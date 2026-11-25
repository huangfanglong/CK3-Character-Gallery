'use strict';

const { parentPort, workerData } = require('node:worker_threads');

const PW_RENDERFULLCONTENT = 2;
const SRCCOPY = 0x00cc0020;
const HALFTONE = 4;

function createWindowsCursorlessApi(koffi) {
  const HANDLE = koffi.pointer('CURSORLESS_CAPTURE_HANDLE', koffi.opaque());
  koffi.alias('CURSORLESS_CAPTURE_HDC', HANDLE);
  koffi.alias('CURSORLESS_CAPTURE_HBITMAP', HANDLE);
  koffi.alias('CURSORLESS_CAPTURE_HGDIOBJ', HANDLE);
  koffi.struct('CURSORLESS_CAPTURE_RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
  koffi.struct('CURSORLESS_CAPTURE_BITMAPINFOHEADER', {
    size: 'uint32_t', width: 'int32_t', height: 'int32_t', planes: 'uint16_t', bitCount: 'uint16_t',
    compression: 'uint32_t', sizeImage: 'uint32_t', xPelsPerMeter: 'int32_t', yPelsPerMeter: 'int32_t',
    clrUsed: 'uint32_t', clrImportant: 'uint32_t',
  });
  koffi.struct('CURSORLESS_CAPTURE_RGBQUAD', { blue: 'uint8_t', green: 'uint8_t', red: 'uint8_t', reserved: 'uint8_t' });
  koffi.struct('CURSORLESS_CAPTURE_BITMAPINFO', { header: 'CURSORLESS_CAPTURE_BITMAPINFOHEADER', colors: koffi.array('CURSORLESS_CAPTURE_RGBQUAD', 1) });
  const user32 = koffi.load('user32.dll');
  const gdi32 = koffi.load('gdi32.dll');
  return {
    getWindowRect: user32.func('bool __stdcall GetWindowRect(CURSORLESS_CAPTURE_HANDLE hwnd, _Out_ CURSORLESS_CAPTURE_RECT *rect)'),
    printWindow: user32.func('bool __stdcall PrintWindow(CURSORLESS_CAPTURE_HANDLE hwnd, CURSORLESS_CAPTURE_HDC dc, uint32_t flags)'),
    getDC: user32.func('CURSORLESS_CAPTURE_HDC __stdcall GetDC(CURSORLESS_CAPTURE_HANDLE hwnd)'),
    releaseDC: user32.func('int __stdcall ReleaseDC(CURSORLESS_CAPTURE_HANDLE hwnd, CURSORLESS_CAPTURE_HDC dc)'),
    createCompatibleDC: gdi32.func('CURSORLESS_CAPTURE_HDC __stdcall CreateCompatibleDC(CURSORLESS_CAPTURE_HDC dc)'),
    createCompatibleBitmap: gdi32.func('CURSORLESS_CAPTURE_HBITMAP __stdcall CreateCompatibleBitmap(CURSORLESS_CAPTURE_HDC dc, int width, int height)'),
    selectObject: gdi32.func('CURSORLESS_CAPTURE_HGDIOBJ __stdcall SelectObject(CURSORLESS_CAPTURE_HDC dc, CURSORLESS_CAPTURE_HGDIOBJ object)'),
    setStretchBltMode: gdi32.func('int __stdcall SetStretchBltMode(CURSORLESS_CAPTURE_HDC dc, int mode)'),
    stretchBlt: gdi32.func('bool __stdcall StretchBlt(CURSORLESS_CAPTURE_HDC target, int x, int y, int width, int height, CURSORLESS_CAPTURE_HDC source, int sourceX, int sourceY, int sourceWidth, int sourceHeight, uint32_t operation)'),
    deleteObject: gdi32.func('bool __stdcall DeleteObject(CURSORLESS_CAPTURE_HGDIOBJ object)'),
    deleteDC: gdi32.func('bool __stdcall DeleteDC(CURSORLESS_CAPTURE_HDC dc)'),
    getDIBits: gdi32.func('int __stdcall GetDIBits(CURSORLESS_CAPTURE_HDC dc, CURSORLESS_CAPTURE_HBITMAP bitmap, uint32_t start, uint32_t lines, _Out_ uint8_t *bits, CURSORLESS_CAPTURE_BITMAPINFO *info, uint32_t usage)'),
  };
}

function cursorlessBitmapInfo(api, width, height) {
  void api;
  return {
    header: {
      size: 40, width, height: -height, planes: 1, bitCount: 32, compression: 0,
      sizeImage: width * height * 4, xPelsPerMeter: 0, yPelsPerMeter: 0, clrUsed: 0, clrImportant: 0,
    },
    colors: [{ blue: 0, green: 0, red: 0, reserved: 0 }],
  };
}

class WindowsCursorlessFrameSource {
  constructor(options) {
    if ((options.platform || process.platform) !== 'win32') throw new Error('Cursor-free dock capture is available only on Windows.');
    if (typeof options.gameHwnd !== 'string' || !/^\d{1,20}$/.test(options.gameHwnd)) throw new Error('The CK3 capture window is invalid.');
    if (!options.crop || !['x', 'y', 'size'].every((key) => Number.isInteger(options.crop[key]) && options.crop[key] >= 0) || options.crop.size < 1) throw new Error('The cursor-free portrait crop is invalid.');
    this.hwndText = options.gameHwnd;
    this.hwnd = BigInt(options.gameHwnd);
    this.crop = { x: options.crop.x, y: options.crop.y, size: options.crop.size };
    this.width = options.width || 450;
    this.height = options.height || 450;
    this.api = options.api || createWindowsCursorlessApi(options.koffi || require('koffi'));
    this.resources = null;
  }

  open() {
    if (this.resources) return;
    const resources = { windowDC: null, sourceDC: null, targetDC: null, sourceBitmap: null, targetBitmap: null, previousSource: null, previousTarget: null, width: 0, height: 0 };
    this.resources = resources;
    try {
      const rect = {};
      if (!this.api.getWindowRect(this.hwnd, rect)) throw new Error('The CK3 capture window is no longer available.');
      resources.width = rect.right - rect.left;
      resources.height = rect.bottom - rect.top;
      if (resources.width < 1 || resources.height < 1 || this.crop.x + this.crop.size > resources.width || this.crop.y + this.crop.size > resources.height) throw new Error('The portrait frame no longer fits the CK3 window.');
      resources.windowDC = this.api.getDC(this.hwnd);
      resources.sourceDC = this.api.createCompatibleDC(resources.windowDC);
      resources.targetDC = this.api.createCompatibleDC(resources.windowDC);
      resources.sourceBitmap = this.api.createCompatibleBitmap(resources.windowDC, resources.width, resources.height);
      resources.targetBitmap = this.api.createCompatibleBitmap(resources.windowDC, this.width, this.height);
      if (!resources.windowDC || !resources.sourceDC || !resources.targetDC || !resources.sourceBitmap || !resources.targetBitmap) throw new Error('Windows could not allocate the cursor-free capture surfaces.');
      resources.previousSource = this.api.selectObject(resources.sourceDC, resources.sourceBitmap);
      resources.previousTarget = this.api.selectObject(resources.targetDC, resources.targetBitmap);
      this.api.setStretchBltMode(resources.targetDC, HALFTONE);
    } catch (error) {
      this.close();
      throw error;
    }
  }

  capture() {
    this.open();
    const resources = this.resources;
    const rect = {};
    if (!this.api.getWindowRect(this.hwnd, rect) || rect.right - rect.left !== resources.width || rect.bottom - rect.top !== resources.height) throw new Error('CK3 capture resolution changed.');
    /* PrintWindow renders the window itself, not the composited desktop cursor.
       PW_RENDERFULLCONTENT is required for CK3's hardware-rendered DirectX content. */
    if (!this.api.printWindow(this.hwnd, resources.sourceDC, PW_RENDERFULLCONTENT)) throw new Error('Windows could not render the CK3 window without the cursor.');
    if (!this.api.stretchBlt(resources.targetDC, 0, 0, this.width, this.height, resources.sourceDC, this.crop.x, this.crop.y, this.crop.size, this.crop.size, SRCCOPY)) throw new Error('Windows could not scale the cursor-free portrait.');
    const pixels = Buffer.allocUnsafe(this.width * this.height * 4);
    const info = cursorlessBitmapInfo(this.api, this.width, this.height);
    if (this.api.getDIBits(resources.targetDC, resources.targetBitmap, 0, this.height, pixels, info, 0) !== this.height) throw new Error('Windows could not read the cursor-free portrait pixels.');
    /* GDI returns BGRA; the renderer's ImageData expects opaque RGBA. */
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const blue = pixels[offset];
      pixels[offset] = pixels[offset + 2];
      pixels[offset + 2] = blue;
      pixels[offset + 3] = 255;
    }
    return pixels;
  }

  close() {
    const resources = this.resources;
    this.resources = null;
    if (!resources) return;
    try { if (resources.previousSource) this.api.selectObject(resources.sourceDC, resources.previousSource); } catch {}
    try { if (resources.previousTarget) this.api.selectObject(resources.targetDC, resources.previousTarget); } catch {}
    try { if (resources.sourceBitmap) this.api.deleteObject(resources.sourceBitmap); } catch {}
    try { if (resources.targetBitmap) this.api.deleteObject(resources.targetBitmap); } catch {}
    try { if (resources.sourceDC) this.api.deleteDC(resources.sourceDC); } catch {}
    try { if (resources.targetDC) this.api.deleteDC(resources.targetDC); } catch {}
    try { if (resources.windowDC) this.api.releaseDC(this.hwnd, resources.windowDC); } catch {}
  }
}

