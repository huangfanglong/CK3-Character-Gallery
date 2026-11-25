'use strict';
const assert = require('node:assert/strict');
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
    while (!(await predicate())) {
      if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
      await delay(10);
    }
  };

  async function main() {
    if (process.platform !== 'win32') {
      console.log('Native dock click reliability verification is Windows-only; skipped on this platform.');
      return;
    }
    const koffi = require('koffi');
    koffi.struct('DOCK_CLICK_TEST_POINT', { x: 'long', y: 'long' });
    const user32 = koffi.load('user32.dll');
    const mouse = {
      set: user32.func('bool __stdcall SetCursorPos(int32_t x, int32_t y)'),
      get: user32.func('bool __stdcall GetCursorPos(_Out_ DOCK_CLICK_TEST_POINT *point)'),
      event: user32.func('void __stdcall mouse_event(uint32_t flags, uint32_t dx, uint32_t dy, uint32_t data, uintptr_t extraInfo)'),
    };
    const original = { x: 0, y: 0 };
    mouse.get(original);
    const area = screen.getPrimaryDisplay().workArea;
    const background = new BrowserWindow({ x: area.x + 80, y: area.y + 80, width: 1000, height: 700, show: false, title: 'Dock click isolation' });
    let dock;
    try {
      await background.loadURL('data:text/html,<body style="background:%2322232b;color:white;font:20px sans-serif">Isolated dock click test</body>');
      background.show();
      background.focus();
      const bounds = background.getContentBounds();
      const monitor = new EventEmitter();
      monitor.state = { hwnd: '9998', processId: 9998, executable: 'ck3.exe', executablePath: 'C:\\fixture\\ck3.exe', visible: true, minimized: false, bounds, clientBounds: bounds };
      monitor.start = () => true;
      monitor.stop = () => {};
      monitor.restoreFocus = () => true;
      const commands = [];
      const failures = [];
      const attempts = [];
      dock = new GameDock({
        BrowserWindow, screen, monitor,
        htmlPath: path.join(__dirname, '..', 'electron', 'game-dock.html'),
        preloadPath: path.join(__dirname, '..', 'electron', 'game-dock-preload.cjs'),
        preferences: { enabled: true, position: 'center', collection: 'Court', liveLink: { decision: 'enabled', enabled: true } },
        onCommand: ({ type, payload }) => {
          commands.push({ type, payload, at: Date.now() });
          return { ok: true };
        },
      });
      dock.setLibrary(['Court'], 'Court');
      dock.update({ liveTargetAvailable: true, liveDetectedName: 'Aella', liveCanApply: true, quickAddReady: true });
      dock.start();
      await waitFor(() => dock.ready, 'dock ready');
      const window = dock.window;
      assert.equal(dock.nativeHitTesting, true);
      await window.webContents.executeJavaScript(`(() => {
        window.__dockClickTrace = [];
        window.__dockRenderCount = 0;
        const originalRenderDock = renderDock;
        renderDock = (...args) => {
          window.__dockRenderCount += 1;
          return originalRenderDock(...args);
        };
        for (const type of ['pointermove', 'pointerdown', 'pointerup', 'click']) {
          document.addEventListener(type, (event) => {
            if (type === 'pointermove' && event.buttons) return;
            window.__dockClickTrace.push({
              type, at: performance.now(), x: event.clientX, y: event.clientY,
              buttons: event.buttons, pointerId: event.pointerId,
              command: event.target.closest?.('[data-command]')?.dataset.command || '',
              target: event.target.tagName,
              hover: dockPointerHovers.get(event.pointerId)?.button?.dataset.command || null,
              down: dockPointerDowns.has(event.pointerId),
            });
          }, true);
        }
      })()`);
      const move = async (x, y, dwell = 15) => {
        const point = screen.dipToScreenPoint({ x: Math.round(x), y: Math.round(y) });
        mouse.set(point.x - 1, point.y);
        mouse.event(0x0001, 1, 0, 0, 0);
        await delay(dwell);
      };
      const outside = async () => {
        const bounds = window.getBounds();
        await move(bounds.x + 30, bounds.y + 160, 330);
      };
      for (const selector of ['[data-command=quick-add]', '[data-command=live-import]', '[data-command=live-prepare-apply]']) {
        const scenarios = [
          ...[0, 60, 160, 320].map((expansionDwell) => ({ expansionDwell, publish: '' })),
          { expansionDwell: 320, publish: 'after-hover' },
          { expansionDwell: 320, publish: 'after-down' },
        ];
        for (const { expansionDwell, publish } of scenarios) {
          await outside();
          const before = commands.length;
          const traceStart = await window.webContents.executeJavaScript('__dockClickTrace.length');
          const bounds = window.getBounds();
          await move(bounds.x + bounds.width / 2, bounds.y + 2);
          await waitFor(() => window.webContents.executeJavaScript('dockView.revealed').then(Boolean), 'dock reveal');
          await delay(expansionDwell);
          const rect = await window.webContents.executeJavaScript(`document.querySelector('${selector}').getBoundingClientRect().toJSON()`);
          const currentBounds = window.getBounds();
          const x = currentBounds.x + rect.x + rect.width / 2;
          const y = currentBounds.y + rect.y + rect.height / 2;
          await move(x, y);
          const underPointer = await window.webContents.executeJavaScript(`document.elementFromPoint(${rect.x + rect.width / 2},${rect.y + rect.height / 2})?.closest('[data-command]')?.dataset.command || ''`);
          const publishState = async () => {
            const renderCount = await window.webContents.executeJavaScript('__dockRenderCount');
            dock.present();
            await waitFor(() => window.webContents.executeJavaScript(`__dockRenderCount > ${renderCount}`), 'published state render');
          };
          if (publish === 'after-hover') await publishState();
          mouse.event(0x0002, 0, 0, 0, 0);
          await delay(20);
          if (publish === 'after-down') await publishState();
          await delay(20);
          mouse.event(0x0004, 0, 0, 0, 0);
          await delay(140);
          const snapshot = await window.webContents.executeJavaScript(`(() => ({
            pending: dockView.pending,
            revealed: dockView.revealed,
            downs: [...dockPointerDowns],
            hovers: [...dockPointerHovers].map(([id, value]) => ({ id, command: value.button?.dataset.command || null, x: value.x, y: value.y, until: value.until })),
            trace: __dockClickTrace.slice(${traceStart}),
          }))()`);
          const received = commands.length - before;
          const attempt = { selector, expansionDwell, publish, underPointer, received, ...snapshot };
          attempts.push(attempt);
          if (received !== 1) {
            failures.push(attempt);
            console.error('Click mismatch:', JSON.stringify(attempt));
          }
          await waitFor(() => window.webContents.executeJavaScript('!dockView.pending').then(Boolean), 'command completion');
        }
      }
      dock.update({ mode: 'error', error: 'Synthetic click failure', liveRetry: false });
      await waitFor(() => window.webContents.executeJavaScript('Boolean(document.querySelector(".capture-actions [data-command=dismiss]"))'), 'error actions');
      const orphanBefore = commands.length;
      await window.webContents.executeJavaScript(`(() => {
        const selector = '.capture-actions [data-command=dismiss]';
        const hovered = document.querySelector(selector);
        const rect = hovered.getBoundingClientRect();
        const event = (type) => new PointerEvent(type, {
          bubbles: true, cancelable: true, pointerId: 141, button: 0, buttons: 0,
          clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2,
        });
        hovered.dispatchEvent(event('pointermove'));
        renderDock();
        const released = document.querySelector(selector);
        /* Deliberately omit pointerdown, as Windows does for MA_NOACTIVATEANDEAT. */
        released.dispatchEvent(event('pointerup'));
        released.dispatchEvent(event('click'));
      })()`);
      await delay(100);
      const orphanReceived = commands.length - orphanBefore;
      const orphanAttempt = { selector: 'orphaned Dismiss release after DOM replacement', received: orphanReceived };
      attempts.push(orphanAttempt);
      if (orphanReceived !== 1) failures.push(orphanAttempt);
      console.log(JSON.stringify({ attempts: attempts.length, failures, commandCounts: commands.reduce((counts, command) => ({ ...counts, [command.type]: (counts[command.type] || 0) + 1 }), {}) }, null, 2));
      assert.equal(failures.length, 0, 'Every physical click must produce exactly one command.');
      console.log('Dock click reliability passed: rapid first clicks, mid-click state renders, and replaced-node orphan release.');
    } finally {
      dock?.destroy();
      background.destroy();
      mouse.set(original.x, original.y);
    }
  }
  const timeout = setTimeout(() => { console.error('Dock click reliability test timed out.'); app.exit(1); }, 45_000);
  app.whenReady().then(main).then(() => { clearTimeout(timeout); app.quit(); }).catch((error) => {
    console.error(error);
    clearTimeout(timeout);
    app.exit(1);
  });
}
