'use strict';

// CK3's four-byte gene array is positional. Keep persistent text as the archival
// representation, and construct bytes only against a catalog read from this installation.
const MAX_DNA_LENGTH = 1_000_000;
const MAX_GENES = 1000;
const UNSUPPORTED_GENES = /^(?:beards|hairstyles|clothes|headgear|secondary_headgears|additive_headgear|clothes_hoods|legwear|special_legwear|cloaks|props_left|props_right|animated_props|pose)$/;

function dnaError(message) { return new Error(`Live DNA: ${message}`); }
function geneName(value) { return /^[a-z][a-z0-9_]{0,119}$/.test(value) ? value : ''; }

function scriptTokens(text) {
  if (typeof text !== 'string' || text.length > 8_000_000) throw dnaError('a gene file is empty or too large.');
  const tokens = text.replace(/^\uFEFF/, '').replace(/#[^\r\n]*/g, '').match(/"[^"\r\n]*"|[{}=]|[^\s{}="]+/g) || [];
  return tokens;
}

function scriptBlock(tokens, start = 0, nested = false) {
  const result = [];
  let index = start;
  while (index < tokens.length) {
    const key = tokens[index];
    if (key === '}') {
      if (!nested) throw dnaError('a gene file has an unexpected closing brace.');
      return { children: result, next: index + 1 };
    }
    if (key === '=') throw dnaError('a gene file has invalid syntax.');
    if (key === '{') {
      if (!nested) throw dnaError('a gene file has an unexpected opening brace.');
      const child = scriptBlock(tokens, index + 1, true);
      result.push({ children: child.children });
      index = child.next;
      continue;
    }
    /* Clausewitz gene files contain positional lists and anonymous blocks as well as
       key/value properties (for example blend_range={ 0.0 0.0 } and age curves).
       Preserve those values as syntax nodes; only indexed gene templates are consumed
       by the DNA codec below. Persistent DNA itself retains its separate strict parser. */
    if (tokens[index + 1] !== '=') {
      if (!nested) throw dnaError(`a gene file has an invalid property near “${key}”.`);
      result.push({ value: key.replace(/^"|"$/g, '') });
      index += 1;
      continue;
    }
    if (tokens[index + 2] === '{') {
      const child = scriptBlock(tokens, index + 3, true);
      result.push({ key, children: child.children });
      index = child.next;
    } else {
      const value = tokens[index + 2];
      if (value === undefined || ['}', '=', '{'].includes(value)) throw dnaError(`the gene property “${key}” has no value.`);
      result.push({ key, value: value.replace(/^"|"$/g, '') });
      index += 3;
    }
  }
  if (nested) throw dnaError('a gene file has an unclosed block.');
  return { children: result, next: index };
}

function parseGeneScript(text) { return scriptBlock(scriptTokens(text)).children; }
function childrenOf(node, key) { return node?.children?.filter((child) => child.key === key) || []; }
function directIndex(node) {
  const indexes = node.children.filter((child) => child.key === 'index' && child.value !== undefined);
  if (indexes.length !== 1 || !/^\d{1,3}$/.test(indexes[0].value) || Number(indexes[0].value) > 255) return null;
  return Number(indexes[0].value);
}

const GENE_GROUPS = { color_genes: 'color', morph_genes: 'morph', accessory_genes: 'accessory' };

function createGeneCatalog(sources) {
  if (!Array.isArray(sources) || !sources.length) throw dnaError('no installation gene files were supplied.');
  const genes = [];
  const byName = new Map();
  const specialByName = new Set();
  for (const source of sources) {
    const root = { children: parseGeneScript(source.text) };
    const expected = { color: 'color_genes', morph: 'morph_genes', accessory: 'accessory_genes' }[source.kind];
    const groups = expected ? childrenOf(root, expected) : root.children.filter((child) => GENE_GROUPS[child.key]);
    if (expected && groups.length !== 1) throw dnaError(`${expected} must occur exactly once in ${source.name || 'the gene file'}.`);
    for (const group of groups) {
      const kind = GENE_GROUPS[group.key];
      if (!group.children) throw dnaError(`${group.key} is not a gene block in ${source.name || 'the gene file'}.`);
      for (const node of group.children) {
        const name = geneName(node.key);
        if (!name || !node.children) throw dnaError(`an invalid gene occurs in ${source.name || 'the gene file'}.`);
        const templates = {};
        const byIndex = new Map();
        for (const template of node.children) {
          if (!template.children) continue;
          const index = directIndex(template);
          if (index === null) continue;
          if (!geneName(template.key) || byIndex.has(index)) throw dnaError(`${name} has ambiguous template indices.`);
          if (Object.hasOwn(templates, template.key)) throw dnaError(`${name} has a duplicate template name.`);
          templates[template.key] = index;
          byIndex.set(index, template.key);
        }
        if (kind !== 'color' && byIndex.size === 0) throw dnaError(`${name} has no indexed templates.`);
        const gene = { name, color: kind === 'color', templates, byIndex };
        const previous = byName.get(name);
        if (previous) {
          if (previous.color !== gene.color) throw dnaError(`${name} changes its gene representation between overrides.`);
          /* CK3 replaces an overridden definition in place. Moving it to the end would
             misalign every following four-byte value in the live positional array. */
          genes[genes.indexOf(previous)] = gene;
        } else genes.push(gene);
        byName.set(name, gene);
      }
    }
    /* special_genes are persistent-text appearance entries, not raw character DNA.
       Record their names so Apply can explicitly exclude them instead of misclassifying
       modded hair, clothes, or visual traits as unknown raw genes. */
    for (const special of childrenOf(root, 'special_genes')) {
      for (const group of special.children || []) {
        if (!GENE_GROUPS[group.key]) continue;
        for (const node of group.children || []) {
          const name = geneName(node.key);
          if (name) specialByName.add(name);
        }
      }
    }
  }
  if (!genes.length || genes.length > MAX_GENES) throw dnaError('the installation gene count is unsupported.');
  return { genes, byName, specialByName, hash: '' };
}

function genesBody(text) {
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_DNA_LENGTH) throw dnaError('the persistent DNA is empty or too large.');
  const open = /\bgenes\s*=\s*\{/.exec(text);
  if (!open) throw dnaError('the genes block is missing.');
  let depth = 1;
  let quote = false;
  for (let i = open.index + open[0].length; i < text.length; i++) {
    if (text[i] === '"') quote = !quote;
    if (quote || text[i] === '#') {
      if (text[i] === '#') while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) {
      if (depth !== 0) throw dnaError('the genes block is malformed.');
      return text.slice(open.index + open[0].length, i);
    }
  }
  throw dnaError('the genes block is not closed.');
}

function parsePersistentDna(text) {
  const body = genesBody(text);
  const entries = new Map();
  const record = /(?:^|[\s{}])([a-z][a-z0-9_]{0,119})\s*=\s*\{([^{}]*)\}/gi;
  for (const match of body.matchAll(record)) {
    const name = match[1].toLowerCase();
    if (entries.has(name)) throw dnaError(`${name} occurs more than once.`);
    const tokens = [...match[2].matchAll(/"([^"\r\n]{0,120})"|(-?\d+(?:\.\d+)?)|([^\s]+)/g)];
    if (tokens.length !== 4) throw dnaError(`${name} must have exactly four gene values.`);
    const parts = tokens.map((part) => part[1] !== undefined ? { template: part[1] } : part[2] !== undefined ? { value: Number(part[2]) } : { invalid: part[3] });
    if (parts.some((part) => part.invalid !== undefined || (part.value !== undefined && (!Number.isInteger(part.value) || part.value < 0 || part.value > 255)))) {
      throw dnaError(`${name} contains an invalid value.`);
    }
    const color = parts.every((part) => part.value !== undefined);
    const morph = parts.every((part, index) => index % 2 === 0 ? part.template !== undefined : part.value !== undefined);
    if (!color && !morph) throw dnaError(`${name} is neither a color nor a template gene.`);
    if (entries.size >= MAX_GENES) throw dnaError('the DNA contains too many genes.');
    entries.set(name, { name, color, parts });
  }
  if (entries.size < 20) throw dnaError('the persistent DNA has fewer than 20 valid genes.');
  const type = /\btype\s*=\s*"?(male|female|boy|girl)\b/i.exec(text.slice(0, /\bgenes\s*=\s*\{/.exec(text).index))?.[1].toLowerCase() || '';
  return { entries, type };
}

function byte(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 255) throw dnaError(`${label} is outside the byte range.`);
  return value;
}

