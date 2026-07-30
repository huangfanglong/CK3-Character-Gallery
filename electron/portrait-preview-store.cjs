const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

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
    this.wait = options.wait || ((delay) => new Promise((resolve) => global.setTimeout(resolve, delay)));
    this.logger = options.logger || console;
    this.files = new Map();
    this.stages = new Map();
    this.pendingRemovals = new Set();
    this.retryTimers = new Map();
    this.draining = false;
  }

  get size() { return new Set([...this.files.values(), ...[...this.stages.values()].map((stage) => stage.previewPath), ...this.pendingRemovals]).size; }

  isActive(isSourceActive) {
    try { return Boolean(isSourceActive()); }
    catch { return false; }
  }

  cancelRemovalRetry(previewPath) {
    const timer = this.retryTimers.get(previewPath);
    if (timer !== undefined) this.clearTimeout(timer);
    this.retryTimers.delete(previewPath);
  }

  forgetPreviewPath(previewPath) {
    this.cancelRemovalRetry(previewPath);
    this.pendingRemovals.delete(previewPath);
    for (const [sourceId, storedPath] of this.files) {
      if (storedPath === previewPath) this.files.delete(sourceId);
    }
  }

  scheduleRemovalRetry(previewPath, retryCount) {
    if (this.retryTimers.has(previewPath)) return;
    const timer = this.setTimeout(() => {
      this.retryTimers.delete(previewPath);
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
      this.scheduleRemovalRetry(previewPath, retryCount);
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
        this.removePreviewPath(stage.previewPath);
      }
      const previewPath = this.files.get(sourceId);
      if (!previewPath) continue;
      if (this.pendingRemovals.has(previewPath)) continue;
      this.removePreviewPath(previewPath);
    }
  }

  removePreviewPath(previewPath) {
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
    for (const previewPath of [...this.pendingRemovals]) this.removePreviewPath(previewPath);
  }

  async drainPendingRemoval(previewPath) {
    let retryCount = 0;
    this.cancelRemovalRetry(previewPath);
    while (this.pendingRemovals.has(previewPath)) {
      try {
        await this.removeFile(previewPath, { force: true });
        this.forgetPreviewPath(previewPath);
      } catch (error) {
        this.logger.error('Failed to remove staged portrait preview:', error);
        if (!this.pendingRemovals.has(previewPath)) break;
        retryCount += 1;
        await this.wait(Math.min(5_000, 100 * 2 ** Math.min(retryCount, 5)));
      }
    }
  }

  async drain() {
    this.draining = true;
    this.removeAll();
    const writes = [...this.stages.values()].map((stage) => stage.writePromise).filter(Boolean);
    await Promise.allSettled(writes);
    this.removeAll();
    while (this.pendingRemovals.size) {
      await Promise.all([...this.pendingRemovals].map((previewPath) => this.drainPendingRemoval(previewPath)));
    }
  }
}

module.exports = { PortraitPreviewStore };
