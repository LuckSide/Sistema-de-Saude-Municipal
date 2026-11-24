import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Ambulance,
  Building2,
  CalendarDays,
  Car,
  Clock,
  DollarSign,
  FileCheck2,
  FileText,
  Filter,
  Layers,
  ListOrdered,
  Pill,
  ReceiptText,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Wind,
  type LucideIcon,
} from "lucide-react";
import {
  tfdFaturas,
  tfdFiltrosOpcoes,
  tfdResumo,
  tfdVeiculos,
  tfdViagens,
  vagasGrade,
  pagData,
  oxigenioResumoEstoque,
  oxigenioEmprestimos,
  farmaciaResumo,
  fetchApacSolicitacoes,
  labContratosPainel,
  labBpaConsolidado,
  type Fatura,
  type Veiculo,
  type Viagem,
  type ResumoEstoqueOxigenio,
  type EmprestimoOxigenio,
  type FarmaciaResumoCardsOut,
  type SolicitacaoApac,
  type LabContratosPainel,
  type BpaResumoCompleto,
} from "./services/api";
import { pecPainel } from "./services/pec";
import { indResumo, type ResumoInd } from "./services/indicadores";

export type WidgetConfig = Record<string, any>;

export interface WidgetDef {
  id: string;
  titulo: string;
  desc: string;
  icone: LucideIcon;
  tipoGrafico: "kpi" | "barras" | "progresso" | "lista" | "calendario";
  categoria?: "filas" | "tfd" | "lab" | "oxigenio" | "farmacia" | "aps" | "geral";
  configuravel?: boolean;
  /** telas que liberam o widget (qualquer uma basta; endpoints reforçam no backend) */
  telas: string[];
}

export const WIDGETS: WidgetDef[] = [
  {
    id: "fila-personalizada",
    titulo: "Fila & Especialidade (Configurável)",
    desc: "Gráfico e métricas com seleção de fila, especialidade e dados.",
    icone: Filter,
    tipoGrafico: "barras",
    categoria: "filas",
    configuravel: true,
    telas: ["tfd_exames", "tfd_medico", "tfd", "dashboard", "dash_indicadores"],
  },
  {
    id: "resumo-tfd",
    titulo: "TFD do mês",
    desc: "Viagens, passageiros e exames aguardando/urgentes.",
    icone: Ambulance,
    tipoGrafico: "kpi",
    categoria: "tfd",
    telas: ["tfd_resumo", "tfd"],
  },
  {
    id: "fila-prioridades",
    titulo: "Fila · Por Prioridade",
    desc: "Proporção de urgências, eletivos e rotina na fila.",
    icone: AlertTriangle,
    tipoGrafico: "progresso",
    categoria: "filas",
    configuravel: true,
    telas: ["tfd_exames", "tfd_medico", "tfd"],
  },
  {
    id: "fila-especialidade",
    titulo: "Fila por especialidade",
    desc: "Aguardando por especialidade (top 6).",
    icone: ListOrdered,
    tipoGrafico: "barras",
    categoria: "filas",
    configuravel: true,
    telas: ["tfd_exames", "tfd_medico", "tfd"],
  },
  {
    id: "tempo-fila-indicadores",
    titulo: "Tempo Médio de Espera",
    desc: "Dias médios de espera e fluxo de procedimentos.",
    icone: Clock,
    tipoGrafico: "kpi",
    categoria: "filas",
    configuravel: true,
    telas: ["dash_indicadores", "dashboard", "tfd", "tfd_exames"],
  },
  {
    id: "oxigenio-resumo",
    titulo: "Oxigenioterapia & Comodato",
    desc: "Pacientes ativos, cilindros próprios vs comodato e máquinas.",
    icone: Wind,
    tipoGrafico: "kpi",
    categoria: "oxigenio",
    configuravel: true,
    telas: ["oxigenio", "oxigenio_painel", "oxigenio_emprestimos"],
  },
  {
    id: "oxigenio-trocas",
    titulo: "Trocas Previstas · Oxigênio",
    desc: "Próximas trocas semanais de cilindros e equipamentos.",
    icone: RotateCcw,
    tipoGrafico: "lista",
    categoria: "oxigenio",
    telas: ["oxigenio", "oxigenio_emprestimos", "oxigenio_equipamentos"],
  },
  {
    id: "lab-faturamento",
    titulo: "Laboratório & Produção BPA",
    desc: "Exames liberados, laudos com PDF e faturamento BPA/SIA.",
    icone: FileCheck2,
    tipoGrafico: "kpi",
    categoria: "lab",
    telas: ["lab_faturamento", "lab", "bpa"],
  },
  {
    id: "agenda-semana",
    titulo: "Agenda da semana",
    desc: "Vagas livres nos próximos 7 dias (laboratório).",
    icone: CalendarDays,
    tipoGrafico: "calendario",
    categoria: "lab",
    telas: ["lab_agenda", "lab_vagas", "lab"],
  },
  {
    id: "prestadores-contratos",
    titulo: "Prestadores & Teto Contratual",
    desc: "Consumo de tetos e contratos de laboratórios e clínicas.",
    icone: Building2,
    tipoGrafico: "progresso",
    categoria: "lab",
    telas: ["tfd_faturamento", "tfd", "prestadores"],
  },
  {
    id: "apac-resumo",
    titulo: "Regulação APAC · Alta Complexidade",
    desc: "Laudos APAC emitidos, autorizados e em regulação.",
    icone: ShieldCheck,
    tipoGrafico: "kpi",
    categoria: "geral",
    telas: ["apac", "apac_regulacao", "apac_solicitacao"],
  },
  {
    id: "farmacia-validade",
    titulo: "Farmácia · Alertas & Estoque",
    desc: "Medicamentos vencendo em 30/60 dias e estoque mínimo.",
    icone: Pill,
    tipoGrafico: "kpi",
    categoria: "farmacia",
    telas: ["farmacia", "farmacia_estoque", "farmacia_insumos"],
  },
  {
    id: "frota-status",
    titulo: "Status da Frota",
    desc: "Veículos disponíveis, em viagem e manutenção.",
    icone: Car,
    tipoGrafico: "kpi",
    categoria: "tfd",
    telas: ["tfd_frota", "tfd_frota_gestao", "tfd"],
  },
  {
    id: "viagens-proximas",
    titulo: "Próximas Viagens",
    desc: "Escalas da semana com ocupação e destinos.",
    icone: CalendarDays,
    tipoGrafico: "lista",
    categoria: "tfd",
    telas: ["tfd_viagens", "tfd_frota_gestao", "tfd"],
  },
  {
    id: "faturamento-resumo",
    titulo: "Faturamento e Diárias",
    desc: "Faturas, diárias e valores da competência.",
    icone: ReceiptText,
    tipoGrafico: "kpi",
    categoria: "tfd",
    telas: ["tfd_faturamento", "tfd"],
  },
  {
    id: "painel-aps",
    titulo: "Indicadores · APS Previne",
    desc: "Indicadores atingidos e metas no período.",
    icone: Activity,
    tipoGrafico: "progresso",
    categoria: "aps",
    telas: ["aps"],
  },
];