function persistentDnaToRaw(text, catalog) {
  const { entries } = parsePersistentDna(text);
  const unsupported = [];
  const unknown = [];
  for (const name of entries.keys()) {
    if (!catalog.byName.has(name)) (UNSUPPORTED_GENES.test(name) || catalog.specialByName?.has(name) ? unsupported : unknown).push(name);
  }
  if (unknown.length) throw dnaError(`this installation does not define ${unknown.slice(0, 8).join(', ')}${unknown.length > 8 ? '…' : ''}. No DNA was changed.`);
  const missing = catalog.genes.filter((gene) => !entries.has(gene.name)).map((gene) => gene.name);
  if (missing.length) throw dnaError(`the persistent DNA is missing ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? '…' : ''}. No DNA was changed.`);
  const bytes = [];
  for (const gene of catalog.genes) {
    const entry = entries.get(gene.name);
    if (entry.color !== gene.color) throw dnaError(`${gene.name} has the wrong gene representation.`);
    if (gene.color) bytes.push(...entry.parts.map((part) => part.value));
    else {
      for (let strand = 0; strand < 2; strand++) {
        const name = entry.parts[strand * 2].template;
        if (!Object.hasOwn(gene.templates, name)) throw dnaError(`${gene.name} has no template named “${name}” in this installation. No DNA was changed.`);
        bytes.push(byte(gene.templates[name], `${gene.name} template`), entry.parts[strand * 2 + 1].value);
      }
    }
  }
  const raw = Buffer.from(bytes);
  return { raw, report: conversionReport(catalog, unsupported, []) };
}

