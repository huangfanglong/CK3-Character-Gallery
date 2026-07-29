const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'capture-settings.js'), 'utf8');
const settings = vm.runInNewContext(`(() => { ${source}; return { LIVE_CAPTURE_FPS, LIVE_CAPTURE_MAX_DURATION_MS, LIVE_CAPTURE_MAX_FRAMES, LIVE_CAPTURE_VIDEO_BITRATE, CAPTURE_MIME_TYPES }; })()`);

assert.equal(settings.LIVE_CAPTURE_FPS, 30);
assert.equal(settings.LIVE_CAPTURE_MAX_DURATION_MS, 25_000);
assert.equal(settings.LIVE_CAPTURE_MAX_FRAMES, 750);
assert.equal(settings.LIVE_CAPTURE_VIDEO_BITRATE, 6_000_000);
assert.deepEqual(Array.from(settings.CAPTURE_MIME_TYPES), ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']);

console.log('Capture settings test passed: 30 FPS, 25-second 750-frame cap, fixed 6 Mbps bitrate, and VP9-first WebM preference.');
