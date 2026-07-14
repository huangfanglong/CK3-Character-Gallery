/* The renderer is deliberately dependency-light: the archive is fast, local, and keyboard-friendly. */
const desktop = window.galleryDesktop;

const state = {
  galleries: [],
  activeGallery: 'Default',
  activeId: null,
  focusContext: 'character',
  selectedVariantIndex: null,
  imageUrls: new Map(),
  query: '',
  filters: { dna: 'all', favorites: false, tags: new Set() },
  filterPanelOpen: false,
  sortMenuOpen: false,
  sort: 'recent',
  view: 'cards',
  preview: false,
  imageDirectory: '',
  dataDirectory: '',
  startupWarning: '',
  modal: null,
  importFolder: null,
  activeMenu: null,
  cropSession: null,
  pendingPortraitSource: null,
  pendingDnaSource: null,
  dnaHistory: null,
  focusDnaSave: false,
  batchMode: false,
  selectedCharacterIds: new Set(),
  contextMenu: null,
  saved: false,
  favorites: new Set(JSON.parse(localStorage.getItem('ck3-favorites') || '[]')),
};

const app = document.querySelector('#app');

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
  return ['recent', 'custom', 'name', 'oldest'].includes(gallery?.sortMode)
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

function chromeMarkup() {
  const menuItems = {
    file: [
      ['new-character', 'New character', 'Ctrl+N'],
      ['new-gallery', 'New collection', ''],
      ['rename-gallery', 'Rename collection', ''],
      ['delete-gallery', 'Delete collection', ''],
      ['divider'],
      ['import', 'Import collection…', ''],
      ['export', 'Export collection…', ''],
      ['open-folder', 'Open archive folder', ''],
      ['save-library', 'Save archive', 'Ctrl+S'],
      ['divider'],
      ['exit', 'Exit', 'Alt+F4'],
    ],
    edit: [
      ['undo-dna', 'Undo DNA edit', 'Ctrl+Z'],
      ['redo-dna', 'Redo DNA edit', 'Ctrl+Y'],
      ['batch-select', 'Select multiple characters', 'Ctrl+Click'],
      ['focus-search', 'Find a character', 'Ctrl+F'],
      ['paste-portrait', 'Paste portrait from clipboard', 'Ctrl+V'],
      ['manage-record', 'Manage selected record', ''],
      ['edit-note', 'Edit notes', ''],
      ['open-dna', 'Open DNA workbench', ''],
    ],
    view: [
      ['view-cards', 'Portrait cards', ''],
      ['view-table', 'Compact list', ''],
    ],
    help: [
      ['help-hint', 'New character', 'Ctrl+N'],
      ['help-hint', 'Find character', 'Ctrl+F'],
      ['help-hint', 'Save archive', 'Ctrl+S'],
      ['help-hint', 'Duplicate character', 'Ctrl+D'],
      ['help-hint', 'Export collection', 'Ctrl+E'],
      ['help-hint', 'Paste portrait or DNA', 'Ctrl+V'],
      ['help-hint', 'Copy selected DNA', 'Ctrl+C'],
      ['help-hint', 'Undo / redo DNA', 'Ctrl+Z / Ctrl+Y'],
      ['help-hint', 'Manage record', 'F2'],
      ['help-hint', 'Add to selection', 'Ctrl+Click'],
      ['help-hint', 'Delete selection', 'Delete'],
    ],
  };
  const menu = state.activeMenu;
  const popover = menu ? `<div class="chrome-menu" data-menu-popover="${menu}">${menuItems[menu].map(([actionName, label, shortcut]) => actionName === 'divider'
    ? '<div class="chrome-menu-divider"></div>'
    : `<button data-action="${actionName}"><span>${label}</span>${shortcut ? `<kbd>${shortcut}</kbd>` : ''}</button>`).join('')}</div>` : '';
  return `<header class="window-chrome">
    <div class="chrome-title"><span class="chrome-seal">III</span><strong>The Bloodline Index</strong></div>
    <nav class="chrome-nav"><button class="${menu === 'file' ? 'active' : ''}" data-menu="file">File</button><button class="${menu === 'edit' ? 'active' : ''}" data-menu="edit">Edit</button><button class="${menu === 'view' ? 'active' : ''}" data-menu="view">View</button><button class="${menu === 'help' ? 'active' : ''}" data-menu="help">Help</button></nav>
    <div class="chrome-drag-region"></div>${popover}
  </header>`;
}

function contextMenuMarkup() {
  const menu = state.contextMenu;
  if (!menu) return '';
  const character = menu.type === 'character'
    ? getCharacters().find((item) => item.id === menu.id)
    : null;
  const heading = menu.type === 'collection' ? menu.name : character?.name;
  const items = menu.type === 'collection'
    ? [
      ['rename', icon('edit'), 'Rename'],
      ['duplicate', icon('copy'), 'Duplicate'],
      ['divider'],
      ['delete', icon('trash'), 'Delete', 'danger'],
    ]
    : [
      ['manage', icon('edit'), 'Manage record'],
      ['favorite', icon('star'), state.favorites.has(menu.id) ? 'Remove favorite' : 'Add favorite'],
      ['divider'],
      ['copy-dna', icon('copy'), 'Copy DNA'],
      ['paste-dna', icon('download'), 'Paste DNA'],
      ['duplicate', icon('copy'), 'Duplicate'],
      ['divider'],
      ['delete', icon('trash'), 'Delete', 'danger'],
    ];
  return `<div class="context-menu" role="menu" style="left:${menu.x}px;top:${menu.y}px"><p>${escapeHtml(heading || '')}</p>${items.map(([actionName, itemIcon, label, className]) => actionName === 'divider'
    ? '<div class="context-menu-divider"></div>'
    : `<button class="${className || ''}" data-context-action="${actionName}" role="menuitem">${itemIcon}<span>${label}</span></button>`).join('')}</div>`;
}

function cardMarkup(character, index, reorderable = false) {
  const favorite = state.favorites.has(character.id);
  const selected = !state.batchMode && state.activeId === character.id;
  const batchSelected = state.selectedCharacterIds.has(character.id);
  const variantCount = character.images?.length || (state.preview ? character.variants || 0 : 0);
  const coverIndex = coverVariantIndex(character);
  return `<article class="character-card ${selected ? 'selected' : ''} ${state.batchMode ? 'batch-selectable' : ''} ${batchSelected ? 'batch-selected' : ''}" data-character-id="${escapeHtml(character.id)}" tabindex="0"${state.batchMode ? ` aria-pressed="${batchSelected}"` : ''}${reorderable ? ' draggable="true"' : ''}>
    <div class="card-portrait">${portraitMarkup(character, 'card', coverIndex)}
      ${state.batchMode ? `<span class="batch-check">${batchSelected ? icon('check') : ''}</span>` : ''}
      <div class="card-topline"><span class="status-dot ${character.status}"></span>${character.status === 'ready' ? 'DNA READY' : 'DRAFT'}<button class="icon-button favorite ${favorite ? 'active' : ''}" data-action="favorite" title="${favorite ? 'Remove from favorites' : 'Add to favorites'}">${icon('star')}</button></div>
      <div class="card-index">${String(index + 1).padStart(2, '0')}</div>
      ${variantCount > 1 ? `<div class="card-bottom"><div class="card-cycle"><button data-cycle-portrait="-1" title="Previous cover portrait" aria-label="Previous cover portrait">‹</button><span>${coverIndex + 1}/${variantCount}</span><button data-cycle-portrait="1" title="Next cover portrait" aria-label="Next cover portrait">›</button></div></div>` : ''}
    </div>
    <div class="card-info"><div><h3>${escapeHtml(character.name)}</h3>${character.title ? `<p>${escapeHtml(character.title)}</p>` : ''}</div><button class="more-button" data-action="more" title="More actions">${icon('more')}</button></div>
    <div class="tag-row">${character.tags.slice(0, 3).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}${character.tags.length > 3 ? `<span class="tag muted">+${character.tags.length - 3}</span>` : ''}</div>
  </article>`;
}

