const LIVE_CAPTURE_COMMAND_LABEL = /mac/i.test(navigator.platform || '') ? 'Cmd' : 'Ctrl';
const LIVE_CAPTURE_SHORTCUTS = [
  ['CommandOrControl+Alt+G', `${LIVE_CAPTURE_COMMAND_LABEL} + Alt + G`],
  ['CommandOrControl+Shift+G', `${LIVE_CAPTURE_COMMAND_LABEL} + Shift + G`],
  ['CommandOrControl+Alt+R', `${LIVE_CAPTURE_COMMAND_LABEL} + Alt + R`],
  ['CommandOrControl+Shift+R', `${LIVE_CAPTURE_COMMAND_LABEL} + Shift + R`],
];
const LIVE_CAPTURE_CROP_STORAGE_KEY = 'ck3-live-capture-crops-v1';

async function showLiveCaptureModal() {
  const character = getActiveCharacter();
  const gallery = getGallery();
  if (!character || !gallery || state.preview || state.captureSession) return;
  if (hasMaximumPortraits(character)) return showToast(`This character already has ${MAX_PORTRAIT_VARIANTS} portrait variants.`, 'info');
  state.captureSession = { characterId: character.id, galleryName: gallery.name, sources: [], selectedSourceId: null, stream: null, phase: 'loading', frames: 0, encodedFrames: 0, droppedFrames: 0, timer: null, durationTimer: null, sessionId: null, shortcut: LIVE_CAPTURE_SHORTCUTS[0][0], crop: null, recordingCrop: null, canvas: null, outputCanvas: null, outputFrameRequest: null, previewResizeObserver: null, previewResizeListener: null, previewResources: null, encoder: null, recordingError: null, drawMode: false };
  const capture = state.captureSession;
  renderLiveCaptureModal();
  try {
    const sources = await desktop.listCaptureSources();
    if (state.captureSession !== capture) return;
    capture.sources = sources;
    capture.phase = sources.length ? 'select-source' : 'empty';
  } catch (error) {
    if (state.captureSession !== capture) return;
    capture.phase = 'error'; capture.error = readableError(error, 'CK3 windows could not be listed.');
  }
  renderLiveCaptureModal();
}

async function refreshLiveCaptureSources() {
  const capture = state.captureSession;
  if (!capture) return;
  capture.phase = 'loading'; renderLiveCaptureModal();
  try {
    const sources = await desktop.listCaptureSources();
    if (state.captureSession !== capture) return;
    capture.sources = sources;
    capture.phase = capture.sources.length ? 'select-source' : 'empty';
  } catch (error) {
    if (state.captureSession !== capture) return;
    capture.phase = 'error'; capture.error = readableError(error, 'CK3 windows could not be listed.');
  }
  renderLiveCaptureModal();
}

function liveCaptureShortcutLabel(shortcut) {
  return LIVE_CAPTURE_SHORTCUTS.find(([value]) => value === shortcut)?.[1] || shortcut;
}

