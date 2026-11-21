const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Ck3LayoutResolver } = require('../electron/live-game-resolver.cjs');
const { LiveGameEngine } = require('../electron/live-game-engine.cjs');
const { decodeX64 } = require('../electron/x64-decoder.cjs');
const { sanitizeResult } = require('../electron/live-game-bridge.cjs');
const { liveFixture, BASE, RVA } = require('./live-game-fixture.cjs');

function decoded(bytes) { return decodeX64(Buffer.from(bytes)); }
assert.equal(decoded([0x41, 0x8b, 0x40, 0x18]).operands[0].name, 'eax');
assert.equal(decoded([0x41, 0x8b, 0x40, 0x18]).operands[1].displacement, 0x18);
assert.equal(decoded([0x81, 0xe9, 0x78, 0x56, 0x34, 0x12]).mnemonic, 'sub');
assert.equal(decoded([0x0f, 0x84, 0x10, 0, 0, 0]).target, 0x16);
assert.equal(decoded([0x48, 0x8d, 0x81, 0x60, 1, 0, 0]).operands[1].displacement, 0x160);
assert.throws(() => decoded([0x62]), /Unsupported/);
assert.equal(decoded([0x32, 0xc0]).mnemonic, 'xor');
assert.equal(decoded([0x32, 0xc0]).operands[0].name, 'al');
assert.equal(decoded([0x38, 0xd8]).mnemonic, 'cmp');

