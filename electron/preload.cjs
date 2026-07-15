const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('galleryDesktop', {
  load: () => ipcRenderer.invoke('library:load'),
  save: (galleries) => ipcRenderer.invoke('library:save', galleries),
  chooseImage: (characterId) => ipcRenderer.invoke('library:choose-image', characterId),
  readClipboardImage: () => ipcRenderer.invoke('library:read-clipboard-image'),
  readImagePath: (value) => ipcRenderer.invoke('library:read-image-path', value),
  saveCroppedImage: (characterId, payload) => ipcRenderer.invoke('library:save-cropped-image', characterId, payload),
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
