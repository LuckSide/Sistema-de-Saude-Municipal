import { useEffect, useState, useMemo } from "react";
import {
  FileCheck,
  Plus,
  Search,
  Printer,
  Copy,
  Trash2,
  FileText,
  AlertCircle,
  CheckCircle2,
  Clock,
  Filter,
  User,
  Hospital,
  Stethoscope,
  Paperclip,
  X,
  RefreshCw,
} from "lucide-react";
import {
  fetchApacSolicitacoes,
  criarApacSolicitacao,
  atualizarApacSolicitacao,
  duplicarApacContinuidade,
  cancelarApacSolicitacao,
  uploadAnexoApac,
  fetchSigtapApac,
  fetchCidsApac,
  fetchMedicos,
  fetchUnidadesSaude,
  tfdPacientes,
  pagData,
  pagMeta,
  type SolicitacaoApac,
  type ProcedimentoSecundarioApac,
  type ItemSigtapApac,
  type CidItem,
  type Medico,
  type UnidadeSaude,
  type Paciente,
} from "../../services/api";
import { Button, Card, Input, Label, Badge } from "../../components/ui/primitives";
import Paginacao from "../../components/Paginacao";
import ExportarExcel from "../../components/ExportarExcel";
import LaudoApacPrint from "./LaudoApacPrint";

