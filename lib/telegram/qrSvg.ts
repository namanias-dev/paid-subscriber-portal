/**
 * Minimal QR Code → SVG generator (pure TS, no deps).
 * ECC level M, byte mode, versions 1–10. Sufficient for typical t.me deep links.
 */

/* ---- GF(256) Reed-Solomon ---- */
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function initGf() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
})();

function gfMul(a: number, b: number): number {
  if (!a || !b) return 0;
  return EXP[LOG[a]! + LOG[b]!]!;
}

function rsGenerator(ecLen: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < ecLen; i++) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j]!;
      next[j + 1] ^= gfMul(poly[j]!, EXP[i]!);
    }
    poly = next;
  }
  return poly;
}

/** ECC codewords per version for level M (versions 1–10). */
const EC_CODEWORDS_M = [0, 10, 16, 26, 36, 48, 64, 84, 108, 130, 156];
/** Total data capacity (codewords) level M versions 1–10. */
const DATA_CODEWORDS_M = [0, 16, 28, 44, 64, 86, 108, 124, 154, 182, 216];

function bitBuffer() {
  const bits: number[] = [];
  return {
    put(val: number, len: number) {
      for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
    },
    toBytes(size: number): Uint8Array {
      const out = new Uint8Array(size);
      for (let i = 0; i < bits.length && i < size * 8; i++) {
        if (bits[i]) out[i >> 3]! |= 0x80 >> (i & 7);
      }
      return out;
    },
    length: () => bits.length,
  };
}

function chooseVersion(byteLen: number): number {
  for (let v = 1; v <= 10; v++) {
    // byte mode: 4 mode + (8 or 16) count + 8*len + 4 terminator padding
    const countBits = v <= 9 ? 8 : 16;
    const totalBits = 4 + countBits + byteLen * 8 + 4;
    const capacityBits = DATA_CODEWORDS_M[v]! * 8;
    if (totalBits <= capacityBits) return v;
  }
  return 10; // truncate later if needed
}

function encodeData(text: string, version: number): Uint8Array {
  const enc = new TextEncoder();
  let bytes = enc.encode(text);
  const capacity = DATA_CODEWORDS_M[version]!;
  const countBits = version <= 9 ? 8 : 16;
  const maxBytes = Math.floor((capacity * 8 - 4 - countBits - 4) / 8);
  if (bytes.length > maxBytes) bytes = bytes.slice(0, Math.max(0, maxBytes));

  const buf = bitBuffer();
  buf.put(0b0100, 4); // byte mode
  buf.put(bytes.length, countBits);
  for (let i = 0; i < bytes.length; i++) buf.put(bytes[i]!, 8);
  // terminator
  const remaining = capacity * 8 - buf.length();
  buf.put(0, Math.min(4, Math.max(0, remaining)));
  // pad to byte
  while (buf.length() % 8 !== 0) buf.put(0, 1);
  const data = buf.toBytes(capacity);
  // pad codewords 0xEC / 0x11
  let i = Math.ceil(buf.length() / 8);
  let pad = 0;
  while (i < capacity) {
    data[i++] = pad % 2 === 0 ? 0xec : 0x11;
    pad++;
  }
  return data;
}

function moduleSize(version: number): number {
  return 17 + 4 * version;
}

function placeFinders(mod: number[][], size: number) {
  const draw = (r0: number, c0: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = r0 + r;
        const cc = c0 + c;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        const on =
          (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
          (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        mod[rr]![cc] = on ? 1 : 0;
      }
    }
  };
  draw(0, 0);
  draw(0, size - 7);
  draw(size - 7, 0);
}

function placeTiming(mod: number[][], size: number) {
  for (let i = 8; i < size - 8; i++) {
    mod[6]![i] = i % 2 === 0 ? 1 : 0;
    mod[i]![6] = i % 2 === 0 ? 1 : 0;
  }
}

