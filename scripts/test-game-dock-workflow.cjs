const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

const context = {
  console, crypto,
  state: {
    galleries: [{ name: 'Court', characters: [] }], activeGallery: 'Court', activeId: null,
    focusContext: 'character', selectedVariantIndex: null, preview: false, modal: null,
    sort: 'recent', allGalleries: false, captureSession: null, cropSession: null,
    imageUrls: new Map(), favorites: new Set(),
  },
  dockUpdates: [], deletedImages: [],
  desktop: { updateGameDock(patch) { context.dockUpdates.push(patch); }, },
  saveResult: true,
  render() {}, showToast() {}, cancelBatchSelection() {},
  isValidCk3Dna: (value) => typeof value === 'string' && Boolean(value),
  readableError: (error, fallback) => error?.message || fallback,
  normalizedCaptureCrop: (crop, width, height) => ({ centerX: (crop.x + crop.size / 2) / width, centerY: (crop.y + crop.size / 2) / height, size: crop.size / Math.min(width, height) }),
  characterForPortraitTarget(target) { return context.state.galleries.find((gallery) => gallery.name === target?.galleryName)?.characters.find((character) => character.id === target?.characterId) || null; },
  resetSelection(id = null) { context.state.activeId = id; context.state.focusContext = 'character'; context.state.selectedVariantIndex = null; },
  cleanupUnusedPortraits: async (paths) => { context.deletedImages.push(...paths); return 0; },
  bindCharacterGallery(id) { const gallery = context.state.galleries.find((item) => item.characters.some((character) => character.id === id)); if (gallery) context.state.activeGallery = gallery.name; },
  startDockLiveCapture: async () => { context.state.captureSession = { dock: true, phase: 'ready', crop: { x: 100, y: 0, size: 500 }, video: { videoWidth: 1000, videoHeight: 500 } }; },
  captureDockSnapshot: async () => true,
  toggleLiveCapture: async () => {},
  releaseDockCapture: async () => { context.state.captureSession = null; },
};
context.getGallery = () => context.state.galleries.find((gallery) => gallery.name === context.state.activeGallery) || context.state.galleries[0];
context.saveLibrary = async () => context.saveResult;
vm.createContext(context);
for (const file of ['character-records.js', 'game-dock-workflow.js']) vm.runInContext(fs.readFileSync(require.resolve(`../renderer/${file}`), 'utf8'), context);