function conversionReport(catalog, unsupported, remapped) {
  const excluded = [...new Set(unsupported)];
  return {
    geneCount: catalog.genes.length,
    catalogHash: catalog.hash || '',
    excluded,
    remapped,
    message: `${catalog.genes.length} genes mapped to this installation. Hair, beard, clothing, and other special appearance entries are not part of CK3’s raw DNA array${excluded.length ? `; ${excluded.length} such entr${excluded.length === 1 ? 'y was' : 'ies were'} excluded` : ''}.`,
  };
}

function rawToPersistentDna(raw, catalog, options = {}) {
  if (!Buffer.isBuffer(raw) || raw.length !== catalog.genes.length * 4 || raw.length === 0) {
    throw dnaError(`the raw array must contain exactly ${catalog.genes.length * 4} bytes for this installation.`);
  }
  const lines = [];
  for (let index = 0; index < catalog.genes.length; index++) {
    const gene = catalog.genes[index];
    const values = [...raw.subarray(index * 4, index * 4 + 4)];
    if (gene.color) lines.push(`\t\t${gene.name}={ ${values.join(' ')} }`);
    else {
      const first = gene.byIndex.get(values[0]);
      const second = gene.byIndex.get(values[2]);
      if (!first || !second) throw dnaError(`${gene.name} uses an unknown template index. The live DNA was not imported.`);
      lines.push(`\t\t${gene.name}={ "${first}" ${values[1]} "${second}" ${values[3]} }`);
    }
  }
  const type = ['male', 'female', 'boy', 'girl'].includes(options.type) ? `\n\ttype=${options.type}` : '';
  return `ruler_designer_live={${type}\n\tgenes={\n${lines.join('\n')}\n\t}\n}`;
}

module.exports = { createGeneCatalog, parseGeneScript, parsePersistentDna, persistentDnaToRaw, rawToPersistentDna, UNSUPPORTED_GENES };
