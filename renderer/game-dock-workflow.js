let dockWorkflow = null;
let dockCommandQueue = Promise.resolve();

function publishDockState(patch = {}) {
  const workflow = dockWorkflow;
  const character = workflow ? characterForPortraitTarget(workflow) : null;
  const statePatch = {
    collections: state.preview ? ['Default'] : state.galleries.map((gallery) => gallery.name),
    collection: workflow?.galleryName || (state.preview ? 'Default' : state.activeGallery),
    draftId: workflow?.draftId || null,
    characterId: workflow?.characterId || null,
    characterName: character?.name || workflow?.name || '',
    ...patch,
  };
  return desktop?.updateGameDock?.(statePatch) || Promise.resolve(false);
}

function dockWorkflowCharacter(workflow = dockWorkflow) {
  return characterForPortraitTarget(workflow);
}

function dockBusyError() {
  return new Error('Finish or cancel the open gallery editor or capture before using the CK3 dock.');
}

function dockSuccessState(message = 'Character and DNA saved.') {
  return { mode: 'success', capture: null, crop: null, sourceSize: null, message, error: '', undoUntil: Date.now() + 12_000, busy: false, dnaReady: true, dnaAttached: true };
}

async function createFromDock(command) {
  if (state.modal || state.cropSession || state.captureSession) throw dockBusyError();
  const { draftId, dna, collection, gameHwnd } = command.payload;
  if (!draftId || !isValidCk3Dna(dna)) throw new Error('Copy valid CK3 DNA before creating this record.');
  if (dockWorkflow && dockWorkflow.draftId !== draftId) dockWorkflow = null;
  const existing = dockWorkflow?.draftId === draftId ? dockWorkflowCharacter(dockWorkflow) : null;
  const result = existing
    ? { character: existing, galleryName: dockWorkflow.galleryName }
    : await createCharacterRecord({
      name: command.payload.name || '',
      dna,
      galleryName: collection,
      select: false,
    });
  dockWorkflow = {
    draftId,
    characterId: result.character.id,
    galleryName: result.galleryName,
    name: result.character.name,
    expectedModified: existing ? dockWorkflow.expectedModified : result.character.modified,
    gameHwnd,
    lastCommand: command,
  };
  if (command.type === 'create-record' && command.payload.frame === false) {
    await publishDockState(dockSuccessState('DNA saved. You can add a portrait later.'));
    return { ok: true };
  }
  await publishDockState({ mode: 'framing', busy: true, message: 'Opening the CK3 capture stream…', error: '', dnaReady: true, dnaAttached: true });
  try {
    await startDockLiveCapture(dockWorkflow, gameHwnd);
    const capture = state.captureSession;
    if (!capture?.dock || capture.phase !== 'ready') throw new Error(capture?.error || 'The CK3 capture stream is not ready.');
    await publishDockState({
      mode: 'framing', busy: false, message: 'Frame the portrait, then choose Snapshot or Live portrait.',
      crop: capture.crop ? normalizedCaptureCrop(capture.crop, capture.video.videoWidth, capture.video.videoHeight) : null,
      sourceSize: { width: capture.video.videoWidth, height: capture.video.videoHeight },
      shortcut: capture.shortcut,
    });
    return { ok: true };
  } catch (error) {
    if (state.captureSession?.dock) await releaseDockCapture();
    await publishDockState({ mode: 'error', busy: false, capture: null, crop: null, error: readableError(error, 'CK3 capture could not start. The character and DNA are still saved.') });
    return { ok: false, error: readableError(error, 'CK3 capture could not start.') };
  }
}

async function undoFromDock(command) {
  if (!dockWorkflow || dockWorkflow.draftId !== command.payload.draftId || !dockWorkflow.characterId) throw new Error('This quick-add is no longer available to undo.');
  if (state.modal && !state.captureSession?.dock) throw dockBusyError();
  if (state.captureSession?.dock) await releaseDockCapture();
  const character = dockWorkflowCharacter();
  if (!character) throw new Error('The new character no longer exists. Nothing was undone.');
  const removed = await removeCreatedCharacter({ characterId: character.id, galleryName: dockWorkflow.galleryName, expectedModified: dockWorkflow.expectedModified });
  await cleanupUnusedPortraits(removed.imagePaths);
  state.favorites.delete(character.id);
  state.imageUrls.delete(character.id);
  dockWorkflow = null;
  await publishDockState({ mode: 'compact', draftId: null, characterId: null, characterName: '', capture: null, crop: null, sourceSize: null, dnaReady: false, dnaAttached: false, undoUntil: 0, message: 'Quick-add undone.', error: '' });
  return { ok: true };
}

