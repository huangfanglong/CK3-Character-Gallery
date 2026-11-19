const { contextBridge, ipcRenderer } = require('electron');

const pending = new Map();
let operationCounter = 0;

ipcRenderer.on('game-dock:result', (_event, result) => {
  const request = pending.get(result?.operationId);
  if (!request) return;
  pending.delete(result.operationId);
  clearTimeout(request.timeout);
  request.resolve(result);
});

contextBridge.exposeInMainWorld('gameDock', {
  ready: () => ipcRenderer.send('game-dock:ready'),
  command(type, payload = {}) {
    const operationId = `${Date.now().toString(36)}-${(++operationCounter).toString(36)}`;
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        pending.delete(operationId);
        resolve({ ok: false, error: 'The gallery did not respond. Try again.' });
      }, 25_000);
      pending.set(operationId, { resolve, timeout });
      ipcRenderer.send('game-dock:command', { operationId, type, payload });
    });
  },
  setInteractive: (interactive) => ipcRenderer.send('game-dock:interactive', Boolean(interactive)),
  setTextInput: (active) => ipcRenderer.send('game-dock:text-input', Boolean(active)),
  onState: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('game-dock:state', listener);
    return () => ipcRenderer.removeListener('game-dock:state', listener);
  },
});
