function showCropModal(source) {
  state.pendingPortraitSource = null;
  const characterId = source.targetCharacterId || getActiveCharacter()?.id || null;
  const galleryName = source.targetGalleryName || state.activeGallery;
  state.cropSession = {
    characterId,
    galleryName,
    dataUrl: source.dataUrl,
    sourceId: source.sourceId || null,
    format: source.format || null,
    animated: Boolean(source.animated),
    frames: Number(source.frames) || 1,
    sourceWidth: source.width,
    sourceHeight: source.height,
    viewport: 480,
    baseScale: 1,
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
  };
  const outputLabel = source.animated
    ? `Output: 450 × 450 animated GIF · ${source.frames} frames`
    : source.format === 'gif' ? 'Output: 450 × 450 GIF' : 'Output: 450 × 450 PNG';
  state.modal = `<div class="modal-backdrop" ${modalPreserveAttribute('crop')}><div class="crop-modal"><div class="modal-head"><div><p class="eyebrow">ADJUST IMAGE POSITION</p><h2>Compose the portrait</h2></div><button class="modal-close" data-action="close-modal">${icon('close')}</button></div><p class="modal-copy">Drag the image to position it inside the square. Use the slider or mouse wheel to zoom before adding it to the selected character.</p><div class="crop-stage" id="crop-stage"><img id="crop-source" src="${source.dataUrl}" alt="Portrait crop preview" draggable="false"/><div class="crop-grid"><span></span><span></span><span></span><span></span></div></div><div class="crop-controls"><button class="outline-button" data-action="crop-reset">Reset</button><label><span>Zoom</span><input id="crop-zoom" type="range" min="100" max="300" value="100"/><output id="crop-zoom-value">100%</output></label></div><div class="crop-footer"><span>${outputLabel}</span><div><button class="outline-button" data-action="close-modal">Cancel</button><button class="primary-button" data-action="save-crop">Use portrait ${icon('check')}</button></div></div></div></div>`;
  render('modal');
  initializeCropInteraction();
  requestAnimationFrame(initializeCropInteraction);
}

function initializeCropInteraction() {
  const session = state.cropSession;
  const stage = document.querySelector('#crop-stage');
  const image = document.querySelector('#crop-source');
  const slider = document.querySelector('#crop-zoom');
  if (!session || !stage || !image || !slider || stage.dataset.bound === 'true') return;
  stage.dataset.bound = 'true';
  session.viewport = stage.clientWidth;
  session.baseScale = Math.max(session.viewport / session.sourceWidth, session.viewport / session.sourceHeight);
  resetCropPosition();

  let dragStart = null;
  stage.addEventListener('pointerdown', (event) => {
    dragStart = { x: event.clientX, y: event.clientY, offsetX: session.offsetX, offsetY: session.offsetY };
    stage.setPointerCapture(event.pointerId);
    stage.classList.add('dragging');
  });
  stage.addEventListener('pointermove', (event) => {
    if (!dragStart) return;
    session.offsetX = dragStart.offsetX + event.clientX - dragStart.x;
    session.offsetY = dragStart.offsetY + event.clientY - dragStart.y;
    clampCropOffset();
    applyCropTransform();
  });
  const stopDragging = () => { dragStart = null; stage.classList.remove('dragging'); };
  stage.addEventListener('pointerup', stopDragging);
  stage.addEventListener('pointercancel', stopDragging);
  const setZoom = (percentage) => {
    const nextPercentage = Math.max(Number(slider.min), Math.min(Number(slider.max), percentage));
    const previousScale = session.baseScale * session.zoom;
    const center = session.viewport / 2;
    session.zoom = nextPercentage / 100;
    const nextScale = session.baseScale * session.zoom;
    const ratio = nextScale / previousScale;
    session.offsetX = center - (center - session.offsetX) * ratio;
    session.offsetY = center - (center - session.offsetY) * ratio;
    clampCropOffset();
    applyCropTransform();
    slider.value = String(nextPercentage);
    document.querySelector('#crop-zoom-value').textContent = `${nextPercentage}%`;
  };
  slider.addEventListener('input', () => setZoom(Number(slider.value)));
  stage.addEventListener('wheel', (event) => {
    if (!event.deltaY) return;
    event.preventDefault();
    setZoom(Number(slider.value) + (event.deltaY < 0 ? 10 : -10));
  }, { passive: false });
}

function resetCropPosition() {
  const session = state.cropSession;
  if (!session) return;
  session.zoom = 1;
  const width = session.sourceWidth * session.baseScale;
  const height = session.sourceHeight * session.baseScale;
  session.offsetX = (session.viewport - width) / 2;
  session.offsetY = (session.viewport - height) / 2;
  const slider = document.querySelector('#crop-zoom');
  if (slider) slider.value = '100';
  const output = document.querySelector('#crop-zoom-value');
  if (output) output.textContent = '100%';
  applyCropTransform();
}

