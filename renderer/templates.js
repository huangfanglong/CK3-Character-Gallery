function chromeMarkup() {
  const menuItems = {
    file: [['new-character', 'New character', 'Ctrl+N'], ['new-gallery', 'New collection', ''], ['rename-gallery', 'Rename collection', ''], ['delete-gallery', 'Delete collection', ''], ['divider'], ['import', 'Import collection…', ''], ['export', 'Export collection…', ''], ['open-folder', 'Open archive folder', ''], ['save-library', 'Save archive', 'Ctrl+S'], ['divider'], ['exit', 'Exit', 'Alt+F4']],
    edit: [['undo-dna', 'Undo DNA edit', 'Ctrl+Z'], ['redo-dna', 'Redo DNA edit', 'Ctrl+Y'], ['batch-select', 'Select multiple characters', 'Ctrl+Click'], ['focus-search', 'Find a character', 'Ctrl+F'], ['paste-portrait', 'Paste portrait from clipboard', 'Ctrl+V'], ['manage-record', 'Manage selected record', ''], ['edit-note', 'Edit notes', ''], ['open-dna', 'Open DNA workbench', '']],
    view: [['view-cards', 'Comfortable grid', ''], ['view-compact', 'Compact grid', ''], ['view-table', 'Compact list', '']],
    help: [['help-hint', 'New character', 'Ctrl+N'], ['help-hint', 'Find a character', 'Ctrl+F'], ['help-hint', 'Save archive', 'Ctrl+S'], ['help-hint', 'Duplicate character', 'Ctrl+D'], ['help-hint', 'Export collection', 'Ctrl+E'], ['help-hint', 'Paste portrait or DNA', 'Ctrl+V'], ['help-hint', 'Copy selected DNA', 'Ctrl+C'], ['help-hint', 'Undo / redo DNA', 'Ctrl+Z / Ctrl+Y'], ['help-hint', 'Manage record', 'F2'], ['help-hint', 'Add to selection', 'Ctrl+Click'], ['help-hint', 'Delete selection', 'Delete']],
  };
  const menu = state.activeMenu;
  const popover = menu ? `<div class="chrome-menu" data-menu-popover="${menu}">${menuItems[menu].map(([actionName, label, shortcut]) => actionName === 'divider' ? '<div class="chrome-menu-divider"></div>' : `<button data-action="${actionName}"><span>${label}</span>${shortcut ? `<kbd>${shortcut}</kbd>` : ''}</button>`).join('')}</div>` : '';
  return `<header class="window-chrome"><div class="chrome-title"><span class="chrome-seal">B</span><strong>Bloodline</strong><span class="chrome-edition">CHARACTER ARCHIVE</span></div><nav class="chrome-nav" aria-label="Application menu"><button class="${menu === 'file' ? 'active' : ''}" data-menu="file">File</button><button class="${menu === 'edit' ? 'active' : ''}" data-menu="edit">Edit</button><button class="${menu === 'view' ? 'active' : ''}" data-menu="view">View</button><button class="${menu === 'help' ? 'active' : ''}" data-menu="help">Help</button></nav><div class="chrome-drag-region"></div>${popover}</header>`;
}

