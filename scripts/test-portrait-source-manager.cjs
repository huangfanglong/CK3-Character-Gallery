const assert = require('node:assert/strict');
const { PortraitSourceManager } = require('../electron/portrait-source-manager.cjs');

function deferred() {
  let resolveJob;
  let rejectJob;
  const promise = new Promise((resolve, reject) => { resolveJob = resolve; rejectJob = reject; });
  return { promise, resolve: resolveJob, reject: rejectJob };
}

async function main() {
  let nextId = 0;
  const jobs = [];
  const worker = {
    run(action, payload) {
      const job = { action, payload, ...deferred() };
      jobs.push(job);
      return job.promise;
    },
    async cancel() { jobs.at(-1)?.reject(new Error('Animated portrait processing was cancelled.')); },
  };
  const sources = new PortraitSourceManager({ worker, createId: () => `source-${++nextId}` });

  const preparing = sources.prepare(7, Buffer.from('first'));
  await assert.rejects(() => sources.prepare(7, Buffer.from('busy')), /already processing/i);
  jobs[0].resolve({ format: 'gif', animated: true, width: 4, height: 3, frames: 2, snapshot: Buffer.from('first-snapshot') });
  const first = await preparing;
  assert.equal(first.sourceId, 'source-1');
  assert.equal(sources.size, 1);
  assert.deepEqual(sources.sourceIdsForOwner(7), ['source-1']);
  assert.equal(sources.inputFor(7, first.sourceId).toString(), 'first-snapshot');

  const replacing = sources.prepare(7, Buffer.from('second'));
  jobs[1].resolve({ format: 'gif', animated: true, width: 8, height: 6, frames: 3, snapshot: Buffer.from('second-snapshot') });
  const second = await replacing;
  assert.equal(second.sourceId, 'source-2');
  assert.equal(sources.size, 1);
  await assert.rejects(() => sources.process(7, first.sourceId, { x: 0, y: 0, size: 3 }), /no longer available/i);
  await assert.rejects(() => sources.process(9, second.sourceId, { x: 0, y: 0, size: 3 }), /another window/i);

  const processing = sources.process(7, second.sourceId, { x: 0, y: 0, size: 3 });
  assert.equal(jobs[2].payload.input.toString(), 'second-snapshot');
  const cancellation = assert.rejects(() => processing, /cancelled/i);
  await sources.release(7, second.sourceId);
  await cancellation;
  assert.equal(sources.size, 0);

  const retrying = sources.prepare(7, Buffer.from('retry'));
  jobs[3].resolve({ format: 'gif', animated: false, width: 2, height: 2, frames: 1, snapshot: Buffer.from('retry-snapshot') });
  assert.equal((await retrying).sourceId, 'source-3');
  await sources.releaseByOwner(7);
  assert.equal(sources.size, 0);

  const persistingSource = sources.prepare(7, Buffer.from('persisting'));
  jobs[4].resolve({ format: 'gif', animated: false, width: 2, height: 2, frames: 1, snapshot: Buffer.from('persisting-snapshot') });
  const persistedSource = await persistingSource;
  const write = deferred();
  const persisting = sources.persist(7, persistedSource.sourceId, async () => write.promise);
  await sources.release(7, persistedSource.sourceId);
  write.resolve('portrait.gif');
  assert.deepEqual(await persisting, { cancelled: true, result: 'portrait.gif' });

  console.log('Portrait source manager test passed: single-flight jobs, bounded ownership, stale-ID rejection, cancellation, replacement, and retry.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
