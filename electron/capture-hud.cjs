const CAPTURE_HUD_WIDTH = 304;
const CAPTURE_HUD_HEIGHT = 72;
const CAPTURE_HUD_MARGIN = 24;
const HIDDEN_CAPTURE_HUD_STATUS = Object.freeze({ state: 'hidden', label: '', detail: '', startedAt: 0, sound: '', hideAfter: 0 });

const CAPTURE_HUD_STATES = {
  armed: { label: 'READY', detail: (shortcut) => `${shortcut} to record`, sound: '', hideAfter: 0 },
  starting: { label: 'STARTING', detail: () => 'Preparing video encoder', sound: '', hideAfter: 0 },
  recording: { label: 'REC', detail: (shortcut) => `${shortcut} to stop`, sound: 'start', hideAfter: 0 },
  saving: { label: 'SAVING', detail: () => 'Encoding live portrait', sound: 'stop', hideAfter: 0 },
  saved: { label: 'SAVED', detail: () => 'Portrait added to gallery', sound: 'success', hideAfter: 2200 },
  failed: { label: 'CAPTURE FAILED', detail: (_shortcut, message) => message || 'The live portrait could not be saved', sound: 'failure', hideAfter: 4500 },
};

function formatCaptureShortcut(shortcut, platform = process.platform) {
  const names = {
    CommandOrControl: platform === 'darwin' ? 'Cmd' : 'Ctrl',
    Command: 'Cmd',
    Control: 'Ctrl',
  };
  return String(shortcut || '').split('+').map((part) => names[part] || part).join(' + ');
}

function cleanCaptureHudMessage(message) {
  return String(message || '').replace(/\s+/g, ' ').trim().slice(0, 96);
}

function normalizeCaptureHudStatus(status, shortcut) {
  const definition = CAPTURE_HUD_STATES[status?.state];
  if (!definition) throw new Error('Capture HUD status is invalid.');
  const safeShortcut = cleanCaptureHudMessage(shortcut);
  const message = cleanCaptureHudMessage(status.message);
  return {
    state: status.state,
    label: definition.label,
    detail: definition.detail(safeShortcut, message),
    shortcut: safeShortcut,
    startedAt: status.state === 'recording' && Number.isFinite(status.startedAt) && status.startedAt > 0 ? status.startedAt : 0,
    sound: definition.sound,
    hideAfter: definition.hideAfter,
  };
}

function captureHudBounds(display, width = CAPTURE_HUD_WIDTH, height = CAPTURE_HUD_HEIGHT, margin = CAPTURE_HUD_MARGIN) {
  const workArea = display.workArea;
  return {
    x: Math.round(workArea.x + workArea.width - width - margin),
    y: Math.round(workArea.y + margin),
    width,
    height,
  };
}

class CaptureHud {
  constructor(options) {
    this.BrowserWindow = options.BrowserWindow;
    this.screen = options.screen;
    this.htmlPath = options.htmlPath;
    this.preloadPath = options.preloadPath;
    this.platform = options.platform || process.platform;
    this.setTimeout = options.setTimeout || global.setTimeout;
    this.clearTimeout = options.clearTimeout || global.clearTimeout;
    this.logger = options.logger || console;
    this.window = null;
    this.loaded = false;
    this.sessionId = null;
    this.displayId = '';
    this.shortcut = '';
    this.status = null;
    this.hideTimer = null;
    this.readyTimer = null;
    this.retryTimer = null;
    this.loadAttempts = 0;
    this.reposition = () => { if (this.status) this.positionWindow(); };
    ['display-added', 'display-removed', 'display-metrics-changed'].forEach((eventName) => this.screen.on?.(eventName, this.reposition));
  }

  arm(sessionId, { displayId = '', shortcut }) {
    if (typeof sessionId !== 'string' || !sessionId || typeof shortcut !== 'string' || !shortcut) throw new Error('Capture HUD session is invalid.');
    this.hideNow();
    this.sessionId = sessionId;
    this.displayId = String(displayId || '');
    this.shortcut = shortcut;
  }

  update(sessionId, status) {
    if (sessionId !== this.sessionId) return false;
    this.status = normalizeCaptureHudStatus(status, formatCaptureShortcut(this.shortcut, this.platform));
    this.ensureWindow();
    if (this.loaded) this.present();
    return true;
  }

