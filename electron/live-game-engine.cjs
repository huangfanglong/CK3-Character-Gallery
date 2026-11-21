'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Ck3LayoutResolver, CHARACTER_DATABASE, WINDOW_CLASS, IDLER_CLASS, uint32 } = require('./live-game-resolver.cjs');
const { WindowsLiveProcess } = require('./windows-live-process.cjs');
const { rawToPersistentDna, persistentDnaToRaw } = require('./live-dna-codec.cjs');
const { loadEffectiveGeneCatalog } = require('./live-game-catalog.cjs');

/* Kept for callers that displayed the original supported-file list. Catalog loading
   now discovers every effective raw-gene file instead of using this legacy subset. */
const GENE_FILES = ['00_genes_color.txt', '01_genes_morph.txt', '02_genes_accessories_misc.txt'];
function fingerprintOf(target) { return `${target.pid}:${target.id}:${target.character}:${target.window}:${target.dnaPointer}:${target.geneCount}:${target.catalogHash}:${target.exeHash}`; }
function validGame(game) {
  if (!Number.isInteger(game?.pid) || game.pid <= 0 || typeof game?.executablePath !== 'string' || !/^[a-z]:[\\/].*\\ck3\.exe$/i.test(game.executablePath)) throw new Error('Focus CK3 before using Live Game Link.');
  return { pid: game.pid, executablePath: game.executablePath };
}
function publicTarget(target) { return { id: target.id, name: target.name, nameIsKey: true }; }
function sameBytes(a, b) { return Buffer.isBuffer(a) && Buffer.isBuffer(b) && a.length === b.length && a.equals(b); }
function validCachedLayout(layout, windowVtableRva) {
  if (!layout || layout.format !== 2 || layout.windowVtableRva !== windowVtableRva) return false;
  const offsets = [['dnaOffset', 0x40, 0x800], ['guiOffset', 0x18, 0x800], ['opacityOffset', 0x18, 0x2000]];
  return offsets.every(([name, minimum, maximum]) => Number.isInteger(layout[name]) && layout[name] >= minimum && layout[name] <= maximum)
    && Array.isArray(layout.idOffsets) && layout.idOffsets.length > 0 && layout.idOffsets.length <= 32
    && new Set(layout.idOffsets).size === layout.idOffsets.length
    && layout.idOffsets.every((offset) => Number.isInteger(offset) && offset >= 0x18 && offset <= 0x400);
}

