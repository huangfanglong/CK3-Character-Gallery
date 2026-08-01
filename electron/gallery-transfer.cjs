const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const SORT_MODES = new Set(['recent', 'custom', 'name', 'oldest']);

function normalizeAppearanceColor(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : '';
}

function safeFolderName(value) {
  const cleaned = String(value || 'Collection')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  const name = cleaned || 'Collection';
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name) ? `_${name}` : name;
}

function exportPathFor(gallery, parentDirectory) {
  return path.join(path.resolve(parentDirectory), safeFolderName(gallery?.name));
}

async function copyPortrait(source, destination, operation, characterName) {
  try {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
  } catch (error) {
    throw new Error(`Could not ${operation} portrait "${path.basename(source)}" for ${characterName}: ${error.message}`);
  }
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
    throw error;
  }
}

async function resolveGalleryFolder(selectedFolder) {
  const folder = path.resolve(selectedFolder);
  if (await pathExists(path.join(folder, 'characters.json'))) return folder;

  const entries = await fs.readdir(folder, { withFileTypes: true });
  const matches = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(folder, entry.name);
    if (await pathExists(path.join(candidate, 'characters.json'))) matches.push(candidate);
  }
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error('This folder contains multiple collection exports. Select the collection folder you want to import.');
  throw new Error('No characters.json was found in this folder or its immediate subfolders.');
}

async function exportGalleryToFolder(gallery, destinationDirectory, options = {}) {
  if (!gallery || typeof gallery.name !== 'string' || !Array.isArray(gallery.characters)) {
    throw new Error('The selected collection is not valid.');
  }
  const exportDirectory = path.resolve(destinationDirectory);
  const stagingDirectory = `${exportDirectory}.tmp-${crypto.randomUUID()}`;
  const exportExists = await pathExists(exportDirectory);
  if (exportExists && !options.replace) throw new Error('The export folder already exists.');
  if (exportExists && options.replace) {
    if (!(await pathExists(path.join(exportDirectory, 'characters.json')))) throw new Error('The existing folder is not a collection export and will not be replaced.');
  }
  let previousDirectory = null;
  try {
    await fs.mkdir(path.join(stagingDirectory, 'images'), { recursive: true });
    const exportedCharacters = [];
    for (const character of gallery.characters) {
      if (!character || typeof character.name !== 'string') continue;
      const exportId = typeof character.id === 'string' && /^[^\\/]+$/.test(character.id)
        ? character.id
        : crypto.randomUUID();
      const imageDirectory = path.join(stagingDirectory, 'images', exportId);
      const exportedImages = [];
      const sourceImages = Array.isArray(character.images) ? character.images : [];
      for (let index = 0; index < sourceImages.length; index += 1) {
        if (typeof sourceImages[index] !== 'string' || !sourceImages[index]) continue;
        const source = path.isAbsolute(sourceImages[index])
          ? sourceImages[index]
          : path.resolve(options.sourceRoot || process.cwd(), sourceImages[index]);
        const filename = `${index}${path.extname(source) || '.png'}`;
        await copyPortrait(source, path.join(imageDirectory, filename), 'export', character.name);
        exportedImages.push(filename);
      }
      exportedCharacters.push({
        ...Object.fromEntries(Object.entries(character).filter(([key]) => !key.startsWith('_'))),
        id: exportId,
        images: exportedImages,
        variants: exportedImages.length,
        coverIndex: exportedImages.length
          ? Math.min(Math.max(Number(character.coverIndex) || 0, 0), exportedImages.length - 1)
          : 0,
      });
    }

    await fs.writeFile(path.join(stagingDirectory, 'characters.json'), JSON.stringify(exportedCharacters, null, 2));
    await fs.writeFile(path.join(stagingDirectory, 'gallery.json'), JSON.stringify({
      formatVersion: 3,
      name: gallery.name,
      sortMode: gallery.sortMode || 'recent',
    }, null, 2));
    if (exportExists) {
      previousDirectory = `${exportDirectory}.previous-${crypto.randomUUID()}`;
      await fs.rename(exportDirectory, previousDirectory);
    }
    await fs.rename(stagingDirectory, exportDirectory);
    if (previousDirectory) await fs.rm(previousDirectory, { recursive: true, force: true });
    return exportDirectory;
  } catch (error) {
    await fs.rm(stagingDirectory, { recursive: true, force: true });
    if (previousDirectory) {
      if (!(await pathExists(exportDirectory))) await fs.rename(previousDirectory, exportDirectory);
    }
    throw error;
  }
}

async function readGalleryInfo(folder) {
  const resolvedFolder = await resolveGalleryFolder(folder);
  let metadata = {};
  const metadataFile = path.join(resolvedFolder, 'gallery.json');
  if (await pathExists(metadataFile)) metadata = JSON.parse(await fs.readFile(metadataFile, 'utf8'));
  return {
    folder: resolvedFolder,
    suggestedName: typeof metadata.name === 'string' && metadata.name.trim()
      ? metadata.name.trim()
      : path.basename(resolvedFolder),
    sortMode: SORT_MODES.has(metadata.sortMode)
      ? metadata.sortMode
      : 'recent',
  };
}

