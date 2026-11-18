const dockRoot = document.querySelector('#game-dock');
const announcer = document.querySelector('#announcer');
const dockBridge = window.gameDock;
let dockState = { mode: 'compact', collections: [], collection: '', position: 'center', visible: false, capture: null, sound: true };
let dockView = { picker: false, menu: '', help: false, query: '', pending: false, revealed: false };
let interactive = false;
let drag = null;
let captureClock = null;
let textInputActive = false;

function setDockRevealed(next) {
  const pinned = dockView.picker || Boolean(dockView.menu) || dockView.help || dockView.pending || textInputActive;
  const revealed = Boolean(next || pinned);
  if (dockView.revealed === revealed) return;
  dockView.revealed = revealed;
  document.querySelector('.dock')?.classList.toggle('revealed', revealed);
}

function dockEscape(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[character]));
}

function dockIcon(name) {
  const paths = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    chevron: '<path d="m8 10 4 4 4-4"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    camera: '<path d="M4 7h4l2-3h4l2 3h4v12H4z"/><circle cx="12" cy="13" r="4"/>',
    record: '<circle cx="12" cy="12" r="6"/>',
    undo: '<path d="M9 7 4 12l5 5M5 12h8a6 6 0 0 1 0 12" transform="translate(0 -3)"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.7 9a2.4 2.4 0 0 1 4.6 1c0 2-2.3 2-2.3 4M12 17h.01"/>',
  };
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.more}</svg>`;
}

function shortcutLabel(value) {
  return String(value || 'CommandOrControl+Alt+G').replace('CommandOrControl', 'Ctrl').replaceAll('+', ' + ');
}

function elapsedLabel(startedAt) {
  if (!startedAt) return '00:00';
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function collectionPicker() {
  if (!dockView.picker) return '';
  const query = dockView.query.toLowerCase();
  const collections = dockState.collections.filter((name) => name.toLowerCase().includes(query));
  return `<section class="popover" role="dialog" aria-label="Choose destination collection"><div class="search-field"><input id="collection-filter" class="input dock-text-input" type="search" placeholder="Find a collection…" aria-label="Find a collection" value="${dockEscape(dockView.query)}" /></div><p class="popover-label">DESTINATION</p>${collections.map((name) => `<button class="collection-option ${name === dockState.collection ? 'selected' : ''}" data-command="select-collection" data-collection="${dockEscape(name)}"><span>${dockEscape(name)}</span>${name === dockState.collection ? dockIcon('check') : ''}</button>`).join('') || '<p class="empty-option">No matching collections.</p>'}</section>`;
}

function dockMenu() {
  if (dockView.help) return `<section class="popover menu" role="dialog" aria-label="Game dock help"><p class="popover-label">HOW IT WORKS</p><div class="help-copy"><p>Rest your pointer on the thin top strip to unfold the controls. Move away to tuck them back.</p><p><strong>1.</strong> Use CK3’s Copy DNA option, then choose <strong>Quick add</strong>.</p><p><strong>2.</strong> Move the square over the character. Drag corners to resize.</p><p><strong>Snapshot</strong> saves a PNG. <strong>Live portrait</strong> records WebM; press <strong>${dockEscape(shortcutLabel(dockState.shortcut))}</strong> to stop and find a smooth loop.</p><p>Use windowed or borderless CK3. Keep Bloodline running. Clipboard text is checked only while a draft awaits DNA.</p></div><button class="menu-option" data-command="close-menu">Close help</button></section>`;
  if (dockView.menu !== 'menu') return '';
  return `<section class="popover menu" role="menu" aria-label="Game dock options"><p class="popover-label">DOCK POSITION</p>${['left', 'center', 'right'].map((position) => `<button class="menu-option" role="menuitem" data-command="set-position" data-position="${position}"><span>${position[0].toUpperCase()}${position.slice(1)}</span>${dockState.position === position ? dockIcon('check') : ''}</button>`).join('')}<div class="menu-separator"></div><button class="menu-option" role="menuitem" data-command="help">${dockIcon('help')}<span>How to use the dock</span></button><button class="menu-option danger" role="menuitem" data-command="disable-dock">Disable CK3 dock</button></section>`;
}

function brand() {
  return `<div class="brand"><span class="brand-mark" aria-hidden="true">B</span><span class="connection" aria-hidden="true"></span><span class="visually-hidden">CK3 connected</span></div>`;
}

function draftMarkup() {
  const ready = dockState.dnaReady;
  return `<div class="dock-body"><div class="dock-heading"><div><p class="eyebrow">NEW CHARACTER</p><h2>${ready ? 'DNA ready to archive' : 'Copy DNA in CK3'}</h2></div><button class="icon-button" data-command="cancel-draft" aria-label="Cancel new character">${dockIcon('close')}</button></div><p class="helper">${ready ? 'Choose a destination, then create the record or continue to portrait framing.' : 'Return to the character’s DNA window and copy its DNA. This panel will update automatically.'}</p><div class="draft-grid"><label class="field">Name (optional)<input id="character-name" class="input dock-text-input" maxlength="120" value="${dockEscape(dockState.characterName)}" placeholder="Automatic name" /></label><label class="field">Destination<input id="draft-destination" class="input" value="${dockEscape(dockState.collection)}" readonly /></label></div><div class="draft-actions"><p class="helper">${ready ? 'Your copied DNA stays private.' : 'No other clipboard text is shown or stored.'}</p><button class="text-button" data-command="cancel-draft">Cancel</button><button class="secondary-button" data-command="create-record" data-frame="false"${ready && !dockView.pending ? '' : ' disabled'}>Save DNA only</button><button class="primary-button" data-command="create-record" data-frame="true"${ready && !dockView.pending ? '' : ' disabled'}>${dockView.pending ? 'Creating…' : 'Create & frame'}</button></div></div>`;
}

function framingMarkup() {
  const capture = dockState.capture;
  return `<div class="dock-body"><div class="dock-heading"><div><p class="eyebrow">PORTRAIT FRAMING</p><h2>${dockEscape(dockState.characterName || 'New character')}</h2></div><span class="helper">450 × 450</span></div><p class="helper">Drag the square to move it. Use its corners to resize. Everything outside remains in CK3.</p><div class="capture-actions" style="margin-top:14px"><button class="text-button" data-command="reset-crop">Reset frame</button><span class="spacer"></span><button class="text-button" data-command="finish-without-portrait">Skip portrait</button><button class="secondary-button" data-command="live-capture"${capture ? ' disabled' : ''}>${dockIcon('record')} Live portrait</button><button class="primary-button" data-command="snapshot"${capture ? ' disabled' : ''}>${dockIcon('camera')} Snapshot</button></div></div>`;
}

function captureMarkup() {
  const capture = dockState.capture || {};
  const recording = capture.state === 'recording';
  const matching = capture.state === 'matching';
  const label = recording ? 'Recording live portrait' : matching ? 'Finding a smooth loop' : capture.state === 'saving' ? 'Saving portrait' : 'Preparing capture';
  const detail = recording ? `Press ${shortcutLabel(dockState.shortcut)} to stop` : matching ? 'Press again to finish now' : 'Keep CK3 visible for a moment';
  return `<div class="dock-body"><div class="capture-state"><span class="capture-indicator"></span><div class="capture-copy"><strong>${label}</strong><span>${detail}</span></div><span class="spacer"></span><time class="capture-time" id="capture-time">${elapsedLabel(capture.startedAt)}</time>${recording || matching ? `<button class="primary-button danger-button" data-command="toggle-capture">${matching ? 'Finish now' : 'Stop'}</button>` : ''}<button class="icon-button" data-command="cancel-capture" aria-label="Cancel capture">${dockIcon('close')}</button></div></div>`;
}

function successMarkup() {
  return `<div class="dock-body"><div class="capture-state"><span class="success-mark">${dockIcon('check')}</span><div class="capture-copy"><strong>Saved to ${dockEscape(dockState.collection)}</strong><span>${dockEscape(dockState.message || `${dockState.characterName} is in your archive.`)}</span></div></div><div class="success-actions" style="margin-top:14px"><button class="text-button" data-command="undo-create"${dockState.undoUntil > Date.now() ? '' : ' disabled'}>Undo</button><span class="spacer"></span><button class="secondary-button" data-command="view-gallery">View in gallery</button><button class="primary-button" data-command="dismiss">Done</button></div></div>`;
}

function errorMarkup() {
  return `<div class="dock-body"><div class="dock-heading"><div><p class="eyebrow">COULDN’T COMPLETE THAT</p><h2>${dockEscape(dockState.error || 'The archive did not respond.')}</h2></div><button class="icon-button" data-command="dismiss" aria-label="Dismiss error">${dockIcon('close')}</button></div><div class="capture-actions"><button class="secondary-button" data-command="dismiss">Dismiss</button><button class="primary-button" data-command="retry">Try again</button></div></div>`;
}

function compactBar() {
  const destinationDisabled = dockView.pending || !['compact', 'draft'].includes(dockState.mode);
  const quickAddDisabled = dockView.pending || !dockState.connected || dockState.mode !== 'compact';
  return `<div class="dock-bar">${brand()}<button class="collection-button" data-command="open-collections" aria-label="Destination: ${dockEscape(dockState.collection)}" aria-expanded="${dockView.picker}"${destinationDisabled ? ' disabled' : ''}><span>${dockEscape(dockState.collection || 'Choose collection')}</span>${dockIcon('chevron')}</button><span class="divider"></span><button class="primary-button" data-command="quick-add"${quickAddDisabled ? ' disabled' : ''}>${dockIcon('plus')} ${dockView.pending ? 'Adding…' : 'Quick add'}</button><span class="spacer"></span><span class="dna-state ${dockState.dnaReady ? 'ready' : ''}"><span class="dna-dot"></span>${dockState.dnaReady ? 'DNA copied' : 'CK3 ready'}</span><button class="icon-button" data-command="toggle-menu" aria-label="More dock options" aria-expanded="${dockView.menu === 'menu'}">${dockIcon('more')}</button></div>`;
}

function dockDisplayGeometry() {
  const source = dockState.sourceSize;
  if (!(source?.width > 0 && source?.height > 0)) return null;
  return displayRectForVideo(window.innerWidth, window.innerHeight, source.width, source.height);
}

function cropRect() {
  const normalized = dockState.crop;
  const source = dockState.sourceSize;
  const display = dockDisplayGeometry();
  if (!normalized || !display) return null;
  const crop = restoredCaptureCrop(normalized, source.width, source.height);
  if (!crop) return null;
  return selectionRectForCrop(crop, display, source.width, source.height);
}

function reticleMarkup() {
  const rect = cropRect();
  if (!rect || !['framing', 'capture'].includes(dockState.mode)) return '';
  const locked = Boolean(dockState.capture);
  return `<div id="portrait-reticle" class="reticle ${locked ? 'locked' : ''}" role="group" tabindex="${locked ? '-1' : '0'}" aria-label="Portrait frame. Drag to move, corners to resize." style="--crop-x:${rect.x}px;--crop-y:${rect.y}px;--crop-size:${rect.size}px"><span class="reticle-grid" aria-hidden="true"></span>${locked ? '' : ['north-west', 'north-east', 'south-east', 'south-west'].map((handle) => `<span class="crop-handle ${handle}" data-crop-handle="${handle}" aria-hidden="true"></span>`).join('')}<span class="reticle-label">${locked ? 'Frame locked' : '450 × 450 · drag to frame'}</span></div>`;
}

function renderDock() {
  const mode = dockState.mode;
  const capture = Boolean(dockState.capture) || ['recording', 'matching', 'saving'].includes(mode);
  const expanded = mode !== 'compact';
  const classes = ['dock', `position-${dockState.position || 'center'}`, dockView.revealed ? 'revealed' : '', expanded ? 'expanded' : '', capture ? 'recording' : '', mode === 'error' ? 'failure' : '', mode === 'success' ? 'success' : ''].filter(Boolean).join(' ');
  const body = mode === 'draft' ? draftMarkup() : mode === 'framing' ? framingMarkup() : capture ? captureMarkup() : mode === 'success' ? successMarkup() : mode === 'error' ? errorMarkup() : '';
  dockRoot.innerHTML = dockState.visible ? `<section class="${classes}" aria-label="Bloodline game dock">${compactBar()}${body}${collectionPicker()}${dockMenu()}</section>${reticleMarkup()}` : '';
  syncCaptureClock();
}

function syncCaptureClock() {
  if (captureClock) clearInterval(captureClock);
  captureClock = null;
  if (!dockState.capture?.startedAt || !['recording', 'matching'].includes(dockState.capture.state)) return;
  captureClock = setInterval(() => {
    const clock = document.querySelector('#capture-time');
    if (clock) clock.textContent = elapsedLabel(dockState.capture.startedAt);
  }, 500);
}

function setInteractive(next) {
  if (next === interactive) return;
  interactive = next;
  dockBridge.setInteractive(next);
}

function closeMenus() {
  dockView.picker = false;
  dockView.menu = '';
  dockView.help = false;
  dockView.query = '';
}

async function runCommand(type, payload = {}) {
  if (textInputActive) { textInputActive = false; dockBridge.setTextInput(false); }
  if (dockView.pending && ['quick-add', 'create-record', 'snapshot', 'live-capture', 'undo-create'].includes(type)) return;
  if (['quick-add', 'create-record', 'snapshot', 'live-capture', 'undo-create'].includes(type)) { dockView.pending = true; renderDock(); }
  try {
    const result = await dockBridge.command(type, payload);
    if (!result?.ok) {
      dockState = { ...dockState, mode: 'error', error: result?.error || 'The action could not be completed.' };
      renderDock();
    }
    return result;
  } finally {
    dockView.pending = false;
    renderDock();
  }
}

async function selectCommand(button) {
  const type = button.dataset.command;
  if (type === 'open-collections') { dockView.picker = !dockView.picker; dockView.menu = ''; dockView.query = ''; setDockRevealed(true); renderDock(); document.querySelector('#collection-filter')?.focus(); return; }
  if (type === 'toggle-menu') { dockView.menu = dockView.menu ? '' : 'menu'; dockView.picker = false; dockView.help = false; setDockRevealed(true); renderDock(); return; }
  if (type === 'help') { dockView.help = true; dockView.menu = ''; setDockRevealed(true); renderDock(); return; }
  if (type === 'close-menu') { closeMenus(); renderDock(); return; }
  if (type === 'select-collection') { dockView.picker = false; dockView.query = ''; await runCommand(type, { collection: button.dataset.collection }); return; }
  if (type === 'set-position') { dockView.menu = ''; await runCommand(type, { position: button.dataset.position }); return; }
  if (type === 'create-record') return runCommand(type, { frame: button.dataset.frame === 'true', name: document.querySelector('#character-name')?.value || '' });
  if (['cancel-draft', 'dismiss', 'cancel-capture'].includes(type)) { closeMenus(); setInteractive(false); return runCommand(type); }
  return runCommand(type);
}

function dockSourcePoint(clientX, clientY) {
  const display = dockDisplayGeometry();
  const scale = dockState.sourceSize.width / display.width;
  return { x: (clientX - display.x) * scale, y: (clientY - display.y) * scale };
}

function beginCrop(event) {
  if (dockState.capture || dockState.mode !== 'framing' || !dockState.crop || !dockState.sourceSize) return;
  const reticle = event.target.closest('#portrait-reticle');
  if (!reticle) return;
  event.preventDefault();
  reticle.setPointerCapture(event.pointerId);
  drag = {
    pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
    initialPointer: dockSourcePoint(event.clientX, event.clientY),
    crop: restoredCaptureCrop(dockState.crop, dockState.sourceSize.width, dockState.sourceSize.height),
    handle: event.target.dataset.cropHandle || '',
  };
}

function moveCrop(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const { width, height } = dockState.sourceSize;
  const scale = width / dockDisplayGeometry().width;
  const delta = { x: (event.clientX - drag.startX) * scale, y: (event.clientY - drag.startY) * scale };
  const pointer = { x: drag.initialPointer.x + delta.x, y: drag.initialPointer.y + delta.y };
  const crop = drag.handle
    ? resizeCaptureCrop(drag.crop, drag.handle, pointer, width, height, Math.max(32, Math.round(width / 40)))
    : moveCaptureCrop(drag.crop, delta.x, delta.y, width, height);
  dockState.crop = normalizedCaptureCrop(crop, width, height);
  const rect = cropRect();
  const reticle = document.querySelector('#portrait-reticle');
  if (reticle && rect) { reticle.style.setProperty('--crop-x', `${rect.x}px`); reticle.style.setProperty('--crop-y', `${rect.y}px`); reticle.style.setProperty('--crop-size', `${rect.size}px`); }
}

async function endCrop(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  drag = null;
  await runCommand('crop-change', { crop: dockState.crop });
}

function nudgeCrop(event) {
  if (dockState.capture || dockState.mode !== 'framing' || !dockState.crop) return;
  const { width, height } = dockState.sourceSize;
  const step = event.shiftKey ? 10 : 1;
  const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
  if (!delta && !['+', '=', '-', '_'].includes(event.key)) return;
  event.preventDefault();
  let crop = restoredCaptureCrop(dockState.crop, width, height);
  crop = delta ? moveCaptureCrop(crop, delta[0], delta[1], width, height) : resizeCaptureCropFromCenter(crop, ['+', '='].includes(event.key) ? step * 2 : -step * 2, width, height, Math.max(32, Math.round(width / 40)));
  dockState.crop = normalizedCaptureCrop(crop, width, height);
  renderDock();
  void runCommand('crop-change', { crop: dockState.crop });
}

dockRoot.addEventListener('click', (event) => {
  const button = event.target.closest('[data-command]');
  if (button) { event.preventDefault(); void selectCommand(button); return; }
  if (!event.target.closest('.popover')) { closeMenus(); renderDock(); }
});
dockRoot.addEventListener('pointerdown', (event) => {
  const input = event.target.closest('.dock-text-input');
  if (input) {
    event.preventDefault();
    textInputActive = true;
    dockBridge.setTextInput(true);
    setTimeout(() => input.focus(), 0);
    return;
  }
  beginCrop(event);
});
dockRoot.addEventListener('pointermove', moveCrop);
dockRoot.addEventListener('pointerup', (event) => { void endCrop(event); });
dockRoot.addEventListener('pointercancel', (event) => { void endCrop(event); });
dockRoot.addEventListener('keydown', (event) => {
  if (event.target.id === 'portrait-reticle') { nudgeCrop(event); return; }
  if (event.key === 'Escape') {
    event.preventDefault();
    if (textInputActive) { document.activeElement?.blur(); dockBridge.setTextInput(false); textInputActive = false; }
    if (dockView.picker || dockView.menu || dockView.help) { closeMenus(); renderDock(); }
    else if (dockState.mode === 'draft') void runCommand('cancel-draft');
    else if (dockState.capture) void runCommand('cancel-capture');
  }
  if (event.key === 'Enter' && event.target.id === 'character-name') {
    event.preventDefault();
    event.target.blur();
    if (dockState.dnaReady) void runCommand('create-record', { frame: true, name: event.target.value });
  }
});
dockRoot.addEventListener('input', (event) => {
  if (event.target.id === 'collection-filter') {
    dockView.query = event.target.value;
    const start = event.target.selectionStart;
    renderDock();
    const input = document.querySelector('#collection-filter');
    input?.focus();
    input?.setSelectionRange(start, start);
  }
});
dockRoot.addEventListener('focusin', (event) => {
  if (!event.target.matches('.dock-text-input')) return;
  textInputActive = true;
  dockBridge.setTextInput(true);
});
dockRoot.addEventListener('focusout', () => {
  setTimeout(() => {
    if (document.activeElement?.matches('.dock-text-input')) return;
    if (textInputActive) { textInputActive = false; dockBridge.setTextInput(false); }
  }, 0);
});
document.addEventListener('mousemove', (event) => {
  const target = document.elementFromPoint(event.clientX, event.clientY);
  setDockRevealed(Boolean(target?.closest('.dock')));
  setInteractive(Boolean(target?.closest('.dock, .reticle')));
});
document.addEventListener('mouseleave', () => { if (!drag) { setInteractive(false); setDockRevealed(false); } });
window.addEventListener('blur', () => { if (!drag) { setInteractive(false); setDockRevealed(false); } });
dockBridge.onState((nextState) => {
  const input = document.activeElement;
  const preserveName = input?.id === 'character-name';
  const preservePicker = input?.id === 'collection-filter';
  const name = preserveName ? input.value : '';
  dockState = { ...dockState, ...nextState };
  if (preserveName) dockState.characterName = name;
  renderDock();
  if (preserveName) { const field = document.querySelector('#character-name'); field?.focus(); field?.setSelectionRange(name.length, name.length); }
  if (preservePicker) document.querySelector('#collection-filter')?.focus();
  if (nextState.message || nextState.error) announcer.textContent = nextState.error || nextState.message;
});
dockBridge.ready();
