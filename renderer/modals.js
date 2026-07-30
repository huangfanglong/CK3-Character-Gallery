function showCharacterModal(portraitSource = null, dnaSource = null) {
  state.pendingPortraitSource = portraitSource;
  state.pendingDnaSource = dnaSource;
  const fromPortrait = Boolean(portraitSource);
  const fromDna = typeof dnaSource === 'string' && Boolean(dnaSource);
  const eyebrow = fromPortrait ? 'NEW RECORD FROM CLIPBOARD' : fromDna ? 'NEW RECORD FROM DNA' : 'NEW ARCHIVE RECORD';
  const copy = fromPortrait
    ? 'Create the record first, then position the copied portrait.'
    : fromDna
      ? 'Name this character to create a portrait-empty record with the copied DNA.'
      : 'Start with a name. Portrait, DNA, and tags can be added from the inspector.';
  state.modal = `<div class="modal-backdrop"><div class="modal"><button class="modal-close" data-action="close-modal">${icon('close')}</button><p class="eyebrow">${eyebrow}</p><h2>Name the character</h2><p class="modal-copy">${copy}</p><label class="modal-label">Character name<input id="modal-name" autofocus placeholder="e.g. Ragnhild of Jorvik" /></label><div class="modal-actions"><button class="outline-button" data-action="close-modal">Cancel</button><button class="primary-button" data-action="create-character">Create record ${icon('arrow')}</button></div></div></div>`;
  render('modal'); document.querySelector('#modal-name')?.focus();
}

function showGalleryModal() {
  state.modal = `<div class="modal-backdrop"><div class="modal"><button class="modal-close" data-action="close-modal">${icon('close')}</button><p class="eyebrow">NEW COLLECTION</p><h2>Add a new collection</h2><label class="modal-label">Collection name<input id="modal-gallery-name" autofocus placeholder="e.g. The Baltic Court" /></label><div class="modal-actions"><button class="outline-button" data-action="close-modal">Cancel</button><button class="primary-button" data-action="create-gallery">Create collection ${icon('arrow')}</button></div></div></div>`;
  render('modal'); document.querySelector('#modal-gallery-name')?.focus();
}

function showRenameGalleryModal() {
  const gallery = getGallery();
  if (!gallery || state.preview) return;
  state.modal = `<div class="modal-backdrop"><div class="modal"><button class="modal-close" data-action="close-modal">${icon('close')}</button><p class="eyebrow">RENAME COLLECTION</p><h2>Rename ${escapeHtml(gallery.name)}</h2><label class="modal-label">Collection name<input id="rename-gallery-name" value="${escapeHtml(gallery.name)}" /></label><div class="modal-actions"><button class="outline-button" data-action="close-modal">Cancel</button><button class="primary-button" data-action="confirm-rename-gallery">Save name ${icon('check')}</button></div></div></div>`;
  render('modal'); document.querySelector('#rename-gallery-name')?.focus(); document.querySelector('#rename-gallery-name')?.select();
}

function showDeleteGalleryConfirmation() {
  const gallery = getGallery();
  if (!gallery || state.preview) return;
  if (state.galleries.length === 1) return showToast('The last collection cannot be deleted.', 'info');
  state.modal = `<div class="modal-backdrop"><div class="modal delete-modal"><p class="eyebrow">DELETE COLLECTION</p><h2>Remove ${escapeHtml(gallery.name)}?</h2><p class="modal-copy">This removes the collection and its ${gallery.characters.length} character record${gallery.characters.length === 1 ? '' : 's'}. This cannot be undone.</p><div class="modal-actions"><button class="outline-button" data-action="close-modal">Cancel</button><button class="danger-button" data-action="confirm-delete-gallery" autofocus>Delete collection</button></div><p class="dialog-shortcuts"><span>Enter to confirm</span><span>Esc to cancel</span></p></div></div>`;
  render('modal'); document.querySelector('[data-action="confirm-delete-gallery"]')?.focus();
}

