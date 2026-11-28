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
  const gameLosses = [];
  const contents = { id: 7, isDestroyed: () => false, send(channel, value) {
    if (channel === 'game-dock:cancel') cancellations.push(value);
    if (channel === 'game-dock:game-lost') gameLosses.push(value);
    if (channel === 'game-dock:command') {
      commands.push(value);
      if (options.autoRespond !== false) queueMicrotask(() => service.completeRendererResult({ sender: contents, senderFrame: contents.mainFrame }, value.operationId, { ok: true }));
    }
  } };
  contents.mainFrame = {};
  let clipboard = '';
  let reads = 0;
  let galleryShows = 0;
  let service;
  service = new GameDockService({
    dock,
    clipboard: { readText() { reads += 1; return clipboard; } },
    getMainContents: () => contents,
    showMainWindow() { galleryShows += 1; },
    createId: (() => { let index = 0; return () => `draft-${++index}`; })(),
    ...(Object.hasOwn(options, 'preferences') ? { preferences: options.preferences } : { preferences: { enabled: true, position: 'center', collection: 'Court' } }),
    preferencesPath: options.preferencesPath || '',
    rendererCommandTimeoutMs: options.rendererCommandTimeoutMs,
  });
  service.mainWindowWebContentsId = contents.id;
  return { dock, commands, cancellations, gameLosses, contents, service, setClipboard(value) { clipboard = value; }, reads: () => reads, galleryShows: () => galleryShows };
}

