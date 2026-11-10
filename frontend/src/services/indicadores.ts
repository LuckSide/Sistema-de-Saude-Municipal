import api from "./api";

export type PontoEvolucao = {
  periodo: string;
  label: string;
  inicio: string;
  fim: string;
  total: number;
  realizados: number;
  agendados: number;
  urgentes: number;
};

export type EvolucaoResp = {
  granularidade: string;
  de: string;
  ate: string;
  tipo_fila: string;
  pontos: PontoEvolucao[];
};

export type VolumeItem = {
  tipo: string;
  total: number;
  urgentes: number;
  agendados: number;
  aguardando: number;
  perc: number;
};

export type VolumeResp = {
  de: string;
  ate: string;
  status: string[];
  total: number;
  itens: VolumeItem[];
};

export type AgendaItem = {
  origem: string;
  id: number;
  titulo: string;
  status: string;
  local: string;
};

export type AgendaDia = {
  data: string;
  confirmados: number;
  realizados: number;
  cancelados: number;
  total: number;
  itens: AgendaItem[];
};

export type AgendaResp = {
  de: string;
  ate: string;
  laboratorios: { id: number; nome: string }[];
  dias: AgendaDia[];
  tot_confirmados: number;
  tot_realizados: number;
  tot_cancelados: number;
};

export type ResumoInd = {
  de: string;
  ate: string;
  em_fila: number;
  urgentes: number;
  novos_periodo: number;
  agendados: number;
  realizados_periodo: number;
  agenda_confirmados: number;
  agenda_realizados: number;
  tempo_medio_espera_dias: number;
};

const MOCK_RESUMO: ResumoInd = {
  de: "", ate: "", em_fila: 0, urgentes: 0, novos_periodo: 0,
  agendados: 0, realizados_periodo: 0, agenda_confirmados: 0,
  agenda_realizados: 0, tempo_medio_espera_dias: 0,
};

async function getFallback<T>(url: string, params: object, mock: T): Promise<{ dados: T; viaApi: boolean }> {
  try {
    const { data } = await api.get(url, { params });
    return { dados: data as T, viaApi: true };
  } catch (e: any) {
    if (e?.response?.status === 401) throw e;
    return { dados: mock, viaApi: false };
  }
}

export const indResumo = (de = "", ate = "") =>
  getFallback<ResumoInd>("/api/indicadores/resumo", { de: de || undefined, ate: ate || undefined }, MOCK_RESUMO);

export const indEvolucao = (de = "", ate = "", granularidade = "mes", tipo_fila = "") =>
  getFallback<EvolucaoResp>(
    "/api/indicadores/filas-evolucao",
    { de: de || undefined, ate: ate || undefined, granularidade, tipo_fila: tipo_fila || undefined },
    { granularidade, de, ate, tipo_fila, pontos: [] }
  );

export const indVolume = (de = "", ate = "", status = "aguardando,agendado") =>
  getFallback<VolumeResp>(
    "/api/indicadores/filas-volume",
    { de: de || undefined, ate: ate || undefined, status },
    { de, ate, status: status.split(","), total: 0, itens: [] }
  );

export type ProcTopItem = {
  procedimento: string;
  codigo: string;
  total_fila: number;
  aguardando: number;
  agendados: number;
  urgentes: number;
  novos_periodo: number;
  realizados_periodo: number;
  variacao_pct: number;
  tendencia: "alta" | "queda" | "estavel";
};

export type ProcTopResp = { de: string; ate: string; total: number; itens: ProcTopItem[] };

export type ProcEvolResp = {
  granularidade: string;
  de: string;
  ate: string;
  series: string[];
  pontos: Record<string, string | number>[];
};

export const indProcTop = (de = "", ate = "", limit = 8) =>
  getFallback<ProcTopResp>(
    "/api/indicadores/procedimentos-top",
    { de: de || undefined, ate: ate || undefined, limit },
    { de, ate, total: 0, itens: [] }
  );

export const indProcEvolucao = (de = "", ate = "", granularidade = "mes", procedimentos = "", top = 4) =>
  getFallback<ProcEvolResp>(
    "/api/indicadores/procedimentos-evolucao",
    { de: de || undefined, ate: ate || undefined, granularidade, procedimentos: procedimentos || undefined, top },
    { granularidade, de, ate, series: [], pontos: [] }
  );
export const indAgenda = (de = "", ate = "", laboratorio_id?: number) =>
  getFallback<AgendaResp>(
    "/api/indicadores/agenda",
    { de: de || undefined, ate: ate || undefined, laboratorio_id },
    { de, ate, laboratorios: [], dias: [], tot_confirmados: 0, tot_realizados: 0, tot_cancelados: 0 }
  );
