const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'capture-settings.js'), 'utf8');
const settings = vm.runInNewContext(`(() => { ${source}; return { LIVE_CAPTURE_FPS, LIVE_CAPTURE_MAX_DURATION_MS, LIVE_CAPTURE_MAX_FRAMES, LIVE_CAPTURE_VIDEO_BITRATE, LIVE_CAPTURE_LOOP_SEARCH_SECONDS_DEFAULT, normalizeLiveCaptureLoopSearchSeconds }; })()`);

assert.equal(settings.LIVE_CAPTURE_FPS, 30);
assert.equal(settings.LIVE_CAPTURE_MAX_DURATION_MS, 25_000);
assert.equal(settings.LIVE_CAPTURE_MAX_FRAMES, 750);
assert.equal(settings.LIVE_CAPTURE_VIDEO_BITRATE, 6_000_000);
assert.equal(settings.LIVE_CAPTURE_LOOP_SEARCH_SECONDS_DEFAULT, 2);
assert.equal(settings.normalizeLiveCaptureLoopSearchSeconds(undefined), 2);
assert.equal(settings.normalizeLiveCaptureLoopSearchSeconds('10'), 10);
assert.equal(settings.normalizeLiveCaptureLoopSearchSeconds(3.8), 3);
assert.equal(settings.normalizeLiveCaptureLoopSearchSeconds(0), 2);
assert.equal(settings.normalizeLiveCaptureLoopSearchSeconds(-1), 2);
assert.equal(settings.normalizeLiveCaptureLoopSearchSeconds('not a number'), 2);
console.log('Capture settings test passed: fixed capture limits and a persistent, positive smart-loop search duration.');
