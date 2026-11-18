const fs = require('node:fs/promises');
const path = require('node:path');
const { WindowsGameMonitor } = require('./windows-game-monitor.cjs');
const { GameDock, normalizeDockPreferences } = require('./game-dock.cjs');
const { normalizeGameDockCommand, normalizeGameDockState } = require('./game-dock-commands.cjs');
const { isValidCk3Dna } = require('../renderer/dna-validation.js');

const MUTATING_COMMANDS = new Set(['quick-add', 'create-record', 'snapshot', 'live-capture', 'toggle-capture', 'cancel-capture', 'undo-create', 'finish-without-portrait', 'retry']);

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
    this.dock = options.dock || null;
    this.preferences = normalizeDockPreferences(options.preferences);
    this.preferencesPath = options.preferencesPath || '';
    this.preferencesLoaded = Boolean(options.preferences);
    this.preferencesSaveQueue = Promise.resolve();
    this.pending = new Map();
    this.completed = new Map();
    this.mutation = null;
    this.draftActive = false;
    this.draftDna = '';
    this.clipboardTimer = null;
    this.destroyed = false;
    this.mainWindowWebContentsId = null;
  }

  async loadPreferences() {
    if (this.preferencesLoaded) return this.preferences;
    this.preferencesLoaded = true;
    if (!this.preferencesPath) return this.preferences;
    try {
      this.preferences = normalizeDockPreferences(JSON.parse(await fs.readFile(this.preferencesPath, 'utf8')));
    } catch (error) {
      if (error.code !== 'ENOENT') this.logger.error('Game dock preferences could not be read:', error);
    }
    return this.preferences;
  }

  async savePreferences() {
    if (!this.preferencesPath) return;
    const preferences = { ...this.preferences };
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
    if (!this.preferences.enabled) return false;
    return this.dock.start();
  }

  preferencesChanged(preferences) {
    this.preferences = normalizeDockPreferences(preferences);
    void this.savePreferences().catch((error) => this.logger.error('Game dock preferences could not be saved:', error));
    const contents = this.getMainContents();
    if (contents && !contents.isDestroyed()) contents.send('game-dock:preferences', { ...this.preferences });
  }

  setEnabled(enabled) {
    if (!this.dock) return false;
    const result = this.dock.setEnabled(Boolean(enabled));
    if (!enabled) this.clearDraft();
    return result;
  }

  syncLibrary(galleries) {
    if (!this.dock) return;
    const names = (Array.isArray(galleries) ? galleries : []).map((gallery) => gallery?.name).filter(Boolean);
    const selected = this.dock.setLibrary(names, this.dock.state.collection || this.preferences.collection);
    if (selected && selected !== this.preferences.collection) this.dock.setPreferences({ collection: selected });
  }

  validateGameHwnd(value) {
    const hwnd = typeof value === 'string' ? value : '';
    if (!/^\d{1,20}$/.test(hwnd) || String(this.dock?.game?.hwnd || '') !== hwnd) throw new Error('The foreground CK3 window has changed. Start the capture again.');
    return hwnd;
  }

  validateCaptureContext(context) {
    if (context === undefined || context === null) return null;
    if (typeof context !== 'object' || Array.isArray(context)) throw new Error('The dock capture context is invalid.');
    const dockDraftId = typeof context.dockDraftId === 'string' ? context.dockDraftId : '';
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(dockDraftId) || this.dock?.state.draftId !== dockDraftId) throw new Error('This dock draft is no longer active.');
    return { dockDraftId, gameHwnd: this.validateGameHwnd(context.gameHwnd) };
  }

  updateFromRenderer(patch) {
    if (!this.dock) return;
    const state = normalizeGameDockState(patch);
    this.dock.update(state);
    if (state.collection && state.collection !== this.preferences.collection) this.dock.setPreferences({ collection: state.collection });
    if (state.mode && state.mode !== 'draft') this.setDraftActive(false);
    if (['compact', 'success'].includes(state.mode) && !state.characterId && this.dock.state.mode === 'compact') this.draftDna = '';
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
    this.dock.update({ dnaReady: true, message: 'DNA detected. Choose a destination and create the record.' });
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
    if (!this.dock.game?.hwnd && type !== 'view-gallery') throw new Error('CK3 is no longer in the foreground.');
    if (type === 'quick-add') {
      if (this.mutation) return { ok: false, error: 'Another archive action is still finishing.' };
      const draftId = this.createId();
      this.draftDna = '';
      const clipboardText = this.clipboard.readText();
      const dna = isValidCk3Dna(clipboardText) ? clipboardText.trim() : '';
      if (!dna) {
        this.dock.update({ mode: 'draft', draftId, characterId: '', characterName: '', dnaReady: false, dnaAttached: false, capture: null, crop: null, error: '', message: 'Copy DNA in CK3 to continue.' });
        this.setDraftActive(this.dock.state.visible);
        return { ok: true };
      }
      this.draftDna = dna;
      return this.runMutation({ ...command, payload: { ...payload, draftId, dna, collection: this.dock.state.collection, gameHwnd: this.dock.game.hwnd } });
    }
    if (type === 'cancel-draft' || type === 'dismiss') {
      this.clearDraft();
      return { ok: true };
    }
    if (MUTATING_COMMANDS.has(type) && this.mutation) return { ok: false, error: 'Another archive action is still finishing.' };
    const enriched = { ...command, payload: { ...payload, draftId: this.dock.state.draftId, collection: this.dock.state.collection, gameHwnd: this.dock.game?.hwnd || '' } };
    if (['create-record', 'retry'].includes(type)) enriched.payload.dna = this.draftDna;
    return MUTATING_COMMANDS.has(type) ? this.runMutation(enriched) : this.forward(enriched);
  }

  async runMutation(command) {
    const operation = this.forward(command).finally(() => { if (this.mutation === operation) this.mutation = null; });
    this.mutation = operation;
    const result = await operation;
    if (result.ok && ['quick-add', 'create-record', 'finish-without-portrait', 'dismiss'].includes(command.type)) this.clearDraft(false);
    return result;
  }

  clearDraft(resetState = true) {
    this.setDraftActive(false);
    this.draftDna = '';
    if (resetState && this.dock) this.dock.update({ mode: 'compact', draftId: null, characterId: null, characterName: '', dnaReady: false, dnaAttached: false, capture: null, crop: null, sourceSize: null, message: '', error: '', undoUntil: 0 });
  }

  forward(command) {
    const contents = this.getMainContents();
    if (!contents || contents.isDestroyed()) return Promise.resolve({ ok: false, error: 'The gallery is still starting. Try again in a moment.' });
    if (command.type === 'view-gallery') this.showMainWindow();
    return new Promise((resolve) => {
      this.pendingRenderer = this.pendingRenderer || new Map();
      this.pendingRenderer.set(command.operationId, { resolve, contentsId: contents.id });
      contents.send('game-dock:command', command);
    });
  }

  completeRendererResult(event, operationId, result) {
    const request = this.pendingRenderer?.get(operationId);
    if (!request || event.sender.id !== request.contentsId || event.sender.id !== this.mainWindowWebContentsId || event.senderFrame !== event.sender.mainFrame) return false;
    this.pendingRenderer.delete(operationId);
    const response = { ok: result?.ok !== false };
    if (!response.ok) response.error = String(result?.error || 'The action could not be completed.').slice(0, 256);
    request.resolve(response);
    if (!response.ok && this.dock.state.mode !== 'error') this.dock.update({ mode: 'error', error: response.error, busy: false });
    return true;
  }

  notifyGameLoss() {
    const contents = this.getMainContents();
    if (contents && !contents.isDestroyed()) contents.send('game-dock:game-lost', { draftId: this.dock?.state.draftId || '' });
  }

  updateCapture(capture, status) {
    if (!capture?.dockDraftId || capture.dockDraftId !== this.dock?.state.draftId || !this.dock) return false;
    if (status?.state === 'saved') {
      this.dock.update({ mode: 'success', capture: null, crop: null, message: 'Portrait and DNA saved.', undoUntil: Date.now() + 12_000, busy: false });
    } else if (status?.state === 'failed') {
      this.dock.update({ mode: 'error', capture: null, error: String(status.message || 'The portrait could not be captured.').slice(0, 256), busy: false });
    } else if (status?.state) {
      this.dock.update({ mode: 'capture', capture: { state: status.state === 'armed' ? 'armed' : status.state, startedAt: status.startedAt || 0, deadline: status.deadline || 0 }, busy: false });
    }
    return true;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.setDraftActive(false);
    this.draftDna = '';
    if (this.pendingRenderer) {
      for (const request of this.pendingRenderer.values()) request.resolve({ ok: false, error: 'The application is closing.' });
      this.pendingRenderer.clear();
    }
    this.dock?.destroy();
    this.dock = null;
  }
}

module.exports = { GameDockService };