function tableMarkup(character) {
  const favorite = state.favorites.has(character.id);
  const batchSelected = state.selectedCharacterIds.has(character.id);
  const coverIndex = coverVariantIndex(character);
  const preview = imageUrlFor(character, coverIndex)
    ? `<span class="table-portrait-preview" aria-hidden="true">${portraitMarkup(character, 'list-preview', coverIndex)}</span>`
    : '';
  return `<button class="table-row ${!state.batchMode && state.activeId === character.id ? 'selected' : ''} ${state.batchMode ? 'batch-selectable' : ''} ${batchSelected ? 'batch-selected' : ''}" data-character-id="${escapeHtml(character.id)}"${state.batchMode ? ` aria-pressed="${batchSelected}"` : ''}>
    <span class="table-avatar">${portraitMarkup(character, 'mini', coverIndex)}${preview}</span><span class="table-name"><strong>${escapeHtml(character.name)}</strong>${character.title ? `<small>${escapeHtml(character.title)}</small>` : ''}</span>
    <span class="table-tags">${character.tags.slice(0, 2).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</span><span class="table-status ${character.status}">${character.status === 'ready' ? icon('check') + ' ready' : 'draft'}</span><span class="table-favorite ${favorite ? 'active' : ''}">${icon('star')}</span>
  </button>`;
}

function sidebarMarkup(galleries) {
  const allCount = galleries.reduce((sum, gallery) => sum + gallery.characters.length, 0);
  const favoriteCount = [...state.favorites].filter((id) => galleries.some((gallery) => gallery.characters.some((character) => character.id === id))).length;
  return `<aside class="sidebar">
    <div class="brand"><div class="brand-seal">III</div><div><span>CRUSADER KINGS</span><strong>Bloodline<br/>Index</strong></div></div>
    <div class="sidebar-rule"></div>
    <button class="new-record" data-action="new-character">${icon('plus')} <span>New character</span><kbd>⌘ N</kbd></button>
    <nav class="library-nav"><p class="nav-label">LIBRARY</p>
      <button class="nav-item ${activeFilterCount() === 0 ? 'active' : ''}" data-filter="all"><span class="nav-symbol">◈</span><span>All characters</span><b>${allCount}</b></button>
      <button class="nav-item ${state.filters.favorites ? 'active' : ''}" data-filter="favorites"><span class="nav-symbol">☆</span><span>Favorites</span><b>${favoriteCount}</b></button>
      <button class="nav-item ${state.filters.dna === 'ready' ? 'active' : ''}" data-filter="ready"><span class="nav-symbol">◌</span><span>DNA ready</span></button>
      <button class="nav-item ${state.filters.dna === 'drafts' ? 'active' : ''}" data-filter="drafts"><span class="nav-symbol">◍</span><span>Needs DNA</span></button>
    </nav>
    <nav class="collection-nav"><div class="nav-heading"><p class="nav-label">COLLECTIONS</p><div class="collection-actions"><button class="text-icon" data-action="rename-gallery" title="Rename selected collection"${state.preview ? ' disabled' : ''}>${icon('edit')}</button><button class="text-icon" data-action="delete-gallery" title="Delete selected collection"${state.preview ? ' disabled' : ''}>${icon('trash')}</button><button class="text-icon" data-action="new-gallery" title="New collection">${icon('plus')}</button></div></div>
      ${galleries.map((gallery) => `<button class="collection-item ${state.activeGallery === gallery.name ? 'active' : ''}" data-gallery="${escapeHtml(gallery.name)}"${galleries.length > 1 && !state.preview ? ' draggable="true"' : ''}><span class="collection-dot"></span><span>${escapeHtml(gallery.name)}</span><b>${gallery.characters.length}</b></button>`).join('')}
    </nav>
    <div class="sidebar-bottom"><button class="utility-link" data-action="import"><span>＋</span> Import collection</button><button class="utility-link" data-action="export"><span>↗</span> Export collection</button><div class="storage-note"><span class="pulse"></span><span>Local archive<br/><b>@huangfanglong</b></span></div></div>
  </aside>`;
}

function inspectorMarkup(character) {
  if (!character) return `<aside class="inspector empty-inspector"><div class="inspector-empty-mark">◌</div><p class="eyebrow">NO RECORD SELECTED</p><p>Choose a portrait from the archive to inspect.</p><button class="outline-button" data-action="new-character">${icon('plus')} New character</button></aside>`;
  const favorite = state.favorites.has(character.id);
  const variantCount = character.images?.length || (state.preview ? character.variants || 0 : 0);
  const viewedVariant = state.selectedVariantIndex !== null && state.selectedVariantIndex < variantCount
    ? state.selectedVariantIndex
    : coverVariantIndex(character);
  return `<aside class="inspector"><div class="inspector-scroll">
    <div class="inspector-head"><div><p class="eyebrow">CHARACTER</p><span class="inspector-id">${escapeHtml(character.id.slice(0, 8).toUpperCase())}</span></div><div class="inspector-actions"><button class="icon-button ${favorite ? 'active' : ''}" data-action="favorite" title="Favorite">${icon('star')}</button><button class="icon-button" data-action="close-inspector" title="Close inspector">${icon('close')}</button></div></div>
    <div class="inspector-portrait">${portraitMarkup(character, 'large', viewedVariant)}<div class="portrait-caption"><span>${variantCount} VARIANTS</span><span>${character.status === 'ready' ? 'DNA READY' : 'DNA DRAFT'}</span></div></div>
    <div class="inspector-title"><div><h2>${escapeHtml(character.name)}</h2><input id="character-title" value="${escapeHtml(character.title)}" placeholder="..." aria-label="Character title" /></div><button class="text-icon" data-action="more">${icon('more')}</button></div>
    <div class="inspector-tags">${characterTags(character).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>
    <div class="variant-strip"><div class="variant-heading"><span>PORTRAIT VARIANTS</span><button data-action="add-variant">${icon('plus')} Add</button></div><div class="variant-row">${variantCount ? Array.from({ length: variantCount }, (_, index) => `<button class="variant-thumb ${state.focusContext === 'variant' && state.selectedVariantIndex === index ? 'selected' : ''}" data-variant="${index}" aria-label="Select portrait variant ${index + 1}">${portraitMarkup(character, 'thumb', index)}<span>${String(index + 1).padStart(2, '0')}</span></button>`).join('') : '<p class="variant-empty">No portrait variants yet</p>'}</div></div>
    <div class="inspector-section"><div class="section-heading"><span>NOTES</span><button class="note-edit-button" data-action="edit-note" title="Edit notes" aria-label="Edit notes">${icon('edit')}</button></div><button class="field-note" data-action="edit-note" title="Edit notes">${character.note ? highlightedNoteMarkup(character.note) : 'Add notes or #tags.'}</button></div></div>
    <div class="inspector-footer"><button class="outline-button" data-action="copy-dna">${icon('copy')} Copy DNA</button><button class="primary-button" data-action="open-dna">Open workbench ${icon('arrow')}</button></div>
  </aside>`;
}

function mainMarkup(characters) {
  const queryLabel = state.query ? `Results for “${escapeHtml(state.query)}”` : state.preview ? 'A visual sample library' : 'Your personal character archive';
  const filterCount = activeFilterCount();
  return `<main class="main-content"><header class="topbar"><div class="breadcrumbs"><span>THE ARCHIVE</span><i>/</i><strong>${escapeHtml(state.activeGallery)}</strong></div><div class="top-actions"><button class="top-action" data-action="import">${icon('download')} Import</button><button class="top-action" data-action="export">${icon('arrow')} Export</button></div></header>
    ${state.startupWarning ? `<div class="archive-warning" role="status">${icon('warning')}<span>${escapeHtml(state.startupWarning)}</span></div>` : ''}
    ${state.preview ? `<div class="preview-banner"><span><b>PREVIEW COLLECTION</b> This is a visual sample of the new archive experience.</span><button data-action="start-blank">Start with an empty gallery ${icon('arrow')}</button></div>` : ''}
    <section class="archive-heading"><div><p class="eyebrow">${state.preview ? 'DESIGN PREVIEW' : 'CHARACTER ARCHIVE'}</p><h1>${escapeHtml(state.activeGallery)}</h1><p class="heading-subtitle">${queryLabel}</p></div><div class="archive-stats"><div><strong>${getCharacters().length}</strong><span>in collection</span></div><div class="stat-line"></div><div class="view-toggle"><button class="${state.view === 'cards' ? 'active' : ''}" data-view="cards" title="Card view">${icon('grid')}</button><button class="${state.view === 'table' ? 'active' : ''}" data-view="table" title="List view">${icon('list')}</button></div></div></section>
    <div class="toolbar"><div class="search-box">${icon('search')}<input id="search-input" value="${escapeHtml(state.query)}" placeholder="Search a name, title, or tag…" /><kbd>⌘ F</kbd></div><div class="filter-control"><button class="filter-button ${state.filterPanelOpen ? 'active' : ''}" data-action="filters" aria-expanded="${state.filterPanelOpen}" aria-controls="filter-panel">${icon('sliders')} Filters${filterCount ? `<span class="filter-count">${filterCount}</span>` : ''}</button>${state.filterPanelOpen ? filterPanelMarkup(characters.length) : ''}</div>${sortControlMarkup()}</div>
    <div class="filter-row"><button class="filter-chip ${filterCount === 0 ? 'active' : ''}" data-filter="all">All faces</button><button class="filter-chip ${state.filters.dna === 'ready' ? 'active' : ''}" data-filter="ready">DNA ready</button><button class="filter-chip ${state.filters.dna === 'drafts' ? 'active' : ''}" data-filter="drafts">Needs DNA</button><span class="filter-rule"></span><span class="results-note">${characters.length ? `Showing ${characters.length} of ${getCharacters().length}` : 'No matching records'}</span>${state.batchMode ? `<div class="batch-toolbar"><button data-action="select-all-visible">Select shown</button><span>${state.selectedCharacterIds.size} selected</span><button class="batch-delete" data-action="delete-batch"${state.selectedCharacterIds.size ? '' : ' disabled'}>Delete selected</button><button data-action="cancel-batch">Cancel</button></div>` : `<button class="batch-start" data-action="batch-select"${characters.length && !state.preview ? '' : ' disabled'}>${icon('check')} Select multiple</button>`}</div>
    ${state.view === 'cards' ? `<section class="card-grid">${characters.length ? characters.map((character, index) => cardMarkup(character, index, characters.length > 1 && !state.preview && !state.batchMode)).join('') : emptyResultsMarkup()}</section>` : `<section class="table-view"><div class="table-header"><span>PORTRAIT</span><span>CHARACTER</span><span>TAGS</span><span>STATUS</span><span></span></div>${characters.length ? characters.map(tableMarkup).join('') : emptyResultsMarkup()}</section>`}
    <footer class="archive-footer"><span><span class="keyboard-dot"></span> Tip: paste an in-game screenshot anywhere to add a portrait</span><span>LOCAL ARCHIVE <b>·</b> v3.0 preview</span></footer>
  </main>`;
}

