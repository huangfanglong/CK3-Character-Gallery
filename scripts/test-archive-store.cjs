const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ensureArchive, saveArchive } = require('../electron/archive-store.cjs');

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ck3-archive-store-'));
  try {
    const fresh = await ensureArchive(root);
    assert.deepEqual(fresh.galleries, [{ name: 'Default', characters: [] }]);
    assert.equal(fresh.warning, null);

    await fs.writeFile(path.join(root, 'galleries.json'), '{ broken archive');
    const recovered = await ensureArchive(root, { now: () => 123456 });
    assert.deepEqual(recovered.galleries, [{ name: 'Default', characters: [] }]);
    assert.match(recovered.warning, /recovery copy/);
    assert.equal(await fs.readFile(path.join(root, 'galleries.json.corrupt-123456'), 'utf8'), '{ broken archive');
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'galleries.json'), 'utf8')), [{ name: 'Default', characters: [] }]);

    await fs.writeFile(path.join(root, 'galleries.json'), JSON.stringify({ invalid: true }));
    const invalidRoot = await ensureArchive(root, { now: () => 123457 });
    assert.deepEqual(invalidRoot.galleries, [{ name: 'Default', characters: [] }]);
    await saveArchive(root, [{ name: 'Saved', characters: [] }]);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'galleries.json'), 'utf8')), [{ name: 'Saved', characters: [] }]);
    console.log('Archive store test passed: fresh setup, corrupt-file recovery, invalid-root recovery, warnings, and atomic saves.');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
