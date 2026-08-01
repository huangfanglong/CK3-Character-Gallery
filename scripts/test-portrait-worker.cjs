const assert = require('node:assert/strict');
const path = require('node:path');
const { GIFEncoder, applyPalette, quantize } = require('gifenc');
const { PortraitWorkerClient } = require('../electron/portrait-worker-client.cjs');

function animatedFixture(width = 4, height = 3, frameCount = 2) {
  const gif = GIFEncoder();
  for (let frame = 0; frame < frameCount; frame += 1) {
    const rgba = new Uint8Array(width * height * 4);
    for (let index = 0; index < width * height; index += 1) {
      rgba.set([(frame * 31 + index) % 256, (frame * 17 + 80) % 256, (index * 13) % 256, 255], index * 4);
    }
    const palette = quantize(rgba, 256);
    gif.writeFrame(applyPalette(rgba, palette), width, height, { palette, delay: 40, repeat: 0 });
  }
  gif.finish();
  return Buffer.from(gif.bytes());
}

async function main() {
  const client = new PortraitWorkerClient({ workerPath: path.join(__dirname, '..', 'electron', 'portrait-worker-thread.cjs') });
  try {
    const input = animatedFixture();
    const info = await client.run('inspect', { input });
    assert.deepEqual({ format: info.format, animated: info.animated, width: info.width, height: info.height, frames: info.frames }, {
      format: 'gif', animated: true, width: 4, height: 3, frames: 2,
    });
    assert.ok(info.snapshot instanceof Uint8Array);
    assert.equal(info.snapshot.byteLength, input.byteLength);

    const busy = client.run('inspect', { input });
    await assert.rejects(() => client.run('inspect', { input }), /already processing/i);
    await busy;

    const stressInput = animatedFixture(16, 16, 12);
    const dispatchStarted = performance.now();
    const processing = client.run('process', { input: stressInput, crop: { x: 0, y: 0, size: 16 } });
    assert.ok(performance.now() - dispatchStarted < 250, 'GIF processing blocked while dispatching work to the worker.');
    let completed = false;
    void processing.then(() => { completed = true; }, () => {});
    const timerStarted = performance.now();
    await new Promise((resolve) => setTimeout(resolve, 25));
    if (!completed) assert.ok(performance.now() - timerStarted < 250, 'GIF processing blocked the main event loop.');
    const output = await processing;
    assert.equal(output.extension, '.gif');
    assert.ok(output.data instanceof Uint8Array);
    assert.ok(output.data.byteLength > 0);

    const cancelled = client.run('process', { input: stressInput, crop: { x: 0, y: 0, size: 16 } });
    const cancellation = assert.rejects(() => cancelled, /cancelled/i);
    await client.cancel();
    await cancellation;
    assert.equal((await client.run('inspect', { input })).frames, 2, 'Worker did not restart after cancellation.');
  } finally {
    await client.destroy();
  }
  console.log('Portrait worker test passed: metadata, single-flight ownership, responsive processing, cancellation, restart, and GIF output.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