function contextMenuMarkup() {
  const menu = state.contextMenu;
  if (!menu) return '';
  const batch = menu.type === 'batch';
  const galleryBatch = menu.type === 'gallery-batch';
  const character = menu.type === 'character' ? getCharacters().find((item) => item.id === menu.id) : null;
  const heading = menu.type === 'collection' ? menu.name : galleryBatch ? `${menu.names.length} COLLECTIONS SELECTED` : batch ? `${menu.ids.length} RECORDS SELECTED` : character?.name;
  const items = menu.type === 'collection'
    ? [['rename', icon('edit'), 'Rename'], ['duplicate', icon('copy'), 'Duplicate'], ['batch-select', icon('check'), 'Batch select'], ['divider'], ['delete', icon('trash'), 'Delete', 'danger']]
    : galleryBatch
      ? [['delete-selected-galleries', icon('trash'), 'Delete selected', 'danger'], ['divider'], ['cancel-gallery-batch', icon('close'), 'Cancel selection']]
      : batch
        ? [['transfer', icon('arrow'), 'Move / Copy'], ['divider'], ['delete-batch', icon('trash'), 'Delete selected', 'danger']]
        : [['manage', icon('edit'), 'Manage record'], ['customize-appearance', icon('palette'), 'Customize appearance'], ['favorite', icon('star'), state.favorites.has(menu.id) ? 'Remove favorite' : 'Add favorite'], ['divider'], ['copy-dna', icon('copy'), 'Copy DNA'], ['paste-dna', icon('download'), 'Paste DNA'], ['transfer', icon('arrow'), 'Move / Copy'], ['duplicate', icon('copy'), 'Duplicate'], ['divider'], ['delete', icon('trash'), 'Delete', 'danger']];
  return `<div class="context-menu" role="menu" style="left:${menu.x}px;top:${menu.y}px"><p>${escapeHtml(heading || '')}</p>${items.map(([actionName, itemIcon, label, className]) => actionName === 'divider' ? '<div class="context-menu-divider"></div>' : `<button class="${className || ''}" data-context-action="${actionName}" role="menuitem">${itemIcon}<span>${label}</span></button>`).join('')}</div>`;
}

function cardMarkup(character, index, reorderable = false) {
  const favorite = state.favorites.has(character.id);
  const selected = !state.batchMode && state.activeId === character.id;
  const batchSelected = state.selectedCharacterIds.has(character.id);
  const variantCount = character.images?.length || (state.preview ? character.variants || 0 : 0);
  const coverIndex = coverVariantIndex(character);
  return `<article class="character-card ${selected ? 'selected' : ''} ${state.batchMode ? 'batch-selectable' : ''} ${batchSelected ? 'batch-selected' : ''}" data-character-id="${escapeHtml(character.id)}" tabindex="0"${state.batchMode ? ` aria-pressed="${batchSelected}"` : ''}${reorderable ? ' draggable="true"' : ''}>
    <div class="card-portrait">
      ${portraitMarkup(character, 'card', coverIndex)}
      ${state.batchMode ? `<span class="batch-check">${batchSelected ? icon('check') : ''}</span>` : ''}
      <div class="card-topline"><span class="card-status"><span class="status-dot ${character.status}"></span>${character.status === 'ready' ? 'DNA ready' : 'Needs DNA'}</span><button class="icon-button favorite ${favorite ? 'active' : ''}" data-action="favorite" title="${favorite ? 'Remove from favorites' : 'Add to favorites'}" aria-label="${favorite ? 'Remove' : 'Add'} ${escapeHtml(character.name)} ${favorite ? 'from' : 'to'} favorites">${icon('star')}</button></div>
      <div class="card-index">${String(index + 1).padStart(2, '0')}</div>
      ${variantCount > 1 ? `<div class="card-bottom"><div class="card-cycle"><button data-cycle-portrait="-1" title="Previous cover portrait" aria-label="Previous cover portrait">‹</button><span>${coverIndex + 1}/${variantCount}</span><button data-cycle-portrait="1" title="Next cover portrait" aria-label="Next cover portrait">›</button></div></div>` : ''}
    </div>
    <div class="card-info"><div><h3>${escapeHtml(character.name)}</h3>${character.title ? `<p>${escapeHtml(character.title)}</p>` : ''}</div><button class="more-button" data-action="more" title="More actions" aria-label="Manage ${escapeHtml(character.name)}">${icon('more')}</button></div>
  </article>`;
}

