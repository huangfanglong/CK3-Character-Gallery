/* In-place DOM morphing: render() diffs the new markup against the live tree instead of
   replacing it, so scroll positions, focus, selection, and one-time event delegation all
   survive re-renders without manual bookkeeping. */

function morphAppContent(container, markup) {
  const template = document.createElement('template');
  template.innerHTML = markup;
  morphChildren(container, template.content);
}

/* Stable identity for list items so reordering reuses nodes instead of rebuilding them. */
function morphKey(node) {
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  return node.id
    || node.getAttribute('data-character-id')
    || node.getAttribute('data-gallery')
    || node.getAttribute('data-variant');
}

function sameMorphIdentity(a, b) {
  if (a.nodeType !== b.nodeType) return false;
  if (a.nodeType !== Node.ELEMENT_NODE) return true;
  /* Differing preserve tokens mean a different modal instance: replace instead of morphing so
     listeners bound to the old subtree cannot leak into the new one. */
  return a.tagName === b.tagName && a.getAttribute('data-preserve') === b.getAttribute('data-preserve');
}

function morphNode(from, to) {
  if (from.nodeType !== Node.ELEMENT_NODE) {
    if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
    return;
  }
  /* Subtrees whose state lives in the DOM (crop stage, note highlighter, DNA editor) opt out
     of morphing: identical data-preserve tokens mean the live subtree is the source of truth. */
  const preserveToken = to.getAttribute('data-preserve');
  if (preserveToken && from.getAttribute('data-preserve') === preserveToken) return;
  syncMorphAttributes(from, to);
  if (from.tagName === 'TEXTAREA') {
    if (document.activeElement !== from && from.value !== to.value) from.value = to.value;
    return;
  }
  syncMorphFormState(from, to);
  morphChildren(from, to);
}

function syncMorphAttributes(from, to) {
  for (const { name, value } of [...to.attributes]) {
    if (from.getAttribute(name) !== value) from.setAttribute(name, value);
  }
  for (const { name } of [...from.attributes]) {
    if (!to.hasAttribute(name)) from.removeAttribute(name);
  }
}

function syncMorphFormState(from, to) {
  if (from instanceof HTMLInputElement) {
    if (document.activeElement !== from && from.value !== to.value) from.value = to.value;
    if ((from.type === 'checkbox' || from.type === 'radio') && from.checked !== to.checked) from.checked = to.checked;
  } else if (from instanceof HTMLSelectElement) {
    if (document.activeElement !== from && from.value !== to.value) from.value = to.value;
  }
}

function morphChildren(from, to) {
  const existing = [...from.childNodes];
  const incoming = [...to.childNodes];
  const used = new Set();
  const keyedExisting = new Map();
  for (const node of existing) {
    const key = morphKey(node);
    if (key !== null && !keyedExisting.has(key)) keyedExisting.set(key, node);
  }
  let anchor = null;
  for (const target of incoming) {
    const match = findMorphMatch(existing, used, keyedExisting, target);
    if (match) {
      used.add(match);
      morphNode(match, target);
      placeMorphNode(from, match, anchor);
      anchor = match;
    } else {
      placeMorphNode(from, target, anchor);
      anchor = target;
    }
  }
  for (const node of existing) {
    if (!used.has(node) && node.parentNode === from) from.removeChild(node);
  }
}

function findMorphMatch(existing, used, keyedExisting, target) {
  const targetKey = morphKey(target);
  if (targetKey !== null) {
    const match = keyedExisting.get(targetKey);
    return match && !used.has(match) && sameMorphIdentity(match, target) ? match : null;
  }
  for (const node of existing) {
    if (used.has(node) || !sameMorphIdentity(node, target)) continue;
    if (morphKey(node) !== null) continue;
    return node;
  }
  return null;
}

function placeMorphNode(parent, node, anchor) {
  const desired = anchor ? anchor.nextSibling : parent.firstChild;
  if (node !== desired) parent.insertBefore(node, desired);
}
