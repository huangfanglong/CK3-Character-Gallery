(function webmColorModule(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined') module.exports = api;
  Object.assign(root, api);
}(typeof globalThis === 'undefined' ? this : globalThis, () => {
  const IDS = {
    SEGMENT: 0x18538067,
    TRACKS: 0x1654AE6B,
    TRACK_ENTRY: 0xAE,
    TRACK_TYPE: 0x83,
    VIDEO: 0xE0,
    COLOUR: 0x55B0,
  };
  const MASTER_IDS = new Set([IDS.SEGMENT, IDS.TRACKS, IDS.TRACK_ENTRY, IDS.VIDEO]);

  function readVint(bytes, offset, stripMarker) {
    const first = bytes[offset];
    let length = 1;
    while (length <= 8 && !(first & (0x80 >> (length - 1)))) length += 1;
    if (length > 8 || offset + length > bytes.length) throw new Error('WebM data is truncated.');
    let value = stripMarker ? first & (0x7F >> (length - 1)) : first;
    for (let index = 1; index < length; index += 1) value = (value * 256) + bytes[offset + index];
    return { length, value, unknown: stripMarker && value === (2 ** (7 * length)) - 1 };
  }

  function encodeSize(value) {
    for (let length = 1; length <= 8; length += 1) {
      if (value < (2 ** (7 * length)) - 1) {
        const bytes = new Uint8Array(length);
        let remaining = value;
        for (let index = length - 1; index >= 0; index -= 1) {
          bytes[index] = remaining & 0xFF;
          remaining = Math.floor(remaining / 256);
        }
        bytes[0] |= 0x80 >> (length - 1);
        return bytes;
      }
    }
    throw new Error('WebM element is too large.');
  }

  function concat(parts) {
    const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
    let offset = 0;
    for (const part of parts) { output.set(part, offset); offset += part.length; }
    return output;
  }

  function element(id, data) {
    return concat([Uint8Array.from(id), encodeSize(data.length), data]);
  }

  function colorElement() {
    return element([0x55, 0xB0], concat([
      element([0x55, 0xB1], Uint8Array.of(1)),
      element([0x55, 0xB9], Uint8Array.of(2)),
      element([0x55, 0xBA], Uint8Array.of(13)),
      element([0x55, 0xBB], Uint8Array.of(1)),
    ]));
  }

  function rewriteElements(bytes, start, end, inVideoTrack = false) {
    const output = [];
    let offset = start;
    let videoTrack = inVideoTrack;
    while (offset < end) {
      const id = readVint(bytes, offset, false);
      const size = readVint(bytes, offset + id.length, true);
      const dataStart = offset + id.length + size.length;
      const dataEnd = size.unknown ? end : dataStart + size.value;
      if (dataEnd > end) throw new Error('WebM data is truncated.');
      const idBytes = bytes.slice(offset, offset + id.length);
      let data = bytes.slice(dataStart, dataEnd);
      if (id.value === IDS.TRACK_ENTRY) {
        let trackType = null;
        let childOffset = dataStart;
        while (childOffset < dataEnd) {
          const childId = readVint(bytes, childOffset, false);
          const childSize = readVint(bytes, childOffset + childId.length, true);
          const childStart = childOffset + childId.length + childSize.length;
          const childEnd = childStart + childSize.value;
          if (childId.value === IDS.TRACK_TYPE && childEnd > childStart) trackType = bytes[childEnd - 1];
          childOffset = childEnd;
        }
        videoTrack = trackType === 1;
      }
      if (MASTER_IDS.has(id.value)) data = rewriteElements(bytes, dataStart, dataEnd, videoTrack);
      if (id.value === IDS.VIDEO && videoTrack) {
        const withoutColour = [];
        let childOffset = 0;
        while (childOffset < data.length) {
          const childId = readVint(data, childOffset, false);
          const childSize = readVint(data, childOffset + childId.length, true);
          const childEnd = childOffset + childId.length + childSize.length + childSize.value;
          if (childId.value !== IDS.COLOUR) withoutColour.push(data.slice(childOffset, childEnd));
          childOffset = childEnd;
        }
        data = concat([...withoutColour, colorElement()]);
      }
      output.push(concat([idBytes, size.unknown ? bytes.slice(offset + id.length, dataStart) : encodeSize(data.length), data]));
      offset = dataEnd;
      if (size.unknown) break;
    }
    return concat(output);
  }

  function normalizeWebmColor(video) {
    if (!(video instanceof ArrayBuffer)) throw new Error('WebM data is invalid.');
    const bytes = new Uint8Array(video);
    const normalized = rewriteElements(bytes, 0, bytes.length);
    return normalized.buffer.slice(normalized.byteOffset, normalized.byteOffset + normalized.byteLength);
  }

  return { normalizeWebmColor };
}));
