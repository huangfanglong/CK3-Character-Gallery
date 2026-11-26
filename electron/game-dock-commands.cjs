const COMMAND_TYPES = new Set([
  'quick-add', 'select-collection', 'create-record', 'cancel-draft', 'discard-draft', 'finish-without-portrait',
  'snapshot', 'live-capture', 'toggle-capture', 'cancel-capture', 'crop-change', 'reset-crop', 'set-loop-search',
  'undo-create', 'view-gallery', 'dismiss', 'retry', 'disable-dock', 'set-position',
  'live-import', 'live-prepare-apply', 'live-undo', 'live-cancel', 'live-retry',
]);
const MODES = new Set(['compact', 'draft', 'framing', 'capture', 'success', 'error']);
const CAPTURE_STATES = new Set(['starting', 'armed', 'recording', 'matching', 'saving']);

function identifier(value, label, required = false) {
  if ((value === undefined || value === null || value === '') && !required) return '';
  if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(value)) throw new Error(`The dock ${label} is invalid.`);
  return value;
}

function text(value, label, maximum = 120) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > maximum) throw new Error(`The dock ${label} is invalid.`);
  return value.trim();
}

function normalizedCrop(value) {
  if (!value || ![value.centerX, value.centerY, value.size].every(Number.isFinite)
    || value.centerX < 0 || value.centerX > 1 || value.centerY < 0 || value.centerY > 1 || value.size <= 0 || value.size > 1) {
    throw new Error('The portrait crop is invalid.');
  }
  return { centerX: value.centerX, centerY: value.centerY, size: value.size };
}

function normalizeGameDockCommand(command) {
  const operationId = identifier(command?.operationId, 'operation', true);
  const type = command?.type;
  if (!COMMAND_TYPES.has(type)) throw new Error('The dock command is not supported.');
  const input = command?.payload && typeof command.payload === 'object' && !Array.isArray(command.payload) ? command.payload : {};
  let payload = {};
  if (type === 'select-collection') {
    const collection = text(input.collection, 'destination');
    if (!collection || collection.toLowerCase() === 'all characters') throw new Error('Choose a real destination collection.');
    payload = { collection };
  } else if (type === 'set-position') {
    if (!['left', 'center', 'right'].includes(input.position)) throw new Error('The dock position is invalid.');
    payload = { position: input.position };
  } else if (type === 'crop-change') payload = { crop: normalizedCrop(input.crop), draftId: identifier(input.draftId, 'draft') };
  else if (type === 'set-loop-search') {
    if (!Number.isInteger(input.seconds) || input.seconds < 1 || input.seconds > 25) throw new Error('The smooth loop search duration is invalid.');
    payload = { draftId: identifier(input.draftId, 'draft'), seconds: input.seconds };
  }
  else if (type === 'create-record') {
    const collection = text(input.collection, 'destination');
    if (collection.toLowerCase() === 'all characters') throw new Error('Choose a real destination collection.');
    payload = { draftId: identifier(input.draftId, 'draft'), name: text(input.name, 'name'), frame: input.frame !== false, collection };
  }
  else if (['snapshot', 'live-capture', 'toggle-capture', 'cancel-capture', 'reset-crop', 'undo-create', 'finish-without-portrait', 'cancel-draft', 'retry'].includes(type)) payload = { draftId: identifier(input.draftId, 'draft') };
  return { operationId, type, payload };
}

function normalizeGameDockState(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('The dock state is invalid.');
  const state = {};
  if ('mode' in patch) {
    if (!MODES.has(patch.mode)) throw new Error('The dock mode is invalid.');
    state.mode = patch.mode;
  }
  for (const key of ['collection', 'characterName', 'draftId', 'characterId']) {
    if (key in patch) state[key] = text(patch[key], key, key === 'characterName' ? 120 : 100);
  }
  if ('collections' in patch) {
    if (!Array.isArray(patch.collections) || patch.collections.length > 1000) throw new Error('The dock collection list is invalid.');
    state.collections = [...new Set(patch.collections.map((name) => text(name, 'collection')).filter(Boolean))];
  }
  for (const key of ['busy', 'dnaReady', 'quickAddReady', 'dnaAttached', 'sound']) if (key in patch) state[key] = Boolean(patch[key]);
  for (const key of ['message', 'error']) if (key in patch) state[key] = text(patch[key], key, 256);
  if ('position' in patch) {
    if (!['left', 'center', 'right'].includes(patch.position)) throw new Error('The dock position is invalid.');
    state.position = patch.position;
  }
  if ('shortcut' in patch) state.shortcut = text(patch.shortcut, 'shortcut', 60);
  if ('loopSearchSeconds' in patch) {
    if (!Number.isInteger(patch.loopSearchSeconds) || patch.loopSearchSeconds < 1 || patch.loopSearchSeconds > 25) throw new Error('The dock smooth loop search duration is invalid.');
    state.loopSearchSeconds = patch.loopSearchSeconds;
  }
  if ('undoUntil' in patch) state.undoUntil = Number.isFinite(patch.undoUntil) ? Math.max(0, patch.undoUntil) : 0;
  if ('crop' in patch) state.crop = patch.crop === null ? null : normalizedCrop(patch.crop);
  if ('sourceSize' in patch) {
    if (patch.sourceSize === null) state.sourceSize = null;
    else {
      const { width, height } = patch.sourceSize || {};
      if (!(Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 && width <= 32768 && height <= 32768)) throw new Error('The capture source dimensions are invalid.');
      state.sourceSize = { width, height };
    }
  }
  if ('capture' in patch) {
    if (patch.capture === null) state.capture = null;
    else {
      const capture = patch.capture;
      if (!CAPTURE_STATES.has(capture?.state)) throw new Error('The dock capture state is invalid.');
      state.capture = {
        state: capture.state,
        startedAt: Number.isFinite(capture.startedAt) ? Math.max(0, capture.startedAt) : 0,
        deadline: Number.isFinite(capture.deadline) ? Math.max(0, capture.deadline) : 0,
      };
    }
  }
  return state;
}

module.exports = { normalizeGameDockCommand, normalizeGameDockState };
