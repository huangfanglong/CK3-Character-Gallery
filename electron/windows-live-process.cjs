'use strict';

const READ_ACCESS = 0x0010 | 0x0400 | 0x1000;
const WRITE_ACCESS = READ_ACCESS | 0x0020 | 0x0008;

function createLiveProcessApi(koffi) {
  koffi.pointer('LIVE_HANDLE', koffi.opaque());
  koffi.alias('LIVE_DWORD', 'uint32_t');
  koffi.struct('LIVE_MODULEINFO', { base: 'void *', size: 'uint32_t', entry: 'void *' });
  const kernel = koffi.load('kernel32.dll');
  const psapi = koffi.load('psapi.dll');
  return {
    openProcess: kernel.func('LIVE_HANDLE __stdcall OpenProcess(LIVE_DWORD access, bool inherit, LIVE_DWORD pid)'),
    closeHandle: kernel.func('bool __stdcall CloseHandle(LIVE_HANDLE handle)'),
    queryPath: kernel.func('bool __stdcall QueryFullProcessImageNameW(LIVE_HANDLE process, LIVE_DWORD flags, _Out_ char16_t *path, _Inout_ LIVE_DWORD *size)'),
    readMemory: kernel.func('bool __stdcall ReadProcessMemory(LIVE_HANDLE process, const void *base, _Out_ uint8_t *buffer, size_t size, _Out_ size_t *read)'),
    writeMemory: kernel.func('bool __stdcall WriteProcessMemory(LIVE_HANDLE process, void *base, const uint8_t *buffer, size_t size, _Out_ size_t *written)'),
    enumModules: psapi.func('bool __stdcall EnumProcessModules(LIVE_HANDLE process, _Out_ LIVE_HANDLE *modules, LIVE_DWORD bytes, _Out_ LIVE_DWORD *needed)'),
    moduleInfo: psapi.func('bool __stdcall GetModuleInformation(LIVE_HANDLE process, LIVE_HANDLE module, _Out_ LIVE_MODULEINFO *info, LIVE_DWORD bytes)'),
    moduleName: psapi.func('LIVE_DWORD __stdcall GetModuleBaseNameW(LIVE_HANDLE process, LIVE_HANDLE module, _Out_ char16_t *name, LIVE_DWORD size)'),
  };
}

class WindowsLiveProcess {
  constructor(options = {}) {
    if ((options.platform || process.platform) !== 'win32') throw new Error('Live Game Link is available only on Windows.');
    this.api = options.api || createLiveProcessApi(options.koffi || require('koffi'));
    this.handles = new Set();
  }
  close(handle) {
    if (!handle || !this.handles.has(handle)) return;
    this.handles.delete(handle);
    this.api.closeHandle(handle);
  }
  closeAll() { for (const handle of [...this.handles]) this.close(handle); }
  open(pid, expectedPath, write = false) {
    if (!Number.isInteger(pid) || pid <= 0 || typeof expectedPath !== 'string' || !expectedPath.toLowerCase().endsWith('ck3.exe')) throw new Error('The CK3 process identity is invalid.');
    const handle = this.api.openProcess(write ? WRITE_ACCESS : READ_ACCESS, false, pid);
    if (!handle) throw new Error(write ? 'CK3 could not be opened for the confirmed DNA write. Check Windows permissions.' : 'CK3 could not be opened for read-only DNA access. Check Windows permissions.');
    this.handles.add(handle);
    try {
      const path = ['\0'.repeat(32768)];
      const length = [32768];
      if (!this.api.queryPath(handle, 0, path, length) || path[0].slice(0, length[0]).toLowerCase() !== expectedPath.toLowerCase()) throw new Error('The CK3 process changed. Focus its window and try again.');
      const modules = Array.from({ length: 1024 }, () => null);
      const needed = [0];
      if (!this.api.enumModules(handle, modules, modules.length * 8, needed) || !modules[0]) throw new Error('CK3’s executable module is unavailable.');
      const name = ['\0'.repeat(260)];
      if (!this.api.moduleName(handle, modules[0], name, 260) || !name[0].replace(/\0.*$/, '').toLowerCase().endsWith('ck3.exe')) throw new Error('The CK3 module identity could not be verified.');
      const info = {};
      if (!this.api.moduleInfo(handle, modules[0], info, 24) || !info.base || !info.size) throw new Error('CK3’s executable image bounds could not be verified.');
      return { handle, base: BigInt(info.base), size: Number(info.size) };
    } catch (error) { this.close(handle); throw error; }
  }
  async read(handle, address, size) {
    if (!this.handles.has(handle) || !Number.isInteger(size) || size < 0 || size > 256 * 1024 * 1024) throw new Error('The CK3 memory read is invalid.');
    const buffer = Buffer.alloc(size);
    const count = [0];
    if (!this.api.readMemory(handle, BigInt(address), buffer, size, count) || count[0] !== size) throw new Error(`CK3 memory changed or became unreadable (${size} bytes requested).`);
    return buffer;
  }
  async write(handle, address, raw) {
    if (!this.handles.has(handle) || !Buffer.isBuffer(raw) || raw.length === 0) throw new Error('The CK3 memory write is invalid.');
    const count = [0];
    const ok = this.api.writeMemory(handle, BigInt(address), raw, raw.length, count);
    return { ok: Boolean(ok && count[0] === raw.length), attempted: true };
  }
}

module.exports = { WindowsLiveProcess, createLiveProcessApi, READ_ACCESS, WRITE_ACCESS };