function liveCaptureDuration(elapsedMs) {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function liveCaptureRecordingStatus(capture) {
  const elapsed = capture.startedAt ? Math.min(LIVE_CAPTURE_MAX_DURATION_MS, performance.now() - capture.startedAt) : 0;
  const dropped = capture.droppedFrames ? ` · ${capture.droppedFrames} dropped` : '';
  return `Recording ${liveCaptureDuration(elapsed)} / ${liveCaptureDuration(LIVE_CAPTURE_MAX_DURATION_MS)} · ${capture.encodedFrames} frames${dropped}. Press ${liveCaptureShortcutLabel(capture.shortcut)} in CK3 to stop.`;
}

function liveCaptureCharacter(capture) {
  return state.galleries.find((gallery) => gallery.name === capture?.galleryName)?.characters.find((character) => character.id === capture?.characterId) || null;
}

function reportLiveCaptureStatus(capture, status) {
  if (!capture?.sessionId || !desktop?.setCaptureStatus) return Promise.resolve(false);
  return desktop.setCaptureStatus(capture.sessionId, status).catch(() => false);
}

function renderLiveCaptureModal() {
  const capture = state.captureSession;
  if (!capture) return;
  const sources = capture.sources.map((source) => `<button class="capture-source ${source.id === capture.selectedSourceId ? 'selected' : ''}" data-capture-source="${escapeHtml(source.id)}"><img src="${source.thumbnail}" alt=""/><span>${escapeHtml(source.name)}</span></button>`).join('');
  const shortcutOptions = LIVE_CAPTURE_SHORTCUTS.map(([value, label]) => `<option value="${value}"${capture.shortcut === value ? ' selected' : ''}>${label}</option>`).join('');
  const canFrame = capture.phase === 'ready';
  const shortcutLocked = !['loading', 'select-source', 'empty', 'error'].includes(capture.phase);
  const status = capture.phase === 'loading' ? 'Looking for an open Crusader Kings III window.'
    : capture.phase === 'empty' ? 'No visible Crusader Kings III window was found. Start CK3 in borderless or windowed mode, then refresh.'
      : capture.phase === 'error' ? capture.error
        : capture.phase === 'starting' ? 'Opening the selected CK3 window.'
        : capture.phase === 'starting-recording' ? 'Starting the high-quality video encoder.'
          : capture.phase === 'finishing' ? 'Encoding and saving the live portrait.'
          : capture.phase === 'recording' ? liveCaptureRecordingStatus(capture)
          : capture.phase === 'ready' ? `Frame the portrait, then press ${liveCaptureShortcutLabel(capture.shortcut)} in CK3 to start recording.`
            : capture.error || 'Choose the visible Crusader Kings III window to capture.';
  const framingDisabled = canFrame ? '' : ' disabled';
  const preview = ['starting', 'ready', 'starting-recording', 'recording', 'finishing', 'completing'].includes(capture.phase)
    ? `<div class="capture-workspace"><div><div class="capture-preview" id="capture-preview"><video id="capture-video" autoplay muted playsinline></video><div class="capture-selection" id="capture-selection" role="group" tabindex="0" aria-label="Portrait recording frame. Drag to move, use corner handles to resize, or use arrow keys to nudge."><div class="capture-selection-grid" aria-hidden="true"><span></span><span></span><span></span><span></span></div><span class="capture-handle north-west" data-capture-handle="north-west" aria-hidden="true"></span><span class="capture-handle north-east" data-capture-handle="north-east" aria-hidden="true"></span><span class="capture-handle south-east" data-capture-handle="south-east" aria-hidden="true"></span><span class="capture-handle south-west" data-capture-handle="south-west" aria-hidden="true"></span></div></div><div class="capture-frame-tools"><button class="outline-button" data-action="capture-draw" aria-pressed="false"${framingDisabled}>Draw new frame</button><button class="outline-button" data-action="capture-center"${framingDisabled}>Center</button><button class="outline-button" data-action="capture-reset"${framingDisabled}>Reset</button><span>Drag frame to move · corners to resize</span></div></div><aside class="capture-output-panel"><p class="eyebrow">RECORDED OUTPUT</p><canvas id="capture-output" width="450" height="450" role="img" aria-label="Live preview of the 450 by 450 recorded portrait"></canvas><span>450 × 450 WebM</span></aside></div><details class="capture-precision"><summary>Precision controls</summary><div><label>X <input data-capture-coordinate="x" type="number" min="0" step="1"${framingDisabled}/></label><label>Y <input data-capture-coordinate="y" type="number" min="0" step="1"${framingDisabled}/></label><label>Size <input data-capture-coordinate="size" type="number" min="1" step="1"${framingDisabled}/></label><span>Arrow keys: 1 px · Shift: 10 px · +/-: resize</span></div></details>`
    : `<div class="capture-sources">${sources || '<p class="variant-empty">No CK3 window available.</p>'}</div>`;
  const primary = capture.phase === 'empty' ? '<button class="outline-button" data-action="capture-refresh">Refresh</button>'
    : capture.phase === 'recording' ? '<button class="danger-button" data-action="capture-stop">Stop recording</button>' : '';
  state.modal = `<div class="modal-backdrop" ${modalPreserveAttribute('capture')}><div class="capture-modal" role="dialog" aria-modal="true" aria-labelledby="capture-title"><div class="modal-head"><div><p class="eyebrow">LIVE CK3 PORTRAIT</p><h2 id="capture-title">Capture ${escapeHtml(liveCaptureCharacter(capture)?.name || 'portrait')}</h2></div><button class="modal-close" data-action="close-modal" aria-label="Close live capture">${icon('close')}</button></div><p class="modal-copy">Capture the visible CK3 window. Keep it unobscured; borderless or windowed mode is recommended.</p><label class="capture-shortcut">Recording hotkey<select id="capture-shortcut"${shortcutLocked ? ' disabled' : ''}>${shortcutOptions}</select></label>${preview}<div class="capture-footer"><span id="capture-status" aria-live="polite">${escapeHtml(status)}</span><div><button class="outline-button" data-action="close-modal">Cancel</button>${primary}</div></div></div></div>`;
  render('modal');
  if (capture.stream) initializeLiveCapturePreview();
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => {
    const modal = document.querySelector('.capture-modal');
    if (state.captureSession !== capture || !modal || modal.contains(document.activeElement)) return;
    const target = capture.phase === 'ready' ? modal.querySelector('#capture-selection')
      : capture.phase === 'select-source' ? modal.querySelector('[data-capture-source]')
        : modal.querySelector('#capture-shortcut:not(:disabled), .modal-close');
    target?.focus({ preventScroll: true });
  });
}

