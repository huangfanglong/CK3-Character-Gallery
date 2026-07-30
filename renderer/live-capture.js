const LIVE_CAPTURE_SHORTCUTS = [
  ['CommandOrControl+Alt+G', 'Ctrl + Alt + G'],
  ['CommandOrControl+Shift+G', 'Ctrl + Shift + G'],
  ['CommandOrControl+Alt+R', 'Ctrl + Alt + R'],
  ['CommandOrControl+Shift+R', 'Ctrl + Shift + R'],
];

async function showLiveCaptureModal() {
  const character = getActiveCharacter();
  if (!character || state.preview) return;
  if (hasMaximumPortraits(character)) return showToast(`This character already has ${MAX_PORTRAIT_VARIANTS} portrait variants.`, 'info');
  state.captureSession = { sources: [], selectedSourceId: null, stream: null, phase: 'loading', frames: 0, encodedFrames: 0, timer: null, durationTimer: null, sessionId: null, shortcut: LIVE_CAPTURE_SHORTCUTS[0][0], crop: null, canvas: null, encoder: null, recordingError: null };
  renderLiveCaptureModal();
  try {
    state.captureSession.sources = await desktop.listCaptureSources();
    state.captureSession.phase = state.captureSession.sources.length ? 'select-source' : 'empty';
  } catch (error) {
    state.captureSession.phase = 'error'; state.captureSession.error = readableError(error, 'CK3 windows could not be listed.');
  }
  renderLiveCaptureModal();
}

async function refreshLiveCaptureSources() {
  const capture = state.captureSession;
  if (!capture) return;
  capture.phase = 'loading'; renderLiveCaptureModal();
  try {
    capture.sources = await desktop.listCaptureSources();
    capture.phase = capture.sources.length ? 'select-source' : 'empty';
  } catch (error) {
    capture.phase = 'error'; capture.error = readableError(error, 'CK3 windows could not be listed.');
  }
  renderLiveCaptureModal();
}

function renderLiveCaptureModal() {
  const capture = state.captureSession;
  if (!capture) return;
  const sources = capture.sources.map((source) => `<button class="capture-source ${source.id === capture.selectedSourceId ? 'selected' : ''}" data-capture-source="${escapeHtml(source.id)}"><img src="${source.thumbnail}" alt=""/><span>${escapeHtml(source.name)}</span></button>`).join('');
  const shortcutOptions = LIVE_CAPTURE_SHORTCUTS.map(([value, label]) => `<option value="${value}"${capture.shortcut === value ? ' selected' : ''}>${label}</option>`).join('');
  const status = capture.phase === 'loading' ? 'Looking for an open Crusader Kings III window.'
    : capture.phase === 'empty' ? 'No visible Crusader Kings III window was found. Start CK3 in borderless or windowed mode, then refresh.'
      : capture.phase === 'error' ? capture.error
        : capture.phase === 'starting-recording' ? 'Starting the high-quality video encoder.'
          : capture.phase === 'recording' ? `Recording ${capture.frames}/${LIVE_CAPTURE_MAX_FRAMES} frames. Press ${capture.shortcut} in CK3 to stop.`
          : capture.phase === 'ready' ? `Frame the portrait, then press ${capture.shortcut} in CK3 to start recording.`
            : capture.error || 'Choose the visible Crusader Kings III window to capture.';
  const preview = ['ready', 'starting-recording', 'recording'].includes(capture.phase)
    ? '<div class="capture-preview" id="capture-preview"><video id="capture-video" autoplay muted playsinline></video><div class="capture-selection" id="capture-selection"></div></div>'
    : `<div class="capture-sources">${sources || '<p class="variant-empty">No CK3 window available.</p>'}</div>`;
  const primary = capture.phase === 'empty' ? '<button class="outline-button" data-action="capture-refresh">Refresh</button>'
    : capture.phase === 'recording' ? '<button class="danger-button" data-action="capture-stop">Stop recording</button>' : '';
  state.modal = `<div class="modal-backdrop" ${modalPreserveAttribute('capture')}><div class="capture-modal"><div class="modal-head"><div><p class="eyebrow">LIVE CK3 PORTRAIT</p><h2>Capture ${escapeHtml(getActiveCharacter()?.name || 'portrait')}</h2></div><button class="modal-close" data-action="close-modal">${icon('close')}</button></div><p class="modal-copy">Capture the visible CK3 window. Keep it unobscured; borderless or windowed mode is recommended.</p><label class="capture-shortcut">Recording hotkey<select id="capture-shortcut"${capture.phase === 'recording' ? ' disabled' : ''}>${shortcutOptions}</select></label>${preview}<div class="capture-footer"><span id="capture-status">${escapeHtml(status)}</span><div><button class="outline-button" data-action="close-modal">Cancel</button>${primary}</div></div></div></div>`;
  render('modal');
  if (capture.stream) initializeLiveCapturePreview();
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
    stream.getVideoTracks()[0].addEventListener('ended', () => { if (state.captureSession === capture && capture.phase !== 'finishing') void cancelLiveCapture('CK3 window capture ended.'); }, { once: true });
    capture.phase = 'ready'; renderLiveCaptureModal();
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop());
    if (sessionId) await desktop.releaseCapture(sessionId).catch(() => {});
    if (state.captureSession !== capture) return;
    capture.sessionId = null;
    capture.phase = 'select-source';
    capture.error = readableError(error, 'CK3 capture could not start.');
    renderLiveCaptureModal();
  }
}

