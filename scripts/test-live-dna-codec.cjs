const assert = require('node:assert/strict');
const { createGeneCatalog, parsePersistentDna, persistentDnaToRaw, rawToPersistentDna } = require('../electron/live-dna-codec.cjs');

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
assert.throws(() => persistentDnaToRaw(original.replace('gene_shape_1', 'modded_gene_1'), newCatalog), /does not define/);
assert.throws(() => persistentDnaToRaw(original.replace(/gene_shape_19=\{[^\n]+\}/, ''), newCatalog), /missing/);
assert.throws(() => rawToPersistentDna(updated.raw.subarray(4), newCatalog), /exactly/);
const unknownIndex = Buffer.from(updated.raw);
unknownIndex[3 * 4] = 254;
assert.throws(() => rawToPersistentDna(unknownIndex, newCatalog), /unknown template index/);
assert.throws(() => createGeneCatalog([]), /no installation gene files/);
const ambiguous = sources();
ambiguous[1].text = ambiguous[1].text.replace('shape_pos={ index=1 }', 'shape_pos={ index=0 }');
assert.throws(() => createGeneCatalog(ambiguous), /ambiguous template indices/);
const moddedSpecialCatalog = createGeneCatalog([{ name: 'modded_genes.txt', text: `morph_genes={${Array.from({ length: 20 }, (_, index) => `gene_shape_${index}={shape_neg={index=0}shape_pos={index=1}range={ 0.0 1.0 }anonymous={ { enabled=1 } }}`).join('')}}\nspecial_genes={accessory_genes={modded_silver_hair={}}}` }]);
const moddedSpecialDna = dna(moddedSpecialCatalog).replace('\n\t}\n}', '\n\tmodded_silver_hair={ "silver" 0 "silver" 0 }\n\t}\n}');
const specialConversion = persistentDnaToRaw(moddedSpecialDna, moddedSpecialCatalog);
assert.deepEqual(specialConversion.report.excluded, ['modded_silver_hair'], 'Modded special genes are excluded without being treated as raw DNA.');
assert.equal(specialConversion.raw.length, 80);
assert.throws(() => persistentDnaToRaw(moddedSpecialDna.replace('modded_silver_hair', 'unknown_modded_gene'), moddedSpecialCatalog), /does not define/);
assert.throws(() => parsePersistentDna(dna(moddedSpecialCatalog).replace('"shape_pos" 144', '"shape_pos" { 0.0 0.0 }')), /gene|property|block/i);
const quotedHashCatalog = createGeneCatalog([{ name: 'quoted-hash.txt', text: 'morph_genes={gene_shape_0={shape_pos={index=1 note="value # not a comment"}}} # actual comment\n' }]);
assert.equal(quotedHashCatalog.byName.get('gene_shape_0').templates.shape_pos, 1, 'A hash inside a quoted installation value is not a comment.');
const quotedHashDna = dna(oldCatalog).replace('gene_shape_0={ "shape_pos"', 'gene_shape_0={ "shape#pos"');
assert.equal(parsePersistentDna(quotedHashDna).entries.get('gene_shape_0').parts[0].template, 'shape#pos', 'Quoted hashes cannot hide the persistent genes-block closing brace.');
assert.throws(() => createGeneCatalog([{ name: 'deep.txt', text: `${'a={'.repeat(5000)}${'}'.repeat(5000)}` }]), /Live DNA:.*nested|Live DNA:.*depth/i, 'Hostile nesting returns a bounded domain error instead of RangeError.');
console.log('Live DNA codec tests passed: catalog-order independence, template remapping, strict unknown handling, raw-only conversion, modded special-gene exclusion, quoted hashes, bounded nesting, and appearance exclusions.');
