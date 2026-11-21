const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');

const { GameDock, dockHitRegions, dockSurfaceBounds, gameDockBounds, normalizeDockPreferences, shouldShowDock } = require('../electron/game-dock.cjs');

assert.deepEqual(gameDockBounds({ bounds: { x: -20, y: 10, width: 1936, height: 1096 }, clientBounds: { x: -12, y: 42, width: 1920, height: 1032 } }), { x: -12, y: 42, width: 1920, height: 1032 });
assert.deepEqual(gameDockBounds({ bounds: { x: 0, y: 0, width: 1280, height: 720 } }), { x: 0, y: 0, width: 1280, height: 720 });
assert.equal(gameDockBounds({ bounds: null }), null);
assert.equal(shouldShowDock({ visible: true, minimized: false }, true, false, false), true);
assert.equal(shouldShowDock(null, true, false, false), false);
assert.equal(shouldShowDock(null, true, true, true), true);
assert.equal(shouldShowDock(null, true, true, false), false);
assert.equal(shouldShowDock({ visible: true }, false, false, false), false);
assert.deepEqual(normalizeDockPreferences({ enabled: false, position: 'right', collection: '  Court  ' }), { enabled: false, position: 'right', collection: 'Court', liveLink: { decision: 'undecided', enabled: false } });
assert.deepEqual(normalizeDockPreferences({ enabled: 'no', position: 'invalid', collection: 42 }), { enabled: true, position: 'center', collection: '', liveLink: { decision: 'undecided', enabled: false } });
assert.deepEqual(normalizeDockPreferences({ liveLink: { decision: 'declined', enabled: true } }).liveLink, { decision: 'declined', enabled: false });
assert.deepEqual(normalizeDockPreferences({ liveLink: { decision: 'enabled', enabled: true } }).liveLink, { decision: 'enabled', enabled: true });
const surfaceGame = { x: 100, y: 50, width: 1920, height: 1080 };
assert.deepEqual(dockSurfaceBounds(surfaceGame), { x: 920, y: 50, width: 280, height: 6 });
assert.deepEqual(dockSurfaceBounds(surfaceGame, 'compact', 'center', true), { x: 720, y: 50, width: 680, height: 48 });
assert.deepEqual(dockHitRegions(surfaceGame), [{ x: 0, y: 0, width: 280, height: 6 }]);
assert.deepEqual(dockHitRegions(surfaceGame, 'compact', 'center', null, true), [{ x: 0, y: 0, width: 680, height: 48 }]);

class FakeWindow extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.destroyed = false;
    this.visible = false;
    this.focused = false;
    this.focusable = options.focusable;
    this.bounds = { x: 0, y: 0, width: options.width, height: options.height };
    this.sent = [];
    this.webContents = new EventEmitter();
    this.webContents.send = (channel, value) => this.sent.push({ channel, value });
    this.webContents.setWindowOpenHandler = () => {};
    this.webContents.isDestroyed = () => this.destroyed;
  }
  loadFile() { queueMicrotask(() => this.webContents.emit('ipc-message', {}, 'game-dock:ready')); return Promise.resolve(); }
  setIgnoreMouseEvents(...args) { this.ignoreMouseEvents = args; }
  setShape(regions) { this.shape = regions; }
  getBounds() { return { ...this.bounds }; }
  setContentProtection(value) { this.contentProtection = value; }
  setAlwaysOnTop(...args) { this.alwaysOnTop = args; }
  setBounds(value) { this.bounds = value; }
  showInactive() { this.visible = true; }
  hide() { this.visible = false; this.focused = false; }
  setFocusable(value) { this.focusable = value; }
  focus() { if (this.focusable) this.focused = true; }
  isFocused() { return this.focused; }
  isDestroyed() { return this.destroyed; }
  isVisible() { return this.visible; }
  destroy() { this.destroyed = true; this.visible = false; this.emit('closed'); }
}
class FakeScreen extends EventEmitter {}

const game = { hwnd: '42', processId: 42, executable: 'ck3.exe', visible: true, minimized: false, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, clientBounds: { x: 8, y: 31, width: 1904, height: 1041 } };
const monitor = new EventEmitter();
monitor.state = null;
monitor.start = () => true;
monitor.stopCalls = 0;
monitor.stop = () => { monitor.stopCalls += 1; monitor.state = null; };
monitor.refresh = () => monitor.state;
monitor.restoreFocus = () => true;
monitor.restoreFocusCalls = [];
const originalRestore = monitor.restoreFocus;
monitor.restoreFocus = (hwnd) => { monitor.restoreFocusCalls.push(hwnd); return originalRestore(hwnd); };
const screen = new FakeScreen();
const windows = [];
const commands = [];
const dock = new GameDock({
  BrowserWindow: class extends FakeWindow { constructor(options) { super(options); windows.push(this); } },
  screen,
  monitor,
  htmlPath: path.join(__dirname, '..', 'electron', 'game-dock.html'),
  preloadPath: path.join(__dirname, '..', 'electron', 'game-dock-preload.cjs'),
  onCommand: (command) => { commands.push(command); return { ok: true }; },
  onGameLoss: (draftId, previous, current) => { dock.gameLosses.push({ draftId, previous, current }); },
});
dock.gameLosses = [];

