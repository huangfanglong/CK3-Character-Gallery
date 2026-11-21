'use strict';

const { decodeX64 } = require('./x64-decoder.cjs');
const CHARACTER_DATABASE = '.?AV?$TPdxRefDatabase@VCCharacter@@$07@@';
const WINDOW_CLASS = '.?AVCCharacterWindow@@';
const IDLER_CLASS = '.?AVCInGameInterfaceIdler@@';
function qword(value) { return BigInt.asUintN(64, BigInt(value)); }
function unique(values) { return [...new Set(values)]; }
function uint32(value) { return Number(BigInt.asUintN(32, BigInt(value))); }

function parsePe(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 0x400 || buffer.toString('ascii', 0, 2) !== 'MZ') throw new Error('CK3’s executable is not a valid PE image.');
  const pe = buffer.readUInt32LE(0x3c);
  if (buffer.toString('ascii', pe, pe + 4) !== 'PE\0\0' || buffer.readUInt16LE(pe + 4) !== 0x8664) throw new Error('Only 64-bit CK3 installations are supported.');
  const optional = pe + 24;
  if (buffer.readUInt16LE(optional) !== 0x20b) throw new Error('CK3’s executable header is unsupported.');
  const sectionCount = buffer.readUInt16LE(pe + 6);
  const optionalSize = buffer.readUInt16LE(pe + 20);
  const imageBase = buffer.readBigUInt64LE(optional + 24);
  const sizeOfImage = buffer.readUInt32LE(optional + 56);
  if (sizeOfImage <= 0 || sizeOfImage > 1024 * 1024 * 1024 || sectionCount > 96) throw new Error('CK3’s executable image bounds are invalid.');
  const sections = [];
  for (let index = 0; index < sectionCount; index++) {
    const offset = optional + optionalSize + index * 40;
    const virtualSize = buffer.readUInt32LE(offset + 8);
    const rva = buffer.readUInt32LE(offset + 12);
    const rawSize = buffer.readUInt32LE(offset + 16);
    const rawOffset = buffer.readUInt32LE(offset + 20);
    const size = Math.min(virtualSize || rawSize, rawSize);
    const mappedSize = Math.max(virtualSize || rawSize, rawSize);
    if (rawOffset + size > buffer.length || rva + mappedSize > sizeOfImage) throw new Error('CK3’s executable sections are truncated.');
    sections.push({ name: buffer.toString('ascii', offset, offset + 8).replace(/\0.*$/, ''), rva, size, mappedSize, data: buffer.subarray(rawOffset, rawOffset + size), executable: Boolean(buffer.readUInt32LE(offset + 36) & 0x20000000) });
  }
  const ordered = [...sections].sort((a, b) => a.rva - b.rva);
  for (const [index, section] of ordered.entries()) {
    const end = ordered[index + 1]?.rva ?? sizeOfImage;
    section.mappedSize = Math.min(section.mappedSize, end - section.rva);
  }
  for (const name of ['.text', '.rdata', '.data']) if (!sections.some((section) => section.name === name)) throw new Error(`CK3’s ${name} section is missing.`);
  return { imageBase, sizeOfImage, sections };
}

class Ck3LayoutResolver {
  constructor(executable, base, readMemory) {
    this.pe = parsePe(executable);
    this.base = qword(base);
    this.readMemory = readMemory;
    this.sections = new Map();
    this.runtimeSections = new Map();
    this.rttiCache = new Map();
    this.vtableCache = new Map();
    this.staticCache = new Map();
  }

