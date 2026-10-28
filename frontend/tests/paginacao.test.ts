import test from "node:test";
import assert from "node:assert";
import { calcularOpcoesPageSize, OPCOES_PADRAO } from "../src/utils/paginacaoUtils.ts";

test("seletor não aparece quando número de resultados for menor ou igual à menor opção (ex: < 10)", () => {
  assert.deepStrictEqual(calcularOpcoesPageSize(OPCOES_PADRAO, 0), []);
  assert.deepStrictEqual(calcularOpcoesPageSize(OPCOES_PADRAO, 5), []);
  assert.deepStrictEqual(calcularOpcoesPageSize(OPCOES_PADRAO, 9), []);
  assert.deepStrictEqual(calcularOpcoesPageSize(OPCOES_PADRAO, 10), []);
});

test("seletor para 26 registros mostra apenas opções menores e Todos (10, 25, Todos), sem 50, 100 ou 250", () => {
  const opcoes = calcularOpcoesPageSize(OPCOES_PADRAO, 26);
  assert.deepStrictEqual(opcoes, [10, 25, "Todos"]);
  assert.strictEqual(opcoes.includes(50), false);
  assert.strictEqual(opcoes.includes(100), false);
  assert.strictEqual(opcoes.includes(250), false);
});

test("seletor para 75 registros mostra apenas [10, 25, 50, Todos], omitindo 100 e 250", () => {
  const opcoes = calcularOpcoesPageSize(OPCOES_PADRAO, 75);
  assert.deepStrictEqual(opcoes, [10, 25, 50, "Todos"]);
  assert.strictEqual(opcoes.includes(100), false);
  assert.strictEqual(opcoes.includes(250), false);
});

test("seletor para 150 registros mostra [10, 25, 50, 100, Todos], omitindo 250", () => {
  const opcoes = calcularOpcoesPageSize(OPCOES_PADRAO, 150);
  assert.deepStrictEqual(opcoes, [10, 25, 50, 100, "Todos"]);
  assert.strictEqual(opcoes.includes(250), false);
});

test("seletor para 300 registros mostra todas as opções disponíveis", () => {
  const opcoes = calcularOpcoesPageSize(OPCOES_PADRAO, 300);
  assert.deepStrictEqual(opcoes, [10, 25, 50, 100, 250, "Todos"]);
});