function placeDark(mod: number[][], size: number) {
  mod[size - 8]![8] = 1;
}

const ALIGN_POS: Record<number, number[]> = {
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

function placeAlign(mod: number[][], version: number, reserved: boolean[][]) {
  const pos = ALIGN_POS[version];
  if (!pos) return;
  for (const r of pos) {
    for (const c of pos) {
      if (reserved[r]![c]) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const on = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          // center + outer ring dark; ring between light — standard pattern
          const rr = r + dr;
          const cc = c + dc;
          const dark =
            Math.max(Math.abs(dr), Math.abs(dc)) === 2 || (dr === 0 && dc === 0);
          mod[rr]![cc] = dark ? 1 : 0;
          void on;
        }
      }
    }
  }
}

function reserveAreas(size: number, version: number): boolean[][] {
  const reserved = Array.from({ length: size }, () => Array(size).fill(false));
  const mark = (r: number, c: number) => {
    if (r >= 0 && c >= 0 && r < size && c < size) reserved[r]![c] = true;
  };
  // finders + separators
  for (const [r0, c0] of [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ] as const) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) mark(r0 + r, c0 + c);
    }
  }
  // timing
  for (let i = 0; i < size; i++) {
    mark(6, i);
    mark(i, 6);
  }
  // dark module + format info
  for (let i = 0; i < 9; i++) {
    mark(8, i);
    mark(i, 8);
    mark(8, size - 1 - i);
    mark(size - 1 - i, 8);
  }
  mark(size - 8, 8);
  // alignment
  const pos = ALIGN_POS[version];
  if (pos) {
    for (const r of pos) {
      for (const c of pos) {
        if (reserved[r]![c]) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) mark(r + dr, c + dc);
        }
      }
    }
  }
  // version info for v>=7
  if (version >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        mark(i, size - 11 + j);
        mark(size - 11 + j, i);
      }
    }
  }
  return reserved;
}

function placeData(mod: number[][], reserved: boolean[][], bits: number[]) {
  const size = mod.length;
  let bitIdx = 0;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i;
      for (let c = 0; c < 2; c++) {
        const cc = col - c;
        if (reserved[row]![cc]) continue;
        mod[row]![cc] = bitIdx < bits.length ? bits[bitIdx]! : 0;
        bitIdx++;
      }
    }
    upward = !upward;
  }
}

function maskFn(mask: number, r: number, c: number): boolean {
  switch (mask) {
    case 0:
      return (r + c) % 2 === 0;
    case 1:
      return r % 2 === 0;
    case 2:
      return c % 3 === 0;
    case 3:
      return (r + c) % 3 === 0;
    case 4:
      return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5:
      return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6:
      return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    case 7:
      return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    default:
      return false;
  }
}

function applyMask(mod: number[][], reserved: boolean[][], mask: number): number[][] {
  const size = mod.length;
  const out = mod.map((row) => row.slice());
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (reserved[r]![c]) continue;
      if (maskFn(mask, r, c)) out[r]![c] = out[r]![c] ? 0 : 1;
    }
  }
  return out;
}

/** Format bits for ECC=M (01) and mask 0–7. */
const FORMAT_BITS_M = [
  0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0,
];

function placeFormat(mod: number[][], mask: number) {
  const bits = FORMAT_BITS_M[mask]!;
  const size = mod.length;
  for (let i = 0; i < 15; i++) {
    const bit = (bits >> (14 - i)) & 1;
    // horizontal near top-left
    if (i < 6) mod[8]![i] = bit;
    else if (i < 8) mod[8]![i + 1] = bit;
    else mod[8]![size - 15 + i] = bit;
    // vertical
    if (i < 8) mod[size - 1 - i]![8] = bit;
    else if (i < 9) mod[15 - i]![8] = bit;
    else mod[14 - i]![8] = bit;
  }
  mod[size - 8]![8] = 1;
}

