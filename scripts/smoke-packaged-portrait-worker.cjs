const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { GIFEncoder, applyPalette, quantize } = require('gifenc');

function fixture() {
  const gif = GIFEncoder();
  for (const color of [[255, 0, 0, 255], [0, 0, 255, 255]]) {
    const rgba = new Uint8Array(2 * 2 * 4);
    for (let offset = 0; offset < rgba.length; offset += 4) rgba.set(color, offset);
    const palette = quantize(rgba, 256);
    gif.writeFrame(applyPalette(rgba, palette), 2, 2, { palette, delay: 40, repeat: 0 });
  }
  gif.finish();
  return Buffer.from(gif.bytes());
}

async function runPackagedWorker() {
  const asarPath = path.join(__dirname, '..', 'release', 'win-unpacked', 'resources', 'app.asar');
  const { PortraitWorkerClient } = require(path.join(asarPath, 'electron', 'portrait-worker-client.cjs'));
  const client = new PortraitWorkerClient({ workerPath: path.join(asarPath, 'electron', 'portrait-worker-thread.cjs') });
  try {
    const input = fixture();
    assert.equal((await client.run('inspect', { input })).frames, 2);
    const output = await client.run('process', { input, crop: { x: 0, y: 0, size: 2 } });
    assert.equal(output.extension, '.gif');
    assert.ok(output.data.byteLength > 0);
  } finally {
    await client.destroy();
  }
  console.log('Packaged portrait worker smoke test passed.');
}

async function main() {
  if (process.platform !== 'win32') return console.log('Packaged portrait worker smoke test skipped outside Windows.');
  if (process.env.CK3_PACKAGED_PORTRAIT_WORKER === '1') return runPackagedWorker();
  const executable = path.join(__dirname, '..', 'release', 'win-unpacked', 'CK3 Character Gallery.exe');
  const child = spawnSync(executable, [__filename], {
    encoding: 'utf8',
    env: { ...process.env, CK3_PACKAGED_PORTRAIT_WORKER: '1', ELECTRON_RUN_AS_NODE: '1' },
  });
  if (child.stdout) process.stdout.write(child.stdout);
  if (child.stderr) process.stderr.write(child.stderr);
  assert.equal(child.status, 0, `Packaged portrait worker exited with ${child.status}.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
