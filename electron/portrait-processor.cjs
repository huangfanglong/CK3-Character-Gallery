const fs = require('node:fs/promises');
const { parseGIF, decompressFrames } = require('gifuct-js');
const { GIFEncoder, applyPalette, quantize } = require('gifenc');

const MAX_PORTRAIT_BYTES = 50 * 1024 * 1024;
const MAX_PORTRAIT_FRAMES = 300;
const MAX_LOGICAL_FRAME_PIXELS = 4_000_000;
const MAX_AGGREGATE_FRAME_PIXELS = 20_000_000;
const PALETTE_SAMPLE_FRAMES = 24;

function portraitLimits(options = {}) {
  return {
    maxBytes: options.maxBytes ?? MAX_PORTRAIT_BYTES,
    maxFrames: options.maxFrames ?? MAX_PORTRAIT_FRAMES,
    maxLogicalPixels: options.maxLogicalPixels ?? MAX_LOGICAL_FRAME_PIXELS,
    maxAggregatePixels: options.maxAggregatePixels ?? MAX_AGGREGATE_FRAME_PIXELS,
  };
}

async function portraitBuffer(input, maxBytes) {
  if (typeof input === 'string') {
    const metadata = await fs.stat(input);
    if (metadata.size > maxBytes) throw new Error('Animated portrait exceeds the 50 MB file-size limit.');
    return fs.readFile(input);
  }
  if (Number(input?.byteLength ?? input?.length) > maxBytes) {
    throw new Error('Animated portrait exceeds the 50 MB file-size limit.');
  }
  return Buffer.from(input);
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
  const buffer = await portraitBuffer(input, limits.maxBytes);
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
  const imageFrames = parsed.frames.filter((frame) => frame.image);
  const frameCount = imageFrames.length;
  if (!width || !height || !frameCount) throw new Error('The portrait dimensions or frames could not be read.');
  if (width * height > limits.maxLogicalPixels) throw new Error('Animated portrait dimensions exceed the logical frame pixel limit.');
  if (frameCount > limits.maxFrames) throw new Error('Animated portrait exceeds the 300 frames limit.');
  if (width * height * frameCount > limits.maxAggregatePixels) {
    throw new Error('Animated portrait exceeds the aggregate frame pixel limit.');
  }
  let descriptorPixels = 0;
  for (const frame of imageFrames) {
    const descriptor = frame.image.descriptor;
    const values = [descriptor.left, descriptor.top, descriptor.width, descriptor.height].map(Number);
    const [left, top, frameWidth, frameHeight] = values;
    descriptorPixels += frameWidth * frameHeight;
    if (!values.every(Number.isSafeInteger) || left < 0 || top < 0 || frameWidth < 1 || frameHeight < 1
      || left + frameWidth > width || top + frameHeight > height || descriptorPixels > limits.maxAggregatePixels) {
      throw new Error('Animated portrait frame dimensions are invalid.');
    }
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

function* compositedFrames(frames, sourceFrames, width, height) {
  const canvas = new Uint8ClampedArray(width * height * 4);
  let previous = null;
  let restoreCanvas = null;
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    if (previous?.disposalType === 2) clearFrameRegion(canvas, width, previous.dims);
    if (previous?.disposalType === 3 && restoreCanvas) canvas.set(restoreCanvas);
    restoreCanvas = frame.disposalType === 3 ? canvas.slice() : null;
    drawFramePatch(canvas, width, frame);
    previous = frame;
    const rawDelay = sourceFrames[index]?.gce?.delay;
    yield { pixels: canvas.slice(), delay: Number.isInteger(rawDelay) ? rawDelay * 10 : frame.delay };
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

function hasTransparency(pixels) {
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] < 255) return true;
  }
  return false;
}

function paletteSampleIndexes(frameCount) {
  const sampleCount = Math.min(frameCount, PALETTE_SAMPLE_FRAMES);
  return new Set(Array.from({ length: sampleCount }, (_, index) => Math.round(index * (frameCount - 1) / Math.max(1, sampleCount - 1))));
}

async function processPortraitCrop(input, crop, options = {}) {
  const source = await inspectPortraitSource(input, options);
  const region = normalizedCrop(crop, source.width, source.height);
  const sampleIndexes = paletteSampleIndexes(source.frames);
  const decodedFrames = decompressFrames(source.parsed, true);
  const sourceFrames = source.parsed.frames.filter((frame) => frame.image);
  const samples = [];
  let transparent = false;
  let index = 0;
  for (const frame of compositedFrames(decodedFrames, sourceFrames, source.width, source.height)) {
    const rgba = resizedCrop(frame.pixels, source.width, region);
    transparent ||= hasTransparency(rgba);
    if (sampleIndexes.has(index)) samples.push(rgba);
    index += 1;
  }
  const samplePixels = new Uint8Array(samples.reduce((length, sample) => length + sample.length, 0));
  let offset = 0;
  for (const sample of samples) {
    samplePixels.set(sample, offset);
    offset += sample.length;
  }
  const format = transparent ? 'rgba4444' : 'rgb565';
  const palette = quantize(samplePixels, 256, transparent ? { format, oneBitAlpha: true } : { format });
  const transparentIndex = transparent ? palette.findIndex((color) => color[3] === 0) : -1;
  const gif = GIFEncoder();
  index = 0;
  for (const frame of compositedFrames(decodedFrames, sourceFrames, source.width, source.height)) {
    const rgba = resizedCrop(frame.pixels, source.width, region);
    const indexed = applyPalette(rgba, palette, format);
    gif.writeFrame(indexed, 450, 450, {
      palette: index === 0 ? palette : undefined,
      delay: frame.delay,
      repeat: source.loop,
      transparent: transparentIndex >= 0,
      transparentIndex: transparentIndex >= 0 ? transparentIndex : undefined,
      dispose: 2,
    });
    index += 1;
  }
  gif.finish();
  return { data: Buffer.from(gif.bytes()), extension: '.gif', animated: source.animated };
}

module.exports = {
  MAX_AGGREGATE_FRAME_PIXELS,
  MAX_LOGICAL_FRAME_PIXELS,
  MAX_PORTRAIT_BYTES,
  MAX_PORTRAIT_FRAMES,
  PALETTE_SAMPLE_FRAMES,
  inspectPortraitSource,
  processPortraitCrop,
};
