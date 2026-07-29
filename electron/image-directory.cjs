const path = require('node:path');

function imageDirectory(dataDirectory, characterId) {
  if (typeof characterId !== 'string' || !/^[a-zA-Z0-9-]+$/.test(characterId)) {
    throw new Error('The selected character is invalid.');
  }
  return path.join(dataDirectory, 'images', characterId);
}

module.exports = { imageDirectory };
