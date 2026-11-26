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
  const timeouts = [];
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
    LIVE_CAPTURE_LOOP_SEARCH_SECONDS_DEFAULT: 2,
    LIVE_CAPTURE_LOOP_SEARCH_SECONDS_MAX: 25,
    LIVE_CAPTURE_LOOP_MATCH_AFTER_FRAMES: 3,
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
    characterForPortraitTarget: (target) => context.state.galleries.find((gallery) => gallery.name === target?.galleryName)?.characters.find((character) => character.id === target?.characterId) || null,
    dockBusyError: () => new Error('Another capture is active.'),
    publishDockState: async (patch) => { context.dockPatches = context.dockPatches || []; context.dockPatches.push(patch); return true; },
    HTMLMediaElement: { HAVE_CURRENT_DATA: 2 },
    readableError: (error, fallback) => error?.message || fallback,
    appendPortrait: async () => true,
    showToast() {},
    createLiveCaptureEncoder: () => Promise.reject(new Error('not configured')),
    createLiveCaptureLoopProcessor: ({ encoder }) => {
      let acceptedFrames = 0;
      return {
        get acceptedFrames() { return acceptedFrames; },
        get decision() { return null; },
        get isReady() { return true; },
        push(canvas, { sourceTimestamp }) { encoder.encode(canvas, sourceTimestamp, acceptedFrames); acceptedFrames += 1; return null; },
        beginSearch() { return true; },
        completeSearch() { return 'fallback'; },
        forceFallback() {},
        finalize: () => encoder.finalize(),
        close() {},
      };
    },
    normalizeLiveCaptureLoopSearchSeconds: (value) => Number.isFinite(Number(value)) && Number(value) >= 1 ? Math.min(Math.floor(Number(value)), 25) : 2,
    localStorage: { getItem: () => null, setItem() {} },
    clearInterval(timer) { clearedIntervals.push(timer); },
    cancelAnimationFrame(frame) { cancelledAnimationFrames.push(frame); },
    clearTimeout() {},
    setInterval(callback) { intervals.push(callback); return intervals.length; },
    setTimeout(callback, delay) { timeouts.push({ callback, delay }); return timeouts.length; },
    performance,
    console,
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'live-capture.js'), 'utf8');
  vm.runInContext(`${source}; globalThis.showLiveCaptureModalForTest = showLiveCaptureModal; globalThis.selectLiveCaptureSourceForTest = selectLiveCaptureSource; globalThis.startLiveCaptureRecordingForTest = startLiveCaptureRecording; globalThis.toggleLiveCaptureForTest = toggleLiveCapture; globalThis.finishLiveCaptureForTest = finishLiveCapture; globalThis.completeLiveCaptureDecisionForTest = completeLiveCaptureDecision; globalThis.cleanupLiveCapturePreviewForTest = cleanupLiveCapturePreview; globalThis.setLiveCaptureLoopSearchSecondsForTest = setLiveCaptureLoopSearchSeconds; globalThis.liveCaptureMatchingStatusForTest = liveCaptureMatchingStatus; globalThis.startDockLiveCaptureForTest = startDockLiveCapture; globalThis.updateDockCaptureCropForTest = updateDockCaptureCrop; globalThis.resetDockCaptureCropForTest = resetDockCaptureCrop; globalThis.startDockCursorlessCaptureForTest = startDockCursorlessCapture; globalThis.stopDockCursorlessCaptureForTest = stopDockCursorlessCapture; globalThis.drawLiveCaptureFrameForTest = drawLiveCaptureFrame;`, context);
  return { cancelledAnimationFrames, clearedIntervals, completions, context, finishCalls, intervals, releases, statuses, timeouts };
}

