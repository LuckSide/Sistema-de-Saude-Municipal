import { useEffect, useState } from "react";
import { CalendarDays, Plus, Search, X } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import {
  tfdAtualizarExame,
  tfdExames,
  pagData,
  pagMeta,
  type Exame,
} from "../../services/api";
import { Button, Card, Input, Label } from "../../components/ui/primitives";
import Paginacao from "../../components/Paginacao";
import { rotuloPrioridade } from "../../utils/rotulos";
import ExportarExcel from "../../components/ExportarExcel";

function hojeISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtDia(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join("/") : iso;
}

export default function AgendaTfd() {
  const { retroativoBloqueado } = useAuth();
  const RETRO_MSG = "Seu perfil não possui permissão para realizar lançamentos com datas retroativas.";
  const [dia, setDia] = useState(hojeISO());
  const [statusFiltro, setStatusFiltro] = useState("agendado");
  const [lista, setLista] = useState<Exame[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");

  // Marcação direta da fila
  const [marcando, setMarcando] = useState(false);
  const [busca, setBusca] = useState("");
  const [candidatos, setCandidatos] = useState<Exame[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [alvo, setAlvo] = useState<Exame | null>(null);
  const [dataMarca, setDataMarca] = useState(hojeISO());
  const [horaMarca, setHoraMarca] = useState("");
  const [medicoId, setMedicoId] = useState("");
  const [unidadeId, setUnidadeId] = useState("");
  const [medicos, setMedicos] = useState<{ id: number; nome: string; crm: string }[]>([]);
  const [unidades, setUnidades] = useState<{ id: number; nome: string }[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [erroModal, setErroModal] = useState("");

  async function carregar(p = 1, d = dia, st = statusFiltro) {
    try {
      const r = await tfdExames({ agendada_em: d, status: st || undefined, page: p, limit: 100 });
      setLista(pagData<Exame>(r));
      const m = pagMeta(r);
      setTotal(m.total);
      setPage(m.page);
      setPages(m.pages);
    } catch {
      setErro("Falha ao carregar agenda.");
    }
  }

  useEffect(() => {
    carregar(1, dia, statusFiltro).catch(() => setErro("Falha ao carregar agenda."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dia, statusFiltro]);

  useEffect(() => {
    import("../../services/api").then((m) => {
      m.fetchMedicos().then((r) => setMedicos(r.filter((x) => x.ativo))).catch(() => {});
      m.fetchUnidadesSaude().then((r) => setUnidades(r.filter((x) => x.ativo))).catch(() => {});
    });
  }, []);

  useEffect(() => {
    if (!marcando || busca.trim().length < 2) {
      setCandidatos([]);
      return;
    }
    const t = setTimeout(() => {
      setBuscando(true);
      tfdExames({ status: "aguardando", q: busca.trim(), page: 1, limit: 15 })
        .then((r) => setCandidatos(pagData<Exame>(r)))
        .catch(() => setCandidatos([]))
        .finally(() => setBuscando(false));
    }, 300);
    return () => clearTimeout(t);
  }, [busca, marcando]);

  function abrirMarcacao() {
    setBusca("");
    setCandidatos([]);
    setAlvo(null);
    setDataMarca(dia);
    setHoraMarca("");
    setMedicoId("");
    setUnidadeId("");
    setErroModal("");
    setMarcando(true);
  }

  async function confirmarMarcacao() {
    if (!alvo) {
      setErroModal("Selecione um paciente da fila de espera.");
      return;
    }
    if (!dataMarca) {
      setErroModal("Escolha a data do atendimento.");
      return;
    }
    if (retroativoBloqueado && dataMarca < hojeISO()) {
      setErroModal(RETRO_MSG);
      return;
    }
    if (!medicoId || !unidadeId) {
      setErroModal("Agendamento exige médico e unidade de atendimento.");
      return;
    }
    setSalvando(true);
    try {
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
        status: "agendado",
        data_pedido: (alvo.data_pedido || "").slice(0, 10),
        data_agendada: dataMarca,
        hora_agendada: horaMarca,
        medico_id: Number(medicoId),
        unidade_saude_id: Number(unidadeId),
        destino: alvo.destino,
        observacoes: alvo.observacoes,
        codigo_curto: alvo.codigo_curto ?? "",
      });
      setOk(`Marcado para ${fmtDia(dataMarca)} e vinculado à agenda do dia.`);
      setMarcando(false);
      setAlvo(null);
      setDia(dataMarca);
      await carregar(1, dataMarca, statusFiltro);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? "Erro ao marcar.";
      setErroModal(msg);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 className="font-display text-lg font-bold text-sus-950">Agenda do TFD</h2>
        <span className="rounded-full bg-teal/10 px-2.5 py-0.5 text-xs font-semibold text-teal">
          {total} marcado(s) em {fmtDia(dia)}
        </span>
        <ExportarExcel url="/api/tfd/agenda/exportar" arquivo="agenda_tfd" params={{ dia, status: statusFiltro || undefined }} />
        <Button onClick={abrirMarcacao} className="ml-auto"><Plus className="h-4 w-4" /> Marcar da fila</Button>
      </div>
      <p className="mb-4 mt-1 text-sm text-ink/55">
        Visão diária de agendados + marcação direta de quem está na fila de espera.
      </p>
      {erro && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
      {ok && <p className="mb-3 rounded-xl bg-teal/10 px-3 py-2 text-sm text-teal">{ok}</p>}

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <Label>Dia</Label>
            <Input type="date" value={dia} onChange={(e) => { if (e.target.value) { setDia(e.target.value); setPage(1); } }} />
          </div>
          <div>
            <Label>Status</Label>
            <select value={statusFiltro} onChange={(e) => setStatusFiltro(e.target.value)} className="rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
              <option value="agendado">Marcados</option>
              <option value="">Todos</option>
              <option value="aguardando">Aguardando</option>
              <option value="realizado">Realizados</option>
            </select>
          </div>
          <button
            type="button"
            onClick={() => { setDia(hojeISO()); setPage(1); }}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-sus-900/10 px-4 py-2 text-sm font-bold text-sus-900 hover:bg-sus-900/15"
          >
            <CalendarDays className="h-4 w-4" /> Hoje
          </button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead><tr className="border-b border-sus-900/10 bg-sand text-xs uppercase text-sus-900/60">
              <th className="px-4 py-3">Paciente / CPF</th><th className="px-4 py-3">Especialidade / procedimento</th><th className="px-4 py-3">Local e horário</th><th className="px-4 py-3">Status</th>
            </tr></thead>
            <tbody>
              {lista.map((e) => (
                <tr key={e.id} className="border-b border-sus-900/5 last:border-0">
                  <td className="px-4 py-3 font-semibold">{e.paciente_nome}<p className="text-xs font-normal text-ink/50">{e.paciente_cpf || "—"}</p></td>
                  <td className="px-4 py-3">{e.nome_especialidade || e.especialidade || e.tipo_fila || "—"}<p className="text-xs text-ink/50">{e.exame}</p></td>
                  <td className="px-4 py-3 text-xs">
                    <p className="font-semibold">{e.unidade_nome || e.destino || "—"}</p>
                    <p className="text-ink/50">{e.data_agendada ? fmtDia(e.data_agendada.slice(0, 10)) : "—"}{e.hora_agendada ? ` · ${e.hora_agendada}` : ""}</p>
                  </td>
                  <td className="px-4 py-3 text-xs font-semibold">{e.status}</td>
                </tr>
              ))}
              {lista.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-ink/45">Nada marcado para este dia.</td></tr>}
            </tbody>
          </table>
        </div>
        <Paginacao page={page} pages={pages} total={total} onPage={(p) => carregar(p).catch(() => setErro("Falha ao carregar agenda."))} />
      </Card>

      {marcando && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4" onClick={() => setMarcando(false)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl bg-white p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <p className="font-display text-base font-bold text-sus-950">Marcar paciente da fila</p>
              <button onClick={() => setMarcando(false)} className="rounded-lg p-2 text-ink/50 hover:bg-sand" aria-label="Fechar"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <Label>Buscar na fila de espera (aguardando)</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/40" />
                  <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome, CNS, CPF ou procedimento…" className="pl-10" />
                </div>
                {buscando && <p className="mt-1 text-xs text-ink/45">Buscando…</p>}
                {candidatos.length > 0 && !alvo && (
                  <div className="mt-1 max-h-44 overflow-y-auto rounded-xl border border-sus-900/10">
                    {candidatos.map((c) => (
                      <button key={c.id} onClick={() => { setAlvo(c); setCandidatos([]); }} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-sand">
                        <span><b>{c.paciente_nome}</b> · {c.exame}</span>
                        <span className="text-xs text-ink/50">{rotuloPrioridade(c.prioridade)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {alvo && (
                <p className="rounded-xl bg-teal/10 px-3 py-2 text-sm font-semibold text-teal">
                  {alvo.paciente_nome} · {alvo.exame}
                  <button onClick={() => setAlvo(null)} className="ml-2 text-xs underline">trocar</button>
                </p>
              )}
              <div className="grid gap-3 md:grid-cols-2">
                <div><Label>Data do atendimento *</Label><Input type="date" value={dataMarca} min={retroativoBloqueado ? hojeISO() : undefined} onChange={(e) => setDataMarca(e.target.value)} /></div>
                <div><Label>Hora</Label><Input type="time" value={horaMarca} onChange={(e) => setHoraMarca(e.target.value)} /></div>
                <div>
                  <Label>Médico(a) *</Label>
                  <select value={medicoId} onChange={(e) => setMedicoId(e.target.value)} className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
                    <option value="">Selecionar…</option>
                    {medicos.map((m) => <option key={m.id} value={m.id}>{m.nome}{m.crm ? ` · ${m.crm}` : ""}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Unidade de atendimento *</Label>
                  <select value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)} className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
                    <option value="">Selecionar…</option>
                    {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
                  </select>
                </div>
              </div>
              {erroModal && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erroModal}</p>}
              <Button onClick={confirmarMarcacao} disabled={salvando || !alvo} className="w-full">
                {salvando ? "Marcando…" : `Confirmar marcação em ${fmtDia(dataMarca)}`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