function runCursorlessWorker() {
  const settings = workerData?.cursorlessCapture;
  if (!parentPort || !settings) return;
  let source = null;
  let timer = null;
  let sequence = 0;
  let stopped = false;
  const close = () => {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
    source?.close();
  };
  const fail = (error) => {
    if (stopped) return;
    close();
    parentPort.postMessage({ type: 'error', message: String(error?.message || error || 'Cursor-free CK3 capture failed.').slice(0, 300) });
    parentPort.close();
  };
  const capture = () => {
    if (stopped) return;
    try {
      const pixels = source.capture();
      sequence += 1;
      parentPort.postMessage({ type: 'frame', sequence, pixels: pixels.buffer }, [pixels.buffer]);
    } catch (error) { fail(error); }
  };
  parentPort.once('message', (message) => {
    if (message?.type !== 'stop') return;
    close();
    parentPort.close();
  });
  try {
    source = new WindowsCursorlessFrameSource(settings);
    source.open();
    capture();
    if (!stopped) timer = setInterval(capture, Math.max(1, Math.round(1000 / (settings.fps || 30))));
  } catch (error) { fail(error); }
}

runCursorlessWorker();

module.exports = { WindowsCursorlessFrameSource, createWindowsCursorlessApi, cursorlessBitmapInfo };
