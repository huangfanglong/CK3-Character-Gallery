const assert = require('node:assert/strict');
const {
  defaultCaptureCrop,
  displayRectForVideo,
  dragCaptureCrop,
  selectionRectForCrop,
} = require('../renderer/capture-geometry.js');

function main() {
  assert.deepEqual(displayRectForVideo(640, 360, 1920, 1080), { x: 0, y: 0, width: 640, height: 360 });
  assert.deepEqual(displayRectForVideo(640, 360, 2560, 1080), { x: 0, y: 45, width: 640, height: 270 });
  assert.deepEqual(displayRectForVideo(640, 360, 1080, 1920), { x: 218.75, y: 0, width: 202.5, height: 360 });
  assert.deepEqual(defaultCaptureCrop(2560, 1080), { x: 740, y: 0, size: 1080 });

  const wideDisplay = displayRectForVideo(640, 360, 2560, 1080);
  const crop = dragCaptureCrop({ x: 160, y: 90 }, { x: 430, y: 270 }, wideDisplay, 2560, 1080);
  assert.deepEqual(crop, { x: 640, y: 360, size: 720 });
  assert.deepEqual(selectionRectForCrop(crop, wideDisplay, 2560, 1080), { x: 160, y: 135, size: 180 });

  const tallDisplay = displayRectForVideo(640, 360, 1080, 1920);
  const tallCrop = dragCaptureCrop({ x: 10, y: 10 }, { x: 170, y: 300 }, tallDisplay, 1080, 1920);
  assert.deepEqual(tallCrop, { x: 53, y: 53, size: 853 });
  const tallSelection = selectionRectForCrop(tallCrop, tallDisplay, 1080, 1920);
  assert.ok(Math.abs(tallSelection.x - 228.6875) < 0.001);
  assert.ok(Math.abs(tallSelection.y - 9.9375) < 0.001);
  assert.ok(Math.abs(tallSelection.size - 159.9375) < 0.001);

  console.log('Capture geometry test passed: letterboxing, intrinsic crop mapping, centering, bounds, and selection alignment.');
}

main();
