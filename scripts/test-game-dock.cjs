const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');

const { GameDock, dockSurfaceBounds, gameDockBounds, gameDockWindowBounds, normalizeDockPreferences, shouldShowDock } = require('../electron/game-dock.cjs');
const { dockSurfacePlacement } = require('../electron/game-dock-geometry.js');

assert.deepEqual(gameDockBounds({ bounds: { x: -20, y: 10, width: 1936, height: 1096 }, clientBounds: { x: -12, y: 42, width: 1920, height: 1032 } }), { x: -12, y: 42, width: 1920, height: 1032 });
assert.deepEqual(gameDockBounds({ bounds: { x: 0, y: 0, width: 1280, height: 720 } }), { x: 0, y: 0, width: 1280, height: 720 });
assert.equal(gameDockBounds({ bounds: null }), null);
const scaledGame = { clientBounds: { x: 120, y: 60, width: 1920, height: 1080 } };
assert.deepEqual(gameDockWindowBounds(scaledGame, { screenToDipRect(window, rect) {
  assert.equal(window, null);
  assert.deepEqual(rect, scaledGame.clientBounds, 'Only the Electron window boundary converts the physical rectangle.');
  return { x: rect.x / 1.5, y: rect.y / 1.5, width: rect.width / 1.5, height: rect.height / 1.5 };
} }), { x: 80, y: 40, width: 1280, height: 720 });
assert.equal(shouldShowDock({ visible: true, minimized: false }, true, false, false), true);
assert.equal(shouldShowDock(null, true, false, false), false);
assert.equal(shouldShowDock(null, true, true, true), true);
assert.equal(shouldShowDock(null, true, true, false), false);
assert.equal(shouldShowDock({ visible: true }, false, false, false), false);
assert.deepEqual(normalizeDockPreferences({ enabled: false, position: 'right', collection: '  Court  ' }), { enabled: false, position: 'right', collection: 'Court', liveLink: { decision: 'undecided', enabled: false } });
assert.deepEqual(normalizeDockPreferences({ enabled: 'no', position: 'invalid', collection: 42 }), { enabled: true, position: 'center', collection: '', liveLink: { decision: 'undecided', enabled: false } });
assert.deepEqual(normalizeDockPreferences({ liveLink: { decision: 'declined', enabled: true } }).liveLink, { decision: 'declined', enabled: false });
assert.deepEqual(normalizeDockPreferences({ liveLink: { decision: 'enabled', enabled: true } }).liveLink, { decision: 'enabled', enabled: true });
assert.equal(normalizeDockPreferences({ collection: 'c'.repeat(120) }).collection.length, 120);
assert.equal(normalizeDockPreferences({ collection: 'c'.repeat(121) }).collection.length, 120, 'Stored preferences cannot exceed the shared collection limit.');
const surfaceGame = { x: 100, y: 50, width: 1920, height: 1080 };
assert.deepEqual(dockSurfaceBounds(surfaceGame), { x: 920, y: 50, width: 280, height: 6 });
assert.deepEqual(dockSurfaceBounds(surfaceGame, 'compact', 'center', true), { x: 720, y: 50, width: 680, height: 48 });

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
    this.webContents.mainFrame = {};
    this.webContents.trustedEvent = { sender: this.webContents, senderFrame: this.webContents.mainFrame };
    this.webContents.send = (channel, value) => this.sent.push({ channel, value });
    this.webContents.setWindowOpenHandler = () => {};
    this.webContents.isDestroyed = () => this.destroyed;
  }
  loadFile() { queueMicrotask(() => this.webContents.emit('ipc-message', this.webContents.trustedEvent, 'game-dock:ready')); return Promise.resolve(); }
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
const cursorGuard = {
  active: false,
  armCalls: [],
  releaseCalls: 0,
  startCalls: 0,
  stopCalls: 0,
  destroyCalls: 0,
  contains: null,
  mouseMove: null,
  start(handler) { this.startCalls += 1; this.mouseMove = handler; return true; },
  stop() { this.stopCalls += 1; this.mouseMove = null; this.release(); },
  arm(bounds, contains) {
    this.armCalls.push({ bounds, contains });
    this.active = true;
    this.contains = contains;
    return true;
  },
  release() {
    const wasActive = this.active;
    this.releaseCalls += 1;
    this.active = false;
    this.contains = null;
    return wasActive;
  },
  destroy() { this.destroyCalls += 1; this.stop(); },
};
const dock = new GameDock({
  BrowserWindow: class extends FakeWindow { constructor(options) { super(options); windows.push(this); } },
  screen,
  monitor,
  htmlPath: path.join(__dirname, '..', 'electron', 'game-dock.html'),
  preloadPath: path.join(__dirname, '..', 'electron', 'game-dock-preload.cjs'),
  cursorGuard,
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
  if (dock.nativeHitTesting) {
    assert.deepEqual(window.shape, [{ x: 812, y: 0, width: 280, height: 8 }], 'Only the narrow resting strip accepts native pointer entry.');
    assert.equal(cursorGuard.startCalls, 1);
    assert.equal(cursorGuard.mouseMove({ x: window.bounds.x + 650, y: window.bounds.y }), false, 'The future expanded footprint does not activate while resting.');
    assert.equal(cursorGuard.active, false);
    assert.equal(cursorGuard.mouseMove({ x: window.bounds.x + 900, y: window.bounds.y }), true, 'Native entry arms before renderer hover IPC.');
    assert.equal(cursorGuard.active, true);
    assert.equal(cursorGuard.contains({ x: window.bounds.x + 900, y: window.bounds.y + 6 }), true, 'The clamped pointer lands inside the resting shape.');
    assert.equal(cursorGuard.contains({ x: window.bounds.x + 900, y: window.bounds.y + 8 }), false);
    dock.releaseCursorGuard();
    cursorGuard.armCalls = [];
  }

  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(window.sent.some((entry) => entry.channel === 'game-dock:state' && entry.value.visible));
  const trustedEvent = window.webContents.trustedEvent;
  const foreignFrameEvent = { sender: window.webContents, senderFrame: {} };
  const ignoreBefore = window.ignoreMouseEvents;
  const shapeBefore = window.shape;
  window.webContents.emit('ipc-message', foreignFrameEvent, 'game-dock:interactive', true);
  window.webContents.emit('ipc-message', foreignFrameEvent, 'game-dock:hit-regions', [{ x: 0, y: 0, width: 500, height: 500 }]);
  window.webContents.emit('ipc-message', foreignFrameEvent, 'game-dock:text-input', true);
  assert.equal(window.ignoreMouseEvents, ignoreBefore, 'A child frame cannot alter dock hit testing.');
  assert.deepEqual(window.shape, shapeBefore, 'A child frame cannot replace native hit regions.');
  assert.equal(window.focused, false, 'A child frame cannot activate dock text input.');
  window.webContents.emit('ipc-message', trustedEvent, 'game-dock:interactive', true);
  window.webContents.emit('ipc-message', trustedEvent, 'game-dock:interactive', false);
  if (dock.nativeHitTesting) {
    assert.equal(window.ignoreMouseEvents, ignoreBefore, 'Synthetic mouse events cannot change native Windows hit testing.');
    window.webContents.emit('ipc-message', trustedEvent, 'game-dock:hit-regions', [
      { x: -10, y: -5, width: 40, height: 20 },
      { x: 10.2, y: 10.2, width: 80.4, height: 30.4 },
      { x: 0, y: 0, width: 0, height: 10 },
      { x: NaN, y: 0, width: 10, height: 10 },
    ]);
    assert.deepEqual(window.shape, [{ x: 0, y: 0, width: 30, height: 15 }, { x: 10, y: 10, width: 81, height: 31 }]);
    window.webContents.emit('ipc-message', trustedEvent, 'game-dock:hit-regions', []);
    assert.deepEqual(window.shape, [{ x: 0, y: 0, width: 1, height: 1 }], 'An empty region list cannot expose the transparent game window.');
    window.webContents.emit('ipc-message', trustedEvent, 'game-dock:hit-regions', [{ x: 100, y: 50, width: 400, height: 60 }]);
    assert.deepEqual(window.shape, [{ x: 100, y: 50, width: 400, height: 60 }]);
  } else {
    assert.equal(window.ignoreMouseEvents[0], true);
  }

  const previousNativeHitTesting = dock.nativeHitTesting;
  dock.nativeHitTesting = true;
  window.webContents.emit('ipc-message', foreignFrameEvent, 'game-dock:hover', true);
  assert.equal(cursorGuard.armCalls.length, 0, 'A child frame cannot arm the cursor guard.');
  window.webContents.emit('ipc-message', trustedEvent, 'game-dock:hover', true);
  assert.equal(cursorGuard.armCalls.length, 0, 'The guard waits for the expanded native shape.');
  window.webContents.emit('ipc-message', trustedEvent, 'game-dock:hover', false);
  window.webContents.emit('ipc-message', trustedEvent, 'game-dock:hit-regions', [
    { x: 620, y: 0, width: 680, height: 48, cursor: true },
    { x: 200, y: 200, width: 100, height: 100, cursor: false },
  ]);
  window.webContents.emit('ipc-message', foreignFrameEvent, 'game-dock:hover', true);
  assert.equal(cursorGuard.active, false, 'A foreign hover cannot engage an expanded dock.');
  window.webContents.emit('ipc-message', trustedEvent, 'game-dock:hover', true);
  assert.equal(cursorGuard.active, true);
  assert.deepEqual(cursorGuard.armCalls[0].bounds, game.clientBounds);
  const containsCursor = cursorGuard.contains;
  assert.equal(containsCursor({ x: window.bounds.x + 700, y: window.bounds.y + 2 }), true);
  assert.equal(containsCursor({ x: window.bounds.x + 20, y: window.bounds.y + 2 }), false, 'Top-edge input outside the dock is not captured.');
  assert.equal(containsCursor({ x: window.bounds.x + 250, y: window.bounds.y + 220 }), false, 'The capture reticle is excluded.');
  window.webContents.emit('ipc-message', foreignFrameEvent, 'game-dock:hover', false);
  assert.equal(cursorGuard.active, true, 'A child frame cannot release trusted dock state.');
  cursorGuard.release();
  window.webContents.emit('ipc-message', trustedEvent, 'game-dock:hit-regions', [{ x: 620, y: 0, width: 680, height: 48, cursor: true }]);
  assert.equal(cursorGuard.active, true, 'A native watchdog exit does not latch out the next dock entry.');
  window.webContents.emit('ipc-message', trustedEvent, 'game-dock:hover', false);
  assert.equal(cursorGuard.active, false);
  window.webContents.emit('ipc-message', trustedEvent, 'game-dock:hover', true);
  assert.equal(cursorGuard.active, true);
  window.emit('blur');
  assert.equal(cursorGuard.active, false, 'Window blur releases clipping.');
  assert.equal(window.focused, false);
  assert.deepEqual(monitor.restoreFocusCalls, [], 'Cursor guarding never transfers window focus.');
  window.webContents.emit('ipc-message', trustedEvent, 'game-dock:hover', true);
  assert.equal(cursorGuard.active, true);
  dock.hide();
  assert.equal(cursorGuard.active, false, 'Hiding the dock releases clipping.');
  dock.refreshVisibility();
  assert.equal(window.visible, true);
  dock.nativeHitTesting = true;
  window.webContents.emit('ipc-message', trustedEvent, 'game-dock:hover', true);
  assert.equal(cursorGuard.active, true);
  window.webContents.emit('ipc-message', trustedEvent, 'game-dock:text-input', true);
  assert.equal(window.focused, true);
  monitor.state = null;
  monitor.emit('change', null);
  assert.equal(window.visible, true, 'A focused text editor remains visible during its explicit focus exception.');
  assert.equal(cursorGuard.active, true, 'Transient CK3 focus loss during text input does not release clipping.');
  assert.equal(dock.gameLosses.length, 0, 'Entering a dock text field is not a game-loss event.');
  window.focused = false;
  window.emit('blur');
  assert.equal(cursorGuard.active, false, 'The subsequent dock blur releases clipping.');
  assert.equal(window.visible, false, 'Losing the editing surface hides the dock over another application.');
  assert.equal(dock.gameLosses.length, 1, 'Alt-Tabbing away from the editing surface still interrupts the workflow.');
  dock.nativeHitTesting = previousNativeHitTesting;

  monitor.state = game;
  monitor.emit('change', game);
  window.webContents.emit('ipc-message', trustedEvent, 'game-dock:text-input', true);
  monitor.state = null;
  monitor.emit('change', null);
  assert.equal(window.visible, true, 'The editing exception survives the Windows foreground update.');
  assert.equal(dock.gameLosses.length, 1, 'Repeated text-field focus does not cancel a new framing session.');
  window.webContents.emit('ipc-message', trustedEvent, 'game-dock:text-input', false);
  assert.deepEqual(monitor.restoreFocusCalls, ['42'], 'Finishing text entry restores the original CK3 HWND even after the dock became foreground.');
  assert.equal(window.focusable, false);

  assert.equal(dock.gameLosses.length, 1, 'Returning focus to CK3 is not another game-loss event.');
  assert.equal(dock.gameLosses[0].previous.hwnd, '42');
  assert.equal(dock.gameLosses[0].current, null);
  window.webContents.emit('ipc-message', foreignFrameEvent, 'game-dock:command', { operationId: 'untrusted', type: 'select-collection', payload: { collection: 'Court' } });
  window.webContents.emit('ipc-message', trustedEvent, 'game-dock:command', { operationId: 'operation-1', type: 'select-collection', payload: { collection: 'Court' } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(commands.length, 1);
  assert.equal(commands[0].type, 'select-collection');
  assert.equal(window.sent.some((entry) => entry.channel === 'game-dock:result' && entry.value.operationId === 'untrusted'), false, 'Foreign frames receive no trusted command response.');
  assert.ok(window.sent.some((entry) => entry.channel === 'game-dock:result' && entry.value.operationId === 'operation-1' && entry.value.ok));

  const moved = { ...game, clientBounds: { ...game.clientBounds, x: 120 } };
  monitor.state = moved;
  monitor.emit('change', moved);
  assert.equal(window.bounds.x, 120);
  dock.nativeHitTesting = true;
  window.webContents.emit('ipc-message', trustedEvent, 'game-dock:hit-regions', [{ x: 620, y: 0, width: 680, height: 48, cursor: true }]);
  window.webContents.emit('ipc-message', trustedEvent, 'game-dock:hover', true);
  assert.equal(cursorGuard.active, true);
  const armsBeforeDisplayChange = cursorGuard.armCalls.length;
  screen.emit('display-metrics-changed');
  assert.equal(window.bounds.x, 120);
  assert.equal(cursorGuard.armCalls.length, armsBeforeDisplayChange, 'An unchanged display does not restart clipping.');
  const movedAgain = { ...moved, clientBounds: { ...moved.clientBounds, x: 140 } };
  monitor.state = movedAgain;
  monitor.emit('change', movedAgain);
  assert.equal(cursorGuard.active, true, 'A game move re-arms the active guard.');
  assert.equal(cursorGuard.armCalls.length, armsBeforeDisplayChange + 1);
  assert.equal(cursorGuard.armCalls.at(-1).bounds.x, 140);
  dock.setPreferences({ position: 'right', collection: 'Court' });
  assert.equal(dock.preferences.position, 'right');
  assert.equal(dock.state.position, 'right');
  dock.setEnabled(false);
  assert.equal(window.visible, false);
  assert.equal(cursorGuard.active, false, 'Disabling the dock releases clipping.');
  assert.equal(monitor.stopCalls, 1);
  dock.setEnabled(true);
  monitor.state = game;
  monitor.emit('change', game);
  assert.equal(window.visible, true);
  dock.nativeHitTesting = true;
  window.webContents.emit('ipc-message', trustedEvent, 'game-dock:hit-regions', [{ x: 620, y: 0, width: 680, height: 48, cursor: true }]);
  window.webContents.emit('ipc-message', trustedEvent, 'game-dock:hover', true);
  assert.equal(cursorGuard.active, true);
  const lossesBeforeDeparture = dock.gameLosses.length;
  monitor.state = null;
  monitor.emit('change', null);
  assert.equal(dock.gameLosses.length, lossesBeforeDeparture + 1, 'A real foreground departure outside text editing still notifies the workflow.');
  dock.destroy();
  assert.equal(cursorGuard.active, false, 'Destroying an active dock releases clipping.');
  assert.equal(cursorGuard.destroyCalls, 1);
  assert.equal(window.destroyed, true);
  assert.equal(monitor.stopCalls, 2);
  assert.equal(screen.listenerCount('display-added'), 0);

  /* Regression: a command issued right after dock text input must not race the
     asynchronous foreground event that repopulates the game. */
  const quietGuard = { active: false, start() { return true; }, stop() {}, arm() { return true; }, check() {}, release() { return false; }, destroy() {} };
  const asyncMonitor = new EventEmitter();
  asyncMonitor.state = game;
  asyncMonitor.start = () => true;
  asyncMonitor.stop = () => {};
  asyncMonitor.restoreFocus = (_hwnd) => {
    setImmediate(() => { asyncMonitor.state = game; asyncMonitor.emit('change', game); });
    return true;
  };
  const asyncDock = new GameDock({ BrowserWindow: class extends FakeWindow {}, screen, monitor: asyncMonitor, htmlPath: '', preloadPath: '', cursorGuard: quietGuard });
  asyncDock.start();
  assert.equal(asyncDock.setTextInput(true), true);
  asyncMonitor.state = null;
  asyncMonitor.emit('change', null);
  assert.equal(asyncDock.game, null, 'The dock owns the foreground while a text field is edited.');
  asyncDock.setTextInput(false);
  assert.equal(asyncDock.game?.hwnd, '42', 'A completed focus restore keeps the game as valid command context until the foreground event lands.');
  assert.equal(asyncDock.state.visible, true, 'The dock no longer hides and rebuilds on text-input exit.');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(asyncDock.game?.hwnd, '42', 'The later foreground event confirms the same game.');
  asyncDock.destroy();

  /* A failed focus restore must not invent a command context. */
  const failedMonitor = new EventEmitter();
  failedMonitor.state = game;
  failedMonitor.start = () => true;
  failedMonitor.stop = () => {};
  failedMonitor.restoreFocus = () => false;
  const failedDock = new GameDock({ BrowserWindow: class extends FakeWindow {}, screen, monitor: failedMonitor, htmlPath: '', preloadPath: '', cursorGuard: quietGuard });
  failedDock.start();
  failedDock.setTextInput(true);
  failedMonitor.state = null;
  failedMonitor.emit('change', null);
  failedDock.setTextInput(false);
  assert.equal(failedDock.game, null, 'A failed focus restore leaves the game context empty.');
  assert.equal(failedDock.state.visible, false, 'The dock still hides when focus could not be returned to CK3.');
  failedDock.destroy();

  /* Regression: a window destroyed mid-command must not throw after the await. */
  const slowMonitor = new EventEmitter();
  slowMonitor.state = game;
  slowMonitor.start = () => true;
  slowMonitor.stop = () => {};
  slowMonitor.restoreFocus = () => true;
  const slowDock = new GameDock({
    BrowserWindow: class extends FakeWindow {}, screen, monitor: slowMonitor, htmlPath: '', preloadPath: '', cursorGuard: quietGuard,
    onCommand: () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 20)),
  });
  slowDock.start();
  const slowWindow = slowDock.window;
  const unhandled = [];
  const onUnhandled = (error) => unhandled.push(error);
  process.on('unhandledRejection', onUnhandled);
  const commandPromise = slowDock.receiveCommand({ operationId: 'op-destroyed', type: 'select-collection' }, slowWindow.webContents.trustedEvent);
  setTimeout(() => slowWindow.destroy(), 5);
  await commandPromise;
  await new Promise((resolve) => setTimeout(resolve, 50));
  process.removeListener('unhandledRejection', onUnhandled);
  assert.equal(unhandled.length, 0, `Destroying the dock mid-command must not leak an unhandled rejection (${unhandled}).`);
  assert.equal(slowWindow.sent.some((entry) => entry.channel === 'game-dock:result'), false, 'No result is sent through a destroyed window.');
  slowDock.destroy();

  /* Small game windows: the native surface and the renderer strip share geometry. */
  const narrow = { x: 500, y: 40, width: 260, height: 700 };
  assert.deepEqual(dockSurfacePlacement(260, 'compact', 'center', true), { x: 12, width: 236 });
  assert.deepEqual(dockSurfaceBounds(narrow, 'compact', 'center', true), { x: 512, y: 40, width: 236, height: 48 }, 'The revealed surface never exceeds the game window.');
  assert.deepEqual(dockSurfaceBounds(narrow, 'framing', 'center', false), { x: 512, y: 40, width: 236, height: 310 }, 'The retracted framing strip matches the renderer in narrow windows.');
  console.log('Game dock controller tests passed: visibility, placement, trusted hover, hit filtering, focus isolation, cursor cleanup, commands, preferences, focus-restore race, destroyed-window commands, and narrow-window geometry.');
  } finally {
    dock.destroy();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
