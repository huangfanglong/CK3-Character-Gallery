const assert = require('node:assert/strict');
const path = require('node:path');
const { imageDirectory } = require('../electron/image-directory.cjs');

const dataDirectory = path.resolve('C:/ck3-gallery-data');
assert.equal(imageDirectory(dataDirectory, '517ee730-eba6-48c7-8542-3725dab9f37c'), path.join(dataDirectory, 'images', '517ee730-eba6-48c7-8542-3725dab9f37c'));
for (const invalidId of ['', '..', '../outside', 'nested/path', 'C:/outside', null, 42]) {
  assert.throws(() => imageDirectory(dataDirectory, invalidId), /selected character is invalid/i);
}

console.log('Image directory test passed: character image writes stay beneath the local archive image root.');