function tableMarkup(character) {
  const favorite = state.favorites.has(character.id);
  const batchSelected = state.selectedCharacterIds.has(character.id);
  const coverIndex = coverVariantIndex(character);
  const preview = imageUrlFor(character, coverIndex) ? `<span class="table-portrait-preview" aria-hidden="true">${portraitMarkup(character, 'list-preview', coverIndex)}</span>` : '';
  return `<button class="table-row ${!state.batchMode && state.activeId === character.id ? 'selected' : ''} ${state.batchMode ? 'batch-selectable' : ''} ${batchSelected ? 'batch-selected' : ''}" data-character-id="${escapeHtml(character.id)}"${state.batchMode ? ` aria-pressed="${batchSelected}"` : ''}><span class="table-avatar">${portraitMarkup(character, 'mini', coverIndex)}${preview}</span><span class="table-name"><strong>${escapeHtml(character.name)}</strong><small>${escapeHtml(character.title || 'Uncatalogued character')}</small></span><span class="table-tags">${character.tags.slice(0, 2).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</span><span class="table-status ${character.status}">${character.status === 'ready' ? icon('check') + ' ready' : 'draft'}</span><span class="table-favorite ${favorite ? 'active' : ''}">${icon('star')}</span></button>`;
}

function sidebarMarkup(galleries) {
  const allCount = galleries.reduce((sum, gallery) => sum + gallery.characters.length, 0);
  const favoriteCount = [...state.favorites].filter((id) => galleries.some((gallery) => gallery.characters.some((character) => character.id === id))).length;
  const galleryQuery = (state.galleryQuery || '').trim().toLowerCase();
  const visibleGalleries = galleries.filter((gallery) => gallery.name.toLowerCase().includes(galleryQuery));
  return `<aside class="sidebar" aria-label="Archive navigation">
    <div class="brand"><div class="brand-seal">B</div><div><strong>Bloodline</strong><span>CHARACTER ARCHIVE</span></div><button class="icon-button sidebar-close" data-action="toggle-sidebar" aria-label="Close navigation">${icon('close')}</button></div>
    <button class="new-record" data-action="new-character">${icon('plus')}<span>New character</span><kbd>Ctrl N</kbd></button>
    <nav class="library-nav" aria-label="Library filters">
      <button class="nav-item ${activeFilterCount() === 0 ? 'active' : ''}" data-filter="all">${icon('grid')}<span>All characters</span><b>${allCount}</b></button>
      <button class="nav-item ${state.filters.favorites ? 'active' : ''}" data-filter="favorites">${icon('star')}<span>Favorites</span><b>${favoriteCount}</b></button>
      <button class="nav-item ${state.filters.dna === 'ready' ? 'active' : ''}" data-filter="ready">${icon('check')}<span>DNA ready</span></button>
      <button class="nav-item ${state.filters.dna === 'drafts' ? 'active' : ''}" data-filter="drafts">${icon('edit')}<span>Needs DNA</span></button>
    </nav>
    <div class="nav-heading"><p class="nav-label">COLLECTIONS <span>${galleries.length}</span></p><div class="collection-actions"><button class="text-icon" data-action="rename-gallery" title="Rename selected collection" aria-label="Rename selected collection"${state.preview ? ' disabled' : ''}>${icon('edit')}</button><button class="text-icon" data-action="new-gallery" title="New collection" aria-label="New collection">${icon('plus')}</button></div></div>
    <label class="gallery-search">${icon('search')}<input id="collection-search-input" value="${escapeHtml(state.galleryQuery || '')}" placeholder="Find a collection…" aria-label="Find a collection" />${state.galleryQuery ? `<button data-action="clear-gallery-search" aria-label="Clear collection search">${icon('close')}</button>` : ''}</label>
    <nav class="collection-nav" aria-label="Collections">${visibleGalleries.map((gallery) => {
      const initials = gallery.name.split(/\s+/).map((word) => word[0]).join('').slice(0, 2).toUpperCase();
      return `<button class="collection-item ${state.activeGallery === gallery.name ? 'active' : ''}" data-gallery="${escapeHtml(gallery.name)}"${galleries.length > 1 && !state.preview ? ' draggable="true"' : ''}><span class="collection-glyph" aria-hidden="true">${escapeHtml(initials)}</span><span class="collection-copy"><strong>${escapeHtml(gallery.name)}</strong><small>${gallery.characters.length ? 'Local collection' : 'Empty collection'}</small></span><b>${gallery.characters.length}</b></button>`;
    }).join('')}${visibleGalleries.length ? '' : '<p class="collection-empty">No collections match this search.</p>'}</nav>
    <div class="sidebar-bottom"><div class="sidebar-utilities"><button class="utility-link" data-action="import">${icon('download')} Import collection</button><button class="utility-link" data-action="export">${icon('arrow')} Export collection</button></div><div class="storage-note"><span class="pulse"></span><span><b>Local archive</b><small>Saved on this device</small></span></div></div>
  </aside>`;
}

