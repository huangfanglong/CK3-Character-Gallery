const assert = require('node:assert/strict');
const { PortraitPreviewStore } = require('../electron/portrait-preview-store.cjs');

function deferred() {
  let finish;
  let fail;
  const promise = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  return { promise, resolve: finish, reject: fail };
}

async function main() {
  const pendingWrite = deferred();
  const removed = [];
  let sourceActive = true;
  let fileWritten = false;
  const store = new PortraitPreviewStore({
    tempDirectory: () => 'C:\\preview-temp',
    processId: 42,
    toFileUrl: (filePath) => `file:///${filePath.replace(/\\/g, '/')}`,
    writeFile: async () => { await pendingWrite.promise; fileWritten = true; },
    removeFile: async (filePath) => { if (fileWritten) removed.push(filePath); },
    removeFileSync: (filePath) => { if (fileWritten) removed.push(filePath); },
    logger: { error() {} },
  });

  const staging = store.stage('source-id', Buffer.from('GIF'), () => sourceActive);
  sourceActive = false;
  store.remove(['source-id']);
  pendingWrite.resolve();

  await assert.rejects(() => staging, /cancelled/i);
  assert.deepEqual(removed, ['C:\\preview-temp\\ck3-character-gallery-42-source-id.gif']);
  assert.equal(store.size, 0);

  let removalAttempts = 0;
  const retries = [];
  const retryStore = new PortraitPreviewStore({
    tempDirectory: () => 'C:\\preview-temp',
    processId: 42,
    toFileUrl: (filePath) => `file:///${filePath.replace(/\\/g, '/')}`,
    writeFile: async () => {},
    removeFile: async () => {
      removalAttempts += 1;
      if (removalAttempts < 5) throw new Error('Preview file is temporarily locked.');
    },
    removeFileSync: () => { throw new Error('Preview file is temporarily locked.'); },
    setTimeout: (callback) => { retries.push(callback); return callback; },
    clearTimeout() {},
    logger: { error() {} },
  });
  await retryStore.stage('retry-source', Buffer.from('GIF'), () => true);
  retryStore.remove(['retry-source']);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(retryStore.size, 1, 'Failed cleanup should retain the preview path for retry.');
  for (let attempt = 0; attempt < 4; attempt += 1) {
    assert.equal(retries.length, 1, 'Failed cleanup should continue scheduling a background retry.');
    retries.shift()();
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(removalAttempts, 5);
  assert.equal(retryStore.size, 0, 'Retried cleanup should remove the retained preview path.');

  const shutdownWrite = deferred();
  const shutdownRemovals = [];
  let shutdownFileWritten = false;
  const shutdownStore = new PortraitPreviewStore({
    tempDirectory: () => 'C:\\preview-temp',
    processId: 42,
    toFileUrl: (filePath) => `file:///${filePath.replace(/\\/g, '/')}`,
    writeFile: async () => { await shutdownWrite.promise; shutdownFileWritten = true; },
    removeFile: async (filePath) => { if (shutdownFileWritten) shutdownRemovals.push(filePath); },
    removeFileSync: (filePath) => { if (shutdownFileWritten) shutdownRemovals.push(filePath); },
    logger: { error() {} },
  });
  const shutdownStage = shutdownStore.stage('shutdown-source', Buffer.from('GIF'), () => true);
  const shutdownDrain = shutdownStore.drain();
  shutdownWrite.resolve();
  await assert.rejects(() => shutdownStage, /cancelled/i);
  await shutdownDrain;
  assert.deepEqual(shutdownRemovals, ['C:\\preview-temp\\ck3-character-gallery-42-shutdown-source.gif']);
  assert.equal(shutdownStore.size, 0, 'Shutdown cleanup should drain a pending staged write.');

  let drainAttempts = 0;
  const drainStore = new PortraitPreviewStore({
    tempDirectory: () => 'C:\\preview-temp',
    processId: 42,
    toFileUrl: (filePath) => `file:///${filePath.replace(/\\/g, '/')}`,
    writeFile: async () => {},
    removeFile: async () => {
      drainAttempts += 1;
      if (drainAttempts < 10) throw new Error('Preview file is temporarily locked.');
    },
    removeFileSync: () => { throw new Error('Preview file is temporarily locked.'); },
    setTimeout: () => ({ unref() {} }),
    clearTimeout() {},
    wait: async () => {},
    logger: { error() {} },
  });
  await drainStore.stage('drain-source', Buffer.from('GIF'), () => true);
  drainStore.remove(['drain-source']);
  await new Promise((resolve) => setImmediate(resolve));
  await drainStore.drain();
  assert.ok(drainAttempts >= 10, 'Shutdown drain should wait through transient removal failures.');
  assert.equal(drainStore.size, 0, 'Shutdown drain should not resolve while a preview path remains.');

  const gateWrite = deferred();
  const gateStore = new PortraitPreviewStore({
    tempDirectory: () => 'C:\\preview-temp',
    processId: 42,
    toFileUrl: (filePath) => `file:///${filePath.replace(/\\/g, '/')}`,
    writeFile: async () => gateWrite.promise,
    removeFile: async () => {},
    removeFileSync() {},
    logger: { error() {} },
  });
  const activeStage = gateStore.stage('active-source', Buffer.from('GIF'), () => true);
  const gatedDrain = gateStore.drain();
  await assert.rejects(() => gateStore.stage('late-source', Buffer.from('GIF'), () => true), /cancelled/i);
  gateWrite.resolve();
  await assert.rejects(() => activeStage, /cancelled/i);
  await gatedDrain;
  assert.equal(gateStore.size, 0, 'Shutdown drain should reject stages started after draining begins.');

  console.log('Portrait preview store test passed: owner teardown, retry, and shutdown cleanup remove staged previews.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
