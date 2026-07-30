class PortraitSourceManager {
  constructor({ worker, createId }) {
    this.worker = worker;
    this.createId = createId;
    this.sources = new Map();
    this.active = null;
  }

  get size() { return this.sources.size; }

  sourceIdsForOwner(ownerWebContentsId) {
    return [...this.sources].filter(([, source]) => source.ownerWebContentsId === ownerWebContentsId).map(([sourceId]) => sourceId);
  }

  assertIdle() {
    if (this.active) throw new Error('An animated portrait is already processing.');
  }

  async prepare(ownerWebContentsId, input) {
    this.assertIdle();
    const job = { sourceId: this.createId(), ownerWebContentsId, cancelled: false, kind: 'worker' };
    this.active = job;
    try {
      const inspected = await this.worker.run('inspect', { input });
      const { snapshot, ...info } = inspected;
      if (job.cancelled || this.active !== job) throw new Error('Animated portrait processing was cancelled.');
      for (const [sourceId, source] of this.sources) {
        if (source.ownerWebContentsId === ownerWebContentsId) this.sources.delete(sourceId);
      }
      this.sources.set(job.sourceId, { ownerWebContentsId, input: snapshot instanceof Uint8Array ? snapshot : input });
      return { sourceId: job.sourceId, ...info };
    } finally {
      if (this.active === job) this.active = null;
    }
  }

  sourceFor(ownerWebContentsId, sourceId) {
    const source = this.sources.get(sourceId);
    if (!source) throw new Error('The animated portrait source is no longer available.');
    if (source.ownerWebContentsId !== ownerWebContentsId) throw new Error('The animated portrait source belongs to another window.');
    return source;
  }

  inputFor(ownerWebContentsId, sourceId) {
    return this.sourceFor(ownerWebContentsId, sourceId).input;
  }

  async process(ownerWebContentsId, sourceId, crop) {
    this.assertIdle();
    const source = this.sourceFor(ownerWebContentsId, sourceId);
    const job = { sourceId, ownerWebContentsId, source, cancelled: false, kind: 'worker' };
    this.active = job;
    try {
      const result = await this.worker.run('process', { input: source.input, crop });
      if (job.cancelled || this.active !== job || this.sources.get(sourceId) !== source) {
        throw new Error('Animated portrait processing was cancelled.');
      }
      return result;
    } finally {
      if (this.active === job) this.active = null;
    }
  }

  async persist(ownerWebContentsId, sourceId, write) {
    this.assertIdle();
    const source = this.sourceFor(ownerWebContentsId, sourceId);
    const job = { sourceId, ownerWebContentsId, source, cancelled: false, kind: 'persistence' };
    this.active = job;
    try {
      const result = await write();
      return { result, cancelled: job.cancelled || this.active !== job || this.sources.get(sourceId) !== source };
    } finally {
      if (this.active === job) this.active = null;
    }
  }

  async release(ownerWebContentsId, sourceId) {
    const source = this.sources.get(sourceId);
    if (!source) return false;
    if (source.ownerWebContentsId !== ownerWebContentsId) throw new Error('The animated portrait source belongs to another window.');
    this.sources.delete(sourceId);
    if (this.active?.sourceId === sourceId) {
      this.active.cancelled = true;
      if (this.active.kind === 'worker') await this.worker.cancel();
    }
    return true;
  }

  async releaseByOwner(ownerWebContentsId) {
    const released = [];
    for (const [sourceId, source] of this.sources) {
      if (source.ownerWebContentsId === ownerWebContentsId) { this.sources.delete(sourceId); released.push(sourceId); }
    }
    if (this.active?.ownerWebContentsId === ownerWebContentsId) {
      this.active.cancelled = true;
      if (this.active.kind === 'worker') await this.worker.cancel();
    }
    return released;
  }
}

module.exports = { PortraitSourceManager };
