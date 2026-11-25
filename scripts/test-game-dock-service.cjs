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
  const cancellations = [];
  const contents = { id: 7, isDestroyed: () => false, send(channel, value) {
    if (channel === 'game-dock:cancel') cancellations.push(value);
    if (channel === 'game-dock:command') {
      commands.push(value);
      if (options.autoRespond !== false) queueMicrotask(() => service.completeRendererResult({ sender: contents, senderFrame: contents.mainFrame }, value.operationId, { ok: true }));
    }
  } };
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
    rendererCommandTimeoutMs: options.rendererCommandTimeoutMs,
  });
  service.mainWindowWebContentsId = contents.id;
  return { dock, commands, cancellations, contents, service, setClipboard(value) { clipboard = value; }, reads: () => reads };
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

  const destination = fixture();
  destination.dock.state.mode = 'draft';
  destination.dock.state.draftId = 'draft-1';
  destination.dock.state.collections = ['Court', 'Mediterranean characters'];
  destination.service.draftDna = validDna;
  const missingDestination = await destination.service.handleCommand({ operationId: 'op-missing-destination', type: 'create-record', payload: { name: 'Aella', collection: 'Deleted gallery', frame: false } });
  assert.equal(missingDestination.ok, false);
  assert.match(missingDestination.error, /no longer exists/);
  assert.equal(destination.commands.length, 0, 'A stale destination cannot create a record in the wrong gallery.');
  await destination.service.handleCommand({ operationId: 'op-chosen-destination', type: 'create-record', payload: { name: 'Aella', collection: 'Mediterranean characters', frame: false } });
  assert.equal(destination.commands[0].payload.collection, 'Mediterranean characters');
  assert.equal(destination.commands[0].payload.dna, validDna);
  destination.service.destroy();

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
    stored.service.preferences.liveLink = { decision: 'enabled', enabled: true };
    stored.service.preferencesChanged({ enabled: false, position: 'left', collection: 'Court' });
    stored.service.preferencesChanged({ enabled: false, position: 'right', collection: 'Court' });
    await stored.service.preferencesSaveQueue;
    const saved = JSON.parse(fs.readFileSync(preferencesPath, 'utf8'));
    assert.deepEqual(saved, { enabled: false, position: 'right', collection: 'Court', liveLink: { decision: 'enabled', enabled: true } }, 'Queued writes must persist the latest preferences.');

    const restarted = fixture({ preferencesPath, preferences: undefined });
    const [rendererPreferences, startupPreferences] = await Promise.all([restarted.service.loadPreferences(), restarted.service.loadPreferences()]);
    assert.deepEqual(rendererPreferences, saved, 'The renderer must wait for the saved preferences.');
    assert.deepEqual(startupPreferences, saved, 'Concurrent startup must not receive defaults while the same read is pending.');
    restarted.service.syncLiveState();
    assert.equal(restarted.dock.state.liveEnabled, true, 'The live controls must receive the saved opt-in on startup.');
    restarted.service.destroy();
    stored.service.destroy();
  } finally {
    stored.service.destroy();
    fs.rmSync(preferencesDirectory, { recursive: true, force: true });
  }
  const stalled = fixture({ autoRespond: false });
  stalled.setClipboard(validDna);
  const creating = stalled.service.handleCommand({ operationId: 'op-stalled', type: 'quick-add', payload: {} });
  assert.equal(stalled.commands.length, 1);
  stalled.dock.game = null;
  const cancelled = await stalled.service.handleCommand({ operationId: 'op-cancel', type: 'cancel-draft', payload: {} });
  assert.equal(cancelled.ok, true, 'Cancel works while a dock text field owns foreground focus.');
  assert.equal((await creating).cancelled, true, 'Cancel resolves the pending renderer mutation.');
  assert.equal(stalled.service.pendingRenderer.size, 0);
  assert.equal(stalled.service.mutation, null);
  assert.deepEqual(stalled.cancellations[0], { draftId: 'draft-1', reason: 'cancelled', operationIds: ['op-stalled'] });
  assert.equal(stalled.service.updateFromRenderer({ mode: 'framing', draftId: 'draft-1', busy: false }), false, 'Late state from a cancelled draft is ignored.');
  assert.equal(stalled.dock.state.mode, 'compact');
  assert.equal(stalled.service.completeRendererResult({ sender: stalled.contents, senderFrame: stalled.contents.mainFrame }, 'op-stalled', { ok: true }), false);
  stalled.dock.game = { hwnd: '42' };
  const newDraft = stalled.service.handleCommand({ operationId: 'op-new', type: 'quick-add', payload: {} });
  assert.equal(stalled.commands.length, 2, 'A new draft is not blocked by the retired mutation.');
  stalled.service.completeRendererResult({ sender: stalled.contents, senderFrame: stalled.contents.mainFrame }, 'op-new', { ok: true });
  assert.equal((await newDraft).ok, true);
  stalled.service.destroy();

  const capturePending = fixture({ autoRespond: false });
  capturePending.setClipboard(validDna);
  const creatingCapture = capturePending.service.handleCommand({ operationId: 'op-capture-start', type: 'quick-add', payload: {} });
  capturePending.dock.update({ mode: 'capture', capture: { state: 'starting' } });
  const cancelledCapture = await capturePending.service.handleCommand({ operationId: 'op-capture-cancel', type: 'cancel-capture', payload: {} });
  assert.equal(cancelledCapture.cancelled, true, 'The Preparing capture Cancel button aborts creation instead of being rejected as another mutation.');
  assert.equal((await creatingCapture).cancelled, true);
  assert.equal(capturePending.dock.state.mode, 'compact');
  capturePending.service.destroy();

  const framing = fixture();
  framing.dock.state.draftId = 'draft-framing';
  assert.equal(framing.service.updateCapture({ dockDraftId: 'draft-framing' }, { state: 'armed' }), true);
  assert.equal(framing.dock.state.mode, 'framing', 'Arming the stream must not replace the framing controls with recording controls.');
  assert.equal(framing.dock.state.capture, null, 'An armed stream is not an active recording.');
  assert.equal(framing.dock.state.busy, true, 'Framing stays busy until the renderer publishes a ready crop.');
  framing.service.updateFromRenderer({ draftId: 'draft-framing', mode: 'framing', busy: false, capture: null, crop: { centerX: .5, centerY: .5, size: .5 }, sourceSize: { width: 2560, height: 1440 } });
  assert.equal(framing.dock.state.busy, false);
  assert.equal(framing.dock.state.capture, null);
  framing.service.updateCapture({ dockDraftId: 'draft-framing' }, { state: 'recording', startedAt: 100 });
  assert.equal(framing.dock.state.mode, 'capture');
  assert.equal(framing.dock.state.capture.state, 'recording', 'Actual recording status still opens the recording controls.');
  framing.service.destroy();

  const timedOut = fixture({ autoRespond: false, rendererCommandTimeoutMs: 20 });
  timedOut.setClipboard(validDna);
  const timeoutResult = await timedOut.service.handleCommand({ operationId: 'op-timeout', type: 'quick-add', payload: {} });
  assert.equal(timeoutResult.ok, false);
  assert.match(timeoutResult.error, /did not finish/);
  assert.equal(timedOut.service.pendingRenderer.size, 0);
  assert.equal(timedOut.cancellations.at(-1).reason, 'timeout');
  assert.equal(timedOut.dock.state.mode, 'error');
  timedOut.service.destroy();

  const trusted = fixture({ autoRespond: false });
  trusted.setClipboard(validDna);
  const trustedCommand = trusted.service.handleCommand({ operationId: 'op-sender-trust', type: 'quick-add', payload: {} });
  assert.equal(trusted.service.completeRendererResult({ sender: { id: 999, mainFrame: trusted.contents.mainFrame }, senderFrame: trusted.contents.mainFrame }, 'op-sender-trust', { ok: true }), false, 'A foreign webContents cannot settle a renderer command.');
  assert.equal(trusted.service.completeRendererResult({ sender: trusted.contents, senderFrame: {} }, 'op-sender-trust', { ok: true }), false, 'A child frame cannot settle a renderer command.');
  assert.equal(trusted.service.pendingRenderer.has('op-sender-trust'), true);
  assert.equal(trusted.service.completeRendererResult({ sender: trusted.contents, senderFrame: trusted.contents.mainFrame }, 'op-sender-trust', { ok: true }), true);
  assert.equal((await trustedCommand).ok, true);
  trusted.service.destroy();

  blocked.service.destroy();
  valid.service.destroy();
  fast.service.destroy();
  console.log('Game dock service tests passed: clipboard scoping, forwarding, preferences, focus-independent cancellation, bounded requests, stale-result rejection, and cleanup.');
})().catch((error) => { console.error(error); process.exitCode = 1; });

function delayImmediate() { return new Promise((resolve) => setImmediate(resolve)); }
