const assert = require('node:assert/strict');
const { createGeneCatalog, parsePersistentDna, persistentDnaToRaw, decodeBase64Dna, base64DnaToRaw, dnaToRaw, rawToPersistentDna } = require('../electron/live-dna-codec.cjs');

function sources({ reordered = false, shifted = false } = {}) {
  const colors = ['hair_color', 'skin_color', 'eye_color'];
  const morph = Array.from({ length: 20 }, (_, index) => `gene_shape_${index}`);
  if (reordered) [morph[2], morph[17]] = [morph[17], morph[2]];
  return [
    { name: '00_genes_color.txt', text: `color_genes={\n${colors.map((name) => `${name}={}`).join('\n')}\n}` },
    { name: '01_genes_morph.txt', text: `morph_genes={\n${morph.map((name) => `${name}={\nshape_neg={ index=${shifted ? 7 : 0} }\nshape_pos={ index=${shifted ? 3 : 1} }\n}`).join('\n')}\n}` },
    { name: '02_genes_accessories_misc.txt', text: 'accessory_genes={\neye_accessory={\nnone={ index=0 }\n}\n}' },
  ];
}

function dna(catalog, template = 'shape_pos') {
  return `ruler_designer_example={\n\ttype=male\n\tgenes={\n${catalog.genes.map((gene) => gene.color
    ? `\t\t${gene.name}={ 10 20 30 40 }`
    : `\t\t${gene.name}={ "${gene.name === 'eye_accessory' ? 'none' : template}" ${template === 'shape_pos' ? 144 : 72} "${gene.name === 'eye_accessory' ? 'none' : template}" 115 }`).join('\n')}\n\t}\n}`;
}

const oldCatalog = createGeneCatalog(sources());
const newCatalog = createGeneCatalog(sources({ reordered: true, shifted: true }));
oldCatalog.hash = 'old';
newCatalog.hash = 'new';
const original = dna(oldCatalog);
const oldRaw = persistentDnaToRaw(original, oldCatalog).raw;
const updated = persistentDnaToRaw(original, newCatalog);
assert.equal(updated.raw.length, oldRaw.length);
for (let index = 3; index < 23; index++) {
  assert.equal(updated.raw[index * 4], 3, 'Template names remap to the new installation index.');
  assert.equal(updated.raw[index * 4 + 1], oldRaw[index * 4 + 1], 'Gene meaning follows its name, not its old position.');
}
assert.notDeepEqual(updated.raw, oldRaw);
assert.deepEqual(parsePersistentDna(original).entries.get('gene_shape_0').parts.map((part) => part.template || part.value), ['shape_pos', 144, 'shape_pos', 115]);
const imported = rawToPersistentDna(updated.raw, newCatalog, { type: 'male' });
assert.equal(parsePersistentDna(imported).entries.get('gene_shape_2').parts[0].template, 'shape_pos');
assert.equal(parsePersistentDna(imported).entries.get('gene_shape_2').parts[1].value, 144);
assert.deepEqual(persistentDnaToRaw(imported, newCatalog).raw, updated.raw, 'Persistent DNA and raw records round-trip without Base64.');
assert.deepEqual(Object.keys(updated), ['raw', 'report']);
assert.equal(JSON.stringify(updated.report).includes(updated.raw.toString('base64')), false);
assert.match(updated.report.message, /Hair, beard, clothing/);

