import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Ambulance,
  CalendarDays,
  Car,
  CheckCircle2,
  Clock,
  ListOrdered,
  ReceiptText,
  ShieldCheck,
  TrendingUp,
  Truck,
  Users,
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
  type Fatura,
  type Veiculo,
  type Viagem,
} from "./services/api";
import { pecPainel } from "./services/pec";
import { indResumo, type ResumoInd } from "./services/indicadores";

export interface WidgetDef {
  id: string;
  titulo: string;
  desc: string;
  icone: LucideIcon;
  tipoGrafico: "kpi" | "barras" | "progresso" | "lista" | "calendario";
  /** telas que liberam o widget (qualquer uma basta; endpoints reforçam no backend) */
  telas: string[];
}

export const WIDGETS: WidgetDef[] = [
  {
    id: "resumo-tfd",
    titulo: "TFD do mês",
    desc: "Viagens, passageiros e exames aguardando/urgentes.",
    icone: Ambulance,
    tipoGrafico: "kpi",
    telas: ["tfd_resumo", "tfd"],
  },
  {
    id: "fila-prioridades",
    titulo: "Fila · Por Prioridade",
    desc: "Proporção de urgências, eletivos e rotina na fila.",
    icone: AlertTriangle,
    tipoGrafico: "progresso",
    telas: ["tfd_exames", "tfd_medico", "tfd"],
  },
  {
    id: "fila-especialidade",
    titulo: "Fila por especialidade",
    desc: "Aguardando por especialidade (top 6).",
    icone: ListOrdered,
    tipoGrafico: "barras",
    telas: ["tfd_exames", "tfd_medico", "tfd"],
  },
  {
    id: "tempo-fila-indicadores",
    titulo: "Tempo Médio de Espera",
    desc: "Dias médios de espera e fluxo de procedimentos.",
    icone: Clock,
    tipoGrafico: "kpi",
    telas: ["dash_indicadores", "dashboard", "tfd", "tfd_exames"],
  },
  {
    id: "frota-status",
    titulo: "Status da Frota",
    desc: "Veículos disponíveis, em viagem e manutenção.",
    icone: Car,
    tipoGrafico: "kpi",
    telas: ["tfd_frota", "tfd_frota_gestao", "tfd"],
  },
  {
    id: "viagens-proximas",
    titulo: "Próximas Viagens",
    desc: "Escalas da semana com ocupação e destinos.",
    icone: CalendarDays,
    tipoGrafico: "lista",
    telas: ["tfd_viagens", "tfd_frota_gestao", "tfd"],
  },
  {
    id: "faturamento-resumo",
    titulo: "Faturamento e Diárias",
    desc: "Faturas, diárias e valores da competência.",
    icone: ReceiptText,
    tipoGrafico: "kpi",
    telas: ["tfd_faturamento", "tfd"],
  },
  {
    id: "agenda-semana",
    titulo: "Agenda da semana",
    desc: "Vagas livres nos próximos 7 dias (laboratório).",
    icone: CalendarDays,
    tipoGrafico: "calendario",
    telas: ["lab_agenda", "lab_vagas", "lab"],
  },
  {
    id: "painel-aps",
    titulo: "APS · Previne Brasil",
    desc: "Indicadores atingidos e metas no período.",
    icone: Activity,
    tipoGrafico: "progresso",
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

export function WidgetPorId({ id }: { id: string }) {
  if (id === "resumo-tfd") return <WidgetResumoTfd />;
  if (id === "fila-prioridades") return <WidgetFilaPrioridades />;
  if (id === "fila-especialidade") return <WidgetFilaEspecialidade />;
  if (id === "tempo-fila-indicadores") return <WidgetTempoFilaIndicadores />;
  if (id === "frota-status") return <WidgetFrotaStatus />;
  if (id === "viagens-proximas") return <WidgetViagensProximas />;
  if (id === "faturamento-resumo") return <WidgetFaturamentoResumo />;
  if (id === "agenda-semana") return <WidgetAgendaSemana />;
  if (id === "painel-aps") return <WidgetPainelAps />;
  return <p className="text-xs text-ink/45">Widget removido do catálogo.</p>;
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
