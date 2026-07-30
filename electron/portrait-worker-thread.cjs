const { parentPort } = require('node:worker_threads');
const { inspectPortraitSource, processPortraitCrop } = require('./portrait-processor.cjs');

function portraitMetadata(source) {
  return {
    format: source.format,
    animated: source.animated,
    width: source.width,
    height: source.height,
    frames: source.frames,
    delay: source.delay,
    loop: source.loop,
  };
}

parentPort.on('message', async ({ requestId, action, input, crop }) => {
  try {
    if (action === 'inspect') {
      const source = await inspectPortraitSource(input);
      const snapshot = Uint8Array.from(source.buffer);
      parentPort.postMessage({ requestId, ok: true, result: { ...portraitMetadata(source), snapshot } }, [snapshot.buffer]);
      return;
    }
    if (action === 'process') {
      const processed = await processPortraitCrop(input, crop);
      const data = Uint8Array.from(processed.data);
      parentPort.postMessage({
        requestId,
        ok: true,
        result: { extension: processed.extension, animated: processed.animated, data },
      }, [data.buffer]);
      return;
    }
    throw new Error('Portrait worker action is invalid.');
  } catch (error) {
    parentPort.postMessage({ requestId, ok: false, error: String(error?.message || 'Animated portrait processing failed.') });
  }
});
