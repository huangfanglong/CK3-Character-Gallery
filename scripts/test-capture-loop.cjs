const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'capture-loop.js'), 'utf8');
const loop = vm.runInNewContext(`(() => { ${source}; return {
  captureLoopBlendWeight,
  captureLoopAppearanceDistance,
  captureLoopMatchScore,
  createLiveCaptureLoopProcessor,
}; })()`);

assert.equal(loop.captureLoopBlendWeight(0, 6), 0);
assert.equal(loop.captureLoopBlendWeight(5, 6), 1);
assert.throws(() => loop.captureLoopBlendWeight(0, 1), /at least two/i);
for (let index = 1; index < 6; index += 1) {
  assert.ok(loop.captureLoopBlendWeight(index, 6) > loop.captureLoopBlendWeight(index - 1, 6));
}

const reference = [new Float32Array([0, 0]), new Float32Array([1, 1]), new Float32Array([2, 2])];
const sameMotion = [new Float32Array([10, 10]), new Float32Array([11, 11]), new Float32Array([12, 12])];
const reverseMotion = [new Float32Array([12, 12]), new Float32Array([11, 11]), new Float32Array([10, 10])];
assert.equal(loop.captureLoopAppearanceDistance(reference[0], sameMotion[0]), 10);
assert.ok(loop.captureLoopMatchScore(reference, sameMotion).motion < loop.captureLoopMatchScore(reference, reverseMotion).motion);

function createProcessorHarness(now = () => 0) {
  const encoded = [];
  const frames = [];
  let descriptorCalls = 0;
  const encoder = {
    encode(source, timestamp, index) { encoded.push({ source, timestamp, index }); },
    finalize: async () => new ArrayBuffer(1),
  };
  const processor = loop.createLiveCaptureLoopProcessor({
    encoder,
    fps: 30,
    settings: {
      overlapFrames: 2, beforeFrames: 1, afterFrames: 1, minBodyFrames: 2, descriptorSize: 1,
      anchorMaxDistance: 0.001, windowMaxDistance: 0.001, motionMaxDistance: 0.001, scoreMax: 0.001,
    },
    createFrame(value) {
      const frame = { value, closeCalls: 0, close() { this.closeCalls += 1; } };
      frames.push(frame);
      return frame;
    },
    createDescriptor(frame) { descriptorCalls += 1; return new Float32Array([frame.value]); },
    createBlendCanvas() {
      const context = { clearRect() {}, drawImage() {}, globalAlpha: 1 };
      return { width: 0, height: 0, getContext() { return context; } };
    },
    now,
  });
  return { encoded, frames, processor, get descriptorCalls() { return descriptorCalls; } };
}

async function processorTests() {
  const natural = createProcessorHarness();
  [0, 1, 2, 3].forEach((value, index) => natural.processor.push(value, { sourceTimestamp: index * 33_333, captureTick: index }));
  natural.processor.beginSearch({ requestedIndex: 4, deadline: 1_000 });
  [0, 1, 2, 3].forEach((value, index) => natural.processor.push(value, { sourceTimestamp: (index + 4) * 33_333, captureTick: index + 4 }));
  assert.equal(natural.processor.decision, null);
  assert.equal(natural.processor.completeSearch(), 'natural');
  await natural.processor.finalize();
  assert.deepEqual(natural.encoded.map(({ source }) => source.value), [2, 3, 0, 1, 2]);
  assert.deepEqual(natural.encoded.map(({ timestamp }) => timestamp), [0, 33_333, 66_666, 99_999, 133_332]);
  assert.ok(natural.frames.every((frame) => frame.closeCalls === 1));

  const expired = createProcessorHarness(() => 1_100);
  [0, 1, 2, 3].forEach((value, index) => expired.processor.push(value, { sourceTimestamp: index * 33_333, captureTick: index }));
  expired.processor.beginSearch({ requestedIndex: 4, deadline: 1_000 });
  expired.processor.push(0, { sourceTimestamp: 4 * 33_333, captureTick: 4 });
  assert.equal(expired.processor.decision, 'fallback');
  assert.equal(expired.frames.length, 4);
  expired.processor.close();
  assert.ok(expired.frames.every((frame) => frame.closeCalls === 1));

  const boundedDescriptors = createProcessorHarness();
  [0, 1, 2, 3, 4].forEach((value, index) => boundedDescriptors.processor.push(value, { sourceTimestamp: index * 33_333, captureTick: index }));
  assert.equal(boundedDescriptors.descriptorCalls, 4);
  boundedDescriptors.processor.beginSearch({ requestedIndex: 5, deadline: 1_000 });
  assert.equal(boundedDescriptors.descriptorCalls, 5);
  boundedDescriptors.processor.push(5, { sourceTimestamp: 5 * 33_333, captureTick: 5 });
  assert.equal(boundedDescriptors.descriptorCalls, 6);
  boundedDescriptors.processor.close();

  const noMatch = createProcessorHarness();
  [0, 1, 2, 3, 9, 8, 7, 6].forEach((value, index) => noMatch.processor.push(value, { sourceTimestamp: index * 33_333, captureTick: index }));
  noMatch.processor.beginSearch({ requestedIndex: 8, deadline: 1_000 });
  assert.equal(noMatch.processor.completeSearch(), 'fallback');
  noMatch.processor.close();

  const droppedOpening = createProcessorHarness();
  [0, 1, 2, 3].forEach((value, index) => droppedOpening.processor.push(value, { sourceTimestamp: index * 33_333, captureTick: index === 2 ? 3 : index }));
  droppedOpening.processor.beginSearch({ requestedIndex: 4, deadline: 1_000 });
  [0, 1, 2, 3].forEach((value, index) => droppedOpening.processor.push(value, { sourceTimestamp: (index + 4) * 33_333, captureTick: index + 5 }));
  assert.equal(droppedOpening.processor.completeSearch(), 'fallback');
  droppedOpening.processor.close();

  const fallback = createProcessorHarness();
  [0, 1, 2, 3].forEach((value, index) => fallback.processor.push(value, { sourceTimestamp: index * 33_333, captureTick: index }));
  fallback.processor.forceFallback();
  await fallback.processor.finalize();
  assert.equal(fallback.encoded.length, 2);
  assert.deepEqual(fallback.encoded.map(({ timestamp }) => timestamp), [0, 33_333]);
  assert.ok(fallback.frames.every((frame) => frame.closeCalls === 1));
}

processorTests().then(() => {
  console.log('Capture loop test passed: blend endpoints, output ordering, motion-aware matching, and bounded frame cleanup.');
}).catch((error) => { console.error(error); process.exitCode = 1; });
