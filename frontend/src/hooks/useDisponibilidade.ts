import { useEffect, useState } from "react";
import { tfdDisponibilidade, type Disponibilidade } from "../services/api";

/** Duração padrão da viagem p/ retorno automático (9h). */
export const DURACAO_PADRAO_H = 9;

export function somarHoras(hhmm: string, horas: number): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm || "").trim());
  if (!m) return "";
  const total = (parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + horas * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function retornoAutomatico(saida: string): string {
  return somarHoras(saida, DURACAO_PADRAO_H);
}

/** Consulta veículos/motoristas livres na janela (debounce 400ms). */
export function useDisponibilidade(
  data: string,
  saida: string,
  retorno: string,
  ignorarId?: number | null,
  ativo = true,
): { disp: Disponibilidade | null; carregando: boolean } {
  const [disp, setDisp] = useState<Disponibilidade | null>(null);
  const [carregando, setCarregando] = useState(false);
  useEffect(() => {
    if (!ativo || !/^\d{4}-\d{2}-\d{2}$/.test(data || "")) {
      setDisp(null);
      return;
    }
    setCarregando(true);
    const t = setTimeout(() => {
      tfdDisponibilidade(data, saida || "", retorno || "", ignorarId || undefined)
        .then(setDisp)
        .catch(() => setDisp(null))
        .finally(() => setCarregando(false));
    }, 400);
    return () => clearTimeout(t);
  }, [data, saida, retorno, ignorarId, ativo]);
  return { disp, carregando };
}
