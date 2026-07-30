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

    let becameAudible = false;
    hud.window.webContents.on('audio-state-changed', (event) => { if (event.audible) becameAudible = true; });
    hud.update('runtime-session', { state: 'recording', startedAt: Date.now() - 2200 });
    await delay(350);
    const recording = JSON.parse(await hudSnapshot(hud));
    assert.equal(recording.state, 'beacon recording');
    assert.equal(recording.label, 'REC');
    assert.match(recording.time, /^00:0[2-3]$/);
    assert.equal(recording.timeHidden, false);
    assert.equal(becameAudible, true);

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
    console.log('Capture HUD runtime smoke test passed: isolated preload, non-focusable display, state rendering, elapsed clock, audio cue, and terminal feedback.');
  } finally {
    hud.destroy();
  }
}

app.whenReady()
  .then(main)
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => app.quit())
  .catch((error) => { console.error(error); process.exitCode = 1; });
