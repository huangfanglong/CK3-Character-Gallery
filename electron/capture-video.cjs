const fs = require('node:fs/promises');
const path = require('node:path');

const CAPTURE_SIZE = 450;
const CAPTURE_FPS = 30;
const MAX_CAPTURE_DURATION_MS = 25_000;
const MAX_CAPTURE_FRAMES = CAPTURE_FPS * (MAX_CAPTURE_DURATION_MS / 1_000);
const MAX_CAPTURE_VIDEO_BYTES = 75 * 1024 * 1024;

const EBML = 0x1A45DFA3;
const DOC_TYPE = 0x4282;
const SEGMENT = 0x18538067;
const TRACKS = 0x1654AE6B;
const TRACK_ENTRY = 0xAE;
const TRACK_TYPE = 0x83;
const CODEC_ID = 0x86;
const VIDEO = 0xE0;
const PIXEL_WIDTH = 0xB0;
const PIXEL_HEIGHT = 0xBA;
const COLOUR = 0x55B0;
const MATRIX_COEFFICIENTS = 0x55B1;
const RANGE = 0x55B9;
const TRANSFER_CHARACTERISTICS = 0x55BA;
const PRIMARIES = 0x55BB;
const CLUSTER = 0x1F43B675;

function readVint(bytes, offset, stripMarker) {
  if (offset >= bytes.length) throw new Error('Captured video is truncated.');
  const first = bytes[offset];
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length += 1;
  if (length > 8 || offset + length > bytes.length) {
    const context = [...bytes.subarray(Math.max(0, offset - 4), Math.min(bytes.length, offset + 8))]
      .map((byte) => byte.toString(16).padStart(2, '0')).join(' ');
    throw new Error(`Captured video is truncated near EBML offset ${offset} (${context}).`);
  }
  let value = stripMarker ? first & (0x7F >> (length - 1)) : first;
  for (let index = 1; index < length; index += 1) value = (value * 256) + bytes[offset + index];
  return { length, value, unknown: stripMarker && value === (2 ** (7 * length)) - 1 };
}

function readElements(bytes, start, end, callback) {
  let offset = start;
  while (offset < end) {
    const id = readVint(bytes, offset, false);
    const size = readVint(bytes, offset + id.length, true);
    const dataStart = offset + id.length + size.length;
    const dataEnd = size.unknown ? end : dataStart + size.value;
    if (dataEnd > end) throw new Error('Captured video is truncated.');
    callback(id.value, dataStart, dataEnd);
    offset = dataEnd;
  }
  if (offset !== end) throw new Error('Captured video is invalid.');
}

function readUnsigned(bytes, start, end) {
  if (end <= start || end - start > 6) throw new Error('Captured video has invalid video dimensions.');
  let value = 0;
  for (let index = start; index < end; index += 1) value = (value * 256) + bytes[index];
  return value;
}

function readText(bytes, start, end) {
  return new TextDecoder().decode(bytes.subarray(start, end));
}

function inspectTrack(bytes, start, end) {
  const track = {};
  readElements(bytes, start, end, (id, dataStart, dataEnd) => {
    if (id === TRACK_TYPE) track.type = readUnsigned(bytes, dataStart, dataEnd);
    if (id === CODEC_ID) track.codec = readText(bytes, dataStart, dataEnd);
    if (id === VIDEO) {
      readElements(bytes, dataStart, dataEnd, (videoId, videoStart, videoEnd) => {
        if (videoId === PIXEL_WIDTH) track.width = readUnsigned(bytes, videoStart, videoEnd);
        if (videoId === PIXEL_HEIGHT) track.height = readUnsigned(bytes, videoStart, videoEnd);
        if (videoId === COLOUR) {
          track.color = {};
          readElements(bytes, videoStart, videoEnd, (colorId, colorStart, colorEnd) => {
            if (colorId === MATRIX_COEFFICIENTS) track.color.matrix = readUnsigned(bytes, colorStart, colorEnd);
            if (colorId === RANGE) track.color.range = readUnsigned(bytes, colorStart, colorEnd);
            if (colorId === TRANSFER_CHARACTERISTICS) track.color.transfer = readUnsigned(bytes, colorStart, colorEnd);
            if (colorId === PRIMARIES) track.color.primaries = readUnsigned(bytes, colorStart, colorEnd);
          });
        }
      });
    }
  });
  return track;
}

function validateCaptureVideo(video) {
  if (!(video instanceof ArrayBuffer) || video.byteLength < 4) throw new Error('Captured video data is invalid.');
  if (video.byteLength > MAX_CAPTURE_VIDEO_BYTES) throw new Error('Captured video exceeds the 75 MiB limit.');

  const bytes = new Uint8Array(video);
  let docType = '';
  let hasSegment = false;
  let hasMediaData = false;
  const tracks = [];

  readElements(bytes, 0, bytes.length, (id, dataStart, dataEnd) => {
    if (id === EBML) {
      readElements(bytes, dataStart, dataEnd, (headerId, headerStart, headerEnd) => {
        if (headerId === DOC_TYPE) docType = readText(bytes, headerStart, headerEnd).toLowerCase();
      });
    }
    if (id === SEGMENT) {
      hasSegment = true;
      readElements(bytes, dataStart, dataEnd, (segmentId, segmentStart, segmentEnd) => {
        if (segmentId === CLUSTER && segmentEnd > segmentStart) hasMediaData = true;
        if (segmentId === TRACKS) {
          readElements(bytes, segmentStart, segmentEnd, (tracksId, tracksStart, tracksEnd) => {
            if (tracksId === TRACK_ENTRY) tracks.push(inspectTrack(bytes, tracksStart, tracksEnd));
          });
        }
      });
    }
  });

  if (docType !== 'webm' || !hasSegment) throw new Error('Captured video must be a WebM file.');
  if (!hasMediaData) throw new Error('Captured video has no media data.');
  const videoTrack = tracks.find((track) => track.type === 1);
  if (!videoTrack) throw new Error('Captured video has no video track.');
  if (!['V_VP8', 'V_VP9'].includes(videoTrack.codec)) throw new Error('Captured video uses an unsupported video codec.');
  if (videoTrack.width !== CAPTURE_SIZE || videoTrack.height !== CAPTURE_SIZE) {
    throw new Error(`Captured video must be ${CAPTURE_SIZE} x ${CAPTURE_SIZE}.`);
  }
  return videoTrack;
}

async function saveCaptureVideo(directory, video, timestamp = Date.now()) {
  validateCaptureVideo(video);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error('Captured video timestamp is invalid.');
  await fs.mkdir(directory, { recursive: true });
  const destination = path.join(directory, `${timestamp}.webm`);
  await fs.writeFile(destination, Buffer.from(video));
  return destination;
}

module.exports = {
  CAPTURE_FPS,
  CAPTURE_SIZE,
  MAX_CAPTURE_DURATION_MS,
  MAX_CAPTURE_FRAMES,
  MAX_CAPTURE_VIDEO_BYTES,
  saveCaptureVideo,
  validateCaptureVideo,
};
