// A strict reader for Micheline's binary encoding (what PACK produces after its 05 prefix).
// Used to make sure a payload a dApp asks us to sign is one complete packed expression and not
// something else dressed up as one. Adapted from Signet's TaquitoBridge/src/micheline.js.
//
//   00 int (signed zarith)             01 string (u32 length, bytes)
//   02 sequence (u32 length, elements) 0a bytes (u32 length, bytes)
//   03 prim                             04 prim + annots
//   05 prim arg                         06 prim arg + annots
//   07 prim arg arg                     08 prim arg arg + annots
//   09 prim (u32 length, args) + annots

const MAX_DEPTH = 128;

class Malformed extends Error {}

function u32(b, p) {
  if (p + 4 > b.length) throw new Malformed();
  return ((b[p] << 24) >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3];
}

function annotations(b, p) {
  const length = u32(b, p);
  if (length > b.length - p - 4) throw new Malformed();
  return p + 4 + length;
}

function elements(b, pos, length, depth) {
  if (length > b.length - pos) throw new Malformed();
  const end = pos + length;
  let p = pos;
  while (p < end) p = expression(b, p, depth + 1);
  if (p !== end) throw new Malformed();
  return end;
}

function prim(b, pos, args, annots, depth) {
  if (pos >= b.length) throw new Malformed();
  let p = pos + 1;
  for (let i = 0; i < args; i++) p = expression(b, p, depth + 1);
  return annots ? annotations(b, p) : p;
}

function expression(b, pos, depth) {
  if (depth > MAX_DEPTH || pos >= b.length) throw new Malformed();
  let p = pos + 1;
  switch (b[pos]) {
    case 0x00:
      if (p >= b.length) throw new Malformed();
      while (b[p] & 0x80) {
        p += 1;
        if (p >= b.length) throw new Malformed();
      }
      return p + 1;
    case 0x01:
    case 0x0a: {
      const length = u32(b, p);
      p += 4;
      if (length > b.length - p) throw new Malformed();
      return p + length;
    }
    case 0x02: {
      const length = u32(b, p);
      return elements(b, p + 4, length, depth);
    }
    case 0x03: return prim(b, p, 0, false, depth);
    case 0x04: return prim(b, p, 0, true, depth);
    case 0x05: return prim(b, p, 1, false, depth);
    case 0x06: return prim(b, p, 1, true, depth);
    case 0x07: return prim(b, p, 2, false, depth);
    case 0x08: return prim(b, p, 2, true, depth);
    case 0x09: {
      if (p >= b.length) throw new Malformed();
      p += 1;
      const length = u32(b, p);
      p = elements(b, p + 4, length, depth);
      return annotations(b, p);
    }
    default:
      throw new Malformed();
  }
}

export function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

/** True when `bytes` is exactly one well-formed Micheline expression. */
export function isWellFormedMicheline(bytes) {
  try {
    return expression(bytes, 0, 0) === bytes.length;
  } catch (e) {
    if (e instanceof Malformed) return false;
    throw e;
  }
}

/** True when `hex` is 05 followed by exactly one well-formed expression. */
export function isPackedMicheline(hex) {
  if (typeof hex !== "string" || hex.length < 4 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return false;
  if (hex.slice(0, 2) !== "05") return false;
  return isWellFormedMicheline(hexToBytes(hex.slice(2)));
}
