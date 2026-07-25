const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { duplicateCharacterInArchive, duplicateGalleryInArchive, exportGalleryToFolder, exportPathFor, importGalleryFromFolder, readGalleryInfo } = require('../electron/gallery-transfer.cjs');

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ck3-gallery-transfer-'));
  try {
    const sourceDirectory = path.join(root, 'source');
    const exportParent = path.join(root, 'exports');
    const importData = path.join(root, 'imported-data');
    await fs.mkdir(sourceDirectory, { recursive: true });
    await fs.mkdir(exportParent, { recursive: true });
    const firstImage = path.join(sourceDirectory, 'first.png');
    const secondImage = path.join(sourceDirectory, 'second.jpg');
    await fs.writeFile(firstImage, Buffer.from('first portrait'));
    await fs.writeFile(secondImage, Buffer.from('second portrait'));

    const gallery = {
      name: 'Court: Test',
      sortMode: 'custom',
      characters: [{
        id: 'character-1',
        name: 'Aldith',
        title: 'The Test Character',
        note: 'Round-trip note',
        color: 'olive',
        nameColor: '#df966d',
        titleGlowColor: '#8fb8c9',
        images: [firstImage, secondImage],
        dna: 'genes={ hair_color={ 76 255 76 255 } }',
        tags: ['english', 'test'],
        coverIndex: 1,
        created: 100,
        modified: 200,
      }],
    };

    const duplicated = await duplicateGalleryInArchive(gallery, 'Court Copy', path.join(root, 'duplicate-data'));
    assert.equal(duplicated.name, 'Court Copy');
    assert.equal(duplicated.characters.length, 1);
    assert.notEqual(duplicated.characters[0].id, gallery.characters[0].id);
    assert.notDeepEqual(duplicated.characters[0].images, gallery.characters[0].images);
    assert.equal(duplicated.characters[0].images.length, 2);
    assert.equal(duplicated.characters[0].nameColor, '#df966d');
    assert.equal(duplicated.characters[0].titleGlowColor, '#8fb8c9');
    await Promise.all(duplicated.characters[0].images.map((image) => fs.access(image)));

    const duplicatedCharacter = await duplicateCharacterInArchive(gallery.characters[0], 'Aldith Copy', path.join(root, 'duplicate-character-data'));
    assert.notDeepEqual(duplicatedCharacter.images, gallery.characters[0].images);
    await fs.rm(duplicatedCharacter.images[0]);
    await fs.access(gallery.characters[0].images[0]);
    await assert.rejects(
      () => duplicateCharacterInArchive({ ...gallery.characters[0], images: [path.join(root, 'missing.png')] }, 'Broken Copy', path.join(root, 'broken-character-data')),
      /Could not duplicate portrait/,
    );

    const exportDirectory = exportPathFor(gallery, exportParent);
    assert.equal(await exportGalleryToFolder(gallery, exportDirectory), exportDirectory);
    assert.equal(path.basename(exportDirectory), 'Court_ Test');
    const manifest = JSON.parse(await fs.readFile(path.join(exportDirectory, 'characters.json'), 'utf8'));
    assert.deepEqual(manifest[0].images, ['0.png', '1.jpg']);
    await fs.access(path.join(exportDirectory, 'images', 'character-1', '0.png'));
    await fs.access(path.join(exportDirectory, 'images', 'character-1', '1.jpg'));
    const metadata = JSON.parse(await fs.readFile(path.join(exportDirectory, 'gallery.json'), 'utf8'));
    assert.equal(metadata.name, gallery.name);
    assert.equal(metadata.sortMode, 'custom');
    await assert.rejects(() => exportGalleryToFolder(gallery, exportDirectory), /already exists/);
    await exportGalleryToFolder(gallery, exportDirectory, { replace: true });

    const currentFolderExport = path.join(root, 'current-folder', 'Chosen Collection Folder');
    assert.equal(await exportGalleryToFolder(gallery, currentFolderExport), currentFolderExport);
    await fs.access(path.join(currentFolderExport, 'characters.json'));
    await assert.rejects(
      () => exportGalleryToFolder({ ...gallery, characters: [{ ...gallery.characters[0], images: [path.join(root, 'missing-export.png')] }] }, path.join(root, 'missing-export')),
      /Could not export portrait/,
    );
    await assert.rejects(() => fs.access(path.join(root, 'missing-export', 'characters.json')));

    const unrelatedDirectory = path.join(exportParent, 'Unrelated');
    await fs.mkdir(unrelatedDirectory);
    await fs.writeFile(path.join(unrelatedDirectory, 'keep.txt'), 'do not remove');
    await assert.rejects(
      () => exportGalleryToFolder({ ...gallery, name: 'Unrelated' }, unrelatedDirectory, { replace: true }),
      /not a collection export/,
    );
    await fs.access(path.join(unrelatedDirectory, 'keep.txt'));

    const selectedParentInfo = await readGalleryInfo(exportParent);
    assert.equal(selectedParentInfo.folder, exportDirectory);
    assert.equal(selectedParentInfo.suggestedName, gallery.name);
    const imported = await importGalleryFromFolder(exportParent, 'Imported Court', importData);
    assert.equal(imported.name, 'Imported Court');
    assert.equal(imported.sortMode, 'custom');
    assert.equal(imported.characters.length, 1);
    const character = imported.characters[0];
    assert.equal(character.name, 'Aldith');
    assert.equal(character.title, 'The Test Character');
    assert.equal(character.note, 'Round-trip note');
    assert.equal(character.color, 'olive');
    assert.equal(character.nameColor, '#df966d');
    assert.equal(character.titleGlowColor, '#8fb8c9');
    assert.equal(character.dna, gallery.characters[0].dna);
    assert.deepEqual(character.tags, ['english', 'test']);
    assert.equal(character.coverIndex, 1);
    assert.equal(character.created, 100);
    assert.equal(character.modified, 200);
    assert.equal(character.images.length, 2);
    await Promise.all(character.images.map((image) => fs.access(image)));

    const unsafeImport = path.join(root, 'unsafe-import');
    await fs.mkdir(unsafeImport, { recursive: true });
    await fs.writeFile(path.join(unsafeImport, 'characters.json'), JSON.stringify([{
      id: 'unsafe-character',
      name: 'Unsafe Appearance',
      nameColor: '#000000',
      titleGlowColor: '#12345g',
    }]));
    const unsafeGallery = await importGalleryFromFolder(unsafeImport, 'Unsafe Court', path.join(root, 'unsafe-import-data'));
    assert.equal(unsafeGallery.characters[0].nameColor, undefined);
    assert.equal(unsafeGallery.characters[0].titleGlowColor, undefined);

    const brokenImport = path.join(root, 'broken-import');
    await fs.mkdir(brokenImport, { recursive: true });
    await fs.writeFile(path.join(brokenImport, 'characters.json'), JSON.stringify([{ id: 'missing-character', name: 'Missing Portrait', images: ['0.png'] }]));
    await assert.rejects(() => importGalleryFromFolder(brokenImport, 'Broken Import', path.join(root, 'broken-import-data')), /Could not import portrait/);
    console.log('Gallery transfer test passed: exact export destinations, parent-folder resolution, safe duplication, metadata, portraits, overwrite protection, and v3 fields round-trip.');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
