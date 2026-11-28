const fs = require('node:fs/promises');
const path = require('node:path');
const { WindowsGameMonitor } = require('./windows-game-monitor.cjs');
const { GameDock, normalizeDockPreferences } = require('./game-dock.cjs');
const { normalizeGameDockCommand, normalizeGameDockState } = require('./game-dock-commands.cjs');
const { isValidCk3Dna } = require('../renderer/dna-validation.js');
const { parsePersistentDna, decodeBase64Dna } = require('./live-dna-codec.cjs');
const { LiveGameBridge } = require('./live-game-bridge.cjs');

const MUTATING_COMMANDS = new Set(['quick-add', 'create-record', 'snapshot', 'live-capture', 'toggle-capture', 'cancel-capture', 'undo-create', 'finish-without-portrait', 'retry']);
const LIVE_COMMANDS = new Set(['live-import', 'live-prepare-apply', 'live-undo', 'live-retry']);

class GameDockService {
  constructor(options) {
    this.options = options;
    this.clipboard = options.clipboard;
    this.getMainContents = options.getMainContents;
    this.showMainWindow = options.showMainWindow || (() => {});
    this.createId = options.createId;
    this.logger = options.logger || console;
    this.setInterval = options.setInterval || global.setInterval;
    this.clearInterval = options.clearInterval || global.clearInterval;
    this.setTimeout = options.setTimeout || global.setTimeout;
    this.clearTimeout = options.clearTimeout || global.clearTimeout;
    this.rendererCommandTimeoutMs = Number.isFinite(options.rendererCommandTimeoutMs) ? Math.max(10, options.rendererCommandTimeoutMs) : 20_000;
    this.dock = options.dock || null;
    this.preferences = normalizeDockPreferences(options.preferences);
    this.preferencesPath = options.preferencesPath || '';
    this.preferencesLoaded = Boolean(options.preferences);
    this.preferencesPromise = null;
    this.preferencesSaveQueue = Promise.resolve();
    this.pending = new Map();
    this.pendingRenderer = new Map();
    this.completed = new Map();
    this.mutation = null;
    this.mutationKind = '';
    this.liveRevision = 0;
    this.draftActive = false;
    this.draftDna = '';
    this.clipboardTimer = null;
    this.quickAddTimer = null;
    this.destroyed = false;
    this.mainWindowWebContentsId = null;
    this.liveBridge = options.liveBridge || new LiveGameBridge({ cachePath: this.preferencesPath ? path.join(path.dirname(this.preferencesPath), 'live-layout-cache.json') : '', logger: this.logger });
    this.selection = null;
    this.selectionSignature = '';
    this.clipboardDna = null;
    this.clipboardSignature = '';
    this.liveApply = null;
    this.lastLiveCommand = null;
    this.liveQueue = Promise.resolve();
    this.serviceStarted = false;
    this.liveTargetTimer = null;
    this.liveTargetProbe = null;
    this.liveTargetProbeSequence = 0;
    this.liveTargetGameKey = '';
    this.liveUndoTimer = null;
  }

  async loadPreferences() {
    if (this.preferencesLoaded) return this.preferences;
    /* The renderer requests preferences while start() is still awaiting the same disk
       read. Share that promise: a read in progress is not a loaded default preference. */
    if (this.preferencesPromise) return this.preferencesPromise;
    this.preferencesPromise = (async () => {
      try {
        if (this.preferencesPath) this.preferences = normalizeDockPreferences(JSON.parse(await fs.readFile(this.preferencesPath, 'utf8')));
      } catch (error) {
        if (error.code !== 'ENOENT') this.logger.error('Game dock preferences could not be read:', error);
      } finally {
        this.preferencesLoaded = true;
      }
      return this.preferences;
    })();
    try { return await this.preferencesPromise; }
    finally { this.preferencesPromise = null; }
  }

  async savePreferences() {
    if (!this.preferencesPath) return;
    const preferences = { ...this.preferences, liveLink: { ...this.preferences.liveLink } };
    const save = this.preferencesSaveQueue.catch(() => {}).then(async () => {
      const temporary = `${this.preferencesPath}.tmp`;
      await fs.mkdir(path.dirname(this.preferencesPath), { recursive: true });
      await fs.writeFile(temporary, JSON.stringify(preferences, null, 2));
      await fs.rename(temporary, this.preferencesPath);
    });
    this.preferencesSaveQueue = save;
    return save;
  }