function showGalleryBatchDeleteConfirmation() {
  const names = new Set(state.selectedGalleryNames);
  const galleries = state.galleries.filter((gallery) => names.has(gallery.name));
  if (!state.galleryBatchMode || !galleries.length) return;
  if (galleries.length === state.galleries.length) return showToast('At least one collection must remain.', 'info');
  const characterCount = galleries.reduce((sum, gallery) => sum + gallery.characters.length, 0);
  state.modal = `<div class="modal-backdrop"><div class="modal delete-modal"><p class="eyebrow">DELETE COLLECTIONS</p><h2>Remove ${galleries.length} collections?</h2><p class="modal-copy">This removes ${characterCount} character record${characterCount === 1 ? '' : 's'} from the selected collections. This cannot be undone.</p><div class="modal-actions"><button class="outline-button" data-action="close-modal">Cancel</button><button class="danger-button" data-action="confirm-delete-gallery-batch" autofocus>Delete selected</button></div><p class="dialog-shortcuts"><span>Enter to confirm</span><span>Esc to cancel</span></p></div></div>`;
  render('modal'); document.querySelector('[data-action="confirm-delete-gallery-batch"]')?.focus();
}

function showImportModal(folder, suggestedName = '') {
  state.importFolder = folder;
  state.modal = `<div class="modal-backdrop"><div class="modal"><button class="modal-close" data-action="close-modal">${icon('close')}</button><p class="eyebrow">IMPORT COLLECTION</p><h2>Bring in a court</h2><p class="modal-copy">Portraits, DNA, notes, and collection metadata will be copied into this archive. The original folder stays untouched.</p><label class="modal-label">Collection name<input id="modal-import-name" value="${escapeHtml(suggestedName)}" autofocus placeholder="e.g. House of Wessex" /></label><div class="modal-actions"><button class="outline-button" data-action="close-modal">Cancel</button><button class="primary-button" data-action="create-import">Import collection ${icon('arrow')}</button></div></div></div>`;
  render('modal'); document.querySelector('#modal-import-name')?.focus();
}

function showNoteModal() {
  const character = getActiveCharacter();
  if (!character) return showToast('Choose a character before editing notes.', 'info');
  const note = character.note || '';
  const count = noteTags(note).length;
  state.modal = `<div class="modal-backdrop" ${modalPreserveAttribute('note')}><div class="note-modal"><div class="modal-head"><div><p class="eyebrow">NOTES</p><h2>${escapeHtml(character.name)}</h2></div><button class="modal-close" data-action="close-modal">${icon('close')}</button></div><p class="modal-copy">Write down mods, notes, bio, or add tags.</p><div class="note-editor"><div class="note-highlight" id="note-highlight" aria-hidden="true">${highlightedNoteMarkup(note)}</div><textarea id="note-input" spellcheck="true" placeholder="Add notes or #tags…" aria-describedby="note-tag-count">${escapeHtml(note)}</textarea></div><div class="note-footer"><span id="note-tag-count">${count} tag${count === 1 ? '' : 's'} recognized</span><button class="primary-button" data-action="save-note">Save notes ${icon('check')}</button></div></div></div>`;
  render('modal');
  requestAnimationFrame(() => document.querySelector('#note-input')?.focus());
}

function syncNoteHighlightScroll(input) {
  const highlight = document.querySelector('#note-highlight');
  if (!highlight) return;
  highlight.scrollTop = input.scrollTop;
  highlight.scrollLeft = input.scrollLeft;
}

function updateNoteHighlights(input) {
  const highlight = document.querySelector('#note-highlight');
  const count = document.querySelector('#note-tag-count');
  const tags = noteTags(input.value);
  if (highlight) highlight.innerHTML = highlightedNoteMarkup(input.value);
  if (count) count.textContent = `${tags.length} tag${tags.length === 1 ? '' : 's'} recognized`;
  syncNoteHighlightScroll(input);
}

