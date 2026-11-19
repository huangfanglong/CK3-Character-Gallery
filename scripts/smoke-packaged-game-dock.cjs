const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function runPackagedGameDock() {
  const asarPath = path.join(path.resolve(process.env.CK3_PACKAGE_DIRECTORY || path.join(__dirname, '..', 'release', 'win-unpacked')), 'resources', 'app.asar');
  const { WindowsGameMonitor } = require(path.join(asarPath, 'electron', 'windows-game-monitor.cjs'));
  const { gameDockBounds, normalizeDockPreferences } = require(path.join(asarPath, 'electron', 'game-dock.cjs'));
  assert.deepEqual(normalizeDockPreferences({ enabled: false, position: 'right', collection: ' Court ' }), { enabled: false, position: 'right', collection: 'Court', liveLink: { decision: 'undecided', enabled: false } });
  assert.deepEqual(gameDockBounds({ clientBounds: { x: -12, y: 42, width: 1920, height: 1032 } }), { x: -12, y: 42, width: 1920, height: 1032 });

  const monitor = new WindowsGameMonitor({ reconcileIntervalMs: 100 });
  try {
    assert.equal(monitor.start(), true, 'The packaged executable could not load Koffi or install the Windows event hooks.');
    assert.equal(monitor.hooks.length, 2);
    assert.equal(monitor.callbacks.length, 2);
    assert.equal(typeof monitor.api.getForegroundWindow, 'function');
    monitor.api.getForegroundWindow();
    monitor.refresh();
  } finally {
    monitor.stop();
  }
  assert.equal(monitor.started, false);
  assert.equal(monitor.hooks.length, 0);
  assert.equal(monitor.callbacks.length, 0);

  const { LiveGameBridge } = require(path.join(asarPath, 'electron', 'live-game-bridge.cjs'));
  const liveBridge = new LiveGameBridge({ workerPath: path.join(asarPath, 'electron', 'live-game-worker.cjs') });
  try {
    assert.equal(await liveBridge.setEnabled(true), true, 'The packaged Live Game Link worker could not start. Enabling alone must not access CK3.');
  } finally {
    await liveBridge.close();
  }
  console.log('Packaged game dock smoke test passed: app.asar loading, native Koffi, Win32 hooks, live-worker startup without game access, preference normalization, and cleanup.');
}

async function main() {
  if (process.platform !== 'win32') return console.log('Packaged game dock smoke test skipped outside Windows.');
  if (process.env.CK3_PACKAGED_GAME_DOCK === '1') return runPackagedGameDock();
  const executable = path.join(path.resolve(process.env.CK3_PACKAGE_DIRECTORY || path.join(__dirname, '..', 'release', 'win-unpacked')), 'CK3 Character Gallery.exe');
  const userDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ck3-packaged-dock-'));
  try {
    const child = spawnSync(executable, [__filename, `--user-data-dir=${userDataDirectory}`], {
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        CK3_PACKAGED_GAME_DOCK: '1',
        CK3_GALLERY_TEST_DATA_DIRECTORY: userDataDirectory,
        ELECTRON_RUN_AS_NODE: '1',
      },
    });
    if (child.stdout) process.stdout.write(child.stdout);
    if (child.stderr) process.stderr.write(child.stderr);
    assert.equal(child.status, 0, `Packaged game dock exited with ${child.status}${child.error ? `: ${child.error.message}` : ''}.`);
  } finally {
    fs.rmSync(userDataDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
