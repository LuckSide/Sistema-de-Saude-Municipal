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

export function keywordsMedico(m: Partial<Medico>, extras = ""): string {
  const esps = listaEspecialidadesMedico(m).join(" ");
  return `${m.nome || ""} ${m.crm || ""} ${m.cbo_codigo || ""} ${m.cbo_descricao || ""} ${esps} ${extras}`.trim();
}