function showManageModal() {
  const character = getActiveCharacter();
  if (!character) return;
  state.modal = `<div class="modal-backdrop"><div class="modal"><button class="modal-close" data-action="close-modal">${icon('close')}</button><p class="eyebrow">MANAGE RECORD</p><h2>${escapeHtml(character.name)}</h2><label class="modal-label">Character name<input id="manage-name" value="${escapeHtml(character.name)}" /></label><button class="appearance-entry" data-action="customize-appearance">${icon('palette')}<span><strong>Customize appearance</strong><small>Name color and title glow</small></span>${icon('arrow')}</button><button class="appearance-entry" data-action="capture-live-portrait"${state.preview ? ' disabled' : ''}>${icon('grid')}<span><strong>Capture live portrait</strong><small>Record an animated CK3 window portrait</small></span>${icon('arrow')}</button><div class="manage-actions"><button class="danger-text" data-action="delete-character">Delete record</button><button class="outline-button" data-action="transfer-character"${state.preview ? ' disabled' : ''}>Move / Copy</button><button class="outline-button" data-action="duplicate-character">Duplicate</button><button class="primary-button" data-action="rename-character">Save name ${icon('check')}</button></div></div></div>`;
  render('modal');
}

function showTransferCharacterModal(characterIds = [getActiveCharacter()?.id]) {
  const source = getGallery();
  const characters = source?.characters.filter((character) => characterIds.includes(character.id)) || [];
  const destinations = state.galleries.filter((gallery) => gallery !== getGallery());
  if (!characters.length || state.preview) return;
  if (!destinations.length) return showToast('Create another collection before moving a record.', 'info');
  state.transferCharacterIds = characters.map((character) => character.id);
  const multiple = characters.length > 1;
  const subject = multiple ? `${characters.length} selected records` : characters[0].name;
  const noun = multiple ? 'these records' : 'this record';
  state.modal = `<div class="modal-backdrop"><div class="modal"><button class="modal-close" data-action="close-modal">${icon('close')}</button><p class="eyebrow">MOVE OR COPY ${multiple ? 'RECORDS' : 'RECORD'}</p><h2>${escapeHtml(subject)}</h2><p class="modal-copy">Copy keeps ${noun} in ${escapeHtml(source.name)} and duplicates ${multiple ? 'them' : 'it'} in the destination. Move deletes ${noun} from ${escapeHtml(source.name)} and re-creates ${multiple ? 'them' : 'it'} in the destination.</p><label class="modal-label">Destination collection<select id="transfer-gallery">${destinations.map((gallery) => `<option value="${escapeHtml(gallery.name)}">${escapeHtml(gallery.name)}</option>`).join('')}</select></label><div class="modal-actions"><button class="outline-button" data-action="close-modal">Cancel</button><button class="outline-button" data-action="copy-character">Copy to collection</button><button class="primary-button" data-action="move-character">Move to collection ${icon('arrow')}</button></div></div></div>`;
  render('modal');
  document.querySelector('#transfer-gallery')?.focus();
}

function showDeleteConfirmation() {
  const character = getActiveCharacter();
  if (!character) return showToast('Select a character before deleting it.', 'info');
  state.modal = `<div class="modal-backdrop"><div class="modal delete-modal"><p class="eyebrow">DELETE CHARACTER</p><h2>Remove ${escapeHtml(character.name)}?</h2><p class="modal-copy">This removes the character record from the collection. Portrait files associated with it will no longer appear in the archive.</p><div class="modal-actions"><button class="outline-button" data-action="close-modal">Cancel</button><button class="danger-button" data-action="confirm-delete" autofocus>Delete character</button></div><p class="dialog-shortcuts"><span>Enter to confirm</span><span>Esc to cancel</span></p></div></div>`;
  render('modal');
  document.querySelector('[data-action="confirm-delete"]')?.focus();
}

function showDeleteVariantConfirmation() {
  const character = getActiveCharacter();
  const index = state.selectedVariantIndex;
  if (!character || index === null || !character.images?.[index]) return;
  state.modal = `<div class="modal-backdrop"><div class="modal delete-modal"><p class="eyebrow">DELETE PORTRAIT VARIANT</p><h2>Remove portrait ${index + 1}?</h2><p class="modal-copy">This permanently removes the selected portrait from ${escapeHtml(character.name)}. The character record and its other variants will remain.</p><div class="modal-actions"><button class="outline-button" data-action="close-modal">Cancel</button><button class="danger-button" data-action="confirm-delete-variant" autofocus>Delete portrait</button></div><p class="dialog-shortcuts"><span>Enter to confirm</span><span>Esc to cancel</span></p></div></div>`;
  render('modal');
  document.querySelector('[data-action="confirm-delete-variant"]')?.focus();
}

