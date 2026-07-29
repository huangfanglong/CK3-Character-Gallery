class CaptureSessionManager {
  constructor(globalShortcut, createId) {
    this.globalShortcut = globalShortcut;
    this.createId = createId;
    this.sessions = new Map();
    this.activeSessionId = null;
  }

  arm({ sourceId, shortcut, ownerWebContentsId, onToggle }) {
    if (this.activeSessionId) throw new Error('Another live portrait capture is already active.');
    const sessionId = this.createId();
    if (!this.globalShortcut.register(shortcut, () => onToggle(sessionId))) {
      throw new Error(`${shortcut} is already in use by another application.`);
    }
    this.sessions.set(sessionId, { sourceId, shortcut, ownerWebContentsId });
    this.activeSessionId = sessionId;
    return sessionId;
  }

  get(sessionId) {
    return this.sessions.get(sessionId);
  }

  release(sessionId) {
    const capture = this.sessions.get(sessionId);
    if (!capture) return false;
    if (this.activeSessionId === sessionId) {
      this.globalShortcut.unregister(capture.shortcut);
      this.activeSessionId = null;
    }
    this.sessions.delete(sessionId);
    return true;
  }

  releaseByOwner(ownerWebContentsId) {
    for (const [sessionId, capture] of this.sessions) {
      if (capture.ownerWebContentsId === ownerWebContentsId) this.release(sessionId);
    }
  }
}

module.exports = { CaptureSessionManager };
