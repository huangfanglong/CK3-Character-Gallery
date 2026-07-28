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
  listCaptureSources: () => ipcRenderer.invoke('capture:list-sources'),
  armCapture: (sourceId) => ipcRenderer.invoke('capture:arm', sourceId),
  appendCaptureFrame: (sessionId, frame, timestamp) => ipcRenderer.invoke('capture:append-frame', sessionId, frame, timestamp),
  finishCapture: (sessionId, characterId) => ipcRenderer.invoke('capture:finish', sessionId, characterId),
  releaseCapture: (sessionId) => ipcRenderer.invoke('capture:release', sessionId),
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
  quit: () => ipcRenderer.invoke('window:quit'),
});
