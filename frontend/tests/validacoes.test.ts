import test from "node:test";
import assert from "node:assert";
import {
  validaCpf,
  validaCnh,
  validaCnhValidade,
  validaTelefone,
  validaCrm,
  normalizaCrm,
  validaCnes,
  validaEmail,
  soDigitos,
  validarForcaSenha,
  avaliarRequisitosSenha,
} from "../src/utils/validacoes.ts";

test("soDigitos limpa pontuações", () => {
  assert.strictEqual(soDigitos("123.456.789-00"), "12345678900");
  assert.strictEqual(soDigitos("(35) 99999-8888"), "35999998888");
  assert.strictEqual(soDigitos(null), "");
});

test("validaCpf detecta CPFs inválidos e vazios", () => {
  assert.strictEqual(validaCpf(""), "CPF é obrigatório.");
  assert.strictEqual(validaCpf("11111111111"), "CPF inválido. Insira um CPF real.");
  assert.strictEqual(validaCpf("12345"), "CPF deve ter 11 dígitos.");
  assert.strictEqual(validaCpf("", false), "");
});

test("validaCnh detecta CNHs com dígitos repetidos e tamanho incorreto", () => {
  assert.strictEqual(validaCnh(""), "CNH é obrigatória.");
  assert.strictEqual(validaCnh("1234"), "CNH deve ter 11 dígitos.");
  assert.strictEqual(validaCnh("11111111111"), "CNH com dígito verificador inválido.");
  assert.strictEqual(validaCnh("", false), "");
});

test("validaCnhValidade valida formato e datas passadas", () => {
  assert.strictEqual(validaCnhValidade(""), "Validade da CNH é obrigatória.");
  assert.strictEqual(validaCnhValidade("10/10/2026"), "Validade da CNH em formato inválido (use AAAA-MM-DD).");
  assert.strictEqual(validaCnhValidade("2020-01-01"), "CNH vencida. Informe uma validade futura.");
  assert.strictEqual(validaCnhValidade("2030-12-31"), "");
});

test("validaTelefone valida DDD e formato brasileiro", () => {
  assert.strictEqual(validaTelefone("", true), "Telefone é obrigatório.");
  assert.strictEqual(validaTelefone(""), "");
  assert.strictEqual(validaTelefone("123"), "Telefone deve ter 10 dígitos (fixo) ou 11 dígitos (celular com DDD).");
  assert.strictEqual(validaTelefone("00999998888"), "DDD inválido no celular.");
  assert.strictEqual(validaTelefone("35999998888"), "");
});

test("validaCrm e normalizaCrm tratam padrões e UFs", () => {
  assert.strictEqual(validaCrm(""), "CRM é obrigatório (ex: CRM/MG 123456).");
  assert.strictEqual(validaCrm("123456"), "UF do CRM é obrigatória (ex: CRM/MG 123456).");
  assert.strictEqual(validaCrm("123456/XX"), "UF 'XX' inválida para o CRM.");
  assert.strictEqual(validaCrm("123456/MG"), "");
  assert.strictEqual(normalizaCrm("123456/MG"), "CRM/MG 123456");
  assert.strictEqual(normalizaCrm("CRM/SP 654321"), "CRM/SP 654321");
});

test("validaCnes exige 7 dígitos numéricos", () => {
  assert.strictEqual(validaCnes(""), "CNES é obrigatório (7 dígitos).");
  assert.strictEqual(validaCnes("123"), "CNES deve ter 7 dígitos numéricos.");
  assert.strictEqual(validaCnes("1234567"), "");
});

test("validaEmail permite vazio e valida formato", () => {
  assert.strictEqual(validaEmail(""), "");
  assert.strictEqual(validaEmail("invalido"), "E-mail inválido. Use o formato usuario@dominio.ext.");
  assert.strictEqual(validaEmail("duplo..ponto@dominio.com"), "E-mail inválido. Use o formato usuario@dominio.ext.");
  assert.strictEqual(validaEmail("contato@guape.mg.gov.br"), "");
});

test("validarForcaSenha rejeita senhas fracas, comuns, numéricas, sequenciais e iguais ao usuário", () => {
  for (const fraca of [
    "",
    "   ",
    "Ab1@xy",
    "123456",
    "12345678",
    "00000000",
    "11111111",
    "aaaaaaaa",
    "20252026",
    "98765432",
    "senha123",
    "Senha 123",
    "PASSWORD123",
    "admin123",
    "guape123",
    "mudar123",
    "trocar123",
    "qwerty123",
    "abc12345",
    "1q2w3e4r",
    "saude123",
    "senhaforte",
    "Abcd@2026",
    "Dcba@2026",
    "Senha1234!",
    "Teste4321@",
    "Qwer@2026",
  ]) {
    const msg = validarForcaSenha(fraca, "operador.tfd");
    assert.ok(typeof msg === "string" && msg.length > 0, `Deveria rejeitar: ${fraca}`);
  }

  assert.ok(validarForcaSenha("maria.silva", "maria.silva"));
  assert.ok(validarForcaSenha("Maria.Silva@2026", "maria.silva"));
  assert.ok(validarForcaSenha("operador99", "operador"));
});

test("validarForcaSenha e avaliarRequisitosSenha aceitam senhas fortes", () => {
  for (const forte of ["Guape#2026", "Clinica!94", "NovaSenha123@", "Saude@k7m2p"]) {
    assert.strictEqual(validarForcaSenha(forte, "operador.tfd"), null);
    const reqs = avaliarRequisitosSenha(forte, "operador.tfd");
    assert.deepStrictEqual(reqs, {
      minimoCaracteres: true,
      letraENumeroOuEspecial: true,
      semCaractereRepetidoOuNumerica: true,
      semSequenciaOuComum: true,
      diferenteDoUsuario: true,
    });
  }
});
