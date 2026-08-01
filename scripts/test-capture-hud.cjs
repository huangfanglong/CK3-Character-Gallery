const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  CaptureHud,
  captureHudBounds,
  formatCaptureShortcut,
  normalizeCaptureHudStatus,
} = require('../electron/capture-hud.cjs');

class FakeWindow extends EventEmitter {
  static instances = [];

  constructor(options) {
    super();
    this.options = options;
    this.webContents = new EventEmitter();
    this.webContents.messages = [];
    this.webContents.send = (channel, payload) => this.webContents.messages.push({ channel, payload });
    this.webContents.setWindowOpenHandler = (handler) => { this.windowOpenHandler = handler; };
    this.calls = [];
    FakeWindow.instances.push(this);
  }

  isDestroyed() { return false; }
  loadFile(file) { this.loadedFile = file; return Promise.resolve(); }
  setAlwaysOnTop(...args) { this.calls.push(['setAlwaysOnTop', ...args]); }
  setContentProtection(...args) { this.calls.push(['setContentProtection', ...args]); }
  setIgnoreMouseEvents(...args) { this.calls.push(['setIgnoreMouseEvents', ...args]); }
  setBounds(...args) { this.calls.push(['setBounds', ...args]); }
  showInactive() { this.calls.push(['showInactive']); }
  hide() { this.calls.push(['hide']); }
  destroy() { this.calls.push(['destroy']); }
}

