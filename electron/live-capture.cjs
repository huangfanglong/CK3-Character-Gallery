const { GIFEncoder, applyPalette, quantize } = require('gifenc');

const CAPTURE_SIZE = 450;
const CAPTURE_FPS = 12;
const MAX_CAPTURE_FRAMES = 300;
const MAX_CAPTURE_DURATION_MS = 25_000;
const MIN_FRAME_DELAY_MS = 20;
const MAX_FRAME_DELAY_MS = 1_000;

function createCaptureEncoder() {
  return { gif: GIFEncoder(), frames: 0, lastTimestamp: null };
}

function frameDelay(encoder, timestamp) {
  const numericTimestamp = Number(timestamp);
  const current = Number.isFinite(numericTimestamp) ? numericTimestamp : Date.now();
  const delay = encoder.lastTimestamp === null
    ? Math.round(1_000 / CAPTURE_FPS)
    : Math.max(MIN_FRAME_DELAY_MS, Math.min(MAX_FRAME_DELAY_MS, Math.round(current - encoder.lastTimestamp)));
  encoder.lastTimestamp = current;
  return delay;
}

function appendCaptureFrame(encoder, pixels, width, height, timestamp) {
  if (!encoder?.gif) throw new Error('No live portrait capture is active.');
  if (encoder.frames >= MAX_CAPTURE_FRAMES) throw new Error('Live portrait capture reached the 300 frame limit.');
  if (width !== CAPTURE_SIZE || height !== CAPTURE_SIZE) throw new Error('Captured portrait frames must be 450 by 450 pixels.');
  const expectedBytes = CAPTURE_SIZE * CAPTURE_SIZE * 4;
  if (!(pixels instanceof ArrayBuffer) || pixels.byteLength !== expectedBytes) throw new Error('Captured portrait frame data is invalid.');
  const rgba = new Uint8Array(pixels);
  const palette = quantize(rgba, 256, { format: 'rgba4444', oneBitAlpha: true });
  const indexed = applyPalette(rgba, palette, 'rgba4444');
  const transparentIndex = palette.findIndex((color) => color[3] === 0);
  encoder.gif.writeFrame(indexed, CAPTURE_SIZE, CAPTURE_SIZE, {
    palette,
    delay: frameDelay(encoder, timestamp),
    repeat: 0,
    transparent: transparentIndex >= 0,
    transparentIndex: Math.max(0, transparentIndex),
    dispose: 1,
  });
  encoder.frames += 1;
  return encoder.frames;
}

function finishCaptureEncoder(encoder) {
  if (!encoder?.gif || !encoder.frames) throw new Error('Live portrait capture did not contain any frames.');
  encoder.gif.finish();
  return Buffer.from(encoder.gif.bytes());
}

module.exports = {
  CAPTURE_FPS,
  CAPTURE_SIZE,
  MAX_CAPTURE_DURATION_MS,
  MAX_CAPTURE_FRAMES,
  appendCaptureFrame,
  createCaptureEncoder,
  finishCaptureEncoder,
};