(async () => {
  const created = await context.processGameDockCommand({ operationId: 'op-1', type: 'quick-add', payload: { draftId: 'draft-1', dna: 'valid-dna', collection: 'Court', gameHwnd: '42' } });
  assert.equal(created.ok, true);
  const character = context.state.galleries[0].characters[0];
  assert.equal(character.name, 'Unnamed character');
  assert.equal(character.dna, 'valid-dna');
  assert.equal(context.dockUpdates.at(-1).mode, 'framing');
  assert.equal(context.state.activeId, null);

  const undo = await context.processGameDockCommand({ operationId: 'op-2', type: 'undo-create', payload: { draftId: 'draft-1' } });
  assert.equal(undo.ok, true);
  assert.equal(context.state.galleries[0].characters.length, 0);
  const staleUndo = await context.processGameDockCommand({ operationId: 'op-3', type: 'undo-create', payload: { draftId: 'draft-1' } });
  assert.equal(staleUndo.ok, false);

  const dnaOnly = await context.processGameDockCommand({ operationId: 'op-4', type: 'create-record', payload: { draftId: 'draft-2', name: 'DNA only', dna: 'dna-2', collection: 'Court', frame: false, gameHwnd: '42' } });
  assert.equal(dnaOnly.ok, true);
  assert.equal(context.dockUpdates.at(-1).mode, 'success');
  assert.ok(context.dockUpdates.at(-1).undoUntil > Date.now());
  assert.equal(context.state.galleries[0].characters[0].name, 'DNA only');

  await context.processGameDockCommand({ operationId: 'op-5', type: 'select-for-test', payload: {} }).catch(() => {});
  context.state.modal = 'unrelated editor';
  const busy = await context.processGameDockCommand({ operationId: 'op-6', type: 'quick-add', payload: { draftId: 'draft-3', dna: 'dna-3', collection: 'Court', gameHwnd: '42' } });
  assert.equal(busy.ok, false);
  assert.match(busy.error, /Finish or cancel/);
  assert.equal(context.state.galleries[0].characters.length, 1);
  assert.equal(context.state.modal, 'unrelated editor');
  context.state.modal = null;

  const missing = await context.processGameDockCommand({ operationId: 'op-7', type: 'quick-add', payload: { draftId: 'draft-4', dna: 'dna', collection: 'Deleted', gameHwnd: '42' } });
  assert.equal(missing.ok, false);
  assert.equal(context.state.galleries[0].characters.length, 1);
  context.state.captureSession = null;
  const stale = await context.processGameDockCommand({ operationId: 'op-8', type: 'quick-add', payload: { draftId: 'draft-5', dna: 'dna-5', collection: 'Court', gameHwnd: '42', frame: false } });
  assert.equal(stale.ok, true);
  const previousDraftUndo = await context.processGameDockCommand({ operationId: 'op-9', type: 'undo-create', payload: { draftId: 'draft-2' } });
  assert.equal(previousDraftUndo.ok, false, 'A new quick-add must invalidate the previous draft Undo state.');
  assert.equal(context.state.galleries[0].characters.length, 2);

  context.drawLiveCaptureFrame = () => true;
  context.hasMaximumPortraits = () => false;
  context.desktop.saveCroppedImage = async (characterId, payload) => {
    assert.equal(characterId, context.state.galleries[0].characters.at(-1).id);
    assert.equal(payload.size, 450);
    return { path: 'dock-portrait.png', url: 'file:///dock-portrait.png' };
  };
  context.appendPortrait = async (character, selected) => {
    if (!context.appendResult && context.appendResult !== undefined) return false;
    character.images = [selected.path];
    character.modified += 1;
    return true;
  };
  context.appendResult = true;
  context.state.captureSession = { dock: true, dockDraftId: 'draft-5', phase: 'ready', canvas: { toDataURL: () => 'data:image/png;base64,AA==' } };
  const snapshot = await context.processGameDockCommand({ operationId: 'op-10', type: 'snapshot', payload: { draftId: 'draft-5' } });
  assert.equal(snapshot.ok, true);
  assert.equal(context.state.galleries[0].characters.at(-1).images[0], 'dock-portrait.png');
  assert.equal(context.dockUpdates.at(-1).mode, 'success');

  const failedCreate = await context.processGameDockCommand({ operationId: 'op-11', type: 'create-record', payload: { draftId: 'draft-6', dna: 'dna-6', collection: 'Court', frame: false, gameHwnd: '42' } });
  assert.equal(failedCreate.ok, true);
  const failedCharacter = context.state.galleries[0].characters.at(-1);
  context.state.captureSession = { dock: true, dockDraftId: 'draft-6', phase: 'ready', canvas: { toDataURL: () => 'data:image/png;base64,AA==' } };
  context.appendResult = false;
  const failedSnapshot = await context.processGameDockCommand({ operationId: 'op-12', type: 'snapshot', payload: { draftId: 'draft-6' } });
  assert.equal(failedSnapshot.ok, false);
  assert.equal(failedCharacter.images?.length || 0, 0);
  assert.ok(context.deletedImages.includes('dock-portrait.png'), 'A failed archive append removes the newly written snapshot.');

  const countBeforeRetry = context.state.galleries[0].characters.length;
  context.startDockLiveCapture = async () => { throw new Error('Capture unavailable'); };
  const failedStart = await context.processGameDockCommand({ operationId: 'op-13', type: 'quick-add', payload: { draftId: 'draft-7', dna: 'dna-7', collection: 'Court', gameHwnd: '42' } });
  assert.equal(failedStart.ok, false);
  assert.equal(context.state.galleries[0].characters.length, countBeforeRetry + 1);
  context.startDockLiveCapture = async () => { context.state.captureSession = { dock: true, phase: 'ready', crop: { x: 100, y: 0, size: 500 }, video: { videoWidth: 1000, videoHeight: 500 } }; };
  const retryCharacter = context.state.galleries[0].characters.at(-1);
  const createdModified = retryCharacter.modified;
  retryCharacter.modified += 1;
  const retry = await context.processGameDockCommand({ operationId: 'op-14', type: 'retry', payload: { draftId: 'draft-7' } });
  assert.equal(retry.ok, true);
  assert.equal(context.state.galleries[0].characters.length, countBeforeRetry + 1, 'Retrying capture must not duplicate the saved character.');
  const changedUndo = await context.processGameDockCommand({ operationId: 'op-15', type: 'undo-create', payload: { draftId: 'draft-7' } });
  assert.equal(changedUndo.ok, false, 'A capture retry must not make an externally changed character eligible for Undo.');
  assert.match(changedUndo.error, /changed since it was created/);
  assert.equal(retryCharacter.modified, createdModified + 1);
  assert.equal(context.state.galleries[0].characters.at(-1), retryCharacter);
  console.log('Game dock workflow tests passed: real creation, DNA-only saves, Undo, stale requests, busy protection, snapshots, failure cleanup, safe retry, and missing collections.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