  section(name) { return this.pe.sections.find((section) => section.name === name); }
  sectionAtRva(rva, length = 1) {
    return this.pe.sections.find((section) => rva >= section.rva && rva + length <= section.rva + section.mappedSize && rva + length >= rva);
  }
  inImage(address, sectionName = '') {
    const rva = Number(qword(address) - this.base);
    return Number.isSafeInteger(rva) && rva >= 0 && (!sectionName || this.sectionAtRva(rva, 8)?.name === sectionName);
  }
  address(rva) { return this.base + BigInt(rva); }
  async loadSection(name) {
    if (this.sections.has(name)) return this.sections.get(name);
    const section = this.section(name);
    if (!section || section.size > 256 * 1024 * 1024) throw new Error(`CK3’s ${name} section is too large to validate.`);
    const data = await this.readMemory(this.address(section.rva), section.size);
    this.sections.set(name, data);
    return data;
  }
  async loadRuntimeSection(name) {
    if (this.runtimeSections.has(name)) return this.runtimeSections.get(name);
    const section = this.section(name);
    if (!section || section.mappedSize > 256 * 1024 * 1024) throw new Error(`CK3’s mapped ${name} section is too large to validate.`);
    const data = section.mappedSize === section.size ? await this.loadSection(name) : await this.readMemory(this.address(section.rva), section.mappedSize);
    this.runtimeSections.set(name, data);
    return data;
  }
  async readRva(rva, size) {
    const section = this.sectionAtRva(rva, size);
    if (!section) return null;
    const offset = rva - section.rva;
    const data = offset + size > section.size ? await this.loadRuntimeSection(section.name) : await this.loadSection(section.name);
    return data.subarray(offset, offset + size);
  }
  async pointerRva(rva) { return (await this.readRva(rva, 8))?.readBigUInt64LE(0) ?? null; }
  async pointer(address) {
    if (!qword(address)) return null;
    try { return (await this.readMemory(qword(address), 8)).readBigUInt64LE(0); } catch { return null; }
  }
  async rttiNameForVtable(address) {
    const rva = Number(qword(address) - this.base);
    if (!Number.isSafeInteger(rva) || rva < 8 || this.rttiCache.has(rva)) return this.rttiCache.get(rva) || null;
    let name = '';
    /* The qword before a vtable's address point points to its complete object
       locator. The locator is not part of the vtable and can live elsewhere. */
    const locatorAddress = await this.pointerRva(rva - 8);
    const locatorRva = locatorAddress === null ? NaN : Number(qword(locatorAddress) - this.base);
    const locator = Number.isSafeInteger(locatorRva) ? await this.readRva(locatorRva, 16) : null;
    if (locator?.readUInt32LE(0) === 1) {
      const type = await this.readRva(locator.readUInt32LE(12) + 16, 256);
      if (type) name = type.toString('utf8').split('\0')[0];
    }
    this.rttiCache.set(rva, name);
    return name || null;
  }
  async className(object) {
    const vtable = await this.pointer(object);
    return vtable && this.inImage(vtable, '.rdata') ? this.rttiNameForVtable(vtable) : null;
  }
  async vtables(className) {
    if (this.vtableCache.has(className)) return this.vtableCache.get(className);
    const rdata = this.section('.rdata');
    const bytes = await this.loadSection('.rdata');
    const needle = Buffer.from(`${className}\0`, 'utf8');
    const descriptors = new Set();
    /* CK3 emits type descriptors into .data. Accept .rdata too for other valid
       MSVC layouts, but never assume both are in the same section. */
    for (const section of [this.section('.data'), this.section('.rdata')]) {
      if (!section) continue;
      const data = await this.loadSection(section.name);
      for (let at = data.indexOf(needle); at >= 0; at = data.indexOf(needle, at + 1)) {
        if (at >= 16) descriptors.add(section.rva + at - 16);
      }
    }
    const tables = [];
    for (let at = 0; at + 8 <= bytes.length; at += 8) {
      const locatorRva = Number(bytes.readBigUInt64LE(at) - this.base);
      const local = locatorRva - rdata.rva;
      if (!Number.isSafeInteger(locatorRva) || local < 0 || local + 16 > bytes.length) continue;
      if (bytes.readUInt32LE(local) !== 1 || !descriptors.has(bytes.readUInt32LE(local + 12))) continue;
      const vtableRva = rdata.rva + at + 8;
      const first = await this.pointerRva(vtableRva);
      if (first && this.inImage(first, '.text')) tables.push({ rva: vtableRva, subobjectOffset: bytes.readInt32LE(local + 4) });
    }
    const distinct = [...new Map(tables.map((table) => [`${table.rva}:${table.subobjectOffset}`, table])).values()];
    this.vtableCache.set(className, distinct);
    return distinct;
  }
  async oneVtable(className) {
    const tables = await this.vtables(className);
    const primary = tables.filter((table) => table.subobjectOffset === 0);
    if (primary.length !== 1) throw new Error(`CK3’s ${className} vtable is ${primary.length ? 'ambiguous' : 'unavailable'}. Open a saved game and try again.`);
    return primary[0];
  }
  async findStatic(className) {
    if (this.staticCache.has(className)) return this.staticCache.get(className);
    const table = await this.oneVtable(className);
    const section = this.section('.data');
    /* Static singleton pointers can live in zero-initialized BSS beyond the bytes
       stored in the PE file. Read the mapped section, while keeping RTTI parsing
       restricted to file-backed data above. */
    const data = await this.loadRuntimeSection('.data');
    const vtable = this.address(table.rva);
    const candidates = [];
    for (let at = 0; at + 8 <= data.length; at += 8) {
      const object = data.readBigUInt64LE(at);
      if (object < 0x10000n || object === vtable || (object >= this.base && object < this.base + BigInt(this.pe.sizeOfImage))) continue;
      if (await this.pointer(object) === vtable) candidates.push(section.rva + at);
    }
    if (candidates.length !== 1) throw new Error(`CK3’s ${className} static object is ${candidates.length ? 'ambiguous' : 'not initialized yet'}.`);
    const rva = candidates[0];
    this.staticCache.set(className, rva);
    return rva;
  }
  async staticObject(className) {
    const rva = await this.findStatic(className);
    const object = await this.pointerRva(rva);
    if (!object || await this.className(object) !== className) throw new Error(`CK3’s ${className} is unavailable. Load a save before using Live Game Link.`);
    return object;
  }
  async field(object, className, size) {
    const table = await this.oneVtable(className);
    const vtable = this.address(table.rva);
    const candidates = [];
    for (let offset = 0; offset <= size - 8; offset += 8) {
      const pointer = await this.pointer(object + BigInt(offset));
      if (pointer && await this.pointer(pointer) === vtable) candidates.push(pointer);
    }
    if (candidates.length !== 1) throw new Error(`CK3’s ${className} interface path is unavailable or ambiguous.`);
    return candidates[0];
  }
  instruction(rva) {
    const section = this.sectionAtRva(rva, 1);
    if (!section?.executable) throw new Error('Dispatcher instruction left executable memory.');
    const local = rva - section.rva;
    if (section.size - local < 1) throw new Error('Dispatcher instruction left executable memory.');
    const decoded = decodeX64(this.sections.get(section.name), local);
    decoded.rva = rva;
    decoded.next = rva + decoded.size;
    if (decoded.target !== null) decoded.target += rva - local;
    if (decoded.operands.some((operand) => operand.ripRelative)) {
      for (const operand of decoded.operands) if (operand.ripRelative) operand.address = decoded.next + operand.displacement;
    }
    return decoded;
  }
  async windowIdOffsets(vtableRva) {
    const pointers = await this.readRva(vtableRva, 256 * 8);
    const candidates = [];
    for (let slot = 0; slot < 256 && pointers; slot++) {
      const address = pointers.readBigUInt64LE(slot * 8);
      if (!this.inImage(address, '.text')) continue;
      const objects = new Set(['rcx']);
      let previous = null;
      try {
        let rva = Number(address - this.base);
        for (let count = 0; count < 40; count++) {
          const op = this.instruction(rva);
          const [destination, source] = op.operands;
          if (op.mnemonic === 'mov' && destination?.kind === 'reg' && source?.kind === 'reg') {
            if (objects.has(source.name)) objects.add(destination.name);
            else objects.delete(destination.name);
          } else if (destination?.kind === 'reg') objects.delete(destination.name);
          if (op.mnemonic === 'call') for (const name of ['rax', 'rcx', 'rdx', 'r8', 'r9', 'r10', 'r11']) objects.delete(name);
          if (op.mnemonic === 'cmp') previous = op;
          else if (op.mnemonic === 'sete' && previous) {
            const memory = previous.operands.find((operand) => operand.kind === 'mem' && !operand.index && !operand.ripRelative);
            if (memory && objects.has(memory.base) && memory.displacement >= 0x18 && memory.displacement <= 0x400) candidates.push(memory.displacement);
            previous = null;
          } else if (['ret', 'jmp', 'int3'].includes(op.mnemonic)) break;
          else if (!['cmp', 'test'].includes(op.mnemonic)) previous = null;
          rva = op.next;
        }
      } catch { /* Other virtual methods need not use the supported instruction subset. */ }
    }
    const distinct = unique(candidates).sort((a, b) => a - b);
    /* Different window modes can carry the shown ID in different fields. Static
       analysis proposes candidates; the engine must validate exactly one against
       the character's database identity on every read, never just use the first. */
    if (!distinct.length) throw new Error('CK3’s shown-character ID offset is not recognized; Live Game Link will not guess it.');
    return distinct;
  }
  async keywordToken(keyword) {
    const section = this.section('.rdata');
    const data = await this.loadSection('.rdata');
    const needle = Buffer.from(`\0${keyword}\0`, 'utf8');
    const tokens = [];
    const entryValid = (offset) => offset >= 0 && offset + 16 <= data.length
      && data.readBigUInt64LE(offset) < 0x100000n
      && this.inImage(data.readBigUInt64LE(offset + 8), '.rdata');
    for (let at = data.indexOf(needle); at >= 0; at = data.indexOf(needle, at + 1)) {
      const stringRva = section.rva + at + 1;
      const pointer = Buffer.alloc(8);
      pointer.writeBigUInt64LE(this.address(stringRva));
      for (let hit = data.indexOf(pointer); hit >= 0; hit = data.indexOf(pointer, hit + 1)) {
        const entry = hit - 8;
        if (!entryValid(entry)) continue;
        let low = entry;
        let high = entry;
        while (entryValid(low - 16) && entry - low < 0x200000) low -= 16;
        while (entryValid(high + 16) && high - entry < 0x200000) high += 16;
        if ((high - low) / 16 + 1 >= 1000) tokens.push(Number(data.readBigUInt64LE(entry)));
      }
    }
    const distinct = unique(tokens);
    if (distinct.length !== 1) throw new Error(`CK3’s “${keyword}” save token could not be uniquely resolved.`);
    return distinct[0];
  }
  tokenRegister(fn) {
    for (let count = 0, rva = fn; count < 40; count++) {
      const op = this.instruction(rva);
      if (['cmp', 'sub'].includes(op.mnemonic) && op.operands[0]?.kind === 'reg' && op.operands[1]?.kind === 'imm' && /^(?:e..|r\d+d)$/.test(op.operands[0].name)) return op.operands[0].name;
      if (op.mnemonic === 'ret') return null;
      rva = op.next;
    }
    return null;
  }
  walkDispatcher(fn, tokenName, objectName = 'rcx') {
    const fields = new Map();
    const seen = new Set();
    let steps = 0;
    const volatile = ['rax', 'rcx', 'rdx', 'r8', 'r9', 'r10', 'r11'];
    const visit = (start, accumulator, equal, last, tokens, objects) => {
      let rva = start;
      while (true) {
        const key = `${rva}:${accumulator}:${equal}`;
        if (seen.has(key) || ++steps > 8000) return;
        seen.add(key);
        const op = this.instruction(rva);
        const [destination, source] = op.operands;
        if (['cmp', 'sub', 'add'].includes(op.mnemonic) && destination?.kind === 'reg' && tokens.has(destination.name) && source?.kind === 'imm') {
          const immediate = Number(source.value);
          if (op.mnemonic === 'cmp') last = uint32(accumulator + immediate);
          else { accumulator = uint32(accumulator + (op.mnemonic === 'sub' ? immediate : -immediate)); last = accumulator; }
        } else if (op.mnemonic === 'dec' && tokens.has(destination?.name)) { accumulator = uint32(accumulator + 1); last = accumulator; }
        else if (['cmp', 'test'].includes(op.mnemonic)) last = null;
        if (op.mnemonic === 'mov' && destination?.kind === 'reg' && source?.kind === 'reg') {
          if (tokens.has(source.name)) tokens = new Set(tokens).add(destination.name);
          else if (objects.has(source.name)) objects = new Set(objects).add(destination.name);
          else { objects = new Set(objects); objects.delete(destination.name); tokens = new Set(tokens); tokens.delete(destination.name); }
        } else if (destination?.kind === 'reg' && ['mov', 'lea', 'xor', 'movzx', 'movsx', 'movsxd', 'pop'].includes(op.mnemonic)) {
          objects = new Set(objects); objects.delete(destination.name);
          tokens = new Set(tokens); tokens.delete(destination.name);
        }
        if (op.mnemonic === 'call' && this.instruction(op.next).mnemonic !== 'sub') {
          objects = new Set(objects); volatile.forEach((name) => objects.delete(name));
        }
        if (/^j/.test(op.mnemonic)) {
          const target = op.target;
          const near = target !== null && Math.abs(target - fn) < 0x8000;
          if (op.mnemonic === 'jmp') { if (!near) return; rva = target; continue; }
          if (near) visit(target, accumulator, ['je', 'jz'].includes(op.mnemonic) ? last ?? equal : equal, null, tokens, objects);
          if (['jne', 'jnz'].includes(op.mnemonic) && last !== null) equal = last;
          rva = op.next;
          continue;
        }
        if (op.mnemonic === 'lea' && destination?.kind === 'reg' && source?.kind === 'mem' && equal !== null && objects.has(source.base) && !objects.has(destination.name) && !source.index && !source.ripRelative) {
          const list = fields.get(equal) || new Set();
          list.add(source.displacement);
          fields.set(equal, list);
          return;
        }
        if (['ret', 'int3'].includes(op.mnemonic)) return;
        rva = op.next;
      }
    };
    visit(fn, 0, null, null, new Set([tokenName]), new Set([objectName]));
    return fields;
  }
  async characterDnaOffset() {
    const token = await this.keywordToken('dna');
    const tables = await this.vtables('.?AVCCharacter@@');
    if (!tables.length) throw new Error('CK3’s character class was not found.');
    let resolved = null;
    for (const table of tables) {
      let fnRva = Number(await this.pointerRva(table.rva + 32) - this.base);
      if (!this.sectionAtRva(fnRva, 1)?.executable) continue;
      try {
        const first = this.instruction(fnRva);
        const second = this.instruction(first.next);
        const third = this.instruction(second.next);
        if (first.mnemonic === 'movsxd' && second.mnemonic === 'sub' && third.mnemonic === 'jmp') fnRva = third.target;
        const tokenName = this.tokenRegister(fnRva);
        if (!tokenName) continue;
        const fields = this.walkDispatcher(fnRva, tokenName);
        const offsets = fields.get(token);
        if (offsets?.size !== 1) continue;
        const offset = table.subobjectOffset + [...offsets][0];
        if (offset < 0x40 || offset > 0x800 || (resolved !== null && resolved !== offset)) throw new Error('CK3’s character save fields disagree about the DNA location.');
        resolved = offset;
      } catch (error) { if (/disagree/.test(error.message)) throw error; }
    }
    if (resolved === null) throw new Error('CK3’s DNA field could not be safely derived from its save-field dispatcher.');
    return resolved;
  }
  async resolve() {
    await Promise.all(['.text', '.rdata', '.data'].map((name) => this.loadSection(name)));
    const window = await this.oneVtable(WINDOW_CLASS);
    const [idOffsets, dnaOffset] = await Promise.all([this.windowIdOffsets(window.rva), this.characterDnaOffset()]);
    return {
      format: 2,
      windowVtableRva: window.rva,
      idOffsets,
      dnaOffset,
      databaseClass: CHARACTER_DATABASE,
      idlerClass: IDLER_CLASS,
      // These GUI fields are guarded by the vtable, readable GUI pointer, finite opacity,
      // and the character/database identity chain before every use. Unknown values fail.
      guiOffset: 0x60,
      opacityOffset: 0x108,
    };
  }
}

module.exports = { Ck3LayoutResolver, parsePe, CHARACTER_DATABASE, WINDOW_CLASS, IDLER_CLASS, uint32 };