function penalty(mod: number[][]): number {
  const size = mod.length;
  let score = 0;
  // N1: runs
  for (let r = 0; r < size; r++) {
    let run = 1;
    for (let c = 1; c < size; c++) {
      if (mod[r]![c] === mod[r]![c - 1]) run++;
      else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
    if (run >= 5) score += 3 + (run - 5);
  }
  for (let c = 0; c < size; c++) {
    let run = 1;
    for (let r = 1; r < size; r++) {
      if (mod[r]![c] === mod[r - 1]![c]) run++;
      else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
    if (run >= 5) score += 3 + (run - 5);
  }
  // N2: 2x2 blocks
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = mod[r]![c];
      if (v === mod[r]![c + 1] && v === mod[r + 1]![c] && v === mod[r + 1]![c + 1]) score += 3;
    }
  }
  return score;
}

function buildMatrix(text: string): number[][] {
  let version = chooseVersion(new TextEncoder().encode(text).length);
  let data = encodeData(text, version);
  // If still oversized after truncate, force v10 truncated encode
  if (data.length > DATA_CODEWORDS_M[version]!) {
    version = 10;
    data = encodeData(text, version);
  }

  const ecLen = EC_CODEWORDS_M[version]!;
  // Fix RS encode properly
  const ec = rsEncodeFixed(data, ecLen);
  const all = new Uint8Array(data.length + ec.length);
  all.set(data);
  all.set(ec, data.length);

  const bits: number[] = [];
  for (let i = 0; i < all.length; i++) {
    for (let b = 7; b >= 0; b--) bits.push((all[i]! >> b) & 1);
  }

  const size = moduleSize(version);
  const reserved = reserveAreas(size, version);
  const base = Array.from({ length: size }, () => Array(size).fill(0));
  placeFinders(base, size);
  placeTiming(base, size);
  placeAlign(base, version, reserved);
  placeDark(base, size);
  placeData(base, reserved, bits);

  let best = base;
  let bestScore = Infinity;
  let bestMask = 0;
  for (let mask = 0; mask < 8; mask++) {
    const masked = applyMask(base, reserved, mask);
    placeFormat(masked, mask);
    const s = penalty(masked);
    if (s < bestScore) {
      bestScore = s;
      best = masked;
      bestMask = mask;
    }
  }
  void bestMask;
  return best;
}

function rsEncodeFixed(data: Uint8Array, ecLen: number): Uint8Array {
  const gen = rsGenerator(ecLen);
  const msg = new Uint8Array(data.length + ecLen);
  msg.set(data);
  for (let i = 0; i < data.length; i++) {
    const coef = msg[i]!;
    if (coef === 0) continue;
    for (let j = 0; j < gen.length; j++) {
      msg[i + j]! ^= gfMul(gen[j]!, coef);
    }
  }
  return msg.slice(data.length);
}

/**
 * Return an SVG string for a QR encoding `text`.
 * @param size pixel width/height of the SVG viewport (default 200)
 */
export function qrSvg(text: string, size = 200): string {
  const payload = (text || "").slice(0, 200);
  if (!payload) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="100%" height="100%" fill="#fff"/><text x="50%" y="50%" text-anchor="middle" font-size="12" fill="#333">empty</text></svg>`;
  }
  let matrix: number[][];
  try {
    matrix = buildMatrix(payload);
  } catch {
    // Fallback: render URL as text so callers still get a usable SVG
    const esc = payload.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="100%" height="100%" fill="#fff"/><text x="8" y="${size / 2}" font-size="10" fill="#111">${esc}</text></svg>`;
  }

  const n = matrix.length;
  const quiet = 4;
  const dim = n + quiet * 2;
  const cell = size / dim;
  let rects = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!matrix[r]![c]) continue;
      const x = ((c + quiet) * cell).toFixed(2);
      const y = ((r + quiet) * cell).toFixed(2);
      rects += `<rect x="${x}" y="${y}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}" fill="#000"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/>${rects}</svg>`;
}
