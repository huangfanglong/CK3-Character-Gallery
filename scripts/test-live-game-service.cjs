const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { GameDockService } = require('../electron/game-dock-service.cjs');
const { liveFixture } = require('./live-game-fixture.cjs');

function fixture(preferencesPath = '', preferences = { enabled: true, position: 'center', collection: 'Court', liveLink: { decision: 'undecided', enabled: false } }, loadSaved = false) {
  const dock = {
    state: { mode: 'compact', collections: ['Court'], collection: 'Court' },
    game: { hwnd: '42', processId: 42, executable: 'ck3.exe', executablePath: 'C:\\fixture\\ck3.exe' },
    update(patch) { Object.assign(this.state, patch); }, setEnabled() {}, destroy() {}, setLibrary() {}, start() { return true; },
  };
  const dna = liveFixture().process.persistentDna();
  const bridge = {
    calls: [], enabled: false, failImport: false, failNextEnable: false, pendingImport: null, pendingPrepare: null, undoDelay: 20_000,
    async setEnabled(value) {
      this.calls.push(['enabled', value]);
      if (value && this.failNextEnable) {
        this.failNextEnable = false;
        this.enabled = false;
        throw new Error('Synthetic worker startup failure.');
      }
      this.enabled = value;
      return value;
    },
    async detect() {
      this.calls.push(['detect']);
      if (!this.enabled) throw new Error('Live Game Link is turned off.');
      if (this.targetClosed) throw new Error('The CK3 character window is closed.');
      return { target: { id: 1, name: 'Aella', nameIsKey: true } };
    },
    async import() {
      this.calls.push(['import']);
      if (!this.enabled) throw new Error('Live Game Link is turned off.');
      if (this.pendingImport) return this.pendingImport;
      if (this.failImport) { this.failImport = false; throw new Error('Layout unavailable.'); }
      return { dna, target: { id: 1, name: 'Aella', nameIsKey: true }, geneCount: 24 };
    },
    async prepareApply(_game, selection) {
      this.calls.push(['prepare', selection]);
      if (this.pendingPrepare) await this.pendingPrepare;
      return { token: '123e4567-e89b-42d3-a456-426614174000', target: { id: 1, name: 'Aella', nameIsKey: true }, report: { geneCount: 24, message: '24 genes mapped. Special appearance entries excluded.' } };
    },
    async confirmApply() { this.calls.push(['confirm']); return { target: { id: 1, name: 'Aella' }, undoUntil: Date.now() + this.undoDelay, report: { geneCount: 24, message: '24 genes mapped.' } }; },
    async undo() { this.calls.push(['undo']); return { target: { id: 1, name: 'Aella' } }; },
    async cancel() { this.calls.push(['cancel']); return true; }, async close() {},
  };
  let service;
  const contents = { id: 7, mainFrame: {}, isDestroyed: () => false, send(channel, value) {
    if (channel === 'game-dock:command') queueMicrotask(() => service.completeRendererResult({ sender: contents, senderFrame: contents.mainFrame }, value.operationId, { ok: true }));
  } };
  const options = loadSaved ? {} : { preferences };
  let clipboardText = '';
  service = new GameDockService({ dock, liveBridge: bridge, preferencesPath, clipboard: { readText: () => clipboardText }, getMainContents: () => contents, createId: () => 'draft-live', ...options });
  service.mainWindowWebContentsId = contents.id;
  return { dock, bridge, service, dna, setClipboard(value) { clipboardText = value; } };
}

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ck3-live-service-'));
  const preferencesPath = path.join(directory, 'ui-settings.json');
  const app = fixture(preferencesPath);
  try {
    await app.service.setLiveLinkChoice(false);
    assert.deepEqual(JSON.parse(fs.readFileSync(preferencesPath, 'utf8')).liveLink, { decision: 'declined', enabled: false });
    const remembered = fixture(preferencesPath, undefined, true);
    assert.equal(remembered.service.preferencesLoaded, false, 'The restart fixture must not preload preferences.');
    await remembered.service.loadPreferences();
    assert.deepEqual(remembered.service.preferences.liveLink, { decision: 'declined', enabled: false });
    assert.equal(remembered.bridge.enabled, false);
    const blocked = await app.service.handleCommand({ operationId: 'blocked', type: 'live-import', payload: {} });
    assert.equal(blocked.ok, false);
    assert.equal(app.bridge.calls.some(([action]) => action === 'import'), false);

    await app.service.setLiveLinkChoice(true);
    assert.equal(app.bridge.enabled, true);
    assert.equal(app.bridge.calls.some(([action]) => action === 'import'), false, 'Consent alone performs no game access.');
    assert.equal(app.bridge.calls.some(([action]) => action === 'detect'), false, 'Consent alone does not probe a game process.');

    app.service.serviceStarted = true;
    app.dock.state.mode = 'compact';
    app.dock.state.liveRetry = false;
    app.dock.state.error = '';
    app.dock.state.visible = true;
    app.dock.state.connected = true;
    assert.equal(await app.service.refreshLiveTarget(), true);
    assert.equal(app.dock.state.liveTargetAvailable, true);
    assert.equal(app.dock.state.liveDetectedName, 'Aella');
    app.bridge.targetClosed = true;
    assert.equal(await app.service.refreshLiveTarget(), false);
    assert.equal(app.dock.state.liveTargetAvailable, false, 'A closed character window disables live actions without opening an error.');
    assert.equal(app.dock.state.mode, 'compact');
    assert.equal(app.dock.state.error || '', '');
    const hiddenDetections = app.bridge.calls.filter(([action]) => action === 'detect').length;
    app.dock.state.visible = false;
    assert.equal(await app.service.refreshLiveTarget(), false);
    assert.equal(app.bridge.calls.filter(([action]) => action === 'detect').length, hiddenDetections, 'A hidden dock performs no game detection.');
    app.dock.state.visible = true;
    app.bridge.targetClosed = false;
    assert.equal(await app.service.refreshLiveTarget(), true, 'Detection recovers when the character window reopens.');
    app.service.serviceStarted = false;
    app.service.syncLiveTargetPolling();
    assert.equal(app.dock.state.liveTargetAvailable, false);

    app.bridge.failImport = true;
    assert.equal((await app.service.handleCommand({ operationId: 'import-fail', type: 'live-import', payload: {} })).ok, false);
    assert.equal(app.dock.state.liveRetry, true);
    assert.equal((await app.service.handleCommand({ operationId: 'import-retry', type: 'live-retry', payload: {} })).ok, true);
    assert.equal(app.dock.state.mode, 'draft');
    assert.equal(app.dock.state.liveImported, true);
    assert.equal(app.service.draftDna, app.dna);
    assert.match(app.dock.state.message, /persistent DNA/);
    await app.service.handleCommand({ operationId: 'cancel-import', type: 'cancel-draft', payload: {} });

    app.service.syncSelection({ id: 'card-1', name: 'Archived Aella', modified: 5, dna: app.dna });
    assert.equal(app.dock.state.liveCanApply, true);
    assert.equal(app.dock.state.liveSelectedName, 'Archived Aella');
    let resolveGalleryPrepare;
    app.bridge.pendingPrepare = new Promise((resolve) => { resolveGalleryPrepare = resolve; });
    const staleGalleryApply = app.service.handleCommand({ operationId: 'prepare-stale', type: 'live-prepare-apply', payload: {} });
    await new Promise((resolve) => setImmediate(resolve));
    app.service.syncSelection({ id: 'card-1', name: 'Archived Aella', modified: 6, dna: app.dna });
    assert.equal(app.dock.state.mode, 'compact');
    assert.equal(app.service.liveApply, null);
    resolveGalleryPrepare();
    app.bridge.pendingPrepare = null;
    const staleGallery = await staleGalleryApply;
    assert.equal(staleGallery.ok, false);
    assert.match(staleGallery.error, /gallery selection changed/);
    assert.equal(app.bridge.calls.some(([action]) => action === 'confirm'), false, 'Selection changes invalidate the internal apply preview before writing.');
    await app.service.handleCommand({ operationId: 'cancel-stale-gallery', type: 'live-cancel', payload: {} });

    const applied = await app.service.handleCommand({ operationId: 'apply', type: 'live-prepare-apply', payload: {} });
    assert.equal(applied.ok, true);
    assert.equal(app.dock.state.mode, 'compact', 'Apply leaves Import and Apply available in the normal dock.');
    assert.ok(app.dock.state.liveUndoUntil > Date.now());
    assert.equal(app.dock.state.liveApplyId, 'apply');
    assert.equal(app.bridge.calls.filter(([action]) => action === 'confirm').length, 1, 'One Apply click performs the internal confirmed write.');
    const firstUndoDeadline = app.dock.state.liveUndoUntil;
    const nextApplied = await app.service.handleCommand({ operationId: 'apply-next', type: 'live-prepare-apply', payload: {} });
    assert.equal(nextApplied.ok, true, 'A second Apply is accepted during the first Undo period.');
    assert.equal(app.dock.state.mode, 'compact');
    assert.equal(app.dock.state.liveApplyId, 'apply-next', 'Only the latest Apply retains an Undo identity.');
    assert.ok(app.dock.state.liveUndoUntil >= firstUndoDeadline, 'The latest Apply resets the Undo deadline.');
    assert.equal(app.bridge.calls.filter(([action]) => action === 'confirm').length, 2);
    await app.service.handleCommand({ operationId: 'undo', type: 'live-undo', payload: {} });
    assert.equal(app.dock.state.mode, 'compact', 'Undo returns to the normal dock without a redundant completion panel.');
    assert.equal(app.dock.state.liveUndoUntil, 0);
    assert.equal(app.dock.state.liveApplyId, '');
    assert.equal(app.dock.state.message, '');

    app.service.syncSelection(null);
    app.setClipboard(app.dna);
    app.service.syncClipboardDna(true);
    assert.equal(app.dock.state.liveSelectedName, '');
    assert.equal(app.dock.state.liveCanApply, true, 'Persistent clipboard DNA enables Apply without a gallery selection.');
    assert.equal(app.dock.state.liveApplySource, 'clipboard');
    assert.equal(app.dock.state.liveClipboardFormat, 'persistent');
    let resolveClipboardPrepare;
    app.bridge.pendingPrepare = new Promise((resolve) => { resolveClipboardPrepare = resolve; });
    const persistentApply = app.service.handleCommand({ operationId: 'apply-persistent-clipboard', type: 'live-prepare-apply', payload: {} });
    await new Promise((resolve) => setImmediate(resolve));
    const persistentSource = app.bridge.calls.filter(([action]) => action === 'prepare').at(-1)[1];
    assert.equal(persistentSource.id, 'clipboard');
    assert.equal(persistentSource.name, 'Persistent clipboard DNA');
    assert.equal(persistentSource.dna, app.dna);
    const changedClipboard = app.dna.replace('gene_shape_0={ "shape_pos" 103', 'gene_shape_0={ "shape_pos" 104');
    assert.notEqual(changedClipboard, app.dna);
    app.setClipboard(changedClipboard);
    const confirmCount = app.bridge.calls.filter(([action]) => action === 'confirm').length;
    resolveClipboardPrepare();
    app.bridge.pendingPrepare = null;
    const staleClipboard = await persistentApply;
    assert.equal(staleClipboard.ok, false);
    assert.match(staleClipboard.error, /clipboard DNA changed/);
    assert.equal(app.bridge.calls.filter(([action]) => action === 'confirm').length, confirmCount, 'Changed clipboard DNA is refused before the fixture write.');
    await app.service.handleCommand({ operationId: 'cancel-stale-clipboard', type: 'live-cancel', payload: {} });

    app.setClipboard(liveFixture().process.dna().toString('base64'));
    app.service.syncClipboardDna(true);
    assert.equal(app.dock.state.liveClipboardFormat, 'base64');
    assert.equal(app.dock.state.liveCanApply, true, 'Base64 clipboard DNA enables Apply without a gallery selection.');
    const base64Applied = await app.service.handleCommand({ operationId: 'apply-base64-clipboard', type: 'live-prepare-apply', payload: {} });
    assert.equal(base64Applied.ok, true);
    const base64Source = app.bridge.calls.filter(([action]) => action === 'prepare').at(-1)[1];
    assert.equal(base64Source.id, 'clipboard');
    assert.equal(base64Source.name, 'Base64 clipboard DNA');
    assert.equal(app.dock.state.mode, 'compact');
    assert.equal(app.dock.state.liveApplyId, 'apply-base64-clipboard');
    await app.service.handleCommand({ operationId: 'cancel-base64-result', type: 'live-cancel', payload: {} });
    app.setClipboard('');
    app.service.syncClipboardDna(true);

    app.service.syncSelection({ id: 'card-1', name: 'Archived Aella', modified: 6, dna: Buffer.alloc(80, 65).toString('base64') });
    assert.equal(app.service.selection, null);
    assert.equal(app.dock.state.liveCanApply, false, 'Manual Base64 records do not become live apply inputs.');
    app.service.preferencesChanged({ enabled: false, position: 'right', collection: 'Court', liveLink: { decision: 'undecided', enabled: false } });
    assert.deepEqual(app.service.preferences.liveLink, { decision: 'enabled', enabled: true }, 'Dock preference callbacks cannot restore a stale consent decision.');
    assert.equal(app.dock.state.liveEnabled, true);
    await app.service.setLiveLinkEnabled(false);
    assert.equal(app.bridge.enabled, false);
    assert.equal(app.service.preferences.liveLink.decision, 'enabled', 'Turning the feature off preserves the first-run decision.');
    assert.equal((await app.service.handleCommand({ operationId: 'disabled-again', type: 'live-prepare-apply', payload: {} })).ok, false);

    const recovering = fixture('', { enabled: true, position: 'center', collection: 'Court', liveLink: { decision: 'enabled', enabled: true } });
    try {
      recovering.bridge.failNextEnable = true;
      await recovering.service.start();
      assert.equal(recovering.bridge.enabled, false, 'The startup failure disables the worker, not the saved preference.');
      const imported = await recovering.service.handleCommand({ operationId: 'recover-import', type: 'live-import', payload: {} });
      assert.equal(imported.ok, true, 'Import retries a failed worker startup instead of reporting that the enabled preference is off.');
      assert.equal(recovering.dock.state.mode, 'draft');
      assert.equal(recovering.bridge.calls.filter(([action, value]) => action === 'enabled' && value).length, 2);
    } finally { recovering.service.destroy(); }

    const stalled = fixture('', { enabled: true, position: 'center', collection: 'Court', liveLink: { decision: 'enabled', enabled: true } });
    let rejectImport;
    let importing;
    try {
      await stalled.service.setLiveLinkChoice(true);
      stalled.bridge.pendingImport = new Promise((_resolve, reject) => { rejectImport = reject; });
      importing = stalled.service.handleCommand({ operationId: 'stalled-import', type: 'live-import', payload: {} });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(stalled.service.mutation !== null, true);
      await stalled.service.setLiveLinkEnabled(false);
      await stalled.service.setLiveLinkChoice(true);
      stalled.bridge.pendingImport = null;
      let retryTimer;
      const retryTimeout = new Promise((_resolve, reject) => {
        retryTimer = setTimeout(() => reject(new Error('A stalled Import still blocks the queue after off/on.')), 1000);
      });
      let renewed;
      try {
        renewed = await Promise.race([
          stalled.service.handleCommand({ operationId: 'renewed-import', type: 'live-import', payload: {} }),
          retryTimeout,
        ]);
      } finally { clearTimeout(retryTimer); }
      assert.equal(renewed.ok, true, 'Import can start a fresh operation after the old one is retired.');
      assert.equal(stalled.bridge.calls.filter(([action]) => action === 'import').length, 2);
      assert.equal(stalled.dock.state.liveImported, true);
      stalled.setClipboard(stalled.dna);
      const quickAdd = await stalled.service.handleCommand({ operationId: 'quick-add-after-toggle', type: 'quick-add', payload: {} });
      assert.equal(quickAdd.ok, true, 'Quick Add remains available even if the old live operation never settles cleanly.');
      assert.equal(stalled.dock.state.mode, 'draft');
      rejectImport(new Error('Live Game Link is turned off.'));
      assert.equal((await importing).cancelled, true, 'The retired Import completes as cancelled.');
      assert.equal(stalled.dock.state.mode, 'draft', 'A late live-link failure cannot overwrite the newer Quick Add draft.');
    } finally {
      rejectImport?.(new Error('Test cleanup.'));
      await importing;
      stalled.service.destroy();
    }

    const cancelling = fixture('', { enabled: true, position: 'center', collection: 'Court', liveLink: { decision: 'enabled', enabled: true } });
    let rejectCancelledImport;
    let cancelledImport;
    try {
      await cancelling.service.setLiveLinkChoice(true);
      cancelling.bridge.pendingImport = new Promise((_resolve, reject) => { rejectCancelledImport = reject; });
      cancelledImport = cancelling.service.handleCommand({ operationId: 'cancel-pending-import', type: 'live-import', payload: {} });
      await new Promise((resolve) => setImmediate(resolve));
      cancelling.dock.update({ mode: 'error', busy: false, error: 'Synthetic read failure', liveRetry: true });
      const cancelled = await Promise.race([
        cancelling.service.handleCommand({ operationId: 'dismiss-pending-import', type: 'live-cancel', payload: {} }),
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error('Dismiss queued behind its own pending Import.')), 100)),
      ]);
      assert.equal(cancelled.ok, true);
      assert.equal(cancelling.dock.state.mode, 'compact');
      assert.equal(cancelling.service.mutation, null);
      assert.equal(cancelling.service.lastLiveCommand, null);
      assert.equal(cancelling.bridge.calls.filter(([action]) => action === 'cancel').length, 1);
      cancelling.bridge.pendingImport = null;
      const renewed = await cancelling.service.handleCommand({ operationId: 'import-after-dismiss', type: 'live-import', payload: {} });
      assert.equal(renewed.ok, true, 'A dismissed pending Import cannot block its replacement.');
      assert.equal(cancelling.dock.state.mode, 'draft');
      rejectCancelledImport(new Error('Late failure after Dismiss.'));
      assert.equal((await cancelledImport).cancelled, true);
      assert.equal(cancelling.dock.state.mode, 'draft', 'Late Import errors cannot reopen the dismissed error panel.');
    } finally {
      rejectCancelledImport?.(new Error('Test cleanup.'));
      await cancelledImport;
      cancelling.service.destroy();
    }

    const verifying = fixture('', { enabled: true, position: 'center', collection: 'Court', liveLink: { decision: 'enabled', enabled: true } });
    verifying.service.mutationKind = 'live';
    verifying.service.lastLiveCommand = { type: 'live-prepare-apply' };
    verifying.dock.update({ mode: 'compact', busy: true });
    assert.equal((await verifying.service.handleCommand({ operationId: 'cancel-confirmed-write', type: 'live-cancel', payload: {} })).ok, false, 'A one-click DNA write cannot be cancelled before verification.');
    verifying.service.lastLiveCommand = { type: 'live-undo' };
    verifying.dock.update({ mode: 'compact', busy: true });
    assert.equal((await verifying.service.handleCommand({ operationId: 'cancel-confirmed-restore', type: 'live-cancel', payload: {} })).ok, false, 'An Undo restore cannot be cancelled before verification.');
    assert.equal(verifying.bridge.calls.some(([action]) => action === 'cancel'), false);
    verifying.service.destroy();

    const expiring = fixture('', { enabled: true, position: 'center', collection: 'Court', liveLink: { decision: 'enabled', enabled: true } });
    try {
      await expiring.service.setLiveLinkChoice(true);
      expiring.bridge.undoDelay = 25;
      expiring.service.syncSelection({ id: 'card-1', name: 'Archived Aella', modified: 6, dna: expiring.dna });
      const result = await expiring.service.handleCommand({ operationId: 'apply-expiring', type: 'live-prepare-apply', payload: {} });
      assert.equal(result.ok, true);
      assert.equal(expiring.dock.state.mode, 'compact');
      assert.equal(expiring.dock.state.liveApplyId, 'apply-expiring');
      assert.ok(expiring.dock.state.liveUndoUntil > Date.now());
      assert.equal(expiring.dock.state.message, '', 'Apply stores no redundant completion notification.');
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.equal(expiring.dock.state.mode, 'compact', 'The normal dock remains active when its Undo deadline expires.');
      assert.equal(expiring.dock.state.liveUndoUntil, 0);
      assert.equal(expiring.dock.state.liveApplyId, '');
      assert.equal(expiring.service.liveUndoTimer, null);
    } finally { expiring.service.destroy(); }

    const synchronized = fixture('', { enabled: true, position: 'center', collection: 'Court', liveLink: { decision: 'enabled', enabled: true } });
    try {
      await synchronized.service.setLiveLinkChoice(true);
      await synchronized.service.setLiveLinkEnabled(false);
      synchronized.bridge.failNextEnable = true;
      await assert.rejects(synchronized.service.setLiveLinkChoice(true), /startup failure/);
      assert.equal(synchronized.dock.state.liveEnabled, true, 'A failed enable still synchronizes the saved preference back to the dock.');
    } finally { synchronized.service.destroy(); }
    console.log('Live game service tests passed: consent, bounded command recovery, startup retry, toggle synchronization, import/apply, undo, and stale-operation isolation.');
  } finally { app.service.destroy(); fs.rmSync(directory, { recursive: true, force: true }); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
