import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  ChartColumn,
  Download,
  GitCompareArrows,
  ListOrdered,
  Minus,
  Syringe,
  Timer,
  TriangleAlert,
} from "lucide-react";
import { Badge, Button, Card, Label } from "../components/ui/primitives";
import MonthPicker from "../components/MonthPicker";
import { cn } from "../components/ui/primitives";
import {
  indAgenda,
  indEvolucao,
  indProcEvolucao,
  indProcTop,
  indResumo,
  indVolume,
  type AgendaResp,
  type EvolucaoResp,
  type ProcEvolResp,
  type ProcTopResp,
  type ResumoInd,
  type VolumeResp,
} from "../services/indicadores";
import { tfdCatalogoExames, tfdFiltrosOpcoes, type CatalogoProc } from "../services/api";
import { Combobox, type ComboOption } from "../components/ui/combobox";
import { fonteBadge } from "../services/pec";

function hojeISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function menosDias(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function mesParaIntervalo(month: string): { de: string; ate: string } {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) {
    const h = hojeISO().slice(0, 7);
    return mesParaIntervalo(h);
  }
  const ultimo = new Date(y, m, 0).getDate();
  const mm = String(m).padStart(2, "0");
  return { de: `${y}-${mm}-01`, ate: `${y}-${mm}-${String(ultimo).padStart(2, "0")}` };
}
function diaLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}

const CORES = ["#0A3D62", "#00A896", "#136294", "#E9B44C", "#7A9E9F", "#4F6D7A", "#C1666B", "#5C8001"];

const PRESETS = [
  { id: "30", label: "Último mês" },
  { id: "90", label: "Últimos 3 meses" },
  { id: "180", label: "Últimos 6 meses" },
  { id: "ano", label: "Ano atual" },
];