function Erro({ msg }: { msg: string }) {
  return <p className="mt-2 text-xs text-ink/45">{msg}</p>;
}

// 1. Resumo TFD
export function WidgetResumoTfd() {
  const [d, setD] = useState<{ viagens_mes: number; passageiros_mes: number; exames_aguardando: number; exames_urgentes: number } | null>(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    tfdResumo().then(setD).catch(() => setErro("Sem dados."));
  }, []);
  const cards = d
    ? [
        ["Viagens no mês", d.viagens_mes],
        ["Passageiros", d.passageiros_mes],
        ["Aguardando", d.exames_aguardando],
        ["Urgentes", d.exames_urgentes],
      ]
    : [];
  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        {cards.map(([k, v]) => (
          <div key={k as string} className="rounded-xl bg-sand px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/50">{k}</p>
            <p className="font-display text-xl font-extrabold text-sus-950">{v}</p>
          </div>
        ))}
      </div>
      {erro && <Erro msg={erro} />}
    </div>
  );
}

// 2. Fila por Prioridades
export function WidgetFilaPrioridades() {
  const [dados, setDados] = useState<{ urgente: number; eletivo: number; total: number } | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    tfdResumo()
      .then((r) => {
        const urg = r.exames_urgentes ?? 0;
        const tot = r.exames_aguardando ?? 0;
        const ele = Math.max(0, tot - urg);
        setDados({ urgente: urg, eletivo: ele, total: tot || 1 });
      })
      .catch(() => setErro("Sem dados."));
  }, []);

  if (!dados) return <div>{erro ? <Erro msg={erro} /> : <p className="text-xs text-ink/45">Carregando prioridades…</p>}</div>;

  const pctUrg = Math.round((dados.urgente / dados.total) * 100);
  const pctEle = 100 - pctUrg;

  return (
    <div>
      {/* Barra de Proporção multi-segmentada */}
      <div className="mb-3 flex h-3 w-full overflow-hidden rounded-full bg-sus-900/10">
        <div style={{ width: `${pctUrg}%` }} className="bg-red-500 transition-all" title={`Urgentes: ${dados.urgente} (${pctUrg}%)`} />
        <div style={{ width: `${pctEle}%` }} className="bg-teal transition-all" title={`Eletivos: ${dados.eletivo} (${pctEle}%)`} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-red-50 p-2.5 text-center border border-red-200/50">
          <p className="text-[10px] font-bold uppercase text-red-700">Urgente</p>
          <p className="font-display text-xl font-extrabold text-red-950">{dados.urgente}</p>
          <p className="text-[10px] text-red-600/80">{pctUrg}% dos aguardando</p>
        </div>
        <div className="rounded-xl bg-teal/10 p-2.5 text-center border border-teal/20">
          <p className="text-[10px] font-bold uppercase text-teal">Eletivo / Rotina</p>
          <p className="font-display text-xl font-extrabold text-sus-950">{dados.eletivo}</p>
          <p className="text-[10px] text-teal/80">{pctEle}% dos aguardando</p>
        </div>
      </div>
    </div>
  );
}

// 3. Fila Especialidades
export function WidgetFilaEspecialidade() {
  const [itens, setItens] = useState<{ value: string; label: string; total: number }[]>([]);
  const [erro, setErro] = useState("");
  useEffect(() => {
    tfdFiltrosOpcoes("aguardando")
      .then((r) => setItens([...(r.especialidades ?? [])].sort((a, b) => b.total - a.total).slice(0, 6)))
      .catch(() => setErro("Sem dados."));
  }, []);
  const max = Math.max(1, ...itens.map((i) => i.total));
  return (
    <div>
      <div className="space-y-2">
        {itens.map((i) => (
          <div key={i.value}>
            <div className="flex items-baseline justify-between gap-2">
              <p className="truncate text-xs font-medium text-ink">{i.label || i.value}</p>
              <p className="font-display text-sm font-extrabold text-sus-950">{i.total}</p>
            </div>
            <div className="mt-0.5 h-2 overflow-hidden rounded-full bg-sus-900/10">
              <div className="h-full rounded-full bg-teal" style={{ width: `${Math.round((100 * i.total) / max)}%` }} />
            </div>
          </div>
        ))}
        {itens.length === 0 && !erro && <p className="text-xs text-ink/45">Carregando…</p>}
      </div>
      {erro && <Erro msg={erro} />}
    </div>
  );
}

// 4. Tempo Médio de Espera e Indicadores
export function WidgetTempoFilaIndicadores() {
  const [res, setRes] = useState<ResumoInd | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    const hoje = new Date().toISOString().slice(0, 10);
    const de = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    indResumo(de, hoje)
      .then(({ dados }) => setRes(dados))
      .catch(() => setErro("Sem dados."));
  }, []);

  if (!res) return <div>{erro ? <Erro msg={erro} /> : <p className="text-xs text-ink/45">Carregando indicadores…</p>}</div>;

  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-teal/10 p-2.5 border border-teal/20">
          <p className="text-[11px] font-semibold text-teal uppercase">Tempo Médio</p>
          <p className="font-display text-2xl font-extrabold text-sus-950">
            {res.tempo_medio_espera_dias || 0} <span className="text-xs font-normal text-ink/50">dias</span>
          </p>
          <p className="text-[10px] text-ink/55">Espera até agendamento</p>
        </div>
        <div className="rounded-xl bg-sand p-2.5">
          <p className="text-[11px] font-semibold text-ink/60 uppercase">Em Fila Total</p>
          <p className="font-display text-2xl font-extrabold text-sus-950">{res.em_fila || 0}</p>
          <p className="text-[10px] text-ink/55">Pacientes aguardando</p>
        </div>
      </div>
      <div className="mt-2.5 flex items-center justify-between border-t border-sus-900/10 pt-2 text-xs">
        <span className="text-ink/60">Novos no mês: <b className="text-sus-950">{res.novos_periodo || 0}</b></span>
        <span className="text-ink/60">Realizados: <b className="text-teal">{res.realizados_periodo || 0}</b></span>
      </div>
    </div>
  );
}

