const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { app, BrowserWindow, screen } = require('electron');
const { CaptureHud } = require('../electron/capture-hud.cjs');

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForHud(hud) {
  const deadline = Date.now() + 5000;
  while (!hud.loaded && Date.now() < deadline) await delay(25);
  if (!hud.loaded) throw new Error('Capture HUD did not finish loading.');
}

async function hudSnapshot(hud) {
  return hud.window.webContents.executeJavaScript(`JSON.stringify({
    state: document.querySelector('#capture-beacon')?.className,
    label: document.querySelector('#capture-label')?.textContent,
    detail: document.querySelector('#capture-detail')?.textContent,
    time: document.querySelector('#capture-time')?.textContent,
    timeHidden: document.querySelector('#capture-time')?.hidden
  })`);
}

async function waitForHudState(hud, state) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const snapshot = JSON.parse(await hudSnapshot(hud));
    if (snapshot.state === state) return snapshot;
    await delay(25);
  }
  throw new Error(`Capture HUD did not reach ${state}.`);
}

async function main() {
  const hud = new CaptureHud({
    BrowserWindow,
    screen,
    htmlPath: path.join(__dirname, '..', 'electron', 'capture-hud.html'),
    preloadPath: path.join(__dirname, '..', 'electron', 'capture-hud-preload.cjs'),
  });
  try {
    const display = screen.getPrimaryDisplay();
    hud.arm('runtime-session', { displayId: String(display.id), shortcut: 'CommandOrControl+Alt+G' });
    hud.update('runtime-session', { state: 'armed' });
    await waitForHud(hud);
    await delay(100);
    assert.equal(hud.window.isVisible(), true);
    assert.equal(hud.window.isFocusable(), false);
    const armed = JSON.parse(await hudSnapshot(hud));
    assert.equal(armed.state, 'beacon armed');
    assert.equal(armed.label, 'READY');
    assert.equal(armed.detail, 'Ctrl + Alt + G to record');
    assert.equal(armed.timeHidden, true);

    await hud.window.webContents.executeJavaScript(`
      window.__hudAudio = { started: 0, stopped: 0, resumed: 0, suspended: 0 };
      window.AudioContext = class {
        constructor() { this.currentTime = 0; this.destination = {}; this.state = 'suspended'; }
        createOscillator() {
          const stats = window.__hudAudio;
          return {
            frequency: { value: 0 }, type: '',
            connect(node) { return node; }, addEventListener() {},
            start() { stats.started += 1; }, stop() { stats.stopped += 1; },
          };
        }
        createGain() {
          return {
            gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
            connect(node) { return node; },
          };
        }
        async resume() { this.state = 'running'; window.__hudAudio.resumed += 1; }
        async suspend() { this.state = 'suspended'; window.__hudAudio.suspended += 1; }
      };
      true;
    `);
    hud.update('runtime-session', { state: 'recording', startedAt: Date.now() - 2200 });
    await delay(350);
    const recording = JSON.parse(await hudSnapshot(hud));
    assert.equal(recording.state, 'beacon recording');
    assert.equal(recording.label, 'REC');
    assert.match(recording.time, /^00:\d{2}$/);
    assert.equal(recording.timeHidden, false);
    const audio = JSON.parse(await hud.window.webContents.executeJavaScript('JSON.stringify(window.__hudAudio)'));
    assert.equal(audio.started, 2);
    assert.equal(audio.resumed, 1);

    hud.update('runtime-session', { state: 'saving' });
    await delay(100);
    assert.equal(JSON.parse(await hudSnapshot(hud)).label, 'SAVING');
    hud.release('runtime-session', { state: 'saved' });
    await delay(100);
    assert.equal(JSON.parse(await hudSnapshot(hud)).label, 'SAVED');

    if (process.env.CK3_CAPTURE_HUD_SCREENSHOT) {
      hud.window.setContentProtection(false);
      const image = await hud.window.webContents.capturePage();
      assert.equal(image.isEmpty(), false);
      await fs.writeFile(process.env.CK3_CAPTURE_HUD_SCREENSHOT, image.toPNG());
    }

    hud.arm('cancelled-session', { displayId: String(display.id), shortcut: 'CommandOrControl+Alt+G' });
    hud.update('cancelled-session', { state: 'recording', startedAt: Date.now() - 2200 });
    await delay(100);
    hud.release('cancelled-session');
    const hidden = await waitForHudState(hud, 'beacon hidden');
    assert.equal(hidden.state, 'beacon hidden');
    assert.equal(hidden.timeHidden, true);
    assert.equal(await hud.window.webContents.executeJavaScript('clockTimer === null'), true);
    assert.equal(await hud.window.webContents.executeJavaScript('audioContext?.state'), 'suspended');
    assert.ok(await hud.window.webContents.executeJavaScript('window.__hudAudio.suspended >= 1'));

    console.log('Capture HUD runtime smoke test passed: isolated preload, non-focusable display, state rendering, elapsed clock, deterministic audio cues, terminal feedback, and hidden-state cleanup.');
  } finally {
    hud.destroy();
  }
}

app.whenReady()
  .then(main)
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => app.quit())
  .catch((error) => { console.error(error); process.exitCode = 1; });
