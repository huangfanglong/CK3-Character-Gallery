const { app, BrowserWindow, clipboard, desktopCapturer, dialog, globalShortcut, ipcMain, Menu, nativeImage, screen, session, shell, webContents } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { ensureArchive, saveArchive } = require('./archive-store.cjs');
const { duplicateCharacterInArchive, duplicateGalleryInArchive, exportGalleryToFolder, exportPathFor, importGalleryFromFolder, readGalleryInfo } = require('./gallery-transfer.cjs');
const { MAX_PORTRAIT_BYTES } = require('./portrait-processor.cjs');
const { PortraitPreviewStore } = require('./portrait-preview-store.cjs');
const { PortraitSourceManager } = require('./portrait-source-manager.cjs');
const { PortraitWorkerClient } = require('./portrait-worker-client.cjs');
const { saveCaptureVideo } = require('./capture-video.cjs');
const { isCaptureShortcut } = require('./capture-shortcuts.cjs');
const { CaptureSessionManager } = require('./capture-session-manager.cjs');
const { CaptureHud } = require('./capture-hud.cjs');
const { imageDirectory } = require('./image-directory.cjs');

const IMAGE_FILE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp'];
const IMAGE_FILE_PATTERN = /\.(png|jpe?g|bmp|gif|webp)$/i;
const isDev = !app.isPackaged;
const projectRoot = path.join(__dirname, '..');
const windowIconPath = isDev
  ? path.join(projectRoot, 'assets', 'bloodline-index.ico')
  : path.join(process.resourcesPath, 'assets', 'bloodline-index.ico');
const testDataDirectory = isDev ? process.env.CK3_GALLERY_TEST_DATA_DIRECTORY : '';
let lastExportParent = null;
let archiveRecoveryWarning = null;
const portraitWorker = new PortraitWorkerClient({ workerPath: path.join(__dirname, 'portrait-worker-thread.cjs') });
const portraitSources = new PortraitSourceManager({ worker: portraitWorker, createId: crypto.randomUUID });
const portraitPreviews = new PortraitPreviewStore();
let portraitPreviewDrainInProgress = false;
let portraitPreviewDrainComplete = false;
const captureSources = new Map();
const captureSessions = new CaptureSessionManager(globalShortcut, crypto.randomUUID);
let captureHud = null;
let mainWindowWebContentsId = null;
const dataDirectory = () => isDev
  ? path.resolve(testDataDirectory || path.join(projectRoot, 'character_gallery_data'))
  : path.join(app.getPath('userData'), 'character_gallery_data');

function ensureCaptureHud() {
  captureHud ||= new CaptureHud({
    BrowserWindow,
    screen,
    htmlPath: path.join(__dirname, 'capture-hud.html'),
    preloadPath: path.join(__dirname, 'capture-hud-preload.cjs'),
  });
  return captureHud;
}

function destroyCaptureHud() {
  const hud = captureHud;
  captureHud = null;
  if (!hud) return true;
  try {
    hud.destroy();
    return true;
  } catch (error) {
    console.error('Capture HUD could not be destroyed:', error);
    return false;
  }
}

function readClipboardImagePath() {
  const formats = clipboard.availableFormats();
  const fileFormat = formats.find((format) => /filenamew|filename/i.test(format));
  if (fileFormat) {
    const buffer = clipboard.readBuffer(fileFormat);
    const encoding = /filenamew/i.test(fileFormat) ? 'utf16le' : 'utf8';
    const filePath = buffer.toString(encoding).split('\0')[0].trim().replace(/^"|"$/g, '');
    if (IMAGE_FILE_PATTERN.test(filePath)) return filePath;
  }

  const textPath = clipboard.readText().trim().replace(/^"|"$/g, '');
  return IMAGE_FILE_PATTERN.test(textPath) ? textPath : '';
}

function readClipboardImage() {
  const filePath = readClipboardImagePath();
  if (filePath) return { filePath };
  const gifFormat = clipboard.availableFormats().find((format) => /^(image\/gif|gif)$/i.test(format));
  if (gifFormat) {
    const gif = clipboard.readBuffer(gifFormat);
    if (gif.length > MAX_PORTRAIT_BYTES) return { error: 'Animated portrait exceeds the 50 MB file-size limit.' };
    if (gif.length) return { gif };
  }
  const image = clipboard.readImage();
  return image.isEmpty() ? null : { image };
}

function removePortraitPreviewFiles(sourceIds) {
  portraitPreviews.remove(sourceIds);
}