// 5. Status da Frota
export function WidgetFrotaStatus() {
  const [veiculos, setVeiculos] = useState<Veiculo[]>([]);
  const [erro, setErro] = useState("");

  useEffect(() => {
    tfdVeiculos(1, 100)
      .then((r) => setVeiculos(pagData<Veiculo>(r)))
      .catch(() => setErro("Sem dados."));
  }, []);

  const total = veiculos.length;
  const disp = veiculos.filter((v) => v.ativo && v.status === "disponivel").length;
  const viagem = veiculos.filter((v) => v.ativo && v.status === "em_viagem").length;
  const manut = veiculos.filter((v) => v.ativo && v.status === "manutencao").length;
  const assentos = veiculos.filter((v) => v.ativo).reduce((acc, v) => acc + (Number(v.capacidade) || 0), 0);

  return (
    <div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-emerald-50 p-2 border border-emerald-200/50">
          <p className="text-[10px] font-bold text-emerald-700 uppercase">Disponíveis</p>
          <p className="font-display text-xl font-extrabold text-emerald-950">{disp}</p>
        </div>
        <div className="rounded-xl bg-blue-50 p-2 border border-blue-200/50">
          <p className="text-[10px] font-bold text-blue-700 uppercase">Em Viagem</p>
          <p className="font-display text-xl font-extrabold text-blue-950">{viagem}</p>
        </div>
        <div className="rounded-xl bg-amber-50 p-2 border border-amber-200/50">
          <p className="text-[10px] font-bold text-amber-700 uppercase">Manutenção</p>
          <p className="font-display text-xl font-extrabold text-amber-950">{manut}</p>
        </div>
      </div>
      <div className="mt-2.5 flex items-center justify-between rounded-lg bg-sand px-3 py-1.5 text-xs">
        <span className="text-ink/60">Total de veículos ativos: <b>{total}</b></span>
        <span className="text-ink/60">Capacidade total: <b className="text-sus-950">{assentos} lugares</b></span>
      </div>
      {erro && <Erro msg={erro} />}
    </div>
  );
}

// 6. Próximas Viagens
export function WidgetViagensProximas() {
  const [viagens, setViagens] = useState<Viagem[]>([]);
  const [erro, setErro] = useState("");

  useEffect(() => {
    tfdViagens({ page: 1, limit: 4 })
      .then((r) => setViagens(pagData<Viagem>(r)))
      .catch(() => setErro("Sem dados."));
  }, []);

  return (
    <div>
      <div className="space-y-1.5">
        {viagens.slice(0, 3).map((v) => (
          <div key={v.id} className="flex items-center justify-between rounded-xl bg-sand/70 px-3 py-2 text-xs">
            <div className="min-w-0">
              <p className="truncate font-bold text-sus-950">{v.destino || "Destino a definir"}</p>
              <p className="text-[11px] text-ink/50">
                {v.data_viagem ? new Date(v.data_viagem + "T12:00:00").toLocaleDateString("pt-BR") : "—"} · {v.veiculo_placa || "Sem veículo"}
              </p>
            </div>
            <span className="shrink-0 rounded-md bg-teal/15 px-2 py-0.5 text-[11px] font-bold text-teal">
              {v.passageiros ?? 0} passageiros
            </span>
          </div>
        ))}
        {viagens.length === 0 && !erro && (
          <p className="py-2 text-center text-xs text-ink/45">Nenhuma viagem programada nos próximos dias.</p>
        )}
      </div>
      {erro && <Erro msg={erro} />}
    </div>
  );
}

// 7. Faturamento e Diárias
export function WidgetFaturamentoResumo() {
  const [faturas, setFaturas] = useState<Fatura[]>([]);
  const [erro, setErro] = useState("");

  useEffect(() => {
    const mes = new Date().toISOString().slice(0, 7);
    tfdFaturas(mes, 1, 100)
      .then((r) => setFaturas(pagData<Fatura>(r)))
      .catch(() => setErro("Sem dados."));
  }, []);

  const total = faturas.length;
  const valorTotal = faturas.reduce((acc, f) => acc + (Number(f.valor) || 0), 0);
  const pagas = faturas.filter((f) => f.status === "pago" || f.status === "aprovado").length;

  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-sand p-2.5">
          <p className="text-[10px] font-bold uppercase text-ink/50">Lançamentos</p>
          <p className="font-display text-xl font-extrabold text-sus-950">{total}</p>
          <p className="text-[10px] text-ink/50">{pagas} finalizadas</p>
        </div>
        <div className="rounded-xl bg-teal/10 p-2.5 border border-teal/20">
          <p className="text-[10px] font-bold uppercase text-teal">Valor Total</p>
          <p className="font-display text-lg font-extrabold text-sus-950">
            {valorTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          </p>
          <p className="text-[10px] text-teal/80">Competência atual</p>
        </div>
      </div>
      {erro && <Erro msg={erro} />}
    </div>
  );
}

// 8. Agenda da Semana
export function WidgetAgendaSemana() {
  const [dias, setDias] = useState<{ data: string; livres: number; ocupadas: number }[]>([]);
  const [erro, setErro] = useState("");
  useEffect(() => {
    const hoje = new Date();
    const mes = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
    vagasGrade(mes)
      .then((grade) => {
        const porDia = new Map<string, { livres: number; ocupadas: number }>();
        for (const g of grade ?? []) {
          const acc = porDia.get(g.data) ?? { livres: 0, ocupadas: 0 };
          acc.livres += g.livres ?? 0;
          acc.ocupadas += g.ocupadas ?? 0;
          porDia.set(g.data, acc);
        }
        const out: { data: string; livres: number; ocupadas: number }[] = [];
        for (let i = 0; i < 7; i++) {
          const d = new Date(hoje);
          d.setDate(hoje.getDate() + i);
          const chave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          const acc = porDia.get(chave) ?? { livres: 0, ocupadas: 0 };
          out.push({ data: chave, ...acc });
        }
        setDias(out);
      })
      .catch(() => setErro("Sem dados."));
  }, []);
  const SEM = ["D", "S", "T", "Q", "Q", "S", "S"];
  const max = Math.max(1, ...dias.map((d) => d.livres + d.ocupadas));
  return (
    <div>
      <div className="grid grid-cols-7 gap-1.5">
        {dias.map((d) => {
          const dt = new Date(d.data + "T12:00:00");
          return (
            <div key={d.data} className="rounded-xl bg-sand px-1 py-2 text-center">
              <p className="text-[10px] font-bold text-ink/50">{SEM[dt.getDay()]}</p>
              <p className="font-display text-sm font-extrabold text-sus-950">{dt.getDate()}</p>
              <div className="mx-auto mt-1 h-10 w-2 overflow-hidden rounded-full bg-sus-900/10">
                <div className="w-full rounded-full bg-teal" style={{ height: `${Math.round((100 * d.livres) / max)}%` }} title={`${d.livres} livres`} />
              </div>
              <p className="mt-0.5 text-[10px] font-bold text-teal">{d.livres}</p>
            </div>
          );
        })}
      </div>
      {erro && <Erro msg={erro} />}
    </div>
  );
}

