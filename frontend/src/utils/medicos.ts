import type { Medico } from "../services/api";

export const NOME_MEDICO_UNIDADE = "Médico da Unidade / Responsável Técnico";

export function isMedicoGenericoNome(nome?: string | null): boolean {
  const n = (nome || "").toLowerCase();
  return (
    n.includes("médico da unidade") ||
    n.includes("medico da unidade") ||
    n.includes("responsável técnico") ||
    n.includes("responsavel tecnico")
  );
}

export function listaEspecialidadesMedico(m: Partial<Medico>): string[] {
  const brutas = [m.especialidade || "", ...(m.especialidades || "").split(/[,;|]/)];
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const item of brutas) {
    const limpo = item.trim();
    if (!limpo) continue;
    const chave = limpo.toUpperCase();
    if (!vistos.has(chave)) {
      vistos.add(chave);
      out.push(limpo);
    }
  }
  return out;
}

export function formatarSubMedico(m: Partial<Medico>, extras: string[] = []): string {
  const partes: string[] = [];
  if (m.crm) partes.push(`CRM: ${m.crm}`);
  if (m.cbo_codigo) {
    partes.push(`CBO: ${m.cbo_codigo}${m.cbo_descricao ? ` (${m.cbo_descricao})` : ""}`);
  } else if (m.cbo_descricao) {
    partes.push(`CBO: ${m.cbo_descricao}`);
  }
  const esps = listaEspecialidadesMedico(m);
  if (esps.length > 0) {
    partes.push(`Esp.: ${esps.join(", ")}`);
  }
  for (const ex of extras) {
    if (ex && ex.trim()) partes.push(ex.trim());
  }
  return partes.join(" · ");
}

export function normalizarCodigoCbo(cbo?: string | null): string {
  return String(cbo || "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(0, 6);
}

export function normalizarTextoCbo(texto?: string | null): string {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .toLowerCase()
    .trim();
}

function semPrefixoProfissao(norm: string): string {
  return norm
    .replace(/^(medico|medica|cirurgiao|cirurgia|enfermeiro|enfermeira|fisioterapeuta|fonoaudiologo|farmaceutico|psicologo)\s+(em|da|de|do)?\s*/g, "")
    .trim();
}

export function medicoAtendeCbo(
  m: Partial<Medico>,
  cboAlvo?: string | null,
  nomeCboAlvo?: string | null,
): boolean {
  const alvo = normalizarCodigoCbo(cboAlvo);
  const cboMed = normalizarCodigoCbo(m.cbo_codigo);
  if (alvo && cboMed && cboMed === alvo) {
    return true;
  }
  const alvoTexto = normalizarTextoCbo(nomeCboAlvo);
  if (!alvoTexto || /^cbo\s+[a-z0-9]+$/i.test(alvoTexto)) {
    return false;
  }
  const alvoBase = semPrefixoProfissao(alvoTexto);
  const candidatos = [
    ...listaEspecialidadesMedico(m),
    m.cbo_descricao || "",
  ];
  for (const cand of candidatos) {
    const cNorm = normalizarTextoCbo(cand);
    if (!cNorm) continue;
    if (cNorm === alvoTexto) return true;
    const cBase = semPrefixoProfissao(cNorm);
    if (alvoBase.length >= 4 && cBase.length >= 4 && (cBase === alvoBase || cBase.includes(alvoBase) || alvoBase.includes(cBase))) {
      return true;
    }
  }
  return false;
}

export function medicosPorCbo(
  medicos: Medico[],
  cboAlvo?: string | null,
  nomeCboAlvo?: string | null,
  somenteAtivos = true,
): Medico[] {
  return medicos.filter(
    (m) =>
      (!somenteAtivos || m.ativo) &&
      !isMedicoGenericoNome(m.nome) &&
      medicoAtendeCbo(m, cboAlvo, nomeCboAlvo),
  );
}

export function keywordsMedico(m: Partial<Medico>, extras = ""): string {
  const esps = listaEspecialidadesMedico(m).join(" ");
  return `${m.nome || ""} ${m.crm || ""} ${m.cbo_codigo || ""} ${m.cbo_descricao || ""} ${esps} ${extras}`.trim();
}