function trapLiveCaptureFocus(event) {
  if (!state.captureSession || event.key !== 'Tab') return false;
  const modal = document.querySelector('.capture-modal');
  if (!modal) return false;
  const focusable = [...modal.querySelectorAll('button:not(:disabled), select:not(:disabled), input:not(:disabled), summary, [tabindex="0"]')]
    .filter((element) => element.getClientRects().length);
  if (!focusable.length) return false;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!modal.contains(document.activeElement) || (!event.shiftKey && document.activeElement === last) || (event.shiftKey && document.activeElement === first)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
    return true;
  }
  return false;
}

async function selectLiveCaptureSource(sourceId) {
  const capture = state.captureSession;
  if (!capture || capture.phase !== 'select-source' || !capture.sources.some((source) => source.id === sourceId)) return;
  capture.phase = 'starting';
  capture.error = '';
  renderLiveCaptureModal();
  let sessionId = null;
  let stream = null;
  try {
    const armed = await desktop.armCapture(sourceId, capture.shortcut);
    sessionId = armed.sessionId;
    if (state.captureSession !== capture || capture.phase !== 'starting') {
      await desktop.releaseCapture(sessionId).catch(() => {});
      return;
    }
    capture.selectedSourceId = sourceId;
    capture.sessionId = sessionId;
    capture.shortcut = armed.shortcut;
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: LIVE_CAPTURE_FPS }, audio: false });
    if (state.captureSession !== capture || capture.phase !== 'starting') {
      stream.getTracks().forEach((track) => track.stop());
      await desktop.releaseCapture(sessionId).catch(() => {});
      return;
    }
    capture.stream = stream;
    stream.getVideoTracks()[0].addEventListener('ended', () => {
      if (state.captureSession === capture && ['starting', 'ready', 'starting-recording', 'recording'].includes(capture.phase)) void cancelLiveCapture('CK3 window capture ended.');
    }, { once: true });
    renderLiveCaptureModal();
    await waitForLiveCapturePreview(capture);
    if (state.captureSession !== capture || capture.phase !== 'starting') {
      stream.getTracks().forEach((track) => track.stop());
      await desktop.releaseCapture(sessionId).catch(() => {});
      return;
    }
    capture.phase = 'ready';
    await reportLiveCaptureStatus(capture, { state: 'armed' });
    renderLiveCaptureModal();
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop());
    const failure = readableError(error, 'CK3 capture could not start.');
    if (sessionId) await desktop.releaseCapture(sessionId, state.captureSession === capture ? failure : '').catch(() => {});
    if (state.captureSession !== capture) return;
    capture.sessionId = null;
    capture.phase = 'select-source';
    capture.error = failure;
    renderLiveCaptureModal();
  }
}

function waitForLiveCapturePreview(capture) {
  const video = document.querySelector('#capture-video');
  if (!video) return Promise.reject(new Error('CK3 capture preview could not start.'));
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('CK3 capture preview timed out.')), 5000);
    video.addEventListener('loadeddata', () => { clearTimeout(timeout); resolve(); }, { once: true });
    video.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('CK3 capture preview could not be decoded.')); }, { once: true });
  });
}

function setLiveCaptureShortcut(shortcut) {
  const capture = state.captureSession;
  if (!capture || !['loading', 'select-source', 'empty', 'error'].includes(capture.phase) || !LIVE_CAPTURE_SHORTCUTS.some(([value]) => value === shortcut)) return;
  capture.shortcut = shortcut;
  capture.error = '';
  const status = document.querySelector('#capture-status');
  if (status && capture.phase === 'select-source') status.textContent = 'Choose the visible Crusader Kings III window to capture.';
}

function savedLiveCaptureCrop(videoWidth, videoHeight) {
  try {
    const parsed = JSON.parse(localStorage.getItem(LIVE_CAPTURE_CROP_STORAGE_KEY) || '{}');
    const crops = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    return restoredCaptureCrop(crops[`${videoWidth}x${videoHeight}`], videoWidth, videoHeight);
  } catch {
    try { localStorage.removeItem(LIVE_CAPTURE_CROP_STORAGE_KEY); } catch {}
    return null;
  }
}