function inspectorMarkup(character) {
  if (!character) return `<aside class="inspector empty-inspector"><div class="inspector-empty-mark">◌</div><p class="eyebrow">NO RECORD SELECTED</p><p>Choose a portrait from the archive to inspect.</p><button class="outline-button" data-action="new-character">${icon('plus')} New character</button></aside>`;
  const favorite = state.favorites.has(character.id);
  const variantCount = character.images?.length || (state.preview ? character.variants || 0 : 0);
  const viewedVariant = state.selectedVariantIndex !== null && state.selectedVariantIndex < variantCount ? state.selectedVariantIndex : coverVariantIndex(character);
  return `<aside class="inspector"><div class="inspector-scroll"><div class="inspector-head"><div><p class="eyebrow">CHARACTER</p><span class="inspector-id">${escapeHtml(character.id.slice(0, 8).toUpperCase())}</span></div><div class="inspector-actions"><button class="icon-button ${favorite ? 'active' : ''}" data-action="favorite" title="Favorite">${icon('star')}</button><button class="icon-button" data-action="close-inspector" title="Close inspector">${icon('close')}</button></div></div><div class="inspector-portrait">${portraitMarkup(character, 'large', viewedVariant)}<div class="portrait-caption"><span>${variantCount} VARIANTS</span><span>${character.status === 'ready' ? 'DNA READY' : 'DNA DRAFT'}</span></div></div><div class="inspector-title"><div><h2>${escapeHtml(character.name)}</h2><input id="character-title" value="${escapeHtml(character.title)}" placeholder="Uncatalogued character" aria-label="Character title" /></div><button class="text-icon" data-action="more">${icon('more')}</button></div><div class="inspector-tags">${characterTags(character).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div><div class="variant-strip"><div class="variant-heading"><span>PORTRAIT VARIANTS</span><button data-action="add-variant">${icon('plus')} Add</button></div><div class="variant-row">${variantCount ? Array.from({ length: variantCount }, (_, index) => `<button class="variant-thumb ${state.focusContext === 'variant' && state.selectedVariantIndex === index ? 'selected' : ''}" data-variant="${index}" aria-label="Select portrait variant ${index + 1}">${portraitMarkup(character, 'thumb', index)}<span>${String(index + 1).padStart(2, '0')}</span></button>`).join('') : '<p class="variant-empty">No portrait variants yet</p>'}</div></div><div class="inspector-section"><div class="section-heading"><span>NOTES</span><button class="note-edit-button" data-action="edit-note" title="Edit notes" aria-label="Edit notes">${icon('edit')}</button></div><button class="field-note" data-action="edit-note" title="Edit notes">${character.note ? highlightedNoteMarkup(character.note) : 'Add notes or #tags.'}</button></div></div><div class="inspector-footer"><button class="outline-button" data-action="copy-dna">${icon('copy')} Copy DNA</button><button class="primary-button" data-action="open-dna">Open workbench ${icon('arrow')}</button></div></aside>`;
}

