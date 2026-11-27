import test from "node:test";
import assert from "node:assert/strict";
import { gerarQrDataUri } from "../src/utils/qrSvg.ts";

function decodificarGradeSvg(dataUri: string): { total: number; grid: number[][] } {
  assert.ok(dataUri.startsWith("data:image/svg+xml;charset=utf-8,"));
  const svg = decodeURIComponent(dataUri.split(",")[1]);
  const match = svg.match(/viewBox="0 0 (\d+) \d+"/);
  assert.ok(match, "viewBox ausente no SVG do QR Code");
  const total = Number(match[1]);
  const grid = Array.from({ length: total }, () => new Array<number>(total).fill(0));
  for (const m of svg.matchAll(/M(\d+),(\d+)h1v1h-1z/g)) {
    grid[Number(m[2])][Number(m[1])] = 1;
  }
  return { total, grid };
}

test("QR Code coloca Format Info ISO/IEC 18004 (0x77c4 MSB-first) e dark module corretos", () => {
  const url = "https://sigsm.duckdns.org/acompanhar/AbCdEfGhIjKlMnOpQrStUvWx01234567";
  const uri = gerarQrDataUri(url);
  const { total, grid } = decodificarGradeSvg(uri);
  const quiet = 4;
  const size = total - quiet * 2;
  assert.equal(size, 33); // Versão 4 para 71 bytes

  // Dark module obrigatório em (size - 8, 8)
  assert.equal(grid[quiet + size - 8][quiet + 8], 1);

  // Format Info 0x77c4 = 111011111000100 (MSB bit 14 -> LSB bit 0)
  const expected = [1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0];
  const copy1 = [
    grid[quiet + 8][quiet + 0],
    grid[quiet + 8][quiet + 1],
    grid[quiet + 8][quiet + 2],
    grid[quiet + 8][quiet + 3],
    grid[quiet + 8][quiet + 4],
    grid[quiet + 8][quiet + 5],
    grid[quiet + 8][quiet + 7],
    grid[quiet + 8][quiet + 8],
    grid[quiet + 7][quiet + 8],
    grid[quiet + 5][quiet + 8],
    grid[quiet + 4][quiet + 8],
    grid[quiet + 3][quiet + 8],
    grid[quiet + 2][quiet + 8],
    grid[quiet + 1][quiet + 8],
    grid[quiet + 0][quiet + 8],
  ];
  const copy2 = [
    grid[quiet + size - 1][quiet + 8],
    grid[quiet + size - 2][quiet + 8],
    grid[quiet + size - 3][quiet + 8],
    grid[quiet + size - 4][quiet + 8],
    grid[quiet + size - 5][quiet + 8],
    grid[quiet + size - 6][quiet + 8],
    grid[quiet + size - 7][quiet + 8],
    grid[quiet + 8][quiet + size - 8],
    grid[quiet + 8][quiet + size - 7],
    grid[quiet + 8][quiet + size - 6],
    grid[quiet + 8][quiet + size - 5],
    grid[quiet + 8][quiet + size - 4],
    grid[quiet + 8][quiet + size - 3],
    grid[quiet + 8][quiet + size - 2],
    grid[quiet + 8][quiet + size - 1],
  ];
  assert.deepEqual(copy1, expected);
  assert.deepEqual(copy2, expected);
});

test("QR Code suporta versões 1 até 10 incluindo URLs extensas", () => {
  for (const len of [10, 45, 90, 140, 210, 250]) {
    const dado = "https://sigsm.duckdns.org/acompanhar/" + "a".repeat(Math.max(1, len - 37));
    const uri = gerarQrDataUri(dado);
    const { total } = decodificarGradeSvg(uri);
    assert.ok(total >= 29 && total <= 65, `tamanho inesperado ${total} para ${dado.length} bytes`);
  }
});
