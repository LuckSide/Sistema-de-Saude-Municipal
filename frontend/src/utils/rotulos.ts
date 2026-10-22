/** Rótulos de exibição da prioridade (valores: rotina=Eletivo, urgente=Priorizado). */
export const PRIO_ROTULO: Record<string, string> = {
  rotina: "Eletivo",
  urgente: "Priorizado",
};

export function rotuloPrioridade(v: string | null | undefined): string {
  if (!v) return "—";
  return PRIO_ROTULO[v] ?? v;
}
