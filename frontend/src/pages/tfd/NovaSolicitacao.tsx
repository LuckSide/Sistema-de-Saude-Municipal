import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Building2,
  Calendar,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  Layers,
  ListOrdered,
  MapPin,
  Plus,
  Printer,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  Stethoscope,
  Trash2,
  User,
  Users,
  X,
} from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { acoesEfetivas, type Acao } from "../../permissoes";
import {
  fetchMedicos,
  fetchUnidadesSaude,
  tfdCatalogoExames,
  tfdCriarExame,
  tfdCriarExamesLote,
  tfdTipos,
  tfdEspecialidades,
  tfdCboEspecialidades,
  tfdBuscarCids,
  labSigtap,
  sigtapArvore,
  sigtapCbos,
  pagData,
  msgErro,
  type CatalogoProc,
  type EspecialidadeCat,
  type Exame,
  type ExameLoteCriarOut,
  type Medico,
  type Paciente,
  type SigtapArvore,
  type SigtapCbo,
  type SigtapCidItem,
  type SigtapProc,
  type TipoFila,
  type UnidadeSaude,
  tfdVerificarDuplicidade,
  type PedidoDuplicadoTfd,
  validarCboProcedimento,
  type ValidarCboResult,
} from "../../services/api";
import { Button, Card, Input, Label, Select } from "../../components/ui/primitives";
import { Combobox } from "../../components/ui/combobox";
import BuscaPacienteAutocomplete from "../../components/BuscaPacienteAutocomplete";
import BotaoWhatsApp from "../../components/BotaoWhatsApp";
import ComprovanteExameModal from "../../components/ComprovanteExameModal";
import AlertaPedidoDuplicado from "../../components/AlertaPedidoDuplicado";

function hojeISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function normalizarTexto(texto: string): string {
  return (texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

type PacienteComUnidade = Paciente & {
  unidade_nome?: string;
  unidade_cnes?: string;
};

function ehFilaLaboratorio(tf: TipoFila): boolean {
  if ((tf.tipo_fila || "").trim().toUpperCase() === "EXAME_LABORATORIAL") return true;
  const nomeNorm = normalizarTexto(tf.nome || "").trim().toUpperCase();
  return (
    nomeNorm.startsWith("EX. LAB.") ||
    nomeNorm.startsWith("EX.LAB.") ||
    nomeNorm.startsWith("EX LAB") ||
    nomeNorm.startsWith("LABORATORIO")
  );
}

function encontrarUnidadeDoPaciente(
  p: PacienteComUnidade,
  listaUnidades: UnidadeSaude[],
): UnidadeSaude | undefined {
  if (!listaUnidades.length) return undefined;
  if (p.unidade_saude_id) {
    const porId = listaUnidades.find((u) => u.id === p.unidade_saude_id);
    if (porId) return porId;
  }
  const cnesPac = (p.unidade_cnes || "").trim();
  if (cnesPac) {
    const porCnes = listaUnidades.find((u) => (u.cnes || "").trim() === cnesPac);
    if (porCnes) return porCnes;
  }
  const nomePac = normalizarTexto(p.unidade_nome || "").trim();
  if (nomePac) {
    const porNomeExato = listaUnidades.find(
      (u) => normalizarTexto(u.nome || "").trim() === nomePac,
    );
    if (porNomeExato) return porNomeExato;
    const porNomeParcial = listaUnidades.find((u) => {
      const nU = normalizarTexto(u.nome || "").trim();
      return Boolean(nU && (nU.includes(nomePac) || nomePac.includes(nU)));
    });
    if (porNomeParcial) return porNomeParcial;
  }
  return undefined;
}

function formatarEnderecoCompleto(p: Paciente): string {
  const logradouro = p.endereco
    ? p.endereco_numero
      ? `${p.endereco}, nº ${p.endereco_numero}`
      : p.endereco
    : "";
  const partes = [
    logradouro,
    p.complemento ? `(${p.complemento})` : "",
    p.bairro ? `Bairro ${p.bairro}` : "",
    p.municipio || "",
    p.cep ? `CEP ${p.cep}` : "",
  ].filter((x) => Boolean(x && x.trim()));
  return partes.join(" · ");
}

const JUST_MIN = 12;
const MEDICO_GENERICO = "Médico da Unidade / Responsável Técnico";

export default function NovaSolicitacao() {
  const navigate = useNavigate();
  const { user, can, isTfdCentral, isLancamentoRestrito, retroativoBloqueado } = useAuth();
  const podeDataRetroativa = isTfdCentral && !retroativoBloqueado;
  /** Apenas médicos (ou superuser) podem classificar prioridade urgente na tela de lançamento. */
  const podeDefinirPrioridade = Boolean(
    user?.is_superuser || (user?.medico_id && !isLancamentoRestrito),
  );
  /** Agendamento direto exige permissão RBAC de Agenda TFD (tfd_agenda:criar). */
  const podeAgendarDireto = useMemo(() => {
    if (!user || !isTfdCentral) return false;
    if (user.is_superuser) return true;
    if (!can("tfd_agenda")) return false;
    const acoes = acoesEfetivas((user.acoes ?? {}) as Record<string, Acao[]>, "tfd_agenda");
    return acoes.includes("criar");
  }, [user, isTfdCentral, can]);

  // Estados dos Catálogos
  const [tiposFila, setTiposFila] = useState<TipoFila[]>([]);
  const [procedimentosTodos, setProcedimentosTodos] = useState<CatalogoProc[]>([]);
  const [procedimentosFiltrados, setProcedimentosFiltrados] = useState<CatalogoProc[]>([]);
  const [medicos, setMedicos] = useState<Medico[]>([]);
  const [unidades, setUnidades] = useState<UnidadeSaude[]>([]);
  const [carregandoCatalogos, setCarregandoCatalogos] = useState(true);

  // Seleções do Formulário
  const [pacienteSelecionado, setPacienteSelecionado] = useState<Paciente | null>(null);

  // Hierarquia: 1º Tipo de Serviço -> 2º Procedimento ou CBO (Consultas vs Exames/Cirurgias)
  const [tipoServico, setTipoServico] = useState("");
  const isConsulta = useMemo(() => {
    const t = (tipoServico || "").toUpperCase();
    return t.includes("CONSULTA");
  }, [tipoServico]);

  const [procedimentoSel, setProcedimentoSel] = useState<CatalogoProc | null>(null);
  const [procTexto, setProcTexto] = useState("");
  const [buscaProc, setBuscaProc] = useState("");
  const [procFoco, setProcFoco] = useState(false);
  const [codigoProcedimento, setCodigoProcedimento] = useState("");
  const [especialidade, setEspecialidade] = useState("");
  const [codigoEspecialidade, setCodigoEspecialidade] = useState("");
  const [espManual, setEspManual] = useState(false);
  const [cbosAutorizados, setCbosAutorizados] = useState<SigtapCbo[]>([]);
  const [carregandoCbos, setCarregandoCbos] = useState(false);

  // Árvore SIGTAP completa (Área -> Subgrupo -> CBO) e Especialidades filtradas pelo CBO
  const [arvoreSigtap, setArvoreSigtap] = useState<SigtapArvore | null>(null);
  const [grupoSig, setGrupoSig] = useState("");
  const [subgrupoSig, setSubgrupoSig] = useState("");
  const [cboFiltroSig, setCboFiltroSig] = useState("");
  const [espsCboSel, setEspsCboSel] = useState<{ id: number | null; codigo_cbo: string; nome: string; ativo: boolean }[]>([]);

  // Origem e Data
  const [unidadeId, setUnidadeId] = useState<string>("");
  const [medicoId, setMedicoId] = useState<string>("");
  const [dataPedido, setDataPedido] = useState<string>(hojeISO());

  // Validação Dinâmica de CBO com o Tipo de Serviço e Procedimento
  const [valCbo, setValCbo] = useState<ValidarCboResult | null>(null);
  const [validandoCbo, setValidandoCbo] = useState(false);

  // Dados Clínicos
  const [prioridade, setPrioridade] = useState<"rotina" | "urgente">("rotina");
  const [justificativa, setJustificativa] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [numeroPedido, setNumeroPedido] = useState("");
  const [cidCodigo, setCidCodigo] = useState("");
  const [cidDescricao, setCidDescricao] = useState("");
  const [buscaCid, setBuscaCid] = useState("");
  const [cidsSugeridos, setCidsSugeridos] = useState<SigtapCidItem[]>([]);
  const [buscandoCid, setBuscandoCid] = useState(false);

  useEffect(() => {
    if (!buscaCid || buscaCid.trim().length < 1) {
      setCidsSugeridos([]);
      return;
    }
    const t = setTimeout(() => {
      setBuscandoCid(true);
      tfdBuscarCids(buscaCid.trim())
        .then(setCidsSugeridos)
        .catch(() => setCidsSugeridos([]))
        .finally(() => setBuscandoCid(false));
    }, 250);
    return () => clearTimeout(t);
  }, [buscaCid]);

  // Agendamento Direto (Apenas TFD Central)
  const [agendamentoDireto, setAgendamentoDireto] = useState(false);
  const [dataAgendada, setDataAgendada] = useState("");
  const [horaAgendada, setHoraAgendada] = useState("08:00");

  // Feedback e Controle
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [criado, setCriado] = useState<Exame | null>(null);
  const [abrirComprovante, setAbrirComprovante] = useState(false);
  const [modalConfirmacao, setModalConfirmacao] = useState(false);
  const [procedimentosAdicionados, setProcedimentosAdicionados] = useState<{
    codigo: string;
    nome: string;
    especialidade?: string;
    codigo_especialidade?: string;
    tipo_fila: string;
  }[]>([]);

  const [especialidadesCadastradas, setEspecialidadesCadastradas] = useState<EspecialidadeCat[]>([]);
  const [procedimentosDinamicos, setProcedimentosDinamicos] = useState<CatalogoProc[]>([]);
  const [termoDinamico, setTermoDinamico] = useState("");
  const [buscandoProc, setBuscandoProc] = useState(false);
  const [erroCatalogo, setErroCatalogo] = useState("");

  // Modo de Lançamento: Individual vs Lote
  const [searchParams, setSearchParams] = useSearchParams();
  const modoParam = searchParams.get("modo");
  const [modo, setModo] = useState<"individual" | "lote">(modoParam === "lote" ? "lote" : "individual");

  useEffect(() => {
    if (modoParam === "lote" && modo !== "lote") {
      setModo("lote");
    } else if (!modoParam && modo !== "individual") {
      setModo("individual");
    }
  }, [modoParam]);

  function alternarModo(novoModo: "individual" | "lote") {
    setModo(novoModo);
    setSearchParams(novoModo === "lote" ? { modo: "lote" } : {});
    setErro("");
  }

  // Estados do Modo Lançamento em Lote
  interface ItemPacienteLote {
    uid: string;
    paciente: Paciente;
    justificativa?: string;
    cid_codigo?: string;
    cid_descricao?: string;
    observacoes?: string;
    duplicadoInfo?: PedidoDuplicadoTfd;
  }

  // Verificação de Pedidos Duplicados em Tempo Real
  const [duplicidadeAtiva, setDuplicidadeAtiva] = useState<PedidoDuplicadoTfd | null>(null);
  const [verificandoDuplicidade, setVerificandoDuplicidade] = useState(false);
  const [ignorarDuplicidade, setIgnorarDuplicidade] = useState(false);

  const [pacientesLote, setPacientesLote] = useState<ItemPacienteLote[]>([]);
  const [pacienteLoteBusca, setPacienteLoteBusca] = useState<Paciente | null>(null);
  const [agendamentoDiretoLote, setAgendamentoDiretoLote] = useState(false);
  const [dataAgendadaLote, setDataAgendadaLote] = useState("");
  const [horaAgendadaLote, setHoraAgendadaLote] = useState("08:00");
  const [justificativaLotePadrao, setJustificativaLotePadrao] = useState("");
  const [cidCodigoLotePadrao, setCidCodigoLotePadrao] = useState("");
  const [cidDescricaoLotePadrao, setCidDescricaoLotePadrao] = useState("");
  const [buscaCidLote, setBuscaCidLote] = useState("");
  const [cidsSugeridosLote, setCidsSugeridosLote] = useState<SigtapCidItem[]>([]);
  const [buscandoCidLote, setBuscandoCidLote] = useState(false);
  const [observacoesLotePadrao, setObservacoesLotePadrao] = useState("");

  const [modalConfirmacaoLote, setModalConfirmacaoLote] = useState(false);
  const [loteProcessado, setLoteProcessado] = useState<ExameLoteCriarOut | null>(null);
  const [salvandoLote, setSalvandoLote] = useState(false);
  const [comprovanteLoteModal, setComprovanteLoteModal] = useState<Exame | null>(null);

  useEffect(() => {
    if (!buscaCidLote || buscaCidLote.trim().length < 1) {
      setCidsSugeridosLote([]);
      return;
    }
    const t = setTimeout(() => {
      setBuscandoCidLote(true);
      tfdBuscarCids(buscaCidLote.trim())
        .then(setCidsSugeridosLote)
        .catch(() => setCidsSugeridosLote([]))
        .finally(() => setBuscandoCidLote(false));
    }, 250);
    return () => clearTimeout(t);
  }, [buscaCidLote]);

  // Verificação em Tempo Real de Duplicidade Ativa (Fila de Solicitações)
  useEffect(() => {
    if (!pacienteSelecionado?.id) {
      setDuplicidadeAtiva(null);
      return;
    }

    const codProc = (codigoProcedimento || procedimentoSel?.codigo_procedimento || "").trim();
    const nomeProc = (procTexto || procedimentoSel?.exame || "").trim();
    const cbo = (codigoEspecialidade || "").trim();
    const esp = (especialidade || "").trim();

    if (!codProc && !nomeProc && !cbo && !esp) {
      setDuplicidadeAtiva(null);
      return;
    }

    setIgnorarDuplicidade(false);

    const t = setTimeout(() => {
      setVerificandoDuplicidade(true);
      tfdVerificarDuplicidade({
        paciente_id: pacienteSelecionado.id,
        codigo_procedimento: codProc || undefined,
        procedimento_nome: nomeProc || undefined,
        codigo_especialidade: cbo || undefined,
        especialidade_nome: esp || undefined,
        tipo_fila: tipoServico || undefined,
      })
        .then((res) => {
          if (res.duplicado && res.pedido) {
            setDuplicidadeAtiva(res.pedido);
          } else {
            setDuplicidadeAtiva(null);
          }
        })
        .catch(() => {
          setDuplicidadeAtiva(null);
        })
        .finally(() => {
          setVerificandoDuplicidade(false);
        });
    }, 250);

    return () => clearTimeout(t);
  }, [
    pacienteSelecionado?.id,
    codigoProcedimento,
    procedimentoSel,
    procTexto,
    codigoEspecialidade,
    especialidade,
    tipoServico,
  ]);

  // Verificação em Tempo Real de CBO com as regras do Tipo de Serviço / Procedimento
  useEffect(() => {
    const codProc = (codigoProcedimento || procedimentoSel?.codigo_procedimento || "").trim();
    if (!tipoServico && !codProc) {
      setValCbo(null);
      return;
    }
    const medObj = medicos.find((m) => String(m.id) === String(medicoId));
    const t = setTimeout(() => {
      setValidandoCbo(true);
      validarCboProcedimento({
        codigo_procedimento: codProc || "",
        medico_id: medicoId ? Number(medicoId) : undefined,
        medico_nome: medObj?.nome || undefined,
        cbo: medObj?.cbo_codigo || undefined,
        tipo_fila: tipoServico || undefined,
      })
        .then((res) => setValCbo(res))
        .catch(() => setValCbo(null))
        .finally(() => setValidandoCbo(false));
    }, 250);

    return () => clearTimeout(t);
  }, [medicoId, tipoServico, codigoProcedimento, procedimentoSel, medicos]);

  function aplicarUnidadeDoPaciente(p: Paciente | null) {
    if (!p || unidades.length === 0) return;
    if (!isTfdCentral && user?.unidade_saude_id) return;
    const match = encontrarUnidadeDoPaciente(p as PacienteComUnidade, unidades);
    if (match) {
      setUnidadeId(String(match.id));
    }
  }

  function selecionarPacienteIndividual(p: Paciente | null) {
    setPacienteSelecionado(p);
    if (p) {
      aplicarUnidadeDoPaciente(p);
    }
  }

  async function adicionarPacienteAoLote(pac: Paciente | null) {
    if (!pac?.id) return;
    if (pacientesLote.some((p) => p.paciente.id === pac.id)) {
      setErro(`O paciente "${pac.nome}" já está incluído na lista deste lote.`);
      return;
    }
    setErro("");
    if (pacientesLote.length === 0) {
      aplicarUnidadeDoPaciente(pac);
    }

    const codProc = (codigoProcedimento || procedimentoSel?.codigo_procedimento || "").trim();
    const nomeProc = (procTexto || procedimentoSel?.exame || "").trim();
    const cbo = (codigoEspecialidade || "").trim();
    const esp = (especialidade || "").trim();

    let duplicadoInfo: PedidoDuplicadoTfd | undefined = undefined;
    if (codProc || nomeProc || cbo || esp) {
      try {
        const dup = await tfdVerificarDuplicidade({
          paciente_id: pac.id,
          codigo_procedimento: codProc || undefined,
          procedimento_nome: nomeProc || undefined,
          codigo_especialidade: cbo || undefined,
          especialidade_nome: esp || undefined,
          tipo_fila: tipoServico || undefined,
        });
        if (dup.duplicado && dup.pedido) {
          duplicadoInfo = dup.pedido;
        }
      } catch {
        // Ignora erro de rede na verificação
      }
    }

    setPacientesLote((prev) => [
      ...prev,
      {
        uid: Math.random().toString(36).slice(2, 9),
        paciente: pac,
        justificativa: justificativaLotePadrao || "",
        cid_codigo: cidCodigoLotePadrao || "",
        cid_descricao: cidDescricaoLotePadrao || "",
        observacoes: observacoesLotePadrao || "",
        duplicadoInfo,
      },
    ]);
    setPacienteLoteBusca(null);
  }

  function removerPacienteDoLote(uid: string) {
    setPacientesLote((prev) => prev.filter((p) => p.uid !== uid));
  }

  function atualizarItemLote(
    uid: string,
    campo: "justificativa" | "cid_codigo" | "cid_descricao" | "observacoes",
    valor: string,
  ) {
    setPacientesLote((prev) =>
      prev.map((item) => (item.uid === uid ? { ...item, [campo]: valor } : item)),
    );
  }

  function limparLote() {
    setPacientesLote([]);
    setPacienteLoteBusca(null);
    setJustificativaLotePadrao("");
    setCidCodigoLotePadrao("");
    setCidDescricaoLotePadrao("");
    setBuscaCidLote("");
    setCidsSugeridosLote([]);
    setObservacoesLotePadrao("");
    setAgendamentoDiretoLote(false);
    setDataAgendadaLote("");
    setHoraAgendadaLote("08:00");
    setLoteProcessado(null);
    setErro("");
  }

  function submeterLote(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    setLoteProcessado(null);

    if (pacientesLote.length === 0) {
      setErro("Adicione pelo menos 1 paciente à lista para realizar o lançamento em lote.");
      return;
    }
    if (!tipoServico) {
      setErro("Selecione o Tipo de Serviço a ser aplicado ao lote.");
      return;
    }
    if (isConsulta && !especialidade.trim()) {
      setErro("Para consultas especializadas em lote, selecione o CBO / Especialidade Médica correspondente.");
      return;
    }
    const nomeProcAtual = procTexto.trim() || procedimentoSel?.exame || "";
    if (nomeProcAtual.length < 2) {
      setErro("Informe o procedimento ou exame correspondente a ser aplicado ao lote.");
      return;
    }
    if (!unidadeId) {
      setErro("Selecione a Unidade Solicitante / PSF.");
      return;
    }
    if (!medicoId) {
      setErro("Selecione o(a) Médico(a) Requisitante / Profissional Responsável.");
      return;
    }
    if (tipoFilaAtivo?.exigir_cbo_estrito && cbosLiberadosServico.length > 0) {
      const medObj = medicos.find((m) => String(m.id) === String(medicoId));
      const isGenerico =
        medObj?.nome.includes("Responsável Técnico") ||
        medObj?.nome.includes("Responsavel Tecnico") ||
        medObj?.nome.includes("Médico da Unidade") ||
        medObj?.nome.includes("Medico da Unidade");
      if (!isGenerico && medObj) {
        const cboMed = (medObj.cbo_codigo || "").replace(/\D/g, "");
        const cbosSet = new Set(cbosLiberadosServico.map((c) => c.cbo.replace(/\D/g, "")));
        const cbosPrefix4 = new Set(
          cbosLiberadosServico.map((c) => c.cbo.replace(/\D/g, "").slice(0, 4)).filter((p) => p.length === 4),
        );
        if (!cbosSet.has(cboMed) && !cbosPrefix4.has(cboMed.slice(0, 4))) {
          setErro(
            `O Tipo de Serviço "${tipoServico}" possui regra de CBO estrita. O profissional selecionado (${medObj.nome}) possui CBO "${medObj.cbo_codigo || "não cadastrado"}", incompatível com as regras deste serviço.`,
          );
          return;
        }
      }
    }
    if (isTfdCentral && retroativoBloqueado && dataPedido < hojeISO()) {
      setErro("Seu perfil não possui permissão para realizar lançamentos com datas retroativas.");
      return;
    }

    // Validação da Justificativa para cada paciente
    const justPadrao = justificativaLotePadrao.trim();
    for (let i = 0; i < pacientesLote.length; i++) {
      const item = pacientesLote[i];
      const justEfetiva = (item.justificativa || "").trim() || justPadrao;
      if (justEfetiva.length < JUST_MIN) {
        setErro(
          `O paciente "${item.paciente.nome}" (linha ${i + 1}) não possui justificativa válida. ` +
            `Defina uma Justificativa Padrão para o lote (mínimo ${JUST_MIN} caracteres) ou preencha a justificativa específica do paciente.`,
        );
        return;
      }
    }

    if (agendamentoDiretoLote && podeAgendarDireto) {
      if (!dataAgendadaLote) {
        setErro("Para agendamento direto em lote, informe a Data do Agendamento.");
        return;
      }
    }

    setModalConfirmacaoLote(true);
  }

  async function confirmarGravacaoLote() {
    setSalvandoLote(true);
    setErro("");
    try {
      const nomeProcAtual = procTexto.trim() || procedimentoSel?.exame || "";
      const podeAgendarEfetivo = agendamentoDiretoLote && podeAgendarDireto;
      const res = await tfdCriarExamesLote({
        tipo_fila: tipoServico,
        exame: codigoProcedimento ? `${codigoProcedimento} · ${nomeProcAtual}` : nomeProcAtual,
        codigo_procedimento: codigoProcedimento || undefined,
        especialidade: especialidade.trim() || undefined,
        codigo_especialidade: codigoEspecialidade.trim() || undefined,
        unidade_saude_id: unidadeId ? Number(unidadeId) : undefined,
        medico_id: medicoId ? Number(medicoId) : undefined,
        prioridade: podeDefinirPrioridade ? prioridade : "rotina",
        data_pedido: isTfdCentral ? dataPedido : hojeISO(),
        justificativa_padrao: justificativaLotePadrao.trim(),
        cid_codigo_padrao: cidCodigoLotePadrao.trim() || undefined,
        cid_descricao_padrao: cidDescricaoLotePadrao.trim() || undefined,
        observacoes_padrao: observacoesLotePadrao.trim() || undefined,
        agendamento_direto: podeAgendarEfetivo,
        data_agendada: podeAgendarEfetivo ? dataAgendadaLote : undefined,
        hora_agendada: podeAgendarEfetivo ? horaAgendadaLote : undefined,
        itens: pacientesLote.map((item) => ({
          paciente_id: item.paciente.id,
          paciente_nome: item.paciente.nome,
          justificativa: item.justificativa?.trim() || undefined,
          cid_codigo: item.cid_codigo?.trim() || undefined,
          cid_descricao: item.cid_descricao?.trim() || undefined,
          observacoes: item.observacoes?.trim() || undefined,
        })),
      });

      setModalConfirmacaoLote(false);
      setLoteProcessado(res);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : null;
      setErro(msg || "Falha ao gravar lote de solicitações. Verifique os dados informados.");
      setModalConfirmacaoLote(false);
    } finally {
      setSalvandoLote(false);
    }
  }

  // Inicializa dados e permissões padrão
  useEffect(() => {
    let cancelado = false;
    Promise.all([
      tfdTipos({ ativos: true, limit: 500 }).catch(() => []),
      tfdCatalogoExames()
        .then((res) => {
          if (!cancelado) setErroCatalogo("");
          return res;
        })
        .catch((err) => {
          if (!cancelado) {
            setErroCatalogo(msgErro(err, "Erro ao carregar catálogo de procedimentos."));
          }
          return [];
        }),
      tfdEspecialidades({ limit: 500, ativos: true }).catch(() => ({ data: [] })),
      fetchMedicos().catch(() => []),
      fetchUnidadesSaude().catch(() => []),
    ]).then(([resTipos, resProcs, resEsps, resMeds, resUnis]) => {
      if (cancelado) return;
      const tipos = pagData<TipoFila>(resTipos).filter((t) => t.ativo);
      setTiposFila(tipos);
      const procs = (resProcs as CatalogoProc[]) || [];
      setProcedimentosTodos(procs);
      const esps = pagData<EspecialidadeCat>(resEsps).filter((e) => e.ativo);
      setEspecialidadesCadastradas(esps);
      setMedicos(resMeds.filter((m) => m.ativo));
      setUnidades(resUnis.filter((u) => u.ativo));

      // Unidade padrão: se usuário PSF tem unidade vinculada
      if (user?.unidade_saude_id) {
        setUnidadeId(String(user.unidade_saude_id));
      } else if (resUnis.length > 0) {
        setUnidadeId(String(resUnis[0].id));
      }

      // Médico padrão: Médico da Unidade
      const medGen = resMeds.find(
        (m) => m.nome.includes("Responsável Técnico") || m.nome.includes("Médico da Unidade"),
      );
      if (medGen) {
        setMedicoId(String(medGen.id));
      }

      setCarregandoCatalogos(false);
    });

    return () => {
      cancelado = true;
    };
  }, [user]);

  // Se o usuário não for TFD Central, força data no dia atual e unidade no seu PSF
  useEffect(() => {
    if (!isTfdCentral) {
      setDataPedido(hojeISO());
      if (user?.unidade_saude_id) {
        setUnidadeId(String(user.unidade_saude_id));
      }
      setAgendamentoDireto(false);
      setAgendamentoDiretoLote(false);
    }
  }, [isTfdCentral, user]);

  // Travas RBAC: garante rotina para não-médicos e desativa agendamento direto sem permissão
  useEffect(() => {
    if (!podeDefinirPrioridade && prioridade !== "rotina") {
      setPrioridade("rotina");
    }
  }, [podeDefinirPrioridade, prioridade]);

  useEffect(() => {
    if (!podeAgendarDireto) {
      if (agendamentoDireto) setAgendamentoDireto(false);
      if (agendamentoDiretoLote) setAgendamentoDiretoLote(false);
    }
  }, [podeAgendarDireto, agendamentoDireto, agendamentoDiretoLote]);

  const tiposServicoDisponiveis = useMemo(
    () => tiposFila.filter((tf) => tf.ativo && !ehFilaLaboratorio(tf)),
    [tiposFila],
  );

  // Carrega Árvore SIGTAP completa em cascata: Área (Grupo) -> Subgrupo -> CBO
  useEffect(() => {
    let cancel = false;
    sigtapArvore({
      grupo_codigo: grupoSig || undefined,
      subgrupo_codigo: subgrupoSig || undefined,
      cbo: cboFiltroSig || undefined,
    })
      .then((res) => {
        if (!cancel) setArvoreSigtap(res);
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, [grupoSig, subgrupoSig, cboFiltroSig]);

  // Filtro hierárquico: quando um CBO é selecionado, carrega apenas especialidades correspondentes/autorizadas
  useEffect(() => {
    if (!cboFiltroSig) {
      setEspsCboSel([]);
      return;
    }
    let cancel = false;
    tfdCboEspecialidades(cboFiltroSig)
      .then((res) => {
        if (cancel) return;
        const lista = res?.especialidades ?? [];
        setEspsCboSel(lista);
        setEspecialidade((atual) => {
          const atualNorm = normalizarTexto(atual);
          const aindaValida = atual && lista.some((x) => normalizarTexto(x.nome) === atualNorm);
          if (aindaValida) return atual;
          if (lista.length === 1) return lista[0].nome;
          return "";
        });
        setEspManual(false);
      })
      .catch(() => {
        if (!cancel) setEspsCboSel([]);
      });
    return () => {
      cancel = true;
    };
  }, [cboFiltroSig]);

  // Regra 3: Hierarquia de Seleção (Serviço -> Área/Subgrupo/CBO -> Procedimento)
  const espFiltroCatalogo = espManual ? especialidade : "";

  useEffect(() => {
    if (isConsulta) {
      return;
    }

    let cancel = false;
    setBuscandoProc(true);

    const temFiltroHierarquia = Boolean(grupoSig || subgrupoSig || cboFiltroSig);
    tfdCatalogoExames(
      "",
      tipoServico || undefined,
      undefined,
      espFiltroCatalogo || undefined,
      grupoSig || undefined,
      subgrupoSig || undefined,
      cboFiltroSig || undefined,
    )
      .then(async (res) => {
        if (cancel) return;
        setErroCatalogo("");
        let lista = res || [];
        if (lista.length === 0 && espFiltroCatalogo && tipoServico && !temFiltroHierarquia) {
          lista = (await tfdCatalogoExames("", tipoServico)) || [];
        }
        if (cancel) return;
        if (lista.length > 0 || temFiltroHierarquia) {
          setProcedimentosFiltrados(lista);
        } else if (!tipoServico && !espFiltroCatalogo) {
          setProcedimentosFiltrados(procedimentosTodos);
        } else {
          const tNorm = normalizarTexto(tipoServico.trim());
          const espNorm = normalizarTexto(espFiltroCatalogo.trim());
          const locais = procedimentosTodos.filter((p) => {
            const pTf = normalizarTexto(p.tipo_fila || "");
            const pEsp = normalizarTexto(p.especialidade || p.nome_especialidade || "");
            const pCbo = normalizarTexto(p.codigo_especialidade || "");
            const bateTipo =
              !tNorm ||
              pTf.includes(tNorm) ||
              tNorm.includes(pTf) ||
              (tNorm.includes("exame") &&
                !pTf.includes("lab") &&
                !pTf.includes("sangue") &&
                !pTf.includes("cirurg") &&
                !pTf.includes("consulta")) ||
              (tNorm.includes("cirurg") && pTf.includes("cirurg"));
            const bateEsp =
              !espNorm ||
              pEsp.includes(espNorm) ||
              espNorm.includes(pEsp) ||
              pCbo.includes(espNorm);
            return bateTipo && (bateEsp || !espFiltroCatalogo);
          });
          setProcedimentosFiltrados(locais.length > 0 ? locais : procedimentosTodos);
        }
      })
      .catch((err) => {
        if (!cancel) {
          setErroCatalogo(msgErro(err, "Erro ao consultar catálogo de procedimentos."));
          setProcedimentosFiltrados(procedimentosTodos);
        }
      })
      .finally(() => {
        if (!cancel) setBuscandoProc(false);
      });

    return () => {
      cancel = true;
    };
  }, [tipoServico, espFiltroCatalogo, grupoSig, subgrupoSig, cboFiltroSig, isConsulta, procedimentosTodos]);

  // Regra Dinâmica: Consultas vs Exames e Cirurgias
  // 1. Consultas Médicas Especializadas: define automaticamente o procedimento padrão 0301010072
  useEffect(() => {
    if (isConsulta) {
      setCodigoProcedimento("0301010072");
      setProcTexto("CONSULTA MEDICA EM ATENCAO ESPECIALIZADA");
      setProcedimentoSel({
        codigo_procedimento: "0301010072",
        exame: "CONSULTA MEDICA EM ATENCAO ESPECIALIZADA",
        especialidade: especialidade || "CONSULTAS ESPECIALIZADAS",
        tipo_fila: tipoServico || "CONSULTAS ESPECIALIZADAS",
        codigo_curto: "0301010072",
        rotulo: "CONSULTA MEDICA EM ATENCAO ESPECIALIZADA",
        usos: 0,
      });
      setCbosAutorizados([]);
    } else if (codigoProcedimento === "0301010072") {
      setCodigoProcedimento("");
      setProcTexto("");
      setProcedimentoSel(null);
      setCbosAutorizados([]);
    }
  }, [isConsulta, tipoServico, especialidade]);

  // 2. Exames e Cirurgias: busca estrita de CBOs autorizados no SIGTAP para o procedimento selecionado
  useEffect(() => {
    if (isConsulta || !codigoProcedimento) {
      setCbosAutorizados([]);
      return;
    }
    const codLimpo = codigoProcedimento.replace(/\D/g, "");
    if (codLimpo.length < 8) {
      setCbosAutorizados([]);
      return;
    }
    let cancel = false;
    setCarregandoCbos(true);
    sigtapCbos(codLimpo)
      .then((cbos) => {
        if (!cancel) {
          const lista = cbos || [];
          setCbosAutorizados(lista);
          // Se houver apenas 1 CBO autorizado no SIGTAP para este procedimento, seleciona-o
          if (lista.length === 1) {
            setEspecialidade(lista[0].descricao || `CBO ${lista[0].cbo}`);
            setCodigoEspecialidade(lista[0].cbo);
            setEspManual(false);
          } else if (lista.length > 1) {
            const jaAutorizado = lista.some(
              (c) =>
                c.cbo === codigoEspecialidade ||
                (c.descricao && c.descricao.toLowerCase() === especialidade.toLowerCase()),
            );
            if (!jaAutorizado) {
              const match = lista.find((c) =>
                especialidade ? c.descricao?.toLowerCase().includes(especialidade.toLowerCase()) : false,
              );
              if (match) {
                setEspecialidade(match.descricao || `CBO ${match.cbo}`);
                setCodigoEspecialidade(match.cbo);
                setEspManual(false);
              }
            }
          }
        }
      })
      .catch(() => {
        if (!cancel) setCbosAutorizados([]);
      })
      .finally(() => {
        if (!cancel) setCarregandoCbos(false);
      });
    return () => {
      cancel = true;
    };
  }, [codigoProcedimento, isConsulta]);

  // Busca inteligente via API quando o operador digita no campo de procedimento
  useEffect(() => {
    const termo = buscaProc.trim();
    setProcedimentosDinamicos([]);
    setTermoDinamico("");
    if (!termo) {
      setBuscandoProc(false);
      return;
    }
    let ativo = true;
    setBuscandoProc(true);
    const temHierarquia = Boolean(grupoSig || subgrupoSig || cboFiltroSig);
    const t = setTimeout(() => {
      tfdCatalogoExames(
        termo,
        tipoServico || undefined,
        undefined,
        espFiltroCatalogo || undefined,
        grupoSig || undefined,
        subgrupoSig || undefined,
        cboFiltroSig || undefined,
      )
        .then(async (res) => {
          if (!ativo) return;
          setErroCatalogo("");
          let lista = res || [];
          if (lista.length === 0 && espFiltroCatalogo && tipoServico && !temHierarquia) {
            lista = (await tfdCatalogoExames(termo, tipoServico)) || [];
          }
          if (ativo) {
            setProcedimentosDinamicos(lista);
            setTermoDinamico(normalizarTexto(termo));
          }
        })
        .catch((err) => {
          if (ativo) {
            setErroCatalogo(msgErro(err, "Erro ao pesquisar procedimentos no servidor."));
            setProcedimentosDinamicos([]);
            setTermoDinamico("");
          }
        })
        .finally(() => {
          if (ativo) setBuscandoProc(false);
        });
    }, 150);
    return () => {
      ativo = false;
      clearTimeout(t);
    };
  }, [buscaProc, tipoServico, espFiltroCatalogo, grupoSig, subgrupoSig, cboFiltroSig]);

  // Filtro inteligente de procedimentos: busca por nome, código SIGTAP, código curto, especialidade e aliases comuns
  const opcoesProcFiltradas = useMemo(() => {
    let base: CatalogoProc[] = [];

    if (procedimentosFiltrados.length > 0 || grupoSig || subgrupoSig || cboFiltroSig) {
      base = procedimentosFiltrados;
    } else {
      const tNorm = normalizarTexto(tipoServico.trim());
      const espNorm = normalizarTexto(espFiltroCatalogo.trim());
      const filtradosLocais = procedimentosTodos.filter((p) => {
        const pTf = normalizarTexto(p.tipo_fila || "");
        const pEsp = normalizarTexto(p.especialidade || p.nome_especialidade || "");
        const pCbo = normalizarTexto(p.codigo_especialidade || "");
        const bateTipo =
          !tNorm ||
          pTf.includes(tNorm) ||
          tNorm.includes(pTf) ||
          (tNorm.includes("exame") &&
            !pTf.includes("lab") &&
            !pTf.includes("sangue") &&
            !pTf.includes("cirurg") &&
            !pTf.includes("consulta")) ||
          (tNorm.includes("cirurg") && pTf.includes("cirurg")) ||
          (tNorm.includes("consulta") && pTf.includes("consulta"));
        const bateEsp =
          !espNorm ||
          pEsp.includes(espNorm) ||
          espNorm.includes(pEsp) ||
          pCbo.includes(espNorm);
        return bateTipo && (bateEsp || !espFiltroCatalogo);
      });
      base = filtradosLocais.length > 0 ? filtradosLocais : procedimentosTodos;
    }

    const t = normalizarTexto(buscaProc.trim());
    if (!t) return base.slice(0, 150);

    const aliasesLocais: Record<string, string[]> = {
      ecg: ["eletrocardiograma", "eletrocardio"],
      holter: ["holter", "24 hs"],
      mapa: ["mapa", "monitorizacao ambulatorial", "pressao arterial"],
      eco: ["ecocardiograma", "ecocardiografia", "doppler"],
      usg: ["ultrassonografia", "ecografia"],
      ultrassom: ["ultrassonografia", "ecografia"],
      tc: ["tomografia"],
      rm: ["ressonancia"],
      rnm: ["ressonancia"],
      rx: ["raio", "radiografia"],
      eda: ["endoscopia"],
      eeg: ["eletroencefalograma"],
    };
    const palavras = t.split(/\s+/).filter(Boolean);
    const aliasesExact = aliasesLocais[t] || [];

    const locais = base.filter((p) => {
      const codCurto = normalizarTexto(p.codigo_curto || "");
      // Evita que digitar letras do próprio tipo de serviço (ex: "ci", "ra", "ex") case todos os itens da fila
      const txt = normalizarTexto(
        tipoServico
          ? `${p.codigo_procedimento || ""} ${p.exame || p.nome_procedimento || ""} ${p.especialidade || p.nome_especialidade || ""}`
          : `${p.codigo_curto || ""} ${p.codigo_procedimento || ""} ${p.exame || p.nome_procedimento || ""} ${p.especialidade || p.nome_especialidade || ""} ${p.tipo_fila || ""}`,
      );
      if (palavras.length > 0 && palavras.every((w) => txt.includes(w))) return true;
      if (codCurto && t === codCurto) return true;
      return aliasesExact.some((al) => txt.includes(al));
    });

    const mapaProcs = new Map<string, CatalogoProc>();
    // Dinâmicos vindos da API só são mesclados se corresponderem exatamente ao termo atual digitado
    if (termoDinamico === t) {
      for (const p of procedimentosDinamicos) {
        const k = p.codigo_procedimento || p.exame || p.nome_procedimento;
        if (k) mapaProcs.set(k, p);
      }
    }
    // Adiciona os locais
    for (const p of locais) {
      const k = p.codigo_procedimento || p.exame || p.nome_procedimento;
      if (k && !mapaProcs.has(k)) mapaProcs.set(k, p);
    }

    const listaFinal = Array.from(mapaProcs.values());
    listaFinal.sort((a, b) => {
      const nomeA = normalizarTexto(a.nome_procedimento || a.exame || "");
      const nomeB = normalizarTexto(b.nome_procedimento || b.exame || "");
      const codA = (a.codigo_procedimento || a.codigo_curto || "").toLowerCase();
      const codB = (b.codigo_procedimento || b.codigo_curto || "").toLowerCase();
      const comecaA = nomeA.startsWith(t) || codA.startsWith(t) ? 0 : 1;
      const comecaB = nomeB.startsWith(t) || codB.startsWith(t) ? 0 : 1;
      if (comecaA !== comecaB) return comecaA - comecaB;
      return nomeA.localeCompare(nomeB);
    });

    return listaFinal.slice(0, 100);
  }, [buscaProc, procedimentosFiltrados, procedimentosTodos, espFiltroCatalogo, tipoServico, procedimentosDinamicos, termoDinamico, grupoSig, subgrupoSig, cboFiltroSig]);

  function aoMudarTipoServico(novo: string) {
    setTipoServico(novo);
    setProcedimentoSel(null);
    setProcTexto("");
    setCodigoProcedimento("");
    setBuscaProc("");
    setCboFiltroSig("");
    setEspsCboSel([]);
    setEspManual(false);
    setCbosAutorizados([]);
    setProcedimentosDinamicos([]);
    setTermoDinamico("");
    setErroCatalogo("");

    // Sugestão automática de Especialidade e CBO padrão configurados para o Tipo de Serviço
    const tfObj = tiposFila.find((tf) => tf.nome.trim().toUpperCase() === novo.trim().toUpperCase());
    if (tfObj && tfObj.especialidade_padrao) {
      setEspecialidade(tfObj.especialidade_padrao);
      if (tfObj.cbo_padrao) {
        setCodigoEspecialidade(tfObj.cbo_padrao);
      } else {
        setCodigoEspecialidade("");
      }
    } else {
      setEspecialidade("");
      setCodigoEspecialidade("");
    }
  }

  function aoSelecionarGrupoSig(novoGrupo: string) {
    setGrupoSig(novoGrupo);
    if (subgrupoSig && (!novoGrupo || !subgrupoSig.startsWith(novoGrupo))) {
      setSubgrupoSig("");
    }
    if (!isConsulta) {
      setProcedimentoSel(null);
      setProcTexto("");
      setCodigoProcedimento("");
    }
  }

  function aoSelecionarSubgrupoSig(novoSubgrupo: string) {
    setSubgrupoSig(novoSubgrupo);
    if (novoSubgrupo.length >= 2 && !grupoSig) {
      setGrupoSig(novoSubgrupo.slice(0, 2));
    }
    if (!isConsulta) {
      setProcedimentoSel(null);
      setProcTexto("");
      setCodigoProcedimento("");
    }
  }

  function aoSelecionarCboFiltro(novoCbo: string) {
    const cboLimpo = (novoCbo || "").replace(/\D/g, "").slice(0, 6);
    setCboFiltroSig(cboLimpo);
    if (cboLimpo) {
      setCodigoEspecialidade(cboLimpo);
    } else {
      setCodigoEspecialidade("");
      setEspsCboSel([]);
    }
  }

  function escolherProcedimento(p: CatalogoProc) {
    handleSelecionarProcedimento(p);
    if (p.tipo_fila && !tipoServico) {
      setTipoServico(p.tipo_fila);
    }
    setBuscaProc("");
    setProcFoco(false);
  }

  function handleSelecionarProcedimento(p: CatalogoProc | null) {
    setProcedimentoSel(p);
    if (p) {
      setProcTexto(p.exame || p.nome_procedimento || "");
      setCodigoProcedimento(p.codigo_procedimento || "");
      if (p.especialidade || p.nome_especialidade) {
        setEspecialidade(p.especialidade || p.nome_especialidade || "");
        setEspManual(false);
      }
      if (p.codigo_especialidade) {
        setCodigoEspecialidade(p.codigo_especialidade);
      }
      if (p.tipo_fila && !tipoServico) {
        setTipoServico(p.tipo_fila);
      }
    } else {
      setProcTexto("");
      setCodigoProcedimento("");
      setCbosAutorizados([]);
      if (!espManual) {
        setEspecialidade("");
        setCodigoEspecialidade("");
      }
    }
  }

  function adicionarProcedimentoLista() {
    const nome = procTexto.trim() || procedimentoSel?.exame || "";
    if (nome.length < 2) return;
    if (procedimentosAdicionados.some((p) => p.nome === nome || (p.codigo && p.codigo === codigoProcedimento))) {
      return;
    }
    setProcedimentosAdicionados([
      ...procedimentosAdicionados,
      {
        codigo: codigoProcedimento,
        nome,
        especialidade,
        codigo_especialidade: codigoEspecialidade,
        tipo_fila: tipoServico,
      },
    ]);
    setProcedimentoSel(null);
    setProcTexto("");
    setCodigoProcedimento("");
  }

  // SIGTAP para Exames Laboratoriais
  const isLaboratorial = useMemo(() => {
    const t = (tipoServico || "").toUpperCase();
    return t.includes("LABORAT") || t.includes("SANGUE");
  }, [tipoServico]);
  const [buscaSig, setBuscaSig] = useState("");
  const [sigtapResultados, setSigtapResultados] = useState<SigtapProc[]>([]);
  const [buscandoSig, setBuscandoSig] = useState(false);

  useEffect(() => {
    if (!isLaboratorial) {
      setSigtapResultados([]);
      return;
    }
    setBuscandoSig(true);
    const t = setTimeout(() => {
      labSigtap(buscaSig.trim() || undefined)
        .then((r) => setSigtapResultados(pagData<SigtapProc>(r)))
        .catch(() => setSigtapResultados([]))
        .finally(() => setBuscandoSig(false));
    }, 250);
    return () => clearTimeout(t);
  }, [buscaSig, isLaboratorial]);

  function adicionarSigtapItem(s: SigtapProc) {
    if (procedimentosAdicionados.some((p) => p.codigo === s.codigo || p.nome === s.descricao)) {
      return;
    }
    setProcedimentosAdicionados([
      ...procedimentosAdicionados,
      {
        codigo: s.codigo,
        nome: s.descricao,
        especialidade: "PATOLOGIA CLINICA",
        codigo_especialidade: "0202",
        tipo_fila: "EXAMES LABORATORIAIS",
      },
    ]);
    setCodigoProcedimento(s.codigo);
    setProcTexto(s.descricao);
    setEspecialidade("PATOLOGIA CLINICA");
  }

  function removerProcedimentoLista(index: number) {
    setProcedimentosAdicionados(procedimentosAdicionados.filter((_, idx) => idx !== index));
  }

  function limparFormulario() {
    setPacienteSelecionado(null);
    setTipoServico("");
    setProcedimentoSel(null);
    setProcTexto("");
    setCodigoProcedimento("");
    setEspecialidade("");
    setCodigoEspecialidade("");
    setEspManual(false);
    setJustificativa("");
    setObservacoes("");
    setNumeroPedido("");
    setCidCodigo("");
    setCidDescricao("");
    setBuscaCid("");
    setCidsSugeridos([]);
    setPrioridade("rotina");
    setProcedimentosAdicionados([]);
    setCriado(null);
    setErro("");
    setAbrirComprovante(false);
    if (!isTfdCentral) {
      setDataPedido(hojeISO());
      if (user?.unidade_saude_id) setUnidadeId(String(user.unidade_saude_id));
    }
  }

  function obterListaFinalProcs() {
    const listaFinalProcs = [...procedimentosAdicionados];
    const nomeProcAtual = procTexto.trim() || procedimentoSel?.exame || "";
    if (nomeProcAtual.length >= 2) {
      if (!listaFinalProcs.some((p) => p.nome === nomeProcAtual || (p.codigo && p.codigo === codigoProcedimento))) {
        listaFinalProcs.push({
          codigo: codigoProcedimento,
          nome: nomeProcAtual,
          especialidade: especialidade.trim(),
          codigo_especialidade: codigoEspecialidade.trim(),
          tipo_fila: tipoServico,
        });
      }
    }
    return listaFinalProcs;
  }

  function submeter(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    setCriado(null);

    if (!pacienteSelecionado?.id) {
      setErro("Selecione um paciente para a solicitação.");
      return;
    }
    if (duplicidadeAtiva && !ignorarDuplicidade) {
      setErro(
        "Atenção: Já existe um pedido idêntico ativo para este paciente. Avalie a situação no alerta em destaque ou clique em 'Prosseguir Mesmo com Duplicidade' para continuar."
      );
      return;
    }
    if (!tipoServico) {
      setErro("Selecione o Tipo de Serviço da solicitação.");
      return;
    }
    if (isConsulta && !especialidade.trim()) {
      setErro("Para consultas especializadas, selecione o CBO / Especialidade Médica desejada.");
      return;
    }

    const listaFinalProcs = obterListaFinalProcs();
    if (listaFinalProcs.length === 0) {
      setErro("Informe pelo menos um procedimento ou exame a ser realizado.");
      return;
    }

    if (!unidadeId) {
      setErro("Selecione a Unidade Solicitante / PSF.");
      return;
    }

    if (!medicoId) {
      setErro("Selecione o(a) Médico(a) Requisitante.");
      return;
    }

    if (tipoFilaAtivo?.exigir_cbo_estrito && cbosLiberadosServico.length > 0) {
      const medObj = medicos.find((m) => String(m.id) === String(medicoId));
      const isGenerico =
        medObj?.nome.includes("Responsável Técnico") ||
        medObj?.nome.includes("Responsavel Tecnico") ||
        medObj?.nome.includes("Médico da Unidade") ||
        medObj?.nome.includes("Medico da Unidade");
      if (!isGenerico && medObj) {
        const cboMed = (medObj.cbo_codigo || "").replace(/\D/g, "");
        const cbosSet = new Set(cbosLiberadosServico.map((c) => c.cbo.replace(/\D/g, "")));
        const cbosPrefix4 = new Set(
          cbosLiberadosServico.map((c) => c.cbo.replace(/\D/g, "").slice(0, 4)).filter((p) => p.length === 4),
        );
        if (!cbosSet.has(cboMed) && !cbosPrefix4.has(cboMed.slice(0, 4))) {
          setErro(
            `O Tipo de Serviço "${tipoServico}" possui regra de CBO estrita. O profissional selecionado (${medObj.nome}) possui CBO "${medObj.cbo_codigo || "não cadastrado"}", que não está entre os CBOs liberados para este serviço (${cbosLiberadosServico.map((c) => c.cbo + (c.nome ? ` - ${c.nome}` : "")).join(", ")}).`,
          );
          return;
        }
      }
    }

    if (!justificativa.trim() || justificativa.trim().length < JUST_MIN) {
      setErro(`A Justificativa Clínica é obrigatória e deve conter no mínimo ${JUST_MIN} caracteres.`);
      return;
    }

    if (isTfdCentral && retroativoBloqueado && dataPedido < hojeISO()) {
      setErro("Seu perfil não possui permissão para realizar lançamentos com datas retroativas.");
      return;
    }

    if (agendamentoDireto && podeAgendarDireto && (!dataAgendada || !unidadeId || !medicoId)) {
      setErro("Para agendamento direto, informe a data agendada, unidade e médico.");
      return;
    }

    // Abre a tela de confirmação antes de gravar no banco de dados
    setModalConfirmacao(true);
  }

  async function confirmarGravacaoDefinitiva() {
    setSalvando(true);
    setErro("");
    try {
      const listaFinalProcs = obterListaFinalProcs();
      const numPedidoEfetivo =
        numeroPedido.trim() ||
        `PED-${hojeISO().replace(/-/g, "")}-${Math.floor(100000 + Math.random() * 900000)}`;

      let primeiroCriado: Exame | null = null;

      for (const proc of listaFinalProcs) {
        const payload: Record<string, unknown> = {
          paciente_id: pacienteSelecionado!.id,
          paciente_nome: pacienteSelecionado!.nome,
          tipo_fila: proc.tipo_fila || tipoServico,
          exame: proc.codigo ? `${proc.codigo} · ${proc.nome}` : proc.nome,
          codigo_procedimento: proc.codigo || undefined,
          especialidade: proc.especialidade || especialidade.trim() || undefined,
          codigo_especialidade: proc.codigo_especialidade || codigoEspecialidade.trim() || undefined,
          unidade_saude_id: unidadeId ? Number(unidadeId) : undefined,
          medico_id: medicoId ? Number(medicoId) : undefined,
          data_pedido: isTfdCentral ? dataPedido : hojeISO(),
          prioridade: podeDefinirPrioridade ? prioridade : "rotina",
          justificativa: justificativa.trim(),
          cid_codigo: cidCodigo || undefined,
          cid_descricao: cidDescricao || undefined,
          observacoes: observacoes.trim() || undefined,
          numero_pedido: numPedidoEfetivo,
        };

        if (agendamentoDireto && podeAgendarDireto) {
          payload.data_agendada = dataAgendada;
          payload.hora_agendada = horaAgendada;
          payload.status = "agendado";
        } else {
          payload.status = "aguardando";
        }

        const res = await tfdCriarExame(payload);
        if (!primeiroCriado) primeiroCriado = res;
      }

      setModalConfirmacao(false);
      setCriado(primeiroCriado);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : null;
      setErro(msg || "Falha ao cadastrar solicitação. Verifique os dados informados.");
      setModalConfirmacao(false);
    } finally {
      setSalvando(false);
    }
  }

  const opcoesUnidades = useMemo(
    () =>
      unidades.map((u) => ({
        value: String(u.id),
        label: u.nome,
        sub: u.cnes ? `CNES ${u.cnes}` : undefined,
        keywords: `${u.nome} ${u.cnes || ""}`,
      })),
    [unidades],
  );

  const tipoFilaAtivo = useMemo(() => {
    if (!tipoServico) return null;
    const tNorm = tipoServico.trim().toUpperCase();
    return tiposFila.find((tf) => tf.nome.trim().toUpperCase() === tNorm) || null;
  }, [tipoServico, tiposFila]);

  const cbosLiberadosServico = useMemo(() => {
    if (!tipoFilaAtivo) return [];
    if (tipoFilaAtivo.cbos_detalhes && tipoFilaAtivo.cbos_detalhes.length > 0) {
      return tipoFilaAtivo.cbos_detalhes.map((c) => ({
        cbo: c.cbo,
        nome: c.descricao || `CBO ${c.cbo}`,
        descricao: c.descricao || `CBO ${c.cbo}`,
      }));
    }
    const raw = tipoFilaAtivo.cbos_permitidos;
    if (!raw) return [];
    try {
      if (raw.startsWith("[")) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          return arr.map((c: string) => {
            const cod = String(c).trim();
            return { cbo: cod, nome: `CBO ${cod}`, descricao: `CBO ${cod}` };
          });
        }
      }
    } catch {}
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((c) => ({ cbo: c, nome: `CBO ${c}`, descricao: `CBO ${c}` }));
  }, [tipoFilaAtivo]);

  const opcoesMedicos = useMemo(() => {
    const cbosSet = new Set(cbosLiberadosServico.map((c) => c.cbo.replace(/\D/g, "")));
    const cbosPrefix4 = new Set(
      cbosLiberadosServico.map((c) => c.cbo.replace(/\D/g, "").slice(0, 4)).filter((p) => p.length === 4),
    );
    const temRegra = cbosSet.size > 0;

    return medicos
      .map((m) => {
        const cboMed = (m.cbo_codigo || "").replace(/\D/g, "");
        const isGenerico =
          m.nome.includes("Responsável Técnico") ||
          m.nome.includes("Responsavel Tecnico") ||
          m.nome.includes("Médico da Unidade") ||
          m.nome.includes("Medico da Unidade");
        const cboMatch =
          temRegra &&
          !isGenerico &&
          (cbosSet.has(cboMed) || cbosPrefix4.has(cboMed.slice(0, 4)));

        let subTexto = m.crm ? `CRM ${m.crm}` : "";
        if (m.cbo_codigo) {
          subTexto += (subTexto ? " · " : "") + `CBO ${m.cbo_codigo}`;
        }
        if (cboMatch) {
          subTexto += ` · ⭐ CBO Liberado p/ ${tipoServico}`;
        } else if (temRegra && tipoFilaAtivo?.exigir_cbo_estrito && !isGenerico) {
          subTexto += " · ⚠️ Não autorizado neste serviço";
        }

        return {
          value: String(m.id),
          label: cboMatch ? `⭐ ${m.nome} [CBO Liberado]` : m.nome,
          sub: subTexto || undefined,
          keywords: `${m.nome} ${m.crm || ""} ${m.cbo_codigo || ""} ${m.especialidade || ""} ${
            cboMatch ? "liberado autorizado cardiologista especialista" : ""
          }`,
          cboMatch,
          isGenerico,
        };
      })
      .sort((a, b) => {
        // 1. Médicos com CBO liberado no topo
        if (a.cboMatch && !b.cboMatch) return -1;
        if (!a.cboMatch && b.cboMatch) return 1;
        // 2. Médico genérico da unidade
        if (a.isGenerico && !b.isGenerico) return -1;
        if (!a.isGenerico && b.isGenerico) return 1;
        return a.label.localeCompare(b.label, "pt-BR");
      });
  }, [medicos, cbosLiberadosServico, tipoServico, tipoFilaAtivo]);

  const opcoesCboArvore = useMemo(() => {
    const base = arvoreSigtap?.cbos ?? [];
    return base.map((c) => ({
      value: c.cbo,
      label: c.descricao ? `${c.cbo} · ${c.descricao}` : `CBO ${c.cbo}`,
      sub: c.cbo ? `CBO ${c.cbo}` : undefined,
      keywords: `${c.cbo} ${c.descricao}`,
    }));
  }, [arvoreSigtap]);

  const opcoesEspecialidades = useMemo(() => {
    // 1. Se há um CBO explicitamente selecionado na árvore/filtro, exibe APENAS as especialidades correspondentes/autorizadas para aquele CBO
    if (cboFiltroSig) {
      const cboPrefix = cboFiltroSig.slice(0, 4);
      const mapaCbo = new Map<string, { nome: string; cbo?: string; autorizadoSigtap?: boolean }>();

      for (const e of espsCboSel) {
        const nome = (e.nome || "").trim();
        if (nome && !mapaCbo.has(nome)) {
          mapaCbo.set(nome, { nome, cbo: e.codigo_cbo || cboFiltroSig });
        }
      }
      for (const e of especialidadesCadastradas) {
        const ec = (e.codigo_cbo || "").replace(/\D/g, "");
        if (ec && (ec === cboFiltroSig || (cboPrefix.length >= 4 && ec.startsWith(cboPrefix)))) {
          const nome = (e.nome || "").trim();
          if (nome && !mapaCbo.has(nome)) {
            mapaCbo.set(nome, { nome, cbo: ec });
          }
        }
      }
      if (!isConsulta && cbosAutorizados.length > 0) {
        const autorizadosSet = new Set(cbosAutorizados.map((c) => c.cbo));
        for (const c of cbosAutorizados) {
          if (c.cbo === cboFiltroSig || (cboPrefix.length >= 4 && c.cbo.startsWith(cboPrefix))) {
            const nome = (c.descricao || `CBO ${c.cbo}`).trim();
            if (!mapaCbo.has(nome)) {
              mapaCbo.set(nome, { nome, cbo: c.cbo, autorizadoSigtap: true });
            }
          }
        }
        const filtradosSigtap = Array.from(mapaCbo.values()).filter(
          (item) => !item.cbo || autorizadosSet.has(item.cbo) || item.cbo === cboFiltroSig,
        );
        if (filtradosSigtap.length > 0) {
          return filtradosSigtap
            .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
            .map((e) => ({
              value: e.nome,
              label: e.nome,
              sub: `CBO ${e.cbo || cboFiltroSig} · Correspondente ao CBO`,
              keywords: `${e.nome} ${e.cbo || cboFiltroSig}`,
            }));
        }
      }
      return Array.from(mapaCbo.values())
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
        .map((e) => ({
          value: e.nome,
          label: e.nome,
          sub: `CBO ${e.cbo || cboFiltroSig} · Autorizada p/ CBO`,
          keywords: `${e.nome} ${e.cbo || cboFiltroSig}`,
        }));
    }

    // 2. Se não é consulta e há CBOs autorizados pelo SIGTAP para o procedimento selecionado:
    if (!isConsulta && cbosAutorizados.length > 0) {
      return cbosAutorizados.map((c) => ({
        value: c.descricao || `CBO ${c.cbo}`,
        label: c.descricao || `CBO ${c.cbo}`,
        sub: `CBO ${c.cbo} (Autorizado SIGTAP)`,
        keywords: `${c.descricao} ${c.cbo}`,
      }));
    }

    const mapa = new Map<string, { nome: string; cbo?: string }>();
    // 3. Especialidades cadastradas e oficiais na base
    for (const e of especialidadesCadastradas) {
      const nome = (e.nome || "").trim();
      if (nome && !mapa.has(nome)) {
        mapa.set(nome, { nome, cbo: e.codigo_cbo });
      }
    }
    // 4. Especialidades complementares presentes no catálogo de procedimentos
    for (const p of procedimentosTodos) {
      const esp = (p.especialidade || p.nome_especialidade || "").trim();
      if (esp && !mapa.has(esp)) {
        mapa.set(esp, { nome: esp, cbo: p.codigo_especialidade });
      }
    }
    return Array.from(mapa.values())
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
      .map((e) => ({
        value: e.nome,
        label: e.nome,
        sub: e.cbo ? `CBO ${e.cbo}` : undefined,
        keywords: `${e.nome} ${e.cbo || ""}`,
      }));
  }, [cboFiltroSig, espsCboSel, isConsulta, cbosAutorizados, especialidadesCadastradas, procedimentosTodos]);

  function renderPainelHierarquiaSigtap(contexto: "individual" | "lote") {
    const grupos = arvoreSigtap?.grupos ?? [];
    const subgrupos = (arvoreSigtap?.subgrupos ?? []).filter(
      (s) => !grupoSig || s.grupo_codigo === grupoSig || s.codigo.startsWith(grupoSig),
    );
    return (
      <div className="mt-4 rounded-xl border border-sus-900/10 bg-sand/30 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-sus-900">
            <Layers className="h-3.5 w-3.5 text-teal" /> Hierarquia SIGTAP (Área → Subgrupo → CBO)
          </span>
          {(grupoSig || subgrupoSig || cboFiltroSig) && (
            <button
              type="button"
              onClick={() => {
                setGrupoSig("");
                setSubgrupoSig("");
                aoSelecionarCboFiltro("");
              }}
              className="text-[11px] font-semibold text-red-600 hover:underline"
            >
              Limpar filtro SIGTAP
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 items-start">
          <div>
            <div className="min-h-[22px] flex items-center mb-1">
              <Label className="!mb-0 text-[11px] font-bold text-sus-950">Área (Grupo SIGTAP)</Label>
            </div>
            <Select
              value={grupoSig}
              onChange={(e) => aoSelecionarGrupoSig(e.target.value)}
              className="h-11 text-xs font-medium"
            >
              <option value="">Todas as áreas SIGTAP…</option>
              {grupos.map((g) => (
                <option key={g.codigo} value={g.codigo}>
                  {g.codigo} · {g.nome}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <div className="min-h-[22px] flex items-center mb-1">
              <Label className="!mb-0 text-[11px] font-bold text-sus-950">Subgrupo SIGTAP</Label>
            </div>
            <Select
              value={subgrupoSig}
              onChange={(e) => aoSelecionarSubgrupoSig(e.target.value)}
              className="h-11 text-xs font-medium"
            >
              <option value="">
                {grupoSig ? `Todos os subgrupos do Grupo ${grupoSig}…` : "Todos os subgrupos SIGTAP…"}
              </option>
              {subgrupos.map((s) => (
                <option key={s.codigo} value={s.codigo}>
                  {s.codigo} · {s.nome}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <div className="min-h-[22px] flex items-center mb-1">
              <Label className="!mb-0 text-[11px] font-bold text-sus-950">
                CBO (Ocupação SIGTAP)
              </Label>
            </div>
            <Combobox
              value={cboFiltroSig}
              onChange={(v) => aoSelecionarCboFiltro(v)}
              options={opcoesCboArvore}
              placeholder={
                contexto === "lote"
                  ? "Selecione o CBO para filtrar…"
                  : "Selecione o CBO…"
              }
              searchPlaceholder="Digite o código CBO ou nome da ocupação…"
              emptyText="Nenhum CBO encontrado nessa área/subgrupo"
              showAll={true}
            />
          </div>
        </div>
      </div>
    );
  }

  function renderCampoCboEspecialidade(contexto: "individual" | "lote") {
    return (
      <div>
        <div className="min-h-[22px] flex items-center justify-between gap-2 mb-1">
          <Label className="!mb-0 text-xs font-bold text-sus-950">
            {isConsulta ? "Especialidade Médica *" : "Especialidade Autorizada"}
          </Label>
          <div className="flex items-center gap-2">
            {cboFiltroSig && (
              <span className="text-[10px] font-bold text-teal bg-teal/10 px-2 py-0.5 rounded">
                Filtrada p/ CBO {cboFiltroSig}
              </span>
            )}
            {cbosAutorizados.length > 0 && !isConsulta && !cboFiltroSig && (
              <span className="text-[10px] font-bold text-teal bg-teal/10 px-2 py-0.5 rounded">
                {cbosAutorizados.length} CBO(s) no SIGTAP
              </span>
            )}
            {(especialidade || cboFiltroSig) && (
              <button
                type="button"
                onClick={() => {
                  setEspecialidade("");
                  setCodigoEspecialidade("");
                  setCboFiltroSig("");
                  setEspsCboSel([]);
                  setEspManual(false);
                }}
                className="text-[10px] text-red-600 font-semibold hover:underline"
              >
                Limpar
              </button>
            )}
          </div>
        </div>
        <div className="mt-1">
          <Combobox
            value={especialidade}
            onChange={(v) => {
              setEspecialidade(v);
              setEspManual(Boolean(v));
              const cboItem = cbosAutorizados.find(
                (c) => (c.descricao || `CBO ${c.cbo}`) === v || c.descricao === v,
              );
              if (cboItem) {
                setCodigoEspecialidade(cboItem.cbo);
                return;
              }
              const opt = opcoesEspecialidades.find((o) => o.value === v);
              if (opt?.sub) {
                const cboMatch = opt.sub.match(/\d{4,6}/);
                if (cboMatch) setCodigoEspecialidade(cboMatch[0]);
              }
              const it = procedimentosTodos.find((p) => (p.especialidade || p.nome_especialidade) === v);
              if (it?.codigo_especialidade) setCodigoEspecialidade(it.codigo_especialidade);
            }}
            options={opcoesEspecialidades}
            placeholder={
              cboFiltroSig
                ? `Especialidades autorizadas para o CBO ${cboFiltroSig}…`
                : isConsulta
                  ? contexto === "lote"
                    ? "Buscar especialidade médica ou CBO para o lote…"
                    : "Buscar CBO ou especialidade médica (ex: Cardiologia, Ortopedia)…"
                  : !codigoProcedimento
                    ? "Selecione o CBO acima ou o procedimento abaixo…"
                    : carregandoCbos
                      ? "Consultando CBOs autorizados no SIGTAP…"
                      : "Buscar especialidade médica ou CBO autorizado…"
            }
            searchPlaceholder="Digite o nome da especialidade ou CBO…"
            emptyText={
              cboFiltroSig
                ? "Nenhuma especialidade vinculada a este CBO"
                : !isConsulta && codigoProcedimento && cbosAutorizados.length > 0
                  ? "Nenhum CBO autorizado correspondente"
                  : "Nenhuma especialidade encontrada"
            }
            showAll={Boolean(cboFiltroSig)}
          />
        </div>
        <p className="mt-1 text-[11px] text-ink/60">
          {cboFiltroSig
            ? "Exibindo exclusivamente as especialidades correspondentes e autorizadas ao CBO selecionado."
            : isConsulta
              ? "Para consultas, selecione o CBO acima ou escolha diretamente a especialidade médica."
              : cbosAutorizados.length > 0
                ? "Especialidades restritas estritamente aos CBOs autorizados no SIGTAP para o procedimento."
                : "Preenchida automaticamente pelo CBO ou procedimento selecionado."}
        </p>
      </div>
    );
  }

  function renderBannerRegrasServico() {
    if (!tipoServico || !tipoFilaAtivo) return null;
    const temCbos = cbosLiberadosServico.length > 0;
    if (!temCbos && !tipoFilaAtivo.descricao_regras) return null;

    return (
      <div className="mt-2.5 rounded-lg border border-teal/20 bg-teal/5 p-2.5 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-bold text-teal-900 inline-flex items-center gap-1">
              {tipoFilaAtivo.exigir_cbo_estrito ? (
                <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-bold text-amber-900 border border-amber-300">
                  🔒 Regra Estrita
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-bold text-emerald-900 border border-emerald-300">
                  ℹ️ Regra Flexível
                </span>
              )}
              CBOs Liberados:
            </span>
            {temCbos ? (
              cbosLiberadosServico.map((c) => (
                <span
                  key={c.cbo}
                  className="inline-flex items-center gap-1 rounded bg-white px-2 py-0.5 text-[11px] font-semibold text-sus-900 border border-teal/20 shadow-xs"
                >
                  <span className="font-mono text-[10px] font-bold text-teal">{c.cbo}</span>
                  <span>{c.nome || `CBO ${c.cbo}`}</span>
                </span>
              ))
            ) : (
              <span className="text-[11px] text-ink/70">Acesso amplo a todos os CBOs médicos</span>
            )}
          </div>
          <Link
            to="/configuracoes?aba=servicos"
            target="_blank"
            className="text-[11px] font-semibold text-teal hover:underline inline-flex items-center gap-1"
          >
            Editar regras nas Configurações →
          </Link>
        </div>
        {tipoFilaAtivo.descricao_regras && (
          <p className="mt-1.5 text-[11px] text-ink/75 border-t border-teal/10 pt-1.5">
            {tipoFilaAtivo.descricao_regras}
          </p>
        )}
      </div>
    );
  }

  function renderAlertaCboMedico() {
    if (!medicoId || !tipoServico) return null;
    const medObj = medicos.find((m) => String(m.id) === String(medicoId));
    if (!medObj) return null;
    const isGenerico =
      medObj.nome.includes("Responsável Técnico") ||
      medObj.nome.includes("Responsavel Tecnico") ||
      medObj.nome.includes("Médico da Unidade") ||
      medObj.nome.includes("Medico da Unidade");

    if (validandoCbo) {
      return (
        <p className="mt-1 text-[11px] text-ink/60 animate-pulse">
          Verificando compatibilidade de CBO do médico com o serviço...
        </p>
      );
    }

    if (valCbo && !valCbo.compativel) {
      return (
        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-800 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">Incompatibilidade com as regras de {tipoServico}</p>
            <p className="mt-0.5 text-[11px]">
              {valCbo.alerta ||
                valCbo.motivo ||
                "O profissional selecionado não possui CBO autorizado para este tipo de serviço."}
            </p>
          </div>
        </div>
      );
    }

    if (
      valCbo?.compativel &&
      valCbo?.cbo_profissional &&
      cbosLiberadosServico.some((c) => c.cbo === valCbo.cbo_profissional)
    ) {
      return (
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] font-medium text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
          <span>Médico especialista autorizado para {tipoServico} (CBO {valCbo.cbo_profissional}).</span>
        </div>
      );
    }

    if (isGenerico && tipoFilaAtivo?.exigir_cbo_estrito) {
      return (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">Serviço com Regra Estrita de CBO</p>
            <p className="mt-0.5 text-[11px]">
              O serviço &quot;{tipoServico}&quot; foi configurado para exigir médico especialista com CBO autorizado.
            </p>
          </div>
        </div>
      );
    }

    return null;
  }

  const unidNomeAtual = useMemo(() => {
    const u = unidades.find((x) => String(x.id) === String(unidadeId));
    return u?.nome || user?.unidade_saude_nome || "Unidade não vinculada";
  }, [unidades, unidadeId, user]);

  const medNomeAtual = useMemo(() => {
    const m = medicos.find((x) => String(x.id) === String(medicoId));
    return m?.nome || (m?.crm ? `Dr(a). CRM ${m.crm}` : "Médico da Unidade");
  }, [medicos, medicoId]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-16">
      {/* Breadcrumb e Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-xs text-ink/60 mb-1">
            <Link to="/fila-exames" className="hover:text-sus-900 transition font-medium">
              Solicitações
            </Link>
            <ChevronRight className="h-3 w-3" />
            <span className="font-semibold text-sus-950">Nova Solicitação</span>
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-sus-950 flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-teal" />
            Lançamento de Nova Solicitação
          </h1>
          <p className="text-xs text-ink/60">
            Cadastre novos pedidos regulados para a fila de espera{podeAgendarDireto ? " ou agendamento direto" : ""} com validação instantânea.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link to="/fila-exames">
            <Button variant="outline" className="text-xs">
              <ListOrdered className="h-4 w-4" /> Ver Fila de Espera
            </Button>
          </Link>
          {can("tfd_agenda") && (
            <Link to="/tfd/agendamentos">
              <Button variant="outline" className="text-xs">
                <Calendar className="h-4 w-4" /> Agenda e Recepção
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* Seletor de Modo: Individual vs. Lançamento em Lote */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sus-900/10 bg-white p-2.5 shadow-xs">
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-sand/60">
          <button
            type="button"
            onClick={() => alternarModo("individual")}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition ${
              modo === "individual"
                ? "bg-white text-sus-950 shadow-xs"
                : "text-ink/60 hover:text-sus-950 hover:bg-white/40"
            }`}
          >
            <User className="h-4 w-4 text-teal" />
            Lançamento Individual
          </button>
          <button
            type="button"
            onClick={() => alternarModo("lote")}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition ${
              modo === "lote"
                ? "bg-teal text-white shadow-xs"
                : "text-ink/60 hover:text-sus-950 hover:bg-white/40"
            }`}
          >
            <Layers className="h-4 w-4" />
            Lançamento em Lote
            <span
              className={`rounded-full px-1.5 py-0.2 text-[10px] font-black ${
                modo === "lote" ? "bg-white/20 text-white" : "bg-teal/15 text-teal"
              }`}
            >
              Novo
            </span>
          </button>
        </div>

        <div className="text-xs text-ink/60 px-2">
          {modo === "lote" ? (
            <span className="flex items-center gap-1.5 text-teal font-semibold">
              <Users className="h-4 w-4" /> Modo Lote: adicione múltiplos pacientes rapidamente com o mesmo procedimento e agendamento direto.
            </span>
          ) : (
            <span>Modo Individual: preenchimento completo de um paciente por solicitação.</span>
          )}
        </div>
      </div>

      {/* Alerta de Erro Global */}
      {erro && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-800">
          <AlertCircle className="h-5 w-5 shrink-0 text-red-600" />
          <span>{erro}</span>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODO 1: LANÇAMENTO INDIVIDUAL                                  */}
      {/* ============================================================== */}
      {modo === "individual" && (
        <>
          {/* Banner de Sucesso pós-criação */}
          {criado && (
            <Card className="border-2 border-emerald-500 bg-emerald-50/60 p-5 shadow-sm">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="h-7 w-7 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-display text-base font-bold text-emerald-950">
                      Solicitação cadastrada com sucesso!
                    </p>
                    <p className="text-xs text-emerald-800 mt-0.5">
                      Identificador do pedido:{" "}
                      <strong className="font-mono bg-emerald-200/70 px-1.5 py-0.5 rounded text-emerald-950">
                        {criado.codigo_curto || `EX-${criado.id}`}
                      </strong>{" "}
                      · Paciente: <strong>{criado.paciente_nome}</strong>
                    </p>
                    <p className="text-xs text-emerald-700 mt-1">
                      Status atual:{" "}
                      <span className="font-bold uppercase tracking-wider text-[11px] bg-white px-2 py-0.5 rounded border border-emerald-300">
                        {criado.status === "agendado" ? "📅 Agendado Direto" : "⏳ Na Fila de Espera"}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                  <BotaoWhatsApp
                    exameId={criado.id}
                    exame={criado}
                    tipo={criado.status === "agendado" ? "agendamento" : "entrada_fila"}
                    variante="completo"
                  />
                  <Button
                    type="button"
                    onClick={() => setAbrirComprovante(true)}
                    variant="outline"
                    className="border-emerald-600 text-emerald-800 hover:bg-emerald-100 text-xs font-semibold flex items-center gap-1.5 !h-9"
                  >
                    <Printer className="h-4 w-4" /> Comprovante com QR Code
                  </Button>
                  <Button
                    onClick={limparFormulario}
                    className="bg-emerald-700 hover:bg-emerald-800 text-white text-xs"
                  >
                    <Plus className="h-4 w-4" /> Lançar Outra Solicitação
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => navigate("/fila-exames")}
                    className="border-emerald-600 text-emerald-800 hover:bg-emerald-100 text-xs"
                  >
                    Ir para Fila
                  </Button>
                </div>
              </div>
            </Card>
          )}

          {/* Formulário Principal com Prevenção de Enter */}
          <form
            onSubmit={submeter}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA") {
                e.preventDefault();
              }
            }}
          >
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* COLUNA ESQUERDA: Paciente, Serviço/Origem, Dados Clínicos e Agendamento */}
              <div className="lg:col-span-7 space-y-6">
                {/* Bloco 1: Identificação do Paciente (Primeiro Campo) */}
                <Card className="p-5 shadow-xs">
                  <div className="flex items-center justify-between border-b border-sus-900/10 pb-3 mb-4">
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-teal" />
                      <h2 className="font-display text-sm font-bold text-sus-950">
                        1. Identificação do Paciente
                      </h2>
                    </div>
                    <span className="text-[11px] font-semibold text-teal bg-teal/10 px-2.5 py-0.5 rounded-full">
                      Primeiro Passo Obrigatório
                    </span>
                  </div>

                  <BuscaPacienteAutocomplete
                    pacienteId={pacienteSelecionado?.id || ""}
                    pacienteInicial={pacienteSelecionado}
                    onSelect={selecionarPacienteIndividual}
                    label="Paciente Solicitante"
                    placeholder="Buscar paciente por nome, CPF, CNS, prontuário ou nascimento (DD/MM/AAAA)…"
                    obrigatorio
                  />

                  {pacienteSelecionado && (() => {
                    const pacExt = pacienteSelecionado as PacienteComUnidade;
                    const unidadePac = encontrarUnidadeDoPaciente(pacExt, unidades);
                    const unidadePacNome = pacExt.unidade_nome || unidadePac?.nome || "";
                    const unidadePacCnes = pacExt.unidade_cnes || unidadePac?.cnes || "";
                    const endCompleto = formatarEnderecoCompleto(pacienteSelecionado);
                    return (
                      <div className="mt-3 rounded-xl border border-sus-900/10 bg-sand/30 p-3.5 text-xs space-y-2">
                        <div className="flex flex-wrap gap-x-6 gap-y-1">
                          <div>
                            <span className="text-ink/60">CPF:</span>{" "}
                            <strong className="text-sus-950 font-mono">
                              {pacienteSelecionado.cpf || "Não informado"}
                            </strong>
                          </div>
                          <div>
                            <span className="text-ink/60">Cartão SUS (CNS):</span>{" "}
                            <strong className="text-sus-950 font-mono">
                              {pacienteSelecionado.cns || "Não informado"}
                            </strong>
                          </div>
                          <div>
                            <span className="text-ink/60">Prontuário:</span>{" "}
                            <strong className="text-sus-950 font-mono">
                              {pacienteSelecionado.codigo_prontuario?.replace(/^PR-0*/, "") || pacienteSelecionado.id || "—"}
                            </strong>
                          </div>
                          {pacienteSelecionado.nascimento && (
                            <div>
                              <span className="text-ink/60">Nascimento:</span>{" "}
                              <strong className="text-sus-950 font-mono">
                                {pacienteSelecionado.nascimento.slice(0, 10).split("-").reverse().join("/")}
                              </strong>
                            </div>
                          )}
                        </div>
                        <div className="border-t border-sus-900/10 pt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 items-start">
                          <div className="flex items-start gap-1.5">
                            <Building2 className="h-3.5 w-3.5 text-teal shrink-0 mt-0.5" />
                            <div>
                              <span className="text-ink/60 block text-[11px]">Unidade de Saúde (Cadastro):</span>
                              <strong className="text-sus-950">
                                {unidadePacNome || "Não vinculada"}
                                {unidadePacCnes ? ` (CNES ${unidadePacCnes})` : ""}
                              </strong>
                            </div>
                          </div>
                          <div className="flex items-start gap-1.5">
                            <MapPin className="h-3.5 w-3.5 text-teal shrink-0 mt-0.5" />
                            <div>
                              <span className="text-ink/60 block text-[11px]">Endereço Completo:</span>
                              <strong className="text-sus-950">
                                {endCompleto || "Endereço não informado"}
                              </strong>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </Card>

                {/* Bloco 2: Data do Pedido, Tipo de Serviço e Especialidade */}
                <Card className="p-5 shadow-xs">
                  <div className="flex items-center justify-between border-b border-sus-900/10 pb-3 mb-4">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-teal" />
                      <h2 className="font-display text-sm font-bold text-sus-950">
                        2. Data do Pedido, Tipo de Serviço e Especialidade
                      </h2>
                    </div>
                  </div>

                  {/* 2.1 Data do Pedido */}
                  <div className="mb-4 rounded-xl border border-sus-900/10 bg-sand/20 p-3.5">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                      <div>
                        <Label className="!mb-0.5 text-xs font-bold text-sus-950">
                          Data do Pedido / Solicitação <span className="text-red-500">*</span>
                        </Label>
                        <p className="text-[11px] text-ink/60">
                          Data constante no pedido médico ou encaminhamento do paciente.
                        </p>
                      </div>
                      <div className="w-full sm:w-64 shrink-0">
                        {isTfdCentral ? (
                          <div>
                            <Input
                              type="date"
                              value={dataPedido}
                              min={retroativoBloqueado ? hojeISO() : undefined}
                              onChange={(e) => setDataPedido(e.target.value)}
                              className="h-11 text-xs font-semibold"
                              required
                            />
                            <span className="block mt-1 text-[10px] text-ink/60 font-medium">
                              {podeDataRetroativa
                                ? "Lançamentos retroativos liberados para este perfil."
                                : "Perfil sem permissão para datas retroativas."}
                            </span>
                          </div>
                        ) : (
                          <div>
                            <Input
                              type="date"
                              value={hojeISO()}
                              disabled
                              className="h-11 bg-sand/40 font-semibold text-sus-950 cursor-not-allowed text-xs"
                            />
                            <span className="block mt-1 text-[10px] text-amber-800 font-medium">
                              Operadores de PSF: lançamento para a data atual.
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 2.2 Seleção de Serviço e Especialidade */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                    {/* Passo 1: Tipo de Serviço (Dinâmico do Banco, sem filas de sangue) */}
                    <div>
                      <div className="min-h-[22px] flex items-center mb-1">
                        <Label className="!mb-0 text-xs font-bold text-sus-950">
                          Tipo de Serviço <span className="text-red-500">*</span>
                        </Label>
                      </div>
                      <Select
                        value={tipoServico}
                        onChange={(e) => aoMudarTipoServico(e.target.value)}
                        className="text-xs font-semibold text-sus-950"
                        required
                      >
                        <option value="">Selecione o Tipo de Serviço…</option>
                        {tiposServicoDisponiveis.map((tf) => (
                          <option key={tf.id} value={tf.nome}>
                            {tf.nome}
                          </option>
                        ))}
                      </Select>
                      <p className="mt-1 text-[11px] text-ink/60">
                        {isConsulta
                          ? "Consulta médica especializada: requer apenas a definição do CBO/especialidade."
                          : "Filtra automaticamente o catálogo de procedimentos ao lado."}
                      </p>
                      {renderBannerRegrasServico()}
                    </div>

                    {/* Especialidade Médica / CBO */}
                    {renderCampoCboEspecialidade("individual")}
                  </div>

                  {renderPainelHierarquiaSigtap("individual")}
                </Card>

                {/* Bloco 3: Origem do Pedido, Unidade e Médico */}
                <Card className="p-5 shadow-xs">
                  <div className="flex items-center justify-between border-b border-sus-900/10 pb-3 mb-4">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-teal" />
                      <h2 className="font-display text-sm font-bold text-sus-950">
                        3. Origem e Profissional Solicitante
                      </h2>
                    </div>
                    {!isTfdCentral && (
                      <span className="text-[11px] font-semibold text-amber-800 bg-amber-100 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" /> Restrito à Unidade do Operador
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                    {/* Unidade Solicitante com busca inteligente Combobox */}
                    <div>
                      <div className="min-h-[22px] flex items-center justify-between mb-1">
                        <Label className="!mb-0 text-xs font-bold text-sus-950">
                          PSF / Unidade Solicitante <span className="text-red-500">*</span>
                        </Label>
                      </div>
                      {isTfdCentral ? (
                        <div>
                          <Combobox
                            value={unidadeId}
                            onChange={(v) => setUnidadeId(v)}
                            options={opcoesUnidades}
                            placeholder="Buscar PSF / Unidade Solicitante…"
                            searchPlaceholder="Digite o nome do PSF ou CNES…"
                            emptyText="Nenhuma unidade encontrada"
                            showAll={false}
                          />
                          {pacienteSelecionado && (
                            <p className="mt-1 text-[11px] text-ink/60">
                              Preenchida automaticamente pelo cadastro do paciente (editável se necessário).
                            </p>
                          )}
                        </div>
                      ) : (
                        <div>
                          <Input
                            value={unidNomeAtual}
                            disabled
                            className="bg-sand/40 font-semibold text-sus-950 cursor-not-allowed text-xs"
                          />
                          <p className="mt-1 text-[11px] text-ink/60">
                            Usuários de PSF só podem lançar pedidos vinculados à sua própria unidade.
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Médico Requisitante com busca inteligente Combobox */}
                    <div>
                      <div className="min-h-[22px] flex items-center justify-between mb-1">
                        <Label className="!mb-0 text-xs font-bold text-sus-950">
                          Médico(a) Requisitante <span className="text-red-500">*</span>
                        </Label>
                        <button
                          type="button"
                          onClick={() => {
                            const mGen = medicos.find((m) =>
                              m.nome.includes("Responsável Técnico") || m.nome.includes("Médico da Unidade"),
                            );
                            if (mGen) setMedicoId(String(mGen.id));
                          }}
                          className="text-[10px] font-bold text-teal hover:underline"
                        >
                          Usar Médico da Unidade
                        </button>
                      </div>
                      <Combobox
                        value={medicoId}
                        onChange={(v) => setMedicoId(v)}
                        options={opcoesMedicos}
                        placeholder="Buscar Médico(a) Requisitante…"
                        searchPlaceholder="Digite o nome do médico ou CRM…"
                        emptyText="Nenhum médico encontrado"
                        showAll={false}
                      />
                      {renderAlertaCboMedico()}
                    </div>
                  </div>
                </Card>

                {/* Bloco 4: Dados Clínicos e Prioridade */}
                <Card className="p-5 shadow-xs">
                  <div className="flex items-center gap-2 border-b border-sus-900/10 pb-3 mb-4">
                    <Stethoscope className="h-4 w-4 text-teal" />
                    <h2 className="font-display text-sm font-bold text-sus-950">
                      {podeDefinirPrioridade ? "4. Dados Clínicos e Prioridade" : "4. Dados Clínicos"}
                    </h2>
                  </div>

                  <div className="space-y-4">
                    {/* Classificação de Prioridade (visível apenas para Médicos / Superuser) */}
                    {podeDefinirPrioridade && (
                      <div>
                        <Label className="text-xs font-bold text-sus-950">Classificação de Prioridade</Label>
                        <div className="mt-1.5 flex flex-wrap gap-3">
                          <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                            <input
                              type="radio"
                              name="prio"
                              value="rotina"
                              checked={prioridade === "rotina"}
                              onChange={() => setPrioridade("rotina")}
                              className="accent-teal h-4 w-4"
                            />
                            <span className="rounded-md bg-sus-900/10 px-2 py-0.5 text-sus-900 font-bold">
                              Eletivo / Rotina (Fila normal regulada)
                            </span>
                          </label>
                          <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                            <input
                              type="radio"
                              name="prio"
                              value="urgente"
                              checked={prioridade === "urgente"}
                              onChange={() => setPrioridade("urgente")}
                              className="accent-red-600 h-4 w-4"
                            />
                            <span className="rounded-md bg-red-100 px-2 py-0.5 text-red-700 font-bold">
                              Prioridade Urgente
                            </span>
                          </label>
                        </div>
                      </div>
                    )}

                    {/* Campo CID-10 com busca inteligente */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <Label className="!mb-0 text-xs font-bold text-sus-950 flex items-center gap-1.5">
                          <ClipboardList className="h-3.5 w-3.5 text-teal" /> Diagnóstico / CID-10 (opcional)
                        </Label>
                        {cidCodigo && (
                          <button
                            type="button"
                            onClick={() => {
                              setCidCodigo("");
                              setCidDescricao("");
                              setBuscaCid("");
                            }}
                            className="text-[11px] font-bold text-red-600 hover:underline"
                          >
                            Remover CID
                          </button>
                        )}
                      </div>
                      {cidCodigo ? (
                        <div className="flex items-center justify-between rounded-xl border border-teal/40 bg-teal/10 px-3 py-2 text-xs">
                          <div>
                            <span className="font-mono font-bold text-teal">{cidCodigo}</span>
                            <span className="ml-2 font-medium text-sus-950">{cidDescricao}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setCidCodigo("");
                              setCidDescricao("");
                              setBuscaCid("");
                            }}
                            className="rounded p-1 text-ink/40 hover:text-red-600"
                            title="Remover CID"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink/40" />
                          <Input
                            value={buscaCid}
                            onChange={(e) => setBuscaCid(e.target.value)}
                            placeholder="Pesquise por código ou nome do CID-10 (ex: J06, cefaleia, diabetes)…"
                            className="pl-9 text-xs"
                          />
                          {buscandoCid && (
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-ink/45">
                              Buscando…
                            </span>
                          )}
                          {cidsSugeridos.length > 0 && (
                            <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-xl border border-sus-900/15 bg-white shadow-lg">
                              {cidsSugeridos.map((c) => (
                                <button
                                  key={c.codigo}
                                  type="button"
                                  onClick={() => {
                                    setCidCodigo(c.codigo);
                                    setCidDescricao(c.descricao);
                                    setBuscaCid("");
                                    setCidsSugeridos([]);
                                  }}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-teal/10 transition"
                                >
                                  <span className="rounded bg-teal/15 px-1.5 py-0.5 font-mono font-bold text-teal">
                                    {c.codigo}
                                  </span>
                                  <span className="truncate text-ink/80">{c.descricao}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Justificativa Clínica Obrigatória */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <Label className="!mb-0 text-xs font-bold text-sus-950">
                          Justificativa Clínica e Hipótese Diagnóstica <span className="text-red-500">*</span> (mínimo {JUST_MIN} caracteres)
                        </Label>
                        <span className={`text-[11px] font-semibold ${justificativa.trim().length >= JUST_MIN ? "text-emerald-700" : "text-amber-800"}`}>
                          {justificativa.trim().length} / {JUST_MIN} caracteres {justificativa.trim().length >= JUST_MIN ? "✓" : `(faltam ${JUST_MIN - justificativa.trim().length})`}
                        </span>
                      </div>
                      <textarea
                        value={justificativa}
                        onChange={(e) => setJustificativa(e.target.value)}
                        rows={3}
                        placeholder="Descreva a indicação clínica, sintomas ou observações do médico solicitante (obrigatório, mínimo 12 caracteres)…"
                        className={`w-full rounded-xl border p-3 text-xs outline-none transition focus:ring-2 ${
                          justificativa.trim().length > 0 && justificativa.trim().length < JUST_MIN
                            ? "border-amber-400 focus:border-amber-500 focus:ring-amber-200"
                            : "border-sus-900/15 focus:border-teal focus:ring-teal/20"
                        }`}
                        required
                      />
                    </div>

                    {/* Observações Gerais */}
                    <div>
                      <Label className="text-[11px] text-ink/70">Observações adicionais (opcional)</Label>
                      <textarea
                        value={observacoes}
                        onChange={(e) => setObservacoes(e.target.value)}
                        rows={2}
                        placeholder="Ex: Paciente necessita de cadeira de rodas, jejum especial ou contato com acompanhante…"
                        className="w-full rounded-xl border border-sus-900/15 bg-white p-2.5 text-xs outline-none transition focus:border-teal"
                      />
                    </div>
                  </div>
                </Card>

                {/* Bloco 5: Opção de Agendamento Direto (Requer RBAC tfd_agenda:criar) */}
                {podeAgendarDireto && (
                  <Card className="p-5 shadow-xs border-dashed border-sus-900/20">
                    <div className="flex items-center justify-between border-b border-sus-900/10 pb-3 mb-3">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-teal" />
                        <h2 className="font-display text-sm font-bold text-sus-950">
                          5. Modo de Inclusão: Fila vs. Agendamento Direto
                        </h2>
                      </div>
                      <span className="text-[11px] text-teal font-semibold">Permissão Agenda TFD</span>
                    </div>

                    <div className="space-y-3">
                      <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer text-sus-950">
                        <input
                          type="checkbox"
                          checked={agendamentoDireto}
                          onChange={(e) => setAgendamentoDireto(e.target.checked)}
                          className="accent-teal h-4 w-4"
                        />
                        Marcar data de agendamento diretamente (ignorar espera na fila)
                      </label>

                      {agendamentoDireto && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 items-start">
                          <div>
                            <Label className="text-xs font-bold text-sus-950">Data do Atendimento</Label>
                            <Input
                              type="date"
                              value={dataAgendada}
                              onChange={(e) => setDataAgendada(e.target.value)}
                              className="text-xs"
                              required={agendamentoDireto}
                            />
                          </div>
                          <div>
                            <Label className="text-xs font-bold text-sus-950">Horário</Label>
                            <Input
                              type="time"
                              value={horaAgendada}
                              onChange={(e) => setHoraAgendada(e.target.value)}
                              className="text-xs"
                              required={agendamentoDireto}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </Card>
                )}
              </div>

              {/* COLUNA DIREITA (STICKY): Seleção de Procedimentos, Lista de Exames e Resumo */}
              <div className="lg:col-span-5 space-y-6 lg:sticky lg:top-6">
                <Card className="p-5 shadow-xs">
                  <div className="flex items-center justify-between border-b border-sus-900/10 pb-3 mb-4">
                    <div className="flex items-center gap-2">
                      <ClipboardList className="h-4 w-4 text-teal" />
                      <h2 className="font-display text-sm font-bold text-sus-950">
                        Procedimentos e Exames do Pedido
                      </h2>
                    </div>
                    {procedimentosAdicionados.length > 0 && (
                      <span className="text-[11px] font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                        {procedimentosAdicionados.length} agrupado(s)
                      </span>
                    )}
                  </div>

                  {/* Se for Consulta Especializada: banner SUS 0301010072 */}
                  {isConsulta ? (
                    <div className="rounded-xl border border-teal/20 bg-teal/5 p-4 flex items-start gap-3">
                      <CheckCircle2 className="h-5 w-5 text-teal shrink-0 mt-0.5" />
                      <div className="text-xs">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-sm text-sus-950 font-mono">0301010072</span>
                          <span className="font-bold text-sus-950">CONSULTA MEDICA EM ATENCAO ESPECIALIZADA</span>
                          <span className="rounded bg-teal/15 px-2 py-0.5 text-[10px] font-bold text-teal uppercase">
                            Padrão SUS / Vivver
                          </span>
                        </div>
                        <p className="mt-1 text-ink/65 text-[11px]">
                          Consultas médicas especializadas utilizam o procedimento padronizado <strong>0301010072</strong>. O direcionamento clínico é definido pelo <strong>CBO da especialidade</strong> selecionado à esquerda.
                        </p>
                        {especialidade ? (
                          <p className="mt-1.5 font-bold text-teal-900">
                            ✓ Especialidade vinculada: {especialidade} {codigoEspecialidade ? `(CBO: ${codigoEspecialidade})` : ""}
                          </p>
                        ) : (
                          <p className="mt-1.5 font-medium text-amber-700">
                            Aguardando a seleção do CBO / Especialidade Médica ao lado.
                          </p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div>
                      <Label className="text-xs font-bold text-sus-950 flex items-center justify-between">
                        <span>Procedimento Correspondente <span className="text-red-500">*</span></span>
                        {isLaboratorial && (
                          <span className="text-[10px] text-teal font-semibold flex items-center gap-1">
                            <FlaskConical className="h-3 w-3" /> Tabela SIGTAP Laboratorial
                          </span>
                        )}
                      </Label>

                      {isLaboratorial ? (
                        <div className="mt-1 space-y-2">
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink/40" />
                            <Input
                              placeholder="Buscar exame laboratorial (ex: hemograma, glicose, EAS)..."
                              value={buscaSig}
                              onChange={(e) => setBuscaSig(e.target.value)}
                              className="pl-9 text-xs"
                            />
                          </div>
                          <div className="max-h-44 space-y-1 overflow-auto rounded-xl border border-sus-900/10 p-2 bg-sand/30">
                            {sigtapResultados.slice(0, 30).map((s) => (
                              <button
                                key={s.id}
                                type="button"
                                onClick={() => adicionarSigtapItem(s)}
                                className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-white transition"
                              >
                                <Plus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal" />
                                <span>
                                  <b>{s.codigo}</b> · {s.descricao}
                                </span>
                              </button>
                            ))}
                            {buscaSig.trim() && sigtapResultados.length === 0 && (
                              <p className="py-2 text-center text-xs text-ink/45">
                                Nenhum exame laboratorial encontrado para "{buscaSig}".
                              </p>
                            )}
                            {!buscaSig.trim() && sigtapResultados.length === 0 && !buscandoSig && (
                              <p className="py-2 text-center text-xs text-ink/45">
                                Digite para consultar exames laboratoriais na tabela SIGTAP.
                              </p>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="relative mt-1">
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink/40 pointer-events-none" />
                            <Input
                              placeholder={
                                tipoServico
                                  ? `Buscar em ${tipoServico} por nome, SIGTAP ou sigla…`
                                  : "Buscar procedimento por código SIGTAP, sigla ou nome…"
                              }
                              value={buscaProc}
                              onChange={(e) => {
                                setBuscaProc(e.target.value);
                                setProcFoco(true);
                              }}
                              onFocus={() => setProcFoco(true)}
                              onBlur={() => setTimeout(() => setProcFoco(false), 250)}
                              className="pl-9 pr-9 text-xs"
                              autoComplete="off"
                            />
                            {(buscaProc || procedimentoSel || procTexto) && (
                              <button
                                type="button"
                                onClick={() => {
                                  setBuscaProc("");
                                  handleSelecionarProcedimento(null);
                                  setProcFoco(false);
                                }}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink/40 hover:text-ink transition"
                                title="Limpar procedimento"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>

                          {/* Procedimento Selecionado Badge */}
                          {(procedimentoSel || procTexto) && (
                            <div className="mt-2 flex flex-wrap items-center justify-between gap-1.5 rounded-xl border border-teal/20 bg-teal/5 px-3 py-2 text-xs">
                              <div className="flex items-center gap-2 min-w-0">
                                <Check className="h-4 w-4 text-teal shrink-0" />
                                <div className="min-w-0">
                                  <p className="font-bold text-sus-950 break-words">
                                    {codigoProcedimento ? `${codigoProcedimento} · ` : ""}
                                    {procTexto || procedimentoSel?.exame}
                                  </p>
                                  <p className="text-[11px] text-ink/60">
                                    {tipoServico ? `${tipoServico} · ` : ""}
                                    {especialidade ? `Especialidade: ${especialidade}` : ""}
                                  </p>
                                </div>
                              </div>
                              <span className="rounded bg-teal/15 px-2 py-0.5 text-[10px] font-bold text-teal shrink-0">
                                Selecionado
                              </span>
                            </div>
                          )}

                          {/* Dropdown com Busca Inteligente */}
                          {procFoco && (
                            <div className="absolute left-0 right-0 z-30 mt-1 max-h-60 overflow-y-auto rounded-xl border border-sus-900/10 bg-white shadow-card">
                              <p className="sticky top-0 border-b border-sus-900/5 bg-sand/80 px-3 py-1.5 text-[11px] font-semibold text-sus-900/60 flex items-center justify-between">
                                <span className={erroCatalogo && opcoesProcFiltradas.length === 0 ? "text-red-700" : ""}>
                                  {opcoesProcFiltradas.length > 0
                                    ? `${opcoesProcFiltradas.length} procedimento(s) — clique para selecionar`
                                    : buscandoProc
                                    ? "Pesquisando no catálogo..."
                                    : erroCatalogo
                                    ? `Falha ao carregar catálogo: ${erroCatalogo}`
                                    : "Nenhum procedimento encontrado"}
                                </span>
                                {buscandoProc && (
                                  <span className="text-[10px] text-teal font-bold flex items-center gap-1">
                                    <span className="h-1.5 w-1.5 rounded-full bg-teal animate-ping" />
                                    SIGTAP...
                                  </span>
                                )}
                              </p>
                              {erroCatalogo && opcoesProcFiltradas.length > 0 && (
                                <p className="border-b border-amber-200 bg-amber-50 px-3 py-1 text-[11px] text-amber-800">
                                  Aviso da consulta ao catálogo: {erroCatalogo}
                                </p>
                              )}
                              {opcoesProcFiltradas.map((p, idx) => (
                                <button
                                  key={`${p.codigo_curto || p.codigo_procedimento || idx}-${p.exame}`}
                                  type="button"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => escolherProcedimento(p)}
                                  className="flex w-full items-start justify-between gap-2 border-b border-sus-900/5 px-3 py-2 text-left text-xs last:border-0 hover:bg-teal/5 transition"
                                >
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      {p.codigo_curto && (
                                        <span className="rounded bg-teal/15 px-1.5 py-0.5 text-[9px] font-bold text-teal uppercase shrink-0">
                                          {p.codigo_curto}
                                        </span>
                                      )}
                                      <span className="font-bold text-sus-950 truncate">
                                        {p.exame || p.nome_procedimento}
                                      </span>
                                    </div>
                                    <div className="mt-1 flex items-center gap-1.5 flex-wrap text-[11px] text-ink/60">
                                      {p.codigo_procedimento && (
                                        <span className="inline-flex items-center gap-0.5 rounded bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-800 border border-emerald-200">
                                          ✓ SIGTAP {p.codigo_procedimento}
                                        </span>
                                      )}
                                      {p.instrumento && (
                                        <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[9px] font-medium text-sky-800 border border-sky-200">
                                          {p.instrumento}
                                        </span>
                                      )}
                                      {p.complexidade && (
                                        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-800 border border-amber-200">
                                          {p.complexidade}
                                        </span>
                                      )}
                                      {p.tipo_fila && <span>{p.tipo_fila}</span>}
                                      {p.especialidade && <span>· {p.especialidade}</span>}
                                    </div>
                                  </div>
                                  <Plus className="h-4 w-4 shrink-0 text-teal mt-0.5" />
                                </button>
                              ))}
                              {buscaProc.trim().length >= 2 && (
                                <button
                                  type="button"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => {
                                    setProcTexto(buscaProc.trim());
                                    setProcedimentoSel(null);
                                    setBuscaProc("");
                                    setProcFoco(false);
                                  }}
                                  className="flex w-full items-center gap-2 border-t border-sus-900/10 bg-sand/30 px-3 py-2 text-left text-xs font-semibold text-teal hover:bg-teal/10 transition"
                                >
                                  <Plus className="h-3.5 w-3.5" /> Usar texto digitado: “{buscaProc.trim()}”
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={adicionarProcedimentoLista}
                          disabled={!tipoServico || (!procTexto.trim() && !procedimentoSel)}
                          className="border-teal/40 text-teal hover:bg-teal/10 text-xs font-bold"
                        >
                          <Plus className="h-3.5 w-3.5" /> Adicionar exame à lista do pedido
                        </Button>
                      </div>

                      {procedimentosAdicionados.length > 0 && (
                        <div className="mt-3 space-y-2 rounded-xl bg-sand/40 p-3 border border-sus-900/10">
                          <p className="text-[11px] font-bold uppercase tracking-wider text-sus-900/60">
                            Exames agrupados neste pedido ({procedimentosAdicionados.length}):
                          </p>
                          <div className="space-y-1.5">
                            {procedimentosAdicionados.map((it, idx) => (
                              <div
                                key={idx}
                                className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-xs font-medium text-sus-950 border border-sus-900/15 shadow-2xs"
                              >
                                <div className="min-w-0">
                                  <p className="truncate font-semibold">
                                    {it.codigo ? <strong className="font-mono text-teal mr-1">{it.codigo} ·</strong> : null}
                                    {it.nome}
                                  </p>
                                  {it.tipo_fila && (
                                    <span className="text-[10px] text-ink/55">{it.tipo_fila}</span>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => removerProcedimentoLista(idx)}
                                  className="text-red-500 hover:text-red-700 p-1 shrink-0"
                                  title="Remover este exame"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Dados Complementares do Procedimento */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 pt-4 border-t border-sus-900/10 items-start">
                    <div>
                      <div className="min-h-[20px] flex items-center justify-between mb-1">
                        <Label className="!mb-0 text-[11px] text-ink/70">Código SIGTAP</Label>
                        {isConsulta && (
                          <span className="text-[10px] text-teal font-semibold font-mono">
                            Fixado pelo SUS
                          </span>
                        )}
                      </div>
                      <Input
                        value={codigoProcedimento}
                        disabled={isConsulta}
                        onChange={(e) => setCodigoProcedimento(e.target.value)}
                        placeholder="Ex: 0205020186"
                        className={`text-xs font-mono ${isConsulta ? "bg-sand/40 font-bold text-teal" : ""}`}
                      />
                    </div>
                    <div>
                      <div className="min-h-[20px] flex items-center mb-1">
                        <Label className="!mb-0 text-[11px] text-ink/70">Nº do Pedido / Guia</Label>
                      </div>
                      <Input
                        value={numeroPedido}
                        onChange={(e) => setNumeroPedido(e.target.value)}
                        placeholder="Automático se vazio"
                        className="text-xs font-mono uppercase"
                      />
                    </div>
                  </div>

                  {/* ALERTA DE DUPLICIDADE EM TEMPO REAL */}
                  {duplicidadeAtiva && !ignorarDuplicidade && (
                    <div className="mt-4 pt-3 border-t border-sus-900/10">
                      <AlertaPedidoDuplicado
                        pedido={duplicidadeAtiva}
                        tipoModulo="tfd"
                        onProsseguir={() => setIgnorarDuplicidade(true)}
                        onCancelar={() => {
                          setProcedimentoSel(null);
                          setProcTexto("");
                          setCodigoProcedimento("");
                          setEspecialidade("");
                          setCodigoEspecialidade("");
                          setDuplicidadeAtiva(null);
                        }}
                      />
                    </div>
                  )}
                </Card>

                {/* Resumo do Pedido e Botões de Ação */}
                <Card className="p-5 shadow-xs bg-sand/20 border-sus-900/15 space-y-4">
                  <div className="flex items-center justify-between border-b border-sus-900/10 pb-2.5">
                    <h3 className="font-display text-sm font-bold text-sus-950">Resumo da Solicitação</h3>
                    <span className="text-[11px] font-semibold text-teal">
                      {agendamentoDireto && podeAgendarDireto ? "Agendamento Direto" : "Fila de Espera"}
                    </span>
                  </div>

                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between gap-2">
                      <span className="text-ink/60">Paciente:</span>
                      <span className="font-semibold text-sus-950 text-right truncate">
                        {pacienteSelecionado?.nome || "Não selecionado"}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-ink/60">Tipo de Serviço:</span>
                      <span className="font-semibold text-teal text-right truncate">
                        {tipoServico || "Não selecionado"}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-ink/60">Procedimento(s):</span>
                      <span className="font-semibold text-sus-950 text-right">
                        {obterListaFinalProcs().length > 0
                          ? `${obterListaFinalProcs().length} item(ns)`
                          : "Nenhum selecionado"}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-ink/60">PSF / Unidade:</span>
                      <span className="font-medium text-sus-950 text-right truncate">{unidNomeAtual}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-ink/60">Profissional:</span>
                      <span className="font-medium text-sus-950 text-right truncate">{medNomeAtual}</span>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-2 border-t border-sus-900/10">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={limparFormulario}
                      disabled={salvando}
                      className="text-xs"
                    >
                      <RotateCcw className="h-4 w-4" /> Limpar Campos
                    </Button>

                    <Button
                      type="submit"
                      disabled={salvando}
                      className="bg-teal text-white hover:brightness-110 shadow-sm text-xs font-bold px-5"
                    >
                      {salvando ? (
                        "Processando…"
                      ) : agendamentoDireto && podeAgendarDireto ? (
                        <>
                          <Calendar className="h-4 w-4" /> Confirmar e Agendar Direto
                        </>
                      ) : (
                        <>
                          <Plus className="h-4 w-4" /> Incluir Solicitação na Fila
                        </>
                      )}
                    </Button>
                  </div>
                </Card>
              </div>
            </div>
          </form>

      {/* Modal de Confirmação antes de Gravar Definitivamente no Banco */}
      {modalConfirmacao && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4">
          <div
            className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-sus-900/10 pb-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-teal" />
                <h3 className="font-display text-base font-bold text-sus-950">
                  Confirmar Lançamento de Solicitação
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setModalConfirmacao(false)}
                className="rounded-lg p-1 text-ink/50 hover:bg-sand"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-xs text-ink/70">
              Revise atentamente os dados do pedido antes de gravar na fila de regulação:
            </p>

            <div className="rounded-xl border border-sus-900/10 bg-sand/20 p-4 text-xs space-y-2.5">
              <div className="flex justify-between border-b border-sus-900/5 pb-2">
                <span className="text-ink/60 font-medium">Paciente:</span>
                <span className="font-bold text-sus-950 text-right">{pacienteSelecionado?.nome}</span>
              </div>
              {pacienteSelecionado?.cpf && (
                <div className="flex justify-between border-b border-sus-900/5 pb-2">
                  <span className="text-ink/60 font-medium">CPF:</span>
                  <span className="font-mono text-sus-950">{pacienteSelecionado.cpf}</span>
                </div>
              )}
              <div className="flex justify-between border-b border-sus-900/5 pb-2">
                <span className="text-ink/60 font-medium">Data do Pedido:</span>
                <span className="font-semibold text-sus-950">
                  {dataPedido.split("-").reverse().join("/")}
                </span>
              </div>
              <div className="flex justify-between border-b border-sus-900/5 pb-2">
                <span className="text-ink/60 font-medium">Tipo de Serviço:</span>
                <span className="font-semibold text-teal">{tipoServico}</span>
              </div>
              <div className="flex justify-between border-b border-sus-900/5 pb-2">
                <span className="text-ink/60 font-medium">Procedimento(s):</span>
                <span className="font-bold text-sus-950 text-right">
                  {codigoProcedimento ? `${codigoProcedimento} · ` : ""}
                  {procTexto.trim() || procedimentoSel?.exame}
                  {procedimentosAdicionados.length > 0 && ` (+${procedimentosAdicionados.length} agrupados)`}
                </span>
              </div>
              {especialidade && (
                <div className="flex justify-between border-b border-sus-900/5 pb-2">
                  <span className="text-ink/60 font-medium">Especialidade:</span>
                  <span className="font-semibold text-sus-950">{especialidade}</span>
                </div>
              )}
              <div className="flex justify-between border-b border-sus-900/5 pb-2">
                <span className="text-ink/60 font-medium">PSF / Unidade:</span>
                <span className="font-medium text-sus-950 text-right">{unidNomeAtual}</span>
              </div>
              <div className="flex justify-between border-b border-sus-900/5 pb-2">
                <span className="text-ink/60 font-medium">Médico(a):</span>
                <span className="font-medium text-sus-950 text-right">{medNomeAtual}</span>
              </div>
              {podeDefinirPrioridade && (
                <div className="flex justify-between border-b border-sus-900/5 pb-2">
                  <span className="text-ink/60 font-medium">Prioridade:</span>
                  <span className={`rounded px-2 py-0.5 font-bold uppercase text-[10px] ${prioridade === "urgente" ? "bg-red-100 text-red-800" : "bg-teal/15 text-teal"}`}>
                    {prioridade === "urgente" ? "Prioridade Urgente" : "Rotina / Eletivo"}
                  </span>
                </div>
              )}
              {cidCodigo && (
                <div className="flex justify-between border-b border-sus-900/5 pb-2">
                  <span className="text-ink/60 font-medium">Diagnóstico / CID:</span>
                  <span className="font-mono text-sus-950">{cidCodigo} · {cidDescricao}</span>
                </div>
              )}
              <div className="flex flex-col gap-1 border-b border-sus-900/5 pb-2">
                <span className="text-ink/60 font-medium">Justificativa Clínica:</span>
                <p className="font-medium text-sus-950 italic bg-white p-2 rounded-lg border border-sus-900/10">
                  "{justificativa.trim()}"
                </p>
              </div>
              <div className="flex justify-between pt-1">
                <span className="text-ink/60 font-medium">Nº do Pedido:</span>
                <span className="font-mono text-ink/80">
                  {numeroPedido.trim() || "Gerado automaticamente em segundo plano"}
                </span>
              </div>
              {agendamentoDireto && podeAgendarDireto && (
                <div className="flex justify-between pt-1 text-teal font-semibold">
                  <span>Agendamento Direto:</span>
                  <span>{dataAgendada.split("-").reverse().join("/")} às {horaAgendada}</span>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                type="button"
                onClick={() => setModalConfirmacao(false)}
                disabled={salvando}
                className="text-xs"
              >
                Voltar e Corrigir
              </Button>
              <Button
                type="button"
                onClick={confirmarGravacaoDefinitiva}
                disabled={salvando}
                className="bg-teal text-white hover:brightness-110 text-xs font-bold shadow-sm"
              >
                {salvando ? "Gravando no Banco…" : "Confirmar e Gravar Pedido"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {abrirComprovante && criado && (
        <ComprovanteExameModal
          exameId={criado.id}
          numeroPedido={criado.numero_pedido}
          onClose={() => setAbrirComprovante(false)}
        />
      )}
        </>
      )}

      {/* ============================================================== */}
      {/* MODO 2: LANÇAMENTO EM LOTE                                     */}
      {/* ============================================================== */}
      {modo === "lote" && (
        <>
          {/* Banner de Sucesso do Lote pós-criação */}
          {loteProcessado && (
            <Card className="border-2 border-emerald-500 bg-emerald-50/70 p-5 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="h-7 w-7 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-display text-base font-bold text-emerald-950">
                      Lote processado e cadastrado com sucesso!
                    </p>
                    <p className="text-xs text-emerald-800 mt-0.5">
                      Total de solicitações cadastradas:{" "}
                      <strong className="font-mono bg-emerald-200/70 px-2 py-0.5 rounded text-emerald-950">
                        {loteProcessado.total_criados}
                      </strong>
                      {loteProcessado.agendados > 0 && (
                        <span className="text-teal-800 ml-2 font-bold">
                          ({loteProcessado.agendados} agendado(s) direto)
                        </span>
                      )}
                      {loteProcessado.na_fila > 0 && (
                        <span className="text-amber-800 ml-2 font-bold">
                          ({loteProcessado.na_fila} na fila de espera)
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-emerald-700 mt-1">
                      Status das solicitações:{" "}
                      <span className="font-bold uppercase tracking-wider text-[11px] bg-white px-2 py-0.5 rounded border border-emerald-300">
                        {agendamentoDiretoLote && podeAgendarDireto
                          ? `📅 Agendados Direto (${dataAgendadaLote.split("-").reverse().join("/")} às ${horaAgendadaLote})`
                          : "⏳ Inseridos na Fila de Espera"}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    onClick={limparLote}
                    className="bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold"
                  >
                    <Plus className="h-4 w-4" /> Cadastrar Outro Lote
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => navigate("/fila-exames")}
                    className="border-emerald-600 text-emerald-800 hover:bg-emerald-100 text-xs font-semibold"
                  >
                    Ir para Fila de Espera
                  </Button>
                </div>
              </div>

              {/* Tabela de comprovantes e ações do lote processado */}
              {loteProcessado.itens && loteProcessado.itens.length > 0 && (
                <div className="mt-3 overflow-x-auto rounded-xl border border-emerald-200 bg-white">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-emerald-100/60 text-emerald-950 font-bold uppercase tracking-wider text-[10px]">
                      <tr>
                        <th className="py-2.5 px-3">Pedido</th>
                        <th className="py-2.5 px-3">Paciente</th>
                        <th className="py-2.5 px-3">Procedimento</th>
                        <th className="py-2.5 px-3">Status</th>
                        <th className="py-2.5 px-3 text-right">Ações / Comprovante</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-emerald-100">
                      {loteProcessado.itens.map((item) => (
                        <tr key={item.id} className="hover:bg-emerald-50/40">
                          <td className="py-2.5 px-3 font-mono font-bold text-sus-950">
                            {item.codigo_curto || item.numero_pedido || `EX-${item.id}`}
                          </td>
                          <td className="py-2.5 px-3">
                            <p className="font-bold text-sus-950">{item.paciente_nome}</p>
                            {item.paciente_cpf && (
                              <span className="font-mono text-[10px] text-ink/60">{item.paciente_cpf}</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 font-medium text-sus-900">
                            {item.exame}
                          </td>
                          <td className="py-2.5 px-3">
                            <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                              item.status === "agendado" ? "bg-teal/15 text-teal" : "bg-amber-100 text-amber-900"
                            }`}>
                              {item.status === "agendado" ? "Agendado" : "Aguardando"}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <BotaoWhatsApp
                                exameId={item.id}
                                exame={item}
                                tipo={item.status === "agendado" ? "agendamento" : "entrada_fila"}
                                variante="compacto"
                              />
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => setComprovanteLoteModal(item)}
                                className="border-emerald-600 text-emerald-800 hover:bg-emerald-100 text-xs font-semibold h-8 px-2 flex items-center gap-1"
                                title="Ver Comprovante com QR Code"
                              >
                                <Printer className="h-3.5 w-3.5" />
                                <span className="hidden sm:inline">Comprovante</span>
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          {/* Formulário Principal de Lançamento em Lote */}
          <form
            onSubmit={submeterLote}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA") {
                e.preventDefault();
              }
            }}
            className="space-y-6"
          >
            {/* Bloco 1: Procedimento e Unidade de Atendimento (Comum ao Lote) */}
            <Card className="p-5 shadow-xs">
              <div className="flex items-center justify-between border-b border-sus-900/10 pb-3 mb-4">
                <div className="flex items-center gap-2">
                  <Stethoscope className="h-4 w-4 text-teal" />
                  <h2 className="font-display text-sm font-bold text-sus-950">
                    1. Procedimento e Unidade Solicitante (Comum ao Lote)
                  </h2>
                </div>
                <span className="text-[11px] font-semibold text-teal bg-teal/10 px-2.5 py-0.5 rounded-full">
                  Aplicado a todos os pacientes do lote
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                {/* Tipo de Serviço (Dinâmico do Banco, sem filas de sangue) */}
                <div>
                  <div className="min-h-[22px] flex items-center mb-1">
                    <Label className="!mb-0 text-xs font-bold text-sus-950">
                      Tipo de Serviço <span className="text-red-500">*</span>
                    </Label>
                  </div>
                  <Select
                    value={tipoServico}
                    onChange={(e) => aoMudarTipoServico(e.target.value)}
                    className="text-xs font-semibold text-sus-950"
                    required
                  >
                    <option value="">Selecione o Tipo de Serviço…</option>
                    {tiposServicoDisponiveis.map((tf) => (
                      <option key={tf.id} value={tf.nome}>
                        {tf.nome}
                      </option>
                    ))}
                  </Select>
                  <p className="mt-1 text-[11px] text-ink/60">
                    {isConsulta
                      ? "Consulta médica especializada em lote: requer apenas a definição do CBO/especialidade."
                      : "Filtra automaticamente o catálogo de procedimentos correspondentes."}
                  </p>
                  {renderBannerRegrasServico()}
                </div>

                {/* Especialidade Médica / CBO */}
                {renderCampoCboEspecialidade("lote")}
              </div>

              {renderPainelHierarquiaSigtap("lote")}

              {/* Se for Consulta Especializada no Lote: banner padronizado */}
              {isConsulta ? (
                <div className="mt-4 rounded-xl border border-teal/20 bg-teal/5 p-4 flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-teal shrink-0 mt-0.5" />
                  <div className="text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-sm text-sus-950 font-mono">0301010072</span>
                      <span className="font-bold text-sus-950">CONSULTA MEDICA EM ATENCAO ESPECIALIZADA</span>
                      <span className="rounded bg-teal/15 px-2 py-0.5 text-[10px] font-bold text-teal uppercase">
                        Padrão SUS / Vivver
                      </span>
                    </div>
                    <p className="mt-1 text-ink/65 text-[11px]">
                      Consultas médicas especializadas do lote utilizarão o procedimento padronizado <strong>0301010072</strong>. O direcionamento clínico é definido pelo <strong>CBO da especialidade</strong> selecionado acima.
                    </p>
                    {especialidade && (
                      <p className="mt-1.5 font-bold text-teal-900">
                        ✓ Especialidade vinculada ao lote: {especialidade} {codigoEspecialidade ? `(CBO: ${codigoEspecialidade})` : ""}
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                /* Procedimento Correspondente (Exames e Cirurgias no Lote) */
                <div className="mt-4 pt-4 border-t border-sus-900/10">
                  <Label className="text-xs font-bold text-sus-950 flex items-center justify-between">
                    <span>Procedimento Correspondente <span className="text-red-500">*</span></span>
                    {codigoProcedimento && (
                      <span className="text-[10px] text-ink/60 font-mono">
                        Cód. SIGTAP: {codigoProcedimento}
                      </span>
                    )}
                  </Label>

                  <div className="relative mt-1">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink/40 pointer-events-none" />
                      <Input
                        placeholder={
                          tipoServico
                            ? `Buscar procedimento em ${tipoServico} por nome, código SIGTAP ou sigla…`
                            : "Buscar procedimento por código SIGTAP, sigla ou nome…"
                        }
                        value={buscaProc}
                        onChange={(e) => {
                          setBuscaProc(e.target.value);
                          setProcFoco(true);
                        }}
                        onFocus={() => setProcFoco(true)}
                        onBlur={() => setTimeout(() => setProcFoco(false), 250)}
                        className="pl-9 pr-9 text-xs"
                        autoComplete="off"
                      />
                      {(buscaProc || procedimentoSel || procTexto) && (
                        <button
                          type="button"
                          onClick={() => {
                            setBuscaProc("");
                            handleSelecionarProcedimento(null);
                            setProcFoco(false);
                          }}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink/40 hover:text-ink transition"
                          title="Limpar procedimento"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Procedimento Selecionado Badge */}
                    {(procedimentoSel || procTexto) && (
                      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1.5 rounded-xl border border-teal/20 bg-teal/5 px-3 py-2 text-xs">
                        <div className="flex items-center gap-2">
                          <Check className="h-4 w-4 text-teal shrink-0" />
                          <div>
                            <p className="font-bold text-sus-950">
                              {codigoProcedimento ? `${codigoProcedimento} · ` : ""}
                              {procTexto || procedimentoSel?.exame}
                            </p>
                            <p className="text-[11px] text-ink/60">
                              {tipoServico ? `${tipoServico} · ` : ""}
                              {especialidade ? `Especialidade: ${especialidade}` : ""}
                            </p>
                          </div>
                        </div>
                        <span className="text-[10px] font-bold text-teal bg-teal/10 px-2 py-0.5 rounded uppercase">
                          Selecionado para o Lote
                        </span>
                      </div>
                    )}

                    {/* Dropdown de sugestões de procedimentos */}
                    {procFoco && (
                      <div className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-sus-900/15 bg-white shadow-xl">
                        <p className="sticky top-0 border-b border-sus-900/5 bg-sand/80 px-3 py-1.5 text-[11px] font-semibold text-sus-900/60 flex items-center justify-between">
                          <span className={erroCatalogo && opcoesProcFiltradas.length === 0 ? "text-red-700" : ""}>
                            {opcoesProcFiltradas.length > 0
                              ? `${opcoesProcFiltradas.length} procedimento(s) encontrado(s) — clique para selecionar`
                              : buscandoProc
                              ? "Pesquisando no catálogo..."
                              : erroCatalogo
                              ? `Falha ao carregar catálogo: ${erroCatalogo}`
                              : "Nenhum procedimento encontrado"}
                          </span>
                          {buscandoProc && (
                            <span className="text-[10px] text-teal font-bold flex items-center gap-1">
                              <span className="h-1.5 w-1.5 rounded-full bg-teal animate-ping" />
                              Buscando no SIGTAP...
                            </span>
                          )}
                        </p>
                        {erroCatalogo && opcoesProcFiltradas.length > 0 && (
                          <p className="border-b border-amber-200 bg-amber-50 px-3 py-1 text-[11px] text-amber-800">
                            Aviso da consulta ao catálogo: {erroCatalogo}
                          </p>
                        )}
                        <div className="p-1 space-y-0.5">
                          {opcoesProcFiltradas.map((p, idx) => {
                            const nome = p.exame || p.nome_procedimento || "";
                            const cod = p.codigo_curto || p.codigo_procedimento;
                            const esp = p.especialidade || p.nome_especialidade;
                            return (
                              <button
                                key={`${cod || ""}-${nome}-${idx}`}
                                type="button"
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  escolherProcedimento(p);
                                }}
                                className="w-full text-left px-3 py-2 rounded-lg text-xs hover:bg-teal/10 transition flex items-start justify-between gap-2 border-b border-sus-900/5 last:border-0"
                              >
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap font-bold text-sus-950">
                                    {p.codigo_curto && (
                                      <span className="rounded bg-teal/15 px-1.5 py-0.5 text-[9px] font-bold text-teal uppercase shrink-0">
                                        {p.codigo_curto}
                                      </span>
                                    )}
                                    <span className="truncate">{nome}</span>
                                  </div>
                                  <div className="mt-1 text-[10px] text-ink/60 flex items-center gap-1.5 flex-wrap">
                                    {p.codigo_procedimento && (
                                      <span className="inline-flex items-center gap-0.5 rounded bg-emerald-50 px-1 py-0.2 text-[9px] font-semibold text-emerald-800 border border-emerald-200">
                                        ✓ SIGTAP {p.codigo_procedimento}
                                      </span>
                                    )}
                                    {p.instrumento && (
                                      <span className="rounded bg-sky-50 px-1 py-0.2 text-[9px] font-medium text-sky-800 border border-sky-200">
                                        {p.instrumento}
                                      </span>
                                    )}
                                    {p.tipo_fila && <span>Tipo: {p.tipo_fila}</span>}
                                    {esp && <span>· Especialidade: {esp}</span>}
                                  </div>
                                </div>
                                <Plus className="h-3.5 w-3.5 text-teal shrink-0 mt-0.5" />
                              </button>
                            );
                          })}
                        </div>
                        {buscaProc.trim().length >= 2 && (
                          <button
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setProcTexto(buscaProc.trim());
                              setProcedimentoSel(null);
                              setBuscaProc("");
                              setProcFoco(false);
                            }}
                            className="flex w-full items-center gap-2 border-t border-sus-900/10 bg-sand/30 px-3 py-2 text-left text-xs font-semibold text-teal hover:bg-teal/10 transition"
                          >
                            <Plus className="h-3.5 w-3.5" /> Usar texto digitado: “{buscaProc.trim()}”
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Unidade e Médico Responsável */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pt-4 border-t border-sus-900/10">
                <div>
                  <Label className="text-xs font-bold text-sus-950">
                    Unidade Solicitante / PSF <span className="text-red-500">*</span>
                  </Label>
                  <Select
                    value={unidadeId}
                    onChange={(e) => setUnidadeId(e.target.value)}
                    disabled={!isTfdCentral && !!user?.unidade_saude_id}
                    className="mt-1 text-xs"
                    required
                  >
                    <option value="">Selecione a Unidade Solicitante…</option>
                    {unidades.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.nome} {u.cnes ? `(CNES: ${u.cnes})` : ""}
                      </option>
                    ))}
                  </Select>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-bold text-sus-950">
                      Médico(a) Requisitante / Responsável <span className="text-red-500">*</span>
                    </Label>
                    <button
                      type="button"
                      onClick={() => {
                        const mGen = medicos.find((m) =>
                          m.nome.includes("Responsável Técnico") || m.nome.includes("Médico da Unidade"),
                        );
                        if (mGen) setMedicoId(String(mGen.id));
                      }}
                      className="text-[10px] font-bold text-teal hover:underline"
                    >
                      Usar Médico da Unidade
                    </button>
                  </div>
                  <div className="mt-1">
                    <Combobox
                      value={medicoId}
                      onChange={(v) => setMedicoId(v)}
                      options={opcoesMedicos}
                      placeholder="Buscar Médico(a) Requisitante…"
                      searchPlaceholder="Digite o nome do médico ou CRM…"
                      emptyText="Nenhum médico encontrado"
                      showAll={false}
                    />
                  </div>
                  {renderAlertaCboMedico()}
                </div>
              </div>

              {/* Data do Pedido e Prioridade */}
              <div className={`grid grid-cols-1 ${podeDefinirPrioridade ? "md:grid-cols-2" : ""} gap-4 mt-4 pt-4 border-t border-sus-900/10 items-start`}>
                <div>
                  <Label className="text-xs font-bold text-sus-950">
                    Data do Pedido
                  </Label>
                  <Input
                    type="date"
                    value={isTfdCentral ? dataPedido : hojeISO()}
                    min={isTfdCentral && retroativoBloqueado ? hojeISO() : undefined}
                    onChange={(e) => setDataPedido(e.target.value)}
                    disabled={!isTfdCentral}
                    max={hojeISO()}
                    className="mt-1 text-xs"
                  />
                  <p className="mt-1 text-[11px] text-ink/60">
                    {!isTfdCentral
                      ? "Fixada na data de hoje para unidades solicitantes."
                      : podeDataRetroativa
                      ? "Lançamentos retroativos liberados para este perfil."
                      : "Perfil sem permissão para datas retroativas."}
                  </p>
                </div>

                {podeDefinirPrioridade && (
                  <div>
                    <Label className="text-xs font-bold text-sus-950">
                      Classificação de Prioridade
                    </Label>
                    <Select
                      value={prioridade}
                      onChange={(e) => setPrioridade(e.target.value as "rotina" | "urgente")}
                      className="mt-1 text-xs font-semibold"
                    >
                      <option value="rotina">Rotina / Eletivo (Padrão)</option>
                      <option value="urgente">Urgência / Prioritário</option>
                    </Select>
                    <p className="mt-1 text-[11px] text-ink/60">
                      Define a ordenação na fila de regulação para o lote.
                    </p>
                  </div>
                )}
              </div>
            </Card>

            {/* Bloco 2: Justificativa Clínica e Diagnóstico (Padrão do Lote) */}
            <Card className="p-5 shadow-xs">
              <div className="flex items-center justify-between border-b border-sus-900/10 pb-3 mb-4">
                <div className="flex items-center gap-2">
                  <ClipboardList className="h-4 w-4 text-teal" />
                  <h2 className="font-display text-sm font-bold text-sus-950">
                    2. Justificativa Clínica e CID Padrão do Lote
                  </h2>
                </div>
                <span className="text-[11px] font-semibold text-ink/60 bg-sand/80 px-2.5 py-0.5 rounded-full">
                  Pode ser ajustado por paciente na tabela
                </span>
              </div>

              <div className="rounded-xl border border-teal/20 bg-teal/5 p-3 text-xs text-teal-900 mb-4 flex items-start gap-2.5">
                <Sparkles className="h-4 w-4 text-teal shrink-0 mt-0.5" />
                <p>
                  A justificativa e o CID configurados aqui serão herdados automaticamente por todos os pacientes adicionados no lote. Caso algum paciente possua particularidade clínica, você poderá sobrescrever na tabela abaixo.
                </p>
              </div>

              <div className="space-y-4">
                {/* Justificativa Padrão */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label className="text-xs font-bold text-sus-950">
                      Justificativa Clínica Padrão <span className="text-red-500">*</span>
                    </Label>
                    <span
                      className={`text-[11px] font-bold ${
                        justificativaLotePadrao.trim().length >= JUST_MIN
                          ? "text-emerald-700"
                          : "text-amber-700"
                      }`}
                    >
                      {justificativaLotePadrao.trim().length}/{JUST_MIN} caracteres mínimos
                    </span>
                  </div>
                  <textarea
                    value={justificativaLotePadrao}
                    onChange={(e) => setJustificativaLotePadrao(e.target.value)}
                    placeholder="Descreva a indicação clínica compartilhada deste grupo de pacientes (mínimo 12 caracteres)…"
                    rows={3}
                    className="w-full rounded-xl border border-sus-900/20 bg-white p-3 text-xs focus:border-teal focus:ring-1 focus:ring-teal outline-none"
                    required={pacientesLote.some((p) => !(p.justificativa && p.justificativa.trim().length >= JUST_MIN))}
                  />
                </div>

                {/* CID Padrão e Observações */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Busca CID */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <Label className="text-xs font-bold text-sus-950">
                        Diagnóstico / CID-10 Padrão (Opcional)
                      </Label>
                      {cidCodigoLotePadrao && (
                        <button
                          type="button"
                          onClick={() => {
                            setCidCodigoLotePadrao("");
                            setCidDescricaoLotePadrao("");
                            setBuscaCidLote("");
                          }}
                          className="text-[10px] text-red-600 hover:underline font-semibold"
                        >
                          Limpar CID
                        </button>
                      )}
                    </div>
                    <div className="relative">
                      <Input
                        placeholder="Buscar por código CID ou patologia (ex: I10, diabetes)…"
                        value={buscaCidLote}
                        onChange={(e) => setBuscaCidLote(e.target.value)}
                        className="text-xs"
                      />
                      {buscandoCidLote && (
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-ink/40">
                          Buscando…
                        </span>
                      )}
                      {cidsSugeridosLote.length > 0 && (
                        <div className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-xl border border-sus-900/15 bg-white shadow-lg p-1">
                          {cidsSugeridosLote.map((c) => (
                            <button
                              key={c.codigo}
                              type="button"
                              onClick={() => {
                                setCidCodigoLotePadrao(c.codigo);
                                setCidDescricaoLotePadrao(c.descricao);
                                setBuscaCidLote(`${c.codigo} · ${c.descricao}`);
                                setCidsSugeridosLote([]);
                              }}
                              className="w-full text-left px-2.5 py-1.5 text-xs hover:bg-teal/10 rounded flex justify-between gap-2"
                            >
                              <span className="font-bold font-mono text-teal">{c.codigo}</span>
                              <span className="truncate text-ink/80 flex-1">{c.descricao}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {cidCodigoLotePadrao && (
                      <p className="mt-1 text-[11px] text-emerald-800 font-medium">
                        CID selecionado: <strong>{cidCodigoLotePadrao}</strong> — {cidDescricaoLotePadrao}
                      </p>
                    )}
                  </div>

                  {/* Observações Gerais */}
                  <div>
                    <Label className="text-xs font-bold text-sus-950">
                      Observações / Preparo Geral (Opcional)
                    </Label>
                    <Input
                      placeholder="Ex: Jejum obrigatório de 8h, trazer exames anteriores..."
                      value={observacoesLotePadrao}
                      onChange={(e) => setObservacoesLotePadrao(e.target.value)}
                      className="mt-1 text-xs"
                    />
                  </div>
                </div>
              </div>
            </Card>

            {/* Bloco 3: Opção de Agendamento Direto em Lote (Requer RBAC tfd_agenda:criar) */}
            {podeAgendarDireto && (
              <Card className="p-5 shadow-xs border-l-4 border-l-teal">
                <div className="flex items-center justify-between border-b border-sus-900/10 pb-3 mb-4">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-teal" />
                    <h2 className="font-display text-sm font-bold text-sus-950">
                      3. Agendamento Direto em Lote
                    </h2>
                  </div>
                  <span className="text-[11px] font-semibold text-teal bg-teal/10 px-2.5 py-0.5 rounded-full">
                    Permissão Agenda TFD
                  </span>
                </div>

                <div className="space-y-4">
                  <div className="rounded-xl border border-sus-900/10 bg-sand/30 p-4">
                    <label className="flex items-start gap-3 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={agendamentoDiretoLote}
                        onChange={(e) => setAgendamentoDiretoLote(e.target.checked)}
                        className="mt-1 h-4 w-4 rounded border-sus-900/20 text-teal focus:ring-teal cursor-pointer"
                      />
                      <div>
                        <span className="text-xs font-bold text-sus-950">
                          Adicionar à fila e agendar imediatamente
                        </span>
                        <p className="text-[11px] text-ink/70 mt-0.5">
                          Ao marcar esta opção, todos os pacientes adicionados no lote serão processados e gravados com status <strong>"Agendado"</strong> diretamente para a data e hora selecionadas abaixo, permitindo emissão imediata dos comprovantes e envio de notificações.
                        </p>
                      </div>
                    </label>
                  </div>

                  {agendamentoDiretoLote && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-xl border border-teal/20 bg-teal/5 p-4 animate-fadeIn">
                      <div>
                        <Label className="text-xs font-bold text-teal-950">
                          Data do Agendamento <span className="text-red-500">*</span>
                        </Label>
                        <Input
                          type="date"
                          value={dataAgendadaLote}
                          onChange={(e) => setDataAgendadaLote(e.target.value)}
                          min={hojeISO()}
                          className="mt-1 text-xs"
                          required={agendamentoDiretoLote}
                        />
                      </div>
                      <div>
                        <Label className="text-xs font-bold text-teal-950">
                          Horário Previsto
                        </Label>
                        <Input
                          type="time"
                          value={horaAgendadaLote}
                          onChange={(e) => setHoraAgendadaLote(e.target.value)}
                          className="mt-1 text-xs"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            )}

            {/* Bloco 4: Pacientes do Lote (Lista Dinâmica) */}
            <Card className="p-5 shadow-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-sus-900/10 pb-3 mb-4">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-teal" />
                  <h2 className="font-display text-sm font-bold text-sus-950">
                    {podeAgendarDireto ? "4" : "3"}. Pacientes do Lote ({pacientesLote.length} adicionado{pacientesLote.length === 1 ? "" : "s"})
                  </h2>
                </div>
                <span className="text-[11px] font-bold text-teal bg-teal/10 px-2.5 py-0.5 rounded-full self-start sm:self-auto">
                  {pacientesLote.length === 0
                    ? "Aguardando pacientes"
                    : `${pacientesLote.length} paciente(s) pronto(s) para gravação`}
                </span>
              </div>

              {/* Barra de Pesquisa Rápida para Adicionar Paciente */}
              <div className="rounded-xl border border-sus-900/15 bg-sand/20 p-4 mb-4">
                <BuscaPacienteAutocomplete
                  pacienteId={pacienteLoteBusca?.id || ""}
                  pacienteInicial={pacienteLoteBusca}
                  onSelect={(pac) => {
                    if (pac) {
                      adicionarPacienteAoLote(pac);
                    }
                  }}
                  label="Adicionar Paciente ao Lote"
                  placeholder="Buscar paciente por nome, CPF, CNS, prontuário ou nascimento (DD/MM/AAAA)…"
                />
                <p className="mt-2 text-[11px] text-ink/60">
                  Dica: basta pesquisar e clicar no paciente para inseri-lo instantaneamente na lista abaixo. Você pode adicionar quantos pacientes precisar.
                </p>
              </div>

              {/* Estado Vazio ou Tabela de Pacientes */}
              {pacientesLote.length === 0 ? (
                <div className="rounded-xl border-2 border-dashed border-sus-900/15 p-8 text-center bg-sand/10">
                  <Users className="mx-auto h-8 w-8 text-ink/30 mb-2" />
                  <p className="text-xs font-bold text-sus-950">
                    Nenhum paciente adicionado ao lote até o momento.
                  </p>
                  <p className="text-[11px] text-ink/60 mt-1 max-w-md mx-auto">
                    Utilize o campo de busca acima para pesquisar os pacientes por nome, CPF ou cartão SUS e adicioná-los à lista deste lote.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {pacientesLote.some((p) => p.duplicadoInfo) && (
                    <div className="rounded-xl border border-amber-400 bg-amber-50/90 p-3 text-xs text-amber-900 flex items-start gap-2.5 shadow-xs">
                      <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold">Atenção: Paciente(s) com pedido idêntico ativo detectado(s)!</p>
                        <p className="mt-0.5 text-ink/75 leading-relaxed">
                          Identificamos que um ou mais pacientes desta lista já possuem solicitações ativas pendentes para este mesmo procedimento ou especialidade. Verifique as linhas destacadas na tabela abaixo antes de confirmar a inclusão em lote.
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="overflow-x-auto rounded-xl border border-sus-900/10 bg-white">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-sand/40 text-sus-950 font-bold uppercase tracking-wider text-[10px] border-b border-sus-900/10">
                        <tr>
                          <th className="py-2.5 px-3 w-10 text-center">#</th>
                          <th className="py-2.5 px-3 min-w-[200px]">Paciente</th>
                          <th className="py-2.5 px-3 min-w-[220px]">
                            Justificativa Específica
                            <span className="block text-[9px] font-normal lowercase text-ink/50">
                              deixe em branco p/ usar a padrão
                            </span>
                          </th>
                          <th className="py-2.5 px-3 min-w-[130px]">
                            CID Específico
                            <span className="block text-[9px] font-normal lowercase text-ink/50">
                              opcional
                            </span>
                          </th>
                          <th className="py-2.5 px-3 min-w-[150px]">Observações</th>
                          <th className="py-2.5 px-3 w-12 text-center">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-sus-900/5">
                        {pacientesLote.map((item, idx) => {
                          const justEfetiva = (item.justificativa || "").trim() || justificativaLotePadrao.trim();
                          const justValida = justEfetiva.length >= JUST_MIN;

                          return (
                            <tr key={item.uid} className={`hover:bg-sand/10 ${item.duplicadoInfo ? "bg-amber-50/40" : ""}`}>
                              <td className="py-2.5 px-3 text-center font-bold text-ink/60">
                                {idx + 1}
                              </td>
                              <td className="py-2.5 px-3">
                                <p className="font-bold text-sus-950">{item.paciente.nome}</p>
                                <div className="text-[10px] text-ink/60 space-x-2 font-mono mt-0.5">
                                  {item.paciente.cpf && <span>CPF: {item.paciente.cpf}</span>}
                                  {item.paciente.cns && <span>CNS: {item.paciente.cns}</span>}
                                  {item.paciente.codigo_prontuario && (
                                    <span>Pront: {item.paciente.codigo_prontuario}</span>
                                  )}
                                </div>
                                {(() => {
                                  const pacExt = item.paciente as PacienteComUnidade;
                                  const endRes = formatarEnderecoCompleto(item.paciente);
                                  if (!pacExt.unidade_nome && !endRes) return null;
                                  return (
                                    <div className="mt-0.5 text-[10px] text-ink/65 space-y-0.5">
                                      {pacExt.unidade_nome && (
                                        <p className="text-teal-900 font-medium">{pacExt.unidade_nome}</p>
                                      )}
                                      {endRes && <p className="truncate max-w-[260px]">{endRes}</p>}
                                    </div>
                                  );
                                })()}
                                {item.duplicadoInfo && (
                                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-md bg-amber-500/10 border border-amber-500/30 px-2 py-1 text-[11px] text-amber-900">
                                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                                    <span className="font-semibold">Pedido ativo existente:</span>
                                    <span className="font-mono font-medium">{item.duplicadoInfo.codigo_curto || `#${item.duplicadoInfo.id}`}</span>
                                    <span className="text-[10px] uppercase font-bold bg-amber-200/60 px-1 py-0.5 rounded">
                                      {item.duplicadoInfo.status}
                                    </span>
                                    {item.duplicadoInfo.link_visualizacao && (
                                      <button
                                        type="button"
                                        onClick={() => window.open(item.duplicadoInfo!.link_visualizacao, "_blank", "noopener,noreferrer")}
                                        className="ml-auto underline hover:text-amber-950 font-medium text-[10px]"
                                      >
                                        Visualizar Pedido
                                      </button>
                                    )}
                                  </div>
                                )}
                              </td>
                              <td className="py-2.5 px-3">
                                <div className="space-y-1">
                                  <textarea
                                    value={item.justificativa || ""}
                                    onChange={(e) =>
                                      atualizarItemLote(item.uid, "justificativa", e.target.value)
                                    }
                                    placeholder={
                                      justificativaLotePadrao.trim()
                                        ? `Herdar padrão: "${justificativaLotePadrao.slice(0, 30)}…"`
                                        : "Justificativa específica (min 12 chars)…"
                                    }
                                    rows={2}
                                    className={`w-full rounded-lg border p-1.5 text-xs outline-none transition ${
                                      justValida
                                        ? "border-sus-900/15 focus:border-teal"
                                        : "border-red-300 bg-red-50/30 focus:border-red-500"
                                    }`}
                                  />
                                  <div className="flex items-center justify-between text-[10px]">
                                    {item.justificativa?.trim() ? (
                                      <span className={item.justificativa.trim().length >= JUST_MIN ? "text-emerald-700 font-semibold" : "text-amber-700 font-semibold"}>
                                        Específica: {item.justificativa.trim().length}/{JUST_MIN}
                                      </span>
                                    ) : (
                                      <span className={justValida ? "text-teal font-medium" : "text-amber-600 font-medium"}>
                                        {justificativaLotePadrao.trim() ? "✓ Usando justificativa padrão" : "⚠ Requer justificativa"}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className="py-2.5 px-3">
                                <Input
                                  value={item.cid_codigo || ""}
                                  onChange={(e) =>
                                    atualizarItemLote(item.uid, "cid_codigo", e.target.value.toUpperCase())
                                  }
                                  placeholder={
                                    cidCodigoLotePadrao
                                      ? `Padrão: ${cidCodigoLotePadrao}`
                                      : "CID (ex: I10)"
                                  }
                                  className="text-xs uppercase h-8"
                                />
                              </td>
                              <td className="py-2.5 px-3">
                                <Input
                                  value={item.observacoes || ""}
                                  onChange={(e) =>
                                    atualizarItemLote(item.uid, "observacoes", e.target.value)
                                  }
                                  placeholder="Obs específica..."
                                  className="text-xs h-8"
                                />
                              </td>
                              <td className="py-2.5 px-3 text-center">
                                <button
                                  type="button"
                                  onClick={() => removerPacienteDoLote(item.uid)}
                                  className="rounded-lg p-1.5 text-red-500 hover:bg-red-50 hover:text-red-700 transition"
                                  title={`Remover ${item.paciente.nome} do lote`}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex items-center justify-between text-xs text-ink/70 px-1 pt-1">
                    <span>
                      Total no lote: <strong>{pacientesLote.length} paciente(s)</strong>
                    </span>
                    <button
                      type="button"
                      onClick={() => setPacientesLote([])}
                      className="text-[11px] text-red-600 hover:underline font-semibold"
                    >
                      Remover todos os pacientes
                    </button>
                  </div>
                </div>
              )}
            </Card>

            {/* Barra de Ações Inferior do Lote */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={limparLote}
                disabled={salvandoLote}
                className="text-xs font-semibold"
              >
                <RotateCcw className="h-4 w-4" /> Limpar Formulário
              </Button>

              <div className="flex items-center gap-2">
                <Button
                  type="submit"
                  disabled={salvandoLote || pacientesLote.length === 0}
                  className="bg-teal text-white hover:brightness-110 shadow-sm text-xs font-bold px-6 py-2.5"
                >
                  {salvandoLote ? (
                    "Processando Lote…"
                  ) : agendamentoDiretoLote && podeAgendarDireto ? (
                    <>
                      <Calendar className="h-4 w-4" /> Confirmar e Agendar Lote ({pacientesLote.length})
                    </>
                  ) : (
                    <>
                      <Layers className="h-4 w-4" /> Incluir Lote na Fila ({pacientesLote.length})
                    </>
                  )}
                </Button>
              </div>
            </div>
          </form>

          {/* Modal de Confirmação do Lote */}
          {modalConfirmacaoLote && (
            <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4">
              <div
                className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start justify-between border-b border-sus-900/10 pb-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-teal" />
                    <h3 className="font-display text-base font-bold text-sus-950">
                      Confirmar Lançamento em Lote
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setModalConfirmacaoLote(false)}
                    className="rounded-lg p-1 text-ink/50 hover:bg-sand"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <p className="text-xs text-ink/70">
                  Revise atentamente os dados do lote antes de confirmar a inclusão no banco de dados:
                </p>

                <div className="rounded-xl border border-sus-900/10 bg-sand/20 p-4 text-xs space-y-2.5">
                  <div className="flex justify-between border-b border-sus-900/5 pb-2">
                    <span className="text-ink/60 font-medium">Tipo de Serviço:</span>
                    <span className="font-semibold text-teal">{tipoServico}</span>
                  </div>
                  <div className="flex justify-between border-b border-sus-900/5 pb-2">
                    <span className="text-ink/60 font-medium">Procedimento:</span>
                    <span className="font-bold text-sus-950 text-right">
                      {codigoProcedimento ? `${codigoProcedimento} · ` : ""}
                      {procTexto.trim() || procedimentoSel?.exame}
                    </span>
                  </div>
                  {especialidade && (
                    <div className="flex justify-between border-b border-sus-900/5 pb-2">
                      <span className="text-ink/60 font-medium">Especialidade:</span>
                      <span className="font-semibold text-sus-950">{especialidade}</span>
                    </div>
                  )}
                  <div className="flex justify-between border-b border-sus-900/5 pb-2">
                    <span className="text-ink/60 font-medium">PSF / Unidade:</span>
                    <span className="font-medium text-sus-950 text-right">{unidNomeAtual}</span>
                  </div>
                  <div className="flex justify-between border-b border-sus-900/5 pb-2">
                    <span className="text-ink/60 font-medium">Médico(a) Responsável:</span>
                    <span className="font-medium text-sus-950 text-right">{medNomeAtual}</span>
                  </div>
                  <div className="flex justify-between border-b border-sus-900/5 pb-2">
                    <span className="text-ink/60 font-medium">Ação / Destino:</span>
                    <span className="font-bold text-teal">
                      {agendamentoDiretoLote && podeAgendarDireto
                        ? `📅 Agendamento Direto para ${dataAgendadaLote.split("-").reverse().join("/")} às ${horaAgendadaLote}`
                        : "⏳ Inclusão na Fila de Espera"}
                    </span>
                  </div>
                  <div className="flex justify-between pt-1">
                    <span className="text-ink/60 font-medium">Total de Pacientes:</span>
                    <span className="font-bold text-sus-950 text-base">{pacientesLote.length}</span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="text-xs font-bold text-sus-950">
                    Relação de Pacientes ({pacientesLote.length}):
                  </span>
                  <div className="max-h-40 overflow-y-auto rounded-xl border border-sus-900/10 bg-white p-2 divide-y divide-sus-900/5 text-xs">
                    {pacientesLote.map((item, i) => (
                      <div key={item.uid} className="py-1.5 flex items-center justify-between gap-2">
                        <div>
                          <span className="font-bold text-sus-950">
                            {i + 1}. {item.paciente.nome}
                          </span>
                          {item.paciente.cpf && (
                            <span className="ml-2 font-mono text-[10px] text-ink/60">
                              CPF: {item.paciente.cpf}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-emerald-800 font-medium">
                          {item.justificativa?.trim() ? "Justificativa individual" : "Justificativa padrão"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    variant="outline"
                    type="button"
                    onClick={() => setModalConfirmacaoLote(false)}
                    disabled={salvandoLote}
                    className="text-xs"
                  >
                    Voltar e Corrigir
                  </Button>
                  <Button
                    type="button"
                    onClick={confirmarGravacaoLote}
                    disabled={salvandoLote}
                    className="bg-teal text-white hover:brightness-110 text-xs font-bold shadow-sm"
                  >
                    {salvandoLote ? "Gravando no Banco…" : "Confirmar e Gravar Lote"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Modal de Comprovante Individual do Lote */}
          {comprovanteLoteModal && (
            <ComprovanteExameModal
              exameId={comprovanteLoteModal.id}
              numeroPedido={comprovanteLoteModal.numero_pedido}
              onClose={() => setComprovanteLoteModal(null)}
            />
          )}
        </>
      )}
    </div>
  );
}
