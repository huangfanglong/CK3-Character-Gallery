const assert = require('node:assert/strict');
const { normalizeWebmColor } = require('../renderer/webm-color.js');

function element(id, data) {
  assert.ok(data.length < 127);
  return Buffer.concat([Buffer.from(id), Buffer.from([0x80 | data.length]), data]);
}

function fixture() {
  const video = element([0xE0], Buffer.concat([
    element([0xB0], Buffer.from([0x01, 0xC2])),
    element([0xBA], Buffer.from([0x01, 0xC2])),
  ]));
  const track = element([0xAE], Buffer.concat([
    element([0x83], Buffer.from([1])),
    element([0x86], Buffer.from('V_VP9')),
    video,
  ]));
  const tracks = element([0x16, 0x54, 0xAE, 0x6B], track);
  const cluster = element([0x1F, 0x43, 0xB6, 0x75], element([0xA3], Buffer.from([0x81, 0, 0, 0x80, 0])));
  const segment = element([0x18, 0x53, 0x80, 0x67], Buffer.concat([tracks, cluster]));
  const header = element([0x1A, 0x45, 0xDF, 0xA3], element([0x42, 0x82], Buffer.from('webm')));
  const data = Buffer.concat([header, segment]);
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

const normalized = Buffer.from(normalizeWebmColor(fixture()));
const colour = Buffer.from([0x55, 0xB0]);
assert.notEqual(normalized.indexOf(colour), -1);
assert.notEqual(normalized.indexOf(Buffer.from([0x55, 0xB1, 0x81, 1])), -1);
assert.notEqual(normalized.indexOf(Buffer.from([0x55, 0xB9, 0x81, 2])), -1);
assert.notEqual(normalized.indexOf(Buffer.from([0x55, 0xBA, 0x81, 13])), -1);
assert.notEqual(normalized.indexOf(Buffer.from([0x55, 0xBB, 0x81, 1])), -1);
assert.equal(Buffer.from(normalizeWebmColor(normalized.buffer.slice(normalized.byteOffset, normalized.byteOffset + normalized.byteLength))).indexOf(colour), normalized.indexOf(colour));

console.log('WebM color test passed: video track declares BT.709 primaries/matrix, sRGB transfer, and full range.');