async function importGalleryFromFolder(folder, galleryName, destinationDataDirectory) {
  const resolvedFolder = await resolveGalleryFolder(folder);
  const sourceCharacters = JSON.parse(await fs.readFile(path.join(resolvedFolder, 'characters.json'), 'utf8'));
  if (!Array.isArray(sourceCharacters)) throw new Error('characters.json must contain a character list.');
  const info = await readGalleryInfo(resolvedFolder);
  const importedCharacters = [];
  const createdDirectories = [];
  try {
    for (const source of sourceCharacters) {
      if (!source || typeof source !== 'object' || typeof source.name !== 'string') continue;
      const id = crypto.randomUUID();
      const characterDirectory = path.join(destinationDataDirectory, 'images', id);
      createdDirectories.push(characterDirectory);
      const sourceId = typeof source.id === 'string' && /^[^\\/]+$/.test(source.id) ? source.id : '';
      const sourceImages = Array.isArray(source.images) && sourceId
        ? source.images.filter((image) => typeof image === 'string').map((image) => path.join(resolvedFolder, 'images', sourceId, path.basename(image)))
        : typeof source.image === 'string' && sourceId
          ? [path.join(resolvedFolder, 'images', `${sourceId}.png`)]
          : [];
      const images = [];
      for (let index = 0; index < sourceImages.length; index += 1) {
        const destination = path.join(characterDirectory, `${index}${path.extname(sourceImages[index]) || '.png'}`);
        await copyPortrait(sourceImages[index], destination, 'import', source.name);
        images.push(destination);
      }

      const character = {
        id,
        name: source.name,
        images,
        dna: typeof source.dna === 'string' ? source.dna : '',
        tags: Array.isArray(source.tags) ? source.tags.filter((tag) => typeof tag === 'string') : [],
        created: Number.isFinite(Number(source.created)) ? Number(source.created) : Date.now(),
        modified: Number.isFinite(Number(source.modified)) ? Number(source.modified) : Date.now(),
        variants: images.length,
        coverIndex: images.length ? Math.min(Math.max(Number(source.coverIndex) || 0, 0), images.length - 1) : 0,
      };
      for (const field of ['title', 'note', 'color']) {
        if (typeof source[field] === 'string') character[field] = source[field];
      }
      const nameColor = normalizeAppearanceColor(source.nameColor);
      const titleColor = normalizeAppearanceColor(source.titleColor);
      const titleGlowColor = normalizeAppearanceColor(source.titleGlowColor);
      if (nameColor) character.nameColor = nameColor;
      if (titleColor) character.titleColor = titleColor;
      if (titleGlowColor) character.titleGlowColor = titleGlowColor;
      importedCharacters.push(character);
    }
    return { name: galleryName, sortMode: info.sortMode, characters: importedCharacters };
  } catch (error) {
    await Promise.all(createdDirectories.map((directory) => fs.rm(directory, { recursive: true, force: true })));
    throw error;
  }
}

async function duplicateCharacterInArchive(source, duplicateName, destinationDataDirectory, sourceRoot = process.cwd()) {
  if (!source || typeof source.name !== 'string') throw new Error('The selected character is not valid.');
  const id = crypto.randomUUID();
  const characterDirectory = path.join(destinationDataDirectory, 'images', id);
  const images = [];
  try {
    const sourceImages = Array.isArray(source.images) ? source.images : [];
    for (let index = 0; index < sourceImages.length; index += 1) {
      if (typeof sourceImages[index] !== 'string' || !sourceImages[index]) continue;
      const sourcePath = path.isAbsolute(sourceImages[index]) ? sourceImages[index] : path.resolve(sourceRoot, sourceImages[index]);
      const destination = path.join(characterDirectory, `${index}${path.extname(sourcePath) || '.png'}`);
      await copyPortrait(sourcePath, destination, 'duplicate', source.name);
      images.push(destination);
    }
    return {
      ...Object.fromEntries(Object.entries(source).filter(([key]) => !key.startsWith('_'))),
      id,
      name: duplicateName || `${source.name} (Copy)`,
      images,
      variants: images.length,
      coverIndex: images.length ? Math.min(Math.max(Number(source.coverIndex) || 0, 0), images.length - 1) : 0,
      created: Date.now(),
      modified: Date.now(),
    };
  } catch (error) {
    await fs.rm(characterDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function duplicateGalleryInArchive(gallery, duplicateName, destinationDataDirectory, sourceRoot = process.cwd()) {
  if (!gallery || !Array.isArray(gallery.characters)) throw new Error('The selected collection is not valid.');
  const characters = [];
  try {
    for (const source of gallery.characters) {
      if (!source || typeof source.name !== 'string') continue;
      const character = await duplicateCharacterInArchive(source, source.name, destinationDataDirectory, sourceRoot);
      character.created = source.created;
      character.modified = source.modified;
      characters.push(character);
    }
  } catch (error) {
    await Promise.all(characters.map((character) => fs.rm(path.join(destinationDataDirectory, 'images', character.id), { recursive: true, force: true })));
    throw error;
  }
  return {
    ...Object.fromEntries(Object.entries(gallery).filter(([key]) => key !== 'characters')),
    name: duplicateName,
    modified: Date.now(),
    characters,
  };
}

module.exports = {
  duplicateCharacterInArchive,
  duplicateGalleryInArchive,
  exportGalleryToFolder,
  exportPathFor,
  importGalleryFromFolder,
  readGalleryInfo,
  resolveGalleryFolder,
  safeFolderName,
};
