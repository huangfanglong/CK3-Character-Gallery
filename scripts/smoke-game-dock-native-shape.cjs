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
        if (type === 'set-loop-search') dock.update({ loopSearchSeconds: payload.seconds });
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
      dock.update({ liveTargetAvailable: true, liveDetectedName: 'Aella' });
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

      await hover();
      const collapseStart = report.shapes.length;
      const departureBounds = window.getBounds();
      await move(departureBounds.x + 24, departureBounds.y + 120);
      await window.webContents.executeJavaScript('document.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true, clientX: 24, clientY: 120 }))');
      assert.equal(await window.webContents.executeJavaScript('dockView.revealed'), false, 'Leaving the expanded dock must begin its collapse.');
      assert.ok(report.shapes.slice(collapseStart).some((regions) => regions.some((region) => region.height > 8)), 'The native shape clipped the dock to its resting height before the exit transition could render.');
      await waitFor(() => report.shapes.at(-1)?.every((region) => region.height <= 10 && region.width <= 282), 'Collapsed dock did not reach its resting native shape');
      assert.ok(report.shapes.at(-1).some((region) => region.width >= 280 && region.width <= 282), 'The collapsed native approach area returns to the narrow resting strip.');
      assert.equal(await window.webContents.executeJavaScript('document.querySelector(".dock").getBoundingClientRect().height'), 6, 'The collapsed dock did not reach its resting visual height.');

      const focusedGame = monitor.state;
      window.on('focus', () => { monitor.state = null; monitor.emit('change', null); });
      background.on('focus', () => { monitor.state = focusedGame; monitor.emit('change', focusedGame); });
      monitor.restoreFocus = () => { background.focus(); return true; };
      dock.setPreferences({ position: 'center' });
      const framing = () => ({ mode: 'framing', loopSearchSeconds: 2, crop: { centerX: .5, centerY: .5, size: .35 }, sourceSize: { width: bounds.width, height: bounds.height }, capture: null, busy: false });
      dock.update(framing());
      const clickDurationField = async () => {
        const inputRect = await window.webContents.executeJavaScript(`document.querySelector('#dock-loop-search-seconds').getBoundingClientRect().toJSON()`);
        const inputBounds = window.getBounds();
        await move(inputBounds.x + inputRect.x + inputRect.width * .55, inputBounds.y + inputRect.y + inputRect.height / 2);
        await nativeDownUp();
        await delay(100);
        return window.webContents.executeJavaScript(`({active:document.activeElement?.id,mode:dockState.mode,textInputActive,value:document.querySelector('#dock-loop-search-seconds')?.value})`);
      };
      const clickDurationSpinner = async () => {
        const inputRect = await window.webContents.executeJavaScript(`document.querySelector('#dock-loop-search-seconds').getBoundingClientRect().toJSON()`);
        const inputBounds = window.getBounds();
        await move(inputBounds.x + inputRect.right - 8, inputBounds.y + inputRect.y + inputRect.height * .25);
        await nativeDownUp();
        await delay(100);
      };
      const leaveDurationField = async () => {
        const inputBounds = window.getBounds();
        await move(inputBounds.x + 24, inputBounds.y + 400);
        await delay(400);
        assert.equal(await window.webContents.executeJavaScript('dockView.revealed'), false);
        assert.equal(dock.editing, false, 'Pointer-exit retraction ends temporary native text focus.');
      };
      await hover();
      report.loopSearchLayout = await window.webContents.executeJavaScript(`(()=>{
        const row=document.querySelector('.loop-search-field').getBoundingClientRect();
        const unit=document.querySelector('.loop-search-value > span').getBoundingClientRect();
        const reset=document.querySelector('[data-command=reset-crop]').getBoundingClientRect();
        const keep=document.querySelector('.keep-close-button').getBoundingClientRect();
        const skipButton=document.querySelector('[data-command=finish-without-portrait]');
        const skip=skipButton.getBoundingClientRect();
        const skipTextRange=document.createRange();
        skipTextRange.selectNodeContents(skipButton.firstChild);
        const skipText=skipTextRange.getBoundingClientRect();
        const live=document.querySelector('[data-command=live-capture]').getBoundingClientRect();
        const snapshot=document.querySelector('[data-command=snapshot]').getBoundingClientRect();
        const actions=document.querySelector('.mode-framing .capture-actions').getBoundingClientRect();
        return {rowTop:row.top,rowLeft:row.left,skipTop:skip.top,skipRight:skip.right,skipBottom:skip.bottom,skipTextLeft:skipText.left,rowRight:row.right,unitRight:unit.right,snapshotLeft:snapshot.left,
          resetLeft:reset.left,resetBottom:reset.bottom,keepLeft:keep.left,keepTop:keep.top,liveLeft:live.left,liveTop:live.top,actionsLeft:actions.left,actionsRight:actions.right,snapshotRight:snapshot.right};
      })()`);
      const layout = report.loopSearchLayout;
      assert.ok(layout.rowTop >= layout.skipBottom, `Smooth loop search must sit beneath Skip portrait (${JSON.stringify(layout)}).`);
      assert.ok(Math.abs(layout.rowLeft - layout.skipTextLeft) <= .5, `The Smooth and Skip text must align (${JSON.stringify(layout)}).`);
      assert.ok(layout.unitRight <= layout.rowRight + .5, `The seconds unit must stay inside the moved row (${JSON.stringify(layout)}).`);
      assert.ok(layout.unitRight < layout.snapshotLeft, `The seconds unit must remain clear of Snapshot (${JSON.stringify(layout)}).`);
      assert.ok(layout.keepTop >= layout.resetBottom && Math.abs(layout.keepLeft - layout.resetLeft) <= .5, `Keep & close must sit directly beneath Reset frame (${JSON.stringify(layout)}).`);
      assert.ok(Math.abs(layout.resetLeft - layout.actionsLeft) <= .5 && Math.abs(layout.keepLeft - layout.actionsLeft) <= .5, `Reset frame and Keep & close must remain far left (${JSON.stringify(layout)}).`);
      assert.ok(Math.abs(layout.snapshotRight - layout.actionsRight) <= .5, `The Skip, Live portrait, and Snapshot group must remain far right (${JSON.stringify(layout)}).`);
      assert.ok(Math.abs(layout.liveLeft - layout.skipRight - 8) <= .5 && Math.abs(layout.liveTop - layout.skipTop) <= .5, `Live portrait must sit immediately beside Skip portrait (${JSON.stringify(layout)}).`);
      const initialDurationFocus = await clickDurationField();
      assert.equal(initialDurationFocus.active, 'dock-loop-search-seconds', `The initial native duration click must focus the field (${JSON.stringify(initialDurationFocus)}).`);
      await leaveDurationField();
      await hover();
      const resumedDurationFocus = await clickDurationField();
      assert.equal(resumedDurationFocus.active, 'dock-loop-search-seconds', `The native duration click must work after retraction (${JSON.stringify(resumedDurationFocus)}).`);
      assert.equal(resumedDurationFocus.mode, 'framing');
      assert.equal(resumedDurationFocus.textInputActive, true);
      await clickDurationSpinner();
      assert.equal(await window.webContents.executeJavaScript('dockState.loopSearchSeconds'), 3, 'The native spinner must still change the duration after retraction.');
      await clickDurationSpinner();
      assert.equal(await window.webContents.executeJavaScript('dockState.loopSearchSeconds'), 4, 'Repeated native spinner clicks must remain responsive.');
      await leaveDurationField();
      dock.update({ mode: 'compact', crop: null, sourceSize: null, capture: null, busy: false });
      await delay(80);
      dock.update({ ...framing(), draftId: 'fresh-framing-session' });
      await hover();
      const freshDurationFocus = await clickDurationField();
      assert.equal(freshDurationFocus.active, 'dock-loop-search-seconds', `A fresh framing session must restore duration editing (${JSON.stringify(freshDurationFocus)}).`);
      assert.equal(freshDurationFocus.value, '2');
      await clickDurationSpinner();
      assert.equal(await window.webContents.executeJavaScript('dockState.loopSearchSeconds'), 3, 'The fresh framing session must accept spinner changes.');
      report.durationFocus = { initialDurationFocus, resumedDurationFocus, freshDurationFocus };
      report.passed = true;
      await snapshot('all native controls passed');
      console.log('Native dock input passed: reliable buttons, animated collapse, duration editing after retraction and fresh framing, repeated spinner changes, and seconds-unit spacing.');
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
