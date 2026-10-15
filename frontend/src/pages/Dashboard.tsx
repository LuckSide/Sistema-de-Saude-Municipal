import { Activity, Ambulance, CalendarDays, ChartColumn, FlaskConical, ListOrdered, Settings2, ShieldCheck, Users, Pencil, Plus, X, ChevronLeft, ChevronRight, RotateCcw, LayoutGrid } from "lucide-react";
import { Link } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { Card } from "../components/ui/primitives";
import UpdateBanner, { VersaoRodape } from "../components/UpdateBanner";
import { fetchDashboard, saveDashboard, updateStatus, type DashboardItem, type UpdateStatus } from "../services/api";
import { MODULOS, type NoPermissao } from "../permissoes";
import { WIDGETS, WidgetPorId } from "../widgets";

const CARDS_PADRAO = [
  { refs: ["dash_indicadores"], titulo: "Indicadores e Agenda", desc: "Evolução das filas, volume por tipo e agenda integrada.", icon: ChartColumn, to: "/indicadores" },
  { refs: ["tfd"], titulo: "TFD · Operações", desc: "Viagens, pacientes, fila de exames, frota e faturamento.", icon: Ambulance, to: "/tfd" },
  { refs: ["lab"], titulo: "Exames / BPA", desc: "Solicitações laboratoriais, SIGTAP e lote BPA.", icon: FlaskConical, to: "/lab" },
  { refs: ["aps"], titulo: "APS · Previne Brasil", desc: "Indicadores, painéis e acompanhamento das equipes.", icon: Activity, to: "/aps" },
  { refs: ["lab_fila"], titulo: "Fila do PSF", desc: "Pedidos das unidades de saúde.", icon: ListOrdered, to: "/lab/fila" },
  { refs: ["lab_agenda", "lab_vagas"], titulo: "Agenda de exames", desc: "Grade mensal de vagas por laboratório.", icon: CalendarDays, to: "/lab/agenda" },
  { refs: ["lab_vagas"], titulo: "Vagas", desc: "Quantitativo diário dos 3 laboratórios.", icon: Settings2, to: "/lab/vagas" },
  { refs: ["lab_audit"], titulo: "Auditoria lab", desc: "Conferência pedido físico × sistema.", icon: ShieldCheck, to: "/lab/auditoria" },
  { refs: ["usuarios"], titulo: "Contas", desc: "Usuários, áreas e telas permitidas.", icon: Users, to: "/usuarios" },
  { refs: ["usuarios", "integracoes"], seed: "integracoes", titulo: "Configurações", desc: "Município, marca, filas, e-SUS, RNDS e sistema.", icon: Settings2, to: "/configuracoes" },
];

const WIDE_WIDGETS = new Set(["agenda-semana"]);