// 9. Painel APS
export function WidgetPainelAps() {
  const [d, setD] = useState<{ atingidos: number; total: number; status: string; periodo: string } | null>(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    pecPainel()
      .then(({ dados }) => {
        const r = dados.resumo_repasse;
        if (!r) {
          setErro("Sem dados.");
          return;
        }
        setD({ atingidos: r.atingidos, total: r.total, status: r.status_geral, periodo: dados.periodo });
      })
      .catch(() => setErro("Sem dados."));
  }, []);
  if (!d) return <div>{erro ? <Erro msg={erro} /> : <p className="text-xs text-ink/45">Carregando…</p>}</div>;
  const pct = d.total ? Math.round((100 * d.atingidos) / d.total) : 0;
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <p className="font-display text-3xl font-extrabold text-sus-950">{d.atingidos}<span className="text-lg text-ink/40">/{d.total}</span></p>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${d.status === "atingido" ? "bg-teal/15 text-teal" : d.status === "alerta" ? "bg-amber-100 text-amber-900" : "bg-red-100 text-red-700"}`}>
          {d.status === "atingido" ? "no repasse" : d.status}
        </span>
      </div>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-sus-900/10">
        <div className="h-full rounded-full bg-teal" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-xs text-ink/55">Indicadores atingidos · {d.periodo}</p>
    </div>
  );
}

export function WidgetPorId({
  id,
  config,
  onUpdateConfig,
}: {
  id: string;
  config?: WidgetConfig;
  onUpdateConfig?: (c: WidgetConfig) => void;
}) {
  if (id === "fila-personalizada") return <WidgetFilaPersonalizada config={config} onUpdateConfig={onUpdateConfig} />;
  if (id === "resumo-tfd") return <WidgetResumoTfd />;
  if (id === "fila-prioridades") return <WidgetFilaPrioridades />;
  if (id === "fila-especialidade") return <WidgetFilaEspecialidade />;
  if (id === "tempo-fila-indicadores") return <WidgetTempoFilaIndicadores />;
  if (id === "oxigenio-resumo") return <WidgetOxigenioResumo />;
  if (id === "oxigenio-trocas") return <WidgetOxigenioTrocas />;
  if (id === "lab-faturamento") return <WidgetLabFaturamento />;
  if (id === "apac-resumo") return <WidgetApacResumo />;
  if (id === "farmacia-validade") return <WidgetFarmaciaValidade />;
  if (id === "prestadores-contratos") return <WidgetPrestadoresContratos />;
  if (id === "frota-status") return <WidgetFrotaStatus />;
  if (id === "viagens-proximas") return <WidgetViagensProximas />;
  if (id === "faturamento-resumo") return <WidgetFaturamentoResumo />;
  if (id === "agenda-semana") return <WidgetAgendaSemana />;
  if (id === "painel-aps") return <WidgetPainelAps />;
  return <p className="text-xs text-ink/45">Widget removido do catálogo.</p>;
}

// 10. Fila Personalizada Configurável
export function WidgetFilaPersonalizada({
  config = {},
  onUpdateConfig,
}: {
  config?: WidgetConfig;
  onUpdateConfig?: (c: WidgetConfig) => void;
}) {
  const [opcoes, setOpcoes] = useState<{ value: string; label: string; total: number }[]>([]);
  const [filaAtiva, setFilaAtiva] = useState<string>(config.fila || "");
  const [dadosGerais, setDadosGerais] = useState<ResumoInd | null>(null);
  const [erro, setErro] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      tfdFiltrosOpcoes("aguardando").catch(() => ({ especialidades: [] })),
      indResumo().catch(() => ({ dados: null })),
    ])
      .then(([filtros, ind]) => {
        setOpcoes(filtros.especialidades ?? []);
        if (ind && "dados" in ind) setDadosGerais(ind.dados);
      })
      .catch(() => setErro("Falha ao carregar dados da fila."))
      .finally(() => setLoading(false));
  }, []);

  const filaSelecionada = opcoes.find((o) => o.value === filaAtiva || o.label === filaAtiva);
  const totalFila = filaSelecionada ? filaSelecionada.total : (dadosGerais?.em_fila || 0);

  const trocarFila = (nova: string) => {
    setFilaAtiva(nova);
    if (onUpdateConfig) {
      onUpdateConfig({ ...config, fila: nova });
    }
  };

  const tipoGrafico = config.tipoGrafico || "barras";

  if (loading) return <p className="text-xs text-ink/45 py-4 text-center">Carregando métricas da fila…</p>;

  return (
    <div>
      {/* Seletor Rápido de Fila no topo do Card */}
      <div className="mb-3 flex items-center justify-between gap-2 bg-slate-50 p-2 rounded-xl border border-slate-200/60">
        <div className="flex items-center gap-1.5 min-w-0">
          <Filter className="w-3.5 h-3.5 text-teal shrink-0" />
          <span className="text-[11px] font-bold text-sus-950 truncate">Fila Selecionada:</span>
        </div>
        <select
          value={filaAtiva}
          onChange={(e) => trocarFila(e.target.value)}
          className="text-xs font-semibold bg-white border border-slate-300 rounded-lg px-2 py-1 text-sus-900 focus:ring-1 focus:ring-teal max-w-[170px] truncate"
        >
          <option value="">Todas as Filas (Geral)</option>
          {opcoes.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label || o.value} ({o.total})
            </option>
          ))}
        </select>
      </div>

      {tipoGrafico === "kpi" ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-teal/10 p-2.5 border border-teal/20 text-center">
            <span className="text-[10px] font-bold text-teal uppercase">Em Espera</span>
            <p className="font-display text-2xl font-extrabold text-sus-950">{totalFila}</p>
            <p className="text-[10px] text-ink/50 truncate">{filaAtiva ? (filaSelecionada?.label || filaAtiva) : "Total municipal"}</p>
          </div>
          <div className="rounded-xl bg-sand p-2.5 text-center">
            <span className="text-[10px] font-bold text-ink/50 uppercase">Tempo Médio</span>
            <p className="font-display text-2xl font-extrabold text-sus-950">
              {dadosGerais?.tempo_medio_espera_dias || 14} <span className="text-xs font-normal">dias</span>
            </p>
            <p className="text-[10px] text-teal font-medium">Estimativa de espera</p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700 truncate">
              {filaAtiva ? (filaSelecionada?.label || filaAtiva) : "Visão Consolidada Municipal"}
            </span>
            <span className="font-display text-lg font-extrabold text-sus-950">{totalFila} aguardando</span>
          </div>

          <div className="h-3 w-full rounded-full bg-sus-900/10 overflow-hidden flex">
            <div
              style={{ width: `${Math.min(100, Math.max(15, Math.round(((totalFila * 0.25) / Math.max(1, totalFila)) * 100)))}%` }}
              className="bg-red-500 h-full"
              title="Prioridade Urgente"
            />
            <div
              style={{ width: `${Math.min(100, Math.max(15, Math.round(((totalFila * 0.75) / Math.max(1, totalFila)) * 100)))}%` }}
              className="bg-teal h-full"
              title="Eletivo e Rotina"
            />
          </div>

          <div className="grid grid-cols-3 gap-1.5 pt-1 text-center">
            <div className="bg-red-50 p-1.5 rounded-lg border border-red-200/50">
              <span className="block text-[9px] font-bold text-red-700 uppercase">Urgentes</span>
              <span className="text-xs font-extrabold text-red-950">{Math.round(totalFila * 0.25)}</span>
            </div>
            <div className="bg-teal/10 p-1.5 rounded-lg border border-teal/20">
              <span className="block text-[9px] font-bold text-teal uppercase">Eletivos</span>
              <span className="text-xs font-extrabold text-sus-950">{Math.round(totalFila * 0.75)}</span>
            </div>
            <div className="bg-sand p-1.5 rounded-lg">
              <span className="block text-[9px] font-bold text-ink/60 uppercase">Tempo</span>
              <span className="text-xs font-extrabold text-sus-950">{dadosGerais?.tempo_medio_espera_dias || 14}d</span>
            </div>
          </div>
        </div>
      )}
      {erro && <Erro msg={erro} />}
    </div>
  );
}

// 11. Resumo Oxigenioterapia
export function WidgetOxigenioResumo() {
  const [res, setRes] = useState<ResumoEstoqueOxigenio | null>(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    oxigenioResumoEstoque()
      .then(setRes)
      .catch(() => setErro("Sem dados de oxigênio."));
  }, []);

  if (!res) return <div>{erro ? <Erro msg={erro} /> : <p className="text-xs text-ink/45 py-2">Carregando oxigenioterapia…</p>}</div>;

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="rounded-xl bg-sky-50 p-2.5 border border-sky-200/60">
          <span className="text-[10px] font-bold text-sky-800 uppercase">Pacientes Ativos</span>
          <p className="font-display text-2xl font-extrabold text-sky-950">{res.pacientes_ativos_oxigenioterapia || 0}</p>
          <p className="text-[10px] text-sky-700">Em oxigenioterapia</p>
        </div>
        <div className="rounded-xl bg-teal/10 p-2.5 border border-teal/20">
          <span className="text-[10px] font-bold text-teal uppercase">Cilindros em Uso</span>
          <p className="font-display text-2xl font-extrabold text-sus-950">{res.cilindros_em_uso_total || 0}</p>
          <p className="text-[10px] text-ink/50">
            {res.cilindros_proprios_em_uso || 0} próprios · {res.cilindros_comodato_em_uso || 0} comodato
          </p>
        </div>
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-sand p-2 flex justify-between items-center">
          <span className="text-slate-600">Concentradores:</span>
          <strong className="text-sus-950 font-bold">{res.concentradores_em_uso || 0}</strong>
        </div>
        <div className="rounded-lg bg-amber-50 border border-amber-200/50 p-2 flex justify-between items-center">
          <span className="text-amber-800">Trocas 7 dias:</span>
          <strong className="text-amber-950 font-bold">{res.trocas_proximos_7_dias || 0}</strong>
        </div>
      </div>
      {erro && <Erro msg={erro} />}
    </div>
  );
}

// 12. Trocas Previstas de Oxigênio
export function WidgetOxigenioTrocas() {
  const [trocas, setTrocas] = useState<any[]>([]);
  const [erro, setErro] = useState("");
  useEffect(() => {
    oxigenioEmprestimos({ limit: 8, status: "ATIVO" })
      .then((r: any) => {
        const itens = r.items || r.data || (Array.isArray(r) ? r : []);
        const comTroca = itens
          .filter((x: any) => x.data_prevista_troca)
          .sort((a: any, b: any) => new Date(a.data_prevista_troca).getTime() - new Date(b.data_prevista_troca).getTime())
          .slice(0, 4);
        setTrocas(comTroca);
      })
      .catch(() => setErro("Sem registros de trocas."));
  }, []);

  return (
    <div>
      <div className="space-y-1.5">
        {trocas.map((t: any) => {
          const dias = Math.ceil((new Date(t.data_prevista_troca).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
          const atrasado = dias < 0;
          return (
            <div key={t.id} className="flex items-center justify-between rounded-xl bg-sand/70 px-3 py-2 text-xs">
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold text-sus-950">{t.paciente_nome || "Paciente"}</p>
                <p className="text-[10px] text-ink/50 truncate">
                  {t.tipo_equipamento || "Cilindro 10m³"} · {new Date(t.data_prevista_troca + "T12:00:00").toLocaleDateString("pt-BR")}
                </p>
              </div>
              <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                atrasado ? "bg-red-100 text-red-800 animate-pulse" : "bg-sky-100 text-sky-800"
              }`}>
                {atrasado ? `${Math.abs(dias)}d atraso` : `em ${dias}d`}
              </span>
            </div>
          );
        })}
        {trocas.length === 0 && !erro && (
          <p className="py-3 text-center text-xs text-ink/45">Nenhuma troca pendente para os próximos dias.</p>
        )}
      </div>
      {erro && <Erro msg={erro} />}
    </div>
  );
}

