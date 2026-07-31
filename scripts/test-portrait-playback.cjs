const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const observers = [];
const geometry = { rectReads: 0, styleReads: 0 };
class FakeIntersectionObserver {
  constructor(callback) {
    this.callback = callback;
    this.observed = new Set();
    observers.push(this);
  }

  observe(video) { this.observed.add(video); }
  unobserve(video) { this.observed.delete(video); }
}

function video({ connected = true, playback = 'viewport', bounds = { top: 0, right: 100, bottom: 100, left: 0, width: 100, height: 100 }, parentElement = null } = {}) {
  let currentBounds = bounds;
  return {
    isConnected: connected,
    parentElement,
    paused: true,
    dataset: { portraitPlayback: playback },
    pauseCalls: 0,
    playCalls: 0,
    getBoundingClientRect() { geometry.rectReads += 1; return currentBounds; },
    setBounds(nextBounds) { currentBounds = nextBounds; },
    pause() { this.pauseCalls += 1; this.paused = true; },
    play() { this.playCalls += 1; this.paused = false; return Promise.resolve(); },
  };
}

function root(videos) {
  return { querySelectorAll: () => videos };
}

function main() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'portrait-playback.js'), 'utf8');
  const context = vm.createContext({
    IntersectionObserver: FakeIntersectionObserver,
    document: { hidden: false, addEventListener() {} },
    getComputedStyle: (element) => {
      geometry.styleReads += 1;
      return { overflow: element.overflow || 'visible', overflowX: element.overflowX || element.overflow || 'visible', overflowY: element.overflowY || element.overflow || 'visible' };
    },
    window: { innerWidth: 1000, innerHeight: 1000 },
    console,
  });
  vm.runInContext(`${source}; globalThis.__portraitPlayback = { portraitObserver, portraitVideos, syncPortraitPlayback };`, context);
  const { portraitObserver, portraitVideos, syncPortraitPlayback } = context.__portraitPlayback;

  const visible = video();
  const offscreen = video({ bounds: { top: 1200, right: 100, bottom: 1300, left: 0, width: 100, height: 100 } });
  const scrollPort = {
    overflow: 'auto',
    parentElement: null,
    getBoundingClientRect() { return { top: 0, right: 100, bottom: 100, left: 0, width: 100, height: 100 }; },
  };
  const clipped = video({ bounds: { top: 150, right: 100, bottom: 250, left: 0, width: 100, height: 100 }, parentElement: scrollPort });
  syncPortraitPlayback(root([visible, offscreen, clipped]));
  assert.equal(visible.paused, false, 'Visible cards should start playback without waiting for the observer callback.');
  assert.equal(offscreen.paused, true, 'Offscreen cards should remain paused before the observer callback.');
  assert.equal(clipped.paused, true, 'Cards clipped by a scroll container should remain paused before the observer callback.');
  portraitObserver.callback([{ target: visible, isIntersecting: true, intersectionRatio: 1 }]);
  assert.equal(visible.paused, false, 'Visible cards should start playback immediately.');
  portraitObserver.callback([{ target: visible, isIntersecting: false, intersectionRatio: 0 }]);
  assert.equal(visible.paused, true, 'Offscreen cards should pause playback.');

  const retainedGeometry = { ...geometry };
  syncPortraitPlayback(root([visible, offscreen, clipped]));
  assert.deepEqual(geometry, retainedGeometry, 'Retained cards should not remeasure viewport geometry during a scoped render.');

  const newlyTracked = video();
  syncPortraitPlayback(root([visible, offscreen, clipped, newlyTracked]));
  assert.ok(geometry.rectReads > retainedGeometry.rectReads, 'Newly tracked cards should receive an immediate geometry check.');
  assert.equal(newlyTracked.paused, false, 'Newly tracked visible cards should still start immediately.');

  const blockedGeometry = { ...geometry };
  syncPortraitPlayback(root([visible, offscreen, clipped, newlyTracked]), true);
  assert.deepEqual(geometry, blockedGeometry, 'Blocked playback should pause cards without performing viewport geometry work.');
  assert.equal(newlyTracked.paused, true, 'Blocked playback should pause visible cards.');
  portraitObserver.callback([{ target: newlyTracked, isIntersecting: true, intersectionRatio: 1 }]);
  assert.deepEqual(geometry, blockedGeometry, 'Observer entries should not measure viewport geometry while playback is blocked.');

  syncPortraitPlayback(root([visible, offscreen, clipped, newlyTracked]), false, true);
  assert.ok(geometry.rectReads > blockedGeometry.rectReads, 'Full renders should refresh retained card geometry before playback resumes.');
  assert.equal(newlyTracked.paused, false, 'A full refresh should resume visible cards after playback unblocks.');

  const staleEntry = video();
  syncPortraitPlayback(root([staleEntry]));
  staleEntry.setBounds({ top: 1200, right: 100, bottom: 1300, left: 0, width: 100, height: 100 });
  portraitObserver.callback([{ target: staleEntry, isIntersecting: true, intersectionRatio: 1 }]);
  assert.equal(staleEntry.paused, true, 'A stale visible observer entry must not restart an offscreen card.');

  portraitVideos.delete(staleEntry);
  const detached = video({ connected: false });
  detached.paused = false;
  portraitVideos.add(detached);
  syncPortraitPlayback(root([]));
  assert.equal(detached.pauseCalls, 1, 'Detached videos must be paused before unregistration.');
  assert.equal(portraitVideos.has(detached), false, 'Detached videos must be unregistered.');

  console.log('Portrait playback test passed: visible cards play, offscreen cards pause, and detached videos stop.');
}

main();
