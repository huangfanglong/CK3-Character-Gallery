const { EventEmitter } = require('node:events');
const path = require('node:path');

const EVENT_SYSTEM_FOREGROUND = 0x0003;
const EVENT_OBJECT_LOCATIONCHANGE = 0x800b;
const WINEVENT_OUTOFCONTEXT = 0x0000;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const DWMWA_EXTENDED_FRAME_BOUNDS = 9;

function handleKey(handle) {
  if (handle === null || handle === undefined || handle === 0 || handle === 0n) return '';
  return String(handle);
}

function normalizeExecutableName(executablePath) {
  return path.basename(String(executablePath || '').trim()).toLowerCase();
}

function boundsFromRect(rect) {
  if (![rect?.left, rect?.top, rect?.right, rect?.bottom].every(Number.isFinite)) return null;
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  if (width <= 0 || height <= 0) return null;
  return { x: rect.left, y: rect.top, width, height };
}

function createWindowsApi(koffi) {
  const HANDLE = koffi.pointer('HANDLE', koffi.opaque());
  koffi.alias('HWND', HANDLE);
  koffi.alias('HWINEVENTHOOK', HANDLE);
  koffi.alias('DWORD', 'uint32_t');
  koffi.struct('RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
  koffi.struct('POINT', { x: 'long', y: 'long' });
  const WinEventProc = koffi.proto('void __stdcall WinEventProc(HWINEVENTHOOK hook, DWORD event, HWND hwnd, long objectId, long childId, DWORD eventThread, DWORD eventTime)');
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');
  const dwmapi = koffi.load('dwmapi.dll');
  const api = {
    getForegroundWindow: user32.func('HWND __stdcall GetForegroundWindow()'),
    getWindowThreadProcessId: user32.func('DWORD __stdcall GetWindowThreadProcessId(HWND hwnd, _Out_ DWORD *processId)'),
    isWindow: user32.func('bool __stdcall IsWindow(HWND hwnd)'),
    isWindowVisible: user32.func('bool __stdcall IsWindowVisible(HWND hwnd)'),
    isIconic: user32.func('bool __stdcall IsIconic(HWND hwnd)'),
    getWindowRect: user32.func('bool __stdcall GetWindowRect(HWND hwnd, _Out_ RECT *rect)'),
    getClientRect: user32.func('bool __stdcall GetClientRect(HWND hwnd, _Out_ RECT *rect)'),
    clientToScreen: user32.func('bool __stdcall ClientToScreen(HWND hwnd, _Inout_ POINT *point)'),
    setForegroundWindow: user32.func('bool __stdcall SetForegroundWindow(HWND hwnd)'),
    setWinEventHook: user32.func('HWINEVENTHOOK __stdcall SetWinEventHook(DWORD eventMin, DWORD eventMax, HANDLE module, WinEventProc *callback, DWORD processId, DWORD threadId, DWORD flags)'),
    unhookWinEvent: user32.func('bool __stdcall UnhookWinEvent(HWINEVENTHOOK hook)'),
    openProcess: kernel32.func('HANDLE __stdcall OpenProcess(DWORD access, bool inheritHandle, DWORD processId)'),
    queryFullProcessImageName: kernel32.func('bool __stdcall QueryFullProcessImageNameW(HANDLE process, DWORD flags, _Out_ char16_t *imageName, _Inout_ DWORD *size)'),
    closeHandle: kernel32.func('bool __stdcall CloseHandle(HANDLE handle)'),
    getFrameBounds: dwmapi.func('long __stdcall DwmGetWindowAttribute(HWND hwnd, DWORD attribute, _Out_ RECT *rect, DWORD size)'),
    koffi,
    callbackType: koffi.pointer(WinEventProc),
  };
  return api;
}

function readProcessExecutable(api, processId) {
  if (!processId) return '';
  const process = api.openProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, processId);
  if (!process) return '';
  try {
    const output = ['\0'.repeat(32768)];
    const size = [32768];
    return api.queryFullProcessImageName(process, 0, output, size) ? output[0].slice(0, size[0]) : '';
  } finally {
    api.closeHandle(process);
  }
}

