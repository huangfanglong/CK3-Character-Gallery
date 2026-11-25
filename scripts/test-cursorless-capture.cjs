const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { CursorlessCapture, CURSORLESS_FRAME_BYTES } = require('../electron/cursorless-capture.cjs');
const { WindowsCursorlessFrameSource } = require('../electron/windows-cursorless-capture-worker.cjs');

class FakeWorker extends EventEmitter {
  constructor() { super(); this.messages = []; this.terminated = false; }
  postMessage(message) {
    this.messages.push(message);
    if (message?.type === 'stop') setImmediate(() => this.emit('exit', 0));
  }
  terminate() { this.terminated = true; setImmediate(() => this.emit('exit', 1)); return Promise.resolve(0); }
}

function fakeFrame() { return new ArrayBuffer(CURSORLESS_FRAME_BYTES); }

function fakeNativeApi() {
  const calls = { select: [], stretch: [], print: [], deleteObjects: [], deleteDCs: [], releaseDCs: [], mode: [] };
  let dc = 0;
  let bitmap = 0;
  const api = {
    rect: { left: 0, top: 0, right: 1600, bottom: 900 },
    getWindowRect(_hwnd, output) { Object.assign(output, this.rect); return true; },
    printWindow(...args) { calls.print.push(args); return true; },
    getDC: () => 'window-dc',
    releaseDC(...args) { calls.releaseDCs.push(args); return 1; },
    createCompatibleDC: () => `memory-dc-${++dc}`,
    createCompatibleBitmap: () => `bitmap-${++bitmap}`,
    selectObject(...args) { calls.select.push(args); return `previous-${args[1]}`; },
    setStretchBltMode(...args) { calls.mode.push(args); return 4; },
    stretchBlt(...args) { calls.stretch.push(args); return true; },
    deleteObject(handle) { calls.deleteObjects.push(handle); return true; },
    deleteDC(handle) { calls.deleteDCs.push(handle); return true; },
    getDIBits(_dc, _bitmap, _start, lines, pixels) {
      for (let offset = 0; offset < pixels.length; offset += 4) {
        pixels[offset] = 10;
        pixels[offset + 1] = 20;
        pixels[offset + 2] = 30;
        pixels[offset + 3] = 0;
      }
      return lines;
    },
  };
  return { api, calls };
}

async function managerTests() {
  const workers = [];
  const capture = new CursorlessCapture({
    workerFactory: () => { const worker = new FakeWorker(); workers.push(worker); return worker; },
    logger: { error() {} },
    stopTimeoutMs: 20,
  });
  const frames = [];
  const starting = capture.start({ sessionId: 'session-1', gameHwnd: '42', crop: { x: 350, y: 0, size: 900 }, onFrame: (frame) => frames.push(frame) });
  workers[0].emit('message', { type: 'frame', sequence: 1, pixels: fakeFrame() });
  assert.deepEqual(await starting, { width: 450, height: 450 });
  workers[0].emit('message', { type: 'frame', sequence: 2, pixels: fakeFrame() });
  assert.deepEqual(frames.map((frame) => frame.sequence), [1, 2]);
  assert.equal(await capture.stop('session-1'), true);
  assert.equal(await capture.stop('session-1'), false);
  assert.equal(workers[0].terminated, false, 'A responsive worker shuts down gracefully and releases GDI handles.');
  workers[0].emit('message', { type: 'frame', sequence: 3, pixels: fakeFrame() });
  assert.equal(frames.length, 2, 'A stale worker cannot paint after cancellation.');

  const failedFrames = [];
  const running = capture.start({ sessionId: 'session-2', gameHwnd: '42', crop: { x: 0, y: 0, size: 450 }, onFrame: (frame) => failedFrames.push(frame) });
  workers[1].emit('message', { type: 'frame', sequence: 1, pixels: fakeFrame() });
  await running;
  workers[1].emit('message', { type: 'error', message: 'Synthetic capture loss' });
  assert.equal(failedFrames.at(-1).error, 'Synthetic capture loss');
  await new Promise((resolve) => setImmediate(resolve));

  const invalidStart = capture.start({ sessionId: 'session-3', gameHwnd: '42', crop: { x: 0, y: 0, size: 450 }, onFrame() {} });
  workers[2].emit('message', { type: 'frame', sequence: 1, pixels: new ArrayBuffer(12) });
  await assert.rejects(invalidStart, /invalid cursor-free portrait frame/);

  const cancelled = capture.start({ sessionId: 'session-4', gameHwnd: '42', crop: { x: 0, y: 0, size: 450 }, onFrame() {} });
  const cancelledAssertion = assert.rejects(cancelled, { name: 'AbortError' });
  await capture.stop('session-4');
  await cancelledAssertion;
  assert.throws(() => capture.start({ sessionId: 'bad-crop', gameHwnd: '42', crop: { x: -1, y: 0, size: 450 }, onFrame() {} }), /crop is invalid/);
  await capture.destroy();
}

function nativeSourceTests() {
  const { api, calls } = fakeNativeApi();
  const source = new WindowsCursorlessFrameSource({ gameHwnd: '42', crop: { x: 350, y: 0, size: 900 }, width: 450, height: 450, api, platform: 'win32' });
  const pixels = source.capture();
  assert.equal(pixels.length, CURSORLESS_FRAME_BYTES);
  assert.deepEqual([...pixels.subarray(0, 8)], [30, 20, 10, 255, 30, 20, 10, 255], 'GDI BGRA becomes opaque RGBA.');
  assert.equal(calls.print.length, 1);
  assert.equal(calls.print[0][0], 42n);
  assert.equal(calls.print[0][2], 2, 'PW_RENDERFULLCONTENT preserves the DirectX game image.');
  assert.deepEqual(calls.stretch[0], ['memory-dc-2', 0, 0, 450, 450, 'memory-dc-1', 350, 0, 900, 900, 0x00cc0020], 'The frozen source crop is scaled directly to the encoder dimensions.');
  assert.deepEqual(calls.mode[0], ['memory-dc-2', 4]);
  source.close();
  assert.deepEqual(calls.deleteObjects, ['bitmap-1', 'bitmap-2']);
  assert.deepEqual(calls.deleteDCs, ['memory-dc-1', 'memory-dc-2']);
  assert.deepEqual(calls.releaseDCs, [[42n, 'window-dc']]);
  source.close();

  const resized = fakeNativeApi();
  const changing = new WindowsCursorlessFrameSource({ gameHwnd: '42', crop: { x: 350, y: 0, size: 900 }, api: resized.api, platform: 'win32' });
  changing.open();
  resized.api.rect = { left: 0, top: 0, right: 1280, bottom: 720 };
  assert.throws(() => changing.capture(), /resolution changed/);
  changing.close();

  const invalid = fakeNativeApi();
  const outside = new WindowsCursorlessFrameSource({ gameHwnd: '42', crop: { x: 1400, y: 0, size: 450 }, api: invalid.api, platform: 'win32' });
  assert.throws(() => outside.open(), /no longer fits/);
  assert.equal(outside.resources, null);
}

(async () => {
  nativeSourceTests();
  await managerTests();
  console.log('Cursor-free capture tests passed: crop geometry, RGBA conversion, native cleanup, first-frame startup, stale isolation, and graceful shutdown.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