async function captureDockSnapshot(workflow) {
  const capture = state.captureSession;
  const character = dockWorkflowCharacter(workflow);
  if (!capture?.dock || capture.phase !== 'ready' || !character) throw new Error('The CK3 portrait frame is not ready.');
  if (hasMaximumPortraits(character)) throw new Error(`This character already has ${MAX_PORTRAIT_VARIANTS} portrait variants.`);
  capture.phase = 'snapshotting';
  await publishDockState({ mode: 'capture', capture: { state: 'saving' }, busy: true, message: 'Saving portrait…', error: '' });
  let selected = null;
  try {
    if (!drawLiveCaptureFrame(capture)) throw new Error('Wait for a visible CK3 frame, then try Snapshot again.');
    selected = await desktop.saveCroppedImage(character.id, { dataUrl: capture.canvas.toDataURL('image/png'), x: 0, y: 0, size: 450 });
    const saved = await appendPortrait(character, selected, 'Portrait and DNA saved.', true);
    if (!saved) throw new Error('The portrait could not be added to the archive.');
    dockWorkflow.expectedModified = character.modified;
    await releaseDockCapture();
    await publishDockState(dockSuccessState('Portrait and DNA saved.'));
  } catch (error) {
    if (selected && !character.images?.includes(selected.path)) await cleanupUnusedPortraits([selected.path]);
    if (state.captureSession === capture) await releaseDockCapture();
    throw error;
  }
}

async function captureFromDock(command) {
  const capture = state.captureSession;
  if (!dockWorkflow || capture?.dockDraftId !== dockWorkflow.draftId) throw new Error('This portrait session is no longer active. The character and DNA are still saved.');
  if (command.type === 'snapshot') {
    await captureDockSnapshot(dockWorkflow);
    return { ok: true };
  }
  if (['live-capture', 'toggle-capture'].includes(command.type)) {
    await toggleLiveCapture(capture.sessionId);
    return { ok: true };
  }
  if (command.type === 'cancel-capture') {
    await releaseDockCapture();
    dockWorkflow.lastCommand = null;
    await publishDockState(dockSuccessState('Capture cancelled. The character and DNA are still saved.'));
    return { ok: true };
  }
  throw new Error('That capture action is not available.');
}

async function processGameDockCommand(command) {
  try {
    if (command.type === 'quick-add' || command.type === 'create-record') return await createFromDock(command);
    if (command.type === 'undo-create') return await undoFromDock(command);
    if (['snapshot', 'live-capture', 'toggle-capture', 'cancel-capture'].includes(command.type)) return await captureFromDock(command);
    if (!dockWorkflow || dockWorkflow.draftId !== command.payload.draftId) throw new Error('This dock draft has expired. Start a new quick-add.');
    if (command.type === 'crop-change') {
      updateDockCaptureCrop(command.payload.crop);
      return { ok: true };
    }
    if (command.type === 'reset-crop') {
      resetDockCaptureCrop();
      return { ok: true };
    }
    if (command.type === 'finish-without-portrait') {
      if (state.captureSession?.dock) await releaseDockCapture();
      await publishDockState(dockSuccessState('Character and DNA saved.'));
      return { ok: true };
    }
    if (command.type === 'view-gallery') {
      if (state.modal || state.captureSession) throw dockBusyError();
      const character = dockWorkflowCharacter();
      if (!character) throw new Error('The character no longer exists.');
      bindCharacterGallery(character.id);
      resetSelection(character.id);
      render();
      return { ok: true };
    }
    if (command.type === 'retry') {
      if (!dockWorkflow.lastCommand) throw new Error('There is no failed action to retry.');
      return await processGameDockCommand(dockWorkflow.lastCommand);
    }
    throw new Error('The requested dock action is not available.');
  } catch (error) {
    const message = readableError(error, 'The dock action could not be completed.');
    if (dockWorkflow) await publishDockState({ mode: 'error', busy: false, error: message });
    return { ok: false, error: message };
  }
}

