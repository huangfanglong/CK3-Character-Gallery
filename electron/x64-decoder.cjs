'use strict';

// A deliberately small, fail-closed x86-64 decoder for compiler-generated field
// dispatchers. It is not a general disassembler and never guesses instruction size.
const REGISTERS = ['rax', 'rcx', 'rdx', 'rbx', 'rsp', 'rbp', 'rsi', 'rdi'];
const REX_REGISTERS = ['r8', 'r9', 'r10', 'r11', 'r12', 'r13', 'r14', 'r15'];
const CONDITIONS = ['o', 'no', 'b', 'ae', 'e', 'ne', 'be', 'a', 's', 'ns', 'p', 'np', 'l', 'ge', 'le', 'g'];
const EXT_GROUP = ['add', 'or', 'adc', 'sbb', 'and', 'sub', 'xor', 'cmp'];

function register(code, extended, width) {
  const index = code + (extended ? 8 : 0);
  if (width === 32) return ['eax', 'ecx', 'edx', 'ebx', 'esp', 'ebp', 'esi', 'edi', 'r8d', 'r9d', 'r10d', 'r11d', 'r12d', 'r13d', 'r14d', 'r15d'][index];
  if (width === 16) return ['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di', 'r8w', 'r9w', 'r10w', 'r11w', 'r12w', 'r13w', 'r14w', 'r15w'][index];
  if (width === 8) return ['al', 'cl', 'dl', 'bl', 'spl', 'bpl', 'sil', 'dil', 'r8b', 'r9b', 'r10b', 'r11b', 'r12b', 'r13b', 'r14b', 'r15b'][index];
  return [...REGISTERS, ...REX_REGISTERS][index];
}
function signed(buffer, offset, size) {
  return size === 1 ? buffer.readInt8(offset) : buffer.readInt32LE(offset);
}

