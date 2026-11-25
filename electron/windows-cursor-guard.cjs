'use strict';

const DOCK_CURSOR_INSET = 6;
const WH_MOUSE_LL = 14;
const WM_MOUSEMOVE = 0x0200;

function cursorClipBounds(bounds, inset = DOCK_CURSOR_INSET) {
  if (![bounds?.x, bounds?.y, bounds?.width, bounds?.height].every(Number.isFinite)) return null;
  const left = Math.round(bounds.x);
  const top = Math.round(bounds.y) + inset;
  const right = Math.round(bounds.x + bounds.width);
  const bottom = Math.round(bounds.y + bounds.height);
  if (right <= left || bottom <= top) return null;
  return { left, top, right, bottom };
}

function sameRect(left, right) {
  return Boolean(left && right && ['left', 'top', 'right', 'bottom'].every((key) => left[key] === right[key]));
}

function createCursorApi(koffi) {
  koffi.struct('BLOODLINE_CURSOR_POINT', { x: 'long', y: 'long' });
  koffi.struct('BLOODLINE_CURSOR_RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
  koffi.struct('BLOODLINE_MOUSE_DATA', {
    pt: 'BLOODLINE_CURSOR_POINT',
    mouseData: 'uint32_t',
    flags: 'uint32_t',
    time: 'uint32_t',
    extraInfo: 'uintptr_t',
  });
  const HANDLE = koffi.pointer('BLOODLINE_CURSOR_HANDLE', koffi.opaque());
  koffi.alias('BLOODLINE_CURSOR_HHOOK', HANDLE);
  koffi.alias('BLOODLINE_CURSOR_HINSTANCE', HANDLE);
  const LowLevelMouseProc = koffi.proto('intptr_t __stdcall BloodlineLowLevelMouseProc(int code, uintptr_t message, BLOODLINE_MOUSE_DATA *data)');
  const user32 = koffi.load('user32.dll');
  const clipCursor = user32.func('bool __stdcall ClipCursor(BLOODLINE_CURSOR_RECT *rect)');
  const getCursorPos = user32.func('bool __stdcall GetCursorPos(_Out_ BLOODLINE_CURSOR_POINT *point)');
  const getClipCursor = user32.func('bool __stdcall GetClipCursor(_Out_ BLOODLINE_CURSOR_RECT *rect)');
  const callNextHookEx = user32.func('intptr_t __stdcall CallNextHookEx(BLOODLINE_CURSOR_HHOOK hook, int code, uintptr_t message, BLOODLINE_MOUSE_DATA *data)');
  const setWindowsHookEx = user32.func('BLOODLINE_CURSOR_HHOOK __stdcall SetWindowsHookExW(int idHook, BloodlineLowLevelMouseProc *callback, BLOODLINE_CURSOR_HINSTANCE module, uint32_t threadId)');
  const unhookWindowsHookEx = user32.func('bool __stdcall UnhookWindowsHookEx(BLOODLINE_CURSOR_HHOOK hook)');
  return {
    clipCursor,
    getCursorPos,
    getClipCursor,
    installMouseHook(callback) {
      /* Low-level mouse hooks run in this process before Windows posts the input to
         CK3 or Chromium. A null module is required for this in-process callback;
         passing Electron's module handle silently installs an inert hook. */
      const registration = koffi.register((code, message, data) => {
        if (code === 0 && message === WM_MOUSEMOVE) {
          const mouse = koffi.decode(data, 'BLOODLINE_MOUSE_DATA');
          callback({ x: mouse.pt.x, y: mouse.pt.y });
        }
        return callNextHookEx(null, code, message, data);
      }, koffi.pointer(LowLevelMouseProc));
      const hook = setWindowsHookEx(WH_MOUSE_LL, registration, null, 0);
      if (!hook) {
        koffi.unregister(registration);
        return null;
      }
      let installed = true;
      return () => {
        if (!installed) return;
        installed = false;
        try { unhookWindowsHookEx(hook); }
        finally { koffi.unregister(registration); }
      };
    },
  };
}

class WindowsCursorGuard {
  constructor(options = {}) {
    this.platform = options.platform || process.platform;
    this.logger = options.logger || console;
    this.api = options.api || null;
    this.koffi = options.koffi || null;
    this.intervalMs = options.intervalMs || 16;
    this.active = false;
    this.bounds = null;
    this.contains = null;
    this.timer = null;
    this.unhook = null;
    this.onMouseMove = null;
  }

  ensureApi() {
    if (this.platform !== 'win32') return false;
    try {
      if (!this.api) {
        this.koffi ||= require('koffi');
        this.api = createCursorApi(this.koffi);
      }
      return true;
    } catch (error) {
      this.logger.error('Dock cursor guard could not initialize:', error);
      return false;
    }
  }

  start(onMouseMove) {
    if (this.unhook) return true;
    if (typeof onMouseMove !== 'function' || !this.ensureApi() || typeof this.api.installMouseHook !== 'function') return false;
    this.onMouseMove = onMouseMove;
    try {
      this.unhook = this.api.installMouseHook((point) => {
        try { this.onMouseMove?.(point); }
        catch (error) { this.logger.error('Dock cursor hook failed:', error); }
      });
      if (typeof this.unhook !== 'function') {
        this.unhook = null;
        this.onMouseMove = null;
        return false;
      }
      return true;
    } catch (error) {
      this.logger.error('Dock cursor hook could not start:', error);
      this.unhook = null;
      this.onMouseMove = null;
      return false;
    }
  }

  arm(gameBounds, contains) {
    const bounds = cursorClipBounds(gameBounds);
    if (!bounds || !this.ensureApi()) return false;
    this.release();
    const nextContains = typeof contains === 'function' ? contains : null;
    try {
      /* A stale hover IPC must not clip a pointer that has already left the dock. */
      if (nextContains) {
        const point = { x: 0, y: 0 };
        if (!this.api.getCursorPos(point) || !nextContains(point)) return false;
      }
      if (!this.api.clipCursor(bounds)) return false;
    } catch (error) {
      this.logger.error('Dock cursor guard could not engage:', error);
      return false;
    }
    this.active = true;
    this.bounds = bounds;
    this.contains = nextContains;
    /* Native mouse entry is the primary path. This poll releases missed exits and
       restores the clip if CK3 or another overlay replaces it while still hovered. */
    this.timer = setInterval(() => this.check(), this.intervalMs);
    this.timer.unref?.();
    return true;
  }

  check() {
    if (!this.active) return;
    try {
      const point = { x: 0, y: 0 };
      if (!this.api.getCursorPos(point) || (this.contains && !this.contains(point))) {
        this.release();
        return;
      }
      if (typeof this.api.getClipCursor === 'function') {
        const current = { left: 0, top: 0, right: 0, bottom: 0 };
        if (!this.api.getClipCursor(current)) {
          this.release();
          return;
        }
        if (!sameRect(current, this.bounds) && !this.api.clipCursor(this.bounds)) this.release();
      }
    } catch {
      this.release();
    }
  }

  release() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const wasActive = this.active;
    this.active = false;
    this.bounds = null;
    this.contains = null;
    if (wasActive && this.api) {
      try { this.api.clipCursor(null); }
      catch (error) { this.logger.error('Dock cursor guard could not release:', error); }
    }
    return wasActive;
  }

  stop() {
    this.release();
    if (this.unhook) {
      try { this.unhook(); }
      catch (error) { this.logger.error('Dock cursor hook could not stop:', error); }
    }
    this.unhook = null;
    this.onMouseMove = null;
  }

  destroy() {
    this.stop();
  }
}

module.exports = { WindowsCursorGuard, createCursorApi, cursorClipBounds, DOCK_CURSOR_INSET };
