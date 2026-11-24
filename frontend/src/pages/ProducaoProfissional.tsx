import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Coins,
  Edit3,
  FileCheck,
  FileText,
  Filter,
  Layers,
  Plus,
  RefreshCw,
  Search,
  Stethoscope,
  Trash2,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import BuscaPacienteAutocomplete from "../components/BuscaPacienteAutocomplete";
import { useAuth } from "../hooks/useAuth";
import {
  atualizarProducaoAmbulatorial,
  buscarCidsSigtapProducao,
  buscarProcedimentosSigtapProducao,
  criarProducaoAmbulatorial,
  excluirProducaoAmbulatorial,
  listarEquipesSaudeProducao,
  listarMedicos,
  listarProducoesAmbulatoriais,
  listarUnidades,
  msgErro,
  obterResumoProducaoAmbulatorial,
  type Cid10Item,
  type EquipeSaude,
  type Medico,
  type Paciente,
  type ProcedimentoSigtapItem,
  type ProducaoAmbulatorial,
  type ProducaoAmbulatorialIn,
  type ResumoCompetenciaProducao,
  type UnidadeSaude,
} from "../services/api";

function formatarMoeda(val: number | null | undefined): string {
  const n = Number(val) || 0;
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatarDataBr(isoDate: string | null | undefined): string {
  if (!isoDate) return "—";
  const parts = isoDate.split("-");
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return isoDate;
}

function calcularIdadeAnos(nasc: string | null | undefined, ref: string): number {
  if (!nasc) return 0;
  const dNasc = new Date(nasc);
  const dRef = new Date(ref || new Date().toISOString().split("T")[0]);
  let anos = dRef.getFullYear() - dNasc.getFullYear();
  const m = dRef.getMonth() - dNasc.getMonth();
  if (m < 0 || (m === 0 && dRef.getDate() < dNasc.getDate())) {
    anos--;
  }
  return Math.max(0, anos);
}

function getCompetenciaAtual(): string {
  const h = new Date();
  const ano = h.getFullYear();
  const mes = String(h.getMonth() + 1).padStart(2, "0");
  return `${ano}${mes}`;
}

function formatarCompetenciaVisual(comp: string): string {
  if (comp.length === 6) {
    return `${comp.substring(4, 6)}/${comp.substring(0, 4)}`;
  }
  return comp;
}

export default function ProducaoProfissional() {
  const { user } = useAuth();

  // Competência selecionada (AAAAMM)
  const [competencia, setCompetencia] = useState<string>(getCompetenciaAtual());

  // Dados auxiliares para selects
  const [medicos, setMedicos] = useState<Medico[]>([]);
  const [unidades, setUnidades] = useState<UnidadeSaude[]>([]);
  const [equipes, setEquipes] = useState<EquipeSaude[]>([]);

  // Filtros ativos da tabela
  const [medicoFiltroId, setMedicoFiltroId] = useState<number | "">("");
  const [unidadeFiltroId, setUnidadeFiltroId] = useState<number | "">("");
  const [instrumentoFiltro, setInstrumentoFiltro] = useState<string>("");
  const [termoFiltro, setTermoFiltro] = useState<string>("");

  // Lista e Resumo da produção
  const [producoes, setProducoes] = useState<ProducaoAmbulatorial[]>([]);
  const [totalRegistros, setTotalRegistros] = useState<number>(0);
  const [resumo, setResumo] = useState<ResumoCompetenciaProducao | null>(null);
  const [carregando, setCarregando] = useState<boolean>(false);
  const [erroCarregamento, setErroCarregamento] = useState<string>("");

  // Controle do Formulário Modal / Drawer de Lançamento
  const [modalAberto, setModalAberto] = useState<boolean>(false);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [salvando, setSalvando] = useState<boolean>(false);
  const [mensagemSucesso, setMensagemSucesso] = useState<string>("");
  const [erroForm, setErroForm] = useState<string>("");

  // Estado dos campos do formulário
  const [formMedicoId, setFormMedicoId] = useState<number | "">("");
  const [formUnidadeId, setFormUnidadeId] = useState<number | "">("");
  const [formEquipeId, setFormEquipeId] = useState<number | "">("");
  const [formDataAtendimento, setFormDataAtendimento] = useState<string>(
    new Date().toISOString().split("T")[0]
  );
  const [formQuantidade, setFormQuantidade] = useState<number>(1);
  const [formCbo, setFormCbo] = useState<string>("");

  // Autocomplete Procedimento SIGTAP
  const [buscaProcTexto, setBuscaProcTexto] = useState<string>("");
  const [sugestoesProc, setSugestoesProc] = useState<ProcedimentoSigtapItem[]>([]);
  const [buscandoProc, setBuscandoProc] = useState<boolean>(false);
  const [procSelecionado, setProcSelecionado] = useState<ProcedimentoSigtapItem | null>(null);
  const [dropdownProcAberto, setDropdownProcAberto] = useState<boolean>(false);
  const procContainerRef = useRef<HTMLDivElement>(null);

  // Campos específicos BPA-I
  const [pacienteId, setPacienteId] = useState<string | number>("");
  const [pacienteObj, setPacienteObj] = useState<Paciente | null>(null);
  const [pacienteNome, setPacienteNome] = useState<string>("");
  const [pacienteCns, setPacienteCns] = useState<string>("");
  const [pacienteSexo, setPacienteSexo] = useState<string>("M");
  const [pacienteNasc, setPacienteNasc] = useState<string>("");
  const [numeroAutorizacao, setNumeroAutorizacao] = useState<string>("");
  const [servicoCodigo, setServicoCodigo] = useState<string>("");
  const [classificacaoCodigo, setClassificacaoCodigo] = useState<string>("");

  // Autocomplete CID-10
  const [buscaCidTexto, setBuscaCidTexto] = useState<string>("");
  const [sugestoesCid, setSugestoesCid] = useState<Cid10Item[]>([]);
  const [buscandoCid, setBuscandoCid] = useState<boolean>(false);
  const [cidSelecionado, setCidSelecionado] = useState<string>("");
  const [dropdownCidAberto, setDropdownCidAberto] = useState<boolean>(false);
  const cidContainerRef = useRef<HTMLDivElement>(null);

  // Exclusão modal
  const [excluindoId, setExcluindoId] = useState<number | null>(null);

  // 1. Carrega listas iniciais de Médicos, Unidades e Equipes
  useEffect(() => {
    async function carregarAuxiliares() {
      try {
        const [listaM, listaU, listaEq] = await Promise.all([
          listarMedicos({ somente_ativos: true }),
          listarUnidades({ somente_ativas: true }),
          listarEquipesSaudeProducao(),
        ]);
        setMedicos(listaM);
        setUnidades(listaU);
        setEquipes(listaEq);

        // Se o usuário logado tiver médico vinculado, auto-seleciona
        if (user?.medico_id) {
          setMedicoFiltroId(user.medico_id);
          setFormMedicoId(user.medico_id);
        }
        if (user?.unidade_saude_id) {
          setUnidadeFiltroId(user.unidade_saude_id);
          setFormUnidadeId(user.unidade_saude_id);
        }
      } catch (e) {
        console.error("Erro ao carregar dados auxiliares:", e);
      }
    }
    carregarAuxiliares();
  }, [user]);

  // Se o médico do formulário mudar, atualiza o CBO padrão
  useEffect(() => {
    if (formMedicoId) {
      const m = medicos.find((it) => it.id === Number(formMedicoId));
      if (m?.cbo_codigo) {
        setFormCbo(m.cbo_codigo);
      }
    }
  }, [formMedicoId, medicos]);

  // Se a unidade do formulário mudar, carrega equipes daquela unidade se necessário
  const equipesDisponiveisForm = useMemo(() => {
    if (!formUnidadeId) return equipes;
    return equipes.filter((eq) => eq.unidade_saude_id === Number(formUnidadeId));
  }, [equipes, formUnidadeId]);

  // 2. Busca lista de produções e resumo quando mudam os filtros
  const recarregarDados = async () => {
    setCarregando(true);
    setErroCarregamento("");
    try {
      const pMed = medicoFiltroId ? Number(medicoFiltroId) : undefined;
      const pUnid = unidadeFiltroId ? Number(unidadeFiltroId) : undefined;
      const pInst = instrumentoFiltro || undefined;
      const pTermo = termoFiltro || undefined;

      const [respLista, respResumo] = await Promise.all([
        listarProducoesAmbulatoriais({
          competencia,
          medico_id: pMed,
          unidade_saude_id: pUnid,
          instrumento: pInst,
          termo: pTermo,
          limit: 200,
        }),
        obterResumoProducaoAmbulatorial(competencia, pMed, pUnid),
      ]);

      setProducoes(respLista.itens);
      setTotalRegistros(respLista.total);
      setResumo(respResumo);
    } catch (err) {
      setErroCarregamento(msgErro(err, "Falha ao carregar a produção ambulatorial."));
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    recarregarDados();
  }, [competencia, medicoFiltroId, unidadeFiltroId, instrumentoFiltro, termoFiltro]);

  // Navegação de Competência
  const alterarMes = (delta: number) => {
    const ano = parseInt(competencia.substring(0, 4), 10);
    const mes = parseInt(competencia.substring(4, 6), 10);
    const d = new Date(ano, mes - 1 + delta, 1);
    const novoAno = d.getFullYear();
    const novoMes = String(d.getMonth() + 1).padStart(2, "0");
    setCompetencia(`${novoAno}${novoMes}`);
  };

  // Autocomplete SIGTAP com debounce
  useEffect(() => {
    if (!buscaProcTexto || buscaProcTexto.trim().length < 2) {
      setSugestoesProc([]);
      setDropdownProcAberto(false);
      return;
    }
    const timer = setTimeout(async () => {
      setBuscandoProc(true);
      try {
        const itens = await buscarProcedimentosSigtapProducao(buscaProcTexto, formCbo);
        setSugestoesProc(itens);
        setDropdownProcAberto(true);
      } catch (err) {
        console.error(err);
      } finally {
        setBuscandoProc(false);
      }
    }, 280);
    return () => clearTimeout(timer);
  }, [buscaProcTexto, formCbo]);

  // Autocomplete CID com debounce
  useEffect(() => {
    if (!buscaCidTexto || buscaCidTexto.trim().length < 1) {
      setSugestoesCid([]);
      setDropdownCidAberto(false);
      return;
    }
    const timer = setTimeout(async () => {
      setBuscandoCid(true);
      try {
        const itens = await buscarCidsSigtapProducao(buscaCidTexto);
        setSugestoesCid(itens);
        setDropdownCidAberto(true);
      } catch (err) {
        console.error(err);
      } finally {
        setBuscandoCid(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [buscaCidTexto]);

  // Fecha dropdowns se clicar fora
  useEffect(() => {
    function handleClickFora(evt: MouseEvent) {
      if (procContainerRef.current && !procContainerRef.current.contains(evt.target as Node)) {
        setDropdownProcAberto(false);
      }
      if (cidContainerRef.current && !cidContainerRef.current.contains(evt.target as Node)) {
        setDropdownCidAberto(false);
      }
    }
    document.addEventListener("mousedown", handleClickFora);
    return () => document.removeEventListener("mousedown", handleClickFora);
  }, []);

  // Seleciona paciente do BuscaPacienteAutocomplete
  const handleSelectPaciente = (p: Paciente | null) => {
    setPacienteObj(p);
    if (p) {
      setPacienteId(p.id ?? "");
      setPacienteNome(p.nome || "");
      setPacienteCns(p.cns || "");
      setPacienteSexo(p.sexo ? (p.sexo.toUpperCase().startsWith("F") ? "F" : "M") : "M");
      setPacienteNasc(p.nascimento || "");
    } else {
      setPacienteId("");
      setPacienteNome("");
      setPacienteCns("");
      setPacienteNasc("");
    }
  };

  // Abre Modal para Novo Lançamento
  const abrirNovoLancamento = () => {
    setEditandoId(null);
    setErroForm("");
    setProcSelecionado(null);
    setBuscaProcTexto("");
    setSugestoesProc([]);
    setFormQuantidade(1);
    setPacienteId("");
    setPacienteObj(null);
    setPacienteNome("");
    setPacienteCns("");
    setPacienteSexo("M");
    setPacienteNasc("");
    setCidSelecionado("");
    setBuscaCidTexto("");
    setNumeroAutorizacao("");
    setServicoCodigo("");
    setClassificacaoCodigo("");

    // Mantém médico e unidade atuais ou do user
    if (!formMedicoId && user?.medico_id) setFormMedicoId(user.medico_id);
    else if (!formMedicoId && medicos.length > 0) setFormMedicoId(medicos[0].id);

    if (!formUnidadeId && user?.unidade_saude_id) setFormUnidadeId(user.unidade_saude_id);
    else if (!formUnidadeId && unidades.length > 0) setFormUnidadeId(unidades[0].id);

    setFormDataAtendimento(new Date().toISOString().split("T")[0]);
    setModalAberto(true);
  };

  // Abre Modal para Edição
  const abrirEdicao = (prod: ProducaoAmbulatorial) => {
    setEditandoId(prod.id);
    setErroForm("");
    setFormMedicoId(prod.medico_id);
    setFormUnidadeId(prod.unidade_saude_id);
    setFormEquipeId(prod.equipe_id || "");
    setFormDataAtendimento(prod.data_atendimento);
    setFormQuantidade(prod.quantidade);
    setFormCbo(prod.cbo_codigo);

    setProcSelecionado({
      id: prod.procedimento_id,
      codigo: prod.procedimento_codigo,
      descricao: prod.procedimento_nome,
      complexidade: "AB",
      instrumento: prod.instrumento_registro,
      sexo: "I",
      idade_min: 0,
      idade_max: 0,
      qtd_maxima: 0,
      pontos: 0,
      valor_sa: 0,
      valor_sp: 0,
      valor_total: prod.valor_unitario,
    });
    setBuscaProcTexto(`${prod.procedimento_codigo} - ${prod.procedimento_nome}`);

    setPacienteId(prod.paciente_id || "");
    setPacienteNome(prod.paciente_nome || "");
    setPacienteCns(prod.paciente_cns || "");
    setPacienteSexo(prod.paciente_sexo || "M");
    setPacienteNasc(prod.paciente_data_nascimento || "");
    setCidSelecionado(prod.cid10 || "");
    setBuscaCidTexto(prod.cid10 || "");
    setNumeroAutorizacao(prod.numero_autorizacao || "");
    setServicoCodigo(prod.servico_codigo || "");
    setClassificacaoCodigo(prod.classificacao_codigo || "");

    setModalAberto(true);
  };

  // Submissão do Formulário
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErroForm("");

    if (!formMedicoId) {
      setErroForm("Selecione o profissional executante.");
      return;
    }
    if (!formUnidadeId) {
      setErroForm("Selecione a unidade de saúde.");
      return;
    }
    if (!procSelecionado) {
      setErroForm("Selecione um procedimento do SIGTAP.");
      return;
    }
    if (!formDataAtendimento) {
      setErroForm("Informe a data do atendimento.");
      return;
    }
    if (formQuantidade < 1) {
      setErroForm("A quantidade deve ser de no mínimo 1.");
      return;
    }

    const ehBpaI = procSelecionado.instrumento === "BPA-I";

    if (ehBpaI) {
      if (!pacienteNome.trim()) {
        setErroForm("Nome do paciente é obrigatório para procedimentos BPA-I.");
        return;
      }
      if (!pacienteCns.trim() || pacienteCns.replace(/\D/g, "").length !== 15) {
        setErroForm("Cartão Nacional de Saúde (CNS) com 15 dígitos é obrigatório para BPA-I.");
        return;
      }
      if (!pacienteNasc) {
        setErroForm("Data de nascimento do paciente é obrigatória para apuração de idade.");
        return;
      }
    }

    setSalvando(true);
    try {
      const payload: ProducaoAmbulatorialIn = {
        medico_id: Number(formMedicoId),
        unidade_saude_id: Number(formUnidadeId),
        equipe_id: formEquipeId ? Number(formEquipeId) : null,
        procedimento_id: procSelecionado.id,
        procedimento_codigo: procSelecionado.codigo,
        procedimento_nome: procSelecionado.descricao,
        cbo_codigo: formCbo,
        competencia,
        data_atendimento: formDataAtendimento,
        instrumento_registro: procSelecionado.instrumento,
        quantidade: Number(formQuantidade),
        paciente_id: pacienteId ? Number(pacienteId) : null,
        paciente_nome: pacienteNome.trim(),
        paciente_cns: pacienteCns.replace(/\D/g, ""),
        paciente_sexo: pacienteSexo,
        paciente_data_nascimento: pacienteNasc || null,
        cid10: cidSelecionado.trim(),
        numero_autorizacao: numeroAutorizacao.trim(),
        servico_codigo: servicoCodigo.trim(),
        classificacao_codigo: classificacaoCodigo.trim(),
      };

      if (editandoId) {
        await atualizarProducaoAmbulatorial(editandoId, payload);
        setMensagemSucesso("Lançamento atualizado com sucesso!");
      } else {
        await criarProducaoAmbulatorial(payload);
        setMensagemSucesso("Produção lançada e validada com sucesso no SIA/SUS!");
      }

      setModalAberto(false);
      setTimeout(() => setMensagemSucesso(""), 4000);
      await recarregarDados();
    } catch (err) {
      setErroForm(msgErro(err, "Falha ao salvar a produção ambulatorial."));
    } finally {
      setSalvando(false);
    }
  };

  // Exclusão de Registro
  const handleConfirmarExclusao = async () => {
    if (!excluindoId) return;
    try {
      await excluirProducaoAmbulatorial(excluindoId);
      setMensagemSucesso("Lançamento removido com sucesso.");
      setTimeout(() => setMensagemSucesso(""), 4000);
      setExcluindoId(null);
      await recarregarDados();
    } catch (err) {
      alert(msgErro(err, "Falha ao excluir o lançamento."));
    }
  };

  // Verificação em tempo real de idade/sexo do paciente para aviso visual no form
  const avisoCompatibilidade = useMemo(() => {
    if (!procSelecionado || procSelecionado.instrumento !== "BPA-I") return null;
    const avisos: string[] = [];

    if (procSelecionado.sexo && procSelecionado.sexo !== "I") {
      if (procSelecionado.sexo === "M" && pacienteSexo !== "M") {
        avisos.push("Procedimento exclusivo para o sexo Masculino.");
      } else if (procSelecionado.sexo === "F" && pacienteSexo !== "F") {
        avisos.push("Procedimento exclusivo para o sexo Feminino.");
      }
    }

    if (pacienteNasc && procSelecionado.idade_max > 0) {
      const idade = calcularIdadeAnos(pacienteNasc, formDataAtendimento);
      const minA = procSelecionado.idade_max > 150 ? Math.floor(procSelecionado.idade_min / 12) : procSelecionado.idade_min;
      const maxA = procSelecionado.idade_max > 150 ? Math.floor(procSelecionado.idade_max / 12) : procSelecionado.idade_max;
      if (idade < minA || idade > maxA) {
        avisos.push(`Idade do paciente (${idade} anos) fora da faixa permitida (${minA} a ${maxA} anos).`);
      }
    }
    return avisos.length > 0 ? avisos : null;
  }, [procSelecionado, pacienteSexo, pacienteNasc, formDataAtendimento]);

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-7xl mx-auto">
      {/* Mensagem de Sucesso Flutuante */}
      {mensagemSucesso && (
        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-xl shadow-sm animate-fade-in">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
          <span className="text-sm font-medium">{mensagemSucesso}</span>
        </div>
      )}

      {/* Topo: Título + Navegação de Competência + Botão Novo */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-sus-900/10 shadow-xs">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 bg-teal/10 rounded-xl text-teal">
              <Activity className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-sus-950 tracking-tight">
                Lançamento de Produção Ambulatorial
              </h1>
              <p className="text-xs md:text-sm text-sus-900/60 font-medium">
                Digitação e validação de procedimentos dos profissionais de saúde (BPA-C e BPA-I / SIA-SUS)
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Seletor de Competência */}
          <div className="flex items-center bg-sus-900/5 rounded-xl p-1 border border-sus-900/10">
            <button
              onClick={() => alterarMes(-1)}
              title="Competência Anterior"
              className="p-1.5 hover:bg-white rounded-lg transition-colors text-sus-900/70 hover:text-sus-950"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="px-3 flex items-center gap-1.5 text-sm font-bold text-sus-950">
              <Calendar className="h-4 w-4 text-teal" />
              <span>{formatarCompetenciaVisual(competencia)}</span>
            </div>
            <button
              onClick={() => alterarMes(1)}
              title="Próxima Competência"
              className="p-1.5 hover:bg-white rounded-lg transition-colors text-sus-900/70 hover:text-sus-950"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <button
            onClick={() => setCompetencia(getCompetenciaAtual())}
            className="text-xs font-semibold px-2.5 py-2 bg-sus-900/5 hover:bg-sus-900/10 text-sus-900 rounded-xl transition-colors"
          >
            Mês Atual
          </button>

          <button
            onClick={abrirNovoLancamento}
            className="flex items-center gap-2 bg-teal hover:bg-teal/90 text-white font-semibold text-sm px-4 py-2.5 rounded-xl shadow-xs transition-all active:scale-95"
          >
            <Plus className="h-4 w-4" />
            <span>Novo Lançamento</span>
          </button>
        </div>
      </div>

      {/* Cards de Resumo da Competência */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-2xl border border-sus-900/10 shadow-xs flex items-center gap-3.5">
          <div className="p-3 bg-sky-50 text-sky-600 rounded-xl">
            <FileText className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-sus-900/60 font-semibold uppercase tracking-wider">
              Total de Atos
            </p>
            <p className="text-xl font-bold text-sus-950">
              {resumo?.total_procedimentos ?? 0}{" "}
              <span className="text-xs font-normal text-sus-900/50">procedimentos</span>
            </p>
            <p className="text-[11px] text-sus-900/50">
              {resumo?.total_lancamentos ?? 0} registros gravados
            </p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-sus-900/10 shadow-xs flex items-center gap-3.5">
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
            <Coins className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-sus-900/60 font-semibold uppercase tracking-wider">
              Valor Faturado Estimado
            </p>
            <p className="text-xl font-bold text-emerald-700">
              {formatarMoeda(resumo?.valor_total)}
            </p>
            <p className="text-[11px] text-sus-900/50">Tabela Unificada DATASUS</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-sus-900/10 shadow-xs flex items-center gap-3.5">
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
            <Layers className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <p className="text-xs text-sus-900/60 font-semibold uppercase tracking-wider">
              Distribuição BPA
            </p>
            <div className="flex items-center justify-between text-xs mt-1">
              <span className="font-medium text-sus-900">BPA-C: {resumo?.total_bpac ?? 0}</span>
              <span className="text-sus-900/60">{formatarMoeda(resumo?.valor_bpac)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-teal">BPA-I: {resumo?.total_bpai ?? 0}</span>
              <span className="text-sus-900/60">{formatarMoeda(resumo?.valor_bpai)}</span>
            </div>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-sus-900/10 shadow-xs flex items-center gap-3.5">
          <div className="p-3 bg-amber-50 text-amber-600 rounded-xl">
            <UserCheck className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-sus-900/60 font-semibold uppercase tracking-wider">
              Cobertura
            </p>
            <p className="text-xl font-bold text-sus-950">
              {resumo?.total_profissionais ?? 0}{" "}
              <span className="text-xs font-normal text-sus-900/50">profissionais</span>
            </p>
            <p className="text-[11px] text-sus-900/50">
              em {resumo?.total_unidades ?? 0} unidades de atendimento
            </p>
          </div>
        </div>
      </div>

      {/* Barra de Filtros da Produção */}
      <div className="bg-white p-4 rounded-2xl border border-sus-900/10 shadow-xs space-y-3">
        <div className="flex items-center gap-2 pb-2 border-b border-sus-900/5 text-xs font-semibold text-sus-900/70 uppercase">
          <Filter className="h-3.5 w-3.5 text-teal" />
          <span>Filtros de Consulta</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          {/* Filtro Profissional */}
          <div>
            <label className="block text-xs font-medium text-sus-900/70 mb-1">
              Profissional Executante
            </label>
            <select
              value={medicoFiltroId}
              onChange={(e) => setMedicoFiltroId(e.target.value ? Number(e.target.value) : "")}
              className="w-full text-xs font-medium rounded-xl border border-sus-900/20 bg-sus-900/5 px-3 py-2 text-sus-950 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal/30"
            >
              <option value="">Todos os Profissionais</option>
              {medicos.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome} ({m.crm ? `CRM ${m.crm}` : m.cbo_codigo || "Profissional"})
                </option>
              ))}
            </select>
          </div>

          {/* Filtro Unidade */}
          <div>
            <label className="block text-xs font-medium text-sus-900/70 mb-1">
              Unidade de Saúde
            </label>
            <select
              value={unidadeFiltroId}
              onChange={(e) => setUnidadeFiltroId(e.target.value ? Number(e.target.value) : "")}
              className="w-full text-xs font-medium rounded-xl border border-sus-900/20 bg-sus-900/5 px-3 py-2 text-sus-950 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal/30"
            >
              <option value="">Todas as Unidades</option>
              {unidades.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nome} {u.cnes ? `(CNES ${u.cnes})` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Filtro Instrumento */}
          <div>
            <label className="block text-xs font-medium text-sus-900/70 mb-1">
              Instrumento (BPA)
            </label>
            <select
              value={instrumentoFiltro}
              onChange={(e) => setInstrumentoFiltro(e.target.value)}
              className="w-full text-xs font-medium rounded-xl border border-sus-900/20 bg-sus-900/5 px-3 py-2 text-sus-950 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal/30"
            >
              <option value="">Todos os Instrumentos</option>
              <option value="BPA-C">BPA-C (Consolidado)</option>
              <option value="BPA-I">BPA-I (Individualizado)</option>
            </select>
          </div>

          {/* Busca Textual */}
          <div>
            <label className="block text-xs font-medium text-sus-900/70 mb-1">
              Busca Rápida
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-sus-900/40" />
              <input
                type="text"
                placeholder="Código, procedimento ou paciente…"
                value={termoFiltro}
                onChange={(e) => setTermoFiltro(e.target.value)}
                className="w-full text-xs rounded-xl border border-sus-900/20 bg-sus-900/5 pl-8 pr-3 py-2 text-sus-950 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal/30"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Tabela de Lançamentos */}
      <div className="bg-white rounded-2xl border border-sus-900/10 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-sus-900/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-sus-950">
              Registros da Competência {formatarCompetenciaVisual(competencia)}
            </h2>
            <span className="text-xs bg-sus-900/5 px-2 py-0.5 rounded-full text-sus-900/70 font-semibold">
              {totalRegistros} itens
            </span>
          </div>

          <button
            onClick={recarregarDados}
            title="Atualizar lista"
            className="p-1.5 hover:bg-sus-900/5 rounded-lg text-sus-900/60 transition-colors"
          >
            <RefreshCw className={`h-4 w-4 ${carregando ? "animate-spin text-teal" : ""}`} />
          </button>
        </div>

        {erroCarregamento && (
          <div className="p-4 bg-red-50 text-red-700 text-xs flex items-center gap-2 border-b border-red-100">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{erroCarregamento}</span>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-sus-900/5 text-sus-900/70 font-semibold border-b border-sus-900/10">
                <th className="py-3 px-4">Data</th>
                <th className="py-3 px-4">Profissional / CBO</th>
                <th className="py-3 px-4">Unidade / Equipe</th>
                <th className="py-3 px-4">Procedimento SIGTAP</th>
                <th className="py-3 px-3 text-center">Tipo</th>
                <th className="py-3 px-4">Paciente (BPA-I)</th>
                <th className="py-3 px-3 text-right">Qtd</th>
                <th className="py-3 px-3 text-right">Unitário</th>
                <th className="py-3 px-4 text-right">Total</th>
                <th className="py-3 px-4 text-center">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sus-900/5">
              {producoes.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-sus-900/40">
                    {carregando ? (
                      <div className="flex flex-col items-center gap-2">
                        <RefreshCw className="h-6 w-6 animate-spin text-teal" />
                        <span>Carregando produção ambulatorial…</span>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <p className="font-medium text-sus-900/60">
                          Nenhum lançamento encontrado para os filtros selecionados.
                        </p>
                        <p className="text-[11px]">
                          Clique em &quot;Novo Lançamento&quot; acima para registrar os atendimentos.
                        </p>
                      </div>
                    )}
                  </td>
                </tr>
              ) : (
                producoes.map((p) => {
                  const ehBpaI = p.instrumento_registro === "BPA-I";
                  return (
                    <tr key={p.id} className="hover:bg-sus-900/5 transition-colors">
                      <td className="py-3 px-4 font-medium text-sus-950 whitespace-nowrap">
                        {formatarDataBr(p.data_atendimento)}
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-semibold text-sus-950">{p.medico_nome}</p>
                        <p className="text-[10px] text-sus-900/60">CBO: {p.cbo_codigo}</p>
                      </td>
                      <td className="py-3 px-4">
                        <p className="text-sus-900">{p.unidade_saude_nome}</p>
                        {p.equipe_nome && (
                          <p className="text-[10px] text-teal font-medium">
                            {p.equipe_nome} {p.equipe_ine ? `(INE ${p.equipe_ine})` : ""}
                          </p>
                        )}
                      </td>
                      <td className="py-3 px-4 max-w-xs">
                        <span className="font-mono text-[11px] font-semibold text-sus-950 bg-sus-900/5 px-1.5 py-0.5 rounded">
                          {p.procedimento_codigo}
                        </span>
                        <p className="text-[11px] text-sus-900/80 truncate mt-0.5" title={p.procedimento_nome}>
                          {p.procedimento_nome}
                        </p>
                      </td>
                      <td className="py-3 px-3 text-center whitespace-nowrap">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            ehBpaI
                              ? "bg-teal/15 text-teal"
                              : "bg-indigo-50 text-indigo-700"
                          }`}
                        >
                          {p.instrumento_registro}
                        </span>
                      </td>
                      <td className="py-3 px-4 max-w-xs">
                        {ehBpaI ? (
                          <div>
                            <p className="font-medium text-sus-950 truncate">{p.paciente_nome}</p>
                            <p className="text-[10px] text-sus-900/60">
                              CNS: {p.paciente_cns || "—"} • Sexo: {p.paciente_sexo}
                              {p.paciente_idade !== null && ` • ${p.paciente_idade} anos`}
                            </p>
                            {p.cid10 && (
                              <p className="text-[10px] text-sus-900/70 font-semibold">
                                CID: {p.cid10}
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-sus-900/40 text-[11px] italic">
                            Consolidado (sem identificação)
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-sus-950 whitespace-nowrap">
                        {p.quantidade}
                      </td>
                      <td className="py-3 px-3 text-right text-sus-900/70 whitespace-nowrap">
                        {formatarMoeda(p.valor_unitario)}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-emerald-700 whitespace-nowrap">
                        {formatarMoeda(p.valor_total)}
                      </td>
                      <td className="py-3 px-4 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => abrirEdicao(p)}
                            title="Editar lançamento"
                            className="p-1 text-sus-900/60 hover:text-teal hover:bg-teal/10 rounded-lg transition-colors"
                          >
                            <Edit3 className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setExcluindoId(p.id)}
                            title="Excluir lançamento"
                            className="p-1 text-sus-900/60 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL DE NOVO LANÇAMENTO / EDIÇÃO */}
      {modalAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-sus-950/40 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl border border-sus-900/10 w-full max-w-2xl my-8 overflow-hidden animate-scale-up">
            {/* Cabeçalho do Modal */}
            <div className="flex items-center justify-between p-4 px-6 border-b border-sus-900/10 bg-sus-900/5">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-teal/15 text-teal rounded-xl">
                  {editandoId ? <Edit3 className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
                </div>
                <div>
                  <h3 className="text-base font-bold text-sus-950">
                    {editandoId ? "Editar Lançamento Ambulatorial" : "Novo Lançamento Ambulatorial"}
                  </h3>
                  <p className="text-xs text-sus-900/60">
                    Competência Ativa: <span className="font-bold text-sus-950">{formatarCompetenciaVisual(competencia)}</span>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setModalAberto(false)}
                className="p-1.5 rounded-lg text-sus-900/50 hover:bg-sus-900/10 hover:text-sus-950 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Formulário */}
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {erroForm && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-800 text-xs rounded-xl flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
                  <span>{erroForm}</span>
                </div>
              )}

              {/* Linha 1: Profissional e CBO */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-sus-950 mb-1">
                    Profissional de Saúde Executante *
                  </label>
                  <select
                    value={formMedicoId}
                    onChange={(e) => setFormMedicoId(e.target.value ? Number(e.target.value) : "")}
                    className="w-full text-xs font-medium rounded-xl border border-sus-900/20 bg-white px-3 py-2.5 text-sus-950 focus:outline-none focus:ring-2 focus:ring-teal/30"
                    required
                  >
                    <option value="">Selecione o profissional…</option>
                    {medicos.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.nome} ({m.crm ? `CRM ${m.crm}` : m.cbo_codigo || "Profissional"})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-sus-950 mb-1">
                    CBO Executante *
                  </label>
                  <input
                    type="text"
                    value={formCbo}
                    onChange={(e) => setFormCbo(e.target.value)}
                    placeholder="Ex: 225125"
                    maxLength={10}
                    className="w-full text-xs font-medium rounded-xl border border-sus-900/20 bg-white px-3 py-2.5 text-sus-950 focus:outline-none focus:ring-2 focus:ring-teal/30"
                    required
                  />
                </div>
              </div>

              {/* Linha 2: Unidade de Saúde e Equipe (INE) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-sus-950 mb-1">
                    Unidade de Saúde (CNES) *
                  </label>
                  <select
                    value={formUnidadeId}
                    onChange={(e) => setFormUnidadeId(e.target.value ? Number(e.target.value) : "")}
                    className="w-full text-xs font-medium rounded-xl border border-sus-900/20 bg-white px-3 py-2.5 text-sus-950 focus:outline-none focus:ring-2 focus:ring-teal/30"
                    required
                  >
                    <option value="">Selecione a unidade…</option>
                    {unidades.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.nome} {u.cnes ? `(CNES ${u.cnes})` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-sus-950 mb-1">
                    Equipe de Saúde (INE Opcional)
                  </label>
                  <select
                    value={formEquipeId}
                    onChange={(e) => setFormEquipeId(e.target.value ? Number(e.target.value) : "")}
                    className="w-full text-xs font-medium rounded-xl border border-sus-900/20 bg-white px-3 py-2.5 text-sus-950 focus:outline-none focus:ring-2 focus:ring-teal/30"
                  >
                    <option value="">Sem vínculo de equipe (UBS Geral)</option>
                    {equipesDisponiveisForm.map((eq) => (
                      <option key={eq.id} value={eq.id}>
                        {eq.nome_equipe} {eq.ine ? `(INE ${eq.ine})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Linha 3: Procedimento SIGTAP Autocomplete */}
              <div ref={procContainerRef} className="relative">
                <label className="block text-xs font-semibold text-sus-950 mb-1">
                  Procedimento do SIGTAP (Tabela Unificada) *
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-sus-900/40" />
                  <input
                    type="text"
                    value={buscaProcTexto}
                    onChange={(e) => {
                      setBuscaProcTexto(e.target.value);
                      if (procSelecionado && e.target.value !== `${procSelecionado.codigo} - ${procSelecionado.descricao}`) {
                        setProcSelecionado(null);
                      }
                    }}
                    onFocus={() => {
                      if (sugestoesProc.length > 0) setDropdownProcAberto(true);
                    }}
                    placeholder="Digite o código (10 dígitos) ou nome do procedimento…"
                    className="w-full text-xs rounded-xl border border-sus-900/20 bg-white pl-9 pr-8 py-2.5 text-sus-950 focus:outline-none focus:ring-2 focus:ring-teal/30"
                    required
                  />
                  {buscandoProc && (
                    <RefreshCw className="absolute right-3 top-3 h-4 w-4 animate-spin text-teal" />
                  )}
                </div>

                {/* Dropdown de sugestões do SIGTAP */}
                {dropdownProcAberto && sugestoesProc.length > 0 && (
                  <div className="absolute z-20 left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-white rounded-xl shadow-lg border border-sus-900/10 divide-y divide-sus-900/5">
                    {sugestoesProc.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setProcSelecionado(item);
                          setBuscaProcTexto(`${item.codigo} - ${item.descricao}`);
                          setDropdownProcAberto(false);
                        }}
                        className="w-full text-left p-3 hover:bg-sus-900/5 transition-colors flex items-start justify-between gap-3 text-xs"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-sus-950">{item.codigo}</span>
                            <span
                              className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                                item.instrumento === "BPA-I"
                                  ? "bg-teal/15 text-teal"
                                  : "bg-indigo-50 text-indigo-700"
                              }`}
                            >
                              {item.instrumento}
                            </span>
                          </div>
                          <p className="text-sus-900 mt-0.5">{item.descricao}</p>
                        </div>
                        <div className="text-right whitespace-nowrap shrink-0">
                          <p className="font-bold text-emerald-700">{formatarMoeda(item.valor_total)}</p>
                          <p className="text-[10px] text-sus-900/50">{item.pontos} pts</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* Card de Detalhes do Procedimento Selecionado */}
                {procSelecionado && (
                  <div className="mt-2 p-3 bg-sus-900/5 rounded-xl border border-sus-900/10 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sus-950">Instrumento Exigido:</span>
                      <span
                        className={`px-2 py-0.5 rounded-full font-bold ${
                          procSelecionado.instrumento === "BPA-I"
                            ? "bg-teal text-white"
                            : "bg-indigo-600 text-white"
                        }`}
                      >
                        {procSelecionado.instrumento}
                      </span>
                    </div>

                    <div className="flex items-center gap-4 text-sus-900/80">
                      <span>
                        Valor SUS: <strong className="text-emerald-700">{formatarMoeda(procSelecionado.valor_total)}</strong>
                      </span>
                      <span>
                        Sexo: <strong>{procSelecionado.sexo === "I" ? "Ambos" : procSelecionado.sexo}</strong>
                      </span>
                      {procSelecionado.idade_max > 0 && (
                        <span>
                          Faixa etária:{" "}
                          <strong>
                            {procSelecionado.idade_max > 150
                              ? `${Math.floor(procSelecionado.idade_min / 12)} a ${Math.floor(procSelecionado.idade_max / 12)} anos`
                              : `${procSelecionado.idade_min} a ${procSelecionado.idade_max} anos`}
                          </strong>
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Linha 4: Data Atendimento e Quantidade */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-sus-950 mb-1">
                    Data do Atendimento *
                  </label>
                  <input
                    type="date"
                    value={formDataAtendimento}
                    onChange={(e) => setFormDataAtendimento(e.target.value)}
                    className="w-full text-xs font-medium rounded-xl border border-sus-900/20 bg-white px-3 py-2.5 text-sus-950 focus:outline-none focus:ring-2 focus:ring-teal/30"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-sus-950 mb-1">
                    Quantidade de Procedimentos *
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={procSelecionado?.qtd_maxima ? procSelecionado.qtd_maxima : 9999}
                      value={formQuantidade}
                      onChange={(e) => setFormQuantidade(Math.max(1, parseInt(e.target.value, 10) || 1))}
                      className="w-full text-xs font-bold rounded-xl border border-sus-900/20 bg-white px-3 py-2.5 text-sus-950 focus:outline-none focus:ring-2 focus:ring-teal/30"
                      required
                    />
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setFormQuantidade((q) => q + 1)}
                        className="px-2.5 py-2 bg-sus-900/5 hover:bg-sus-900/10 rounded-lg text-xs font-bold text-sus-900"
                      >
                        +1
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormQuantidade((q) => q + 5)}
                        className="px-2.5 py-2 bg-sus-900/5 hover:bg-sus-900/10 rounded-lg text-xs font-bold text-sus-900"
                      >
                        +5
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* BLOCO CONDICIONAL BPA-I (INDIVIDUALIZADO) */}
              {procSelecionado?.instrumento === "BPA-I" && (
                <div className="p-4 bg-teal/5 border border-teal/20 rounded-2xl space-y-3.5">
                  <div className="flex items-center gap-2 text-teal font-bold text-xs uppercase tracking-wide">
                    <Users className="h-4 w-4" />
                    <span>Identificação Obrigatória do Paciente (BPA-I)</span>
                  </div>

                  {/* Busca Paciente Unificada do PEC */}
                  <BuscaPacienteAutocomplete
                    pacienteId={pacienteId}
                    pacienteInicial={pacienteObj}
                    onSelect={handleSelectPaciente}
                    label="Selecionar Paciente Cadastrado *"
                    placeholder="Digite nome, CPF ou CNS do paciente…"
                    obrigatorio={true}
                  />

                  {/* Dados Complementares do Paciente */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-sus-950 mb-1">
                        CNS do Paciente (15 dígitos) *
                      </label>
                      <input
                        type="text"
                        value={pacienteCns}
                        onChange={(e) => setPacienteCns(e.target.value)}
                        placeholder="Cartão Nacional de Saúde"
                        maxLength={15}
                        className="w-full text-xs font-medium rounded-xl border border-sus-900/20 bg-white px-3 py-2 text-sus-950 focus:outline-none focus:ring-2 focus:ring-teal/30"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-sus-950 mb-1">
                        Sexo *
                      </label>
                      <select
                        value={pacienteSexo}
                        onChange={(e) => setPacienteSexo(e.target.value)}
                        className="w-full text-xs font-medium rounded-xl border border-sus-900/20 bg-white px-3 py-2 text-sus-950 focus:outline-none focus:ring-2 focus:ring-teal/30"
                      >
                        <option value="M">M - Masculino</option>
                        <option value="F">F - Feminino</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-sus-950 mb-1">
                        Data de Nascimento *
                      </label>
                      <input
                        type="date"
                        value={pacienteNasc}
                        onChange={(e) => setPacienteNasc(e.target.value)}
                        className="w-full text-xs font-medium rounded-xl border border-sus-900/20 bg-white px-3 py-2 text-sus-950 focus:outline-none focus:ring-2 focus:ring-teal/30"
                        required
                      />
                    </div>
                  </div>

                  {/* Alerta de Incompatibilidade Visual */}
                  {avisoCompatibilidade && (
                    <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-xl flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold">Atenção às regras do SIGTAP:</p>
                        {avisoCompatibilidade.map((a, i) => (
                          <p key={i}>• {a}</p>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* CID-10 e Autorização */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <div ref={cidContainerRef} className="relative">
                      <label className="block text-xs font-semibold text-sus-950 mb-1">
                        CID-10 Principal
                      </label>
                      <input
                        type="text"
                        value={buscaCidTexto}
                        onChange={(e) => {
                          setBuscaCidTexto(e.target.value);
                          setCidSelecionado(e.target.value.toUpperCase());
                        }}
                        onFocus={() => {
                          if (sugestoesCid.length > 0) setDropdownCidAberto(true);
                        }}
                        placeholder="Buscar por código ou diagnóstico…"
                        className="w-full text-xs rounded-xl border border-sus-900/20 bg-white px-3 py-2 text-sus-950 uppercase focus:outline-none focus:ring-2 focus:ring-teal/30"
                      />

                      {dropdownCidAberto && sugestoesCid.length > 0 && (
                        <div className="absolute z-20 left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-white rounded-xl shadow-lg border border-sus-900/10 divide-y divide-sus-900/5">
                          {sugestoesCid.map((c) => (
                            <button
                              key={c.codigo}
                              type="button"
                              onClick={() => {
                                setCidSelecionado(c.codigo);
                                setBuscaCidTexto(`${c.codigo} - ${c.descricao}`);
                                setDropdownCidAberto(false);
                              }}
                              className="w-full text-left p-2.5 hover:bg-sus-900/5 text-xs transition-colors flex items-center justify-between"
                            >
                              <span className="font-mono font-bold text-sus-950">{c.codigo}</span>
                              <span className="text-sus-900/80 truncate ml-2 text-right">
                                {c.descricao}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-sus-950 mb-1">
                        Nº Autorização (APAC / APAC-SIA)
                      </label>
                      <input
                        type="text"
                        value={numeroAutorizacao}
                        onChange={(e) => setNumeroAutorizacao(e.target.value)}
                        placeholder="Opcional"
                        maxLength={20}
                        className="w-full text-xs font-medium rounded-xl border border-sus-900/20 bg-white px-3 py-2 text-sus-950 focus:outline-none focus:ring-2 focus:ring-teal/30"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Rodapé com Cálculo Total e Botões */}
              <div className="pt-3 border-t border-sus-900/10 flex items-center justify-between">
                <div>
                  <p className="text-[11px] text-sus-900/50">Valor Financeiro Total Previsto:</p>
                  <p className="text-lg font-bold text-emerald-700">
                    {formatarMoeda((procSelecionado?.valor_total || 0) * formQuantidade)}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setModalAberto(false)}
                    className="px-4 py-2 text-xs font-semibold rounded-xl text-sus-900/70 hover:bg-sus-900/5 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={salvando}
                    className="flex items-center gap-1.5 px-5 py-2.5 text-xs font-bold rounded-xl bg-teal hover:bg-teal/90 text-white shadow-xs transition-all active:scale-95 disabled:opacity-50"
                  >
                    {salvando ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        <span>Validando…</span>
                      </>
                    ) : (
                      <>
                        <FileCheck className="h-4 w-4" />
                        <span>Gravar Lançamento</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL DE CONFIRMAÇÃO DE EXCLUSÃO */}
      {excluindoId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-sus-950/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-sus-900/10 w-full max-w-sm p-6 text-center space-y-4 animate-scale-up">
            <div className="p-3 bg-red-50 text-red-600 rounded-full w-12 h-12 flex items-center justify-center mx-auto">
              <Trash2 className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-sus-950">Excluir Lançamento?</h3>
              <p className="text-xs text-sus-900/60 mt-1">
                Esta ação removerá permanentemente o lançamento da competência ativa.
              </p>
            </div>
            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                onClick={() => setExcluindoId(null)}
                className="px-4 py-2 text-xs font-semibold rounded-xl text-sus-900/70 hover:bg-sus-900/5 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmarExclusao}
                className="px-4 py-2 text-xs font-bold rounded-xl bg-red-600 hover:bg-red-700 text-white shadow-xs transition-colors"
              >
                Confirmar Exclusão
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
