const fs = require('node:fs/promises');
const path = require('node:path');
const { MAX_COLLECTION_NAME_LENGTH } = require('./game-dock-commands.cjs');

const defaultGalleries = () => [{ name: 'Default', characters: [] }];

async function writeArchiveFile(file, galleries) {
  const temporary = `${file}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(galleries, null, 2));
    await fs.rename(temporary, file);
  } catch (error) {
    try { await fs.rm(temporary, { force: true }); }
    catch (cleanupError) { error.cleanupError = cleanupError; }
    throw error;
  }
}

function validArchive(galleries) {
  return Array.isArray(galleries) && galleries.every((gallery) => Boolean(gallery)
    && typeof gallery === 'object' && !Array.isArray(gallery)
    && typeof gallery.name === 'string' && Boolean(gallery.name.trim())
    && Array.isArray(gallery.characters)
    && gallery.characters.every((character) => Boolean(character)
      && typeof character === 'object' && !Array.isArray(character)
      && typeof character.id === 'string' && Boolean(character.id)
      && typeof character.name === 'string'));
}

/* Every other surface enforces the shared collection-name limit; a legacy or
   hand-edited archive must not smuggle in names the dock and commands reject.
   Shorten them on load instead of quarantining an otherwise valid archive. */
function capGalleryNames(galleries) {
  let capped = false;
  const normalized = galleries.map((gallery) => {
    if (gallery.name.length <= MAX_COLLECTION_NAME_LENGTH) return gallery;
    capped = true;
    return { ...gallery, name: gallery.name.slice(0, MAX_COLLECTION_NAME_LENGTH) };
  });
  return { galleries: normalized, capped };
}

async function ensureArchive(directory, options = {}) {
  await fs.mkdir(path.join(directory, 'images'), { recursive: true });
  const file = path.join(directory, 'galleries.json');
  let source;
  try {
    source = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const galleries = defaultGalleries();
    await writeArchiveFile(file, galleries);
    return { directory, file, galleries, warning: null, recoveryFile: null };
  }

  try {
    const parsed = JSON.parse(source);
    if (!validArchive(parsed)) throw new Error('The archive must contain valid collections and character records.');
    const { galleries, capped } = capGalleryNames(parsed);
    return {
      directory,
      file,
      galleries,
      warning: capped ? `Collection names longer than ${MAX_COLLECTION_NAME_LENGTH} characters were shortened on load.` : null,
      recoveryFile: null,
    };
  } catch {
    const timestamp = Number(options.now?.() ?? Date.now());
    const recoveryFile = `${file}.corrupt-${timestamp}`;
    await fs.rename(file, recoveryFile);
    const galleries = defaultGalleries();
    await writeArchiveFile(file, galleries);
    return {
      directory,
      file,
      galleries,
      recoveryFile,
      warning: `The archive was unreadable. A recovery copy was saved as ${path.basename(recoveryFile)}.`,
    };
  }
}

async function saveArchive(directory, galleries) {
  if (!validArchive(galleries)) throw new Error('The archive must contain valid collections and character records.');
  await fs.mkdir(path.join(directory, 'images'), { recursive: true });
  const file = path.join(directory, 'galleries.json');
  await writeArchiveFile(file, galleries);
  return true;
}

module.exports = { ensureArchive, saveArchive };
