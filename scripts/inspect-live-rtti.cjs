const fs = require('node:fs');
const path = require('node:path');
const { Ck3LayoutResolver, WINDOW_CLASS } = require('../electron/live-game-resolver.cjs');

function operation(op) {
  return { rva: op.rva.toString(16), mnemonic: op.mnemonic, operands: op.operands, target: op.target?.toString(16) };
}
function fields(map) {
  return [...map.entries()].map(([token, offsets]) => ({ token, offsets: [...offsets].map((offset) => offset.toString(16)) }));
}

async function main() {
  const executable = fs.readFileSync(path.join(__dirname, '..', 'reference', 'installation', 'ck3-1.20.exe'));
  const probe = new Ck3LayoutResolver(executable, 0x140000000n, async () => { throw new Error('Unexpected read'); });
  const { imageBase: base, sections } = probe.pe;
  const readMemory = async (address, size) => {
    const rva = Number(BigInt(address) - base);
    const section = sections.find((item) => rva >= item.rva && rva + size <= item.rva + item.size);
    if (!section) throw new Error(`Unmapped RVA ${rva?.toString(16)} (${size})`);
    return section.data.subarray(rva - section.rva, rva - section.rva + size);
  };
  const resolver = new Ck3LayoutResolver(executable, base, readMemory);
  const instruction = resolver.instruction.bind(resolver);
  resolver.instruction = (rva) => {
    try { return instruction(rva); }
    catch (error) {
      const section = resolver.sectionAtRva(rva, 16);
      const bytes = section ? (resolver.sections.get(section.name) || section.data).subarray(rva - section.rva, rva - section.rva + 16) : Buffer.alloc(0);
      console.log('Unsupported instruction:', { rva: rva.toString(16), bytes: bytes.toString('hex'), error: error.message });
      throw error;
    }
  };
  await Promise.all(['.text', '.rdata', '.data'].map((name) => resolver.loadSection(name)));
  console.log('Executable SHA-256:', require('node:crypto').createHash('sha256').update(executable).digest('hex'));
  try { console.log('DNA token:', await resolver.keywordToken('dna')); }
  catch (error) { console.log('DNA token error:', error.stack); }

  const windowTables = await resolver.vtables(WINDOW_CLASS);
  console.log('Character-window vtables:', windowTables.map((table) => ({ rva: table.rva.toString(16), subobjectOffset: table.subobjectOffset })));
  for (const table of windowTables.filter((item) => item.subobjectOffset === 0)) {
    const pointers = await resolver.readRva(table.rva, 91 * 8);
    for (let slot = 0; slot < 91; slot++) {
      const address = pointers.readBigUInt64LE(slot * 8);
      if (!resolver.inImage(address, '.text')) continue;
      const operations = [];
      try {
        let rva = Number(address - base);
        for (let count = 0; count < 40; count++) {
          const op = resolver.instruction(rva);
          operations.push(op);
          if (op.mnemonic === 'cmp' && op.operands.some((operand) => [0xc8, 0xf8, 0x100].includes(operand.displacement))) {
            console.log('Window ID comparison:', slot, JSON.stringify(operations.map(operation)));
          }
          if (op.mnemonic === 'sete') console.log('Window Sete:', slot, JSON.stringify(operations.slice(-8).map(operation)));
          if (['ret', 'jmp', 'int3'].includes(op.mnemonic)) break;
          rva = op.next;
        }
      } catch (error) {
        console.log('Window unsupported method:', { slot, functionRva: (Number(address - base)).toString(16), error: error.message, operations: operations.slice(-5).map(operation) });
      }
    }
  }

  const text = resolver.section('.text');
  const bytes = await resolver.loadSection('.text');
  const needle = Buffer.from([0xc8, 0, 0, 0, 0x0f, 0x94, 0xc0]);
  for (let at = bytes.indexOf(needle); at >= 0; at = bytes.indexOf(needle, at + 1)) {
    const start = Math.max(0, at - 10);
    console.log('Raw C8/Sete evidence:', { rva: (text.rva + at).toString(16), bytes: bytes.subarray(start, at + needle.length + 2).toString('hex') });
  }

  try { console.log('Window ID offsets:', await resolver.windowIdOffsets((await resolver.oneVtable(WINDOW_CLASS)).rva)); }
  catch (error) { console.log('Window ID resolution error:', error.message); }
  const characterTables = await resolver.vtables('.?AVCCharacter@@');
  console.log('Character vtables:', characterTables.map((table) => ({ rva: table.rva.toString(16), subobjectOffset: table.subobjectOffset })));
  for (const table of characterTables) {
    let fnRva = Number(await resolver.pointerRva(table.rva + 32) - base);
    const operations = [];
    try {
      for (let count = 0; count < 40; count++) {
        const op = resolver.instruction(fnRva);
        operations.push(op);
        if (['ret', 'jmp', 'int3'].includes(op.mnemonic)) break;
        fnRva = op.next;
      }
      fnRva = Number(await resolver.pointerRva(table.rva + 32) - base);
      const first = resolver.instruction(fnRva);
      const second = resolver.instruction(first.next);
      const third = resolver.instruction(second.next);
      if (first.mnemonic === 'movsxd' && second.mnemonic === 'sub' && third.mnemonic === 'jmp') fnRva = third.target;
      console.log('Character save dispatcher:', { table: table.rva.toString(16), functionRva: fnRva.toString(16), prefix: operations.map(operation) });
      const tokenName = resolver.tokenRegister(fnRva);
      console.log('Character token register:', tokenName);
      if (tokenName) console.log('Character dispatcher fields:', JSON.stringify(fields(resolver.walkDispatcher(fnRva, tokenName))));
    } catch (error) {
      console.log('Character dispatcher error:', { table: table.rva.toString(16), functionRva: fnRva.toString(16), error: error.stack, operations: operations.slice(-10).map(operation) });
    }
  }
  try { console.log('DNA offset:', await resolver.characterDnaOffset()); }
  catch (error) { console.log('DNA resolution error:', error.message); }
  try { console.log('Resolved layout:', await resolver.resolve()); }
  catch (error) { console.log('Full resolution error:', error.stack); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
