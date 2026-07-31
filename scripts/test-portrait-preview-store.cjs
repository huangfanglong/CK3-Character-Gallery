const assert = require('node:assert/strict');
const { PortraitPreviewStore } = require('../electron/portrait-preview-store.cjs');

function deferred() {
  let finish;
  let fail;
  const promise = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  return { promise, resolve: finish, reject: fail };
}

async function settleOrTimeout(promise, timeoutMs = 100) {
  let timeout;
  try {
    return await Promise.race([
      promise.then((value) => ({ settled: true, value })),
      new Promise((resolve) => { timeout = setTimeout(() => resolve({ settled: false }), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
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
  let releaseDrainRetries = false;
  let drainTime = 0;
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
    drainTimeoutMs: 10_000,
    now: () => drainTime,
    setTimeout: (callback, delay) => {
      const timer = { cancelled: false, unref() {} };
      if (releaseDrainRetries && delay < 10_000) queueMicrotask(() => {
        if (!timer.cancelled) {
          drainTime += delay;
          callback();
        }
      });
      return timer;
    },
    clearTimeout(timer) { timer.cancelled = true; },
    logger: { error() {} },
  });
  await drainStore.stage('drain-source', Buffer.from('GIF'), () => true);
  drainStore.remove(['drain-source']);
  await new Promise((resolve) => setImmediate(resolve));
  releaseDrainRetries = true;
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

  let permanentlyLocked = true;
  const drainWarnings = [];
  const boundedStore = new PortraitPreviewStore({
    tempDirectory: () => 'C:\\preview-temp',
    processId: 42,
    toFileUrl: (filePath) => `file:///${filePath.replace(/\\/g, '/')}`,
    writeFile: async () => {},
    removeFile: async () => {
      if (permanentlyLocked) throw new Error('Preview file remains locked.');
    },
    removeFileSync: () => {
      if (permanentlyLocked) throw new Error('Preview file remains locked.');
    },
    drainTimeoutMs: 5,
    logger: {
      error() {},
      warn(message, details) { drainWarnings.push({ message, details }); },
    },
  });
  await boundedStore.stage('permanently-locked-source', Buffer.from('GIF'), () => true);
  boundedStore.remove(['permanently-locked-source']);
  const boundedDrain = boundedStore.drain();
  const boundedOutcome = await settleOrTimeout(boundedDrain);
  permanentlyLocked = false;
  if (!boundedOutcome.settled) await boundedDrain;
  const permanentlyLockedPath = 'C:\\preview-temp\\ck3-character-gallery-42-permanently-locked-source.gif';
  assert.equal(boundedOutcome.settled, true, 'Shutdown cleanup must finish by its deadline when a preview remains locked.');
  assert.deepEqual(boundedOutcome.value, [permanentlyLockedPath]);
  assert.equal(boundedStore.size, 1, 'Timed-out cleanup should retain unresolved previews for diagnostic reporting.');
  assert.ok(drainWarnings.some(({ details }) => details?.paths?.includes(permanentlyLockedPath)), 'Timed-out cleanup should log the unresolved preview path.');

  const stalledWrite = deferred();
  const writeWarnings = [];
  const stalledWriteStore = new PortraitPreviewStore({
    tempDirectory: () => 'C:\\preview-temp',
    processId: 42,
    toFileUrl: (filePath) => `file:///${filePath.replace(/\\/g, '/')}`,
    writeFile: () => stalledWrite.promise,
    removeFile: async () => {},
    removeFileSync() {},
    drainTimeoutMs: 5,
    logger: {
      error() {},
      warn(message, details) { writeWarnings.push({ message, details }); },
    },
  });
  const stalledStage = stalledWriteStore.stage('stalled-write-source', Buffer.from('GIF'), () => true);
  const stalledStageFailure = stalledStage.catch((error) => error);
  const stalledDrain = stalledWriteStore.drain();
  const stalledOutcome = await settleOrTimeout(stalledDrain);
  stalledWrite.resolve();
  await stalledStageFailure;
  if (!stalledOutcome.settled) await stalledDrain;
  const stalledWritePath = 'C:\\preview-temp\\ck3-character-gallery-42-stalled-write-source.gif';
  assert.equal(stalledOutcome.settled, true, 'Shutdown cleanup must finish by its deadline when a staged write stalls.');
  assert.deepEqual(stalledOutcome.value, [stalledWritePath]);
  assert.ok(writeWarnings.some(({ details }) => details?.paths?.includes(stalledWritePath)), 'Timed-out cleanup should log stalled write paths.');

  const mixedStalledWrite = deferred();
  let mixedWriteCount = 0;
  const mixedRemovals = [];
  const mixedDrainStore = new PortraitPreviewStore({
    tempDirectory: () => 'C:\\preview-temp',
    processId: 42,
    toFileUrl: (filePath) => `file:///${filePath.replace(/\\/g, '/')}`,
    writeFile: async () => {
      mixedWriteCount += 1;
      if (mixedWriteCount === 2) await mixedStalledWrite.promise;
    },
    removeFile: async (filePath) => { mixedRemovals.push(filePath); },
    removeFileSync: () => { throw new Error('Shutdown cleanup must not call fs.rmSync.'); },
    drainTimeoutMs: 5,
    logger: { error() {}, warn() {} },
  });
  await mixedDrainStore.stage('ready-during-stalled-write', Buffer.from('GIF'), () => true);
  const mixedStalledStage = mixedDrainStore.stage('stalled-during-ready-cleanup', Buffer.from('GIF'), () => true);
  const mixedStalledStageFailure = mixedStalledStage.catch((error) => error);
  const mixedOutcome = await settleOrTimeout(mixedDrainStore.drain());
  const readyDuringStallPath = 'C:\\preview-temp\\ck3-character-gallery-42-ready-during-stalled-write.gif';
  assert.equal(mixedOutcome.settled, true, 'Shutdown cleanup must remain bounded while a staged write stalls.');
  assert.ok(mixedRemovals.includes(readyDuringStallPath), 'Ready previews must be removed while another staged write is still pending.');
  mixedStalledWrite.resolve();
  await mixedStalledStageFailure;

  let synchronousDrainRemovals = 0;
  const asynchronousDrainStore = new PortraitPreviewStore({
    tempDirectory: () => 'C:\\preview-temp',
    processId: 42,
    toFileUrl: (filePath) => `file:///${filePath.replace(/\\/g, '/')}`,
    writeFile: async () => {},
    removeFile: async () => {},
    removeFileSync: () => {
      synchronousDrainRemovals += 1;
      throw new Error('Shutdown cleanup must not call fs.rmSync.');
    },
    logger: { error() {} },
  });
  await asynchronousDrainStore.stage('asynchronous-drain-source', Buffer.from('GIF'), () => true);
  assert.deepEqual(await asynchronousDrainStore.drain(), [], 'Asynchronous drain cleanup should remove previews successfully.');
  assert.equal(synchronousDrainRemovals, 0, 'Shutdown cleanup must not call synchronous file removal.');

  let lockedDuringDrain = true;
  let drainLockAttempts = 0;
  const adaptiveRetryStore = new PortraitPreviewStore({
    tempDirectory: () => 'C:\\preview-temp',
    processId: 42,
    toFileUrl: (filePath) => `file:///${filePath.replace(/\\/g, '/')}`,
    writeFile: async () => {},
    removeFile: async () => {
      drainLockAttempts += 1;
      if (lockedDuringDrain) throw new Error('Preview file is temporarily locked.');
    },
    removeFileSync: () => { throw new Error('Shutdown cleanup must not call fs.rmSync.'); },
    drainTimeoutMs: 200,
    logger: { error() {} },
  });
  await adaptiveRetryStore.stage('adaptive-retry-source', Buffer.from('GIF'), () => true);
  const releaseDrainLock = setTimeout(() => { lockedDuringDrain = false; }, 75);
  const adaptiveResult = await adaptiveRetryStore.drain();
  clearTimeout(releaseDrainLock);
  assert.deepEqual(adaptiveResult, [], 'Drain retries should use the remaining deadline budget to remove a transiently locked preview.');
  assert.ok(drainLockAttempts >= 2, 'Drain should retry after the preview lock is released.');

  const drainWaitTimers = [];
  const drainWaitStore = new PortraitPreviewStore({
    tempDirectory: () => 'C:\\preview-temp',
    processId: 42,
    toFileUrl: (filePath) => `file:///${filePath.replace(/\\/g, '/')}`,
    writeFile: async () => {},
    removeFile: async () => { throw new Error('Preview file remains locked.'); },
    removeFileSync: () => { throw new Error('Shutdown cleanup must not call fs.rmSync.'); },
    drainTimeoutMs: 10,
    setTimeout: (callback, delay) => {
      const timer = { delay, cancelled: false, native: null, unref() {} };
      if (delay === 10) timer.native = global.setTimeout(callback, delay);
      drainWaitTimers.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      timer.cancelled = true;
      if (timer.native) global.clearTimeout(timer.native);
    },
    logger: { error() {}, warn() {} },
  });
  await drainWaitStore.stage('drain-wait-source', Buffer.from('GIF'), () => true);
  await drainWaitStore.drain();
  assert.equal(drainWaitTimers.find(({ delay }) => delay !== 10)?.cancelled, true, 'Shutdown timeout must cancel a pending drain backoff timer.');

  const lateFailure = deferred();
  let synchronousRemovalSucceeds = false;
  const staleRetryTimers = [];
  const staleRetryStore = new PortraitPreviewStore({
    tempDirectory: () => 'C:\\preview-temp',
    processId: 42,
    toFileUrl: (filePath) => `file:///${filePath.replace(/\\/g, '/')}`,
    writeFile: async () => {},
    removeFile: () => lateFailure.promise,
    removeFileSync: () => {
      if (!synchronousRemovalSucceeds) throw new Error('Preview file is temporarily locked.');
    },
    setTimeout: (callback, delay) => {
      const timer = { callback, delay, cancelled: false, unref() {} };
      staleRetryTimers.push(timer);
      return timer;
    },
    clearTimeout(timer) { timer.cancelled = true; },
    logger: { error() {} },
  });
  await staleRetryStore.stage('late-failure-source', Buffer.from('GIF'), () => true);
  const lateFailurePath = 'C:\\preview-temp\\ck3-character-gallery-42-late-failure-source.gif';
  staleRetryStore.remove(['late-failure-source']);
  synchronousRemovalSucceeds = true;
  staleRetryStore.removePreviewPath(lateFailurePath);
  lateFailure.reject(new Error('Late removal failure.'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(staleRetryTimers.filter(({ delay }) => delay === 100).length, 0, 'A late failed removal must not requeue a preview that was already removed.');

  const orphanRetryTimers = [];
  const orphanRetryStore = new PortraitPreviewStore({
    setTimeout: (callback, delay) => {
      const timer = { callback, delay, cancelled: false, unref() {} };
      orphanRetryTimers.push(timer);
      return timer;
    },
    clearTimeout(timer) { timer.cancelled = true; },
    logger: { error() {} },
  });
  orphanRetryStore.scheduleRemovalRetry('C:\\preview-temp\\orphan.gif', 0);
  await orphanRetryStore.drain();
  assert.equal(orphanRetryTimers.find(({ delay }) => delay === 100)?.cancelled, true, 'Shutdown must cancel retry timers even when no removal is pending.');

  const stalledRetryWrite = deferred();
  const retryDuringDrainTimers = [];
  let stagedWrites = 0;
  let retryDuringDrainLocked = true;
  let retryDuringDrainCalls = 0;
  const retryDuringDrainStore = new PortraitPreviewStore({
    tempDirectory: () => 'C:\\preview-temp',
    processId: 42,
    toFileUrl: (filePath) => `file:///${filePath.replace(/\\/g, '/')}`,
    writeFile: async () => {
      stagedWrites += 1;
      if (stagedWrites === 2) await stalledRetryWrite.promise;
    },
    removeFile: async () => {
      retryDuringDrainCalls += 1;
      if (retryDuringDrainLocked) throw new Error('Preview file remains locked.');
    },
    removeFileSync: () => { throw new Error('Preview file remains locked.'); },
    drainTimeoutMs: 50,
    setTimeout: (callback, delay) => {
      const timer = { callback, delay, cancelled: false, native: null, unref() {} };
      if (delay === 50) timer.native = global.setTimeout(callback, delay);
      retryDuringDrainTimers.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      timer.cancelled = true;
      if (timer.native) global.clearTimeout(timer.native);
    },
    logger: { error() {}, warn() {} },
  });
  await retryDuringDrainStore.stage('retry-during-drain-source', Buffer.from('GIF'), () => true);
  const stalledRetryStage = retryDuringDrainStore.stage('stalled-retry-write-source', Buffer.from('GIF'), () => true);
  const stalledRetryStageFailure = stalledRetryStage.catch((error) => error);
  retryDuringDrainStore.remove(['retry-during-drain-source']);
  await new Promise((resolve) => setImmediate(resolve));
  const armedRetry = retryDuringDrainTimers.find(({ delay }) => delay === 100);
  assert.ok(armedRetry, 'Failed foreground cleanup should arm a background retry.');
  const retryDuringDrain = retryDuringDrainStore.drain();
  const callsBeforeQueuedRetry = retryDuringDrainCalls;
  armedRetry.callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(retryDuringDrainCalls, callsBeforeQueuedRetry, 'A queued background retry must not remove files after draining begins.');
  retryDuringDrainLocked = false;
  stalledRetryWrite.resolve();
  await stalledRetryStageFailure;
  await retryDuringDrain;

  console.log('Portrait preview store test passed: owner teardown, retry, and shutdown cleanup remove staged previews.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
