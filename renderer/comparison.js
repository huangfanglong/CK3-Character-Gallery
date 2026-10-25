function comparisonRecords() {
  return state.comparisonIds.map((id) => {
    const gallery = state.galleries.find((item) => item.characters.some((character) => character.id === id));
    const character = gallery?.characters.find((item) => item.id === id);
    return character ? { character, galleryName: gallery.name } : null;
  }).filter(Boolean);
}

function comparisonChipMarkup(record) {
  const { character } = record;
  return `<div class="comparison-chip" data-compare-id="${escapeHtml(character.id)}">${portraitMarkup(character, 'mini', coverVariantIndex(character))}<span>${escapeHtml(character.name)}</span><button data-remove-comparison="${escapeHtml(character.id)}" aria-label="Remove ${escapeHtml(character.name)} from comparison">${icon('close')}</button></div>`;
}

function comparisonVariantMarkup(record, viewedVariant) {
  const { character } = record;
  const count = character.images?.length || 0;
  if (count < 2) return '';
  return `<div class="comparison-variants" aria-label="${escapeHtml(character.name)} portrait variants">${Array.from({ length: count }, (_, index) => `<button class="${viewedVariant === index ? 'active' : ''}" data-compare-variant="${escapeHtml(character.id)}" data-variant-index="${index}" aria-label="${escapeHtml(character.name)} variant ${index + 1}" aria-pressed="${viewedVariant === index}">${portraitMarkup(character, 'thumb', index)}<span>${index + 1}</span></button>`).join('')}</div>`;
}

function comparisonDnaMarkup(record, records) {
  const { character } = record;
  if (!character.dna?.trim()) return '<div class="comparison-empty"><span>∅</span><p>No DNA in this record.</p></div>';
  const allLines = records.map((item) => String(item.character.dna || '').split('\n'));
  const lines = String(character.dna).split('\n');
  const recordIndex = records.indexOf(record);
  let differences = 0;
  const markup = lines.map((line, index) => {
    const normalized = line.trim();
    const different = allLines.some((other, otherIndex) => otherIndex !== recordIndex && (other[index] || '').trim() !== normalized);
    if (different) differences += 1;
    return `<div class="dna-line ${different ? 'different' : ''}"${different ? ' title="This line differs between records"' : ''}><span>${String(index + 1).padStart(2, '0')}</span><code>${escapeHtml(line || ' ')}</code></div>`;
  }).join('');
  return `<div class="comparison-dna-summary"><strong>${differences}</strong> differing line${differences === 1 ? '' : 's'}</div><div class="comparison-dna" tabindex="0" aria-label="${escapeHtml(character.name)} DNA with differences highlighted">${markup}</div>`;
}

function comparisonCardMarkup(record, records) {
  const { character, galleryName } = record;
  const count = character.images?.length || 0;
  const requested = state.comparisonVariants.get(character.id);
  const viewedVariant = Number.isInteger(requested) && requested >= 0 && requested < count ? requested : coverVariantIndex(character);
  const portraits = `<div class="comparison-viewport"><div class="comparison-zoom-layer">${portraitMarkup(character, 'compare', viewedVariant)}</div></div>${comparisonVariantMarkup(record, viewedVariant)}`;
  return `<article class="comparison-card" data-compare-id="${escapeHtml(character.id)}"><header class="comparison-card-head"><div><h3>${escapeHtml(character.name)}</h3><p>${escapeHtml(galleryName)}</p></div><button class="icon-button" data-remove-comparison="${escapeHtml(character.id)}" aria-label="Remove ${escapeHtml(character.name)} from comparison">${icon('close')}</button></header><div class="comparison-card-body">${state.comparisonTab === 'dna' ? comparisonDnaMarkup(record, records) : portraits}</div></article>`;
}

