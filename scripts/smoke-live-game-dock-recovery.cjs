const assert = require('node:assert/strict');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const electron = require('electron');
const { GameDock } = require('../electron/game-dock.cjs');
const { GameDockService } = require('../electron/game-dock-service.cjs');
const { LiveGameBridge } = require('../electron/live-game-bridge.cjs');

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(predicate, message) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await delay(20);
  }
}

async function main() {
  const { app, BrowserWindow, screen } = electron;
  await app.whenReady();
  const area = screen.getPrimaryDisplay().workArea;
  /* Keep every native click over an isolated test window, never the running CK3. */
  const background = new BrowserWindow({ x: area.x + 60, y: area.y + 60, width: 1200, height: 800, show: false, title: 'Live dock recovery isolation' });
  await background.loadURL('data:text/html,<body style="background:%2322232b;color:white;font:20px sans-serif">Isolated live dock recovery</body>');
  background.show();
  background.focus();
  const isolatedBounds = background.getContentBounds();
  const game = {
    hwnd: '424242', processId: 1073741822, executable: 'ck3.exe',
    executablePath: path.win32.join('C:', 'fixture', 'ck3.exe'),
    visible: true, minimized: false, bounds: isolatedBounds, clientBounds: isolatedBounds,
  };
  const monitor = new EventEmitter();
  monitor.state = game;
  monitor.start = () => true;
  monitor.stop = () => {};
  monitor.restoreFocus = () => true;
  let service;
  const contents = { id: 7, mainFrame: {}, isDestroyed: () => false, send(channel, value) {
    if (channel === 'game-dock:command') queueMicrotask(() => service.completeRendererResult({ sender: contents, senderFrame: contents.mainFrame }, value.operationId, { ok: true }));
  } };
  const dock = new GameDock({
    BrowserWindow, screen, monitor,
    htmlPath: path.join(__dirname, '..', 'electron', 'game-dock.html'),
    preloadPath: path.join(__dirname, '..', 'electron', 'game-dock-preload.cjs'),
    preferences: { enabled: true, position: 'center', collection: 'Court', liveLink: { decision: 'enabled', enabled: true } },
    logger: { error() {} },
  });
  const liveBridge = new LiveGameBridge({ logger: { error() {} } });
  /* Only target detection is synthetic. Worker startup and Import still cross the
     real bridge and fail at the intentionally nonexistent CK3 process boundary. */
  liveBridge.detect = async () => ({ target: { id: 1, name: 'Aella', nameIsKey: true } });
  let clipboardText = '';
  service = new GameDockService({
    dock, liveBridge, clipboard: { readText: () => clipboardText }, getMainContents: () => contents,
    createId: () => 'draft-recovery', logger: { error() {} },
    preferences: { enabled: true, position: 'center', collection: 'Court', liveLink: { decision: 'enabled', enabled: true } },
  });
  dock.onCommand = (command) => service.handleCommand(command);
  dock.onPreferencesChange = (preferences) => service.preferencesChanged(preferences);
  dock.onDraftVisibilityChange = (active) => service.setDraftActive(active);
  dock.onGameLoss = () => service.notifyGameLoss();
  service.mainWindowWebContentsId = contents.id;
  let restorePointer = () => {};
  const nativeMouse = process.platform === 'win32' ? (() => {
    const koffi = require('koffi');
    koffi.struct('CK3_TEST_POINT', { x: 'long', y: 'long' });
    const user32 = koffi.load('user32.dll');
    return {
      setPosition: user32.func('bool __stdcall SetCursorPos(int32_t x, int32_t y)'),
      getPosition: user32.func('bool __stdcall GetCursorPos(_Out_ CK3_TEST_POINT *point)'),
      event: user32.func('void __stdcall mouse_event(uint32_t flags, uint32_t dx, uint32_t dy, uint32_t data, uintptr_t extraInfo)'),
    };
  })() : null;

  try {
    if (nativeMouse) {
      const original = { x: 0, y: 0 };
      nativeMouse.getPosition(original);
      restorePointer = () => nativeMouse.setPosition(original.x, original.y);
    }
    await service.start();
    dock.setLibrary(['Court'], 'Court');
    await waitFor(() => dock.ready, 'The real dock did not become ready.');
    await delay(100);
    const window = dock.window;
    const ignoreCalls = [];
    const shapeCalls = [];
    const commands = [];
    const setIgnoreMouseEvents = window.setIgnoreMouseEvents.bind(window);
    window.setIgnoreMouseEvents = (ignore, options) => {
      ignoreCalls.push({ ignore, options, at: Date.now() });
      return setIgnoreMouseEvents(ignore, options);
    };
    const setShape = window.setShape.bind(window);
    window.setShape = (regions) => {
      shapeCalls.push({ regions, at: Date.now() });
      return setShape(regions);
    };
    const handleCommand = dock.onCommand;
    dock.onCommand = async (command) => {
      commands.push({ type: command.type, operationId: command.operationId, at: Date.now() });
      return handleCommand(command);
    };
    await waitFor(() => service.liveBridge.worker, 'The initial live worker did not start.');

    /* Simulate an unexpected worker exit. No CK3 process exists at the synthetic PID;
       the command must fail safely before any game process or executable is accessed. */
    service.liveBridge.worker.emit('error', new Error('Synthetic unexpected worker restart'));
    await waitFor(() => !service.liveBridge.worker, 'The interrupted worker was not retired.');
    const click = async (selector) => {
      const result = await window.webContents.executeJavaScript(`(() => { const button = document.querySelector('${selector}'); if (!button) return { clicked: false, state: dockState, text: document.body.innerText }; button.click(); return { clicked: true }; })()`);
      assert.equal(result.clicked, true, `${selector} was not clickable: ${JSON.stringify(result)}`);
    };
    const movePointer = (x, y) => {
      const point = screen.dipToScreenPoint({ x: Math.round(x), y: Math.round(y) });
      nativeMouse.setPosition(point.x - 1, point.y);
      nativeMouse.event(0x0001, 1, 0, 0, 0);
      return point;
    };
    const nativeClick = async (selector) => {
      if (!nativeMouse) return click(selector);
      const bounds = window.getBounds();
      const started = Date.now();
      const commandCount = commands.length;
      const hoverPoint = movePointer(bounds.x + bounds.width / 2, bounds.y + 2);
      let targetPoint = hoverPoint;
      const nativeReady = (rect = null) => {
        if (!dock.nativeHitTesting) return ignoreCalls.at(-1)?.ignore === false;
        return shapeCalls.some((call) => call.at >= started && call.regions.some((region) => {
          if (!rect) return region.width >= 200 && region.height >= 48;
          const x = rect.x + rect.width / 2;
          const y = rect.y + rect.height / 2;
          return x >= region.x && x < region.x + region.width && y >= region.y && y < region.y + region.height;
        }));
      };
      const diagnostics = async () => {
        const actual = { x: 0, y: 0 };
        nativeMouse.getPosition(actual);
        const details = await window.webContents.executeJavaScript(`(() => { const rect = document.querySelector('.dock')?.getBoundingClientRect(); return { dockRect: rect?.toJSON(), view: dockView, state: dockState, interactive, width: innerWidth, height: innerHeight }; })()`);
        return { bounds, hoverPoint, targetPoint, actual, ignoreCalls: ignoreCalls.filter((call) => call.at >= started), shapeCalls: shapeCalls.filter((call) => call.at >= started), commands: commands.slice(commandCount), details };
      };
      try {
        await waitFor(() => nativeReady(), 'The main process did not expose the dock after hover.');
        await delay(320);
        const rect = await window.webContents.executeJavaScript(`(() => { const button = document.querySelector('${selector}'); if (!button) return null; const rect = button.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, disabled: button.disabled }; })()`);
        assert.ok(rect && !rect.disabled, `${selector} was not available for a native click.`);
        targetPoint = movePointer(bounds.x + rect.x + rect.width / 2, bounds.y + rect.y + rect.height / 2);
        await delay(16);
        const actual = { x: 0, y: 0 };
        nativeMouse.getPosition(actual);
        assert.ok(Math.abs(actual.x - targetPoint.x) <= 2 && Math.abs(actual.y - targetPoint.y) <= 2,
          `The physical pointer moved before mouse-down (expected ${targetPoint.x},${targetPoint.y}; got ${actual.x},${actual.y}). Rerun without moving the mouse.`);
        await waitFor(() => nativeReady(rect), 'The native shape does not include the button.');
        if (!dock.nativeHitTesting) assert.equal(await window.webContents.executeJavaScript('interactive'), true);
        nativeMouse.event(0x0002, 0, 0, 0, 0);
        await delay(40);
        nativeMouse.event(0x0004, 0, 0, 0, 0);
        await waitFor(() => commands.length > commandCount, 'The native click produced no dock command.');
      } catch (error) {
        throw new Error(`${selector}: ${error.message}\n${JSON.stringify(await diagnostics(), null, 2)}`);
      }
    };
    await click('[data-command=live-import]');
    await waitFor(() => dock.state.mode === 'error', 'The first Import did not report a result.');
    const firstError = dock.state.error;

    /* These are the same service methods invoked by the actual File-menu IPC handlers. */
    await service.setLiveLinkEnabled(false);
    await service.setLiveLinkChoice(true);
    await delay(60);
    assert.equal(await window.webContents.executeJavaScript('dockView.pending'), false, 'File off/on must release the dock pending state.');
    clipboardText = Buffer.alloc(80, 65).toString('base64');
    service.syncQuickAddClipboard();
    await delay(40);
    assert.equal(await window.webContents.executeJavaScript('document.querySelector("[data-command=quick-add]").disabled'), false, 'Eligible clipboard DNA keeps Quick Add clickable after File off/on.');

    await nativeClick('[data-command=live-import]');
    await waitFor(() => dock.state.mode === 'error', 'The post-toggle Import did not report a result.');
    const secondError = dock.state.error;
    await nativeClick('.capture-actions [data-command=live-cancel]');
    await waitFor(() => dock.state.mode === 'compact', 'The Import error did not dismiss.');
    await nativeClick('[data-command=live-import]');
    await waitFor(() => dock.state.mode === 'error', 'The third Import did not report a result.');
    await nativeClick('[data-command=live-retry]');
    await waitFor(() => service.pending.size === 0 && !service.mutation, 'Try again did not finish its operation.');
    assert.match(dock.state.error, /could not be opened for read-only DNA access/i, 'Try again should reach the synthetic access boundary.');
    await nativeClick('.dock-heading [data-command=live-cancel]');
    await waitFor(() => dock.state.mode === 'compact', 'The error close button did not dismiss the panel.');
    await nativeClick('[data-command=quick-add]');
    await waitFor(() => dock.state.mode === 'draft', 'Quick Add did not open a draft after File off/on.');
    await nativeClick('.dock-heading [data-command=discard-draft]');
    await waitFor(() => dock.state.mode === 'compact', 'The Quick Add draft did not close.');

    assert.doesNotMatch(firstError, /turned off/i, `A fresh worker received Import before its enable handshake: ${firstError}`);
    assert.match(firstError, /could not be opened for read-only DNA access/i, 'The first Import should reach the synthetic access boundary, not report a preference mismatch.');
    assert.doesNotMatch(secondError, /turned off/i, `File off/on left the replacement worker disabled: ${secondError}`);
    assert.match(secondError, /could not be opened for read-only DNA access/i);

    if (nativeMouse) {
      await waitFor(() => service.pending.size === 0 && !service.mutation, 'The final cancellation did not settle.');
      await delay(100);
      const bounds = window.getBounds();
      /* Re-hover after pending clears, then verify a definite physical departure. */
      movePointer(bounds.x + bounds.width / 2, bounds.y + 2);
      await delay(320);
      movePointer(bounds.x + 24, bounds.y + 120);
      await waitFor(() => dock.nativeHitTesting
        ? shapeCalls.at(-1)?.regions.every((region) => region.height <= 10 && region.width <= 282)
        : ignoreCalls.at(-1)?.ignore === true, 'Leaving the dock did not restore its inert hit region.');
      await delay(250);
      assert.equal(await window.webContents.executeJavaScript('dockView.revealed'), false, 'Leaving the dock did not fold the menu.');
      assert.equal(await window.webContents.executeJavaScript('document.querySelector(".dock").getBoundingClientRect().height'), 6, 'The resting strip did not return.');
    }
    console.log('Live dock recovery passed: worker handshake, preference-toggle service path, native Import and Quick Add, and native-shape cleanup.');
  } finally {
    service.destroy();
    background.destroy();
    restorePointer();
  }
}

if (!electron.app) {
  const { spawnSync } = require('node:child_process');
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), [__filename], { stdio: 'inherit', env: environment });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} else {
  main().then(() => electron.app.quit()).catch((error) => {
    console.error(error);
    electron.app.exit(1);
  });
}
