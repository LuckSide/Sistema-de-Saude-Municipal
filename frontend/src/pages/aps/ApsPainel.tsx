import { useEffect, useMemo, useState } from "react";
import { Activity, CircleAlert, CircleCheck, Download, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { Badge, Button, Card, Label, cn } from "../../components/ui/primitives";
import IndicadorDetalhe from "../../components/IndicadorDetalhe";
import {
  fonteBadge,
  pecAtualizarIndicadores,
  pecDimensoes,
  pecGraficos,
  pecIndicador,
  pecPainel,
  pecRelatorio,
  pecUbs,
  type PecDimensoes,
  type PecEquipe,
  type PecGraficos,
  type PecIndicadorDetalhe,
  type PecPainel,
  type PecUbsItem,
} from "../../services/pec";

const BLOCO_NOME: Record<string, string> = {
  cuidado: "Cuidado APS · eSF/eAP",
  bucal: "Saúde Bucal · eSB",
  emulti: "Multiprofissional · eMulti",
};

const STATUS_META: Record<string, { label: string; cls: string; Icon: any }> = {
  atingido: { label: "Atingido", cls: "bg-teal/15 text-teal", Icon: CircleCheck },
  alerta: { label: "Alerta", cls: "bg-amber-100 text-amber-700", Icon: TriangleAlert },
  risco_perda: { label: "Risco de perda", cls: "bg-red-100 text-red-700", Icon: CircleAlert },
};

function barra(perc: number, meta: number, menorMelhor: boolean) {
  const ok = menorMelhor ? perc <= meta : perc >= meta;
  return (
    <div className="mt-2 h-2 overflow-hidden rounded-full bg-sand">
      <div
        className={`h-full rounded-full ${ok ? "bg-teal" : "bg-amber-500"}`}
        style={{ width: `${Math.min(100, perc)}%` }}
      />
    </div>
  );
}

export default function ApsPainel() {
  const [periodo, setPeriodo] = useState("2026-T1");
  const [ubs, setUbs] = useState("");
  const [equipe, setEquipe] = useState("");
  const [painel, setPainel] = useState<PecPainel | null>(null);
  const [graf, setGraf] = useState<PecGraficos | null>(null);
  const [unidades, setUnidades] = useState<PecUbsItem[]>([]);
  const [periodos, setPeriodos] = useState<string[]>([]);
  const [equipes, setEquipes] = useState<PecEquipe[]>([]);
  const [dim, setDim] = useState<PecDimensoes | null>(null);
  const [bloco, setBloco] = useState("todos");
  const [detalhe, setDetalhe] = useState<PecIndicadorDetalhe | null>(null);
  const [viaApi, setViaApi] = useState(true);
  const [carregando, setCarregando] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [erro, setErro] = useState("");
  const [sucessoMsg, setSucessoMsg] = useState("");

  async function carregar() {
    setCarregando(true);
    setErro("");
    try {
      const [p, g, u, d] = await Promise.all([
        pecPainel(periodo, ubs, equipe),
        pecGraficos(),
        pecUbs(),
        pecDimensoes(),
      ]);
      setPainel(p.dados);
      setGraf({ ...g.dados, fonte: p.dados.fonte });
      setUnidades((u.dados as any).ubs ?? []);
      setDim(d.dados);
      setPeriodos(d.dados.periodos?.length ? d.dados.periodos : p.dados.periodos ?? []);
      setEquipes(d.dados.equipes?.length ? d.dados.equipes : p.dados.equipes ?? []);
      setViaApi(p.viaApi && g.viaApi);
    } catch {
      setErro("Sessão expirada ou falha ao carregar indicadores.");
    } finally {
      setCarregando(false);
    }
  }

  async function sincronizarPec() {
    setSincronizando(true);
    setErro("");
    setSucessoMsg("");
    try {
      const res = await pecAtualizarIndicadores();
      if (res.ok) {
        setSucessoMsg(res.mensagem || "Indicadores sincronizados com sucesso a partir do e-SUS PEC!");
        await carregar();
      } else {
        setErro(res.mensagem || "Não foi possível sincronizar com o e-SUS PEC.");
      }
    } catch {
      setErro("Erro de comunicação ao sincronizar dados com o e-SUS PEC.");
    } finally {
      setSincronizando(false);
    }
  }

  useEffect(() => {
    carregar().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function baixar() {
    try {
      const r = await pecRelatorio(periodo, ubs, equipe);
      const blob = new Blob([(r.dados as any).csv ?? ""], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `indicadores-aps-${periodo || "geral"}.csv`;
      a.click();
    } catch {
      setErro("Falha ao gerar relatório.");
    }
  }

  async function abrirDetalhe(codigo: string) {
    setErro("");
    try {
      const r = await pecIndicador(codigo, ubs, equipe);
      setDetalhe(r.dados);
    } catch {
      setErro("Falha ao abrir detalhe do indicador.");
    }
  }

  const kpis = useMemo(
    () => (painel?.kpis ?? []).filter((k) => bloco === "todos" || k.bloco === bloco),
    [painel, bloco]
  );
  const resumo = painel?.resumo_repasse;
  const statusGeral = STATUS_META[resumo?.status_geral ?? "alerta"] ?? STATUS_META.alerta;
  const fonte = painel?.fonte ?? "mock";

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold text-sus-950">
          <Activity className="h-5 w-5" /> Indicadores · APS Previne
        </h2>
        <span className="ml-auto"><Badge>{fonteBadge(fonte, viaApi)}</Badge></span>
      </div>
      {erro && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
      {sucessoMsg && (
        <p className="mb-3 flex items-center gap-1.5 rounded-xl bg-teal/15 px-3 py-2 text-sm text-teal font-semibold">
          <CircleCheck className="h-4 w-4" /> {sucessoMsg}
        </p>
      )}

      {resumo && (
        <Card className="mb-4 flex flex-wrap items-center gap-3 p-4">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${statusGeral.cls}`}>
            <statusGeral.Icon className="h-3.5 w-3.5" />
            Repasse: {statusGeral.label}
          </span>
          <p className="text-sm text-ink/60">
            <b>{resumo.atingidos}/{resumo.total}</b> indicadores com meta atingida · Portarias 3.493/2024 e 6.907/2025
          </p>
        </Card>
      )}

      <Card className="mb-4 p-4">
        <div className="grid gap-3 md:grid-cols-5">
          <div>
            <Label>Período</Label>
            <select value={periodo} onChange={(e) => setPeriodo(e.target.value)} className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
              {periodos.length === 0 && <option value={periodo}>{periodo}</option>}
              {periodos.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <Label>UBS (CNES)</Label>
            <select value={ubs} onChange={(e) => setUbs(e.target.value)} className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
              <option value="">Todas</option>
              {unidades.map((u) => (
                <option key={u.codigo} value={u.cnes || u.codigo}>
                  {u.codigo}{u.cnes ? ` · ${u.cnes}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Equipe (eSF/eSB)</Label>
            <select value={equipe} onChange={(e) => setEquipe(e.target.value)} className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
              <option value="">Todas</option>
              {equipes.map((q) => (
                <option key={q.codigo} value={q.codigo}>
                  {q.codigo}{q.tipo ? ` · ${q.tipo}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Bloco</Label>
            <select value={bloco} onChange={(e) => setBloco(e.target.value)} className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
              <option value="todos">Todos</option>
              <option value="cuidado">Cuidado APS</option>
              <option value="bucal">Saúde Bucal</option>
              <option value="emulti">eMulti</option>
            </select>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Button onClick={carregar} disabled={carregando}>
              {carregando ? "Carregando..." : "Filtrar"}
            </Button>
            <Button onClick={baixar} className="!bg-teal !text-sus-950">
              <Download className="h-4 w-4" /> CSV
            </Button>
            <Button
              onClick={sincronizarPec}
              disabled={sincronizando}
              className="!bg-sus-900 !text-white flex items-center gap-1.5"
              title="Sincronizar indicadores diretamente do e-SUS PEC para o cache local"
            >
              <RefreshCw className={cn("h-4 w-4", sincronizando && "animate-spin")} />
              {sincronizando ? "Sincronizando..." : "Sincronizar PEC"}
            </Button>
          </div>
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-ink/55">
          <ShieldCheck className="h-3.5 w-3.5 text-teal" /> LGPD: só agregados + UUID ficha. Sem nome/CPF/CNS.
        </p>
      </Card>

      {(["cuidado", "bucal", "emulti"] as const)
        .filter((b) => bloco === "todos" || bloco === b)
        .map((b) => {
          const itens = kpis.filter((k) => k.bloco === b);
          if (!itens.length) return null;
          return (
            <div key={b} className="mb-4">
              <p className="mb-2 font-display text-sm font-bold uppercase tracking-wide text-sus-900/70">
                {BLOCO_NOME[b]}
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {itens.map((k) => {
                  const st = STATUS_META[k.status] ?? STATUS_META.alerta;
                  const menor = k.codigo === "SB_EXODONTIA";
                  return (
                    <button key={k.codigo} type="button" onClick={() => abrirDetalhe(k.codigo)} className="text-left" title="Ver evolução e ações">
                      <Card className="p-4 transition hover:-translate-y-0.5 hover:shadow-card">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-display text-sm font-bold text-sus-950">{k.codigo}</p>
                          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${st.cls}`}>
                            <st.Icon className="h-3 w-3" /> {st.label}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-ink/55">{k.nome}</p>
                        <p className="mt-2 text-sm">
                          {k.num}/{k.den} · <b>{k.perc}%</b> · meta {menor ? `≤${k.meta}%` : `${k.meta}%`}
                        </p>
                        {barra(k.perc, k.meta, menor)}
                        <p className="mt-1 text-[11px] font-semibold text-teal">Ver evolução →</p>
                      </Card>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Card className="p-4">
          <p className="font-display text-sm font-bold text-sus-950">Série temporal</p>
          <div className="mt-2 space-y-2">
            {(graf?.serie ?? []).map((s, i) => (
              <div key={i} className="text-xs">
                <div className="flex justify-between">
                  <span>{s.periodo} · {s.indicador}</span>
                  <b>{s.perc}%</b>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sand">
                  <div className="h-full rounded-full bg-sus-700" style={{ width: `${Math.min(100, s.perc)}%` }} />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-4 font-display text-sm font-bold text-sus-950">Unidades de Guapé</p>
          <div className="mt-2 space-y-1 text-xs">
            {unidades.map((u) => (
              <p key={u.codigo} className="flex justify-between rounded-lg bg-sand/60 px-2 py-1.5">
                <span>{u.codigo}{u.cnes ? ` · CNES ${u.cnes}` : ""}{u.equipe_tipo ? ` · ${u.equipe_tipo}` : ""}</span>
                <b>{u.cadastros_validos}</b>
              </p>
            ))}
          </div>
        </Card>
        <Card className="p-4">
          <p className="font-display text-sm font-bold text-sus-950">Funil cadastros</p>
          <div className="mt-2 space-y-2">
            {(graf?.funil ?? []).map((f) => (
              <div key={f.etapa} className="flex items-center justify-between text-sm">
                <span className="capitalize">{f.etapa}</span>
                <b>{f.total}</b>
              </div>
            ))}
          </div>
          <p className="mt-4 font-display text-sm font-bold text-sus-950">Fichas inconsistentes (UUID)</p>
          <div className="mt-2 space-y-1 text-xs">
            {(graf?.inconsistentes ?? []).map((f) => (
              <p key={f.ficha_uuid} className="rounded-lg bg-sand/60 px-2 py-1.5">
                <span className="font-mono">{f.ficha_uuid}</span> · {f.motivo}
              </p>
            ))}
          </div>
        </Card>
      </div>

      {detalhe && <IndicadorDetalhe detalhe={detalhe} onClose={() => setDetalhe(null)} />}
      {dim === null && <span className="hidden" />}
    </div>
  );
}