export default function ApacSolicitacao() {

  // Estados da Listagem
  const [solicitacoes, setSolicitacoes] = useState<SolicitacaoApac[]>([]);
  const [loading, setLoading] = useState(false);
  const [termoBusca, setTermoBusca] = useState("");
  const [statusFiltro, setStatusFiltro] = useState("TODOS");
  const [tipoFiltro, setTipoFiltro] = useState("TODOS");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [mensagemSucesso, setMensagemSucesso] = useState("");
  const [mensagemErro, setMensagemErro] = useState("");

  // Modais
  const [modalNovoAberto, setModalNovoAberto] = useState(false);
  const [modalContinuidadeAberto, setModalContinuidadeAberto] = useState(false);
  const [solicitacaoParaImprimir, setSolicitacaoParaImprimir] = useState<SolicitacaoApac | null>(null);
  const [solicitacaoAlvoContinuidade, setSolicitacaoAlvoContinuidade] = useState<SolicitacaoApac | null>(null);

  // Auxiliares de cadastros
  const [medicos, setMedicos] = useState<Medico[]>([]);
  const [unidades, setUnidades] = useState<UnidadeSaude[]>([]);
  const [listaSigtap, setListaSigtap] = useState<ItemSigtapApac[]>([]);
  const [listaCids, setListaCids] = useState<CidItem[]>([]);

  // Estados do Formulário de Solicitação
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erroModal, setErroModal] = useState("");

  // Autocomplete do Paciente
  const [buscaPaciente, setBuscaPaciente] = useState("");
  const [pacientesSugestoes, setPacientesSugestoes] = useState<Paciente[]>([]);
  const [buscandoPacientes, setBuscandoPacientes] = useState(false);

  // Campos do formulário
  const [pacienteId, setPacienteId] = useState<number>(0);
  const [pacienteNome, setPacienteNome] = useState("");
  const [pacienteCpf, setPacienteCpf] = useState("");
  const [pacienteCns, setPacienteCns] = useState("");
  const [pacienteNasc, setPacienteNasc] = useState("");
  const [pacienteSexo, setPacienteSexo] = useState("F");
  const [pacienteNomeMae, setPacienteNomeMae] = useState("");
  const [pacienteEndereco, setPacienteEndereco] = useState("");
  const [pacienteBairro, setPacienteBairro] = useState("");
  const [pacienteMunicipio, setPacienteMunicipio] = useState("Guapé");
  const [pacienteCep, setPacienteCep] = useState("37177-000");
  const [pacienteTelefone, setPacienteTelefone] = useState("");

  const [medicoSolicitanteId, setMedicoSolicitanteId] = useState<number | "">("");
  const [unidadeSolicitanteId, setUnidadeSolicitanteId] = useState<number | "">("");
  const [unidadeExecutanteId, setUnidadeExecutanteId] = useState<number | "">("");

  // Procedimento Principal
  const [sigtapSelecionado, setSigtapSelecionado] = useState<ItemSigtapApac | null>(null);
  const [qtdMes1, setQtdMes1] = useState<number>(1);
  const [qtdMes2, setQtdMes2] = useState<number>(1);
  const [qtdMes3, setQtdMes3] = useState<number>(1);

  // Procedimentos Secundários
  const [procedimentosSecundarios, setProcedimentosSecundarios] = useState<ProcedimentoSecundarioApac[]>([]);
  const [filtroSecundario, setFiltroSecundario] = useState("");

  // Dados Clínicos
  const [cidPrincipal, setCidPrincipal] = useState<CidItem | null>(null);
  const [cidSecundario, setCidSecundario] = useState<CidItem | null>(null);
  const [estadiamento, setEstadiamento] = useState("");
  const [anamnese, setAnamnese] = useState("");
  const [justificativa, setJustificativa] = useState("");

  // Upload de anexos
  const [arquivosParaUpload, setArquivosParaUpload] = useState<File[]>([]);
  const [tipoAnexo, setTipoAnexo] = useState("laudo_biopsia");

  // Continuidade
  const [justificativaContinuidade, setJustificativaContinuidade] = useState("");
  const [salvandoContinuidade, setSalvandoContinuidade] = useState(false);

  // Carregar dados iniciais
  const carregarSolicitacoes = async (p = 1) => {
    setLoading(true);
    try {
      const res = await fetchApacSolicitacoes({
        page: p,
        limit: 20,
        q: termoBusca.trim() || undefined,
        status: statusFiltro !== "TODOS" ? statusFiltro : undefined,
        tipo: tipoFiltro !== "TODOS" ? tipoFiltro : undefined,
      });
      const dados = pagData<SolicitacaoApac>(res);
      setSolicitacoes(dados);
      const meta = pagMeta(res);
      setTotal(meta.total);
      setPage(meta.page);
      setPages(meta.pages);
    } catch {
      setMensagemErro("Erro ao carregar a lista de solicitações.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarSolicitacoes(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFiltro, tipoFiltro]);

  // Carrega opções de médicos, unidades, SIGTAP e CIDs
  useEffect(() => {
    fetchMedicos({ somente_ativos: true })
      .then((m) => setMedicos(m))
      .catch(() => {});
    fetchUnidadesSaude({ somente_ativas: true })
      .then((u) => setUnidades(u))
      .catch(() => {});
    fetchSigtapApac()
      .then((s) => setListaSigtap(s))
      .catch(() => {});
    fetchCidsApac()
      .then((c) => setListaCids(c))
      .catch(() => {});
  }, []);

  // Busca debounce de pacientes
  useEffect(() => {
    if (buscaPaciente.trim().length < 3) {
      setPacientesSugestoes([]);
      return;
    }
    const timer = setTimeout(async () => {
      setBuscandoPacientes(true);
      try {
        const res = await tfdPacientes(buscaPaciente.trim(), 1, 8);
        const lista = pagData<Paciente>(res);
        setPacientesSugestoes(lista);
      } catch {
        setPacientesSugestoes([]);
      } finally {
        setBuscandoPacientes(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [buscaPaciente]);

  // Selecionar paciente e auto-preencher
  const selecionarPaciente = (pac: Paciente) => {
    setPacienteId(pac.id);
    setPacienteNome(pac.nome);
    setPacienteCpf(pac.cpf || "");
    setPacienteCns(pac.cns || "");
    setPacienteNasc(pac.nascimento || "");
    setPacienteEndereco(`${pac.endereco || ""} ${pac.endereco_numero ? "nº " + pac.endereco_numero : ""}`);
    setPacienteBairro(pac.bairro || "");
    setPacienteCep(pac.cep || "37177-000");
    setPacienteTelefone(pac.telefone || "");
    setBuscaPaciente("");
    setPacientesSugestoes([]);
  };

  // Cálculo da quantidade total e valor estimado
  const qtdTotalCalculada = useMemo(() => {
    return Number(qtdMes1 || 0) + Number(qtdMes2 || 0) + Number(qtdMes3 || 0);
  }, [qtdMes1, qtdMes2, qtdMes3]);

  const valorEstimado = useMemo(() => {
    if (!sigtapSelecionado) return 0;
    const valorUnitario = sigtapSelecionado.valor_total || 0;
    const totalPrincipal = valorUnitario * qtdTotalCalculada;
    const totalSecundarios = procedimentosSecundarios.reduce((acc, sec) => {
      return acc + (sec.valor_unitario || 0) * (sec.quantidade || 0);
    }, 0);
    return totalPrincipal + totalSecundarios;
  }, [sigtapSelecionado, qtdTotalCalculada, procedimentosSecundarios]);

  // Adicionar procedimento secundário
  const adicionarSecundario = (proc: ItemSigtapApac) => {
    if (procedimentosSecundarios.some((p) => p.codigo_procedimento === proc.codigo)) return;
    setProcedimentosSecundarios([
      ...procedimentosSecundarios,
      {
        sigtap_id: proc.id,
        codigo_procedimento: proc.codigo,
        nome_procedimento: proc.descricao,
        quantidade: 1,
        valor_unitario: proc.valor_total || 0,
        justificativa: "",
      },
    ]);
    setFiltroSecundario("");
  };

  const removerSecundario = (codigo: string) => {
    setProcedimentosSecundarios(procedimentosSecundarios.filter((p) => p.codigo_procedimento !== codigo));
  };

  const atualizarQtdSecundario = (codigo: string, qtd: number) => {
    setProcedimentosSecundarios(
      procedimentosSecundarios.map((p) => (p.codigo_procedimento === codigo ? { ...p, quantidade: Math.max(1, qtd) } : p))
    );
  };

  // Reset do formulário
  const limparFormulario = () => {
    setEditandoId(null);
    setPacienteId(0);
    setPacienteNome("");
    setPacienteCpf("");
    setPacienteCns("");
    setPacienteNasc("");
    setPacienteSexo("F");
    setPacienteNomeMae("");
    setPacienteEndereco("");
    setPacienteBairro("");
    setPacienteMunicipio("Guapé");
    setPacienteCep("37177-000");
    setPacienteTelefone("");
    setMedicoSolicitanteId(medicos[0]?.id || "");
    setUnidadeSolicitanteId(unidades[0]?.id || "");
    setUnidadeExecutanteId("");
    setSigtapSelecionado(null);
    setQtdMes1(1);
    setQtdMes2(1);
    setQtdMes3(1);
    setProcedimentosSecundarios([]);
    setCidPrincipal(null);
    setCidSecundario(null);
    setEstadiamento("");
    setAnamnese("");
    setJustificativa("");
    setArquivosParaUpload([]);
    setErroModal("");
  };

  // Abrir Modal de Nova Solicitação
  const abrirNovaSolicitacao = () => {
    limparFormulario();
    if (medicos.length > 0 && !medicoSolicitanteId) {
      setMedicoSolicitanteId(medicos[0].id);
    }
    if (unidades.length > 0 && !unidadeSolicitanteId) {
      setUnidadeSolicitanteId(unidades[0].id);
    }
    setModalNovoAberto(true);
  };

  // Salvar Solicitação (Criar ou Atualizar)
  const salvarSolicitacao = async () => {
    setErroModal("");
    if (!pacienteId && !pacienteNome.trim()) {
      setErroModal("Selecione ou identifique o paciente.");
      return;
    }
    if (!medicoSolicitanteId) {
      setErroModal("Selecione o médico solicitante.");
      return;
    }
    if (!sigtapSelecionado) {
      setErroModal("Selecione o procedimento principal SIGTAP.");
      return;
    }
    if (!cidPrincipal) {
      setErroModal("Informe o CID-10 Principal do diagnóstico.");
      return;
    }
    if (justificativa.trim().length < 12) {
      setErroModal("A justificativa clínica deve conter no mínimo 12 caracteres (exigência SUS).");
      return;
    }

    setSalvando(true);
    try {
      const medicoSol = medicos.find((m) => m.id === medicoSolicitanteId);
      const uniSol = unidades.find((u) => u.id === unidadeSolicitanteId);
      const uniExec = unidades.find((u) => u.id === unidadeExecutanteId);

      const payload = {
        tipo_solicitacao: "inicial",
        paciente_id: pacienteId || 1,
        paciente_nome: pacienteNome,
        paciente_cpf: pacienteCpf,
        paciente_cns: pacienteCns,
        paciente_data_nascimento: pacienteNasc || undefined,
        paciente_sexo: pacienteSexo,
        paciente_nome_mae: pacienteNomeMae,
        paciente_telefone: pacienteTelefone,
        paciente_endereco: pacienteEndereco,
        paciente_bairro: pacienteBairro,
        paciente_municipio: pacienteMunicipio,
        paciente_cep: pacienteCep,

        medico_solicitante_id: medicoSolicitanteId,
        medico_solicitante_nome: medicoSol?.nome,
        medico_solicitante_crm: medicoSol?.crm,
        medico_solicitante_cbo: medicoSol?.cbo_codigo,
        medico_solicitante_cns: "700000000000000",

        unidade_solicitante_id: unidadeSolicitanteId || undefined,
        unidade_solicitante_nome: uniSol?.nome || "Unidade Solicitante",
        unidade_solicitante_cnes: uniSol?.cnes || "2156828",

        unidade_executante_id: unidadeExecutanteId || undefined,
        unidade_executante_nome: uniExec?.nome || "Unidade Executante Regulada",
        unidade_executante_cnes: uniExec?.cnes || "312610",

        procedimento_principal_id: sigtapSelecionado.id,
        codigo_procedimento_principal: sigtapSelecionado.codigo,
        nome_procedimento_principal: sigtapSelecionado.descricao,
        qtd_mes1: Number(qtdMes1 || 0),
        qtd_mes2: Number(qtdMes2 || 0),
        qtd_mes3: Number(qtdMes3 || 0),
        qtd_total: qtdTotalCalculada,
        valor_unitario: sigtapSelecionado.valor_total,
        valor_total: valorEstimado,

        procedimentos_secundarios: procedimentosSecundarios,

        cid_principal_codigo: cidPrincipal.codigo,
        cid_principal_descricao: cidPrincipal.descricao,
        cid_secundario_codigo: cidSecundario?.codigo || undefined,
        cid_secundario_descricao: cidSecundario?.descricao || undefined,
        estadiamento_clinico: estadiamento || undefined,
        anamnese_diagnostico: anamnese || undefined,
        justificativa_clinica: justificativa,
      };

      let salvo: SolicitacaoApac;
      if (editandoId) {
        salvo = await atualizarApacSolicitacao(editandoId, payload);
      } else {
        salvo = await criarApacSolicitacao(payload);
      }

      // Upload de anexos se houver
      if (arquivosParaUpload.length > 0 && salvo.id) {
        for (const arq of arquivosParaUpload) {
          const form = new FormData();
          form.append("arquivo", arq);
          form.append("tipo_documento", tipoAnexo);
          try {
            await uploadAnexoApac(salvo.id, form);
          } catch {
            // não bloqueia
          }
        }
      }

      setMensagemSucesso("Laudo de solicitação de APAC emitido com sucesso!");
      setModalNovoAberto(false);
      carregarSolicitacoes(1);
    } catch (err: any) {
      setErroModal(err?.response?.data?.detail || "Erro ao salvar a solicitação de APAC.");
    } finally {
      setSalvando(false);
    }
  };

  // Abrir Continuidade
  const abrirContinuidade = (sol: SolicitacaoApac) => {
    setSolicitacaoAlvoContinuidade(sol);
    setJustificativaContinuidade(`Continuidade do tratamento conforme laudo anterior Nº ${sol.numero_apac || sol.id}. Paciente mantém indicação clínica e estabilidade ambulatorial.`);
    setModalContinuidadeAberto(true);
  };

  const confirmarContinuidade = async () => {
    if (!solicitacaoAlvoContinuidade) return;
    if (justificativaContinuidade.trim().length < 12) {
      alert("A justificativa clínica deve conter no mínimo 12 caracteres.");
      return;
    }
    setSalvandoContinuidade(true);
    try {
      await duplicarApacContinuidade(solicitacaoAlvoContinuidade.id, justificativaContinuidade);
      setMensagemSucesso("Nova APAC de Continuidade gerada com sucesso!");
      setModalContinuidadeAberto(false);
      carregarSolicitacoes(1);
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Falha ao gerar continuidade da APAC.");
    } finally {
      setSalvandoContinuidade(false);
    }
  };

  // Cancelar Solicitação
  const handleCancelar = async (id: number) => {
    if (!confirm("Tem certeza que deseja cancelar esta solicitação de APAC?")) return;
    try {
      await cancelarApacSolicitacao(id, "Cancelado pelo usuário solicitante");
      setMensagemSucesso("Solicitação cancelada com sucesso.");
      carregarSolicitacoes(page);
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Erro ao cancelar a solicitação.");
    }
  };

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl font-extrabold text-sus-950">
              Laudos e Solicitações de APAC
            </h1>
            <span className="rounded-full bg-emerald-100 text-emerald-800 px-2.5 py-0.5 text-xs font-bold">
              Alta Complexidade
            </span>
          </div>
          <p className="text-sm text-ink/60 mt-1">
            Emissão de Laudos de Solicitação de Procedimentos de Alta Complexidade conforme SIGTAP / SIA-SUS.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <ExportarExcel
            url="/api/apac/solicitacoes/exportar"
            arquivo="solicitacoes_apac"
            params={{ q: termoBusca, status: statusFiltro, tipo: tipoFiltro }}
          />
          <Button onClick={abrirNovaSolicitacao} className="bg-emerald-700 hover:bg-emerald-800">
            <Plus className="w-4 h-4 mr-1.5" />
            Nova Solicitação de APAC
          </Button>
        </div>
      </div>

      {/* Alertas */}
      {mensagemSucesso && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>{mensagemSucesso}</span>
          </div>
          <button onClick={() => setMensagemSucesso("")} className="text-emerald-700 hover:text-emerald-900">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {mensagemErro && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-800 rounded-xl text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-600" />
            <span>{mensagemErro}</span>
          </div>
          <button onClick={() => setMensagemErro("")} className="text-red-700 hover:text-red-900">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Barra de Filtros */}
      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          <div className="md:col-span-5">
            <Label>Buscar por Paciente, CPF, APAC ou Procedimento</Label>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-3 text-ink/40" />
              <Input
                placeholder="Nome do paciente, CPF, CNS ou Nº APAC..."
                className="pl-9"
                value={termoBusca}
                onChange={(e) => setTermoBusca(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && carregarSolicitacoes(1)}
              />
            </div>
          </div>

          <div className="md:col-span-3">
            <Label>Status da Solicitação</Label>
            <select
              className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sus-700 focus:ring-2 focus:ring-sus-700/20"
              value={statusFiltro}
              onChange={(e) => setStatusFiltro(e.target.value)}
            >
              <option value="TODOS">Todos os Status</option>
              <option value="SOLICITADO">Solicitado (Aguardando Regulação)</option>
              <option value="EM ANALISE">Em Análise Médica</option>
              <option value="PENDENTE">Pendente de Complementação</option>
              <option value="AUTORIZADO">Autorizado / Deferido</option>
              <option value="INDEFERIDO">Indeferido / Negado</option>
              <option value="CANCELADO">Cancelado</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <Label>Tipo de Laudo</Label>
            <select
              className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sus-700 focus:ring-2 focus:ring-sus-700/20"
              value={tipoFiltro}
              onChange={(e) => setTipoFiltro(e.target.value)}
            >
              <option value="TODOS">Todos os Tipos</option>
              <option value="inicial">Inicial</option>
              <option value="continuidade">Continuidade</option>
            </select>
          </div>

          <div className="md:col-span-2 flex gap-2">
            <Button
              className="w-full bg-sus-900/10 text-sus-900 hover:bg-sus-900/20"
              onClick={() => carregarSolicitacoes(1)}
            >
              <Filter className="w-4 h-4 mr-1" />
              Filtrar
            </Button>
          </div>
        </div>
      </Card>

      {/* Tabela de Solicitações */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-sus-900/10 text-xs font-semibold text-slate-600 uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">Nº APAC / Data</th>
                <th className="px-4 py-3">Paciente</th>
                <th className="px-4 py-3">Procedimento Principal (SIGTAP)</th>
                <th className="px-4 py-3">CID-10</th>
                <th className="px-4 py-3 text-center">Tipo</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sus-900/10 bg-white">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-ink/60">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-emerald-600" />
                    Carregando solicitações de APAC...
                  </td>
                </tr>
              ) : solicitacoes.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-ink/60">
                    Nenhuma solicitação de APAC encontrada com os filtros selecionados.
                  </td>
                </tr>
              ) : (
                solicitacoes.map((sol) => (
                  <tr key={sol.id} className="hover:bg-slate-50/70 transition">
                    <td className="px-4 py-3">
                      <div className="font-mono font-bold text-sus-950 text-xs">
                        {sol.numero_apac ? sol.numero_apac : `#${sol.id}`}
                      </div>
                      <div className="text-[11px] text-ink/50 flex items-center gap-1 mt-0.5">
                        <Clock className="w-3 h-3" />
                        {new Date(sol.criado_em).toLocaleDateString("pt-BR")}
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      <div className="font-semibold text-sus-950">{sol.paciente_nome}</div>
                      <div className="text-xs text-ink/50 font-mono">
                        CPF: {sol.paciente_cpf || "Não informado"}
                      </div>
                    </td>

                    <td className="px-4 py-3 max-w-xs">
                      <div className="font-mono text-xs font-bold text-emerald-800">
                        {sol.codigo_procedimento_principal}
                      </div>
                      <div className="text-xs text-ink/80 truncate" title={sol.nome_procedimento_principal}>
                        {sol.nome_procedimento_principal}
                      </div>
                      <div className="text-[11px] text-ink/50">
                        Qtd Total: <b>{sol.qtd_total}</b> sessões
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      <div className="font-mono font-bold text-xs bg-slate-100 px-1.5 py-0.5 rounded inline-block">
                        {sol.cid_principal_codigo}
                      </div>
                      {sol.cid_principal_descricao && (
                        <div className="text-[11px] text-ink/60 truncate max-w-[150px]" title={sol.cid_principal_descricao}>
                          {sol.cid_principal_descricao}
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${
                        sol.tipo_solicitacao === "continuidade"
                          ? "bg-purple-100 text-purple-800"
                          : "bg-blue-100 text-blue-800"
                      }`}>
                        {sol.tipo_solicitacao === "continuidade" ? "Continuidade" : "Inicial"}
                      </span>
                      {sol.numero_apac_anterior && (
                        <span className="block text-[10px] text-ink/50 font-mono mt-0.5">
                          Ant: {sol.numero_apac_anterior}
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-3 text-center">
                      <Badge
                        variant={
                          sol.status === "AUTORIZADO"
                            ? "success"
                            : sol.status === "INDEFERIDO"
                            ? "danger"
                            : sol.status === "PENDENTE"
                            ? "warning"
                            : "default"
                        }
                      >
                        {sol.status}
                      </Badge>
                    </td>

                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* Imprimir Laudo Oficial (Pilar 1) */}
                        <button
                          onClick={() => setSolicitacaoParaImprimir(sol)}
                          className="p-1.5 text-emerald-700 hover:text-emerald-900 hover:bg-emerald-50 rounded-lg transition"
                          title="Imprimir Laudo Oficial do SUS"
                        >
                          <Printer className="w-4 h-4" />
                        </button>

                        {/* Solicitar Continuidade (Pilar 3) */}
                        {sol.status === "AUTORIZADO" && (
                          <button
                            onClick={() => abrirContinuidade(sol)}
                            className="p-1.5 text-purple-700 hover:text-purple-900 hover:bg-purple-50 rounded-lg transition"
                            title="Solicitar Continuidade de Tratamento (Novo Ciclo)"
                          >
                            <Copy className="w-4 h-4" />
                          </button>
                        )}

                        {/* Cancelar (se solicitado ou pendente) */}
                        {(sol.status === "SOLICITADO" || sol.status === "PENDENTE") && (
                          <button
                            onClick={() => handleCancelar(sol.id)}
                            className="p-1.5 text-red-600 hover:text-red-800 hover:bg-red-50 rounded-lg transition"
                            title="Cancelar Solicitação"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <Paginacao page={page} pages={pages} total={total} onPage={(p) => carregarSolicitacoes(p)} />
      </Card>

      {/* MODAL 1: Nova Solicitação de APAC (Laudo Completo) */}
      {modalNovoAberto && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm p-4 flex items-center justify-center">
          <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden">
            {/* Topo do Modal */}
            <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center">
                  <FileCheck className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="font-display text-lg font-bold text-sus-950">
                    Emissão de Laudo de Solicitação de APAC
                  </h2>
                  <p className="text-xs text-ink/60">
                    Formulário padronizado conforme diretrizes do Ministério da Saúde / DATASUS.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setModalNovoAberto(false)}
                className="p-2 text-ink/40 hover:text-ink hover:bg-slate-200/50 rounded-xl transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Conteúdo com Scroll */}
            <div className="p-5 sm:p-6 overflow-y-auto space-y-6 flex-1">
              {erroModal && (
                <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-red-800 text-sm flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{erroModal}</span>
                </div>
              )}

              {/* SEÇÃO 1: Identificação do Paciente */}
              <div>
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide flex items-center gap-2 mb-3 pb-1 border-b border-slate-200">
                  <User className="w-4 h-4 text-emerald-700" />
                  1. Identificação do Paciente
                </h3>

                {/* Autocomplete dinâmico */}
                <div className="relative mb-3">
                  <Label>Localizar Paciente (Nome, CPF ou CNS)</Label>
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-3 text-ink/40" />
                    <Input
                      placeholder="Digite ao menos 3 letras do nome, CPF ou CNS para buscar..."
                      className="pl-9"
                      value={buscaPaciente}
                      onChange={(e) => setBuscaPaciente(e.target.value)}
                    />
                    {buscandoPacientes && (
                      <RefreshCw className="w-4 h-4 absolute right-3 top-3 animate-spin text-emerald-600" />
                    )}
                  </div>

                  {pacientesSugestoes.length > 0 && (
                    <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden divide-y divide-slate-100 max-h-56 overflow-y-auto">
                      {pacientesSugestoes.map((pac) => (
                        <div
                          key={pac.id}
                          onClick={() => selecionarPaciente(pac)}
                          className="p-2.5 hover:bg-emerald-50 cursor-pointer transition flex items-center justify-between"
                        >
                          <div>
                            <span className="font-semibold text-sm text-slate-900 block">{pac.nome}</span>
                            <span className="text-xs text-slate-500 font-mono">
                              CPF: {pac.cpf || "Sem CPF"} · CNS: {pac.cns || "Sem CNS"}
                            </span>
                          </div>
                          <span className="text-xs text-emerald-700 font-semibold bg-emerald-100 px-2 py-0.5 rounded">
                            Selecionar
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Dados do Paciente preenchidos */}
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                  <div className="sm:col-span-6">
                    <Label>Nome Completo do Paciente *</Label>
                    <Input
                      value={pacienteNome}
                      onChange={(e) => setPacienteNome(e.target.value)}
                      placeholder="Nome do paciente"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <Label>CPF *</Label>
                    <Input
                      value={pacienteCpf}
                      onChange={(e) => setPacienteCpf(e.target.value)}
                      placeholder="000.000.000-00"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <Label>Cartão SUS (CNS) *</Label>
                    <Input
                      value={pacienteCns}
                      onChange={(e) => setPacienteCns(e.target.value)}
                      placeholder="000 0000 0000 0000"
                    />
                  </div>

                  <div className="sm:col-span-3">
                    <Label>Data de Nascimento</Label>
                    <Input
                      type="date"
                      value={pacienteNasc}
                      onChange={(e) => setPacienteNasc(e.target.value)}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Label>Sexo</Label>
                    <select
                      className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm"
                      value={pacienteSexo}
                      onChange={(e) => setPacienteSexo(e.target.value)}
                    >
                      <option value="F">Feminino</option>
                      <option value="M">Masculino</option>
                    </select>
                  </div>
                  <div className="sm:col-span-7">
                    <Label>Nome da Mãe</Label>
                    <Input
                      value={pacienteNomeMae}
                      onChange={(e) => setPacienteNomeMae(e.target.value)}
                      placeholder="Nome completo da mãe"
                    />
                  </div>

                  <div className="sm:col-span-6">
                    <Label>Endereço Residencial</Label>
                    <Input
                      value={pacienteEndereco}
                      onChange={(e) => setPacienteEndereco(e.target.value)}
                      placeholder="Rua, número, complemento"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <Label>Bairro</Label>
                    <Input
                      value={pacienteBairro}
                      onChange={(e) => setPacienteBairro(e.target.value)}
                      placeholder="Bairro"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <Label>Telefone / Contato</Label>
                    <Input
                      value={pacienteTelefone}
                      onChange={(e) => setPacienteTelefone(e.target.value)}
                      placeholder="(35) 99999-9999"
                    />
                  </div>
                </div>
              </div>

              {/* SEÇÃO 2: Médico e Estabelecimentos */}
              <div>
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide flex items-center gap-2 mb-3 pb-1 border-b border-slate-200">
                  <Hospital className="w-4 h-4 text-emerald-700" />
                  2. Estabelecimentos e Médico Solicitante
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                  <div className="sm:col-span-4">
                    <Label>Médico Solicitante *</Label>
                    <select
                      className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2 text-sm"
                      value={medicoSolicitanteId}
                      onChange={(e) => setMedicoSolicitanteId(Number(e.target.value) || "")}
                    >
                      <option value="">Selecione o médico...</option>
                      {medicos.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.nome} (CRM: {m.crm} | {m.cbo_codigo || "2251-25"})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:col-span-4">
                    <Label>Unidade Solicitante (Origem Guapé) *</Label>
                    <select
                      className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2 text-sm"
                      value={unidadeSolicitanteId}
                      onChange={(e) => setUnidadeSolicitanteId(Number(e.target.value) || "")}
                    >
                      <option value="">Selecione a unidade...</option>
                      {unidades.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.nome} (CNES: {u.cnes})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:col-span-4">
                    <Label>Unidade Executante (Hospital/Clínica)</Label>
                    <select
                      className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2 text-sm"
                      value={unidadeExecutanteId}
                      onChange={(e) => setUnidadeExecutanteId(Number(e.target.value) || "")}
                    >
                      <option value="">Hospital de Referência SUS / Passos / Alfenas</option>
                      {unidades.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.nome} (CNES: {u.cnes})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* SEÇÃO 3: Procedimento Principal SIGTAP */}
              <div>
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide flex items-center gap-2 mb-3 pb-1 border-b border-slate-200">
                  <Stethoscope className="w-4 h-4 text-emerald-700" />
                  3. Procedimento Principal (SIGTAP - Alta Complexidade)
                </h3>

                <div className="space-y-3">
                  <div>
                    <Label>Selecione o Procedimento Principal (10 dígitos) *</Label>
                    <select
                      className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2 text-sm font-mono font-medium"
                      value={sigtapSelecionado?.codigo || ""}
                      onChange={(e) => {
                        const item = listaSigtap.find((s) => s.codigo === e.target.value);
                        setSigtapSelecionado(item || null);
                      }}
                    >
                      <option value="">-- Selecione o Procedimento de Alta Complexidade --</option>
                      {listaSigtap.map((proc) => (
                        <option key={proc.id} value={proc.codigo}>
                          {proc.codigo} - {proc.descricao} (R$ {((proc.valor_total || 0)).toFixed(2)})
                        </option>
                      ))}
                    </select>
                  </div>

                  {sigtapSelecionado && (
                    <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <span className="font-mono text-xs font-black text-emerald-900 bg-emerald-200 px-2 py-0.5 rounded">
                            {sigtapSelecionado.codigo}
                          </span>
                          <span className="ml-2 font-bold text-sm text-slate-900">
                            {sigtapSelecionado.descricao}
                          </span>
                        </div>
                        <span className="text-xs font-bold text-emerald-800 bg-white border border-emerald-300 px-2 py-1 rounded-lg">
                          R$ {((sigtapSelecionado.valor_total || 0)).toFixed(2)} / sessão
                        </span>
                      </div>

                      {/* Quantidades por mês */}
                      <div className="grid grid-cols-4 gap-3 text-center mt-3 pt-3 border-t border-emerald-200/60">
                        <div>
                          <Label className="text-center text-[11px]">Qtd Mês 1</Label>
                          <Input
                            type="number"
                            min="0"
                            className="text-center font-bold"
                            value={qtdMes1}
                            onChange={(e) => setQtdMes1(Math.max(0, parseInt(e.target.value) || 0))}
                          />
                        </div>
                        <div>
                          <Label className="text-center text-[11px]">Qtd Mês 2</Label>
                          <Input
                            type="number"
                            min="0"
                            className="text-center font-bold"
                            value={qtdMes2}
                            onChange={(e) => setQtdMes2(Math.max(0, parseInt(e.target.value) || 0))}
                          />
                        </div>
                        <div>
                          <Label className="text-center text-[11px]">Qtd Mês 3</Label>
                          <Input
                            type="number"
                            min="0"
                            className="text-center font-bold"
                            value={qtdMes3}
                            onChange={(e) => setQtdMes3(Math.max(0, parseInt(e.target.value) || 0))}
                          />
                        </div>
                        <div className="bg-emerald-100/60 rounded-xl p-1 flex flex-col justify-center">
                          <span className="text-[10px] font-bold uppercase text-emerald-900">Total Estimado</span>
                          <span className="font-mono font-black text-emerald-950 text-base">
                            {qtdTotalCalculada} sessões
                          </span>
                          <span className="text-[11px] font-bold text-emerald-800">
                            R$ {valorEstimado.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* SEÇÃO 4: Procedimentos Secundários */}
              <div>
                <div className="flex items-center justify-between mb-2 pb-1 border-b border-slate-200">
                  <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide flex items-center gap-2">
                    <FileText className="w-4 h-4 text-emerald-700" />
                    4. Procedimentos Secundários Apensados
                  </h3>
                  <span className="text-xs text-slate-500">
                    {procedimentosSecundarios.length} adicionado(s)
                  </span>
                </div>

                <div className="flex gap-2 mb-3">
                  <select
                    className="flex-1 rounded-xl border border-sus-900/15 bg-white px-3 py-2 text-sm"
                    value={filtroSecundario}
                    onChange={(e) => setFiltroSecundario(e.target.value)}
                  >
                    <option value="">Adicionar procedimento secundário...</option>
                    {listaSigtap
                      .filter((s) => s.codigo !== sigtapSelecionado?.codigo)
                      .map((p) => (
                        <option key={p.id} value={p.codigo}>
                          {p.codigo} - {p.descricao}
                        </option>
                      ))}
                  </select>
                  <Button
                    type="button"
                    disabled={!filtroSecundario}
                    onClick={() => {
                      const proc = listaSigtap.find((p) => p.codigo === filtroSecundario);
                      if (proc) adicionarSecundario(proc);
                    }}
                    className="bg-slate-800 hover:bg-slate-900 text-white"
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    Adicionar
                  </Button>
                </div>

                {procedimentosSecundarios.length > 0 && (
                  <div className="space-y-2">
                    {procedimentosSecundarios.map((sec) => (
                      <div
                        key={sec.codigo_procedimento}
                        className="flex items-center justify-between bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-xs"
                      >
                        <div className="flex-1">
                          <span className="font-mono font-bold text-slate-900">{sec.codigo_procedimento}</span>
                          <span className="ml-2 font-medium text-slate-700">{sec.nome_procedimento}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-1">
                            <span className="text-[11px] text-slate-500">Qtd:</span>
                            <input
                              type="number"
                              min="1"
                              value={sec.quantidade}
                              onChange={(e) => atualizarQtdSecundario(sec.codigo_procedimento, parseInt(e.target.value) || 1)}
                              className="w-14 text-center border border-slate-300 rounded px-1 py-0.5"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => removerSecundario(sec.codigo_procedimento)}
                            className="text-red-600 hover:text-red-800 p-1 rounded"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* SEÇÃO 5: Dados Clínicos e CIDs */}
              <div>
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide flex items-center gap-2 mb-3 pb-1 border-b border-slate-200">
                  <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                  5. Diagnóstico e CID-10
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 mb-3">
                  <div className="sm:col-span-6">
                    <Label>CID-10 Principal (Diagnóstico) *</Label>
                    <select
                      className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2 text-sm font-mono"
                      value={cidPrincipal?.codigo || ""}
                      onChange={(e) => {
                        const item = listaCids.find((c) => c.codigo === e.target.value);
                        setCidPrincipal(item || null);
                      }}
                    >
                      <option value="">Selecione o CID-10 Principal...</option>
                      {listaCids.map((c) => (
                        <option key={c.codigo} value={c.codigo}>
                          {c.codigo} - {c.descricao}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:col-span-6">
                    <Label>CID-10 Secundário / Causas Associadas</Label>
                    <select
                      className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2 text-sm font-mono"
                      value={cidSecundario?.codigo || ""}
                      onChange={(e) => {
                        const item = listaCids.find((c) => c.codigo === e.target.value);
                        setCidSecundario(item || null);
                      }}
                    >
                      <option value="">Opcional / Não se aplica</option>
                      {listaCids.map((c) => (
                        <option key={c.codigo} value={c.codigo}>
                          {c.codigo} - {c.descricao}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:col-span-12">
                    <Label>Estadiamento Clínico (Obrigatório se Oncológico / TNM)</Label>
                    <Input
                      placeholder="Ex: Grau III, Estádio IIB (T2 N1 M0) ou Não se aplica"
                      value={estadiamento}
                      onChange={(e) => setEstadiamento(e.target.value)}
                    />
                  </div>

                  <div className="sm:col-span-12">
                    <Label>Anamnese e Diagnóstico Fundamentado</Label>
                    <textarea
                      rows={2}
                      className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sus-700 focus:ring-2 focus:ring-sus-700/20"
                      placeholder="Sinais clínicos, sintomas e histórico relevante..."
                      value={anamnese}
                      onChange={(e) => setAnamnese(e.target.value)}
                    />
                  </div>

                  <div className="sm:col-span-12">
                    <div className="flex justify-between items-center mb-1">
                      <Label className="mb-0">Justificativa Clínica do Procedimento * (Mínimo 12 caracteres)</Label>
                      <span className={`text-xs font-mono font-semibold ${
                        justificativa.trim().length >= 12 ? "text-emerald-700" : "text-amber-600"
                      }`}>
                        {justificativa.trim().length} / 12 caracteres mín.
                      </span>
                    </div>
                    <textarea
                      rows={3}
                      className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sus-700 focus:ring-2 focus:ring-sus-700/20"
                      placeholder="Indicação clínica detalhada, fundamentação e necessidade da alta complexidade..."
                      value={justificativa}
                      onChange={(e) => setJustificativa(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* SEÇÃO 6: Anexos e Documentos Comprobatórios */}
              <div>
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide flex items-center gap-2 mb-3 pb-1 border-b border-slate-200">
                  <Paperclip className="w-4 h-4 text-emerald-700" />
                  6. Anexos e Documentos Comprobatórios
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                  <div className="sm:col-span-4">
                    <Label>Tipo de Documento</Label>
                    <select
                      className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2 text-sm"
                      value={tipoAnexo}
                      onChange={(e) => setTipoAnexo(e.target.value)}
                    >
                      <option value="laudo_biopsia">Laudo de Biópsia / Histopatológico</option>
                      <option value="exame_imagem">Exame de Imagem (RM / TC / USG)</option>
                      <option value="termo_consentimento">Termo de Consentimento Informado</option>
                      <option value="outro">Outro Documento Clínico</option>
                    </select>
                  </div>

                  <div className="sm:col-span-8">
                    <Label>Arquivo (PDF, PNG ou JPG)</Label>
                    <input
                      type="file"
                      multiple
                      onChange={(e) => {
                        if (e.target.files) {
                          setArquivosParaUpload(Array.from(e.target.files));
                        }
                      }}
                      className="w-full text-xs text-slate-500 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-emerald-100 file:text-emerald-800 hover:file:bg-emerald-200"
                    />
                  </div>
                </div>

                {arquivosParaUpload.length > 0 && (
                  <div className="mt-2 text-xs text-slate-600 bg-slate-50 p-2 rounded-lg">
                    <b>Arquivos anexados:</b> {arquivosParaUpload.map((f) => f.name).join(", ")}
                  </div>
                )}
              </div>
            </div>

            {/* Rodapé com botões */}
            <div className="p-4 sm:p-5 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
              <Button
                type="button"
                className="bg-transparent hover:bg-slate-200 text-slate-700 border border-slate-300"
                onClick={() => setModalNovoAberto(false)}
              >
                Cancelar
              </Button>

              <Button
                type="button"
                disabled={salvando}
                onClick={salvarSolicitacao}
                className="bg-emerald-700 hover:bg-emerald-800 text-white min-w-[160px]"
              >
                {salvando ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                    Emitindo Laudo...
                  </>
                ) : (
                  <>
                    <FileCheck className="w-4 h-4 mr-2" />
                    Emitir Laudo APAC
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Continuidade de APAC (Pilar 3) */}
      {modalContinuidadeAberto && solicitacaoAlvoContinuidade && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm p-4 flex items-center justify-center">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="p-5 border-b border-slate-100 bg-purple-50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-purple-700 text-white flex items-center justify-center">
                  <Copy className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-display text-base font-bold text-slate-900">
                    Solicitar Continuidade de APAC
                  </h3>
                  <p className="text-xs text-slate-500">
                    Novo ciclo vinculado à APAC anterior Nº {solicitacaoAlvoContinuidade.numero_apac || solicitacaoAlvoContinuidade.id}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setModalContinuidadeAberto(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="p-3 bg-slate-50 rounded-xl text-xs space-y-1.5 border border-slate-200">
                <p>
                  <b>Paciente:</b> {solicitacaoAlvoContinuidade.paciente_nome}
                </p>
                <p>
                  <b>Procedimento:</b> {solicitacaoAlvoContinuidade.codigo_procedimento_principal} - {solicitacaoAlvoContinuidade.nome_procedimento_principal}
                </p>
                <p>
                  <b>CID-10:</b> {solicitacaoAlvoContinuidade.cid_principal_codigo}
                </p>
              </div>

              <div>
                <Label>Justificativa Clínica Atualizada (Obrigatório) *</Label>
                <textarea
                  rows={4}
                  className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-purple-600 focus:ring-2 focus:ring-purple-600/20"
                  value={justificativaContinuidade}
                  onChange={(e) => setJustificativaContinuidade(e.target.value)}
                  placeholder="Relatório de evolução clínica do paciente justificando a continuidade do tratamento..."
                />
                <span className="text-xs text-slate-500">
                  {justificativaContinuidade.trim().length} / 12 caracteres mín.
                </span>
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
              <Button
                type="button"
                className="bg-transparent hover:bg-slate-200 text-slate-700"
                onClick={() => setModalContinuidadeAberto(false)}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                disabled={salvandoContinuidade}
                onClick={confirmarContinuidade}
                className="bg-purple-700 hover:bg-purple-800 text-white"
              >
                {salvandoContinuidade ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                    Gerando...
                  </>
                ) : (
                  "Confirmar Continuidade"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Impressão do Laudo Oficial (Pilar 1) */}
      {solicitacaoParaImprimir && (
        <LaudoApacPrint
          solicitacao={solicitacaoParaImprimir}
          onFechar={() => setSolicitacaoParaImprimir(null)}
        />
      )}
    </div>
  );
}
