const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

async function main() {
  const window = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  try {
    await window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    const result = await window.webContents.executeJavaScript(`(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 450;
      canvas.height = 450;
      const context = canvas.getContext('2d');
      const encoder = await createLiveCaptureEncoder({ bufferOnly: true });
      const processor = createLiveCaptureLoopProcessor({ encoder });
      for (let index = 0; index < 18; index += 1) {
        context.fillStyle = 'rgb(' + (20 + index * 6) + ', ' + (70 + index * 4) + ', ' + (110 + index * 3) + ')';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = '#e8dcc7';
        context.beginPath();
        context.arc(80 + index * 12, 225, 70, 0, Math.PI * 2);
        context.fill();
        processor.push(canvas, { sourceTimestamp: index * 33_333, captureTick: index });
      }
      processor.forceFallback();
      const bytes = await processor.finalize();
      const naturalEncoder = await createLiveCaptureEncoder({ bufferOnly: true });
      const naturalProcessor = createLiveCaptureLoopProcessor({ encoder: naturalEncoder });
      for (let index = 0; index < 34; index += 1) {
        const cycle = index % 12;
        context.fillStyle = 'rgb(' + (30 + cycle * 12) + ', ' + (90 + cycle * 6) + ', ' + (140 + cycle * 4) + ')';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = '#e8dcc7';
        context.beginPath();
        context.arc(90 + cycle * 18, 225, 70, 0, Math.PI * 2);
        context.fill();
        naturalProcessor.push(canvas, { sourceTimestamp: index * 33_333, captureTick: index });
        if (index === 29) naturalProcessor.beginSearch({ requestedIndex: 25, deadline: performance.now() + 1_000 });
      }
      if (naturalProcessor.completeSearch() !== 'natural') throw new Error('The periodic sequence did not find a natural loop.');
      const naturalBytes = await naturalProcessor.finalize();
      const inspect = async (videoBytes) => {
        const video = document.createElement('video');
        video.muted = true;
        video.loop = true;
        video.src = URL.createObjectURL(new Blob([videoBytes], { type: 'video/webm' }));
        await new Promise((resolve, reject) => {
          video.addEventListener('loadedmetadata', resolve, { once: true });
          video.addEventListener('error', () => reject(new Error('The encoded loop could not be decoded.')), { once: true });
        });
        let callbacks = 0;
        let wraps = 0;
        let previousMediaTime = -1;
        await video.play();
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('The encoded loop did not wrap twice.')), 5_000);
          const observe = (_now, metadata) => {
            callbacks += 1;
            if (metadata.mediaTime < previousMediaTime) wraps += 1;
            previousMediaTime = metadata.mediaTime;
            if (wraps >= 2) { clearTimeout(timeout); resolve(); }
            else video.requestVideoFrameCallback(observe);
          };
          video.requestVideoFrameCallback(observe);
        });
        video.pause();
        URL.revokeObjectURL(video.src);
        return { bytes: videoBytes.byteLength, duration: video.duration, height: video.videoHeight, width: video.videoWidth, callbacks, wraps };
      };
      return { fallback: await inspect(bytes), natural: await inspect(naturalBytes) };
    })()`);
    for (const loop of [result.fallback, result.natural]) {
      assert.ok(loop.bytes > 0);
      assert.deepEqual([loop.width, loop.height], [450, 450]);
      assert.ok(loop.duration > 0);
      assert.ok(loop.callbacks > 0);
      assert.equal(loop.wraps, 2);
    }
    assert.ok(Math.abs(result.fallback.duration - 12 / 30) < .08, JSON.stringify(result.fallback));
    assert.ok(Math.abs(result.natural.duration - 24 / 30) < .08, JSON.stringify(result.natural));
    console.log('Capture loop runtime smoke test passed: real WebCodecs natural and fallback output decode and native video observes two wraps.');
  } finally {
    window.destroy();
  }
}

app.whenReady()
  .then(main)
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => app.quit())
  .catch((error) => { console.error(error); process.exitCode = 1; });
