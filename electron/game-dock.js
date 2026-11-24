const dockRoot = document.querySelector('#game-dock');
const announcer = document.querySelector('#announcer');
const dockBridge = window.gameDock;
let dockState = { mode: 'compact', collections: [], collection: '', position: 'center', visible: false, capture: null, sound: true, liveEnabled: false, liveCanApply: false, liveApplySource: '', liveClipboardFormat: '', liveSelectedName: '', liveTargetAvailable: false, liveDetectedName: '', liveTargetName: '', liveReport: '', liveUndoUntil: 0, liveRetry: false, busy: false, commandEpoch: 0 };
let dockView = { picker: false, menu: '', help: false, query: '', pending: false, pendingCommand: null, revealed: false };
let commandSequence = 0;
let interactive = false;
let drag = null;
let captureClock = null;
let textInputActive = false;
let hitRegionFrame = null;
let hitRegionTimer = null;

function sendNativeHitRegions() {
  const regions = [];
  for (const element of dockRoot.querySelectorAll('.dock, .popover, .reticle:not(.locked)')) {
    let rect = element.getBoundingClientRect();
    if (element.classList.contains('dock') && dockState.mode === 'compact' && dockView.revealed) {
      /* Claim the final compact bounds as reveal starts, not only after its CSS
         transition. Otherwise a fast pointer leaves the temporary native region.
         During collapse, retain the element's animated bounds instead: native
         window shapes clip rendering too, so forcing 6px here hides the exit. */
      const available = Math.max(120, window.innerWidth - 24);
      const width = Math.min(680, available);
      const x = dockState.position === 'left' ? 12 : dockState.position === 'right' ? window.innerWidth - width - 12 : (window.innerWidth - width) / 2;
      rect = { x, y: 0, width, height: 48 };
    }
    if (!(rect.width > 0 && rect.height > 0)) continue;
    /* Include crop handles outside the reticle and its label below. These are real
       native hit regions, so their clickable area must include the visible border. */
    const padding = element.classList.contains('reticle') ? 10 : 1;
    const labelSpace = element.classList.contains('reticle') ? 24 : 0;
    regions.push({
      x: Math.floor(rect.x) - padding,
      y: Math.floor(rect.y) - padding,
      width: Math.ceil(rect.width) + padding * 2,
      height: Math.ceil(rect.height) + padding * 2 + labelSpace,
    });
  }
  dockBridge.setHitRegions(regions);
}

function syncNativeHitRegions() {
  sendNativeHitRegions();
  if (hitRegionFrame !== null) cancelAnimationFrame(hitRegionFrame);
  if (hitRegionTimer !== null) clearTimeout(hitRegionTimer);
  hitRegionFrame = requestAnimationFrame(() => { hitRegionFrame = null; sendNativeHitRegions(); });
  /* Reveal and height transitions must not leave a stale narrow or short region. */
  hitRegionTimer = setTimeout(() => { hitRegionTimer = null; sendNativeHitRegions(); }, 300);
}

