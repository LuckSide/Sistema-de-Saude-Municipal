import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { createPortal } from "react-dom";
import { AlertTriangle, Building2, Calendar, CheckCircle2, Copy, Download, Eye, MapPin, Pencil, Plus, Printer, QrCode, RefreshCw, Search, Stethoscope, Trash2, X } from "lucide-react";
import {
  tfdAtualizarExame,
  tfdAtualizarExamesLote,
  tfdBuscarPacientesPec,
  tfdCatalogoExames,
  tfdConsultarExamePublico,
  tfdCriarExame,
  tfdExameDetalhe,
  tfdExames,
  tfdExcluirExame,
  tfdFiltrosOpcoes,
  tfdPacientes,
  tfdRegenerarTokenExame,
  validarCboProcedimento,
  type ValidarCboResult,
  pagData,
  pagMeta,
  sigtapCbos,
  type CatalogoProc,
  type Exame,
  type FilaExamesParams,
  type OpcaoFiltro,
  type Paciente,
  type PacientePec,
  type SigtapCbo,
  fetchMedicos,
  fetchUnidadesSaude,
  type Medico,
  type UnidadeSaude,
} from "../../services/api";
import { useAuth } from "../../hooks/useAuth";
import { useUndo } from "../../components/UndoToast";
import { Button, Card, Input, Label } from "../../components/ui/primitives";
import Timeline from "../../components/Timeline";
import { Combobox, type ComboOption } from "../../components/ui/combobox";
import Paginacao from "../../components/Paginacao";
import ExportarExcel from "../../components/ExportarExcel";
import PerfilPaciente from "../../components/PerfilPaciente";
import BotaoWhatsApp from "../../components/BotaoWhatsApp";
import { PRIO_ROTULO } from "../../utils/rotulos";

const STATUS = ["aguardando", "agendado", "realizado", "cancelado"];
const PRIOS = ["rotina", "urgente"];
const JUST_MIN = 12;
const GENERICO_UNIDADE = "GENERICO_UNIDADE";

function acharMedicoGenerico(meds: Medico[]): Medico | undefined {
  return meds.find((m) => {
    const n = (m.nome || "").toLowerCase();
    return (
      n.includes("responsável técnico") ||
      n.includes("responsavel tecnico") ||
      n.includes("médico da unidade") ||
      n.includes("medico da unidade")
    );
  });
}

function hoje(): string {
  return new Date().toISOString().slice(0, 10);
}

function novoForm(unidadePadraoId?: string | number | null, medicoPadraoId?: string | number | null) {
  return {
    paciente_id: "",
    exame: "",
    codigo_curto: "",
    justificativa: "",
    // Número do Pedido (identificação operacional; o nº oficial segue sendo o id).
    numero_pedido: "",
    especialidade: "",
    tipo_fila: "ELETIVO",
    codigo_procedimento: "",
    codigo_especialidade: "",
    nome_especialidade: "",
    prioridade: "rotina",
    justificativa_prioridade: "",
    status: "aguardando",
    data_pedido: hoje(),
    data_agendada: "",
    hora_agendada: "",
    medico_id: medicoPadraoId ? String(medicoPadraoId) : GENERICO_UNIDADE,
    unidade_saude_id: unidadePadraoId ? String(unidadePadraoId) : "",
    destino: "",
    observacoes: "",
  };
}

function fmtData(s: string | null | undefined): string {
  if (!s || typeof s !== "string") return "—";
  const base = s.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(base)) return "—";
  return base.split("-").reverse().join("/");
}

function tempoEspera(s: string | null | undefined): string {
  if (!s || typeof s !== "string") return "";
  const base = s.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(base)) return "";
  const [ano, mes, dia] = base.split("-").map(Number);
  const data = new Date(ano, mes - 1, dia);
  if (isNaN(data.getTime())) return "";
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const diffMs = hoje.getTime() - data.getTime();
  const dias = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (dias < 0) return "";
  if (dias === 0) return "hoje";
  if (dias === 1) return "1 dia";
  if (dias < 30) return `${dias} dias`;
  const meses = Math.floor(dias / 30.4375);
  if (meses < 12) return `${meses} ${meses === 1 ? "mês" : "meses"}`;
  const anos = Math.floor(dias / 365.25);
  const mesesResto = Math.floor((dias % 365.25) / 30.4375);
  return mesesResto > 0 ? `${anos}a ${mesesResto}m` : `${anos} ${anos === 1 ? "ano" : "anos"}`;
}

function nomeLimpo(exame: string): string {
  const s = (exame || "").trim();
  const m = s.match(/^[0-9.\-]{4,}\s*-\s*(.+)$/);
  return (m ? m[1] : s).trim() || s;
}

/** Rótulo da posição na fila específica (tipo p/ exames, especialidade p/ consultas). */
function rotuloPosicao(e: { posicao?: number | null; grupo_fila?: string }): string {
  if (!e.posicao) return "";
  const onde = e.grupo_fila ? ` na fila ${e.grupo_fila}` : "";
  return `${e.posicao}º${onde}`;
}

function sigtapDe(exame: string): string {
  const s = (exame || "").trim();
  const m = s.match(/^([0-9.\-]{4,})\s*-/);
  return m ? m[1].trim() : "";
}

function baseAcompanhar(): string {
  const env = (import.meta as any).env?.VITE_PUBLIC_URL as string | undefined;
  if (env) return env.replace(/\/$/, "");
  return window.location.origin;
}

