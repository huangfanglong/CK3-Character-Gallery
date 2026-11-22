'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createGeneCatalog, parseGeneScript } = require('./live-dna-codec.cjs');

const MAX_MOD_CONFIG_BYTES = 2_000_000;
const MAX_CATALOG_BYTES = 64_000_000;
const GENE_DIRECTORY = path.join('common', 'genes');

function catalogError(message) { return new Error(`Live DNA: ${message}`); }

let knownDocumentsDirectory;
function windowsDocumentsDirectory() {
  if (knownDocumentsDirectory !== undefined) return knownDocumentsDirectory;
  knownDocumentsDirectory = '';
  if (process.platform !== 'win32') return knownDocumentsDirectory;
  try {
    const koffi = require('koffi');
    koffi.struct('CK3_CATALOG_GUID', { data1: 'uint32_t', data2: 'uint16_t', data3: 'uint16_t', data4: koffi.array('uint8_t', 8) });
    const free = koffi.load('ole32.dll').func('void __stdcall CoTaskMemFree(void *pointer)');
    koffi.disposable('CK3_CATALOG_KNOWN_PATH', 'str16', free);
    const query = koffi.load('shell32.dll').func('long __stdcall SHGetKnownFolderPath(CK3_CATALOG_GUID *id, uint32_t flags, void *token, _Out_ CK3_CATALOG_KNOWN_PATH *path)');
    const output = [null];
    /* FOLDERID_Documents. This follows redirected OneDrive and custom Documents
       folders instead of assuming that they live under %USERPROFILE%\Documents. */
    const result = query({ data1: 0xFDD39AD0, data2: 0x238F, data3: 0x46AF, data4: [0xAD, 0xB4, 0x6C, 0x85, 0x48, 0x03, 0x69, 0xC7] }, 0, null, output);
    if (result === 0 && typeof output[0] === 'string') knownDocumentsDirectory = output[0];
  } catch { /* Conventional Documents and OneDrive candidates remain available. */ }
  return knownDocumentsDirectory;
}

function defaultUserDataDirectories(environment = process.env, home = os.homedir()) {
  const windowsDocuments = windowsDocumentsDirectory();
  const candidates = [
    environment.CK3_USER_DATA_DIRECTORY,
    windowsDocuments && path.join(windowsDocuments, 'Paradox Interactive', 'Crusader Kings III'),
    home && path.join(home, 'Documents', 'Paradox Interactive', 'Crusader Kings III'),
    environment.OneDrive && path.join(environment.OneDrive, 'Documents', 'Paradox Interactive', 'Crusader Kings III'),
    environment.OneDriveCommercial && path.join(environment.OneDriveCommercial, 'Documents', 'Paradox Interactive', 'Crusader Kings III'),
  ];
  return [...new Map(candidates.filter(Boolean).map((directory) => [path.resolve(directory).toLowerCase(), path.resolve(directory)])).values()];
}

async function findBaseGeneDirectory(executablePath, stat) {
  const ancestors = [];
  let current = path.dirname(executablePath);
  for (let count = 0; count < 5; count++) { ancestors.push(current); current = path.dirname(current); }
  for (const candidate of ancestors) {
    const directory = path.join(candidate, 'game', GENE_DIRECTORY);
    try { if ((await stat(directory)).isDirectory()) return directory; } catch { /* Try the next installation layout. */ }
  }
  throw catalogError('CK3’s base-game gene files were not found. Check the detected installation path.');
}

function modDescriptorPath(userDataDirectory, entry) {
  if (typeof entry !== 'string' || !entry.trim() || entry.length > 1000 || path.isAbsolute(entry) || /^[a-z]:/i.test(entry)) {
    throw catalogError('CK3’s enabled-mod list contains an invalid descriptor path.');
  }
  const normalized = entry.replaceAll('/', path.sep).replaceAll('\\', path.sep);
  if (normalized.split(path.sep).includes('..')) throw catalogError('CK3’s enabled-mod list contains an unsafe descriptor path.');
  const root = path.resolve(userDataDirectory);
  const resolved = path.resolve(root, normalized);
  if (resolved !== root && !resolved.toLowerCase().startsWith(`${root.toLowerCase()}${path.sep}`)) throw catalogError('CK3’s enabled-mod descriptor is outside its user-data folder.');
  return resolved;
}

function pathWithin(root, candidate) {
  const normalizedRoot = path.resolve(root).toLowerCase();
  const normalizedCandidate = path.resolve(candidate).toLowerCase();
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
}

function expectedModRoots(baseDirectory, userDataDirectory) {
  const installationDirectory = path.dirname(path.resolve(baseDirectory, '..', '..'));
  const roots = [installationDirectory];
  if (userDataDirectory) roots.push(path.resolve(userDataDirectory));
  const commonDirectory = path.dirname(installationDirectory);
  if (path.basename(commonDirectory).toLowerCase() === 'common' && path.basename(path.dirname(commonDirectory)).toLowerCase() === 'steamapps') {
    roots.push(path.join(path.dirname(commonDirectory), 'workshop'));
  }
  return roots;
}