export default function Indicadores() {
  const [preset, setPreset] = useState("180");
  const [de, setDe] = useState(() => menosDias(180));
  const [ate, setAte] = useState(() => hojeISO());
  const [gran, setGran] = useState("mes");
  const [tipoFila, setTipoFila] = useState("");
  const [tipos, setTipos] = useState<{ value: string; label: string; total: number }[]>([]);
  const [resumo, setResumo] = useState<ResumoInd | null>(null);
  const [evol, setEvol] = useState<EvolucaoResp | null>(null);
  const [vol, setVol] = useState<VolumeResp | null>(null);
  const [procTop, setProcTop] = useState<ProcTopResp | null>(null);
  const [procEvol, setProcEvol] = useState<ProcEvolResp | null>(null);
  const [procSel, setProcSel] = useState<string[]>([]);
  const [catalogo, setCatalogo] = useState<CatalogoProc[]>([]);
  const [viaApi, setViaApi] = useState(true);
  const [fonte, setFonte] = useState("api");
  const [erro, setErro] = useState("");
  const [loading, setLoading] = useState(false);

  // Agenda integrada (mês + laboratório)
  const [month, setMonth] = useState(() => hojeISO().slice(0, 7));
  const [labId, setLabId] = useState<number | "">("");
  const [agenda, setAgenda] = useState<AgendaResp | null>(null);
  const [diaSel, setDiaSel] = useState(() => hojeISO());

  function aplicarPreset(id: string) {
    setPreset(id);
    const hoje = hojeISO();
    if (id === "30") {
      setDe(menosDias(30));
      setAte(hoje);
    } else if (id === "90") {
      setDe(menosDias(90));
      setAte(hoje);
    } else if (id === "180") {
      setDe(menosDias(180));
      setAte(hoje);
    } else if (id === "ano") {
      setDe(`${hoje.slice(0, 4)}-01-01`);
      setAte(hoje);
    }
  }

  async function carregar() {
    setErro("");
    setLoading(true);
    try {
      const [r, e, v, pt] = await Promise.all([
        indResumo(de, ate),
        indEvolucao(de, ate, gran, tipoFila),
        indVolume(de, ate),
        indProcTop(de, ate, 8),
      ]);
      setResumo(r.dados);
      setEvol(e.dados);
      setVol(v.dados);
      setProcTop(pt.dados);
      const ok = r.viaApi && e.viaApi && v.viaApi;
      setViaApi(ok);
      setFonte(ok ? "api" : "mock");
      try {
        const ops = await tfdFiltrosOpcoes("aguardando");
        setTipos(ops.tipos ?? []);
      } catch {
        /* mantém vazio */
      }
      try {
        const cat = await tfdCatalogoExames("", "");
        setCatalogo(cat ?? []);
      } catch {
        /* catálogo opcional */
      }
      await carregarProcEvol(procSel);
    } catch {
      setErro("Sessão expirada. Faça login.");
    } finally {
      setLoading(false);
    }
  }

  async function carregarProcEvol(sel: string[]) {
    try {
      const r = await indProcEvolucao(de, ate, gran, sel.join(","), 4);
      setProcEvol(r.dados);
      // seleção vazia -> backend devolve top automático; espelha nos chips
      if (sel.length === 0 && r.dados.series.length) setProcSel(r.dados.series.slice(0, 4));
    } catch {
      /* mantém série anterior */
    }
  }

  async function carregarAgenda() {
    try {
      const { de: d, ate: a } = mesParaIntervalo(month);
      const r = await indAgenda(d, a, labId === "" ? undefined : Number(labId));
      setAgenda(r.dados);
      if (!r.dados.dias.some((x: AgendaResp["dias"][number]) => x.data === diaSel)) setDiaSel(d);
    } catch {
      /* mantém agenda anterior */
    }
  }

  useEffect(() => {
    carregar().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    carregarAgenda().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, labId]);

  const pontos = evol?.pontos ?? [];
  const itensVol = useMemo(() => (vol?.itens ?? []).slice(0, 10), [vol]);
  const procPontos = useMemo(() => procEvol?.pontos ?? [], [procEvol]);
  const procSeries = useMemo(() => procEvol?.series ?? procSel, [procEvol, procSel]);
  const opcoesProc: ComboOption[] = useMemo(() => {
    const base: ComboOption[] = (procTop?.itens ?? []).map((p) => ({
      value: p.procedimento,
      label: `${p.procedimento} (${p.total_fila})`,
      sub: p.codigo ? `SIGTAP ${p.codigo}` : undefined,
      keywords: p.codigo,
    }));
    for (const c of catalogo) {
      const nome = (c.nome_procedimento || c.exame || "").trim().toUpperCase();
      if (!nome || base.some((b) => b.value === nome)) continue;
      base.push({
        value: nome,
        label: nome,
        sub: c.codigo_procedimento ? `SIGTAP ${c.codigo_procedimento}` : c.tipo_fila || undefined,
        keywords: `${c.codigo_procedimento ?? ""} ${c.codigo_curto ?? ""}`,
      });
      if (base.length >= 60) break;
    }
    return base;
  }, [procTop, catalogo]);

  function toggleProc(v: string) {
    if (!v) return;
    const next = procSel.includes(v) ? procSel.filter((s) => s !== v) : [...procSel, v].slice(-4);
    setProcSel(next);
    carregarProcEvol(next).catch(() => {});
  }
  const diaInfo = useMemo(
    () => agenda?.dias.find((d: AgendaResp["dias"][number]) => d.data === diaSel) ?? null,
    [agenda, diaSel]
  );

  // Grade mensal agenda (Dom–Sáb, padrão GradeDias)
  const grade = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    if (!y || !m) return { cells: [] as (string | null)[], mapa: new Map() };
    const desloc = new Date(y, m - 1, 1).getDay();
    const n = new Date(y, m, 0).getDate();
    const cells: (string | null)[] = [
      ...Array<string | null>(desloc).fill(null),
      ...Array.from({ length: n }, (_, i) => `${y}-${String(m).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`),
    ];
    const mapa = new Map((agenda?.dias ?? []).map((d: AgendaResp["dias"][number]) => [d.data, d]));
    return { cells, mapa };
  }, [month, agenda]);

  function baixarCSV() {
    const linhas = ["periodo;novos;realizados;agendados;urgentes"];
    for (const p of pontos) linhas.push(`${p.label};${p.total};${p.realizados};${p.agendados};${p.urgentes}`);
    linhas.push("");
    linhas.push("tipo_fila;total;perc;urgentes;agendados;aguardando");
    for (const g of vol?.itens ?? []) linhas.push(`${g.tipo};${g.total};${g.perc};${g.urgentes};${g.agendados};${g.aguardando}`);
    linhas.push("");
    linhas.push("procedimento;codigo;em_fila;aguardando;agendados;urgentes;novos;realizados;variacao_pct;tendencia");
    for (const p of procTop?.itens ?? [])
      linhas.push(`${p.procedimento};${p.codigo};${p.total_fila};${p.aguardando};${p.agendados};${p.urgentes};${p.novos_periodo};${p.realizados_periodo};${p.variacao_pct};${p.tendencia}`);
    linhas.push("");
    linhas.push(["periodo", ...(procEvol?.series ?? [])].join(";"));
    for (const r of procEvol?.pontos ?? []) {
      const row = r as Record<string, string | number>;
      linhas.push([String(row.label ?? row.periodo ?? ""), ...((procEvol?.series ?? []).map((s) => String(row[s] ?? 0)))].join(";"));
    }
    const blob = new Blob([linhas.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `indicadores-filas-${de}_a_${ate}.csv`;
    a.click();
  }

  const kpis = [
    { titulo: "Em fila agora", valor: String(resumo?.em_fila ?? "—"), desc: "aguardando + agendado", Icon: ListOrdered },
    { titulo: "Urgentes", valor: String(resumo?.urgentes ?? "—"), desc: "prioridade urgente em fila", Icon: TriangleAlert },
    { titulo: "Novos no período", valor: String(resumo?.novos_periodo ?? "—"), desc: `${diaLabel(de)} – ${diaLabel(ate)}`, Icon: Syringe },
    { titulo: "Espera média", valor: resumo ? `${resumo.tempo_medio_espera_dias}d` : "—", desc: "pedido → realização", Icon: Timer },
  ];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold text-sus-950">
          <ChartColumn className="h-5 w-5" /> Indicadores e Agenda
        </h2>
        <span className="ml-auto">
          <Badge>{fonteBadge(fonte, viaApi)}</Badge>
        </span>
      </div>
      {erro && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}

      {/* KPIs */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k, i) => (
          <Card key={k.titulo} className={`rise rise-${i + 1} p-4`}>
            <div className="mb-2 grid h-10 w-10 place-items-center rounded-2xl bg-sus-900 text-white">
              <k.Icon className="h-5 w-5" />
            </div>
            <p className="font-display text-2xl font-extrabold text-sus-950">{k.valor}</p>
            <p className="font-display text-sm font-bold text-sus-950">{k.titulo}</p>
            <p className="text-xs text-ink/55">{k.desc}</p>
          </Card>
        ))}
      </div>

      {/* Filtros período */}
      <Card className="mb-4 p-4">
        <div className="grid gap-3 md:grid-cols-5">
          <div className="md:col-span-2">
            <Label>Período</Label>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => aplicarPreset(p.id)}
                  className={cn(
                    "rounded-xl px-3 py-2 text-xs font-bold transition",
                    preset === p.id ? "bg-sus-900 text-white" : "bg-sand text-sus-950 hover:bg-sand-dark"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <Label>De</Label>
                <input
                  type="date"
                  value={de}
                  onChange={(e) => {
                    setDe(e.target.value);
                    setPreset("custom");
                  }}
                  className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm"
                />
              </div>
              <div>
                <Label>Até</Label>
                <input
                  type="date"
                  value={ate}
                  onChange={(e) => {
                    setAte(e.target.value);
                    setPreset("custom");
                  }}
                  className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm"
                />
              </div>
            </div>
          </div>
          <div>
            <Label>Granularidade</Label>
            <select
              value={gran}
              onChange={(e) => setGran(e.target.value)}
              className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm"
            >
              <option value="mes">Mensal</option>
              <option value="semana">Semanal</option>
            </select>
            <div className="mt-3">
              <Label>Tipo de fila</Label>
              <select
                value={tipoFila}
                onChange={(e) => setTipoFila(e.target.value)}
                className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm"
              >
                <option value="">Todas</option>
                {tipos.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-end gap-2 md:col-span-2">
            <Button onClick={carregar} disabled={loading}>
              {loading ? "Carregando…" : "Filtrar"}
            </Button>
            <Button onClick={baixarCSV} className="!bg-teal !text-sus-950">
              <Download className="h-4 w-4" /> CSV
            </Button>
          </div>
        </div>
      </Card>

      {/* Evolução histórica */}
      <Card className="mb-4 p-4">
        <p className="font-display text-sm font-bold text-sus-950">Evolução histórica da fila</p>
        <p className="text-xs text-ink/55">
          Novos pedidos por {gran === "mes" ? "mês" : "semana"} · realizados e agendados no período
          {tipoFila ? ` · filtro: ${tipoFila}` : ""}
        </p>
        {pontos.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink/45">Sem dados no período.</p>
        ) : (
          <div className="mt-3 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={pontos} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#0A3D6222" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="total" name="Novos" stroke="#0A3D62" strokeWidth={2.5} dot={false} />
                <Line type="monotone" dataKey="realizados" name="Realizados" stroke="#00A896" strokeWidth={2.5} dot={false} />
                <Line type="monotone" dataKey="agendados" name="Agendados" stroke="#E9B44C" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="urgentes" name="Urgentes" stroke="#C1666B" strokeWidth={2} strokeDasharray="5 4" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {/* Volume por tipo */}
      <div className="mb-4 grid gap-3 lg:grid-cols-2">
        <Card className="p-4">
          <p className="font-display text-sm font-bold text-sus-950">Volume por tipo de fila</p>
          <p className="text-xs text-ink/55">Comparativo atual · total {vol?.total ?? 0} em fila</p>
          {itensVol.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink/45">Sem dados no período.</p>
          ) : (
            <div className="mt-3 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={itensVol} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#0A3D6222" />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="tipo" width={130} tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="aguardando" name="Aguardando" stackId="a" fill="#0A3D62" />
                  <Bar dataKey="agendados" name="Agendados" stackId="a" fill="#00A896" />
                  <Bar dataKey="urgentes" name="Urgentes" fill="#C1666B" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
        <Card className="p-4">
          <p className="font-display text-sm font-bold text-sus-950">Distribuição (%)</p>
          <p className="text-xs text-ink/55">Fatia de cada tipo na fila atual</p>
          {itensVol.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink/45">Sem dados no período.</p>
          ) : (
            <div className="mt-3 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={itensVol} dataKey="total" nameKey="tipo" outerRadius={95} label={{ fontSize: 10 }}>
                    {itensVol.map((_: VolumeResp["itens"][number], i: number) => (
                      <Cell key={i} fill={CORES[i % CORES.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      {/* Procedimentos: variação + comparativo */}
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="flex items-center gap-2 font-display text-sm font-bold text-sus-950">
            <GitCompareArrows className="h-4 w-4" /> Por procedimento — tamanho e tendência
          </p>
          <span className="ml-auto text-xs text-ink/55">
            {procTop?.total ?? 0} procedimentos · 1ª metade × 2ª metade do período
          </span>
        </div>
        {(procTop?.itens ?? []).length === 0 ? (
          <p className="py-8 text-center text-sm text-ink/45">Sem dados no período.</p>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(procTop?.itens ?? []).map((p, i) => {
              const up = p.tendencia === "alta";
              const down = p.tendencia === "queda";
              const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
              const cls = up
                ? "bg-red-100 text-red-700"
                : down
                  ? "bg-teal/15 text-teal"
                  : "bg-sand text-sus-950/60";
              return (
                <div key={p.procedimento} className={`rise rise-${(i % 4) + 1} rounded-2xl border border-sus-900/10 bg-white p-3`}>
                  <p className="truncate font-display text-xs font-bold text-sus-950" title={p.procedimento}>
                    {p.procedimento}
                  </p>
                  {p.codigo && <p className="text-[11px] text-ink/45">SIGTAP {p.codigo}</p>}
                  <div className="mt-1 flex items-end justify-between gap-2">
                    <p className="font-display text-xl font-extrabold text-sus-950">{p.total_fila}</p>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${cls}`}>
                      <Icon className="h-3 w-3" />
                      {p.variacao_pct > 0 ? "+" : ""}{p.variacao_pct}%
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-ink/55">
                    {p.aguardando} aguard · {p.agendados} agend
                    {p.urgentes > 0 ? ` · ${p.urgentes} urg` : ""} · {p.novos_periodo} novos
                  </p>
                  <button
                    type="button"
                    onClick={() => toggleProc(p.procedimento)}
                    className={cn(
                      "mt-2 w-full rounded-xl px-2 py-1.5 text-[11px] font-bold transition",
                      procSel.includes(p.procedimento)
                        ? "bg-sus-900 text-white"
                        : "bg-sand text-sus-950 hover:bg-sand-dark"
                    )}
                  >
                    {procSel.includes(p.procedimento) ? "No comparativo ✓" : "+ Comparar"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-4 border-t border-sus-900/10 pt-3">
          <p className="font-display text-sm font-bold text-sus-950">Série comparativa por exame</p>
          <p className="text-xs text-ink/55">
            Novos pedidos por {gran === "mes" ? "mês" : "semana"} · até 4 exames · exames mais solicitados como padrão
          </p>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <div>
              <Label>Adicionar exame ao comparativo</Label>
              <Combobox
                value=""
                onChange={toggleProc}
                options={opcoesProc.filter((o) => !procSel.includes(o.value))}
                placeholder="Buscar Mamografia, Tomografia, USG…"
                emptyText="Nenhum procedimento encontrado"
              />
            </div>
            <div className="flex flex-wrap items-end gap-1.5">
              {procSel.length === 0 && (
                <span className="text-xs text-ink/45">Nenhum exame fixado — exibindo top automático.</span>
              )}
              {procSel.map((s, i) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleProc(s)}
                  title="Remover do comparativo"
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold text-white"
                  style={{ background: CORES[i % CORES.length] }}
                >
                  {s.length > 28 ? `${s.slice(0, 28)}…` : s} ✕
                </button>
              ))}
              {procSel.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setProcSel([]);
                    carregarProcEvol([]).catch(() => {});
                  }}
                  className="rounded-full bg-sand px-2.5 py-1 text-[11px] font-bold text-sus-950 hover:bg-sand-dark"
                >
                  Limpar
                </button>
              )}
            </div>
          </div>
          {procPontos.length === 0 || procSeries.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink/45">Sem dados no período.</p>
          ) : (
            <div className="mt-3 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={procPontos} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#0A3D6222" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {procSeries.slice(0, 4).map((s, i) => (
                    <Line
                      key={s}
                      type="monotone"
                      dataKey={s}
                      name={s.length > 30 ? `${s.slice(0, 30)}…` : s}
                      stroke={CORES[i % CORES.length]}
                      strokeWidth={2.5}
                      dot={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </Card>

      {/* Agenda integrada */}
      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <p className="flex items-center gap-2 font-display text-sm font-bold text-sus-950">
            <CalendarDays className="h-4 w-4" /> Agenda — confirmados e realizados
          </p>
          <span className="ml-auto flex items-center gap-2 text-xs text-ink/60">
            <b className="text-teal">{agenda?.tot_confirmados ?? 0}</b> confirmados ·{" "}
            <b className="text-sus-900">{agenda?.tot_realizados ?? 0}</b> realizados ·{" "}
            <b>{agenda?.tot_cancelados ?? 0}</b> cancelados
          </span>
        </div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-[260px] flex-1">
            <MonthPicker value={month} onChange={setMonth} />
          </div>
          <div className="flex items-center gap-2">
            <Label className="mb-0 whitespace-nowrap">Laboratório</Label>
            <select
              value={labId}
              onChange={(e) => setLabId(e.target.value === "" ? "" : Number(e.target.value))}
              className="w-auto min-w-[200px] rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm"
            >
              <option value="">Todos</option>
              {(agenda?.laboratorios ?? []).map((l: AgendaResp["laboratorios"][number]) => (
                <option key={l.id} value={l.id}>
                  {l.nome}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid gap-3 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <div className="mb-1.5 grid grid-cols-7 gap-1.5">
              {["dom", "seg", "ter", "qua", "qui", "sex", "sáb"].map((s) => (
                <p key={s} className="py-1 text-center font-display text-[11px] font-bold uppercase tracking-wide text-sus-900/60">
                  {s}
                </p>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {grade.cells.map((d, i) => {
                if (!d) return <span key={`v-${i}`} />;
                const g = grade.mapa.get(d);
                const tot = g?.total ?? 0;
                const ativa = diaSel === d;
                const ehHoje = d === hojeISO();
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDiaSel(d)}
                    title={tot ? `${tot} na agenda · ${g?.confirmados ?? 0} conf · ${g?.realizados ?? 0} real` : "Sem agendamentos"}
                    className={cn(
                      "min-h-[64px] rounded-xl border bg-white p-1.5 text-left font-body transition active:scale-[.98]",
                      ativa ? "border-sus-900 bg-sus-900 text-white shadow-card" : "text-sus-950 hover:border-teal/50",
                      !ativa && ehHoje && "ring-2 ring-teal ring-offset-1",
                      !ativa && tot === 0 && "border-sus-900/10",
                      !ativa && tot > 0 && "border-teal/30 bg-teal/10"
                    )}
                  >
                    <span className="flex items-center justify-between">
                      <span className={cn("font-display text-xs font-bold", ativa ? "text-white" : "text-sus-950")}>
                        {d.slice(8)}
                      </span>
                      {!ativa && ehHoje && (
                        <span className="rounded-full bg-teal px-1.5 py-px text-[9px] font-bold uppercase text-white">hoje</span>
                      )}
                    </span>
                    {tot === 0 ? (
                      <span className={cn("mt-1 block text-[10px]", ativa ? "text-white/80" : "text-sus-950/40")}>livre</span>
                    ) : (
                      <span className="mt-1 block">
                        <span className={cn("block text-[10px] font-bold", ativa ? "text-white" : "text-sus-950")}>
                          {tot} agenda
                        </span>
                        <span className={cn("block text-[10px]", ativa ? "text-white/75" : "text-sus-950/55")}>
                          {g?.confirmados ?? 0} conf · {g?.realizados ?? 0} real
                        </span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="lg:col-span-2">
            <p className="font-display text-sm font-bold text-sus-950">
              {diaLabel(diaSel)} · {diaInfo?.total ?? 0} na agenda
            </p>
            <div className="mt-2 max-h-80 space-y-1.5 overflow-y-auto">
              {(diaInfo?.itens ?? []).length === 0 && (
                <p className="rounded-xl bg-sand/60 px-3 py-4 text-center text-xs text-ink/50">
                  Nenhum agendamento confirmado/realizado neste dia.
                </p>
              )}
              {(diaInfo?.itens ?? []).map((it: AgendaResp["dias"][number]["itens"][number]) => (
                <div key={`${it.origem}-${it.id}`} className="rounded-xl border border-sus-900/10 bg-white px-3 py-2">
                  <p className="truncate text-xs font-bold text-sus-950">{it.titulo}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink/55">
                    <Badge variant={it.status === "realizado" ? "success" : "default"}>{it.status}</Badge>
                    <span className="truncate">
                      {it.origem === "lab" ? "Lab" : "TFD"}
                      {it.local ? ` · ${it.local}` : ""}
                    </span>
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