(async () => {
  const fixture = liveFixture();
  const resolver = new Ck3LayoutResolver(fixture.pe.buffer, BASE, (address, size) => fixture.process.read(fixture.process.open(1, 'fixture', false).handle, address, size));
  const layout = await resolver.resolve();
  assert.equal(layout.windowVtableRva, fixture.pe.vtables.window);
  assert.equal((await resolver.vtables('.?AVCCharacterWindow@@')).length, 2);
  assert.equal(await resolver.rttiNameForVtable(BASE + BigInt(fixture.pe.vtables.windowSecondary)), '.?AVCCharacterWindow@@');
  assert.deepEqual(layout.idOffsets, [0xc8, 0xf8]);
  assert.equal(layout.dnaOffset, 0x160);
  assert.equal(await resolver.keywordToken('dna'), 0x500);
  assert.equal(await resolver.findStatic('.?AVCInGameInterfaceIdler@@'), RVA.data);
  assert.equal(await resolver.findStatic('.?AV?$TPdxRefDatabase@VCCharacter@@$07@@'), RVA.data + 8);
  const ambiguous = liveFixture();
  ambiguous.pe.buffer.writeBigUInt64LE(0x5000000n, 0x7400 + 0x20);
  const ambiguousResolver = new Ck3LayoutResolver(ambiguous.pe.buffer, BASE, (address, size) => ambiguous.process.read(ambiguous.process.open(1, 'fixture', false).handle, address, size));
  await assert.rejects(ambiguousResolver.findStatic('.?AVCInGameInterfaceIdler@@'), /ambiguous/);
  const noDna = liveFixture();
  noDna.pe.buffer.writeUInt32LE(0x501, 0x1400 + 0x2000 + 10 * 16);
  const unresolved = new Ck3LayoutResolver(noDna.pe.buffer, BASE, (address, size) => noDna.process.read(noDna.process.open(1, 'fixture', false).handle, address, size));
  await assert.rejects(unresolved.resolve(), /DNA field|save token/);

  fixture.process.closeAll();
  const accessCountBeforeDisabled = fixture.process.openCalls.length;
  const engine = new LiveGameEngine({ process: fixture.process, readFile: async () => fixture.pe.buffer, now: () => 10_000 });
  engine.loadCatalog = async () => fixture.catalog;
  await assert.rejects(engine.import(fixture.game), /turned off/);
  assert.equal(fixture.process.openCalls.length, accessCountBeforeDisabled, 'Disabled Live Game Link performs no process access.');
  await engine.setEnabled(true);
  assert.equal(fixture.process.openCalls.length, accessCountBeforeDisabled, 'Opt-in alone does not access a game process.');
  const imported = await engine.import(fixture.game);
  assert.match(imported.dna, /ruler_designer_live=/);
  assert.match(imported.dna, /gene_shape_19=/);
  assert.equal(imported.target.name, 'Aella');
  assert.equal(imported.target.id, 1);
  assert.equal(imported.dna.includes(fixture.process.dna().toString('base64')), false);
  assert.equal(fixture.process.handles.size, 0);
  assert.deepEqual(fixture.process.openCalls.slice(accessCountBeforeDisabled).map((call) => call.write), [false, false], 'Discovery opens read-only handles.');

  const candidateIds = liveFixture();
  const candidateEngine = new LiveGameEngine({ process: candidateIds.process, readFile: async () => candidateIds.pe.buffer });
  candidateEngine.loadCatalog = async () => candidateIds.catalog;
  await candidateEngine.setEnabled(true);
  candidateIds.process.patch(candidateIds.process.objects.window, 0xf8, 1, 4);
  assert.equal((await candidateEngine.import(candidateIds.game)).target.id, 1, 'Duplicate fields agreeing on one verified character are safe.');
  const secondCharacter = 0x5700000n;
  candidateIds.process.add(secondCharacter, Buffer.alloc(0x1000));
  candidateIds.process.pointer(secondCharacter, 0, BASE + BigInt(candidateIds.pe.vtables.character));
  candidateIds.process.patch(secondCharacter, 0x18, 2, 4);
  candidateIds.process.pointer(candidateIds.process.objects.slots, 2 * 16 + 8, secondCharacter);
  candidateIds.process.patch(candidateIds.process.objects.window, 0xf8, 2, 4);
  await assert.rejects(candidateEngine.import(candidateIds.game), /more than one possible selected character/);
  assert.equal(candidateIds.process.writeCalls.length, 0, 'Ambiguous and duplicate selection tests are read-only.');
  candidateIds.process.patch(candidateIds.process.objects.window, 0xc8, 0, 4);
  candidateIds.process.patch(candidateIds.process.objects.window, 0xf8, 0, 4);
  await assert.rejects(candidateEngine.import(candidateIds.game), /identity can be verified/);
  await candidateEngine.setEnabled(false);

  const mappedTail = liveFixture();
  const dataHeader = 0x98 + 0xf0 + 2 * 40;
  mappedTail.pe.buffer.writeUInt32LE(0x1000, dataHeader + 8);
  mappedTail.pe.buffer.writeUInt32LE(0xb00, dataHeader + 16);
  const runtimeData = Buffer.alloc(0x1000);
  const dataMemory = mappedTail.process.memory.find((entry) => entry.address === BASE + BigInt(RVA.data));
  dataMemory.data.copy(runtimeData, 0, 0, 0xb00);
  runtimeData.writeBigUInt64LE(0n, 0);
  runtimeData.writeBigUInt64LE(mappedTail.process.objects.idler, 0xe00);
  dataMemory.data = runtimeData;
  const tailResolver = new Ck3LayoutResolver(mappedTail.pe.buffer, BASE, (address, size) => {
    const opened = mappedTail.process.open(1, 'fixture', false);
    return mappedTail.process.read(opened.handle, address, size);
  });
  assert.equal(await tailResolver.findStatic('.?AVCInGameInterfaceIdler@@'), RVA.data + 0xe00, 'Singleton discovery includes the zero-initialized mapped tail.');
  assert.equal(await tailResolver.pointerRva(RVA.data + 0xe00), mappedTail.process.objects.idler, 'Pointer reads cross the file-backed boundary safely.');
  assert.equal((await tailResolver.resolve()).windowVtableRva, mappedTail.pe.vtables.window);

  const heap = liveFixture();
  heap.process.patch(BASE + BigInt(RVA.data), 0, 0, 8);
  const heapWindows = [heap.process.objects.window];
  heap.process.findVtableInstances = async (_handle, addresses) => new Map([
    [addresses[0].toString(16), heapWindows],
    [addresses[1].toString(16), [heap.process.objects.database]],
  ]);
  const heapEngine = new LiveGameEngine({ process: heap.process, readFile: async () => heap.pe.buffer });
  heapEngine.loadCatalog = async () => heap.catalog;
  await heapEngine.setEnabled(true);
  assert.equal((await heapEngine.import(heap.game)).target.id, 1, 'A fully validated heap fallback can recover the live window.');
  const staleWindow = 0x5700000n;
  heap.process.add(staleWindow, Buffer.alloc(0x1000));
  heap.process.pointer(staleWindow, 0, BASE + BigInt(heap.pe.vtables.window));
  heapWindows.push(staleWindow);
  assert.equal((await heapEngine.import(heap.game)).target.id, 1, 'A stale vtable candidate without a valid visible identity is ignored.');
  const secondWindow = 0x5800000n;
  const secondGui = 0x5900000n;
  heap.process.add(secondWindow, Buffer.alloc(0x1000));
  heap.process.add(secondGui, Buffer.alloc(0x1000));
  heap.process.pointer(secondWindow, 0, BASE + BigInt(heap.pe.vtables.window));
  heap.process.pointer(secondWindow, 0x60, secondGui);
  heap.process.patch(secondWindow, 0xc8, 1, 4);
  heap.process.pointer(secondGui, 0, BASE + BigInt(heap.pe.vtables.gui));
  heap.process.memory.find((entry) => entry.address === secondGui).data.writeFloatLE(1, 0x108);
  heapWindows.push(secondWindow);
  await assert.rejects(heapEngine.import(heap.game), /more than one possible selected character/);
  assert.equal(heap.process.writeCalls.length, 0, 'Mapped-tail and heap-fallback verification are read-only.');
  await heapEngine.setEnabled(false);

  const selection = { id: 'card-1', name: 'Archived Aella', dna: imported.dna.replace('gene_shape_0={ "shape_pos" 103', 'gene_shape_0={ "shape_pos" 211'), modified: 5 };
  const original = fixture.process.dna();
  const prepared = await engine.prepareApply(fixture.game, selection);
  assert.equal(prepared.target.name, 'Aella');
  assert.equal(prepared.report.geneCount, 24);
  assert.equal('raw' in prepared && 'base64' in prepared, false);
  const applied = await engine.confirmApply(fixture.game, prepared.token);
  assert.ok(applied.undoUntil > 10_000);
  assert.notDeepEqual(fixture.process.dna(), original);
  assert.equal(fixture.process.openCalls.at(-1).write, true);
  await engine.undoApply(fixture.game);
  assert.deepEqual(fixture.process.dna(), original);
  await assert.rejects(engine.undoApply(fixture.game), /expired/);

  const changedTarget = await engine.prepareApply(fixture.game, selection);
  fixture.process.patch(fixture.process.objects.window, 0xc8, 2, 4);
  const beforeRejectedWrite = fixture.process.writeCalls.length;
  await assert.rejects(engine.confirmApply(fixture.game, changedTarget.token), /character window|identity|character/i);
  assert.equal(fixture.process.writeCalls.length, beforeRejectedWrite, 'A target race is rejected before writing.');
  fixture.process.patch(fixture.process.objects.window, 0xc8, 1, 4);

  const changedDna = await engine.prepareApply(fixture.game, selection);
  fixture.process.patch(fixture.process.objects.dna, 0, Buffer.from([99]), 1);
  const originalChangedDna = fixture.process.dna();
  const writeCount = fixture.process.writeCalls.length;
  await assert.rejects(engine.confirmApply(fixture.game, changedDna.token), /changed after the preview/);
  assert.equal(fixture.process.writeCalls.length, writeCount);
  assert.deepEqual(fixture.process.dna(), originalChangedDna);

  const rollback = await engine.prepareApply(fixture.game, selection);
  const beforeRollback = fixture.process.dna();
  fixture.process.failNextWrite = true;
  await assert.rejects(engine.confirmApply(fixture.game, rollback.token), /original DNA was restored/);
  assert.deepEqual(fixture.process.dna(), beforeRollback, 'A partial write is rolled back and verified.');

  const sameSelection = await engine.prepareApply(fixture.game, selection);
  fixture.process.patch(fixture.process.objects.dna, 0, Buffer.from([88]), 1);
  await assert.rejects(engine.confirmApply(fixture.game, sameSelection.token), /changed after the preview/);

  assert.deepEqual(sanitizeResult('prepare-apply', { token: '123e4567-e89b-42d3-a456-426614174000', target: { id: 1, name: 'Aella' }, report: { geneCount: 24, message: 'Safe' }, raw: original }), { token: '123e4567-e89b-42d3-a456-426614174000', target: { id: 1, name: 'Aella', nameIsKey: true }, report: { geneCount: 24, catalogHash: '', excluded: [], remapped: [], message: 'Safe' } });
  await engine.setEnabled(false);
  assert.equal(fixture.process.handles.size, 0);

  const cacheDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ck3-live-layout-cache-'));
  const cachedFixture = liveFixture();
  const cachePath = path.join(cacheDirectory, 'live-layout-cache.json');
  let resolutions = 0;
  const cachedEngine = new LiveGameEngine({
    process: cachedFixture.process,
    cachePath,
    readFile: async (filename, encoding) => filename === cachedFixture.game.executablePath ? cachedFixture.pe.buffer : fs.promises.readFile(filename, encoding),
    resolverFactory: (executable, base, read) => {
      const resolver = new Ck3LayoutResolver(executable, base, read);
      const resolve = resolver.resolve.bind(resolver);
      resolver.resolve = async () => { resolutions += 1; return resolve(); };
      return resolver;
    },
  });
  cachedEngine.loadCatalog = async () => cachedFixture.catalog;
  try {
    await cachedEngine.setEnabled(true);
    await cachedEngine.import(cachedFixture.game);
    assert.equal(resolutions, 1);
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    assert.equal(cached.layout.guiOffset, 0x60);
    assert.equal(cached.layout.opacityOffset, 0x108);
    const beforeCachedImport = cachedFixture.process.openCalls.length;
    await cachedEngine.import(cachedFixture.game);
    assert.equal(cachedFixture.process.openCalls.length, beforeCachedImport + 1, 'A cached session opens only its active operation handle.');
    assert.equal(cachedFixture.process.handles.size, 0, 'Cached resolver reads use the active handle, not the closed discovery handle.');
    cachedEngine.session = null;
    await cachedEngine.import(cachedFixture.game);
    assert.equal(resolutions, 1, 'An executable-keyed disk cache avoids repeating static layout discovery.');
    for (const [index, offset] of ['guiOffset', 'opacityOffset'].entries()) {
      fs.writeFileSync(cachePath, JSON.stringify({ ...cached, layout: { ...cached.layout, [offset]: -1 } }));
      cachedEngine.session = null;
      await cachedEngine.import(cachedFixture.game);
      assert.equal(resolutions, index + 2, `Malformed cached ${offset} must trigger full discovery.`);
      assert.equal(JSON.parse(fs.readFileSync(cachePath, 'utf8')).layout[offset], cached.layout[offset]);
    }
    assert.equal(cachedFixture.process.handles.size, 0);
  } finally {
    await cachedEngine.setEnabled(false);
    fs.rmSync(cacheDirectory, { recursive: true, force: true });
  }
  console.log('Live game engine tests passed: PE/RTTI and save-field discovery, no disabled access, target-race refusal, verified writes, rollback, guarded undo, sanitized results, and safe cached sessions.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
