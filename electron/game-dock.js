const dockRoot = document.querySelector('#game-dock');
const announcer = document.querySelector('#announcer');
const dockBridge = window.gameDock;
let dockState = { mode: 'compact', collections: [], collection: '', position: 'center', visible: false, capture: null, sound: true, liveEnabled: false, liveCanApply: false, liveApplySource: '', liveClipboardFormat: '', liveSelectedName: '', liveTargetAvailable: false, liveDetectedName: '', liveTargetName: '', liveUndoUntil: 0, liveApplyId: '', liveRetry: false, busy: false, commandEpoch: 0 };
let dockView = { picker: false, menu: '', help: false, query: '', pending: false, pendingCommand: null, revealed: false };
let commandSequence = 0;
let interactive = false;
let dockHovered = false;
let drag = null;
let captureClock = null;
let textInputActive = false;
let hitRegionFrame = null;
let hitRegionTimer = null;

function positionDraftCollectionPicker() {
  const picker = document.querySelector('.popover.draft-picker');
  const destination = document.querySelector('#draft-destination');
  const dock = document.querySelector('.dock');
  if (!picker || !destination || !dock) return;
  const dockRect = dock.getBoundingClientRect();
  const destinationRect = destination.getBoundingClientRect();
  const originX = dockRect.left + dock.clientLeft;
  const originY = dockRect.top + dock.clientTop;
  picker.style.top = `${destinationRect.bottom - originY + 6}px`;
  picker.style.left = `${destinationRect.left - originX}px`;
  picker.style.width = `${destinationRect.width}px`;
}

