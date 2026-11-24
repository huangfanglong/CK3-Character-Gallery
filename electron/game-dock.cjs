const DOCK_POSITIONS = new Set(['left', 'center', 'right']);
const DOCK_WIDTH = 680;
const DOCK_RESTING_WIDTH = 280;
const DOCK_RESTING_HEIGHT = 6;
const DOCK_COMPACT_HEIGHT = 48;
const DOCK_EXPANDED_HEIGHT = 310;

function normalizeLiveLinkPreferences(preferences = {}) {
  const decision = ['undecided', 'enabled', 'declined'].includes(preferences?.liveLink?.decision) ? preferences.liveLink.decision : 'undecided';
  return { decision, enabled: decision === 'enabled' && preferences?.liveLink?.enabled === true };
}

function normalizeDockPreferences(preferences = {}) {
  return {
    enabled: typeof preferences.enabled === 'boolean' ? preferences.enabled : true,
    position: DOCK_POSITIONS.has(preferences.position) ? preferences.position : 'center',
    collection: typeof preferences.collection === 'string' ? preferences.collection.trim().slice(0, 120) : '',
    liveLink: normalizeLiveLinkPreferences(preferences),
  };
}

function gameDockBounds(game) {
  const bounds = game?.clientBounds || game?.bounds;
  if (![bounds?.x, bounds?.y, bounds?.width, bounds?.height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) return null;
  return { x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) };
}

function shouldShowDock(game, enabled, editing, focused) {
  return Boolean(enabled && (game || (editing && focused)));
}

function dockSurfaceBounds(gameBounds, mode = 'compact', position = 'center', revealed = false) {
  if (!gameBounds) return null;
  const resting = mode === 'compact' && !revealed;
  const width = resting ? Math.min(DOCK_RESTING_WIDTH, Math.max(120, gameBounds.width - 24)) : Math.min(DOCK_WIDTH, Math.max(280, gameBounds.width - 24));
  const height = resting ? DOCK_RESTING_HEIGHT : mode === 'compact' ? DOCK_COMPACT_HEIGHT : Math.min(DOCK_EXPANDED_HEIGHT, Math.max(160, gameBounds.height - 24));
  const availableX = gameBounds.width - width - 24;
  const offset = position === 'left' ? 0 : position === 'right' ? availableX : availableX / 2;
  return { x: Math.round(gameBounds.x + 12 + offset), y: Math.round(gameBounds.y), width, height };
}

function dockHitRegions(gameBounds, mode = 'compact', position = 'center', crop = null, revealed = false) {
  const surface = dockSurfaceBounds(gameBounds, mode, position, revealed);
  if (!surface) return [];
  const regions = [{ x: 0, y: 0, width: surface.width, height: surface.height }];
  if (crop && ['framing', 'ready'].includes(mode)) {
    const side = Math.max(1, crop.size);
    regions.push({ x: Math.round(crop.x), y: Math.round(crop.y), width: Math.round(side), height: Math.round(side) });
  }
  return regions;
}

class GameDock {
  constructor(options) {
    this.BrowserWindow = options.BrowserWindow;
    this.screen = options.screen;
    this.monitor = options.monitor;
    this.htmlPath = options.htmlPath;
    this.preloadPath = options.preloadPath;
    this.onCommand = options.onCommand || (() => ({ ok: false, error: 'The gallery is not ready.' }));
    this.onPreferencesChange = options.onPreferencesChange || (() => {});
    this.onDraftVisibilityChange = options.onDraftVisibilityChange || (() => {});
    this.onGameLoss = options.onGameLoss || (() => {});
    this.logger = options.logger || console;
    this.preferences = normalizeDockPreferences(options.preferences);
    this.window = null;
    this.ready = false;
    this.editing = false;
    this.nativeHitTesting = false;
    this.hitRegions = [];
    this.focusReturnHwnd = '';
    this.game = null;
    this.started = false;
    this.destroyed = false;
    this.lastDraftVisible = false;
    this.state = {
      mode: 'compact',
      visible: false,
      connected: false,
      busy: false,
      collections: [],
      collection: this.preferences.collection,
      position: this.preferences.position,
      draftId: null,
      characterId: null,
      characterName: '',
      dnaReady: false,
      dnaAttached: false,
      message: '',
      error: '',
      capture: null,
      crop: null,
      sourceSize: null,
      shortcut: 'CommandOrControl+Alt+G',
      undoUntil: 0,
      sound: true,
      liveEnabled: this.preferences.liveLink.enabled,
      liveSelectedName: '',
      liveCanApply: false,
      liveApplySource: '',
      liveClipboardFormat: '',
      liveTargetAvailable: false,
      liveDetectedName: '',
      liveTargetName: '',
      liveUndoUntil: 0,
      liveRetry: false,
      liveImported: false,
      commandEpoch: 0,
    };
    this.handleGameChange = (game) => this.setGame(game);
    this.reposition = () => this.positionWindow();
    this.handleBlur = () => {
      if (!this.editing) return;
      this.editing = false;
      this.focusReturnHwnd = '';
      this.window?.setFocusable(false);
      this.refreshVisibility();
    };
  }

