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
    this.records = [];
    observers.push(this);
  }

  observe(video) { this.observed.add(video); }
  unobserve(video) { this.observed.delete(video); }
  queue(entries) { this.records.push(...entries); }
  takeRecords() { const records = this.records; this.records = []; return records; }
  deliver() {
    const entries = this.takeRecords();
    if (entries.length) this.callback(entries);
  }
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
  const documentListeners = new Map();
  const fakeDocument = {
    hidden: false,
    addEventListener(type, listener) { documentListeners.set(type, listener); },
  };
  const context = vm.createContext({
    IntersectionObserver: FakeIntersectionObserver,
    document: fakeDocument,
    getComputedStyle: (element) => {
      geometry.styleReads += 1;
      return { overflow: element.overflow || 'visible', overflowX: element.overflowX || element.overflow || 'visible', overflowY: element.overflowY || element.overflow || 'visible' };
    },
    window: { innerWidth: 1000, innerHeight: 1000 },
    console,
  });
  vm.runInContext(`${source}; globalThis.__portraitPlayback = { portraitObserver, portraitVideos, syncPortraitPlayback };`, context);
  const { portraitObserver, portraitVideos, syncPortraitPlayback } = context.__portraitPlayback;
  const visibilityChange = documentListeners.get('visibilitychange');
  assert.equal(typeof visibilityChange, 'function', 'Portrait playback should handle document visibility changes.');

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
  context.document.hidden = true;
  visibilityChange();
  const blockedVisibilityGeometry = { ...geometry };
  context.document.hidden = false;
  visibilityChange();
  assert.deepEqual(geometry, blockedVisibilityGeometry, 'Foregrounding while playback is blocked should not remeasure retained cards.');

  portraitObserver.queue([{ target: newlyTracked, isIntersecting: false, intersectionRatio: 0 }]);
  syncPortraitPlayback(root([visible, offscreen, clipped, newlyTracked]), false, true);
  assert.ok(geometry.rectReads > blockedGeometry.rectReads, 'Full renders should refresh retained card geometry before playback resumes.');
  assert.equal(newlyTracked.paused, false, 'A full refresh should resume visible cards after playback unblocks.');
  portraitObserver.deliver();
  assert.equal(newlyTracked.paused, false, 'Queued observer records must not override a later full viewport refresh.');

  const hiddenViewportCard = video();
  syncPortraitPlayback(root([hiddenViewportCard]));
  const hiddenViewportPlayCalls = hiddenViewportCard.playCalls;
  context.document.hidden = true;
  visibilityChange();
  assert.equal(hiddenViewportCard.paused, true, 'Hidden cards should pause playback.');
  hiddenViewportCard.setBounds({ top: 1200, right: 100, bottom: 1300, left: 0, width: 100, height: 100 });
  const hiddenRestoreGeometry = { ...geometry };
  context.document.hidden = false;
  visibilityChange();
  assert.equal(hiddenViewportCard.paused, true, 'A card moved offscreen while hidden must remain paused after visibility is restored.');
  assert.equal(hiddenViewportCard.playCalls, hiddenViewportPlayCalls, 'Visibility restoration must not restart an offscreen retained card.');
  assert.ok(geometry.rectReads > hiddenRestoreGeometry.rectReads, 'Visibility restoration should refresh retained viewport geometry before playback resumes.');

  const hiddenOffscreenCard = video({ bounds: { top: 1200, right: 100, bottom: 1300, left: 0, width: 100, height: 100 } });
  syncPortraitPlayback(root([hiddenOffscreenCard]));
  context.document.hidden = true;
  visibilityChange();
  portraitObserver.queue([{ target: hiddenOffscreenCard, isIntersecting: false, intersectionRatio: 0 }]);
  hiddenOffscreenCard.setBounds({ top: 0, right: 100, bottom: 100, left: 0, width: 100, height: 100 });
  context.document.hidden = false;
  visibilityChange();
  assert.equal(hiddenOffscreenCard.paused, false, 'A card moved onscreen while hidden should start after visibility is restored.');
  portraitObserver.deliver();
  assert.equal(hiddenOffscreenCard.paused, false, 'A hidden-era observer record must not pause a card refreshed onscreen after visibility is restored.');

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
