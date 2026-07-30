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
    characterId: 'character-1', galleryName: 'Test Gallery',
    sources: [{ id: 'source-1' }], selectedSourceId: null, stream: null, phase: 'select-source',
    frames: 0, encodedFrames: 0, timer: null, durationTimer: null, sessionId: null, shortcut: 'CommandOrControl+Alt+G',
    crop: null, canvas: null, encoder: null, recordingError: null,
  };
}

function createHarness() {
  const cancelledAnimationFrames = [];
  const clearedIntervals = [];
  const completions = [];
  const finishCalls = [];
  const releases = [];
  const intervals = [];
  const statuses = [];
  const characters = [
    { id: 'character-1', name: 'Test' },
    { id: 'character-2', name: 'Other' },
  ];
  const context = {
    state: { activeGallery: 'Test Gallery', activeId: 'character-1', captureSession: null, galleries: [{ name: 'Test Gallery', characters }] },
    desktop: {
      armCapture: () => Promise.resolve({ sessionId: 'unused', shortcut: 'CommandOrControl+Alt+G' }),
      completeCapture: async (sessionId, outcome) => { completions.push({ sessionId, outcome }); return true; },
      deleteImage: async () => true,
      finishCapture: async (sessionId, characterId) => { finishCalls.push({ sessionId, characterId }); return { path: 'portrait.webm', url: 'file:///portrait.webm' }; },
      listCaptureSources: () => Promise.resolve([]),
      releaseCapture: async (sessionId) => { releases.push(sessionId); return true; },
      setCaptureStatus: async (sessionId, status) => { statuses.push({ sessionId, status }); return true; },
    },
    navigator: { mediaDevices: { getDisplayMedia: () => Promise.resolve(null) } },
    document: { createElement: () => ({ width: 0, height: 0 }), querySelector: () => null, querySelectorAll: () => [] },
    LIVE_CAPTURE_FPS: 30,
    LIVE_CAPTURE_MAX_DURATION_MS: 25_000,
    LIVE_CAPTURE_MAX_FRAMES: 750,
    LIVE_CAPTURE_SHORTCUTS: [['CommandOrControl+Alt+G', 'Ctrl + Alt + G']],
    MAX_PORTRAIT_VARIANTS: 5,
    clampCaptureCrop: (crop) => ({ ...crop }),
    escapeHtml: (value) => String(value),
    icon: () => '',
    modalPreserveAttribute: () => '',
    render() {},
    getActiveCharacter: () => characters.find((character) => character.id === context.state.activeId),
    getGallery: () => context.state.galleries.find((gallery) => gallery.name === context.state.activeGallery),
    hasMaximumPortraits: () => false,
    readableError: (error, fallback) => error?.message || fallback,
    appendPortrait: async () => true,
    showToast() {},
    createLiveCaptureEncoder: () => Promise.reject(new Error('not configured')),
    clearInterval(timer) { clearedIntervals.push(timer); },
    cancelAnimationFrame(frame) { cancelledAnimationFrames.push(frame); },
    clearTimeout() {},
    setInterval(callback) { intervals.push(callback); return intervals.length; },
    setTimeout() { return 1; },
    performance,
    console,
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'live-capture.js'), 'utf8');
  vm.runInContext(`${source}; globalThis.showLiveCaptureModalForTest = showLiveCaptureModal; globalThis.selectLiveCaptureSourceForTest = selectLiveCaptureSource; globalThis.toggleLiveCaptureForTest = toggleLiveCapture; globalThis.finishLiveCaptureForTest = finishLiveCapture; globalThis.cleanupLiveCapturePreviewForTest = cleanupLiveCapturePreview;`, context);
  return { cancelledAnimationFrames, clearedIntervals, completions, context, finishCalls, intervals, releases, statuses };
}