async function releasePortraitSource(ownerWebContentsId, sourceId) {
  const ownedSource = portraitSources.sourceIdsForOwner(ownerWebContentsId).includes(sourceId);
  try {
    return await portraitSources.release(ownerWebContentsId, sourceId);
  } finally {
    if (ownedSource) removePortraitPreviewFiles([sourceId]);
  }
}

async function releasePortraitSourcesByOwner(ownerWebContentsId) {
  const sourceIds = portraitSources.sourceIdsForOwner(ownerWebContentsId);
  try {
    await portraitSources.releaseByOwner(ownerWebContentsId);
  } finally {
    removePortraitPreviewFiles(sourceIds);
  }
}

async function prepareGifSource(ownerWebContentsId, input) {
  await releasePortraitSourcesByOwner(ownerWebContentsId);
  const info = await portraitSources.prepare(ownerWebContentsId, input);
  try {
    if (info.format !== 'gif') throw new Error('The selected file is not a valid GIF image.');
    const previewUrl = await portraitPreviews.stage(
      info.sourceId,
      portraitSources.inputFor(ownerWebContentsId, info.sourceId),
      () => {
        try {
          portraitSources.inputFor(ownerWebContentsId, info.sourceId);
          return true;
        } catch {
          return false;
        }
      },
    );
    return {
      sourceId: info.sourceId,
      dataUrl: previewUrl,
      format: info.format,
      animated: info.animated,
      width: info.width,
      height: info.height,
      frames: info.frames,
    };
  } catch (error) {
    await releasePortraitSource(ownerWebContentsId, info.sourceId).catch(() => {});
    throw error;
  }
}

function bufferFromDataUrl(value) {
  if (typeof value !== 'string') throw new Error('The image data is invalid.');
  const match = /^data:image\/gif;base64,([a-z0-9+/=]+)$/i.exec(value);
  if (!match) throw new Error('Only GIF data can use the animated portrait pipeline.');
  if (match[1].length > Math.ceil(MAX_PORTRAIT_BYTES / 3) * 4) {
    throw new Error('Animated portrait exceeds the 50 MB file-size limit.');
  }
  return Buffer.from(match[1], 'base64');
}

async function ensureData() {
  const data = await ensureArchive(dataDirectory());
  if (data.warning) archiveRecoveryWarning = { warning: data.warning, recoveryFile: data.recoveryFile };
  return archiveRecoveryWarning && !data.warning ? { ...data, ...archiveRecoveryWarning } : data;
}

async function createWindow() {
  ensureCaptureHud();
  const window = new BrowserWindow({
    width: 1540,
    height: 960,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#0d100f',
    icon: windowIconPath,
    title: 'The Bloodline Index',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0d100f',
      symbolColor: '#d8d0c1',
      height: 38,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const contents = window.webContents;
  const ownerWebContentsId = contents.id;
  mainWindowWebContentsId = ownerWebContentsId;
  const releaseOwnedCaptures = () => releaseCaptureSessionsByOwner(ownerWebContentsId);
  const releaseOwnedPortraitSources = () => { void releasePortraitSourcesByOwner(ownerWebContentsId).catch(() => {}); };
  contents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) { releaseOwnedCaptures(); releaseOwnedPortraitSources(); }
  });
  contents.on('render-process-gone', () => { releaseOwnedCaptures(); releaseOwnedPortraitSources(); });
  contents.once('destroyed', () => { releaseOwnedCaptures(); releaseOwnedPortraitSources(); });
  contents.on('will-navigate', (event) => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.once('closed', () => {
    if (mainWindowWebContentsId === ownerWebContentsId) mainWindowWebContentsId = null;
    if (!destroyCaptureHud()) app.quit();
  });

  contents.on('before-input-event', (event, input) => {
    const command = input.control || input.meta;
    if (input.type === 'keyDown' && command && input.key.toLowerCase() === 'v' && readClipboardImage()) {
      event.preventDefault();
      contents.send('shortcut:paste-image');
    }
  });
  window.setMenuBarVisibility(false);
  await window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

function releaseCaptureSession(sessionId, terminalStatus = null) {
  const released = captureSessions.release(sessionId);
  try { captureHud?.release(sessionId, terminalStatus); }
  catch (error) { console.error('Capture HUD could not release:', error); }
  return released;
}

function releaseCaptureSessionsByOwner(ownerWebContentsId) {
  const sessionId = captureSessions.activeSessionId;
  const capture = sessionId && captureSessions.get(sessionId);
  captureSessions.releaseByOwner(ownerWebContentsId);
  if (capture?.ownerWebContentsId === ownerWebContentsId) {
    try { captureHud?.release(sessionId); }
    catch (error) { console.error('Capture HUD could not release:', error); }
  }
}

function requireTrustedCaptureSender(event) {
  const senderFrame = event.senderFrame;
  const mainFrame = event.sender.mainFrame;
  if (event.sender.id !== mainWindowWebContentsId || !senderFrame || senderFrame.processId !== mainFrame.processId || senderFrame.routingId !== mainFrame.routingId) {
    throw new Error('Live capture is only available from the gallery window.');
  }
}

function requireCaptureOwner(event, sessionId) {
  requireTrustedCaptureSender(event);
  const capture = captureSessions.get(sessionId);
  if (!capture) throw new Error('The live portrait capture has ended.');
  if (capture.ownerWebContentsId !== event.sender.id) throw new Error('The live portrait capture belongs to another window.');
  return capture;
}

function captureFailureMessage(value) {
  if (typeof value !== 'string' || value.length > 256) throw new Error('Capture failure message is invalid.');
  return value.trim();
}

ipcMain.handle('library:load', async () => {
  const data = await ensureData();
  return {
    galleries: data.galleries,
    dataDirectory: data.directory,
    warning: data.warning,
    recoveryFile: data.recoveryFile,
  };
});

ipcMain.handle('library:save', async (_event, galleries) => {
  return saveArchive(dataDirectory(), galleries);
});

ipcMain.handle('library:choose-image', async (event, characterId) => {
  const directory = imageDirectory(dataDirectory(), characterId);
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Portrait images', extensions: IMAGE_FILE_EXTENSIONS }],
  });
  if (result.canceled) return null;
  const source = result.filePaths[0];
  const extension = path.extname(source).toLowerCase() || '.png';
  if (extension === '.gif') return prepareGifSource(event.sender.id, source);
  await fs.mkdir(directory, { recursive: true });
  const destination = path.join(directory, `${Date.now()}${extension}`);
  await fs.copyFile(source, destination);
  return { path: destination, url: pathToFileURL(destination).toString() };
});