function commandDockMarkup(characters) {
  const filterCount = activeFilterCount();
  return `<div class="command-dock" role="toolbar" aria-label="Library commands">
    <div class="search-box command-search">${icon('search')}<input id="search-input" value="${escapeHtml(state.query)}" placeholder="Search this archive…" aria-label="Search characters" /><kbd>Ctrl F</kbd></div>
    <span class="dock-divider"></span>
    <div class="filter-control"><button class="filter-button ${state.filterPanelOpen ? 'active' : ''}" data-action="filters" aria-expanded="${state.filterPanelOpen}" aria-controls="filter-panel">${icon('sliders')}<span>Filter</span>${filterCount ? `<span class="filter-count">${filterCount}</span>` : ''}</button>${state.filterPanelOpen ? filterPanelMarkup(characters.length) : ''}</div>
    ${sortControlMarkup()}
    <span class="dock-divider"></span>
    <div class="view-toggle" aria-label="View density"><button class="${state.view === 'cards' ? 'active' : ''}" data-view="cards" title="Comfortable grid" aria-label="Comfortable grid" aria-pressed="${state.view === 'cards'}">${icon('grid')}</button><button class="${state.view === 'compact' ? 'active' : ''}" data-view="compact" title="Compact grid" aria-label="Compact grid" aria-pressed="${state.view === 'compact'}">${icon('columns')}</button><button class="${state.view === 'table' ? 'active' : ''}" data-view="table" title="Compact list" aria-label="Compact list" aria-pressed="${state.view === 'table'}">${icon('list')}</button></div>
    ${state.batchMode ? `<button class="batch-start active" data-action="cancel-batch">Done</button>` : `<button class="batch-start" data-action="batch-select"${characters.length && !state.preview ? '' : ' disabled'}>Select</button>`}
  </div>${state.batchMode ? `<div class="selection-bar"><strong>${state.selectedCharacterIds.size} selected</strong><button data-action="select-all-visible">Select shown</button><button data-action="delete-batch"${state.selectedCharacterIds.size ? '' : ' disabled'}>Delete</button><button data-action="cancel-batch">Cancel</button></div>` : ''}`;
}

function mainMarkup(characters) {
  const queryLabel = state.query ? `Results for “${escapeHtml(state.query)}”` : state.preview ? 'A visual sample library' : 'A living collection of faces & DNA';
  const visibleLimit = state.visibleLimit || 48;
  const renderedCharacters = characters.slice(0, visibleLimit);
  const viewLabel = state.filters.favorites ? 'Favorites' : state.filters.dna === 'ready' ? 'DNA ready' : state.filters.dna === 'drafts' ? 'Needs DNA' : 'All faces';
  return `<main class="main-content"><div class="ambient-aura" aria-hidden="true"></div>
    <header class="topbar"><div class="breadcrumbs"><button class="icon-button sidebar-open" data-action="toggle-sidebar" aria-label="Open navigation">${icon('list')}</button><span>ARCHIVE</span><i>/</i><strong>${escapeHtml(state.activeGallery)}</strong></div><div class="top-actions"><span class="save-state"><i></i>Local archive</span><button class="icon-button" data-action="import" title="Import collection" aria-label="Import collection">${icon('download')}</button><button class="icon-button" data-action="export" title="Export collection" aria-label="Export collection">${icon('arrow')}</button></div></header>
    ${state.startupWarning ? `<div class="archive-warning" role="status">${icon('warning')}<span>${escapeHtml(state.startupWarning)}</span></div>` : ''}
    ${state.preview ? `<div class="preview-banner"><span><b>PREVIEW COLLECTION</b> This is a visual sample of the new archive experience.</span><button data-action="start-blank">Start with an empty gallery ${icon('arrow')}</button></div>` : ''}
    <section class="archive-heading"><div><p class="eyebrow">${state.preview ? 'DESIGN PREVIEW' : 'CHARACTER ARCHIVE'} / ${String(state.galleries.findIndex((gallery) => gallery.name === state.activeGallery) + 1).padStart(2, '0')}</p><h1>${escapeHtml(state.activeGallery)}</h1><p class="heading-subtitle">${getCharacters().length} characters <i></i> ${queryLabel}</p></div><button class="new-record heading-new" data-action="new-character">${icon('plus')} New character</button></section>
    <section class="library-toolbar" aria-label="Current view"><div class="view-label">${icon('grid')}<strong>${viewLabel}</strong><span>${characters.length}</span></div><div class="view-hint">${state.query ? `Matching “${escapeHtml(state.query)}”` : 'Select a portrait for Quick Look'}<span>↗</span></div></section>
    ${state.view === 'table' ? `<section class="table-view"><div class="table-header"><span>PORTRAIT</span><span>CHARACTER</span><span>TAGS</span><span>STATUS</span><span></span></div>${renderedCharacters.length ? renderedCharacters.map(tableMarkup).join('') : emptyResultsMarkup()}</section>` : `<section class="card-grid ${state.view === 'compact' ? 'compact' : ''}">${renderedCharacters.length ? renderedCharacters.map((character, index) => cardMarkup(character, index, characters.length > 1 && !state.preview && !state.batchMode)).join('') : emptyResultsMarkup()}</section>`}
    ${characters.length > visibleLimit ? `<div class="load-more"><button data-action="show-more">Show 48 more ${icon('chevron')}</button><span>Rendering ${renderedCharacters.length} of ${characters.length} to keep scrolling fluid</span></div>` : ''}
    <footer class="archive-footer"><span><span class="keyboard-dot"></span> Paste an in-game screenshot anywhere to add a portrait</span><span>Bloodline / Optical Archive</span></footer>
    ${commandDockMarkup(characters)}
  </main>`;
}

