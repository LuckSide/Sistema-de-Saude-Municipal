/**
 * Gerador offline de QR Code (ISO/IEC 18004, modo Byte, ECC L, versões 1..8)
 * Evita vazar tokens/identificadores de pacientes para serviços externos como api.qrserver.com.
 */

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(ecLen: number): number[] {
  let poly = [1];
  for (let i = 0; i < ecLen; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    const root = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], root);
    }
    poly = next;
  }
  return poly;
}

function rsComputeEc(data: number[], ecLen: number): number[] {
  const gen = rsGeneratorPoly(ecLen);
  const res = new Array<number>(data.length + ecLen).fill(0);
  for (let i = 0; i < data.length; i++) res[i] = data[i];
  for (let i = 0; i < data.length; i++) {
    const coef = res[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        res[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }
  return res.slice(data.length);
}

// Versões 1..10 ECC Level L: [versão, maxBytes, g1Blocks, g1Data, g2Blocks, g2Data, ecPerBlock, alignmentCenters]
const VERSION_SPECS: Array<[number, number, number, number, number, number, number, number[]]> = [
  [1, 17, 1, 19, 0, 0, 7, []],
  [2, 32, 1, 34, 0, 0, 10, [6, 18]],
  [3, 53, 1, 55, 0, 0, 15, [6, 22]],
  [4, 78, 1, 80, 0, 0, 20, [6, 26]],
  [5, 106, 1, 108, 0, 0, 26, [6, 30]],
  [6, 134, 2, 68, 0, 0, 18, [6, 34]],
  [7, 154, 2, 78, 0, 0, 20, [6, 22, 38]],
  [8, 192, 2, 97, 0, 0, 24, [6, 24, 42]],
  [9, 230, 2, 116, 0, 0, 30, [6, 26, 46]],
  [10, 271, 2, 68, 2, 69, 18, [6, 28, 50]],
];

const VERSION_INFO_BITS: Record<number, number> = {
  7: 0x07c94,
  8: 0x085bc,
  9: 0x09a99,
  10: 0x0a4d3,
};

function encodeBits(bytes: Uint8Array, totalDataCodewords: number, version: number): number[] {
  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };
  pushBits(0b0100, 4); // Modo Byte
  pushBits(bytes.length, version >= 10 ? 16 : 8);
  for (const b of bytes) pushBits(b, 8);

  const totalDataBits = totalDataCodewords * 8;
  const term = Math.min(4, totalDataBits - bits.length);
  pushBits(0, term);
  while (bits.length % 8 !== 0) bits.push(0);

  const padBytes = [0xec, 0x11];
  let idx = 0;
  while (bits.length < totalDataBits) {
    pushBits(padBytes[idx++ % 2], 8);
  }
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }
  return codewords;
}

