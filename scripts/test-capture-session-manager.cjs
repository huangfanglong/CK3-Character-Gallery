const assert = require('node:assert/strict');
const { CaptureSessionManager } = require('../electron/capture-session-manager.cjs');

function createShortcut() {
  return {
    registered: new Map(),
    unregistered: [],
    register(shortcut, callback) {
      if (this.registered.has(shortcut)) return false;
      this.registered.set(shortcut, callback);
      return true;
    },
    unregister(shortcut) {
      this.unregistered.push(shortcut);
      this.registered.delete(shortcut);
    },
  };
}

function main() {
  const shortcut = createShortcut();
  let nextId = 0;
  const manager = new CaptureSessionManager(shortcut, () => `session-${++nextId}`);
  const toggles = [];
  const sessionId = manager.arm({
    sourceId: 'source-1',
    shortcut: 'CommandOrControl+Shift+9',
    ownerWebContentsId: 10,
    onToggle: (id) => toggles.push(id),
  });

  assert.equal(sessionId, 'session-1');
  assert.equal(manager.get(sessionId).ownerWebContentsId, 10);
  assert.equal(manager.get(sessionId).phase, 'arming');
  assert.throws(() => manager.transition(sessionId, 'recording'), /cannot transition/i);
  ['armed', 'starting', 'recording', 'saving', 'writing', 'written'].forEach((phase) => manager.transition(sessionId, phase));
  assert.equal(manager.get(sessionId).phase, 'written');
  assert.throws(() => manager.transition(sessionId, 'writing'), /cannot transition/i);
  assert.throws(() => manager.transition('missing-session', 'armed'), /has ended/i);
  shortcut.registered.get('CommandOrControl+Shift+9')();
  assert.deepEqual(toggles, ['session-1']);
  assert.throws(() => manager.arm({ sourceId: 'source-2', shortcut: 'CommandOrControl+Shift+8', ownerWebContentsId: 11, onToggle() {} }), /already active/i);

  manager.releaseByOwner(11);
  assert.ok(manager.get(sessionId));
  manager.releaseByOwner(10);
  assert.equal(manager.get(sessionId), undefined);
  assert.deepEqual(shortcut.unregistered, ['CommandOrControl+Shift+9']);
  assert.doesNotThrow(() => manager.arm({ sourceId: 'source-2', shortcut: 'CommandOrControl+Shift+8', ownerWebContentsId: 11, onToggle() {} }));
  console.log('Capture session manager test passed: ordered state transitions, ownership cleanup, shortcut release, and subsequent capture.');
}

main();
