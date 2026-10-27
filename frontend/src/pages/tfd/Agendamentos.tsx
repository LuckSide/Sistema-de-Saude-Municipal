import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  FileText,
  Layers,
  ListOrdered,
  Plus,
  Printer,
  QrCode,
  RotateCcw,
  Search,
  Sparkles,
  Undo2,
  UserCheck,
  UserX,
  X,
  XCircle,
} from "lucide-react";
import {
  fetchMedicos,
  fetchUnidadesSaude,
  pagData,
  tfdAtendimentoStatus,
  tfdAtendimentoStatusLote,
  tfdAtualizarExame,
  tfdEstornarRecepcaoExame,
  tfdExames,
  tfdRecepcionarExame,
  tfdRecepcionarLote,
  type Exame,
  type Medico,
  type UnidadeSaude,
} from "../../services/api";
import { useAuth } from "../../hooks/useAuth";
import { useUndo } from "../../components/UndoToast";
import { Button, Card, Input, Label } from "../../components/ui/primitives";
import { rotuloPrioridade } from "../../utils/rotulos";
import ExportarExcel from "../../components/ExportarExcel";
import BotaoWhatsApp from "../../components/BotaoWhatsApp";
import ModalLeituraRapidaQR from "../../components/ModalLeituraRapidaQR";
import ComprovanteExameModal from "../../components/ComprovanteExameModal";
import { useBackdropClose } from "../../hooks/useBackdropClose";

type Visao = "mes" | "semana" | "dia";
type Formato = "calendario" | "lista";

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

const NOMES_DIA = ["SEG", "TER", "QUA", "QUI", "SEX", "SÁB", "DOM"];

const COR_STATUS: Record<string, string> = {
  agendado: "bg-blue-100 text-blue-800 border-blue-200",
  recepcionado: "bg-teal/15 text-teal border-teal/30",
  realizado: "bg-emerald-100 text-emerald-800 border-emerald-300",
  faltou: "bg-amber-100 text-amber-800 border-amber-300",
  cancelado: "bg-red-100 text-red-700 border-red-200",
};

const ROTULO_STATUS: Record<string, string> = {
  agendado: "Agendado",
  recepcionado: "Recepcionado",
  realizado: "Realizado",
  faltou: "Faltou",
  cancelado: "Cancelado",
};

