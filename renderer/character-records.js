function automaticCharacterName(gallery, baseName = 'Unnamed character') {
  const used = new Set(gallery.characters.map((character) => character.name.trim().toLowerCase()));
  if (!used.has(baseName.toLowerCase())) return baseName;
  let suffix = 2;
  while (used.has(`${baseName} ${suffix}`.toLowerCase())) suffix += 1;
  return `${baseName} ${suffix}`;
}

async function createCharacterRecord({ name = '', dna = '', galleryName = '', select = true } = {}) {
  const previewSnapshot = state.preview ? {
    galleries: state.galleries,
    activeGallery: state.activeGallery,
    allGalleries: state.allGalleries,
    sort: state.sort,
  } : null;
  if (state.preview) {
    state.preview = false;
    state.galleries = [{ name: 'Default', characters: [] }];
    state.activeGallery = 'Default';
    state.allGalleries = false;
    state.sort = 'recent';
  }
  const gallery = galleryName
    ? state.galleries.find((item) => item.name === galleryName)
    : getGallery();
  if (!gallery) throw new Error('The destination collection no longer exists. Choose another collection.');
  const character = {
    id: crypto.randomUUID(),
    name: String(name || '').trim().slice(0, 120) || automaticCharacterName(gallery),
    images: [],
    dna: typeof dna === 'string' ? dna.trim() : '',
    tags: [],
    created: Date.now(),
    modified: Date.now(),
  };
  const previousSelection = { activeId: state.activeId, focusContext: state.focusContext, selectedVariantIndex: state.selectedVariantIndex };
  gallery.characters.push(character);
  if (select) {
    state.activeGallery = gallery.name;
    state.allGalleries = false;
    state.activeId = character.id;
    state.focusContext = 'character';
    state.selectedVariantIndex = null;
    cancelBatchSelection(false);
  }
  state.modal = null;
  render();
  if (await saveLibrary()) return { character, galleryName: gallery.name };
  gallery.characters = gallery.characters.filter((item) => item.id !== character.id);
  if (previewSnapshot) {
    state.preview = true;
    state.galleries = previewSnapshot.galleries;
    state.activeGallery = previewSnapshot.activeGallery;
    state.allGalleries = previewSnapshot.allGalleries;
    state.sort = previewSnapshot.sort;
  }
  state.activeId = previousSelection.activeId;
  state.focusContext = previousSelection.focusContext;
  state.selectedVariantIndex = previousSelection.selectedVariantIndex;
  render();
  throw new Error('The new character could not be saved. No record was added.');
}

async function removeCreatedCharacter({ characterId, galleryName, expectedModified }) {
  const gallery = state.galleries.find((item) => item.name === galleryName);
  const character = gallery?.characters.find((item) => item.id === characterId);
  if (!gallery || !character) throw new Error('The new character no longer exists. Nothing was undone.');
  if (!Number.isFinite(expectedModified) || character.modified !== expectedModified) {
    throw new Error('This character has changed since it was created. It was not removed.');
  }
  const index = gallery.characters.indexOf(character);
  const selection = { activeId: state.activeId, focusContext: state.focusContext, selectedVariantIndex: state.selectedVariantIndex };
  gallery.characters.splice(index, 1);
  if (state.activeId === characterId) resetSelection();
  state.modal = null;
  render();
  if (await saveLibrary()) return { character, imagePaths: [...(character.images || [])] };
  gallery.characters.splice(index, 0, character);
  state.activeId = selection.activeId;
  state.focusContext = selection.focusContext;
  state.selectedVariantIndex = selection.selectedVariantIndex;
  render();
  throw new Error('The archive could not be saved. The character was not removed.');
}
