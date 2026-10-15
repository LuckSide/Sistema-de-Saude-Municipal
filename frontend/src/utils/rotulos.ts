/** Rótulos de exibição da prioridade (valor gravado: rotina|prioritaria|urgente). */
export const PRIO_ROTULO: Record<string, string> = {
  rotina: "Eletivo",
  prioritaria: "Prioritário",
  urgente: "Urgente",
};

export function rotuloPrioridade(v: string | null | undefined): string {
  if (!v) return "—";
  return PRIO_ROTULO[v] ?? v;
}