function rememberLiveCaptureCrop(crop, videoWidth, videoHeight) {
  try {
    const parsed = JSON.parse(localStorage.getItem(LIVE_CAPTURE_CROP_STORAGE_KEY) || '{}');
    const crops = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    const key = `${videoWidth}x${videoHeight}`;
    crops[key] = normalizedCaptureCrop(crop, videoWidth, videoHeight);
    localStorage.setItem(LIVE_CAPTURE_CROP_STORAGE_KEY, JSON.stringify(crops));
  } catch {
    try {
      localStorage.removeItem(LIVE_CAPTURE_CROP_STORAGE_KEY);
      localStorage.setItem(LIVE_CAPTURE_CROP_STORAGE_KEY, JSON.stringify({
        [`${videoWidth}x${videoHeight}`]: normalizedCaptureCrop(crop, videoWidth, videoHeight),
      }));
    } catch { /* Storage can be unavailable in hardened renderer sessions. */ }
  }
}

function minimumLiveCaptureCrop(videoWidth) {
  return Math.max(32, Math.round(videoWidth / 40));
}

function commitLiveCaptureCrop(nextCrop) {
  const capture = state.captureSession;
  const video = document.querySelector('#capture-video');
  if (!capture || capture.phase !== 'ready' || !video?.videoWidth || !video.videoHeight) return;
  capture.crop = clampCaptureCrop(nextCrop, video.videoWidth, video.videoHeight);
  capture.applyCrop?.();
  rememberLiveCaptureCrop(capture.crop, video.videoWidth, video.videoHeight);
}

function resetLiveCaptureCrop() {
  const video = document.querySelector('#capture-video');
  if (video?.videoWidth && video.videoHeight) commitLiveCaptureCrop(defaultCaptureCrop(video.videoWidth, video.videoHeight));
}

function centerLiveCaptureCrop() {
  const capture = state.captureSession;
  const video = document.querySelector('#capture-video');
  if (capture?.crop && video?.videoWidth && video.videoHeight) commitLiveCaptureCrop(centeredCaptureCrop(capture.crop, video.videoWidth, video.videoHeight));
}

function setLiveCaptureDrawMode(enabled) {
  const capture = state.captureSession;
  if (!capture || (enabled && capture.phase !== 'ready')) return;
  capture.drawMode = enabled;
  const preview = document.querySelector('#capture-preview');
  const button = document.querySelector('[data-action="capture-draw"]');
  preview?.classList.toggle('drawing', enabled);
  if (button) {
    button.setAttribute('aria-pressed', String(enabled));
    button.textContent = enabled ? 'Cancel drawing' : 'Draw new frame';
  }
}

function updateLiveCaptureCoordinate(field, value) {
  const capture = state.captureSession;
  const video = document.querySelector('#capture-video');
  if (!['x', 'y', 'size'].includes(field) || String(value).trim() === '') return capture?.crop?.[field] ?? null;
  const number = Number(value);
  if (!capture?.crop || capture.phase !== 'ready' || !video?.videoWidth || !video.videoHeight || !Number.isFinite(number)) return capture?.crop?.[field] ?? null;
  const nextCrop = { ...capture.crop, [field]: Math.round(number) };
  if (field === 'size') nextCrop.size = Math.max(minimumLiveCaptureCrop(video.videoWidth), nextCrop.size);
  commitLiveCaptureCrop(nextCrop);
  return capture.crop[field];
}

