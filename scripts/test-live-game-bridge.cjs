const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { LiveGameBridge } = require('../electron/live-game-bridge.cjs');

class FakeWorker extends EventEmitter {
  constructor() { super(); this.messages = []; this.terminated = false; }
  postMessage(message) { this.messages.push(message); }
  terminate() { this.terminated = true; return Promise.resolve(0); }
}

async function runningBridge() {
  const worker = new FakeWorker();
  const bridge = new LiveGameBridge({ workerFactory: () => worker, logger: { error() {} } });
  const enabling = bridge.setEnabled(true);
  worker.emit('message', { id: worker.messages[0].id, ok: true, result: true });
  await enabling;
  return { bridge, worker };
}

(async () => {
  const disabled = await runningBridge();
  const confirmation = disabled.bridge.confirmApply({ pid: 42, executablePath: 'C:\\fixture\\ck3.exe' }, '123e4567-e89b-42d3-a456-426614174000');
  await disabled.bridge.setEnabled(false);
  await assert.rejects(confirmation, /interrupted during a write.*unconfirmed/);
  assert.equal(disabled.worker.terminated, true);

  const crashed = await runningBridge();
  const undo = crashed.bridge.undo({ pid: 42, executablePath: 'C:\\fixture\\ck3.exe' });
  crashed.worker.emit('error', new Error('Synthetic worker crash'));
  await assert.rejects(undo, /interrupted during a write.*unconfirmed/);
  assert.equal(crashed.worker.terminated, true);
  await crashed.bridge.close();

  const interruptedRead = await runningBridge();
  const importing = interruptedRead.bridge.import({ pid: 42, executablePath: 'C:\\fixture\\ck3.exe' });
  interruptedRead.worker.emit('error', new Error('Synthetic read interruption'));
  await assert.rejects(importing, /interrupted before the action completed/);
  await interruptedRead.bridge.close();

  const timedOut = await runningBridge();
  const timeoutAssertion = assert.rejects(timedOut.bridge.request('confirm-apply', { game: { pid: 42, executablePath: 'C:\\fixture\\ck3.exe' }, token: '123e4567-e89b-42d3-a456-426614174000' }, 5), /stopped responding during a write.*unconfirmed/);
  /* The bridge deliberately unreferences its request timers. Keep this test process alive
     long enough to prove the timeout branch instead of letting Node exit successfully early. */
  await new Promise((resolve) => setTimeout(resolve, 25));
  await timeoutAssertion;
  assert.equal(timedOut.worker.terminated, true);
  await timedOut.bridge.close();

  const replacementWorkers = [];
  const restarted = new LiveGameBridge({ workerFactory: () => { const worker = new FakeWorker(); replacementWorkers.push(worker); return worker; }, logger: { error() {} } });
  let afterRestart;
  try {
    const initialEnable = restarted.setEnabled(true);
    replacementWorkers[0].emit('message', { id: replacementWorkers[0].messages[0].id, ok: true, result: true });
    await initialEnable;
    restarted.worker.emit('error', new Error('Synthetic unexpected worker exit'));
    afterRestart = restarted.import({ pid: 1073741822, executablePath: 'C:\\fixture\\ck3.exe' });
    assert.equal(replacementWorkers.length, 2);
    assert.deepEqual(replacementWorkers[1].messages.map((message) => message.action), ['set-enabled'], 'A replacement worker must be enabled before Import is queued.');
    replacementWorkers[1].emit('message', { id: replacementWorkers[1].messages[0].id, ok: true, result: true });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(replacementWorkers[1].messages.map((message) => message.action), ['set-enabled', 'import']);
    replacementWorkers[1].emit('message', { id: replacementWorkers[1].messages[1].id, ok: true, result: { dna: 'genes={}', target: { id: 1, name: 'Aella' }, geneCount: 24 } });
    assert.equal((await afterRestart).target.name, 'Aella');
  } finally {
    const settling = afterRestart ? afterRestart.catch(() => {}) : null;
    await restarted.close();
    await settling;
  }

  const workers = [];
  const racing = new LiveGameBridge({ workerFactory: () => { const worker = new FakeWorker(); workers.push(worker); return worker; }, logger: { error() {} } });
  const keepAlive = setInterval(() => {}, 1000);
  const firstEnable = racing.setEnabled(true);
  let secondEnable;
  try {
    await racing.setEnabled(false);
    secondEnable = racing.setEnabled(true);
    assert.equal(await firstEnable, false, 'An older enable completes as stale instead of failing the newer choice.');
    assert.equal(workers.length, 2);
    workers[1].emit('message', { id: workers[1].messages[0].id, ok: true, result: true });
    assert.equal(await secondEnable, true);
    assert.equal(racing.worker, workers[1], 'A stale enable failure cannot terminate the replacement worker.');
    assert.equal(racing.enabled, true);
  } finally {
    await racing.close();
    await Promise.allSettled([firstEnable, secondEnable].filter(Boolean));
    clearInterval(keepAlive);
  }
  console.log('Live game bridge tests passed: interrupted writes, retryable read failures, bounded timeouts, and stale enable isolation.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