function showBatchDeleteConfirmation() {
  const count = state.selectedCharacterIds.size;
  if (!state.batchMode || !count) return;
  state.modal = `<div class="modal-backdrop"><div class="modal delete-modal"><p class="eyebrow">DELETE CHARACTERS</p><h2>Remove ${count} character${count === 1 ? '' : 's'}?</h2><p class="modal-copy">This removes the selected records from ${escapeHtml(state.activeGallery)}. This cannot be undone.</p><div class="modal-actions"><button class="outline-button" data-action="close-modal">Cancel</button><button class="danger-button" data-action="confirm-delete-batch" autofocus>Delete selected</button></div><p class="dialog-shortcuts"><span>Enter to confirm</span><span>Esc to cancel</span></p></div></div>`;
  render('modal'); document.querySelector('[data-action="confirm-delete-batch"]')?.focus();
}

function showDnaOverwriteConfirmation(dna) {
  const character = getActiveCharacter();
  if (!character) return;
  state.pendingDnaSource = dna;
  state.modal = `<div class="modal-backdrop"><div class="modal delete-modal"><p class="eyebrow">REPLACE DNA</p><h2>Replace ${escapeHtml(character.name)}'s DNA?</h2><p class="modal-copy">This opens the clipboard DNA in the workbench. The current DNA is not replaced until you choose Save DNA.</p><div class="modal-actions"><button class="outline-button" data-action="close-modal">Cancel</button><button class="danger-button" data-action="confirm-paste-dna" autofocus>Replace in workbench</button></div><p class="dialog-shortcuts"><span>Enter to continue</span><span>Esc to cancel</span></p></div></div>`;
  render('modal');
  document.querySelector('[data-action="confirm-paste-dna"]')?.focus();
}

