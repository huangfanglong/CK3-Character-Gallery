const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForPreview(window) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const ready = await window.webContents.executeJavaScript("Boolean(document.querySelector('#capture-video')?.videoWidth && document.querySelector('#capture-selection')?.style.width)");
    if (ready) return;
    await delay(50);
  }
  throw new Error('Precision frame preview did not become drawable.');
}

async function main() {
  const window = new BrowserWindow({
    width: 1100,
    height: 820,
    useContentSize: true,
    show: false,
    backgroundColor: '#0d100f',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  try {
    await window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    await delay(200);
    await window.webContents.executeJavaScript(`(() => {
      state.preview = false;
      localStorage.removeItem('ck3-live-capture-crops-v1');
      state.galleries = [{ name: 'Runtime', characters: [{ id: 'runtime-character', name: 'Ragnhild of Jorvik', images: [], dna: '', tags: [] }] }];
      state.activeGallery = 'Runtime';
      state.activeId = 'runtime-character';
      const source = document.createElement('canvas');
      source.width = 1920;
      source.height = 1080;
      const context = source.getContext('2d');
      context.fillStyle = '#24332b';
      context.fillRect(0, 0, 1920, 1080);
      context.fillStyle = '#131a16';
      context.fillRect(0, 0, 360, 1080);
      context.fillStyle = '#536a59';
      context.fillRect(430, 90, 1420, 70);
      context.fillStyle = '#596c5c';
      context.fillRect(420, 850, 1440, 150);
      context.fillStyle = '#b79372';
      context.beginPath();
      context.arc(1180, 400, 145, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#6c3940';
      context.beginPath();
      context.moveTo(880, 920);
      context.lineTo(1010, 520);
      context.lineTo(1350, 520);
      context.lineTo(1510, 920);
      context.closePath();
      context.fill();
      context.fillStyle = '#e8dcc7';
      context.font = '32px Georgia';
      context.fillText('CRUSADER KINGS III', 50, 70);
      window.__captureFixture = source;
      const stream = source.captureStream(15);
      window.__captureStream = stream;
      state.captureSession = {
        characterId: 'runtime-character', galleryName: 'Runtime',
        sources: [], selectedSourceId: 'runtime-source', stream, phase: 'ready', frames: 0, encodedFrames: 0,
        droppedFrames: 0, timer: null, durationTimer: null, sessionId: 'runtime-session', shortcut: 'CommandOrControl+Alt+G',
        crop: { x: 720, y: 170, size: 800 }, canvas: null, encoder: null, recordingError: null, drawMode: false
      };
      renderLiveCaptureModal();
    })()`);
    await waitForPreview(window);
    await delay(250);
    const layout = JSON.parse(await window.webContents.executeJavaScript(`JSON.stringify((() => {
      const modal = document.querySelector('.capture-modal').getBoundingClientRect();
      const video = document.querySelector('#capture-video');
      const videoRect = video.getBoundingClientRect();
      const selection = document.querySelector('#capture-selection').getBoundingClientRect();
      const scale = Math.min(videoRect.width / video.videoWidth, videoRect.height / video.videoHeight);
      const displayLeft = videoRect.left + (videoRect.width - video.videoWidth * scale) / 2;
      const displayTop = videoRect.top + (videoRect.height - video.videoHeight * scale) / 2;
      const output = document.querySelector('#capture-output');
      const pixel = Array.from(output.getContext('2d').getImageData(225, 225, 1, 1).data);
      return {
        modal: { top: modal.top, right: modal.right, bottom: modal.bottom, left: modal.left },
        selection: { width: selection.width, height: selection.height },
        expectedSelection: {
          left: displayLeft + state.captureSession.crop.x * scale,
          top: displayTop + state.captureSession.crop.y * scale,
          size: state.captureSession.crop.size * scale
        },
        selectionPosition: { left: selection.left, top: selection.top },
        handles: document.querySelectorAll('[data-capture-handle]').length,
        output: { width: output.width, height: output.height, pixel },
        viewport: { width: innerWidth, height: innerHeight }
      };
    })())`));
    assert.equal(layout.handles, 4);
    assert.equal(Math.round(layout.selection.width), Math.round(layout.selection.height));
    assert.ok(Math.abs(layout.selectionPosition.left - layout.expectedSelection.left) < .5, JSON.stringify(layout));
    assert.ok(Math.abs(layout.selectionPosition.top - layout.expectedSelection.top) < .5, JSON.stringify(layout));
    assert.ok(Math.abs(layout.selection.width - layout.expectedSelection.size) < .5, JSON.stringify(layout));
    assert.deepEqual([layout.output.width, layout.output.height], [450, 450]);
    assert.ok(layout.output.pixel[3] > 0);
    assert.ok(layout.modal.left >= 0 && layout.modal.top >= 0 && layout.modal.right <= layout.viewport.width && layout.modal.bottom <= layout.viewport.height);

    window.setContentSize(900, 780);
    await delay(150);
    const resizedAlignment = JSON.parse(await window.webContents.executeJavaScript(`JSON.stringify((() => {
      const video = document.querySelector('#capture-video');
      const videoRect = video.getBoundingClientRect();
      const selection = document.querySelector('#capture-selection').getBoundingClientRect();
      const scale = Math.min(videoRect.width / video.videoWidth, videoRect.height / video.videoHeight);
      const displayLeft = videoRect.left + (videoRect.width - video.videoWidth * scale) / 2;
      const displayTop = videoRect.top + (videoRect.height - video.videoHeight * scale) / 2;
      return { actual: [selection.left, selection.top, selection.width], expected: [displayLeft + state.captureSession.crop.x * scale, displayTop + state.captureSession.crop.y * scale, state.captureSession.crop.size * scale] };
    })())`));
    resizedAlignment.actual.forEach((value, index) => assert.ok(Math.abs(value - resizedAlignment.expected[index]) < .5));

    const interaction = JSON.parse(await window.webContents.executeJavaScript(`JSON.stringify((() => {
      const size = document.querySelector('[data-capture-coordinate="size"]');
      size.value = '99999';
      size.dispatchEvent(new Event('input', { bubbles: true }));
      size.dispatchEvent(new Event('change', { bubbles: true }));
      const committedSize = state.captureSession.crop.size;
      const beforeX = state.captureSession.crop.x;
      document.querySelector('#capture-selection').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
      const restored = savedLiveCaptureCrop(1920, 1080);
      return { displayedSize: size.value, committedSize, beforeX, afterX: state.captureSession.crop.x, restored, crop: state.captureSession.crop };
    })())`));
    assert.equal(interaction.displayedSize, String(interaction.committedSize));
    assert.equal(interaction.afterX, interaction.beforeX + 10);
    assert.deepEqual(interaction.restored, interaction.crop);
    const guardedUi = JSON.parse(await window.webContents.executeJavaScript(`JSON.stringify((() => {
      const capture = state.captureSession;
      const cancel = document.querySelector('.capture-footer [data-action="close-modal"]');
      cancel.focus();
      cancel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
      const trappedFocus = document.activeElement?.classList.contains('modal-close');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true, cancelable: true }));
      localStorage.setItem('ck3-live-capture-crops-v1', 'null');
      rememberLiveCaptureCrop(capture.crop, 1920, 1080);
      const repaired = savedLiveCaptureCrop(1920, 1080);
      localStorage.setItem('ck3-live-capture-crops-v1', '{bad');
      rememberLiveCaptureCrop(capture.crop, 1920, 1080);
      const repairedMalformed = savedLiveCaptureCrop(1920, 1080);
      return { sameCapture: state.captureSession === capture, captureModal: Boolean(document.querySelector('.capture-modal')), trappedFocus, repaired, repairedMalformed };
    })())`));
    assert.equal(guardedUi.sameCapture, true);
    assert.equal(guardedUi.captureModal, true);
    assert.equal(guardedUi.trappedFocus, true);
    assert.deepEqual(guardedUi.repaired, interaction.crop);
    assert.deepEqual(guardedUi.repairedMalformed, interaction.crop);
    if (process.env.CK3_CAPTURE_UI_SCREENSHOT) {
      const image = await window.webContents.capturePage();
      assert.equal(image.isEmpty(), false);
      await fs.writeFile(process.env.CK3_CAPTURE_UI_SCREENSHOT, image.toPNG());
    }
    console.log('Capture UI runtime smoke test passed: precision controls, square geometry, live output pixels, and viewport containment.');
  } finally {
    await window.webContents.executeJavaScript("window.__captureStream?.getTracks().forEach((track) => track.stop())").catch(() => {});
    window.destroy();
  }
}

app.whenReady()
  .then(main)
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => app.quit())
  .catch((error) => { console.error(error); process.exitCode = 1; });
