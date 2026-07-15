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

/* Modals that manage their own DOM (crop stage, note highlighter, DNA editor) tag their root
   with a unique data-preserve token so morphing leaves the live subtree alone; a fresh token
   per modal instance still lets a replacement modal render normally. */
let modalPreserveCounter = 0;

function modalPreserveAttribute(name) {
  modalPreserveCounter += 1;
  return `data-preserve="${name}-${modalPreserveCounter}"`;
}
