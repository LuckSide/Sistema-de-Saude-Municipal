import {
  Activity,
  AlertTriangle,
  Ambulance,
  ArrowUpRight,
  BarChart3,
  BookOpenText,
  Building2,
  CalendarDays,
  Car,
  ChartColumn,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Coins,
  Database,
  Eye,
  FlaskConical,
  History,
  LayoutDashboard,
  LayoutGrid,
  ListOrdered,
  MapPin,
  Pencil,
  Plus,
  ReceiptText,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Truck,
  UserCheck,
  Users,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { Card } from "../components/ui/primitives";
import UpdateBanner, { VersaoRodape } from "../components/UpdateBanner";
import { fetchDashboard, saveDashboard, updateStatus, type DashboardItem, type UpdateStatus } from "../services/api";
import { MODULOS, type NoPermissao } from "../permissoes";
import { WIDGETS, WidgetMiniPreview, WidgetPorId } from "../widgets";

const CARDS_PADRAO = [
  { refs: ["dash_indicadores"], titulo: "Indicadores e Agenda", desc: "Evolução das filas e volume.", icon: ChartColumn, to: "/indicadores" },
  { refs: ["tfd"], titulo: "TFD · Operações", desc: "Viagens, pacientes e frota.", icon: Ambulance, to: "/tfd" },
  { refs: ["tfd_exames"], titulo: "Fila de Espera", desc: "Regulação e procedimentos.", icon: ListOrdered, to: "/fila-exames" },
  { refs: ["lab"], titulo: "Exames / BPA", desc: "Solicitações e vagas.", icon: FlaskConical, to: "/lab" },
  { refs: ["aps"], titulo: "APS · Previne Brasil", desc: "Indicadores de repasse.", icon: Activity, to: "/aps" },
  { refs: ["usuarios"], titulo: "Contas e Acessos", desc: "Gestão de usuários.", icon: Users, to: "/usuarios" },
  { refs: ["usuarios", "integracoes"], seed: "integracoes", titulo: "Configurações", desc: "Parâmetros do município.", icon: Settings2, to: "/configuracoes" },
];

const WIDE_WIDGETS = new Set(["agenda-semana", "tempo-fila-indicadores"]);

const ATALHOS_EXTRAS: Record<string, { rotulo: string; icone: LucideIcon; rota: string }> = {
  auditoria: { rotulo: "Auditoria / Logs", icone: History, rota: "/auditoria" },
  cfg_backup: { rotulo: "Backup do Sistema", icone: Database, rota: "/configuracoes?aba=backup" },
  cfg_geral: { rotulo: "Configurações Gerais", icone: Settings2, rota: "/configuracoes?aba=geral" },
  tfd_quadro: { rotulo: "Viagens e Escalas", icone: CalendarDays, rota: "/tfd/quadro" },
};

function buscarNo(ref: string): NoPermissao | null {
  if (ATALHOS_EXTRAS[ref]) {
    const extra = ATALHOS_EXTRAS[ref];
    return { codigo: ref, rotulo: extra.rotulo, icone: extra.icone, rota: extra.rota };
  }
  for (const m of MODULOS) {
    if (m.codigo === ref) return m;
    for (const f of m.filhos ?? []) if (f.codigo === ref) return f;
  }
  return null;
}

function uid(ref: string) {
  return `${ref}-${Date.now().toString(36)}${Math.floor(Math.random() * 999)}`;
}

export default function Dashboard() {
  const { user, can } = useAuth();
  const [versao, setVersao] = useState<UpdateStatus | null>(null);
  const [items, setItems] = useState<DashboardItem[] | null>(null);
  const [salvos, setSalvos] = useState<DashboardItem[]>([]);
  const [editando, setEditando] = useState(false);
  const [galeria, setGaleria] = useState<null | "atalho" | "widget">(null);
  const [buscaGaleria, setBuscaGaleria] = useState("");
  const [previewWidgetId, setPreviewWidgetId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"ok" | "salvando" | "erro">("ok");
  const timer = useRef<number | null>(null);
  const saveSeq = useRef(0);
  const [saindo, setSaindo] = useState(false);

  useEffect(() => {
    if (!user?.is_superuser) return;
    updateStatus(false).then(setVersao).catch(() => {});
  }, [user?.is_superuser]);

  useEffect(() => {
    if (!user) return;
    fetchDashboard()
      .then((it) => {
        setItems(it);
        setSalvos(it);
      })
      .catch(() => {
        setItems([]);
        setSalvos([]);
      });
  }, [user?.id]);

  const custom = (items ?? []).length > 0;

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  function salvarAgora(novos: DashboardItem[]) {
    const seq = ++saveSeq.current;
    setSaveState("salvando");
    return saveDashboard(novos)
      .then((r) => {
        if (seq !== saveSeq.current) return r;
        setSalvos(r);
        setSaveState("ok");
        return r;
      })
      .catch(() => {
        if (seq !== saveSeq.current) return novos;
        setSaveState("erro");
        throw new Error("falha ao salvar dashboard");
      });
  }

  function agendarSave(novos: DashboardItem[]) {
    setSaveState("salvando");
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      salvarAgora(novos).catch(() => {});
    }, 600);
  }

  function alterar(novos: DashboardItem[]) {
    setItems(novos);
    agendarSave(novos);
  }

  function mover(id: string, dir: -1 | 1) {
    const arr = [...(items ?? [])];
    const i = arr.findIndex((x) => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    alterar(arr);
  }

  function remover(id: string) {
    alterar((items ?? []).filter((x) => x.id !== id));
  }

  function adicionar(tipo: "atalho" | "widget", ref: string) {
    alterar([...(items ?? []), { id: uid(ref), tipo, ref }]);
    setGaleria(null);
    setPreviewWidgetId(null);
  }

  function usarPadraoComoBase() {
    const base: DashboardItem[] = [];
    for (const c of CARDS_PADRAO) {
      if (!c.refs.some((t) => can(t))) continue;
      const ref = (c as { seed?: string }).seed ?? c.refs[0];
      if (!can(ref)) continue;
      base.push({ id: uid(ref), tipo: "atalho", ref });
    }
    // Adiciona widget inicial de resumo se permitido
    if (can("tfd_resumo") || can("tfd")) {
      base.push({ id: uid("resumo-tfd"), tipo: "widget", ref: "resumo-tfd" });
    }
    alterar(base);
  }

  function restaurar() {
    if (!confirm("Restaurar o painel padrão automático? Sua personalização atual será substituída.")) return;
    saveSeq.current++;
    if (timer.current) window.clearTimeout(timer.current);
    setSaveState("salvando");
    saveDashboard([])
      .then((r) => {
        setItems(r);
        setSalvos(r);
        setSaveState("ok");
      })
      .catch(() => setSaveState("erro"));
  }

  async function sairEdicao() {
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const pendente = JSON.stringify(items ?? []) !== JSON.stringify(salvos);
    if (pendente) {
      setSaindo(true);
      try {
        await salvarAgora(items ?? []);
      } catch {
        setSaindo(false);
        return;
      }
      setSaindo(false);
    }
    setEditando(false);
    setGaleria(null);
    setPreviewWidgetId(null);
  }

  const refsUsados = new Set((items ?? []).map((i) => `${i.tipo}:${i.ref}`));

  // Lista enriquecida de atalhos disponíveis
  const listaNosPermitidos = [
    ...MODULOS.flatMap((m) => [m, ...(m.filhos ?? [])]),
    ...Object.entries(ATALHOS_EXTRAS).map(([codigo, val]) => ({
      codigo,
      rotulo: val.rotulo,
      icone: val.icone,
      rota: val.rota,
    })),
  ];

  // Remove duplicatas de código
  const nosUnicos = Array.from(new Map(listaNosPermitidos.map((n) => [n.codigo, n])).values());

  const atalhosGal = nosUnicos.filter(
    (n) => can(n.codigo) && !refsUsados.has(`atalho:${n.codigo}`) &&
      (buscaGaleria === "" ||
        n.rotulo.toLowerCase().includes(buscaGaleria.toLowerCase()) ||
        (n.rota && n.rota.toLowerCase().includes(buscaGaleria.toLowerCase())))
  );

  const widgetsGal = WIDGETS.filter(
    (w) =>
      w.telas.some((t) => can(t)) &&
      !refsUsados.has(`widget:${w.id}`) &&
      (buscaGaleria === "" ||
        w.titulo.toLowerCase().includes(buscaGaleria.toLowerCase()) ||
        w.desc.toLowerCase().includes(buscaGaleria.toLowerCase()))
  );

  if (items === null) {
    return (
      <div>
        {user?.is_superuser && <UpdateBanner />}
        <p className="mt-8 text-sm text-ink/50">Carregando painel personalizado…</p>
      </div>
    );
  }

  const atalhos = (items ?? []).filter((i) => i.tipo === "atalho");
  const widgets = (items ?? []).filter((i) => i.tipo === "widget");

  return (
    <div>
      {user?.is_superuser && <UpdateBanner />}

      {/* Topo do Painel com Saudação e Controles */}
      <div className="rise mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-sus-700">
            Secretaria de Saúde · Guapé-MG
          </p>
          <h1 className="mt-1 font-display text-2xl md:text-3xl font-extrabold text-sus-950">
            Olá, {(user?.nome || user?.username)?.split(" ")[0]}
          </h1>
          <p className="mt-1 text-xs md:text-sm text-ink/55">
            Perfil: <b className="text-sus-950">{user?.is_superuser ? "Superusuário" : user?.area || "Operador"}</b>
            {saveState === "salvando" && <span className="ml-2 font-medium text-teal">Salvando alterações…</span>}
            {saveState === "erro" && <span className="ml-2 font-bold text-red-600">Falha ao salvar — tente de novo</span>}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {editando && (
            <>
              <button
                onClick={() => {
                  setBuscaGaleria("");
                  setGaleria("atalho");
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-teal/40 bg-teal/10 px-3 py-2 text-xs font-bold text-teal transition hover:bg-teal hover:text-white"
              >
                <Plus className="h-3.5 w-3.5" /> Adicionar Atalho
              </button>
              <button
                onClick={() => {
                  setBuscaGaleria("");
                  setGaleria("widget");
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-sus-900/15 bg-white px-3 py-2 text-xs font-bold text-sus-900 shadow-sm transition hover:bg-sand"
              >
                <BarChart3 className="h-3.5 w-3.5" /> Adicionar Gráfico
              </button>
              {custom && (
                <button
                  onClick={restaurar}
                  title="Restaurar sugestão inicial automática do perfil"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-sus-900/15 px-3 py-2 text-xs font-bold text-sus-900 hover:bg-sand"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Padrão
                </button>
              )}
            </>
          )}

          <button
            onClick={() => (editando ? sairEdicao() : setEditando(true))}
            disabled={saindo}
            className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition shadow-sm disabled:opacity-60 ${
              editando ? "bg-teal text-sus-950 font-extrabold" : "bg-sus-900 text-white hover:bg-sus-800"
            }`}
          >
            {editando ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5" /> {saindo ? "Salvando…" : "Concluir Edição"}
              </>
            ) : (
              <>
                <Pencil className="h-3.5 w-3.5" /> Personalizar Painel
              </>
            )}
          </button>
        </div>
      </div>

      {/* Exibição Padrão caso não haja itens configurados */}
      {!custom && !editando && (
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
          {CARDS_PADRAO.filter((c) => c.refs.some((t) => can(t))).map((c, i) => (
            <Link key={c.to} to={c.to}>
              <Card className={`rise rise-${i + 1} group p-4 transition hover:-translate-y-0.5 hover:shadow-card`}>
                <div className="mb-2.5 grid h-10 w-10 place-items-center rounded-xl bg-sus-900 text-white transition group-hover:bg-teal group-hover:text-sus-950">
                  <c.icon className="h-5 w-5" />
                </div>
                <p className="font-display text-sm font-bold text-sus-950">{c.titulo}</p>
                <p className="mt-0.5 text-xs text-ink/55">{c.desc}</p>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {/* SEÇÃO 1: ATALHOS RÁPIDOS COMPACTOS */}
      {(custom || editando) && atalhos.length > 0 && (
        <div className="mb-7">
          <div className="mb-2.5 flex items-center justify-between">
            <span className="flex items-center gap-1.5 font-display text-xs font-bold uppercase tracking-wider text-sus-900">
              <Sparkles className="h-3.5 w-3.5 text-teal" /> Atalhos Rápidos ({atalhos.length})
            </span>
            {editando && (
              <span className="text-[11px] text-ink/45">
                Organize ou remova os atalhos rápidos conforme sua rotina
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {atalhos.map((it) => {
              const no = buscarNo(it.ref);
              if (!no || !can(no.codigo)) return null;
              const Icone = no.icone;

              return (
                <div key={it.id} className="relative group">
                  <Controles
                    editando={editando}
                    onRemover={() => remover(it.id)}
                    onMover={(d) => mover(it.id, d)}
                  />
                  <Link
                    to={editando ? "#" : (no.rota ?? "/")}
                    onClick={(e) => {
                      if (editando) e.preventDefault();
                    }}
                    title={no.rotulo}
                    className="flex min-h-[54px] items-center gap-2.5 rounded-xl border border-sus-900/10 bg-white p-2.5 shadow-sm transition hover:-translate-y-0.5 hover:border-teal/40 hover:shadow-md"
                  >
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-teal/15 text-teal transition group-hover:bg-teal group-hover:text-sus-950">
                      <Icone className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-bold text-sus-950 group-hover:text-teal">
                        {no.rotulo}
                      </p>
                      {no.rota && (
                        <p className="truncate font-mono text-[10px] text-ink/40">
                          {no.rota}
                        </p>
                      )}
                    </div>
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SEÇÃO 2: GRÁFICOS E PAINÉIS DE INDICADORES */}
      {(custom || editando) && (
        <div>
          <div className="mb-2.5 flex items-center justify-between">
            <span className="flex items-center gap-1.5 font-display text-xs font-bold uppercase tracking-wider text-sus-900">
              <BarChart3 className="h-3.5 w-3.5 text-teal" /> Gráficos e Métricas ({widgets.length})
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {widgets.map((it) => {
              const w = WIDGETS.find((x) => x.id === it.ref);
              if (!w || !w.telas.some((t) => can(t))) return null;
              const Icone = w.icone;
              const isWide = WIDE_WIDGETS.has(w.id);

              return (
                <Card
                  key={it.id}
                  className={`relative p-4 transition-all ${
                    isWide ? "sm:col-span-2" : ""
                  }`}
                >
                  <Controles
                    editando={editando}
                    onRemover={() => remover(it.id)}
                    onMover={(d) => mover(it.id, d)}
                  />
                  <div className="mb-3 flex items-center gap-2.5 border-b border-sus-900/5 pb-2.5">
                    <div className="grid h-8 w-8 place-items-center rounded-lg bg-sus-900 text-white">
                      <Icone className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-display text-xs font-bold text-sus-950">
                        {w.titulo}
                      </p>
                      <p className="truncate text-[11px] text-ink/50">{w.desc}</p>
                    </div>
                  </div>
                  <WidgetPorId id={w.id} />
                </Card>
              );
            })}

            {editando && (
              <button
                onClick={() => {
                  setBuscaGaleria("");
                  setGaleria("widget");
                }}
                className="grid min-h-[160px] place-items-center rounded-2xl border-2 border-dashed border-sus-900/20 bg-white/40 p-4 text-xs font-bold text-sus-900 transition hover:border-teal hover:bg-teal/5 hover:text-teal"
              >
                <span className="inline-flex flex-col items-center gap-2">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-sus-900/5">
                    <Plus className="h-5 w-5 text-teal" />
                  </div>
                  Adicionar Gráfico ou Métrica
                </span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Estado vazio em modo de edição */}
      {editando && (items ?? []).length === 0 && (
        <div className="mt-4 rounded-2xl border-2 border-dashed border-sus-900/20 p-8 text-center">
          <p className="font-display text-base font-bold text-sus-950">Seu painel está vazio</p>
          <p className="mt-1 text-xs text-ink/55">
            Comece adicionando atalhos rápidos ou gráficos personalizados para acompanhar sua rotina.
          </p>
          <div className="mt-4 flex justify-center gap-3">
            <button
              onClick={usarPadraoComoBase}
              className="inline-flex items-center gap-1.5 rounded-xl bg-sus-900 px-4 py-2 text-xs font-bold text-white transition hover:bg-sus-800"
            >
              <LayoutGrid className="h-3.5 w-3.5" /> Aplicar Modelo Recomendado
            </button>
            <button
              onClick={() => {
                setBuscaGaleria("");
                setGaleria("atalho");
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-sus-900/20 bg-white px-4 py-2 text-xs font-bold text-sus-900 hover:bg-sand"
            >
              <Plus className="h-3.5 w-3.5 text-teal" /> Escolher Blocos
            </button>
          </div>
        </div>
      )}

      {/* MODAL / GALERIA DE ADIÇÃO COM PRÉ-VISUALIZAÇÃO RICA */}
      {galeria && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-sus-950/60 backdrop-blur-sm p-4"
          onClick={() => {
            setGaleria(null);
            setPreviewWidgetId(null);
          }}
        >
          <div
            className="rise max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header do Modal */}
            <div className="flex items-center justify-between border-b border-sus-900/10 px-6 py-4">
              <div>
                <h3 className="font-display text-lg font-bold text-sus-950">
                  Adicionar ao Painel Principal
                </h3>
                <p className="text-xs text-ink/50">
                  Selecione blocos com pré-visualização em tempo real de layout e métricas.
                </p>
              </div>
              <button
                onClick={() => {
                  setGaleria(null);
                  setPreviewWidgetId(null);
                }}
                className="rounded-lg p-2 text-ink/50 hover:bg-sand"
                aria-label="Fechar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Barra de Filtros e Abas */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sus-900/5 bg-sand/30 px-6 py-3">
              <div className="inline-flex rounded-xl bg-white p-1 shadow-sm border border-sus-900/10">
                <button
                  onClick={() => {
                    setGaleria("atalho");
                    setPreviewWidgetId(null);
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold transition ${
                    galeria === "atalho"
                      ? "bg-sus-900 text-white"
                      : "text-sus-900 hover:bg-sand"
                  }`}
                >
                  <Sparkles className="h-3.5 w-3.5" /> Atalhos Rápidos ({atalhosGal.length})
                </button>
                <button
                  onClick={() => {
                    setGaleria("widget");
                    setPreviewWidgetId(null);
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold transition ${
                    galeria === "widget"
                      ? "bg-sus-900 text-white"
                      : "text-sus-900 hover:bg-sand"
                  }`}
                >
                  <BarChart3 className="h-3.5 w-3.5" /> Gráficos e Painéis ({widgetsGal.length})
                </button>
              </div>

              {/* Campo de Busca */}
              <div className="relative min-w-[220px]">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-ink/40" />
                <input
                  type="text"
                  placeholder="Pesquisar opções…"
                  value={buscaGaleria}
                  onChange={(e) => setBuscaGaleria(e.target.value)}
                  className="w-full rounded-xl border border-sus-900/15 bg-white py-1.5 pl-8 pr-3 text-xs outline-none focus:border-teal"
                />
              </div>
            </div>

            {/* Conteúdo com Pré-visualização */}
            <div className="flex-1 overflow-y-auto p-6">
              {/* TAB ATALHOS */}
              {galeria === "atalho" && (
                <div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {atalhosGal.map((n) => {
                      const Icone = n.icone;
                      return (
                        <div
                          key={n.codigo}
                          className="group relative flex flex-col justify-between rounded-xl border border-sus-900/10 bg-white p-3.5 shadow-sm transition hover:border-teal/50 hover:shadow-md"
                        >
                          <div className="flex items-start gap-3">
                            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-teal/15 text-teal transition group-hover:bg-teal group-hover:text-sus-950">
                              <Icone className="h-4 w-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-bold text-sus-950">
                                {n.rotulo}
                              </p>
                              {n.rota && (
                                <p className="truncate font-mono text-[10px] text-ink/40">
                                  {n.rota}
                                </p>
                              )}
                              <span className="mt-1 inline-block rounded bg-sand px-1.5 py-0.5 text-[9px] font-semibold text-ink/60">
                                Atalho compacto
                              </span>
                            </div>
                          </div>

                          <div className="mt-3 flex items-center justify-between border-t border-sus-900/5 pt-2">
                            <span className="text-[10px] text-ink/40 font-medium">Card de 1 clique</span>
                            <button
                              onClick={() => adicionar("atalho", n.codigo)}
                              className="inline-flex items-center gap-1 rounded-lg bg-sus-900 px-2.5 py-1 text-xs font-bold text-white transition hover:bg-teal hover:text-sus-950"
                            >
                              <Plus className="h-3 w-3" /> Adicionar
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {atalhosGal.length === 0 && (
                    <div className="py-12 text-center">
                      <p className="text-xs font-semibold text-ink/50">
                        Nenhum atalho disponível com os critérios atuais.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* TAB GRÁFICOS COM PRÉ-VISUALIZAÇÃO RICA */}
              {galeria === "widget" && (
                <div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {widgetsGal.map((w) => {
                      const Icone = w.icone;
                      return (
                        <div
                          key={w.id}
                          className="flex flex-col justify-between rounded-2xl border border-sus-900/10 bg-white p-4 shadow-sm transition hover:border-teal/50 hover:shadow-md"
                        >
                          <div>
                            {/* Topo do card com ícone, título e badge de tipo */}
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <div className="flex items-center gap-2.5">
                                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sus-900 text-white">
                                  <Icone className="h-4 w-4" />
                                </div>
                                <div>
                                  <h4 className="font-display text-sm font-bold text-sus-950">
                                    {w.titulo}
                                  </h4>
                                  <p className="text-[11px] text-ink/55">{w.desc}</p>
                                </div>
                              </div>
                              <span className="shrink-0 rounded-md bg-teal/10 px-2 py-0.5 text-[10px] font-bold text-teal uppercase">
                                {w.tipoGrafico}
                              </span>
                            </div>

                            {/* Miniatura de Pré-Visualização Visual Realista */}
                            <div className="my-3">
                              <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-ink/40">
                                Pré-visualização do layout:
                              </p>
                              <WidgetMiniPreview id={w.id} />
                            </div>
                          </div>

                          {/* Rodapé com botão adicionar */}
                          <div className="mt-2 flex items-center justify-between border-t border-sus-900/10 pt-2.5">
                            <span className="text-[11px] text-ink/50">
                              Atualização dinâmica em tempo real
                            </span>
                            <button
                              onClick={() => adicionar("widget", w.id)}
                              className="inline-flex items-center gap-1.5 rounded-xl bg-teal px-3 py-1.5 text-xs font-bold text-sus-950 transition hover:brightness-110 shadow-sm"
                            >
                              <Plus className="h-3.5 w-3.5" /> Adicionar ao Painel
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {widgetsGal.length === 0 && (
                    <div className="py-12 text-center">
                      <p className="text-xs font-semibold text-ink/50">
                        Nenhum gráfico disponível ou todos já foram adicionados.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Rodapé do Modal */}
            <div className="border-t border-sus-900/10 bg-sand/30 px-6 py-3 flex justify-between items-center text-xs text-ink/50">
              <span>Personalize a disposição dos blocos usando as setas no painel principal.</span>
              <button
                onClick={() => {
                  setGaleria(null);
                  setPreviewWidgetId(null);
                }}
                className="font-bold text-sus-900 hover:underline"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {user?.is_superuser && <VersaoRodape st={versao} />}
    </div>
  );
}

function Controles({
  editando,
  onRemover,
  onMover,
}: {
  editando: boolean;
  onRemover: () => void;
  onMover: (d: -1 | 1) => void;
}) {
  if (!editando) return null;
  const btn = "rounded-lg bg-sus-950/75 p-1 text-white transition hover:bg-sus-950";
  return (
    <div className="absolute right-1.5 top-1.5 z-10 flex gap-0.5">
      <button
        onClick={(e) => {
          e.preventDefault();
          onMover(-1);
        }}
        className={btn}
        title="Mover para trás"
        aria-label="Mover para trás"
      >
        <ChevronLeft className="h-3 w-3" />
      </button>
      <button
        onClick={(e) => {
          e.preventDefault();
          onMover(1);
        }}
        className={btn}
        title="Mover para frente"
        aria-label="Mover para frente"
      >
        <ChevronRight className="h-3 w-3" />
      </button>
      <button
        onClick={(e) => {
          e.preventDefault();
          onRemover();
        }}
        className="rounded-lg bg-red-600/90 p-1 text-white transition hover:bg-red-600"
        title="Remover"
        aria-label="Remover"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