async function main() {
  const { cancelledAnimationFrames, clearedIntervals, completions, context, finishCalls, intervals, releases, statuses } = createHarness();
  const sourceListing = deferred();
  context.desktop.listCaptureSources = () => sourceListing.promise;
  const listing = context.showLiveCaptureModalForTest();
  const listingCapture = context.state.captureSession;
  context.state.captureSession = null;
  sourceListing.resolve([{ id: 'late-source' }]);
  await listing;
  assert.equal(context.state.captureSession, null);
  assert.equal(listingCapture.phase, 'loading');
  assert.equal(listingCapture.characterId, 'character-1');
  assert.equal(listingCapture.galleryName, 'Test Gallery');

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

  const recording = captureSession();
  recording.phase = 'ready';
  recording.sessionId = 'recording-progress';
  recording.crop = { x: 120, y: 75, size: 400 };
  recording.video = { videoWidth: 1920, videoHeight: 1080 };
  recording.outputCanvas = { id: 'capture-output' };
  recording.outputFrameRequest = 77;
  let previewObserverDisconnected = false;
  recording.previewResizeObserver = { disconnect() { previewObserverDisconnected = true; } };
  recording.previewResources = { outputFrameRequest: 77, resizeObserver: recording.previewResizeObserver, resizeListener: null, video: null };
  const encoder = { hasCapacity: false, encode() {}, close() {}, finalize: async () => new ArrayBuffer(16) };
  context.createLiveCaptureEncoder = () => Promise.resolve(encoder);
  context.state.captureSession = recording;
  let recordingDraws = 0;
  context.drawLiveCaptureFrame = () => { recordingDraws += 1; return true; };
  await context.toggleLiveCaptureForTest('recording-progress');
  assert.deepEqual(statuses.slice(-2).map(({ status }) => status.state), ['starting', 'recording']);
  assert.ok(Number.isFinite(statuses.at(-1).status.startedAt));
  assert.equal(recording.frames, 1);
  assert.equal(recording.encodedFrames, 1);
  assert.equal(recording.canvas, recording.outputCanvas);
  assert.deepEqual(cancelledAnimationFrames, [77]);
  assert.equal(recording.outputFrameRequest, null);
  assert.equal(recordingDraws, 1);
  recording.crop.x = 900;
  assert.equal(recording.recordingCrop.x, 120);
  intervals.at(-1)();
  assert.equal(recording.frames, 1);
  assert.equal(recording.encodedFrames, 1);
  assert.equal(recording.droppedFrames, 1);
  assert.equal(recordingDraws, 1);
  encoder.hasCapacity = true;
  intervals.at(-1)();
  assert.equal(recording.frames, 2);
  assert.equal(recording.encodedFrames, 2);
  assert.equal(recording.droppedFrames, 1);
  assert.equal(recordingDraws, 2);
  await context.finishLiveCaptureForTest();
  assert.equal(recordingDraws, 2);
  assert.equal(previewObserverDisconnected, true);
  assert.equal(statuses.at(-1).status.state, 'saving');
  assert.equal(completions.at(-1).sessionId, 'recording-progress');
  assert.equal(completions.at(-1).outcome.state, 'saved');
  assert.equal(context.state.captureSession, null);

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
  assert.ok(releases.includes('stale-startup'));

  const encoderStartupSuccess = deferred();
  const staleSuccess = captureSession();
  staleSuccess.phase = 'ready';
  staleSuccess.sessionId = 'stale-success';
  context.createLiveCaptureEncoder = () => encoderStartupSuccess.promise;
  context.state.captureSession = staleSuccess;
  const successfulStartup = context.toggleLiveCaptureForTest('stale-success');
  const successfulEncoder = { hasCapacity: true, encode() {}, closed: false, close() { this.closed = true; } };
  context.state.captureSession = replacement;
  const clearedBeforeSuccess = clearedIntervals.length;
  encoderStartupSuccess.resolve(successfulEncoder);
  await successfulStartup;
  assert.equal(successfulEncoder.closed, true);
  assert.ok(clearedIntervals.length > clearedBeforeSuccess);
  assert.equal(staleSuccess.timer, null);
  assert.ok(releases.includes('stale-success'));

  const pinnedTarget = captureSession();
  pinnedTarget.phase = 'recording';
  pinnedTarget.sessionId = 'pinned-target';
  pinnedTarget.characterId = 'character-1';
  pinnedTarget.galleryName = 'Test Gallery';
  pinnedTarget.encodedFrames = 1;
  pinnedTarget.encoder = { finalize: async () => new ArrayBuffer(16), close() {} };
  context.state.activeId = 'character-2';
  context.state.captureSession = pinnedTarget;
  await context.finishLiveCaptureForTest();
  assert.equal(finishCalls.at(-1).characterId, 'character-1');
  context.state.activeId = 'character-1';

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

  let oldObserverDisconnected = false;
  let newObserverDisconnected = false;
  const oldResources = { outputFrameRequest: 8, resizeObserver: { disconnect() { oldObserverDisconnected = true; } }, resizeListener: null, video: null };
  const newResources = { outputFrameRequest: 9, resizeObserver: { disconnect() { newObserverDisconnected = true; } }, resizeListener: null, video: null };
  const generationCapture = captureSession();
  generationCapture.previewResources = newResources;
  generationCapture.outputFrameRequest = 9;
  context.cleanupLiveCapturePreviewForTest(generationCapture, oldResources);
  assert.equal(oldObserverDisconnected, true);
  assert.equal(newObserverDisconnected, false);
  assert.equal(generationCapture.previewResources, newResources);
  assert.equal(generationCapture.outputFrameRequest, 9);

  const appSource = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
  assert.match(appSource, /if \(state\.modal\) \{ event\.preventDefault\(\); runModalAction\('close-modal'\); \}/);
  console.log('Live capture lifecycle test passed: stale listings are ignored, source selection is single-flight, late streams stop, accepted and dropped frames are accurate, stale encoder work is isolated, and Escape uses modal cleanup.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
