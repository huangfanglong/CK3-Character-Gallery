const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { parseGIF, decompressFrames } = require('gifuct-js');
const { GIFEncoder, applyPalette, quantize } = require('gifenc');
const { PALETTE_SAMPLE_FRAMES, inspectPortraitSource, processPortraitCrop } = require('../electron/portrait-processor.cjs');

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

function transparentFixture() {
  const gif = GIFEncoder();
  const rgba = new Uint8Array([
    255, 0, 0, 255, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 255, 255,
  ]);
  const palette = quantize(rgba, 256, { format: 'rgba4444', oneBitAlpha: true });
  const transparentIndex = palette.findIndex((color) => color[3] === 0);
  gif.writeFrame(applyPalette(rgba, palette, 'rgba4444'), 2, 2, {
    palette,
    transparent: true,
    transparentIndex,
  });
  gif.finish();
  return Buffer.from(gif.bytes());
}

function zeroDelayFixture() {
  const gif = GIFEncoder();
  for (const color of [[255, 0, 0, 255], [0, 0, 255, 255]]) {
    const rgba = new Uint8Array(2 * 2 * 4);
    for (let offset = 0; offset < rgba.length; offset += 4) rgba.set(color, offset);
    const palette = quantize(rgba, 256);
    gif.writeFrame(applyPalette(rgba, palette), 2, 2, { palette, delay: 0, repeat: 0 });
  }
  gif.finish();
  return Buffer.from(gif.bytes());
}

function transparentAnimationFixture() {
  const gif = GIFEncoder();
  const frames = [
    new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]),
    new Uint8Array([0, 0, 0, 0, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255]),
  ];
  frames.forEach((rgba) => {
    const palette = quantize(rgba, 256, { format: 'rgba4444', oneBitAlpha: true });
    const transparentIndex = palette.findIndex((color) => color[3] === 0);
    gif.writeFrame(applyPalette(rgba, palette, 'rgba4444'), 2, 2, { palette, delay: 40, repeat: 0, transparent: true, transparentIndex });
  });
  gif.finish();
  return Buffer.from(gif.bytes());
}

function invalidFrameDescriptorFixture() {
  const input = animatedFixture();
  const descriptor = input.indexOf(0x2c);
  assert.ok(descriptor >= 0, 'Fixture should contain an image descriptor.');
  input.writeUInt16LE(5, descriptor + 5);
  return input;
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
  const imageFrames = parsed.frames.filter((frame) => frame.image);
  assert.ok(imageFrames.slice(1).every((frame) => !frame.image.descriptor.lct.exists), 'Cropped GIF frames should share the global palette.');
  assert.equal(PALETTE_SAMPLE_FRAMES, 24);

  const transparentOutput = await processPortraitCrop(transparentFixture(), { x: 0, y: 0, size: 2 });
  const transparentFrames = decompressFrames(parseGIF(arrayBufferFor(transparentOutput.data)), true);
  assert.ok([...transparentFrames[0].patch].some((_, index) => index % 4 === 3 && transparentFrames[0].patch[index] === 0), 'Transparent GIF pixels should remain transparent after cropping.');

  const zeroDelayOutput = await processPortraitCrop(zeroDelayFixture(), { x: 0, y: 0, size: 2 });
  assert.deepEqual(parseGIF(arrayBufferFor(zeroDelayOutput.data)).frames.filter((frame) => frame.image).map((frame) => frame.gce?.delay), [0, 0]);

  const transparentAnimationOutput = await processPortraitCrop(transparentAnimationFixture(), { x: 0, y: 0, size: 2 });
  assert.deepEqual(parseGIF(arrayBufferFor(transparentAnimationOutput.data)).frames.filter((frame) => frame.image).map((frame) => frame.gce?.extras.disposal), [2, 2]);

  await assert.rejects(() => inspectPortraitSource(input, { maxBytes: input.length - 1 }), /50 MB|file-size limit/i);
  await assert.rejects(() => inspectPortraitSource(input, { maxFrames: 1 }), /300 frames|frame limit/i);
  await assert.rejects(() => inspectPortraitSource(input, { maxLogicalPixels: 11 }), /dimensions|logical frame pixel limit/i);
  await assert.rejects(() => inspectPortraitSource(input, { maxAggregatePixels: 23 }), /aggregate frame pixel limit/i);
  await assert.rejects(() => inspectPortraitSource(invalidFrameDescriptorFixture()), /frame dimensions/i);
  const oversizedPath = path.join(os.tmpdir(), `ck3-portrait-${Date.now()}.gif`);
  await fs.writeFile(oversizedPath, input);
  try {
    await assert.rejects(() => inspectPortraitSource(oversizedPath, { maxBytes: input.length - 1 }), /file-size limit/i);
  } finally {
    await fs.rm(oversizedPath, { force: true });
  }
  await assert.rejects(() => inspectPortraitSource(Buffer.from('not a gif')), /not a valid GIF/i);

  console.log('Portrait processor test passed: globally-paletted animated GIF crop, frame pixels, timing, looping, dimensions, malformed input, and resource limits.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
