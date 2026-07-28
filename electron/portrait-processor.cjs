const fs = require('node:fs/promises');
const { parseGIF, decompressFrames } = require('gifuct-js');
const { GIFEncoder, applyPalette, quantize } = require('gifenc');

const MAX_PORTRAIT_BYTES = 50 * 1024 * 1024;
const MAX_PORTRAIT_FRAMES = 300;
const MAX_AGGREGATE_FRAME_PIXELS = 100_000_000;

function portraitLimits(options = {}) {
  return {
    maxBytes: options.maxBytes ?? MAX_PORTRAIT_BYTES,
    maxFrames: options.maxFrames ?? MAX_PORTRAIT_FRAMES,
    maxAggregatePixels: options.maxAggregatePixels ?? MAX_AGGREGATE_FRAME_PIXELS,
  };
}

async function portraitBuffer(input) {
  return typeof input === 'string' ? fs.readFile(input) : Buffer.from(input);
}

function arrayBufferFor(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function gifLoopCount(parsed) {
  const extension = parsed.frames.find((frame) => ['NETSCAPE2.0', 'ANIMEXTS1.0'].includes(frame.application?.id));
  const blocks = extension?.application?.blocks;
  return blocks?.length >= 3 ? blocks[1] | (blocks[2] << 8) : -1;
}

async function inspectPortraitSource(input, options = {}) {
  const limits = portraitLimits(options);
  const buffer = await portraitBuffer(input);
  if (buffer.length > limits.maxBytes) throw new Error('Animated portrait exceeds the 50 MB file-size limit.');
  if (buffer.length < 6 || !/^GIF8[79]a$/.test(buffer.subarray(0, 6).toString('ascii'))) {
    throw new Error('The selected file is not a valid GIF image.');
  }
  let parsed;
  try {
    parsed = parseGIF(arrayBufferFor(buffer));
  } catch {
    throw new Error('The selected file is not a valid GIF image.');
  }
  const width = Number(parsed.lsd.width);
  const height = Number(parsed.lsd.height);
  const frameCount = parsed.frames.reduce((count, frame) => count + (frame.image ? 1 : 0), 0);
  if (!width || !height || !frameCount) throw new Error('The portrait dimensions or frames could not be read.');
  if (frameCount > limits.maxFrames) throw new Error('Animated portrait exceeds the 300 frames limit.');
  if (width * height * frameCount > limits.maxAggregatePixels) {
    throw new Error('Animated portrait exceeds the 100 million aggregate frame pixel limit.');
  }
  let frames;
  try {
    frames = decompressFrames(parsed, false);
  } catch {
    throw new Error('The selected file is not a valid GIF image.');
  }
  return {
    buffer,
    parsed,
    format: 'gif',
    animated: frames.length > 1,
    width,
    height,
    frames: frames.length,
    delay: frames.map((frame) => frame.delay),
    loop: gifLoopCount(parsed),
  };
}

function normalizedCrop(crop, width, height) {
  const x = Math.max(0, Math.min(Math.round(Number(crop.x) || 0), width - 1));
  const y = Math.max(0, Math.min(Math.round(Number(crop.y) || 0), height - 1));
  const size = Math.max(1, Math.min(Math.round(Number(crop.size) || 1), width - x, height - y));
  return { x, y, size };
}

function clearFrameRegion(canvas, width, dims) {
  for (let row = 0; row < dims.height; row += 1) {
    const start = ((dims.top + row) * width + dims.left) * 4;
    canvas.fill(0, start, start + dims.width * 4);
  }
}

function drawFramePatch(canvas, width, frame) {
  for (let row = 0; row < frame.dims.height; row += 1) {
    for (let column = 0; column < frame.dims.width; column += 1) {
      const source = (row * frame.dims.width + column) * 4;
      if (frame.patch[source + 3] === 0) continue;
      const target = ((frame.dims.top + row) * width + frame.dims.left + column) * 4;
      canvas.set(frame.patch.subarray(source, source + 4), target);
    }
  }
}

function* compositedFrames(parsed, width, height) {
  const frames = decompressFrames(parsed, true);
  const canvas = new Uint8ClampedArray(width * height * 4);
  let previous = null;
  let restoreCanvas = null;
  for (const frame of frames) {
    if (previous?.disposalType === 2) clearFrameRegion(canvas, width, previous.dims);
    if (previous?.disposalType === 3 && restoreCanvas) canvas.set(restoreCanvas);
    restoreCanvas = frame.disposalType === 3 ? canvas.slice() : null;
    drawFramePatch(canvas, width, frame);
    previous = frame;
    yield { pixels: canvas.slice(), delay: frame.delay };
  }
}

function resizedCrop(pixels, sourceWidth, crop, outputSize = 450) {
  const output = new Uint8ClampedArray(outputSize * outputSize * 4);
  const scale = crop.size / outputSize;
  for (let y = 0; y < outputSize; y += 1) {
    const sourceY = crop.y + (y + 0.5) * scale - 0.5;
    const y0 = Math.max(crop.y, Math.floor(sourceY));
    const y1 = Math.min(crop.y + crop.size - 1, y0 + 1);
    const vertical = Math.max(0, sourceY - y0);
    for (let x = 0; x < outputSize; x += 1) {
      const sourceX = crop.x + (x + 0.5) * scale - 0.5;
      const x0 = Math.max(crop.x, Math.floor(sourceX));
      const x1 = Math.min(crop.x + crop.size - 1, x0 + 1);
      const horizontal = Math.max(0, sourceX - x0);
      const target = (y * outputSize + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const top = pixels[(y0 * sourceWidth + x0) * 4 + channel] * (1 - horizontal)
          + pixels[(y0 * sourceWidth + x1) * 4 + channel] * horizontal;
        const bottom = pixels[(y1 * sourceWidth + x0) * 4 + channel] * (1 - horizontal)
          + pixels[(y1 * sourceWidth + x1) * 4 + channel] * horizontal;
        output[target + channel] = Math.round(top * (1 - vertical) + bottom * vertical);
      }
    }
  }
  return output;
}

async function processPortraitCrop(input, crop, options = {}) {
  const source = await inspectPortraitSource(input, options);
  const region = normalizedCrop(crop, source.width, source.height);
  const gif = GIFEncoder();
  for (const frame of compositedFrames(source.parsed, source.width, source.height)) {
    const rgba = resizedCrop(frame.pixels, source.width, region);
    const palette = quantize(rgba, 256, { format: 'rgba4444', oneBitAlpha: true });
    const indexed = applyPalette(rgba, palette, 'rgba4444');
    const transparentIndex = palette.findIndex((color) => color[3] === 0);
    gif.writeFrame(indexed, 450, 450, {
      palette,
      delay: frame.delay,
      repeat: source.loop,
      transparent: transparentIndex >= 0,
      transparentIndex: Math.max(0, transparentIndex),
      dispose: 1,
    });
  }
  gif.finish();
  return { data: Buffer.from(gif.bytes()), extension: '.gif', animated: source.animated };
}

module.exports = {
  MAX_AGGREGATE_FRAME_PIXELS,
  MAX_PORTRAIT_BYTES,
  MAX_PORTRAIT_FRAMES,
  inspectPortraitSource,
  processPortraitCrop,
};