async function handleModalAction(name) {
  if (name === 'close-modal') {
    releaseCropSource();
    if (state.captureSession) await releaseLiveCapture();
    state.modal = null;
    state.cropSession = null;
    state.captureSession = null;
    state.pendingPortraitSource = null;
    state.pendingDnaSource = null;
    state.dnaHistory = null;
    state.focusDnaSave = false;
    state.transferCharacterIds = [];
    render('modal');
    restoreSelectionFocus();
    return;
  }
  if (name === 'create-character') {
    const input = document.querySelector('#modal-name'); const nameValue = input?.value.trim();
    if (!nameValue) return input?.focus();
    const portraitSource = state.pendingPortraitSource;
    const dnaSource = state.pendingDnaSource;
    state.pendingPortraitSource = null;
    state.pendingDnaSource = null;
    if (state.preview) { state.preview = false; state.galleries = [{ name: 'Default', characters: [] }]; state.activeGallery = 'Default'; state.sort = 'recent'; }
    const character = { id: crypto.randomUUID(), name: nameValue, images: [], dna: dnaSource || '', tags: [], created: Date.now(), modified: Date.now() };
    getGallery().characters.push(character); state.activeId = character.id; state.focusContext = 'character'; state.selectedVariantIndex = null; state.modal = null; cancelBatchSelection(false); render();
    if (!(await saveLibrary())) { releaseCropSource(portraitSource); return; }
    if (portraitSource) { showCropModal(portraitSource); showToast('Record created. Position the clipboard portrait.', 'success'); }
    else if (dnaSource) showToast('Record created with clipboard DNA.', 'success');
    else showToast('Record created. Add a portrait when ready.', 'success');
    return;
  }
  if (name === 'confirm-paste-dna') {
    const dna = state.pendingDnaSource;
    state.pendingDnaSource = null;
    if (dna) showDnaModal(dna, true);
  }
  if (name === 'create-gallery') {
    const input = document.querySelector('#modal-gallery-name'); const nameValue = input?.value.trim();
    if (!nameValue) return input?.focus();
    if (state.galleries.some((gallery) => gallery.name.toLowerCase() === nameValue.toLowerCase())) { showToast('A collection with that name already exists.', 'info'); return input.focus(); }
    state.galleries.push({ name: nameValue, characters: [] }); state.activeGallery = nameValue; resetSelection(); clearFilters(false); state.filterPanelOpen = false; state.sort = 'recent'; state.modal = null; cancelBatchSelection(false); render(); if (await saveLibrary()) showToast('Collection created.', 'success');
  }
  if (name === 'confirm-rename-gallery') {
    const gallery = getGallery(); const input = document.querySelector('#rename-gallery-name'); const value = input?.value.trim();
    if (!gallery || !value) return input?.focus();
    if (state.galleries.some((item) => item !== gallery && item.name.toLowerCase() === value.toLowerCase())) { showToast('A collection with that name already exists.', 'info'); return input.focus(); }
    gallery.name = value; gallery.modified = Date.now(); state.activeGallery = value; state.modal = null; render(); if (await saveLibrary()) showToast('Collection renamed.', 'success');
  }
  if (name === 'confirm-delete-gallery') {
    const gallery = getGallery();
    if (!gallery || state.galleries.length === 1) return;
    const galleryIndex = state.galleries.indexOf(gallery);
    const deletedIds = new Set(gallery.characters.map((character) => character.id));
    const imagePaths = [...new Set(gallery.characters.flatMap((character) => character.images || []).filter(Boolean))];
    state.galleries = state.galleries.filter((item) => item !== gallery);
    state.activeGallery = state.galleries[0].name; clearFilters(false); state.filterPanelOpen = false; state.sort = gallerySortMode(); resetSelection(); state.modal = null; cancelBatchSelection(false); render();
    if (!(await saveLibrary())) {
      state.galleries.splice(galleryIndex, 0, gallery);
      state.activeGallery = gallery.name;
      state.sort = gallerySortMode(gallery);
      render();
      return;
    }
    deletedIds.forEach((id) => { state.favorites.delete(id); state.imageUrls.delete(id); });
    localStorage.setItem('ck3-favorites', JSON.stringify([...state.favorites]));
    const cleanupFailures = await cleanupUnusedPortraits(imagePaths);
    showToast(cleanupFailures ? `Collection deleted, but ${cleanupFailures} portrait file${cleanupFailures === 1 ? '' : 's'} could not be removed.` : `Collection "${gallery.name}" deleted.`, cleanupFailures ? 'info' : 'success');
  }
  if (name === 'confirm-delete-gallery-batch') {
    const names = new Set(state.selectedGalleryNames);
    const deletedGalleries = state.galleries.filter((gallery) => names.has(gallery.name));
    if (!deletedGalleries.length || deletedGalleries.length === state.galleries.length) return;
    const previousGalleries = state.galleries;
    const previousState = {
      activeGallery: state.activeGallery,
      sort: state.sort,
      filters: { dna: state.filters.dna, favorites: state.filters.favorites, tags: new Set(state.filters.tags) },
      filterPanelOpen: state.filterPanelOpen,
      activeId: state.activeId,
      focusContext: state.focusContext,
      selectedVariantIndex: state.selectedVariantIndex,
      batchMode: state.batchMode,
      selectedCharacterIds: new Set(state.selectedCharacterIds),
      galleryBatchMode: state.galleryBatchMode,
      selectedGalleryNames: new Set(state.selectedGalleryNames),
    };
    const deletedIds = new Set(deletedGalleries.flatMap((gallery) => gallery.characters.map((character) => character.id)));
    const imagePaths = deletedGalleries.flatMap((gallery) => gallery.characters.flatMap((character) => character.images || []));
    state.galleries = state.galleries.filter((gallery) => !names.has(gallery.name));
    if (names.has(state.activeGallery)) state.activeGallery = state.galleries[0].name;
    clearFilters(false); state.filterPanelOpen = false; state.sort = gallerySortMode(); resetSelection(); state.modal = null; cancelBatchSelection(false); cancelGalleryBatchSelection(false); render();
    if (!(await saveLibrary())) {
      state.galleries = previousGalleries;
      state.activeGallery = previousState.activeGallery;
      state.sort = previousState.sort;
      state.filters = previousState.filters;
      state.filterPanelOpen = previousState.filterPanelOpen;
      state.activeId = previousState.activeId;
      state.focusContext = previousState.focusContext;
      state.selectedVariantIndex = previousState.selectedVariantIndex;
      state.batchMode = previousState.batchMode;
      state.selectedCharacterIds = previousState.selectedCharacterIds;
      state.galleryBatchMode = previousState.galleryBatchMode;
      state.selectedGalleryNames = previousState.selectedGalleryNames;
      render();
      return;
    }
    deletedIds.forEach((id) => { state.favorites.delete(id); state.imageUrls.delete(id); });
    localStorage.setItem('ck3-favorites', JSON.stringify([...state.favorites]));
    const cleanupFailures = await cleanupUnusedPortraits(imagePaths);
    showToast(cleanupFailures ? `${deletedGalleries.length} collections deleted, but ${cleanupFailures} portrait file${cleanupFailures === 1 ? '' : 's'} could not be removed.` : `${deletedGalleries.length} collections deleted.`, cleanupFailures ? 'info' : 'success');
  }
  if (name === 'create-import') {
    const input = document.querySelector('#modal-import-name'); const nameValue = input?.value.trim();
    if (!nameValue || !state.importFolder) return input?.focus();
    if (state.galleries.some((gallery) => gallery.name.toLowerCase() === nameValue.toLowerCase())) { showToast('A collection with that name already exists. Choose a different name to import it as a separate collection.', 'info'); return input.focus(); }
    try {
      const imported = await desktop.importGallery(state.importFolder, nameValue);
      state.galleries.push(imported); state.activeGallery = imported.name; resetSelection(); clearFilters(false); state.filterPanelOpen = false; state.sort = gallerySortMode(imported); state.modal = null; state.importFolder = null; state.preview = false; cancelBatchSelection(false); render(); if (await saveLibrary()) showToast('Collection imported into the archive.', 'success');
    } catch (error) { showToast(readableError(error, 'The collection could not be imported.'), 'info'); }
  }
  if (name === 'save-dna') {
    const character = getActiveCharacter(); const input = document.querySelector('#dna-input'); if (character && input) { character.dna = input.value; character.modified = Date.now(); state.dnaHistory = null; state.focusDnaSave = false; state.modal = null; render(); if (await saveLibrary()) showToast('DNA saved to the archive.', 'success'); }
  }
  if (name === 'transfer-character') return showTransferCharacterModal();
  if (name === 'customize-appearance') return showCharacterAppearanceModal();
  if (name === 'capture-live-portrait') return showLiveCaptureModal();
  if (name === 'capture-reset') return resetLiveCaptureCrop();
  if (name === 'capture-center') return centerLiveCaptureCrop();
  if (name === 'capture-draw') return setLiveCaptureDrawMode(!state.captureSession?.drawMode);
  if (name === 'capture-refresh') return refreshLiveCaptureSources();
  if (name === 'capture-stop') return finishLiveCapture();
  if (name === 'copy-character' || name === 'move-character') return transferCharacters(name === 'copy-character' ? 'copy' : 'move', document.querySelector('#transfer-gallery')?.value, state.transferCharacterIds);
  if (name === 'reset-appearance') return resetAppearanceEditor();
  if (name === 'save-appearance') return saveCharacterAppearance();
  if (name === 'clear-dna') {
    if (document.querySelector('#dna-input')) { setDnaEditorValue(''); showToast('DNA editor cleared. Save to keep the change.', 'success'); }
  }
  if (name === 'homogenize-dna') {
    const input = document.querySelector('#dna-input');
    if (input) { setDnaEditorValue(homogenizeDna(input.value)); showToast('DNA homogenized. Save to keep the change.', 'success'); }
  }
  if (name === 'save-note') {
    const character = getActiveCharacter(); const input = document.querySelector('#note-input');
    if (character && input) { character.note = input.value.trim(); character.tags = noteTags(character.note); character.modified = Date.now(); state.modal = null; render(); if (await saveLibrary()) showToast('Notes and tags saved.', 'success'); }
  }
  if (name === 'rename-character') {
    const character = getActiveCharacter(); const value = document.querySelector('#manage-name')?.value.trim();
    if (!character || !value) return;
    character.name = value; character.modified = Date.now(); state.modal = null; render(); if (await saveLibrary()) showToast('Character record renamed.', 'success');
  }
  if (name === 'duplicate-character') {
    await duplicateSelectedCharacter();
  }
  if (name === 'delete-character') {
    return showDeleteConfirmation();
  }
  if (name === 'confirm-delete') {
    const character = getActiveCharacter(); if (!character) return;
    const gallery = getGallery();
    const characterIndex = gallery.characters.indexOf(character);
    const imagePaths = [...(character.images || [])];
    gallery.characters = gallery.characters.filter((item) => item.id !== character.id); resetSelection(); state.modal = null; render();
    if (!(await saveLibrary())) {
      gallery.characters.splice(characterIndex, 0, character);
      state.activeId = character.id;
      render();
      return;
    }
    state.favorites.delete(character.id); state.imageUrls.delete(character.id);
    localStorage.setItem('ck3-favorites', JSON.stringify([...state.favorites]));
    const cleanupFailures = await cleanupUnusedPortraits(imagePaths);
    showToast(cleanupFailures ? `Character deleted, but ${cleanupFailures} portrait file${cleanupFailures === 1 ? '' : 's'} could not be removed.` : 'Character record deleted.', cleanupFailures ? 'info' : 'success');
  }
  if (name === 'confirm-delete-batch') {
    const gallery = getGallery(); const ids = new Set(state.selectedCharacterIds);
    if (!gallery || !ids.size) return;
    const previousCharacters = gallery.characters;
    const deletedCharacters = gallery.characters.filter((character) => ids.has(character.id));
    const count = deletedCharacters.length;
    const imagePaths = deletedCharacters.flatMap((character) => character.images || []);
    gallery.characters = gallery.characters.filter((character) => !ids.has(character.id));
    resetSelection(); state.modal = null; render();
    if (!(await saveLibrary())) { gallery.characters = previousCharacters; render(); return; }
    ids.forEach((id) => { state.favorites.delete(id); state.imageUrls.delete(id); });
    localStorage.setItem('ck3-favorites', JSON.stringify([...state.favorites]));
    cancelBatchSelection(false); render();
    const cleanupFailures = await cleanupUnusedPortraits(imagePaths);
    showToast(cleanupFailures ? `${count} characters deleted, but ${cleanupFailures} portrait file${cleanupFailures === 1 ? '' : 's'} could not be removed.` : `${count} character${count === 1 ? '' : 's'} deleted.`, cleanupFailures ? 'info' : 'success');
  }
  if (name === 'confirm-delete-variant') await deleteSelectedVariant();
  if (name === 'crop-reset') resetCropPosition();
  if (name === 'save-crop') await saveCroppedPortrait();
}