  async start() {
    if (this.destroyed) return false;
    await this.loadPreferences();
    if (!this.dock) {
      const monitor = new WindowsGameMonitor({ logger: this.logger });
      this.dock = new GameDock({
        BrowserWindow: this.options.BrowserWindow,
        screen: this.options.screen,
        monitor,
        htmlPath: this.options.htmlPath,
        preloadPath: this.options.preloadPath,
        preferences: this.preferences,
        onCommand: (command) => this.handleCommand(command),
        onPreferencesChange: (preferences) => this.preferencesChanged(preferences),
        onDraftVisibilityChange: (active) => this.setDraftActive(active),
        onGameLoss: () => this.notifyGameLoss(),
      });
    }
    if (this.preferences.liveLink.enabled) {
      try { await this.liveBridge.setEnabled(true); }
      catch (error) { this.logger.error('Live Game Link could not start:', error); }
    }
    this.serviceStarted = true;
    this.syncLiveState();
    this.startQuickAddClipboardMonitoring();
    if (!this.preferences.enabled) return false;
    const started = this.dock.start();
    this.syncLiveTargetPolling();
    return started;
  }

  preferencesChanged(preferences) {
    /* Live Game Link is service-owned; dock position/visibility callbacks must not restore
       the dock's older consent value and unexpectedly show the first-run dialog again. */
    this.preferences = normalizeDockPreferences({ ...preferences, liveLink: this.preferences.liveLink });
    void this.savePreferences().catch((error) => this.logger.error('Game dock preferences could not be saved:', error));
    this.broadcastPreferences();
    this.syncLiveState();
  }

  broadcastPreferences() {
    const contents = this.getMainContents();
    if (contents && !contents.isDestroyed()) contents.send('game-dock:preferences', { ...this.preferences, liveLink: { ...this.preferences.liveLink } });
  }

  async setLiveLinkChoice(enabled) {
    await this.loadPreferences();
    this.preferences = normalizeDockPreferences({ ...this.preferences, liveLink: { decision: enabled ? 'enabled' : 'declined', enabled: Boolean(enabled) } });
    await this.savePreferences();
    try { await this.applyLivePreference(); }
    finally {
      this.broadcastPreferences();
      this.syncLiveState();
    }
    return { ...this.preferences.liveLink };
  }

  async setLiveLinkEnabled(enabled) {
    await this.loadPreferences();
    const decision = enabled ? 'enabled' : this.preferences.liveLink.decision;
    this.preferences = normalizeDockPreferences({ ...this.preferences, liveLink: { decision, enabled: Boolean(enabled) } });
    await this.savePreferences();
    try { await this.applyLivePreference(); }
    finally {
      this.broadcastPreferences();
      this.syncLiveState();
    }
    return { ...this.preferences.liveLink };
  }

  async applyLivePreference() {
    if (!this.preferences.liveLink.enabled) {
      /* Retiring the revision intentionally suppresses the rejected request's normal
         error path. Preserve the safety warning when that request was an active write. */
      const interruptedWrite = this.mutationKind === 'live'
        && (Boolean(this.liveApply) || this.lastLiveCommand?.type === 'live-undo');
      this.retireLiveOperations();
      try { await this.liveBridge.setEnabled(false); }
      finally {
        /* Preference changes also retire the dock's local pending command. Late IPC
           replies remain identity-checked and cannot unlock a newer operation. */
        this.dock?.retirePendingCommands?.();
        this.clearLiveState();
        if (interruptedWrite) this.dock?.update({
          mode: 'error', busy: false, liveRetry: false,
          error: 'Live Game Link was disabled during a DNA write. Check the character in CK3 before saving; the final DNA state is unconfirmed.',
        });
      }
      return false;
    }
    await this.liveBridge.setEnabled(true);
    return true;
  }

  async ensureLiveBridge() {
    /* enabled records the user's runtime choice; workerReady proves this particular
       worker received it. A crashed replacement must complete its own handshake. */
    if (this.liveBridge.enabled && this.liveBridge.workerReady !== false) return true;
    await this.liveBridge.setEnabled(true);
    if (!this.liveBridge.enabled) throw new Error('Live Game Link is still starting. Try the action again.');
    return true;
  }

  retireLiveOperations() {
    ++this.liveRevision;
    /* Detach an unsettled legacy worker operation from the queue. Revision checks
       keep its eventual result away from the replacement live-link session. */
    this.liveQueue = Promise.resolve();
    this.liveApply = null;
    this.lastLiveCommand = null;
    if (this.mutationKind === 'live') {
      this.mutation = null;
      this.mutationKind = '';
    }
  }

  syncLiveState() {
    if (!this.dock) return;
    this.dock.syncPreferences?.({ liveLink: this.preferences.liveLink });
    this.dock.update({ liveEnabled: this.preferences.liveLink.enabled, liveSelectedName: this.selection?.name || '', ...this.liveApplyState() });
    this.syncLiveTargetPolling();
  }

  liveApplyState() {
    const source = this.clipboardDna ? 'clipboard' : this.selection ? 'gallery' : '';
    return { liveCanApply: Boolean(source), liveApplySource: source, liveClipboardFormat: this.clipboardDna?.format || '' };
  }

