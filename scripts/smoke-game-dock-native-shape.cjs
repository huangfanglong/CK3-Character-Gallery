'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const electron = require('electron');

if (!electron.app) {
  const { spawnSync } = require('node:child_process');
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), [__filename], { stdio: 'inherit', env: environment, cwd: path.join(__dirname, '..') });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} else {
  const { app, BrowserWindow, screen } = electron;
  const { GameDock } = require('../electron/game-dock.cjs');
  const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const waitFor = async (predicate, label, timeout = 5000) => {
    const deadline = Date.now() + timeout;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
      await delay(20);
    }
  };

  async function main() {
    if (process.platform !== 'win32') {
      console.log('Native-shape input verification is Windows-only; skipped on this platform.');
      return;
    }
    const koffi = require('koffi');
    koffi.struct('DOCK_TEST_POINT', { x: 'long', y: 'long' });
    const user32 = koffi.load('user32.dll');
    const mouse = {
      set: user32.func('bool __stdcall SetCursorPos(int32_t x, int32_t y)'),
      get: user32.func('bool __stdcall GetCursorPos(_Out_ DOCK_TEST_POINT *point)'),
      event: user32.func('void __stdcall mouse_event(uint32_t flags, uint32_t dx, uint32_t dy, uint32_t data, uintptr_t extraInfo)'),
    };
    const original = { x: 0, y: 0 };
    mouse.get(original);
    const area = screen.getPrimaryDisplay().workArea;
    const background = new BrowserWindow({ x: area.x + 80, y: area.y + 80, width: 1000, height: 700, show: false, title: 'Dock input isolation' });
    await background.loadURL('data:text/html,<body style="background:%2322232b;color:white;font:20px sans-serif">Isolated dock input test</body>');
    background.show();
    background.focus();
    const bounds = background.getContentBounds();
    const monitor = new EventEmitter();
    monitor.state = { hwnd: '9999', processId: 9999, executable: 'ck3.exe', executablePath: 'C:\\fixture\\ck3.exe', visible: true, minimized: false, bounds, clientBounds: bounds };
    monitor.start = () => true;
    monitor.stop = () => {};
    monitor.restoreFocus = () => true;
    const commands = [];
    const report = { commands, shapes: [], states: [] };
    const dock = new GameDock({
      BrowserWindow, screen, monitor,
      htmlPath: path.join(__dirname, '..', 'electron', 'game-dock.html'),
      preloadPath: path.join(__dirname, '..', 'electron', 'game-dock-preload.cjs'),
      preferences: { enabled: true, position: 'center', collection: 'Court', liveLink: { decision: 'enabled', enabled: true } },
      onCommand: ({ type, payload }) => {
        commands.push({ type, payload, at: Date.now() });
        if (type === 'live-import') {
          /* Reproduce the worst ordering: the error is visible while Import's own
             IPC promise remains unsettled. Dismiss must not wait for this promise. */
          dock.update({ mode: 'error', error: 'Synthetic import failure', liveRetry: true, busy: false });
          return new Promise(() => {});
        }
        if (type === 'live-retry') {
          dock.update({ mode: 'error', error: 'Synthetic retry failure', liveRetry: true, busy: false });
          return { ok: false, error: 'Synthetic retry failure' };
        }
        if (type === 'live-cancel') {
          dock.update({ mode: 'compact', liveRetry: false, error: '', commandEpoch: dock.state.commandEpoch + 1 });
          return { ok: true, cancelled: true };
        }
        if (type === 'set-position') dock.setPreferences({ position: payload.position });
        return { ok: true };
      },
    });
    let window;
    const snapshot = async (label) => {
      report.states.push({ label, mode: dock.state.mode, renderer: await window.webContents.executeJavaScript('({ dockView, interactive })') });
    };
    const move = async (x, y) => {
      const point = screen.dipToScreenPoint({ x: Math.round(x), y: Math.round(y) });
      mouse.set(point.x - 1, point.y);
      mouse.event(0x0001, 1, 0, 0, 0);
      await delay(90);
    };
    const nativeDownUp = async () => {
      mouse.event(0x0002, 0, 0, 0, 0);
      await delay(40);
      mouse.event(0x0004, 0, 0, 0, 0);
    };
    const hover = async () => {
      const gameBounds = window.getBounds();
      await move(gameBounds.x + gameBounds.width / 2, gameBounds.y + 2);
      const deadline = Date.now() + 5000;
      while (!(await window.webContents.executeJavaScript('dockView.revealed'))) {
        if (Date.now() > deadline) throw new Error('Timed out: renderer hover state');
        await delay(20);
      }
      await delay(320);
    };
    const nativeClick = async (selector, syntheticLeave = false) => {
      await hover();
      const gameBounds = window.getBounds();
      const rect = await window.webContents.executeJavaScript(`document.querySelector('${selector}')?.getBoundingClientRect().toJSON()`);
      assert.ok(rect, `${selector} was not rendered`);
      await move(gameBounds.x + rect.x + rect.width / 2, gameBounds.y + rect.y + rect.height / 2);
      if (syntheticLeave) {
        await window.webContents.executeJavaScript('document.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true, clientX: 20, clientY: 400 }))');
        assert.equal(await window.webContents.executeJavaScript('interactive'), false);
        await snapshot('synthetic leave with stationary pointer over button');
      }
      const before = commands.length;
      await nativeDownUp();
      await waitFor(() => commands.length > before, `${selector} native click produced no command`);
    };

    try {
      dock.setLibrary(['Court'], 'Court');
      dock.start();
      await waitFor(() => dock.ready, 'dock ready');
      window = dock.window;
      assert.equal(dock.nativeHitTesting, true);
      const nativeShape = window.setShape.bind(window);
      window.setShape = (regions) => { report.shapes.push(regions); return nativeShape(regions); };
      const nativeIgnore = window.setIgnoreMouseEvents.bind(window);
      const ignoreCalls = [];
      window.setIgnoreMouseEvents = (...args) => { ignoreCalls.push(args); return nativeIgnore(...args); };
      const nativeDrag = async (start, dx, dy) => {
        await move(start.x, start.y);
        mouse.event(0x0002, 0, 0, 0, 0);
        await delay(50);
        for (let step = 1; step <= 8; step += 1) await move(start.x + dx * step / 8, start.y + dy * step / 8);
        mouse.event(0x0004, 0, 0, 0, 0);
        await delay(150);
      };

      /* The first press on a new focusable:false window is the one Windows may eat.
         Exercise real native move and resize before any dock button has been used. */
      dock.update({ mode: 'framing', crop: { centerX: .5, centerY: .5, size: .35 }, sourceSize: { width: bounds.width, height: bounds.height }, capture: null, busy: false });
      await delay(120);
      let cropBefore = await window.webContents.executeJavaScript('({ ...dockState.crop })');
      let cropRect = await window.webContents.executeJavaScript('cropRect()');
      const moveBounds = window.getBounds();
      await nativeDrag({ x: moveBounds.x + cropRect.x + cropRect.size / 2, y: moveBounds.y + cropRect.y + cropRect.size / 2 }, 48, 32);
      let cropAfter = await window.webContents.executeJavaScript('({ ...dockState.crop })');
      assert.notDeepEqual(cropAfter, cropBefore, 'The first native crop drag must move the frame.');
      assert.ok(commands.some((command) => command.type === 'crop-change'), 'Native crop movement must persist on release.');

      cropBefore = cropAfter;
      cropRect = await window.webContents.executeJavaScript('cropRect()');
      const resizeBounds = window.getBounds();
      await nativeDrag({ x: resizeBounds.x + cropRect.x, y: resizeBounds.y + cropRect.y }, 36, 24);
      cropAfter = await window.webContents.executeJavaScript('({ ...dockState.crop })');
      assert.ok(cropAfter.size < cropBefore.size, 'The first native corner drag must resize the frame.');
      assert.equal(await window.webContents.executeJavaScript('drag'), null, 'Crop drag state must be released.');
      dock.update({ mode: 'compact', crop: null, sourceSize: null, capture: null, busy: false });
      await delay(80);

      await nativeClick('[data-command=live-import]');
      await waitFor(() => dock.state.mode === 'error', 'Import error');
      assert.equal(await window.webContents.executeJavaScript('dockView.pending'), false, 'A reported error must release its Import pending state.');
      await nativeClick('.capture-actions [data-command=live-cancel]', true);
      await waitFor(() => dock.state.mode === 'compact', 'Dismiss after synthetic leave');
      assert.equal(commands.at(-1).type, 'live-cancel');

      await nativeClick('[data-command=live-import]');
      await nativeClick('.dock-heading [data-command=live-cancel]', true);
      await waitFor(() => dock.state.mode === 'compact', 'Error X after synthetic leave');

      await nativeClick('[data-command=live-import]');
      await nativeClick('[data-command=live-retry]', true);
      assert.equal(commands.at(-1).type, 'live-retry');
      await nativeClick('.capture-actions [data-command=live-cancel]');
      await waitFor(() => dock.state.mode === 'compact', 'Retry error dismissal');

      await hover();
      let rect = await window.webContents.executeJavaScript('document.querySelector("[data-command=toggle-menu]").getBoundingClientRect().toJSON()');
      let gameBounds = window.getBounds();
      await move(gameBounds.x + rect.x + rect.width / 2, gameBounds.y + rect.y + rect.height / 2);
      await nativeDownUp();
      const menuDeadline = Date.now() + 5000;
      while (!(await window.webContents.executeJavaScript('Boolean(document.querySelector(".popover.menu"))'))) {
        if (Date.now() > menuDeadline) throw new Error('Timed out: native menu opening');
        await delay(20);
      }
      await nativeClick('[data-command=set-position][data-position=left]', true);
      assert.equal(dock.state.position, 'left');
      assert.equal(await window.webContents.executeJavaScript('dockView.pending'), false);
      assert.equal(ignoreCalls.length, 0, 'Native shapes never toggle whole-window click-through.');
      assert.ok(report.shapes.some((regions) => regions.some((region) => region.height >= 48)), 'Expanded native regions reached Windows.');
      report.passed = true;
      await snapshot('all native controls passed');
      console.log('Native dock input passed: stationary Dismiss, X, Try again, and menu clicks after synthetic mouseleave; pending-error recovery also passed.');
    } finally {
      const reportPath = path.join(__dirname, '..', 'reference', 'dock-native-shape-verification.json');
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
      dock.destroy();
      background.destroy();
      mouse.set(original.x, original.y);
    }
  }
  app.whenReady().then(main).then(() => app.quit()).catch((error) => {
    console.error(error);
    app.exit(1);
  });
}
