const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DEFAULT_DRAIN_TIMEOUT_MS = 5_000;

class PortraitPreviewStore {
  constructor(options = {}) {
    this.tempDirectory = options.tempDirectory || os.tmpdir;
    this.processId = options.processId ?? process.pid;
    this.toFileUrl = options.toFileUrl || pathToFileURL;
    this.writeFile = options.writeFile || fsPromises.writeFile;
    this.removeFile = options.removeFile || fsPromises.rm;
    this.removeFileSync = options.removeFileSync || fs.rmSync;
    this.setTimeout = options.setTimeout || global.setTimeout;
    this.clearTimeout = options.clearTimeout || global.clearTimeout;
    this.now = options.now || Date.now;
    this.drainTimeoutMs = options.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
    this.logger = options.logger || console;
    this.files = new Map();
    this.stages = new Map();
    this.pendingRemovals = new Set();
    this.retryTimers = new Map();
    this.draining = false;
  }

  previewPaths() {
    return [...new Set([...this.files.values(), ...[...this.stages.values()].map((stage) => stage.previewPath), ...this.pendingRemovals])];
  }

  get size() { return this.previewPaths().length; }

  isActive(isSourceActive) {
    try { return Boolean(isSourceActive()); }
    catch { return false; }
  }

  cancelRemovalRetry(previewPath) {
    const timer = this.retryTimers.get(previewPath);
    if (timer !== undefined) this.clearTimeout(timer);
    this.retryTimers.delete(previewPath);
  }

  cancelAllRemovalRetries() {
    for (const previewPath of [...this.retryTimers.keys()]) this.cancelRemovalRetry(previewPath);
  }

  forgetPreviewPath(previewPath) {
    this.cancelRemovalRetry(previewPath);
    this.pendingRemovals.delete(previewPath);
    for (const [sourceId, storedPath] of this.files) {
      if (storedPath === previewPath) this.files.delete(sourceId);
    }
  }

  scheduleRemovalRetry(previewPath, retryCount) {
    if (this.draining || this.retryTimers.has(previewPath)) return;
    const timer = this.setTimeout(() => {
      this.retryTimers.delete(previewPath);
      if (this.draining) return;
      void this.removeFileAfterFailedStaging(previewPath, retryCount + 1);
    }, Math.min(5_000, 100 * 2 ** Math.min(retryCount, 5)));
    timer?.unref?.();
    this.retryTimers.set(previewPath, timer);
  }

  async removeFileAfterFailedStaging(previewPath, retryCount = 0) {
    this.pendingRemovals.add(previewPath);
    try {
      await this.removeFile(previewPath, { force: true });
      this.forgetPreviewPath(previewPath);
      return true;
    } catch (error) {
      this.logger.error('Failed to remove staged portrait preview:', error);
      if (!this.draining && this.pendingRemovals.has(previewPath)) this.scheduleRemovalRetry(previewPath, retryCount);
      return false;
    }
  }

  async stage(sourceId, bytes, isSourceActive) {
    if (this.draining) throw new Error('Animated portrait processing was cancelled.');
    const previewPath = path.join(
      this.tempDirectory(),
      `ck3-character-gallery-${this.processId}-${sourceId}.gif`,
    );
    const stage = { previewPath, cancelled: false, writePromise: null };
    this.stages.set(sourceId, stage);
    if (!this.isActive(isSourceActive)) {
      this.stages.delete(sourceId);
      throw new Error('Animated portrait processing was cancelled.');
    }
    try {
      stage.writePromise = this.writeFile(previewPath, bytes, { flag: 'wx' });
      await stage.writePromise;
    } catch (error) {
      this.stages.delete(sourceId);
      this.removePreviewPath(previewPath);
      throw error;
    }
    if (stage.cancelled || !this.isActive(isSourceActive)) {
      this.stages.delete(sourceId);
      this.removePreviewPath(previewPath);
      throw new Error('Animated portrait processing was cancelled.');
    }
    this.stages.delete(sourceId);
    this.files.set(sourceId, previewPath);
    return this.toFileUrl(previewPath).toString();
  }

  remove(sourceIds) {
    for (const sourceId of sourceIds) {
      const stage = this.stages.get(sourceId);
      if (stage) {
        stage.cancelled = true;
        this.requestPreviewRemoval(stage.previewPath);
      }
      const previewPath = this.files.get(sourceId);
      if (!previewPath) continue;
      if (this.pendingRemovals.has(previewPath)) continue;
      this.requestPreviewRemoval(previewPath);
    }
  }