function setDockRevealed(next) {
  const pinned = dockView.picker || Boolean(dockView.menu) || dockView.help || dockView.pending || textInputActive;
  const revealed = Boolean(next || pinned);
  if (dockView.revealed !== revealed) {
    dockView.revealed = revealed;
    document.querySelector('.dock')?.classList.toggle('revealed', revealed);
  }
  syncNativeHitRegions();
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
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.7 9a2.4 2.4 0 0 1 4.6 1c0 2-2.3 2-2.3 4M12 17h.01"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M5 20h14"/>',
    apply: '<path d="M12 21V9m-5 5 5-5 5 5M5 4h14"/>',
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
  if (dockView.help) return `<section class="popover menu" role="dialog" aria-label="Game dock help"><p class="popover-label">HOW IT WORKS</p><div class="help-copy"><p>Rest your pointer on the thin top strip to unfold the controls. Move away to tuck them back.</p><p><strong>1.</strong> Use CK3’s Copy DNA option, then choose <strong>Quick add</strong>.</p><p><strong>2.</strong> Move the square over the character. Drag corners to resize.</p><p><strong>Snapshot</strong> saves a PNG. <strong>Live portrait</strong> records WebM; press <strong>${dockEscape(shortcutLabel(dockState.shortcut))}</strong> to stop and find a smooth loop.</p><p><strong>Live Game Link:</strong> open a CK3 character window, then <strong>Import</strong> creates a draft with persistent DNA. Copy persistent or Base64 DNA, or select a gallery character with persistent DNA, then <strong>Apply</strong> previews and confirms the write. Clipboard DNA takes priority. Persistent DNA applies recognized genes by name, unknown genes are ignored and missing genes retain the character’s current values. Base64 stays positional and should match your game version and mods. Undo is available briefly.</p><p>Keep app running. Clipboard text is checked only while a draft awaits DNA or the compact live controls are visible.</p></div><button class="menu-option" data-command="close-menu">Close help</button></section>`;
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
  const opening = dockState.busy || dockView.pending;
  const unavailable = capture || opening ? ' disabled' : '';
  return `<div class="dock-body" aria-busy="${opening}"><div class="dock-heading"><div><p class="eyebrow">${opening ? 'OPENING CK3 CAPTURE' : 'PORTRAIT FRAMING'}</p><h2>${dockEscape(dockState.characterName || 'New character')}</h2></div><button class="icon-button" data-command="cancel-draft" aria-label="Cancel quick add; keep the saved character">${dockIcon('close')}</button></div><p class="helper">${opening ? 'This may take a few seconds. Cancel keeps the character if it has already been saved.' : 'Drag the square to move it. Use its corners to resize. Everything outside remains in CK3.'}</p><div class="capture-actions" style="margin-top:14px"><button class="text-button" data-command="reset-crop"${unavailable}>Reset frame</button><span class="spacer"></span><button class="text-button" data-command="finish-without-portrait"${unavailable}>Skip portrait</button><button class="secondary-button" data-command="live-capture"${unavailable}>${dockIcon('record')} Live portrait</button><button class="primary-button" data-command="snapshot"${unavailable}>${dockIcon('camera')} Snapshot</button></div><button class="text-button" data-command="cancel-draft">Cancel quick add</button></div>`;
}

function captureMarkup() {
  const capture = dockState.capture || {};
  const recording = capture.state === 'recording';
  const matching = capture.state === 'matching';
  const label = recording ? 'Recording live portrait' : matching ? 'Finding a smooth loop' : capture.state === 'saving' ? 'Saving portrait' : 'Preparing capture';
  const detail = recording ? `Press ${dockEscape(shortcutLabel(dockState.shortcut))} to stop` : matching ? 'Press again to finish now' : 'Keep CK3 visible for a moment';
  return `<div class="dock-body"><div class="capture-state"><span class="capture-indicator"></span><div class="capture-copy"><strong>${label}</strong><span>${detail}</span></div><span class="spacer"></span><time class="capture-time" id="capture-time">${elapsedLabel(capture.startedAt)}</time>${recording || matching ? `<button class="primary-button danger-button" data-command="toggle-capture">${matching ? 'Finish now' : 'Stop'}</button>` : ''}<button class="icon-button" data-command="cancel-capture" aria-label="Cancel capture">${dockIcon('close')}</button></div></div>`;
}

function successMarkup() {
  return `<div class="dock-body"><div class="capture-state"><span class="success-mark">${dockIcon('check')}</span><div class="capture-copy"><strong>Saved to ${dockEscape(dockState.collection)}</strong><span>${dockEscape(dockState.message || `${dockState.characterName} is in your archive.`)}</span></div></div><div class="success-actions" style="margin-top:14px"><button class="text-button" data-command="undo-create"${dockState.undoUntil > Date.now() ? '' : ' disabled'}>Undo</button><span class="spacer"></span><button class="secondary-button" data-command="view-gallery">View in gallery</button><button class="primary-button" data-command="dismiss">Done</button></div></div>`;
}

function liveConfirmMarkup() {
  const clipboard = dockState.liveApplySource === 'clipboard';
  const sourceName = clipboard ? `${dockState.liveClipboardFormat === 'base64' ? 'Base64' : 'Persistent'} clipboard DNA` : dockState.liveSelectedName;
  return `<div class="dock-body live-confirm" aria-busy="${dockState.busy}"><div class="dock-heading"><div><p class="eyebrow">LIVE GAME LINK · CONFIRM APPLY</p><h2>Replace this character’s DNA?</h2></div><button class="icon-button" data-command="live-cancel" aria-label="Cancel DNA apply"${dockState.busy ? ' disabled' : ''}>${dockIcon('close')}</button></div><div class="live-mapping"><div><small>${clipboard ? 'FROM CLIPBOARD' : 'FROM YOUR GALLERY'}</small><strong>${dockEscape(sourceName)}</strong></div><span aria-hidden="true">→</span><div><small>OPEN IN CK3</small><strong>${dockEscape(dockState.liveTargetName)}</strong></div></div><p class="live-report">${dockEscape(dockState.liveReport)}</p><p class="helper">Hair, beard, clothing, and other special appearance entries are excluded. This changes the running CK3 session; review the character before saving your game.</p><div class="capture-actions live-actions"><button class="text-button" data-command="live-cancel"${dockState.busy ? ' disabled' : ''}>Cancel</button><button class="primary-button" data-command="live-confirm-apply"${dockState.busy || dockView.pending ? ' disabled' : ''}>${dockState.busy ? 'Applying & verifying…' : 'Apply DNA to CK3'}</button></div></div>`;
}

