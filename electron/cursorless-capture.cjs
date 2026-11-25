'use strict';

const path = require('node:path');
const { Worker } = require('node:worker_threads');

const CURSORLESS_FRAME_WIDTH = 450;
const CURSORLESS_FRAME_HEIGHT = 450;
const CURSORLESS_FRAME_BYTES = CURSORLESS_FRAME_WIDTH * CURSORLESS_FRAME_HEIGHT * 4;

function normalizedCursorlessCrop(crop) {
  if (!crop || !['x', 'y', 'size'].every((key) => Number.isInteger(crop[key]))) throw new Error('The cursor-free portrait crop is invalid.');
  const normalized = { x: crop.x, y: crop.y, size: crop.size };
  if (normalized.x < 0 || normalized.y < 0 || normalized.size < 1 || normalized.x > 32_768 || normalized.y > 32_768 || normalized.size > 32_768) throw new Error('The cursor-free portrait crop is invalid.');
  return normalized;
}

class CursorlessCapture {
  constructor(options = {}) {
    this.workerPath = options.workerPath || path.join(__dirname, 'windows-cursorless-capture-worker.cjs');
    this.workerFactory = options.workerFactory || ((filename, settings) => new Worker(filename, settings));
    this.logger = options.logger || console;
    this.sessions = new Map();
    this.startTimeoutMs = options.startTimeoutMs || 5000;
    this.stopTimeoutMs = options.stopTimeoutMs || 500;
  }

  start({ sessionId, gameHwnd, crop, onFrame }) {
    if (typeof sessionId !== 'string' || !sessionId || this.sessions.has(sessionId)) throw new Error('The cursor-free capture session is invalid.');
    if (typeof gameHwnd !== 'string' || !/^\d{1,20}$/.test(gameHwnd)) throw new Error('The CK3 capture window is invalid.');
    if (typeof onFrame !== 'function') throw new Error('The cursor-free frame receiver is invalid.');
    const normalizedCrop = normalizedCursorlessCrop(crop);
    let worker;
    try {
      worker = this.workerFactory(this.workerPath, {
        workerData: { cursorlessCapture: { gameHwnd, crop: normalizedCrop, width: CURSORLESS_FRAME_WIDTH, height: CURSORLESS_FRAME_HEIGHT, fps: 30 } },
        resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 2 },
      });
    } catch (error) { return Promise.reject(error); }
    return new Promise((resolve, reject) => {
      const session = { sessionId, worker, onFrame, settled: false, resolve, reject, timer: null };
      this.sessions.set(sessionId, session);
      session.timer = setTimeout(() => this.fail(session, new Error('Windows did not provide a cursor-free CK3 frame in time.')), this.startTimeoutMs);
      worker.on('message', (message) => {
        if (this.sessions.get(sessionId) !== session) return;
        if (message?.type === 'frame') {
          if (!(message.pixels instanceof ArrayBuffer) || message.pixels.byteLength !== CURSORLESS_FRAME_BYTES) {
            this.fail(session, new Error('Windows returned an invalid cursor-free portrait frame.'));
            return;
          }
          try { session.onFrame({ pixels: message.pixels, sequence: Number(message.sequence) || 0 }); }
          catch (error) { this.fail(session, error); return; }
          this.settle(session);
        } else if (message?.type === 'error') this.fail(session, new Error(String(message.message || 'Cursor-free CK3 capture failed.').slice(0, 300)));
      });
      worker.once('error', (error) => this.fail(session, error));
      worker.once('exit', (code) => {
        if (this.sessions.get(sessionId) === session) this.fail(session, new Error(`Cursor-free CK3 capture stopped unexpectedly (${code}).`));
      });
    });
  }

  settle(session, error = null) {
    if (session.settled) return;
    session.settled = true;
    clearTimeout(session.timer);
    session.timer = null;
    if (error) session.reject(error);
    else session.resolve({ width: CURSORLESS_FRAME_WIDTH, height: CURSORLESS_FRAME_HEIGHT });
  }

  fail(session, error) {
    if (this.sessions.get(session.sessionId) !== session) return;
    this.sessions.delete(session.sessionId);
    const failure = error instanceof Error ? error : new Error(String(error || 'Cursor-free CK3 capture failed.'));
    const wasSettled = session.settled;
    this.settle(session, failure);
    if (wasSettled) {
      try { session.onFrame({ error: failure.message }); }
      catch (callbackError) { this.logger.error('Cursor-free frame receiver failed:', callbackError); }
    }
    void this.shutdownWorker(session.worker);
  }

  async stop(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    this.sessions.delete(sessionId);
    const error = new Error('Cursor-free CK3 capture was stopped.');
    error.name = 'AbortError';
    this.settle(session, error);
    await this.shutdownWorker(session.worker);
    return true;
  }

  shutdownWorker(worker) {
    return new Promise((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        worker.removeListener('exit', finish);
        resolve();
      };
      const timer = setTimeout(() => {
        void Promise.resolve(worker.terminate()).catch((error) => this.logger.error('Cursor-free capture worker could not terminate:', error)).finally(finish);
      }, this.stopTimeoutMs);
      worker.once('exit', finish);
      try { worker.postMessage({ type: 'stop' }); }
      catch { void Promise.resolve(worker.terminate()).catch((error) => this.logger.error('Cursor-free capture worker could not terminate:', error)).finally(finish); }
    });
  }

  async destroy() {
    await Promise.all([...this.sessions.keys()].map((sessionId) => this.stop(sessionId)));
  }
}

module.exports = { CursorlessCapture, normalizedCursorlessCrop, CURSORLESS_FRAME_WIDTH, CURSORLESS_FRAME_HEIGHT, CURSORLESS_FRAME_BYTES };
