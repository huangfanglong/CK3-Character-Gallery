const js = require('@eslint/js');
const globals = require('globals');
const promise = require('eslint-plugin-promise');

const rendererGlobals = Object.fromEntries([
  'MAX_PORTRAIT_VARIANTS', 'state', 'resetSelection', 'hasMaximumPortraits', 'modalPreserveAttribute', 'syncPortraitPlayback', 'setPortraitPlaybackActive',
  'DEFAULT_CHARACTER_NAME_COLOR', 'DEFAULT_CHARACTER_TITLE_COLOR', 'DEFAULT_TITLE_GLOW_COLOR', 'CHARACTER_COLOR_PRESETS', 'normalizeAppearanceColor', 'applyCharacterAppearance', 'syncCharacterAppearance', 'showCharacterAppearanceModal', 'trapAppearanceFocus', 'updateAppearanceSelection', 'updateAppearancePreview', 'resetAppearanceEditor', 'saveCharacterAppearance',
  'morphAppContent', 'morphAppRegion',
  'chromeMarkup', 'contextMenuMarkup', 'cardMarkup', 'tableMarkup', 'sidebarMarkup', 'inspectorMarkup', 'mainMarkup', 'sortControlMarkup', 'filterPanelMarkup', 'emptyResultsMarkup',
  'showCropModal', 'initializeCropInteraction', 'resetCropPosition', 'clampCropOffset', 'applyCropTransform', 'saveCroppedPortrait', 'releaseCropSource', 'appendPortrait',
  'showLiveCaptureModal', 'refreshLiveCaptureSources', 'renderLiveCaptureModal', 'trapLiveCaptureFocus', 'selectLiveCaptureSource', 'setLiveCaptureShortcut', 'setLiveCaptureLoopSearchSeconds', 'initializeLiveCapturePreview', 'resetLiveCaptureCrop', 'centerLiveCaptureCrop', 'setLiveCaptureDrawMode', 'updateLiveCaptureCoordinate', 'drawLiveCaptureFrame', 'toggleLiveCapture', 'finishLiveCapture', 'releaseLiveCapture', 'cancelLiveCapture',
  'centeredCaptureCrop', 'clampCaptureCrop', 'defaultCaptureCrop', 'displayRectForVideo', 'dragCaptureCrop', 'moveCaptureCrop', 'normalizedCaptureCrop', 'resizeCaptureCrop', 'resizeCaptureCropFromCenter', 'restoredCaptureCrop', 'selectionRectForCrop', 'snapCaptureCrop', 'LIVE_CAPTURE_FPS', 'LIVE_CAPTURE_MAX_DURATION_MS', 'LIVE_CAPTURE_MAX_FRAMES', 'LIVE_CAPTURE_VIDEO_BITRATE', 'LIVE_CAPTURE_LOOP_SEARCH_SECONDS_DEFAULT', 'LIVE_CAPTURE_LOOP_OVERLAP_FRAMES', 'LIVE_CAPTURE_LOOP_MATCH_BEFORE_FRAMES', 'LIVE_CAPTURE_LOOP_MATCH_AFTER_FRAMES', 'LIVE_CAPTURE_LOOP_MIN_BODY_FRAMES', 'LIVE_CAPTURE_LOOP_DESCRIPTOR_SIZE', 'LIVE_CAPTURE_LOOP_ANCHOR_MAX_DISTANCE', 'LIVE_CAPTURE_LOOP_WINDOW_MAX_DISTANCE', 'LIVE_CAPTURE_LOOP_MOTION_MAX_DISTANCE', 'LIVE_CAPTURE_LOOP_SCORE_MAX', 'normalizeLiveCaptureLoopSearchSeconds', 'createLiveCaptureLoopProcessor', 'createLiveCaptureEncoder',
  'showCharacterModal', 'showGalleryModal', 'showRenameGalleryModal', 'showDeleteGalleryConfirmation', 'showGalleryBatchDeleteConfirmation', 'showImportModal', 'showNoteModal', 'syncNoteHighlightScroll', 'updateNoteHighlights', 'showManageModal', 'showTransferCharacterModal', 'showDeleteConfirmation', 'showDeleteVariantConfirmation', 'showBatchDeleteConfirmation', 'showDnaOverwriteConfirmation', 'handleModalAction', 'deleteSelectedVariant',
  'duplicateSelectedCharacter', 'transferCharacters', 'uniqueCollectionName', 'duplicateActiveGallery', 'copyDna', 'saveLibrary', 'referencedImagePaths', 'cleanupUnusedPortraits', 'exportCollection', 'importCollection',
  'showDnaModal', 'hasBalancedBraces', 'isValidCk3Dna', 'openClipboardDna', 'pasteDnaFromClipboard', 'homogenizeDna', 'updateDnaCount', 'recordDnaHistory', 'setDnaEditorValue', 'undoDnaChange', 'redoDnaChange',
  'desktop', 'app', 'SORT_OPTIONS', 'escapeHtml', 'noteTags', 'highlightedNoteMarkup', 'characterTags', 'activeFilterCount', 'availableTags', 'clearFilters', 'getGallery', 'getCharacters', 'getActiveCharacter', 'gallerySortMode', 'normalizedCharacter', 'colorFor', 'visibleCharacters', 'imageUrlFor', 'coverVariantIndex', 'portraitMarkup', 'icon', 'render', 'focusWithoutScroll', 'updateImageUrls', 'runPortraitSourceRequest', 'activePortraitTarget', 'characterForPortraitTarget', 'MAX_ANIMATED_PORTRAIT_BYTES', 'installEventDelegation', 'openContextMenu', 'handleContextAction', 'saveCollectionOrder', 'setSortMode', 'saveCustomCardOrder', 'cycleCardPortrait', 'toggleFavorite', 'saveCharacterTitle', 'startBatchSelection', 'cancelBatchSelection', 'toggleBatchSelection', 'selectAllVisibleCharacters', 'startGalleryBatchSelection', 'cancelGalleryBatchSelection', 'toggleGalleryBatchSelection', 'restoreSelectionFocus', 'action', 'showToast', 'readableError', 'chooseImage', 'pasteClipboardPortrait', 'pasteClipboardContent', 'bindModalDelegation', 'runModalAction', 'installKeyboardShortcuts', 'installClipboardPasteHandler', 'openClipboardFile', 'openClipboardSource', 'boot',
].map((name) => [name, 'readonly']));

module.exports = [
  {
    ignores: ['character_gallery_data/**', 'node_modules/**', 'release/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,cjs}'],
    plugins: { promise },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'promise/catch-or-return': 'error',
      'promise/no-return-wrap': 'error',
      'promise/param-names': 'error',
    },
  },
  {
    files: ['electron/**/*.cjs', 'scripts/**/*.cjs', 'eslint.config.cjs'],
    languageOptions: {
      globals: globals.node,
      sourceType: 'commonjs',
    },
  },
  {
    files: ['renderer/**/*.js'],
    languageOptions: {
      globals: { ...globals.browser, ...rendererGlobals },
      sourceType: 'script',
    },
    rules: {
      // Renderer files are ordered classic scripts, so declarations are consumed across files.
      'no-redeclare': ['error', { builtinGlobals: false }],
      'no-unused-vars': 'off',
    },
  },
  {
    files: ['electron/capture-hud.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['renderer/capture-geometry.js'],
    languageOptions: { globals: { module: 'readonly' } },
  },
  {
    files: ['electron/gallery-transfer.cjs'],
    rules: {
      // The folder-name sanitizer intentionally strips ASCII control characters.
      'no-control-regex': 'off',
    },
  },
];