  syncClipboardDna(read = false) {
    let next = null;
    if (read && this.preferences.liveLink.enabled) {
      try {
        const dna = this.clipboard.readText().trim();
        if (isValidCk3Dna(dna)) {
          if (/\bgenes\s*=\s*\{/.test(dna)) {
            parsePersistentDna(dna);
            next = { dna, format: 'persistent' };
          } else {
            decodeBase64Dna(dna);
            next = { dna, format: 'base64' };
          }
        }
      } catch { next = null; }
    }
    const signature = next ? `${next.format}:${next.dna}` : '';
    if (signature === this.clipboardSignature) return false;
    this.clipboardDna = next;
    this.clipboardSignature = signature;
    this.dock?.update(this.liveApplyState());
    return true;
  }

  currentLiveApplyInput(readClipboard = false) {
    if (readClipboard) this.syncClipboardDna(true);
    if (this.clipboardDna) {
      const label = this.clipboardDna.format === 'base64' ? 'Base64 clipboard DNA' : 'Persistent clipboard DNA';
      return { kind: 'clipboard', signature: this.clipboardSignature, selection: { id: 'clipboard', name: label, modified: 0, dna: this.clipboardDna.dna } };
    }
    if (this.selection) return { kind: 'gallery', signature: this.selectionSignature, selection: this.selection };
    return null;
  }

  syncLiveTargetPolling() {
    const active = Boolean(this.serviceStarted && !this.destroyed && this.preferences.liveLink.enabled && this.dock);
    if (active && !this.liveTargetTimer) {
      this.liveTargetTimer = this.setInterval(() => { void this.refreshLiveTarget(); }, 1000);
      this.liveTargetTimer?.unref?.();
    }
    if (!active) {
      if (this.liveTargetTimer) this.clearInterval(this.liveTargetTimer);
      this.liveTargetTimer = null;
      ++this.liveTargetProbeSequence;
      this.liveTargetProbe = null;
      this.liveTargetGameKey = '';
      this.publishLiveTarget(null);
      this.syncClipboardDna(false);
      return;
    }
    void this.refreshLiveTarget();
  }

  async refreshLiveTarget() {
    if (!this.serviceStarted || this.destroyed || !this.preferences.liveLink.enabled || !this.dock) {
      this.publishLiveTarget(null);
      this.syncClipboardDna(false);
      return false;
    }
    const dock = this.dock;
    const game = dock.game;
    if (!dock.state.visible || !dock.state.connected || !game?.processId || game.executable !== 'ck3.exe' || !game.executablePath) {
      this.publishLiveTarget(null);
      this.syncClipboardDna(false);
      return false;
    }
    /* Expanded panels and mutations retain the last known identity but do not compete
       with an in-flight DNA operation. Hidden or disconnected docks never touch CK3. */
    if (dock.state.mode !== 'compact' || dock.state.busy || this.mutation || this.liveTargetProbe) return false;
    this.syncClipboardDna(true);
    const identity = { pid: game.processId, executablePath: game.executablePath };
    const gameKey = `${identity.pid}:${identity.executablePath.toLowerCase()}`;
    const revision = this.liveRevision;
    const sequence = ++this.liveTargetProbeSequence;
    const probe = (async () => {
      await this.ensureLiveBridge();
      return this.liveBridge.detect(identity);
    })();
    this.liveTargetProbe = probe;
    this.liveTargetGameKey = gameKey;
    try {
      const result = await probe;
      const current = dock.game;
      const currentKey = current?.processId && current.executablePath ? `${current.processId}:${current.executablePath.toLowerCase()}` : '';
      const usable = this.serviceStarted && !this.destroyed && this.preferences.liveLink.enabled && this.dock === dock
        && dock.state.visible && dock.state.connected && dock.state.mode === 'compact' && !dock.state.busy && !this.mutation
        && current?.executable === 'ck3.exe' && currentKey === gameKey && this.liveTargetGameKey === gameKey;
      if (sequence !== this.liveTargetProbeSequence || revision !== this.liveRevision) return false;
      this.publishLiveTarget(usable ? result?.target : null);
      return Boolean(usable && result?.target);
    } catch {
      /* A closed window and a temporarily unreadable game are ordinary detection
         states. Keep the controls disabled and let the next quiet poll recover. */
      if (sequence === this.liveTargetProbeSequence && revision === this.liveRevision) this.publishLiveTarget(null);
      return false;
    } finally {
      if (this.liveTargetProbe === probe) {
        this.liveTargetProbe = null;
        this.liveTargetGameKey = '';
      }
    }
  }

  publishLiveTarget(target) {
    if (!this.dock) return;
    const available = Boolean(target && Number.isInteger(target.id) && target.id >= 0 && typeof target.name === 'string');
    const name = available ? target.name : '';
    if (this.dock.state.liveTargetAvailable === available && this.dock.state.liveDetectedName === name) return;
    this.dock.update({ liveTargetAvailable: available, liveDetectedName: name });
  }

  setEnabled(enabled) {
    if (!this.dock) return false;
    const result = this.dock.setEnabled(Boolean(enabled));
    if (!enabled) {
      this.cancelRendererDraft(this.dock.state.draftId || '');
      this.clearDraft();
      this.clearLiveState();
    }
    return result;
  }

  syncLibrary(galleries) {
    if (!this.dock) return;
    const names = (Array.isArray(galleries) ? galleries : []).map((gallery) => gallery?.name).filter(Boolean);
    const selected = this.dock.setLibrary(names, this.dock.state.collection || this.preferences.collection);
    if (selected && selected !== this.preferences.collection) this.dock.setPreferences({ collection: selected });
  }

  syncSelection(input) {
    let selection = null;
    if (input && typeof input === 'object' && !Array.isArray(input)) {
      if (typeof input.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(input.id) || typeof input.name !== 'string' || !Number.isFinite(input.modified) || typeof input.dna !== 'string' || input.dna.length > 1_000_000) throw new Error('The selected gallery record is invalid.');
      try {
        parsePersistentDna(input.dna);
        selection = { id: input.id, name: input.name.trim().slice(0, 120), modified: input.modified, dna: input.dna.trim() };
      } catch { selection = null; }
    }
    const signature = selection ? `${selection.id}:${selection.modified}:${selection.dna}` : '';
    if (signature === this.selectionSignature) { this.syncLiveState(); return; }
    this.selectionSignature = signature;
    this.selection = selection;
    this.liveApply = null;
    this.lastLiveCommand = null;
    void this.liveBridge.cancel().catch(() => {});
    if (this.dock?.state.liveRetry) this.clearLiveState();
    this.syncLiveState();
  }

  validateGameHwnd(value) {
    const hwnd = typeof value === 'string' ? value : '';
    if (!/^\d{1,20}$/.test(hwnd) || String(this.dock?.game?.hwnd || '') !== hwnd) throw new Error('The foreground CK3 window has changed. Start the capture again.');
    return hwnd;
  }

  liveGame() {
    if (!this.preferences.liveLink.enabled) throw new Error('Live Game Link is turned off. Enable it in File → Live Game Link.');
    const game = this.dock?.game;
    if (!game?.processId || game.executable !== 'ck3.exe' || !game.executablePath) throw new Error('Focus CK3 before using Live Game Link.');
    return { pid: game.processId, executablePath: game.executablePath };
  }

  validateCaptureContext(context) {
    if (context === undefined || context === null) return null;
    if (typeof context !== 'object' || Array.isArray(context)) throw new Error('The dock capture context is invalid.');
    const dockDraftId = typeof context.dockDraftId === 'string' ? context.dockDraftId : '';
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(dockDraftId) || this.dock?.state.draftId !== dockDraftId) throw new Error('This dock draft is no longer active.');
    return { dockDraftId, gameHwnd: this.validateGameHwnd(context.gameHwnd) };
  }

