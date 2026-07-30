const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('captureHud', {
  ready: () => ipcRenderer.send('capture-hud:ready'),
  onState: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('capture-hud:state', listener);
    return () => ipcRenderer.removeListener('capture-hud:state', listener);
  },
});