function sendNativeHitRegions() {
  positionDraftCollectionPicker();
  const regions = [];
  for (const element of dockRoot.querySelectorAll('.dock, .popover, .reticle:not(.locked)')) {
    let rect = element.getBoundingClientRect();
    if (element.classList.contains('dock') && ['compact', 'framing'].includes(dockState.mode)) {
      /* Reveal claims the final expanded footprint immediately. Compact collapse
         follows its animated bounds; framing immediately releases the departing
         panel so an invisible animated shell cannot intercept CK3 input. */
      const available = Math.max(120, window.innerWidth - 24);
      const restingWidth = dockState.mode === 'framing' ? Math.min(280, available) : rect.width;
      const width = dockView.revealed ? Math.min(680, available) : restingWidth;
      const x = dockView.revealed || dockState.mode === 'framing'
        ? dockState.position === 'left' ? 12 : dockState.position === 'right' ? window.innerWidth - width - 12 : (window.innerWidth - width) / 2
        : rect.x;
      const height = dockState.mode === 'framing'
        ? dockView.revealed ? Math.max(48, element.scrollHeight) : 8
        : dockView.revealed ? 48 : Math.max(8, rect.height);
      rect = { x, y: 0, width, height };
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
      cursor: !element.classList.contains('reticle'),
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
  const changed = dockView.revealed !== revealed;
  if (changed) {
    dockView.revealed = revealed;
    document.querySelector('.dock')?.classList.toggle('revealed', revealed);
    /* Framing is a retractable mode, not a permanently expanded dialog. Re-render
       only its panel; dockState and the independent crop surface stay untouched. */
    if (dockState.visible && dockState.mode === 'framing') renderDock();
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
  const draftPicker = dockView.pickerSource === 'draft' && dockState.mode === 'draft';
  return `<section class="popover ${draftPicker ? 'draft-picker' : ''}" role="dialog" aria-label="Choose destination collection"><div class="search-field"><input id="collection-filter" class="input dock-text-input" type="search" placeholder="Find a collection…" aria-label="Find a collection" value="${dockEscape(dockView.query)}" /></div><p class="popover-label">DESTINATION</p>${collections.map((name) => `<button class="collection-option ${name === dockState.collection ? 'selected' : ''}" data-command="select-collection" data-collection="${dockEscape(name)}"><span>${dockEscape(name)}</span>${name === dockState.collection ? dockIcon('check') : ''}</button>`).join('') || '<p class="empty-option">No matching collections.</p>'}</section>`;
}

function dockMenu() {
  if (dockView.help) return `<section class="popover menu" role="dialog" aria-label="Game dock help"><p class="popover-label">HOW IT WORKS</p><div class="help-copy"><p>Rest your pointer on the thin top strip to unfold the controls. Move away to tuck them back.</p><p><strong>1.</strong> Use CK3’s Copy DNA option, then choose <strong>Quick add</strong>.</p><p><strong>2.</strong> Name the character inline, then choose <strong>Create & frame</strong> or <strong>Save DNA only</strong>. Cancel before saving adds nothing.</p><p><strong>3.</strong> Move the square over the character. Drag corners to resize.</p><p><strong>Snapshot</strong> saves a PNG. <strong>Live portrait</strong> records WebM; press <strong>${dockEscape(shortcutLabel(dockState.shortcut))}</strong> to stop and find a smooth loop.</p><p><strong>Live Game Link:</strong> open a CK3 character window, then <strong>Import</strong> creates a draft with persistent DNA. Copy persistent or Base64 DNA, or select a gallery character with persistent DNA, then <strong>Apply</strong> writes it immediately. Clipboard DNA takes priority. Persistent DNA applies recognized genes by name, unknown genes are ignored and missing genes retain the character’s current values. Base64 stays positional and should match your game version and mods. After Apply, the dock immediately tucks away without a completion panel. Hover to use Undo within 18 seconds; each new Apply replaces the previous Undo and restarts its countdown. Import and Apply remain available during that countdown.</p><p>Keep app running. Clipboard text is checked only while a draft awaits DNA or the compact live controls are visible.</p></div><button class="menu-option" data-command="close-menu">Close help</button></section>`;
  if (dockView.menu !== 'menu') return '';
  return `<section class="popover menu" role="menu" aria-label="Game dock options"><p class="popover-label">DOCK POSITION</p>${['left', 'center', 'right'].map((position) => `<button class="menu-option" role="menuitem" data-command="set-position" data-position="${position}"><span>${position[0].toUpperCase()}${position.slice(1)}</span>${dockState.position === position ? dockIcon('check') : ''}</button>`).join('')}<div class="menu-separator"></div><button class="menu-option" role="menuitem" data-command="help">${dockIcon('help')}<span>How to use the dock</span></button><button class="menu-option danger" role="menuitem" data-command="disable-dock">Disable CK3 dock</button></section>`;
}

function brand() {
  return `<div class="brand"><span class="brand-mark" aria-hidden="true">B</span><span class="connection" aria-hidden="true"></span><span class="visually-hidden">CK3 connected</span></div>`;
}

function draftMarkup() {
  const ready = dockState.dnaReady;
  const pickerExpanded = dockView.picker && dockView.pickerSource === 'draft';
  const destinationDisabled = dockView.pending || dockState.busy || !dockState.collections.length;
  return `<div class="dock-body"><div class="dock-heading"><div><p class="eyebrow draft-title">New character</p></div><button class="icon-button" data-command="cancel-draft" aria-label="Cancel new character">${dockIcon('close')}</button></div><div class="draft-grid"><label class="field">Name (optional)<input id="character-name" class="input dock-text-input" maxlength="120" value="${dockEscape(dockState.characterName)}" placeholder="Unnamed character" /></label><div class="field"><label for="draft-destination">Destination</label><button type="button" id="draft-destination" class="input destination-button" data-command="open-collections" data-picker="draft" aria-haspopup="dialog" aria-expanded="${pickerExpanded}"${destinationDisabled ? ' disabled' : ''}><span>${dockEscape(dockState.collection || 'Choose collection')}</span>${dockIcon('chevron')}</button></div></div><div class="draft-actions"><p class="helper">${ready ? '' : 'No other clipboard text is shown or stored.'}</p><button class="text-button" data-command="cancel-draft">Cancel</button><button class="secondary-button" data-command="create-record" data-frame="false"${ready && !dockView.pending ? '' : ' disabled'}>Save DNA only</button><button class="primary-button" data-command="create-record" data-frame="true"${ready && !dockView.pending ? '' : ' disabled'}>${dockView.pending ? 'Creating…' : 'Create & frame'}</button></div></div>`;
}

function framingMarkup() {
  const capture = dockState.capture;
  const opening = dockState.busy || dockView.pending;
  const unavailable = capture || opening ? ' disabled' : '';
  return `<div class="dock-body" aria-busy="${opening}"><div class="dock-heading"><div><p class="eyebrow">${opening ? 'OPENING CK3 CAPTURE' : 'PORTRAIT FRAMING'}</p><h2>${dockEscape(dockState.characterName || 'New character')}</h2></div><button class="icon-button" data-command="cancel-draft" aria-label="Keep character and close quick add">${dockIcon('close')}</button></div><p class="helper">${opening ? 'This may take a few seconds. Keep & close preserves the character if it has already been saved.' : 'Drag the square to move it. Use its corners to resize. Everything outside remains in CK3.'}</p><div class="capture-actions" style="margin-top:14px"><button class="text-button" data-command="reset-crop"${unavailable}>Reset frame</button><span class="spacer"></span><button class="text-button" data-command="finish-without-portrait"${unavailable}>Skip portrait</button><button class="secondary-button" data-command="live-capture"${unavailable}>${dockIcon('record')} Live portrait</button><button class="primary-button" data-command="snapshot"${unavailable}>${dockIcon('camera')} Snapshot</button></div><button class="text-button" data-command="cancel-draft">Keep & close</button></div>`;
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

function errorMarkup() {
  const live = Boolean(dockState.liveRetry);
  return `<div class="dock-body"><div class="dock-heading"><div><p class="eyebrow">COULDN’T COMPLETE THAT</p><h2>${dockEscape(dockState.error || 'The archive did not respond.')}</h2></div><button class="icon-button" data-command="${live ? 'live-cancel' : 'dismiss'}" aria-label="Dismiss error">${dockIcon('close')}</button></div><div class="capture-actions"><button class="secondary-button" data-command="${live ? 'live-cancel' : 'dismiss'}">Dismiss</button><button class="primary-button" data-command="${live ? 'live-retry' : 'retry'}"${dockView.pending ? ' disabled' : ''}>Try again</button></div></div>`;
}

function compactBar() {
  const unavailable = dockView.pending || dockState.busy || !dockState.connected || dockState.mode !== 'compact';
  const destinationDisabled = dockView.pending || dockState.busy || !['compact', 'draft'].includes(dockState.mode);
  const targetName = dockState.liveDetectedName || 'the character open in CK3';
  const sourceName = dockState.liveApplySource === 'clipboard' ? `${dockState.liveClipboardFormat === 'base64' ? 'Base64' : 'Persistent'} clipboard DNA` : dockState.liveSelectedName;
  const quickAddTitle = dockState.quickAddReady ? 'Create a character from the DNA in your clipboard' : 'Copy persistent or Base64 DNA in CK3 to use Quick add';
  const importTitle = dockState.liveTargetAvailable ? `Import persistent DNA from ${targetName}` : 'Open a character window in CK3 to import DNA';
  const applyTitle = !dockState.liveTargetAvailable ? 'Open a character window in CK3 to apply DNA'
    : !dockState.liveCanApply ? 'Copy persistent or Base64 DNA, or select a gallery character with persistent DNA'
      : `Apply ${sourceName} to ${targetName} in CK3`;
  const liveControls = dockState.liveEnabled ? `<span class="divider"></span><button class="live-button live-import" data-command="live-import" title="${dockEscape(importTitle)}" aria-label="Import DNA from CK3"${unavailable || !dockState.liveTargetAvailable ? ' disabled' : ''}>${dockIcon('download')}<span>Import</span></button><button class="live-button live-apply" data-command="live-prepare-apply" title="${dockEscape(applyTitle)}" aria-label="Apply DNA to CK3"${unavailable || !dockState.liveTargetAvailable || !dockState.liveCanApply ? ' disabled' : ''}>${dockIcon('apply')}<span>Apply</span></button>` : '';
  const undoAvailable = dockState.liveEnabled && dockState.liveUndoUntil > Date.now();
  const undoSeconds = Math.max(0, Math.ceil((dockState.liveUndoUntil - Date.now()) / 1000));
  const undoTitle = `Undo the latest DNA application to ${dockState.liveTargetName}`;
  const undoControl = undoAvailable ? `<button class="secondary-button live-undo" data-command="live-undo" title="${dockEscape(undoTitle)}" aria-label="${dockEscape(undoTitle)}"${unavailable ? ' disabled' : ''}>Undo <span id="live-undo-time">${undoSeconds}</span>s</button>` : '';
  const dnaCopied = dockState.dnaReady || dockState.quickAddReady;
  return `<div class="dock-bar ${undoAvailable ? 'has-undo' : ''}">${brand()}<button class="collection-button" data-command="open-collections" aria-label="Destination: ${dockEscape(dockState.collection)}" aria-expanded="${dockView.picker}"${destinationDisabled ? ' disabled' : ''}><span>${dockEscape(dockState.collection || 'Choose collection')}</span>${dockIcon('chevron')}</button><span class="divider"></span><button class="live-button live-quick-add" data-command="quick-add" title="${dockEscape(quickAddTitle)}" aria-label="Quick add with clipboard DNA"${unavailable || !dockState.quickAddReady ? ' disabled' : ''}>${dockIcon('plus')}<span>Quick add</span></button>${liveControls}${undoControl}<span class="spacer"></span><span class="dna-state ${dnaCopied ? 'ready' : ''}">${dockState.liveImported ? 'Persistent DNA' : dnaCopied ? 'DNA copied' : ''}</span><button class="icon-button" data-command="toggle-menu" aria-label="More dock options" aria-expanded="${dockView.menu === 'menu'}">${dockIcon('more')}</button></div>`;
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

let dockHeightAnimation = null;
let deferredDockRender = false;
let deferredDockRenderTimer = null;

function scheduleDeferredDockRender() {
  if (!deferredDockRender || dockPointerDowns.size || deferredDockRenderTimer !== null) return;
  /* pointerup is followed by mouseup and click in the same input dispatch. Deferring
     one task preserves the pressed node until Chromium has chosen the click target. */
  deferredDockRenderTimer = setTimeout(() => {
    deferredDockRenderTimer = null;
    if (!dockPointerDowns.size) renderDock();
  }, 0);
}

function renderDock() {
  /* Replacing a pressed button before pointerup makes Chromium dispatch no click.
     Keep the existing controls for this short interval; command handlers revalidate
     current state, and the deferred render catches up immediately after the click. */
  if (dockState.visible && dockPointerDowns.size) {
    deferredDockRender = true;
    return;
  }
  deferredDockRender = false;
  const mode = dockState.mode;
  const capture = Boolean(dockState.capture) || ['recording', 'matching', 'saving'].includes(mode);
  const expanded = mode !== 'compact' && (mode !== 'framing' || dockView.revealed);
  const classes = ['dock', `position-${dockState.position || 'center'}`, `mode-${mode}`, dockView.revealed ? 'revealed' : '', expanded ? 'expanded' : '', capture ? 'recording' : '', mode === 'error' ? 'failure' : '', mode === 'success' ? 'success' : ''].filter(Boolean).join(' ');
  const body = mode === 'draft' ? draftMarkup() : mode === 'framing' ? framingMarkup() : capture ? captureMarkup() : mode === 'success' ? successMarkup() : mode === 'error' ? errorMarkup() : '';
  const previousDock = dockRoot.querySelector(':scope > .dock');
  const previousHeight = previousDock?.getBoundingClientRect().height || 0;
  const wasExpanded = previousDock?.classList.contains('expanded') || false;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reducedMotion && dockHeightAnimation) { dockHeightAnimation.cancel(); dockHeightAnimation = null; }
  if (!dockState.visible) {
    dockHeightAnimation?.cancel();
    dockHeightAnimation = null;
    dockRoot.innerHTML = '';
  } else {
    /* Keep the section alive so Apply uses the same CSS collapse as pointer exit.
       Replacing the whole node used to cancel every transition before it appeared. */
    const dock = previousDock || document.createElement('section');
    if (!previousDock) {
      dockRoot.innerHTML = '';
      dock.setAttribute('aria-label', 'Bloodline game dock');
      dockRoot.append(dock);
    }
    dock.className = classes;
    dock.innerHTML = `${compactBar()}${body}${collectionPicker()}${dockMenu()}`;
    dockRoot.querySelectorAll(':scope > .reticle').forEach((reticle) => reticle.remove());
    const reticle = reticleMarkup();
    dock.insertAdjacentHTML('afterend', reticle);
    const nextHeight = dock.getBoundingClientRect().height;
    /* CSS cannot interpolate to an expanded panel's auto height. Measure that target
       and animate mode changes plus framing's hover collapse. Compact Apply remains
       a native CSS transition; recording's crop surface opens without height motion. */
    if (previousDock && (wasExpanded || expanded) && (!reticle || mode === 'framing') && Math.abs(nextHeight - previousHeight) > .5 && !reducedMotion) {
      dockHeightAnimation?.cancel();
      const animation = dock.animate([
        { height: `${previousHeight}px` },
        { height: `${nextHeight}px` },
      ], { duration: 200, easing: 'cubic-bezier(.2, .8, .2, 1)' });
      dockHeightAnimation = animation;
      animation.onfinish = () => { if (dockHeightAnimation === animation) dockHeightAnimation = null; };
      animation.oncancel = () => { if (dockHeightAnimation === animation) dockHeightAnimation = null; };
    }
  }
  syncCaptureClock();
  syncNativeHitRegions();
}

function syncCaptureClock() {
  if (captureClock) clearInterval(captureClock);
  captureClock = null;
  const recording = dockState.capture?.startedAt && ['recording', 'matching'].includes(dockState.capture.state);
  const undo = dockState.liveUndoUntil > Date.now();
  if (!recording && !undo) return;
  captureClock = setInterval(() => {
    if (recording) {
      const clock = document.querySelector('#capture-time');
      if (clock) clock.textContent = elapsedLabel(dockState.capture.startedAt);
    }
    if (dockState.liveUndoUntil) {
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

function setDockHovered(next) {
  const hovered = Boolean(next);
  if (hovered === dockHovered) return;
  dockHovered = hovered;
  dockBridge.setHover(hovered);
}

function closeMenus() {
  dockView.picker = false;
  dockView.menu = '';
  dockView.help = false;
  dockView.query = '';
}

function collapseDockAfterApply() {
  closeMenus();
  dockView.pending = false;
  dockView.pendingCommand = null;
  if (dockRoot.contains(document.activeElement)) document.activeElement.blur();
  setDockRevealed(false);
  setInteractive(false);
}

function focusDraftName() {
  const field = document.querySelector('#character-name');
  if (!field || dockState.mode !== 'draft') return;
  field.focus({ preventScroll: true });
  field.select();
}

async function runCommand(type, payload = {}) {
  if (textInputActive) { textInputActive = false; dockBridge.setTextInput(false); }
  const blocking = ['quick-add', 'create-record', 'snapshot', 'live-capture', 'undo-create', 'live-import', 'live-prepare-apply', 'live-undo', 'live-retry'];
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
      if (type === 'quick-add') focusDraftName();
    }
  }
}

async function selectCommand(button) {
  const type = button.dataset.command;
  if (type === 'open-collections') {
    const nameField = document.querySelector('#character-name');
    if (nameField) dockState.characterName = nameField.value;
    const opening = !dockView.picker;
    dockView.picker = opening;
    dockView.pickerSource = opening && button.dataset.picker === 'draft' ? 'draft' : 'bar';
    dockView.menu = '';
    dockView.query = '';
    setDockRevealed(true);
    renderDock();
    document.querySelector('#collection-filter')?.focus();
    return;
  }
  if (type === 'toggle-menu') { dockView.menu = dockView.menu ? '' : 'menu'; dockView.picker = false; dockView.help = false; setDockRevealed(true); renderDock(); return; }
  if (type === 'help') { dockView.help = true; dockView.menu = ''; setDockRevealed(true); renderDock(); return; }
  if (type === 'close-menu') { closeMenus(); renderDock(); return; }
  if (type === 'select-collection') {
    dockState = { ...dockState, collection: button.dataset.collection };
    closeMenus();
    renderDock();
    await runCommand(type, { collection: button.dataset.collection });
    return;
  }
  if (type === 'set-position') { dockView.menu = ''; await runCommand(type, { position: button.dataset.position }); return; }
  if (type === 'create-record') { closeMenus(); return runCommand(type, { frame: button.dataset.frame === 'true', name: document.querySelector('#character-name')?.value || '', collection: dockState.collection }); }
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
  const input = event.target.closest('.dock-text-input');
  /* Text fields keep live rendering for search filtering and state updates. Only
     controls whose pressed element must survive through click dispatch block it. */
  if (event.button === 0 && !input) dockPointerDowns.add(event.pointerId);
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
function dockCommandSignature(button) {
  return JSON.stringify(Object.keys(button?.dataset || {}).sort().map((key) => [key, button.dataset[key]]));
}

dockRoot.addEventListener('pointermove', (event) => {
  pruneDockPointerState();
  const reticle = event.target.closest('#portrait-reticle');
  if (!event.buttons) {
    const button = event.target.closest('[data-command]');
    const enabled = button && !button.disabled ? button : null;
    dockPointerHovers.set(event.pointerId, {
      button: enabled,
      signature: enabled ? dockCommandSignature(enabled) : '',
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
  scheduleDeferredDockRender();
  const hover = dockPointerHovers.get(event.pointerId);
  dockPointerHovers.delete(event.pointerId);
  cropHover = null;
  void endCrop(event);
  if (hadPointerDown || event.button !== 0) return;
  const button = event.target.closest('[data-command]');
  if (!button || button.disabled || hover?.signature !== dockCommandSignature(button) || now > hover.until
    || Math.abs(event.clientX - hover.x) > 4 || Math.abs(event.clientY - hover.y) > 4) return;
  /* An inactive focusable:false Electron window answers WM_MOUSEACTIVATE with
     MA_NOACTIVATEANDEAT. Dispatch an orphaned release only when this pointer just
     hovered the same logical command and payload. A state render may have replaced
     its element; a drag that began in CK3 still has no dock hover and remains input. */
  releasedPointerClicks.set(event.pointerId, { x: event.clientX, y: event.clientY, until: now + 750 });
  event.preventDefault();
  void selectCommand(button);
});
dockRoot.addEventListener('pointercancel', (event) => {
  dockPointerDowns.delete(event.pointerId);
  scheduleDeferredDockRender();
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
    else if (dockState.liveRetry) void runCommand('live-cancel');
    else if (dockState.capture) void runCommand('cancel-capture');
  }
  if (event.key === 'Enter' && event.target.id === 'character-name') {
    event.preventDefault();
    event.target.blur();
    if (dockState.dnaReady) { closeMenus(); void runCommand('create-record', { frame: true, name: event.target.value, collection: dockState.collection }); }
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
function withinDockStrip(event) {
  if (!['compact', 'framing'].includes(dockState.mode)) return false;
  const available = Math.max(0, window.innerWidth - 24);
  const width = dockView.revealed ? Math.min(680, available) : Math.min(280, Math.max(120, available));
  const left = dockState.position === 'left' ? 12 : dockState.position === 'right' ? window.innerWidth - width - 12 : (window.innerWidth - width) / 2;
  const height = dockView.revealed ? 48 : 8;
  return event.clientX >= left && event.clientX < left + width && event.clientY >= 0 && event.clientY < height;
}

function dockPointerTargets(event) {
  const target = document.elementFromPoint(event.clientX, event.clientY);
  /* Only the narrow resting strip reveals the dock. Once revealed, the entire
     expanded footprint remains interactive and protected from game edge-panning. */
  const overDock = Boolean(target?.closest('.dock')) || withinDockStrip(event);
  return { overDock, overSurface: overDock || Boolean(target?.closest('.reticle')) };
}

document.addEventListener('mousemove', (event) => {
  if (!event.buttons) {
    dockPointerDowns.clear();
    scheduleDeferredDockRender();
  }
  const targets = dockPointerTargets(event);
  setDockRevealed(targets.overDock);
  setDockHovered(targets.overDock);
  setInteractive(targets.overSurface);
});
document.addEventListener('mouseleave', (event) => {
  /* Windows can emit a synthetic leave at the same coordinates when the native
     click-through flag or dock mode changes. Check the actual expanded controls,
     not only the compact strip, before treating it as a real departure. */
  const targets = dockPointerTargets(event);
  setDockHovered(targets.overDock);
  if (!drag && !targets.overSurface) { setInteractive(false); setDockRevealed(false); }
});
window.addEventListener('blur', () => {
  dockPointerDowns.clear();
  scheduleDeferredDockRender();
  setDockHovered(false);
  if (!drag) { setInteractive(false); setDockRevealed(false); }
});
dockBridge.onState((nextState) => {
  if (!nextState.visible) {
    dockPointerDowns.clear();
    setDockHovered(false);
  }
  const input = document.activeElement;
  const preserveName = input?.id === 'character-name';
  const preservePicker = input?.id === 'collection-filter';
  /* Destination selection publishes a fresh dock state, but it must not replace a
     locally edited draft name with the name originally imported from CK3. */
  const preserveDraftName = dockView.pickerSource === 'draft' && dockState.mode === 'draft' && nextState.mode === 'draft';
  const name = preserveName ? input.value : dockState.characterName;
  const selection = preserveName ? { start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection } : null;
  const newLiveApply = nextState.mode === 'compact' && Boolean(nextState.liveApplyId) && nextState.liveApplyId !== dockState.liveApplyId;
  if (((Number(nextState.commandEpoch) || 0) !== (Number(dockState.commandEpoch) || 0))
    || (nextState.mode === 'error' && dockView.pendingCommand?.type?.startsWith('live-'))) {
    /* The service publishes a terminal error before its IPC reply reaches the
       renderer. Both Dismiss and Try again become available at that terminal state. */
    dockView.pending = false;
    dockView.pendingCommand = null;
  }
  /* Every completed Apply returns immediately to the resting strip. The compact
     controls still contain the latest Undo deadline and never block the next action. */
  if (newLiveApply) collapseDockAfterApply();
  dockState = { ...dockState, ...nextState };
  if (preserveName || preserveDraftName) dockState.characterName = name;
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