(async () => {
  const validDna = Buffer.alloc(80, 65).toString('base64');
  const valid = fixture();
  const pending = valid.service.handleCommand({ operationId: 'op-1', type: 'quick-add', payload: {} });
  const duplicate = valid.service.handleCommand({ operationId: 'op-1', type: 'quick-add', payload: {} });
  assert.equal(valid.commands.length, 0, 'An empty clipboard cannot touch the archive.');
  const [invalid, duplicateInvalid] = await Promise.all([pending, duplicate]);
  assert.equal(invalid.ok, false);
  assert.equal(duplicateInvalid.ok, false);
  assert.match(invalid.error, /Copy persistent or Base64 DNA/);
  assert.equal(valid.dock.state.mode, 'compact', 'Quick Add no longer opens an empty waiting draft.');
  assert.equal(valid.dock.state.draftId, '');
  assert.equal(valid.reads(), 1, 'Duplicate physical commands share one clipboard read.');

  valid.dock.state.visible = true;
  valid.setClipboard('unrelated clipboard text');
  valid.service.syncQuickAddClipboard();
  assert.equal(valid.dock.state.quickAddReady, false);
  valid.setClipboard(validDna);
  valid.service.syncQuickAddClipboard();
  assert.equal(valid.dock.state.quickAddReady, true, 'Base64 DNA enables Quick Add.');
  valid.setClipboard('genes = { hair_color = { index = 1 } }');
  valid.service.syncQuickAddClipboard();
  assert.equal(valid.dock.state.quickAddReady, true, 'Persistent DNA enables Quick Add.');
  valid.setClipboard('unrelated clipboard text');
  valid.service.syncQuickAddClipboard();
  assert.equal(valid.dock.state.quickAddReady, false, 'Removing eligible DNA disables Quick Add again.');
  const hiddenReads = valid.reads();
  valid.dock.state.visible = false;
  valid.service.syncQuickAddClipboard();
  assert.equal(valid.reads(), hiddenReads, 'A hidden dock performs no Quick Add clipboard read.');
  valid.dock.state.visible = true;

  valid.dock.state.mode = 'draft';
  valid.dock.state.draftId = 'draft-1';
  valid.dock.state.dnaReady = true;
  valid.service.draftDna = validDna;
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
  const staged = await fast.service.handleCommand({ operationId: 'op-fast', type: 'quick-add', payload: {} });
  assert.equal(staged.ok, true);
  assert.equal(fast.commands.length, 0, 'Quick Add stages DNA without immediately creating an archive record.');
  assert.equal(fast.dock.state.mode, 'draft');
  assert.equal(fast.dock.state.characterName, '', 'The dock draft starts with an editable name.');
  await fast.service.handleCommand({ operationId: 'op-fast-cancel', type: 'cancel-draft', payload: {} });
  assert.equal(fast.commands.length, 0, 'Cancelling a staged Quick Add cannot touch the archive.');
  assert.equal(fast.dock.state.mode, 'compact');
  await fast.service.handleCommand({ operationId: 'op-fast-named-draft', type: 'quick-add', payload: {} });
  await fast.service.handleCommand({ operationId: 'op-fast-create', type: 'create-record', payload: { name: 'Ragnhild of Jorvik', frame: true } });
  assert.equal(fast.commands.length, 1, 'Only the explicit create action reaches the archive.');
  assert.equal(fast.commands[0].payload.name, 'Ragnhild of Jorvik', 'The inline dock name is used for creation.');
  assert.equal(fast.commands[0].payload.dna, validDna);
  assert.equal(fast.commands[0].payload.draftId, 'draft-2');
  assert.equal(fast.service.validateGameHwnd('42'), '42');
  assert.deepEqual(fast.service.validateCaptureContext({ dockDraftId: 'draft-2', gameHwnd: '42' }), { dockDraftId: 'draft-2', gameHwnd: '42' });
  assert.equal(fast.service.validateCaptureContext(), null);
  assert.throws(() => fast.service.validateCaptureContext({ dockDraftId: 'old-draft', gameHwnd: '42' }), /no longer active/);
  assert.throws(() => fast.service.validateGameHwnd('99'), /window has changed/);

  const discarded = fixture();
  discarded.setClipboard(validDna);
  await discarded.service.handleCommand({ operationId: 'op-discard-stage', type: 'quick-add', payload: {} });
  await discarded.service.handleCommand({ operationId: 'op-discard-close', type: 'discard-draft', payload: {} });
  assert.equal(discarded.commands.length, 0, 'Closing a staged draft never forwards a create command.');
  assert.deepEqual(discarded.cancellations[0], { draftId: 'draft-1', reason: 'discard', operationIds: [] });
  assert.equal(discarded.dock.state.mode, 'compact');
  discarded.service.destroy();

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

  const undoDeadline = fixture();
  Object.assign(undoDeadline.dock.state, { mode: 'success', draftId: 'draft-deadline', undoUntil: 123456 });
  await undoDeadline.service.handleCommand({ operationId: 'op-undo-deadline', type: 'undo-create', payload: { draftId: 'draft-deadline', undoUntil: 1 } });
  assert.equal(undoDeadline.commands.at(-1).payload.undoUntil, 123456, 'Undo forwards the dock’s authoritative capture-service deadline.');
  undoDeadline.service.destroy();

  const blocked = fixture();
  blocked.dock.game = null;
  const response = await blocked.service.handleCommand({ operationId: 'op-hidden', type: 'quick-add', payload: {} });
  assert.equal(response.ok, false);
  assert.equal(blocked.commands.length, 0);
  Object.assign(blocked.dock.state, { mode: 'framing', draftId: 'draft-1' });
  blocked.dock.editing = true;
  blocked.dock.window = { isFocused: () => true };
  const editingLoopSearch = await blocked.service.handleCommand({ operationId: 'op-loop-search-editing', type: 'set-loop-search', payload: { draftId: 'draft-1', seconds: 7 } });
  assert.equal(editingLoopSearch.ok, true, 'The duration remains editable while the dock owns temporary text-input focus.');
  assert.equal(blocked.commands.at(-1).type, 'set-loop-search');
  assert.equal(blocked.commands.at(-1).payload.seconds, 7);
  blocked.dock.window.isFocused = () => false;
  const unfocusedLoopSearch = await blocked.service.handleCommand({ operationId: 'op-loop-search-unfocused', type: 'set-loop-search', payload: { draftId: 'draft-1', seconds: 8 } });
  assert.equal(unfocusedLoopSearch.ok, false, 'The editing exception ends when the dock loses focus.');
  assert.match(unfocusedLoopSearch.error, /foreground/);
  blocked.service.destroy();
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
  await stalled.service.handleCommand({ operationId: 'op-stalled-stage', type: 'quick-add', payload: {} });
  const creating = stalled.service.handleCommand({ operationId: 'op-stalled', type: 'create-record', payload: { name: 'Test', frame: true } });
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
  await stalled.service.handleCommand({ operationId: 'op-new-stage', type: 'quick-add', payload: {} });
  assert.equal(stalled.commands.length, 1, 'A replacement Quick Add draft does not itself create a record.');
  const newDraft = stalled.service.handleCommand({ operationId: 'op-new', type: 'create-record', payload: { name: 'Test', frame: true } });
  assert.equal(stalled.commands.length, 2, 'A new create action is not blocked by the retired mutation.');
  stalled.service.completeRendererResult({ sender: stalled.contents, senderFrame: stalled.contents.mainFrame }, 'op-new', { ok: true });
  assert.equal((await newDraft).ok, true);
  stalled.service.destroy();

  const capturePending = fixture({ autoRespond: false });
  capturePending.setClipboard(validDna);
  await capturePending.service.handleCommand({ operationId: 'op-capture-stage', type: 'quick-add', payload: {} });
  const creatingCapture = capturePending.service.handleCommand({ operationId: 'op-capture-start', type: 'create-record', payload: { name: 'Capture', frame: true } });
  capturePending.dock.update({ mode: 'capture', capture: { state: 'starting' } });
  const cancelledCapture = await capturePending.service.handleCommand({ operationId: 'op-capture-cancel', type: 'cancel-capture', payload: {} });
  assert.equal(cancelledCapture.cancelled, true, 'The Preparing capture Cancel button aborts creation instead of being rejected as another mutation.');
  assert.equal((await creatingCapture).cancelled, true);
  assert.equal(capturePending.dock.state.mode, 'compact');
  capturePending.service.destroy();

  const captureSaved = fixture({ autoRespond: false });
  captureSaved.setClipboard(validDna);
  await captureSaved.service.handleCommand({ operationId: 'op-saved-stage', type: 'quick-add', payload: {} });
  const savingCapture = captureSaved.service.handleCommand({ operationId: 'op-saved-create', type: 'create-record', payload: { name: 'Capture', frame: true } });
  captureSaved.dock.update({ mode: 'capture', characterId: 'character-1', capture: { state: 'recording', startedAt: 1 } });
  const cancelledSaved = await captureSaved.service.handleCommand({ operationId: 'op-saved-cancel', type: 'cancel-capture', payload: {} });
  assert.equal(cancelledSaved.cancelled, true);
  assert.equal((await savingCapture).cancelled, true, 'The in-flight save settles as cancelled.');
  assert.equal(captureSaved.dock.state.mode, 'success', 'Cancelling with a saved character lands on the same confirmation panel as a quiet cancel.');
  assert.match(captureSaved.dock.state.message, /Capture cancelled/);
  assert.equal(captureSaved.dock.state.characterId, 'character-1', 'Cancellation no longer drops the draft identity.');
  assert.equal(captureSaved.dock.state.draftId, 'draft-1', 'The draft identity survives cancellation.');
  assert.ok(captureSaved.dock.state.undoUntil > Date.now(), 'The Undo window is published.');
  captureSaved.service.destroy();

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
  await timedOut.service.handleCommand({ operationId: 'op-timeout-stage', type: 'quick-add', payload: {} });
  const timeoutResult = await timedOut.service.handleCommand({ operationId: 'op-timeout', type: 'create-record', payload: { name: 'Timeout', frame: true } });
  assert.equal(timeoutResult.ok, false);
  assert.match(timeoutResult.error, /did not finish/);
  assert.equal(timedOut.service.pendingRenderer.size, 0);
  assert.equal(timedOut.cancellations.at(-1).reason, 'timeout');
  assert.equal(timedOut.dock.state.mode, 'error');
  timedOut.service.destroy();

  const trusted = fixture({ autoRespond: false });
  trusted.setClipboard(validDna);
  await trusted.service.handleCommand({ operationId: 'op-sender-stage', type: 'quick-add', payload: {} });
  const trustedCommand = trusted.service.handleCommand({ operationId: 'op-sender-trust', type: 'create-record', payload: { name: 'Trusted', frame: true } });
  assert.equal(trusted.service.completeRendererResult({ sender: { id: 999, mainFrame: trusted.contents.mainFrame }, senderFrame: trusted.contents.mainFrame }, 'op-sender-trust', { ok: true }), false, 'A foreign webContents cannot settle a renderer command.');
  assert.equal(trusted.service.completeRendererResult({ sender: trusted.contents, senderFrame: {} }, 'op-sender-trust', { ok: true }), false, 'A child frame cannot settle a renderer command.');
  assert.equal(trusted.service.pendingRenderer.has('op-sender-trust'), true);
  assert.equal(trusted.service.completeRendererResult({ sender: trusted.contents, senderFrame: trusted.contents.mainFrame }, 'op-sender-trust', { ok: true }), true);
  assert.equal((await trustedCommand).ok, true);
  trusted.service.destroy();

  const focusReturn = fixture();
  focusReturn.dock.state.mode = 'success';
  focusReturn.dock.state.draftId = 'draft-saved';
  focusReturn.service.notifyGameLoss();
  assert.equal(focusReturn.gameLosses.length, 0, 'View in gallery must not turn a completed save into a foreground-loss error.');
  focusReturn.dock.state.mode = 'framing';
  focusReturn.service.notifyGameLoss();
  assert.deepEqual(focusReturn.gameLosses, [{ draftId: 'draft-saved', operationIds: [] }], 'An unsaved in-progress capture still receives game-loss handling.');
  focusReturn.service.destroy();

  const viewGallery = fixture();
  Object.assign(viewGallery.dock.state, {
    mode: 'success', draftId: 'draft-saved', characterId: 'character-saved', characterName: 'Aella',
    dnaReady: true, dnaAttached: true, undoUntil: Date.now() + 12_000,
    liveUndoUntil: Date.now() + 18_000, liveApplyId: 'live-apply-saved',
  });
  viewGallery.service.draftDna = validDna;
  const viewed = await viewGallery.service.handleCommand({ operationId: 'op-view-gallery', type: 'view-gallery', payload: {} });
  assert.equal(viewed.ok, true);
  assert.equal(viewGallery.galleryShows(), 1, 'View in gallery still brings the main window forward.');
  assert.equal(viewGallery.commands.at(-1).type, 'view-gallery');
  assert.equal(viewGallery.commands.at(-1).payload.draftId, 'draft-saved');
  assert.equal(viewGallery.dock.state.mode, 'compact', 'View in gallery confirms the saved draft like Done.');
  assert.equal(viewGallery.dock.state.draftId, null);
  assert.equal(viewGallery.dock.state.characterId, null);
  assert.equal(viewGallery.dock.state.characterName, '');
  assert.equal(viewGallery.dock.state.dnaReady, false);
  assert.equal(viewGallery.dock.state.undoUntil, 0);
  assert.equal(viewGallery.dock.state.liveUndoUntil, 0);
  assert.equal(viewGallery.dock.state.liveApplyId, '');
  assert.equal(viewGallery.service.draftDna, '');
  assert.deepEqual(viewGallery.cancellations, [{ draftId: 'draft-saved', reason: 'cancelled', operationIds: [] }], 'The confirmed draft is cleared in the renderer too.');
  viewGallery.service.destroy();

  const failedView = fixture({ autoRespond: false });
  Object.assign(failedView.dock.state, { mode: 'success', draftId: 'draft-saved', characterId: 'character-saved' });
  const failedViewCommand = failedView.service.handleCommand({ operationId: 'op-view-failed', type: 'view-gallery', payload: {} });
  assert.equal(failedView.commands.length, 1);
  failedView.service.completeRendererResult({ sender: failedView.contents, senderFrame: failedView.contents.mainFrame }, 'op-view-failed', { ok: false, error: 'Finish the open gallery editor first.' });
  assert.equal((await failedViewCommand).ok, false);
  assert.equal(failedView.dock.state.mode, 'error');
  assert.equal(failedView.dock.state.draftId, 'draft-saved', 'A failed gallery action must not clear the saved draft.');
  assert.equal(failedView.dock.state.characterId, 'character-saved');
  assert.equal(failedView.cancellations.length, 0);
  failedView.service.destroy();

  blocked.service.destroy();
  valid.service.destroy();
  fast.service.destroy();
  console.log('Game dock service tests passed: clipboard scoping, forwarding, preferences, focus-independent cancellation, saved-character capture cancel, bounded requests, stale-result rejection, and cleanup.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