function liveResultMarkup() {
  const canUndo = dockState.liveUndoUntil > Date.now();
  const seconds = Math.max(0, Math.ceil((dockState.liveUndoUntil - Date.now()) / 1000));
  return `<div class="dock-body live-result" aria-busy="${dockState.busy}"><div class="capture-state"><span class="success-mark">${dockIcon('check')}</span><div class="capture-copy"><strong>${canUndo ? `DNA applied to ${dockEscape(dockState.liveTargetName)}` : 'Live Game Link complete'}</strong><span>${dockEscape(dockState.message)}</span></div></div><div class="success-actions live-actions">${canUndo ? `<button class="secondary-button" data-command="live-undo"${dockState.busy || dockView.pending ? ' disabled' : ''}>${dockState.busy ? 'Restoring…' : `Undo (<span id="live-undo-time">${seconds}</span>s)`}</button>` : ''}<span class="spacer"></span><button class="primary-button" data-command="live-cancel"${dockState.busy ? ' disabled' : ''}>Done</button></div></div>`;
}

function errorMarkup() {
  const live = Boolean(dockState.liveRetry);
  return `<div class="dock-body"><div class="dock-heading"><div><p class="eyebrow">COULDN’T COMPLETE THAT</p><h2>${dockEscape(dockState.error || 'The archive did not respond.')}</h2></div><button class="icon-button" data-command="${live ? 'live-cancel' : 'dismiss'}" aria-label="Dismiss error">${dockIcon('close')}</button></div><div class="capture-actions"><button class="secondary-button" data-command="${live ? 'live-cancel' : 'dismiss'}">Dismiss</button><button class="primary-button" data-command="${live ? 'live-retry' : 'retry'}"${dockView.pending ? ' disabled' : ''}>Try again</button></div></div>`;
}

function compactBar() {
  const unavailable = dockView.pending || dockState.busy || !dockState.connected || dockState.mode !== 'compact';
  const destinationDisabled = dockView.pending || dockState.busy || !['compact', 'draft'].includes(dockState.mode);
  const targetName = dockState.liveDetectedName || 'the character open in CK3';
  const sourceName = dockState.liveApplySource === 'clipboard' ? `${dockState.liveClipboardFormat === 'base64' ? 'Base64' : 'Persistent'} clipboard DNA` : dockState.liveSelectedName;
  const importTitle = dockState.liveTargetAvailable ? `Import persistent DNA from ${targetName}` : 'Open a character window in CK3 to import DNA';
  const applyTitle = !dockState.liveTargetAvailable ? 'Open a character window in CK3 to apply DNA'
    : !dockState.liveCanApply ? 'Copy persistent or Base64 DNA, or select a gallery character with persistent DNA'
      : `Apply ${sourceName} to ${targetName} in CK3`;
  const liveControls = dockState.liveEnabled ? `<span class="divider"></span><button class="live-button live-import" data-command="live-import" title="${dockEscape(importTitle)}" aria-label="Import DNA from CK3"${unavailable || !dockState.liveTargetAvailable ? ' disabled' : ''}>${dockIcon('download')}<span>Import</span></button><button class="live-button live-apply" data-command="live-prepare-apply" title="${dockEscape(applyTitle)}" aria-label="Apply DNA to CK3"${unavailable || !dockState.liveTargetAvailable || !dockState.liveCanApply ? ' disabled' : ''}>${dockIcon('apply')}<span>Apply</span></button>` : '';
  return `<div class="dock-bar">${brand()}<button class="collection-button" data-command="open-collections" aria-label="Destination: ${dockEscape(dockState.collection)}" aria-expanded="${dockView.picker}"${destinationDisabled ? ' disabled' : ''}><span>${dockEscape(dockState.collection || 'Choose collection')}</span>${dockIcon('chevron')}</button><span class="divider"></span><button class="primary-button" data-command="quick-add"${unavailable ? ' disabled' : ''}>${dockIcon('plus')} Quick add</button>${liveControls}<span class="spacer"></span><span class="dna-state ${dockState.dnaReady ? 'ready' : ''}"><span class="dna-dot"></span>${dockState.liveImported ? 'Persistent DNA' : dockState.dnaReady ? 'DNA copied' : 'CK3 ready'}</span><button class="icon-button" data-command="toggle-menu" aria-label="More dock options" aria-expanded="${dockView.menu === 'menu'}">${dockIcon('more')}</button></div>`;
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
  const body = mode === 'draft' ? draftMarkup() : mode === 'framing' ? framingMarkup() : capture ? captureMarkup() : mode === 'success' ? successMarkup() : mode === 'live-confirm' ? liveConfirmMarkup() : mode === 'live-result' ? liveResultMarkup() : mode === 'error' ? errorMarkup() : '';
  dockRoot.innerHTML = dockState.visible ? `<section class="${classes}" aria-label="Bloodline game dock">${compactBar()}${body}${collectionPicker()}${dockMenu()}</section>${reticleMarkup()}` : '';
  syncCaptureClock();
  syncNativeHitRegions();
}

