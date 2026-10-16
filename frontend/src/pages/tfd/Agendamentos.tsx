import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileText,
  RotateCcw,
  Search,
  Undo2,
  UserCheck,
  UserX,
  X,
  XCircle,
} from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import {
  fetchMedicos,
  fetchUnidadesSaude,
  pagData,
  pagMeta,
  tfdAtendimentoStatus,
  tfdEstornarRecepcaoExame,
  tfdExames,
  tfdRecepcionarExame,
  type Exame,
  type Medico,
  type UnidadeSaude,
} from "../../services/api";
import { useUndo } from "../../components/UndoToast";
import { Button, Card, Input, Label } from "../../components/ui/primitives";
import { rotuloPrioridade } from "../../utils/rotulos";
import ExportarExcel from "../../components/ExportarExcel";

type Visao = "mes" | "semana" | "dia";

const STATUS_AGENDA = ["agendado", "recepcionado", "realizado", "faltou", "cancelado"];

function hojeISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function somaDias(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function fmtDia(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join("/") : iso;
}

function inicioSemana(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  const dow = (d.getDay() + 6) % 7; // seg=0
  d.setDate(d.getDate() - dow);
  return d.toISOString().slice(0, 10);
}

const NOMES_DIA = ["SEG", "TER", "QUA", "QUI", "SEX", "SÁB", "DOM"];

const COR_STATUS: Record<string, string> = {
  agendado: "bg-sus-900/10 text-sus-900",
  recepcionado: "bg-teal/15 text-teal",
  realizado: "bg-green-100 text-green-800",
  faltou: "bg-amber-100 text-amber-800",
  cancelado: "bg-sus-900/10 text-ink/50",
};

const ROTULO_STATUS: Record<string, string> = {
  agendado: "Agendado",
  recepcionado: "Recepcionado",
  realizado: "Realizado",
  faltou: "Faltou",
  cancelado: "Cancelado",
};

export default function Agendamentos() {
  const { retroativoBloqueado } = useAuth();
  const { notificarUndo } = useUndo();
  const [visao, setVisao] = useState<Visao>("semana");
  const [dia, setDia] = useState(hojeISO());
  const [lista, setLista] = useState<Exame[]>([]);
  const [total, setTotal] = useState(0);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  // Filtros rápidos
  const [fTipo, setFTipo] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fUnidade, setFUnidade] = useState("");
  const [fMedico, setFMedico] = useState("");
  const [medicos, setMedicos] = useState<Medico[]>([]);
  const [unidades, setUnidades] = useState<UnidadeSaude[]>([]);
  // Menu rápido por agendamento
  const [sel, setSel] = useState<Exame | null>(null);
  const [resultado, setResultado] = useState("");
  const [mostraResultado, setMostraResultado] = useState(false);
  const [agindo, setAgindo] = useState(false);
  const [erroModal, setErroModal] = useState("");

  const diasVisiveis = useMemo(() => {
    if (visao === "dia") return [dia];
    if (visao === "semana") {
      const ini = inicioSemana(dia);
      return Array.from({ length: 7 }, (_, i) => somaDias(ini, i));
    }
    // mês: grade completa do mês da referência
    const [y, m] = dia.slice(0, 7).split("-").map(Number);
    const primeiro = new Date(y, m - 1, 1);
    const desloc = (primeiro.getDay() + 6) % 7;
    const nDias = new Date(y, m, 0).getDate();
    const ini = somaDias(`${y}-${String(m).padStart(2, "0")}-01`, -desloc);
    const totalCells = Math.ceil((desloc + nDias) / 7) * 7;
    return Array.from({ length: totalCells }, (_, i) => somaDias(ini, i));
  }, [dia, visao]);

  const carregar = useCallback(async () => {
    setErro("");
    try {
      const de = diasVisiveis[0];
      const ate = diasVisiveis[diasVisiveis.length - 1];
      const r = await tfdExames({
        data_de: "1900-01-01",
        data_ate: "2100-12-31",
        page: 1,
        limit: 500,
      });
      let itens = pagData<Exame>(r);
      // Só agendados com data no intervalo visível (filtra em memória p/ combinar filtros rápidos).
      itens = itens.filter((e) => {
        const d = (e.data_agendada || "").slice(0, 10);
        if (!d || d < de || d > ate) return false;
        if (fStatus && e.status !== fStatus) return false;
        if (fTipo && !`${e.tipo_fila} ${e.exame}`.toLowerCase().includes(fTipo.toLowerCase())) return false;
        if (fUnidade && String(e.unidade_saude_id ?? "") !== fUnidade && (e.unidade_nome || "") !== fUnidade) return false;
        if (fMedico && String(e.medico_id ?? "") !== fMedico) return false;
        return true;
      });
      itens.sort((a, b) =>
        `${a.data_agendada}${a.hora_agendada}`.localeCompare(`${b.data_agendada}${b.hora_agendada}`),
      );
      setLista(itens);
      setTotal(itens.length);
    } catch {
      setErro("Falha ao carregar agendamentos.");
    }
  }, [diasVisiveis, fStatus, fTipo, fUnidade, fMedico]);

  useEffect(() => {
    carregar().catch(() => setErro("Falha ao carregar agendamentos."));
  }, [carregar]);

  useEffect(() => {
    fetchMedicos({ somente_ativos: true }).then(setMedicos).catch(() => {});
    fetchUnidadesSaude().then(setUnidades).catch(() => {});
  }, []);

  const porDia = useMemo(() => {
    const mapa = new Map<string, Exame[]>();
    for (const e of lista) {
      const d = (e.data_agendada || "").slice(0, 10);
      if (!d) continue;
      if (!mapa.has(d)) mapa.set(d, []);
      mapa.get(d)!.push(e);
    }
    return mapa;
  }, [lista]);

  function abrirAcao(e: Exame) {
    setSel(e);
    setResultado(e.resultado ?? "");
    setMostraResultado(false);
    setErroModal("");
  }

  async function acaoRecepcionar() {
    if (!sel) return;
    setAgindo(true);
    setErroModal("");
    try {
      const atualizado = await tfdRecepcionarExame(sel.id);
      setSel(atualizado);
      setOk(`${atualizado.paciente_nome} recepcionado(a).`);
      await carregar();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? "Falha ao recepcionar.";
      setErroModal(msg);
    } finally {
      setAgindo(false);
    }
  }

  async function acaoEstornar() {
    if (!sel) return;
    setAgindo(true);
    setErroModal("");
    try {
      const atualizado = await tfdEstornarRecepcaoExame(sel.id);
      setSel(atualizado);
      setOk("Recepção estornada.");
      await carregar();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? "Falha ao estornar.";
      setErroModal(msg);
    } finally {
      setAgindo(false);
    }
  }

  async function acaoStatus(status: "faltou" | "realizado" | "cancelado") {
    if (!sel) return;
    if (status === "realizado" && !resultado.trim()) {
      setErroModal("Informe o resultado do exame realizado.");
      return;
    }
    const alvo = sel;
    const statusAntes = alvo.status;
    setAgindo(true);
    setErroModal("");
    try {
      const atualizado = await tfdAtendimentoStatus(alvo.id, status, status === "realizado" ? resultado.trim() : undefined);
      setSel(null);
      setOk(
        status === "faltou" ? `${alvo.paciente_nome} marcado como faltou.`
        : status === "realizado" ? `Resultado registrado p/ ${alvo.paciente_nome}.`
        : `Agendamento de ${alvo.paciente_nome} cancelado.`,
      );
      await carregar();
      if (status === "cancelado") {
        notificarUndo({
          titulo: `Agendamento de ${alvo.paciente_nome} cancelado.`,
          descricao: "Desfazer restaura o status anterior em 5s.",
          onUndo: async () => {
            const { tfdAtualizarExame } = await import("../../services/api");
            await tfdAtualizarExame(alvo.id, {
              paciente_id: alvo.paciente_id,
              exame: alvo.exame,
              especialidade: alvo.especialidade,
              tipo_fila: alvo.tipo_fila,
              codigo_procedimento: alvo.codigo_procedimento,
              codigo_especialidade: alvo.codigo_especialidade,
              nome_especialidade: alvo.nome_especialidade,
              prioridade: alvo.prioridade,
              justificativa_prioridade: alvo.justificativa_prioridade ?? "",
              justificativa: alvo.justificativa ?? "Restaurado via desfazer cancelamento.",
              status: statusAntes,
              data_pedido: (alvo.data_pedido || "").slice(0, 10),
              data_agendada: (alvo.data_agendada || "").slice(0, 10) || null,
              hora_agendada: alvo.hora_agendada ?? "",
              medico_id: alvo.medico_id ?? null,
              unidade_saude_id: alvo.unidade_saude_id ?? null,
              destino: alvo.destino,
              observacoes: alvo.observacoes,
              resultado: alvo.resultado ?? "",
              codigo_curto: alvo.codigo_curto ?? "",
              numero_pedido: alvo.numero_pedido ?? "",
            });
            await carregar();
          },
        });
      }
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? "Falha ao atualizar status.";
      setErroModal(msg);
    } finally {
      setAgindo(false);
    }
  }

  const tiposUnicos = useMemo(() => {
    const s = new Set(lista.map((e) => (e.tipo_fila || "—").trim() || "—"));
    return [...s].sort();
  }, [lista]);

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold text-sus-950">
          <CalendarDays className="h-5 w-5 text-sus-900" /> Agendamentos
        </h2>
        <span className="rounded-full bg-teal/10 px-2.5 py-0.5 text-xs font-semibold text-teal">
          {total} atendimento(s) no período
        </span>
        <ExportarExcel
          url="/api/tfd/agenda/exportar"
          arquivo="agendamentos"
          params={{ dia }}
        />
      </div>
      <p className="mb-4 mt-1 text-sm text-ink/55">
        Calendário de exames agendados · clique num agendamento p/ recepcionar, registrar resultado, faltou ou cancelar.
      </p>
      {erro && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
      {ok && <p className="mb-3 rounded-xl bg-teal/10 px-3 py-2 text-sm text-teal">{ok}</p>}

      <Card className="mb-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1 rounded-xl border border-sus-900/10 bg-sand/50 p-1" title="Modo de visualização">
            {(["mes", "semana", "dia"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setVisao(m)}
                aria-pressed={visao === m}
                className={`min-h-[44px] rounded-lg px-4 py-1.5 text-xs font-bold transition ${visao === m ? "bg-sus-900 text-white" : "text-sus-900 hover:bg-white"}`}
              >
                {m === "mes" ? "Mês" : m === "semana" ? "Semana" : "Dia"}
              </button>
            ))}
          </div>
          <button onClick={() => setDia(somaDias(dia, visao === "mes" ? -30 : visao === "semana" ? -7 : -1))} aria-label="Período anterior" className="grid min-h-[44px] min-w-[44px] place-items-center rounded-xl bg-sus-900/10 text-sus-900 hover:bg-sus-900/15"><ChevronLeft className="h-4 w-4" /></button>
          <Input type="date" value={dia} onChange={(e) => e.target.value && setDia(e.target.value)} className="!w-auto" />
          <button onClick={() => setDia(somaDias(dia, visao === "mes" ? 30 : visao === "semana" ? 7 : 1))} aria-label="Próximo período" className="grid min-h-[44px] min-w-[44px] place-items-center rounded-xl bg-sus-900/10 text-sus-900 hover:bg-sus-900/15"><ChevronRight className="h-4 w-4" /></button>
          <button onClick={() => setDia(hojeISO())} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-teal px-3 py-2 text-xs font-bold text-white hover:brightness-110">
            <CalendarDays className="h-4 w-4" /> Hoje
          </button>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-4">
          <div>
            <Label>Tipo de exame</Label>
            <select value={fTipo} onChange={(e) => setFTipo(e.target.value)} className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
              <option value="">Todos</option>
              {tiposUnicos.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <Label>Status</Label>
            <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
              <option value="">Todos</option>
              {STATUS_AGENDA.map((s) => <option key={s} value={s}>{ROTULO_STATUS[s]}</option>)}
            </select>
          </div>
          <div>
            <Label>Unidade</Label>
            <select value={fUnidade} onChange={(e) => setFUnidade(e.target.value)} className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
              <option value="">Todas</option>
              {unidades.filter((u) => u.ativo).map((u) => <option key={u.id} value={String(u.id)}>{u.nome}</option>)}
            </select>
          </div>
          <div>
            <Label>Profissional</Label>
            <select value={fMedico} onChange={(e) => setFMedico(e.target.value)} className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
              <option value="">Todos</option>
              {medicos.filter((m) => m.ativo).map((m) => <option key={m.id} value={String(m.id)}>{m.nome}{m.crm ? ` · ${m.crm}` : ""}</option>)}
            </select>
          </div>
        </div>
      </Card>

      {visao === "mes" && (
        <section className="overflow-x-auto pb-2">
          <div className="mb-1.5 grid grid-cols-7 gap-1.5">
            {NOMES_DIA.map((s) => (
              <p key={s} className="py-1 text-center font-display text-[11px] font-bold uppercase tracking-wide text-sus-900/60">{s}</p>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {diasVisiveis.map((d) => {
              const itens = porDia.get(d) ?? [];
              const ehHoje = d === hojeISO();
              const foraMes = d.slice(0, 7) !== dia.slice(0, 7);
              return (
                <div key={d} className={`min-h-[96px] rounded-xl border p-1.5 ${ehHoje ? "border-teal bg-teal/5" : "border-sus-900/10 bg-white"} ${foraMes ? "opacity-50" : ""}`}>
                  <p className={`text-center font-display text-xs font-extrabold ${ehHoje ? "text-teal" : "text-sus-950"}`}>{d.slice(8, 10)}</p>
                  <div className="mt-1 space-y-1">
                    {itens.slice(0, 4).map((e) => (
                      <button key={e.id} onClick={() => abrirAcao(e)} className="block w-full truncate rounded-md bg-sand/70 px-1.5 py-1 text-left text-[10px] font-semibold hover:bg-teal/15" title={`${e.paciente_nome} · ${e.exame} · ${e.hora_agendada || "s/ hora"} · ${ROTULO_STATUS[e.status] ?? e.status}`}>
                        {e.hora_agendada ? `${e.hora_agendada} ` : ""}{e.paciente_nome}
                      </button>
                    ))}
                    {itens.length > 4 && (
                      <button onClick={() => { setDia(d); setVisao("dia"); }} className="block w-full rounded-md px-1.5 py-1 text-left text-[10px] font-bold text-teal hover:bg-teal/10">
                        +{itens.length - 4} ver dia
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {visao !== "mes" && (
        <section className={`grid gap-2 ${visao === "semana" ? "md:grid-cols-7" : "grid-cols-1"}`}>
          {diasVisiveis.map((d) => {
            const itens = porDia.get(d) ?? [];
            const di = (new Date(`${d}T12:00:00`).getDay() + 6) % 7;
            const ehHoje = d === hojeISO();
            return (
              <div key={d} className={`rounded-2xl border p-2 ${ehHoje ? "border-teal bg-teal/5" : "border-sus-900/10 bg-white"}`}>
                <p className="mb-2 text-center">
                  <span className="block text-[10px] font-bold uppercase text-ink/50">{NOMES_DIA[di]}</span>
                  <span className="font-display text-sm font-extrabold text-sus-950">{d.slice(8, 10)}/{d.slice(5, 7)}</span>
                  <span className="ml-1 rounded-full bg-sus-900/10 px-1.5 py-0.5 text-[10px] font-bold">{itens.length}</span>
                </p>
                <div className="space-y-1.5">
                  {itens.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => abrirAcao(e)}
                      className="block w-full rounded-lg border border-sus-900/10 bg-sand/50 p-2 text-left hover:border-teal/50"
                    >
                      <p className="flex items-center gap-1 text-[11px] font-bold text-sus-950">
                        <span className="text-ink/55">{e.hora_agendada || "--:--"}</span>
                        <span className="min-w-0 flex-1 truncate">{e.paciente_nome}</span>
                      </p>
                      <p className="truncate text-[10px] text-ink/55">{e.exame}</p>
                      <p className="mt-1 flex items-center gap-1">
                        <span className={`rounded-full px-1.5 py-px text-[9px] font-bold ${COR_STATUS[e.status] ?? "bg-sus-900/10"}`}>{ROTULO_STATUS[e.status] ?? e.status}</span>
                        <span className="truncate text-[9px] text-ink/45">{e.unidade_nome || e.destino || "—"}</span>
                      </p>
                    </button>
                  ))}
                  {itens.length === 0 && <p className="py-3 text-center text-[11px] text-ink/40">Sem atendimentos</p>}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {sel && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4" onClick={() => setSel(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl bg-white p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <p className="font-display text-base font-bold text-sus-950">Atendimento · {fmtDia((sel.data_agendada || "").slice(0, 10))}</p>
              <button onClick={() => setSel(null)} className="rounded-lg p-2 text-ink/50 hover:bg-sand" aria-label="Fechar"><X className="h-4 w-4" /></button>
            </div>
            <div className="rounded-2xl bg-sand/60 p-4 text-sm">
              <p className="font-bold text-sus-950">{sel.paciente_nome}</p>
              <p className="text-ink/70">{sel.exame}</p>
              <p className="mt-1 text-xs text-ink/55">
                {sel.hora_agendada ? `${sel.hora_agendada} · ` : ""}{sel.unidade_nome || sel.destino || "—"} · {sel.medico_nome || "—"}
                {sel.prioridade ? ` · ${rotuloPrioridade(sel.prioridade)}` : ""}
              </p>
              <p className="mt-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${COR_STATUS[sel.status] ?? "bg-sus-900/10"}`}>{ROTULO_STATUS[sel.status] ?? sel.status}</span>
              </p>
              {sel.resultado && (
                <p className="mt-2 rounded-xl bg-white/70 px-3 py-2 text-xs text-ink/70"><b>Resultado:</b> {sel.resultado}</p>
              )}
            </div>
            {mostraResultado ? (
              <div className="mt-3">
                <Label>Resultado do exame *</Label>
                <textarea
                  value={resultado}
                  onChange={(e) => setResultado(e.target.value)}
                  rows={4}
                  maxLength={2000}
                  placeholder="Registre o resultado/laudo do exame realizado…"
                  className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2 text-sm outline-none focus:border-teal"
                />
                <p className="mt-1 text-xs text-ink/45">{resultado.trim().length} caracteres</p>
              </div>
            ) : null}
            {erroModal && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erroModal}</p>}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button onClick={() => { setMostraResultado(true); }} disabled={agindo || (sel.status !== "agendado" && sel.status !== "recepcionado")} className="!w-auto">
                <FileText className="h-4 w-4" /> Adicionar Resultados
              </Button>
              {mostraResultado && (
                <Button onClick={() => acaoStatus("realizado")} disabled={agindo} className="!w-auto">
                  <CheckCircle2 className="h-4 w-4" /> Salvar realizado
                </Button>
              )}
              <button onClick={acaoRecepcionar} disabled={agindo || sel.status !== "agendado"} className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-teal/15 px-3 py-2 text-xs font-bold text-teal hover:bg-teal/25 disabled:opacity-40">
                <UserCheck className="h-4 w-4" /> Recepcionar
              </button>
              <button onClick={acaoEstornar} disabled={agindo || sel.status !== "recepcionado"} className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-sus-900/10 px-3 py-2 text-xs font-bold text-sus-900 hover:bg-sus-900/15 disabled:opacity-40">
                <RotateCcw className="h-4 w-4" /> Estornar Recepção
              </button>
              <button onClick={() => acaoStatus("faltou")} disabled={agindo || (sel.status !== "agendado" && sel.status !== "recepcionado")} className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-amber-100 px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-200 disabled:opacity-40">
                <UserX className="h-4 w-4" /> Marcar como Faltou
              </button>
              <button onClick={() => acaoStatus("cancelado")} disabled={agindo || (sel.status !== "agendado" && sel.status !== "recepcionado")} className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100 disabled:opacity-40">
                <XCircle className="h-4 w-4" /> Cancelar Agendamento
              </button>
            </div>
            <p className="mt-3 flex items-center gap-1 text-[11px] text-ink/45">
              <Undo2 className="h-3.5 w-3.5" /> Cancelar oferece Desfazer por 5s (restaura o status anterior).
            </p>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button onClick={() => setDia(somaDias(dia, -1))} className="inline-flex min-h-[44px] items-center gap-1 rounded-xl bg-sus-900/10 px-3 py-2 text-xs font-bold text-sus-900 hover:bg-sus-900/15"><ArrowLeft className="h-4 w-4" /> Dia anterior</button>
        <button onClick={() => setDia(somaDias(dia, 1))} className="inline-flex min-h-[44px] items-center gap-1 rounded-xl bg-sus-900/10 px-3 py-2 text-xs font-bold text-sus-900 hover:bg-sus-900/15">Próximo dia <ArrowRight className="h-4 w-4" /></button>
        <span className="inline-flex items-center gap-1 text-xs text-ink/45"><Search className="h-3.5 w-3.5" /> Dica: use os filtros p/ tipo, status, unidade e profissional.</span>
        <span className="inline-flex items-center gap-1 text-xs text-ink/45"><ClipboardList className="h-3.5 w-3.5" /> Marcação continua na Agenda do TFD.</span>
      </div>
    </div>
  );
}