  requestPreviewRemoval(previewPath) {
    if (this.draining) {
      this.pendingRemovals.add(previewPath);
      return;
    }
    this.removePreviewPath(previewPath);
  }

  removePreviewPath(previewPath) {
    if (this.draining) {
      this.pendingRemovals.add(previewPath);
      return;
    }
    try {
      this.removeFileSync(previewPath, { force: true });
      this.forgetPreviewPath(previewPath);
    } catch (error) {
      this.logger.error('Failed to remove staged portrait preview:', error);
      void this.removeFileAfterFailedStaging(previewPath);
    }
  }

  removeAll() {
    this.remove([...new Set([...this.files.keys(), ...this.stages.keys()])]);
    for (const previewPath of [...this.pendingRemovals]) this.requestPreviewRemoval(previewPath);
  }

  waitForDrainRetry(delay, drainState) {
    const remaining = drainState.deadlineAt - this.now();
    if (remaining <= 1) {
      drainState.timedOut = true;
      return Promise.resolve(false);
    }
    const retryDelay = Math.min(delay, Math.max(1, Math.floor(remaining / 2)));
    return new Promise((resolve) => {
      let timer;
      let settled = false;
      const finish = () => {
        settled = true;
        if (timer !== undefined) drainState.waitTimers.delete(timer);
        resolve(true);
      };
      timer = this.setTimeout(finish, retryDelay);
      if (!settled) drainState.waitTimers.add(timer);
    });
  }

  createDrainDeadline(drainState) {
    let timer;
    drainState.deadlineAt = this.now() + this.drainTimeoutMs;
    const promise = new Promise((resolve) => {
      timer = this.setTimeout(() => {
        drainState.timedOut = true;
        resolve();
      }, this.drainTimeoutMs);
    });
    return {
      promise,
      cancel: () => {
        if (timer !== undefined) this.clearTimeout(timer);
      },
    };
  }

  stopDrain(drainState) {
    drainState.stopped = true;
    for (const timer of drainState.waitTimers) this.clearTimeout(timer);
    drainState.waitTimers.clear();
    this.cancelAllRemovalRetries();
  }

  async drainPendingRemoval(previewPath, drainState) {
    let retryCount = 0;
    this.cancelRemovalRetry(previewPath);
    while (!drainState.stopped && this.pendingRemovals.has(previewPath)) {
      try {
        await this.removeFile(previewPath, { force: true });
        if (drainState.stopped) break;
        this.forgetPreviewPath(previewPath);
      } catch (error) {
        this.logger.error('Failed to remove staged portrait preview:', error);
        if (drainState.stopped || !this.pendingRemovals.has(previewPath)) break;
        retryCount += 1;
        if (!await this.waitForDrainRetry(Math.min(5_000, 100 * 2 ** Math.min(retryCount, 5)), drainState)) break;
      }
    }
  }

  async drainPendingRemovals(drainState) {
    while (!drainState.stopped && !drainState.timedOut && this.pendingRemovals.size) {
      await Promise.all([...this.pendingRemovals].map((previewPath) => this.drainPendingRemoval(previewPath, drainState)));
    }
  }

  async drain() {
    this.draining = true;
    this.cancelAllRemovalRetries();
    const drainState = { stopped: false, timedOut: false, waitTimers: new Set() };
    this.removeAll();
    const deadline = this.createDrainDeadline(drainState);
    const completed = (async () => {
      const writes = [...this.stages.values()].map((stage) => stage.writePromise).filter(Boolean);
      const pendingRemovals = this.drainPendingRemovals(drainState);
      await Promise.allSettled(writes);
      if (drainState.stopped) return;
      this.removeAll();
      await pendingRemovals;
      await this.drainPendingRemovals(drainState);
    })();
    const timedOut = await Promise.race([completed.then(() => false), deadline.promise.then(() => true)]);
    deadline.cancel();
    this.stopDrain(drainState);
    if (timedOut || drainState.timedOut) {
      const paths = this.previewPaths();
      if (paths.length) this.logger.warn?.('Timed out draining staged portrait previews:', { paths, timeoutMs: this.drainTimeoutMs });
      return paths;
    }
    return [];
  }
}

module.exports = { PortraitPreviewStore };
