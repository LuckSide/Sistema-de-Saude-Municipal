import api from "./api";

export type PecFonte = "postgres" | "files" | "mock" | "auto";

export type PecKpi = {
  codigo: string;
  nome: string;
  bloco: string;
  num: number;
  den: number;
  perc: number;
  meta: number;
  status: "atingido" | "alerta" | "risco_perda" | string;
};

export type PecPainel = {
  fonte: string;
  lgpd_ok: boolean;
  periodo: string;
  modelo?: string;
  resumo_repasse?: { atingidos: number; total: number; status_geral: string };
  periodos?: string[];
  equipes?: PecEquipe[];
  kpis: PecKpi[];
};

export type PecFichaInc = { ficha_uuid: string; motivo: string };
export type PecFichas = {
  fonte: string;
  lgpd_ok: boolean;
  inconsistentes: PecFichaInc[];
  funil: { etapa: string; total: number }[];
};

export type PecSerie = { periodo: string; indicador: string; num: number; den: number; perc: number };

export type PecGraficos = PecFichas & {
  serie: PecSerie[];
  evolucao?: Record<string, PecSerie[]>;
  periodos?: string[];
  equipes?: PecEquipe[];
};

export type PecEquipe = { codigo: string; tipo: string; ubs: string };

export type PecDimensoes = {
  fonte: string;
  lgpd_ok: boolean;
  periodos: string[];
  equipes: PecEquipe[];
  ubs: PecUbsItem[];
};

export type PecIndicadorDetalhe = {
  fonte: string;
  lgpd_ok: boolean;
  indicador: string;
  nome: string;
  bloco: string;
  meta: number;
  perc_atual: number;
  status: string;
  serie: PecSerie[];
  acoes: string[];
};

const MOCK_PAINEL: PecPainel = {
  fonte: "mock",
  lgpd_ok: true,
  periodo: "2026-T1",
  modelo: "novo-cofinanciamento-2024",
  resumo_repasse: { atingidos: 8, total: 15, status_geral: "alerta" },
  kpis: [
    { codigo: "ACESSO", nome: "Mais acesso na APS", bloco: "cuidado", num: 620, den: 900, perc: 68.9, meta: 60, status: "atingido" },
    { codigo: "INFANTIL", nome: "Desenvolvimento infantil", bloco: "cuidado", num: 95, den: 140, perc: 67.9, meta: 60, status: "atingido" },
    { codigo: "GESTANTE", nome: "Gestante e puerpério (11 ações)", bloco: "cuidado", num: 30, den: 48, perc: 62.5, meta: 60, status: "atingido" },
    { codigo: "DIABETES", nome: "Cuidado diabetes", bloco: "cuidado", num: 150, den: 300, perc: 50, meta: 60, status: "alerta" },
    { codigo: "HIPERTENSAO", nome: "Cuidado hipertensão", bloco: "cuidado", num: 210, den: 400, perc: 52.5, meta: 60, status: "alerta" },
    { codigo: "IDOSO", nome: "Cuidado pessoa idosa", bloco: "cuidado", num: 180, den: 320, perc: 56.3, meta: 60, status: "alerta" },
    { codigo: "CANCER", nome: "Rastreio câncer colo/mama", bloco: "cuidado", num: 240, den: 500, perc: 48, meta: 60, status: "risco_perda" },
    { codigo: "SB_PRIM_CONS", nome: "1ª consulta odonto programada", bloco: "bucal", num: 300, den: 800, perc: 37.5, meta: 40, status: "alerta" },
    { codigo: "SB_TRAT_CONCL", nome: "Tratamento odonto concluído", bloco: "bucal", num: 180, den: 400, perc: 45, meta: 40, status: "atingido" },
    { codigo: "SB_EXODONTIA", nome: "Taxa exodontias", bloco: "bucal", num: 60, den: 400, perc: 15, meta: 10, status: "alerta" },
    { codigo: "SB_ESCOVACAO", nome: "Escovação supervisionada", bloco: "bucal", num: 500, den: 1200, perc: 41.7, meta: 40, status: "atingido" },
    { codigo: "SB_PREVENTIVO", nome: "Procedimentos preventivos", bloco: "bucal", num: 350, den: 800, perc: 43.8, meta: 40, status: "atingido" },
    { codigo: "SB_ART", nome: "Tratamento restaurador atraumático", bloco: "bucal", num: 60, den: 400, perc: 15, meta: 20, status: "alerta" },
    { codigo: "EMULTI_MEDIA", nome: "Média atendimentos eMulti", bloco: "emulti", num: 420, den: 700, perc: 60, meta: 60, status: "atingido" },
    { codigo: "EMULTI_INTERPROF", nome: "Ações interprofissionais eMulti", bloco: "emulti", num: 90, den: 160, perc: 56.3, meta: 60, status: "alerta" },
  ],
};