  updateFromRenderer(patch) {
    if (!this.dock) return false;
    const state = normalizeGameDockState(patch);
    /* Renderer operations carry their draft identity even after IPC settles. Never let
       a cancelled operation reopen framing or overwrite a newer destination/draft. */
    if (state.draftId && state.draftId !== this.dock.state.draftId) return false;
    this.dock.update(state);
    if (state.collection && state.collection !== this.preferences.collection) this.dock.setPreferences({ collection: state.collection });
    if (state.mode && state.mode !== 'draft') this.setDraftActive(false);
    if (state.mode === 'compact' && !state.characterId) this.draftDna = '';
    return true;
  }

  startQuickAddClipboardMonitoring() {
    if (this.quickAddTimer || this.destroyed) return false;
    this.syncQuickAddClipboard();
    this.quickAddTimer = this.setInterval(() => { this.syncQuickAddClipboard(); }, 400);
    this.quickAddTimer?.unref?.();
    return true;
  }

  syncQuickAddClipboard() {
    const dock = this.dock;
    if (!dock || this.destroyed) return false;
    const visibleCompactDock = dock.state.visible && dock.state.mode === 'compact';
    let ready = false;
    if (visibleCompactDock) {
      try { ready = isValidCk3Dna(this.clipboard.readText()); }
      catch (error) { this.logger.error('Quick Add clipboard could not be read:', error); }
    }
    if (dock.state.quickAddReady === ready) return false;
    dock.update({ quickAddReady: ready });
    return true;
  }

  setDraftActive(active) {
    this.draftActive = Boolean(active && this.dock?.state.mode === 'draft' && !this.dock.state.dnaReady);
    if (this.clipboardTimer) this.clearInterval(this.clipboardTimer);
    this.clipboardTimer = null;
    if (!this.draftActive) return;
    void this.checkClipboard();
    this.clipboardTimer = this.setInterval(() => { void this.checkClipboard(); }, 400);
    this.clipboardTimer?.unref?.();
  }

