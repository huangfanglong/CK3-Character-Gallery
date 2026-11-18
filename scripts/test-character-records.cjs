const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

const context = {
  console,
  crypto,
  state: {
    galleries: [{ name: 'Court', characters: [] }, { name: 'Other', characters: [] }],
    activeGallery: 'Court', activeId: null, focusContext: 'character', selectedVariantIndex: null,
    preview: false, modal: null, sort: 'recent', allGalleries: false,
  },
  saveResult: true,
  render() {},
  showToast() {},
  cancelBatchSelection() {},
  resetSelection(id = null) { context.state.activeId = id; context.state.focusContext = 'character'; context.state.selectedVariantIndex = null; },
  cleanupUnusedPortraits: async () => 0,
};
context.getGallery = () => context.state.galleries.find((gallery) => gallery.name === context.state.activeGallery) || context.state.galleries[0];
context.saveLibrary = async () => context.saveResult;
vm.createContext(context);
vm.runInContext(fs.readFileSync(require.resolve('../renderer/character-records.js'), 'utf8'), context);

(async () => {
  const created = await context.createCharacterRecord({ name: '  Ragnhild  ', dna: 'dna-value', galleryName: 'Court' });
  assert.equal(created.character.name, 'Ragnhild');
  assert.equal(created.character.dna, 'dna-value');
  assert.equal(context.state.activeId, created.character.id);
  assert.equal(context.state.galleries[0].characters.length, 1);

  const automatic = await context.createCharacterRecord({ name: '', galleryName: 'Other', select: false });
  const second = await context.createCharacterRecord({ name: '', galleryName: 'Other', select: false });
  assert.equal(automatic.character.name, 'Unnamed character');
  assert.equal(second.character.name, 'Unnamed character 2');
  assert.equal(context.state.activeId, created.character.id, 'Background quick-add must not change the current selection.');

  await assert.rejects(() => context.createCharacterRecord({ name: 'Nobody', galleryName: 'Deleted collection' }), /no longer exists/);
  assert.equal(context.state.galleries[0].characters.length, 1);

  context.saveResult = false;
  await assert.rejects(() => context.createCharacterRecord({ name: 'Unsaved', galleryName: 'Court' }), /could not be saved/);
  assert.equal(context.state.galleries[0].characters.length, 1, 'A failed initial save rolls back only the new record.');
  assert.equal(context.state.activeId, created.character.id);
  context.saveResult = true;

  const current = context.state.galleries[0].characters[0];
  await assert.rejects(() => context.removeCreatedCharacter({ characterId: current.id, galleryName: 'Court', expectedModified: current.modified - 1 }), /changed since/);
  assert.equal(context.state.galleries[0].characters.length, 1, 'Undo refuses to remove a record changed elsewhere.');
  const removed = await context.removeCreatedCharacter({ characterId: current.id, galleryName: 'Court', expectedModified: current.modified });
  assert.equal(removed.character.id, current.id);
  assert.equal(context.state.galleries[0].characters.length, 0);

  context.saveResult = true;
  const restored = await context.createCharacterRecord({ name: 'Restore failure', galleryName: 'Court' });
  context.saveResult = false;
  await assert.rejects(() => context.removeCreatedCharacter({ characterId: restored.character.id, galleryName: 'Court', expectedModified: restored.character.modified }), /could not be saved/);
  assert.equal(context.state.galleries[0].characters[0].id, restored.character.id, 'A failed undo restores the record.');
  context.state.preview = true;
  context.state.galleries = [{ name: 'Preview', characters: [{ id: 'demo', name: 'Demo' }] }];
  const previewGalleries = context.state.galleries;
  await assert.rejects(() => context.createCharacterRecord({ name: 'Unsaved preview', galleryName: 'Default', select: false }), /could not be saved/);
  assert.equal(context.state.preview, true);
  assert.equal(context.state.galleries, previewGalleries, 'A failed first quick-add restores the preview library.');
  context.state.preview = false;
  context.state.galleries = [{ name: 'Court', characters: [] }];
  context.saveResult = true;
  console.log('Character record tests passed: shared creation, unique names, safe destinations, rollback, and guarded undo.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
