const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('galleryDesktop', {
  load: () => ipcRenderer.invoke('library:load'),
  save: (galleries) => ipcRenderer.invoke('library:save', galleries),
  chooseImage: (characterId) => ipcRenderer.invoke('library:choose-image', characterId),
  readClipboardImage: () => ipcRenderer.invoke('library:read-clipboard-image'),
  readImagePath: (value) => ipcRenderer.invoke('library:read-image-path', value),
  prepareImageData: (dataUrl) => ipcRenderer.invoke('library:prepare-image-data', dataUrl),
  saveCroppedImage: (characterId, payload) => ipcRenderer.invoke('library:save-cropped-image', characterId, payload),
  releaseImageSource: (sourceId) => ipcRenderer.invoke('library:release-image-source', sourceId),
  listCaptureSources: (gameHwnd = '') => ipcRenderer.invoke('capture:list-sources', gameHwnd),
  armCapture: (sourceId, shortcut, context) => ipcRenderer.invoke('capture:arm', sourceId, shortcut, context),
  setCaptureStatus: (sessionId, status) => ipcRenderer.invoke('capture:status', sessionId, status),
  finishCapture: (sessionId, characterId, video) => ipcRenderer.invoke('capture:finish', sessionId, characterId, video),
  completeCapture: (sessionId, outcome) => ipcRenderer.invoke('capture:complete', sessionId, outcome),
  releaseCapture: (sessionId, failureMessage = '') => ipcRenderer.invoke('capture:release', sessionId, failureMessage),
  onCaptureToggle: (callback) => {
    const listener = (_event, sessionId) => callback(sessionId);
    ipcRenderer.on('capture:toggle', listener);
    return () => ipcRenderer.removeListener('capture:toggle', listener);
  },
  deleteImage: (imagePath) => ipcRenderer.invoke('library:delete-image', imagePath),
  readClipboardText: () => ipcRenderer.invoke('clipboard:read-text'),
  onPasteImage: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('shortcut:paste-image', listener);
    return () => ipcRenderer.removeListener('shortcut:paste-image', listener);
  },
  chooseGallery: () => ipcRenderer.invoke('library:choose-gallery'),
  importGallery: (folder, name) => ipcRenderer.invoke('library:import-gallery', folder, name),
  exportGallery: (gallery) => ipcRenderer.invoke('library:export-gallery', gallery),
  duplicateGallery: (gallery, name) => ipcRenderer.invoke('library:duplicate-gallery', gallery, name),
  duplicateCharacter: (character, name) => ipcRenderer.invoke('library:duplicate-character', character, name),
  openFolder: (directory) => ipcRenderer.invoke('library:open-folder', directory),
  imageUrl: (imagePath) => ipcRenderer.invoke('library:image-url', imagePath),
  updateGameDock: (patch) => ipcRenderer.invoke('game-dock:renderer-state', patch),
  completeGameDockCommand: (operationId, result) => ipcRenderer.invoke('game-dock:renderer-result', operationId, result),
  syncGameDockLibrary: (galleries) => ipcRenderer.invoke('game-dock:sync-library', galleries),
  setGameDockEnabled: (enabled) => ipcRenderer.invoke('game-dock:set-enabled', enabled),
  getGameDockPreferences: () => ipcRenderer.invoke('game-dock:get-preferences'),
  syncLiveGameSelection: (selection) => ipcRenderer.invoke('game-dock:sync-selection', selection),
  setLiveGameLinkChoice: (enabled) => ipcRenderer.invoke('game-dock:set-live-link-choice', enabled),
  setLiveGameLinkEnabled: (enabled) => ipcRenderer.invoke('game-dock:set-live-link-enabled', enabled),
  onGameDockCommand: (callback) => {
    const listener = (_event, command) => callback(command);
    ipcRenderer.on('game-dock:command', listener);
    return () => ipcRenderer.removeListener('game-dock:command', listener);
  },
  onGameDockGameLoss: (callback) => {
    const listener = (_event, detail) => callback(detail);
    ipcRenderer.on('game-dock:game-lost', listener);
    return () => ipcRenderer.removeListener('game-dock:game-lost', listener);
  },
  onGameDockCancel: (callback) => {
    const listener = (_event, detail) => callback(detail);
    ipcRenderer.on('game-dock:cancel', listener);
    return () => ipcRenderer.removeListener('game-dock:cancel', listener);
  },
  onGameDockPreferences: (callback) => {
    const listener = (_event, preferences) => callback(preferences);
    ipcRenderer.on('game-dock:preferences', listener);
    return () => ipcRenderer.removeListener('game-dock:preferences', listener);
  },
  quit: () => ipcRenderer.invoke('window:quit'),
});
