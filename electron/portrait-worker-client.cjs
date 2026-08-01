const { Worker } = require('node:worker_threads');

class PortraitWorkerClient {
  constructor({ workerPath, WorkerClass = Worker, resourceLimits = { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 } }) {
    this.workerPath = workerPath;
    this.WorkerClass = WorkerClass;
    this.resourceLimits = resourceLimits;
    this.worker = null;
    this.active = null;
    this.nextRequestId = 1;
  }

  ensureWorker() {
    if (this.worker) return this.worker;
    const worker = new this.WorkerClass(this.workerPath, { resourceLimits: this.resourceLimits });
    this.worker = worker;
    worker.on('message', (message) => this.handleMessage(worker, message));
    worker.on('error', (error) => this.handleFailure(worker, error));
    worker.on('exit', (code) => {
      if (this.worker !== worker) return;
      this.worker = null;
      this.rejectActive(new Error(code === 0 ? 'Portrait worker stopped before completing its task.' : `Portrait worker stopped with exit code ${code}.`));
    });
    return worker;
  }

  run(action, payload) {
    if (this.active) return Promise.reject(new Error('An animated portrait is already processing.'));
    const worker = this.ensureWorker();
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    return new Promise((resolve, reject) => {
      this.active = { requestId, resolve, reject };
      try { worker.postMessage({ requestId, action, ...payload }); }
      catch (error) { this.active = null; reject(error); }
    });
  }

  handleMessage(worker, message) {
    if (this.worker !== worker || !this.active || message?.requestId !== this.active.requestId) return;
    const { resolve, reject } = this.active;
    this.active = null;
    if (message.ok) resolve(message.result);
    else reject(new Error(message.error || 'Animated portrait processing failed.'));
  }

  handleFailure(worker, error) {
    if (this.worker !== worker) return;
    this.worker = null;
    this.rejectActive(error);
  }

  rejectActive(error) {
    if (!this.active) return;
    const { reject } = this.active;
    this.active = null;
    reject(error);
  }

  async cancel() {
    const worker = this.worker;
    if (!worker) return;
    this.worker = null;
    this.rejectActive(new Error('Animated portrait processing was cancelled.'));
    await worker.terminate();
  }

  async destroy() {
    const worker = this.worker;
    this.worker = null;
    this.rejectActive(new Error('Animated portrait worker was destroyed.'));
    if (worker) await worker.terminate();
  }
}

module.exports = { PortraitWorkerClient };
