'use strict';

const assert = require('node:assert/strict');
const { WindowsCursorGuard, cursorClipBounds, DOCK_CURSOR_INSET } = require('../electron/windows-cursor-guard.cjs');

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const waitFor = async (predicate, label) => {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await delay(5);
  }
};

function fakeApi() {
  return {
    point: { x: 200, y: 100 },
    clips: [],
    currentClip: null,
    failClip: false,
    failGet: false,
    failGetClip: false,
    clipCursor(rect) {
      this.clips.push(rect ? { ...rect } : null);
      if (this.failClip) return false;
      this.currentClip = rect ? { ...rect } : null;
      return true;
    },
    getCursorPos(point) {
      if (this.failGet) return false;
      Object.assign(point, this.point);
      return true;
    },
    getClipCursor(rect) {
      if (this.failGetClip) return false;
      Object.assign(rect, this.currentClip || { left: 0, top: 0, right: 1000, bottom: 800 });
      return true;
    },
  };
}

async function main() {
  assert.equal(DOCK_CURSOR_INSET, 6);
  assert.deepEqual(cursorClipBounds({ x: -20, y: 10, width: 1920, height: 1080 }), { left: -20, top: 16, right: 1900, bottom: 1090 });
  assert.deepEqual(cursorClipBounds({ x: 10.4, y: 20.4, width: 1000.2, height: 800.2 }, 4), { left: 10, top: 24, right: 1011, bottom: 821 });
  assert.equal(cursorClipBounds({ x: 0, y: 0, width: 0, height: 800 }), null);
  assert.equal(cursorClipBounds(null), null);
  assert.equal(cursorClipBounds({ x: 0, y: 0, width: 100, height: 4 }), null);

  const unsupported = new WindowsCursorGuard({ platform: 'linux', api: fakeApi() });
  assert.equal(unsupported.arm({ x: 0, y: 0, width: 100, height: 100 }), false);
  assert.equal(unsupported.active, false);

  const api = fakeApi();
  const guard = new WindowsCursorGuard({ platform: 'win32', api, intervalMs: 5 });
  let inside = true;
  try {
    assert.equal(guard.arm({ x: 0, y: 0, width: 1000, height: 800 }, () => inside), true);
    assert.equal(guard.active, true);
    assert.deepEqual(api.clips[0], { left: 0, top: 6, right: 1000, bottom: 800 });
    await delay(25);
    assert.equal(guard.active, true, 'The watchdog keeps an in-region hover engaged.');
    const clipCount = api.clips.length;
    api.currentClip = { left: 0, top: 0, right: 1000, bottom: 800 };
    guard.check();
    assert.equal(guard.active, true, 'An external clip replacement does not release an in-dock hover.');
    assert.equal(api.currentClip.top, 6, 'The guard restores its clip after another process replaces it.');
    assert.equal(api.clips.length, clipCount + 1);
    inside = false;
    await waitFor(() => !guard.active, 'watchdog release outside dock regions');
    assert.equal(api.clips.at(-1), null);
    assert.equal(guard.timer, null);
    const releasedClipCount = api.clips.length;
    assert.equal(guard.release(), false, 'Release is idempotent.');
    assert.equal(api.clips.length, releasedClipCount, 'An inactive guard does not call ClipCursor again.');

    inside = true;
    assert.equal(guard.arm({ x: 0, y: 0, width: 1000, height: 800 }, () => inside), true);
    guard.destroy();
    assert.equal(guard.active, false);
    assert.equal(guard.timer, null);
    assert.equal(api.clips.at(-1), null);
  } finally {
    guard.destroy();
  }

  const staleApi = fakeApi();
  const staleGuard = new WindowsCursorGuard({ platform: 'win32', api: staleApi });
  assert.equal(staleGuard.arm({ x: 0, y: 0, width: 1000, height: 800 }, () => false), false, 'A stale hover cannot engage clipping.');
  assert.equal(staleApi.clips.length, 0);

  const failedClipApi = fakeApi();
  failedClipApi.failClip = true;
  const failedClip = new WindowsCursorGuard({ platform: 'win32', api: failedClipApi });
  assert.equal(failedClip.arm({ x: 0, y: 0, width: 1000, height: 800 }), false);
  assert.equal(failedClip.active, false);
  assert.equal(failedClip.timer, null);

  const failedGetApi = fakeApi();
  const failedGet = new WindowsCursorGuard({ platform: 'win32', api: failedGetApi, intervalMs: 5 });
  assert.equal(failedGet.arm({ x: 0, y: 0, width: 1000, height: 800 }), true);
  failedGetApi.failGet = true;
  await waitFor(() => !failedGet.active, 'release after GetCursorPos failure');
  assert.equal(failedGetApi.clips.at(-1), null);

  const failedGetClipApi = fakeApi();
  const failedGetClip = new WindowsCursorGuard({ platform: 'win32', api: failedGetClipApi, intervalMs: 5 });
  assert.equal(failedGetClip.arm({ x: 0, y: 0, width: 1000, height: 800 }), true);
  failedGetClipApi.failGetClip = true;
  await waitFor(() => !failedGetClip.active, 'release after GetClipCursor failure');
  assert.equal(failedGetClipApi.clips.at(-1), null);

  const hookApi = fakeApi();
  let hookCallback = null;
  let hookInstalls = 0;
  let hookRemovals = 0;
  hookApi.installMouseHook = (callback) => {
    hookInstalls += 1;
    hookCallback = callback;
    return () => { hookRemovals += 1; hookCallback = null; };
  };
  const hooked = new WindowsCursorGuard({ platform: 'win32', api: hookApi });
  let received = null;
  assert.equal(hooked.start((point) => { received = point; }), true);
  assert.equal(hooked.start(() => {}), true, 'Starting the native hook twice is idempotent.');
  assert.equal(hookInstalls, 1);
  hookCallback({ x: 320, y: 0 });
  assert.deepEqual(received, { x: 320, y: 0 });
  hooked.stop();
  assert.equal(hookRemovals, 1);
  assert.equal(hookCallback, null);
  assert.equal(hooked.unhook, null);

  const unavailableHook = new WindowsCursorGuard({ platform: 'win32', api: fakeApi() });
  assert.equal(unavailableHook.start(() => {}), false, 'Renderer hover remains the fallback when native hooks are unavailable.');

  const errors = [];
  const throwingApi = fakeApi();
  throwingApi.clipCursor = () => { throw new Error('synthetic native failure'); };
  const throwing = new WindowsCursorGuard({ platform: 'win32', api: throwingApi, logger: { error: (...args) => errors.push(args) } });
  assert.equal(throwing.arm({ x: 0, y: 0, width: 1000, height: 800 }), false);
  assert.equal(throwing.active, false);
  assert.equal(errors.length, 1);

  console.log('Windows cursor guard tests passed: bounds, native hook lifecycle, immediate entry, clip restoration, watchdog, stale hover, native failures, idempotence, and cleanup.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
