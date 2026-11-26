import test from "node:test";
import assert from "node:assert";
import { EXCLUSIVAS, MODULOS, concedida, todosCodigos } from "../src/permissoes.ts";

test("tela /tfd (tfd_resumo) removida da árvore de permissões e novas telas presentes", () => {
  const codigos = todosCodigos();
  assert.ok(!codigos.includes("tfd_resumo"), "tfd_resumo não deve constar na árvore de permissões");

  for (const esperada of ["lab_auditoria_laudos", "cfg_importar", "admin_tickets", "lab_vagas", "lab_portal", "lab_orcamento"]) {
    assert.ok(codigos.includes(esperada), `Código ${esperada} deve existir na árvore de permissões`);
  }

  const tfdMod = MODULOS.find((m) => m.codigo === "tfd");
  assert.ok(tfdMod);
  assert.notStrictEqual(tfdMod.rota, "/tfd");
});

test("usuário novo com permissões pontuais não recebe telas exclusivas nem não liberadas", () => {
  assert.ok(EXCLUSIVAS.has("auditoria"));
  assert.ok(EXCLUSIVAS.has("cfg_backup"));
  assert.ok(EXCLUSIVAS.has("cfg_geral"));
  assert.ok(EXCLUSIVAS.has("admin_tickets"));

  assert.strictEqual(concedida(["dashboard"], "dash_indicadores"), false);
  assert.strictEqual(concedida(["dashboard", "usuarios"], "auditoria"), false);
  assert.strictEqual(concedida(["dashboard", "usuarios"], "admin_tickets"), false);
  assert.strictEqual(concedida(["dashboard", "integracoes"], "cfg_geral"), false);
  assert.strictEqual(concedida(["dashboard", "integracoes"], "cfg_backup"), false);
  assert.strictEqual(concedida(["dashboard", "tfd_fila_lancamento"], "tfd_exames"), false);
});
