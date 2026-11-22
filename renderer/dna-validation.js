(function dnaValidationModule(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined') module.exports = api;
  Object.assign(root, api);
}(typeof globalThis === 'undefined' ? this : globalThis, () => {
  function hasBalancedBraces(text) {
    let depth = 0;
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      if (text[index] === '"' && text[index - 1] !== '\\') quoted = !quoted;
      if (quoted) continue;
      if (text[index] === '{') depth += 1;
      if (text[index] === '}') depth -= 1;
      if (depth < 0) return false;
    }
    return depth === 0;
  }

  function isValidCk3Dna(value) {
    if (typeof value !== 'string' || value.length > 1_000_000) return false;
    const text = value.trim();
    if (!text) return false;
    const plainTextDna = /^[\w.-]+\s*=\s*\{/.test(text)
      && /\bgenes\s*=\s*\{/.test(text)
      && /\b(?:hair_color|skin_color|eye_color|gene_[\w]+|face_detail_[\w]+)\s*=\s*\{/.test(text)
      && hasBalancedBraces(text);
    if (plainTextDna) return true;
    const compact = text.replace(/\s+/g, '');
    if (compact.length < 80 || compact.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return false;
    try {
      const decoded = typeof atob === 'function' ? atob(compact.padEnd(Math.ceil(compact.length / 4) * 4, '=')) : Buffer.from(compact, 'base64').toString('binary');
      return decoded.length >= 60;
    } catch { return false; }
  }

  return { isValidCk3Dna };
}));