function buildMatrix(text: string): { size: number; modules: boolean[][] } | null {
  const utf8 = new TextEncoder().encode(text);
  const spec = VERSION_SPECS.find((s) => utf8.length <= s[1]);
  if (!spec) return null;

  const [version, , g1Blocks, g1Data, g2Blocks, g2Data, ecPerBlock, alignCenters] = spec;
  const size = 4 * version + 17;
  const grid = Array.from({ length: size }, () => new Array<number>(size).fill(-1));
  const reserved = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));

  const setModule = (r: number, c: number, dark: boolean) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      grid[r][c] = dark ? 1 : 0;
      reserved[r][c] = true;
    }
  };

  const drawFinder = (top: number, left: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = top + dr;
        const c = left + dc;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        const inBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inCore = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        const inFinder = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        setModule(r, c, inFinder && (inBorder || inCore));
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  for (const rCenter of alignCenters) {
    for (const cCenter of alignCenters) {
      const overlapsFinder =
        (rCenter < 9 && cCenter < 9) ||
        (rCenter < 9 && cCenter > size - 10) ||
        (rCenter > size - 10 && cCenter < 9);
      if (overlapsFinder) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0);
          setModule(rCenter + dr, cCenter + dc, dark);
        }
      }
    }
  }

  for (let i = 8; i < size - 8; i++) {
    if (!reserved[6][i]) setModule(6, i, i % 2 === 0);
    if (!reserved[i][6]) setModule(i, 6, i % 2 === 0);
  }
  setModule(size - 8, 8, true);

  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      reserved[8][i] = true;
      reserved[i][8] = true;
    }
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][size - 1 - i] = true;
    reserved[size - 1 - i][8] = true;
  }

  const verBits = VERSION_INFO_BITS[version];
  if (verBits !== undefined) {
    for (let i = 0; i < 18; i++) {
      const bit = ((verBits >> i) & 1) === 1;
      const r = Math.floor(i / 3);
      const c = size - 11 + (i % 3);
      setModule(r, c, bit);
      setModule(c, r, bit);
    }
  }

  const totalDataCodewords = g1Blocks * g1Data + g2Blocks * g2Data;
  const codewords = encodeBits(utf8, totalDataCodewords, version);
  const blocksData: number[][] = [];
  const blocksEc: number[][] = [];
  let offset = 0;
  for (let b = 0; b < g1Blocks; b++) {
    const slice = codewords.slice(offset, offset + g1Data);
    offset += g1Data;
    blocksData.push(slice);
    blocksEc.push(rsComputeEc(slice, ecPerBlock));
  }
  for (let b = 0; b < g2Blocks; b++) {
    const slice = codewords.slice(offset, offset + g2Data);
    offset += g2Data;
    blocksData.push(slice);
    blocksEc.push(rsComputeEc(slice, ecPerBlock));
  }

  const stream: number[] = [];
  const maxDataCols = Math.max(g1Data, g2Data);
  for (let i = 0; i < maxDataCols; i++) {
    for (let b = 0; b < blocksData.length; b++) {
      if (i < blocksData[b].length) stream.push(blocksData[b][i]);
    }
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (let b = 0; b < blocksEc.length; b++) stream.push(blocksEc[b][i]);
  }

  const streamBits: number[] = [];
  for (const cw of stream) {
    for (let b = 7; b >= 0; b--) streamBits.push((cw >> b) & 1);
  }

  let bitIdx = 0;
  let dirUp = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let step = 0; step < size; step++) {
      const r = dirUp ? size - 1 - step : step;
      for (const dc of [0, -1]) {
        const c = col + dc;
        if (!reserved[r][c]) {
          grid[r][c] = bitIdx < streamBits.length ? streamBits[bitIdx++] : 0;
        }
      }
    }
    dirUp = !dirUp;
  }

  // Mask 0 ((r + c) % 2 === 0) + Format Info ECC-L (01) Mask 0 (0x77c4)
  const maskBit = (r: number, c: number) => (r + c) % 2 === 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!reserved[r][c] && maskBit(r, c)) {
        grid[r][c] ^= 1;
      }
    }
  }

  // ISO/IEC 18004: bit 14 (MSB) -> bit 0 (LSB) em ambas as cópias do Format Info
  const fmt = 0x77c4; // Level L (01) + Mask 0 (000) BCH masked with 101010000010010
  for (let i = 0; i < 15; i++) {
    const dark = ((fmt >> (14 - i)) & 1) === 1;

    // Cópia 1 (canto superior esquerdo): horizontal (8,0..5), (8,7), (8,8) e vertical (7,8), (5..0,8)
    if (i < 6) grid[8][i] = dark ? 1 : 0;
    else if (i === 6) grid[8][7] = dark ? 1 : 0;
    else if (i === 7) grid[8][8] = dark ? 1 : 0;
    else if (i === 8) grid[7][8] = dark ? 1 : 0;
    else grid[14 - i][8] = dark ? 1 : 0;

    // Cópia 2: vertical inferior esquerdo (size-1..size-7, 8) e horizontal superior direito (8, size-8..size-1)
    if (i < 7) grid[size - 1 - i][8] = dark ? 1 : 0;
    else grid[8][size - 15 + i] = dark ? 1 : 0;
  }

  return { size, modules: grid.map((row) => row.map((v) => v === 1)) };
}

export function extrairDadoQr(valor: string): string {
  const s = (valor || "").trim();
  if (s.startsWith("https://api.qrserver.com/") || s.startsWith("http://api.qrserver.com/")) {
    try {
      const u = new URL(s);
      return u.searchParams.get("data") || s;
    } catch {
      return s;
    }
  }
  return s;
}

export function gerarQrDataUri(valor: string): string {
  const texto = extrairDadoQr(valor);
  if (!texto) return "";
  const qr = buildMatrix(texto);
  if (!qr) return "";
  const quiet = 4;
  const total = qr.size + quiet * 2;
  let path = "";
  for (let r = 0; r < qr.size; r++) {
    for (let c = 0; c < qr.size; c++) {
      if (qr.modules[r][c]) {
        path += `M${c + quiet},${r + quiet}h1v1h-1z`;
      }
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
