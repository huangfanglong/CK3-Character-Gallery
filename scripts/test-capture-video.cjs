const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  CAPTURE_FPS,
  CAPTURE_SIZE,
  MAX_CAPTURE_DURATION_MS,
  MAX_CAPTURE_FRAMES,
  MAX_CAPTURE_VIDEO_BYTES,
  saveCaptureVideo,
  validateCaptureVideo,
} = require('../electron/capture-video.cjs');

function element(id, data) {
  assert.ok(data.length < 127, 'Test EBML elements must use one-byte sizes.');
  return Buffer.concat([Buffer.from(id), Buffer.from([0x80 | data.length]), data]);
}

function uint(value) {
  if (value <= 0xFF) return Buffer.from([value]);
  return Buffer.from([(value >> 8) & 0xFF, value & 0xFF]);
}

function webmBuffer({ width = 450, height = 450, codec = 'V_VP9', includeCluster = true } = {}) {
  const ebml = element([0x1A, 0x45, 0xDF, 0xA3], element([0x42, 0x82], Buffer.from('webm')));
  const video = element([0xE0], Buffer.concat([
    element([0xB0], uint(width)),
    element([0xBA], uint(height)),
  ]));
  const track = element([0xAE], Buffer.concat([
    element([0x83], uint(1)),
    element([0x86], Buffer.from(codec)),
    video,
  ]));
  const tracks = element([0x16, 0x54, 0xAE, 0x6B], track);
  const cluster = includeCluster
    ? element([0x1F, 0x43, 0xB6, 0x75], element([0xA3], Buffer.from([0x81, 0, 0, 0x80, 0])))
    : Buffer.alloc(0);
  const segment = element([0x18, 0x53, 0x80, 0x67], Buffer.concat([tracks, cluster]));
  const data = Buffer.concat([ebml, segment]);
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

async function main() {
  assert.equal(CAPTURE_SIZE, 450);
  assert.equal(CAPTURE_FPS, 30);
  assert.equal(MAX_CAPTURE_DURATION_MS, 25_000);
  assert.equal(MAX_CAPTURE_FRAMES, 750);
  assert.doesNotThrow(() => validateCaptureVideo(webmBuffer()));
  assert.throws(() => validateCaptureVideo(new ArrayBuffer(0)), /invalid/i);
  assert.throws(() => validateCaptureVideo(new Uint8Array([0x1A, 0x45, 0xDF, 0xA3])), /invalid/i);
  assert.throws(() => validateCaptureVideo(new Uint8Array([0, 1, 2, 3]).buffer), /WebM|truncated|invalid/i);
  assert.throws(() => validateCaptureVideo(new ArrayBuffer(MAX_CAPTURE_VIDEO_BYTES + 1)), /75 MiB/i);
  assert.throws(() => validateCaptureVideo(new Uint8Array([0x1A, 0x45, 0xDF, 0xA3, 0, 0, 0, 0]).buffer), /WebM|truncated|invalid/i);
  assert.throws(() => validateCaptureVideo(webmBuffer({ width: 451 })), /450 x 450/i);
  assert.throws(() => validateCaptureVideo(webmBuffer({ codec: 'V_MPEG4' })), /codec/i);
  assert.throws(() => validateCaptureVideo(webmBuffer({ includeCluster: false })), /media data/i);

  const truncated = webmBuffer().slice(0, -2);
  assert.throws(() => validateCaptureVideo(truncated), /truncated|invalid/i);

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ck3-live-video-'));
  try {
    const destination = await saveCaptureVideo(directory, webmBuffer(), 1_234);
    assert.equal(path.basename(destination), '1234.webm');
    assert.deepEqual(await fs.readFile(destination), Buffer.from(webmBuffer()));
    await assert.rejects(() => saveCaptureVideo(directory, webmBuffer(), -1), /timestamp/i);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
  console.log('Capture video test passed: fixed 30 FPS WebM contract, validated persistence, frame cap, and payload rejection.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
