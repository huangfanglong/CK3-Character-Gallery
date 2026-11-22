'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const { LiveGameEngine } = require('./live-game-engine.cjs');

let engine;
try { engine = new LiveGameEngine({ cachePath: workerData.cachePath }); }
catch (error) { engine = { error }; }
let queue = Promise.resolve();

async function execute(message) {
  if (engine.error) throw engine.error;
  const { action } = message;
  if (action === 'set-enabled') return engine.setEnabled(message.enabled);
  if (action === 'import') return engine.import(message.game);
  if (action === 'prepare-apply') return engine.prepareApply(message.game, message.selection);
  if (action === 'confirm-apply') return engine.confirmApply(message.game, message.token);
  if (action === 'undo') return engine.undoApply(message.game);
  if (action === 'cancel') { engine.cancel(); return true; }
  throw new Error('The live-game operation is not supported.');
}

if (parentPort) {
  parentPort.on('message', (message) => {
    const task = queue.then(() => execute(message));
    queue = task.catch(() => {});
    task.then((result) => parentPort.postMessage({ id: message.id, ok: true, result }))
      .catch((error) => parentPort.postMessage({ id: message.id, ok: false, error: String(error.message || error).slice(0, 600) }));
  });
}