function sortControlMarkup() {
  const options = [
    ['recent', 'Recently modified'],
    ['custom', 'Custom'],
    ['name', 'Name A-Z'],
    ['oldest', 'Oldest first'],
  ];
  const selectedLabel = options.find(([value]) => value === state.sort)?.[1] || options[0][1];
  return `<div class="sort-control"><button class="sort-select ${state.sortMenuOpen ? 'active' : ''}" data-action="sort-menu" data-sort-value="${state.sort}" aria-haspopup="listbox" aria-expanded="${state.sortMenuOpen}" aria-controls="sort-menu"><span>Sort by</span><strong>${selectedLabel}</strong>${icon('chevron')}</button>${state.sortMenuOpen ? `<div class="sort-menu" id="sort-menu" role="listbox" aria-label="Sort characters">${options.map(([value, label]) => `<button class="${state.sort === value ? 'selected' : ''}" data-sort="${value}" role="option" aria-selected="${state.sort === value}"><span>${label}</span>${state.sort === value ? icon('check') : ''}</button>`).join('')}</div>` : ''}</div>`;
}

function filterPanelMarkup(matchCount) {
  const tags = availableTags();
  return `<section class="filter-panel" id="filter-panel" aria-label="Archive filters">
    <div class="filter-panel-head"><span>FILTER ARCHIVE</span><button data-action="clear-filters"${activeFilterCount() ? '' : ' disabled'}>Clear all</button></div>
    <div class="filter-group"><span class="filter-label">DNA STATUS</span><div class="filter-segments" role="group" aria-label="DNA status"><button class="${state.filters.dna === 'all' ? 'active' : ''}" data-dna-filter="all">Any</button><button class="${state.filters.dna === 'ready' ? 'active' : ''}" data-dna-filter="ready">Ready</button><button class="${state.filters.dna === 'drafts' ? 'active' : ''}" data-dna-filter="drafts">Needs DNA</button></div></div>
    <div class="filter-group"><span class="filter-label">RECORD</span><label class="filter-toggle"><input type="checkbox" data-favorite-filter${state.filters.favorites ? ' checked' : ''}/><span class="filter-checkbox">${state.filters.favorites ? icon('check') : ''}</span><span>Favorites only</span></label></div>
    <div class="filter-group filter-tag-group"><span class="filter-label">TAGS</span><div class="filter-tag-list">${tags.length ? tags.map((tag) => `<label class="filter-tag-option ${state.filters.tags.has(tag) ? 'active' : ''}"><input type="checkbox" data-filter-tag value="${escapeHtml(tag)}"${state.filters.tags.has(tag) ? ' checked' : ''}/><span>#${escapeHtml(tag)}</span></label>`).join('') : '<p>No tags in this collection</p>'}</div></div>
    <div class="filter-panel-foot"><span>${matchCount} match${matchCount === 1 ? '' : 'es'}</span><button data-action="close-filters">Done</button></div>
  </section>`;
}

function emptyResultsMarkup() {
  return `<div class="empty-results"><span>⌁</span><h2>No faces found</h2><p>Try another name or clear the filters.</p><button class="outline-button" data-action="clear-search">Clear search and filters</button></div>`;
}

function render() {
  const scrollPositions = [
    ['.main-content', app.querySelector('.main-content')],
    ['.sidebar', app.querySelector('.sidebar')],
    ['.inspector-scroll', app.querySelector('.inspector-scroll')],
  ].map(([selector, element]) => ({ selector, top: element?.scrollTop || 0, left: element?.scrollLeft || 0 }));
  const characters = visibleCharacters();
  app.innerHTML = `${chromeMarkup()}<div class="app-shell">${sidebarMarkup(state.galleries)}${mainMarkup(characters)}${inspectorMarkup(getActiveCharacter())}</div>${state.modal || ''}${contextMenuMarkup()}`;
  scrollPositions.forEach(({ selector, top, left }) => {
    const element = app.querySelector(selector);
    if (element) { element.scrollTop = top; element.scrollLeft = left; }
  });
  bindEvents();
  if (state.focusDnaSave) focusWithoutScroll(app.querySelector('[data-action="save-dna"]'));
  updateImageUrls();
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
    state.imageUrls.set(character.id, await Promise.all(paths.map((imagePath) => desktop.imageUrl(imagePath))));
    changed = true;
  }
  if (changed) render();
}

function bindEvents() {
  app.querySelector('.main-content')?.addEventListener('click', (event) => {
    const blankArchiveSpace = event.target.classList.contains('main-content')
      || event.target.classList.contains('card-grid')
      || event.target.classList.contains('table-view');
    if (blankArchiveSpace && state.activeId) {
      state.activeId = null;
      state.focusContext = 'character';
      state.selectedVariantIndex = null;
      render();
    }
  });
  app.querySelectorAll('[data-character-id]').forEach((element) => {
    element.addEventListener('click', (event) => {
      if (event.target.closest('[data-action="favorite"]')) return toggleFavorite(element.dataset.characterId);
      if (event.target.closest('[data-cycle-portrait]')) return;
      if (state.batchMode || event.ctrlKey || event.metaKey) return toggleBatchSelection(element.dataset.characterId, event.ctrlKey || event.metaKey);
      state.activeId = element.dataset.characterId;
      state.focusContext = 'character';
      state.selectedVariantIndex = null;
      render();
      restoreSelectionFocus();
    });
    element.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        if (state.batchMode || event.ctrlKey || event.metaKey) return toggleBatchSelection(element.dataset.characterId, event.ctrlKey || event.metaKey);
        state.activeId = element.dataset.characterId; state.focusContext = 'character'; state.selectedVariantIndex = null; render(); restoreSelectionFocus();
      }
    });
    element.addEventListener('contextmenu', (event) => {
      if (state.batchMode || state.preview) return;
      event.preventDefault();
      state.activeId = element.dataset.characterId;
      state.focusContext = 'character';
      state.selectedVariantIndex = null;
      openContextMenu(event, { type: 'character', id: element.dataset.characterId });
    });
  });
  bindCardDragAndDrop();
  bindTablePortraitPreviews();
  app.querySelectorAll('[data-action="favorite"]').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation();
    if (state.batchMode) return;
    toggleFavorite(button.closest('[data-character-id]')?.dataset.characterId || state.activeId);
  }));
  app.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => {
    const filter = button.dataset.filter;
    if (filter === 'all') clearFilters(false);
    if (filter === 'favorites') state.filters.favorites = !state.filters.favorites;
    if (filter === 'ready' || filter === 'drafts') state.filters.dna = state.filters.dna === filter ? 'all' : filter;
    state.filterPanelOpen = false;
    render();
  }));
  app.querySelectorAll('[data-gallery]').forEach((button) => button.addEventListener('click', () => {
    state.activeGallery = button.dataset.gallery; state.activeId = null; state.focusContext = 'character'; state.selectedVariantIndex = null; clearFilters(false); state.filterPanelOpen = false; state.sort = gallerySortMode(); cancelBatchSelection(false); render();
  }));
  app.querySelectorAll('[data-gallery]').forEach((button) => button.addEventListener('contextmenu', (event) => {
    if (state.preview) return;
    event.preventDefault();
    state.activeGallery = button.dataset.gallery; state.activeId = null; state.focusContext = 'character'; state.selectedVariantIndex = null; clearFilters(false); state.filterPanelOpen = false; state.sort = gallerySortMode(); cancelBatchSelection(false);
    openContextMenu(event, { type: 'collection', name: button.dataset.gallery });
  }));
  bindCollectionDragAndDrop();
  app.querySelectorAll('[data-variant]').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation();
    state.focusContext = 'variant';
    state.selectedVariantIndex = Number(button.dataset.variant);
    render();
    focusWithoutScroll(document.querySelector(`[data-variant="${state.selectedVariantIndex}"]`));
  }));
  app.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => { state.view = button.dataset.view; render(); }));
  app.querySelectorAll('[data-cycle-portrait]').forEach((button) => button.addEventListener('click', (event) => {
    event.stopImmediatePropagation();
    if (state.batchMode) return;
    const characterId = button.closest('[data-character-id]')?.dataset.characterId;
    cycleCardPortrait(characterId, Number(button.dataset.cyclePortrait));
  }));
  app.querySelectorAll('[data-menu]').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation(); state.activeMenu = state.activeMenu === button.dataset.menu ? null : button.dataset.menu; render();
  }));
  app.querySelectorAll('[data-action="more"]').forEach((button) => button.addEventListener('click', (event) => {
    event.stopImmediatePropagation();
    if (state.batchMode) return;
    state.activeId = button.closest('[data-character-id]')?.dataset.characterId || state.activeId;
    state.focusContext = 'character';
    state.selectedVariantIndex = null;
    showManageModal();
  }));
  app.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => action(button.dataset.action)));
  app.querySelectorAll('[data-context-action]').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation();
    handleContextAction(button.dataset.contextAction);
  }));
  const search = document.querySelector('#search-input');
  search?.addEventListener('input', () => { state.query = search.value; render(); requestAnimationFrame(() => { const input = document.querySelector('#search-input'); input.focus(); input.setSelectionRange(input.value.length, input.value.length); }); });
  app.querySelectorAll('[data-dna-filter]').forEach((button) => button.addEventListener('click', () => {
    state.filters.dna = button.dataset.dnaFilter;
    render();
  }));
  document.querySelector('[data-favorite-filter]')?.addEventListener('change', (event) => {
    state.filters.favorites = event.target.checked;
    render();
  });
  app.querySelectorAll('[data-filter-tag]').forEach((input) => input.addEventListener('change', () => {
    const tag = input.value.toLowerCase();
    if (input.checked) state.filters.tags.add(tag); else state.filters.tags.delete(tag);
    render();
  }));
  app.querySelectorAll('[data-sort]').forEach((button) => button.addEventListener('click', () => setSortMode(button.dataset.sort)));
  app.querySelectorAll('[data-sort]').forEach((button) => button.addEventListener('keydown', (event) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const options = [...document.querySelectorAll('[data-sort]')];
    const index = options.indexOf(button);
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? options.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    options[next]?.focus();
  }));
  document.querySelector('#dna-input')?.addEventListener('input', (event) => {
    updateDnaCount();
    recordDnaHistory(event.target.value);
  });
  const noteInput = document.querySelector('#note-input');
  noteInput?.addEventListener('input', () => updateNoteHighlights(noteInput));
  noteInput?.addEventListener('scroll', () => syncNoteHighlightScroll(noteInput));
  document.querySelector('.dna-modal')?.addEventListener('focusin', (event) => {
    if (event.target.dataset?.action !== 'save-dna') state.focusDnaSave = false;
  });
  const titleInput = document.querySelector('#character-title');
  titleInput?.addEventListener('change', () => saveCharacterTitle(titleInput.value));
  titleInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); titleInput.blur(); }
    if (event.key === 'Escape') { event.preventDefault(); titleInput.value = getActiveCharacter()?.title || ''; titleInput.blur(); }
  });
}

function openContextMenu(event, target) {
  state.activeMenu = null;
  state.sortMenuOpen = false;
  state.contextMenu = {
    ...target,
    x: Math.max(8, Math.min(event.clientX, window.innerWidth - 218)),
    y: Math.max(8, Math.min(event.clientY, window.innerHeight - (target.type === 'collection' ? 174 : 306))),
  };
  render();
}

function bindTablePortraitPreviews() {
  app.querySelectorAll('.table-avatar').forEach((avatar) => {
    const preview = avatar.querySelector('.table-portrait-preview');
    if (!preview) return;
    avatar.addEventListener('mouseenter', () => {
      const anchor = avatar.getBoundingClientRect();
      const width = preview.offsetWidth;
      const height = preview.offsetHeight;
      const right = anchor.right + 14;
      const left = right + width <= window.innerWidth - 12 ? right : Math.max(12, anchor.left - width - 14);
      const top = Math.max(46, Math.min(anchor.top + anchor.height / 2 - height / 2, window.innerHeight - height - 12));
      preview.style.left = `${left}px`;
      preview.style.top = `${top}px`;
      preview.classList.add('visible');
    });
    avatar.addEventListener('mouseleave', () => preview.classList.remove('visible'));
  });
}

async function handleContextAction(actionName) {
  const menu = state.contextMenu;
  state.contextMenu = null;
  if (!menu) return;
  if (menu.type === 'collection') {
    state.activeGallery = menu.name;
    if (actionName === 'rename') return showRenameGalleryModal();
    if (actionName === 'duplicate') return duplicateActiveGallery();
    if (actionName === 'delete') return showDeleteGalleryConfirmation();
  }
  if (menu.type === 'character') {
    state.activeId = menu.id;
    state.focusContext = 'character';
    state.selectedVariantIndex = null;
    if (actionName === 'manage') return showManageModal();
    if (actionName === 'favorite') return toggleFavorite(menu.id);
    if (actionName === 'copy-dna') return copyDna();
    if (actionName === 'paste-dna') return pasteDnaFromClipboard();
    if (actionName === 'duplicate') return duplicateSelectedCharacter();
    if (actionName === 'delete') return showDeleteConfirmation();
  }
  render();
}

function bindCardDragAndDrop() {
  const grid = app.querySelector('.card-grid');
  const cards = [...(grid?.querySelectorAll('.character-card[draggable="true"]') || [])];
  if (!grid || cards.length < 2) return;

  let draggedCard = null;
  let initialOrder = [];
  let committed = false;

  cards.forEach((card) => {
    card.addEventListener('dragstart', (event) => {
      if (event.target.closest('button')) {
        event.preventDefault();
        return;
      }
      draggedCard = card;
      initialOrder = cards.map((item) => item.dataset.characterId);
      committed = false;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', card.dataset.characterId);
      grid.classList.add('is-reordering');
      requestAnimationFrame(() => card.classList.add('dragging'));
    });

    card.addEventListener('dragend', () => {
      grid.classList.remove('is-reordering');
      card.classList.remove('dragging');
      if (draggedCard && !committed) render();
      draggedCard = null;
    });
  });

  grid.addEventListener('dragover', (event) => {
    if (!draggedCard) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const target = event.target.closest('.character-card');
    if (!target || target === draggedCard) return;
    const targetRect = target.getBoundingClientRect();
    const draggedRect = draggedCard.getBoundingClientRect();
    const sameRow = Math.abs(draggedRect.top - targetRect.top) < targetRect.height / 2;
    const insertAfter = sameRow
      ? event.clientX > targetRect.left + targetRect.width / 2
      : event.clientY > targetRect.top + targetRect.height / 2;
    grid.insertBefore(draggedCard, insertAfter ? target.nextElementSibling : target);
  });

  grid.addEventListener('drop', (event) => {
    if (!draggedCard) return;
    event.preventDefault();
    if (!event.target.closest('.character-card')) grid.appendChild(draggedCard);
    const orderedIds = [...grid.querySelectorAll('.character-card')].map((card) => card.dataset.characterId);
    if (orderedIds.some((id, index) => id !== initialOrder[index])) {
      committed = true;
      saveCustomCardOrder(orderedIds);
    } else {
      render();
    }
  });
}

function bindCollectionDragAndDrop() {
  const navigation = app.querySelector('.collection-nav');
  const items = [...(navigation?.querySelectorAll('.collection-item[draggable="true"]') || [])];
  if (!navigation || items.length < 2) return;
  let draggedItem = null;
  let initialOrder = [];
  let committed = false;

  items.forEach((item) => {
    item.addEventListener('dragstart', (event) => {
      draggedItem = item;
      initialOrder = items.map((entry) => entry.dataset.gallery);
      committed = false;
      state.contextMenu = null;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', item.dataset.gallery);
      navigation.classList.add('is-reordering');
      requestAnimationFrame(() => item.classList.add('dragging'));
    });
    item.addEventListener('dragend', () => {
      navigation.classList.remove('is-reordering');
      item.classList.remove('dragging');
      if (draggedItem && !committed) render();
      draggedItem = null;
    });
  });

  navigation.addEventListener('dragover', (event) => {
    if (!draggedItem) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const target = event.target.closest('.collection-item');
    if (!target || target === draggedItem) return;
    const rect = target.getBoundingClientRect();
    navigation.insertBefore(draggedItem, event.clientY > rect.top + rect.height / 2 ? target.nextElementSibling : target);
  });

  navigation.addEventListener('drop', (event) => {
    if (!draggedItem) return;
    event.preventDefault();
    if (!event.target.closest('.collection-item')) navigation.appendChild(draggedItem);
    const orderedNames = [...navigation.querySelectorAll('.collection-item')].map((item) => item.dataset.gallery);
    if (orderedNames.some((name, index) => name !== initialOrder[index])) {
      committed = true;
      saveCollectionOrder(orderedNames);
    } else render();
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
  state.sort = ['recent', 'custom', 'name', 'oldest'].includes(mode) ? mode : 'recent';
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

function toggleBatchSelection(id, allowStart = false) {
  if (!id || state.preview) return;
  if (!state.batchMode) {
    if (!allowStart) return;
    const activeId = state.activeId;
    state.batchMode = true;
    state.selectedCharacterIds.clear();
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
    focusWithoutScroll([...document.querySelectorAll('[data-character-id]')]
      .find((element) => element.dataset.characterId === state.activeId));
  }
}

function action(name) {
  state.activeMenu = null;
  if (name === 'new-character') return showCharacterModal();
  if (name === 'new-gallery') return showGalleryModal();
  if (name === 'rename-gallery') return showRenameGalleryModal();
  if (name === 'delete-gallery') return showDeleteGalleryConfirmation();
  if (name === 'batch-select') return startBatchSelection();
  if (name === 'cancel-batch') return cancelBatchSelection();
  if (name === 'select-all-visible') return selectAllVisibleCharacters();
  if (name === 'delete-batch') return showBatchDeleteConfirmation();
  if (name === 'close-inspector') { state.activeId = null; state.focusContext = 'character'; state.selectedVariantIndex = null; return render(); }
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
  if (name === 'save-library') return saveLibrary().then((saved) => { if (saved) showToast('Archive saved.', 'success'); });
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
    if (state.sortMenuOpen) requestAnimationFrame(() => document.querySelector('[data-sort][aria-selected="true"]')?.focus());
    return;
  }
  if (name === 'close-filters') { state.filterPanelOpen = false; return render(); }
  if (name === 'clear-filters') return clearFilters();
  if (name === 'clear-search') { state.query = ''; clearFilters(false); state.filterPanelOpen = false; render(); }
  if (name === 'start-blank') { state.preview = false; state.galleries = [{ name: 'Default', characters: [] }]; state.activeGallery = 'Default'; state.activeId = null; state.focusContext = 'character'; state.selectedVariantIndex = null; clearFilters(false); state.filterPanelOpen = false; state.sort = 'recent'; cancelBatchSelection(false); render(); }
}

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
  render(); document.querySelector('#modal-name')?.focus();
}

function showGalleryModal() {
  state.modal = `<div class="modal-backdrop"><div class="modal"><button class="modal-close" data-action="close-modal">${icon('close')}</button><p class="eyebrow">NEW COLLECTION</p><h2>Add a new collection</h2><label class="modal-label">Collection name<input id="modal-gallery-name" autofocus placeholder="e.g. The Baltic Court" /></label><div class="modal-actions"><button class="outline-button" data-action="close-modal">Cancel</button><button class="primary-button" data-action="create-gallery">Create collection ${icon('arrow')}</button></div></div></div>`;
  render(); document.querySelector('#modal-gallery-name')?.focus();
}

function showRenameGalleryModal() {
  const gallery = getGallery();
  if (!gallery || state.preview) return;
  state.modal = `<div class="modal-backdrop"><div class="modal"><button class="modal-close" data-action="close-modal">${icon('close')}</button><p class="eyebrow">RENAME COLLECTION</p><h2>Rename ${escapeHtml(gallery.name)}</h2><label class="modal-label">Collection name<input id="rename-gallery-name" value="${escapeHtml(gallery.name)}" /></label><div class="modal-actions"><button class="outline-button" data-action="close-modal">Cancel</button><button class="primary-button" data-action="confirm-rename-gallery">Save name ${icon('check')}</button></div></div></div>`;
  render(); document.querySelector('#rename-gallery-name')?.focus(); document.querySelector('#rename-gallery-name')?.select();
}

function showDeleteGalleryConfirmation() {
  const gallery = getGallery();
  if (!gallery || state.preview) return;
  if (state.galleries.length === 1) return showToast('The last collection cannot be deleted.', 'info');
  state.modal = `<div class="modal-backdrop"><div class="modal delete-modal"><p class="eyebrow">DELETE COLLECTION</p><h2>Remove ${escapeHtml(gallery.name)}?</h2><p class="modal-copy">This removes the collection and its ${gallery.characters.length} character record${gallery.characters.length === 1 ? '' : 's'}. This cannot be undone.</p><div class="modal-actions"><button class="outline-button" data-action="close-modal">Cancel</button><button class="danger-button" data-action="confirm-delete-gallery" autofocus>Delete collection</button></div><p class="dialog-shortcuts"><span>Enter to confirm</span><span>Esc to cancel</span></p></div></div>`;
  render(); document.querySelector('[data-action="confirm-delete-gallery"]')?.focus();
}

function showImportModal(folder, suggestedName = '') {
  state.importFolder = folder;
  state.modal = `<div class="modal-backdrop"><div class="modal"><button class="modal-close" data-action="close-modal">${icon('close')}</button><p class="eyebrow">IMPORT COLLECTION</p><h2>Bring in a court</h2><p class="modal-copy">Portraits, DNA, notes, and collection metadata will be copied into this archive. The original folder stays untouched.</p><label class="modal-label">Collection name<input id="modal-import-name" value="${escapeHtml(suggestedName)}" autofocus placeholder="e.g. House of Wessex" /></label><div class="modal-actions"><button class="outline-button" data-action="close-modal">Cancel</button><button class="primary-button" data-action="create-import">Import collection ${icon('arrow')}</button></div></div></div>`;
  render(); document.querySelector('#modal-import-name')?.focus();
}

function showDnaModal(initialDna = null, focusSave = false) {
  const character = getActiveCharacter();
  if (!character) return;
  const currentDna = character.dna || '';
  const dna = typeof initialDna === 'string' ? initialDna : currentDna;
  state.dnaHistory = dna === currentDna
    ? { entries: [currentDna], index: 0 }
    : { entries: [currentDna, dna], index: 1 };
  state.focusDnaSave = focusSave;
  state.modal = `<div class="modal-backdrop"><div class="dna-modal"><div class="modal-head"><div><p class="eyebrow">DNA WORKBENCH</p><h2>${escapeHtml(character.name)}</h2></div><button class="modal-close" data-action="close-modal">${icon('close')}</button></div><textarea id="dna-input" spellcheck="false">${escapeHtml(dna)}</textarea><div class="dna-footer"><span id="dna-count">Raw CK3 DNA · ${dna.length} characters</span><div class="dna-actions"><button class="outline-button" data-action="clear-dna">Clear DNA</button><button class="outline-button" data-action="homogenize-dna" title="Copy each first allele value and count into the second allele">Homogenize DNA</button><button class="primary-button" data-action="save-dna">Save DNA ${icon('check')}</button></div></div></div></div>`;
  render();
}

function hasBalancedBraces(text) {
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '"' && text[index - 1] !== '\\') quoted = !quoted;
    if (quoted) continue;
    if (text[index] === '{') depth += 1;
    if (text[index] === '}') depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

function isValidCk3Dna(value) {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (!text) return false;
  const plainTextDna = /^[\w.-]+\s*=\s*\{/.test(text)
    && /\bgenes\s*=\s*\{/.test(text)
    && /\b(?:hair_color|skin_color|eye_color|gene_[\w]+|face_detail_[\w]+)\s*=\s*\{/.test(text)
    && hasBalancedBraces(text);
  if (plainTextDna) return true;

  const compact = text.replace(/\s+/g, '');
  if (compact.length < 80 || compact.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return false;
  try {
    const decoded = atob(compact.padEnd(Math.ceil(compact.length / 4) * 4, '='));
    return decoded.length >= 60;
  } catch { return false; }
}

function openClipboardDna(value, confirmOverwrite = true) {
  const character = getActiveCharacter();
  const dna = typeof value === 'string' ? value.trim() : '';
  if (!isValidCk3Dna(dna)) return false;
  if (!character || state.preview) { showCharacterModal(null, dna); return true; }
  if (confirmOverwrite && character.dna?.trim()) { showDnaOverwriteConfirmation(dna); return true; }
  showDnaModal(dna, true);
  return true;
}

function pasteDnaFromClipboard(clipboardValue = null) {
  const dna = typeof clipboardValue === 'string' ? clipboardValue : desktop?.readClipboardText?.() || '';
  if (!isValidCk3Dna(dna)) return showToast('The clipboard does not contain valid CK3 DNA.', 'info');
  openClipboardDna(dna, true);
}

function homogenizeDna(text) {
  return text.replace(
    /(\b[\w_]+\s*=\s*\{\s*)("[^"]+"|\d+)\s+(\d+)\s+("[^"]+"|\d+)\s+(\d+)\s*(\})/g,
    '$1$2 $3 $2 $3 $6',
  );
}

function updateDnaCount() {
  const input = document.querySelector('#dna-input');
  const count = document.querySelector('#dna-count');
  if (input && count) count.textContent = `Raw CK3 DNA · ${input.value.length} characters`;
}

function recordDnaHistory(value) {
  const history = state.dnaHistory;
  if (!history || history.entries[history.index] === value) return;
  history.entries = history.entries.slice(0, history.index + 1);
  history.entries.push(value);
  if (history.entries.length > 100) history.entries.shift();
  history.index = history.entries.length - 1;
}

function setDnaEditorValue(value, record = true) {
  const input = document.querySelector('#dna-input');
  if (!input) return;
  const modal = input.closest('.dna-modal');
  const view = {
    inputTop: input.scrollTop,
    inputLeft: input.scrollLeft,
    modalTop: modal?.scrollTop || 0,
    start: input.selectionStart,
    end: input.selectionEnd,
  };
  input.value = value;
  if (record) recordDnaHistory(value);
  updateDnaCount();
  input.setSelectionRange(Math.min(view.start, value.length), Math.min(view.end, value.length));
  input.scrollTop = view.inputTop;
  input.scrollLeft = view.inputLeft;
  if (modal) modal.scrollTop = view.modalTop;
}

function undoDnaChange() {
  const history = state.dnaHistory;
  if (!document.querySelector('#dna-input') || !history || history.index < 1) return;
  history.index -= 1;
  setDnaEditorValue(history.entries[history.index], false);
}

function redoDnaChange() {
  const history = state.dnaHistory;
  if (!document.querySelector('#dna-input') || !history || history.index >= history.entries.length - 1) return;
  history.index += 1;
  setDnaEditorValue(history.entries[history.index], false);
}

function showNoteModal() {
  const character = getActiveCharacter();
  if (!character) return showToast('Choose a character before editing notes.', 'info');
  const note = character.note || '';
  const count = noteTags(note).length;
  state.modal = `<div class="modal-backdrop"><div class="note-modal"><div class="modal-head"><div><p class="eyebrow">NOTES</p><h2>${escapeHtml(character.name)}</h2></div><button class="modal-close" data-action="close-modal">${icon('close')}</button></div><p class="modal-copy">Write down mods, notes, bio, or add tags.</p><div class="note-editor"><div class="note-highlight" id="note-highlight" aria-hidden="true">${highlightedNoteMarkup(note)}</div><textarea id="note-input" spellcheck="true" placeholder="Add notes or #tags…" aria-describedby="note-tag-count">${escapeHtml(note)}</textarea></div><div class="note-footer"><span id="note-tag-count">${count} tag${count === 1 ? '' : 's'} recognized</span><button class="primary-button" data-action="save-note">Save notes ${icon('check')}</button></div></div></div>`;
  render();
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
  state.modal = `<div class="modal-backdrop"><div class="modal"><button class="modal-close" data-action="close-modal">${icon('close')}</button><p class="eyebrow">MANAGE RECORD</p><h2>${escapeHtml(character.name)}</h2><label class="modal-label">Character name<input id="manage-name" value="${escapeHtml(character.name)}" /></label><div class="manage-actions"><button class="danger-text" data-action="delete-character">Delete record</button><button class="outline-button" data-action="duplicate-character">Duplicate</button><button class="primary-button" data-action="rename-character">Save name ${icon('check')}</button></div></div></div>`;
  render();
}

function showDeleteConfirmation() {
  const character = getActiveCharacter();
  if (!character) return showToast('Select a character before deleting it.', 'info');
  state.modal = `<div class="modal-backdrop"><div class="modal delete-modal"><p class="eyebrow">DELETE CHARACTER</p><h2>Remove ${escapeHtml(character.name)}?</h2><p class="modal-copy">This removes the character record from the collection. Portrait files associated with it will no longer appear in the archive.</p><div class="modal-actions"><button class="outline-button" data-action="close-modal">Cancel</button><button class="danger-button" data-action="confirm-delete" autofocus>Delete character</button></div><p class="dialog-shortcuts"><span>Enter to confirm</span><span>Esc to cancel</span></p></div></div>`;
  render();
  document.querySelector('[data-action="confirm-delete"]')?.focus();
}

function showDeleteVariantConfirmation() {
  const character = getActiveCharacter();
  const index = state.selectedVariantIndex;
  if (!character || index === null || !character.images?.[index]) return;
  state.modal = `<div class="modal-backdrop"><div class="modal delete-modal"><p class="eyebrow">DELETE PORTRAIT VARIANT</p><h2>Remove portrait ${index + 1}?</h2><p class="modal-copy">This permanently removes the selected portrait from ${escapeHtml(character.name)}. The character record and its other variants will remain.</p><div class="modal-actions"><button class="outline-button" data-action="close-modal">Cancel</button><button class="danger-button" data-action="confirm-delete-variant" autofocus>Delete portrait</button></div><p class="dialog-shortcuts"><span>Enter to confirm</span><span>Esc to cancel</span></p></div></div>`;
  render();
  document.querySelector('[data-action="confirm-delete-variant"]')?.focus();
}

function showBatchDeleteConfirmation() {
  const count = state.selectedCharacterIds.size;
  if (!state.batchMode || !count) return;
  state.modal = `<div class="modal-backdrop"><div class="modal delete-modal"><p class="eyebrow">DELETE CHARACTERS</p><h2>Remove ${count} character${count === 1 ? '' : 's'}?</h2><p class="modal-copy">This removes the selected records from ${escapeHtml(state.activeGallery)}. This cannot be undone.</p><div class="modal-actions"><button class="outline-button" data-action="close-modal">Cancel</button><button class="danger-button" data-action="confirm-delete-batch" autofocus>Delete selected</button></div><p class="dialog-shortcuts"><span>Enter to confirm</span><span>Esc to cancel</span></p></div></div>`;
  render(); document.querySelector('[data-action="confirm-delete-batch"]')?.focus();
}

function showDnaOverwriteConfirmation(dna) {
  const character = getActiveCharacter();
  if (!character) return;
  state.pendingDnaSource = dna;
  state.modal = `<div class="modal-backdrop"><div class="modal delete-modal"><p class="eyebrow">REPLACE DNA</p><h2>Replace ${escapeHtml(character.name)}'s DNA?</h2><p class="modal-copy">This opens the clipboard DNA in the workbench. The current DNA is not replaced until you choose Save DNA.</p><div class="modal-actions"><button class="outline-button" data-action="close-modal">Cancel</button><button class="danger-button" data-action="confirm-paste-dna" autofocus>Replace in workbench</button></div><p class="dialog-shortcuts"><span>Enter to continue</span><span>Esc to cancel</span></p></div></div>`;
  render();
  document.querySelector('[data-action="confirm-paste-dna"]')?.focus();
}