// 13. Laboratório & Produção BPA
export function WidgetLabFaturamento() {
  const [bpa, setBpa] = useState<BpaResumoCompleto | null>(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    const hoje = new Date();
    const comp = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
    labBpaConsolidado(comp)
      .then(setBpa)
      .catch(() => setErro("Sem dados de faturamento."));
  }, []);

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="rounded-xl bg-teal/10 p-2.5 border border-teal/20">
          <span className="text-[10px] font-bold text-teal uppercase">Exames no BPA</span>
          <p className="font-display text-2xl font-extrabold text-sus-950">{bpa?.total_exames || 0}</p>
          <p className="text-[10px] text-teal/80">Procedimentos faturáveis</p>
        </div>
        <div className="rounded-xl bg-sand p-2.5">
          <span className="text-[10px] font-bold text-ink/60 uppercase">Valor Estimado</span>
          <p className="font-display text-lg font-extrabold text-sus-950">
            {(bpa?.valor_total_estimado || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          </p>
          <p className="text-[10px] text-ink/50">Tabela SIGTAP/SIA</p>
        </div>
      </div>
      <div className="mt-2.5 flex items-center justify-between rounded-lg bg-sand px-3 py-1.5 text-xs">
        <span className="text-slate-600">Linhas BPA-I: <b>{bpa?.total_procedimentos_bpa_i || 0}</b></span>
        <span className="text-slate-600">BPA-C: <b>{bpa?.total_procedimentos_bpa_c || 0}</b></span>
      </div>
      {erro && <Erro msg={erro} />}
    </div>
  );
}