export default function Agendamentos() {
  const { user, retroativoBloqueado } = useAuth();
  const { notificarUndo } = useUndo();

  // Modo de exibição: Calendário vs Lista de Atendimento / Recepção
  const [formato, setFormato] = useState<Formato>("calendario");
  const [visao, setVisao] = useState<Visao>("semana");
  const [qtdDias, setQtdDias] = useState<number>(5);
  const [dia, setDia] = useState(hojeISO());
  const [lista, setLista] = useState<Exame[]>([]);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");

  // Filtros avançados
  const [fTipo, setFTipo] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fUnidade, setFUnidade] = useState("");
  const [fMedico, setFMedico] = useState("");
  const [fBusca, setFBusca] = useState("");
  const [medicos, setMedicos] = useState<Medico[]>([]);
  const [unidades, setUnidades] = useState<UnidadeSaude[]>([]);

  // Seleção Múltipla para Recepção e Desfecho em Lote
  const [selMulti, setSelMulti] = useState<number[]>([]);
  const [recepcionandoLote, setRecepcionandoLote] = useState(false);
  const [modalLoteStatus, setModalLoteStatus] = useState<"realizado" | "faltou" | "cancelado" | null>(null);
  const [resultadoLote, setResultadoLote] = useState("");
  const [salvandoLote, setSalvandoLote] = useState(false);

  // Modal de Ação Individual por agendamento
  const [sel, setSel] = useState<Exame | null>(null);
  const [resultado, setResultado] = useState("");
  const [mostraResultado, setMostraResultado] = useState(false);
  const [agindo, setAgindo] = useState(false);
  const [erroModal, setErroModal] = useState("");
  const [modalLeituraQR, setModalLeituraQR] = useState(false);
  const [comprovanteExameId, setComprovanteExameId] = useState<number | null>(null);

  // Modal de Marcação Direta da Fila de Espera
  const [modalAgendarFila, setModalAgendarFila] = useState(false);
  const [buscaFila, setBuscaFila] = useState("");
  const [candidatosFila, setCandidatosFila] = useState<Exame[]>([]);
  const [buscandoFila, setBuscandoFila] = useState(false);
  const [alvoFila, setAlvoFila] = useState<Exame | null>(null);
  const [dataMarca, setDataMarca] = useState(dia);
  const [horaMarca, setHoraMarca] = useState("08:00");
  const [medicoIdMarca, setMedicoIdMarca] = useState("");
  const [unidadeIdMarca, setUnidadeIdMarca] = useState("");
  const [salvandoMarca, setSalvandoMarca] = useState(false);

  const selBackdrop = useBackdropClose(() => setSel(null), !!sel);
  const loteStatusBackdrop = useBackdropClose(() => setModalLoteStatus(null), !!modalLoteStatus);
  const agendarFilaBackdrop = useBackdropClose(() => setModalAgendarFila(false), modalAgendarFila);

  // Cálculo dos dias visíveis em torno da data de referência
  const semanaPills = useMemo(() => {
    if (visao === "dia") return [dia];
    if (visao === "semana") return Array.from({ length: qtdDias }, (_, i) => somaDias(dia, i));
    const [y, m] = dia.slice(0, 7).split("-").map(Number);
    const primeiro = new Date(y, m - 1, 1);
    const desloc = (primeiro.getDay() + 6) % 7;
    const nDias = new Date(y, m, 0).getDate();
    const ini = somaDias(`${y}-${String(m).padStart(2, "0")}-01`, -desloc);
    const totalCells = Math.ceil((desloc + nDias) / 7) * 7;
    return Array.from({ length: totalCells }, (_, i) => somaDias(ini, i));
  }, [dia, visao, qtdDias]);

  const diasVisiveis = useMemo(() => {
    if (visao === "dia") return [dia];
    if (visao === "semana") return semanaPills;
    // Mês: grade completa do mês da referência
    const [y, m] = dia.slice(0, 7).split("-").map(Number);
    const primeiro = new Date(y, m - 1, 1);
    const desloc = (primeiro.getDay() + 6) % 7;
    const nDias = new Date(y, m, 0).getDate();
    const ini = somaDias(`${y}-${String(m).padStart(2, "0")}-01`, -desloc);
    const totalCells = Math.ceil((desloc + nDias) / 7) * 7;
    return Array.from({ length: totalCells }, (_, i) => somaDias(ini, i));
  }, [dia, visao, semanaPills]);

  const carregar = useCallback(async () => {
    setErro("");
    try {
      const de = visao === "mes" ? diasVisiveis[0] : semanaPills[0];
      const ate = visao === "mes" ? diasVisiveis[diasVisiveis.length - 1] : semanaPills[semanaPills.length - 1];
      const r = await tfdExames({
        agendada_de: de,
        agendada_ate: ate,
        apenas_agendados: true,
        page: 1,
        limit: 1000,
      });
      let itens = pagData<Exame>(r);
      // Filtra agendados com data no intervalo visível
      itens = itens.filter((e) => {
        const d = (e.data_agendada || "").slice(0, 10);
        if (!d || d < de || d > ate) return false;
        if (fStatus && e.status !== fStatus) return false;
        if (fTipo && !`${e.tipo_fila} ${e.exame}`.toLowerCase().includes(fTipo.toLowerCase())) return false;
        if (fUnidade && String(e.unidade_saude_id ?? "") !== fUnidade && (e.unidade_nome || "") !== fUnidade) return false;
        if (fMedico && String(e.medico_id ?? "") !== fMedico) return false;
        if (fBusca.trim()) {
          const termo = fBusca.trim().toLowerCase();
          const matchPac = (e.paciente_nome || "").toLowerCase().includes(termo);
          const matchProc = (e.exame || "").toLowerCase().includes(termo);
          const matchCod = (e.codigo_curto || "").toLowerCase().includes(termo);
          if (!matchPac && !matchProc && !matchCod) return false;
        }
        return true;
      });
      itens.sort((a, b) =>
        `${a.data_agendada}${a.hora_agendada}`.localeCompare(`${b.data_agendada}${b.hora_agendada}`),
      );
      setLista(itens);
    } catch {
      setErro("Falha ao carregar agendamentos.");
    }
  }, [diasVisiveis, semanaPills, visao, fStatus, fTipo, fUnidade, fMedico, fBusca]);

  useEffect(() => {
    carregar().catch(() => setErro("Falha ao carregar agendamentos."));
  }, [carregar]);

  useEffect(() => {
    fetchMedicos({ somente_ativos: true }).then(setMedicos).catch(() => {});
    fetchUnidadesSaude().then(setUnidades).catch(() => {});
  }, []);

  // Busca pacientes na fila de espera para agendamento direto
  useEffect(() => {
    if (!modalAgendarFila || buscaFila.trim().length < 2) {
      setCandidatosFila([]);
      return;
    }
    const t = setTimeout(() => {
      setBuscandoFila(true);
      tfdExames({ status: "aguardando", q: buscaFila.trim(), page: 1, limit: 15 })
        .then((r) => setCandidatosFila(pagData<Exame>(r)))
        .catch(() => setCandidatosFila([]))
        .finally(() => setBuscandoFila(false));
    }, 300);
    return () => clearTimeout(t);
  }, [buscaFila, modalAgendarFila]);

  const porDia = useMemo(() => {
    const map = new Map<string, Exame[]>();
    for (const e of lista) {
      const d = (e.data_agendada || "").slice(0, 10);
      if (!d) continue;
      if (!map.has(d)) map.set(d, []);
      map.get(d)!.push(e);
    }
    return map;
  }, [lista]);

  // Lista linear de itens para a visualização em formato de Lista
  const itensListaExibicao = useMemo(() => {
    if (visao === "dia") {
      return porDia.get(dia) ?? [];
    }
    return lista;
  }, [visao, dia, porDia, lista]);

  // Seleção Múltipla
  const todosSelecionados = useMemo(() => {
    if (itensListaExibicao.length === 0) return false;
    return itensListaExibicao.every((it) => selMulti.includes(it.id));
  }, [itensListaExibicao, selMulti]);

  function toggleSel(id: number) {
    setSelMulti((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleTodos() {
    if (todosSelecionados) {
      setSelMulti([]);
    } else {
      setSelMulti(itensListaExibicao.map((x) => x.id));
    }
  }

  // Ação de Recepção em Lote (Requisito 5)
  async function executarRecepcaoLote() {
    if (selMulti.length === 0) return;
    setRecepcionandoLote(true);
    setErro("");
    setOk("");
    try {
      const res = await tfdRecepcionarLote(selMulti);
      setOk(`${res.atualizados} paciente(s) recepcionado(s) com sucesso na unidade!`);
      setSelMulti([]);
      await carregar();
    } catch {
      setErro("Falha ao recepcionar pacientes em lote. Verifique as permissões.");
    } finally {
      setRecepcionandoLote(false);
    }
  }

  // Ação de Status / Desfecho em Lote
  async function executarStatusLote(status: "realizado" | "faltou" | "cancelado") {
    if (selMulti.length === 0) return;
    setSalvandoLote(true);
    setErro("");
    setOk("");
    try {
      const res = await tfdAtendimentoStatusLote(selMulti, status, resultadoLote);
      const rotulo = status === "realizado" ? "concluído(s) como realizado" : status === "faltou" ? "marcado(s) como falta" : "cancelado(s)";
      setOk(`${res.atualizados} atendimento(s) ${rotulo} com sucesso!`);
      setSelMulti([]);
      setModalLoteStatus(null);
      setResultadoLote("");
      await carregar();
    } catch {
      setErro("Falha ao atualizar status em lote.");
    } finally {
      setSalvandoLote(false);
    }
  }

  // Ações Individuais (Modal rápido)
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
      await tfdRecepcionarExame(sel.id);
      setSel(null);
      setOk(`Recepção confirmada para ${sel.paciente_nome}.`);
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
      await tfdEstornarRecepcaoExame(sel.id);
      setSel(null);
      setOk(`Recepção estornada para ${sel.paciente_nome}.`);
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
    const alvo = sel;
    const statusAntes = alvo.status;
    setAgindo(true);
    setErroModal("");
    try {
      await tfdAtendimentoStatus(alvo.id, status, status === "realizado" && resultado.trim() ? resultado.trim() : undefined);
      setSel(null);
      setOk(
        status === "faltou"
          ? `${alvo.paciente_nome} marcado como faltou.`
          : status === "realizado"
          ? `Atendimento realizado registrado p/ ${alvo.paciente_nome}.`
          : `Agendamento de ${alvo.paciente_nome} cancelado.`,
      );
      await carregar();
      if (status === "cancelado") {
        notificarUndo({
          titulo: `Agendamento de ${alvo.paciente_nome} cancelado.`,
          descricao: "Desfazer restaura o status anterior em 5s.",
          onUndo: async () => {
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

  // Agendamento Direto da Fila
  function abrirModalMarcacao() {
    setBuscaFila("");
    setCandidatosFila([]);
    setAlvoFila(null);
    setDataMarca(dia);
    setHoraMarca("08:00");
    setMedicoIdMarca("");
    setUnidadeIdMarca(user?.unidade_saude_id ? String(user.unidade_saude_id) : "");
    setErroModal("");
    setModalAgendarFila(true);
  }

  async function confirmarMarcacaoFila() {
    if (!alvoFila) {
      setErroModal("Selecione um paciente da fila de espera.");
      return;
    }
    if (!dataMarca) {
      setErroModal("Informe a data do agendamento.");
      return;
    }
    if (retroativoBloqueado && dataMarca < hojeISO()) {
      setErroModal("Seu perfil não possui permissão para realizar agendamentos retroativos.");
      return;
    }
    if (!medicoIdMarca || !unidadeIdMarca) {
      setErroModal("Agendamento exige médico e unidade de atendimento.");
      return;
    }

    setSalvandoMarca(true);
    try {
      await tfdAtualizarExame(alvoFila.id, {
        paciente_id: alvoFila.paciente_id,
        exame: alvoFila.exame,
        especialidade: alvoFila.especialidade,
        tipo_fila: alvoFila.tipo_fila,
        codigo_procedimento: alvoFila.codigo_procedimento,
        codigo_especialidade: alvoFila.codigo_especialidade,
        nome_especialidade: alvoFila.nome_especialidade,
        prioridade: alvoFila.prioridade,
        justificativa_prioridade: alvoFila.justificativa_prioridade ?? "",
        justificativa: alvoFila.justificativa || "Agendado diretamente via Agenda.",
        status: "agendado",
        data_pedido: (alvoFila.data_pedido || "").slice(0, 10),
        data_agendada: dataMarca,
        hora_agendada: horaMarca,
        medico_id: Number(medicoIdMarca),
        unidade_saude_id: Number(unidadeIdMarca),
        destino: alvoFila.destino,
        observacoes: alvoFila.observacoes,
        codigo_curto: alvoFila.codigo_curto ?? "",
      });
      setOk(`Agendamento de ${alvoFila.paciente_nome} confirmado para ${fmtDia(dataMarca)} às ${horaMarca}!`);
      setModalAgendarFila(false);
      setAlvoFila(null);
      setDia(dataMarca);
      await carregar();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? "Erro ao agendar paciente.";
      setErroModal(msg);
    } finally {
      setSalvandoMarca(false);
    }
  }

  const tiposUnicos = useMemo(() => {
    const s = new Set(lista.map((e) => (e.tipo_fila || "—").trim() || "—"));
    return [...s].sort();
  }, [lista]);

  const totalVisivel = useMemo(() => {
    return diasVisiveis.reduce((acc, d) => acc + (porDia.get(d)?.length ?? 0), 0);
  }, [diasVisiveis, porDia]);

  const periodoRotulo = useMemo(() => {
    if (visao === "dia") return fmtDia(dia);
    if (visao === "semana") return `${fmtDia(semanaPills[0])} a ${fmtDia(semanaPills[semanaPills.length - 1])}`;
    return `${fmtDia(diasVisiveis[0])} a ${fmtDia(diasVisiveis[diasVisiveis.length - 1])}`;
  }, [visao, dia, semanaPills, diasVisiveis]);

  return (
    <div className="space-y-4">
      {/* Topo: Título, Modo de Visão e Ações Principais */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-xl font-bold text-sus-950 flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-teal" />
              Agenda e Recepção
            </h1>
            <span className="rounded-full bg-teal/10 px-2.5 py-0.5 text-xs font-semibold text-teal">
              {periodoRotulo} · {totalVisivel} atendimento(s)
            </span>
          </div>
          <p className="mt-0.5 text-xs text-ink/60">
            Gerencie agendamentos, recepção com check-in em lote, registro de comparecimentos e desfechos clínicos.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Alternância de Visão: Calendário vs Lista (Requisito 5) */}
          <div className="inline-flex rounded-xl border border-sus-900/15 bg-sand/60 p-1 shadow-2xs">
            <button
              type="button"
              onClick={() => setFormato("calendario")}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition flex items-center gap-1.5 ${
                formato === "calendario"
                  ? "bg-sus-900 text-white shadow-xs"
                  : "text-sus-900 hover:bg-white"
              }`}
            >
              <CalendarDays className="h-3.5 w-3.5" /> Calendário
            </button>
            <button
              type="button"
              onClick={() => setFormato("lista")}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition flex items-center gap-1.5 ${
                formato === "lista"
                  ? "bg-sus-900 text-white shadow-xs"
                  : "text-sus-900 hover:bg-white"
              }`}
            >
              <ClipboardList className="h-3.5 w-3.5" /> Lista de Atendimento / Recepção
            </button>
          </div>

          <Button
            type="button"
            onClick={() => setModalLeituraQR(true)}
            className="border border-teal/40 bg-teal/5 text-teal hover:bg-teal/15 text-xs font-bold flex items-center gap-1.5 !h-9"
          >
            <QrCode className="h-4 w-4" /> Leitura Rápida QR
          </Button>

          <Button
            onClick={abrirModalMarcacao}
            className="bg-teal text-white hover:brightness-110 shadow-xs text-xs font-bold flex items-center gap-1.5"
          >
            <Plus className="h-4 w-4" /> Marcar da Fila
          </Button>

          <Link to="/tfd/relatorio-agendados">
            <Button variant="outline" className="text-xs shadow-xs">
              <FileText className="h-4 w-4 text-ink/70" /> Relatório Gerencial
            </Button>
          </Link>

          <ExportarExcel
            url="/api/tfd/agenda/exportar"
            arquivo="agendamentos"
            rotulo="Exportar Excel"
            params={{ dia }}
          />
        </div>
      </div>

      {erro && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-800">
          {erro}
        </div>
      )}
      {ok && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-800">
          {ok}
        </div>
      )}

      {/* Barra de Filtros e Navegação Temporal */}
      <Card className="p-3.5 space-y-3 shadow-xs">
        {/* Linha 1: Controles de Navegação de Dias e Granularidade */}
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          {/* Seletor Mês / Semana / Dia e Dias Flexíveis */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-1 rounded-xl border border-sus-900/10 bg-sand/50 p-1" title="Período de visualização">
              {(["mes", "semana", "dia"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setVisao(m)}
                  className={`min-h-[36px] rounded-lg px-3.5 py-1 text-xs font-bold transition ${
                    visao === m ? "bg-sus-900 text-white shadow-xs" : "text-sus-900 hover:bg-white"
                  }`}
                >
                  {m === "mes" ? "Mês" : m === "semana" ? "Semana" : "Dia"}
                </button>
              ))}
            </div>

            {/* Seletor dinâmico de quantidade de dias (1, 3, 5, 7) */}
            <div className="inline-flex items-center gap-1 rounded-xl border border-sus-900/10 bg-white p-1 shadow-2xs" title="Dias visíveis na grade">
              <span className="px-2 text-[11px] font-bold text-ink/55">Dias:</span>
              {([1, 3, 5, 7] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => {
                    setQtdDias(n);
                    if (n === 1) setVisao("dia");
                    else setVisao("semana");
                  }}
                  aria-pressed={(visao === "dia" && n === 1) || (visao === "semana" && qtdDias === n)}
                  className={`min-h-[32px] rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                    (visao === "dia" && n === 1) || (visao === "semana" && qtdDias === n)
                      ? "bg-sus-900 text-white shadow-xs"
                      : "text-sus-900 hover:bg-sand"
                  }`}
                >
                  {n}d
                </button>
              ))}
            </div>
          </div>

          {/* Navegação de Datas */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setDia(somaDias(dia, -(visao === "semana" ? qtdDias : visao === "mes" ? 30 : 1)))}
              title="Período anterior"
              className="grid min-h-[36px] min-w-[36px] place-items-center rounded-xl border border-sus-900/10 bg-white text-sus-900 shadow-2xs hover:bg-sand transition"
            >
              <ChevronsLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setDia(somaDias(dia, -1))}
              title="Dia anterior (-1 dia)"
              className="grid min-h-[36px] min-w-[36px] place-items-center rounded-xl border border-sus-900/10 bg-white text-sus-900 shadow-2xs hover:bg-sand transition"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>

            <Input
              type="date"
              value={dia}
              onChange={(e) => e.target.value && setDia(e.target.value)}
              className="!w-auto !min-h-[36px] text-xs font-semibold"
            />

            <button
              type="button"
              onClick={() => setDia(somaDias(dia, 1))}
              title="Próximo dia (+1 dia)"
              className="grid min-h-[36px] min-w-[36px] place-items-center rounded-xl border border-sus-900/10 bg-white text-sus-900 shadow-2xs hover:bg-sand transition"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setDia(somaDias(dia, (visao === "semana" ? qtdDias : visao === "mes" ? 30 : 1)))}
              title="Próximo período"
              className="grid min-h-[36px] min-w-[36px] place-items-center rounded-xl border border-sus-900/10 bg-white text-sus-900 shadow-2xs hover:bg-sand transition"
            >
              <ChevronsRight className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={() => setDia(hojeISO())}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl bg-teal px-3 py-1 text-xs font-bold text-white shadow-2xs hover:brightness-110 transition"
            >
              <CalendarDays className="h-3.5 w-3.5" /> Hoje
            </button>
          </div>
        </div>

        {/* Linha 2: Faixa Semanal de Dias (SEG - DOM) com Contagens (Exibido no Modo Lista; ocultado no Modo Calendário para evitar calendário duplo) */}
        {formato === "lista" && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-0.5">
            {semanaPills.map((d) => {
              const itensDoDia = porDia.get(d) ?? [];
              const ativo = d === dia;
              const ehHoje = d === hojeISO();
              const di = (new Date(`${d}T12:00:00`).getDay() + 6) % 7;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDia(d)}
                  className={`flex min-w-[95px] flex-1 flex-col items-center justify-center rounded-xl border px-2 py-1.5 transition ${
                    ativo
                      ? "border-sus-900 bg-sus-900 text-white shadow-xs font-bold"
                      : ehHoje
                      ? "border-teal/60 bg-teal/5 text-sus-950 font-bold hover:bg-teal/10"
                      : "border-sus-900/10 bg-white text-sus-900 hover:border-sus-900/25"
                  }`}
                >
                  <span className={`text-[10px] uppercase font-bold tracking-wider ${ativo ? "text-white/80" : "text-ink/50"}`}>
                    {NOMES_DIA[di]}
                  </span>
                  <span className="font-display text-xs font-extrabold">{fmtDia(d).slice(0, 5)}</span>
                  <span
                    className={`mt-0.5 rounded-full px-1.5 text-[9px] font-black leading-tight ${
                      ativo
                        ? "bg-white/20 text-white"
                        : itensDoDia.length > 0
                        ? "bg-teal/15 text-teal"
                        : "text-ink/30"
                    }`}
                  >
                    {itensDoDia.length}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Linha 3: Filtros Avançados (Unidade, Status, Médico, Tipo, Busca) */}
        <div className="grid grid-cols-1 gap-2.5 pt-2 border-t border-sus-900/10 sm:grid-cols-2 lg:grid-cols-5">
          {/* Filtro de Unidade (Requisito 4) */}
          <div>
            <Label className="text-[11px] font-bold text-ink/70">Unidade de Saúde (PSF)</Label>
            <select
              value={fUnidade}
              onChange={(e) => setFUnidade(e.target.value)}
              className="mt-1 w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2 text-xs font-medium outline-none transition focus:border-teal"
            >
              <option value="">Todas as unidades</option>
              {unidades.map((u) => (
                <option key={u.id} value={String(u.id)}>
                  {u.nome}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label className="text-[11px] font-bold text-ink/70">Status do Atendimento</Label>
            <select
              value={fStatus}
              onChange={(e) => setFStatus(e.target.value)}
              className="mt-1 w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2 text-xs font-medium outline-none transition focus:border-teal"
            >
              <option value="">Todos os status</option>
              {STATUS_AGENDA.map((s) => (
                <option key={s} value={s}>
                  {ROTULO_STATUS[s]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label className="text-[11px] font-bold text-ink/70">Profissional / Médico</Label>
            <select
              value={fMedico}
              onChange={(e) => setFMedico(e.target.value)}
              className="mt-1 w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2 text-xs font-medium outline-none transition focus:border-teal"
            >
              <option value="">Todos os profissionais</option>
              {medicos.map((m) => (
                <option key={m.id} value={String(m.id)}>
                  {m.nome}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label className="text-[11px] font-bold text-ink/70">Tipo de Procedimento</Label>
            <select
              value={fTipo}
              onChange={(e) => setFTipo(e.target.value)}
              className="mt-1 w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2 text-xs font-medium outline-none transition focus:border-teal"
            >
              <option value="">Todos os tipos</option>
              {tiposUnicos.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label className="text-[11px] font-bold text-ink/70">Busca Textual</Label>
            <div className="relative mt-1">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-ink/40" />
              <input
                type="text"
                value={fBusca}
                onChange={(e) => setFBusca(e.target.value)}
                placeholder="Paciente ou exame…"
                className="w-full rounded-xl border border-sus-900/15 bg-white pl-8 pr-3 py-2 text-xs outline-none transition focus:border-teal"
              />
            </div>
          </div>
        </div>
      </Card>

      {/* ========================================================================= */}
      {/* FORMATO 1: LISTA DE ATENDIMENTO E RECEPÇÃO COM MULTI-SELEÇÃO EM LOTE     */}
      {/* ========================================================================= */}
      {formato === "lista" && (
        <Card className="overflow-hidden shadow-xs">
          {/* Barra Flutuante de Ações em Lote para Recepção (Requisito 5) */}
          {selMulti.length > 0 && (
            <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-sus-900/10 bg-sus-900 px-4 py-2.5 text-xs text-white shadow-md">
              <div className="flex items-center gap-2">
                <span className="font-bold">{selMulti.length} paciente(s) selecionado(s)</span>
                <button
                  type="button"
                  onClick={() => setSelMulti([])}
                  className="rounded-lg bg-white/10 px-2 py-0.5 text-[11px] text-white hover:bg-white/20 transition"
                >
                  Limpar
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  onClick={executarRecepcaoLote}
                  disabled={recepcionandoLote}
                  className="bg-teal text-white hover:brightness-110 text-xs font-bold shadow-xs py-1.5"
                >
                  <UserCheck className="h-4 w-4" />
                  {recepcionandoLote ? "Recepcionando…" : "Recepcionar em Lote"}
                </Button>

                <Button
                  variant="outline"
                  onClick={() => setModalLoteStatus("realizado")}
                  className="border-white/30 text-white hover:bg-white/15 text-xs font-bold py-1.5"
                >
                  <CheckCircle2 className="h-4 w-4 text-emerald-300" /> Marcar Realizado
                </Button>

                <Button
                  variant="outline"
                  onClick={() => setModalLoteStatus("faltou")}
                  className="border-white/30 text-white hover:bg-white/15 text-xs font-bold py-1.5"
                >
                  <UserX className="h-4 w-4 text-amber-300" /> Marcar Faltou
                </Button>
              </div>
            </div>
          )}

          {/* Cabeçalho da Lista */}
          <div className="border-b border-sus-900/10 bg-sand/30 px-4 py-2.5 flex items-center justify-between text-xs">
            <span className="font-display font-bold text-sus-950">
              Pacientes Agendados no Período ({itensListaExibicao.length} registros)
            </span>
            <span className="text-ink/60 text-[11px]">
              Dica: Selecione as caixas para recolher e recepcionar em lote.
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-sus-900/10 bg-sand/60 text-[11px] uppercase font-bold text-sus-900/70">
                  <th className="w-10 px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={todosSelecionados}
                      onChange={toggleTodos}
                      aria-label="Selecionar todos os atendimentos visíveis"
                      className="h-4 w-4 accent-teal rounded cursor-pointer"
                    />
                  </th>
                  <th className="px-3 py-2.5">Horário / Data</th>
                  <th className="px-3 py-2.5">ID Pedido</th>
                  <th className="px-3 py-2.5">Paciente</th>
                  <th className="px-3 py-2.5">Procedimento / Tipo</th>
                  <th className="px-3 py-2.5">Unidade (PSF)</th>
                  <th className="px-3 py-2.5">Profissional</th>
                  <th className="px-3 py-2.5 text-center">Status</th>
                  <th className="px-3 py-2.5 text-right">Ações Rápidas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sus-900/5">
                {itensListaExibicao.map((it) => {
                  const marcada = selMulti.includes(it.id);
                  const isPriorizado = it.prioridade && it.prioridade !== "rotina";
                  return (
                    <tr
                      key={it.id}
                      className={`transition ${marcada ? "bg-teal/5 font-medium" : "hover:bg-sand/20"}`}
                    >
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={marcada}
                          onChange={() => toggleSel(it.id)}
                          className="h-4 w-4 accent-teal rounded cursor-pointer"
                        />
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className="font-bold text-sus-950">
                          {it.hora_agendada || "--:--"}
                        </span>
                        <span className="block text-[10px] text-ink/50">
                          {fmtDia((it.data_agendada || "").slice(0, 10))}
                        </span>
                      </td>
                      <td className="px-3.5 py-3 font-mono text-xs text-ink/70">
                        {it.codigo_curto || `EX-${String(it.id).padStart(6, "0")}`}
                      </td>
                      <td className="px-3.5 py-3">
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-sm text-sus-950">{it.paciente_nome}</p>
                          {isPriorizado && (
                            <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700 leading-tight">
                              Urgente
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3.5 py-3">
                        <p className="font-semibold text-xs text-sus-950">{it.exame}</p>
                        <p className="text-[11px] text-ink/60">{it.tipo_fila || "Eletivo"}</p>
                      </td>
                      <td className="px-3.5 py-3 text-xs text-ink/80">{it.unidade_nome || it.destino || "—"}</td>
                      <td className="px-3.5 py-3 text-xs text-ink/80">{it.medico_nome || "—"}</td>
                      <td className="px-3.5 py-3 text-center whitespace-nowrap">
                        <span
                          className={`inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${
                            COR_STATUS[it.status] || "bg-gray-100 text-gray-800"
                          }`}
                        >
                          {ROTULO_STATUS[it.status] || it.status}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          {it.status === "agendado" && (
                            <button
                              type="button"
                              onClick={() => {
                                setSel(it);
                                acaoRecepcionar();
                              }}
                              className="rounded-lg bg-teal/15 px-2.5 py-1 text-[11px] font-bold text-teal hover:bg-teal/25 transition"
                              title="Confirmar recepção / check-in do paciente"
                            >
                              Recepcionar
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setComprovanteExameId(it.id)}
                            className="rounded-lg p-1.5 text-teal hover:bg-teal/10 transition"
                            title="Comprovante Unificado / QR Code"
                          >
                            <Printer className="h-4 w-4" />
                          </button>
                          <BotaoWhatsApp exameId={it.id} exame={it} tipo="agendamento" variante="compacto" />
                          <Button
                            variant="outline"
                            onClick={() => abrirAcao(it)}
                            className="!px-2 !py-1 text-[11px]"
                          >
                            Opções…
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {itensListaExibicao.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-xs text-ink/60">
                      Nenhum agendamento encontrado para os filtros selecionados neste período.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ========================================================================= */}
      {/* FORMATO 2: VISÃO EM CALENDÁRIO (MÊS / SEMANA / DIA)                       */}
      {/* ========================================================================= */}
      {formato === "calendario" && visao === "mes" && (
        <section className="overflow-x-auto pb-2">
          <div className="mb-1.5 grid grid-cols-7 gap-1.5">
            {NOMES_DIA.map((s) => (
              <p key={s} className="py-1 text-center font-display text-[11px] font-bold uppercase tracking-wide text-sus-900/60">
                {s}
              </p>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {diasVisiveis.map((d) => {
              const itens = porDia.get(d) ?? [];
              const ehHoje = d === hojeISO();
              const foraMes = d.slice(0, 7) !== dia.slice(0, 7);
              const selecionado = d === dia;
              return (
                <div
                  key={d}
                  onClick={() => {
                    setDia(d);
                  }}
                  className={`min-h-[100px] rounded-xl border p-2 transition cursor-pointer ${
                    selecionado
                      ? "border-sus-900 ring-2 ring-sus-900/20 bg-sus-900/[0.02]"
                      : ehHoje
                      ? "border-teal bg-teal/5"
                      : "border-sus-900/10 bg-white hover:border-sus-900/25"
                  } ${foraMes ? "opacity-40" : ""}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className={`font-display text-xs font-extrabold ${ehHoje ? "text-teal" : "text-sus-950"}`}>
                      {d.slice(8, 10)}
                    </span>
                    {itens.length > 0 && (
                      <span className="rounded-full bg-sus-900/10 px-1.5 py-0.2 text-[9px] font-bold text-sus-900">
                        {itens.length}
                      </span>
                    )}
                  </div>
                  <div className="space-y-1">
                    {itens.slice(0, 3).map((e) => (
                      <button
                        key={e.id}
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          abrirAcao(e);
                        }}
                        className="block w-full truncate rounded-md bg-sand/70 px-1.5 py-0.5 text-left text-[10px] font-semibold hover:bg-teal/15 transition"
                        title={`${e.paciente_nome} · ${e.exame} · ${e.hora_agendada || "s/ hora"}`}
                      >
                        {e.hora_agendada ? `${e.hora_agendada} ` : ""}
                        {e.paciente_nome}
                      </button>
                    ))}
                    {itens.length > 3 && (
                      <button
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setDia(d);
                          setVisao("dia");
                        }}
                        className="block w-full rounded-md px-1 py-0.5 text-left text-[10px] font-bold text-teal hover:bg-teal/10"
                      >
                        +{itens.length - 3} ver dia
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {formato === "calendario" && visao !== "mes" && (
        <section
          className={`grid gap-2.5 ${
            visao === "dia" || qtdDias === 1
              ? "grid-cols-1 max-w-2xl mx-auto"
              : qtdDias === 3
              ? "grid-cols-1 md:grid-cols-3"
              : qtdDias === 5
              ? "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5"
              : "grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7"
          }`}
          style={
            visao === "semana" && qtdDias > 1
              ? { gridTemplateColumns: `repeat(${qtdDias}, minmax(0, 1fr))` }
              : undefined
          }
        >
          {diasVisiveis.map((d) => {
            const itens = porDia.get(d) ?? [];
            const di = (new Date(`${d}T12:00:00`).getDay() + 6) % 7;
            const ehHoje = d === hojeISO();
            const selecionado = d === dia;
            return (
              <div
                key={d}
                onClick={() => {
                  if (visao === "semana" && d !== dia) {
                    setDia(d);
                  }
                }}
                className={`flex flex-col rounded-2xl border p-2.5 transition cursor-pointer ${
                  selecionado && visao === "semana"
                    ? "border-sus-900 ring-2 ring-sus-900/20 bg-sus-900/[0.02] shadow-sm"
                    : ehHoje
                    ? "border-teal/60 bg-teal/5 hover:border-teal"
                    : "border-sus-900/10 bg-white hover:border-sus-900/25"
                }`}
              >
                {/* Topo do dia */}
                <div className="mb-2 flex items-center justify-between gap-1.5 border-b border-sus-900/10 pb-1.5">
                  <div className="min-w-0">
                    <span
                      className={`block text-[10px] font-bold uppercase tracking-wider leading-none ${
                        selecionado ? "text-sus-900 font-extrabold" : ehHoje ? "text-teal-700" : "text-ink/60"
                      }`}
                    >
                      {NOMES_DIA[di]}
                    </span>
                    <span className="font-display text-sm font-extrabold text-sus-950 leading-tight">
                      {d.slice(8, 10)}/{d.slice(5, 7)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {ehHoje && (
                      <span className="rounded-full bg-teal/15 px-1.5 py-0.5 text-[9px] font-bold text-teal uppercase">
                        Hoje
                      </span>
                    )}
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold ${
                        selecionado
                          ? "bg-sus-900 text-white"
                          : itens.length > 0
                          ? ehHoje
                            ? "bg-teal text-white"
                            : "bg-sus-900/10 text-sus-900"
                          : "bg-sand text-ink/40"
                      }`}
                    >
                      {itens.length}
                    </span>
                  </div>
                </div>

                {/* Cards de Pacientes */}
                <div className="flex-1 space-y-2">
                  {itens.map((e) => {
                    const isPriorizado = e.prioridade && e.prioridade !== "rotina";
                    return (
                      <button
                        key={e.id}
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          abrirAcao(e);
                        }}
                        className="group block w-full rounded-xl border border-sus-900/15 bg-white p-3 text-left transition-all hover:border-teal hover:shadow-md hover:scale-[1.01]"
                      >
                        <div className="flex items-start justify-between gap-1.5">
                          <p className="flex items-center gap-2 min-w-0 text-sm font-bold text-sus-950">
                            <span className="shrink-0 text-sus-900 font-mono text-xs font-bold">
                              {e.hora_agendada || "--:--"}
                            </span>
                            <span className="truncate font-bold group-hover:text-teal transition">
                              {e.paciente_nome}
                            </span>
                          </p>
                          <span className="shrink-0 rounded bg-sus-900/10 px-1.5 py-0.5 text-[10px] font-mono font-bold text-sus-900">
                            {e.codigo_curto || `EX-${String(e.id).padStart(6, "0")}`}
                          </span>
                        </div>

                        <p className="mt-1 truncate text-xs text-ink/75 font-semibold" title={e.exame}>
                          {e.exame}
                        </p>

                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold leading-none ${
                              COR_STATUS[e.status] ?? "bg-sus-900/10 text-sus-900"
                            }`}
                          >
                            {ROTULO_STATUS[e.status] ?? e.status}
                          </span>

                          {isPriorizado && (
                            <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700 leading-none">
                              Urgente
                            </span>
                          )}

                          <span className="truncate text-[11px] text-ink/60 font-medium max-w-[150px]">
                            {e.unidade_nome || e.destino || "—"}
                          </span>
                        </div>
                      </button>
                    );
                  })}

                  {itens.length === 0 && (
                    <div className="grid place-items-center py-6 text-center">
                      <span className="text-[11px] font-medium text-ink/35">Sem atendimentos</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: AÇÃO RÁPIDA INDIVIDUAL DO ATENDIMENTO                             */}
      {/* ========================================================================= */}
      {sel && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-sus-950/40 p-4"
          {...selBackdrop}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-2 border-b border-sus-900/10 pb-2.5">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-ink/50">
                  Gestão do Atendimento
                </p>
                <h3 className="font-display text-base font-bold text-sus-950">{sel.paciente_nome}</h3>
                <p className="text-xs text-ink/70">
                  {sel.exame} · {fmtDia((sel.data_agendada || "").slice(0, 10))} às {sel.hora_agendada || "s/ horário"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSel(null)}
                className="rounded-lg p-1 text-ink/50 hover:bg-sand"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {erroModal && (
              <p className="mb-3 rounded-lg bg-red-50 p-2 text-xs font-semibold text-red-700">{erroModal}</p>
            )}

            <div className="mb-4 space-y-1.5 text-xs">
              <p>
                <span className="text-ink/60">Status atual:</span>{" "}
                <strong className="uppercase">{ROTULO_STATUS[sel.status] ?? sel.status}</strong>
              </p>
              <p>
                <span className="text-ink/60">Unidade:</span>{" "}
                <strong>{sel.unidade_nome || sel.destino || "Não informada"}</strong>
              </p>
              {sel.medico_nome && (
                <p>
                  <span className="text-ink/60">Médico:</span> <strong>{sel.medico_nome}</strong>
                </p>
              )}
            </div>

            <div className="mb-4 space-y-2">
              <BotaoWhatsApp exameId={sel.id} exame={sel} tipo="agendamento" variante="completo" />
              <Button
                type="button"
                onClick={() => setComprovanteExameId(sel.id)}
                variant="outline"
                className="w-full text-xs font-semibold flex items-center justify-center gap-1.5 border-teal/40 text-teal hover:bg-teal/5 !h-9"
              >
                <Printer className="h-4 w-4" /> Comprovante Unificado / QR Code
              </Button>
            </div>

            <div className="mb-2">
              <button
                type="button"
                onClick={() => setMostraResultado((v) => !v)}
                className="text-xs font-semibold text-teal hover:underline flex items-center gap-1"
              >
                {mostraResultado ? "− Ocultar campo de laudo / observação" : "+ Informar laudo / resultado (opcional)"}
              </button>
            </div>

            {mostraResultado && (
              <div className="mb-4 space-y-1.5">
                <Label className="text-xs font-bold text-sus-950">
                  Resultado / Observações do Atendimento:
                </Label>
                <textarea
                  value={resultado}
                  onChange={(e) => setResultado(e.target.value)}
                  rows={3}
                  placeholder="Descreva o resultado ou laudo emitido..."
                  className="w-full rounded-xl border border-sus-900/15 p-2 text-xs outline-none focus:border-teal"
                />
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-2 border-t border-sus-900/10">
              <button
                type="button"
                onClick={acaoRecepcionar}
                disabled={agindo || sel.status !== "agendado"}
                className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-xl bg-teal/15 px-3 py-1.5 text-xs font-bold text-teal hover:bg-teal/25 disabled:opacity-40 transition"
              >
                <UserCheck className="h-4 w-4" /> Recepcionar / Check-in
              </button>

              <button
                type="button"
                onClick={acaoEstornar}
                disabled={agindo || sel.status !== "recepcionado"}
                className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-xl bg-sus-900/10 px-3 py-1.5 text-xs font-bold text-sus-900 hover:bg-sus-900/15 disabled:opacity-40 transition"
              >
                <RotateCcw className="h-4 w-4" /> Estornar Recepção
              </button>

              <button
                type="button"
                onClick={() => acaoStatus("realizado")}
                disabled={agindo || (sel.status !== "agendado" && sel.status !== "recepcionado")}
                className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-xl bg-emerald-100 px-3 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-200 disabled:opacity-40 transition"
              >
                <CheckCircle2 className="h-4 w-4" /> Marcar Realizado
              </button>

              <button
                type="button"
                onClick={() => acaoStatus("faltou")}
                disabled={agindo || (sel.status !== "agendado" && sel.status !== "recepcionado")}
                className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-xl bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-800 hover:bg-amber-200 disabled:opacity-40 transition"
              >
                <UserX className="h-4 w-4" /> Marcar como Faltou
              </button>

              <button
                type="button"
                onClick={() => acaoStatus("cancelado")}
                disabled={agindo || (sel.status !== "agendado" && sel.status !== "recepcionado")}
                className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-xl bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100 disabled:opacity-40 transition"
              >
                <XCircle className="h-4 w-4" /> Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: CONFIRMAÇÃO DE DESFECHO EM LOTE (REALIZADO / FALTOU)              */}
      {/* ========================================================================= */}
      {modalLoteStatus && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-sus-950/40 p-4"
          {...loteStatusBackdrop}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-2 border-b border-sus-900/10 pb-2.5">
              <h3 className="font-display text-base font-bold text-sus-950">
                {modalLoteStatus === "realizado"
                  ? `Marcar ${selMulti.length} paciente(s) como Realizado`
                  : `Marcar ${selMulti.length} paciente(s) como Faltou`}
              </h3>
              <button
                type="button"
                onClick={() => setModalLoteStatus(null)}
                className="rounded-lg p-1 text-ink/50 hover:bg-sand"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-xs text-ink/70 mb-3">
              Confirma a alteração de status em lote para os <strong>{selMulti.length}</strong> pacientes selecionados?
            </p>

            {modalLoteStatus === "realizado" && (
              <div className="mb-4">
                <Label className="text-xs font-bold text-sus-950">Resultado padrão (opcional):</Label>
                <textarea
                  value={resultadoLote}
                  onChange={(e) => setResultadoLote(e.target.value)}
                  placeholder="Ex: Exame realizado sem intercorrências..."
                  rows={2}
                  className="mt-1 w-full rounded-xl border border-sus-900/15 p-2 text-xs outline-none focus:border-teal"
                />
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setModalLoteStatus(null)} className="text-xs">
                Cancelar
              </Button>
              <Button
                onClick={() => executarStatusLote(modalLoteStatus)}
                disabled={salvandoLote}
                className="bg-teal text-white text-xs font-bold"
              >
                {salvandoLote ? "Salvando…" : "Confirmar Alteração em Lote"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: AGENDAMENTO DIRETO DA FILA DE ESPERA                              */}
      {/* ========================================================================= */}
      {modalAgendarFila && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-sus-950/40 p-4"
          {...agendarFilaBackdrop}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-sus-900/10 pb-3">
              <div>
                <h3 className="font-display text-base font-bold text-sus-950 flex items-center gap-2">
                  <Plus className="h-5 w-5 text-teal" /> Agendar Paciente da Fila de Espera
                </h3>
                <p className="text-xs text-ink/60">
                  Aloque um paciente aguardando na fila diretamente para uma vaga da agenda.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalAgendarFila(false)}
                className="rounded-lg p-1 text-ink/50 hover:bg-sand"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {erroModal && (
              <p className="rounded-lg bg-red-50 p-2 text-xs font-semibold text-red-700">{erroModal}</p>
            )}

            {/* Passo 1: Busca do Paciente na Fila */}
            <div>
              <Label className="text-xs font-bold text-sus-950">
                1. Buscar Paciente na Fila de Espera <span className="text-red-500">*</span>
              </Label>
              <div className="relative mt-1">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-ink/40" />
                <input
                  type="text"
                  value={buscaFila}
                  onChange={(e) => setBuscaFila(e.target.value)}
                  placeholder="Digite o nome do paciente aguardando na fila…"
                  className="w-full rounded-xl border border-sus-900/15 bg-white pl-9 pr-3 py-2 text-xs outline-none focus:border-teal"
                />
              </div>

              {buscandoFila && (
                <p className="mt-1 text-[11px] text-ink/50">Pesquisando na fila de espera…</p>
              )}

              {candidatosFila.length > 0 && !alvoFila && (
                <div className="mt-2 max-h-40 overflow-y-auto rounded-xl border border-sus-900/15 divide-y bg-white">
                  {candidatosFila.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setAlvoFila(c);
                        setCandidatosFila([]);
                      }}
                      className="block w-full text-left p-2.5 hover:bg-teal/5 transition text-xs"
                    >
                      <p className="font-bold text-sus-950">{c.paciente_nome}</p>
                      <p className="text-[10px] text-ink/60">
                        {c.exame} · {c.tipo_fila} · Pedido em {fmtDia((c.data_pedido || "").slice(0, 10))}
                      </p>
                    </button>
                  ))}
                </div>
              )}

              {alvoFila && (
                <div className="mt-2 rounded-xl border border-teal/30 bg-teal/5 p-3 flex items-center justify-between text-xs">
                  <div>
                    <p className="font-bold text-sus-950">{alvoFila.paciente_nome}</p>
                    <p className="text-[11px] text-teal">
                      Procedimento: <strong>{alvoFila.exame}</strong>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAlvoFila(null)}
                    className="text-[11px] font-bold text-red-600 hover:underline"
                  >
                    Trocar paciente
                  </button>
                </div>
              )}
            </div>

            {/* Passo 2: Data e Horário */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-bold text-sus-950">Data do Atendimento</Label>
                <Input
                  type="date"
                  value={dataMarca}
                  onChange={(e) => setDataMarca(e.target.value)}
                  className="mt-1 text-xs"
                  required
                />
              </div>
              <div>
                <Label className="text-xs font-bold text-sus-950">Horário</Label>
                <Input
                  type="time"
                  value={horaMarca}
                  onChange={(e) => setHoraMarca(e.target.value)}
                  className="mt-1 text-xs"
                  required
                />
              </div>
            </div>

            {/* Passo 3: Unidade e Médico */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-bold text-sus-950">Unidade (PSF)</Label>
                <select
                  value={unidadeIdMarca}
                  onChange={(e) => setUnidadeIdMarca(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2 text-xs font-medium text-sus-950 outline-none focus:border-teal"
                  required
                >
                  <option value="">Selecione a unidade…</option>
                  {unidades.map((u) => (
                    <option key={u.id} value={String(u.id)}>
                      {u.nome}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <Label className="text-xs font-bold text-sus-950">Médico(a)</Label>
                <select
                  value={medicoIdMarca}
                  onChange={(e) => setMedicoIdMarca(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2 text-xs font-medium text-sus-950 outline-none focus:border-teal"
                  required
                >
                  <option value="">Selecione o médico…</option>
                  {medicos.map((m) => (
                    <option key={m.id} value={String(m.id)}>
                      {m.nome}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-sus-900/10">
              <Button variant="outline" onClick={() => setModalAgendarFila(false)} className="text-xs">
                Cancelar
              </Button>
              <Button
                onClick={confirmarMarcacaoFila}
                disabled={salvandoMarca || !alvoFila}
                className="bg-teal text-white text-xs font-bold"
              >
                {salvandoMarca ? "Agendando…" : "Confirmar Agendamento"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {modalLeituraQR && (
        <ModalLeituraRapidaQR
          onClose={() => setModalLeituraQR(false)}
          onRecepcaoSucesso={() => carregar()}
        />
      )}

      {comprovanteExameId && (
        <ComprovanteExameModal
          exameId={comprovanteExameId}
          onClose={() => setComprovanteExameId(null)}
        />
      )}
    </div>
  );
}
