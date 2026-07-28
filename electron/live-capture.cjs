const { GIFEncoder, applyPalette, quantize } = require('gifenc');

const CAPTURE_SIZE = 450;
const CAPTURE_FPS = 12;
const MAX_CAPTURE_FRAMES = 300;
const MAX_CAPTURE_DURATION_MS = 25_000;
const MIN_FRAME_DELAY_MS = 20;
const MAX_FRAME_DELAY_MS = 1_000;
const PALETTE_SAMPLE_FRAMES = CAPTURE_FPS;

function createCaptureEncoder() {
  return { gif: GIFEncoder(), frames: 0, lastTimestamp: null, palette: null, pendingFrames: [] };
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

function writeCaptureFrame(encoder, rgba, delay) {
  const indexed = applyPalette(rgba, encoder.palette, 'rgb565');
  encoder.gif.writeFrame(indexed, CAPTURE_SIZE, CAPTURE_SIZE, {
    palette: encoder.frames === 0 ? encoder.palette : undefined,
    delay,
    repeat: 0,
    dispose: 1,
  });
  encoder.frames += 1;
}

function establishCapturePalette(encoder) {
  const pixels = new Uint8Array(encoder.pendingFrames.length * CAPTURE_SIZE * CAPTURE_SIZE * 4);
  let offset = 0;
  for (const frame of encoder.pendingFrames) {
    pixels.set(frame.rgba, offset);
    offset += frame.rgba.length;
  }
  encoder.palette = quantize(pixels, 256, { format: 'rgb565' });
  for (const frame of encoder.pendingFrames) writeCaptureFrame(encoder, frame.rgba, frame.delay);
  encoder.pendingFrames = [];
}

function appendCaptureFrame(encoder, pixels, width, height, timestamp) {
  if (!encoder?.gif) throw new Error('No live portrait capture is active.');
  if (encoder.frames >= MAX_CAPTURE_FRAMES) throw new Error('Live portrait capture reached the 300 frame limit.');
  if (width !== CAPTURE_SIZE || height !== CAPTURE_SIZE) throw new Error('Captured portrait frames must be 450 by 450 pixels.');
  const expectedBytes = CAPTURE_SIZE * CAPTURE_SIZE * 4;
  if (!(pixels instanceof ArrayBuffer) || pixels.byteLength !== expectedBytes) throw new Error('Captured portrait frame data is invalid.');
  const rgba = new Uint8Array(pixels);
  const delay = frameDelay(encoder, timestamp);
  if (!encoder.palette) {
    encoder.pendingFrames.push({ rgba, delay });
    if (encoder.pendingFrames.length === PALETTE_SAMPLE_FRAMES) establishCapturePalette(encoder);
    return encoder.frames + encoder.pendingFrames.length;
  }
  writeCaptureFrame(encoder, rgba, delay);
  return encoder.frames;
}

function finishCaptureEncoder(encoder) {
  if (!encoder?.gif || (!encoder.frames && !encoder.pendingFrames?.length)) throw new Error('Live portrait capture did not contain any frames.');
  if (!encoder.palette) establishCapturePalette(encoder);
  encoder.gif.finish();
  return Buffer.from(encoder.gif.bytes());
}

module.exports = {
  CAPTURE_FPS,
  CAPTURE_SIZE,
  MAX_CAPTURE_DURATION_MS,
  MAX_CAPTURE_FRAMES,
  PALETTE_SAMPLE_FRAMES,
  appendCaptureFrame,
  createCaptureEncoder,
  finishCaptureEncoder,
};