  start() {
    if (this.started) return true;
    if (!this.preferences.enabled || this.destroyed) return false;
    this.started = true;
    this.monitor.on('change', this.handleGameChange);
    ['display-added', 'display-removed', 'display-metrics-changed'].forEach((name) => this.screen.on?.(name, this.reposition));
    if (!this.monitor.start()) {
      this.stopListeners();
      return false;
    }
    this.setGame(this.monitor.state);
    return true;
  }

  stopListeners() {
    this.monitor.removeListener('change', this.handleGameChange);
    ['display-added', 'display-removed', 'display-metrics-changed'].forEach((name) => this.screen.removeListener?.(name, this.reposition));
    this.started = false;
  }

  setEnabled(enabled) {
    this.setPreferences({ enabled });
    if (!enabled) {
      this.hide();
      this.monitor.stop();
      this.stopListeners();
      this.setGame(null);
      return false;
    }
    if (!this.destroyed) this.start();
    return this.started;
  }

  syncPreferences(preferences) {
    this.preferences = normalizeDockPreferences({ ...this.preferences, ...preferences });
  }

  setPreferences(preferences) {
    this.syncPreferences(preferences);
    this.update({ position: this.preferences.position });
    if (this.preferences.collection) this.update({ collection: this.preferences.collection });
    this.onPreferencesChange({ ...this.preferences });
  }

  setLibrary(galleries, collection = this.state.collection) {
    const collections = Array.isArray(galleries) ? galleries.map((gallery) => typeof gallery === 'string' ? gallery : gallery?.name).filter((name) => typeof name === 'string' && name.trim()).slice(0, 1000) : [];
    const selected = collections.includes(collection) ? collection : collections.includes(this.preferences.collection) ? this.preferences.collection : collections[0] || '';
    this.update({ collections, collection: selected });
    return selected;
  }

  setGame(game) {
    const previous = this.game;
    this.game = game || null;
    if (previous && (!game || previous.hwnd !== game.hwnd)) this.onGameLoss(this.state.draftId, previous, game || null);
    this.refreshVisibility();
  }

  refreshVisibility() {
    const visible = shouldShowDock(this.game, this.preferences.enabled, this.editing, Boolean(this.window?.isFocused()));
    this.state.connected = Boolean(this.game);
    this.state.visible = visible;
    if (visible) {
      this.ensureWindow();
      this.positionWindow();
      this.window?.showInactive();
      this.present();
    } else this.hide();
    this.syncDraftVisibility();
  }

  syncDraftVisibility() {
    const active = Boolean(this.state.visible && this.state.mode === 'draft' && !this.state.dnaReady);
    if (active === this.lastDraftVisible) return;
    this.lastDraftVisible = active;
    this.onDraftVisibilityChange(active);
  }

  positionWindow() {
    if (!this.window || this.window.isDestroyed()) return;
    const bounds = gameDockBounds(this.game);
    if (!bounds) return;
    this.window.setBounds(bounds, false);
    if (this.nativeHitTesting) this.applyHitRegions(this.hitRegions.length ? this.hitRegions : this.initialHitRegions());
    this.present();
  }

  initialHitRegions() {
    const gameBounds = gameDockBounds(this.game);
    const windowBounds = this.window?.getBounds();
    if (!gameBounds || !windowBounds) return [{ x: 0, y: 0, width: 1, height: 1 }];
    const surface = dockSurfaceBounds(gameBounds, 'compact', this.state.position, false);
    return [{ x: surface.x - gameBounds.x, y: surface.y - gameBounds.y, width: surface.width, height: surface.height }];
  }

  applyHitRegions(regions) {
    if (!this.nativeHitTesting || !this.window || this.window.isDestroyed()) return false;
    const bounds = this.window.getBounds();
    const normalized = [];
    for (const region of Array.isArray(regions) ? regions.slice(0, 8) : []) {
      if (![region?.x, region?.y, region?.width, region?.height].every(Number.isFinite)) continue;
      const left = Math.max(0, Math.floor(region.x));
      const top = Math.max(0, Math.floor(region.y));
      const right = Math.min(bounds.width, Math.ceil(region.x + region.width));
      const bottom = Math.min(bounds.height, Math.ceil(region.y + region.height));
      if (right > left && bottom > top) normalized.push({ x: left, y: top, width: right - left, height: bottom - top });
    }
    this.hitRegions = normalized;
    /* An empty set resets Electron's shape to the entire transparent game window.
       Keep a one-pixel inert region instead while the next renderer state arrives. */
    this.window.setShape(normalized.length ? normalized : [{ x: 0, y: 0, width: 1, height: 1 }]);
    return true;
  }