  async checkClipboard() {
    if (!this.draftActive || this.destroyed || this.dock?.state.mode !== 'draft' || this.dock.state.dnaReady) return false;
    let text = '';
    try { text = this.clipboard.readText(); }
    catch (error) { this.logger.error('Draft clipboard could not be read:', error); return false; }
    if (!this.draftActive || this.dock.state.mode !== 'draft' || !isValidCk3Dna(text)) return false;
    this.draftDna = text.trim();
    this.dock.update({ dnaReady: true, liveImported: false, message: 'DNA detected. Choose a destination and create the record.' });
    this.setDraftActive(false);
    return true;
  }

  async handleCommand(input) {
    if (this.destroyed) return { ok: false, error: 'The dock is closing.' };
    let command;
    try { command = normalizeGameDockCommand(input); }
    catch (error) { return { ok: false, error: error.message }; }
    if (this.completed.has(command.operationId)) return this.completed.get(command.operationId);
    if (this.pending.has(command.operationId)) return this.pending.get(command.operationId);
    const promise = this.executeCommand(command).catch((error) => ({ ok: false, error: String(error.message || error).slice(0, 256) }));
    this.pending.set(command.operationId, promise);
    try {
      const result = await promise;
      this.completed.set(command.operationId, result);
      if (this.completed.size > 200) this.completed.delete(this.completed.keys().next().value);
      return result;
    } finally { this.pending.delete(command.operationId); }
  }

  async executeCommand(command) {
    const { type, payload } = command;
    if (type === 'set-position') { this.dock.setPreferences({ position: payload.position }); return { ok: true }; }
    if (type === 'disable-dock') { this.setEnabled(false); return { ok: true }; }
    if (type === 'select-collection') {
      if (!this.dock.state.collections.includes(payload.collection)) throw new Error('That collection no longer exists.');
      this.dock.setPreferences({ collection: payload.collection });
      this.dock.update({ collection: payload.collection });
      return { ok: true };
    }
    if (type === 'live-cancel') {
      /* A write/restore must finish verification, but a pending read or an
         already-reported error must never queue its Dismiss button behind itself. */
      const writing = ['live-prepare-apply', 'live-undo'].includes(this.lastLiveCommand?.type);
      if (this.mutationKind === 'live' && this.dock.state.busy && writing) {
        return { ok: false, error: 'Wait for the DNA write to finish verifying.' };
      }
      this.retireLiveOperations();
      this.clearLiveState();
      this.dock.retirePendingCommands?.();
      void this.liveBridge.cancel().catch((error) => this.logger.error('Live Game Link cancellation failed:', error));
      return { ok: true, cancelled: true };
    }
    if (LIVE_COMMANDS.has(type)) {
      if (this.mutation) return { ok: false, error: 'Another archive action is still finishing.' };
      const revision = this.liveRevision;
      const operation = this.liveQueue.catch(() => {}).then(() => this.executeLiveCommand(command, revision));
      this.liveQueue = operation.catch(() => {});
      this.mutation = operation;
      this.mutationKind = 'live';
      try { return await operation; }
      finally {
        if (this.mutation === operation) {
          this.mutation = null;
          this.mutationKind = '';
        }
      }
    }
    /* Dismissal is local cleanup. It must still work while the dock's name field owns
       Windows focus, or after CK3 loses its foreground window. */
    if (type === 'discard-draft') {
      this.resetDraft('discard');
      return { ok: true, cancelled: true };
    }
    if (type === 'cancel-draft' || type === 'dismiss') {
      this.resetDraft();
      return { ok: true, cancelled: true };
    }
    if (type === 'cancel-capture' && this.mutation) {
      /* Cancelling a capture has one outcome whether or not an archive action is
         still in flight: settle the operation, keep the saved character, and show
         the same confirmation panel the renderer publishes for a quiet cancel.
         Without a saved character there is nothing to keep, so reset as before. */
      const characterId = this.dock.state.characterId;
      if (!characterId) {
        this.resetDraft();
        return { ok: true, cancelled: true };
      }
      this.cancelRendererDraft(this.dock.state.draftId || '', 'cancelled');
      void this.liveBridge.cancel().catch(() => {});
      this.setDraftActive(false);
      this.dock.update({ mode: 'success', capture: null, crop: null, sourceSize: null, busy: false, dnaReady: true, dnaAttached: true, undoUntil: Date.now() + 12_000, message: 'Capture cancelled. The character and DNA are still saved.', error: '' });
      return { ok: true, cancelled: true };
    }
    const editingLoopSearch = type === 'set-loop-search' && this.dock.editing && this.dock.window?.isFocused?.();
    if (!this.dock.game?.hwnd && type !== 'view-gallery' && !editingLoopSearch) throw new Error('CK3 is no longer in the foreground.');
    if (type === 'quick-add') {
      if (this.mutation) return { ok: false, error: 'Another archive action is still finishing.' };
      /* The visible button is eligibility-gated, but the clipboard can change between
         a poll and the physical click. Revalidate and use only this exact DNA snapshot. */
      const clipboardText = this.clipboard.readText();
      const dna = isValidCk3Dna(clipboardText) ? clipboardText.trim() : '';
      if (!dna) {
        this.dock.update({ quickAddReady: false });
        return { ok: false, error: 'Copy persistent or Base64 DNA in CK3 before using Quick add.' };
      }
      const draftId = this.createId();
      this.draftDna = dna;
      /* Quick Add only stages DNA. The editable draft must explicitly save or frame
         before any archive record exists, so Cancel always leaves the gallery unchanged. */
      this.dock.update({ mode: 'draft', draftId, characterId: '', characterName: '', dnaReady: true, dnaAttached: false, liveImported: false, capture: null, crop: null, busy: false, error: '', message: 'Name the character, then save its DNA or create and frame a portrait.' });
      return { ok: true };
    }
    if (MUTATING_COMMANDS.has(type) && this.mutation) return { ok: false, error: 'Another archive action is still finishing.' };
    const collection = type === 'create-record' && payload.collection ? payload.collection : this.dock.state.collection;
    if (type === 'create-record' && !this.dock.state.collections.includes(collection)) throw new Error('That destination collection no longer exists. Choose another gallery.');
    const enriched = { ...command, payload: { ...payload, draftId: this.dock.state.draftId, collection, gameHwnd: this.dock.game?.hwnd || '' } };
    if (['create-record', 'retry'].includes(type)) enriched.payload.dna = this.draftDna;
    /* Live-portrait completion publishes its deadline from the capture service. Send
       that authoritative value with Undo so every creation path enforces expiry. */
    if (type === 'undo-create') enriched.payload.undoUntil = this.dock.state.undoUntil || 0;
    if (type === 'view-gallery') {
      const result = await this.forward(enriched);
      /* View in gallery is also confirmation of the saved draft. Reset only after
         the gallery selected the character successfully, exactly like choosing Done. */
      if (result.ok) this.resetDraft();
      return result;
    }
    return MUTATING_COMMANDS.has(type) ? this.runMutation(enriched) : this.forward(enriched);
  }