class LiveGameEngine {
  constructor(options = {}) {
    this.process = options.process || new WindowsLiveProcess(options);
    this.enabled = false;
    this.cachePath = options.cachePath || '';
    this.resolverFactory = options.resolverFactory || ((executable, base, read) => new Ck3LayoutResolver(executable, base, read));
    this.readFile = options.readFile || fs.readFile;
    this.session = null;
    this.pending = null;
    this.undo = null;
    this.now = options.now || Date.now;
    this.undoLifetimeMs = options.undoLifetimeMs || 20_000;
  }
  async setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) this.close();
    return this.enabled;
  }
  close() {
    this.process.closeAll();
    this.session = null;
    this.pending = null;
    this.undo = null;
  }
  assertEnabled() { if (!this.enabled) throw new Error('Live Game Link is turned off. Enable it in the File menu before using this action.'); }
  async loadCatalog(executablePath) {
    return loadEffectiveGeneCatalog(executablePath, { readFile: this.readFile });
  }
  async prepareSession(game) {
    const identity = validGame(game);
    if (this.session?.identity.executablePath.toLowerCase() === identity.executablePath.toLowerCase() && this.session.identity.pid === identity.pid) return this.session;
    this.process.closeAll();
    this.session = null;
    const opened = this.process.open(identity.pid, identity.executablePath, false);
    try {
      const executable = await this.readFile(identity.executablePath);
      const exeHash = crypto.createHash('sha256').update(executable).digest('hex');
      const resolver = this.resolverFactory(executable, opened.base, (address, size) => this.process.read(this.activeHandle, address, size));
      let cached = null;
      if (this.cachePath) {
        try { cached = JSON.parse(await this.readFile(this.cachePath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') cached = null; }
      }
      if (cached?.format === 1 && cached.exeHash === exeHash) {
        this.activeHandle = opened.handle;
        await Promise.all(['.text', '.rdata', '.data'].map((name) => resolver.loadSection(name)));
        const window = await resolver.oneVtable(WINDOW_CLASS);
        if (!validCachedLayout(cached.layout, window.rva)) cached = null;
      } else cached = null;
      this.activeHandle = opened.handle;
      const layout = cached ? cached.layout : await resolver.resolve();
      const catalog = await this.loadCatalog(identity.executablePath);
      this.session = { identity, exeHash, catalog, layout, resolver, base: opened.base };
      if (!cached && this.cachePath) {
        const temporary = `${this.cachePath}.tmp`;
        await fs.mkdir(path.dirname(this.cachePath), { recursive: true });
        await fs.writeFile(temporary, JSON.stringify({ format: 1, exeHash, layout }, null, 2), { flag: 'w' });
        await fs.rename(temporary, this.cachePath).catch(async () => { await fs.rm(temporary, { force: true }); });
      }
      return this.session;
    } finally { this.activeHandle = null; this.process.close(opened.handle); }
  }
  async withProcess(write, callback) {
    this.assertEnabled();
    const session = await this.prepareSession(validGame(this.game));
    const opened = this.process.open(this.game.pid, this.game.executablePath, write);
    if (opened.base !== session.base || opened.size < session.layout.windowVtableRva) throw new Error('CK3’s executable image changed. Restart Live Game Link.');
    this.activeHandle = opened.handle;
    try { return await callback(opened, session); }
    finally { this.activeHandle = null; this.process.close(opened.handle); }
  }
  async heapObjects(handle, session) {
    if (session.heapObjects) return session.heapObjects;
    if (typeof this.process.findVtableInstances !== 'function') throw new Error('This CK3 process reader cannot search for live interface objects.');
    const database = await session.resolver.oneVtable(CHARACTER_DATABASE);
    const addresses = [session.base + BigInt(session.layout.windowVtableRva), session.resolver.address(database.rva)];
    const found = await this.process.findVtableInstances(handle, addresses);
    session.heapObjects = {
      window: found.get(addresses[0].toString(16)) || [],
      database: found.get(addresses[1].toString(16)) || [],
    };
    return session.heapObjects;
  }
  async windowCandidates(handle, session) {
    const { resolver } = session;
    try {
      const idler = await resolver.staticObject(IDLER_CLASS);
      const gfx = await resolver.field(idler, '.?AVCIngameInterfaceIdlerGfx@@', 0x100);
      const handler = await resolver.field(gfx, '.?AVCIngameInterfaceHandler@@', 0x200);
      return [await resolver.field(handler, WINDOW_CLASS, 0x1000)];
    } catch (error) {
      /* Recent CK3 builds can keep these objects alive without the old module-global
         pointers. A heap match is only a candidate: vtable, visible CPdxGuiWindow,
         shown ID, CCharacter class, embedded ID and database slot are all checked below. */
      if (typeof this.process.findVtableInstances !== 'function') throw error;
      return (await this.heapObjects(handle, session)).window;
    }
  }
  async databaseCandidates(handle, session) {
    try { return [await session.resolver.staticObject(CHARACTER_DATABASE)]; }
    catch (error) {
      if (typeof this.process.findVtableInstances !== 'function') throw error;
      return (await this.heapObjects(handle, session)).database;
    }
  }
  async resolveWindowGui(handle, session, window) {
    const { layout, resolver } = session;
    const bytes = await this.process.read(handle, window, 0x408);
    const preferred = [session.guiOffset, layout.guiOffset].filter((offset) => Number.isInteger(offset));
    const offsets = [...new Set([...preferred, ...Array.from({ length: (0x400 - 0x18) / 8 + 1 }, (_, index) => 0x18 + index * 8)])];
    const candidates = new Map();
    for (const offset of offsets) {
      const gui = bytes.readBigUInt64LE(offset);
      if (gui < 0x10000n || await resolver.className(gui) !== '.?AVCPdxGuiWindow@@') continue;
      const opacity = (await this.process.read(handle, gui + BigInt(layout.opacityOffset), 4)).readFloatLE(0);
      if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1.001) continue;
      candidates.set(gui.toString(16), { gui, opacity, offset });
      if (preferred.includes(offset)) break;
    }
    if (candidates.size !== 1) {
      if (candidates.size > 1) throw new Error('CK3 reported more than one possible character-window GUI. Live Game Link will not guess.');
      return null;
    }
    const result = candidates.values().next().value;
    session.guiOffset = result.offset;
    return result;
  }
  async readTarget(handle, session) {
    const { layout, catalog, resolver } = session;
    const read = (address, size) => this.process.read(handle, address, size);
    const pointer = async (address) => (await read(address, 8)).readBigUInt64LE(0);
    const expectedWindowVtable = session.base + BigInt(layout.windowVtableRva);
    const databases = [];
    for (const database of await this.databaseCandidates(handle, session)) {
      try {
        if (!database || await resolver.className(database) !== CHARACTER_DATABASE) continue;
        const view = await read(database + 0x20n, 16);
        const array = view.readBigUInt64LE(0);
        const capacity = view.readUInt32LE(12);
        if (!array || capacity <= 0 || capacity > 0x1000000) continue;
        databases.push({ database, array, capacity });
      } catch { /* Another candidate must pass every runtime identity check. */ }
    }
    if (!databases.length) throw new Error('CK3’s character database is unavailable. Load a save first.');
    const matches = [];
    let closed = false;
    for (const window of await this.windowCandidates(handle, session)) {
      try {
        if (!window || await pointer(window) !== expectedWindowVtable) continue;
        const gui = await this.resolveWindowGui(handle, session, window);
        if (!gui) continue;
        if (gui.opacity <= 0.01) { closed = true; continue; }
        for (const { array, capacity } of databases) {
          for (const idOffset of layout.idOffsets) {
            const id = uint32((await read(window + BigInt(idOffset), 4)).readInt32LE(0));
            const index = id & 0xffffff;
            if (!id || id === 0xffffffff || index >= capacity) continue;
            /* Every candidate must resolve through CK3's own database to a CCharacter
               whose embedded ID agrees. Never select the first merely plausible field. */
            const character = await resolver.pointer(array + BigInt(index * 16 + 8));
            if (!character) continue;
            const identity = await read(character + 0x18n, 4).catch(() => null);
            if (!identity || uint32(identity.readInt32LE(0)) !== id || await resolver.className(character) !== '.?AVCCharacter@@') continue;
            matches.push({ id, character, window });
          }
        }
      } catch (error) {
        if (/more than one possible character-window GUI/.test(error.message)) throw error;
        // Stale heap objects can retain a vtable after the game has discarded them.
      }
    }
    const distinctMatches = [...new Map(matches.map((match) => [`${match.id}:${match.character}:${match.window}`, match])).values()];
    if (distinctMatches.length !== 1) throw new Error(matches.length
      ? 'CK3 reported more than one possible selected character. Close and reopen its character window; Live Game Link will not guess.'
      : closed ? 'The CK3 character window is closed. Open the character you want to use.'
        : 'The CK3 character window does not show a character whose identity can be verified. Reopen it and try again.');
    const { id, character, window } = distinctMatches[0];
    const arrayInfo = await read(character + BigInt(layout.dnaOffset), 16);
    const dnaPointer = arrayInfo.readBigUInt64LE(0);
    const geneCount = arrayInfo.readUInt32LE(8);
    const capacityCount = arrayInfo.readUInt32LE(12);
    if (!dnaPointer || geneCount === 0 || geneCount > 1000 || geneCount !== capacityCount || geneCount !== catalog.genes.length) {
      throw new Error(`The live DNA array (${geneCount} genes) does not match the installation catalog (${catalog.genes.length} genes). Wait for CK3 and its enabled mods to finish loading, then reopen the character window.`);
    }
    const raw = Buffer.from(await read(dnaPointer, geneCount * 4));
    const stringInfo = await read(character + 0x20n, 32);
    const length = stringInfo.readBigUInt64LE(16);
    const stringCapacity = stringInfo.readBigUInt64LE(24);
    let name = `Character ${id}`;
    if (length <= 120n && stringCapacity <= 0x10000n && length <= stringCapacity) {
      const address = stringCapacity < 16n ? character + 0x20n : stringInfo.readBigUInt64LE(0);
      if (length > 0n && address) name = [...(await read(address, Number(length))).toString('utf8')].filter((character) => { const code = character.charCodeAt(0); return code > 31 && code !== 127; }).join('').trim() || name;
    }
    return { pid: session.identity.pid, id, character, window, dnaPointer, geneCount, catalogHash: catalog.hash, exeHash: session.exeHash, name, raw };
  }
  async import(game) {
    this.game = validGame(game);
    this.pending = null;
    this.undo = null;
    return this.withProcess(false, async ({ handle }, session) => {
      const target = await this.readTarget(handle, session);
      return { dna: rawToPersistentDna(target.raw, session.catalog), target: publicTarget(target), geneCount: target.geneCount };
    });
  }
  async prepareApply(game, selection) {
    this.game = validGame(game);
    this.undo = null;
    this.pending = null;
    if (typeof selection?.dna !== 'string' || typeof selection.id !== 'string' || !selection.id || typeof selection.name !== 'string' || !Number.isFinite(selection.modified)) throw new Error('Select a saved gallery character with persistent Ruler Designer DNA.');
    return this.withProcess(false, async ({ handle }, session) => {
      const target = await this.readTarget(handle, session);
      const converted = persistentDnaToRaw(selection.dna, session.catalog);
      if (sameBytes(target.raw, converted.raw)) throw new Error('The selected CK3 character already has this DNA. Nothing needs to be applied.');
      const token = crypto.randomUUID();
      this.pending = { token, target, raw: converted.raw, original: target.raw, selection: { ...selection }, report: converted.report, fingerprint: fingerprintOf(target), createdAt: this.now() };
      return { token, target: publicTarget(target), report: converted.report };
    });
  }
  sameTarget(current, expected) {
    if (!expected || fingerprintOf(current) !== expected.fingerprint) throw new Error('The CK3 character window, character, or DNA location changed. No DNA was written.');
  }
  async writeVerified(handle, target, raw) {
    const result = await this.process.write(handle, target.dnaPointer, raw);
    let verified = false;
    try { verified = result.ok && sameBytes(await this.process.read(handle, target.dnaPointer, raw.length), raw); } catch { verified = false; }
    return { ...result, verified };
  }
  async restore(handle, target, original) {
    try { return (await this.writeVerified(handle, target, original)).verified; } catch { return false; }
  }
  async confirmApply(game, token) {
    this.game = validGame(game);
    const pending = this.pending;
    if (!pending || pending.token !== token || this.now() - pending.createdAt > 60_000) { this.pending = null; throw new Error('This apply preview expired. Prepare it again before applying DNA.'); }
    return this.withProcess(true, async ({ handle }, session) => {
      const current = await this.readTarget(handle, session);
      this.sameTarget(current, pending);
      if (!sameBytes(current.raw, pending.original)) throw new Error('The character’s DNA changed after the preview. No DNA was written.');
      const applied = await this.writeVerified(handle, current, pending.raw);
      if (!applied.verified) {
        const restored = await this.restore(handle, current, pending.original);
        this.pending = null;
        throw new Error(restored ? 'The DNA write did not verify, so the original DNA was restored.' : 'The DNA write did not verify and rollback could not be confirmed. Do not save this CK3 session until you have checked the character.');
      }
      this.undo = { target: current, fingerprint: pending.fingerprint, original: pending.original, applied: pending.raw, expiresAt: this.now() + this.undoLifetimeMs };
      this.pending = null;
      return { target: publicTarget(current), undoUntil: this.undo.expiresAt, report: pending.report };
    });
  }
  async undoApply(game) {
    this.game = validGame(game);
    const undo = this.undo;
    if (!undo || this.now() >= undo.expiresAt) { this.undo = null; throw new Error('The guarded undo window has expired.'); }
    return this.withProcess(true, async ({ handle }, session) => {
      const current = await this.readTarget(handle, session);
      this.sameTarget(current, undo);
      if (!sameBytes(current.raw, undo.applied)) throw new Error('CK3 changed the DNA after it was applied. Undo was refused to avoid overwriting a newer change.');
      const restored = await this.writeVerified(handle, current, undo.original);
      if (!restored.verified) throw new Error('Undo could not be verified. Check the character before saving this CK3 session.');
      this.undo = null;
      return { target: publicTarget(current) };
    });
  }
  cancel() { this.pending = null; }
}

module.exports = { LiveGameEngine, fingerprintOf, publicTarget, sameBytes, GENE_FILES };
