const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { GameDockService } = require('../electron/game-dock-service.cjs');

function fixture(options = {}) {
  const dock = {
    state: { mode: 'compact', collections: ['Court'], collection: 'Court', draftId: '', characterId: '' },
    game: { hwnd: '42' }, preferences: { enabled: true, position: 'center', collection: 'Court' },
    updates: [], start: () => true, destroy() {}, startCalls: 0,
    update(patch) { this.updates.push(patch); Object.assign(this.state, patch); },
    setPreferences(patch) { Object.assign(this.preferences, patch); },
    setLibrary(names) { this.state.collections = names; },
    setEnabled(value) { this.preferences.enabled = value; },
  };
  const commands = [];
  const contents = { id: 7, isDestroyed: () => false, send(channel, value) { if (channel === 'game-dock:command') { commands.push(value); queueMicrotask(() => service.completeRendererResult({ sender: contents, senderFrame: contents.mainFrame }, value.operationId, { ok: true })); } } };
  contents.mainFrame = {};
  let clipboard = '';
  let reads = 0;
  let service;
  service = new GameDockService({
    dock,
    clipboard: { readText() { reads += 1; return clipboard; } },
    getMainContents: () => contents,
    createId: (() => { let index = 0; return () => `draft-${++index}`; })(),
    ...(Object.hasOwn(options, 'preferences') ? { preferences: options.preferences } : { preferences: { enabled: true, position: 'center', collection: 'Court' } }),
    preferencesPath: options.preferencesPath || '',
  });
  service.mainWindowWebContentsId = contents.id;
  return { dock, commands, contents, service, setClipboard(value) { clipboard = value; }, reads: () => reads };
}

(async () => {
  const validDna = Buffer.alloc(80, 65).toString('base64');
  const valid = fixture();
  const pending = valid.service.handleCommand({ operationId: 'op-1', type: 'quick-add', payload: {} });
  const duplicate = valid.service.handleCommand({ operationId: 'op-1', type: 'quick-add', payload: {} });
  assert.equal(valid.commands.length, 0, 'Invalid clipboard opens a draft locally without touching the archive.');
  await Promise.all([pending, duplicate]);
  assert.equal(valid.dock.state.mode, 'draft');
  assert.equal(valid.dock.state.draftId, 'draft-1');

  valid.service.setDraftActive(false);
  assert.equal(valid.reads(), 1);
  valid.setClipboard('unrelated clipboard text');
  valid.service.setDraftActive(true);
  await delayImmediate();
  assert.equal(valid.dock.state.dnaReady, false);
  assert.equal(valid.dock.state.message.includes('valid CK3 DNA'), false, 'Unrelated clipboard content is never shown in the dock.');
  valid.service.setDraftActive(false);
  const stoppedReads = valid.reads();
  await valid.service.checkClipboard();
  assert.equal(valid.reads(), stoppedReads, 'Clipboard checks stop when the draft is hidden.');

  valid.setClipboard(validDna);
  valid.service.setDraftActive(true);
  await delayImmediate();
  assert.equal(valid.dock.state.dnaReady, true);
  await valid.service.handleCommand({ operationId: 'op-2', type: 'create-record', payload: { name: 'Ragnhild', frame: true } });
  assert.equal(valid.commands.length, 1);
  assert.equal(valid.commands[0].payload.dna, validDna);
  assert.equal(valid.commands[0].payload.collection, 'Court');
  assert.equal(valid.commands[0].payload.gameHwnd, '42');
  assert.equal(valid.commands[0].payload.draftId, 'draft-1');
  assert.equal(valid.service.draftDna, '', 'Draft DNA is cleared after the create command completes.');
  await valid.service.handleCommand({ operationId: 'op-3', type: 'cancel-draft', payload: {} });

  const fast = fixture();
  fast.setClipboard(validDna);
  await fast.service.handleCommand({ operationId: 'op-fast', type: 'quick-add', payload: {} });
  assert.equal(fast.commands.length, 1, 'Already copied DNA uses the immediate creation path.');
  assert.equal(fast.commands[0].payload.dna, validDna);
  assert.equal(fast.commands[0].payload.draftId, 'draft-1');
  fast.dock.state.draftId = 'draft-1';
  assert.equal(fast.service.validateGameHwnd('42'), '42');
  assert.deepEqual(fast.service.validateCaptureContext({ dockDraftId: 'draft-1', gameHwnd: '42' }), { dockDraftId: 'draft-1', gameHwnd: '42' });
  assert.equal(fast.service.validateCaptureContext(), null);
  assert.throws(() => fast.service.validateCaptureContext({ dockDraftId: 'old-draft', gameHwnd: '42' }), /no longer active/);
  assert.throws(() => fast.service.validateGameHwnd('99'), /window has changed/);

  const blocked = fixture();
  blocked.dock.game = null;
  const response = await blocked.service.handleCommand({ operationId: 'op-hidden', type: 'quick-add', payload: {} });
  assert.equal(response.ok, false);
  assert.equal(blocked.commands.length, 0);
  const preferencesDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ck3-dock-preferences-'));
  const preferencesPath = path.join(preferencesDirectory, 'ui-settings.json');
  const stored = fixture({ preferencesPath });
  try {
    await stored.service.loadPreferences();
    stored.service.preferencesChanged({ enabled: false, position: 'left', collection: 'Court' });
    stored.service.preferencesChanged({ enabled: false, position: 'right', collection: 'Court' });
    await stored.service.preferencesSaveQueue;
    const saved = JSON.parse(fs.readFileSync(preferencesPath, 'utf8'));
    assert.deepEqual(saved, { enabled: false, position: 'right', collection: 'Court' }, 'Queued writes must persist the latest preferences.');

    const restarted = fixture({ preferencesPath, preferences: undefined });
    await restarted.service.loadPreferences();
    assert.deepEqual(restarted.service.preferences, saved, 'A restart must load the saved dock preferences.');
    restarted.service.destroy();
    stored.service.destroy();
  } finally {
    stored.service.destroy();
    fs.rmSync(preferencesDirectory, { recursive: true, force: true });
  }
  blocked.service.destroy();
  valid.service.destroy();
  fast.service.destroy();
  console.log('Game dock service tests passed: scoped clipboard access, fast quick-add, draft continuity, trusted forwarding, queued preferences, restart loading, and cleanup.');
})().catch((error) => { console.error(error); process.exitCode = 1; });

function delayImmediate() { return new Promise((resolve) => setImmediate(resolve)); }