function qrUrl(link: string): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(link)}`;
}

export default function FilaExames() {
  const { user, isMedico, podeAlterarPrioridade, retroativoBloqueado, isLancamentoRestrito } = useAuth();
  const { notificarUndo } = useUndo();
  const RETRO_MSG = "Seu perfil não possui permissão para realizar lançamentos com datas retroativas.";
  const hojeISO = () => new Date().toISOString().slice(0, 10);
  const ehRetroativa = (d: string) => !!d && d < hojeISO();
  const [lista, setLista] = useState<Exame[]>([]);
  const [sp] = useSearchParams();
  const [soMeus, setSoMeus] = useState(false);
  const [filtro, setFiltro] = useState("aguardando");
  const [q, setQ] = useState("");
  const [prio, setPrio] = useState("");
  const [tipoFila, setTipoFila] = useState("");
  const [proc, setProc] = useState("");
  const [espCbo, setEspCbo] = useState("");
  const [opTipos, setOpTipos] = useState<OpcaoFiltro[]>([]);
  const [opProcs, setOpProcs] = useState<OpcaoFiltro[]>([]);
  const [opEsps, setOpEsps] = useState<OpcaoFiltro[]>([]);
  const [dest, setDest] = useState("");
  const [filtroUnidadeId, setFiltroUnidadeId] = useState("");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(novoForm());
  const [pacientesPec, setPacientesPec] = useState<PacientePec[]>([]);
  const [pacientesLocais, setPacientesLocais] = useState<Paciente[]>([]);
  const [pacienteSelecionado, setPacienteSelecionado] = useState<Paciente | PacientePec | null>(null);
  const [buscaPac, setBuscaPac] = useState("");
  const [buscaDebounce, setBuscaDebounce] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [catalogo, setCatalogo] = useState<CatalogoProc[]>([]);
  const [buscaExame, setBuscaExame] = useState("");
  const [buscaExameDeb, setBuscaExameDeb] = useState("");
  const [exameFoco, setExameFoco] = useState(false);
  const [catLoading, setCatLoading] = useState(false);
  const [valCbo, setValCbo] = useState<ValidarCboResult | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(""), 4000);
    return () => window.clearTimeout(t);
  }, [toast]);
  const [removerAlvo, setRemoverAlvo] = useState<Exame | null>(null);
  const [removerMotivo, setRemoverMotivo] = useState("");
  const [removendo, setRemovendo] = useState(false);
  const [comprovante, setComprovante] = useState<Exame | null>(null);
  const [detalhe, setDetalhe] = useState<Exame | null>(null);
  const [perfilId, setPerfilId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [filtrosAvancados, setFiltrosAvancados] = useState(false);
  const [ordem, setOrdem] = useState<"prioridade" | "cronologica">("prioridade");
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [sel, setSel] = useState<number[]>([]);
  const [loteModal, setLoteModal] = useState<"agendar" | "status" | "editar" | null>(null);
  const [loteForm, setLoteForm] = useState({ data_agendada: "", hora_agendada: "", medico_id: "", unidade_id: "", destino: "", status: "", prioridade: "", justificativa: "", observacoes: "" });
  const [loteSalvando, setLoteSalvando] = useState(false);
  const [medicos, setMedicos] = useState<Medico[]>([]);
  const medGenerico = useMemo(() => acharMedicoGenerico(medicos), [medicos]);
  const [medicosErro, setMedicosErro] = useState("");
  const [cbos, setCbos] = useState<SigtapCbo[]>([]);
  const [mostrarAgendamento, setMostrarAgendamento] = useState(false);
  const [unidades, setUnidades] = useState<UnidadeSaude[]>([]);
  const [confirmandoLote, setConfirmandoLote] = useState(false);

  // Modo de visualização da fila: por tipo de fila, por especialidade ou simultâneo (ambas)
  const [modoVisualizacao, setModoVisualizacao] = useState<"tipo" | "especialidade" | "ambas">("ambas");
  // Modal de seleção de colunas para exportação
  const [exportModal, setExportModal] = useState(false);
  const [exportarApenasSel, setExportarApenasSel] = useState(false);
  const COLUNAS_EXPORTACAO = [
    { id: "codigo_curto", label: "ID do Pedido", padrao: true },
    { id: "posicao", label: "Posição", padrao: true },
    { id: "posicao_tipo", label: "Posição Geral da Fila SUS", padrao: true },
    { id: "posicao_especialidade", label: "Posição Especialidade", padrao: true },
    { id: "prioridade", label: "Prioridade / Classificação de risco", padrao: true },
    { id: "status", label: "Status", padrao: true },
    { id: "data_pedido", label: "Data do Envio para Fila", padrao: true },
    { id: "exame", label: "Procedimento", padrao: true },
    { id: "especialidade", label: "Especialidade", padrao: true },
    { id: "prontuario", label: "Prontuário", padrao: true },
    { id: "paciente", label: "Paciente", padrao: true },
    { id: "cpf", label: "CPF", padrao: true },
    { id: "cns", label: "Cartão SUS / CNS", padrao: true },
    { id: "logradouro", label: "Logradouro", padrao: true },
    { id: "numero", label: "Número", padrao: true },
    { id: "bairro", label: "Bairro", padrao: true },
    { id: "complemento", label: "Complemento", padrao: false },
    { id: "municipio", label: "Município", padrao: false },
    { id: "cep", label: "CEP", padrao: false },
    { id: "telefone", label: "Telefone", padrao: false },
    { id: "endereco_completo", label: "Endereço Completo", padrao: false },
    { id: "codigo_procedimento", label: "Código do Procedimento", padrao: false },
    { id: "tipo_fila", label: "Fila específica", padrao: false },
    { id: "data_agendada", label: "Data Agendada", padrao: false },
    { id: "destino", label: "Destino/Unidade", padrao: false },
    { id: "observacoes", label: "Observações", padrao: false },
    { id: "numero_pedido", label: "Nº do Pedido", padrao: false },
    { id: "justificativa", label: "Justificativa", padrao: false },
  ];
  const [colunasExport, setColunasExport] = useState<string[]>(
    COLUNAS_EXPORTACAO.filter((c) => c.padrao).map((c) => c.id)
  );

  const idsVisiveis = useMemo(() => lista.map((e) => e.id), [lista]);
  const todosVisiveis = idsVisiveis.length > 0 && idsVisiveis.every((id) => sel.includes(id));
  const algunsVisiveis = idsVisiveis.some((id) => sel.includes(id));

  const medicosFiltrados = useMemo(() => {
    const ativos = medicos.filter((m) => m.ativo);
    if (!form.unidade_saude_id) {
      return { daUnidade: ativos, outros: [], temFiltro: false };
    }
    const uid = Number(form.unidade_saude_id);
    const daUnidade = ativos.filter((m) => m.unidades_ids && m.unidades_ids.includes(uid));
    const outros = ativos.filter((m) => !m.unidades_ids || !m.unidades_ids.includes(uid));
    return { daUnidade, outros, temFiltro: true };
  }, [medicos, form.unidade_saude_id]);

  const opcoesUnidades = useMemo<ComboOption[]>(() => {
    return unidades.filter((u) => u.ativo).map((u) => ({
      value: String(u.id),
      label: u.nome,
      sub: u.cnes ? `CNES: ${u.cnes}` : undefined,
    }));
  }, [unidades]);

  const opcoesMedicos = useMemo<ComboOption[]>(() => {
    const opts: ComboOption[] = [
      {
        value: GENERICO_UNIDADE,
        label: "🏥 Médico da Unidade / Responsável Técnico",
        sub: "Padrão da rede municipal",
      },
    ];
    if (medicosFiltrados.temFiltro && medicosFiltrados.daUnidade.length > 0) {
      medicosFiltrados.daUnidade.forEach((m) => {
        if (!m.nome.includes("Responsável Técnico") && !m.nome.includes("Médico da Unidade")) {
          opts.push({
            value: String(m.id),
            label: `⭐ ${m.nome}`,
            sub: m.crm ? `CRM: ${m.crm}${m.cbo_codigo ? ` · CBO: ${m.cbo_codigo}` : ""}` : undefined,
          });
        }
      });
      medicosFiltrados.outros.forEach((m) => {
        if (!m.nome.includes("Responsável Técnico") && !m.nome.includes("Médico da Unidade")) {
          opts.push({
            value: String(m.id),
            label: m.nome,
            sub: m.crm ? `CRM: ${m.crm}${m.cbo_codigo ? ` · CBO: ${m.cbo_codigo}` : ""}` : undefined,
          });
        }
      });
    } else {
      medicos.filter((m) => m.ativo).forEach((m) => {
        if (!m.nome.includes("Responsável Técnico") && !m.nome.includes("Médico da Unidade")) {
          opts.push({
            value: String(m.id),
            label: m.nome,
            sub: m.crm ? `CRM: ${m.crm}${m.cbo_codigo ? ` · CBO: ${m.cbo_codigo}` : ""}` : undefined,
          });
        }
      });
    }
    return opts;
  }, [medicos, medicosFiltrados]);

  function toggleUm(id: number) {
    setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }
  function toggleTodos() {
    setSel((s) => (todosVisiveis ? s.filter((id) => !idsVisiveis.includes(id)) : [...new Set([...s, ...idsVisiveis])]));
  }
  function abrirLote(kind: "agendar" | "status" | "editar") {
    setErro("");
    setLoteForm({ data_agendada: "", hora_agendada: "", medico_id: "", unidade_id: "", destino: "", status: "", prioridade: "", justificativa: "", observacoes: "" });
    setLoteModal(kind);
  }
  async function salvarLote() {
    if (sel.length === 0) return;
    setLoteSalvando(true);
    setErro("");
    try {
      const payload: Record<string, unknown> = { ids: sel };
      if (loteModal === "agendar") {
        if (!loteForm.data_agendada && !loteForm.destino.trim() && !loteForm.unidade_id) {
          setErro("Informe data agendada e/ou unidade/destino.");
          setLoteSalvando(false);
          return;
        }
        if (retroativoBloqueado && loteForm.data_agendada && ehRetroativa(loteForm.data_agendada)) {
          setErro(RETRO_MSG);
          setLoteSalvando(false);
          return;
        }
        if (loteForm.data_agendada && (!loteForm.medico_id || !loteForm.unidade_id)) {
          setErro("Agendamento exige médico e unidade de atendimento (PSF).");
          setLoteSalvando(false);
          return;
        }
        if (loteForm.data_agendada) payload.data_agendada = loteForm.data_agendada;
        if (loteForm.hora_agendada) payload.hora_agendada = loteForm.hora_agendada;
        if (loteForm.medico_id) {
          const mid = loteForm.medico_id === GENERICO_UNIDADE ? (medGenerico?.id ?? null) : Number(loteForm.medico_id);
          if (mid) payload.medico_id = mid;
        }
        if (loteForm.unidade_id) {
          payload.unidade_saude_id = Number(loteForm.unidade_id);
          const u = unidades.find((x) => String(x.id) === loteForm.unidade_id);
          if (u && !loteForm.destino.trim()) payload.destino = u.nome;
        }
        if (loteForm.destino.trim()) payload.destino = loteForm.destino.trim();
        payload.status = "agendado";
      } else if (loteModal === "status") {
        if (!loteForm.status) {
          setErro("Escolha o novo status.");
          setLoteSalvando(false);
          return;
        }
        payload.status = loteForm.status;
      } else {
        if (!loteForm.prioridade && !loteForm.observacoes.trim()) {
          setErro("Informe prioridade e/ou observações.");
          setLoteSalvando(false);
          return;
        }
        if (loteForm.prioridade) {
          if (loteForm.justificativa.trim().length < 12) {
            setErro("A justificativa deve conter no mínimo 12 caracteres.");
            setLoteSalvando(false);
            return;
          }
          payload.prioridade = loteForm.prioridade;
          payload.justificativa_prioridade = loteForm.justificativa.trim();
        }
        if (loteForm.observacoes.trim()) payload.observacoes = loteForm.observacoes.trim();
      }
      const anteriores = lista
        .filter((x) => sel.includes(x.id))
        .map((x) => ({ ...x }));
      const r = await tfdAtualizarExamesLote(payload as { ids: number[] });
      setLoteModal(null);
      setConfirmandoLote(false);
      setSel([]);
      await carregar();
      carregarOpcoes().catch(() => {});
      if (anteriores.length > 0) {
        const rotuloLote = loteModal === "agendar" ? "agendados" : loteModal === "status" ? "status alterado" : "modificados";
        notificarUndo({
          titulo: `${r.atualizados} pedido(s) ${rotuloLote} em lote.`,
          descricao: "Desfazer restaura os valores anteriores de cada pedido.",
          onUndo: async () => {
            for (const a of anteriores) {
              await tfdAtualizarExame(a.id, {
                paciente_id: a.paciente_id, exame: a.exame,
                especialidade: a.especialidade, tipo_fila: a.tipo_fila,
                codigo_procedimento: a.codigo_procedimento ?? "",
                codigo_especialidade: a.codigo_especialidade ?? "",
                nome_especialidade: a.nome_especialidade ?? "",
                prioridade: a.prioridade,
                justificativa_prioridade: a.justificativa_prioridade ?? "",
                status: a.status, data_pedido: a.data_pedido,
                data_agendada: a.data_agendada,
                hora_agendada: a.hora_agendada ?? "",
                medico_id: a.medico_id ?? null,
                unidade_saude_id: a.unidade_saude_id ?? null,
                destino: a.destino ?? "",
                observacoes: a.observacoes ?? "",
                codigo_curto: a.codigo_curto ?? "",
              }).catch(() => null);
            }
            await carregar();
          },
        });
      } else {
        setOk(`${r.atualizados} pedido(s) atualizado(s).`);
      }
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? "Erro ao atualizar em lote.";
      setErro(msg);
    } finally {
      setLoteSalvando(false);
    }
  }

  async function carregar(p = page, over?: { tipo?: string; proc?: string; esp?: string; meus?: boolean; ordenacao?: string }) {
    const tipoAtual = over?.tipo !== undefined ? over.tipo : tipoFila;
    const procAtual = over?.proc !== undefined ? over.proc : proc;
    const espAtual = over?.esp !== undefined ? over.esp : espCbo;
    const meusAtual = over?.meus !== undefined ? over.meus : soMeus;
    const ordAtual = over?.ordenacao !== undefined ? over.ordenacao : ordem;
    const params: FilaExamesParams = {
      status: filtro || undefined,
      meus: meusAtual || undefined,
      q: q.trim() || undefined,
      prioridade: prio || undefined,
      tipo_fila: tipoAtual.trim() || undefined,
      procedimento: procAtual.trim() || undefined,
      codigo_especialidade: espAtual.trim() || undefined,
      destino: dest.trim() || undefined,
      unidade_id: filtroUnidadeId ? Number(filtroUnidadeId) : undefined,
      data_de: de || undefined,
      data_ate: ate || undefined,
      ordenacao: ordAtual,
      page: p,
      limit: 100,
    };
    setCarregando(true);
    setErro("");
    try {
      const r = await tfdExames(params);
      setLista(pagData<Exame>(r));
      const m = pagMeta(r);
      setTotal(m.total);
      setPage(m.page);
      setPages(m.pages);
    } catch (e: unknown) {
      console.error("Erro ao carregar fila de procedimentos:", e);
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Falha ao carregar fila de procedimentos.";
      setErro(msg);
      setLista([]);
    } finally {
      setCarregando(false);
    }
  }

  async function carregarOpcoes(st = filtro, tf = tipoFila) {
    try {
      const o = await tfdFiltrosOpcoes(st || undefined, tf || undefined);
      setOpTipos(o.tipos ?? []);
      setOpProcs(o.procedimentos ?? []);
      setOpEsps(o.especialidades ?? []);
      return o;
    } catch {
      setOpTipos([]);
      setOpProcs([]);
      setOpEsps([]);
      return { tipos: [], procedimentos: [], especialidades: [] };
    }
  }

  useEffect(() => {
    carregarOpcoes(filtro, tipoFila).then((novas) => {
      if (espCbo && novas?.especialidades) {
        const existe = novas.especialidades.some((e) => e.value === espCbo);
        if (!existe) {
          setEspCbo("");
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipoFila]);

  useEffect(() => {
    // Marca o body durante a impressão p/ CSS isolar só o comprovante.
    document.body.classList.toggle("imprimindo-comprovante", !!comprovante);
    return () => document.body.classList.remove("imprimindo-comprovante");
  }, [comprovante]);

  useEffect(() => {
    setPage(1);
    setSel([]);
    carregar(1).catch(() => setErro("Falha ao carregar fila."));
    carregarOpcoes().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtro]);

  useEffect(() => {
    tfdPacientes("").then((r) => setPacientesLocais(pagData<Paciente>(r))).catch(() => {});
  }, []);

  useEffect(() => {
    const rid = Number(sp.get("registro") || sp.get("id"));
    const sq = sp.get("q");
    if (sq && !q) {
      setQ(sq);
      setFiltro("");
    }
    if (!rid || detalhe) return;
    const found = lista.find((x) => x.id === rid);
    if (found) {
      setDetalhe(found);
    } else {
      tfdExameDetalhe(rid).then((item) => {
        if (item) setDetalhe(item);
      }).catch(() => {});
    }
  }, [sp, lista, detalhe, q]);

  useEffect(() => {
    const t = setTimeout(() => setBuscaDebounce(buscaPac), 250);
    return () => clearTimeout(t);
  }, [buscaPac]);

  useEffect(() => {
    const t = setTimeout(() => setBuscaExameDeb(buscaExame), 200);
    return () => clearTimeout(t);
  }, [buscaExame]);

  useEffect(() => {
    // Abre modal já com catálogo; foco/clica só exibe, digitar refina via API + filtro local.
    if (!modal) return;
    let vivo = true;
    setCatLoading(true);
    tfdCatalogoExames(buscaExameDeb || undefined, form.tipo_fila || undefined, undefined)
      .then((r) => vivo && setCatalogo(r))
      .catch(() => vivo && setCatalogo([]))
      .finally(() => vivo && setCatLoading(false));
    return () => {
      vivo = false;
    };
  }, [buscaExameDeb, modal, form.tipo_fila]);

  useEffect(() => {
    const cod = form.codigo_procedimento || sigtapDe(form.exame);
    if (!cod || !modal) {
      setValCbo(null);
      return;
    }
    const t = setTimeout(() => {
      const nomeMed =
        form.medico_id === GENERICO_UNIDADE
          ? "Médico da Unidade / Responsável Técnico"
          : medicos.find((m) => m.id === Number(form.medico_id))?.nome || undefined;
      validarCboProcedimento({
        codigo_procedimento: cod,
        medico_id: form.medico_id && form.medico_id !== GENERICO_UNIDADE ? Number(form.medico_id) : undefined,
        medico_nome: nomeMed,
        tipo_fila: form.tipo_fila || undefined,
      })
        .then(setValCbo)
        .catch(() => setValCbo(null));
    }, 250);
    return () => clearTimeout(t);
  }, [form.codigo_procedimento, form.exame, form.medico_id, form.tipo_fila, modal]);

  useEffect(() => {
    if (!buscaDebounce || buscaDebounce.trim().length < 1) {
      setPacientesPec([]);
      return;
    }
    let vivo = true;
    setBuscando(true);
    const termo = buscaDebounce.trim();

    Promise.allSettled([
      tfdBuscarPacientesPec(termo),
      tfdPacientes(termo, 1, 50),
    ])
      .then(([resPec, resLocais]) => {
        if (!vivo) return;
        const combinados: PacientePec[] = [];
        const idsVistos = new Set<number>();

        if (resLocais.status === "fulfilled") {
          const locais = pagData<Paciente>(resLocais.value);
          setPacientesLocais(locais);
          for (const l of locais) {
            if (l.id && !idsVistos.has(l.id)) {
              idsVistos.add(l.id);
              combinados.push({
                id: l.id,
                origem: "local",
                nome: l.nome,
                cns: l.cns || "",
                cpf: l.cpf || "",
                prontuario: "",
                nascimento: l.nascimento || null,
              });
            }
          }
        }

        if (resPec.status === "fulfilled" && resPec.value?.resultados) {
          for (const p of resPec.value.resultados) {
            if (p.id && idsVistos.has(p.id)) continue;
            if (p.id) idsVistos.add(p.id);
            combinados.push(p);
          }
        }

        setPacientesPec(combinados);
      })
      .finally(() => {
        if (vivo) setBuscando(false);
      });

    return () => {
      vivo = false;
    };
  }, [buscaDebounce]);

  // CBO SIGTAP do procedimento selecionado p/ o médico do agendamento.
  useEffect(() => {
    if (!modal || !mostrarAgendamento) return;
    const cod = (form.codigo_procedimento || sigtapDe(form.exame) || "").replace(/\D/g, "");
    if (!cod) { setCbos([]); return; }
    let vivo = true;
    sigtapCbos(cod).then((r) => vivo && setCbos(r)).catch(() => vivo && setCbos([]));
    return () => { vivo = false; };
  }, [modal, mostrarAgendamento, form.codigo_procedimento, form.exame]);

  function aplicarFiltros(e?: React.FormEvent) {
    e?.preventDefault();
    setErro("");
    setPage(1);
    carregar(1).catch(() => setErro("Falha ao carregar fila."));
  }

  function escolherExame(c: CatalogoProc) {
    setForm((f) => ({
      ...f,
      exame: c.exame,
      especialidade: c.especialidade || c.nome_especialidade || f.especialidade,
      tipo_fila: c.tipo_fila || f.tipo_fila,
      codigo_procedimento: c.codigo_procedimento || sigtapDe(c.exame) || f.codigo_procedimento,
      codigo_especialidade: c.codigo_especialidade || f.codigo_especialidade,
      nome_especialidade: c.nome_especialidade || c.especialidade || f.nome_especialidade,
      codigo_curto: c.codigo_curto || f.codigo_curto,
    }));
    setBuscaExame("");
    setBuscaExameDeb("");
    setExameFoco(false);
  }

  // Opções vindas do backend com contagem: Tipo / Procedimento / Especialidade-CBO.
  function paraCombo(lista: OpcaoFiltro[]): ComboOption[] {
    return (lista ?? []).map((o) => ({
      value: o.value,
      label: o.label,
      keywords: `${o.value} ${o.label}`,
    }));
  }
  const opcoesTipo = useMemo(() => paraCombo(opTipos), [opTipos]);
  const opcoesProc = useMemo(() => paraCombo(opProcs), [opProcs]);
  const opcoesEsp = useMemo(() => paraCombo(opEsps), [opEsps]);

  useEffect(() => {
    // Opções com contagem p/ Tipo / Procedimento / CBO ao abrir a tela.
    carregarOpcoes("aguardando").catch(() => {});
    fetchMedicos({ somente_ativos: true })
      .then((m) => { setMedicos(m); setMedicosErro(""); })
      .catch(() => { setMedicos([]); setMedicosErro("Falha ao carregar médicos. Confira o cadastro em Médicos/profissionais."); });
    fetchUnidadesSaude().then(setUnidades).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Catálogo alimenta autocomplete do modal mesmo antes de abrir.
    tfdCatalogoExames().then(setCatalogo).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filtro local imediato: dropdown responde a cada tecla mesmo antes da API voltar.
  const opcoesFiltradas = useMemo(() => {
    let list = catalogo;
    if (form.tipo_fila?.trim()) {
      const tfNorm = form.tipo_fila.trim().toUpperCase();
      const porTipo = catalogo.filter((c) => (c.tipo_fila || "").toUpperCase() === tfNorm);
      if (porTipo.length > 0) list = porTipo;
    }
    const t = buscaExame.trim().toLowerCase();
    if (!t) return list;
    return list.filter((c) =>
      `${c.codigo_curto} ${c.codigo_procedimento} ${c.exame} ${c.especialidade} ${nomeLimpo(c.exame)}`.toLowerCase().includes(t)
    );
  }, [buscaExame, catalogo, form.tipo_fila]);

  const procsDoTipo = useMemo(() => {
    if (!form.tipo_fila?.trim()) return catalogo;
    const tfNorm = form.tipo_fila.trim().toUpperCase();
    return catalogo.filter((c) => (c.tipo_fila || "").toUpperCase() === tfNorm);
  }, [catalogo, form.tipo_fila]);

  const especialidadesDoTipo = useMemo(() => {
    const mapa = new Map<string, { nome: string; cbo: string }>();
    for (const p of procsDoTipo) {
      const nome = p.nome_especialidade || p.especialidade;
      const cbo = p.codigo_especialidade || "";
      if (nome && !mapa.has(nome)) {
        mapa.set(nome, { nome, cbo });
      }
    }
    return Array.from(mapa.values());
  }, [procsDoTipo]);

  function abrirModal(id?: number) {
    setErro("");
    setExameFoco(false);
    // Pré-carrega catálogo p/ dropdown abrir imediato no clique.
    tfdCatalogoExames().then(setCatalogo).catch(() => {});
    if (id) {
      const e = lista.find((x) => x.id === id);
      if (e) {
        setEditId(e.id);
        setForm({
          paciente_id: String(e.paciente_id),
          exame: e.exame,
          codigo_curto: e.codigo_curto ?? "",
          justificativa: e.justificativa ?? "",
          numero_pedido: e.numero_pedido ?? "",
          especialidade: e.especialidade,
          tipo_fila: e.tipo_fila ?? "",
          codigo_procedimento: e.codigo_procedimento ?? sigtapDe(e.exame),
          codigo_especialidade: e.codigo_especialidade ?? "",
          nome_especialidade: e.nome_especialidade ?? e.especialidade ?? "",
          prioridade: e.prioridade,
          justificativa_prioridade: e.justificativa_prioridade ?? "",
          status: e.status,
          data_pedido: (e.data_pedido || "").slice(0, 10),
          data_agendada: (e.data_agendada || "").slice(0, 10),
          hora_agendada: e.hora_agendada ?? "",
          medico_id: e.medico_id ? String(e.medico_id) : "",
          unidade_saude_id: e.unidade_saude_id ? String(e.unidade_saude_id) : "",
          destino: e.destino,
          observacoes: e.observacoes,
        });
        setBuscaPac(e.paciente_nome);
        setPacienteSelecionado({
          id: e.paciente_id,
          nome: e.paciente_nome,
          cpf: "",
          cns: "",
        } as any);
        setBuscaExame("");
        // Edição com agendamento existente abre a seção expandida.
        setMostrarAgendamento(!!(e.data_agendada || e.medico_id || e.unidade_saude_id || e.hora_agendada));
      }
    } else {
      setEditId(null);
      const unidDefault = user?.unidade_saude_id ? String(user.unidade_saude_id) : "";
      setForm(novoForm(unidDefault));
      setBuscaPac("");
      setPacienteSelecionado(null);
      setBuscaExame("");
      setBuscaExameDeb("");
      setMostrarAgendamento(false);
    }
    tfdPacientes("", 1, 100).then((r) => setPacientesLocais(pagData<Paciente>(r))).catch(() => {});
    setModal(true);
  }

  function fecharModal() {
    setModal(false);
    setEditId(null);
    const unidDefault = user?.unidade_saude_id ? String(user.unidade_saude_id) : "";
    setForm(novoForm(unidDefault));
    setBuscaPac("");
    setBuscaDebounce("");
    setPacienteSelecionado(null);
    setPacientesPec([]);
    setBuscaExame("");
    setBuscaExameDeb("");
    setExameFoco(false);
    setMostrarAgendamento(false);
    setValCbo(null);
    setErro("");
  }

  async function salvar() {
    setErro("");
    setOk("");
    if (!form.paciente_id || !form.exame.trim() || !form.data_pedido) {
      setErro("Paciente, exame e data do pedido são obrigatórios.");
      return;
    }
    if (!form.justificativa || form.justificativa.trim().length < 12) {
      setErro("A justificativa é obrigatória e deve ter pelo menos 12 caracteres.");
      return;
    }
    // Agendamento expandido exige data + médico + unidade.
    if (mostrarAgendamento && (!form.data_agendada || !form.medico_id || !form.unidade_saude_id)) {
      setErro("Agendamento exige data agendada, médico e unidade de atendimento.");
      return;
    }
    const pid = Number(form.paciente_id);
    if (!Number.isInteger(pid) || pid <= 0) {
      setErro("Paciente inválido.");
      return;
    }
    const original = editId ? lista.find((x) => x.id === editId) : undefined;
    const prioMudou = !!original && form.prioridade !== original.prioridade;
    if (prioMudou && form.justificativa_prioridade.trim().length < JUST_MIN) {
      setErro("A justificativa deve conter no mínimo 12 caracteres.");
      return;
    }
    if (retroativoBloqueado && ehRetroativa(form.data_pedido)) {
      setErro(RETRO_MSG);
      return;
    }
    const dataOriginal = (original?.data_agendada || "").slice(0, 10);
    const novoAgendamento = !!form.data_agendada && form.data_agendada !== dataOriginal;
    if (retroativoBloqueado && novoAgendamento && ehRetroativa(form.data_agendada)) {
      setErro(RETRO_MSG);
      return;
    }
    if (novoAgendamento && (!form.medico_id || !form.unidade_saude_id)) {
      setErro("Agendamento exige médico e unidade de atendimento.");
      return;
    }
    setSalvando(true);
    // Compat legado: especialidade espelha tipo_fila / nome especialidade.
    const espFinal = (form.nome_especialidade || form.especialidade || form.tipo_fila || "").trim();
    const tipoFinal = (form.tipo_fila || form.especialidade || "").trim().toUpperCase();
    const midFinal =
      form.medico_id === GENERICO_UNIDADE
        ? (medGenerico?.id ?? null)
        : form.medico_id
        ? Number(form.medico_id)
        : null;
    const payload: Record<string, unknown> = {
      ...form,
      exame: form.exame.trim(),
      especialidade: espFinal || tipoFinal,
      tipo_fila: tipoFinal,
      codigo_procedimento: (form.codigo_procedimento || sigtapDe(form.exame) || "").trim(),
      codigo_especialidade: (form.codigo_especialidade || "").replace(/\D/g, "").slice(0, 6),
      nome_especialidade: espFinal,
      codigo_curto: form.codigo_curto.trim().toUpperCase(),
      numero_pedido: form.numero_pedido.trim().toUpperCase(),
      justificativa: form.justificativa.trim(),
      paciente_id: pid,
      data_agendada: form.data_agendada || null,
      hora_agendada: form.hora_agendada || "",
      medico_id: midFinal,
      unidade_saude_id: form.unidade_saude_id ? Number(form.unidade_saude_id) : null,
      justificativa_prioridade: form.justificativa_prioridade.trim(),
    };
    if (form.data_agendada) payload.status = "agendado";
    try {
      let salvo: Exame;
      if (editId) {
        salvo = await tfdAtualizarExame(editId, payload);
        setOk("Exame atualizado.");
      } else {
        salvo = await tfdCriarExame(payload);
        setOk("Exame inserido na fila.");
      }
      fecharModal();
      setComprovante(salvo);
      await carregar();
      carregarOpcoes().catch(() => {});
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? "Erro ao salvar.";
      setErro(msg);
    } finally {
      setSalvando(false);
    }
  }

  async function excluir() {
    if (!removerAlvo) return;
    const motivo = removerMotivo.trim();
    if (!motivo) {
      setErro("Informe o motivo da remoção da fila.");
      return;
    }
    setRemovendo(true);
    try {
      await tfdExcluirExame(removerAlvo.id, motivo);
      setOk("Removido da fila (registro preservado na linha do tempo).");
      setRemoverAlvo(null);
      setRemoverMotivo("");
      setSel((ids) => ids.filter((x) => x !== removerAlvo.id));
      await carregar();
      carregarOpcoes().catch(() => {});
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? "Erro ao remover.";
      setErro(msg);
    } finally {
      setRemovendo(false);
    }
  }

  async function regenerar(id: number) {
    try {
      const e = await tfdRegenerarTokenExame(id);
      setOk("Link de acompanhamento renovado.");
      setComprovante(e);
      await carregar();
    } catch {
      setErro("Erro ao renovar link.");
    }
  }

  function linkAcompanhar(e: Exame): string {
    return `${baseAcompanhar()}/acompanhar/${encodeURIComponent(e.public_token ?? "")}`;
  }

  function copiar(link: string) {
    const done = () => {
      setToast("Link copiado com sucesso!");
      setOk("Link copiado.");
    };
    const fallback = () => {
      try {
        const ta = document.createElement("textarea");
        ta.value = link;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const okCopy = document.execCommand("copy");
        document.body.removeChild(ta);
        if (okCopy) done();
        else setErro("Não foi possível copiar.");
      } catch {
        setErro("Não foi possível copiar.");
      }
    };
    try {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(link).then(done, fallback);
      } else {
        fallback();
      }
    } catch {
      fallback();
    }
  }

  const exameEmEdicao = editId ? lista.find((x) => x.id === editId) : undefined;
  const podeEditarPrio = !editId || podeAlterarPrioridade(exameEmEdicao?.medico_id);
  const prioAlterada = !!exameEmEdicao && form.prioridade !== exameEmEdicao.prioridade;

  const badgeTotal = lista.length > 0 ? lista[0].total_fila ?? total : total;
  const prioCor: Record<string, string> = {
    rotina: "bg-sus-900/10 text-sus-900",
    urgente: "bg-red-100 text-red-700 border border-red-200",
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-display text-lg font-bold text-sus-950">Fila de Procedimentos</h2>
          <span className="rounded-full bg-teal/10 px-2.5 py-0.5 text-xs font-semibold text-teal">
            {total} no filtro · {badgeTotal} na fila
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/tfd/solicitacoes/nova">
            <Button className="bg-teal text-white hover:brightness-110 text-xs shadow-xs font-bold flex items-center gap-1.5">
              <Plus className="h-4 w-4" /> Nova Solicitação
            </Button>
          </Link>
        </div>
      </div>
      {erro && !modal && !comprovante && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700 print:hidden">
          <span>{erro}</span>
          <button
            type="button"
            onClick={() => carregar(page)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-100 px-3 py-1 text-xs font-bold text-red-800 hover:bg-red-200"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Tentar novamente
          </button>
        </div>
      )}
      {ok && <p className="mb-3 rounded-xl bg-teal/10 px-3 py-2 text-sm text-teal print:hidden">{ok}</p>}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 print:hidden">
          <p className="flex items-center gap-2 rounded-xl bg-sus-950 px-4 py-3 text-sm font-semibold text-white shadow-lg">
            <CheckCircle2 className="h-4 w-4 text-teal" /> {toast}
          </p>
        </div>
      )}

      <Card className="mb-4 p-4 print:hidden">
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-sm font-bold text-sus-950">Filtros rápidos</h3>
              <p className="text-xs text-ink/55">Busque imediatamente ou refine a lista por status, prioridade e categoria.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {isMedico && (
                <button
                  type="button"
                  onClick={() => { const v = !soMeus; setSoMeus(v); setPage(1); setSel([]); setErro(""); carregar(1, { meus: v }).catch(() => setErro("Falha ao carregar fila.")); }}
                  title="Mostrar apenas solicitações vinculadas ao seu cadastro de médico"
                  className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-bold transition ${soMeus ? "border-teal bg-teal text-white" : "border-sus-900/10 bg-white text-sus-900 hover:bg-sus-900/5"}`}
                >
                  Meus encaminhamentos
                </button>
              )}
              <button
                type="button"
                onClick={() => setFiltrosAvancados((v) => !v)}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-sus-900/10 bg-white px-3.5 py-1.5 text-xs font-bold text-sus-900 hover:bg-sus-900/5"
              >
                <Search className="h-4 w-4" /> {filtrosAvancados ? "Ocultar avançados" : "Filtros avançados"}
              </button>
            </div>
          </div>

          <form onSubmit={aplicarFiltros} className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/40" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar por nome, CNS, CPF ou código do procedimento"
                className="pl-10"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <div>
                <Label>Status</Label>
                <select value={filtro} onChange={(e) => setFiltro(e.target.value)} className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
                  <option value="">Todos</option>
                  {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <Label>Prioridade</Label>
                <select value={prio} onChange={(e) => setPrio(e.target.value)} className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
                  <option value="">Todas</option>
                  {PRIOS.map((p) => <option key={p} value={p}>{PRIO_ROTULO[p]}</option>)}
                </select>
              </div>
              <div>
                <Label>Tipo de fila</Label>
                <Combobox
                  value={tipoFila}
                  onChange={(v) => {
                    setTipoFila(v);
                    setPage(1);
                    setErro("");
                    carregar(1, { tipo: v }).catch(() => setErro("Falha ao carregar fila."));
                  }}
                  options={opcoesTipo}
                  placeholder="Todos os tipos de fila"
                  emptyText="Nenhum tipo encontrado"
                  searchPlaceholder="Buscar tipo de fila…"
                />
              </div>
              <div>
                <Label>Especialidade</Label>
                <Combobox
                  value={espCbo}
                  onChange={(v) => {
                    setEspCbo(v);
                    setPage(1);
                    setErro("");
                    if (v && modoVisualizacao === "tipo") {
                      setModoVisualizacao("especialidade");
                    }
                    carregar(1, { esp: v }).catch(() => setErro("Falha ao carregar fila."));
                  }}
                  options={opcoesEsp}
                  placeholder="Todas as especialidades"
                  emptyText="Nenhuma especialidade encontrada"
                  searchPlaceholder="Buscar especialidade…"
                />
              </div>
              <div>
                <Label>Procedimento</Label>
                <Combobox
                  value={proc}
                  onChange={(v) => {
                    setProc(v);
                    setPage(1);
                    setErro("");
                    carregar(1, { proc: v }).catch(() => setErro("Falha ao carregar fila."));
                  }}
                  options={opcoesProc}
                  placeholder="Todos os procedimentos"
                  emptyText="Nenhum procedimento encontrado"
                  searchPlaceholder="Buscar código ou nome…"
                />
              </div>
            </div>

            {filtrosAvancados && (
              <div className="grid gap-3 rounded-2xl bg-sand/50 p-3 sm:grid-cols-2 md:grid-cols-4">
                <div>
                  <Label>Unidade de Saúde (PSF)</Label>
                  <select
                    value={filtroUnidadeId}
                    onChange={(e) => setFiltroUnidadeId(e.target.value)}
                    className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2 text-xs font-medium text-sus-950 outline-none transition focus:border-teal"
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
                  <Label>Destino</Label>
                  <Input placeholder="Ex: Hospital ou Município" value={dest} onChange={(e) => setDest(e.target.value)} />
                </div>
                <div>
                  <Label>De</Label>
                  <Input type="date" value={de} onChange={(e) => setDe(e.target.value)} />
                </div>
                <div>
                  <Label>Até</Label>
                  <Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
                </div>
              </div>
            )}

            {/* Barra de Ferramentas / Controles Integrados da Fila */}
            <div className="mt-4 flex flex-col gap-3.5 border-t border-sus-900/10 pt-4 xl:flex-row xl:items-center xl:justify-between">
              {/* Controles de Ordenação e Visualização de Posição */}
              <div className="flex flex-wrap items-center gap-3">
                {/* Bloco 1: Ordenação da Fila */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-sus-900/70">Ordenação:</span>
                  <div className="inline-flex rounded-xl border border-sus-900/10 bg-sand/60 p-1">
                    <button
                      type="button"
                      onClick={() => { setOrdem("prioridade"); setPage(1); carregar(1, { ordenacao: "prioridade" }).catch(() => setErro("Falha ao carregar fila.")); }}
                      className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${ordem === "prioridade" ? "bg-sus-900 text-white shadow-xs" : "text-sus-900 hover:bg-sand"}`}
                      title="Prioriza pacientes com urgência médica seguidos por data de solicitação"
                    >Com prioridade</button>
                    <button
                      type="button"
                      onClick={() => { setOrdem("cronologica"); setPage(1); carregar(1, { ordenacao: "cronologica" }).catch(() => setErro("Falha ao carregar fila.")); }}
                      className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${ordem === "cronologica" ? "bg-sus-900 text-white shadow-xs" : "text-sus-900 hover:bg-sand"}`}
                      title="Ordena estritamente por tempo de espera / data de pedido"
                    >Cronológica</button>
                  </div>
                </div>

                <div className="hidden h-5 w-px bg-sus-900/15 md:block" />

                {/* Bloco 2: Modo de Exibição da Posição */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-sus-900/70">Posição:</span>
                  <div className="inline-flex rounded-xl border border-sus-900/10 bg-sand/60 p-1">
                    <button
                      type="button"
                      onClick={() => setModoVisualizacao("tipo")}
                      className={`rounded-lg px-2.5 py-1.5 text-xs font-bold transition ${modoVisualizacao === "tipo" ? "bg-sus-900 text-white shadow-xs" : "text-sus-900 hover:bg-sand"}`}
                      title="Exibe a posição geral em relação ao Tipo de Fila (ex: Consultas Especializadas)"
                    >Por Tipo</button>
                    <button
                      type="button"
                      onClick={() => setModoVisualizacao("especialidade")}
                      className={`rounded-lg px-2.5 py-1.5 text-xs font-bold transition ${modoVisualizacao === "especialidade" ? "bg-sus-900 text-white shadow-xs" : "text-sus-900 hover:bg-sand"}`}
                      title="Exibe a posição na Especialidade médica"
                    >Por Especialidade</button>
                    <button
                      type="button"
                      onClick={() => setModoVisualizacao("ambas")}
                      className={`rounded-lg px-2.5 py-1.5 text-xs font-bold transition ${modoVisualizacao === "ambas" ? "bg-sus-900 text-white shadow-xs" : "text-sus-900 hover:bg-sand"}`}
                      title="Exibe simultaneamente a posição Geral e na Especialidade"
                    >Ambas (Geral + Esp)</button>
                  </div>
                </div>
              </div>

              {/* Bloco 3: Ações de Filtragem e Exportação Excel */}
              <div className="flex flex-wrap items-center gap-2 sm:self-start xl:self-center">
                <Button type="submit" className="!px-4 !py-2 text-xs">
                  <Search className="h-3.5 w-3.5" /> Filtrar
                </Button>
                <button
                  type="button"
                  onClick={() => { setQ(""); setPrio(""); setTipoFila(""); setProc(""); setEspCbo(""); setDest(""); setFiltroUnidadeId(""); setDe(""); setAte(""); setFiltro("aguardando"); setSoMeus(false); setFiltrosAvancados(false); setPage(1); carregar(1, { tipo: "", proc: "", esp: "" }).catch(() => {}); }}
                  className="rounded-xl px-3 py-2 text-xs font-semibold text-ink/70 hover:bg-sus-900/5 transition"
                >
                  Limpar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setExportarApenasSel(sel.length > 0);
                    setExportModal(true);
                  }}
                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-sus-900/15 bg-white px-3.5 py-1.5 text-xs font-bold text-sus-900 hover:bg-sus-900/5 transition shadow-xs"
                  title="Selecionar colunas e exportar a fila para arquivo Excel"
                >
                  <Download className="h-4 w-4 text-teal" /> Exportar Excel
                </button>
              </div>
            </div>
          </form>
        </div>
      </Card>
      <Card className="overflow-hidden print:hidden">
        {sel.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-sus-900/10 bg-sus-900 px-4 py-2.5 text-sm text-white">
            <span className="font-semibold">{sel.length} selecionado(s)</span>
            <button onClick={() => setSel([])} className="rounded-lg px-2 py-1 text-xs text-white/70 hover:bg-white/10 hover:text-white">Limpar</button>
            <div className="ml-auto flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setExportarApenasSel(true);
                  setExportModal(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-white/20 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/30 transition shadow-xs"
                title="Exportar apenas os pacientes selecionados para planilha Excel"
              >
                <Download className="h-3.5 w-3.5" /> Exportar selecionados ({sel.length})
              </button>
              <button onClick={() => abrirLote("agendar")} className="rounded-xl bg-teal px-3 py-1.5 text-xs font-bold text-white hover:brightness-110">Agendar em lote</button>
              <button onClick={() => abrirLote("status")} className="rounded-xl bg-white/15 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/25">Alterar status em lote</button>
              <button onClick={() => abrirLote("editar")} className="rounded-xl bg-white/15 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/25">Modificar em conjunto</button>
            </div>
          </div>
        )}
        <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b border-sus-900/10 bg-sand text-xs uppercase text-sus-900/60">
            <th className="w-10 px-3 py-3">
              <input type="checkbox" checked={todosVisiveis} ref={(el) => { if (el) el.indeterminate = !todosVisiveis && algunsVisiveis; }} onChange={toggleTodos} aria-label="Selecionar todos visíveis" className="h-4 w-4 accent-teal" />
            </th>
            <th className={modoVisualizacao === "ambas" ? "min-w-[210px] px-4 py-3 whitespace-nowrap" : "w-40 px-4 py-3"}>
              {modoVisualizacao === "tipo"
                ? "Posição / Tipo"
                : modoVisualizacao === "especialidade"
                ? "Posição / Especialidade"
                : "Posições (Geral | Esp)"}
            </th>
            <th className="min-w-[220px] px-4 py-3">Paciente</th>
            <th className="w-28 px-4 py-3 whitespace-nowrap">Prioridade</th>
            <th className="min-w-[200px] px-4 py-3">Procedimento</th>
            {modoVisualizacao !== "tipo" && <th className="w-40 px-4 py-3">Cód. Procedimento</th>}
            <th className="w-36 px-4 py-3">Status</th>
            <th className="w-32 px-4 py-3 text-right">Ações</th>
          </tr></thead>
          <tbody>
            {carregando && (
              <tr>
                <td colSpan={modoVisualizacao === "tipo" ? 7 : 8} className="px-4 py-12 text-center text-ink/50">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <RefreshCw className="h-6 w-6 animate-spin text-teal" />
                    <span className="text-xs font-medium">Carregando procedimentos da fila…</span>
                  </div>
                </td>
              </tr>
            )}
            {!carregando && lista.map((e) => (
              <tr key={e.id} className={`border-b border-sus-900/5 last:border-0 ${sel.includes(e.id) ? "bg-teal/5" : ""}`}>
                <td className="px-3 py-3">
                  <input type="checkbox" checked={sel.includes(e.id)} onChange={() => toggleUm(e.id)} aria-label={`Selecionar pedido ${e.id}`} className="h-4 w-4 accent-teal" />
                </td>
                <td className={`px-4 py-3 font-display ${modoVisualizacao === "ambas" ? "whitespace-nowrap" : ""}`}>
                  {modoVisualizacao === "tipo" && (
                    <div>
                      <span className="text-base font-extrabold text-teal">
                        {(e.posicao_tipo ?? e.posicao) ? `${e.posicao_tipo ?? e.posicao}º` : "—"}
                      </span>
                      {(e.total_tipo ?? e.total_fila) ? (
                        <span className="block text-[10px] font-normal text-ink/45">
                          de {e.total_tipo ?? e.total_fila} · {e.grupo_tipo || e.tipo_fila || "Geral"}
                        </span>
                      ) : null}
                    </div>
                  )}
                  {modoVisualizacao === "especialidade" && (
                    <div>
                      <span className="text-base font-extrabold text-sus-900">
                        {(e.posicao_especialidade ?? e.posicao) ? `${e.posicao_especialidade ?? e.posicao}º` : "—"}
                      </span>
                      {(e.total_especialidade ?? e.total_fila) ? (
                        <span className="block text-[10px] font-normal text-ink/45">
                          de {e.total_especialidade ?? e.total_fila} · {e.grupo_especialidade || e.nome_especialidade || e.especialidade || "Especialidade"}
                        </span>
                      ) : null}
                    </div>
                  )}
                  {modoVisualizacao === "ambas" && (
                    <div className="whitespace-nowrap">
                      <div className="flex items-center gap-1.5 text-xs font-bold whitespace-nowrap">
                        <span className="inline-flex items-center rounded-md bg-teal/15 px-2 py-0.5 text-teal whitespace-nowrap" title="Posição no Tipo de Fila Geral (ex: Consultas Especializadas)">
                          G: {(e.posicao_tipo ?? e.posicao) ? `${e.posicao_tipo ?? e.posicao}` : "—"}{e.total_tipo ? `/${e.total_tipo}` : ""}
                        </span>
                        <span className="inline-flex items-center rounded-md bg-sus-900/10 px-2 py-0.5 text-sus-900 whitespace-nowrap" title="Posição na Especialidade">
                          Esp: {(e.posicao_especialidade ?? e.posicao) ? `${e.posicao_especialidade ?? e.posicao}` : "—"}{e.total_especialidade ? `/${e.total_especialidade}` : ""}
                        </span>
                      </div>
                      <p className="mt-0.5 block max-w-[210px] truncate text-[10px] font-normal text-ink/45" title={`${e.grupo_tipo || e.tipo_fila || "Tipo"} · ${e.grupo_especialidade || e.nome_especialidade || "Especialidade"}`}>
                        {e.grupo_tipo || e.tipo_fila || "Geral"} · {e.grupo_especialidade || e.nome_especialidade || e.especialidade || "Esp."}
                      </p>
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold text-sus-950">{e.paciente_nome}</span>
                    <span
                      className="inline-flex items-center rounded bg-sus-900/10 px-1.5 py-0.5 text-[11px] font-mono font-bold text-sus-900"
                      title="Identificador Único e Imutável do Pedido na Fila"
                    >
                      {e.codigo_curto || `EX-${String(e.id).padStart(6, "0")}`}
                    </span>
                  </div>
                  {(e.paciente_endereco || e.paciente_bairro) && (
                    <div
                      className="mt-0.5 flex items-center gap-1 text-[11px] text-ink/70 truncate max-w-[340px]"
                      title={`${e.paciente_endereco || ""}${e.paciente_numero ? `, nº ${e.paciente_numero}` : ""}${e.paciente_complemento ? ` (${e.paciente_complemento})` : ""}${e.paciente_bairro ? ` · ${e.paciente_bairro}` : ""}${e.paciente_municipio ? ` - ${e.paciente_municipio}` : ""}`}
                    >
                      <MapPin className="h-3 w-3 shrink-0 text-teal" />
                      <span className="truncate">
                        {e.paciente_endereco ? `${e.paciente_endereco}${e.paciente_numero ? `, ${e.paciente_numero}` : ""}` : ""}
                        {e.paciente_bairro ? `${e.paciente_endereco ? " · " : ""}${e.paciente_bairro}` : ""}
                      </span>
                    </div>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 border border-amber-600/30 px-2 py-0.5 text-[11px] font-bold text-amber-950 shadow-xs" title="Data em que o paciente foi adicionado à fila de espera">
                      <Calendar className="h-3.5 w-3.5 text-amber-800 shrink-0" />
                      <span>Na fila desde: <strong className="font-black text-amber-950">{fmtData(e.data_pedido)}</strong></span>
                      {tempoEspera(e.data_pedido) ? <span className="font-semibold text-amber-900/80">({tempoEspera(e.data_pedido)})</span> : null}
                    </span>
                    {e.destino && <span className="text-[11px] text-ink/60 truncate max-w-[180px]" title={e.destino}>· {e.destino}</span>}
                  </div>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold leading-none ${prioCor[e.prioridade] ?? "bg-sand"}`}>
                    {PRIO_ROTULO[e.prioridade] ?? e.prioridade}
                  </span>
                </td>
                <td className="px-4 py-3">{nomeLimpo(e.exame)}</td>
                {modoVisualizacao !== "tipo" && (
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs font-semibold text-sus-900">{e.codigo_procedimento || sigtapDe(e.exame) || "—"}</span>
                    <p className="text-xs text-ink/50">{e.nome_especialidade || e.especialidade || "—"}</p>
                  </td>
                )}
                <td className="px-4 py-3 text-xs">{e.status}{e.data_agendada ? ` · ${fmtData(e.data_agendada)}` : ""}</td>
                <td className="px-4 py-3"><div className="flex items-center justify-end gap-1">
                  <BotaoWhatsApp exameId={e.id} exame={e} variante="compacto" />
                  <button onClick={() => setDetalhe(e)} className="rounded-lg p-2 text-sus-900 hover:bg-sand" title="Detalhes"><Eye className="h-4 w-4" /></button>
                  {e.public_token && (
                    <button onClick={() => setComprovante(e)} className="rounded-lg p-2 text-teal hover:bg-teal/10" title="Comprovante / QR"><QrCode className="h-4 w-4" /></button>
                  )}
                  <button onClick={() => abrirModal(e.id)} className="rounded-lg p-2 text-sus-800 hover:bg-sus-100" title="Editar"><Pencil className="h-4 w-4" /></button>
                  <button onClick={() => { setRemoverAlvo(e); setRemoverMotivo(""); setErro(""); }} className="rounded-lg p-2 text-red-600 hover:bg-red-50" title="Remover da fila"><Trash2 className="h-4 w-4" /></button>
                </div></td>
              </tr>
            ))}
            {!carregando && lista.length === 0 && (
              <tr>
                <td colSpan={modoVisualizacao === "tipo" ? 7 : 8} className="px-4 py-12 text-center text-ink/50">
                  <p className="font-semibold text-sus-950">Nenhum procedimento encontrado</p>
                  <p className="mt-1 text-xs text-ink/40">
                    {filtro ? `Não há registros com o status "${filtro}".` : "Não há procedimentos cadastrados na fila."}
                  </p>
                  <button
                    type="button"
                    onClick={() => { setQ(""); setPrio(""); setTipoFila(""); setProc(""); setEspCbo(""); setDest(""); setDe(""); setAte(""); setFiltro(""); setSoMeus(false); setPage(1); carregar(1, { tipo: "", proc: "", esp: "" }).catch(() => {}); }}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-sus-900/15 bg-white px-3 py-1.5 text-xs font-bold text-sus-900 hover:bg-sand"
                  >
                    Exibir todos os registros
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
        <p className="bg-sand/50 px-4 py-2 text-[11px] text-ink/50">* Posição na fila específica: por tipo de fila p/ exames, por especialidade p/ consultas especializadas.{total > 0 ? ` ${total} registro(s) no filtro.` : ""}{sel.length > 0 ? ` ${sel.length} selecionado(s) no total.` : ""}</p>
        <Paginacao page={page} pages={pages} total={total} onPage={(p) => { setPage(p); carregar(p).catch(() => setErro("Falha ao carregar fila.")); }} />
      </Card>

      {loteModal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4 print:hidden" onClick={() => { setConfirmandoLote(false); setLoteModal(null); }}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl bg-white p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <p className="font-display text-base font-bold text-sus-950">
                {loteModal === "agendar" ? `Agendar ${sel.length} pedido(s)` : loteModal === "status" ? `Alterar status de ${sel.length} pedido(s)` : `Modificar ${sel.length} pedido(s)`}
              </p>
              <button onClick={() => setLoteModal(null)} className="rounded-lg p-2 text-ink/50 hover:bg-sand" aria-label="Fechar"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3">
              {loteModal === "agendar" && (
                <>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div><Label>Data do agendamento *</Label><Input type="date" value={loteForm.data_agendada} min={retroativoBloqueado ? hojeISO() : undefined} onChange={(e) => setLoteForm({ ...loteForm, data_agendada: e.target.value })} /></div>
                    <div><Label>Hora</Label><Input type="time" value={loteForm.hora_agendada} onChange={(e) => setLoteForm({ ...loteForm, hora_agendada: e.target.value })} /></div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <Label className="flex items-center gap-1.5">
                        <Stethoscope className="h-3.5 w-3.5 text-teal" /> Médico(a)
                      </Label>
                      <button
                        type="button"
                        onClick={() =>
                          setLoteForm({
                            ...loteForm,
                            medico_id: medGenerico ? String(medGenerico.id) : GENERICO_UNIDADE,
                          })
                        }
                        className="text-[11px] font-semibold text-teal hover:underline"
                        title="Definir Médico da Unidade"
                      >
                        🏥 Médico da Unidade
                      </button>
                    </div>
                    <Combobox
                      value={
                        medGenerico && String(loteForm.medico_id) === String(medGenerico.id)
                          ? GENERICO_UNIDADE
                          : loteForm.medico_id
                      }
                      onChange={(val) => {
                        if (val === GENERICO_UNIDADE) {
                          setLoteForm({ ...loteForm, medico_id: medGenerico ? String(medGenerico.id) : GENERICO_UNIDADE });
                        } else {
                          setLoteForm({ ...loteForm, medico_id: val });
                        }
                      }}
                      options={opcoesMedicos}
                      placeholder="Buscar médico…"
                      searchPlaceholder="Digite o nome do médico ou CRM…"
                      emptyText="Nenhum médico encontrado"
                      showAll={false}
                    />
                  </div>
                  <div>
                    <Label className="mb-1.5 flex items-center gap-1.5">
                      <Building2 className="h-3.5 w-3.5 text-teal" /> PSF / Unidade de saúde
                    </Label>
                    <Combobox
                      value={loteForm.unidade_id}
                      onChange={(v) => setLoteForm({ ...loteForm, unidade_id: v })}
                      options={opcoesUnidades}
                      placeholder="Buscar unidade / PSF…"
                      searchPlaceholder="Digite o nome da unidade…"
                      emptyText="Nenhuma unidade encontrada"
                      showAll={false}
                    />
                  </div>
                  <div><Label>Unidade / destino (texto)</Label><Input value={loteForm.destino} onChange={(e) => setLoteForm({ ...loteForm, destino: e.target.value })} placeholder="Cidade / unidade (se não selecionar PSF)" /></div>
                  <p className="text-xs text-ink/55">Status muda para <b>agendado</b>. Campos vazios mantêm valor atual.</p>
                </>
              )}
              {loteModal === "status" && (
                <div>
                  <Label>Novo status</Label>
                  <select value={loteForm.status} onChange={(e) => setLoteForm({ ...loteForm, status: e.target.value })} className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
                    <option value="">Escolher…</option>
                    {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              )}
              {loteModal === "editar" && (
                <>
                  <div>
                    <Label>Prioridade{!isMedico ? " (somente perfil Médico)" : ""}</Label>
                    <select
                      value={loteForm.prioridade}
                      disabled={!isMedico}
                      onChange={(e) => setLoteForm({ ...loteForm, prioridade: e.target.value })}
                      className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm disabled:bg-sand disabled:text-ink/50"
                      title={!isMedico ? "Somente o perfil Médico altera prioridade" : "O backend exige vínculo com cada pedido"}
                    >
                      <option value="">Manter atual</option>
                      {PRIOS.map((p) => <option key={p} value={p}>{PRIO_ROTULO[p]}</option>)}
                    </select>
                  </div>
                  {loteForm.prioridade && (
                    <div>
                      <Label>Justificativa técnica * (mín. 12 caracteres)</Label>
                      <textarea
                        value={loteForm.justificativa}
                        disabled={!isMedico}
                        onChange={(e) => setLoteForm({ ...loteForm, justificativa: e.target.value })}
                        rows={3}
                        maxLength={500}
                        placeholder="Obrigatória ao alterar a prioridade…"
                        className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm outline-none focus:border-teal disabled:bg-sand disabled:text-ink/50"
                      />
                      <p className="mt-1 text-xs text-ink/45">{loteForm.justificativa.trim().length}/{JUST_MIN} caracteres mínimos</p>
                    </div>
                  )}
                  <div><Label>Observações</Label><Input value={loteForm.observacoes} onChange={(e) => setLoteForm({ ...loteForm, observacoes: e.target.value })} placeholder="Vazio mantém valor atual" /></div>
                </>
              )}
              {erro && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
              {loteModal === "agendar" ? (
                <Button
                  onClick={() => {
                    setErro("");
                    if (!loteForm.data_agendada) {
                      setErro("Informe a data do agendamento.");
                      return;
                    }
                    if (!loteForm.medico_id || !loteForm.unidade_id) {
                      setErro("Agendamento exige médico e unidade de atendimento.");
                      return;
                    }
                    setConfirmandoLote(true);
                  }}
                  disabled={loteSalvando}
                  className="w-full"
                >
                  Revisar agendamento em lote
                </Button>
              ) : (
                <Button onClick={salvarLote} disabled={loteSalvando} className="w-full">
                  {loteSalvando ? "Aplicando…" : `Aplicar a ${sel.length} pedido(s)`}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {confirmandoLote && loteModal === "agendar" && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-sus-950/50 p-4 print:hidden" onClick={() => setConfirmandoLote(false)}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <p className="font-display text-base font-bold text-sus-950">Confirmar agendamento em lote</p>
            <div className="mt-3 space-y-1 text-sm text-ink/70">
              <p><b>{sel.length}</b> paciente(s) afetado(s).</p>
              <p>Especialidade: <b>{[...new Set(lista.filter((e) => sel.includes(e.id)).map((e) => e.nome_especialidade || e.especialidade).filter(Boolean))].join(", ") || "—"}</b></p>
              <p>Data: <b>{loteForm.data_agendada.split("-").reverse().join("/")}{loteForm.hora_agendada ? ` · ${loteForm.hora_agendada}` : ""}</b></p>
              <p>Médico(a): <b>{loteForm.medico_id === GENERICO_UNIDADE ? "🏥 Médico da Unidade / Responsável Técnico" : medicos.find((m) => String(m.id) === loteForm.medico_id)?.nome || "—"}</b></p>
              <p>Unidade / PSF: <b>{unidades.find((u) => String(u.id) === loteForm.unidade_id)?.nome || (loteForm.destino.trim() || "—")}</b></p>
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={() => setConfirmandoLote(false)} className="flex-1 rounded-xl border border-sus-900/15 px-4 py-2.5 text-sm font-semibold text-sus-900 hover:bg-sand">Cancelar</button>
              <Button onClick={async () => { setConfirmandoLote(false); await salvarLote(); }} disabled={loteSalvando} className="flex-1">{loteSalvando ? "Aplicando…" : "Confirmar Agendamento em Lote"}</Button>
            </div>
          </div>
        </div>
      )}
      {removerAlvo && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-sus-950/50 p-4 print:hidden" onClick={() => setRemoverAlvo(null)}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <p className="font-display text-base font-bold text-sus-950">Remover da fila de espera</p>
              <button onClick={() => setRemoverAlvo(null)} className="rounded-lg p-2 text-ink/50 hover:bg-sand" aria-label="Fechar"><X className="h-4 w-4" /></button>
            </div>
            <p className="mb-3 text-sm text-ink/60">{removerAlvo.paciente_nome} · {removerAlvo.exame}</p>
            <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
              O registro é preservado (soft delete) e a remoção entra na linha do tempo do paciente com responsável, data/hora e motivo.
            </p>
            <div>
              <Label>Motivo/justificativa da remoção *</Label>
              <textarea
                value={removerMotivo}
                onChange={(e) => setRemoverMotivo(e.target.value)}
                rows={4}
                maxLength={500}
                placeholder="Descreva o motivo da remoção…"
                className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm outline-none focus:border-teal"
              />
            </div>
            {erro && <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
            <div className="mt-4 flex gap-2">
              <button onClick={() => setRemoverAlvo(null)} className="flex-1 rounded-xl border border-sus-900/15 px-4 py-2.5 text-sm font-semibold text-sus-900 hover:bg-sand">Cancelar</button>
              <button onClick={excluir} disabled={removendo} className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white hover:brightness-110 disabled:opacity-50">
                {removendo ? "Removendo…" : "Confirmar remoção"}
              </button>
            </div>
          </div>
        </div>
      )}
      {modal && (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-sus-950/50 p-4 print:hidden" onClick={fecharModal}>
          <div className="max-h-[90vh] w-full max-w-4xl overflow-auto rounded-2xl bg-white p-6 shadow-card md:p-8" onClick={(e) => e.stopPropagation()}>
            <div className="mb-5 flex items-center justify-between">
              <p className="font-display text-lg font-bold text-sus-950">{editId ? "Editar pedido" : "Novo pedido na fila"}</p>
              <button onClick={fecharModal} className="rounded-lg p-2 text-ink/50 hover:bg-sand" aria-label="Fechar"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-5">
              {/* Paciente */}
              <section>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-sus-900/55">Paciente *</p>
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="md:col-span-3">
                    {pacienteSelecionado || (form.paciente_id && (pacientesLocais.find(p => String(p.id) === form.paciente_id) || buscaPac)) ? (
                      <div className="flex items-center justify-between rounded-xl border border-teal/40 bg-teal/5 p-3.5 shadow-xs">
                        <div className="flex flex-col">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sus-950 text-sm">
                              {pacienteSelecionado?.nome || pacientesLocais.find(p => String(p.id) === form.paciente_id)?.nome || buscaPac}
                            </span>
                            <span className="rounded-md bg-teal/20 px-2 py-0.5 text-[10px] font-bold text-teal uppercase">
                              {(pacienteSelecionado as any)?.origem === "pec" ? "PEC e-SUS" : "Cadastro Local"}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink/70 mt-1">
                            {(pacienteSelecionado?.cpf || pacientesLocais.find(p => String(p.id) === form.paciente_id)?.cpf) && (
                              <span>CPF: <strong>{pacienteSelecionado?.cpf || pacientesLocais.find(p => String(p.id) === form.paciente_id)?.cpf}</strong></span>
                            )}
                            {(pacienteSelecionado?.cns || pacientesLocais.find(p => String(p.id) === form.paciente_id)?.cns) && (
                              <span>CNS: <strong>{pacienteSelecionado?.cns || pacientesLocais.find(p => String(p.id) === form.paciente_id)?.cns}</strong></span>
                            )}
                            {(pacienteSelecionado?.nascimento || pacientesLocais.find(p => String(p.id) === form.paciente_id)?.nascimento) && (
                              <span>Nasc.: {fmtData(String(pacienteSelecionado?.nascimento || pacientesLocais.find(p => String(p.id) === form.paciente_id)?.nascimento))}</span>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setPacienteSelecionado(null);
                            setForm({ ...form, paciente_id: "" });
                            setBuscaPac("");
                            setBuscaDebounce("");
                            setPacientesPec([]);
                          }}
                          className="rounded-xl border border-sus-900/15 bg-white px-3 py-1.5 text-xs font-semibold text-sus-900 hover:bg-red-50 hover:text-red-700 hover:border-red-200 transition shadow-xs"
                          title="Alterar paciente selecionado"
                        >
                          Trocar Paciente
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Label>Pesquisar Paciente</Label>
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/40" />
                          <Input
                            placeholder="Digite o nome, CPF (com ou sem pontuação) ou CNS…"
                            value={buscaPac}
                            onChange={(e) => {
                              setBuscaPac(e.target.value);
                              setBuscaDebounce(e.target.value);
                            }}
                            className="pl-10 pr-4"
                            autoComplete="off"
                          />
                        </div>

                        {buscando && (
                          <p className="mt-1 flex items-center gap-2 text-xs text-ink/60">
                            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-teal border-t-transparent" />
                            Pesquisando pacientes no banco de dados e no PEC…
                          </p>
                        )}

                        {/* Lista Interativa de Resultados da Busca */}
                        {pacientesPec.length > 0 && (
                          <div className="mt-1 max-h-56 overflow-y-auto rounded-xl border border-sus-900/15 bg-white shadow-lg divide-y divide-sus-900/5">
                            <div className="bg-sand/40 px-3 py-1.5 text-[11px] font-bold text-sus-900/60 uppercase">
                              {pacientesPec.length} paciente(s) encontrado(s) — clique para selecionar:
                            </div>
                            {pacientesPec.slice(0, 30).map((p, i) => (
                              <button
                                key={`${p.origem}-${p.id ?? "pec"}-${i}`}
                                type="button"
                                onClick={() => {
                                  if (p.origem === "pec" && p.id === null) {
                                    setErro("Este paciente existe no PEC mas ainda não possui ficha local. Selecione um paciente cadastrado localmente.");
                                    return;
                                  }
                                  setForm({ ...form, paciente_id: String(p.id!) });
                                  setPacienteSelecionado(p);
                                  setBuscaPac(p.nome);
                                  setPacientesPec([]);
                                }}
                                className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-teal/5 transition group"
                              >
                                <div className="flex flex-col">
                                  <span className="font-semibold text-sus-950 group-hover:text-teal">{p.nome}</span>
                                  <div className="flex flex-wrap gap-2 text-xs text-ink/60 mt-0.5">
                                    {p.cpf && <span>CPF: <strong>{p.cpf}</strong></span>}
                                    {p.cns && <span>CNS: <strong>{p.cns}</strong></span>}
                                    {p.nascimento && <span>Nasc.: {fmtData(String(p.nascimento))}</span>}
                                    <span className={p.origem === "pec" ? "text-teal font-semibold" : "text-sus-900/80 font-medium"}>
                                      {p.origem === "pec" ? "e-SUS PEC" : "Local"}
                                    </span>
                                  </div>
                                </div>
                                <span className="rounded-lg bg-sand px-2 py-1 text-xs font-semibold text-sus-900 group-hover:bg-teal group-hover:text-white transition">
                                  Selecionar
                                </span>
                              </button>
                            ))}
                          </div>
                        )}

                        {buscaDebounce && buscaDebounce.trim().length >= 2 && !buscando && pacientesPec.length === 0 && (
                          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-900">
                            Nenhum paciente encontrado para a busca "<strong>{buscaDebounce}</strong>". Verifique o nome ou documento digitado.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </section>
              {/* Procedimento */}
              <section>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-sus-900/55">Procedimento</p>
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="md:col-span-2">
                    <Label>Procedimento (código, curto ou nome) *</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/40" />
                    <Input
                      placeholder="Clique p/ ver opções ou digite: mamografia, USG…"
                      value={buscaExame}
                      onChange={(e) => {
                        setBuscaExame(e.target.value);
                        setExameFoco(true);
                      }}
                      onFocus={() => setExameFoco(true)}
                      onBlur={() => setTimeout(() => setExameFoco(false), 200)}
                      onClick={() => setExameFoco(true)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setExameFoco(false);
                        if (e.key === "Enter" && opcoesFiltradas.length > 0) {
                          e.preventDefault();
                          escolherExame(opcoesFiltradas[0]);
                        }
                      }}
                      className="pl-10 pr-10"
                      autoComplete="off"
                    />
                    {form.exame && (
                      <button
                        type="button"
                        title="Limpar seleção"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setForm({ ...form, exame: "", especialidade: "", codigo_curto: "" });
                          setBuscaExame("");
                          setExameFoco(true);
                        }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-ink/40 hover:bg-sand hover:text-ink"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  {form.exame && (
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 rounded-lg bg-teal/10 px-2.5 py-1 text-xs font-semibold text-teal" title={form.exame}>
                      <span className="truncate">Selecionado: {nomeLimpo(form.exame)}{form.codigo_curto ? ` · ${form.codigo_curto}` : ""}</span>
                      {valCbo?.hierarquia?.subgrupo_nome && (
                        <span className="rounded bg-teal/20 px-1.5 py-0.5 text-[10px] font-bold text-teal-900 shrink-0">
                          {valCbo.hierarquia.subgrupo_nome}
                        </span>
                      )}
                    </div>
                  )}
                  {exameFoco && (
                    <div className="mt-1 max-h-56 overflow-y-auto rounded-xl border border-sus-900/10 bg-white shadow-card">
                      <p className="sticky top-0 border-b border-sus-900/5 bg-sand/70 px-3 py-1.5 text-[11px] font-semibold text-sus-900/60">
                        {catLoading && catalogo.length === 0
                          ? "Buscando…"
                          : opcoesFiltradas.length > 0
                            ? `${opcoesFiltradas.length} opção(ões) — clique p/ selecionar`
                            : "Nenhuma opção p/ este filtro"}
                      </p>
                      {opcoesFiltradas.map((c) => (
                        <button
                          key={`${c.codigo_curto}-${c.exame}`}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => escolherExame(c)}
                          className="flex w-full items-center justify-between gap-2 border-b border-sus-900/5 px-3 py-2 text-left text-sm last:border-0 hover:bg-sand"
                        >
                          <span>
                            <span className="font-semibold">{c.codigo_curto ? `${c.codigo_curto} · ` : ""}{nomeLimpo(c.exame)}</span>
                            <span className="block text-xs text-ink/50">{c.especialidade} · {c.usos} na fila{sigtapDe(c.exame) ? ` · SIGTAP ${sigtapDe(c.exame)}` : ""}</span>
                          </span>
                          <Plus className="h-4 w-4 shrink-0 text-teal" />
                        </button>
                      ))}
                      {!catLoading && buscaExame.trim().length >= 2 && (
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setForm({ ...form, exame: buscaExame.trim() });
                            setBuscaExame("");
                            setExameFoco(false);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-sus-900 hover:bg-sand"
                        >
                          <Plus className="h-3.5 w-3.5" /> Usar texto digitado: “{buscaExame.trim()}”
                        </button>
                      )}
                    </div>
                  )}
                  <div className="mt-1 grid grid-cols-2 gap-2">
                    <Input
                      placeholder="Código curto (ex: MAMO, USG-TV)"
                      value={form.codigo_curto}
                      onChange={(e) => setForm({ ...form, codigo_curto: e.target.value.toUpperCase() })}
                    />
                    <Input
                      placeholder="Valor exato p/ registro"
                      value={form.exame}
                      onChange={(e) => { setForm({ ...form, exame: e.target.value }); setBuscaExame(e.target.value); }}
                    />
                  </div>
                </div>
                <div>
                  <Label>Tipo de fila *</Label>
                  <Input
                    value={form.tipo_fila}
                    onChange={(e) => {
                      const novoTipo = e.target.value.toUpperCase();
                      setForm((f) => {
                        const compativeis = catalogo.filter((c) => (c.tipo_fila || "").toUpperCase() === novoTipo);
                        const compativel = !f.exame || compativeis.length === 0 || compativeis.some((c) => c.exame === f.exame || c.codigo_curto === f.codigo_curto);
                        return {
                          ...f,
                          tipo_fila: novoTipo,
                          ...(compativel ? {} : { exame: "", codigo_curto: "", codigo_procedimento: "", nome_especialidade: "", codigo_especialidade: "" }),
                        };
                      });
                    }}
                    placeholder="Ex: ULTRASSONOGRAFIA"
                    list="tipos-fila-datalist"
                  />
                  <datalist id="tipos-fila-datalist">
                    {opTipos.map((o) => <option key={o.value} value={o.value} />)}
                  </datalist>
                </div>
                <div>
                  <Label>Número do Pedido</Label>
                  <Input value={form.numero_pedido} onChange={(e) => setForm({ ...form, numero_pedido: e.target.value.toUpperCase().slice(0, 30) })} placeholder="Ex: PED-2026-00123" />
                  <p className="mt-1 text-xs text-ink/50">Identificação operacional do pedido (o nº oficial segue sendo o #{editId ?? "novo"}).</p>
                </div>
              </div>

              {/* Unidade / PSF Solicitante e Médico Requisitante */}
              <div className="mt-3 grid gap-4 md:grid-cols-2 items-start">
                <div>
                  <div className="flex items-center justify-between min-h-[26px] mb-1.5">
                    <Label className="!mb-0 flex items-center gap-1.5">
                      <Building2 className="h-3.5 w-3.5 text-teal" /> PSF / Unidade Solicitante
                    </Label>
                  </div>
                  <Combobox
                    value={form.unidade_saude_id}
                    onChange={(v) => setForm({ ...form, unidade_saude_id: v })}
                    options={opcoesUnidades}
                    placeholder="Buscar PSF / Unidade…"
                    searchPlaceholder="Digite o nome da unidade…"
                    emptyText="Nenhuma unidade encontrada"
                    showAll={false}
                  />
                  {user?.unidade_saude_id && String(user.unidade_saude_id) === form.unidade_saude_id ? (
                    <p className="mt-1.5 text-[11px] font-medium text-teal">
                      ✓ Sua unidade de cadastro
                    </p>
                  ) : (
                    <p className="mt-1.5 text-[11px] text-ink/50">
                      Unidade de saúde de origem do pedido.
                    </p>
                  )}
                </div>
                <div>
                  <div className="flex items-center justify-between min-h-[26px] mb-1.5">
                    <Label className="!mb-0 flex items-center gap-1.5">
                      <Stethoscope className="h-3.5 w-3.5 text-teal" /> Médico(a) Requisitante
                    </Label>
                    <button
                      type="button"
                      onClick={() =>
                        setForm({
                          ...form,
                          medico_id: medGenerico ? String(medGenerico.id) : GENERICO_UNIDADE,
                        })
                      }
                      className="inline-flex items-center rounded-md bg-teal/10 px-2 py-0.5 text-[10px] font-bold text-teal hover:bg-teal/20 transition"
                      title="Definir Médico da Unidade"
                    >
                      🏥 Médico da Unidade
                    </button>
                  </div>
                  <Combobox
                    value={
                      medGenerico && String(form.medico_id) === String(medGenerico.id)
                        ? GENERICO_UNIDADE
                        : form.medico_id
                    }
                    onChange={(val) => {
                      if (val === GENERICO_UNIDADE) {
                        setForm({
                          ...form,
                          medico_id: medGenerico ? String(medGenerico.id) : GENERICO_UNIDADE,
                        });
                      } else {
                        setForm({ ...form, medico_id: val });
                      }
                    }}
                    options={opcoesMedicos}
                    placeholder="Buscar médico requisitante…"
                    searchPlaceholder="Digite o nome do médico ou CRM…"
                    emptyText="Nenhum médico encontrado"
                    showAll={false}
                  />
                  {medicosErro ? (
                    <p className="mt-1.5 text-[11px] text-red-600 font-medium">{medicosErro}</p>
                  ) : (
                    <p className="mt-1.5 text-[11px] text-ink/50">
                      Padrão: Médico da Unidade / Resp. Técnico.
                    </p>
                  )}
                </div>
              </div>
                  {valCbo && !valCbo.compativel && valCbo.alerta && (
                    <div className="mt-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <p className="font-bold text-amber-950">Aviso de CBO / Habilitação Médica no SIGTAP</p>
                          <p className="mt-0.5 text-amber-900 leading-relaxed">{valCbo.alerta}</p>
                          {valCbo.permite_responsavel_tecnico && (
                            <button
                              type="button"
                              onClick={() => {
                                if (medGenerico) {
                                  setForm({ ...form, medico_id: String(medGenerico.id) });
                                } else {
                                  setForm({ ...form, medico_id: GENERICO_UNIDADE });
                                }
                              }}
                              className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-200/90 px-2.5 py-1 text-xs font-bold text-amber-950 hover:bg-amber-300 transition"
                            >
                              🏥 Usar Médico da Unidade / Responsável Técnico
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                  {valCbo && valCbo.compativel && valCbo.exige_cbo_estrito && !valCbo.alerta && (
                    <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      CBO do profissional compatível com o procedimento no SIGTAP.
                    </p>
                  )}
                {/* Justificativa do Pedido */}
                <div className="mt-3">
                  <Label>Justificativa do Pedido *</Label>
                  <textarea
                    rows={3}
                    maxLength={500}
                    value={form.justificativa}
                    onChange={(e) => setForm({ ...form, justificativa: e.target.value })}
                    placeholder="Informe a justificativa clínica do pedido..."
                    className={`w-full rounded-xl border bg-white px-3 py-2 text-sm outline-none transition focus:border-teal ${
                      form.justificativa.length > 0 && form.justificativa.trim().length < 12
                        ? "border-red-500 focus:border-red-500"
                        : "border-sus-900/15"
                    }`}
                  />
                  <div className="mt-1 flex items-center justify-between text-xs">
                    <span className={form.justificativa.trim().length < 12 ? "font-medium text-red-600" : "font-medium text-teal"}>
                      {form.justificativa.trim().length < 12
                        ? "A justificativa é obrigatória e deve ter pelo menos 12 caracteres."
                        : "Justificativa clínica válida."}
                    </span>
                    <span className={form.justificativa.trim().length < 12 ? "text-ink/45" : "text-teal"}>
                      {form.justificativa.trim().length}/12 caracteres mínimos
                    </span>
                  </div>
                </div>
              </section>
              {/* Classificação */}
              <section>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-sus-900/55">Classificação</p>
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <Label>Código procedimento</Label>
                    <Input
                      value={form.codigo_procedimento}
                      onChange={(e) => setForm({ ...form, codigo_procedimento: e.target.value })}
                      placeholder="Ex: 0205020186"
                      list="procedimentos-datalist"
                    />
                    <datalist id="procedimentos-datalist">
                      {procsDoTipo.map((p, idx) => (
                        <option
                          key={`${p.codigo_procedimento || p.exame}-${idx}`}
                          value={p.codigo_procedimento || sigtapDe(p.exame) || ""}
                        >
                          {p.codigo_curto ? `${p.codigo_curto} · ` : ""}{nomeLimpo(p.exame)}
                        </option>
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <Label>Especialidade</Label>
                    <Input
                      value={form.nome_especialidade || form.especialidade}
                      onChange={(e) => setForm({ ...form, nome_especialidade: e.target.value, especialidade: e.target.value })}
                      placeholder="Ex: Médico urologista"
                      list="especialidades-datalist"
                    />
                    <datalist id="especialidades-datalist">
                      {especialidadesDoTipo.map((esp) => (
                        <option key={esp.nome} value={esp.nome}>
                          {esp.cbo ? `CBO ${esp.cbo} · ` : ""}{esp.nome}
                        </option>
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <Label>CBO</Label>
                    <Input
                      value={form.codigo_especialidade}
                      onChange={(e) => setForm({ ...form, codigo_especialidade: e.target.value.replace(/\D/g, "").slice(0, 6) })}
                      placeholder="Ex: 225285"
                      inputMode="numeric"
                      list="cbos-datalist"
                    />
                    <datalist id="cbos-datalist">
                      {especialidadesDoTipo.filter((esp) => esp.cbo).map((esp) => (
                        <option key={esp.cbo} value={esp.cbo}>
                          {esp.nome}
                        </option>
                      ))}
                    </datalist>
                  </div>
                </div>
              </section>
              {/* Situação e datas */}
              <section>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-sus-900/55">Situação e datas</p>
                <div className="grid gap-4 md:grid-cols-4">
                  <div>
                    <Label>Prioridade{(editId && !podeEditarPrio) || isLancamentoRestrito ? " (somente leitura)" : ""}</Label>
                    <select
                      value={form.prioridade}
                      disabled={(!!editId && !podeEditarPrio) || isLancamentoRestrito}
                      onChange={(e) => setForm({ ...form, prioridade: e.target.value })}
                      className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm disabled:bg-sand disabled:text-ink/50"
                      title={(editId && !podeEditarPrio) ? "Somente o médico envolvido altera a prioridade" : isLancamentoRestrito ? "Seu perfil não permite definir urgência" : undefined}
                    >
                      {PRIOS.filter((p) => !isLancamentoRestrito || p === "rotina").map((p) => <option key={p} value={p}>{PRIO_ROTULO[p]}</option>)}
                    </select>
                    {isLancamentoRestrito && <p className="mt-1 text-xs text-amber-700">Seu perfil permite apenas lançamentos com prioridade Rotina.</p>}
                  </div>
                  <div>
                    <Label>Status</Label>
                    <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
                      {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div><Label>Data pedido *</Label><Input type="date" value={form.data_pedido} min={retroativoBloqueado ? hojeISO() : undefined} onChange={(e) => setForm({ ...form, data_pedido: e.target.value })} /></div>
                  <div><Label>Data agendada</Label><Input type="date" value={form.data_agendada} min={retroativoBloqueado ? hojeISO() : undefined} onChange={(e) => setForm({ ...form, data_agendada: e.target.value })} /></div>
                </div>
                {editId && (
                  <div className="mt-4">
                    <Label>Justificativa técnica da prioridade {prioAlterada ? "*" : ""}{!podeEditarPrio ? " (somente leitura)" : ""}</Label>
                    <textarea
                      value={form.justificativa_prioridade}
                      disabled={!podeEditarPrio}
                      onChange={(e) => setForm({ ...form, justificativa_prioridade: e.target.value })}
                      rows={3}
                      maxLength={500}
                      placeholder={podeEditarPrio ? "Obrigatória ao alterar a prioridade (mín. 12 caracteres)…" : "Somente o médico envolvido registra justificativa"}
                      className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm outline-none focus:border-teal disabled:bg-sand disabled:text-ink/50"
                    />
                    <p className={`mt-1 text-xs ${form.justificativa_prioridade.trim().length < JUST_MIN ? "text-ink/45" : "text-teal"}`}>
                      {form.justificativa_prioridade.trim().length}/{JUST_MIN} caracteres mínimos
                    </p>
                  </div>
                )}
              </section>
              {/* Agendamento: médico + unidade */}
              <section>
              {isLancamentoRestrito ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-amber-800">Agendamento bloqueado</p>
                  <p className="mt-0.5 text-xs text-amber-700">Seu perfil permite apenas adicionar o paciente à fila de espera. O agendamento deve ser realizado por um operador com perfil de regulação.</p>
                </div>
              ) : (
              <button
                  type="button"
                  onClick={() => setMostrarAgendamento((v) => !v)}
                  aria-expanded={mostrarAgendamento}
                  className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition ${mostrarAgendamento ? "border-teal bg-teal/5" : "border-sus-900/15 bg-sand/40 hover:border-teal/50"}`}
                >
                  <span>
                    <span className="block text-[11px] font-bold uppercase tracking-wide text-sus-900/55">Agendamento — médico e unidade</span>
                    <span className="block text-xs text-ink/55">{mostrarAgendamento ? "Seção expandida: data, horário, médico e unidade." : "Expandir para marcar data, horário, médico e unidade."}</span>
                  </span>
                  <span className={`rounded-full px-3 py-1.5 text-xs font-bold ${mostrarAgendamento ? "bg-teal text-white" : "bg-sus-900/10 text-sus-900"}`}>
                    {mostrarAgendamento ? "Ocultar" : "Agendar Atendimento"}
                  </span>
                </button>
              )}
                {mostrarAgendamento && (
                <>
                <div className="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-4 items-start">
                  <div>
                    <div className="flex items-center min-h-[26px] mb-1.5">
                      <Label className="!mb-0">Data agendada *</Label>
                    </div>
                    <Input type="date" value={form.data_agendada} min={retroativoBloqueado ? hojeISO() : undefined} onChange={(e) => setForm({ ...form, data_agendada: e.target.value })} />
                  </div>
                  <div>
                    <div className="flex items-center justify-between min-h-[26px] mb-1.5">
                      <Label className="!mb-0 flex items-center gap-1.5">
                        <Stethoscope className="h-3.5 w-3.5 text-teal" /> Médico(a) *
                      </Label>
                      <button
                        type="button"
                        onClick={() =>
                          setForm({
                            ...form,
                            medico_id: medGenerico ? String(medGenerico.id) : GENERICO_UNIDADE,
                          })
                        }
                        className="inline-flex items-center rounded-md bg-teal/10 px-2 py-0.5 text-[10px] font-bold text-teal hover:bg-teal/20 transition"
                        title="Definir Médico da Unidade"
                      >
                        🏥 Médico da Unidade
                      </button>
                    </div>
                    <Combobox
                      value={
                        medGenerico && String(form.medico_id) === String(medGenerico.id)
                          ? GENERICO_UNIDADE
                          : form.medico_id
                      }
                      onChange={(val) => {
                        if (val === GENERICO_UNIDADE) {
                          setForm({
                            ...form,
                            medico_id: medGenerico ? String(medGenerico.id) : GENERICO_UNIDADE,
                          });
                        } else {
                          setForm({ ...form, medico_id: val });
                        }
                      }}
                      options={opcoesMedicos}
                      placeholder="Buscar médico do agendamento…"
                      searchPlaceholder="Digite o nome do médico ou CRM…"
                      emptyText="Nenhum médico encontrado"
                      showAll={false}
                    />
                    {medicosErro && <p className="mt-1 text-xs text-red-600">{medicosErro}</p>}
                    {cbos.length > 0 && (
                      <p className="mt-1 text-xs text-ink/55">
                        CBO SIGTAP do procedimento: {cbos.slice(0, 3).map((c) => `${c.cbo}${c.descricao ? ` ${c.descricao}` : ""}`).join(" · ")}{cbos.length > 3 ? ` (+${cbos.length - 3})` : ""}
                      </p>
                    )}
                  </div>
                  <div>
                    <div className="flex items-center min-h-[26px] mb-1.5">
                      <Label className="!mb-0">Hora</Label>
                    </div>
                    <Input type="time" value={form.hora_agendada} onChange={(e) => setForm({ ...form, hora_agendada: e.target.value })} />
                  </div>
                  <div>
                    <div className="flex items-center min-h-[26px] mb-1.5">
                      <Label className="!mb-0 flex items-center gap-1.5">
                        <Building2 className="h-3.5 w-3.5 text-teal" /> PSF / Unidade *
                      </Label>
                    </div>
                    <Combobox
                      value={form.unidade_saude_id}
                      onChange={(v) => setForm({ ...form, unidade_saude_id: v })}
                      options={opcoesUnidades}
                      placeholder="Buscar unidade de atendimento…"
                      searchPlaceholder="Digite o nome da unidade…"
                      emptyText="Nenhuma unidade encontrada"
                      showAll={false}
                    />
                  </div>
                </div>
                <p className="mt-1 text-xs text-ink/50">Obrigatórios ao marcar data agendada. Nome, CPF, CBO do médico e endereço da unidade ficam registrados no pedido.</p>
                </>
                )}
              </section>
              {/* Destino e observações */}
              <section>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-sus-900/55">Destino e observações</p>
                <div className="grid gap-4 md:grid-cols-3">
                  <div><Label>Destino / unidade</Label><Input value={form.destino} onChange={(e) => setForm({ ...form, destino: e.target.value })} placeholder="Cidade / unidade" /></div>
                  <div className="md:col-span-2"><Label>Observações</Label><Input value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} /></div>
                </div>
              </section>
              {erro && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
              <Button onClick={salvar} disabled={salvando} className="w-full"><Plus className="h-4 w-4" />{salvando ? "Salvando…" : editId ? "Atualizar" : "Entrar na fila"}</Button>
            </div>
          </div>
        </div>
      )}

      {comprovante && createPortal(
        <div id="comprovante-overlay" className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4" onClick={() => setComprovante(null)}>
          <div id="comprovante-print" className="max-h-[90vh] w-full max-w-md overflow-auto rounded-2xl bg-white p-6 shadow-card print:max-h-none print:overflow-visible print:rounded-none print:shadow-none" onClick={(e) => e.stopPropagation()}>
            <div className="comprovante-header mb-4 flex items-center justify-between print:hidden">
              <p className="flex items-center gap-2 font-display text-base font-bold text-sus-950">
                <CheckCircle2 className="h-5 w-5 text-teal" /> Comprovante do pedido
              </p>
              <button onClick={() => setComprovante(null)} className="rounded-lg p-2 text-ink/50 hover:bg-sand" aria-label="Fechar"><X className="h-4 w-4" /></button>
            </div>
            <div id="comprovante-dados" className="rounded-2xl border border-sus-900/10 p-4 text-sm print:block">
              <p className="mb-2 inline-flex items-center gap-2 rounded-xl bg-sus-900 px-3 py-1.5 font-display text-sm font-extrabold text-white print:border print:border-black print:bg-white print:text-black">
                Número do Pedido: #{comprovante.numero_pedido || comprovante.id}
              </p>
              <p className="font-display text-base font-bold text-sus-950">{comprovante.exame}</p>
              <p className="text-xs text-ink/55">{comprovante.especialidade || "—"} · {PRIO_ROTULO[comprovante.prioridade] ?? comprovante.prioridade} · pedido {fmtData(comprovante.data_pedido)}</p>
              <p className="mt-2 font-semibold">{comprovante.paciente_nome}</p>
              {comprovante.paciente_cpf && <p className="text-xs text-ink/60">CPF: {comprovante.paciente_cpf}</p>}
              <p className="mt-1 text-xs text-ink/60">
                Status: <b>{comprovante.status}</b>
                {comprovante.posicao ? ` · posição ${rotuloPosicao(comprovante)}` : ""}
              </p>
              {comprovante.public_token && (
                <>
                  <div className="mt-3 grid place-items-center rounded-xl bg-sand/60 p-3 print:block print:bg-white print:p-0">
                    <img src={qrUrl(linkAcompanhar(comprovante))} alt="QR Code acompanhamento" className="h-44 w-44 print:block" loading="lazy" />
                    <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-sus-900"><QrCode className="h-3.5 w-3.5 print:hidden" /> Escaneie para acompanhar</p>
                  </div>
                  <p className="mt-2 break-all rounded-xl bg-sand/60 px-3 py-2 text-xs text-sus-900 print:block print:bg-white print:px-0">{linkAcompanhar(comprovante)}</p>
                </>
              )}
            </div>
            <div className="comprovante-acoes mt-3 grid grid-cols-2 gap-2 print:hidden">
              {comprovante.public_token && (
                <Button onClick={() => copiar(linkAcompanhar(comprovante))} className="!w-auto"><Copy className="h-4 w-4" /> Copiar link</Button>
              )}
              <button onClick={() => window.print()} className="flex items-center justify-center gap-2 rounded-xl bg-sus-900/10 px-4 py-2.5 text-sm font-semibold text-sus-900 hover:bg-sus-900/15">
                <Printer className="h-4 w-4" /> Imprimir
              </button>
            </div>
            <button onClick={() => regenerar(comprovante.id)} className="comprovante-extra mt-2 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold text-sus-900/60 hover:bg-sand print:hidden">
              <RefreshCw className="h-3.5 w-3.5" /> Renovar link de acompanhamento
            </button>
            {comprovante.public_token && (
              <div className="comprovante-extra print:hidden">
                <ComprovanteCheck token={comprovante.public_token} />
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
      {detalhe && (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-sus-950/50 p-4 print:hidden" onClick={() => setDetalhe(null)}>
          <div className="max-h-[90vh] w-full max-w-5xl overflow-auto rounded-2xl bg-white p-6 shadow-card md:p-8" onClick={(e) => e.stopPropagation()}>
            <div className="mb-5 flex items-center justify-between">
              <p className="flex items-center gap-2 font-display text-lg font-bold text-sus-950">
                <Eye className="h-5 w-5 text-sus-900" /> Detalhes do pedido #{detalhe.id}
              </p>
              <button onClick={() => setDetalhe(null)} className="rounded-lg p-2 text-ink/50 hover:bg-sand" aria-label="Fechar"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid gap-4 text-sm lg:grid-cols-3">
              <div className="space-y-4 lg:col-span-2">
              <div className="rounded-2xl border border-sus-900/10 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-sus-900/50">Paciente</p>
                <p className="mt-1 text-base font-bold text-sus-950">{detalhe.paciente_nome}</p>
                {(detalhe.paciente_endereco || detalhe.paciente_bairro) && (
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-ink/75">
                    <MapPin className="h-3.5 w-3.5 text-teal shrink-0" />
                    <span>
                      {detalhe.paciente_endereco}
                      {detalhe.paciente_numero ? `, nº ${detalhe.paciente_numero}` : ""}
                      {detalhe.paciente_complemento ? ` (${detalhe.paciente_complemento})` : ""}
                      {detalhe.paciente_bairro ? ` · Bairro ${detalhe.paciente_bairro}` : ""}
                      {detalhe.paciente_municipio ? ` · ${detalhe.paciente_municipio}` : ""}
                    </span>
                  </p>
                )}
                <button onClick={() => setPerfilId(detalhe.paciente_id)} className="mt-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-teal/10 px-3 py-2 text-xs font-bold text-teal hover:bg-teal/15">
                  <Eye className="h-4 w-4" /> Ver perfil e demanda reprimida
                </button>
                {(detalhe.posicao || detalhe.posicao_tipo || detalhe.posicao_especialidade) ? (
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <span className="rounded-lg bg-teal/15 px-2.5 py-1 text-xs font-bold text-teal">
                      Tipo de Fila: {detalhe.posicao_tipo ?? detalhe.posicao}º (de {detalhe.total_tipo ?? detalhe.total_fila ?? "—"}) · {detalhe.grupo_tipo || detalhe.tipo_fila || "Geral"}
                    </span>
                    <span className="rounded-lg bg-sus-900/10 px-2.5 py-1 text-xs font-bold text-sus-900">
                      Especialidade: {detalhe.posicao_especialidade ?? detalhe.posicao}º (de {detalhe.total_especialidade ?? detalhe.total_fila ?? "—"}) · {detalhe.grupo_especialidade || detalhe.nome_especialidade || "Esp."}
                    </span>
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-ink/60">Fora da fila ativa (status {detalhe.status}).</p>
                )}
              </div>
              <div className="rounded-2xl border border-sus-900/10 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-sus-900/50">Procedimento</p>
                <p className="mt-1 font-display text-base font-bold text-sus-950">{nomeLimpo(detalhe.exame)}</p>
                <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2.5 text-xs md:grid-cols-3">
                  <div><dt className="text-ink/45">Código SIGTAP</dt><dd className="font-semibold">{sigtapDe(detalhe.exame) || detalhe.codigo_procedimento || "—"}</dd></div>
                  <div><dt className="text-ink/45">Código curto</dt><dd className="font-semibold">{detalhe.codigo_curto || "—"}</dd></div>
                  <div><dt className="text-ink/45">Tipo de fila</dt><dd className="font-semibold">{detalhe.tipo_fila || "—"}</dd></div>
                  <div><dt className="text-ink/45">Tipo / especialidade</dt><dd className="font-semibold">{detalhe.especialidade || "—"}</dd></div>
                  <div><dt className="text-ink/45">Especialidade</dt><dd className="font-semibold">{detalhe.nome_especialidade || "—"}{detalhe.codigo_especialidade ? ` · ${detalhe.codigo_especialidade}` : ""}</dd></div>
                  <div>
                    <dt className="text-ink/45">Prioridade</dt>
                    <dd className="mt-0.5">
                      <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold leading-none ${prioCor[detalhe.prioridade] ?? "bg-sand"}`}>
                        {PRIO_ROTULO[detalhe.prioridade] ?? detalhe.prioridade}
                      </span>
                    </dd>
                  </div>
                  <div><dt className="text-ink/45">Status</dt><dd className="font-semibold">{detalhe.status}</dd></div>
                  <div>
                    <dt className="text-ink/45">Data do pedido (fila)</dt>
                    <dd className="mt-0.5 inline-flex items-center gap-1 font-bold text-amber-950 bg-amber-500/15 border border-amber-600/30 px-2 py-0.5 rounded text-xs">
                      <Calendar className="h-3 w-3 text-amber-800" />
                      {fmtData(detalhe.data_pedido)} {tempoEspera(detalhe.data_pedido) ? `(${tempoEspera(detalhe.data_pedido)})` : ""}
                    </dd>
                  </div>
                  <div><dt className="text-ink/45">Data agendada</dt><dd className="font-semibold">{fmtData(detalhe.data_agendada)}</dd></div>
                  <div><dt className="text-ink/45">Destino</dt><dd className="font-semibold">{detalhe.destino || "—"}</dd></div>
                </dl>
                {detalhe.justificativa && (
                  <p className="mt-2 rounded-xl bg-teal/10 p-3 text-xs text-ink/80">
                    <span className="font-bold text-sus-950">Justificativa do pedido: </span>
                    {detalhe.justificativa}
                  </p>
                )}
                {detalhe.observacoes && (
                  <p className="mt-2 rounded-xl bg-sand/60 px-3 py-2 text-xs text-ink/70">{detalhe.observacoes}</p>
                )}
                <p className="mt-2 break-all text-[11px] text-ink/40" title="Registro completo (legado)">{detalhe.exame}</p>
              </div>
              <div className="rounded-2xl border border-teal/25 bg-teal/5 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-sus-900/60">Médico solicitante / atendente</p>
                <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2.5 text-xs md:grid-cols-3">
                  <div><dt className="text-ink/45">Nome</dt><dd className="font-semibold">{detalhe.medico_nome || "—"}</dd></div>
                  <div><dt className="text-ink/45">CPF</dt><dd className="font-semibold">{detalhe.medico_cpf || "—"}</dd></div>
                  <div><dt className="text-ink/45">CBO</dt><dd className="font-semibold">{detalhe.medico_cbo_codigo ? `${detalhe.medico_cbo_codigo}${detalhe.medico_cbo_descricao ? ` · ${detalhe.medico_cbo_descricao}` : ""}` : "—"}</dd></div>
                </dl>
                {detalhe.justificativa_prioridade ? (
                  <p className="mt-2 rounded-xl bg-white/70 px-3 py-2 text-xs text-ink/70"><b>Justificativa da prioridade:</b> {detalhe.justificativa_prioridade}</p>
                ) : (
                  <p className="mt-2 text-xs text-ink/45">Sem justificativa registrada.</p>
                )}
              </div>
              <div className="rounded-2xl border border-sus-900/10 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-sus-900/50">Unidade de atendimento</p>
                <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2.5 text-xs md:grid-cols-3">
                  <div className="col-span-2 md:col-span-1"><dt className="text-ink/45">Nome</dt><dd className="font-semibold">{detalhe.unidade_nome || detalhe.destino || "—"}</dd></div>
                  <div><dt className="text-ink/45">CNES</dt><dd className="font-semibold">{detalhe.unidade_cnes || "—"}</dd></div>
                  <div><dt className="text-ink/45">CEP</dt><dd className="font-semibold">{detalhe.unidade_cep || "—"}</dd></div>
                  <div className="col-span-2 md:col-span-3"><dt className="text-ink/45">Endereço completo</dt><dd className="font-semibold">{[detalhe.unidade_endereco, detalhe.unidade_numero ? `Nº ${detalhe.unidade_numero}` : "", detalhe.unidade_bairro, detalhe.unidade_municipio].filter(Boolean).join(" · ") || "—"}</dd></div>
                </dl>
              </div>
              <div className="rounded-2xl border border-sus-900/10 p-4">
                <Timeline pacienteId={detalhe.paciente_id} filtrarProcedimento={detalhe.exame} />
              </div>
              </div>
              <div className="space-y-4">
              <BotaoWhatsApp exameId={detalhe.id} exame={detalhe} variante="card" />
              <div className="rounded-2xl border border-sus-900/10 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-sus-900/50">Rastreio público</p>
                {detalhe.public_token ? (
                  <>
                    <div className="mt-2 grid place-items-center rounded-xl bg-sand/60 p-3">
                      <img src={qrUrl(linkAcompanhar(detalhe))} alt="QR Code acompanhamento" className="h-48 w-48" loading="lazy" />
                      <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-sus-900"><QrCode className="h-3.5 w-3.5" /> Escaneie para acompanhar</p>
                    </div>
                    <p className="mt-2 break-all rounded-xl bg-sand/60 px-3 py-2 text-xs text-sus-900">{linkAcompanhar(detalhe)}</p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <Button onClick={() => copiar(linkAcompanhar(detalhe))} className="!w-auto"><Copy className="h-4 w-4" /> Copiar link</Button>
                      <button onClick={() => { setComprovante(detalhe); setDetalhe(null); }} className="flex items-center justify-center gap-2 rounded-xl bg-sus-900/10 px-4 py-2.5 text-sm font-semibold text-sus-900 hover:bg-sus-900/15">
                        <Printer className="h-4 w-4" /> Comprovante
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="mt-1 text-xs text-ink/55">Sem token gerado.</p>
                )}
              </div>
              <div className="grid grid-cols-1 gap-2">
                <Button onClick={() => { const id = detalhe.id; setDetalhe(null); abrirModal(id); }} className="!w-auto"><Pencil className="h-4 w-4" /> Editar</Button>
                <button onClick={() => { setDetalhe(null); regenerar(detalhe.id); }} className="flex items-center justify-center gap-2 rounded-xl bg-sus-900/10 px-4 py-2.5 text-sm font-semibold text-sus-900 hover:bg-sus-900/15">
                  <RefreshCw className="h-4 w-4" /> Renovar link
                </button>
              </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {perfilId !== null && (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-sus-950/50 p-4 print:hidden" onClick={() => setPerfilId(null)}>
          <div className="max-h-[90vh] w-full max-w-4xl overflow-auto rounded-2xl bg-white p-6 shadow-card md:p-8" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <p className="font-display text-lg font-bold text-sus-950">Perfil do paciente</p>
              <button onClick={() => setPerfilId(null)} className="rounded-lg p-2 text-ink/50 hover:bg-sand" aria-label="Fechar"><X className="h-4 w-4" /></button>
            </div>
            <PerfilPaciente pid={perfilId} />
          </div>
        </div>
      )}
      {/* Modal de seleção de colunas para exportação */}
      {exportModal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4 print:hidden" onClick={() => setExportModal(false)}>
          <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl bg-white shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            {/* Cabeçalho Fixo (Header / Sticky) com Título e Ações */}
            <div className="border-b border-sus-900/10 p-5 bg-sand/40">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="font-display text-base font-bold text-sus-950">Exportar Fila para Excel (.xlsx)</p>
                  <p className="text-xs text-ink/60">
                    {sel.length > 0 && exportarApenasSel
                      ? `Exportando apenas os ${sel.length} paciente(s) selecionado(s)`
                      : "Exportando todos os registros do filtro ativo"}
                    {" · "}
                    {colunasExport.length} de {COLUNAS_EXPORTACAO.length} colunas selecionadas
                  </p>
                </div>
                <button onClick={() => setExportModal(false)} className="rounded-lg p-2 text-ink/50 hover:bg-sand transition" aria-label="Fechar">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {sel.length > 0 && (
                <div className="mb-3 flex items-center justify-between rounded-xl border border-teal/30 bg-teal/5 px-3.5 py-2 text-xs text-sus-950">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-teal shrink-0" />
                    <span>
                      {exportarApenasSel ? (
                        <>Exportando <strong>apenas os {sel.length} paciente(s) selecionado(s)</strong> na tabela.</>
                      ) : (
                        <>Exportando <strong>todos os registros do filtro ativo</strong> (ignorando a seleção).</>
                      )}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExportarApenasSel(!exportarApenasSel)}
                    className="font-bold text-teal hover:underline ml-2 whitespace-nowrap"
                  >
                    {exportarApenasSel
                      ? "Alternar para: Exportar todos do filtro"
                      : `Alternar para: Exportar apenas selecionados (${sel.length})`}
                  </button>
                </div>
              )}

              {/* Botões de Ação Permanentes no Topo */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setColunasExport(COLUNAS_EXPORTACAO.map((c) => c.id))}
                  className="rounded-xl border border-sus-900/20 bg-white px-3 py-1.5 text-xs font-semibold text-sus-900 hover:bg-sand transition"
                >
                  Selecionar Todas
                </button>
                <button
                  type="button"
                  onClick={() => setColunasExport(COLUNAS_EXPORTACAO.filter((c) => c.padrao).map((c) => c.id))}
                  className="rounded-xl border border-sus-900/20 bg-white px-3 py-1.5 text-xs font-semibold text-sus-900 hover:bg-sand transition"
                >
                  Padrão
                </button>
                <button
                  type="button"
                  onClick={() => setColunasExport([])}
                  className="rounded-xl border border-sus-900/15 bg-white px-3 py-1.5 text-xs font-semibold text-ink/70 hover:bg-sand transition"
                >
                  Limpar
                </button>

                <div className="ml-auto">
                  <ExportarExcel
                    url="/api/tfd/exames/exportar"
                    arquivo={sel.length > 0 && exportarApenasSel ? `fila_selecionados_${sel.length}` : "fila_procedimentos"}
                    params={{
                      status: filtro || undefined,
                      q: q.trim() || undefined,
                      prioridade: prio || undefined,
                      tipo_fila: tipoFila.trim() || undefined,
                      procedimento: proc.trim() || undefined,
                      codigo_especialidade: espCbo.trim() || undefined,
                      destino: dest.trim() || undefined,
                      unidade_id: filtroUnidadeId ? Number(filtroUnidadeId) : undefined,
                      data_de: de || undefined,
                      data_ate: ate || undefined,
                      meus: soMeus || undefined,
                      ordenacao: ordem,
                      colunas: colunasExport.join(","),
                      ids: (sel.length > 0 && exportarApenasSel) ? sel.join(",") : undefined,
                    }}
                    rotulo={sel.length > 0 && exportarApenasSel ? `Exportar ${sel.length} selecionado(s)` : "Baixar / Exportar Excel"}
                    className="inline-flex min-h-[38px] items-center gap-2 rounded-xl bg-teal px-4 py-2 text-xs font-bold text-white shadow-sm hover:brightness-110 transition disabled:opacity-50"
                  />
                </div>
              </div>
            </div>

            {/* Grid Responsivo de 2 Colunas com Altura Máxima Contida */}
            <div className="max-h-[60vh] overflow-y-auto p-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {COLUNAS_EXPORTACAO.map((col) => {
                  const marcada = colunasExport.includes(col.id);
                  return (
                    <label
                      key={col.id}
                      className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition text-sm ${
                        marcada
                          ? "border-teal/40 bg-teal/5 text-sus-950 font-semibold"
                          : "border-sus-900/10 bg-white text-ink/75 hover:bg-sand/60"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={marcada}
                        onChange={(e) => {
                          setColunasExport((prev) =>
                            e.target.checked ? [...prev, col.id] : prev.filter((c) => c !== col.id)
                          );
                        }}
                        className="h-4 w-4 accent-teal rounded cursor-pointer"
                      />
                      <span className="truncate">{col.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Rodapé informativo discreto */}
            <div className="border-t border-sus-900/10 px-5 py-3 bg-sand/20 flex items-center justify-between text-xs text-ink/50">
              <span>{colunasExport.length} colunas selecionadas para exportação</span>
              <button
                type="button"
                onClick={() => setExportModal(false)}
                className="text-xs font-semibold text-ink/70 hover:text-sus-950"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ComprovanteCheck({ token }: { token: string }) {
  const [msg, setMsg] = useState("");
  useEffect(() => {
    tfdConsultarExamePublico(token).then(
      () => setMsg(""),
      () => setMsg("Link público indisponível no momento.")
    );
  }, [token]);
  if (!msg) return null;
  return <p className="mt-2 text-center text-xs text-red-600 print:hidden">{msg}</p>;
}