  async executeLiveCommand(command, revision = this.liveRevision) {
    const stale = () => revision !== this.liveRevision;
    if (stale()) return { ok: true, cancelled: true };
    const { type } = command;
    if (type === 'live-retry') {
      if (!this.lastLiveCommand) throw new Error('Start the live-game action again.');
      command = { ...this.lastLiveCommand, operationId: command.operationId };
    }
    try {
      if (command.type === 'live-import') {
        this.lastLiveCommand = command;
        this.scheduleLiveUndoExpiry(0);
        this.dock.update({ busy: true, message: 'Validating the open CK3 character…', error: '', liveUndoUntil: 0, liveTargetName: '', liveApplyId: '', liveRetry: false });
        const game = this.liveGame();
        await this.ensureLiveBridge();
        if (stale()) return { ok: true, cancelled: true };
        const result = await this.liveBridge.import(game);
        if (stale()) return { ok: true, cancelled: true };
        parsePersistentDna(result.dna);
        const draftId = this.createId();
        this.draftDna = result.dna;
        this.dock.update({ mode: 'draft', busy: false, draftId, characterId: '', characterName: result.target.name, dnaReady: true, dnaAttached: true, liveImported: true, capture: null, crop: null, error: '', liveRetry: false, message: `${result.geneCount} genes imported as persistent DNA. Hairstyle, beard, and clothing are not in this DNA array.` });
        this.lastLiveCommand = null;
        return { ok: true };
      }
      if (command.type === 'live-prepare-apply') {
        const game = this.liveGame();
        const source = this.currentLiveApplyInput(true);
        if (!source) throw new Error('Copy persistent or Base64 DNA, or select a gallery character with persistent Ruler Designer DNA in Bloodline first.');
        this.lastLiveCommand = command;
        this.scheduleLiveUndoExpiry(0);
        this.dock.update({ busy: true, message: source.kind === 'clipboard' && source.selection.name.startsWith('Base64') ? 'Preparing guarded Base64 DNA…' : 'Preparing version-matched DNA…', error: '', liveUndoUntil: 0, liveTargetName: '', liveApplyId: '', liveRetry: false });
        await this.ensureLiveBridge();
        if (stale()) return { ok: true, cancelled: true };
        const prepared = await this.liveBridge.prepareApply(game, source.selection);
        if (stale()) return { ok: true, cancelled: true };
        if (source.kind === 'clipboard') this.syncClipboardDna(true);
        const unchanged = source.kind === 'clipboard' ? source.signature === this.clipboardSignature : source.signature === this.selectionSignature;
        if (!unchanged) { await this.liveBridge.cancel(); throw new Error(`The ${source.kind === 'clipboard' ? 'clipboard DNA' : 'gallery selection'} changed. No DNA was applied.`); }
        this.liveApply = { token: prepared.token, sourceKind: source.kind, sourceSignature: source.signature };
        this.dock.update({ busy: true, liveApplySource: source.kind, liveClipboardFormat: source.kind === 'clipboard' ? this.clipboardDna?.format || '' : '', liveTargetName: prepared.target.name, liveUndoUntil: 0, liveApplyId: '', liveRetry: false, error: '', message: 'Applying and verifying DNA…' });
        const result = await this.liveBridge.confirmApply(game, prepared.token);
        if (stale()) return { ok: true, cancelled: true };
        this.liveApply = null;
        this.lastLiveCommand = null;
        this.dock.update({ mode: 'compact', busy: false, liveTargetName: result.target.name, liveUndoUntil: result.undoUntil, liveApplyId: command.operationId, liveRetry: false, error: '', message: '' });
        this.scheduleLiveUndoExpiry(result.undoUntil);
        return { ok: true };
      }
      if (command.type === 'live-undo') {
        if (!this.dock.state.liveUndoUntil || this.dock.state.liveUndoUntil <= Date.now()) throw new Error('The guarded undo window has expired.');
        this.lastLiveCommand = command;
        this.scheduleLiveUndoExpiry(0);
        this.dock.update({ busy: true, error: '' });
        await this.liveBridge.undo(this.liveGame());
        if (stale()) return { ok: true, cancelled: true };
        this.lastLiveCommand = null;
        this.clearLiveState();
        return { ok: true };
      }
      throw new Error('That live-game action is not available.');
    } catch (error) {
      if (stale()) return { ok: true, cancelled: true };
      const message = String(error.message || error).slice(0, 500);
      this.liveApply = null;
      if (command.type === 'live-undo' && this.dock.state.liveUndoUntil > Date.now()) this.scheduleLiveUndoExpiry(this.dock.state.liveUndoUntil);
      this.dock.update({ mode: 'error', busy: false, error: message, liveRetry: Boolean(this.lastLiveCommand) });
      return { ok: false, error: message };
    }
  }