ipcMain.handle('library:read-clipboard-image', async (event) => {
  const source = readClipboardImage();
  if (!source) return null;
  if (source.error) throw new Error(source.error);
  if (source.filePath && path.extname(source.filePath).toLowerCase() === '.gif') {
    return prepareGifSource(event.sender.id, source.filePath);
  }
  if (source.gif) {
    return prepareGifSource(event.sender.id, source.gif);
  }
  const image = source.image || nativeImage.createFromPath(source.filePath);
  if (image.isEmpty()) return null;
  const size = image.getSize();
  return { dataUrl: image.toDataURL(), width: size.width, height: size.height, animated: false };
});

ipcMain.handle('library:read-image-path', (event, value) => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const firstValue = value.split(/\r?\n/).find((line) => line && !line.startsWith('#'))?.trim();
  if (!firstValue) return null;
  let imagePath = firstValue;
  try {
    if (imagePath.startsWith('file:')) imagePath = fileURLToPath(imagePath);
  } catch {
    return null;
  }
  if (!IMAGE_FILE_PATTERN.test(imagePath)) return null;
  if (path.extname(imagePath).toLowerCase() === '.gif') {
    return prepareGifSource(event.sender.id, imagePath);
  }
  const image = nativeImage.createFromPath(imagePath);
  if (image.isEmpty()) return null;
  const size = image.getSize();
  return { dataUrl: image.toDataURL(), width: size.width, height: size.height };
});

ipcMain.handle('library:prepare-image-data', async (event, dataUrl) => {
  const input = bufferFromDataUrl(dataUrl);
  return prepareGifSource(event.sender.id, input);
});

ipcMain.handle('library:save-cropped-image', async (event, characterId, payload) => {
  const directory = imageDirectory(dataDirectory(), characterId);
  if (payload?.sourceId !== null && payload?.sourceId !== undefined && payload.sourceId !== '') {
    if (typeof payload.sourceId !== 'string') throw new Error('The animated portrait source is invalid.');
    const processed = await portraitSources.process(event.sender.id, payload.sourceId, payload);
    const destination = path.join(directory, `${Date.now()}${processed.extension}`);
    const persisted = await portraitSources.persist(event.sender.id, payload.sourceId, async () => {
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(destination, processed.data);
      return destination;
    });
    if (persisted.cancelled) {
      await fs.rm(destination, { force: true }).catch(() => {});
      throw new Error('Animated portrait processing was cancelled.');
    }
    await releasePortraitSource(event.sender.id, payload.sourceId);
    return { path: destination, url: pathToFileURL(destination).toString() };
  }
  const image = nativeImage.createFromDataURL(payload.dataUrl);
  if (image.isEmpty()) throw new Error('The clipboard image could not be decoded.');
  const imageSize = image.getSize();
  const x = Math.max(0, Math.min(Math.round(payload.x), imageSize.width - 1));
  const y = Math.max(0, Math.min(Math.round(payload.y), imageSize.height - 1));
  const side = Math.max(1, Math.min(Math.round(payload.size), imageSize.width - x, imageSize.height - y));
  const cropped = image.crop({ x, y, width: side, height: side }).resize({
    width: 450,
    height: 450,
    quality: 'best',
  });
  await fs.mkdir(directory, { recursive: true });
  const destination = path.join(directory, `${Date.now()}.png`);
  await fs.writeFile(destination, cropped.toPNG());
  return { path: destination, url: pathToFileURL(destination).toString() };
});