function main() {
  assert.equal(formatCaptureShortcut('CommandOrControl+Alt+G', 'win32'), 'Ctrl + Alt + G');
  assert.equal(formatCaptureShortcut('CommandOrControl+Shift+R', 'darwin'), 'Cmd + Shift + R');
  assert.deepEqual(captureHudBounds({ workArea: { x: 1920, y: 0, width: 1920, height: 1040 } }), { x: 3512, y: 24, width: 304, height: 72 });
  assert.deepEqual(normalizeCaptureHudStatus({ state: 'recording', startedAt: 1000 }, 'Ctrl + Alt + G'), {
    state: 'recording', label: 'REC', detail: 'Ctrl + Alt + G to stop', shortcut: 'Ctrl + Alt + G', startedAt: 1000, deadline: 0, sound: 'start', hideAfter: 0,
  });
  assert.deepEqual(normalizeCaptureHudStatus({ state: 'matching', deadline: 5000 }, 'Ctrl + Alt + G'), {
    state: 'matching', label: 'LOOP', detail: 'Ctrl + Alt + G again to finish now', shortcut: 'Ctrl + Alt + G', startedAt: 0, deadline: 5000, sound: '', hideAfter: 0,
  });
  assert.equal(normalizeCaptureHudStatus({ state: 'failed', message: '  Encoder\n exploded\t ' }, 'Ctrl + Alt + G').detail, 'Encoder exploded');
  assert.throws(() => normalizeCaptureHudStatus({ state: 'unknown' }, 'Ctrl + Alt + G'), /status is invalid/);

  const displays = [
    { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
    { id: 7, workArea: { x: 1920, y: 0, width: 1920, height: 1040 } },
  ];
  const timers = [];
  const screen = new EventEmitter();
  screen.getAllDisplays = () => displays;
  screen.getPrimaryDisplay = () => displays[0];
  const hud = new CaptureHud({
    BrowserWindow: FakeWindow,
    screen,
    htmlPath: 'capture-hud.html',
    preloadPath: 'capture-hud-preload.cjs',
    platform: 'win32',
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
    clearTimeout: () => {},
  });

  hud.arm('session-1', { displayId: '7', shortcut: 'CommandOrControl+Alt+G' });
  assert.equal(hud.update('other-session', { state: 'armed' }), false);
  assert.equal(hud.update('session-1', { state: 'armed' }), true);
  const window = FakeWindow.instances.at(-1);
  assert.equal(window.options.focusable, false);
  assert.equal(window.options.transparent, true);
  assert.equal(window.options.frame, false);
  assert.equal(window.options.skipTaskbar, true);
  assert.equal(window.options.webPreferences.contextIsolation, true);
  assert.equal(window.options.webPreferences.sandbox, true);
  assert.equal(window.options.webPreferences.nodeIntegration, false);
  assert.equal(window.options.webPreferences.partition, 'capture-hud');
  assert.ok(window.calls.some((call) => call[0] === 'setIgnoreMouseEvents' && call[1] === true));
  assert.ok(window.calls.some((call) => call[0] === 'setContentProtection' && call[1] === true));
  assert.ok(window.calls.some((call) => call[0] === 'setAlwaysOnTop' && call[1] === true && call[2] === 'screen-saver'));
  assert.deepEqual(window.windowOpenHandler(), { action: 'deny' });
  assert.equal(window.webContents.messages.length, 0);

  window.webContents.emit('did-finish-load');
  assert.equal(window.webContents.messages.length, 0);
  window.webContents.emit('ipc-message', {}, 'capture-hud:ready');
  assert.deepEqual(window.webContents.messages.at(-1), {
    channel: 'capture-hud:state',
    payload: { state: 'armed', label: 'READY', detail: 'Ctrl + Alt + G to record', shortcut: 'Ctrl + Alt + G', startedAt: 0, deadline: 0, sound: '', hideAfter: 0 },
  });
  assert.ok(window.calls.some((call) => call[0] === 'setBounds' && JSON.stringify(call[1]) === JSON.stringify({ x: 3512, y: 24, width: 304, height: 72 })));
  assert.ok(window.calls.some((call) => call[0] === 'showInactive'));

  hud.update('session-1', { state: 'recording', startedAt: 1234 });
  assert.equal(window.webContents.messages.at(-1).payload.state, 'recording');
  hud.release('session-1', { state: 'saved' });
  assert.equal(window.webContents.messages.at(-1).payload.state, 'saved');
  assert.equal(timers.at(-1).delay, 2200);
  timers.at(-1).callback();
  assert.equal(window.webContents.messages.at(-1).payload.state, 'hidden');
  assert.deepEqual(window.calls.at(-1), ['hide']);

  hud.destroy();
  assert.deepEqual(window.calls.at(-1), ['destroy']);

  const cancelledHud = new CaptureHud({
    BrowserWindow: FakeWindow,
    screen,
    htmlPath: 'capture-hud.html',
    preloadPath: 'capture-hud-preload.cjs',
    platform: 'win32',
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
    clearTimeout: () => {},
  });
  cancelledHud.arm('cancelled-session', { shortcut: 'CommandOrControl+Alt+G' });
  cancelledHud.update('cancelled-session', { state: 'recording', startedAt: 1234 });
  const cancelledWindow = FakeWindow.instances.at(-1);
  cancelledWindow.webContents.emit('ipc-message', {}, 'capture-hud:ready');
  cancelledHud.release('cancelled-session');
  assert.equal(cancelledWindow.webContents.messages.at(-1).payload.state, 'hidden');
  assert.deepEqual(cancelledWindow.calls.at(-1), ['hide']);
  cancelledHud.destroy();

  const retryHud = new CaptureHud({
    BrowserWindow: FakeWindow,
    screen,
    htmlPath: 'capture-hud.html',
    preloadPath: 'capture-hud-preload.cjs',
    platform: 'win32',
    logger: { error() {} },
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
    clearTimeout: () => {},
  });
  retryHud.arm('retry-session', { shortcut: 'CommandOrControl+Alt+G' });
  retryHud.update('retry-session', { state: 'armed' });
  const brokenWindow = FakeWindow.instances.at(-1);
  brokenWindow.webContents.emit('preload-error', {}, 'capture-hud-preload.cjs', new Error('broken preload'));
  assert.equal(retryHud.window, null);
  assert.equal(timers.at(-1).delay, 100);
  timers.at(-1).callback();
  const replacementWindow = FakeWindow.instances.at(-1);
  assert.notEqual(replacementWindow, brokenWindow);
  replacementWindow.webContents.emit('ipc-message', {}, 'capture-hud:ready');
  assert.equal(replacementWindow.webContents.messages.at(-1).payload.state, 'armed');
  retryHud.destroy();
  console.log('Capture HUD test passed: validation, shortcut labels, display placement, secure window options, session ownership, and terminal-state hiding.');
}

main();