const MOCK_FICHAS: PecFichas = {
  fonte: "mock",
  lgpd_ok: true,
  inconsistentes: [
    { ficha_uuid: "9f1a2b3c-mock-0001", motivo: "CNS dígito inválido" },
    { ficha_uuid: "9f1a2b3c-mock-0002", motivo: "Cadastro duplicado" },
  ],
  funil: [
    { etapa: "captados", total: 1200 },
    { etapa: "validos", total: 1050 },
    { etapa: "ativos", total: 980 },
  ],
};

const MOCK_GRAFICOS: PecGraficos = {
  ...MOCK_FICHAS,
  serie: [
    { periodo: "2025-T3", indicador: "DIABETES", num: 130, den: 290, perc: 44.8 },
    { periodo: "2025-T4", indicador: "DIABETES", num: 140, den: 295, perc: 47.5 },
    { periodo: "2026-T1", indicador: "DIABETES", num: 150, den: 300, perc: 50 },
    { periodo: "2025-T3", indicador: "GESTANTE", num: 25, den: 46, perc: 54.3 },
    { periodo: "2025-T4", indicador: "GESTANTE", num: 28, den: 47, perc: 59.6 },
    { periodo: "2026-T1", indicador: "GESTANTE", num: 30, den: 48, perc: 62.5 },
  ],
};

async function getComFallback<T>(url: string, params: object, mock: T): Promise<{ dados: T; viaApi: boolean }> {
  try {
    const { data } = await api.get(url, { params });
    return { dados: data as T, viaApi: true };
  } catch (e: any) {
    if (e?.response?.status === 401) throw e; // interceptor já redireciona p/ login
    return { dados: mock, viaApi: false };
  }
}

export const pecPainel = (periodo = "", ubs = "", equipe = "") =>
  getComFallback<PecPainel>("/api/painel", { periodo, ubs, equipe }, MOCK_PAINEL);

export const pecFichas = () => getComFallback<PecFichas>("/api/fichas", {}, MOCK_FICHAS);

export const pecGraficos = () => getComFallback<PecGraficos>("/api/graficos", {}, MOCK_GRAFICOS);

export const pecDimensoes = () =>
  getComFallback<PecDimensoes>("/api/dimensoes", {}, {
    fonte: "mock",
    lgpd_ok: true,
    periodos: ["2025-T2", "2025-T3", "2025-T4", "2026-T1"],
    equipes: [
      { codigo: "eSF-01", tipo: "eSF", ubs: "UBS-CENTRO" },
      { codigo: "eSF-02", tipo: "eSF", ubs: "UBS-CENTRO" },
      { codigo: "eSF-03", tipo: "eSF", ubs: "UBS-RURAL" },
      { codigo: "eSB-01", tipo: "eSB", ubs: "UBS-CENTRO" },
      { codigo: "eSB-02", tipo: "eSB", ubs: "UBS-RURAL" },
    ],
    ubs: [
      { codigo: "UBS-CENTRO", cnes: "2211221", cadastros_validos: 980, equipe_tipo: "eSF" },
      { codigo: "UBS-RURAL", cnes: "2211332", cadastros_validos: 640, equipe_tipo: "eSF" },
    ],
  });

export const pecIndicador = (codigo: string, ubs = "", equipe = "") =>
  getComFallback<PecIndicadorDetalhe>(`/api/indicador/${codigo}`, { ubs, equipe }, {
    fonte: "mock",
    lgpd_ok: true,
    indicador: codigo,
    nome: codigo,
    bloco: "cuidado",
    meta: 60,
    perc_atual: 0,
    status: "alerta",
    serie: MOCK_GRAFICOS.serie.filter((s) => s.indicador === codigo),
    acoes: ["Atualizar cadastros via ACS", "Agendar faltosos com prioridade", "Registrar tudo no PEC no mesmo dia"],
  });

export const pecUbs = () =>
  getComFallback("/api/ubs", {}, {
    fonte: "mock",
    lgpd_ok: true,
    ubs: [
      { codigo: "UBS-CENTRO", cnes: "2211221", cadastros_validos: 980, equipe_tipo: "eSF" },
      { codigo: "UBS-RURAL", cnes: "2211332", cadastros_validos: 640, equipe_tipo: "eSF" },
    ],
  });

export type PecUbsItem = { codigo: string; cnes?: string; cadastros_validos: number; equipe_tipo?: string };

export const pecRelatorio = (periodo = "", ubs = "", equipe = "") =>
  getComFallback("/api/relatorio", { periodo, ubs, equipe }, {
    fonte: "mock",
    lgpd_ok: true,
    periodo,
    csv: "codigo;num;den;perc;meta",
  });

export function fonteBadge(fonte: string, viaApi: boolean): string {
  if (!viaApi || fonte === "mock") return "Modo Mock";
  if (fonte === "postgres") return "Dados via API Postgres · LGPD ok";
  if (fonte === "files") return "Dados via API Arquivos · LGPD ok";
  return "Dados via API · LGPD ok";
}
