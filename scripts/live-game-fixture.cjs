const { createGeneCatalog, rawToPersistentDna } = require('../electron/live-dna-codec.cjs');

const BASE = 0x140000000n;
const RVA = { text: 0x1000, rdata: 0x2000, data: 0x9000 };
const IDS = { window: 1, character: 2, idler: 3, database: 4, gfx: 5, handler: 6 };
const NAMES = {
  window: '.?AVCCharacterWindow@@', character: '.?AVCCharacter@@', idler: '.?AVCInGameInterfaceIdler@@',
  database: '.?AV?$TPdxRefDatabase@VCCharacter@@$07@@', gfx: '.?AVCIngameInterfaceIdlerGfx@@', handler: '.?AVCIngameInterfaceHandler@@',
  gui: '.?AVCPdxGuiWindow@@',
};
function catalog() {
  const colors = ['hair_color', 'skin_color', 'eye_color'];
  const morph = Array.from({ length: 20 }, (_, index) => `gene_shape_${index}`);
  const result = createGeneCatalog([
    { name: '00_genes_color.txt', text: `color_genes={${colors.map((name) => `${name}={}`).join('')}}` },
    { name: '01_genes_morph.txt', text: `morph_genes={${morph.map((name) => `${name}={shape_neg={index=0}shape_pos={index=1}}`).join('')}}` },
    { name: '02_genes_accessories_misc.txt', text: 'accessory_genes={eye_accessory={none={index=0}}}' },
  ]);
  result.hash = 'fixture-catalog-v1';
  return result;
}

function executable() {
  const size = 0x8000;
  const buffer = Buffer.alloc(size);
  buffer.write('MZ', 0);
  buffer.writeUInt32LE(0x80, 0x3c);
  buffer.write('PE\0\0', 0x80);
  buffer.writeUInt16LE(0x8664, 0x84);
  buffer.writeUInt16LE(3, 0x86);
  buffer.writeUInt16LE(0xf0, 0x94);
  const optional = 0x98;
  buffer.writeUInt16LE(0x20b, optional);
  buffer.writeBigUInt64LE(BASE, optional + 24);
  buffer.writeUInt32LE(0xa000, optional + 56);
  const sections = [
    { name: '.text', rva: RVA.text, offset: 0x400, length: 0x1000, flags: 0x20000000 },
    { name: '.rdata', rva: RVA.rdata, offset: 0x1400, length: 0x6000, flags: 0 },
    { name: '.data', rva: RVA.data, offset: 0x7400, length: 0xc00, flags: 0 },
  ];
  for (const [index, section] of sections.entries()) {
    const at = optional + 0xf0 + index * 40;
    buffer.write(section.name, at);
    buffer.writeUInt32LE(section.length, at + 8);
    buffer.writeUInt32LE(section.rva, at + 12);
    buffer.writeUInt32LE(section.length, at + 16);
    buffer.writeUInt32LE(section.offset, at + 20);
    buffer.writeUInt32LE(section.flags, at + 36);
  }
  const write = (rva, offset, value) => {
    const section = sections.find((item) => rva >= item.rva && rva + offset + 8 <= item.rva + item.length);
    buffer.writeBigUInt64LE(BigInt(value), section.offset + rva - section.rva + offset);
  };
  const bytes = (rva, values) => Buffer.from(values).copy(buffer, 0x400 + rva - RVA.text);
  const vtables = {};
  for (const [index, [key, type]] of Object.entries(NAMES).entries()) {
    const rva = RVA.rdata + index * 0x400;
    const at = 0x1400 + index * 0x400;
    const descriptor = RVA.data + 0x400 + index * 0x80;
    const locator = rva + 0x80;
    buffer.writeUInt32LE(1, at + 0x80);
    buffer.writeInt32LE(0, at + 0x84);
    buffer.writeUInt32LE(descriptor, at + 0x8c);
    buffer.write(`${type}\0`, 0x7400 + descriptor - RVA.data + 0x10, 'utf8');
    vtables[key] = rva + 0x100;
    buffer.writeBigUInt64LE(BASE + BigInt(locator), at + 0xf8);
    write(vtables[key], 0, BASE + BigInt(RVA.text + 0x100));
    write(vtables[key], 32, BASE + BigInt(RVA.text + 0x200));
    if (key === 'window') {
      write(vtables[key], 19 * 8, BASE + BigInt(RVA.text + 0x120));
      write(vtables[key], 59 * 8, BASE + BigInt(RVA.text + 0x140));
      const secondaryLocator = rva + 0x180;
      vtables.windowSecondary = rva + 0x200;
      buffer.writeUInt32LE(1, at + 0x180);
      buffer.writeInt32LE(16, at + 0x184);
      buffer.writeUInt32LE(descriptor, at + 0x18c);
      buffer.writeBigUInt64LE(BASE + BigInt(secondaryLocator), at + 0x1f8);
      write(vtables.windowSecondary, 0, BASE + BigInt(RVA.text + 0x100));
    }
  }
  bytes(RVA.text + 0x100, [0x48, 0x39, 0x91, 0xc8, 0, 0, 0, 0x0f, 0x94, 0xc0, 0xc3]);
  bytes(RVA.text + 0x120, [0x48, 0x89, 0xcb, 0x48, 0x39, 0x93, 0xf8, 0, 0, 0, 0x0f, 0x94, 0xc0, 0xc3]);
  bytes(RVA.text + 0x140, [0x32, 0xc0, 0xc3]);
  bytes(RVA.text + 0x200, [0x41, 0x81, 0xe8, 0x00, 0x05, 0, 0, 0x74, 0x04, 0x32, 0xc0, 0xc3, 0x90, 0x48, 0x8d, 0x81, 0x60, 1, 0, 0, 0xc3]);
  const keywordName = RVA.rdata + 0x5f00;
  buffer.write('\0dna\0', 0x1400 + 0x5eff, 'utf8');
  for (let index = 0; index < 1000; index++) {
    const at = 0x1400 + 0x2000 + index * 16;
    buffer.writeBigUInt64LE(BigInt(index === 10 ? 0x500 : 0x300 + index), at);
    buffer.writeBigUInt64LE(BASE + BigInt(index === 10 ? keywordName : RVA.rdata), at + 8);
  }
  write(RVA.data, 0, 0x5000000);
  write(RVA.data, 8, 0x6000000);
  return { buffer, sections, vtables, keywordToken: 0x500 };
}