  scheduleLiveUndoExpiry(deadline) {
    if (this.liveUndoTimer) this.clearTimeout(this.liveUndoTimer);
    this.liveUndoTimer = null;
    if (!Number.isFinite(deadline) || deadline <= 0) return;
    this.liveUndoTimer = this.setTimeout(() => {
      this.liveUndoTimer = null;
      if (this.destroyed || !this.dock || this.dock.state.busy || this.dock.state.liveUndoUntil !== deadline) return;
      this.dock.update({ liveTargetName: '', liveUndoUntil: 0, liveApplyId: '' });
    }, Math.max(0, deadline - Date.now()));
    this.liveUndoTimer?.unref?.();
  }

  clearLiveState() {
    this.scheduleLiveUndoExpiry(0);
    if (!this.dock) return;
    this.dock.update({ mode: 'compact', busy: false, liveTargetName: '', liveUndoUntil: 0, liveApplyId: '', liveRetry: false, liveImported: false, message: '', error: '' });
  }

  async runMutation(command) {
    const operation = this.forward(command);
    this.mutation = operation;
    this.mutationKind = 'archive';
    try {
      const result = await operation;
      if (result.cancelled || this.mutation !== operation) return { ok: true, cancelled: true };
      if (result.ok && ['create-record', 'finish-without-portrait'].includes(command.type)) this.clearDraft(false);
      return result;
    } finally {
      if (this.mutation === operation) {
        this.mutation = null;
        this.mutationKind = '';
      }
    }
  }

  clearDraft(resetState = true) {
    this.setDraftActive(false);
    this.draftDna = '';
    if (resetState && this.dock) this.dock.update({ mode: 'compact', draftId: null, characterId: null, characterName: '', dnaReady: false, dnaAttached: false, liveImported: false, capture: null, crop: null, sourceSize: null, message: '', error: '', undoUntil: 0 });
  }

  resetDraft(reason = 'cancelled') {
    this.cancelRendererDraft(this.dock.state.draftId || '', reason);
    this.clearDraft();
    this.clearLiveState();
    void this.liveBridge.cancel().catch(() => {});
  }

  settleRendererRequest(operationId, response) {
    const request = this.pendingRenderer.get(operationId);
    if (!request) return false;
    this.pendingRenderer.delete(operationId);
    this.clearTimeout(request.timeout);
    request.resolve(response);
    return true;
  }

  cancelRendererDraft(draftId, reason = 'cancelled') {
    if (!draftId) return false;
    const operationIds = [];
    for (const [operationId, request] of this.pendingRenderer) {
      if (request.draftId !== draftId) continue;
      operationIds.push(operationId);
      this.settleRendererRequest(operationId, { ok: true, cancelled: true });
    }
    const contents = this.getMainContents();
    if (contents && !contents.isDestroyed()) contents.send('game-dock:cancel', { draftId, reason, operationIds });
    /* The forward promise's own finally still runs; this merely lets a new local draft
       open immediately without waiting behind an obsolete renderer operation. */
    if (this.mutation && reason !== 'timeout') {
      this.mutation = null;
      this.mutationKind = '';
    }
    return true;
  }

