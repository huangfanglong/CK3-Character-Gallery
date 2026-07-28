const assert = require('node:assert/strict');
const { parseGIF, decompressFrames } = require('gifuct-js');
const { GIFEncoder, applyPalette, quantize } = require('gifenc');
const { inspectPortraitSource, processPortraitCrop } = require('../electron/portrait-processor.cjs');

function arrayBufferFor(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function solidFrame(width, height, left, right) {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) rgba.set(x ? right : left, (y * width + x) * 4);
  }
  return rgba;
}

function animatedFixture() {
  const gif = GIFEncoder();
  const frames = [
    solidFrame(4, 3, [255, 0, 0, 255], [0, 255, 0, 255]),
    solidFrame(4, 3, [0, 0, 255, 255], [255, 255, 0, 255]),
  ];
  frames.forEach((rgba, index) => {
    const palette = quantize(rgba, 256);
    gif.writeFrame(applyPalette(rgba, palette), 4, 3, { palette, delay: index ? 120 : 80, repeat: 2 });
  });
  gif.finish();
  return Buffer.from(gif.bytes());
}

function loopCount(parsed) {
  const blocks = parsed.frames.find((frame) => frame.application?.id === 'NETSCAPE2.0')?.application?.blocks;
  return blocks?.length >= 3 ? blocks[1] | (blocks[2] << 8) : -1;
}

async function main() {
  const input = animatedFixture();
  const source = await inspectPortraitSource(input);
  assert.equal(source.format, 'gif');
  assert.equal(source.animated, true);
  assert.equal(source.width, 4);
  assert.equal(source.height, 3);
  assert.equal(source.frames, 2);
  assert.deepEqual(source.delay, [80, 120]);
  assert.equal(source.loop, 2);

  const output = await processPortraitCrop(input, { x: 1, y: 0, size: 3 });
  assert.equal(output.extension, '.gif');
  const parsed = parseGIF(arrayBufferFor(output.data));
  const frames = decompressFrames(parsed, true);
  assert.equal(parsed.lsd.width, 450);
  assert.equal(parsed.lsd.height, 450);
  assert.equal(frames.length, 2);
  assert.deepEqual(frames.map((frame) => frame.delay), [80, 120]);
  assert.equal(loopCount(parsed), 2);
  assert.deepEqual([...frames[0].patch.subarray(0, 4)], [0, 255, 0, 255]);
  assert.deepEqual([...frames[1].patch.subarray(0, 4)], [255, 255, 0, 255]);

  await assert.rejects(() => inspectPortraitSource(input, { maxBytes: input.length - 1 }), /50 MB|file-size limit/i);
  await assert.rejects(() => inspectPortraitSource(input, { maxFrames: 1 }), /300 frames|frame limit/i);
  await assert.rejects(() => inspectPortraitSource(input, { maxAggregatePixels: 23 }), /100 million|pixel limit/i);
  await assert.rejects(() => inspectPortraitSource(Buffer.from('not a gif')), /not a valid GIF/i);

  console.log('Portrait processor test passed: animated GIF crop, frame pixels, timing, looping, dimensions, malformed input, and resource limits.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