function initializeLiveCapturePreview() {
  const capture = state.captureSession;
  const video = document.querySelector('#capture-video');
  const preview = document.querySelector('#capture-preview');
  const selection = document.querySelector('#capture-selection');
  const output = document.querySelector('#capture-output');
  if (!capture || !video || !preview || !selection || !output || video.dataset.bound) return;
  cleanupLiveCapturePreview(capture);
  video.dataset.bound = 'true';
  video.srcObject = capture.stream;
  capture.video = video;
  capture.outputCanvas = output;
  const previewResources = { video, outputFrameRequest: null, resizeObserver: null, resizeListener: null };
  capture.previewResources = previewResources;
  const displayGeometry = () => {
    const videoRect = video.getBoundingClientRect();
    return { videoRect, display: displayRectForVideo(videoRect.width, videoRect.height, video.videoWidth, video.videoHeight) };
  };
  const apply = () => {
    if (!capture.crop || !video.videoWidth || !video.videoHeight) return;
    const { display } = displayGeometry();
    const selectionRect = selectionRectForCrop(capture.crop, display, video.videoWidth, video.videoHeight);
    selection.style.cssText = `width:${selectionRect.size}px;height:${selectionRect.size}px;left:${selectionRect.x}px;top:${selectionRect.y}px`;
    document.querySelectorAll('[data-capture-coordinate]').forEach((input) => {
      if (document.activeElement !== input) input.value = String(capture.crop[input.dataset.captureCoordinate]);
    });
  };
  capture.applyCrop = apply;
  const loadCrop = () => {
    if (!video.videoWidth || !video.videoHeight) return;
    capture.crop = capture.crop
      ? clampCaptureCrop(capture.crop, video.videoWidth, video.videoHeight)
      : savedLiveCaptureCrop(video.videoWidth, video.videoHeight) || defaultCaptureCrop(video.videoWidth, video.videoHeight);
    capture.sourceWidth = video.videoWidth;
    capture.sourceHeight = video.videoHeight;
    apply();
  };
  if (video.videoWidth && video.videoHeight) loadCrop();
  else video.addEventListener('loadedmetadata', loadCrop, { once: true });
  const resizeObserver = new ResizeObserver(apply);
  resizeObserver.observe(video);
  previewResources.resizeObserver = resizeObserver;
  capture.previewResizeObserver = resizeObserver;
  const resizeListener = () => {
    if (!video.videoWidth || !video.videoHeight) return;
    if (capture.phase === 'recording' || capture.phase === 'finishing' || capture.phase === 'completing') {
      void cancelLiveCapture('CK3 capture resolution changed.');
      return;
    }
    if (capture.crop && capture.sourceWidth && capture.sourceHeight) {
      const normalized = normalizedCaptureCrop(capture.crop, capture.sourceWidth, capture.sourceHeight);
      capture.crop = restoredCaptureCrop(normalized, video.videoWidth, video.videoHeight) || defaultCaptureCrop(video.videoWidth, video.videoHeight);
    }
    capture.sourceWidth = video.videoWidth;
    capture.sourceHeight = video.videoHeight;
    apply();
  };
  previewResources.resizeListener = resizeListener;
  capture.previewResizeListener = resizeListener;
  video.addEventListener('resize', resizeListener);

  const outputContext = output.getContext('2d');
  outputContext.imageSmoothingEnabled = true;
  outputContext.imageSmoothingQuality = 'high';
  let lastOutputPaint = 0;
  const paintOutput = (now) => {
    previewResources.outputFrameRequest = null;
    if (capture.previewResources === previewResources) capture.outputFrameRequest = null;
    if (!video.isConnected || state.captureSession !== capture) { cleanupLiveCapturePreview(capture, previewResources); return; }
    if (capture.crop && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && now - lastOutputPaint >= 1000 / LIVE_CAPTURE_FPS) {
      const crop = clampCaptureCrop(capture.crop, video.videoWidth, video.videoHeight);
      outputContext.drawImage(video, crop.x, crop.y, crop.size, crop.size, 0, 0, 450, 450);
      lastOutputPaint = now;
    }
    previewResources.outputFrameRequest = requestAnimationFrame(paintOutput);
    if (capture.previewResources === previewResources) capture.outputFrameRequest = previewResources.outputFrameRequest;
  };
  previewResources.outputFrameRequest = requestAnimationFrame(paintOutput);
  capture.outputFrameRequest = previewResources.outputFrameRequest;

  const displayPoint = (event) => {
    const { display, videoRect } = displayGeometry();
    return {
      display,
      point: { x: event.clientX - videoRect.left - display.x, y: event.clientY - videoRect.top - display.y },
    };
  };
  const sourcePoint = (event) => {
    const { display, point } = displayPoint(event);
    const scale = video.videoWidth / display.width;
    return { display, point, source: { x: point.x * scale, y: point.y * scale }, scale };
  };
  let drag = null;
  preview.addEventListener('pointerdown', (event) => {
    if (capture.phase !== 'ready') return;
    const { display, point, source } = sourcePoint(event);
    if (point.x < 0 || point.x > display.width || point.y < 0 || point.y > display.height) return;
    const handle = event.target.closest?.('[data-capture-handle]')?.dataset.captureHandle;
    const mode = capture.drawMode ? 'draw' : handle ? 'resize' : event.target.closest?.('#capture-selection') ? 'move' : null;
    if (!mode) return;
    drag = { mode, handle, crop: { ...capture.crop }, point, source };
    preview.setPointerCapture(event.pointerId);
    selection.focus({ preventScroll: true });
  });
  preview.addEventListener('pointermove', (event) => {
    if (!drag) return;
    if (capture.phase !== 'ready') { drag = null; return; }
    const { display, point, source, scale } = sourcePoint(event);
    let nextCrop = capture.crop;
    if (drag.mode === 'move') {
      nextCrop = moveCaptureCrop(drag.crop, source.x - drag.source.x, source.y - drag.source.y, video.videoWidth, video.videoHeight);
      if (!event.altKey) nextCrop = snapCaptureCrop(nextCrop, video.videoWidth, video.videoHeight, 7 * scale);
    }
    if (drag.mode === 'resize') nextCrop = resizeCaptureCrop(drag.crop, drag.handle, source, video.videoWidth, video.videoHeight, minimumLiveCaptureCrop(video.videoWidth));
    if (drag.mode === 'draw') {
      nextCrop = dragCaptureCrop(drag.point, point, display, video.videoWidth, video.videoHeight);
      if (nextCrop.size < minimumLiveCaptureCrop(video.videoWidth)) return;
    }
    capture.crop = nextCrop;
    apply();
  });
  const stopDragging = () => {
    if (!drag) return;
    drag = null;
    rememberLiveCaptureCrop(capture.crop, video.videoWidth, video.videoHeight);
    if (capture.drawMode) setLiveCaptureDrawMode(false);
  };
  preview.addEventListener('pointerup', stopDragging);
  preview.addEventListener('pointercancel', stopDragging);
  preview.addEventListener('lostpointercapture', stopDragging);
  selection.addEventListener('keydown', (event) => {
    if (capture.phase !== 'ready' || !capture.crop) return;
    const step = event.shiftKey ? 10 : 1;
    const movement = {
      ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
    }[event.key];
    let nextCrop = null;
    if (movement) nextCrop = moveCaptureCrop(capture.crop, movement[0], movement[1], video.videoWidth, video.videoHeight);
    if (['+', '='].includes(event.key)) nextCrop = resizeCaptureCropFromCenter(capture.crop, step * 2, video.videoWidth, video.videoHeight, minimumLiveCaptureCrop(video.videoWidth));
    if (['-', '_'].includes(event.key)) nextCrop = resizeCaptureCropFromCenter(capture.crop, step * -2, video.videoWidth, video.videoHeight, minimumLiveCaptureCrop(video.videoWidth));
    if (!nextCrop) return;
    event.preventDefault();
    capture.crop = nextCrop;
    apply();
    rememberLiveCaptureCrop(capture.crop, video.videoWidth, video.videoHeight);
  });
}

