const assert = require('node:assert/strict');
const { WindowsGameMonitor, boundsFromRect, handleKey, normalizeExecutableName } = require('../electron/windows-game-monitor.cjs');

assert.equal(normalizeExecutableName('C:\\Games\\CK3.exe'), 'ck3.exe');
assert.equal(normalizeExecutableName('/games/CK3.EXE'), 'ck3.exe');
assert.equal(handleKey(12n), '12');
assert.equal(handleKey(null), '');
assert.deepEqual(boundsFromRect({ left: -20, top: 10, right: 1900, bottom: 1090 }), { x: -20, y: 10, width: 1920, height: 1080 });
assert.equal(boundsFromRect({ left: 0, top: 0, right: 0, bottom: 100 }), null);

function fakeApi() {
  const listeners = [];
  const koffi = {
    registrations: 0,
    failRegistrationAt: 0,
    register(callback) {
      this.registrations += 1;
      if (this.registrations === this.failRegistrationAt) throw new Error('registration failed');
      listeners.push(callback);
      return callback;
    },
    unregister(callback) { const index = listeners.indexOf(callback); if (index >= 0) listeners.splice(index, 1); },
    listenerCount() { return listeners.length; },
  };
  return {
    koffi,
    callbackType: {},
    foreground: 1n,
    windows: new Map(),
    setWinEventHook: () => ({}),
    unhookWinEvent: () => true,
    getForegroundWindow() { return this.foreground; },
    isWindow: (_hwnd) => true,
    isWindowVisible: (_hwnd) => true,
    isIconic: () => false,
    getWindowThreadProcessId(hwnd, output) { output[0] = Number(hwnd); return 1; },
    openProcess: () => ({}),
    queryFullProcessImageName(_process, _flags, output, size) {
      const name = this.windows.get(this.foreground) || 'other.exe';
      output[0] = name;
      size[0] = name.length;
      return true;
    },
    closeHandle: () => true,
    getFrameBounds: () => -1,
    getWindowRect(hwnd, output) { Object.assign(output, { left: 0, top: 0, right: 1920, bottom: 1080 }); return true; },
    getClientRect(hwnd, output) { Object.assign(output, { left: 0, top: 0, right: 1920, bottom: 1080 }); return true; },
    clientToScreen: () => true,
    setForegroundWindow: () => true,
    emit() { listeners.forEach((listener) => listener(null, 0, this.foreground, 0, 0, 0, 0)); },
  };
}

const api = fakeApi();
api.windows.set(1n, 'C:\\Games\\ck3.exe');
const monitor = new WindowsGameMonitor({ api, reconcileIntervalMs: 60_000 });
const changes = [];
monitor.on('change', (state) => changes.push(state));
assert.equal(monitor.start(), true);
assert.equal(monitor.state.executable, 'ck3.exe');
assert.equal(monitor.state.hwnd, '1');
assert.equal(changes.length, 1);
monitor.refresh();
assert.equal(changes.length, 1, 'Unchanged foreground state must not emit.');
api.foreground = 2n;
api.windows.set(2n, 'C:\\Windows\\explorer.exe');
api.emit();
assert.equal(monitor.state, null);
assert.equal(changes.length, 2);
api.foreground = 1n;
api.emit();
assert.equal(monitor.state.executable, 'ck3.exe');
assert.equal(monitor.restoreFocus('1'), true);
monitor.stop();
assert.equal(monitor.started, false);
assert.equal(monitor.state, null);
assert.equal(api.koffi.listenerCount(), 0);

const partialRegistration = fakeApi();
partialRegistration.koffi.failRegistrationAt = 2;
const failedMonitor = new WindowsGameMonitor({ api: partialRegistration, reconcileIntervalMs: 60_000 });
assert.equal(failedMonitor.start(), false);
assert.equal(partialRegistration.koffi.listenerCount(), 0, 'A failed second registration must release the first native callback.');

const unsupported = new WindowsGameMonitor({ platform: 'darwin' });
assert.equal(unsupported.start(), false);
console.log('Windows game monitor tests passed: executable matching, stable state, focus transitions, bounds, partial-registration cleanup, and cleanup.');
