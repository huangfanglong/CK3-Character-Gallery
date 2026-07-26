const DEFAULT_CHARACTER_NAME_COLOR = '#ebe7dc';
const DEFAULT_TITLE_GLOW_COLOR = '#df966d';
const CHARACTER_COLOR_PRESETS = [
  ['Ivory', DEFAULT_CHARACTER_NAME_COLOR],
  ['Copper', '#df966d'],
  ['Gold', '#d6b76b'],
  ['Sage', '#a9c18e'],
  ['Sea glass', '#7ac7b4'],
  ['Sky', '#8fb8c9'],
  ['Rose', '#d99aa5'],
  ['Violet', '#c3a6e8'],
];

function normalizeAppearanceColor(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : '';
}

function applyCharacterAppearance(element, character) {
  if (!element) return;
  const nameColor = normalizeAppearanceColor(character?.nameColor);
  const titleGlowColor = normalizeAppearanceColor(character?.titleGlowColor);
  if (
    element.style.getPropertyValue('--character-name-color') === nameColor
    && element.style.getPropertyValue('--character-title-glow-color') === titleGlowColor
  ) return;
  element.style.removeProperty('--character-name-color');
  element.style.removeProperty('--character-title-glow-color');
  element.style.removeProperty('--character-title-glow');
  if (nameColor) element.style.setProperty('--character-name-color', nameColor);
  if (titleGlowColor) {
    element.style.setProperty('--character-title-glow-color', titleGlowColor);
    element.style.setProperty('--character-title-glow', `0 0 4px ${titleGlowColor}, 0 0 11px ${titleGlowColor}`);
  }
}

function syncCharacterAppearance(root = document) {
  const recordElements = root.querySelectorAll('[data-character-id]');
  if (recordElements.length) {
    const charactersById = new Map(getCharacters().map((character) => [character.id, character]));
    recordElements.forEach((element) => {
      const character = charactersById.get(element.dataset.characterId);
      const styled = element.style.getPropertyValue('--character-name-color')
        || element.style.getPropertyValue('--character-title-glow-color');
      if (styled || normalizeAppearanceColor(character?.nameColor) || normalizeAppearanceColor(character?.titleGlowColor)) {
        applyCharacterAppearance(element, character);
      }
    });
  }
  const inspector = root.matches?.('.inspector') ? root : root.querySelector('.inspector');
  applyCharacterAppearance(inspector, getActiveCharacter());
}

function appearanceSwatchesMarkup(selectedColor) {
  return CHARACTER_COLOR_PRESETS.map(([label, color]) => (
    `<button class="appearance-swatch ${selectedColor === color ? 'selected' : ''}" data-appearance-color="${color}" style="--swatch-color:${color}" aria-label="${label}" aria-pressed="${selectedColor === color}" title="${label}"></button>`
  )).join('');
}

function appearanceFieldMarkup(field, label, selectedColor, emptyLabel, fallbackColor) {
  const labelId = `appearance-${field}-label`;
  const inputId = `appearance-${field === 'nameColor' ? 'name-color' : 'title-glow-color'}`;
  return `<section class="appearance-field" data-appearance-field="${field}" data-appearance-value="${selectedColor}" aria-labelledby="${labelId}"><div class="appearance-field-heading"><h3 id="${labelId}">${label}</h3><button class="appearance-default ${selectedColor ? '' : 'selected'}" data-appearance-color="" aria-pressed="${!selectedColor}">${emptyLabel}</button></div><div class="appearance-color-row"><div class="appearance-swatches" role="group" aria-label="${label} presets">${appearanceSwatchesMarkup(selectedColor)}</div><label class="appearance-custom ${selectedColor && !CHARACTER_COLOR_PRESETS.some(([, color]) => color === selectedColor) ? 'selected' : ''}"><span>Custom</span><input id="${inputId}" type="color" data-appearance-custom="${field}" value="${selectedColor || fallbackColor}" aria-label="Custom ${label.toLowerCase()}" /></label></div></section>`;
}