class MemoryProcess {
  constructor(pe, geneCatalog) {
    this.pe = pe;
    this.catalog = geneCatalog;
    this.memory = [];
    this.handles = new Set();
    this.openCalls = [];
    this.writeCalls = [];
    this.failNextWrite = false;
    this.addSections();
    this.addObjects();
  }
  add(address, data) { this.memory.push({ address: BigInt(address), data }); }
  patch(address, offset, value, size = 8) {
    const item = this.memory.find((entry) => BigInt(address) >= entry.address && BigInt(address) + BigInt(offset) + BigInt(size) <= entry.address + BigInt(entry.data.length));
    if (!item) throw new Error(`Missing fixture memory ${address.toString(16)}+${offset}`);
    if (size === 8) item.data.writeBigUInt64LE(BigInt(value), offset);
    else if (size === 4) item.data.writeUInt32LE(Number(value), offset);
    else Buffer.from(value).copy(item.data, offset);
  }
  pointer(address, offset, value) { this.patch(address, offset, BigInt(value), 8); }
  addSections() {
    for (const section of this.pe.sections) this.add(BASE + BigInt(section.rva), this.pe.buffer.subarray(section.offset, section.offset + section.length));
  }
  addObjects() {
    const objects = { idler: 0x5000000n, gfx: 0x5100000n, handler: 0x5200000n, window: 0x5300000n, character: 0x5400000n, dna: 0x5500000n, gui: 0x5600000n, database: 0x6000000n, slots: 0x6100000n };
    this.objects = objects;
    for (const [name, address] of Object.entries(objects)) this.add(address, Buffer.alloc(name === 'slots' ? 0x4000 : 0x1000));
    this.pointer(objects.idler, 0, BASE + BigInt(this.pe.vtables.idler));
    this.pointer(objects.gfx, 0, BASE + BigInt(this.pe.vtables.gfx));
    this.pointer(objects.handler, 0, BASE + BigInt(this.pe.vtables.handler));
    this.pointer(objects.window, 0, BASE + BigInt(this.pe.vtables.window));
    this.pointer(objects.character, 0, BASE + BigInt(this.pe.vtables.character));
    this.pointer(objects.database, 0, BASE + BigInt(this.pe.vtables.database));
    this.pointer(objects.gui, 0, BASE + BigInt(this.pe.vtables.gui));
    this.pointer(objects.idler, 0x10, objects.gfx);
    this.pointer(objects.gfx, 0x20, objects.handler);
    this.pointer(objects.handler, 0x30, objects.window);
    this.pointer(objects.window, 0x60, objects.gui);
    this.memory.find((entry) => entry.address === objects.gui).data.writeFloatLE(1, 0x108);
    this.patch(objects.window, 0xc8, 1, 4);
    this.patch(objects.character, 0x18, 1, 4);
    this.pointer(objects.database, 0x20, objects.slots);
    this.patch(objects.database, 0x2c, 16, 4);
    this.pointer(objects.slots, 16 + 8, objects.character);
    this.pointer(objects.character, 0x160, objects.dna);
    this.patch(objects.character, 0x168, this.catalog.genes.length, 4);
    this.patch(objects.character, 0x16c, this.catalog.genes.length, 4);
    Buffer.from(this.catalog.genes.map((gene, index) => gene.color ? [index, 20, 30, 40] : gene.name === 'eye_accessory' ? [0, 0, 0, 0] : [1, 100 + index, 0, 80]).flat()).copy(this.memory.find((entry) => entry.address === objects.dna).data);
    this.patch(objects.character, 0x20, Buffer.from('Aella'), 5);
    this.patch(objects.character, 0x30, 5, 8);
    this.patch(objects.character, 0x38, 15, 8);
  }
  open(pid, executablePath, write) { const handle = { pid, write: Boolean(write) }; this.handles.add(handle); this.openCalls.push({ pid, executablePath, write: Boolean(write) }); return { handle, base: BASE, size: 0xa000 }; }
  close(handle) { this.handles.delete(handle); }
  closeAll() { this.handles.clear(); }
  async read(handle, address, size) {
    if (!this.handles.has(handle)) throw new Error('Read from a closed handle.');
    const item = this.memory.find((entry) => BigInt(address) >= entry.address && BigInt(address) + BigInt(size) <= entry.address + BigInt(entry.data.length));
    if (!item) throw new Error(`Unreadable fixture memory ${BigInt(address).toString(16)} (${size})`);
    return item.data.subarray(Number(BigInt(address) - item.address), Number(BigInt(address) - item.address) + size);
  }
  async write(handle, address, raw) {
    if (!handle.write) throw new Error('Write attempted through a read-only handle.');
    this.writeCalls.push({ address: BigInt(address), raw: Buffer.from(raw) });
    if (this.failNextWrite) { this.failNextWrite = false; raw.subarray(0, 2).copy(await this.read(handle, address, raw.length)); return { ok: false, attempted: true }; }
    raw.copy(await this.read(handle, address, raw.length));
    return { ok: true, attempted: true };
  }
  dna() { return Buffer.from(this.memory.find((entry) => entry.address === this.objects.dna).data.subarray(0, this.catalog.genes.length * 4)); }
  persistentDna() { return rawToPersistentDna(this.dna(), this.catalog, { type: 'male' }); }
}

function liveFixture() {
  const genes = catalog();
  const pe = executable();
  const process = new MemoryProcess(pe, genes);
  return { pe, process, catalog: genes, game: { pid: 42, executablePath: 'C:\\fixture\\ck3.exe' } };
}

module.exports = { liveFixture, BASE, RVA, IDS };