function setLiveCaptureShortcut(shortcut) {
  const capture = state.captureSession;
  if (!capture || capture.phase === 'recording' || !LIVE_CAPTURE_SHORTCUTS.some(([value]) => value === shortcut)) return;
  capture.shortcut = shortcut;
  capture.error = '';
  const status = document.querySelector('#capture-status');
  if (status && capture.phase === 'select-source') status.textContent = 'Choose the visible Crusader Kings III window to capture.';
}

function initializeLiveCapturePreview() {
  const capture = state.captureSession; const video = document.querySelector('#capture-video'); const preview = document.querySelector('#capture-preview'); const selection = document.querySelector('#capture-selection');
  if (!capture || !video || !preview || !selection || video.dataset.bound) return;
  video.dataset.bound = 'true'; video.srcObject = capture.stream;
  const apply = () => {
    if (!capture.crop || !video.videoWidth || !video.videoHeight) return;
    const previewRect = preview.getBoundingClientRect();
    const display = displayRectForVideo(previewRect.width, previewRect.height, video.videoWidth, video.videoHeight);
    const selectionRect = selectionRectForCrop(capture.crop, display, video.videoWidth, video.videoHeight);
    selection.style.cssText = `width:${selectionRect.size}px;height:${selectionRect.size}px;left:${selectionRect.x}px;top:${selectionRect.y}px`;
  };
  video.addEventListener('loadedmetadata', () => {
    if (!capture.crop) capture.crop = defaultCaptureCrop(video.videoWidth, video.videoHeight);
    apply();
  }, { once: true });
  let start = null;
  preview.addEventListener('pointerdown', (event) => {
    if (capture.phase !== 'ready') return;
    const previewRect = preview.getBoundingClientRect(); const display = displayRectForVideo(previewRect.width, previewRect.height, video.videoWidth, video.videoHeight);
    const point = { x: event.clientX - previewRect.left - display.x, y: event.clientY - previewRect.top - display.y };
    if (point.x < 0 || point.x > display.width || point.y < 0 || point.y > display.height) return;
    start = point; preview.setPointerCapture(event.pointerId);
  });
  preview.addEventListener('pointermove', (event) => {
    if (!start) return;
    const previewRect = preview.getBoundingClientRect(); const display = displayRectForVideo(previewRect.width, previewRect.height, video.videoWidth, video.videoHeight);
    const end = { x: event.clientX - previewRect.left - display.x, y: event.clientY - previewRect.top - display.y };
    const nextCrop = dragCaptureCrop(start, end, display, video.videoWidth, video.videoHeight);
    const minimumSize = 8 * video.videoWidth / display.width;
    if (nextCrop.size >= minimumSize) { capture.crop = nextCrop; apply(); }
  });
  preview.addEventListener('pointerup', () => { start = null; });
}

function drawLiveCaptureFrame(capture) {
  const video = document.querySelector('#capture-video');
  if (!capture || !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !capture.crop) return false;
  const context = capture.canvas.getContext('2d'); const crop = clampCaptureCrop(capture.crop, video.videoWidth, video.videoHeight);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(video, crop.x, crop.y, crop.size, crop.size, 0, 0, 450, 450);
  return true;
}