async function main() {
  try {
    assert.equal(dock.start(), true);
  assert.equal(windows.length, 0, 'The dock window is not created while another app is focused.');
  monitor.state = game;
  monitor.emit('change', game);
  assert.equal(windows.length, 1);
  const window = windows[0];
  assert.deepEqual(window.bounds, game.clientBounds);
  assert.equal(window.visible, true);
  assert.equal(window.focusable, false);
  assert.equal(window.contentProtection, true);
  assert.deepEqual(window.ignoreMouseEvents, process.platform === 'win32' ? [false, { forward: false }] : [true, { forward: true }]);
  assert.equal(window.options.webPreferences.sandbox, true);
  assert.equal(window.options.webPreferences.contextIsolation, true);
  assert.equal(window.options.webPreferences.nodeIntegration, false);

  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(window.sent.some((entry) => entry.channel === 'game-dock:state' && entry.value.visible));
  const ignoreBefore = window.ignoreMouseEvents;
  window.webContents.emit('ipc-message', {}, 'game-dock:interactive', true);
  window.webContents.emit('ipc-message', {}, 'game-dock:interactive', false);
  if (dock.nativeHitTesting) {
    assert.equal(window.ignoreMouseEvents, ignoreBefore, 'Synthetic mouse events cannot change native Windows hit testing.');
    window.webContents.emit('ipc-message', {}, 'game-dock:hit-regions', [
      { x: -10, y: -5, width: 40, height: 20 },
      { x: 10.2, y: 10.2, width: 80.4, height: 30.4 },
      { x: 0, y: 0, width: 0, height: 10 },
      { x: NaN, y: 0, width: 10, height: 10 },
    ]);
    assert.deepEqual(window.shape, [{ x: 0, y: 0, width: 30, height: 15 }, { x: 10, y: 10, width: 81, height: 31 }]);
    window.webContents.emit('ipc-message', {}, 'game-dock:hit-regions', []);
    assert.deepEqual(window.shape, [{ x: 0, y: 0, width: 1, height: 1 }], 'An empty region list cannot expose the transparent game window.');
    window.webContents.emit('ipc-message', {}, 'game-dock:hit-regions', [{ x: 100, y: 50, width: 400, height: 60 }]);
    assert.deepEqual(window.shape, [{ x: 100, y: 50, width: 400, height: 60 }]);
  } else {
    assert.equal(window.ignoreMouseEvents[0], true);
  }

  window.webContents.emit('ipc-message', {}, 'game-dock:text-input', true);
  assert.equal(window.focused, true);
  monitor.state = null;
  monitor.emit('change', null);
  assert.equal(window.visible, true, 'A focused text editor remains visible during its explicit focus exception.');
  window.focused = false;
  window.emit('blur');
  assert.equal(window.visible, false, 'Losing the editing surface hides the dock over another application.');

  monitor.state = game;
  monitor.emit('change', game);
  window.webContents.emit('ipc-message', {}, 'game-dock:text-input', true);
  monitor.state = null;
  monitor.emit('change', null);
  assert.equal(window.visible, true, 'The editing exception survives the Windows foreground update.');
  window.webContents.emit('ipc-message', {}, 'game-dock:text-input', false);
  assert.deepEqual(monitor.restoreFocusCalls, ['42'], 'Finishing text entry restores the original CK3 HWND even after the dock became foreground.');
  assert.equal(window.focusable, false);

  assert.equal(dock.gameLosses.length, 2, 'Leaving CK3 must notify the active workflow.');
  assert.equal(dock.gameLosses[0].previous.hwnd, '42');
  assert.equal(dock.gameLosses[0].current, null);
  assert.equal(dock.gameLosses[1].previous.hwnd, '42');
  const mainFrame = {};
  const trustedEvent = { senderFrame: mainFrame, sender: { mainFrame } };
  window.webContents.emit('ipc-message', {}, 'game-dock:command', { operationId: 'untrusted', type: 'select-collection', payload: { collection: 'Court' } });
  window.webContents.emit('ipc-message', trustedEvent, 'game-dock:command', { operationId: 'operation-1', type: 'select-collection', payload: { collection: 'Court' } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(commands.length, 1);
  assert.equal(commands[0].type, 'select-collection');
  assert.ok(window.sent.some((entry) => entry.channel === 'game-dock:result' && entry.value.operationId === 'untrusted' && !entry.value.ok));
  assert.ok(window.sent.some((entry) => entry.channel === 'game-dock:result' && entry.value.operationId === 'operation-1' && entry.value.ok));

  const moved = { ...game, clientBounds: { ...game.clientBounds, x: 120 } };
  monitor.state = moved;
  monitor.emit('change', moved);
  assert.equal(window.bounds.x, 120);
  screen.emit('display-metrics-changed');
  assert.equal(window.bounds.x, 120);
  dock.setPreferences({ position: 'right', collection: 'Court' });
  assert.equal(dock.preferences.position, 'right');
  assert.equal(dock.state.position, 'right');
  dock.setEnabled(false);
  assert.equal(window.visible, false);
  assert.equal(monitor.stopCalls, 1);
  dock.setEnabled(true);
  monitor.state = game;
  monitor.emit('change', game);
  assert.equal(window.visible, true);
  dock.destroy();
  assert.equal(window.destroyed, true);
  assert.equal(monitor.stopCalls, 2);
  assert.equal(screen.listenerCount('display-added'), 0);
  console.log('Game dock controller tests passed: focus-aware visibility, placement, hit testing, command replies, preferences, and cleanup.');
  } finally {
    dock.destroy();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