function syncCaptureClock() {
  if (captureClock) clearInterval(captureClock);
  captureClock = null;
  const recording = dockState.capture?.startedAt && ['recording', 'matching'].includes(dockState.capture.state);
  const undo = dockState.mode === 'live-result' && dockState.liveUndoUntil > Date.now();
  if (!recording && !undo) return;
  captureClock = setInterval(() => {
    if (recording) {
      const clock = document.querySelector('#capture-time');
      if (clock) clock.textContent = elapsedLabel(dockState.capture.startedAt);
    }
    if (dockState.mode === 'live-result') {
      if (dockState.liveUndoUntil <= Date.now()) { dockState.liveUndoUntil = 0; renderDock(); }
      else {
        const clock = document.querySelector('#live-undo-time');
        if (clock) clock.textContent = String(Math.ceil((dockState.liveUndoUntil - Date.now()) / 1000));
      }
    }
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
  const blocking = ['quick-add', 'create-record', 'snapshot', 'live-capture', 'undo-create', 'live-import', 'live-prepare-apply', 'live-confirm-apply', 'live-undo', 'live-retry'];
  if (dockView.pending && blocking.includes(type)) return;
  const operation = { id: ++commandSequence, type };
  if (blocking.includes(type)) {
    dockView.pending = true;
    dockView.pendingCommand = operation;
    renderDock();
  } else if (type === 'live-cancel' && dockView.pendingCommand?.type?.startsWith('live-')) {
    /* An error may arrive before the original Import IPC has settled. Cancellation
       owns the panel immediately; that operation's identity check rejects its late
       reply instead of allowing it to reopen or relock the error. Confirmed writes
       keep their disabled Cancel controls and service-side verification guard. */
    dockView.pending = false;
    dockView.pendingCommand = null;
    renderDock();
  }
  try {
    const result = await dockBridge.command(type, payload);
    const current = !blocking.includes(type) || dockView.pendingCommand === operation;
    if (current && !result?.ok && !result?.cancelled) {
      dockState = { ...dockState, mode: 'error', error: result?.error || 'The action could not be completed.' };
      renderDock();
    }
    return result;
  } finally {
    /* A late timeout or completion belongs only to its own command. It cannot unlock,
       re-render, or overwrite a newer draft's pending state. */
    if (dockView.pendingCommand === operation) {
      dockView.pending = false;
      dockView.pendingCommand = null;
      renderDock();
    }
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

function beginCrop(event, origin = null) {
  if (dockState.capture || dockState.mode !== 'framing' || !dockState.crop || !dockState.sourceSize) return;
  const reticle = event.target.closest('#portrait-reticle');
  if (!reticle) return;
  event.preventDefault();
  reticle.setPointerCapture(event.pointerId);
  const startX = origin?.x ?? event.clientX;
  const startY = origin?.y ?? event.clientY;
  drag = {
    pointerId: event.pointerId, startX, startY,
    initialPointer: dockSourcePoint(startX, startY),
    crop: restoredCaptureCrop(dockState.crop, dockState.sourceSize.width, dockState.sourceSize.height),
    handle: origin?.handle ?? (event.target.dataset.cropHandle || ''),
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
  sendNativeHitRegions();
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

const dockPointerDowns = new Set();
const dockPointerHovers = new Map();
const releasedPointerClicks = new Map();
let cropHover = null;

function pruneDockPointerState(now = performance.now()) {
  for (const [pointerId, hover] of dockPointerHovers) if (now > hover.until) dockPointerHovers.delete(pointerId);
  for (const [pointerId, click] of releasedPointerClicks) if (now > click.until) releasedPointerClicks.delete(pointerId);
}

dockRoot.addEventListener('click', (event) => {
  pruneDockPointerState();
  const released = releasedPointerClicks.get(event.pointerId);
  if (released && Math.abs(event.clientX - released.x) <= 2 && Math.abs(event.clientY - released.y) <= 2) {
    /* Some Windows/Chromium combinations still synthesize click after an orphaned
       pointer-up. Suppress only the click from that same physical pointer. */
    releasedPointerClicks.delete(event.pointerId);
    event.preventDefault();
    return;
  }
  releasedPointerClicks.delete(event.pointerId);
  const button = event.target.closest('[data-command]');
  if (button) { event.preventDefault(); void selectCommand(button); return; }
  if (event.target.closest('.dock-text-input')) return;
  if (!event.target.closest('.popover')) { closeMenus(); renderDock(); }
});
dockRoot.addEventListener('pointerdown', (event) => {
  releasedPointerClicks.delete(event.pointerId);
  dockPointerHovers.delete(event.pointerId);
  if (event.button === 0) dockPointerDowns.add(event.pointerId);
  const input = event.target.closest('.dock-text-input');
  if (input) {
    /* Native focus must be requested, but Chromium still owns caret placement and
       drag-selection. Cancelling pointerdown made the field look read-only. */
    textInputActive = true;
    dockBridge.setTextInput(true);
    if (document.activeElement !== input) input.focus({ preventScroll: true });
    return;
  }
  beginCrop(event);
});
dockRoot.addEventListener('pointermove', (event) => {
  pruneDockPointerState();
  const reticle = event.target.closest('#portrait-reticle');
  if (!event.buttons) {
    const button = event.target.closest('[data-command]');
    dockPointerHovers.set(event.pointerId, {
      button: button && !button.disabled ? button : null,
      x: event.clientX, y: event.clientY, until: performance.now() + 750,
    });
    cropHover = reticle ? {
      pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      handle: event.target.dataset.cropHandle || '',
    } : null;
  } else {
    dockPointerHovers.delete(event.pointerId);
    if (!drag && (event.buttons & 1) && !dockPointerDowns.has(event.pointerId)
      && reticle && cropHover?.pointerId === event.pointerId) {
      /* WM_MOUSEACTIVATE can eat the crop's pointer-down while its later moves still
         carry the primary button. Recover from the last hover so the first movement
         and the originally hovered corner are not lost. A drag that began in CK3 has
         no crop hover and remains game input. */
      beginCrop(event, cropHover);
      if (drag) dockPointerDowns.add(event.pointerId);
    }
  }
  moveCrop(event);
});
dockRoot.addEventListener('pointerout', (event) => {
  if (!event.relatedTarget) dockPointerHovers.delete(event.pointerId);
  if (event.target.closest('#portrait-reticle') && !event.relatedTarget?.closest?.('#portrait-reticle')) cropHover = null;
});
dockRoot.addEventListener('pointerup', (event) => {
  const now = performance.now();
  pruneDockPointerState(now);
  const hadPointerDown = dockPointerDowns.delete(event.pointerId);
  const hover = dockPointerHovers.get(event.pointerId);
  dockPointerHovers.delete(event.pointerId);
  cropHover = null;
  void endCrop(event);
  if (hadPointerDown || event.button !== 0) return;
  const button = event.target.closest('[data-command]');
  if (!button || button.disabled || hover?.button !== button || now > hover.until
    || Math.abs(event.clientX - hover.x) > 4 || Math.abs(event.clientY - hover.y) > 4) return;
  /* An inactive focusable:false Electron window answers WM_MOUSEACTIVATE with
     MA_NOACTIVATEANDEAT. Dispatch an orphaned release only when this pointer just
     hovered the same button; a drag that began in CK3 remains game input. */
  releasedPointerClicks.set(event.pointerId, { x: event.clientX, y: event.clientY, until: now + 750 });
  event.preventDefault();
  void selectCommand(button);
});
dockRoot.addEventListener('pointercancel', (event) => {
  dockPointerDowns.delete(event.pointerId);
  dockPointerHovers.delete(event.pointerId);
  releasedPointerClicks.delete(event.pointerId);
  cropHover = null;
  void endCrop(event);
});
dockRoot.addEventListener('keydown', (event) => {
  if (event.target.id === 'portrait-reticle') { nudgeCrop(event); return; }
  if (event.key === 'Escape') {
    event.preventDefault();
    if (textInputActive) { document.activeElement?.blur(); dockBridge.setTextInput(false); textInputActive = false; }
    if (dockView.picker || dockView.menu || dockView.help) { closeMenus(); renderDock(); }
    else if (dockState.mode === 'draft') void runCommand('cancel-draft');
    else if (['live-confirm', 'live-result'].includes(dockState.mode) || dockState.liveRetry) void runCommand('live-cancel');
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
    /* Moving from the name field to a button is still interaction inside the dock.
       Returning CK3's native focus here changes the window between pointer-down and
       pointer-up, so Chromium drops the click. runCommand restores focus after the
       button's click has been delivered; a genuinely external focus loss still exits
       text editing here. */
    if (document.hasFocus() && dockRoot.contains(document.activeElement)) return;
    if (textInputActive) { textInputActive = false; dockBridge.setTextInput(false); }
  }, 0);
});
function withinRevealedCompactDock(event) {
  if (dockState.mode !== 'compact' || !dockView.revealed) return false;
  const width = Math.min(680, Math.max(0, window.innerWidth - 24));
  const left = dockState.position === 'left' ? 12 : dockState.position === 'right' ? window.innerWidth - width - 12 : (window.innerWidth - width) / 2;
  return event.clientX >= left && event.clientX < left + width && event.clientY >= 0 && event.clientY < 48;
}

function dockPointerTargets(event) {
  const target = document.elementFromPoint(event.clientX, event.clientY);
  /* Removing click-through can immediately dispatch another mousemove before the
     expansion transition has enlarged the DOM hit box. Use the final compact bounds
     during that transition so the same pointer cannot collapse its own menu. */
  const overDock = Boolean(target?.closest('.dock')) || withinRevealedCompactDock(event);
  return { overDock, overSurface: overDock || Boolean(target?.closest('.reticle')) };
}

document.addEventListener('mousemove', (event) => {
  if (!event.buttons) dockPointerDowns.clear();
  const targets = dockPointerTargets(event);
  setDockRevealed(targets.overDock);
  setInteractive(targets.overSurface);
});
document.addEventListener('mouseleave', (event) => {
  /* Windows can emit a synthetic leave at the same coordinates when the native
     click-through flag or dock mode changes. Check the actual expanded controls,
     not only the compact strip, before treating it as a real departure. */
  if (!drag && !dockPointerTargets(event).overSurface) { setInteractive(false); setDockRevealed(false); }
});
window.addEventListener('blur', () => { dockPointerDowns.clear(); if (!drag) { setInteractive(false); setDockRevealed(false); } });
dockBridge.onState((nextState) => {
  const input = document.activeElement;
  const preserveName = input?.id === 'character-name';
  const preservePicker = input?.id === 'collection-filter';
  const name = preserveName ? input.value : '';
  const selection = preserveName ? { start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection } : null;
  if (((Number(nextState.commandEpoch) || 0) !== (Number(dockState.commandEpoch) || 0))
    || (nextState.mode === 'error' && dockView.pendingCommand?.type?.startsWith('live-'))) {
    /* The service publishes a terminal error before its IPC reply reaches the
       renderer. Both Dismiss and Try again become available at that terminal state. */
    dockView.pending = false;
    dockView.pendingCommand = null;
  }
  dockState = { ...dockState, ...nextState };
  if (preserveName) dockState.characterName = name;
  renderDock();
  if (preserveName) {
    const field = document.querySelector('#character-name');
    field?.focus({ preventScroll: true });
    field?.setSelectionRange(selection.start, selection.end, selection.direction);
  }
  if (preservePicker) document.querySelector('#collection-filter')?.focus();
  if (nextState.message || nextState.error) announcer.textContent = nextState.error || nextState.message;
});
dockBridge.ready();
