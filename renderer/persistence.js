async function duplicateSelectedCharacter() {
  const character = getActiveCharacter();
  if (!character) return showToast('Select a character before duplicating it.', 'info');
  if (!desktop?.duplicateCharacter) return showToast('Character duplication is unavailable.', 'info');
  try {
    const duplicate = await desktop.duplicateCharacter(character, `${character.name} (Copy)`);
    getGallery().characters.push(duplicate);
    resetSelection(duplicate.id);
    state.modal = null;
    render();
    if (await saveLibrary()) showToast('Character record duplicated.', 'success');
    else {
      getGallery().characters = getGallery().characters.filter((item) => item.id !== duplicate.id);
      resetSelection(character.id);
      state.imageUrls.delete(duplicate.id);
      render();
      await cleanupUnusedPortraits(duplicate.images);
    }
  } catch (error) { showToast(readableError(error, 'The character could not be duplicated.'), 'info'); }
}

function uniqueCollectionName(baseName) {
  let name = baseName;
  let suffix = 2;
  while (state.galleries.some((gallery) => gallery.name.toLowerCase() === name.toLowerCase())) name = `${baseName} (${suffix++})`;
  return name;
}

async function duplicateActiveGallery() {
  const gallery = getGallery();
  if (!gallery || state.preview || !desktop) return;
  const duplicateName = uniqueCollectionName(`${gallery.name} Copy`);
  try {
    const duplicate = await desktop.duplicateGallery(gallery, duplicateName);
    const sourceIndex = state.galleries.indexOf(gallery);
    state.galleries.splice(sourceIndex + 1, 0, duplicate);
    state.activeGallery = duplicate.name;
    resetSelection();
    clearFilters(false);
    state.filterPanelOpen = false;
    state.sort = gallerySortMode(duplicate);
    cancelBatchSelection(false);
    render();
    if (await saveLibrary()) showToast(`Collection "${duplicate.name}" created.`, 'success');
    else {
      state.galleries = state.galleries.filter((item) => item !== duplicate);
      state.activeGallery = gallery.name;
      resetSelection();
      render();
      await cleanupUnusedPortraits(duplicate.characters.flatMap((character) => character.images || []));
    }
  } catch (error) { showToast(readableError(error, 'The collection could not be duplicated.'), 'info'); }
}

async function copyDna() {
  const character = getActiveCharacter(); if (!character?.dna) return showToast('This character has no DNA yet.', 'info');
  try { await navigator.clipboard.writeText(character.dna); showToast('DNA copied to clipboard.', 'success'); }
  catch { showToast('DNA could not be copied to the clipboard.', 'info'); }
}

async function saveLibrary() {
  if (state.preview || !desktop) return true;
  const galleries = state.galleries.map((gallery) => ({
    ...gallery,
    characters: gallery.characters.map((character) => Object.fromEntries(
      Object.entries(character).filter(([key]) => !key.startsWith('_')),
    )),
  }));
  try {
    const saved = Boolean(await desktop.save(galleries));
    if (!saved) throw new Error('The archive save did not complete.');
    render();
    return true;
  } catch (error) {
    render();
    const detail = readableError(error, 'Unknown storage error.');
    showToast(`The archive could not be saved. Your latest changes may not persist. ${detail}`, 'info');
    return false;
  }
}

function referencedImagePaths() {
  return new Set(state.galleries.flatMap((gallery) => gallery.characters.flatMap((character) => character.images || [])));
}

async function cleanupUnusedPortraits(imagePaths) {
  if (!desktop) return 0;
  const referenced = referencedImagePaths();
  const removable = [...new Set(imagePaths.filter((imagePath) => typeof imagePath === 'string' && imagePath && !referenced.has(imagePath)))];
  const results = await Promise.allSettled(removable.map((imagePath) => desktop.deleteImage(imagePath)));
  return results.filter((result) => result.status === 'rejected').length;
}

async function exportCollection() {
  if (!desktop) return showToast('Export is only available in the desktop app.', 'info');
  if (state.preview) return showToast('Start a local collection before exporting it.', 'info');
  try {
    const result = await desktop.exportGallery(getGallery());
    if (result?.folder) showToast(`Collection exported to ${result.folder}`, 'success');
  } catch (error) { showToast(readableError(error, 'The collection could not be exported.'), 'info'); }
}

async function importCollection() {
  if (!desktop) return showToast('Import is only available in the desktop app.', 'info');
  let selection;
  try { selection = await desktop.chooseGallery(); }
  catch (error) { showToast(readableError(error, 'The selected folder could not be read.'), 'info'); return; }
  if (!selection) return;
  const folder = typeof selection === 'string' ? selection : selection.folder;
  let suggestedName = typeof selection === 'string' ? '' : selection.suggestedName;
  if (suggestedName) {
    const base = suggestedName; let suffix = 2;
    while (state.galleries.some((gallery) => gallery.name.toLowerCase() === suggestedName.toLowerCase())) suggestedName = `${base} (${suffix++})`;
  }
  showImportModal(folder, suggestedName);
}
