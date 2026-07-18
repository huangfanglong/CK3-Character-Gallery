/* The renderer is deliberately dependency-light: the archive is fast, local, and keyboard-friendly. */
const desktop = window.galleryDesktop;

const app = document.querySelector('#app');
const SORT_OPTIONS = [['recent', 'Recently modified'], ['custom', 'Custom'], ['name', 'Name A-Z'], ['oldest', 'Oldest first']];
const IMAGE_FILE_PATTERN = /\.(png|jpe?g|bmp|gif|webp)$/i;

function isSortMode(value) {
  return SORT_OPTIONS.some(([sortMode]) => sortMode === value);
}

function isSupportedImageFile(value) {
  return IMAGE_FILE_PATTERN.test(value);
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;'
  }[character]));
}

function noteTags(note = '') {
  const tags = [];
  const seen = new Set();
  for (const match of String(note).matchAll(/(^|[\s,])#([^,\s#]+)/g)) {
    const tag = match[2].toLowerCase();
    if (!seen.has(tag)) { seen.add(tag); tags.push(tag); }
  }
  return tags;
}

function highlightedNoteMarkup(note = '') {
  const value = String(note);
  let markup = '';
  let cursor = 0;
  for (const match of value.matchAll(/(^|[\s,])#([^,\s#]+)/g)) {
    const tagStart = match.index + match[1].length;
    const tagEnd = match.index + match[0].length;
    markup += escapeHtml(value.slice(cursor, tagStart));
    markup += `<mark class="note-tag-token">${escapeHtml(value.slice(tagStart, tagEnd))}</mark>`;
    cursor = tagEnd;
  }
  markup += escapeHtml(value.slice(cursor));
  return markup || ' ';
}

function characterTags(character) {
  const tagsFromNote = noteTags(character.note);
  return tagsFromNote.length ? tagsFromNote : Array.isArray(character.tags) ? character.tags : [];
}

function activeFilterCount() {
  return (state.filters.dna === 'all' ? 0 : 1)
    + (state.filters.favorites ? 1 : 0)
    + state.filters.tags.size;
}

function availableTags() {
  return [...new Set(getCharacters()
    .flatMap(characterTags)
    .map((tag) => String(tag).trim().toLowerCase())
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function clearFilters(renderPage = true) {
  state.filters = { dna: 'all', favorites: false, tags: new Set() };
  if (renderPage) render();
}

function getGallery() {
  return state.galleries.find((gallery) => gallery.name === state.activeGallery) || state.galleries[0];
}

function getCharacters() {
  return getGallery()?.characters || [];
}

function getActiveCharacter() {
  return getCharacters().find((character) => character.id === state.activeId) || null;
}

function gallerySortMode(gallery = getGallery()) {
  return isSortMode(gallery?.sortMode)
    ? gallery.sortMode
    : 'recent';
}

function normalizedCharacter(character) {
  return {
    ...character,
    tags: characterTags(character),
    images: Array.isArray(character.images) ? character.images : [],
    status: character.dna?.trim() ? 'ready' : 'draft',
    title: character.title === 'Uncatalogued character' ? '' : character.title || '',
    variants: character.variants || character.images?.length || 0,
    color: character.color || colorFor(character.name),
  };
}

function colorFor(name = '') {
  const colors = ['rust', 'violet', 'olive', 'ochre', 'blue', 'plum'];
  return colors[[...name].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % colors.length];
}

function visibleCharacters() {
  let characters = getCharacters().map(normalizedCharacter);
  const query = state.query.trim().toLowerCase();
  if (query) {
    if (query.startsWith('tag:') || query.startsWith('tags:')) {
      const tags = query.replace(/^tags?:/, '').split(',').map((tag) => tag.trim()).filter(Boolean);
      characters = characters.filter((character) => tags.every((tag) => character.tags.map((item) => item.toLowerCase()).includes(tag)));
    } else {
      characters = characters.filter((character) => `${character.name} ${character.title} ${character.tags.join(' ')}`.toLowerCase().includes(query));
    }
  }
  if (state.filters.dna === 'ready') characters = characters.filter((character) => character.status === 'ready');
  if (state.filters.dna === 'drafts') characters = characters.filter((character) => character.status === 'draft');
  if (state.filters.favorites) characters = characters.filter((character) => state.favorites.has(character.id));
  if (state.filters.tags.size) {
    characters = characters.filter((character) => {
      const tags = new Set(character.tags.map((tag) => tag.toLowerCase()));
      return [...state.filters.tags].every((tag) => tags.has(tag));
    });
  }
  if (state.sort !== 'custom') {
    characters.sort((a, b) => {
      if (state.sort === 'name') return a.name.localeCompare(b.name);
      if (state.sort === 'oldest') return (a.created || 0) - (b.created || 0);
      return (b.modified || b.created || 0) - (a.modified || a.created || 0);
    });
  }
  return characters;
}

function imageUrlFor(character, variantIndex = 0) {
  return state.imageUrls.get(character.id)?.[variantIndex]
    || (variantIndex === 0 ? character._imageUrl || character.imageUrl : null);
}

function coverVariantIndex(character) {
  const count = character.images?.length || (state.preview ? character.variants || 0 : 0);
  if (!count) return 0;
  const index = Number(character.coverIndex) || 0;
  return Math.max(0, Math.min(index, count - 1));
}

function portraitMarkup(character, size = 'card', variantIndex = 0) {
  const image = imageUrlFor(character, variantIndex);
  if (image) return `<img class="portrait-image ${size}" src="${escapeHtml(image)}" alt="${escapeHtml(character.name)} portrait" />`;
  return `<div class="portrait-placeholder ${size}" aria-label="No portrait available"><span class="silhouette-head"></span><span class="silhouette-shoulders"></span></div>`;
}

function icon(name) {
  const paths = {
    search: '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path>',
    plus: '<path d="M12 5v14M5 12h14"></path>',
    close: '<path d="m6 6 12 12M18 6 6 18"></path>',
    sliders: '<path d="M4 6h16M7 12h10M10 18h4"></path>',
    grid: '<rect x="4" y="4" width="6" height="6" rx="1"></rect><rect x="14" y="4" width="6" height="6" rx="1"></rect><rect x="4" y="14" width="6" height="6" rx="1"></rect><rect x="14" y="14" width="6" height="6" rx="1"></rect>',
    list: '<path d="M8 6h12M8 12h12M8 18h12"></path><path d="M4 6h.01M4 12h.01M4 18h.01"></path>',
    copy: '<rect x="8" y="8" width="10" height="10" rx="2"></rect><path d="M6 16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z"></path>',
    more: '<circle cx="5" cy="12" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"></path>',
    download: '<path d="M12 4v11M8 11l4 4 4-4M5 20h14"></path>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>',
    check: '<path d="m5 12 4 4L19 6"></path>',
    edit: '<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"></path>',
    trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"></path>',
    warning: '<path d="M12 4 21 20H3z"></path><path d="M12 9v5M12 17h.01"></path>',
    chevron: '<path d="m7 10 5 5 5-5"></path>',
  };
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.more}</svg>`;
}

let lastRenderedActiveId = null;

function render(scope = 'all') {
  if (scope === 'selection') return renderSelection();
  if (scope === 'context') return renderContextMenu();
  if (scope === 'modal') return renderModal();
  if (scope === 'chrome') return renderChrome();
  const characters = visibleCharacters();
  morphAppContent(app, `${chromeMarkup()}<div class="app-shell">${sidebarMarkup(state.galleries)}${mainMarkup(characters)}${inspectorMarkup(getActiveCharacter())}</div>${state.modal || ''}${contextMenuMarkup()}`);
  syncGalleryBatchSelection();
  lastRenderedActiveId = state.activeId;
  if (state.focusDnaSave) focusWithoutScroll(app.querySelector('[data-action="save-dna"]'));
  if (state.sortMenuOpen) focusWithoutScroll(app.querySelector('[data-sort][aria-selected="true"]'));
  void updateImageUrls().catch((error) => showToast(readableError(error, 'Portrait previews could not be loaded.'), 'info'));
}

function focusWithoutScroll(element) {
  element?.focus({ preventScroll: true });
}

async function updateImageUrls() {
  if (!desktop) return;
  const chars = getCharacters();
  let changed = false;
  for (const character of chars) {
    const paths = (character.images || []).filter(Boolean);
    const existing = state.imageUrls.get(character.id);
    if (existing?.length === paths.length) continue;
    if (!paths.length) { state.imageUrls.set(character.id, []); continue; }
    state.imageUrls.set(character.id, await Promise.all(paths.map((imagePath) => desktop.imageUrl(imagePath))));
    changed = true;
  }
  if (changed) render();
}

function renderSelection() {
  if (lastRenderedActiveId !== state.activeId) {
    if (lastRenderedActiveId) app.querySelector(`[data-character-id="${CSS.escape(lastRenderedActiveId)}"]`)?.classList.remove('selected');
    if (state.activeId && !state.batchMode) app.querySelector(`[data-character-id="${CSS.escape(state.activeId)}"]`)?.classList.add('selected');
    lastRenderedActiveId = state.activeId;
  }
  const inspector = app.querySelector('.inspector');
  if (inspector) morphAppRegion(inspector, inspectorMarkup(getActiveCharacter()));
}

function renderChrome() {
  const current = app.querySelector('.window-chrome');
  const next = morphAppRegion(current, chromeMarkup());
  if (!current && next) app.prepend(next);
}

function renderContextMenu() {
  const current = app.querySelector('.context-menu');
  const next = morphAppRegion(current, contextMenuMarkup());
  if (!current && next) app.appendChild(next);
}

function renderModal() {
  renderChrome();
  if (!state.contextMenu) app.querySelector('.context-menu')?.remove();
  const current = app.querySelector('.modal-backdrop');
  const next = morphAppRegion(current, state.modal || '');
  if (!current && next) app.insertBefore(next, app.querySelector('.context-menu'));
  if (state.focusDnaSave) focusWithoutScroll(app.querySelector('[data-action="save-dna"]'));
}

/* All UI events are delegated once from #app at boot; render() only morphs the DOM and never
   rebinds listeners. Branches that previously stopped propagation on their own elements still
   do so here, so the document-level modal/menu delegation keeps its original behavior. */
function installEventDelegation() {
  app.addEventListener('click', handleDelegatedClick);
  app.addEventListener('contextmenu', handleDelegatedContextMenu);
  app.addEventListener('keydown', handleDelegatedKeydown);
  app.addEventListener('input', handleDelegatedInput);
  app.addEventListener('change', handleDelegatedChange);
  app.addEventListener('focusin', (event) => {
    if (event.target.closest?.('.dna-modal') && event.target.dataset?.action !== 'save-dna') state.focusDnaSave = false;
  });
  /* scroll and mouseenter/mouseleave do not bubble, but capture-phase listeners still see them. */
  app.addEventListener('scroll', (event) => {
    if (event.target?.id === 'note-input') syncNoteHighlightScroll(event.target);
  }, true);
  app.addEventListener('mouseenter', showTablePortraitPreview, true);
  app.addEventListener('mouseleave', hideTablePortraitPreview, true);
  installReorderDelegation();
}

function handleDelegatedClick(event) {
  if (!(event.target instanceof Element)) return;
  if (state.galleryBatchMode && !event.target.closest('.collection-nav, .context-menu, .modal-backdrop')) {
    cancelGalleryBatchSelection(false);
    syncGalleryBatchSelection();
  }
  const favoriteButton = event.target.closest('[data-action="favorite"]');
  if (favoriteButton) {
    event.stopPropagation();
    state.activeMenu = null;
    if (state.batchMode) return;
    return toggleFavorite(favoriteButton.closest('[data-character-id]')?.dataset.characterId || state.activeId);
  }
  const cycleButton = event.target.closest('[data-cycle-portrait]');
  if (cycleButton) {
    event.stopPropagation();
    if (state.batchMode) return;
    return void cycleCardPortrait(cycleButton.closest('[data-character-id]')?.dataset.characterId, Number(cycleButton.dataset.cyclePortrait));
  }
  const moreButton = event.target.closest('[data-action="more"]');
  if (moreButton) {
    event.stopPropagation();
    if (state.batchMode) return;
    resetSelection(moreButton.closest('[data-character-id]')?.dataset.characterId || state.activeId);
    render('selection');
    return showManageModal();
  }
  const contextActionButton = event.target.closest('[data-context-action]');
  if (contextActionButton) {
    event.stopPropagation();
    return void handleContextAction(contextActionButton.dataset.contextAction);
  }
  const menuButton = event.target.closest('[data-menu]');
  if (menuButton) {
    event.stopPropagation();
    if (state.contextMenu) { state.contextMenu = null; render('context'); }
    state.activeMenu = state.activeMenu === menuButton.dataset.menu ? null : menuButton.dataset.menu;
    return render('chrome');
  }
  const variantButton = event.target.closest('[data-variant]');
  if (variantButton) {
    event.stopPropagation();
    state.focusContext = 'variant';
    state.selectedVariantIndex = Number(variantButton.dataset.variant);
    render('selection');
    return focusWithoutScroll(document.querySelector(`[data-variant="${state.selectedVariantIndex}"]`));
  }
  const sortButton = event.target.closest('[data-sort]');
  if (sortButton) return void setSortMode(sortButton.dataset.sort);
  const dnaFilterButton = event.target.closest('[data-dna-filter]');
  if (dnaFilterButton) {
    state.filters.dna = dnaFilterButton.dataset.dnaFilter;
    return render();
  }
  const filterButton = event.target.closest('[data-filter]');
  if (filterButton) {
    const filter = filterButton.dataset.filter;
    if (filter === 'all') clearFilters(false);
    if (filter === 'favorites') state.filters.favorites = !state.filters.favorites;
    if (filter === 'ready' || filter === 'drafts') state.filters.dna = state.filters.dna === filter ? 'all' : filter;
    state.filterPanelOpen = false;
    return render();
  }
  const galleryButton = event.target.closest('[data-gallery]');
  if (galleryButton) {
    if (state.galleryBatchMode || event.ctrlKey || event.metaKey) return toggleGalleryBatchSelection(galleryButton.dataset.gallery, event.ctrlKey || event.metaKey);
    activateGallery(galleryButton.dataset.gallery);
    state.focusContext = 'collection';
    return render();
  }
  const viewButton = event.target.closest('[data-view]');
  if (viewButton) {
    state.view = viewButton.dataset.view;
    return render();
  }
  const actionButton = event.target.closest('[data-action]');
  if (actionButton) return action(actionButton.dataset.action);
  const characterElement = event.target.closest('[data-character-id]');
  if (characterElement) return selectCharacterElement(characterElement, event);
  const blankArchiveSpace = event.target.classList.contains('main-content')
    || event.target.classList.contains('card-grid')
    || event.target.classList.contains('table-view');
  if (blankArchiveSpace && state.activeId) {
    resetSelection();
    render('selection');
  }
}

function selectCharacterElement(element, event) {
  if (state.batchMode || event.ctrlKey || event.metaKey) return toggleBatchSelection(element.dataset.characterId, event.ctrlKey || event.metaKey);
  resetSelection(element.dataset.characterId);
  render('selection');
  restoreSelectionFocus();
}

function activateGallery(name) {
  state.activeGallery = name;
  resetSelection();
  clearFilters(false);
  state.filterPanelOpen = false;
  state.sort = gallerySortMode();
  cancelBatchSelection(false);
  cancelGalleryBatchSelection(false);
}

function handleDelegatedContextMenu(event) {
  if (!(event.target instanceof Element)) return;
  const characterElement = event.target.closest('[data-character-id]');
  if (characterElement) {
    if (state.preview) return;
    event.preventDefault();
    if (state.batchMode) {
      if (!state.selectedCharacterIds.has(characterElement.dataset.characterId)) {
        state.selectedCharacterIds.clear();
        state.selectedCharacterIds.add(characterElement.dataset.characterId);
      }
      return openContextMenu(event, { type: 'batch', ids: [...state.selectedCharacterIds] });
    }
    resetSelection(characterElement.dataset.characterId);
    return openContextMenu(event, { type: 'character', id: characterElement.dataset.characterId });
  }
  const galleryButton = event.target.closest('[data-gallery]');
  if (galleryButton) {
    if (state.preview) return;
    event.preventDefault();
    if (state.galleryBatchMode) {
      if (!state.selectedGalleryNames.has(galleryButton.dataset.gallery)) {
        state.selectedGalleryNames.clear();
        state.selectedGalleryNames.add(galleryButton.dataset.gallery);
      }
      return openContextMenu(event, { type: 'gallery-batch', names: [...state.selectedGalleryNames] });
    }
    activateGallery(galleryButton.dataset.gallery);
    state.focusContext = 'collection';
    openContextMenu(event, { type: 'collection', name: galleryButton.dataset.gallery });
  }
}

function handleDelegatedKeydown(event) {
  if (!(event.target instanceof Element)) return;
  const sortButton = event.target.closest('[data-sort]');
  if (sortButton) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const options = [...document.querySelectorAll('[data-sort]')];
    const index = options.indexOf(sortButton);
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? options.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    return options[next]?.focus();
  }
  if (event.target.id === 'character-title') {
    const titleInput = event.target;
    if (event.key === 'Enter') { event.preventDefault(); titleInput.blur(); }
    if (event.key === 'Escape') { event.preventDefault(); titleInput.value = getActiveCharacter()?.title || ''; titleInput.blur(); }
    return;
  }
  if (event.key !== 'Enter') return;
  const characterElement = event.target.closest('[data-character-id]');
  if (characterElement) selectCharacterElement(characterElement, event);
}

function handleDelegatedInput(event) {
  const target = event.target;
  if (target.id === 'search-input') {
    state.query = target.value;
    return render();
  }
  if (target.id === 'dna-input') {
    updateDnaCount();
    return recordDnaHistory(target.value);
  }
  if (target.id === 'note-input') updateNoteHighlights(target);
}

function handleDelegatedChange(event) {
  const target = event.target;
  if (target.id === 'character-title') return void saveCharacterTitle(target.value);
  if (target.matches?.('[data-favorite-filter]')) {
    state.filters.favorites = target.checked;
    return render();
  }
  if (target.matches?.('[data-filter-tag]')) {
    const tag = target.value.toLowerCase();
    if (target.checked) state.filters.tags.add(tag); else state.filters.tags.delete(tag);
    render();
  }
}

function openContextMenu(event, target) {
  const hadSortMenu = state.sortMenuOpen;
  state.activeMenu = null;
  state.sortMenuOpen = false;
  state.contextMenu = {
    ...target,
    x: Math.max(8, Math.min(event.clientX, window.innerWidth - 218)),
    y: Math.max(8, Math.min(event.clientY, window.innerHeight - (target.type === 'collection' ? 204 : target.type === 'batch' || target.type === 'gallery-batch' ? 112 : 342))),
  };
  if (target.type === 'character' && !hadSortMenu) {
    render('selection');
    render('chrome');
    render('context');
  } else render();
}

function showTablePortraitPreview(event) {
  if (!(event.target instanceof Element) || !event.target.matches('.table-avatar')) return;
  const avatar = event.target;
  const preview = avatar.querySelector('.table-portrait-preview');
  if (!preview) return;
  const anchor = avatar.getBoundingClientRect();
  const width = preview.offsetWidth;
  const height = preview.offsetHeight;
  const right = anchor.right + 14;
  const left = right + width <= window.innerWidth - 12 ? right : Math.max(12, anchor.left - width - 14);
  const top = Math.max(46, Math.min(anchor.top + anchor.height / 2 - height / 2, window.innerHeight - height - 12));
  preview.style.left = `${left}px`;
  preview.style.top = `${top}px`;
  preview.classList.add('visible');
}

function hideTablePortraitPreview(event) {
  if (!(event.target instanceof Element) || !event.target.matches('.table-avatar')) return;
  event.target.querySelector('.table-portrait-preview')?.classList.remove('visible');
}

async function handleContextAction(actionName) {
  const menu = state.contextMenu;
  state.contextMenu = null;
  if (!menu) return;
  render('context');
  if (menu.type === 'collection') {
    state.activeGallery = menu.name;
    if (actionName === 'rename') return showRenameGalleryModal();
    if (actionName === 'duplicate') return duplicateActiveGallery();
    if (actionName === 'batch-select') return startGalleryBatchSelection(menu.name);
    if (actionName === 'delete') return showDeleteGalleryConfirmation();
  }
  if (menu.type === 'gallery-batch') {
    if (actionName === 'delete-selected-galleries') return showGalleryBatchDeleteConfirmation();
    if (actionName === 'cancel-gallery-batch') return cancelGalleryBatchSelection();
  }
  if (menu.type === 'character') {
    state.activeId = menu.id;
    state.focusContext = 'character';
    state.selectedVariantIndex = null;
    if (actionName === 'manage') return showManageModal();
    if (actionName === 'favorite') return toggleFavorite(menu.id);
    if (actionName === 'copy-dna') return copyDna();
    if (actionName === 'paste-dna') return pasteDnaFromClipboard();
    if (actionName === 'transfer') return showTransferCharacterModal([menu.id]);
    if (actionName === 'duplicate') return duplicateSelectedCharacter();
    if (actionName === 'delete') return showDeleteConfirmation();
  }
  if (menu.type === 'batch') {
    if (actionName === 'transfer') return showTransferCharacterModal(menu.ids);
    if (actionName === 'delete-batch') return showBatchDeleteConfirmation();
  }
  render();
}

const REORDERABLE_LISTS = [
  {
    containerSelector: '.card-grid',
    itemSelector: '.character-card',
    key: (item) => item.dataset.characterId,
    canStart: (event) => !event.target.closest('button'),
    onStart: () => {},
    insertAfter: (event, dragged, target) => {
      const targetRect = target.getBoundingClientRect();
      const draggedRect = dragged.getBoundingClientRect();
      const sameRow = Math.abs(draggedRect.top - targetRect.top) < targetRect.height / 2;
      return sameRow ? event.clientX > targetRect.left + targetRect.width / 2 : event.clientY > targetRect.top + targetRect.height / 2;
    },
    commit: (order) => saveCustomCardOrder(order),
  },
  {
    containerSelector: '.collection-nav',
    itemSelector: '.collection-item',
    key: (item) => item.dataset.gallery,
    canStart: () => true,
    onStart: () => { state.contextMenu = null; },
    insertAfter: (event, _dragged, target) => {
      const rect = target.getBoundingClientRect();
      return event.clientY > rect.top + rect.height / 2;
    },
    commit: (order) => saveCollectionOrder(order),
  },
];

let reorderSession = null;

function installReorderDelegation() {
  app.addEventListener('dragstart', (event) => {
    if (!(event.target instanceof Element)) return;
    for (const config of REORDERABLE_LISTS) {
      const item = event.target.closest(`${config.itemSelector}[draggable="true"]`);
      const container = item?.closest(config.containerSelector);
      if (!item || !container) continue;
      const items = [...container.querySelectorAll(`${config.itemSelector}[draggable="true"]`)];
      if (items.length < 2) return;
      if (!config.canStart(event)) { event.preventDefault(); return; }
      reorderSession = { config, container, item, initialOrder: items.map(config.key), committed: false };
      config.onStart(item);
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', config.key(item));
      container.classList.add('is-reordering');
      requestAnimationFrame(() => { if (reorderSession?.item === item) item.classList.add('dragging'); });
      return;
    }
  });

  app.addEventListener('dragover', (event) => {
    if (!reorderSession || !(event.target instanceof Element)) return;
    const { config, container, item } = reorderSession;
    if (event.target.closest(config.containerSelector) !== container) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const target = event.target.closest(config.itemSelector);
    if (!target || target === item) return;
    container.insertBefore(item, config.insertAfter(event, item, target) ? target.nextElementSibling : target);
  });

  app.addEventListener('drop', (event) => {
    if (!reorderSession || !(event.target instanceof Element)) return;
    const { config, container, item } = reorderSession;
    if (event.target.closest(config.containerSelector) !== container) return;
    event.preventDefault();
    if (!event.target.closest(config.itemSelector)) container.appendChild(item);
    const order = [...container.querySelectorAll(config.itemSelector)].map(config.key);
    if (order.some((value, index) => value !== reorderSession.initialOrder[index])) {
      reorderSession.committed = true;
      config.commit(order);
    } else render();
  });

  app.addEventListener('dragend', () => {
    if (!reorderSession) return;
    const { container, item, committed } = reorderSession;
    container.classList.remove('is-reordering');
    item.classList.remove('dragging');
    reorderSession = null;
    if (!committed) render();
  });
}

async function saveCollectionOrder(orderedNames) {
  const galleriesByName = new Map(state.galleries.map((gallery) => [gallery.name, gallery]));
  if (orderedNames.length !== state.galleries.length || orderedNames.some((name) => !galleriesByName.has(name))) return;
  state.galleries = orderedNames.map((name) => galleriesByName.get(name));
  render();
  if (await saveLibrary()) {
    focusWithoutScroll(document.querySelector(`[data-gallery="${CSS.escape(state.activeGallery)}"]`));
    showToast('Collection order saved.', 'success');
  }
}

async function setSortMode(mode) {
  const gallery = getGallery();
  state.sort = isSortMode(mode) ? mode : 'recent';
  state.sortMenuOpen = false;
  if (gallery && !state.preview) gallery.sortMode = state.sort;
  render();
  if (!state.preview) await saveLibrary();
}

async function saveCustomCardOrder(orderedIds) {
  const gallery = getGallery();
  if (!gallery || orderedIds.length < 2) return;
  const visibleIds = new Set(orderedIds);
  const charactersById = new Map(gallery.characters.map((character) => [character.id, character]));
  let visibleIndex = 0;
  gallery.characters = gallery.characters.map((character) => (
    visibleIds.has(character.id) ? charactersById.get(orderedIds[visibleIndex++]) : character
  ));
  gallery.sortMode = 'custom';
  state.sort = 'custom';
  render();
  if (await saveLibrary()) {
    restoreSelectionFocus();
    showToast('Custom order saved.', 'success');
  }
}

async function cycleCardPortrait(characterId, delta) {
  const character = getCharacters().find((item) => item.id === characterId);
  const count = character?.images?.length || 0;
  if (!character || count < 2) return;
  character.coverIndex = (coverVariantIndex(character) + delta + count) % count;
  state.activeId = character.id;
  state.focusContext = 'character';
  state.selectedVariantIndex = null;
  render();
  await saveLibrary();
  restoreSelectionFocus();
}

function toggleFavorite(id) {
  if (!id) return;
  state.favorites.has(id) ? state.favorites.delete(id) : state.favorites.add(id);
  localStorage.setItem('ck3-favorites', JSON.stringify([...state.favorites])); render();
}

async function saveCharacterTitle(value) {
  const character = getActiveCharacter();
  if (!character) return;
  const title = value.trim();
  if (character.title === title) return;
  character.title = title;
  character.modified = Date.now();
  if (await saveLibrary()) showToast(title ? 'Character title saved.' : 'Character title removed.', 'success');
}

function startBatchSelection() {
  if (state.preview || !visibleCharacters().length) return;
  state.batchMode = true;
  state.selectedCharacterIds.clear();
  cancelGalleryBatchSelection(false);
  state.activeId = null;
  state.focusContext = 'character';
  state.selectedVariantIndex = null;
  render();
}

function cancelBatchSelection(shouldRender = true) {
  state.batchMode = false;
  state.selectedCharacterIds.clear();
  if (shouldRender) render();
}

function startGalleryBatchSelection(name) {
  if (state.preview || !state.galleries.some((gallery) => gallery.name === name)) return;
  state.galleryBatchMode = true;
  state.selectedGalleryNames.clear();
  state.selectedGalleryNames.add(name);
  resetSelection();
  state.focusContext = 'collection';
  cancelBatchSelection(false);
  render();
}

function cancelGalleryBatchSelection(shouldRender = true) {
  state.galleryBatchMode = false;
  state.selectedGalleryNames.clear();
  if (shouldRender) render();
}

function toggleGalleryBatchSelection(name, allowStart = false) {
  if (state.preview || !state.galleries.some((gallery) => gallery.name === name)) return;
  if (!state.galleryBatchMode) {
    if (!allowStart) return;
    state.galleryBatchMode = true;
    state.selectedGalleryNames.clear();
    resetSelection();
    state.focusContext = 'collection';
    cancelBatchSelection(false);
  }
  state.selectedGalleryNames.has(name) ? state.selectedGalleryNames.delete(name) : state.selectedGalleryNames.add(name);
  render();
}

function syncGalleryBatchSelection() {
  app.querySelectorAll('.collection-item').forEach((item) => {
    const selected = state.galleryBatchMode && state.selectedGalleryNames.has(item.dataset.gallery);
    item.classList.toggle('batch-selected', selected);
    item.setAttribute('aria-pressed', String(selected));
  });
}

function toggleBatchSelection(id, allowStart = false) {
  if (!id || state.preview) return;
  if (!state.batchMode) {
    if (!allowStart) return;
    const activeId = state.activeId;
    state.batchMode = true;
    state.selectedCharacterIds.clear();
    cancelGalleryBatchSelection(false);
    if (activeId) state.selectedCharacterIds.add(activeId);
    state.activeId = null;
    state.focusContext = 'character';
    state.selectedVariantIndex = null;
  }
  state.selectedCharacterIds.has(id) ? state.selectedCharacterIds.delete(id) : state.selectedCharacterIds.add(id);
  render();
  focusWithoutScroll(document.querySelector(`[data-character-id="${CSS.escape(id)}"]`));
}

function selectAllVisibleCharacters() {
  if (!state.batchMode) return;
  const visibleIds = visibleCharacters().map((character) => character.id);
  const allSelected = visibleIds.every((id) => state.selectedCharacterIds.has(id));
  visibleIds.forEach((id) => allSelected ? state.selectedCharacterIds.delete(id) : state.selectedCharacterIds.add(id));
  render();
}

function restoreSelectionFocus() {
  if (state.focusContext === 'variant' && state.selectedVariantIndex !== null) {
    focusWithoutScroll(document.querySelector(`[data-variant="${state.selectedVariantIndex}"]`));
    return;
  }
  if (state.activeId) {
    focusWithoutScroll(document.querySelector(`[data-character-id="${CSS.escape(state.activeId)}"]`));
  }
}

function action(name) {
  const hadActiveMenu = Boolean(state.activeMenu);
  state.activeMenu = null;
  if (hadActiveMenu) render('chrome');
  if (name === 'new-character') return showCharacterModal();
  if (name === 'new-gallery') return showGalleryModal();
  if (name === 'rename-gallery') return showRenameGalleryModal();
  if (name === 'delete-gallery') return showDeleteGalleryConfirmation();
  if (name === 'batch-select') return startBatchSelection();
  if (name === 'cancel-batch') return cancelBatchSelection();
  if (name === 'select-all-visible') return selectAllVisibleCharacters();
  if (name === 'delete-batch') return showBatchDeleteConfirmation();
  if (name === 'close-inspector') { resetSelection(); return render('selection'); }
  if (name === 'copy-dna') return copyDna();
  if (name === 'open-dna') return showDnaModal();
  if (name === 'undo-dna') return undoDnaChange();
  if (name === 'redo-dna') return redoDnaChange();
  if (name === 'paste-portrait') return pasteClipboardPortrait();
  if (name === 'edit-note') return showNoteModal();
  if (name === 'manage-record') return showManageModal();
  if (name === 'focus-search') { render(); document.querySelector('#search-input')?.focus(); return; }
  if (name === 'help-hint') return render();
  if (name === 'view-cards') { state.view = 'cards'; return render(); }
  if (name === 'view-table') { state.view = 'table'; return render(); }
  if (name === 'open-folder') return desktop?.openFolder(state.dataDirectory);
  if (name === 'save-library') return saveLibrary()
    .then((saved) => { if (saved) showToast('Archive saved.', 'success'); })
    .catch((error) => showToast(readableError(error, 'The archive could not be saved.'), 'info'));
  if (name === 'exit') return desktop?.quit();
  if (name === 'duplicate-shortcut') return duplicateSelectedCharacter();
  if (name === 'add-variant') return chooseImage();
  if (name === 'import') return importCollection();
  if (name === 'export') return exportCollection();
  if (name === 'filters') { state.sortMenuOpen = false; state.filterPanelOpen = !state.filterPanelOpen; return render(); }
  if (name === 'sort-menu') {
    state.filterPanelOpen = false;
    state.sortMenuOpen = !state.sortMenuOpen;
    render();
    if (state.sortMenuOpen) document.querySelector('[data-sort][aria-selected="true"]')?.focus();
    return;
  }
  if (name === 'close-filters') { state.filterPanelOpen = false; return render(); }
  if (name === 'clear-filters') return clearFilters();
  if (name === 'clear-search') { state.query = ''; clearFilters(false); state.filterPanelOpen = false; render(); }
  if (name === 'start-blank') { state.preview = false; state.galleries = [{ name: 'Default', characters: [] }]; state.activeGallery = 'Default'; resetSelection(); clearFilters(false); state.filterPanelOpen = false; state.sort = 'recent'; cancelBatchSelection(false); render(); }
}

function showToast(message, type = 'success') {
  document.querySelector('.toast')?.remove();
  const toast = document.createElement('div'); toast.className = `toast ${type}`; toast.innerHTML = `<span>${type === 'success' ? icon('check') : '◌'}</span>${escapeHtml(message)}`; document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

function readableError(error, fallback) {
  return String(error?.message || fallback).replace(/^Error invoking remote method '[^']+': Error:\s*/, '');
}

async function chooseImage() {
  if (!desktop || !getActiveCharacter()) return showToast('Choose a character first.', 'info');
  if (state.preview) return showToast('Start an empty gallery before adding your own portraits.', 'info');
  const character = getActiveCharacter();
  if (hasMaximumPortraits(character)) return showToast(`This character already has ${MAX_PORTRAIT_VARIANTS} portrait variants.`, 'info');
  try {
    const selected = await desktop.chooseImage(character.id); if (!selected) return;
    await appendPortrait(character, selected, 'Portrait variant added.');
  } catch (error) { showToast(readableError(error, 'The portrait could not be added.'), 'info'); }
}

async function pasteClipboardPortrait() {
  if (state.cropSession) return;
  if (!desktop) return showToast('Clipboard portraits are only available in the desktop app.', 'info');
  try {
    const source = await desktop.readClipboardImage();
    if (!source) return showToast('The clipboard does not contain an image.', 'info');
    openClipboardSource(source);
  } catch (error) {
    showToast(readableError(error, 'The clipboard image could not be read.'), 'info');
  }
}

async function pasteClipboardContent() {
  if (state.cropSession || !desktop) return;
  try {
    const source = await desktop.readClipboardImage();
    if (source) return openClipboardSource(source);
    const clipboardText = await desktop.readClipboardText();
    if (isValidCk3Dna(clipboardText)) openClipboardDna(clipboardText);
  } catch (error) {
    showToast(readableError(error, 'The clipboard could not be read.'), 'info');
  }
}

function bindModalDelegation() {
  document.addEventListener('click', (event) => {
    const actionName = event.target.closest('[data-action]')?.dataset.action;
    if (state.modal && actionName) runModalAction(actionName);
    if (state.activeMenu && !event.target.closest('.window-chrome')) { state.activeMenu = null; render('chrome'); }
    if (state.contextMenu && !event.target.closest('.context-menu')) { state.contextMenu = null; render('context'); }
    if (state.filterPanelOpen && !event.target.closest('.filter-control')) { state.filterPanelOpen = false; render(); }
    if (state.sortMenuOpen && !event.target.closest('.sort-control')) { state.sortMenuOpen = false; render(); }
  });
}

function runModalAction(actionName) {
  void handleModalAction(actionName)
    .catch((error) => showToast(readableError(error, 'The requested action could not be completed.'), 'info'));
}

function installKeyboardShortcuts() {
  document.addEventListener('keydown', (event) => {
    const command = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const target = event.target;
    const editingText = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;

    if (command && key === 'z' && !event.shiftKey && document.querySelector('#dna-input')) {
      event.preventDefault();
      undoDnaChange();
      return;
    }
    if (command && (key === 'y' || (key === 'z' && event.shiftKey)) && document.querySelector('#dna-input')) {
      event.preventDefault();
      redoDnaChange();
      return;
    }

    if (command && key === 'v') {
      if (editingText) return;
      event.preventDefault();
      void pasteClipboardContent();
      return;
    }
    if (command && key === 'c' && !editingText && !state.modal) {
      if (!getActiveCharacter()?.dna) return;
      event.preventDefault();
      copyDna();
      return;
    }
    if (command && key === 'n') {
      event.preventDefault();
      showCharacterModal();
      return;
    }
    if (command && key === 'f') {
      event.preventDefault();
      action('focus-search');
      return;
    }
    if (command && key === 's') {
      event.preventDefault();
      saveLibrary()
        .then((saved) => { if (saved) showToast('Archive saved.', 'success'); })
        .catch((error) => showToast(readableError(error, 'The archive could not be saved.'), 'info'));
      return;
    }
    if (command && key === 'd') {
      event.preventDefault();
      duplicateSelectedCharacter();
      return;
    }
    if (command && key === 'e') {
      event.preventDefault();
      exportCollection();
      return;
    }
    if (event.key === 'F2') {
      event.preventDefault();
      showManageModal();
      return;
    }
    if (event.key === 'Delete' && !editingText && !state.modal) {
      event.preventDefault();
      if (state.galleryBatchMode) showGalleryBatchDeleteConfirmation();
      else if (state.batchMode) showBatchDeleteConfirmation();
      else if (state.focusContext === 'collection') showDeleteGalleryConfirmation();
      else if (state.focusContext === 'variant' && state.selectedVariantIndex !== null) showDeleteVariantConfirmation();
      else showDeleteConfirmation();
      return;
    }
    if (event.key === 'Enter' && document.activeElement?.dataset.action === 'save-dna') {
      event.preventDefault();
      runModalAction('save-dna');
      return;
    }
    const confirmationAction = state.modal && [
      'confirm-delete-gallery',
      'confirm-delete-gallery-batch',
      'confirm-paste-dna',
      'confirm-delete-batch',
      'confirm-delete-variant',
      'confirm-delete',
    ].find((actionName) => document.querySelector(`[data-action="${actionName}"]`));
    if (event.key === 'Enter' && confirmationAction) {
      event.preventDefault();
      runModalAction(confirmationAction);
      return;
    }
    if (event.key === 'Escape') {
      if (state.modal) { state.modal = null; state.cropSession = null; state.pendingPortraitSource = null; state.pendingDnaSource = null; state.dnaHistory = null; state.focusDnaSave = false; state.transferCharacterIds = []; render('modal'); restoreSelectionFocus(); }
      else if (state.activeMenu) { state.activeMenu = null; render('chrome'); }
      else if (state.contextMenu) { state.contextMenu = null; render('context'); }
      else if (state.filterPanelOpen) { state.filterPanelOpen = false; render(); }
      else if (state.sortMenuOpen) { state.sortMenuOpen = false; render(); focusWithoutScroll(document.querySelector('[data-action="sort-menu"]')); }
      else if (state.batchMode) cancelBatchSelection();
      else if (state.galleryBatchMode) cancelGalleryBatchSelection();
    }
  });
}

function installClipboardPasteHandler() {
  document.addEventListener('paste', (event) => {
    if (state.cropSession) return;
    const items = [...(event.clipboardData?.items || [])];
    const files = [...(event.clipboardData?.files || [])];
    const imageItem = items.find((item) => item.kind === 'file' && (item.type.startsWith('image/') || isSupportedImageFile(item.getAsFile()?.name || '')));
    const imageFile = imageItem?.getAsFile() || files.find((file) => file.type.startsWith('image/') || isSupportedImageFile(file.name));
    if (imageFile) {
      event.preventDefault();
      openClipboardFile(imageFile).catch(() => showToast('The clipboard image could not be decoded.', 'info'));
      return;
    }

    const uriItem = items.find((item) => item.type === 'text/uri-list');
    if (uriItem) {
      event.preventDefault();
      uriItem.getAsString((value) => {
        if (!desktop) return showToast('Clipboard portraits are only available in the desktop app.', 'info');
        void desktop.readImagePath(value)
          .then((source) => {
            if (source) openClipboardSource(source);
            else showToast('The copied file is not a supported image.', 'info');
          })
          .catch((error) => showToast(readableError(error, 'The copied image path could not be read.'), 'info'));
      });
    }
  });
}

async function openClipboardFile(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const dimensions = await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = reject;
    image.src = dataUrl;
  });
  openClipboardSource({ dataUrl, ...dimensions });
}

function openClipboardSource(source) {
  const character = getActiveCharacter();
  if (!character) return showCharacterModal(source);
  if (state.preview) return showToast('Start an empty gallery before adding your own portraits.', 'info');
  if (hasMaximumPortraits(character)) return showToast(`This character already has ${MAX_PORTRAIT_VARIANTS} portrait variants.`, 'info');
  showCropModal(source);
}

async function boot() {
  installEventDelegation();
  bindModalDelegation();
  installKeyboardShortcuts();
  installClipboardPasteHandler();
  desktop?.onPasteImage(() => { void pasteClipboardPortrait(); });
  let loaded = null;
  let loadError = null;
  try { loaded = desktop ? await desktop.load() : null; } catch (error) { loadError = error; }
  if (loaded?.galleries) {
    state.galleries = loaded.galleries.map((gallery) => ({ ...gallery, characters: gallery.characters.map(normalizedCharacter) }));
    state.dataDirectory = loaded.dataDirectory;
    state.activeGallery = state.galleries[0]?.name || 'Default';
    state.sort = gallerySortMode();
    if (!state.galleries.some((gallery) => gallery.characters.length)) {
      state.preview = true;
      state.galleries = [{ name: window.demoLibrary.name, characters: window.demoLibrary.characters.map((character) => ({ ...character, images: [] })) }];
      state.activeGallery = window.demoLibrary.name;
      state.sort = 'recent';
    }
  } else {
    state.preview = true;
    state.galleries = [{ name: window.demoLibrary.name, characters: window.demoLibrary.characters.map((character) => ({ ...character, images: [] })) }];
    state.activeGallery = window.demoLibrary.name;
  }
  const startupWarning = loaded?.warning || (loadError ? readableError(loadError, 'The archive could not be loaded. Start with a new archive or restore the data file.') : null);
  state.startupWarning = startupWarning || '';
  render();
  if (startupWarning) requestAnimationFrame(() => showToast(startupWarning, 'info'));
}

void boot().catch((error) => {
  console.error('Failed to initialize the renderer:', error);
  showToast(readableError(error, 'The application could not be initialized.'), 'info');
});
