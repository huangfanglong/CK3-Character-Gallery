'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadEffectiveGeneCatalog, modDescriptorPath } = require('../electron/live-game-catalog.cjs');

const root = path.resolve('reference', 'virtual-catalog');
const executablePath = path.join(root, 'binaries', 'ck3.exe');
const baseDirectory = path.join(root, 'game', 'common', 'genes');
const userDataDirectory = path.join(root, 'user-data');
const firstMod = path.join(root, 'mods', 'first');
const secondMod = path.join(root, 'mods', 'second');
const files = new Map();
const directories = new Map();
const normalize = (value) => path.resolve(value).toLowerCase();
const file = (filename, text) => files.set(normalize(filename), text);
const directory = (dirname, names) => directories.set(normalize(dirname), names);
const error = (code) => Object.assign(new Error(code), { code });
const readFile = async (filename) => {
  if (!files.has(normalize(filename))) throw error('ENOENT');
  return files.get(normalize(filename));
};
const readDir = async (dirname) => {
  if (!directories.has(normalize(dirname))) throw error('ENOENT');
  return directories.get(normalize(dirname)).map((name) => ({ name, isFile: () => true }));
};
const stat = async (filename) => {
  if (normalize(filename) !== normalize(baseDirectory)) throw error('ENOENT');
  return { isDirectory: () => true };
};

file(path.join(baseDirectory, '00_color.txt'), 'color_genes={ skin_color={ range={ 0.0 1.0 } defaults={ { min=0.0 max=1.0 } } } }');
file(path.join(baseDirectory, '01_morph.txt'), 'morph_genes={ gene_a={ neg={index=0} pos={index=1} } gene_b={ neg={index=0} pos={index=1} } }');
file(path.join(baseDirectory, '02_accessory.txt'), 'accessory_genes={ ear_accessory={ none={index=0} } }');
directory(baseDirectory, ['02_accessory.txt', '01_morph.txt', '00_color.txt']);
file(path.join(userDataDirectory, 'mod', 'first.mod'), `path="${firstMod.replaceAll('\\', '/')}"`);
file(path.join(userDataDirectory, 'mod', 'second.mod'), `path="${secondMod.replaceAll('\\', '/')}"\nreplace_path="common/genes"`);
file(path.join(userDataDirectory, 'dlc_load.json'), JSON.stringify({ enabled_mods: ['mod/first.mod'] }));
file(path.join(firstMod, 'common', 'genes', '01_morph.txt'), 'morph_genes={ gene_a={ left={index=7} right={index=8} values={ 0.0 0.0 } } gene_b={ neg={index=0} pos={index=1} } }');
file(path.join(firstMod, 'common', 'genes', 'zz_extra.txt'), 'morph_genes={ gene_mod={ low={index=2} high={index=3} } }\nspecial_genes={ accessory_genes={ silver_hair={} } }');
directory(path.join(firstMod, 'common', 'genes'), ['zz_extra.txt', '01_morph.txt']);
file(path.join(secondMod, 'common', 'genes', 'replacement.txt'), 'color_genes={ replaced_color={} }\nmorph_genes={ replaced_morph={ neg={index=0} pos={index=1} } }');
directory(path.join(secondMod, 'common', 'genes'), ['replacement.txt']);

(async () => {
  const options = { userDataDirectory, readFile, readDir, stat };
  const vanilla = await loadEffectiveGeneCatalog(executablePath, { ...options, enabledMods: [] });
  assert.deepEqual(vanilla.genes.map((gene) => gene.name), ['skin_color', 'gene_a', 'gene_b', 'ear_accessory']);
  assert.equal(vanilla.sourceCount, 3);
  assert.equal(vanilla.enabledModCount, 0);
  assert.equal(vanilla.byName.get('skin_color').color, true, 'Positional lists and anonymous blocks are valid installation script.');

  const modded = await loadEffectiveGeneCatalog(executablePath, options);
  assert.deepEqual(modded.genes.map((gene) => gene.name), ['skin_color', 'gene_a', 'gene_b', 'ear_accessory', 'gene_mod']);
  assert.deepEqual(modded.byName.get('gene_a').templates, { left: 7, right: 8 });
  assert.equal(modded.genes[1].name, 'gene_a', 'An override replaces its original raw-array position.');
  assert.equal(modded.sourceCount, 4);
  assert.equal(modded.enabledModCount, 1);
  assert.equal(modded.specialByName.has('silver_hair'), true);
  assert.notEqual(modded.hash, vanilla.hash);

  file(path.join(userDataDirectory, 'dlc_load.json'), JSON.stringify({ enabled_mods: ['mod/first.mod', 'mod/second.mod'] }));
  const replaced = await loadEffectiveGeneCatalog(executablePath, options);
  assert.deepEqual(replaced.genes.map((gene) => gene.name), ['replaced_color', 'replaced_morph']);
  assert.equal(replaced.sourceCount, 1);
  assert.equal(replaced.enabledModCount, 2);

  file(path.join(userDataDirectory, 'dlc_load.json'), JSON.stringify({ enabled_mods: ['mod/missing.mod'] }));
  await assert.rejects(loadEffectiveGeneCatalog(executablePath, options), /descriptor.*not found/);
  assert.throws(() => modDescriptorPath(userDataDirectory, '../outside.mod'), /unsafe|outside/);
  assert.throws(() => modDescriptorPath(userDataDirectory, path.resolve(root, 'outside.mod')), /invalid descriptor path/);
  console.log('Live game catalog tests passed: vanilla/modded mixed files, positional and anonymous values, in-place overrides, special genes, replace_path, and missing-descriptor refusal.');
})().catch((failure) => { console.error(failure); process.exitCode = 1; });
