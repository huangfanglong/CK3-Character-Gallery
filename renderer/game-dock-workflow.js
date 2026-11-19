let dockWorkflow = null;
let dockCommandQueue = Promise.resolve();
let dockActiveCreate = null;

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

function dockCancellationError() {
  const error = new Error('Quick add was cancelled. Any saved character is kept.');
  error.name = 'AbortError';
  return error;
}

function dockOperationIsCurrent(operation) {
  return dockActiveCreate === operation && dockWorkflow === operation.workflow && !operation.controller.signal.aborted;
}

function publishDockOperationState(operation, patch) {
  if (!dockOperationIsCurrent(operation)) return Promise.resolve(false);
  return publishDockState(patch);
}

/* Saving is allowed to finish in the background so an already-written character is never
   deleted. The same creation promise is reused on retry, even after Cancel or a timeout. */
function waitForDockCreation(value, operation) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      operation.controller.signal.removeEventListener('abort', aborted);
      error ? reject(error) : resolve(result);
    };
    const aborted = () => finish(dockCancellationError());
    const timeout = setTimeout(() => finish(new Error('The archive did not finish saving in time. Any saved character is kept; try again.')), 15_000);
    operation.controller.signal.addEventListener('abort', aborted, { once: true });
    if (operation.controller.signal.aborted) aborted();
    else Promise.resolve(value).then((result) => finish(null, result)).catch((error) => finish(error));
  });
}

async function createFromDock(command) {
  if (state.modal || state.cropSession || state.captureSession) throw dockBusyError();
  const { draftId, dna, collection, gameHwnd } = command.payload;
  if (!draftId || !isValidCk3Dna(dna)) throw new Error('Copy valid CK3 DNA before creating this record.');
  const workflow = dockWorkflow?.draftId === draftId ? dockWorkflow : { draftId, characterId: null, creationPromise: null, lastCommand: null };
  dockWorkflow = workflow;
  const operation = { workflow, controller: new AbortController(), operationId: command.operationId };
  dockActiveCreate = operation;
  workflow.lastCommand = command;
  workflow.gameHwnd = gameHwnd;
  try {
    let character = dockWorkflowCharacter(workflow);
    if (!character) {
      if (!workflow.creationPromise) {
        workflow.creationPromise = createCharacterRecord({
          name: command.payload.name || '', dna, galleryName: collection, select: false,
        }).then((result) => {
          workflow.characterId = result.character.id;
          workflow.galleryName = result.galleryName;
          workflow.name = result.character.name;
          workflow.expectedModified = result.character.modified;
          return result;
        }).catch((error) => {
          if (!workflow.characterId) workflow.creationPromise = null;
          throw error;
        });
      }
      await waitForDockCreation(workflow.creationPromise, operation);
      character = dockWorkflowCharacter(workflow);
    }
    if (!character) throw new Error('The new character no longer exists.');
    if (!dockOperationIsCurrent(operation)) throw dockCancellationError();
    if (command.type === 'create-record' && command.payload.frame === false) {
      await publishDockOperationState(operation, dockSuccessState('DNA saved. You can add a portrait later.'));
      return { ok: true };
    }
    await publishDockOperationState(operation, { mode: 'framing', busy: true, message: 'Opening the CK3 capture stream…', error: '', dnaReady: true, dnaAttached: true });
    await startDockLiveCapture(workflow, gameHwnd, { signal: operation.controller.signal });
    if (!dockOperationIsCurrent(operation)) throw dockCancellationError();
    const capture = state.captureSession;
    if (!capture?.dock || capture.dockDraftId !== draftId || capture.phase !== 'ready') throw new Error(capture?.error || 'The CK3 capture stream is not ready.');
    await publishDockOperationState(operation, {
      mode: 'framing', busy: false, message: 'Frame the portrait, then choose Snapshot or Live portrait.',
      crop: capture.crop ? normalizedCaptureCrop(capture.crop, capture.video.videoWidth, capture.video.videoHeight) : null,
      sourceSize: { width: capture.video.videoWidth, height: capture.video.videoHeight },
      shortcut: capture.shortcut,
    });
    return { ok: true };
  } catch (error) {
    if (error?.name === 'AbortError' || !dockOperationIsCurrent(operation)) {
      void releaseDockCapture(draftId);
      return { ok: true, cancelled: true };
    }
    await releaseDockCapture(draftId);
    const detail = readableError(error, 'CK3 capture could not start.');
    const recovery = dockWorkflowCharacter(workflow) ? `${detail} The character and DNA are still saved.` : detail;
    await publishDockOperationState(operation, { mode: 'error', busy: false, capture: null, crop: null, error: recovery });
    return { ok: false, error: recovery };
  } finally {
    if (dockActiveCreate === operation) dockActiveCreate = null;
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
    if (error?.name === 'AbortError') return { ok: true, cancelled: true };
    const message = readableError(error, 'The dock action could not be completed.');
    if (dockWorkflow) await publishDockState({ mode: 'error', busy: false, error: message });
    return { ok: false, error: message };
  }
}

const dockCancelledOperations = new Set();

function retireDockOperation(operationId) {
  if (!operationId) return;
  dockCancelledOperations.add(operationId);
  if (dockCancelledOperations.size > 500) dockCancelledOperations.delete(dockCancelledOperations.values().next().value);
}

