import test from "node:test";
import assert from "node:assert";
import { EXCLUSIVAS, MODULOS, concedida, todosCodigos } from "../src/permissoes.ts";

test("tela /tfd (tfd_resumo) removida da árvore de permissões e telas consolidadas presentes", () => {
  const codigos = todosCodigos();
  assert.ok(!codigos.includes("tfd_resumo"), "tfd_resumo não deve constar na árvore de permissões");
  assert.ok(!codigos.includes("lab_vagas"), "lab_vagas foi consolidada em lab_agenda");
  assert.ok(!codigos.includes("lab_auditoria_laudos"), "lab_auditoria_laudos foi consolidada em lab_audit");

  for (const esperada of ["cfg_importar", "admin_tickets", "lab_agenda", "lab_audit", "lab_portal", "lab_orcamento", "lab_sigtap"]) {
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