  forward(command) {
    const contents = this.getMainContents();
    if (!contents || contents.isDestroyed()) return Promise.resolve({ ok: false, error: 'The gallery is still starting. Try again in a moment.' });
    if (command.type === 'view-gallery') this.showMainWindow();
    return new Promise((resolve) => {
      const request = {
        resolve, contentsId: contents.id, draftId: command.payload?.draftId || '', timeout: null,
      };
      this.pendingRenderer.set(command.operationId, request);
      request.timeout = this.setTimeout(() => {
        const error = 'The gallery did not finish this action. Saved changes are kept. Try again or cancel.';
        if (!this.settleRendererRequest(command.operationId, { ok: false, error })) return;
        if (request.draftId) this.cancelRendererDraft(request.draftId, 'timeout');
        if (this.dock && (!request.draftId || this.dock.state.draftId === request.draftId)) this.dock.update({ mode: 'error', error, busy: false });
      }, this.rendererCommandTimeoutMs);
      try { contents.send('game-dock:command', command); }
      catch { this.settleRendererRequest(command.operationId, { ok: false, error: 'The gallery could not receive this action. Try again.' }); }
    });
  }

  completeRendererResult(event, operationId, result) {
    const request = this.pendingRenderer.get(operationId);
    if (!request || event.sender.id !== request.contentsId || event.sender.id !== this.mainWindowWebContentsId || event.senderFrame !== event.sender.mainFrame) return false;
    const response = { ok: result?.cancelled ? true : result?.ok !== false };
    if (result?.cancelled) response.cancelled = true;
    if (!response.ok) response.error = String(result?.error || 'The action could not be completed.').slice(0, 256);
    this.settleRendererRequest(operationId, response);
    if (!response.ok && this.dock.state.mode !== 'error') this.dock.update({ mode: 'error', error: response.error, busy: false });
    return true;
  }

  notifyGameLoss() {
    this.publishLiveTarget(null);
    this.syncClipboardDna(false);
    /* View in gallery intentionally focuses the app after a completed save. There is
       no active draft or capture to interrupt, so keep the success state on re-entry. */
    if (this.dock?.state.mode === 'success') return;
    const contents = this.getMainContents();
    const draftId = this.dock?.state.draftId || '';
    const operationIds = [...this.pendingRenderer].filter(([, request]) => request.draftId === draftId).map(([operationId]) => operationId);
    if (contents && !contents.isDestroyed()) contents.send('game-dock:game-lost', { draftId, operationIds });
  }

  updateCapture(capture, status) {
    if (!capture?.dockDraftId || capture.dockDraftId !== this.dock?.state.draftId || !this.dock) return false;
    if (status?.state === 'saved') {
      this.dock.update({ mode: 'success', capture: null, crop: null, message: 'Portrait and DNA saved.', undoUntil: Date.now() + 12_000, busy: false });
    } else if (status?.state === 'failed') {
      this.dock.update({ mode: 'error', capture: null, error: String(status.message || 'The portrait could not be captured.').slice(0, 256), busy: false });
    } else if (status?.state === 'armed') {
      /* Armed means the stream is ready to frame, not that a recording has started.
         Keep the opening state until createFromDock publishes its crop and clears busy. */
      this.dock.update({ mode: 'framing', capture: null, busy: true });
    } else if (status?.state) {
      this.dock.update({ mode: 'capture', capture: { state: status.state, startedAt: status.startedAt || 0, deadline: status.deadline || 0 }, busy: false });
    }
    return true;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.serviceStarted = false;
    if (this.liveTargetTimer) this.clearInterval(this.liveTargetTimer);
    this.liveTargetTimer = null;
    if (this.quickAddTimer) this.clearInterval(this.quickAddTimer);
    this.quickAddTimer = null;
    if (this.liveUndoTimer) this.clearTimeout(this.liveUndoTimer);
    this.liveUndoTimer = null;
    ++this.liveTargetProbeSequence;
    this.liveTargetProbe = null;
    this.liveTargetGameKey = '';
    this.setDraftActive(false);
    this.draftDna = '';
    this.selection = null;
    this.selectionSignature = '';
    this.clipboardDna = null;
    this.clipboardSignature = '';
    this.liveApply = null;
    for (const operationId of this.pendingRenderer.keys()) {
      this.settleRendererRequest(operationId, { ok: false, error: 'The application is closing.' });
    }
    void this.liveBridge.close().catch(() => {});
    this.dock?.destroy();
    this.dock = null;
  }
}

module.exports = { GameDockService };
