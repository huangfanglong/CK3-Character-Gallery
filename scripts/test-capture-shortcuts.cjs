const assert = require('node:assert/strict');
const { CAPTURE_SHORTCUTS, isCaptureShortcut } = require('../electron/capture-shortcuts.cjs');

assert.deepEqual(CAPTURE_SHORTCUTS, [
  'CommandOrControl+Alt+G',
  'CommandOrControl+Shift+G',
  'CommandOrControl+Alt+R',
  'CommandOrControl+Shift+R',
]);
assert.equal(isCaptureShortcut('CommandOrControl+Alt+G'), true);
assert.equal(isCaptureShortcut('CommandOrControl+Shift+R'), true);
assert.equal(isCaptureShortcut('CommandOrControl+Alt+Delete'), false);
assert.equal(isCaptureShortcut('Control+Alt+G'), false);
assert.equal(isCaptureShortcut(null), false);
console.log('Capture shortcut test passed: supported accelerators and invalid input rejection.');
