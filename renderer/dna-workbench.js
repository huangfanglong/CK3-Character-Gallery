function showDnaModal(initialDna = null, focusSave = false) {
  const character = getActiveCharacter();
  if (!character) return;
  const currentDna = character.dna || '';
  const dna = typeof initialDna === 'string' ? initialDna : currentDna;
  state.dnaHistory = dna === currentDna
    ? { entries: [currentDna], index: 0 }
    : { entries: [currentDna, dna], index: 1 };
  state.focusDnaSave = focusSave;
  state.modal = `<div class="modal-backdrop" ${modalPreserveAttribute('dna')}><div class="dna-modal"><div class="modal-head"><div><p class="eyebrow">DNA WORKBENCH</p><h2>${escapeHtml(character.name)}</h2></div><button class="modal-close" data-action="close-modal">${icon('close')}</button></div><textarea id="dna-input" spellcheck="false">${escapeHtml(dna)}</textarea><div class="dna-footer"><span id="dna-count">Raw CK3 DNA · ${dna.length} characters</span><div class="dna-actions"><button class="outline-button" data-action="clear-dna">Clear DNA</button><button class="outline-button" data-action="homogenize-dna" title="Copy each first allele value and count into the second allele">Homogenize DNA</button><button class="primary-button" data-action="save-dna">Save DNA ${icon('check')}</button></div></div></div></div>`;
  render('modal');
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

async function pasteDnaFromClipboard(clipboardValue = null) {
  try {
    const dna = typeof clipboardValue === 'string' ? clipboardValue : (await desktop?.readClipboardText?.()) || '';
    if (!isValidCk3Dna(dna)) return showToast('The clipboard does not contain valid CK3 DNA.', 'info');
    openClipboardDna(dna, true);
  } catch (error) {
    showToast(readableError(error, 'The clipboard text could not be read.'), 'info');
  }
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