ipcMain.handle('library:release-image-source', (event, sourceId) => {
  if (typeof sourceId !== 'string' || !sourceId) return false;
  return releasePortraitSource(event.sender.id, sourceId);
});

ipcMain.handle('capture:list-sources', async (event) => {
  requireTrustedCaptureSender(event);
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 320, height: 180 } });
  captureSources.clear();
  return sources.filter((source) => /crusader kings iii/i.test(source.name)).map((source) => {
    captureSources.set(source.id, source);
    return { id: source.id, name: source.name, thumbnail: source.thumbnail.toDataURL() };
  });
});

ipcMain.handle('capture:arm', (event, sourceId, shortcut) => {
  requireTrustedCaptureSender(event);
  const source = captureSources.get(sourceId);
  if (!source) throw new Error('The selected CK3 window is no longer available.');
  if (!isCaptureShortcut(shortcut)) throw new Error('Choose one of the available capture shortcuts.');
  const sessionId = captureSessions.arm({
    sourceId,
    shortcut,
    ownerWebContentsId: event.sender.id,
    onToggle: (id) => {
      if (event.sender.isDestroyed()) {
        releaseCaptureSession(id);
        return;
      }
      event.sender.send('capture:toggle', id);
    },
  });
  try {
    const hud = ensureCaptureHud();
    hud.arm(sessionId, { displayId: source.display_id, shortcut });
    hud.update(sessionId, { state: 'starting' });
  } catch (error) { releaseCaptureSession(sessionId); throw error; }
  return { sessionId, shortcut };
});

ipcMain.handle('capture:status', (event, sessionId, status) => {
  const capture = requireCaptureOwner(event, sessionId);
  if (!['armed', 'starting', 'recording', 'matching', 'saving'].includes(status?.state)) throw new Error('Capture status is invalid.');
  if (status.state === 'recording' && (!Number.isFinite(status.startedAt) || status.startedAt < Date.now() - 60_000 || status.startedAt > Date.now() + 5_000)) throw new Error('Capture start time is invalid.');
  if (status.state === 'matching' && (!Number.isFinite(capture.startedAt) || !Number.isFinite(status.deadline) || status.deadline < Date.now() - 1_000 || status.deadline > capture.startedAt + 25_000)) throw new Error('Capture loop deadline is invalid.');
  captureSessions.transition(sessionId, status.state, status);
  try { return ensureCaptureHud().update(sessionId, { state: status.state, startedAt: status.startedAt, deadline: status.deadline }); }
  catch (error) { console.error('Capture HUD could not update:', error); return false; }
});

ipcMain.handle('capture:finish', async (event, sessionId, characterId, video) => {
  const capture = requireCaptureOwner(event, sessionId);
  if (capture.phase !== 'saving') throw new Error('Live portrait capture is not ready to save.');
  captureSessions.transition(sessionId, 'writing');
  try {
    const destination = await saveCaptureVideo(imageDirectory(dataDirectory(), characterId), video);
    if (!captureSessions.get(sessionId)) {
      await fs.unlink(destination).catch(() => {});
      throw new Error('The live portrait capture has ended.');
    }
    captureSessions.transition(sessionId, 'written');
    return { path: destination, url: pathToFileURL(destination).toString() };
  } catch (error) {
    releaseCaptureSession(sessionId, { state: 'failed', message: error.message });
    throw error;
  }
});

ipcMain.handle('capture:complete', (event, sessionId, outcome) => {
  const capture = requireCaptureOwner(event, sessionId);
  if (capture.phase !== 'written') throw new Error('Live portrait capture is not ready to complete.');
  if (outcome?.state === 'saved') return releaseCaptureSession(sessionId, { state: 'saved' });
  if (outcome?.state === 'cancelled') return releaseCaptureSession(sessionId);
  if (outcome?.state === 'failed') return releaseCaptureSession(sessionId, { state: 'failed', message: captureFailureMessage(outcome.message) });
  throw new Error('Capture completion status is invalid.');
});