function comparisonTrayMarkup() {
  const records = comparisonRecords();
  if (!records.length) return '';
  const expanded = state.comparisonExpanded && records.length >= 2;
  if (!expanded) {
    return `<section class="comparison-tray collapsed" aria-label="Character comparison"><div class="comparison-bar"><div class="comparison-label"><span>COMPARE</span><strong>${records.length}/4</strong></div><div class="comparison-chips">${records.map(comparisonChipMarkup).join('')}</div><button class="comparison-expand" data-action="expand-comparison"${records.length < 2 ? ' disabled' : ''}>${icon('columns')}<span>${records.length < 2 ? 'Add one more' : 'Compare'}</span></button><button class="icon-button" data-action="clear-comparison" aria-label="Clear comparison">${icon('close')}</button></div></section>`;
  }
  const zoom = Math.round(state.comparisonZoom * 100);
  return `<section class="comparison-tray expanded" aria-label="Character comparison" style="--compare-count:${records.length};--comparison-zoom:${state.comparisonZoom}"><header class="comparison-header"><div class="comparison-title"><span class="eyebrow">OPTICAL COMPARISON</span><strong>${records.length} records</strong></div><div class="comparison-tabs" role="tablist" aria-label="Comparison view"><button data-comparison-tab="portraits" role="tab" aria-selected="${state.comparisonTab === 'portraits'}" class="${state.comparisonTab === 'portraits' ? 'active' : ''}">Portraits</button><button data-comparison-tab="dna" role="tab" aria-selected="${state.comparisonTab === 'dna'}" class="${state.comparisonTab === 'dna' ? 'active' : ''}">DNA differences</button></div><div class="comparison-tools">${state.comparisonTab === 'portraits' ? `<div class="comparison-zoom" aria-label="Synchronized portrait zoom"><button data-compare-zoom="-1" aria-label="Zoom out all portraits"${state.comparisonZoom <= 1 ? ' disabled' : ''}>−</button><output aria-live="polite">${zoom}%</output><button data-compare-zoom="1" aria-label="Zoom in all portraits"${state.comparisonZoom >= 3 ? ' disabled' : ''}>+</button></div>` : ''}<button class="icon-button" data-action="collapse-comparison" aria-label="Collapse comparison" title="Collapse comparison">${icon('chevron')}</button><button class="icon-button" data-action="clear-comparison" aria-label="Clear comparison" title="Clear comparison">${icon('trash')}</button></div></header><div class="comparison-stage">${records.map((record) => comparisonCardMarkup(record, records)).join('')}</div></section>`;
}

function renderComparison() {
  const current = app.querySelector('.comparison-tray');
  const next = morphAppRegion(current, comparisonTrayMarkup());
  const main = app.querySelector('.main-content');
  if (!current && next && main) main.appendChild(next);
  main?.classList.toggle('has-comparison', comparisonRecords().length > 0);
  if (next) syncCharacterAppearance(next);
  syncPortraitPlayback(app, Boolean(state.modal));
}

function toggleComparison(id) {
  const exists = state.galleries.some((gallery) => gallery.characters.some((character) => character.id === id));
  if (!exists) return;
  state.comparisonIds = state.comparisonIds.filter((comparisonId) => state.galleries.some((gallery) => gallery.characters.some((character) => character.id === comparisonId)));
  const previousCount = state.comparisonIds.length;
  if (state.comparisonIds.includes(id)) {
    removeComparison(id);
    return;
  }
  if (state.comparisonIds.length >= 4) {
    showToast('Comparison is limited to four records. Remove one to add another.', 'info');
    return;
  }
  state.comparisonIds.push(id);
  if (previousCount < 2 && state.comparisonIds.length >= 2) state.comparisonExpanded = true;
  renderComparison();
  focusWithoutScroll(app.querySelector(state.comparisonExpanded ? '[data-action="collapse-comparison"]' : '[data-action="expand-comparison"]'));
}

function removeComparison(id) {
  const trayHadFocus = app.querySelector('.comparison-tray')?.contains(document.activeElement);
  state.comparisonIds = state.comparisonIds.filter((item) => item !== id);
  state.comparisonVariants.delete(id);
  if (state.comparisonIds.length < 2) state.comparisonExpanded = false;
  renderComparison();
  if (trayHadFocus) focusWithoutScroll(app.querySelector('[data-action="expand-comparison"], [data-action="clear-comparison"]') || app.querySelector('#search-input'));
}

function clearComparison() {
  const trayHadFocus = app.querySelector('.comparison-tray')?.contains(document.activeElement);
  state.comparisonIds = [];
  state.comparisonVariants.clear();
  state.comparisonExpanded = false;
  state.comparisonTab = 'portraits';
  state.comparisonZoom = 1;
  renderComparison();
  if (trayHadFocus) focusWithoutScroll(app.querySelector('#search-input'));
}

function collapseComparison() {
  state.comparisonExpanded = false;
  renderComparison();
  focusWithoutScroll(app.querySelector('[data-action="expand-comparison"]'));
}

function setComparisonTab(tab) {
  if (!['portraits', 'dna'].includes(tab)) return;
  state.comparisonTab = tab;
  renderComparison();
  focusWithoutScroll(app.querySelector(`[data-comparison-tab="${tab}"]`));
}

function setComparisonVariant(id, index) {
  const record = comparisonRecords().find((item) => item.character.id === id);
  if (!record || !Number.isInteger(index) || index < 0 || index >= (record.character.images?.length || 0)) return;
  state.comparisonVariants.set(id, index);
  renderComparison();
  focusWithoutScroll(app.querySelector(`[data-compare-variant="${CSS.escape(id)}"][data-variant-index="${index}"]`));
}

function changeComparisonZoom(direction) {
  const next = Math.max(1, Math.min(3, Math.round((state.comparisonZoom + Math.sign(direction) * .25) * 100) / 100));
  if (next === state.comparisonZoom) return;
  state.comparisonZoom = next;
  renderComparison();
  focusWithoutScroll(app.querySelector(`[data-compare-zoom="${Math.sign(direction)}"]`));
}