function drawLiveCaptureFrame(capture) {
  const video = capture?.video || document.querySelector('#capture-video');
  const selectedCrop = capture?.recordingCrop || capture?.crop;
  if (!capture || !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !selectedCrop) return false;
  const context = capture.canvas.getContext('2d'); const crop = clampCaptureCrop(selectedCrop, video.videoWidth, video.videoHeight);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(video, crop.x, crop.y, crop.size, crop.size, 0, 0, 450, 450);
  return true;
}

function stopLiveCaptureOutputPreview(capture) {
  const frame = capture?.previewResources?.outputFrameRequest ?? capture?.outputFrameRequest;
  if (frame !== null && frame !== undefined) cancelAnimationFrame(frame);
  if (capture?.previewResources) capture.previewResources.outputFrameRequest = null;
  if (capture) capture.outputFrameRequest = null;
}

function cleanupLiveCapturePreview(capture, previewResources = capture?.previewResources) {
  if (!capture) return;
  if (!previewResources) {
    stopLiveCaptureOutputPreview(capture);
    capture.previewResizeObserver?.disconnect();
    capture.video?.removeEventListener?.('resize', capture.previewResizeListener);
    capture.previewResizeObserver = null;
    capture.previewResizeListener = null;
    return;
  }
  if (previewResources.outputFrameRequest !== null && previewResources.outputFrameRequest !== undefined) cancelAnimationFrame(previewResources.outputFrameRequest);
  previewResources.outputFrameRequest = null;
  previewResources.resizeObserver?.disconnect();
  previewResources.video?.removeEventListener?.('resize', previewResources.resizeListener);
  if (capture.previewResources !== previewResources) return;
  capture.previewResources = null;
  capture.outputFrameRequest = null;
  capture.previewResizeObserver = null;
  capture.previewResizeListener = null;
}

