'use strict';

const path = require('node:path');
const { Worker } = require('node:worker_threads');

class LiveGameBridge {
  constructor(options = {}) {
    this.workerPath = options.workerPath || path.join(__dirname, 'live-game-worker.cjs');
    this.cachePath = options.cachePath || '';
    this.logger = options.logger || console;
    this.workerFactory = options.workerFactory || ((filename, settings) => new Worker(filename, settings));
    this.worker = null;
    this.workerReady = false;
    this.workerStarting = null;
    this.enabled = false;
    this.pending = new Map();
    this.counter = 0;
    this.generation = 0;
    this.settingRevision = 0;
  }
  async setEnabled(enabled) {
    const revision = ++this.settingRevision;
    this.enabled = Boolean(enabled);
    if (!this.enabled) { this.stopWorker(); return false; }
    try {
      const ready = await this.startWorker();
      return ready && revision === this.settingRevision && this.enabled;
    } catch (error) {
      /* A newer off/on choice owns the bridge. An older enable rejection must not
         disable or terminate its replacement worker. */
      if (revision !== this.settingRevision) return false;
      this.enabled = false;
      this.stopWorker();
      throw error;
    }
  }
  startWorker() {
    if (!this.enabled) return Promise.reject(new Error('Live Game Link is turned off.'));
    if (this.worker && this.workerReady) return Promise.resolve(true);
    if (this.workerStarting) return this.workerStarting;
    const worker = this.ensureWorker();
    const generation = this.generation;
    /* A Worker constructs a fresh engine with enabled=false. Complete its handshake
       before any command, including when the previous worker crashed after consent. */
    const starting = (async () => {
      try {
        await this.sendRequest('set-enabled', { enabled: true });
        if (generation !== this.generation || worker !== this.worker || !this.enabled) return false;
        this.workerReady = true;
        return true;
      } finally {
        if (this.workerStarting === starting) this.workerStarting = null;
      }
    })();
    this.workerStarting = starting;
    return starting;
  }
  ensureWorker() {
    if (this.worker) return this.worker;
    const worker = this.workerFactory(this.workerPath, { workerData: { cachePath: this.cachePath } });
    const generation = ++this.generation;
    this.worker = worker;
    this.workerReady = false;
    worker.on('message', (message) => {
      if (generation !== this.generation) return;
      const request = this.pending.get(message?.id);
      if (!request) return;
      this.pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.ok) request.resolve(request.sanitize(message.result));
      else request.reject(new Error(String(message.error || 'Live Game Link could not complete the action.')));
    });
    worker.on('error', (error) => {
      if (generation !== this.generation) return;
      this.logger.error('Live Game Link worker failed:', error);
      this.stopWorker();
    });
    worker.on('exit', () => { if (generation === this.generation) this.stopWorker(); });
    return worker;
  }
  request(action, payload = {}, timeout = 90_000) {
    if (!this.enabled) return Promise.reject(new Error('Live Game Link is turned off.'));
    if (action === 'set-enabled' || this.worker && this.workerReady) return this.sendRequest(action, payload, timeout);
    return this.startWorker().then((ready) => {
      if (!ready) throw new Error('Live Game Link was interrupted before the action completed. Retry the live-game action.');
      return this.sendRequest(action, payload, timeout);
    });
  }
  sendRequest(action, payload = {}, timeout = 90_000) {
    if (!this.enabled) return Promise.reject(new Error('Live Game Link is turned off.'));
    const worker = this.ensureWorker();
    const id = `live-${++this.counter}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.stopWorker();
        reject(new Error(action === 'confirm-apply' || action === 'undo'
          ? 'CK3 stopped responding during a write. Check the character in CK3 before saving; the final DNA state is unconfirmed.'
          : 'CK3 did not respond in time. The live-game operation was interrupted.'));
      }, timeout);
      timer.unref?.();
      this.pending.set(id, { action, resolve, reject, timer, sanitize: (result) => sanitizeResult(action, result) });
      worker.postMessage({ id, action, ...payload });
    });
  }
  detect(game) { return this.request('detect', { game }); }
  import(game) { return this.request('import', { game }); }
  prepareApply(game, selection) { return this.request('prepare-apply', { game, selection }); }
  confirmApply(game, token) { return this.request('confirm-apply', { game, token }); }
  undo(game) { return this.request('undo', { game }); }
  cancel() { if (this.worker && this.enabled) return this.request('cancel', {}, 5000); return Promise.resolve(true); }
  stopWorker() {
    ++this.generation;
    this.workerReady = false;
    this.workerStarting = null;
    const worker = this.worker;
    this.worker = null;
    if (worker) {
      worker.removeAllListeners('message');
      void worker.terminate().catch((error) => this.logger.error('Live Game Link worker could not stop:', error));
    }
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      const message = ['confirm-apply', 'undo'].includes(request.action)
        ? 'Live Game Link was interrupted during a write. Check the character in CK3 before saving; the final DNA state is unconfirmed.'
        : this.enabled ? 'Live Game Link was interrupted before the action completed. Retry the live-game action.' : 'Live Game Link was turned off.';
      request.reject(new Error(message));
    }
    this.pending.clear();
  }
  async close() { ++this.settingRevision; this.enabled = false; this.stopWorker(); }
}

function sanitizeResult(action, result) {
  if (action === 'set-enabled' || action === 'cancel') return true;
  if (action === 'detect') return { target: targetResult(result?.target) };
  if (action === 'import') {
    if (typeof result?.dna !== 'string' || !result.dna.includes('genes=') && !/\bgenes\s*=\s*\{/.test(result.dna)) throw new Error('The imported DNA response is invalid.');
    return { dna: result.dna, target: targetResult(result.target), geneCount: Number(result.geneCount) };
  }
  if (action === 'prepare-apply') {
    if (typeof result?.token !== 'string' || !/^[a-f0-9-]{36}$/.test(result.token)) throw new Error('The apply preview response is invalid.');
    return { token: result.token, target: targetResult(result.target), report: reportResult(result.report) };
  }
  if (action === 'confirm-apply') return { target: targetResult(result?.target), undoUntil: Number(result?.undoUntil) || 0, report: reportResult(result?.report) };
  if (action === 'undo') return { target: targetResult(result?.target) };
  throw new Error('The live-game result is not supported.');
}
function targetResult(target) {
  if (!Number.isInteger(target?.id) || target.id < 0 || typeof target?.name !== 'string') throw new Error('The CK3 target identity is invalid.');
  return { id: target.id, name: target.name.slice(0, 120), nameIsKey: true };
}
function reportResult(report) {
  return {
    geneCount: Number(report?.geneCount) || 0,
    catalogHash: typeof report?.catalogHash === 'string' ? report.catalogHash : '',
    excluded: Array.isArray(report?.excluded) ? report.excluded.filter((name) => typeof name === 'string').slice(0, 100) : [],
    message: typeof report?.message === 'string' ? report.message.slice(0, 600) : '',
  };
}

module.exports = { LiveGameBridge, sanitizeResult };
