const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

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

async function resolveGalleryFolder(selectedFolder) {
  const folder = path.resolve(selectedFolder);
  try {
    await fs.access(path.join(folder, 'characters.json'));
    return folder;
  } catch {}

  const entries = await fs.readdir(folder, { withFileTypes: true });
  const matches = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(folder, entry.name);
    try {
      await fs.access(path.join(candidate, 'characters.json'));
      matches.push(candidate);
    } catch {}
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
  let exportExists = false;
  try { await fs.access(exportDirectory); exportExists = true; } catch {}
  if (exportExists && !options.replace) throw new Error('The export folder already exists.');
  if (exportExists && options.replace) {
    try { await fs.access(path.join(exportDirectory, 'characters.json')); }
    catch { throw new Error('The existing folder is not a collection export and will not be replaced.'); }
    await fs.rm(exportDirectory, { recursive: true, force: true });
  }
  await fs.mkdir(path.join(exportDirectory, 'images'), { recursive: true });

  const exportedCharacters = [];
  for (const character of gallery.characters) {
    if (!character || typeof character.name !== 'string') continue;
    const exportId = typeof character.id === 'string' && /^[^\\/]+$/.test(character.id)
      ? character.id
      : crypto.randomUUID();
    const imageDirectory = path.join(exportDirectory, 'images', exportId);
    const exportedImages = [];
    const sourceImages = Array.isArray(character.images) ? character.images : [];
    for (let index = 0; index < sourceImages.length; index += 1) {
      if (typeof sourceImages[index] !== 'string' || !sourceImages[index]) continue;
      const source = path.isAbsolute(sourceImages[index])
        ? sourceImages[index]
        : path.resolve(options.sourceRoot || process.cwd(), sourceImages[index]);
      const filename = `${index}${path.extname(source) || '.png'}`;
      try {
        await fs.mkdir(imageDirectory, { recursive: true });
        await fs.copyFile(source, path.join(imageDirectory, filename));
        exportedImages.push(filename);
      } catch {}
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

  await fs.writeFile(path.join(exportDirectory, 'characters.json'), JSON.stringify(exportedCharacters, null, 2));
  await fs.writeFile(path.join(exportDirectory, 'gallery.json'), JSON.stringify({
    formatVersion: 3,
    name: gallery.name,
    sortMode: gallery.sortMode || 'recent',
  }, null, 2));
  return exportDirectory;
}

async function readGalleryInfo(folder) {
  const resolvedFolder = await resolveGalleryFolder(folder);
  let metadata = {};
  try { metadata = JSON.parse(await fs.readFile(path.join(resolvedFolder, 'gallery.json'), 'utf8')); } catch {}
  return {
    folder: resolvedFolder,
    suggestedName: typeof metadata.name === 'string' && metadata.name.trim()
      ? metadata.name.trim()
      : path.basename(resolvedFolder),
    sortMode: ['recent', 'custom', 'name', 'oldest'].includes(metadata.sortMode)
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

  for (const source of sourceCharacters) {
    if (!source || typeof source !== 'object' || typeof source.name !== 'string') continue;
    const id = crypto.randomUUID();
    const characterDirectory = path.join(destinationDataDirectory, 'images', id);
    await fs.mkdir(characterDirectory, { recursive: true });
    const sourceId = typeof source.id === 'string' && /^[^\\/]+$/.test(source.id) ? source.id : '';
    const sourceImages = Array.isArray(source.images) && sourceId
      ? source.images.filter((image) => typeof image === 'string').map((image) => path.join(resolvedFolder, 'images', sourceId, path.basename(image)))
      : typeof source.image === 'string' && sourceId
        ? [path.join(resolvedFolder, 'images', `${sourceId}.png`)]
        : [];
    const images = [];
    for (let index = 0; index < sourceImages.length; index += 1) {
      try {
        const destination = path.join(characterDirectory, `${index}${path.extname(sourceImages[index]) || '.png'}`);
        await fs.copyFile(sourceImages[index], destination);
        images.push(destination);
      } catch {}
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
    importedCharacters.push(character);
  }

  return { name: galleryName, sortMode: info.sortMode, characters: importedCharacters };
}

async function duplicateGalleryInArchive(gallery, duplicateName, destinationDataDirectory, sourceRoot = process.cwd()) {
  if (!gallery || !Array.isArray(gallery.characters)) throw new Error('The selected collection is not valid.');
  const characters = [];
  for (const source of gallery.characters) {
    if (!source || typeof source.name !== 'string') continue;
    const id = crypto.randomUUID();
    const characterDirectory = path.join(destinationDataDirectory, 'images', id);
    const images = [];
    const sourceImages = Array.isArray(source.images) ? source.images : [];
    for (let index = 0; index < sourceImages.length; index += 1) {
      if (typeof sourceImages[index] !== 'string' || !sourceImages[index]) continue;
      const sourcePath = path.isAbsolute(sourceImages[index]) ? sourceImages[index] : path.resolve(sourceRoot, sourceImages[index]);
      const destination = path.join(characterDirectory, `${index}${path.extname(sourcePath) || '.png'}`);
      try {
        await fs.mkdir(characterDirectory, { recursive: true });
        await fs.copyFile(sourcePath, destination);
        images.push(destination);
      } catch {}
    }
    characters.push({
      ...Object.fromEntries(Object.entries(source).filter(([key]) => !key.startsWith('_'))),
      id,
      images,
      variants: images.length,
      coverIndex: images.length ? Math.min(Math.max(Number(source.coverIndex) || 0, 0), images.length - 1) : 0,
    });
  }
  return {
    ...Object.fromEntries(Object.entries(gallery).filter(([key]) => key !== 'characters')),
    name: duplicateName,
    modified: Date.now(),
    characters,
  };
}

module.exports = {
  duplicateGalleryInArchive,
  exportGalleryToFolder,
  exportPathFor,
  importGalleryFromFolder,
  readGalleryInfo,
  resolveGalleryFolder,
  safeFolderName,
};