function handleGameDockCommand(command) {
  if (dockWorkflow && ['quick-add', 'create-record'].includes(command.type)) dockWorkflow.lastCommand = command;
  const result = dockCommandQueue.then(() => processGameDockCommand(command));
  dockCommandQueue = result.catch(() => {});
  return result;
}

function handleGameDockGameLoss({ draftId }) {
  if (state.captureSession?.dock && state.captureSession.dockDraftId === draftId) {
    void cancelLiveCapture('CK3 is no longer in the foreground. The character and DNA are still saved.');
  }
}

function installGameDockBridge() {
  desktop?.onGameDockCommand?.((command) => {
    void handleGameDockCommand(command)
      .then((result) => desktop.completeGameDockCommand(command.operationId, result))
      .catch((error) => desktop.completeGameDockCommand(command.operationId, { ok: false, error: readableError(error, 'The dock action failed.') }));
  });
  desktop?.onGameDockGameLoss?.(handleGameDockGameLoss);
  desktop?.onGameDockPreferences?.((preferences) => {
    state.gameDockPreferences = preferences;
    renderChrome();
  });
  if (desktop?.getGameDockPreferences) {
    void desktop.getGameDockPreferences().then((preferences) => {
      state.gameDockPreferences = preferences;
      renderChrome();
    }).catch(() => {});
  }
  syncGameDockLibrary();
}

async function setGameDockEnabled(enabled) {
  if (!desktop?.setGameDockEnabled) return showToast('The CK3 game dock requires the desktop app on Windows.', 'info');
  try {
    const started = await desktop.setGameDockEnabled(Boolean(enabled));
    state.gameDockPreferences = await desktop.getGameDockPreferences();
    renderChrome();
    if (enabled && !started) return showToast('The CK3 dock could not start. Use a supported Windows session and try again.', 'info');
    showToast(enabled ? 'CK3 game dock enabled. Focus CK3 to use it.' : 'CK3 game dock disabled.', 'success');
    return true;
  } catch (error) {
    showToast(readableError(error, 'The CK3 dock setting could not be changed.'), 'info');
    return false;
  }
}

function showGameDockHelp() {
  state.modal = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="game-dock-guide-title"><button class="modal-close" data-action="close-modal" aria-label="Close game dock guide">${icon('close')}</button><p class="eyebrow">CK3 GAME DOCK</p><h2 id="game-dock-guide-title">Add a character without leaving CK3</h2><p class="modal-copy">Keep Bloodline running, then focus CK3. The dock appears as a thin strip at the top of windowed or borderless games. Hover over it to unfold the controls; move away to tuck them back.</p><ol class="modal-copy"><li>Choose a destination collection in the dock.</li><li>Use CK3’s Copy DNA option, then choose <strong>Quick add</strong>. If needed, the draft detects the copied DNA automatically.</li><li>Move or resize the square over the character. <strong>Snapshot</strong> saves a 450 × 450 PNG.</li><li><strong>Live portrait</strong> records a 450 × 450 WebM. Press Ctrl + Alt + G in CK3 to start or stop; Smart Loop then finds a smooth loop.</li></ol><p class="modal-copy">The dock reads clipboard text only for Quick add or a visible draft awaiting DNA. It does not retain clipboard history. Exclusive fullscreen may hide external overlays; use borderless mode if that happens. Closing Bloodline closes the dock.</p><div class="modal-actions"><button class="primary-button" data-action="close-modal">Got it</button></div></div></div>`;
  render('modal');
  document.querySelector('.modal [data-action="close-modal"]')?.focus();
}

function syncGameDockLibrary() {
  if (!desktop?.syncGameDockLibrary) return;
  const collections = state.preview ? [{ name: 'Default' }] : state.galleries.map((gallery) => ({ name: gallery.name }));
  void desktop.syncGameDockLibrary(collections).catch(() => {});
}