  ensureWindow() {
    if (this.window && !this.window.isDestroyed()) return;
    this.ready = false;
    const window = new this.BrowserWindow({
      width: 800,
      height: 100,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      title: 'Bloodline CK3 game dock',
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        partition: 'game-dock',
        devTools: false,
        backgroundThrottling: false,
        spellcheck: false,
      },
    });
    this.window = window;
    /* Windows native shapes make only the actual dock and crop controls clickable.
       Unlike whole-window setIgnoreMouseEvents toggles, they remain correct after a
       synthetic mouseleave, a DOM replacement, or a pointer that never moves again. */
    this.nativeHitTesting = process.platform === 'win32' && typeof window.setShape === 'function';
    window.setIgnoreMouseEvents(!this.nativeHitTesting, { forward: !this.nativeHitTesting });
    if (this.nativeHitTesting) this.applyHitRegions(this.initialHitRegions());
    window.setContentProtection(true);
    window.setAlwaysOnTop(true, 'screen-saver');
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on('ipc-message', (event, channel, payload) => {
      if (this.window !== window || event?.senderFrame !== event.sender?.mainFrame) return;
      if (channel === 'game-dock:ready') {
        this.ready = true;
        this.present();
      } else if (channel === 'game-dock:interactive') {
        if (!this.nativeHitTesting && !this.destroyed) window.setIgnoreMouseEvents(!payload, { forward: true });
      } else if (channel === 'game-dock:hit-regions') {
        this.applyHitRegions(payload);
      } else if (channel === 'game-dock:text-input') {
        this.setTextInput(Boolean(payload));
      } else if (channel === 'game-dock:command') {
        void this.receiveCommand(payload, event);
      }
    });
    window.webContents.on('preload-error', (_event, preloadPath, error) => {
      this.logger.error(`Game dock preload failed (${preloadPath}):`, error);
    });
    window.on('blur', this.handleBlur);
    window.on('closed', () => {
      if (this.window === window) { this.window = null; this.ready = false; this.editing = false; }
    });
    window.loadFile(this.htmlPath).catch((error) => this.logger.error('Game dock could not load:', error));
  }

  setTextInput(active) {
    if (!this.window || this.window.isDestroyed() || !this.state.visible) return false;
    this.editing = active;
    if (active) {
      this.focusReturnHwnd = this.game?.hwnd || this.focusReturnHwnd;
      this.window.setFocusable(true);
      this.window.focus();
    } else {
      const focusReturnHwnd = this.focusReturnHwnd || this.game?.hwnd || '';
      this.focusReturnHwnd = '';
      this.window.setFocusable(false);
      this.window.showInactive();
      if (focusReturnHwnd) this.monitor.restoreFocus(focusReturnHwnd);
      this.refreshVisibility();
    }
    return true;
  }

  async receiveCommand(command, event) {
    const operationId = typeof command?.operationId === 'string' ? command.operationId.slice(0, 100) : '';
    let result;
    try {
      if (!operationId || typeof command?.type !== 'string' || !/^[a-z][a-z0-9-]{1,50}$/.test(command.type)) throw new Error('The dock command is invalid.');
      if (!event?.senderFrame || event.senderFrame !== event.sender?.mainFrame) throw new Error('The dock command sender is invalid.');
      result = await this.onCommand({ operationId, type: command.type, payload: command.payload || {} });
    } catch (error) {
      result = { ok: false, error: String(error.message || error).slice(0, 256) };
    }
    if (!this.window?.isDestroyed()) this.window.webContents.send('game-dock:result', { operationId, ...(result || { ok: true }) });
  }

  update(patch) {
    Object.assign(this.state, patch || {});
    this.present();
    this.syncDraftVisibility();
  }

  retirePendingCommands() {
    this.state.commandEpoch = (Number(this.state.commandEpoch) || 0) + 1;
    this.present();
  }

  present() {
    if (!this.ready || !this.window || this.window.isDestroyed()) return;
    this.window.webContents.send('game-dock:state', { ...this.state, preferences: { ...this.preferences } });
  }

  hide() {
    this.editing = false;
    if (this.window && !this.window.isDestroyed()) {
      this.window.setFocusable(false);
      this.window.hide();
    }
    this.state.visible = false;
    this.syncDraftVisibility();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopListeners();
    this.monitor.stop();
    this.onDraftVisibilityChange(false);
    this.lastDraftVisible = false;
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
    this.ready = false;
    this.editing = false;
    this.game = null;
    this.state.visible = false;
    this.state.connected = false;
  }
}

module.exports = {
  GameDock,
  dockHitRegions,
  dockSurfaceBounds,
  gameDockBounds,
  normalizeDockPreferences,
  shouldShowDock,
};
