const { app, BrowserWindow, clipboard, desktopCapturer, dialog, globalShortcut, ipcMain, Menu, nativeImage, session, shell } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { ensureArchive, saveArchive } = require('./archive-store.cjs');
const { duplicateCharacterInArchive, duplicateGalleryInArchive, exportGalleryToFolder, exportPathFor, importGalleryFromFolder, readGalleryInfo } = require('./gallery-transfer.cjs');
const { MAX_PORTRAIT_BYTES, inspectPortraitSource, processPortraitCrop } = require('./portrait-processor.cjs');
const { appendCaptureFrame, createCaptureEncoder, finishCaptureEncoder } = require('./live-capture.cjs');
const { isCaptureShortcut } = require('./capture-shortcuts.cjs');

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
const portraitSources = new Map();
const captureSources = new Map();
const captureSessions = new Map();
let activeCaptureSessionId = null;
let mainWindow = null;
const dataDirectory = () => isDev
  ? path.resolve(testDataDirectory || path.join(projectRoot, 'character_gallery_data'))
  : path.join(app.getPath('userData'), 'character_gallery_data');

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
    if (gif.length) return { gif };
  }
  const image = clipboard.readImage();
  return image.isEmpty() ? null : { image };
}

async function prepareGifSource(input, previewUrl) {
  const info = await inspectPortraitSource(input);
  if (info.format !== 'gif') throw new Error('The selected file is not a valid GIF image.');
  const sourceId = crypto.randomUUID();
  portraitSources.set(sourceId, input);
  return {
    sourceId,
    dataUrl: previewUrl,
    format: info.format,
    animated: info.animated,
    width: info.width,
    height: info.height,
    frames: info.frames,
  };
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
  mainWindow = window;

  window.webContents.on('before-input-event', (event, input) => {
    const command = input.control || input.meta;
    if (input.type === 'keyDown' && command && input.key.toLowerCase() === 'v' && readClipboardImage()) {
      event.preventDefault();
      window.webContents.send('shortcut:paste-image');
    }
  });
  window.setMenuBarVisibility(false);
  await window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

function releaseCaptureSession(sessionId) {
  const capture = captureSessions.get(sessionId);
  if (!capture) return false;
  if (activeCaptureSessionId === sessionId) {
    globalShortcut.unregister(capture.shortcut);
    activeCaptureSessionId = null;
  }
  captureSessions.delete(sessionId);
  return true;
}

function captureDirectory(characterId) {
  if (typeof characterId !== 'string' || !/^[a-zA-Z0-9-]+$/.test(characterId)) throw new Error('The selected character is invalid.');
  return path.join(dataDirectory(), 'images', characterId);
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

ipcMain.handle('library:choose-image', async (_event, characterId) => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Portrait images', extensions: IMAGE_FILE_EXTENSIONS }],
  });
  if (result.canceled) return null;
  const source = result.filePaths[0];
  const extension = path.extname(source).toLowerCase() || '.png';
  if (extension === '.gif') return prepareGifSource(source, pathToFileURL(source).toString());
  const directory = path.join(dataDirectory(), 'images', characterId);
  await fs.mkdir(directory, { recursive: true });
  const destination = path.join(directory, `${Date.now()}${extension}`);
  await fs.copyFile(source, destination);
  return { path: destination, url: pathToFileURL(destination).toString() };
});

ipcMain.handle('library:read-clipboard-image', async () => {
  const source = readClipboardImage();
  if (!source) return null;
  if (source.filePath && path.extname(source.filePath).toLowerCase() === '.gif') {
    return prepareGifSource(source.filePath, pathToFileURL(source.filePath).toString());
  }
  if (source.gif) {
    return prepareGifSource(source.gif, `data:image/gif;base64,${source.gif.toString('base64')}`);
  }
  const image = source.image || nativeImage.createFromPath(source.filePath);
  if (image.isEmpty()) return null;
  const size = image.getSize();
  return { dataUrl: image.toDataURL(), width: size.width, height: size.height, animated: false };
});