function clampCropOffset() {
  const session = state.cropSession;
  if (!session) return;
  const width = session.sourceWidth * session.baseScale * session.zoom;
  const height = session.sourceHeight * session.baseScale * session.zoom;
  session.offsetX = Math.min(0, Math.max(session.viewport - width, session.offsetX));
  session.offsetY = Math.min(0, Math.max(session.viewport - height, session.offsetY));
}

function applyCropTransform() {
  const session = state.cropSession;
  const image = document.querySelector('#crop-source');
  if (!session || !image) return;
  const scale = session.baseScale * session.zoom;
  image.style.width = `${session.sourceWidth * scale}px`;
  image.style.height = `${session.sourceHeight * scale}px`;
  image.style.transform = `translate(${session.offsetX}px, ${session.offsetY}px)`;
}

async function saveCroppedPortrait() {
  const session = state.cropSession;
  if (!session || session.saving) return;
  const character = state.galleries.find((gallery) => gallery.name === session.galleryName)?.characters.find((item) => item.id === session.characterId);
  if (!character) {
    releaseCropSource();
    state.cropSession = null;
    state.modal = null;
    render('modal');
    return showToast('The selected character is no longer available.', 'info');
  }
  const scale = session.baseScale * session.zoom;
  const modal = state.modal;
  const saveButton = document.querySelector('[data-action="save-crop"]');
  session.saving = true;
  if (saveButton) { saveButton.disabled = true; saveButton.textContent = 'Processing portrait'; }
  try {
    const selected = await desktop.saveCroppedImage(character.id, {
      dataUrl: session.dataUrl,
      sourceId: session.sourceId,
      x: -session.offsetX / scale,
      y: -session.offsetY / scale,
      size: session.viewport / scale,
    });
    if (state.cropSession !== session || state.modal !== modal) {
      if (state.cropSession === session) state.cropSession = null;
      await desktop.deleteImage(selected.path).catch(() => {});
      return;
    }
    state.modal = null;
    state.cropSession = null;
    await appendPortrait(character, selected, 'Clipboard portrait added.', true);
  } catch (error) {
    if (state.cropSession === session && state.modal === modal) showToast(readableError(error, 'The cropped portrait could not be saved.'), 'info');
  } finally {
    if (state.cropSession === session && state.modal === modal) {
      session.saving = false;
      if (saveButton?.isConnected) { saveButton.disabled = false; saveButton.innerHTML = `Use portrait ${icon('check')}`; }
    }
  }
}

function releaseCropSource(source = null) {
  const sourceIds = new Set([
    source?.sourceId,
    state.cropSession?.sourceId,
    state.pendingPortraitSource?.sourceId,
  ].filter(Boolean));
  sourceIds.forEach((sourceId) => { void desktop?.releaseImageSource(sourceId).catch(() => {}); });
}

async function appendPortrait(character, selected, message, makeCover = false) {
  const hadImages = Array.isArray(character.images);
  const hadImageUrls = state.imageUrls.has(character.id);
  const hadCover = Object.hasOwn(character, 'coverIndex');
  const hadImageUrl = Object.hasOwn(character, '_imageUrl');
  const hadModified = Object.hasOwn(character, 'modified');
  const hadVariants = Object.hasOwn(character, 'variants');
  const previousImages = [...(character.images || [])];
  const previousCover = character.coverIndex;
  const previousImageUrl = character._imageUrl;
  const previousModified = character.modified;
  const previousVariants = character.variants;
  character.images = character.images || [];
  const urls = state.imageUrls.get(character.id) || [];
  const previousUrls = [...urls];
  if (makeCover) character.images.unshift(selected.path);
  else character.images.push(selected.path);
  if (makeCover) urls.unshift(selected.url);
  else urls.push(selected.url);
  state.imageUrls.set(character.id, urls);
  if (makeCover) character.coverIndex = 0;
  character._imageUrl = makeCover ? selected.url : character._imageUrl || selected.url;
  character.modified = Date.now();
  character.variants = character.images.length;
  render();
  if (await saveLibrary()) { showToast(message, 'success'); return true; }
  else {
    if (hadImages) character.images = previousImages; else delete character.images;
    if (hadVariants) character.variants = previousVariants; else delete character.variants;
    if (hadCover) character.coverIndex = previousCover; else delete character.coverIndex;
    if (hadImageUrl) character._imageUrl = previousImageUrl; else delete character._imageUrl;
    if (hadModified) character.modified = previousModified; else delete character.modified;
    if (hadImageUrls) state.imageUrls.set(character.id, previousUrls); else state.imageUrls.delete(character.id);
    render();
    if (hadImageUrls) state.imageUrls.set(character.id, previousUrls); else state.imageUrls.delete(character.id);
    await cleanupUnusedPortraits([selected.path]);
    return false;
  }
}