async function main() {
  const { cancelledAnimationFrames, clearedIntervals, completions, context, finishCalls, intervals, releases, statuses, timeouts } = createHarness();
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
  recording.loopSearchSeconds = 10;
  recording.outputFrameRequest = 77;
  let previewObserverDisconnected = false;
  recording.previewResizeObserver = { disconnect() { previewObserverDisconnected = true; } };
  recording.previewResources = { outputFrameRequest: 77, resizeObserver: recording.previewResizeObserver, resizeListener: null, video: null };
  const encoder = { hasCapacity: false, encode() {}, close() {}, finalize: async () => new ArrayBuffer(16) };
  context.createLiveCaptureEncoder = () => Promise.resolve(encoder);
  context.state.captureSession = recording;
  context.setLiveCaptureLoopSearchSecondsForTest('9999');
  assert.equal(recording.loopSearchSeconds, 25);
  assert.match(context.liveCaptureMatchingStatusForTest({ loopSearchSeconds: 25, loopSearchDurationMs: 4_250, shortcut: recording.shortcut }), /up to 4\.3 seconds/);
  context.setLiveCaptureLoopSearchSecondsForTest('10');
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
  assert.equal(recording.phase, 'matching');
  assert.equal(statuses.at(-1).status.state, 'matching');
  assert.equal(timeouts.at(-1).delay, 10_100);
  timeouts.at(-1).callback();
  await new Promise((resolve) => setImmediate(resolve));
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
  await context.completeLiveCaptureDecisionForTest(pinnedTarget, 'fallback');
  assert.equal(finishCalls.at(-1).characterId, 'character-1');
  context.state.activeId = 'character-1';

  const shortMatching = captureSession();
  shortMatching.phase = 'matching';
  shortMatching.sessionId = 'short-matching';
  shortMatching.loopProcessor = { get isReady() { return false; } };
  context.state.captureSession = shortMatching;
  await context.toggleLiveCaptureForTest('short-matching');
  assert.equal(context.state.captureSession, shortMatching);
  assert.equal(shortMatching.phase, 'matching');
  assert.equal(shortMatching.finishRequested, true);

  const finalizing = deferred();
  const staleFinish = captureSession();
  staleFinish.phase = 'recording';
  staleFinish.sessionId = 'stale-finish';
  staleFinish.encodedFrames = 1;
  staleFinish.encoder = { finalize: () => finalizing.promise, close() {} };
  context.state.captureSession = staleFinish;
  const finishing = context.completeLiveCaptureDecisionForTest(staleFinish, 'fallback');
  assert.equal(staleFinish.phase, 'finishing');
  context.state.captureSession = replacement;
  finalizing.resolve(new ArrayBuffer(16));
  await finishing;
  assert.equal(context.state.captureSession, replacement);

  const matchingFailure = captureSession();
  matchingFailure.phase = 'starting-recording';
  matchingFailure.sessionId = 'matching-failure';
  matchingFailure.crop = { x: 0, y: 0, size: 450 };
  matchingFailure.video = { videoWidth: 450, videoHeight: 450 };
  matchingFailure.outputCanvas = { id: 'capture-output' };
  const matchingEncoder = { hasCapacity: true, encode() {}, close() {}, finalize: async () => new ArrayBuffer(16) };
  context.createLiveCaptureEncoder = () => Promise.resolve(matchingEncoder);
  context.state.captureSession = matchingFailure;
  await context.startLiveCaptureRecordingForTest(matchingFailure);
  matchingFailure.phase = 'matching';
  matchingEncoder.encode = () => { throw new Error('encoder failed during matching'); };
  intervals.at(-1)();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(context.state.captureSession, null);
  assert.ok(releases.includes('matching-failure'));

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

  let dockListedHwnd = '';
  let automaticallySelected = '';
  context.desktop.listCaptureSources = async (hwnd) => { dockListedHwnd = hwnd; return [{ id: 'window:42:0' }]; };
  context.selectLiveCaptureSource = async (sourceId) => {
    automaticallySelected = sourceId;
    const capture = context.state.captureSession;
    capture.phase = 'ready';
    capture.video = { videoWidth: 1600, videoHeight: 900 };
    capture.crop = { x: 350, y: 0, size: 900 };
  };
  await context.startDockLiveCaptureForTest({ draftId: 'dock-draft', characterId: 'character-1', galleryName: 'Test Gallery', gameHwnd: '42' }, '42');
  assert.equal(dockListedHwnd, '42');
  assert.equal(automaticallySelected, 'window:42:0');
  assert.equal(context.state.captureSession.dock, true);
  assert.equal(context.state.captureSession.dockDraftId, 'dock-draft');

  Object.assign(context, require('../renderer/capture-geometry.js'));
  context.updateDockCaptureCropForTest({ centerX: .25, centerY: .5, size: .25 });
  assert.deepEqual({ ...context.state.captureSession.crop }, { x: 288, y: 338, size: 225 });
  context.resetDockCaptureCropForTest();
  assert.deepEqual({ ...context.state.captureSession.crop }, { x: 350, y: 0, size: 900 });
  assert.equal(context.dockPatches.at(-1).sourceSize.width, 1600);

  const dockSelection = captureSession();
  dockSelection.dock = true;
  dockSelection.dockDraftId = 'dock-draft';
  dockSelection.gameHwnd = '42';
  context.state.captureSession = dockSelection;
  let armArguments = null;
  context.desktop.armCapture = async (...args) => { armArguments = args; return { sessionId: 'dock-session', shortcut: args[1] }; };
  const dockTrack = { addEventListener() {}, stop() {} };
  context.navigator.mediaDevices.getDisplayMedia = async () => ({ getTracks: () => [dockTrack], getVideoTracks: () => [dockTrack] });
  context.initializeDockCaptureWorkspace = (capture) => {
    capture.video = { readyState: 2, videoWidth: 1600, videoHeight: 900 };
    capture.crop = { x: 350, y: 0, size: 900 };
  };
  await context.selectLiveCaptureSourceForTest('source-1');
  assert.equal(armArguments[2].dockDraftId, 'dock-draft');
  assert.equal(armArguments[2].gameHwnd, '42');
  assert.equal(dockSelection.phase, 'ready');
  assert.equal(statuses.at(-1).status.state, 'armed');

  const originalCreateElement = context.document.createElement;
  const paintedFrames = [];
  context.document.createElement = () => ({
    width: 0,
    height: 0,
    getContext: () => ({
      createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
      putImageData: (image, x, y) => paintedFrames.push({ image, x, y }),
    }),
  });
  const nativeCapture = captureSession();
  nativeCapture.dock = true;
  nativeCapture.phase = 'starting-recording';
  nativeCapture.sessionId = 'cursorless-session';
  nativeCapture.crop = { x: 350, y: 0, size: 900 };
  nativeCapture.recordingCrop = { ...nativeCapture.crop };
  nativeCapture.video = { readyState: 2, videoWidth: 1600, videoHeight: 900 };
  const encodedDraws = [];
  nativeCapture.canvas = { getContext: () => ({ drawImage: (...args) => encodedDraws.push(args) }) };
  context.state.captureSession = nativeCapture;
  let cursorlessListener = null;
  let cursorlessCleanupCalls = 0;
  let cursorlessStartArguments = null;
  const cursorlessStops = [];
  context.desktop.onCursorlessCaptureFrame = (callback) => { cursorlessListener = callback; return () => { cursorlessCleanupCalls += 1; }; };
  context.desktop.startCursorlessCapture = async (...args) => {
    cursorlessStartArguments = args;
    const pixels = new Uint8Array(450 * 450 * 4);
    pixels.set([30, 20, 10, 255], 0);
    cursorlessListener('cursorless-session', { pixels: pixels.buffer, sequence: 1 });
    return { width: 450, height: 450 };
  };
  context.desktop.stopCursorlessCapture = async (sessionId) => { cursorlessStops.push(sessionId); return true; };
  await context.startDockCursorlessCaptureForTest(nativeCapture);
  assert.equal(cursorlessStartArguments[0], 'cursorless-session');
  assert.deepEqual({ ...cursorlessStartArguments[1] }, nativeCapture.crop);
  assert.equal(nativeCapture.recordingCursorless, true);
  assert.equal(paintedFrames.length, 1);
  assert.deepEqual([...paintedFrames[0].image.data.subarray(0, 4)], [30, 20, 10, 255]);
  assert.equal(context.drawLiveCaptureFrameForTest(nativeCapture), true);
  assert.equal(encodedDraws[0][0], nativeCapture.cursorlessCanvas, 'The encoder reads the cursor-free canvas instead of the Chromium video.');
  await context.stopDockCursorlessCaptureForTest(nativeCapture);
  assert.equal(cursorlessCleanupCalls, 1);
  assert.deepEqual(cursorlessStops, ['cursorless-session']);
  cursorlessListener('cursorless-session', { pixels: new ArrayBuffer(450 * 450 * 4), sequence: 2 });
  assert.equal(paintedFrames.length, 1, 'A late native frame cannot repaint a stopped capture.');
  await context.stopDockCursorlessCaptureForTest(nativeCapture);
  assert.deepEqual(cursorlessStops, ['cursorless-session'], 'Native shutdown is idempotent.');
  context.state.captureSession = null;
  context.document.createElement = originalCreateElement;

  context.state.captureSession = null;
  const stalledSources = deferred();
  context.desktop.listCaptureSources = () => stalledSources.promise;
  const listingController = new AbortController();
  const stalledStartup = context.startDockLiveCaptureForTest({ draftId: 'stalled-draft', characterId: 'character-1', galleryName: 'Test Gallery', gameHwnd: '42' }, '42', { signal: listingController.signal });
  listingController.abort();
  await assert.rejects(stalledStartup, { name: 'AbortError' });
  stalledSources.resolve([{ id: 'window:42:0' }]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(context.state.captureSession.dockDraftId, 'stalled-draft', 'A late source listing cannot replace the cancelled session.');
  context.state.captureSession = null;

  const lateArm = deferred();
  const armController = new AbortController();
  const cancelledSelection = captureSession();
  cancelledSelection.dock = true;
  cancelledSelection.dockDraftId = 'stalled-draft';
  cancelledSelection.gameHwnd = '42';
  cancelledSelection.startupDeadline = Date.now() + 15_000;
  cancelledSelection.startupSignal = armController.signal;
  context.state.captureSession = cancelledSelection;
  context.desktop.armCapture = () => lateArm.promise;
  const cancelledArm = context.selectLiveCaptureSourceForTest('source-1');
  armController.abort();
  await cancelledArm;
  lateArm.resolve({ sessionId: 'late-arm-after-cancel', shortcut: 'CommandOrControl+Alt+G' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(releases.includes('late-arm-after-cancel'), 'An armed session arriving after Cancel is released.');

  const appSource = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
  assert.match(appSource, /if \(state\.modal\) \{ event\.preventDefault\(\); runModalAction\('close-modal'\); \}/);

  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(mainSource, /event\.sender\.setBackgroundThrottling\(false\);\s+if \(dockContext\)/, 'App capture must keep its recording timer at full rate while CK3 owns focus.');
  assert.match(mainSource, /if \(released && capture\?\.ownerWebContentsId === mainWindowWebContentsId\) \{\s+mainWindow\?\.webContents\.setBackgroundThrottling\(true\);\s+\}/, 'Every completed app or dock capture must restore normal throttling.');
  assert.match(mainSource, /if \(ownerWebContentsId === mainWindowWebContentsId\) mainWindow\?\.webContents\.setBackgroundThrottling\(true\);/, 'Renderer teardown must restore normal throttling for app and dock captures.');
  console.log('Live capture lifecycle test passed: stale work isolation, background capture timing, abortable dock startup, late resource cleanup, accurate recording, and modal cleanup.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