ipcMain.handle('capture:release', (event, sessionId, failureMessage = '') => {
  requireCaptureOwner(event, sessionId);
  const message = captureFailureMessage(failureMessage);
  return releaseCaptureSession(sessionId, message ? { state: 'failed', message } : null);
});

ipcMain.handle('library:delete-image', async (_event, imagePath) => {
  if (typeof imagePath !== 'string' || !imagePath) return false;
  const imageRoot = path.resolve(dataDirectory(), 'images');
  const resolvedImage = path.resolve(imagePath);
  const relative = path.relative(imageRoot, resolvedImage);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Portrait path is outside the local archive.');
  }
  try {
    await fs.unlink(resolvedImage);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return true;
});

ipcMain.handle('clipboard:read-text', () => {
  return clipboard.readText();
});

ipcMain.handle('library:choose-gallery', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return result.canceled ? null : readGalleryInfo(result.filePaths[0]);
});

ipcMain.handle('library:import-gallery', async (_event, folder, galleryName) => {
  return importGalleryFromFolder(folder, galleryName, dataDirectory());
});

ipcMain.handle('library:export-gallery', async (_event, gallery) => {
  const suggestedDirectory = exportPathFor(gallery, lastExportParent || app.getPath('documents'));
  const result = await dialog.showSaveDialog({
    title: 'Export collection',
    defaultPath: suggestedDirectory,
    buttonLabel: 'Export',
    nameFieldLabel: 'Collection folder:',
  });
  if (result.canceled || !result.filePath) return null;
  const exportDirectory = path.resolve(result.filePath);
  let replace = false;
  try {
    await fs.access(exportDirectory);
    try { await fs.access(path.join(exportDirectory, 'characters.json')); }
    catch { throw new Error('A same-named folder already exists and is not a collection export. Choose another location.'); }
    const confirmation = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Replace', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Replace existing export?',
      message: `${path.basename(exportDirectory)} already exists.`,
      detail: 'Replacing it removes the existing exported folder before writing the new copy.',
    });
    if (confirmation.response !== 0) return null;
    replace = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const folder = await exportGalleryToFolder(gallery, exportDirectory, { replace, sourceRoot: projectRoot });
  lastExportParent = path.dirname(folder);
  return { folder };
});

ipcMain.handle('library:duplicate-gallery', async (_event, gallery, duplicateName) => (
  duplicateGalleryInArchive(gallery, duplicateName, dataDirectory(), projectRoot)
));

ipcMain.handle('library:duplicate-character', async (_event, character, duplicateName) => (
  duplicateCharacterInArchive(character, duplicateName, dataDirectory(), projectRoot)
));

ipcMain.handle('library:open-folder', async (_event, directory) => {
  await shell.openPath(directory);
});

ipcMain.handle('window:quit', () => app.quit());

ipcMain.handle('library:image-url', (_event, imagePath) => {
  if (!imagePath) return null;
  const resolved = path.isAbsolute(imagePath) ? imagePath : path.resolve(projectRoot, imagePath);
  return pathToFileURL(resolved).toString();
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    const capture = captureSessions.get(captureSessions.activeSessionId);
    const source = capture && captureSources.get(capture.sourceId);
    const requestingContents = request.frame && webContents.fromFrame(request.frame);
    const isOwnerMainFrame = request.frame?.parent === null && requestingContents?.id === capture?.ownerWebContentsId;
    callback(source && isOwnerMainFrame ? { video: source } : {});
  }, { useSystemPicker: false });
  session.fromPartition('capture-hud').setDisplayMediaRequestHandler((_request, callback) => callback({}), { useSystemPicker: false });
  await ensureData();
  ensureCaptureHud();
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow().catch((error) => console.error('Failed to create a window:', error));
    }
  });
}).catch((error) => {
  console.error('Failed to start the application:', error);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  if (portraitPreviewDrainComplete) return;
  event.preventDefault();
  if (portraitPreviewDrainInProgress) return;
  portraitPreviewDrainInProgress = true;
  for (const window of BrowserWindow.getAllWindows()) {
    try {
      if (!window.isDestroyed()) window.destroy();
    } catch (error) {
      console.error('Failed to destroy a window during shutdown:', error);
    }
  }
  void portraitPreviews.drain()
    .catch((error) => console.error('Failed to drain staged portrait previews:', error))
    .finally(() => {
      portraitPreviewDrainComplete = true;
      app.quit();
    });
});

app.on('will-quit', () => {
  portraitPreviews.removeAll();
  void portraitWorker.destroy().catch(() => {});
  destroyCaptureHud();
  globalShortcut.unregisterAll();
});