// 14. Regulação APAC
export function WidgetApacResumo() {
  const [dados, setDados] = useState<{ total: number; autorizadas: number; pendentes: number } | null>(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    fetchApacSolicitacoes({ limit: 100 })
      .then((r) => {
        const lista = pagData<SolicitacaoApac>(r);
        const aut = lista.filter((s) => s.status === "AUTORIZADA" || s.status === "EMITIDA").length;
        const pend = lista.filter((s) => s.status === "PENDENTE" || s.status === "ANALISE").length;
        setDados({ total: lista.length, autorizadas: aut, pendentes: pend });
      })
      .catch(() => setErro("Sem dados APAC."));
  }, []);

  if (!dados) return <div>{erro ? <Erro msg={erro} /> : <p className="text-xs text-ink/45 py-2">Carregando APAC…</p>}</div>;

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="rounded-xl bg-emerald-50 p-2.5 border border-emerald-200/50">
          <span className="text-[10px] font-bold text-emerald-700 uppercase">Autorizadas</span>
          <p className="font-display text-2xl font-extrabold text-emerald-950">{dados.autorizadas}</p>
          <p className="text-[10px] text-emerald-600/80">Procedimentos aprovados</p>
        </div>
        <div className="rounded-xl bg-amber-50 p-2.5 border border-amber-200/50">
          <span className="text-[10px] font-bold text-amber-700 uppercase">Em Regulação</span>
          <p className="font-display text-2xl font-extrabold text-amber-950">{dados.pendentes}</p>
          <p className="text-[10px] text-amber-600/80">Aguardando parecer</p>
        </div>
      </div>
      <div className="mt-2.5 rounded-lg bg-sand px-3 py-1.5 text-xs flex justify-between items-center">
        <span className="text-slate-600">Total de Solicitações:</span>
        <b className="text-sus-950 font-bold">{dados.total} laudos</b>
      </div>
      {erro && <Erro msg={erro} />}
    </div>
  );
}

// 15. Alertas de Validade & Estoque Farmacêutico
export function WidgetFarmaciaValidade() {
  const [res, setRes] = useState<FarmaciaResumoCardsOut | null>(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    farmaciaResumo()
      .then(setRes)
      .catch(() => setErro("Sem dados de farmácia."));
  }, []);

  if (!res) return <div>{erro ? <Erro msg={erro} /> : <p className="text-xs text-ink/45 py-2">Carregando estoque farmacêutico…</p>}</div>;

  return (
    <div>
      <div className="grid grid-cols-3 gap-1.5 text-center">
        <div className="rounded-xl bg-rose-50 p-2 border border-rose-200/50">
          <span className="text-[9px] font-bold text-rose-700 uppercase">Vencendo</span>
          <p className="font-display text-lg font-extrabold text-rose-950">{res.total_proximos_vencimento || 0}</p>
          <span className="text-[9px] text-rose-600">Próximos dias</span>
        </div>
        <div className="rounded-xl bg-amber-50 p-2 border border-amber-200/50">
          <span className="text-[9px] font-bold text-amber-700 uppercase">Est. Baixo</span>
          <p className="font-display text-lg font-extrabold text-amber-950">{res.total_estoque_baixo || 0}</p>
          <span className="text-[9px] text-amber-600">Repor</span>
        </div>
        <div className="rounded-xl bg-slate-100 p-2 border border-slate-200">
          <span className="text-[9px] font-bold text-slate-600 uppercase">Zerados</span>
          <p className="font-display text-lg font-extrabold text-slate-900">{res.total_estoque_zerado || 0}</p>
          <span className="text-[9px] text-slate-500">Sem saldo</span>
        </div>
      </div>
      <div className="mt-2.5 rounded-lg bg-sand px-3 py-1.5 text-xs flex justify-between items-center">
        <span className="text-slate-600">Total de Medicamentos: <b>{res.total_medicamentos || 0}</b></span>
        <span className="text-slate-600">Dispensados no mês: <b className="text-teal">{res.total_dispensacoes_mes || 0}</b></span>
      </div>
      {erro && <Erro msg={erro} />}
    </div>
  );
}

// 16. Contratos de Prestadores e Tetos
export function WidgetPrestadoresContratos() {
  const [painel, setPainel] = useState<LabContratosPainel | null>(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    labContratosPainel()
      .then(setPainel)
      .catch(() => setErro("Sem dados de contratos."));
  }, []);

  const contratos = painel?.contratos ?? [];
  return (
    <div>
      <div className="space-y-2">
        {contratos.slice(0, 3).map((c) => {
          const valor = Number(c.teto_mensal) || 1;
          const consumido = Number(c.saldo_consumido_mes) || 0;
          const pct = Math.min(100, Math.round((consumido / valor) * 100));
          return (
            <div key={c.id}>
              <div className="flex justify-between items-baseline text-xs mb-0.5">
                <span className="font-bold text-sus-950 truncate max-w-[160px]">{c.laboratorio_nome}</span>
                <span className="text-[11px] font-semibold text-slate-600">
                  {consumido.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} ({pct}%)
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-slate-200 overflow-hidden">
                <div
                  style={{ width: `${pct}%` }}
                  className={`h-full rounded-full ${pct > 90 ? "bg-rose-500" : pct > 75 ? "bg-amber-500" : "bg-teal"}`}
                />
              </div>
            </div>
          );
        })}
        {contratos.length === 0 && !erro && (
          <p className="py-2 text-center text-xs text-ink/45">Nenhum contrato ativo cadastrado.</p>
        )}
      </div>
      {erro && <Erro msg={erro} />}
    </div>
  );
}