function readWindow(api, nativeHandle) {
  const hwnd = handleKey(nativeHandle);
  if (!nativeHandle || !api.isWindow(nativeHandle)) return null;
  const processId = [0];
  api.getWindowThreadProcessId(nativeHandle, processId);
  const executablePath = readProcessExecutable(api, processId[0]);
  const rect = {};
  let bounds = null;
  if (api.getFrameBounds(nativeHandle, DWMWA_EXTENDED_FRAME_BOUNDS, rect, 16) === 0) bounds = boundsFromRect(rect);
  if (!bounds && api.getWindowRect(nativeHandle, rect)) bounds = boundsFromRect(rect);
  let clientBounds = null;
  const client = {};
  const origin = { x: 0, y: 0 };
  if (api.getClientRect(nativeHandle, client) && api.clientToScreen(nativeHandle, origin)) {
    const size = boundsFromRect(client);
    if (size) clientBounds = { x: origin.x, y: origin.y, width: size.width, height: size.height };
  }
  return {
    hwnd,
    processId: processId[0],
    executablePath,
    executable: normalizeExecutableName(executablePath),
    visible: Boolean(api.isWindowVisible(nativeHandle)),
    minimized: Boolean(api.isIconic(nativeHandle)),
    bounds,
    clientBounds,
  };
}

class WindowsGameMonitor extends EventEmitter {
  constructor(options = {}) {
    super();
    this.platform = options.platform || process.platform;
    this.targetExecutable = normalizeExecutableName(options.targetExecutable || 'ck3.exe');
    this.logger = options.logger || console;
    this.api = options.api || null;
    this.koffi = options.koffi || null;
    this.state = null;
    this.started = false;
    this.hooks = [];
    this.callbacks = [];
    this.reconcileTimer = null;
    this.reconcileIntervalMs = options.reconcileIntervalMs || 1500;
  }

  start() {
    if (this.started) return true;
    if (this.platform !== 'win32') return false;
    try {
      if (!this.api) {
        this.koffi ||= require('koffi');
        this.api = createWindowsApi(this.koffi);
      }
      this.started = true;
      this.callbacks = [
        this.api.koffi.register(() => this.refresh(), this.api.callbackType),
        this.api.koffi.register((_hook, _event, hwnd) => {
          if (this.state && handleKey(hwnd) === this.state.hwnd) this.refresh();
        }, this.api.callbackType),
      ];
      this.hooks = [
        this.api.setWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, null, this.callbacks[0], 0, 0, WINEVENT_OUTOFCONTEXT),
        this.api.setWinEventHook(EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_LOCATIONCHANGE, null, this.callbacks[1], 0, 0, WINEVENT_OUTOFCONTEXT),
      ];
      if (this.hooks.some((hook) => !hook)) throw new Error('Windows foreground event hooks could not be installed.');
      this.reconcileTimer = setInterval(() => this.refresh(), this.reconcileIntervalMs);
      this.reconcileTimer.unref?.();
      this.refresh();
      return true;
    } catch (error) {
      this.logger.error('CK3 game detection could not start:', error);
      this.stop();
      return false;
    }
  }

  refresh() {
    if (!this.started || !this.api) return null;
    try {
      const foreground = this.api.getForegroundWindow();
      const window = readWindow(this.api, foreground);
      const active = window && window.executable === this.targetExecutable && window.visible && !window.minimized && window.bounds ? window : null;
      const signature = active ? JSON.stringify(active) : '';
      if (signature !== this.lastSignature) {
        this.lastSignature = signature;
        this.state = active;
        this.emit('change', active);
      }
      return active;
    } catch (error) {
      this.logger.error('CK3 foreground state could not be read:', error);
      return this.state;
    }
  }

  restoreFocus(hwnd) {
    if (!this.api || !hwnd) return false;
    try { return Boolean(this.api.setForegroundWindow(BigInt(hwnd))); }
    catch { return false; }
  }

  stop() {
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    this.reconcileTimer = null;
    for (const hook of this.hooks) {
      try { if (hook) this.api?.unhookWinEvent(hook); } catch (error) { this.logger.error('CK3 event hook could not be removed:', error); }
    }
    this.hooks = [];
    for (const callback of this.callbacks) {
      try { this.api?.koffi.unregister(callback); } catch (error) { this.logger.error('CK3 event callback could not be released:', error); }
    }
    this.callbacks = [];
    this.started = false;
    this.state = null;
    this.lastSignature = '';
  }
}

module.exports = {
  WindowsGameMonitor,
  boundsFromRect,
  createWindowsApi,
  handleKey,
  normalizeExecutableName,
  readWindow,
};