function handleGameDockCommand(command) {
  /* IPC listeners are ordered, but command execution is queued. A cancellation can
     therefore arrive before a forwarded command starts; retire that exact operation. */
  if (dockCancelledOperations.has(command.operationId)) return Promise.resolve({ ok: true, cancelled: true });
  const result = dockCommandQueue.then(() => dockCancelledOperations.has(command.operationId)
    ? { ok: true, cancelled: true }
    : processGameDockCommand(command));
  dockCommandQueue = result.catch(() => {});
  return result;
}

function cancelGameDockDraft({ draftId, reason = 'cancelled', operationIds = [] } = {}) {
  if (Array.isArray(operationIds)) operationIds.forEach(retireDockOperation);
  const operation = dockActiveCreate?.workflow.draftId === draftId ? dockActiveCreate : null;
  if (operation) {
    retireDockOperation(operation.operationId);
    dockActiveCreate = null;
    operation.controller.abort();
  }
  if (!draftId || dockWorkflow?.draftId !== draftId) return false;
  if (reason === 'cancelled') dockWorkflow.lastCommand = null;
  void releaseDockCapture(draftId);
  return true;
}

function handleGameDockGameLoss({ draftId }) {
  if (!cancelGameDockDraft({ draftId, reason: 'game-lost' })) return;
  void publishDockState({ mode: 'error', busy: false, capture: null, crop: null, error: 'CK3 is no longer in the foreground. The character and DNA are still saved.' });
}

function installGameDockBridge() {
  desktop?.onGameDockCommand?.((command) => {
    void handleGameDockCommand(command)
      .then((result) => desktop.completeGameDockCommand(command.operationId, result))
      .catch((error) => desktop.completeGameDockCommand(command.operationId, { ok: false, error: readableError(error, 'The dock action failed.') }));
  });
  desktop?.onGameDockCancel?.(cancelGameDockDraft);
  desktop?.onGameDockGameLoss?.(handleGameDockGameLoss);
  desktop?.onGameDockPreferences?.(receiveGameDockPreferences);
  if (desktop?.getGameDockPreferences) {
    void desktop.getGameDockPreferences().then(receiveGameDockPreferences).catch(() => {});
  }
  syncGameDockLibrary();
  syncLiveGameSelection();
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

let liveSelectionSignature = '';
let livePreferenceSaving = false;

function selectedLiveGameRecord() {
  if (state.preview || !state.activeId) return null;
  for (const gallery of state.galleries) {
    const character = gallery.characters.find((item) => item.id === state.activeId);
    if (!character) continue;
    const dna = typeof character.dna === 'string' ? character.dna.trim() : '';
    const geneCount = (dna.match(/(?:^|[\s{}])[a-z][a-z0-9_]{0,119}\s*=\s*\{[^{}]*\}/gi) || []).length;
    if (!Number.isFinite(character.modified) || geneCount < 20 || !/\bgenes\s*=\s*\{/.test(dna) || !isValidCk3Dna(dna)) return null;
    return { id: character.id, name: character.name, modified: character.modified, dna };
  }
  return null;
}

function syncLiveGameSelection() {
  if (!desktop?.syncLiveGameSelection) return;
  const selection = selectedLiveGameRecord();
  const signature = selection ? `${selection.id}:${selection.modified}:${selection.dna}` : '';
  if (signature === liveSelectionSignature) return;
  liveSelectionSignature = signature;
  void desktop.syncLiveGameSelection(selection).catch(() => { liveSelectionSignature = ''; });
}

async function setLiveGameLinkChoice(enabled, announce = true) {
  if (!desktop?.setLiveGameLinkChoice || livePreferenceSaving) return false;
  livePreferenceSaving = true;
  document.querySelectorAll('[data-action="live-link-accept"], [data-action="live-link-decline"]').forEach((button) => { button.disabled = true; });
  try {
    const liveLink = await desktop.setLiveGameLinkChoice(Boolean(enabled));
    receiveGameDockPreferences({ ...state.gameDockPreferences, liveLink });
    if (announce) showToast(enabled ? 'Live Game Link enabled. Focus CK3 and hover the dock to import or apply DNA.' : 'Live Game Link will stay off. You can enable it later in File.', 'success');
    return true;
  } catch (error) {
    showToast(readableError(error, 'The Live Game Link choice could not be saved.'), 'info');
    document.querySelectorAll('[data-action="live-link-accept"], [data-action="live-link-decline"]').forEach((button) => { button.disabled = false; });
    return false;
  } finally { livePreferenceSaving = false; }
}

async function setLiveGameLinkEnabled(enabled) {
  if (!desktop?.setLiveGameLinkEnabled) return showToast('Live Game Link requires the desktop app on Windows.', 'info');
  if (enabled) return setLiveGameLinkChoice(true);
  if (livePreferenceSaving) return false;
  livePreferenceSaving = true;
  try {
    const liveLink = await desktop.setLiveGameLinkEnabled(false);
    receiveGameDockPreferences({ ...state.gameDockPreferences, liveLink });
    showToast('Live Game Link disabled. Pending live previews were cancelled.', 'success');
    return true;
  } catch (error) {
    showToast(readableError(error, 'The Live Game Link setting could not be changed.'), 'info');
    return false;
  } finally { livePreferenceSaving = false; }
}