function showCharacterAppearanceModal() {
  const character = getActiveCharacter();
  if (!character) return;
  const nameColor = normalizeAppearanceColor(character.nameColor);
  const titleGlowColor = normalizeAppearanceColor(character.titleGlowColor);
  state.modal = `<div class="modal-backdrop" ${modalPreserveAttribute('appearance')}><div class="modal appearance-modal" role="dialog" aria-modal="true" aria-labelledby="appearance-dialog-title"><button class="modal-close" data-action="close-modal" aria-label="Close appearance editor">${icon('close')}</button><p class="eyebrow">RECORD APPEARANCE</p><h2 id="appearance-dialog-title">Customize ${escapeHtml(character.name)}</h2><div class="appearance-preview" aria-label="Appearance preview"><strong>${escapeHtml(character.name)}</strong><span>${escapeHtml(character.title || 'Character title')}</span></div><div class="appearance-fields">${appearanceFieldMarkup('nameColor', 'Name color', nameColor, 'Default', DEFAULT_CHARACTER_NAME_COLOR)}${appearanceFieldMarkup('titleGlowColor', 'Title glow', titleGlowColor, 'No glow', DEFAULT_TITLE_GLOW_COLOR)}</div><div class="modal-actions appearance-actions"><button class="outline-button appearance-reset" data-action="reset-appearance">Reset all</button><button class="outline-button" data-action="close-modal">Cancel</button><button class="primary-button" data-action="save-appearance">Save appearance ${icon('check')}</button></div></div></div>`;
  render('modal');
  updateAppearancePreview();
  document.querySelector('.appearance-field [data-appearance-color]')?.focus();
}

function trapAppearanceFocus(event) {
  const modal = document.querySelector('.appearance-modal');
  if (!modal || event.key !== 'Tab') return false;
  const controls = [...modal.querySelectorAll('button:not(:disabled), input:not(:disabled)')];
  if (!controls.length) return false;
  const first = controls[0];
  const last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
    return true;
  }
  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
    return true;
  }
  if (!modal.contains(document.activeElement)) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}

function updateAppearanceSelection(field, value) {
  const group = document.querySelector(`[data-appearance-field="${field}"]`);
  if (!group) return;
  const color = normalizeAppearanceColor(value);
  group.dataset.appearanceValue = color;
  group.querySelectorAll('[data-appearance-color]').forEach((swatch) => {
    const selected = swatch.dataset.appearanceColor === color;
    swatch.classList.toggle('selected', selected);
    swatch.setAttribute('aria-pressed', String(selected));
  });
  const custom = group.querySelector('[data-appearance-custom]');
  custom?.closest('.appearance-custom')?.classList.toggle(
    'selected',
    Boolean(color) && !CHARACTER_COLOR_PRESETS.some(([, preset]) => preset === color),
  );
  updateAppearancePreview();
}

function updateAppearancePreview() {
  const preview = document.querySelector('.appearance-preview');
  if (!preview) return;
  applyCharacterAppearance(preview, {
    nameColor: document.querySelector('[data-appearance-field="nameColor"]')?.dataset.appearanceValue,
    titleGlowColor: document.querySelector('[data-appearance-field="titleGlowColor"]')?.dataset.appearanceValue,
  });
}

function resetAppearanceEditor() {
  updateAppearanceSelection('nameColor', '');
  updateAppearanceSelection('titleGlowColor', '');
}

async function saveCharacterAppearance() {
  const character = getActiveCharacter();
  if (!character) return;
  const previous = {
    hasNameColor: Object.hasOwn(character, 'nameColor'),
    nameColor: character.nameColor,
    hasTitleGlowColor: Object.hasOwn(character, 'titleGlowColor'),
    titleGlowColor: character.titleGlowColor,
    modified: character.modified,
  };
  const nameColor = normalizeAppearanceColor(document.querySelector('[data-appearance-field="nameColor"]')?.dataset.appearanceValue);
  const titleGlowColor = normalizeAppearanceColor(document.querySelector('[data-appearance-field="titleGlowColor"]')?.dataset.appearanceValue);
  if (nameColor) character.nameColor = nameColor; else delete character.nameColor;
  if (titleGlowColor) character.titleGlowColor = titleGlowColor; else delete character.titleGlowColor;
  character.modified = Date.now();
  state.modal = null;
  render();
  if (state.preview) {
    showToast('Preview appearance updated for this session.', 'success');
    return;
  }
  if (await saveLibrary()) {
    showToast(nameColor || titleGlowColor ? 'Character appearance saved.' : 'Character appearance reset.', 'success');
    return;
  }
  if (previous.hasNameColor) character.nameColor = previous.nameColor; else delete character.nameColor;
  if (previous.hasTitleGlowColor) character.titleGlowColor = previous.titleGlowColor; else delete character.titleGlowColor;
  character.modified = previous.modified;
  render();
}