async function startLiveCaptureRecording(capture) {
  capture.canvas = capture.outputCanvas || document.querySelector('#capture-output') || document.createElement('canvas');
  capture.canvas.width = 450;
  capture.canvas.height = 450;
  capture.encoder = await createLiveCaptureEncoder();
  stopLiveCaptureOutputPreview(capture);
  capture.recordingError = null;
  const video = capture.video || document.querySelector('#capture-video');
  if (video?.videoWidth && video.videoHeight && capture.crop) capture.recordingCrop = clampCaptureCrop(capture.crop, video.videoWidth, video.videoHeight);
  if (!drawLiveCaptureFrame(capture)) {
    capture.encoder.close();
    capture.encoder = null;
    throw new Error('Wait for the CK3 preview to finish loading before recording.');
  }
  capture.encoder.encode(capture.canvas, 0, 0);
  capture.frames = 1;
  capture.encodedFrames = 1;
  capture.droppedFrames = 0;
  capture.captureTicks = 1;
  capture.startedAt = performance.now();
  capture.lastTimestamp = 0;
  capture.lastStatusSecond = -1;
  capture.timer = setInterval(() => {
    capture.captureTicks += 1;
    if (capture.encoder.hasCapacity) {
      try {
        if (drawLiveCaptureFrame(capture)) {
          const elapsedTimestamp = Math.round((performance.now() - capture.startedAt) * 1_000);
          const timestamp = Math.max(elapsedTimestamp, capture.lastTimestamp + Math.round(1_000_000 / LIVE_CAPTURE_FPS));
          capture.encoder.encode(capture.canvas, timestamp, capture.encodedFrames);
          capture.lastTimestamp = timestamp;
          capture.encodedFrames += 1;
          capture.frames = capture.encodedFrames;
        } else capture.droppedFrames += 1;
      } catch (error) {
        capture.recordingError = error;
        if (state.captureSession === capture && capture.phase === 'recording') void cancelLiveCapture('WebM recording failed.');
        return;
      }
    } else capture.droppedFrames += 1;
    updateLiveCaptureRecordingStatus(capture);
    if (capture.phase === 'recording' && capture.captureTicks >= LIVE_CAPTURE_MAX_FRAMES) void finishLiveCapture('Frame limit reached.');
  }, 1_000 / LIVE_CAPTURE_FPS);
}

async function stopLiveCaptureRecording(capture) {
  if (capture?.timer) clearInterval(capture.timer);
  if (capture?.durationTimer) clearTimeout(capture.durationTimer);
  if (capture) { capture.timer = null; capture.durationTimer = null; }
  if (capture?.recordingError) {
    capture.encoder?.close();
    capture.encoder = null;
    throw capture.recordingError;
  }
  if (!capture?.encoder || !capture.encodedFrames) return null;
  try { return await capture.encoder.finalize(); }
  finally { capture.encoder = null; }
}

function discardLiveCaptureRecording(capture) {
  if (capture?.timer) clearInterval(capture.timer);
  if (capture?.durationTimer) clearTimeout(capture.durationTimer);
  capture?.encoder?.close();
  if (capture) { capture.encoder = null; capture.timer = null; capture.durationTimer = null; capture.recordingCrop = null; }
}

async function toggleLiveCapture(sessionId) {
  const capture = state.captureSession;
  if (!capture || capture.sessionId !== sessionId) return;
  if (capture.phase === 'ready') {
    capture.phase = 'starting-recording';
    updateLiveCaptureStartingUi(capture);
    await reportLiveCaptureStatus(capture, { state: 'starting' });
    try { await startLiveCaptureRecording(capture); }
    catch (error) {
      if (state.captureSession === capture && capture.phase === 'starting-recording') {
        await cancelLiveCapture(readableError(error, 'WebM recording could not start.'));
      } else {
        discardLiveCaptureRecording(capture);
        stopLiveCaptureStream(capture);
        await desktop?.releaseCapture(capture.sessionId).catch(() => {});
      }
      return;
    }
    if (state.captureSession !== capture || capture.phase !== 'starting-recording') {
      discardLiveCaptureRecording(capture);
      stopLiveCaptureStream(capture);
      await desktop?.releaseCapture(capture.sessionId).catch(() => {});
      return;
    }
    capture.phase = 'recording';
    updateLiveCaptureRecordingUi(capture);
    await reportLiveCaptureStatus(capture, { state: 'recording', startedAt: Date.now() });
    capture.durationTimer = setTimeout(() => { if (state.captureSession === capture && capture.phase === 'recording') void finishLiveCapture('Maximum recording duration reached.'); }, LIVE_CAPTURE_MAX_DURATION_MS);
  } else if (capture.phase === 'recording') void finishLiveCapture();
  else if (capture.phase === 'starting-recording') void cancelLiveCapture();
}

function setLiveCaptureFramingDisabled(disabled) {
  document.querySelectorAll('[data-action="capture-draw"], [data-action="capture-center"], [data-action="capture-reset"], [data-capture-coordinate]').forEach((control) => { control.disabled = disabled; });
  const selection = document.querySelector('#capture-selection');
  if (selection) {
    selection.tabIndex = disabled ? -1 : 0;
    selection.setAttribute('aria-disabled', String(disabled));
  }
}

