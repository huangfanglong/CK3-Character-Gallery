const assert = require('node:assert/strict');
const { parseGIF, decompressFrames } = require('gifuct-js');
const {
  CAPTURE_SIZE,
  MAX_CAPTURE_FRAMES,
  appendCaptureFrame,
  createCaptureEncoder,
  finishCaptureEncoder,
} = require('../electron/live-capture.cjs');

function arrayBufferFor(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function frame(red, green, blue) {
  const pixels = new Uint8Array(CAPTURE_SIZE * CAPTURE_SIZE * 4);
  for (let index = 0; index < pixels.length; index += 4) pixels.set([red, green, blue, 255], index);
  return pixels;
}

function main() {
  const encoder = createCaptureEncoder();
  assert.equal(appendCaptureFrame(encoder, frame(255, 0, 0).buffer, 450, 450, 1_000), 1);
  assert.equal(appendCaptureFrame(encoder, frame(0, 0, 255).buffer, 450, 450, 1_125), 2);
  assert.equal(appendCaptureFrame(encoder, frame(0, 255, 0).buffer, 450, 450, 1_126), 3);
  assert.equal(appendCaptureFrame(encoder, frame(255, 255, 0).buffer, 450, 450, 20_000), 4);
  const output = finishCaptureEncoder(encoder);
  const parsed = parseGIF(arrayBufferFor(output));
  const frames = decompressFrames(parsed, true);
  assert.equal(parsed.lsd.width, CAPTURE_SIZE);
  assert.equal(parsed.lsd.height, CAPTURE_SIZE);
  assert.equal(frames.length, 4);
  assert.deepEqual(frames.map((item) => item.delay), [80, 130, 20, 1_000]);
  assert.deepEqual([...frames[0].patch.subarray(0, 4)], [255, 0, 0, 255]);
  assert.deepEqual([...frames[1].patch.subarray(0, 4)], [0, 0, 255, 255]);

  assert.throws(() => appendCaptureFrame(createCaptureEncoder(), new Uint8Array(1), 450, 450, 1), /frame data is invalid/i);
  assert.throws(() => appendCaptureFrame(createCaptureEncoder(), frame(1, 2, 3).buffer, 449, 450, 1), /450 by 450/i);
  assert.throws(() => finishCaptureEncoder(createCaptureEncoder()), /did not contain any frames/i);
  const capped = createCaptureEncoder(); capped.frames = MAX_CAPTURE_FRAMES;
  assert.throws(() => appendCaptureFrame(capped, frame(1, 2, 3).buffer, 450, 450, 1), /300 frame/i);
  console.log('Live capture test passed: dimensions, animated GIF output, timing, pixels, frame cap, and invalid frame rejection.');
}

main();