async function startLiveCaptureRecording(capture) {
  capture.canvas = document.createElement('canvas');
  capture.canvas.width = 450;
  capture.canvas.height = 450;
  capture.encoder = await createLiveCaptureEncoder();
  capture.recordingError = null;
  if (!drawLiveCaptureFrame(capture)) {
    capture.encoder.close();
    capture.encoder = null;
    throw new Error('Wait for the CK3 preview to finish loading before recording.');
  }
  capture.encoder.encode(capture.canvas, 0, 0);
  capture.frames = 1;
  capture.encodedFrames = 1;
  capture.startedAt = performance.now();
  capture.lastTimestamp = 0;
  capture.timer = setInterval(() => {
    if (capture.encoder.hasCapacity) {
      try {
        if (drawLiveCaptureFrame(capture)) {
          const elapsedTimestamp = Math.round((performance.now() - capture.startedAt) * 1_000);
          const timestamp = Math.max(elapsedTimestamp, capture.lastTimestamp + Math.round(1_000_000 / LIVE_CAPTURE_FPS));
          capture.encoder.encode(capture.canvas, timestamp, capture.frames);
          capture.lastTimestamp = timestamp;
          capture.encodedFrames += 1;
        }
      } catch (error) {
        capture.recordingError = error;
        if (state.captureSession === capture && capture.phase === 'recording') void cancelLiveCapture('WebM recording failed.');
        return;
      }
    }
    capture.frames += 1;
    const status = document.querySelector('#capture-status');
    if (status && capture.phase === 'recording') status.textContent = `Recording ${capture.frames}/${LIVE_CAPTURE_MAX_FRAMES} frames. Press ${capture.shortcut} in CK3 to stop.`;
    if (capture.phase === 'recording' && capture.frames >= LIVE_CAPTURE_MAX_FRAMES) void finishLiveCapture('Frame limit reached.');
  }, 1_000 / LIVE_CAPTURE_FPS);
}

async function stopLiveCaptureRecording(capture) {
  if (capture?.timer) clearInterval(capture.timer);
  if (capture?.durationTimer) clearTimeout(capture.durationTimer);
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
  if (capture) capture.encoder = null;
}

async function toggleLiveCapture(sessionId) {
  const capture = state.captureSession;
  if (!capture || capture.sessionId !== sessionId) return;
  if (capture.phase === 'ready') {
    capture.phase = 'starting-recording';
    try { await startLiveCaptureRecording(capture); }
    catch (error) {
      if (state.captureSession === capture && capture.phase === 'starting-recording') {
        capture.phase = 'ready';
        showToast(readableError(error, 'WebM recording could not start.'), 'info');
      }
      return;
    }
    if (state.captureSession !== capture || capture.phase !== 'starting-recording') { capture.encoder?.close(); return; }
    capture.phase = 'recording';
    updateLiveCaptureRecordingUi(capture);
    capture.durationTimer = setTimeout(() => { if (state.captureSession === capture && capture.phase === 'recording') void finishLiveCapture('Maximum recording duration reached.'); }, LIVE_CAPTURE_MAX_DURATION_MS);
  } else if (capture.phase === 'recording') void finishLiveCapture();
}

function updateLiveCaptureRecordingUi(capture) {
  const status = document.querySelector('#capture-status');
  const shortcut = document.querySelector('#capture-shortcut');
  const controls = document.querySelector('.capture-footer > div');
  if (status) status.textContent = `Recording ${capture.frames}/${LIVE_CAPTURE_MAX_FRAMES} frames. Press ${capture.shortcut} in CK3 to stop.`;
  if (shortcut) shortcut.disabled = true;
  if (controls) controls.innerHTML = '<button class="outline-button" data-action="close-modal">Cancel</button><button class="danger-button" data-action="capture-stop">Stop recording</button>';
}

async function finishLiveCapture(reason = '') {
  const capture = state.captureSession; const character = getActiveCharacter();
  if (!capture || !character || capture.phase === 'finishing') return;
  capture.phase = 'finishing';
  try {
    const video = await stopLiveCaptureRecording(capture);
    if (state.captureSession !== capture || capture.phase !== 'finishing') return;
    if (!video) throw new Error('Live portrait capture did not contain any video frames.');
    const selected = await desktop.finishCapture(capture.sessionId, character.id, video);
    if (state.captureSession !== capture || capture.phase !== 'finishing') {
      await desktop.deleteImage(selected.path).catch(() => {});
      return;
    }
    stopLiveCaptureStream(capture);
    state.captureSession = null; state.modal = null; await appendPortrait(character, selected, reason || 'Live CK3 portrait added.', true);
  }
  catch (error) {
    if (state.captureSession === capture) await cancelLiveCapture(readableError(error, 'The live portrait could not be saved.'));
  }
}

function stopLiveCaptureStream(capture) { if (capture?.timer) clearInterval(capture.timer); if (capture?.durationTimer) clearTimeout(capture.durationTimer); capture?.stream?.getTracks().forEach((track) => track.stop()); }
async function releaseLiveCapture() {
  const capture = state.captureSession;
  if (!capture) return;
  capture.phase = 'releasing';
  discardLiveCaptureRecording(capture);
  stopLiveCaptureStream(capture);
  if (capture.sessionId) await desktop?.releaseCapture(capture.sessionId).catch(() => {});
}
async function cancelLiveCapture(message = '') { await releaseLiveCapture(); state.captureSession = null; state.modal = null; render('modal'); if (message) showToast(message, 'info'); }