function updateLiveCaptureStartingUi(capture) {
  const status = document.querySelector('#capture-status');
  const shortcut = document.querySelector('#capture-shortcut');
  if (status) status.textContent = 'Starting the high-quality video encoder.';
  if (shortcut) shortcut.disabled = true;
  setLiveCaptureDrawMode(false);
  setLiveCaptureFramingDisabled(true);
}

function updateLiveCaptureRecordingStatus(capture, force = false) {
  const status = document.querySelector('#capture-status');
  const second = capture.startedAt ? Math.floor((performance.now() - capture.startedAt) / 1000) : 0;
  if (!status || capture.phase !== 'recording' || (!force && capture.lastStatusSecond === second)) return;
  capture.lastStatusSecond = second;
  status.textContent = liveCaptureRecordingStatus(capture);
}

function updateLiveCaptureRecordingUi(capture) {
  const status = document.querySelector('#capture-status');
  const shortcut = document.querySelector('#capture-shortcut');
  const controls = document.querySelector('.capture-footer > div');
  if (status) status.setAttribute('aria-live', 'off');
  updateLiveCaptureRecordingStatus(capture, true);
  if (shortcut) shortcut.disabled = true;
  setLiveCaptureFramingDisabled(true);
  if (controls) controls.innerHTML = '<button class="outline-button" data-action="close-modal">Cancel</button><button class="danger-button" data-action="capture-stop">Stop recording</button>';
}

function updateLiveCaptureFinishingUi() {
  const status = document.querySelector('#capture-status');
  const controls = document.querySelector('.capture-footer > div');
  if (status) { status.setAttribute('aria-live', 'polite'); status.textContent = 'Encoding and saving the live portrait.'; }
  setLiveCaptureFramingDisabled(true);
  if (controls) controls.innerHTML = '<button class="outline-button" data-action="close-modal">Cancel</button>';
}

async function finishLiveCapture(reason = '') {
  const capture = state.captureSession; const character = liveCaptureCharacter(capture);
  if (!capture || ['finishing', 'completing'].includes(capture.phase)) return;
  if (!character) return cancelLiveCapture('The character selected for capture no longer exists.');
  capture.phase = 'finishing';
  updateLiveCaptureFinishingUi();
  try {
    const videoPromise = stopLiveCaptureRecording(capture);
    await reportLiveCaptureStatus(capture, { state: 'saving' });
    const video = await videoPromise;
    if (state.captureSession !== capture || capture.phase !== 'finishing') {
      stopLiveCaptureStream(capture);
      await desktop?.releaseCapture(capture.sessionId).catch(() => {});
      return;
    }
    if (!video) throw new Error('Live portrait capture did not contain any video frames.');
    const selected = await desktop.finishCapture(capture.sessionId, character.id, video);
    if (state.captureSession !== capture || capture.phase !== 'finishing') {
      await desktop.deleteImage(selected.path).catch(() => {});
      await desktop.completeCapture(capture.sessionId, { state: 'cancelled' }).catch(() => {});
      return;
    }
    stopLiveCaptureStream(capture);
    capture.phase = 'completing';
    updateLiveCaptureFinishingUi();
    let saved = false;
    try { saved = await appendPortrait(character, selected, reason || 'Live CK3 portrait added.', true); }
    finally {
      if (state.captureSession === capture) {
        await desktop.completeCapture(capture.sessionId, saved
          ? { state: 'saved' }
          : { state: 'failed', message: 'The portrait could not be added to the archive.' });
        state.captureSession = null;
        state.modal = null;
        render('modal');
      }
    }
  }
  catch (error) {
    if (state.captureSession === capture) await cancelLiveCapture(readableError(error, 'The live portrait could not be saved.'));
    else showToast(readableError(error, 'The live portrait could not be saved.'), 'info');
  }
}

function stopLiveCaptureStream(capture) {
  if (capture?.timer) clearInterval(capture.timer);
  if (capture?.durationTimer) clearTimeout(capture.durationTimer);
  if (capture) { capture.timer = null; capture.durationTimer = null; }
  cleanupLiveCapturePreview(capture);
  capture?.stream?.getTracks().forEach((track) => track.stop());
}
async function releaseLiveCapture(failureMessage = '') {
  const capture = state.captureSession;
  if (!capture) return;
  capture.phase = 'releasing';
  discardLiveCaptureRecording(capture);
  stopLiveCaptureStream(capture);
  if (capture.sessionId) await desktop?.releaseCapture(capture.sessionId, failureMessage).catch(() => {});
}
async function cancelLiveCapture(message = '') { await releaseLiveCapture(message); state.captureSession = null; state.modal = null; render('modal'); if (message) showToast(message, 'info'); }
