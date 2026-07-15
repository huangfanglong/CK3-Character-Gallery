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
    if (!Array.isArray(galleries)) throw new Error('The archive root must be a collection list.');
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
  if (!Array.isArray(galleries)) throw new Error('The archive must contain a collection list.');
  await fs.mkdir(path.join(directory, 'images'), { recursive: true });
  const file = path.join(directory, 'galleries.json');
  await writeArchiveFile(file, galleries);
  return true;
}

module.exports = { ensureArchive, saveArchive };
