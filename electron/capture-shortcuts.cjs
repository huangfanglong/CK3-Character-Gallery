const CAPTURE_SHORTCUTS = Object.freeze([
  'CommandOrControl+Alt+G',
  'CommandOrControl+Shift+G',
  'CommandOrControl+Alt+R',
  'CommandOrControl+Shift+R',
]);

function isCaptureShortcut(value) {
  return CAPTURE_SHORTCUTS.includes(value);
}

module.exports = { CAPTURE_SHORTCUTS, isCaptureShortcut };
