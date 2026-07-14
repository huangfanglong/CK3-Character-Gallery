const MAX_PORTRAIT_VARIANTS = 5;

const state = {
  galleries: [],
  activeGallery: 'Default',
  activeId: null,
  focusContext: 'character',
  selectedVariantIndex: null,
  imageUrls: new Map(),
  query: '',
  filters: { dna: 'all', favorites: false, tags: new Set() },
  filterPanelOpen: false,
  sortMenuOpen: false,
  sort: 'recent',
  view: 'cards',
  preview: false,
  imageDirectory: '',
  dataDirectory: '',
  startupWarning: '',
  modal: null,
  importFolder: null,
  activeMenu: null,
  cropSession: null,
  pendingPortraitSource: null,
  pendingDnaSource: null,
  dnaHistory: null,
  focusDnaSave: false,
  batchMode: false,
  selectedCharacterIds: new Set(),
  contextMenu: null,
  saved: false,
  favorites: new Set(JSON.parse(localStorage.getItem('ck3-favorites') || '[]')),
};

function resetSelection(activeId = null) {
  state.activeId = activeId;
  state.focusContext = 'character';
  state.selectedVariantIndex = null;
}

function hasMaximumPortraits(character) {
  return (character?.images?.length || 0) >= MAX_PORTRAIT_VARIANTS;
}
