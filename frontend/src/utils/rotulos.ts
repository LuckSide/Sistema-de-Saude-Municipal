/** Rótulos de exibição da prioridade (valores: rotina=Eletivo, urgente=Urgente). */
export const PRIO_ROTULO: Record<string, string> = {
  rotina: "Eletivo",
  urgente: "Urgente",
};

export function rotuloPrioridade(v: string | null | undefined): string {
  if (!v) return "—";
  return PRIO_ROTULO[v] ?? v;
}
