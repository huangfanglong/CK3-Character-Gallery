const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((_resolve, _reject) => { resolve = _resolve; reject = _reject; });
  return { promise, reject, resolve };
}

function captureSession() {
  return {
    sources: [{ id: 'source-1' }], selectedSourceId: null, stream: null, phase: 'select-source',
    frames: 0, encodedFrames: 0, timer: null, durationTimer: null, sessionId: null, shortcut: 'CommandOrControl+Alt+G',
    crop: null, canvas: null, encoder: null, recordingError: null,
  };
}

function createHarness() {
  const releases = [];
  const context = {
    state: { captureSession: null },
    desktop: {
      armCapture: () => Promise.resolve({ sessionId: 'unused', shortcut: 'CommandOrControl+Alt+G' }),
      releaseCapture: async (sessionId) => { releases.push(sessionId); return true; },
    },
    navigator: { mediaDevices: { getDisplayMedia: () => Promise.resolve(null) } },
    document: { createElement: () => ({ width: 0, height: 0 }) },
    LIVE_CAPTURE_FPS: 30,
    LIVE_CAPTURE_MAX_DURATION_MS: 25_000,
    LIVE_CAPTURE_MAX_FRAMES: 750,
    LIVE_CAPTURE_SHORTCUTS: [['CommandOrControl+Alt+G', 'Ctrl + Alt + G']],
    escapeHtml: (value) => String(value),
    icon: () => '',
    modalPreserveAttribute: () => '',
    render() {},
    getActiveCharacter: () => ({ name: 'Test' }),
    readableError: (error, fallback) => error?.message || fallback,
    showToast() {},
    createLiveCaptureEncoder: () => Promise.reject(new Error('not configured')),
    clearInterval() {},
    clearTimeout() {},
    setInterval() { return 1; },
    setTimeout,
    performance,
    console,
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'live-capture.js'), 'utf8');
  vm.runInContext(`${source}; globalThis.selectLiveCaptureSourceForTest = selectLiveCaptureSource; globalThis.toggleLiveCaptureForTest = toggleLiveCapture; globalThis.finishLiveCaptureForTest = finishLiveCapture;`, context);
  return { context, releases };
}

async function main() {
  const { context, releases } = createHarness();
  const arm = deferred();
  let armCalls = 0;
  context.desktop.armCapture = () => { armCalls += 1; return arm.promise; };
  const firstCapture = captureSession();
  context.state.captureSession = firstCapture;
  const first = context.selectLiveCaptureSourceForTest('source-1');
  const second = context.selectLiveCaptureSourceForTest('source-1');
  await Promise.resolve();
  assert.equal(armCalls, 1);
  assert.equal(firstCapture.phase, 'starting');
  context.state.captureSession = null;
  arm.resolve({ sessionId: 'late-arm', shortcut: 'CommandOrControl+Alt+G' });
  await Promise.all([first, second]);
  assert.deepEqual(releases, ['late-arm']);

  const display = deferred();
  const track = { stopped: false, stop() { this.stopped = true; } };
  let displayRequested = false;
  context.desktop.armCapture = () => Promise.resolve({ sessionId: 'display-arm', shortcut: 'CommandOrControl+Alt+G' });
  context.navigator.mediaDevices.getDisplayMedia = () => { displayRequested = true; return display.promise; };
  const secondCapture = captureSession();
  context.state.captureSession = secondCapture;
  const selecting = context.selectLiveCaptureSourceForTest('source-1');
  while (!displayRequested) await new Promise((resolve) => setImmediate(resolve));
  context.state.captureSession = null;
  display.resolve({ getTracks: () => [track], getVideoTracks: () => [track] });
  await selecting;
  assert.equal(track.stopped, true);
  assert.ok(releases.includes('display-arm'));

  const encoderStartup = deferred();
  context.createLiveCaptureEncoder = () => encoderStartup.promise;
  const staleStartup = captureSession();
  staleStartup.phase = 'ready';
  staleStartup.sessionId = 'stale-startup';
  context.state.captureSession = staleStartup;
  const starting = context.toggleLiveCaptureForTest('stale-startup');
  assert.equal(staleStartup.phase, 'starting-recording');
  const replacement = captureSession();
  context.state.captureSession = replacement;
  encoderStartup.reject(new Error('encoder unavailable'));
  await starting;
  assert.equal(context.state.captureSession, replacement);

  const finalizing = deferred();
  const staleFinish = captureSession();
  staleFinish.phase = 'recording';
  staleFinish.sessionId = 'stale-finish';
  staleFinish.encodedFrames = 1;
  staleFinish.encoder = { finalize: () => finalizing.promise, close() {} };
  context.state.captureSession = staleFinish;
  const finishing = context.finishLiveCaptureForTest();
  assert.equal(staleFinish.phase, 'finishing');
  context.state.captureSession = replacement;
  finalizing.resolve(new ArrayBuffer(16));
  await finishing;
  assert.equal(context.state.captureSession, replacement);

  const appSource = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
  assert.match(appSource, /if \(state\.modal\) \{ event\.preventDefault\(\); runModalAction\('close-modal'\); \}/);
  console.log('Live capture lifecycle test passed: source selection is single-flight, stale sessions release, late streams stop, stale encoder work is isolated, and Escape uses modal cleanup.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
