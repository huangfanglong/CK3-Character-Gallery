const { spawnSync } = require('node:child_process');

const allowedLicenses = new Set([
  '0BSD',
  'Apache-2.0',
  'BlueOak-1.0.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC0-1.0',
  'ISC',
  'MIT',
  'Python-2.0',
  'WTFPL',
]);

const npmCommand = process.platform === 'win32' ? process.env.ComSpec : 'npm';
const npmArguments = process.platform === 'win32'
  ? ['/d', '/s', '/c', 'npm.cmd query * --json']
  : ['query', '*', '--json'];
const result = spawnSync(npmCommand, npmArguments, { encoding: 'utf8' });
if (result.status !== 0) {
  process.stderr.write(result.error?.message || result.stderr || 'npm query failed.\n');
  process.exit(result.status || 1);
}

const packages = JSON.parse(result.stdout);
const violations = packages.filter((dependency) => {
  const license = typeof dependency.license === 'string' ? dependency.license : '';
  if (!license) return true;
  const alternatives = license.replace(/[()]/g, '').split(/\s+OR\s+/).map((value) => value.trim()).filter(Boolean);
  return !alternatives.length || !alternatives.every((value) => allowedLicenses.has(value));
});

if (violations.length) {
  console.error('License audit failed:');
  violations.forEach((dependency) => console.error(`- ${dependency.name}@${dependency.version}: ${dependency.license || '(missing)'}`));
  process.exit(1);
}

console.log(`License audit passed for ${packages.length} installed packages.`);