async function deleteSelectedVariant() {
  const character = getActiveCharacter();
  const index = state.selectedVariantIndex;
  if (!character || index === null || !character.images?.[index]) return;
  const previousCover = coverVariantIndex(character);
  const imagePath = character.images[index];
  const previousImages = [...character.images];
  const previousUrls = [...(state.imageUrls.get(character.id) || [])];
  const previousImageUrl = character._imageUrl;
  character.images.splice(index, 1);
  const urls = state.imageUrls.get(character.id) || [];
  urls.splice(index, 1);
  state.imageUrls.set(character.id, urls);
  character.variants = character.images.length;
  if (!character.images.length) character.coverIndex = 0;
  else if (index < previousCover) character.coverIndex = previousCover - 1;
  else if (index === previousCover) character.coverIndex = Math.min(index, character.images.length - 1);
  else character.coverIndex = previousCover;
  character._imageUrl = urls[0] || null;
  character.modified = Date.now();
  state.modal = null;
  if (character.images.length) {
    state.focusContext = 'variant';
    state.selectedVariantIndex = Math.min(index, character.images.length - 1);
  } else {
    state.focusContext = 'character';
    state.selectedVariantIndex = null;
  }
  render();
  if (!(await saveLibrary())) {
    character.images = previousImages;
    character.variants = previousImages.length;
    character.coverIndex = previousCover;
    character._imageUrl = previousImageUrl;
    state.imageUrls.set(character.id, previousUrls);
    state.focusContext = 'variant';
    state.selectedVariantIndex = index;
    render();
    return;
  }
  const cleanupFailures = await cleanupUnusedPortraits([imagePath]);
  showToast(cleanupFailures ? 'The portrait was removed from the record, but its file could not be deleted.' : 'Portrait variant deleted.', cleanupFailures ? 'info' : 'success');
  if (state.focusContext === 'variant') {
    focusWithoutScroll(document.querySelector(`[data-variant="${state.selectedVariantIndex}"]`));
  }
}

