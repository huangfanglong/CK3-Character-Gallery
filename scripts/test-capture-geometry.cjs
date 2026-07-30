const assert = require('node:assert/strict');
const {
  centeredCaptureCrop,
  defaultCaptureCrop,
  displayRectForVideo,
  dragCaptureCrop,
  moveCaptureCrop,
  normalizedCaptureCrop,
  resizeCaptureCrop,
  resizeCaptureCropFromCenter,
  restoredCaptureCrop,
  selectionRectForCrop,
  snapCaptureCrop,
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

  assert.deepEqual(moveCaptureCrop({ x: 100, y: 80, size: 300 }, 75, -120, 1920, 1080), { x: 175, y: 0, size: 300 });
  assert.deepEqual(moveCaptureCrop({ x: 1700, y: 900, size: 300 }, 50, 50, 1920, 1080), { x: 1620, y: 780, size: 300 });

  const resizeCases = [
    ['north-west', { x: 40, y: 80 }, { x: 40, y: 40, size: 360 }],
    ['north-east', { x: 460, y: 70 }, { x: 100, y: 40, size: 360 }],
    ['south-east', { x: 470, y: 440 }, { x: 100, y: 100, size: 370 }],
    ['south-west', { x: 30, y: 450 }, { x: 30, y: 100, size: 370 }],
  ];
  resizeCases.forEach(([handle, point, expected]) => {
    assert.deepEqual(resizeCaptureCrop({ x: 100, y: 100, size: 300 }, handle, point, 1920, 1080, 48), expected);
  });
  assert.deepEqual(resizeCaptureCrop({ x: 100, y: 100, size: 300 }, 'north-west', { x: 390, y: 390 }, 1920, 1080, 48), { x: 352, y: 352, size: 48 });

  assert.deepEqual(resizeCaptureCropFromCenter({ x: 100, y: 100, size: 300 }, 100, 1920, 1080, 48), { x: 50, y: 50, size: 400 });
  assert.deepEqual(resizeCaptureCropFromCenter({ x: 10, y: 10, size: 100 }, -200, 1920, 1080, 48), { x: 36, y: 36, size: 48 });
  assert.deepEqual(centeredCaptureCrop({ x: 1200, y: 250, size: 500 }, 1920, 1080), { x: 710, y: 290, size: 500 });

  assert.deepEqual(snapCaptureCrop({ x: 705, y: 6, size: 500 }, 1920, 1080, 8), { x: 710, y: 0, size: 500 });
  assert.deepEqual(snapCaptureCrop({ x: 698, y: 20, size: 500 }, 1920, 1080, 8), { x: 698, y: 20, size: 500 });

  const normalized = normalizedCaptureCrop({ x: 1200, y: 270, size: 540 }, 1920, 1080);
  assert.deepEqual(normalized, { centerX: 0.765625, centerY: 0.5, size: 0.5 });
  assert.deepEqual(restoredCaptureCrop(normalized, 2560, 1440), { x: 1600, y: 360, size: 720 });
  assert.equal(restoredCaptureCrop({ centerX: 'bad', centerY: 0.5, size: 0.5 }, 1920, 1080), null);

  console.log('Capture geometry test passed: letterboxing, drawing, moving, resizing, snapping, persistence, bounds, and selection alignment.');
}

main();
