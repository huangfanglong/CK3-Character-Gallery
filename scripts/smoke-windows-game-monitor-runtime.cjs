const assert = require('node:assert/strict');

const electron = require('electron');

if (!electron.app) {
  const { spawnSync } = require('node:child_process');
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), [__filename], { stdio: 'inherit', env: environment });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} else {
  const { app } = electron;
  const { WindowsGameMonitor } = require('../electron/windows-game-monitor.cjs');

  async function main() {
    const monitor = new WindowsGameMonitor({ reconcileIntervalMs: 250 });
    const changes = [];
    monitor.on('change', (state) => changes.push(state));
    try {
      assert.equal(monitor.start(), true);
      const state = monitor.refresh();
      assert.equal(typeof state?.hwnd === 'string' || state === null, true);
      console.log('Foreground window:', state ? { executable: state.executable, hwnd: state.hwnd, bounds: state.bounds } : 'not CK3');
      await new Promise((resolve) => setTimeout(resolve, 400));
      assert.equal(monitor.started, true);
      console.log(`Windows game monitor runtime passed under Electron; observed ${changes.length} state change(s).`);
    } finally {
      monitor.stop();
    }
  }

  const timeout = setTimeout(() => { console.error('Windows game monitor runtime timed out.'); app.exit(1); }, 10_000);
  app.whenReady().then(main).then(() => {
    clearTimeout(timeout);
    app.quit();
  }).catch((error) => {
    console.error(error);
    clearTimeout(timeout);
    process.exitCode = 1;
    app.quit();
  });
}
