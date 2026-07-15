const fs = require('node:fs');
const path = require('node:path');

const outputDirectory = path.join(__dirname, '..', 'release', 'win-unpacked');
const requiredFiles = [
  'LICENSE.electron.txt',
  'LICENSES.chromium.html',
  path.join('resources', 'licenses', 'CK3 Character Gallery LICENSE.txt'),
];
const missing = requiredFiles.filter((file) => !fs.existsSync(path.join(outputDirectory, file)));

if (missing.length) {
  console.error(`Packaged license files are missing from ${outputDirectory}:`);
  missing.forEach((file) => console.error(`- ${file}`));
  process.exit(1);
}

console.log('Packaged license files verified.');
