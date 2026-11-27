const fs = require('node:fs/promises');
const path = require('node:path');

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
    const galleries = JSON.parse(source);
    if (!validArchive(galleries)) throw new Error('The archive must contain valid collections and character records.');
    return { directory, file, galleries, warning: null, recoveryFile: null };
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