function buscarNo(ref: string): NoPermissao | null {
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
    fetchDashboard().then((it) => {
      setItems(it);
      setSalvos(it);
    }).catch(() => {
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
    return saveDashboard(novos).then((r) => {
      if (seq !== saveSeq.current) return r; // resposta obsoleta: outro save a cobre
      setSalvos(r);
      setSaveState("ok");
      return r;
    }).catch(() => {
      if (seq !== saveSeq.current) return novos; // obsoleto: save mais novo resolve
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
  }

  function usarPadraoComoBase() {
    const base: DashboardItem[] = [];
    for (const c of CARDS_PADRAO) {
      if (!c.refs.some((t) => can(t))) continue;
      const ref = (c as { seed?: string }).seed ?? c.refs[0];
      if (!can(ref)) continue;
      base.push({ id: uid(ref), tipo: "atalho", ref });
    }
    alterar(base);
  }

  function restaurar() {
    if (!confirm("Voltar ao painel padrão? Sua personalização será apagada.")) return;
    saveSeq.current++;
    if (timer.current) window.clearTimeout(timer.current);
    setSaveState("salvando");
    saveDashboard([]).then((r) => {
      setItems(r);
      setSalvos(r);
      setSaveState("ok");
    }).catch(() => setSaveState("erro"));
  }

  async function sairEdicao() {
    // Flush: nunca descarta alteração pendente do debounce.
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
        return; // mantém edição aberta p/ retry (indicador de erro visível)
      }
      setSaindo(false);
    }
    setEditando(false);
    setGaleria(null);
  }

  const refsUsados = new Set((items ?? []).map((i) => `${i.tipo}:${i.ref}`));
  const atalhosGal = MODULOS.flatMap((m) => [m, ...(m.filhos ?? [])])
    .filter((n) => can(n.codigo) && !refsUsados.has(`atalho:${n.codigo}`));
  const widgetsGal = WIDGETS.filter(
    (w) => w.telas.some((t) => can(t)) && !refsUsados.has(`widget:${w.id}`)
  );

  if (items === null) {
    return (
      <div>
        {user?.is_superuser && <UpdateBanner />}
        <p className="mt-8 text-sm text-ink/50">Carregando painel…</p>
      </div>
    );
  }

  return (
    <div>
      {user?.is_superuser && <UpdateBanner />}
      <div className="rise mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-sus-700">
            Secretaria de Saúde · Guapé-MG
          </p>
          <h1 className="mt-1 font-display text-3xl font-extrabold text-sus-950">
            Olá, {(user?.nome || user?.username)?.split(" ")[0]}
          </h1>
          <p className="mt-1 text-sm text-ink/55">
            Área: <b>{user?.area}</b> · Telas: {user?.telas.join(", ") || "—"}
            {saveState === "salvando" && <span className="ml-2 text-xs text-ink/45">Salvando…</span>}
            {saveState === "erro" && <span className="ml-2 text-xs font-bold text-red-600">Falha ao salvar — tente de novo</span>}
          </p>
        </div>
        <div className="flex gap-2">
          {editando && custom && (
            <button onClick={restaurar} className="inline-flex items-center gap-1.5 rounded-xl border border-sus-900/15 px-3.5 py-2 text-xs font-bold text-sus-900 hover:bg-sand">
              <RotateCcw className="h-3.5 w-3.5" /> Padrão
            </button>
          )}
          <button
            onClick={() => (editando ? sairEdicao() : setEditando(true))}
            disabled={saindo}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition disabled:opacity-60 ${editando ? "bg-teal text-white" : "bg-sus-900 text-white hover:bg-sus-800"}`}
          >
            {editando ? <><X className="h-3.5 w-3.5" /> {saindo ? "Salvando…" : "Concluir"}</> : <><Pencil className="h-3.5 w-3.5" /> Personalizar</>}
          </button>
        </div>
      </div>

      {!custom && !editando && (
        <div className="grid gap-4 sm:grid-cols-2">
          {CARDS_PADRAO.filter((c) => c.refs.some((t) => can(t))).map((c, i) => (
            <Link key={c.to} to={c.to}>
              <Card className={`rise rise-${i + 1} group p-5 transition hover:-translate-y-0.5 hover:shadow-card`}>
                <div className="mb-3 grid h-11 w-11 place-items-center rounded-2xl bg-sus-900 text-white transition group-hover:bg-teal group-hover:text-sus-950">
                  <c.icon className="h-5 w-5" />
                </div>
                <p className="font-display text-base font-bold text-sus-950">{c.titulo}</p>
                <p className="mt-1 text-sm text-ink/55">{c.desc}</p>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {(custom || editando) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {(items ?? []).map((it) => {
            if (it.tipo === "widget") {
              const w = WIDGETS.find((x) => x.id === it.ref);
              if (!w || !w.telas.some((t) => can(t))) return null;
              const Icone = w.icone;
              return (
                <Card key={it.id} className={`relative p-5 ${WIDE_WIDGETS.has(w.id) ? "sm:col-span-2" : ""}`}>
                  <Controles editando={editando} onRemover={() => remover(it.id)} onMover={(d) => mover(it.id, d)} />
                  <div className="mb-3 flex items-center gap-2.5">
                    <div className="grid h-9 w-9 place-items-center rounded-xl bg-sus-900 text-white">
                      <Icone className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="font-display text-sm font-bold text-sus-950">{w.titulo}</p>
                      <p className="text-[11px] text-ink/50">{w.desc}</p>
                    </div>
                  </div>
                  <WidgetPorId id={w.id} />
                </Card>
              );
            }
            const no = buscarNo(it.ref);
            if (!no || !can(no.codigo)) return null;
            const Icone = no.icone;
            return (
              <div key={it.id} className="relative">
                <Controles editando={editando} onRemover={() => remover(it.id)} onMover={(d) => mover(it.id, d)} />
                <Link to={no.rota ?? "/"}>
                  <Card className="group h-full p-5 transition hover:-translate-y-0.5 hover:shadow-card">
                    <div className="mb-3 grid h-11 w-11 place-items-center rounded-2xl bg-sus-900 text-white transition group-hover:bg-teal group-hover:text-sus-950">
                      <Icone className="h-5 w-5" />
                    </div>
                    <p className="font-display text-base font-bold text-sus-950">{no.rotulo}</p>
                    {no.rota && <p className="mt-1 font-mono text-[11px] text-ink/45">{no.rota}</p>}
                  </Card>
                </Link>
              </div>
            );
          })}
          {editando && (
            <>
              <button
                onClick={() => setGaleria("atalho")}
                className="grid min-h-[120px] place-items-center rounded-2xl border-2 border-dashed border-sus-900/20 p-5 text-sm font-bold text-sus-900 transition hover:border-teal hover:text-teal"
              >
                <span className="inline-flex items-center gap-2"><Plus className="h-4 w-4" /> Adicionar bloco</span>
              </button>
              {(items ?? []).length === 0 && (
                <button
                  onClick={usarPadraoComoBase}
                  className="grid min-h-[120px] place-items-center rounded-2xl border-2 border-dashed border-sus-900/20 p-5 text-sm font-bold text-sus-900 transition hover:border-teal hover:text-teal"
                >
                  <span className="inline-flex items-center gap-2"><LayoutGrid className="h-4 w-4" /> Começar do meu painel atual</span>
                </button>
              )}
            </>
          )}
        </div>
      )}

      {galeria && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4" onClick={() => setGaleria(null)}>
          <div className="rise max-h-[85vh] w-full max-w-lg overflow-auto rounded-2xl bg-white p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <p className="font-display text-base font-bold text-sus-950">Adicionar ao painel</p>
              <button onClick={() => setGaleria(null)} className="rounded-lg p-2 text-ink/50 hover:bg-sand" aria-label="Fechar">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mb-3 flex gap-2">
              {(["atalho", "widget"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setGaleria(t)}
                  className={`rounded-xl px-3.5 py-1.5 text-xs font-bold ${galeria === t ? "bg-sus-900 text-white" : "bg-sus-900/10 text-sus-900"}`}
                >
                  {t === "atalho" ? "Atalhos" : "Gráficos"}
                </button>
              ))}
            </div>
            <div className="space-y-1.5">
              {galeria === "atalho" && atalhosGal.map((n) => (
                <button
                  key={n.codigo}
                  onClick={() => adicionar("atalho", n.codigo)}
                  className="flex w-full items-center gap-3 rounded-xl border border-sus-900/10 px-3 py-2.5 text-left transition hover:border-teal hover:bg-teal/5"
                >
                  <n.icone className="h-5 w-5 shrink-0 text-sus-900" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-sus-950">{n.rotulo}</span>
                    {n.rota && <span className="block truncate font-mono text-[11px] text-ink/45">{n.rota}</span>}
                  </span>
                  <Plus className="h-4 w-4 shrink-0 text-teal" />
                </button>
              ))}
              {galeria === "widget" && widgetsGal.map((w) => (
                <button
                  key={w.id}
                  onClick={() => adicionar("widget", w.id)}
                  className="flex w-full items-center gap-3 rounded-xl border border-sus-900/10 px-3 py-2.5 text-left transition hover:border-teal hover:bg-teal/5"
                >
                  <w.icone className="h-5 w-5 shrink-0 text-sus-900" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-sus-950">{w.titulo}</span>
                    <span className="block truncate text-[11px] text-ink/50">{w.desc}</span>
                  </span>
                  <Plus className="h-4 w-4 shrink-0 text-teal" />
                </button>
              ))}
              {((galeria === "atalho" && atalhosGal.length === 0) || (galeria === "widget" && widgetsGal.length === 0)) && (
                <p className="rounded-xl bg-sand/70 px-3 py-4 text-center text-xs text-ink/55">
                  Nada disponível — tudo permitido já está no painel.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {user?.is_superuser && <VersaoRodape st={versao} />}
    </div>
  );
}

function Controles({ editando, onRemover, onMover }: { editando: boolean; onRemover: () => void; onMover: (d: -1 | 1) => void }) {
  if (!editando) return null;
  const btn = "rounded-lg bg-sus-950/70 p-1 text-white transition hover:bg-sus-950";
  return (
    <div className="absolute right-2 top-2 z-10 flex gap-1">
      <button onClick={(e) => { e.preventDefault(); onMover(-1); }} className={btn} title="Mover para trás" aria-label="Mover para trás">
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      <button onClick={(e) => { e.preventDefault(); onMover(1); }} className={btn} title="Mover para frente" aria-label="Mover para frente">
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
      <button onClick={(e) => { e.preventDefault(); onRemover(); }} className="rounded-lg bg-red-600/85 p-1 text-white transition hover:bg-red-600" title="Remover" aria-label="Remover">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