  release(sessionId, terminalStatus = null) {
    if (sessionId !== this.sessionId) return false;
    if (terminalStatus) this.update(sessionId, terminalStatus);
    else this.hideNow();
    this.sessionId = null;
    this.displayId = '';
    this.shortcut = '';
    return true;
  }

  ensureWindow() {
    if (this.window && !this.window.isDestroyed()) return;
    this.loaded = false;
    this.loadAttempts += 1;
    const hudWindow = new this.BrowserWindow({
      width: CAPTURE_HUD_WIDTH,
      height: CAPTURE_HUD_HEIGHT,
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
      title: 'CK3 capture status',
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        partition: 'capture-hud',
        devTools: false,
        backgroundThrottling: false,
        spellcheck: false,
      },
    });
    this.window = hudWindow;
    hudWindow.setIgnoreMouseEvents(true);
    hudWindow.setContentProtection(true);
    hudWindow.setAlwaysOnTop(true, 'screen-saver');
    if (this.platform === 'darwin') hudWindow.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });
    hudWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    hudWindow.webContents.on('will-navigate', (event) => event.preventDefault());
    hudWindow.webContents.on('ipc-message', (_event, channel) => {
      if (channel !== 'capture-hud:ready') return;
      if (this.window !== hudWindow) return;
      this.loaded = true;
      this.loadAttempts = 0;
      this.cancelReady();
      this.present();
    });
    hudWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
      this.logger.error(`Capture HUD preload failed (${preloadPath}):`, error);
      this.abandonWindow(hudWindow, true);
    });
    hudWindow.on('closed', () => {
      if (this.window === hudWindow) { this.window = null; this.loaded = false; }
    });
    hudWindow.loadFile(this.htmlPath).catch((error) => {
      this.logger.error('Capture HUD could not load:', error);
      this.abandonWindow(hudWindow, true);
    });
    this.readyTimer = this.setTimeout(() => {
      if (this.window === hudWindow && !this.loaded) this.abandonWindow(hudWindow, true);
    }, 2000);
  }

  abandonWindow(hudWindow, retry) {
    if (this.window !== hudWindow) return;
    this.cancelReady();
    this.window = null;
    this.loaded = false;
    if (!hudWindow.isDestroyed()) hudWindow.destroy();
    if (retry && this.status && this.loadAttempts < 2) {
      if (this.retryTimer) this.clearTimeout(this.retryTimer);
      this.retryTimer = this.setTimeout(() => {
        this.retryTimer = null;
        if (this.status && !this.window) this.ensureWindow();
      }, 100);
    }
  }

  matchingDisplay() {
    return this.screen.getAllDisplays().find((display) => String(display.id) === this.displayId)
      || this.screen.getPrimaryDisplay();
  }

  positionWindow() {
    if (!this.window || this.window.isDestroyed()) return;
    this.window.setBounds(captureHudBounds(this.matchingDisplay()), false);
  }

  present() {
    if (!this.status || !this.window || this.window.isDestroyed()) return;
    this.cancelHide();
    const status = this.status;
    this.positionWindow();
    this.window.webContents.send('capture-hud:state', status);
    this.window.showInactive();
    if (status.hideAfter) {
      this.hideTimer = this.setTimeout(() => {
        if (this.status === status) this.hideNow();
      }, status.hideAfter);
    }
  }

  cancelHide() {
    if (this.hideTimer) this.clearTimeout(this.hideTimer);
    this.hideTimer = null;
  }

  cancelReady() {
    if (this.readyTimer) this.clearTimeout(this.readyTimer);
    this.readyTimer = null;
  }

  hideNow() {
    this.cancelHide();
    const hadStatus = Boolean(this.status);
    this.status = null;
    if (this.window && !this.window.isDestroyed()) {
      if (hadStatus && this.loaded) this.window.webContents.send('capture-hud:state', HIDDEN_CAPTURE_HUD_STATUS);
      this.window.hide();
    }
  }

  destroy() {
    this.cancelHide();
    this.cancelReady();
    if (this.retryTimer) this.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    ['display-added', 'display-removed', 'display-metrics-changed'].forEach((eventName) => this.screen.removeListener?.(eventName, this.reposition));
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
    this.loaded = false;
    this.sessionId = null;
    this.status = null;
  }
}

module.exports = {
  CaptureHud,
  captureHudBounds,
  formatCaptureShortcut,
  normalizeCaptureHudStatus,
};
