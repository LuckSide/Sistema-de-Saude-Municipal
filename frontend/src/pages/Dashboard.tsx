import {
  Activity,
  Ambulance,
  BarChart3,
  CalendarDays,
  ChartColumn,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Database,
  Filter,
  FlaskConical,
  History,
  LayoutGrid,
  ListOrdered,
  Maximize2,
  Minimize2,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../hooks/useAuth";
import { Card } from "../components/ui/primitives";
import { useConfirm } from "../components/ConfirmDialog";
import UpdateBanner, { VersaoRodape } from "../components/UpdateBanner";
import {
  fetchDashboard,
  saveDashboard,
  updateStatus,
  tfdFiltrosOpcoes,
  type DashboardItem,
  type UpdateStatus,
} from "../services/api";
import { MODULOS, type NoPermissao } from "../permissoes";
import { WIDGETS, WidgetMiniPreview, WidgetPorId } from "../widgets";

const CARDS_PADRAO = [
  { refs: ["dash_indicadores"], titulo: "Indicadores e Agenda", desc: "Evolução das filas e volume.", icon: ChartColumn, to: "/indicadores" },
  { refs: ["tfd_viagens", "tfd"], titulo: "TFD · Viagens", desc: "Viagens, passageiros e rotas.", icon: Ambulance, to: "/tfd/viagens" },
  { refs: ["tfd_exames"], titulo: "Fila de Espera", desc: "Regulação e procedimentos.", icon: ListOrdered, to: "/fila-exames" },
  { refs: ["lab_recepcao", "lab_marcacao", "lab_fila", "lab"], titulo: "Exames laboratoriais", desc: "Marcação de exames de sangue e fila.", icon: FlaskConical, to: "/lab/fila" },
  { refs: ["aps"], titulo: "Indicadores", desc: "Indicadores e metas de repasse (APS Previne).", icon: Activity, to: "/aps" },
  { refs: ["usuarios"], titulo: "Contas e Acessos", desc: "Gestão de usuários.", icon: Users, to: "/usuarios" },
  { refs: ["cfg_geral", "integracoes"], seed: "cfg_geral", titulo: "Configurações", desc: "Parâmetros do município.", icon: Settings2, to: "/configuracoes" },
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
  const { confirmar } = useConfirm();
  const [versao, setVersao] = useState<UpdateStatus | null>(null);
  const [items, setItems] = useState<DashboardItem[] | null>(null);
  const [salvos, setSalvos] = useState<DashboardItem[]>([]);
  const [editando, setEditando] = useState(false);
  const [galeria, setGaleria] = useState<null | "atalho" | "widget">(null);
  const [categoriaGaleria, setCategoriaGaleria] = useState<string>("todas");
  const [buscaGaleria, setBuscaGaleria] = useState("");
  const [configurandoItem, setConfigurandoItem] = useState<DashboardItem | null>(null);
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

  function adicionar(tipo: "atalho" | "widget", ref: string, configPadrao?: Record<string, any>) {
    alterar([...(items ?? []), { id: uid(ref), tipo, ref, config: configPadrao || {} }]);
    setGaleria(null);
  }

  function duplicar(it: DashboardItem) {
    const arr = [...(items ?? [])];
    const index = arr.findIndex((x) => x.id === it.id);
    const novo: DashboardItem = {
      id: uid(it.ref),
      tipo: it.tipo,
      ref: it.ref,
      config: it.config ? JSON.parse(JSON.stringify(it.config)) : {},
    };
    if (index >= 0) {
      arr.splice(index + 1, 0, novo);
    } else {
      arr.push(novo);
    }
    alterar(arr);
  }

  function salvarConfig(id: string, novaConfig: Record<string, any>) {
    alterar(
      (items ?? []).map((x) => (x.id === id ? { ...x, config: novaConfig } : x))
    );
    setConfigurandoItem(null);
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
    if (can("tfd_viagens") || can("tfd_exames") || can("tfd")) {
      base.push({ id: uid("resumo-tfd"), tipo: "widget", ref: "resumo-tfd" });
    }
    alterar(base);
  }

  async function restaurar() {
    const ok = await confirmar({
      titulo: "Restaurar painel padrão",
      descricao: "Deseja realmente restaurar o painel padrão automático? Sua personalização atual será substituída.",
      textoConfirmar: "Sim, Restaurar",
      variante: "warning",
    });
    if (!ok) return;
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
  }

  const refsUsados = new Set((items ?? []).map((i) => `${i.tipo}:${i.ref}`));

  // Lista enriquecida de atalhos disponíveis
  const listaNosPermitidos = [
    ...MODULOS.flatMap((m) => (m.apenasGrupo ? (m.filhos ?? []) : [m, ...(m.filhos ?? [])])),
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
      (w.configuravel || !refsUsados.has(`widget:${w.id}`)) &&
      (categoriaGaleria === "todas" || w.categoria === categoriaGaleria) &&
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
              const isWide = WIDE_WIDGETS.has(w.id) || it.config?.largura === "largo";

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
                    onConfigurar={() => setConfigurandoItem(it)}
                    onDuplicar={() => duplicar(it)}
                  />
                  <div className="mb-3 flex items-center gap-2.5 border-b border-sus-900/5 pb-2.5">
                    <div className="grid h-8 w-8 place-items-center rounded-lg bg-sus-900 text-white shrink-0">
                      <Icone className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-display text-xs font-bold text-sus-950">
                          {it.config?.tituloCustomizado || w.titulo}
                        </p>
                        {it.config?.fila && (
                          <span className="shrink-0 text-[10px] bg-teal/15 text-teal font-bold px-1.5 py-0.2 rounded truncate max-w-[120px]">
                            {it.config.fila}
                          </span>
                        )}
                        {it.config?.largura === "largo" && (
                          <span className="shrink-0 text-[9px] bg-slate-100 text-slate-600 font-bold px-1 rounded border border-slate-200">
                            2x1
                          </span>
                        )}
                      </div>
                      <p className="truncate text-[11px] text-ink/50">{w.desc}</p>
                    </div>
                  </div>
                  <WidgetPorId
                    id={w.id}
                    config={it.config}
                    onUpdateConfig={(novaConfig) => {
                      alterar(
                        (items ?? []).map((x) => (x.id === it.id ? { ...x, config: novaConfig } : x))
                      );
                    }}
                  />
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
                }}
                className="rounded-lg p-2 text-ink/50 hover:bg-sand"
                aria-label="Fechar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Barra de Filtros e Abas */}
            <div className="flex flex-col gap-2.5 border-b border-sus-900/5 bg-sand/30 px-6 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="inline-flex rounded-xl bg-white p-1 shadow-sm border border-sus-900/10">
                  <button
                    onClick={() => {
                      setGaleria("atalho");
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

              {/* Filtro por Categorias quando em aba Widgets */}
              {galeria === "widget" && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-[11px] font-bold text-slate-500 mr-1">Filtrar por:</span>
                  {[
                    { id: "todas", rotulo: "Todos os Blocos" },
                    { id: "filas", rotulo: "Filas & Regulação" },
                    { id: "tfd", rotulo: "TFD & Frota" },
                    { id: "lab", rotulo: "Laboratório & BPA" },
                    { id: "oxigenio", rotulo: "Oxigênio" },
                    { id: "farmacia", rotulo: "Farmácia" },
                    { id: "aps", rotulo: "APS Previne" },
                  ].map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => setCategoriaGaleria(cat.id)}
                      className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg transition ${
                        categoriaGaleria === cat.id
                          ? "bg-sus-900 text-white font-bold"
                          : "bg-white text-slate-700 hover:bg-slate-100 border border-slate-200/60"
                      }`}
                    >
                      {cat.rotulo}
                    </button>
                  ))}
                </div>
              )}
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
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sus-900 text-white">
                                  <Icone className="h-4 w-4" />
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <h4 className="font-display text-sm font-bold text-sus-950 truncate">
                                      {w.titulo}
                                    </h4>
                                    {w.configuravel && (
                                      <span className="shrink-0 rounded bg-teal/15 text-teal text-[9px] font-bold px-1.5 py-0.5">
                                        Configurável
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[11px] text-ink/55 truncate">{w.desc}</p>
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
                              {w.configuravel ? "Permite escolher filas e filtros" : "Atualização dinâmica em tempo real"}
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
                        Nenhum gráfico disponível nesta categoria ou com os termos pesquisados.
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
                }}
                className="font-bold text-sus-900 hover:underline"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE CONFIGURAÇÃO DO WIDGET / BLOCO */}
      {configurandoItem && (
        <ModalConfigurarWidget
          item={configurandoItem}
          onSalvar={(novaConfig) => salvarConfig(configurandoItem.id, novaConfig)}
          onFechar={() => setConfigurandoItem(null)}
        />
      )}

      {user?.is_superuser && <VersaoRodape st={versao} />}
    </div>
  );
}

function Controles({
  editando,
  onRemover,
  onMover,
  onConfigurar,
  onDuplicar,
}: {
  editando: boolean;
  onRemover: () => void;
  onMover: (d: -1 | 1) => void;
  onConfigurar?: () => void;
  onDuplicar?: () => void;
}) {
  if (!editando) return null;
  const btn = "rounded-lg bg-sus-950/75 p-1 text-white transition hover:bg-sus-950";
  return (
    <div className="absolute right-1.5 top-1.5 z-10 flex items-center gap-0.5">
      {onConfigurar && (
        <button
          onClick={(e) => {
            e.preventDefault();
            onConfigurar();
          }}
          className="rounded-lg bg-teal p-1 text-sus-950 font-bold transition hover:brightness-110 shadow-xs"
          title="Configurar opções e filtros deste gráfico"
          aria-label="Configurar gráfico"
        >
          <SlidersHorizontal className="h-3 w-3" />
        </button>
      )}
      {onDuplicar && (
        <button
          onClick={(e) => {
            e.preventDefault();
            onDuplicar();
          }}
          className={btn}
          title="Duplicar bloco (ex: criar outro com fila diferente)"
          aria-label="Duplicar bloco"
        >
          <Copy className="h-3 w-3" />
        </button>
      )}
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

function ModalConfigurarWidget({
  item,
  onSalvar,
  onFechar,
}: {
  item: DashboardItem;
  onSalvar: (novaConfig: Record<string, any>) => void;
  onFechar: () => void;
}) {
  const w = WIDGETS.find((x) => x.id === item.ref);
  const [opcoesFilas, setOpcoesFilas] = useState<{ value: string; label: string; total: number }[]>([]);
  const [tituloCustomizado, setTituloCustomizado] = useState(item.config?.tituloCustomizado || "");
  const [largura, setLargura] = useState(item.config?.largura || "normal");
  const [fila, setFila] = useState(item.config?.fila || "");
  const [tipoGrafico, setTipoGrafico] = useState(item.config?.tipoGrafico || w?.tipoGrafico || "barras");
  const [periodo, setPeriodo] = useState(item.config?.periodo || "30d");
  const [mostrarUrgentes, setMostrarUrgentes] = useState(item.config?.mostrarUrgentes !== false);
  const [mostrarEletivos, setMostrarEletivos] = useState(item.config?.mostrarEletivos !== false);
  const [mostrarTempo, setMostrarTempo] = useState(item.config?.mostrarTempo !== false);

  useEffect(() => {
    tfdFiltrosOpcoes("aguardando")
      .then((r) => setOpcoesFilas(r.especialidades ?? []))
      .catch(() => {});
  }, []);

  const handleSalvar = (e: React.FormEvent) => {
    e.preventDefault();
    onSalvar({
      ...(item.config || {}),
      tituloCustomizado: tituloCustomizado.trim(),
      largura,
      fila,
      tipoGrafico,
      periodo,
      mostrarUrgentes,
      mostrarEletivos,
      mostrarTempo,
    });
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 overflow-hidden">
      <div
        className="fixed -inset-10 bg-sus-950/60 backdrop-blur-md animate-in fade-in duration-150"
        onClick={onFechar}
        aria-hidden="true"
      />
      <div className="relative z-10 bg-white rounded-2xl shadow-2xl max-w-lg w-full flex flex-col max-h-[90vh] overflow-hidden border border-slate-200 animate-in zoom-in-95 duration-150">
        <div className="px-6 py-4 bg-sus-950 text-white flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-white/10 rounded-xl text-teal">
              <SlidersHorizontal className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base">Configurar Bloco · {w?.titulo || "Widget"}</h3>
              <p className="text-xs text-teal-200">Personalize dados exibidos, visualização e filtros</p>
            </div>
          </div>
          <button
            onClick={onFechar}
            className="rounded-xl p-1.5 text-white/80 hover:bg-white/10 hover:text-white transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSalvar} className="flex flex-col flex-1 overflow-hidden min-h-0">
          <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs text-slate-700">
            {/* Título do Bloco */}
            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1">
                Nome de Exibição do Bloco (Opcional)
              </label>
              <input
                type="text"
                value={tituloCustomizado}
                onChange={(e) => setTituloCustomizado(e.target.value)}
                placeholder={w?.titulo || "Ex: Minha Fila de Cardiologia"}
                className="w-full rounded-xl border border-slate-300 p-2.5 text-xs text-slate-900 outline-none focus:border-teal"
              />
            </div>

            {/* Largura no Grid */}
            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1">
                Tamanho do Bloco no Painel
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setLargura("normal")}
                  className={`p-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition ${
                    largura === "normal"
                      ? "border-teal bg-teal/10 text-sus-950 font-bold"
                      : "border-slate-200 hover:bg-slate-50 text-slate-600"
                  }`}
                >
                  <Minimize2 className="w-4 h-4 text-slate-500" />
                  <span>Padrão (1 Coluna)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setLargura("largo")}
                  className={`p-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition ${
                    largura === "largo"
                      ? "border-teal bg-teal/10 text-sus-950 font-bold"
                      : "border-slate-200 hover:bg-slate-50 text-slate-600"
                  }`}
                >
                  <Maximize2 className="w-4 h-4 text-teal" />
                  <span>Expandido (2 Colunas)</span>
                </button>
              </div>
            </div>

            {/* Seleção de Fila/Especialidade */}
            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1">
                Fila de Atendimento / Especialidade a Acompanhar
              </label>
              <select
                value={fila}
                onChange={(e) => setFila(e.target.value)}
                className="w-full rounded-xl border border-slate-300 p-2.5 text-xs text-slate-900 outline-none focus:border-teal bg-white"
              >
                <option value="">Todas as Filas (Visão Geral / Consolidada)</option>
                {opcoesFilas.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label || o.value} ({o.total} pacientes aguardando)
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-slate-500">
                O gráfico filtrará apenas os pacientes e métricas pertencentes a esta fila.
              </p>
            </div>

            {/* Formato do Gráfico */}
            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1">
                Modo de Apresentação Visual
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setTipoGrafico("barras")}
                  className={`p-2.5 rounded-xl border text-xs font-semibold text-center transition ${
                    tipoGrafico === "barras"
                      ? "border-teal bg-teal/10 text-sus-950 font-bold"
                      : "border-slate-200 hover:bg-slate-50 text-slate-600"
                  }`}
                >
                  Barras & Distribuição
                </button>
                <button
                  type="button"
                  onClick={() => setTipoGrafico("kpi")}
                  className={`p-2.5 rounded-xl border text-xs font-semibold text-center transition ${
                    tipoGrafico === "kpi"
                      ? "border-teal bg-teal/10 text-sus-950 font-bold"
                      : "border-slate-200 hover:bg-slate-50 text-slate-600"
                  }`}
                >
                  Cards Numéricos (KPI)
                </button>
              </div>
            </div>

            {/* Período */}
            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1">
                Janela Temporal de Análise
              </label>
              <select
                value={periodo}
                onChange={(e) => setPeriodo(e.target.value)}
                className="w-full rounded-xl border border-slate-300 p-2.5 text-xs text-slate-900 outline-none focus:border-teal bg-white"
              >
                <option value="7d">Últimos 7 dias</option>
                <option value="30d">Últimos 30 dias (Recomendado)</option>
                <option value="mes">Competência do Mês Vigente</option>
                <option value="90d">Últimos 90 dias (Trimestral)</option>
              </select>
            </div>

            {/* Métricas Visíveis */}
            <div className="space-y-2 pt-1 border-t border-slate-100">
              <label className="block text-xs font-bold text-slate-800">
                Métricas e Dados a Exibir no Card
              </label>
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={mostrarUrgentes}
                    onChange={(e) => setMostrarUrgentes(e.target.checked)}
                    className="rounded text-teal focus:ring-teal"
                  />
                  <span>Destacar volume de pacientes com prioridade urgente (vermelho)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={mostrarEletivos}
                    onChange={(e) => setMostrarEletivos(e.target.checked)}
                    className="rounded text-teal focus:ring-teal"
                  />
                  <span>Exibir proporção de pacientes eletivos e rotina</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={mostrarTempo}
                    onChange={(e) => setMostrarTempo(e.target.checked)}
                    className="rounded text-teal focus:ring-teal"
                  />
                  <span>Exibir projeção de dias médios de espera até agendamento</span>
                </label>
              </div>
            </div>
          </div>

          <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onFechar}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 rounded-xl"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-xs font-bold bg-teal hover:bg-teal/90 text-sus-950 rounded-xl shadow-sm transition flex items-center gap-1.5"
            >
              <Check className="w-4 h-4" />
              <span>Salvar Configuração</span>
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