function resolveModRoot(descriptor, descriptorPath, allowedRoots) {
  const normalized = descriptor.root.replaceAll('/', path.sep).replaceAll('\\', path.sep);
  if (normalized.split(path.sep).includes('..')) {
    throw catalogError(`the enabled mod descriptor “${path.basename(descriptorPath)}” contains an unsafe installation path.`);
  }
  const absolute = path.isAbsolute(descriptor.root);
  const root = absolute ? path.normalize(descriptor.root) : path.resolve(path.dirname(descriptorPath), normalized);
  /* Absolute paths are CK3's explicit mechanism for both Workshop and local
     development mods. Relative paths, however, must remain in a known mod root. */
  if (!absolute && !allowedRoots.some((allowed) => pathWithin(allowed, root))) {
    throw catalogError(`the enabled mod descriptor “${path.basename(descriptorPath)}” points outside the installation, user-data, or Workshop mod folders.`);
  }
  return root;
}

function descriptorProperties(text, descriptorPath) {
  if (text.length > MAX_MOD_CONFIG_BYTES) throw catalogError(`the mod descriptor “${path.basename(descriptorPath)}” is too large.`);
  const properties = parseGeneScript(text);
  const roots = properties.filter((property) => property.key === 'path' && typeof property.value === 'string');
  if (roots.length !== 1 || !roots[0].value.trim()) throw catalogError(`the enabled mod descriptor “${path.basename(descriptorPath)}” has no unique installation path.`);
  const replacesGenes = properties.some((property) => property.key === 'replace_path' && typeof property.value === 'string'
    && ['common', 'common/genes'].includes(property.value.valueOf().replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()));
  return { root: roots[0].value.trim(), replacesGenes };
}

async function directoryGeneFiles(directory, readDir) {
  let entries;
  try { entries = await readDir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return []; throw error; }
  return entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.txt'))
    .map((entry) => ({ key: entry.name.toLowerCase(), filePath: path.join(directory, entry.name) }))
    .sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

async function loadActiveMods(options, readFile) {
  if (options.enabledMods) {
    if (!Array.isArray(options.enabledMods)) throw catalogError('the supplied enabled-mod list is invalid.');
    return { directory: options.userDataDirectory ? path.resolve(options.userDataDirectory) : '', entries: options.enabledMods, identity: 'supplied' };
  }
  const directories = options.userDataDirectory ? [path.resolve(options.userDataDirectory)] : defaultUserDataDirectories(options.environment, options.home);
  for (const directory of directories) {
    const filePath = path.join(directory, 'dlc_load.json');
    let text;
    try { text = await readFile(filePath, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') continue; throw error; }
    if (text.length > MAX_MOD_CONFIG_BYTES) throw catalogError('CK3’s enabled-mod configuration is too large.');
    let config;
    try { config = JSON.parse(text); }
    catch { throw catalogError('CK3’s enabled-mod configuration is unreadable. The live gene catalog cannot be verified.'); }
    if (!config || !Array.isArray(config.enabled_mods) || config.enabled_mods.length > 2000) throw catalogError('CK3’s enabled-mod configuration has no valid enabled_mods list.');
    return { directory, entries: config.enabled_mods, identity: text };
  }
  return null;
}

async function loadEffectiveGeneCatalog(executablePath, options = {}) {
  const readFile = options.readFile || fs.readFile;
  const readDir = options.readDir || fs.readdir;
  const stat = options.stat || fs.stat;
  const baseDirectory = await findBaseGeneDirectory(executablePath, stat);
  const files = new Map();
  const identities = [];
  const addFiles = (fileList, origin) => {
    for (const file of fileList) files.set(file.key, { ...file, name: file.key, origin });
  };
  addFiles(await directoryGeneFiles(baseDirectory, readDir), 'base-game');
  if (!files.size) throw catalogError('CK3’s base-game gene files are empty.');
  const active = await loadActiveMods(options, readFile);
  let enabledCount = 0;
  if (active) {
    identities.push(active.identity);
    const allowedModRoots = expectedModRoots(baseDirectory, active.directory);
    for (const entry of active.entries) {
      const descriptorPath = modDescriptorPath(active.directory, entry);
      let text;
      try { text = await readFile(descriptorPath, 'utf8'); }
      catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') throw catalogError(`the enabled mod descriptor “${path.basename(descriptorPath)}” was not found. Live DNA will not guess the active gene catalog.`);
        throw error;
      }
      const descriptor = descriptorProperties(text, descriptorPath);
      const root = resolveModRoot(descriptor, descriptorPath, allowedModRoots);
      identities.push(`${entry}\0${text}`);
      enabledCount += 1;
      if (descriptor.replacesGenes) files.clear();
      addFiles(await directoryGeneFiles(path.join(root, GENE_DIRECTORY), readDir), entry);
    }
  }
  if (!files.size) throw catalogError('the enabled mods removed every raw-DNA gene definition.');
  const ordered = [...files.values()].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const sources = [];
  let totalBytes = 0;
  for (const file of ordered) {
    const text = await readFile(file.filePath, 'utf8');
    totalBytes += Buffer.byteLength(text);
    if (totalBytes > MAX_CATALOG_BYTES) throw catalogError('the effective installation gene catalog is too large.');
    sources.push({ name: file.name, text });
    identities.push(`${file.origin}\0${file.name}\0${text}`);
  }
  const catalog = createGeneCatalog(sources);
  catalog.hash = crypto.createHash('sha256').update(identities.join('\0')).digest('hex');
  catalog.sourceCount = sources.length;
  catalog.enabledModCount = enabledCount;
  return catalog;
}

module.exports = { defaultUserDataDirectories, findBaseGeneDirectory, loadEffectiveGeneCatalog, modDescriptorPath };
