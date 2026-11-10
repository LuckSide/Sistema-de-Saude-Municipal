/** Validações estritas espelhadas do backend (`app/services/validacoes.py`).
 * Cada função retorna a mensagem de erro em pt-BR ou "" quando válido. */

export const UFS = new Set([
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG",
  "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR",
  "RS", "SC", "SE", "SP", "TO",
]);

const DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

export const soDigitos = (s: string | null | undefined): string =>
  (s ?? "").replace(/\D/g, "");

export function validaCpf(cpf: string | null | undefined, obrigatorio = true): string {
  const d = soDigitos(cpf);
  if (!d) return obrigatorio ? "CPF é obrigatório." : "";
  if (d.length !== 11) return "CPF deve ter 11 dígitos.";
  if (/^(\d)\1{10}$/.test(d)) return "CPF inválido. Insira um CPF real.";
  for (const i of [9, 10]) {
    const peso = i + 1;
    let soma = 0;
    for (let j = 0; j < i; j++) soma += parseInt(d[j], 10) * (peso - j);
    const resto = soma % 11;
    const dv = resto < 2 ? 0 : 11 - resto;
    if (parseInt(d[i], 10) !== dv) return "CPF inválido. Insira um CPF real.";
  }
  return "";
}

export function validaCnh(numero: string | null | undefined, obrigatorio = true): string {
  const d = soDigitos(numero);
  if (!d) return obrigatorio ? "CNH é obrigatória." : "";
  if (d.length !== 11) return "CNH deve ter 11 dígitos.";
  if (/^(\d)\1{10}$/.test(d)) return "CNH com dígito verificador inválido.";
  const dig = d.split("").map(Number);
  let soma1 = 0;
  for (let i = 0; i < 9; i++) soma1 += dig[i] * (9 - i);
  const resto1 = soma1 % 11;
  const dv1 = resto1 >= 10 ? 0 : resto1;
  let soma2 = resto1 >= 10 ? 2 : 0;
  for (let i = 0; i < 9; i++) soma2 += dig[i] * (i + 1);
  const resto2 = soma2 % 11;
  const dv2 = resto2 >= 10 ? 0 : resto2;
  if (dv1 !== dig[9] || dv2 !== dig[10]) return "CNH com dígito verificador inválido.";
  return "";
}

export function validaCnhValidade(valor: string | null | undefined, obrigatorio = true): string {
  const v = (valor ?? "").trim();
  if (!v) return obrigatorio ? "Validade da CNH é obrigatória." : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return "Validade da CNH em formato inválido (use AAAA-MM-DD).";
  const hoje = new Date().toISOString().slice(0, 10);
  if (v < hoje) return "CNH vencida. Informe uma validade futura.";
  return "";
}

export function validaCrm(crm: string | null | undefined): string {
  const txt = (crm ?? "").trim().toUpperCase();
  if (!txt) return "CRM é obrigatório (ex: CRM/MG 123456).";
  const semPrefixo = txt.replace(/^CRM\s*/, "").trim().replace(/^[/.\- ]+/, "").trim();
  const m1 = semPrefixo.match(/^(\d{4,7})\s*[/.\-\s]*\s*([A-Z]{2})$/);
  const m2 = semPrefixo.match(/^([A-Z]{2})\s*[/.\-\s]*\s*(\d{4,7})$/);
  const m = m1 ? { numero: m1[1], uf: m1[2] } : m2 ? { numero: m2[2], uf: m2[1] } : null;
  if (!m) {
    if (/^\d{4,7}$/.test(semPrefixo)) return "UF do CRM é obrigatória (ex: CRM/MG 123456).";
    return "CRM inválido. Use o formato CRM/UF número (ex: CRM/MG 123456).";
  }
  if (!UFS.has(m.uf)) return `UF '${m.uf}' inválida para o CRM.`;
  return "";
}

/** Normaliza p/ "CRM/UF NNNNNN" (igual ao backend). */
export function normalizaCrm(crm: string): string {
  const txt = crm.trim().toUpperCase();
  const semPrefixo = txt.replace(/^CRM\s*/, "").trim().replace(/^[/.\- ]+/, "").trim();
  const m1 = semPrefixo.match(/^(\d{4,7})\s*[/.\-\s]*\s*([A-Z]{2})$/);
  const m2 = semPrefixo.match(/^([A-Z]{2})\s*[/.\-\s]*\s*(\d{4,7})$/);
  if (m1) return `CRM/${m1[2]} ${m1[1]}`;
  if (m2) return `CRM/${m2[1]} ${m2[2]}`;
  return crm.trim();
}

export function validaCnes(cnes: string | null | undefined): string {
  const d = soDigitos(cnes);
  if (!d) return "CNES é obrigatório (7 dígitos).";
  if (d.length !== 7) return "CNES deve ter 7 dígitos numéricos.";
  return "";
}

export function validaEmail(email: string | null | undefined): string {
  const txt = (email ?? "").trim();
  if (!txt) return "";
  if (txt.includes("..") || !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(txt)) {
    return "E-mail inválido. Use o formato usuario@dominio.ext.";
  }
  return "";
}

export function validaTelefone(tel: string | null | undefined, obrigatorio = false): string {
  const d = soDigitos(tel);
  if (!d) return obrigatorio ? "Telefone é obrigatório." : "";
  if (/^(\d)\1+$/.test(d)) return "Telefone inválido.";
  if (d.length === 10) {
    const ddd = parseInt(d.slice(0, 2), 10);
    if (!DDDS.has(ddd)) return "DDD inválido no telefone.";
    if (!"2345".includes(d[2])) return "Telefone fixo deve ter 10 dígitos (DDD + número iniciado em 2–5).";
    return "";
  }
  if (d.length === 11) {
    const ddd = parseInt(d.slice(0, 2), 10);
    if (!DDDS.has(ddd)) return "DDD inválido no celular.";
    if (d[2] !== "9") return "Celular deve ter 11 dígitos (DDD + 9 + número).";
    return "";
  }
  return "Telefone deve ter 10 dígitos (fixo) ou 11 dígitos (celular com DDD).";
}

/** Extrai mensagens de campo de um 422 do backend ({loc:['body',campo], msg}). */
export function erros422(e: unknown, campos: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const det = (e as { response?: { data?: { detail?: unknown } } }).response?.data?.detail;
    if (!Array.isArray(det)) return out;
    for (const item of det as { loc?: unknown[]; msg?: string }[]) {
      const loc = Array.isArray(item.loc) ? item.loc.map(String) : [];
      const campo = loc[loc.length - 1] ?? "";
      if (!campo || !(campo in campos)) continue;
      const msg = String(item.msg ?? "").replace(/^Value error,\s*/i, "");
      if (msg && !out[campo]) out[campo] = msg;
    }
  } catch {
    /* ignora */
  }
  return out;
}

/** Toast textual: "Não foi possível salvar: o campo 'X' ...". */
export function toastCampos(erros: Record<string, string>, rotulos: Record<string, string>): string {
  const nomes = Object.keys(erros);
  if (nomes.length === 0) return "";
  if (nomes.length === 1) {
    const c = nomes[0];
    return `Não foi possível salvar: o campo '${rotulos[c] ?? c}' — ${erros[c]}`;
  }
  return `Não foi possível salvar: os campos ${nomes.map((c) => `'${rotulos[c] ?? c}'`).join(", ")} contêm erros. Confira os destaques abaixo.`;
}