async function handleModalAction(name) {
  if (name === 'close-modal') {
    state.modal = null;
    state.cropSession = null;
    state.pendingPortraitSource = null;
    state.pendingDnaSource = null;
    state.dnaHistory = null;
    state.focusDnaSave = false;
    render();
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
    getGallery().characters.push(character); state.activeId = character.id; state.focusContext = 'character'; state.selectedVariantIndex = null; state.modal = null; state.saved = false; cancelBatchSelection(false); render();
    if (!(await saveLibrary())) return;
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
    if (!nameValue || state.galleries.some((gallery) => gallery.name.toLowerCase() === nameValue.toLowerCase())) return input?.focus();
    state.galleries.push({ name: nameValue, characters: [] }); state.activeGallery = nameValue; state.activeId = null; state.focusContext = 'character'; state.selectedVariantIndex = null; clearFilters(false); state.filterPanelOpen = false; state.sort = 'recent'; state.modal = null; cancelBatchSelection(false); render(); if (await saveLibrary()) showToast('Collection created.', 'success');
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
    state.activeGallery = state.galleries[0].name; clearFilters(false); state.filterPanelOpen = false; state.sort = gallerySortMode(); state.activeId = null; state.focusContext = 'character'; state.selectedVariantIndex = null; state.modal = null; cancelBatchSelection(false); render();
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
  if (name === 'create-import') {
    const input = document.querySelector('#modal-import-name'); const nameValue = input?.value.trim();
    if (!nameValue || !state.importFolder || state.galleries.some((gallery) => gallery.name.toLowerCase() === nameValue.toLowerCase())) return input?.focus();
    try {
      const imported = await desktop.importGallery(state.importFolder, nameValue);
      state.galleries.push(imported); state.activeGallery = imported.name; state.activeId = null; state.focusContext = 'character'; state.selectedVariantIndex = null; clearFilters(false); state.filterPanelOpen = false; state.sort = gallerySortMode(imported); state.modal = null; state.importFolder = null; state.preview = false; cancelBatchSelection(false); render(); if (await saveLibrary()) showToast('Collection imported into the archive.', 'success');
    } catch (error) { showToast(readableError(error, 'The collection could not be imported.'), 'info'); }
  }
  if (name === 'save-dna') {
    const character = getActiveCharacter(); const input = document.querySelector('#dna-input'); if (character && input) { character.dna = input.value; character.modified = Date.now(); state.dnaHistory = null; state.focusDnaSave = false; state.modal = null; state.saved = false; render(); if (await saveLibrary()) showToast('DNA saved to the archive.', 'success'); }
  }
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
    gallery.characters = gallery.characters.filter((item) => item.id !== character.id); state.activeId = null; state.focusContext = 'character'; state.selectedVariantIndex = null; state.modal = null; render();
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
    state.activeId = null; state.focusContext = 'character'; state.selectedVariantIndex = null; state.modal = null; render();
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
  if ((character.images?.length || 0) >= 5) return showToast('This character already has five portrait variants.', 'info');
  try {
    const selected = await desktop.chooseImage(character.id); if (!selected) return;
    await appendPortrait(character, selected, 'Portrait variant added.');
  } catch (error) { showToast(readableError(error, 'The portrait could not be added.'), 'info'); }
}

async function pasteClipboardPortrait() {
  if (state.cropSession) return;
  if (!desktop) return showToast('Clipboard portraits are only available in the desktop app.', 'info');
  const source = await desktop.readClipboardImage();
  if (!source) return showToast('The clipboard does not contain an image.', 'info');
  const character = getActiveCharacter();
  if (!character) return showCharacterModal(source);
  if (state.preview) return showToast('Start an empty gallery before adding your own portraits.', 'info');
  if ((character.images?.length || 0) >= 5) return showToast('This character already has five portrait variants.', 'info');
  showCropModal(source);
}

function showCropModal(source) {
  state.pendingPortraitSource = null;
  state.cropSession = {
    dataUrl: source.dataUrl,
    sourceWidth: source.width,
    sourceHeight: source.height,
    viewport: 480,
    baseScale: 1,
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
  };
  state.modal = `<div class="modal-backdrop"><div class="crop-modal"><div class="modal-head"><div><p class="eyebrow">ADJUST IMAGE POSITION</p><h2>Compose the portrait</h2></div><button class="modal-close" data-action="close-modal">${icon('close')}</button></div><p class="modal-copy">Drag the image to position it inside the square. Use the slider or mouse wheel to zoom before adding it to the selected character.</p><div class="crop-stage" id="crop-stage"><img id="crop-source" src="${source.dataUrl}" alt="Clipboard portrait preview" draggable="false"/><div class="crop-grid"><span></span><span></span><span></span><span></span></div></div><div class="crop-controls"><button class="outline-button" data-action="crop-reset">Reset</button><label><span>Zoom</span><input id="crop-zoom" type="range" min="100" max="300" value="100"/><output id="crop-zoom-value">100%</output></label></div><div class="crop-footer"><span>Output: 450 × 450 PNG</span><div><button class="outline-button" data-action="close-modal">Cancel</button><button class="primary-button" data-action="save-crop">Use portrait ${icon('check')}</button></div></div></div></div>`;
  render();
  requestAnimationFrame(initializeCropInteraction);
}

function initializeCropInteraction() {
  const session = state.cropSession;
  const stage = document.querySelector('#crop-stage');
  const image = document.querySelector('#crop-source');
  const slider = document.querySelector('#crop-zoom');
  if (!session || !stage || !image || !slider) return;
  session.viewport = stage.clientWidth;
  session.baseScale = Math.max(session.viewport / session.sourceWidth, session.viewport / session.sourceHeight);
  resetCropPosition();

  let dragStart = null;
  stage.addEventListener('pointerdown', (event) => {
    dragStart = { x: event.clientX, y: event.clientY, offsetX: session.offsetX, offsetY: session.offsetY };
    stage.setPointerCapture(event.pointerId);
    stage.classList.add('dragging');
  });
  stage.addEventListener('pointermove', (event) => {
    if (!dragStart) return;
    session.offsetX = dragStart.offsetX + event.clientX - dragStart.x;
    session.offsetY = dragStart.offsetY + event.clientY - dragStart.y;
    clampCropOffset();
    applyCropTransform();
  });
  const stopDragging = () => { dragStart = null; stage.classList.remove('dragging'); };
  stage.addEventListener('pointerup', stopDragging);
  stage.addEventListener('pointercancel', stopDragging);
  const setZoom = (percentage) => {
    const nextPercentage = Math.max(Number(slider.min), Math.min(Number(slider.max), percentage));
    const previousScale = session.baseScale * session.zoom;
    const center = session.viewport / 2;
    session.zoom = nextPercentage / 100;
    const nextScale = session.baseScale * session.zoom;
    const ratio = nextScale / previousScale;
    session.offsetX = center - (center - session.offsetX) * ratio;
    session.offsetY = center - (center - session.offsetY) * ratio;
    clampCropOffset();
    applyCropTransform();
    slider.value = String(nextPercentage);
    document.querySelector('#crop-zoom-value').textContent = `${nextPercentage}%`;
  };
  slider.addEventListener('input', () => setZoom(Number(slider.value)));
  stage.addEventListener('wheel', (event) => {
    if (!event.deltaY) return;
    event.preventDefault();
    setZoom(Number(slider.value) + (event.deltaY < 0 ? 10 : -10));
  }, { passive: false });
}

function resetCropPosition() {
  const session = state.cropSession;
  if (!session) return;
  session.zoom = 1;
  const width = session.sourceWidth * session.baseScale;
  const height = session.sourceHeight * session.baseScale;
  session.offsetX = (session.viewport - width) / 2;
  session.offsetY = (session.viewport - height) / 2;
  const slider = document.querySelector('#crop-zoom');
  if (slider) slider.value = '100';
  const output = document.querySelector('#crop-zoom-value');
  if (output) output.textContent = '100%';
  applyCropTransform();
}

function clampCropOffset() {
  const session = state.cropSession;
  if (!session) return;
  const width = session.sourceWidth * session.baseScale * session.zoom;
  const height = session.sourceHeight * session.baseScale * session.zoom;
  session.offsetX = Math.min(0, Math.max(session.viewport - width, session.offsetX));
  session.offsetY = Math.min(0, Math.max(session.viewport - height, session.offsetY));
}

function applyCropTransform() {
  const session = state.cropSession;
  const image = document.querySelector('#crop-source');
  if (!session || !image) return;
  const scale = session.baseScale * session.zoom;
  image.style.width = `${session.sourceWidth * scale}px`;
  image.style.height = `${session.sourceHeight * scale}px`;
  image.style.transform = `translate(${session.offsetX}px, ${session.offsetY}px)`;
}

async function saveCroppedPortrait() {
  const character = getActiveCharacter();
  const session = state.cropSession;
  if (!character || !session) return;
  const scale = session.baseScale * session.zoom;
  try {
    const selected = await desktop.saveCroppedImage(character.id, {
      dataUrl: session.dataUrl,
      x: -session.offsetX / scale,
      y: -session.offsetY / scale,
      size: session.viewport / scale,
    });
    state.modal = null;
    state.cropSession = null;
    await appendPortrait(character, selected, 'Clipboard portrait added.', true);
  } catch (error) { showToast(readableError(error, 'The cropped portrait could not be saved.'), 'info'); }
}

async function appendPortrait(character, selected, message, makeCover = false) {
  character.images = character.images || [];
  const urls = state.imageUrls.get(character.id) || [];
  const previousImages = [...character.images];
  const previousUrls = [...urls];
  const previousCover = character.coverIndex;
  const previousImageUrl = character._imageUrl;
  if (makeCover) character.images.unshift(selected.path);
  else character.images.push(selected.path);
  if (makeCover) urls.unshift(selected.url);
  else urls.push(selected.url);
  state.imageUrls.set(character.id, urls);
  if (makeCover) character.coverIndex = 0;
  character._imageUrl = makeCover ? selected.url : character._imageUrl || selected.url;
  character.modified = Date.now();
  character.variants = character.images.length;
  render();
  if (await saveLibrary()) showToast(message, 'success');
  else {
    character.images = previousImages;
    character.variants = previousImages.length;
    character.coverIndex = previousCover;
    character._imageUrl = previousImageUrl;
    state.imageUrls.set(character.id, previousUrls);
    render();
    await cleanupUnusedPortraits([selected.path]);
  }
}

async function duplicateSelectedCharacter() {
  const character = getActiveCharacter();
  if (!character) return showToast('Select a character before duplicating it.', 'info');
  if (!desktop?.duplicateCharacter) return showToast('Character duplication is unavailable.', 'info');
  try {
    const duplicate = await desktop.duplicateCharacter(character, `${character.name} (Copy)`);
    getGallery().characters.push(duplicate);
    state.activeId = duplicate.id;
    state.focusContext = 'character';
    state.selectedVariantIndex = null;
    state.modal = null;
    render();
    if (await saveLibrary()) showToast('Character record duplicated.', 'success');
    else {
      getGallery().characters = getGallery().characters.filter((item) => item.id !== duplicate.id);
      state.activeId = character.id;
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
    state.activeId = null;
    state.focusContext = 'character';
    state.selectedVariantIndex = null;
    clearFilters(false);
    state.filterPanelOpen = false;
    state.sort = gallerySortMode(duplicate);
    cancelBatchSelection(false);
    render();
    if (await saveLibrary()) showToast(`Collection "${duplicate.name}" created.`, 'success');
    else {
      state.galleries = state.galleries.filter((item) => item !== duplicate);
      state.activeGallery = gallery.name;
      state.activeId = null;
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
    state.saved = Boolean(await desktop.save(galleries));
    if (!state.saved) throw new Error('The archive save did not complete.');
    render();
    return true;
  } catch (error) {
    state.saved = false;
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

function bindModalDelegation() {
  document.addEventListener('click', (event) => {
    const actionName = event.target.closest('[data-action]')?.dataset.action;
    if (state.modal && actionName) handleModalAction(actionName);
    if (state.activeMenu && !event.target.closest('.window-chrome')) { state.activeMenu = null; render(); }
    if (state.contextMenu && !event.target.closest('.context-menu')) { state.contextMenu = null; render(); }
    if (state.filterPanelOpen && !event.target.closest('.filter-control')) { state.filterPanelOpen = false; render(); }
    if (state.sortMenuOpen && !event.target.closest('.sort-control')) { state.sortMenuOpen = false; render(); }
  });
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
      if (desktop?.hasClipboardImage()) {
        event.preventDefault();
        pasteClipboardPortrait();
        return;
      }
      const clipboardText = desktop?.readClipboardText?.() || '';
      if (isValidCk3Dna(clipboardText)) {
        event.preventDefault();
        openClipboardDna(clipboardText);
      }
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
      saveLibrary().then((saved) => { if (saved) showToast('Archive saved.', 'success'); });
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
      if (state.batchMode) showBatchDeleteConfirmation();
      else if (state.focusContext === 'variant' && state.selectedVariantIndex !== null) showDeleteVariantConfirmation();
      else showDeleteConfirmation();
      return;
    }
    if (event.key === 'Enter' && state.modal && document.querySelector('[data-action="confirm-delete-gallery"]')) {
      event.preventDefault();
      handleModalAction('confirm-delete-gallery');
      return;
    }
    if (event.key === 'Enter' && state.modal && document.querySelector('[data-action="confirm-paste-dna"]')) {
      event.preventDefault();
      handleModalAction('confirm-paste-dna');
      return;
    }
    if (event.key === 'Enter' && document.activeElement?.dataset.action === 'save-dna') {
      event.preventDefault();
      handleModalAction('save-dna');
      return;
    }
    if (event.key === 'Enter' && state.modal && document.querySelector('[data-action="confirm-delete-batch"]')) {
      event.preventDefault();
      handleModalAction('confirm-delete-batch');
      return;
    }
    if (event.key === 'Enter' && state.modal && document.querySelector('[data-action="confirm-delete-variant"]')) {
      event.preventDefault();
      handleModalAction('confirm-delete-variant');
      return;
    }
    if (event.key === 'Enter' && state.modal && document.querySelector('[data-action="confirm-delete"]')) {
      event.preventDefault();
      handleModalAction('confirm-delete');
      return;
    }
    if (event.key === 'Escape') {
      if (state.modal) { state.modal = null; state.cropSession = null; state.pendingPortraitSource = null; state.pendingDnaSource = null; state.dnaHistory = null; state.focusDnaSave = false; render(); restoreSelectionFocus(); }
      else if (state.activeMenu) { state.activeMenu = null; render(); }
      else if (state.contextMenu) { state.contextMenu = null; render(); }
      else if (state.filterPanelOpen) { state.filterPanelOpen = false; render(); }
      else if (state.sortMenuOpen) { state.sortMenuOpen = false; render(); focusWithoutScroll(document.querySelector('[data-action="sort-menu"]')); }
      else if (state.batchMode) cancelBatchSelection();
    }
  });
}

function installClipboardPasteHandler() {
  document.addEventListener('paste', (event) => {
    if (state.cropSession) return;
    const items = [...(event.clipboardData?.items || [])];
    const files = [...(event.clipboardData?.files || [])];
    const imageItem = items.find((item) => item.kind === 'file' && (item.type.startsWith('image/') || /\.(png|jpe?g|bmp|gif|webp)$/i.test(item.getAsFile()?.name || '')));
    const imageFile = imageItem?.getAsFile() || files.find((file) => file.type.startsWith('image/') || /\.(png|jpe?g|bmp|gif|webp)$/i.test(file.name));
    if (imageFile) {
      event.preventDefault();
      openClipboardFile(imageFile).catch(() => showToast('The clipboard image could not be decoded.', 'info'));
      return;
    }

    const uriItem = items.find((item) => item.type === 'text/uri-list');
    if (uriItem) {
      event.preventDefault();
      uriItem.getAsString(async (value) => {
        const source = await desktop?.readImagePath(value);
        if (source) openClipboardSource(source);
        else showToast('The copied file is not a supported image.', 'info');
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
  if ((character.images?.length || 0) >= 5) return showToast('This character already has five portrait variants.', 'info');
  showCropModal(source);
}

async function boot() {
  bindModalDelegation();
  installKeyboardShortcuts();
  installClipboardPasteHandler();
  desktop?.onPasteImage(() => pasteClipboardPortrait());
  let loaded = null;
  let loadError = null;
  try { loaded = desktop ? await desktop.load() : null; } catch (error) { loadError = error; }
  if (loaded?.galleries) {
    state.galleries = loaded.galleries.map((gallery) => ({ ...gallery, characters: gallery.characters.map(normalizedCharacter) }));
    state.imageDirectory = loaded.imageDirectory;
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

boot();