function decodeX64(bytes, start = 0) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  let at = start;
  const end = bytes.length;
  function take() { if (at >= end) throw new Error('Truncated x64 instruction.'); return bytes[at++]; }
  function available(size) { if (at + size > end) throw new Error('Truncated x64 operands.'); }
  let rex = 0;
  let legacy = 0;
  for (let count = 0; count < 15; count++) {
    const prefix = bytes[at];
    if ([0x66, 0xf2, 0xf3].includes(prefix)) { legacy = prefix; at++; }
    else if (prefix >= 0x40 && prefix <= 0x4f) { rex = prefix; at++; }
    else break;
  }
  const opcode = take();
  const result = { start, size: 0, mnemonic: '', operands: [], target: null };
  const wide = Boolean(rex & 8) && legacy !== 0x66;
  const width = legacy === 0x66 ? 16 : wide ? 64 : 32;
  function modrm(byteWidth = width) {
    const value = take();
    const mod = value >> 6;
    const reg = (value >> 3) & 7;
    const rm = value & 7;
    const destination = register(reg, Boolean(rex & 4), byteWidth);
    let base = null;
    let index = null;
    let scale = 1;
    let displacement = 0;
    let target = null;
    if (mod !== 3) {
      if (rm === 4) {
        const sib = take();
        scale = 1 << (sib >> 6);
        const indexCode = (sib >> 3) & 7;
        if (indexCode !== 4 || (rex & 2)) index = register(indexCode, Boolean(rex & 2), 64);
        if ((sib & 7) === 5 && mod === 0) { available(4); displacement = signed(bytes, at, 4); at += 4; }
        else base = register(sib & 7, Boolean(rex & 1), 64);
      } else if (rm === 5 && mod === 0) { available(4); displacement = signed(bytes, at, 4); at += 4; target = 'rip'; }
      else base = register(rm, Boolean(rex & 1), 64);
      if (mod === 1) { take(); displacement = signed(bytes, at - 1, 1); }
      else if (mod === 2) { available(4); displacement = signed(bytes, at, 4); at += 4; }
    }
    return {
      extension: reg,
      register: destination,
      operand: mod === 3 ? { kind: 'reg', name: register(rm, Boolean(rex & 1), byteWidth) }
        : { kind: 'mem', base, index, scale, displacement, ripRelative: target === 'rip' },
    };
  }
  function immediate(size, sign = false) {
    available(size);
    const value = size === 1 ? sign ? bytes.readInt8(at) : bytes[at] : size === 2 ? bytes.readUInt16LE(at) : size === 8 ? bytes.readBigUInt64LE(at) : sign ? bytes.readInt32LE(at) : bytes.readUInt32LE(at);
    at += size;
    return { kind: 'imm', value };
  }
  function binary(mnemonic, decoded, direction, byteWidth = width) {
    result.mnemonic = mnemonic;
    result.operands = direction ? [{ kind: 'reg', name: decoded.register }, decoded.operand] : [decoded.operand, { kind: 'reg', name: register(decoded.extension, Boolean(rex & 4), byteWidth) }];
    if (decoded.operand.ripRelative) decoded.operand.address = at + decoded.operand.displacement;
  }
  function branch(mnemonic, size) {
    const displacement = immediate(size, true).value;
    result.mnemonic = mnemonic;
    result.target = at + displacement;
    result.operands = [{ kind: 'address', value: result.target }];
  }
  const direct = {
    0x88: ['mov', 0, 8], 0x89: ['mov', 0, width], 0x8a: ['mov', 1, 8], 0x8b: ['mov', 1, width], 0x8d: ['lea', 1, 64],
    0x01: ['add', 0, width], 0x03: ['add', 1, width], 0x08: ['or', 0, 8], 0x09: ['or', 0, width], 0x0a: ['or', 1, 8], 0x0b: ['or', 1, width],
    0x20: ['and', 0, 8], 0x21: ['and', 0, width], 0x22: ['and', 1, 8], 0x23: ['and', 1, width], 0x28: ['sub', 0, 8], 0x29: ['sub', 0, width], 0x2a: ['sub', 1, 8], 0x2b: ['sub', 1, width],
    0x30: ['xor', 0, 8], 0x31: ['xor', 0, width], 0x32: ['xor', 1, 8], 0x33: ['xor', 1, width], 0x38: ['cmp', 0, 8], 0x39: ['cmp', 0, width], 0x3a: ['cmp', 1, 8], 0x3b: ['cmp', 1, width],
    0x84: ['test', 0, 8], 0x85: ['test', 0, width], 0x63: ['movsxd', 1, 64], 0x87: ['xchg', 0, width],
  };
  if (direct[opcode]) {
    const [mnemonic, direction, operandWidth] = direct[opcode];
    binary(mnemonic, modrm(operandWidth), direction, operandWidth);
  } else if ([0x80, 0x81, 0x83].includes(opcode)) {
    const decoded = modrm(opcode === 0x80 ? 8 : width);
    result.mnemonic = EXT_GROUP[decoded.extension];
    result.operands = [decoded.operand, immediate(opcode === 0x81 ? 4 : 1, opcode === 0x83)];
  } else if ([0xf6, 0xf7].includes(opcode)) {
    const decoded = modrm(opcode === 0xf6 ? 8 : width);
    result.mnemonic = ['test', null, 'not', 'neg', 'mul', 'imul', 'div', 'idiv'][decoded.extension];
    if (!result.mnemonic) throw new Error(`Unsupported x64 group opcode ${opcode.toString(16)}.`);
    result.operands = [decoded.operand];
    if (decoded.extension === 0) result.operands.push(immediate(opcode === 0xf6 ? 1 : 4));
  } else if ([0xfe, 0xff].includes(opcode)) {
    const decoded = modrm(opcode === 0xfe ? 8 : 64);
    result.mnemonic = opcode === 0xfe ? ['inc', 'dec'][decoded.extension] : ['inc', 'dec', 'call', 'callf', 'jmp', 'jmpf', 'push'][decoded.extension];
    if (!result.mnemonic) throw new Error('Unsupported x64 indirect instruction.');
    result.operands = [decoded.operand];
    if (decoded.operand.ripRelative) decoded.operand.address = at + decoded.operand.displacement;
  } else if ([0xc6, 0xc7].includes(opcode)) {
    const decoded = modrm(opcode === 0xc6 ? 8 : width);
    if (decoded.extension !== 0) throw new Error('Invalid x64 mov instruction.');
    result.mnemonic = 'mov';
    result.operands = [decoded.operand, immediate(opcode === 0xc6 ? 1 : 4)];
  } else if (opcode >= 0x50 && opcode <= 0x5f) {
    result.mnemonic = opcode < 0x58 ? 'push' : 'pop';
    result.operands = [{ kind: 'reg', name: register(opcode & 7, Boolean(rex & 1), 64) }];
  } else if (opcode >= 0xb0 && opcode <= 0xbf) {
    const isByte = opcode < 0xb8;
    result.mnemonic = 'mov';
    result.operands = [{ kind: 'reg', name: register(opcode & 7, Boolean(rex & 1), isByte ? 8 : width) }, immediate(isByte ? 1 : wide ? 8 : width === 16 ? 2 : 4)];
  } else if (opcode >= 0x70 && opcode <= 0x7f) branch(`j${CONDITIONS[opcode & 15]}`, 1);
  else if (opcode === 0xe8) branch('call', 4);
  else if (opcode === 0xe9) branch('jmp', 4);
  else if (opcode === 0xeb) branch('jmp', 1);
  else if ([0x05, 0x0d, 0x25, 0x2d, 0x35, 0x3d].includes(opcode)) {
    result.mnemonic = { 0x05: 'add', 0x0d: 'or', 0x25: 'and', 0x2d: 'sub', 0x35: 'xor', 0x3d: 'cmp' }[opcode];
    result.operands = [{ kind: 'reg', name: register(0, false, width) }, immediate(4)];
  } else if ([0x3c, 0xa8, 0xa9].includes(opcode)) {
    result.mnemonic = opcode === 0x3c ? 'cmp' : 'test';
    result.operands = [{ kind: 'reg', name: opcode === 0x3c ? 'al' : 'eax' }, immediate(opcode === 0xa9 ? 4 : 1)];
  } else if ([0xc2, 0xc3].includes(opcode)) {
    result.mnemonic = 'ret';
    if (opcode === 0xc2) immediate(2);
  } else if ([0x90, 0xcc, 0xc9, 0x9c, 0x9d].includes(opcode)) result.mnemonic = { 0x90: 'nop', 0xcc: 'int3', 0xc9: 'leave', 0x9c: 'pushfq', 0x9d: 'popfq' }[opcode];
  else if (opcode === 0x68) { result.mnemonic = 'push'; result.operands = [immediate(4)]; }
  else if (opcode === 0x6a) { result.mnemonic = 'push'; result.operands = [immediate(1, true)]; }
  else if (opcode === 0x0f) {
    const second = take();
    if (second >= 0x80 && second <= 0x8f) branch(`j${CONDITIONS[second & 15]}`, 4);
    else if (second >= 0x90 && second <= 0x9f) { const decoded = modrm(8); result.mnemonic = `set${CONDITIONS[second & 15]}`; result.operands = [decoded.operand]; }
    else if ([0xb6, 0xb7, 0xbe, 0xbf].includes(second)) {
      const sourceWidth = [0xb6, 0xbe].includes(second) ? 8 : 16;
      const decoded = modrm(sourceWidth);
      result.mnemonic = [0xbe, 0xbf].includes(second) ? 'movsx' : 'movzx';
      result.operands = [{ kind: 'reg', name: register(decoded.extension, Boolean(rex & 4), width) }, decoded.operand];
    } else if ([0x10, 0x11, 0x28, 0x2f, 0x57, 0x6f, 0x7f].includes(second)) {
      const decoded = modrm(64);
      result.mnemonic = { 0x10: 'movups', 0x11: 'movups', 0x28: 'movaps', 0x2f: 'movaps', 0x57: 'xorps', 0x6f: 'movq', 0x7f: 'movq' }[second];
      if (legacy === 0xf3 && [0x10, 0x11].includes(second)) result.mnemonic = 'movss';
      if (legacy === 0xf2 && [0x10, 0x11].includes(second)) result.mnemonic = 'movsd';
      result.operands = second === 0x11 || second === 0x2f || second === 0x7f ? [decoded.operand, decoded.register] : [decoded.register, decoded.operand];
    } else if ([0x1e, 0x1f, 0xae, 0xaf].includes(second)) {
      if (second === 0x1e && legacy === 0xf3 && bytes[at] === 0xfa) { at++; result.mnemonic = 'endbr64'; }
      else if (second === 0xaf) binary('imul', modrm(), 1);
      else { const decoded = modrm(); result.mnemonic = second === 0x1f ? 'nop' : 'misc'; result.operands = [decoded.operand]; }
    } else throw new Error(`Unsupported x64 opcode 0f ${second.toString(16)}.`);
  } else throw new Error(`Unsupported x64 opcode ${opcode.toString(16)}.`);
  result.size = at - start;
  if (result.size < 1 || result.size > 15) throw new Error('Invalid x64 instruction length.');
  return result;
}

module.exports = { decodeX64 };