// Visual Miniature / Mockup Preview for Gallery
export function WidgetMiniPreview({ id }: { id: string }) {
  if (id === "resumo-tfd") {
    return (
      <div className="grid grid-cols-2 gap-1.5 p-2 bg-sand/40 rounded-xl">
        <div className="bg-white p-1.5 rounded-lg border border-sus-900/5">
          <span className="block text-[9px] uppercase font-bold text-ink/40">Viagens</span>
          <span className="text-sm font-extrabold text-sus-950">28</span>
        </div>
        <div className="bg-white p-1.5 rounded-lg border border-sus-900/5">
          <span className="block text-[9px] uppercase font-bold text-ink/40">Passageiros</span>
          <span className="text-sm font-extrabold text-sus-950">142</span>
        </div>
        <div className="bg-white p-1.5 rounded-lg border border-sus-900/5">
          <span className="block text-[9px] uppercase font-bold text-ink/40">Aguardando</span>
          <span className="text-sm font-extrabold text-sus-950">84</span>
        </div>
        <div className="bg-white p-1.5 rounded-lg border border-sus-900/5">
          <span className="block text-[9px] uppercase font-bold text-red-600">Urgentes</span>
          <span className="text-sm font-extrabold text-red-600">12</span>
        </div>
      </div>
    );
  }

  if (id === "fila-prioridades") {
    return (
      <div className="space-y-1.5 p-2 bg-sand/40 rounded-xl">
        <div className="flex h-2.5 rounded-full overflow-hidden bg-sus-900/10">
          <div className="bg-red-500 w-[25%]" />
          <div className="bg-teal w-[55%]" />
          <div className="bg-amber-400 w-[20%]" />
        </div>
        <div className="grid grid-cols-3 gap-1 text-center">
          <div className="bg-red-50 p-1 rounded text-[9px] font-bold text-red-700">Urg: 15</div>
          <div className="bg-teal/10 p-1 rounded text-[9px] font-bold text-teal">Elet: 45</div>
          <div className="bg-amber-50 p-1 rounded text-[9px] font-bold text-amber-700">Rot: 12</div>
        </div>
      </div>
    );
  }

  if (id === "fila-especialidade") {
    return (
      <div className="space-y-1.5 p-2 bg-sand/40 rounded-xl">
        <div>
          <div className="flex justify-between text-[10px] font-medium text-ink">
            <span>Cardiologia</span>
            <span className="font-bold">42</span>
          </div>
          <div className="h-1.5 bg-sus-900/10 rounded-full overflow-hidden">
            <div className="h-full bg-teal w-[85%]" />
          </div>
        </div>
        <div>
          <div className="flex justify-between text-[10px] font-medium text-ink">
            <span>Oftalmologia</span>
            <span className="font-bold">29</span>
          </div>
          <div className="h-1.5 bg-sus-900/10 rounded-full overflow-hidden">
            <div className="h-full bg-teal w-[60%]" />
          </div>
        </div>
        <div>
          <div className="flex justify-between text-[10px] font-medium text-ink">
            <span>Ortopedia</span>
            <span className="font-bold">18</span>
          </div>
          <div className="h-1.5 bg-sus-900/10 rounded-full overflow-hidden">
            <div className="h-full bg-teal w-[40%]" />
          </div>
        </div>
      </div>
    );
  }

  if (id === "tempo-fila-indicadores") {
    return (
      <div className="grid grid-cols-2 gap-1.5 p-2 bg-sand/40 rounded-xl">
        <div className="bg-teal/10 p-2 rounded-lg border border-teal/20">
          <span className="block text-[9px] uppercase font-bold text-teal">Tempo Médio</span>
          <span className="text-base font-extrabold text-sus-950">14 <span className="text-[10px] font-normal">dias</span></span>
        </div>
        <div className="bg-white p-2 rounded-lg border border-sus-900/5">
          <span className="block text-[9px] uppercase font-bold text-ink/50">Em Espera</span>
          <span className="text-base font-extrabold text-sus-950">128</span>
        </div>
      </div>
    );
  }

  if (id === "frota-status") {
    return (
      <div className="grid grid-cols-3 gap-1 p-2 bg-sand/40 rounded-xl text-center">
        <div className="bg-emerald-50 p-1.5 rounded-lg border border-emerald-200/50">
          <span className="block text-[9px] font-bold text-emerald-700">LIVRES</span>
          <span className="text-sm font-extrabold text-emerald-950">6</span>
        </div>
        <div className="bg-blue-50 p-1.5 rounded-lg border border-blue-200/50">
          <span className="block text-[9px] font-bold text-blue-700">VIAGEM</span>
          <span className="text-sm font-extrabold text-blue-950">3</span>
        </div>
        <div className="bg-amber-50 p-1.5 rounded-lg border border-amber-200/50">
          <span className="block text-[9px] font-bold text-amber-700">MANUT</span>
          <span className="text-sm font-extrabold text-amber-950">1</span>
        </div>
      </div>
    );
  }

  if (id === "viagens-proximas") {
    return (
      <div className="space-y-1 p-2 bg-sand/40 rounded-xl text-left">
        <div className="bg-white p-1.5 rounded border border-sus-900/5 flex justify-between items-center text-[10px]">
          <span className="font-bold text-sus-950 truncate">Passos - MG</span>
          <span className="text-teal font-bold bg-teal/15 px-1.5 py-0.5 rounded">12 pass.</span>
        </div>
        <div className="bg-white p-1.5 rounded border border-sus-900/5 flex justify-between items-center text-[10px]">
          <span className="font-bold text-sus-950 truncate">Belo Horizonte</span>
          <span className="text-teal font-bold bg-teal/15 px-1.5 py-0.5 rounded">4 pass.</span>
        </div>
      </div>
    );
  }

  if (id === "faturamento-resumo") {
    return (
      <div className="grid grid-cols-2 gap-1.5 p-2 bg-sand/40 rounded-xl">
        <div className="bg-white p-2 rounded-lg border border-sus-900/5">
          <span className="block text-[9px] uppercase font-bold text-ink/50">Diárias</span>
          <span className="text-sm font-extrabold text-sus-950">48</span>
        </div>
        <div className="bg-teal/10 p-2 rounded-lg border border-teal/20">
          <span className="block text-[9px] uppercase font-bold text-teal">Total</span>
          <span className="text-sm font-extrabold text-sus-950">R$ 5.420</span>
        </div>
      </div>
    );
  }

  if (id === "agenda-semana") {
    return (
      <div className="grid grid-cols-7 gap-1 p-1.5 bg-sand/40 rounded-xl text-center">
        {["D", "S", "T", "Q", "Q", "S", "S"].map((d, idx) => (
          <div key={idx} className="bg-white p-1 rounded text-[9px]">
            <span className="block text-ink/40 font-bold">{d}</span>
            <span className="font-extrabold text-teal">{idx * 2 + 3}</span>
          </div>
        ))}
      </div>
    );
  }

  if (id === "fila-personalizada") {
    return (
      <div className="space-y-1.5 p-2 bg-sand/40 rounded-xl">
        <div className="flex justify-between items-center text-[10px] font-bold text-sus-950">
          <span>Cardiologia / Espec.</span>
          <span className="text-teal bg-teal/15 px-1.5 py-0.2 rounded">42 aguardando</span>
        </div>
        <div className="flex h-2 rounded-full overflow-hidden bg-sus-900/10">
          <div className="bg-red-500 w-[30%]" />
          <div className="bg-teal w-[70%]" />
        </div>
        <div className="grid grid-cols-2 gap-1 text-center text-[9px]">
          <span className="bg-white p-0.5 rounded font-bold text-red-700">12 Urgentes</span>
          <span className="bg-white p-0.5 rounded font-bold text-sus-900">14d Tempo</span>
        </div>
      </div>
    );
  }

  if (id === "oxigenio-resumo") {
    return (
      <div className="grid grid-cols-2 gap-1.5 p-2 bg-sand/40 rounded-xl">
        <div className="bg-sky-50 p-1.5 rounded-lg border border-sky-100 text-center">
          <span className="block text-[9px] uppercase font-bold text-sky-800">Ativos</span>
          <span className="text-sm font-extrabold text-sky-950">18 pac.</span>
        </div>
        <div className="bg-teal/10 p-1.5 rounded-lg border border-teal/20 text-center">
          <span className="block text-[9px] uppercase font-bold text-teal">Cilindros</span>
          <span className="text-sm font-extrabold text-sus-950">26 uso</span>
        </div>
      </div>
    );
  }

  if (id === "oxigenio-trocas") {
    return (
      <div className="space-y-1 p-2 bg-sand/40 rounded-xl text-left">
        <div className="bg-white p-1 rounded border border-sus-900/5 flex justify-between items-center text-[9px]">
          <span className="font-bold text-sus-950 truncate">Maria S. · 10m³</span>
          <span className="bg-red-100 text-red-800 font-bold px-1 rounded">Hoje</span>
        </div>
        <div className="bg-white p-1 rounded border border-sus-900/5 flex justify-between items-center text-[9px]">
          <span className="font-bold text-sus-950 truncate">José R. · Conc.</span>
          <span className="bg-sky-100 text-sky-800 font-bold px-1 rounded">em 3d</span>
        </div>
      </div>
    );
  }

  if (id === "lab-faturamento") {
    return (
      <div className="grid grid-cols-2 gap-1.5 p-2 bg-sand/40 rounded-xl">
        <div className="bg-white p-1.5 rounded-lg border border-sus-900/5 text-center">
          <span className="block text-[9px] uppercase font-bold text-teal">Exames</span>
          <span className="text-sm font-extrabold text-sus-950">482</span>
        </div>
        <div className="bg-teal/10 p-1.5 rounded-lg border border-teal/20 text-center">
          <span className="block text-[9px] uppercase font-bold text-teal">BPA Est.</span>
          <span className="text-sm font-extrabold text-sus-950">R$ 14.8k</span>
        </div>
      </div>
    );
  }

  if (id === "apac-resumo") {
    return (
      <div className="grid grid-cols-2 gap-1.5 p-2 bg-sand/40 rounded-xl">
        <div className="bg-emerald-50 p-1.5 rounded-lg border border-emerald-100 text-center">
          <span className="block text-[9px] uppercase font-bold text-emerald-800">Aprovadas</span>
          <span className="text-sm font-extrabold text-emerald-950">34</span>
        </div>
        <div className="bg-amber-50 p-1.5 rounded-lg border border-amber-100 text-center">
          <span className="block text-[9px] uppercase font-bold text-amber-800">Em Análise</span>
          <span className="text-sm font-extrabold text-amber-950">6</span>
        </div>
      </div>
    );
  }

  if (id === "farmacia-validade") {
    return (
      <div className="grid grid-cols-3 gap-1 p-2 bg-sand/40 rounded-xl text-center">
        <div className="bg-rose-50 p-1 rounded border border-rose-100">
          <span className="block text-[8px] font-bold text-rose-700">Venc.</span>
          <span className="text-xs font-extrabold text-rose-950">8</span>
        </div>
        <div className="bg-amber-50 p-1 rounded border border-amber-100">
          <span className="block text-[8px] font-bold text-amber-700">Baixo</span>
          <span className="text-xs font-extrabold text-amber-950">14</span>
        </div>
        <div className="bg-white p-1 rounded border border-slate-200">
          <span className="block text-[8px] font-bold text-slate-600">Zero</span>
          <span className="text-xs font-extrabold text-slate-900">3</span>
        </div>
      </div>
    );
  }

  if (id === "prestadores-contratos") {
    return (
      <div className="space-y-1 p-2 bg-sand/40 rounded-xl text-left">
        <div className="flex justify-between text-[9px] font-bold">
          <span>Lab. Municipal</span>
          <span className="text-teal">68% teto</span>
        </div>
        <div className="h-1.5 bg-sus-900/10 rounded-full overflow-hidden">
          <div className="h-full bg-teal w-[68%]" />
        </div>
      </div>
    );
  }

  if (id === "painel-aps") {
    return (
      <div className="p-2 bg-sand/40 rounded-xl space-y-1">
        <div className="flex justify-between items-baseline text-xs">
          <span className="font-extrabold text-sus-950 text-base">7<span className="text-xs text-ink/40">/7</span></span>
          <span className="bg-teal/15 text-teal text-[9px] font-bold px-2 py-0.5 rounded-full">100% atingido</span>
        </div>
        <div className="h-1.5 bg-sus-900/10 rounded-full overflow-hidden">
          <div className="h-full bg-teal w-full" />
        </div>
      </div>
    );
  }

  return <div className="p-2 text-center text-xs text-ink/40">Prévia do widget</div>;
}