const withUnsupported = original.replace('\n\t}', '\n\thairstyles={ "all_hairstyles" 0 "all_hairstyles" 0 }\n\tbeards={ "no_beard" 0 "no_beard" 0 }\n\t}');
const unsupported = persistentDnaToRaw(withUnsupported, newCatalog);
assert.deepEqual(unsupported.report.excluded, ['hairstyles', 'beards']);
assert.throws(() => persistentDnaToRaw(original.replace('shape_pos', 'not_in_game'), newCatalog), /no template named/);
const withUnknown = original.replace('\n\t}', '\n\tretired_mod_gene={ "shape_pos" 1 "shape_pos" 1 }\n\t}');
const ignoredUnknown = persistentDnaToRaw(withUnknown, newCatalog);
assert.deepEqual(ignoredUnknown.raw, updated.raw, 'A retired gene is ignored without displacing recognized genes.');
assert.match(ignoredUnknown.report.message, /1 unknown gene was ignored/);
const partialDna = original.replace(/gene_shape_19=\{[^\n]+\}/, '');
assert.throws(() => persistentDnaToRaw(partialDna, newCatalog), /missing.*current DNA/);
const preservedIndex = newCatalog.genes.findIndex((gene) => gene.name === 'gene_shape_19');
const targetRaw = Buffer.from(updated.raw);
targetRaw[preservedIndex * 4 + 1] = 217;
targetRaw[preservedIndex * 4 + 3] = 218;
const patched = persistentDnaToRaw(partialDna, newCatalog, { baseRaw: targetRaw });
assert.deepEqual(patched.raw.subarray(preservedIndex * 4, preservedIndex * 4 + 4), targetRaw.subarray(preservedIndex * 4, preservedIndex * 4 + 4), 'A gene added by a newer mod retains the previewed target values.');
assert.deepEqual(patched.raw.subarray(0, preservedIndex * 4), updated.raw.subarray(0, preservedIndex * 4));
assert.match(patched.report.message, /23 supplied genes.*1 missing gene retains/);
assert.throws(() => persistentDnaToRaw(partialDna, newCatalog, { baseRaw: targetRaw.subarray(4) }), /wrong length/);
assert.throws(() => rawToPersistentDna(updated.raw.subarray(4), newCatalog), /exactly/);
const unknownIndex = Buffer.from(updated.raw);
unknownIndex[3 * 4] = 254;
assert.throws(() => rawToPersistentDna(unknownIndex, newCatalog), /unknown template index/);
const base64 = updated.raw.toString('base64');
assert.deepEqual(decodeBase64Dna(`\n${base64}\n`), updated.raw);
assert.deepEqual(base64DnaToRaw(base64, newCatalog).raw, updated.raw);
assert.deepEqual(dnaToRaw(base64, newCatalog).raw, updated.raw);
assert.deepEqual(dnaToRaw(original, newCatalog).raw, updated.raw);
assert.match(base64DnaToRaw(base64, newCatalog).report.message, /Base64 does not identify gene names or templates.*game version and enabled mods/);
assert.throws(() => decodeBase64Dna(`${base64}A`), /invalid or incomplete/);
assert.throws(() => decodeBase64Dna(`${base64.slice(0, -1)}!`), /invalid or incomplete/);
assert.throws(() => decodeBase64Dna(base64.slice(0, -4)), /complete four-byte gene entries/);
assert.throws(() => base64DnaToRaw(updated.raw.subarray(4).toString('base64'), newCatalog), /contains 23 genes.*requires 24/);
assert.throws(() => base64DnaToRaw(unknownIndex.toString('base64'), newCatalog), /template index.*does not define/);
assert.throws(() => createGeneCatalog([]), /no installation gene files/);
const ambiguous = sources();
ambiguous[1].text = ambiguous[1].text.replace('shape_pos={ index=1 }', 'shape_pos={ index=0 }');
assert.throws(() => createGeneCatalog(ambiguous), /ambiguous template indices/);
const moddedSpecialCatalog = createGeneCatalog([{ name: 'modded_genes.txt', text: `morph_genes={${Array.from({ length: 20 }, (_, index) => `gene_shape_${index}={shape_neg={index=0}shape_pos={index=1}range={ 0.0 1.0 }anonymous={ { enabled=1 } }}`).join('')}}\nspecial_genes={accessory_genes={modded_silver_hair={}}}` }]);
const moddedSpecialDna = dna(moddedSpecialCatalog).replace('\n\t}\n}', '\n\tmodded_silver_hair={ "silver" 0 "silver" 0 }\n\t}\n}');
const specialConversion = persistentDnaToRaw(moddedSpecialDna, moddedSpecialCatalog);
assert.deepEqual(specialConversion.report.excluded, ['modded_silver_hair'], 'Modded special genes are excluded without being treated as raw DNA.');
assert.equal(specialConversion.raw.length, 80);
const unknownSpecial = persistentDnaToRaw(moddedSpecialDna.replace('modded_silver_hair', 'unknown_modded_gene'), moddedSpecialCatalog);
assert.deepEqual(unknownSpecial.raw, specialConversion.raw, 'An unknown non-special gene is ignored without affecting the raw catalog order.');
assert.match(unknownSpecial.report.message, /1 unknown gene was ignored/);
assert.throws(() => parsePersistentDna(dna(moddedSpecialCatalog).replace('"shape_pos" 144', '"shape_pos" { 0.0 0.0 }')), /gene|property|block/i);
const quotedHashCatalog = createGeneCatalog([{ name: 'quoted-hash.txt', text: 'morph_genes={gene_shape_0={shape_pos={index=1 note="value # not a comment"}}} # actual comment\n' }]);
assert.equal(quotedHashCatalog.byName.get('gene_shape_0').templates.shape_pos, 1, 'A hash inside a quoted installation value is not a comment.');
const quotedHashDna = dna(oldCatalog).replace('gene_shape_0={ "shape_pos"', 'gene_shape_0={ "shape#pos"');
assert.equal(parsePersistentDna(quotedHashDna).entries.get('gene_shape_0').parts[0].template, 'shape#pos', 'Quoted hashes cannot hide the persistent genes-block closing brace.');
assert.throws(() => createGeneCatalog([{ name: 'deep.txt', text: `${'a={'.repeat(5000)}${'}'.repeat(5000)}` }]), /Live DNA:.*nested|Live DNA:.*depth/i, 'Hostile nesting returns a bounded domain error instead of RangeError.');
console.log('Live DNA codec tests passed: catalog-order independence, template remapping, tolerant unknown/missing genes, raw-only conversion, modded special-gene exclusion, quoted hashes, bounded nesting, and appearance exclusions.');