ipcMain.handle('library:read-image-path', (_event, value) => {
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
    return prepareGifSource(imagePath, pathToFileURL(imagePath).toString());
  }
  const image = nativeImage.createFromPath(imagePath);
  if (image.isEmpty()) return null;
  const size = image.getSize();
  return { dataUrl: image.toDataURL(), width: size.width, height: size.height };
});

ipcMain.handle('library:prepare-image-data', async (_event, dataUrl) => {
  const input = bufferFromDataUrl(dataUrl);
  return prepareGifSource(input, dataUrl);
});

ipcMain.handle('library:save-cropped-image', async (_event, characterId, payload) => {
  if (typeof payload.sourceId === 'string' && portraitSources.has(payload.sourceId)) {
    const input = portraitSources.get(payload.sourceId);
    const processed = await processPortraitCrop(input, payload);
    const directory = path.join(dataDirectory(), 'images', characterId);
    await fs.mkdir(directory, { recursive: true });
    const destination = path.join(directory, `${Date.now()}${processed.extension}`);
    await fs.writeFile(destination, processed.data);
    portraitSources.delete(payload.sourceId);
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
  const directory = path.join(dataDirectory(), 'images', characterId);
  await fs.mkdir(directory, { recursive: true });
  const destination = path.join(directory, `${Date.now()}.png`);
  await fs.writeFile(destination, cropped.toPNG());
  return { path: destination, url: pathToFileURL(destination).toString() };
});

ipcMain.handle('library:release-image-source', (_event, sourceId) => portraitSources.delete(sourceId));

ipcMain.handle('capture:list-sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 320, height: 180 } });
  captureSources.clear();
  return sources.filter((source) => /crusader kings iii/i.test(source.name)).map((source) => {
    captureSources.set(source.id, source);
    return { id: source.id, name: source.name, thumbnail: source.thumbnail.toDataURL() };
  });
});

ipcMain.handle('capture:arm', (_event, sourceId, shortcut) => {
  if (!captureSources.has(sourceId)) throw new Error('The selected CK3 window is no longer available.');
  if (activeCaptureSessionId) throw new Error('Another live portrait capture is already active.');
  if (!isCaptureShortcut(shortcut)) throw new Error('Choose one of the available capture shortcuts.');
  const sessionId = crypto.randomUUID();
  if (!globalShortcut.register(shortcut, () => mainWindow?.webContents.send('capture:toggle', sessionId))) {
    throw new Error(`${shortcut} is already in use by another application.`);
  }
  captureSessions.set(sessionId, { sourceId, shortcut, encoder: createCaptureEncoder() });
  activeCaptureSessionId = sessionId;
  return { sessionId, shortcut };
});

ipcMain.handle('capture:append-frame', (_event, sessionId, frame, timestamp) => {
  const capture = captureSessions.get(sessionId);
  if (!capture) throw new Error('The live portrait capture has ended.');
  return appendCaptureFrame(capture.encoder, frame, 450, 450, timestamp);
});

ipcMain.handle('capture:finish', async (_event, sessionId, characterId) => {
  const capture = captureSessions.get(sessionId);
  if (!capture) throw new Error('The live portrait capture has ended.');
  try {
    const data = finishCaptureEncoder(capture.encoder);
    const directory = captureDirectory(characterId);
    await fs.mkdir(directory, { recursive: true });
    const destination = path.join(directory, `${Date.now()}.gif`);
    await fs.writeFile(destination, data);
    return { path: destination, url: pathToFileURL(destination).toString() };
  } finally { releaseCaptureSession(sessionId); }
});

ipcMain.handle('capture:release', (_event, sessionId) => releaseCaptureSession(sessionId));

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
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    const capture = captureSessions.get(activeCaptureSessionId);
    const source = capture && captureSources.get(capture.sourceId);
    callback(source ? { video: source } : {});
  }, { useSystemPicker: false });
  await ensureData();
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

app.on('will-quit', () => globalShortcut.unregisterAll());