function sortControlMarkup() {
  const options = SORT_OPTIONS;
  const selectedLabel = options.find(([value]) => value === state.sort)?.[1] || options[0][1];
  return `<div class="sort-control"><button class="sort-select ${state.sortMenuOpen ? 'active' : ''}" data-action="sort-menu" data-sort-value="${state.sort}" aria-haspopup="listbox" aria-expanded="${state.sortMenuOpen}" aria-controls="sort-menu"><span>Sort</span><strong>${selectedLabel}</strong>${icon('chevron')}</button>${state.sortMenuOpen ? `<div class="sort-menu" id="sort-menu" role="listbox" aria-label="Sort characters">${options.map(([value, label]) => `<button class="${state.sort === value ? 'selected' : ''}" data-sort="${value}" role="option" aria-selected="${state.sort === value}"><span>${label}</span>${state.sort === value ? icon('check') : ''}</button>`).join('')}</div>` : ''}</div>`;
}

function filterPanelMarkup(matchCount) {
  const tags = availableTags();
  return `<section class="filter-panel" id="filter-panel" aria-label="Archive filters"><div class="filter-panel-head"><span>FILTER ARCHIVE</span><button data-action="clear-filters"${activeFilterCount() ? '' : ' disabled'}>Clear all</button></div><div class="filter-group"><span class="filter-label">DNA STATUS</span><div class="filter-segments" role="group" aria-label="DNA status"><button class="${state.filters.dna === 'all' ? 'active' : ''}" data-dna-filter="all">Any</button><button class="${state.filters.dna === 'ready' ? 'active' : ''}" data-dna-filter="ready">Ready</button><button class="${state.filters.dna === 'drafts' ? 'active' : ''}" data-dna-filter="drafts">Needs DNA</button></div></div><div class="filter-group"><span class="filter-label">RECORD</span><label class="filter-toggle"><input type="checkbox" data-favorite-filter${state.filters.favorites ? ' checked' : ''}/><span class="filter-checkbox">${state.filters.favorites ? icon('check') : ''}</span><span>Favorites only</span></label></div><div class="filter-group filter-tag-group"><span class="filter-label">TAGS</span><div class="filter-tag-list">${tags.length ? tags.map((tag) => `<label class="filter-tag-option ${state.filters.tags.has(tag) ? 'active' : ''}"><input type="checkbox" data-filter-tag value="${escapeHtml(tag)}"${state.filters.tags.has(tag) ? ' checked' : ''}/><span>#${escapeHtml(tag)}</span></label>`).join('') : '<p>No tags in this collection</p>'}</div></div><div class="filter-panel-foot"><span>${matchCount} match${matchCount === 1 ? '' : 'es'}</span><button data-action="close-filters">Done</button></div></section>`;
}

function emptyResultsMarkup() {
  return `<div class="empty-results"><span>⌁</span><h2>No faces found</h2><p>Try another name or clear the filters.</p><button class="outline-button" data-action="clear-search">Clear search and filters</button></div>`;
}
