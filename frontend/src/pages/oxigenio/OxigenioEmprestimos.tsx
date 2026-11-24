import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  ClipboardList,
  Plus,
  Search,
  Filter,
  User,
  Activity,
  Calendar,
  FileCheck2,
  Printer,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Building2,
  ArrowRightLeft,
  X,
  FileSpreadsheet,
  Edit2,
  Eye,
  LogOut,
  Package,
  Layers,
  Trash2,
} from "lucide-react";
import {
  oxigenioEmprestimos,
  oxigenioCriarEmprestimo,
  oxigenioEditarEmprestimo,
  oxigenioInativarEmprestimo,
  oxigenioEquipamentos,
  oxigenioEmpresas,
  oxigenioLicitacoes,
  oxigenioRegistrarTroca,
  oxigenioListarCilindrosVazios,
  oxigenioRecolherCilindroVazio,
  type EmprestimoOxigenio,
  type EquipamentoRespiratorio,
  type EmpresaOxigenio,
  type LicitacaoOxigenio,
  type Paciente,
  type CilindroVazio,
  type ItemEmprestimo,
} from "../../services/api";
import { Button, Input, Label, Badge } from "../../components/ui/primitives";
import BuscaPacienteAutocomplete from "../../components/BuscaPacienteAutocomplete";
import ExportarExcel from "../../components/ExportarExcel";
import ComprovanteEmprestimoModal from "./ComprovanteEmprestimoModal";

export interface ItemRascunho {
  id: string;
  tipo_item: "CILINDRO" | "MAQUINA";
  equipamento_id?: number | null;
  tipo_cilindro?: string | null;
  quantidade: number;
  finalidade_cilindro?: string | null;
  posse_cilindro: "PROPRIO" | "COMODATO";
  observacoes?: string;
}

export default function OxigenioEmprestimos() {
  const [emprestimos, setEmprestimos] = useState<EmprestimoOxigenio[]>([]);
  const [equipamentosDisponiveis, setEquipamentosDisponiveis] = useState<EquipamentoRespiratorio[]>([]);
  const [empresas, setEmpresas] = useState<EmpresaOxigenio[]>([]);
  const [licitacoes, setLicitacoes] = useState<LicitacaoOxigenio[]>([]);
  const [cilindrosVazios, setCilindrosVazios] = useState<CilindroVazio[]>([]);

  // Abas
  const [abaAtiva, setAbaAtiva] = useState<"emprestimos" | "cilindros_vazios">("emprestimos");

  // Filtros
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<string>("ATIVO");
  const [filtroServico, setFiltroServico] = useState<string>("");
  const [filtroEmpresa, setFiltroEmpresa] = useState<string>("");
  const [filtroTipoItem, setFiltroTipoItem] = useState<string>("");
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState("");

  // Modal Novo Empréstimo
  const [modalNovoAberto, setModalNovoAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [pacienteSelecionado, setPacienteSelecionado] = useState<Paciente | null>(null);

  // Multi-item no Atendimento
  const [itensAtendimento, setItensAtendimento] = useState<ItemRascunho[]>([]);
  const [itemAtual, setItemAtual] = useState<ItemRascunho>({
    id: "1",
    tipo_item: "OXIGENIO" as any,
    tipo_cilindro: "10m3",
    finalidade_cilindro: "SEMANAL_CONCENTRADOR",
    quantidade: 1,
    equipamento_id: null,
    posse_cilindro: "PROPRIO",
    observacoes: "",
  });

  const [formNovo, setFormNovo] = useState({
    empresa_id: "",
    licitacao_id: "",
    data_instalacao: new Date().toISOString().slice(0, 10),
    data_prevista_troca: "",
    responsavel_retirada_nome: "",
    responsavel_retirada_cpf: "",
    responsavel_retirada_parentesco: "Próprio paciente",
    medico_prescritor: "",
    cid_diagnostico: "",
    fluxo_oxigenio_litros_min: 2,
    pressao_cpap_bipap: "",
    termo_assinado: true,
    observacoes: "",
  });

  // Modal Devolver / Inativar
  const [modalInativarAberto, setModalInativarAberto] = useState(false);
  const [emprestimoParaInativar, setEmprestimoParaInativar] = useState<EmprestimoOxigenio | null>(null);
  const [formInativar, setFormInativar] = useState({
    data_devolucao: new Date().toISOString().slice(0, 10),
    motivo_inativacao: "ALTA",
    observacoes: "",
  });

  // Modal Recolher Cilindro Vazio
  const [modalRecolherAberto, setModalRecolherAberto] = useState(false);
  const [cilindroParaRecolher, setCilindroParaRecolher] = useState<CilindroVazio | null>(null);
  const [formRecolher, setFormRecolher] = useState({
    data_recolhimento: new Date().toISOString().slice(0, 10),
    recolhido_por: "",
    empresa_id: "",
    observacoes: "",
  });

  // Modal Comprovante
  const [comprovanteId, setComprovanteId] = useState<number | null>(null);

  const carregarDados = async () => {
    setCarregando(true);
    setErro("");
    try {
      const [resEmp, resEquipDisp, resEmpresas, resLic, resVazios] = await Promise.all([
        oxigenioEmprestimos({
          status: filtroStatus || undefined,
          tipo_servico: filtroServico || undefined,
          empresa_id: filtroEmpresa ? Number(filtroEmpresa) : undefined,
          q: busca || undefined,
        }),
        oxigenioEquipamentos({ status: "DISPONIVEL" }),
        oxigenioEmpresas({ apenas_ativas: true }),
        oxigenioLicitacoes({ apenas_ativas: true }),
        oxigenioListarCilindrosVazios(),
      ]);
      setEmprestimos(resEmp);
      setEquipamentosDisponiveis(resEquipDisp);
      setEmpresas(resEmpresas);
      setLicitacoes(resLic);
      setCilindrosVazios(resVazios);
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Erro ao carregar lista de empréstimos");
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregarDados();
  }, [filtroStatus, filtroServico, filtroEmpresa]);

  useEffect(() => {
    if (modalNovoAberto || modalInativarAberto || modalRecolherAberto) {
      document.body.classList.add("modal-aberto");
      return () => {
        document.body.classList.remove("modal-aberto");
      };
    }
  }, [modalNovoAberto, modalInativarAberto, modalRecolherAberto]);

  const abrirModalNovo = () => {
    setPacienteSelecionado(null);
    setItensAtendimento([]);
    setItemAtual({
      id: "1",
      tipo_item: "CILINDRO",
      tipo_cilindro: "10m3",
      finalidade_cilindro: "SEMANAL_CONCENTRADOR",
      quantidade: 1,
      equipamento_id: null,
      posse_cilindro: "PROPRIO",
      observacoes: "",
    });
    setFormNovo({
      empresa_id: "",
      licitacao_id: "",
      data_instalacao: new Date().toISOString().slice(0, 10),
      data_prevista_troca: "",
      responsavel_retirada_nome: "",
      responsavel_retirada_cpf: "",
      responsavel_retirada_parentesco: "Próprio paciente",
      medico_prescritor: "",
      cid_diagnostico: "",
      fluxo_oxigenio_litros_min: 2,
      pressao_cpap_bipap: "",
      termo_assinado: true,
      observacoes: "",
    });
    setModalNovoAberto(true);
  };

  const adicionarItemAoAtendimento = () => {
    if (itemAtual.tipo_item === "MAQUINA" && !itemAtual.equipamento_id) {
      setErro("Selecione um equipamento disponível antes de adicionar");
      return;
    }
    if (itemAtual.tipo_item === "CILINDRO" && (!itemAtual.tipo_cilindro || itemAtual.quantidade <= 0)) {
      setErro("Informe o tipo e quantidade válida de cilindro");
      return;
    }
    setItensAtendimento([...itensAtendimento, { ...itemAtual, id: String(Date.now()) }]);
    setItemAtual({
      id: String(Date.now() + 1),
      tipo_item: "CILINDRO",
      tipo_cilindro: "10m3",
      finalidade_cilindro: "SEMANAL_CONCENTRADOR",
      quantidade: 1,
      equipamento_id: null,
      posse_cilindro: "PROPRIO",
      observacoes: "",
    });
    setErro("");
  };

  const removerItemDoAtendimento = (id: string) => {
    setItensAtendimento(itensAtendimento.filter((it) => it.id !== id));
  };

  const handleSalvarNovoEmprestimo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pacienteSelecionado) {
      setErro("Selecione um paciente para o empréstimo");
      return;
    }

    // Se a lista de múltiplos itens estiver vazia, verifica se o itemAtual em edição é válido
    const itensFinais = [...itensAtendimento];
    if (itensFinais.length === 0) {
      if (itemAtual.tipo_item === "MAQUINA" && !itemAtual.equipamento_id) {
        setErro("Selecione um equipamento disponível ou adicione um item");
        return;
      }
      itensFinais.push({ ...itemAtual });
    }

    setSalvando(true);
    setErro("");
    try {
      const primeiroItem = itensFinais[0];
      const tipoServicoRaiz = itensFinais.some(i => i.tipo_item === "MAQUINA") ? "MAQUINA" : "OXIGENIO";

      const payload: any = {
        paciente_id: pacienteSelecionado.id,
        paciente_nome: pacienteSelecionado.nome,
        paciente_cpf: pacienteSelecionado.cpf || "",
        paciente_cns: pacienteSelecionado.cns || "",
        paciente_prontuario: pacienteSelecionado.codigo_prontuario || "",
        paciente_telefone: pacienteSelecionado.telefone || "",
        paciente_endereco: pacienteSelecionado.endereco || "",
        tipo_servico: tipoServicoRaiz,
        equipamento_id: primeiroItem.tipo_item === "MAQUINA" ? primeiroItem.equipamento_id : null,
        tipo_cilindro: primeiroItem.tipo_item === "CILINDRO" ? primeiroItem.tipo_cilindro : null,
        finalidade_cilindro: primeiroItem.tipo_item === "CILINDRO" ? primeiroItem.finalidade_cilindro : null,
        posse_cilindro: primeiroItem.posse_cilindro || "PROPRIO",
        quantidade: primeiroItem.quantidade || 1,
        empresa_id: formNovo.empresa_id ? Number(formNovo.empresa_id) : null,
        licitacao_id: formNovo.licitacao_id ? Number(formNovo.licitacao_id) : null,
        data_instalacao: formNovo.data_instalacao,
        data_prevista_troca: formNovo.data_prevista_troca || null,
        responsavel_retirada_nome: formNovo.responsavel_retirada_nome || pacienteSelecionado.nome,
        responsavel_retirada_cpf: formNovo.responsavel_retirada_cpf || pacienteSelecionado.cpf || "",
        responsavel_retirada_parentesco: formNovo.responsavel_retirada_parentesco,
        medico_prescritor: formNovo.medico_prescritor,
        cid_diagnostico: formNovo.cid_diagnostico,
        fluxo_oxigenio_litros_min: formNovo.fluxo_oxigenio_litros_min ? Number(formNovo.fluxo_oxigenio_litros_min) : null,
        pressao_cpap_bipap: formNovo.pressao_cpap_bipap || null,
        termo_assinado: formNovo.termo_assinado,
        observacoes: formNovo.observacoes,
        itens: itensFinais.map((it) => ({
          tipo_item: it.tipo_item,
          equipamento_id: it.tipo_item === "MAQUINA" ? Number(it.equipamento_id) : null,
          tipo_cilindro: it.tipo_item === "CILINDRO" ? it.tipo_cilindro : null,
          quantidade: Number(it.quantidade) || 1,
          finalidade_cilindro: it.tipo_item === "CILINDRO" ? it.finalidade_cilindro : null,
          posse_cilindro: it.posse_cilindro || "PROPRIO",
          observacoes: it.observacoes,
        })),
      };

      const criado = await oxigenioCriarEmprestimo(payload);
      setSucesso(`Atendimento registrado com sucesso! Termo Nº ${criado.codigo_termo}`);
      setModalNovoAberto(false);
      carregarDados();
      // Abre automaticamente o comprovante para conferência ou impressão
      setComprovanteId(criado.id);
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Erro ao registrar saída de oxigênio/máquina");
    } finally {
      setSalvando(false);
    }
  };

  const abrirModalRecolher = (cil: CilindroVazio) => {
    setCilindroParaRecolher(cil);
    setFormRecolher({
      data_recolhimento: new Date().toISOString().slice(0, 10),
      recolhido_por: "",
      empresa_id: cil.empresa_id ? String(cil.empresa_id) : "",
      observacoes: "",
    });
    setModalRecolherAberto(true);
  };

  const handleConfirmarRecolhimento = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cilindroParaRecolher) return;
    setSalvando(true);
    setErro("");
    try {
      await oxigenioRecolherCilindroVazio(cilindroParaRecolher.id, {
        data_recolhimento: formRecolher.data_recolhimento,
        recolhido_por: formRecolher.recolhido_por,
        empresa_id: formRecolher.empresa_id ? Number(formRecolher.empresa_id) : undefined,
        observacoes: formRecolher.observacoes,
      });
      setSucesso("Recolhimento do cilindro vazio registrado com sucesso!");
      setModalRecolherAberto(false);
      carregarDados();
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Erro ao registrar recolhimento");
    } finally {
      setSalvando(false);
    }
  };

  const abrirModalInativar = (emp: EmprestimoOxigenio) => {
    setEmprestimoParaInativar(emp);
    setFormInativar({
      data_devolucao: new Date().toISOString().slice(0, 10),
      motivo_inativacao: "ALTA",
      observacoes: "",
    });
    setModalInativarAberto(true);
  };

  const handleConfirmarInativacao = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emprestimoParaInativar) return;

    setSalvando(true);
    setErro("");
    try {
      await oxigenioInativarEmprestimo(emprestimoParaInativar.id, {
        data_devolucao: formInativar.data_devolucao,
        motivo_inativacao: formInativar.motivo_inativacao,
        observacoes: formInativar.observacoes,
      });
      setSucesso("Empréstimo encerrado e item devolvido ao estoque com sucesso!");
      setModalInativarAberto(false);
      carregarDados();
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Erro ao inativar empréstimo");
    } finally {
      setSalvando(false);
    }
  };

  const emprestimosFiltrados = emprestimos.filter((emp) => {
    if (!filtroTipoItem) return true;
    if (filtroTipoItem === "CPAP" || filtroTipoItem === "BiPAP" || filtroTipoItem.startsWith("CONCENTRADOR")) {
      if (filtroTipoItem === "CONCENTRADOR_5L") {
        return emp.tipo_equipamento === "CONCENTRADOR_5L" || emp.tipo_equipamento === "CONCENTRADOR" || (emp.itens_resumo || "").includes("5L") || (emp.itens_resumo || "").toUpperCase().includes("CONCENTRADOR");
      }
      if (filtroTipoItem === "CONCENTRADOR_10L") {
        return emp.tipo_equipamento === "CONCENTRADOR_10L" || (emp.itens_resumo || "").includes("10L");
      }
      const matchServico = emp.tipo_equipamento?.toUpperCase().includes(filtroTipoItem.toUpperCase());
      const matchResumo = emp.itens_resumo?.toUpperCase().includes(filtroTipoItem.toUpperCase());
      return matchServico || matchResumo;
    }
    if (filtroTipoItem.includes("m3") || filtroTipoItem.includes("m³")) {
      const termoNorm = filtroTipoItem.replace("m3", "m³");
      const matchCil = emp.tipo_cilindro?.replace("m3", "m³") === termoNorm;
      const matchResumo = emp.itens_resumo?.replace("m3", "m³").includes(termoNorm);
      return matchCil || matchResumo;
    }
    return true;
  });

  const empresaSelecionadaForm = empresas.find((e) => e.id === Number(formNovo.empresa_id));
  const escopoEmpresa = empresaSelecionadaForm?.servicos_prestados || "AMBOS";
  const permiteMaquinas = escopoEmpresa === "LOCACAO_MAQUINAS" || escopoEmpresa === "AMBOS";
  const permiteOxigenio = escopoEmpresa === "FORNECIMENTO_OXIGENIO" || escopoEmpresa === "AMBOS";

  const equipamentosDisponiveisFiltrados = formNovo.empresa_id
    ? equipamentosDisponiveis.filter((eq) => !eq.empresa_id || eq.empresa_id === Number(formNovo.empresa_id))
    : equipamentosDisponiveis;

  const licitacaoEmpresa = licitacoes.find((l) => l.empresa_id === Number(formNovo.empresa_id));

  const totalVaziosPendentes = cilindrosVazios.filter((c) => c.status === "PENDENTE").length;

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Cabeçalho da Página */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-teal/10 text-teal">
            <ClipboardList className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-xl md:text-2xl font-bold text-sus-950">
                Empréstimos & Saídas de Equipamentos
              </h1>
              {totalVaziosPendentes > 0 && (
                <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-amber-500 text-slate-900 animate-pulse">
                  {totalVaziosPendentes} cilindro(s) vazio(s) pendente(s)
                </span>
              )}
            </div>
            <p className="text-xs text-ink/60 mt-0.5">
              Controle de cessão para pacientes, termos múltiplos e recolhimento de cilindros vazios
            </p>
          </div>
        </div>
      </div>

      {erro && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl flex items-center justify-between text-sm shadow-sm">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
            <span>{erro}</span>
          </div>
          <button onClick={() => setErro("")} className="text-rose-500 hover:text-rose-700 font-bold">×</button>
        </div>
      )}

      {sucesso && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl flex items-center justify-between text-sm shadow-sm">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span>{sucesso}</span>
          </div>
          <button onClick={() => setSucesso("")} className="text-emerald-500 hover:text-emerald-700 font-bold">×</button>
        </div>
      )}

      {/* ABAS SUPERIORES */}
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 pt-2 rounded-t-xl shadow-sm">
        <button
          onClick={() => setAbaAtiva("emprestimos")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs md:text-sm font-semibold border-b-2 transition-colors ${
            abaAtiva === "emprestimos"
              ? "border-sky-600 text-sky-700 bg-sky-50/50 rounded-t-lg"
              : "border-transparent text-slate-600 hover:text-slate-900"
          }`}
        >
          <ClipboardList className="w-4 h-4" />
          <span>Atendimentos & Empréstimos ({emprestimos.length})</span>
        </button>

        <button
          onClick={() => setAbaAtiva("cilindros_vazios")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs md:text-sm font-semibold border-b-2 transition-colors ${
            abaAtiva === "cilindros_vazios"
              ? "border-amber-600 text-amber-700 bg-amber-50/50 rounded-t-lg"
              : "border-transparent text-slate-600 hover:text-slate-900"
          }`}
        >
          <Package className="w-4 h-4" />
          <span>Cilindros Vazios a Recolher ({totalVaziosPendentes})</span>
          {totalVaziosPendentes > 0 && (
            <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-rose-500 text-white animate-pulse">
              {totalVaziosPendentes}
            </span>
          )}
        </button>
      </div>

      {abaAtiva === "emprestimos" && (
        <>
          {/* BARRA DE AÇÕES & FILTROS */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <div className="relative min-w-[220px]">
                  <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                  <Input
                    placeholder="Buscar paciente, CPF, termo..."
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    className="pl-9 text-xs"
                  />
                </div>

                <select
                  value={filtroStatus}
                  onChange={(e) => setFiltroStatus(e.target.value)}
                  className="px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white"
                >
                  <option value="ATIVO">Apenas Ativos (Em Uso)</option>
                  <option value="INATIVO">Inativos / Devolvidos</option>
                  <option value="">Todos os Status</option>
                </select>

                <select
                  value={filtroServico}
                  onChange={(e) => setFiltroServico(e.target.value)}
                  className="px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white"
                >
                  <option value="">Todos os Serviços</option>
                  <option value="OXIGENIO">Cilindro de Oxigênio</option>
                  <option value="MAQUINA">Máquina Respiratória (CPAP/BiPAP/Conc)</option>
                </select>

                <select
                  value={filtroEmpresa}
                  onChange={(e) => setFiltroEmpresa(e.target.value)}
                  className="px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white"
                >
                  <option value="">Todas as Empresas</option>
                  {empresas.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.nome_fantasia || emp.razao_social || emp.nome}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  onClick={abrirModalNovo}
                  className="bg-sky-600 hover:bg-sky-700 text-white flex items-center gap-2 text-xs shadow-sm"
                >
                  <Plus className="w-4 h-4" />
                  <span>Novo Empréstimo / Saída Rápida</span>
                </Button>
                <ExportarExcel
                  url="/api/oxigenio/exportar"
                  params={{ tipo: "emprestimos", empresa_id: filtroEmpresa ? Number(filtroEmpresa) : undefined }}
                  arquivo="oxigenio_emprestimos_saidas"
                  rotulo="Exportar Excel"
                />
              </div>
            </div>

            {/* CHIPS DE FILTRO RÁPIDO POR TIPO DE EQUIPAMENTO / CILINDRO */}
            <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100 text-xs">
              <span className="text-slate-500 font-medium mr-1 flex items-center gap-1">
                <Filter className="w-3.5 h-3.5" />
                Tipo de Item:
              </span>
              {[
                { label: "Todos", value: "" },
                { label: "Concentrador (Todos)", value: "CONCENTRADOR" },
                { label: "Conc. 5L", value: "CONCENTRADOR_5L" },
                { label: "Conc. 10L", value: "CONCENTRADOR_10L" },
                { label: "CPAP", value: "CPAP" },
                { label: "BiPAP", value: "BiPAP" },
                { label: "Cilindro 10m³", value: "10m³" },
                { label: "Cilindro 3m³", value: "3m³" },
                { label: "Cilindro 1m³", value: "1m³" },
              ].map((chip) => (
                <button
                  key={chip.value}
                  onClick={() => setFiltroTipoItem(chip.value)}
                  className={`px-2.5 py-1 rounded-full text-xs transition-colors ${
                    filtroTipoItem === chip.value
                      ? "bg-sky-600 text-white font-semibold shadow-sm"
                      : "bg-slate-100 hover:bg-slate-200 text-slate-700"
                  }`}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>

          {/* TABELA DE EMPRÉSTIMOS / SAÍDAS */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-sky-50 text-sky-700 rounded-xl">
                  <ClipboardList className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base md:text-lg">Registros de Saídas e Empréstimos</h3>
                  <p className="text-xs text-slate-500">Histórico detalhado de termos ativos e devoluções</p>
                </div>
              </div>
              <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-3 py-1 rounded-full border border-slate-200">
                Total listado: {emprestimosFiltrados.length} registro(s)
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-700">
                <thead className="bg-slate-50 text-slate-600 uppercase text-xs font-bold tracking-wider border-y border-slate-200">
                  <tr>
                    <th className="py-3.5 px-4">Termo Nº</th>
                    <th className="py-3.5 px-4">Paciente / Prontuário</th>
                    <th className="py-3.5 px-4">Itens Fornecidos</th>
                    <th className="py-3.5 px-4">Instalação / Prazo Troca</th>
                    <th className="py-3.5 px-4">Prescrição Médica</th>
                    <th className="py-3.5 px-4">Status</th>
                    <th className="py-3.5 px-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {emprestimosFiltrados.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-12 text-slate-400 text-sm">
                        Nenhum registro de empréstimo encontrado.
                      </td>
                    </tr>
                  ) : (
                    emprestimosFiltrados.map((emp) => (
                      <tr key={emp.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-4 px-4 font-mono font-bold text-sky-800 text-sm">
                          {emp.codigo_termo}
                        </td>
                        <td className="py-4 px-4">
                          <div className="font-bold text-slate-900 text-sm">{emp.paciente_nome}</div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            CPF: {emp.paciente_cpf || "—"} · Pront: {emp.paciente_prontuario || "—"}
                          </div>
                          <div className="text-xs text-slate-400 truncate max-w-xs">{emp.paciente_endereco}</div>
                        </td>
                        <td className="py-4 px-4">
                          {(emp.tipo_servico === "MAQUINA" || emp.tipo_servico === "EQUIPAMENTO" || emp.tipo_servico === "MISTO") ? (
                            <div className="space-y-1">
                              <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-indigo-100 text-indigo-800 inline-block">
                                Máquina: {emp.tipo_equipamento === "CONCENTRADOR_5L" ? "Concentrador 5L" :
                                          emp.tipo_equipamento === "CONCENTRADOR_10L" ? "Concentrador 10L" :
                                          emp.tipo_equipamento === "CONCENTRADOR" ? "Concentrador 5L" :
                                          emp.tipo_equipamento || "Equipamento"}
                              </span>
                              <div className="text-xs text-slate-600 font-mono">
                                Série: {emp.equipamento_serie || "—"}
                              </div>
                              {emp.itens && emp.itens.filter((it) => it.acompanha_equipamento).map((it, idx) => (
                                <div key={idx} className="text-xs text-emerald-700 font-medium">
                                  + Cilindro de apoio {it.tipo_cilindro?.replace("m3", "m³")} ({it.quantidade}x — acompanha concentrador)
                                </div>
                              ))}
                              {(!emp.itens || emp.itens.length === 0) && emp.itens_resumo && (
                                <div className="text-xs text-slate-600">{emp.itens_resumo}</div>
                              )}
                            </div>
                          ) : emp.itens_resumo ? (
                            <div>
                              <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-sky-100 text-sky-800">
                                {emp.itens_resumo}
                              </span>
                            </div>
                          ) : (
                            <div>
                              <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-sky-100 text-sky-800">
                                Cilindro {emp.tipo_cilindro?.replace("m3", "m³")} ({emp.quantidade}x)
                              </span>
                              {emp.posse_cilindro === "COMODATO" && (
                                <span className="ml-1 px-1.5 py-0.5 text-[10px] rounded font-bold bg-amber-100 text-amber-800">
                                  Comodato
                                </span>
                              )}
                              <div className="text-xs text-slate-500 mt-1">
                                {emp.finalidade_cilindro === "SEMANAL_CONCENTRADOR" ? "Troca Semanal" :
                                 emp.finalidade_cilindro === "FIXO_CONCENTRADOR" ? "Fixo Reserva 3m³" :
                                 emp.finalidade_cilindro === "TRANSPORTE_ESPECIAL" ? "Transporte Especial" :
                                 "Uso Contínuo"}
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="py-4 px-4 font-mono text-xs">
                          <div>Inst: {new Date(emp.data_instalacao).toLocaleDateString("pt-BR")}</div>
                          {emp.data_prevista_troca && (
                            <div className="text-xs text-sky-700 font-bold mt-0.5">
                              Próx: {new Date(emp.data_prevista_troca).toLocaleDateString("pt-BR")}
                            </div>
                          )}
                        </td>
                        <td className="py-4 px-4 text-xs">
                          <div>Dr(a): <strong>{emp.medico_prescritor || "—"}</strong></div>
                          <div className="text-slate-500 mt-0.5">
                            {emp.fluxo_oxigenio_litros_min ? `Fluxo: ${emp.fluxo_oxigenio_litros_min} L/min` : ""}
                            {emp.pressao_cpap_bipap ? `Pressão: ${emp.pressao_cpap_bipap}` : ""}
                            {emp.cid_diagnostico ? ` · CID: ${emp.cid_diagnostico}` : ""}
                          </div>
                        </td>
                        <td className="py-4 px-4">
                          {emp.status === "ATIVO" ? (
                            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 inline-flex items-center gap-1.5">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Ativo em Uso
                            </span>
                          ) : (
                            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-200 text-slate-700">
                              Devolvido / Inativo
                            </span>
                          )}
                        </td>
                        <td className="py-4 px-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setComprovanteId(emp.id)}
                              title="Imprimir Comprovante / Termo de Responsabilidade"
                              className="text-sky-700 border-sky-300 hover:bg-sky-50 text-xs font-semibold flex items-center gap-1.5 h-8 px-3"
                            >
                              <Printer className="w-3.5 h-3.5" />
                              <span>Termo</span>
                            </Button>

                            {emp.status === "ATIVO" && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => abrirModalInativar(emp)}
                                title="Encerrar empréstimo / Devolver item"
                                className="text-rose-700 border-rose-300 hover:bg-rose-50 text-xs font-semibold flex items-center gap-1.5 h-8 px-3"
                              >
                                <LogOut className="w-3.5 h-3.5" />
                                <span>Devolver</span>
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ABA 2: CILINDROS VAZIOS A RECOLHER */}
      {abaAtiva === "cilindros_vazios" && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden p-6 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-amber-50 text-amber-700 rounded-xl">
                  <Package className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base md:text-lg">Rastreio de Cilindros Vazios Pendentes de Recolhimento</h3>
                  <p className="text-xs text-slate-500">
                    Gerados automaticamente na substituição ou troca de cilindros de pacientes e em migrações contratuais
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-700">
              <thead className="bg-slate-50 text-slate-600 uppercase text-xs font-bold tracking-wider border-y border-slate-200">
                <tr>
                  <th className="py-3.5 px-4">Data do Esvaziamento</th>
                  <th className="py-3.5 px-4">Paciente / Origem</th>
                  <th className="py-3.5 px-4">Tipo de Cilindro</th>
                  <th className="py-3.5 px-4">Quantidade</th>
                  <th className="py-3.5 px-4">Motivo</th>
                  <th className="py-3.5 px-4">Status Coleta</th>
                  <th className="py-3.5 px-4 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cilindrosVazios.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-slate-400 text-sm">
                      Nenhum cilindro vazio registrado no momento.
                    </td>
                  </tr>
                ) : (
                  cilindrosVazios.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-4 px-4 font-mono text-xs">
                        {new Date(c.data_geracao).toLocaleDateString("pt-BR")}
                      </td>
                      <td className="py-4 px-4 font-bold text-slate-900 text-sm">
                        {c.paciente_nome}
                      </td>
                      <td className="py-4 px-4">
                        <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-100 text-amber-900">
                          Cilindro {c.tipo_cilindro.replace("m3", "m³")}
                        </span>
                      </td>
                      <td className="py-4 px-4 font-bold text-sm">
                        {c.quantidade} unid(s)
                      </td>
                      <td className="py-4 px-4 text-slate-600 text-xs">
                        {c.motivo_origem === "TROCA_SEMANAL" ? "Troca de Cilindro" :
                         c.motivo_origem === "MIGRACAO_EMPRESA" ? "Migração Contratual" :
                         c.motivo_origem}
                      </td>
                      <td className="py-4 px-4">
                        {c.status === "PENDENTE" ? (
                          <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-rose-100 text-rose-800 inline-flex items-center gap-1.5 animate-pulse">
                            <Clock className="w-3.5 h-3.5" />
                            Aguardando Coleta
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-emerald-100 text-emerald-800 inline-flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Recolhido em {c.data_recolhimento ? new Date(c.data_recolhimento).toLocaleDateString("pt-BR") : ""}
                          </span>
                        )}
                      </td>
                      <td className="py-4 px-4 text-right">
                        {c.status === "PENDENTE" && (
                          <Button
                            size="sm"
                            onClick={() => abrirModalRecolher(c)}
                            className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold h-8 px-3"
                          >
                            Registrar Coleta
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL: NOVO EMPRÉSTIMO / SAÍDA RÁPIDA */}
      {modalNovoAberto &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 md:p-6 overflow-y-auto print:hidden">
            <div
              className="fixed -inset-10 bg-slate-900/65 backdrop-blur-md animate-in fade-in duration-150"
              onClick={() => setModalNovoAberto(false)}
              aria-hidden="true"
            />
            <div className="relative z-10 bg-white rounded-2xl shadow-2xl max-w-5xl xl:max-w-6xl w-full flex flex-col max-h-[92vh] overflow-hidden border border-slate-200 animate-in zoom-in-95 duration-150">
              <div className="px-6 py-4 bg-sky-900 text-white flex justify-between items-center shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-sky-800/80 rounded-xl text-sky-300">
                    <ClipboardList className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-base md:text-lg">Novo Empréstimo & Termo de Retirada</h3>
                    <p className="text-xs text-sky-200">Cessão e entrega de cilindros e equipamentos respiratórios</p>
                  </div>
                </div>
                <button
                  onClick={() => setModalNovoAberto(false)}
                  className="rounded-xl p-1.5 text-white/80 hover:bg-white/10 hover:text-white transition"
                  title="Fechar"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSalvarNovoEmprestimo} className="flex flex-col flex-1 overflow-hidden min-h-0">
                <div className="flex-1 overflow-y-auto p-6 space-y-5 text-sm text-slate-700 overscroll-contain">
                  {/* Autocomplete de Paciente */}
                  <div className="space-y-1.5">
                    <Label className="text-sm font-bold text-slate-800">Paciente Beneficiário *</Label>
                    <BuscaPacienteAutocomplete
                      pacienteId={pacienteSelecionado?.id || ""}
                      onSelect={(p) => setPacienteSelecionado(p)}
                      obrigatorio={true}
                      placeholder="Pesquise o paciente por nome, CPF ou CNS..."
                    />
                    {pacienteSelecionado && (
                      <div className="mt-2.5 p-3.5 bg-sky-50/60 border border-sky-200 rounded-xl text-slate-800 text-xs md:text-sm grid grid-cols-1 sm:grid-cols-3 gap-2.5 shadow-xs">
                        <div><span className="text-slate-500 font-medium">CPF:</span> <strong>{pacienteSelecionado.cpf || "—"}</strong></div>
                        <div><span className="text-slate-500 font-medium">Prontuário:</span> <strong>{pacienteSelecionado.codigo_prontuario || "—"}</strong></div>
                        <div><span className="text-slate-500 font-medium">Cartão SUS:</span> <strong>{pacienteSelecionado.cns || "—"}</strong></div>
                        <div className="sm:col-span-3 pt-1 border-t border-sky-100 text-slate-600">
                          <span className="text-slate-500 font-medium">Endereço:</span> <strong>{pacienteSelecionado.endereco || "Não informado"}</strong>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Empresa Fornecedora & Preços Contratados */}
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                    <div>
                      <Label className="text-sm font-bold text-slate-800">Empresa Fornecedora / Contratada</Label>
                      <select
                        value={formNovo.empresa_id}
                        onChange={(e) => {
                          const novaEmpresaId = e.target.value;
                          const lic = licitacoes.find(l => l.empresa_id === Number(novaEmpresaId));
                          setFormNovo({
                            ...formNovo,
                            empresa_id: novaEmpresaId,
                            licitacao_id: lic ? String(lic.id) : "",
                          });
                        }}
                        className="w-full mt-1.5 px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 bg-white shadow-xs focus:ring-2 focus:ring-sky-500 font-medium"
                      >
                        <option value="">Selecione o Fornecedor (ou deixe vazio para próprio / municipal)</option>
                        {empresas.map((emp) => (
                          <option key={emp.id} value={emp.id}>
                            {emp.nome_fantasia || emp.razao_social || emp.nome} — [{emp.servicos_prestados === "LOCACAO_MAQUINAS" ? "Apenas Máquinas" : emp.servicos_prestados === "FORNECIMENTO_OXIGENIO" ? "Apenas Oxigênio" : "Máquinas & Oxigênio"}]
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Banner de Preços Unitários Contratados */}
                    {formNovo.empresa_id && empresaSelecionadaForm && (
                      <div className="p-3.5 bg-sky-50/80 border border-sky-200 rounded-xl text-xs md:text-sm text-sky-900 space-y-2">
                        <div className="font-bold flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Building2 className="w-4 h-4 text-sky-700" />
                            <span>
                              Tabela de Preços: {empresaSelecionadaForm.nome_fantasia || empresaSelecionadaForm.razao_social || empresaSelecionadaForm.nome}
                              {licitacaoEmpresa?.numero_licitacao ? ` (Licitação ${licitacaoEmpresa.numero_licitacao})` : ""}
                            </span>
                          </div>
                          <span className="text-xs bg-sky-200 text-sky-800 px-2.5 py-0.5 rounded-full font-semibold">Preços Cadastrados</span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5 text-slate-800 pt-1">
                          <div className="bg-white p-2.5 rounded-lg border border-sky-100"><span className="text-slate-500 block text-xs">Recarga O2</span> <strong>R$ {((empresaSelecionadaForm.valor_recarga_m3 || licitacaoEmpresa?.valor_recarga_m3) ?? 0) > 0 ? ((empresaSelecionadaForm.valor_recarga_m3 || licitacaoEmpresa?.valor_recarga_m3)!).toFixed(2) : "—"}/m³</strong></div>
                          <div className="bg-white p-2.5 rounded-lg border border-sky-100"><span className="text-slate-500 block text-xs">Cilindro 10m³</span> <strong>R$ {((empresaSelecionadaForm.valor_unitario_10m3 || licitacaoEmpresa?.valor_unitario_10m3) ?? 0) > 0 ? ((empresaSelecionadaForm.valor_unitario_10m3 || licitacaoEmpresa?.valor_unitario_10m3)!).toFixed(2) : "—"}</strong></div>
                          <div className="bg-white p-2.5 rounded-lg border border-sky-100"><span className="text-slate-500 block text-xs">Conc. 5L</span> <strong>R$ {((empresaSelecionadaForm.locacao_mensal_concentrador_5l || empresaSelecionadaForm.locacao_mensal_concentrador || licitacaoEmpresa?.locacao_mensal_concentrador_5l || licitacaoEmpresa?.locacao_mensal_concentrador) ?? 0) > 0 ? ((empresaSelecionadaForm.locacao_mensal_concentrador_5l || empresaSelecionadaForm.locacao_mensal_concentrador || licitacaoEmpresa?.locacao_mensal_concentrador_5l || licitacaoEmpresa?.locacao_mensal_concentrador)!).toFixed(2) : "—"}/mês</strong></div>
                          <div className="bg-white p-2.5 rounded-lg border border-sky-100"><span className="text-slate-500 block text-xs">Conc. 10L</span> <strong>R$ {((empresaSelecionadaForm.locacao_mensal_concentrador_10l || licitacaoEmpresa?.locacao_mensal_concentrador_10l) ?? 0) > 0 ? ((empresaSelecionadaForm.locacao_mensal_concentrador_10l || licitacaoEmpresa?.locacao_mensal_concentrador_10l)!).toFixed(2) : "—"}/mês</strong></div>
                          <div className="bg-white p-2.5 rounded-lg border border-sky-100"><span className="text-slate-500 block text-xs">CPAP/BiPAP</span> <strong>R$ {((empresaSelecionadaForm.locacao_mensal_cpap || licitacaoEmpresa?.locacao_mensal_cpap) ?? 0) > 0 ? ((empresaSelecionadaForm.locacao_mensal_cpap || licitacaoEmpresa?.locacao_mensal_cpap)!).toFixed(2) : "—"}/mês</strong></div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* SEÇÃO MULTI-ITEM: ITENS DO ATENDIMENTO / TERMO */}
                  <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Layers className="w-5 h-5 text-sky-600" />
                        <Label className="font-bold text-slate-900 text-sm">
                          Itens do Atendimento (Empréstimo Múltiplo Unificado)
                        </Label>
                      </div>
                      <span className="text-xs font-semibold px-2.5 py-1 bg-white border border-slate-200 rounded-full text-slate-600 shadow-2xs">
                        {itensAtendimento.length} item(ns) adicionado(s)
                      </span>
                    </div>

                    {/* Seletor de Tipo de Item para o Rascunho */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                      <label className={`flex items-center gap-3 p-3.5 rounded-xl border text-sm cursor-pointer transition-all ${
                        !permiteOxigenio ? "opacity-50 cursor-not-allowed bg-slate-100 border-slate-200" :
                        itemAtual.tipo_item === "CILINDRO"
                          ? "bg-sky-50 border-sky-500 ring-2 ring-sky-200 text-sky-900 font-bold shadow-xs"
                          : "bg-white border-slate-200 text-slate-700 hover:bg-slate-100/60"
                      }`}>
                        <input
                          type="radio"
                          name="item_tipo"
                          disabled={!permiteOxigenio}
                          checked={itemAtual.tipo_item === "CILINDRO"}
                          onChange={() => setItemAtual({ ...itemAtual, tipo_item: "CILINDRO" })}
                          className="h-4 w-4 text-sky-600"
                        />
                        <div>
                          <span className="block font-semibold">Cilindro de Oxigênio Medicinal</span>
                          <span className="text-xs text-slate-500 font-normal">Capacidades de 10m³, 3m³ ou 1m³</span>
                        </div>
                      </label>

                      <label className={`flex items-center gap-3 p-3.5 rounded-xl border text-sm cursor-pointer transition-all ${
                        !permiteMaquinas ? "opacity-50 cursor-not-allowed bg-slate-100 border-slate-200" :
                        itemAtual.tipo_item === "MAQUINA"
                          ? "bg-indigo-50 border-indigo-500 ring-2 ring-indigo-200 text-indigo-900 font-bold shadow-xs"
                          : "bg-white border-slate-200 text-slate-700 hover:bg-slate-100/60"
                      }`}>
                        <input
                          type="radio"
                          name="item_tipo"
                          disabled={!permiteMaquinas}
                          checked={itemAtual.tipo_item === "MAQUINA"}
                          onChange={() => setItemAtual({ ...itemAtual, tipo_item: "MAQUINA" })}
                          className="h-4 w-4 text-indigo-600"
                        />
                        <div>
                          <span className="block font-semibold">Máquina Respiratória</span>
                          <span className="text-xs text-slate-500 font-normal">Concentrador 5L/10L, CPAP ou BiPAP</span>
                        </div>
                      </label>
                    </div>

                    {/* Campos do Item Rascunho se CILINDRO */}
                    {itemAtual.tipo_item === "CILINDRO" && (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
                        <div>
                          <Label className="text-xs font-semibold text-slate-700">Capacidade</Label>
                          <select
                            value={itemAtual.tipo_cilindro || "10m3"}
                            onChange={(e) => setItemAtual({ ...itemAtual, tipo_cilindro: e.target.value })}
                            className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
                          >
                            <option value="10m3">10m³ (Grande)</option>
                            <option value="3m3">3m³ (Reserva)</option>
                            <option value="1m3">1m³ (Transporte)</option>
                          </select>
                        </div>

                        <div>
                          <Label className="text-xs font-semibold text-slate-700">Finalidade</Label>
                          <select
                            value={itemAtual.finalidade_cilindro || "SEMANAL_CONCENTRADOR"}
                            onChange={(e) => setItemAtual({ ...itemAtual, finalidade_cilindro: e.target.value })}
                            className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
                          >
                            <option value="SEMANAL_CONCENTRADOR">Troca Semanal</option>
                            <option value="FIXO_CONCENTRADOR">Fixo Reserva 3m³</option>
                            <option value="TRANSPORTE_ESPECIAL">Transporte Especial</option>
                            <option value="USO_CONTINUO">Uso Contínuo</option>
                          </select>
                        </div>

                        <div>
                          <Label className="text-xs font-semibold text-slate-700">Regime de Posse</Label>
                          <select
                            value={itemAtual.posse_cilindro}
                            onChange={(e) => setItemAtual({ ...itemAtual, posse_cilindro: e.target.value as "PROPRIO" | "COMODATO" })}
                            className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white font-medium"
                          >
                            <option value="PROPRIO">Próprio (Guapé)</option>
                            <option value="COMODATO">Comodato (Empresa)</option>
                          </select>
                        </div>

                        <div>
                          <Label className="text-xs font-semibold text-slate-700">Quantidade</Label>
                          <Input
                            type="number"
                            min="1"
                            className="h-9 text-sm"
                            value={itemAtual.quantidade || ""}
                            onChange={(e) => {
                              const val = e.target.value;
                              setItemAtual({ ...itemAtual, quantidade: val === "" ? ("" as any) : Number(val) });
                            }}
                            onBlur={() => {
                              if (!itemAtual.quantidade || itemAtual.quantidade < 1) {
                                setItemAtual({ ...itemAtual, quantidade: 1 });
                              }
                            }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Campos do Item Rascunho se MÁQUINA */}
                    {itemAtual.tipo_item === "MAQUINA" && (
                      <div className="pt-2 bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-2">
                        <Label className="text-xs font-semibold text-slate-700">Selecione a Máquina Disponível em Estoque *</Label>
                        <select
                          value={itemAtual.equipamento_id || ""}
                          onChange={(e) => setItemAtual({ ...itemAtual, equipamento_id: e.target.value ? Number(e.target.value) : null })}
                          className="w-full mt-1 px-3 py-2.5 text-sm rounded-lg border border-slate-300 bg-white"
                        >
                          <option value="">Selecione uma máquina em estoque</option>
                          {equipamentosDisponiveisFiltrados.map((eq) => {
                            const rotuloTipo = eq.tipo === "CONCENTRADOR_5L" ? "Concentrador 5L" :
                                               eq.tipo === "CONCENTRADOR_10L" ? "Concentrador 10L" :
                                               eq.tipo === "CONCENTRADOR" ? "Concentrador 5L" : eq.tipo;
                            return (
                              <option key={eq.id} value={eq.id}>
                                [{rotuloTipo}] {eq.marca_modelo} · Série: {eq.numero_serie} {eq.cilindro_incluso_tipo ? `(Inclui cilindro ${eq.cilindro_incluso_tipo})` : ""}
                              </option>
                            );
                          })}
                        </select>

                        {itemAtual.equipamento_id && (() => {
                          const eq = equipamentosDisponiveisFiltrados.find(e => e.id === Number(itemAtual.equipamento_id));
                          if (!eq) return null;
                          return (
                            <div className="mt-2 space-y-2">
                              {eq.cilindro_incluso_tipo ? (
                                <div className="p-3 bg-sky-50 border border-sky-200 rounded-lg text-sky-900 flex items-start gap-2.5">
                                  <CheckCircle2 className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
                                  <div className="text-xs space-y-0.5">
                                    <p className="font-bold">Cilindro de Backup Incluso no Concentrador</p>
                                    <p>
                                      Este equipamento possui <b>{eq.cilindro_incluso_qtd || 1}x cilindro ({eq.cilindro_incluso_tipo})</b> embutido. Ele será vinculado ao termo e abatido do saldo de estoque automaticamente.
                                    </p>
                                  </div>
                                </div>
                              ) : eq.tipo.includes("CONCENTRADOR") ? (
                                <p className="text-xs text-slate-500">
                                  Este concentrador não possui cilindro embutido pré-configurado. Você pode adicionar cilindros extras abaixo.
                                </p>
                              ) : null}
                            </div>
                          );
                        })()}

                        {equipamentosDisponiveisFiltrados.length === 0 && (
                          <p className="text-xs text-rose-600 font-semibold mt-1">
                            Não há equipamentos disponíveis vinculados a este fornecedor.
                          </p>
                        )}
                      </div>
                    )}

                    <div className="flex justify-end pt-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={adicionarItemAoAtendimento}
                        className="border-sky-600 text-sky-700 hover:bg-sky-50 flex items-center gap-2 text-xs md:text-sm font-semibold h-9 px-4"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Adicionar Item ao Atendimento</span>
                      </Button>
                    </div>

                    {/* Lista de Itens Inclusos */}
                    {itensAtendimento.length > 0 && (
                      <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-xs">
                        <div className="bg-slate-100 px-4 py-2 text-xs font-bold text-slate-700 uppercase tracking-wider">
                          Itens Inclusos neste Termo de Retirada:
                        </div>
                        <div className="divide-y divide-slate-100">
                          {itensAtendimento.map((it, idx) => {
                            const equipObj = it.equipamento_id ? equipamentosDisponiveis.find(e => e.id === it.equipamento_id) : null;
                            return (
                              <div key={it.id} className="p-3.5 flex items-center justify-between text-xs md:text-sm hover:bg-slate-50">
                                <div className="flex items-center gap-3">
                                  <span className="font-mono text-slate-400 font-bold text-sm">{idx + 1}.</span>
                                  {it.tipo_item === "MAQUINA" ? (
                                    <div>
                                      <strong className="text-indigo-900">
                                        Máquina {equipObj?.tipo === "CONCENTRADOR_5L" ? "Concentrador 5L" :
                                                 equipObj?.tipo === "CONCENTRADOR_10L" ? "Concentrador 10L" :
                                                 equipObj?.tipo === "CONCENTRADOR" ? "Concentrador 5L" :
                                                 (equipObj?.tipo || "Respiratória")}: {equipObj?.marca_modelo || ""}
                                      </strong>
                                      <span className="text-xs text-slate-500 font-mono ml-2">
                                        Série: {equipObj?.numero_serie}
                                      </span>
                                      {equipObj?.cilindro_incluso_tipo && (
                                        <div className="text-xs text-teal-700 font-semibold flex items-center gap-1 mt-0.5">
                                          <CheckCircle2 className="w-3.5 h-3.5 text-teal-600" />
                                          Cilindro embutido incluso: {equipObj.cilindro_incluso_qtd || 1}x ({equipObj.cilindro_incluso_tipo})
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <div>
                                      <strong className="text-sky-900">
                                        Cilindro {it.tipo_cilindro?.replace("m3", "m³")} ({it.quantidade} unidade(s))
                                      </strong>
                                      <span className="text-xs text-slate-500 ml-2">
                                        [{it.posse_cilindro === "COMODATO" ? "Comodato Fornecedora" : "Próprio Município"}]
                                      </span>
                                    </div>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => removerItemDoAtendimento(it.id)}
                                  className="text-rose-500 hover:text-rose-700 p-1.5 rounded-lg hover:bg-rose-50 transition"
                                  title="Remover Item"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Prescrição Médica */}
                  <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                      <Activity className="w-3.5 h-3.5 text-sky-600" />
                      Prescrição Médica & Parâmetros Clínicos
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <Label className="text-xs font-semibold text-slate-700">Médico Prescritor *</Label>
                        <Input
                          required
                          className="h-10 text-sm mt-1"
                          placeholder="Nome do médico e CRM"
                          value={formNovo.medico_prescritor}
                          onChange={(e) => setFormNovo({ ...formNovo, medico_prescritor: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label className="text-xs font-semibold text-slate-700">CID-10 Diagnóstico</Label>
                        <Input
                          className="h-10 text-sm mt-1"
                          placeholder="Ex: J44.9 (DPOC)"
                          value={formNovo.cid_diagnostico}
                          onChange={(e) => setFormNovo({ ...formNovo, cid_diagnostico: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label className="text-xs font-semibold text-slate-700">Fluxo (L/min) ou Pressão</Label>
                        <Input
                          className="h-10 text-sm mt-1"
                          placeholder="Ex: 2 L/min ou 10 cmH2O"
                          value={formNovo.fluxo_oxigenio_litros_min || formNovo.pressao_cpap_bipap}
                          onChange={(e) => setFormNovo({
                            ...formNovo,
                            fluxo_oxigenio_litros_min: Number(e.target.value) || 2,
                            pressao_cpap_bipap: e.target.value,
                          })}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Dados do Responsável pela Retirada */}
                  <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-sky-600" />
                      Dados do Responsável pela Retirada
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <Label className="text-xs font-semibold text-slate-700">Nome do Responsável</Label>
                        <Input
                          className="h-10 text-sm mt-1"
                          placeholder="Nome completo de quem retirou"
                          value={formNovo.responsavel_retirada_nome}
                          onChange={(e) => setFormNovo({ ...formNovo, responsavel_retirada_nome: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label className="text-xs font-semibold text-slate-700">CPF do Responsável</Label>
                        <Input
                          className="h-10 text-sm mt-1"
                          placeholder="000.000.000-00"
                          value={formNovo.responsavel_retirada_cpf}
                          onChange={(e) => setFormNovo({ ...formNovo, responsavel_retirada_cpf: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label className="text-xs font-semibold text-slate-700">Parentesco / Vínculo</Label>
                        <Input
                          className="h-10 text-sm mt-1"
                          placeholder="Filho, Cônjuge, Próprio Paciente..."
                          value={formNovo.responsavel_retirada_parentesco}
                          onChange={(e) => setFormNovo({ ...formNovo, responsavel_retirada_parentesco: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Datas e Observações */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs font-semibold text-slate-700">Data de Instalação / Saída *</Label>
                      <Input
                        type="date"
                        required
                        className="h-10 text-sm mt-1"
                        value={formNovo.data_instalacao}
                        onChange={(e) => setFormNovo({ ...formNovo, data_instalacao: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label className="text-xs font-semibold text-slate-700">Previsão da Próxima Troca (se semanal)</Label>
                      <Input
                        type="date"
                        className="h-10 text-sm mt-1"
                        value={formNovo.data_prevista_troca}
                        onChange={(e) => setFormNovo({ ...formNovo, data_prevista_troca: e.target.value })}
                      />
                    </div>
                  </div>

                  <div>
                    <Label className="text-xs font-semibold text-slate-700">Observações Clínicas e Logísticas</Label>
                    <Input
                      className="h-10 text-sm mt-1"
                      placeholder="Orientações prestadas à família, máscara fornecida, umidificador entregue..."
                      value={formNovo.observacoes}
                      onChange={(e) => setFormNovo({ ...formNovo, observacoes: e.target.value })}
                    />
                  </div>

                  <div className="p-3.5 bg-sky-50/70 border border-sky-200 rounded-xl flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="termo_assinado"
                      checked={formNovo.termo_assinado}
                      onChange={(e) => setFormNovo({ ...formNovo, termo_assinado: e.target.checked })}
                      className="h-4 w-4 rounded text-sky-600 focus:ring-sky-500"
                    />
                    <label htmlFor="termo_assinado" className="text-xs md:text-sm text-slate-800 font-semibold cursor-pointer">
                      Termo de Responsabilidade e Ciência assinado pelo paciente ou responsável
                    </label>
                  </div>
                </div>

                {/* Rodapé Fixo na Base */}
                <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-3 shrink-0">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setModalNovoAberto(false)}
                    className="h-10 px-5 text-sm"
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="submit"
                    disabled={salvando}
                    className="h-10 px-6 text-sm font-bold bg-sky-600 hover:bg-sky-700 text-white shadow-md flex items-center gap-2"
                  >
                    <FileCheck2 className="w-4 h-4" />
                    <span>{salvando ? "Emitindo Termo..." : "Salvar e Gerar Comprovante"}</span>
                  </Button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

      {/* MODAL: DEVOLVER / INATIVAR EMPRÉSTIMO */}
      {modalInativarAberto && emprestimoParaInativar &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto print:hidden">
            <div
              className="fixed -inset-10 bg-slate-900/65 backdrop-blur-md animate-in fade-in duration-150"
              onClick={() => setModalInativarAberto(false)}
              aria-hidden="true"
            />
            <div className="relative z-10 bg-white rounded-2xl shadow-2xl max-w-xl w-full flex flex-col max-h-[90vh] overflow-hidden border border-slate-200 animate-in zoom-in-95 duration-150">
              <div className="px-6 py-4 bg-rose-900 text-white flex justify-between items-center shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-rose-800/80 rounded-xl text-rose-200">
                    <LogOut className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-base md:text-lg">Registrar Devolução / Encerramento</h3>
                    <p className="text-xs text-rose-200">Finalização do comodato ou entrega de equipamento</p>
                  </div>
                </div>
                <button
                  onClick={() => setModalInativarAberto(false)}
                  className="rounded-xl p-1.5 text-white/80 hover:bg-white/10 hover:text-white transition"
                  title="Fechar"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleConfirmarInativacao} className="flex flex-col flex-1 overflow-hidden min-h-0">
                <div className="flex-1 overflow-y-auto p-6 space-y-4 text-sm text-slate-700">
                  <div className="bg-rose-50 p-3.5 rounded-xl border border-rose-200 text-rose-950 space-y-1">
                    <span className="block font-bold text-base">{emprestimoParaInativar.paciente_nome}</span>
                    <span className="text-xs text-rose-800 block">
                      Item: <strong>{emprestimoParaInativar.tipo_servico === "MAQUINA"
                        ? `${emprestimoParaInativar.tipo_equipamento} (${emprestimoParaInativar.equipamento_serie})`
                        : `Cilindro ${emprestimoParaInativar.tipo_cilindro?.replace("m3", "m³")}`}</strong>
                    </span>
                  </div>

                  <div>
                    <Label className="text-xs font-semibold text-slate-700">Data Efetiva da Devolução / Encerramento *</Label>
                    <Input
                      type="date"
                      required
                      className="h-10 text-sm mt-1"
                      value={formInativar.data_devolucao}
                      onChange={(e) => setFormInativar({ ...formInativar, data_devolucao: e.target.value })}
                    />
                  </div>

                  <div>
                    <Label className="text-xs font-semibold text-slate-700">Motivo do Encerramento *</Label>
                    <select
                      required
                      value={formInativar.motivo_inativacao}
                      onChange={(e) => setFormInativar({ ...formInativar, motivo_inativacao: e.target.value })}
                      className="w-full mt-1 px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 bg-white shadow-xs focus:ring-2 focus:ring-rose-500 font-medium"
                    >
                      <option value="ALTA">Alta Médica / Desmame</option>
                      <option value="OBITO">Óbito</option>
                      <option value="MELHORA_CLINICA">Melhora Clínica Significativa</option>
                      <option value="TRANSFERENCIA">Transferência de Município / Hospitalar</option>
                      <option value="MUDANCA_TRATAMENTO">Mudança no Plano Terapêutico</option>
                      <option value="OUTRO">Outro Motivo</option>
                    </select>
                  </div>

                  <div>
                    <Label className="text-xs font-semibold text-slate-700">Observações / Relatório de Recebimento</Label>
                    <Input
                      className="h-10 text-sm mt-1"
                      placeholder="Estado do equipamento na devolução, carcaça, acessórios..."
                      value={formInativar.observacoes}
                      onChange={(e) => setFormInativar({ ...formInativar, observacoes: e.target.value })}
                    />
                  </div>
                </div>

                <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end gap-3 shrink-0">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setModalInativarAberto(false)}
                    className="h-10 px-4 text-sm"
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="submit"
                    disabled={salvando}
                    className="h-10 px-5 text-sm font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-md"
                  >
                    {salvando ? "Processando..." : "Confirmar Encerramento"}
                  </Button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

      {/* MODAL: RECOLHIMENTO DE CILINDRO VAZIO */}
      {modalRecolherAberto && cilindroParaRecolher &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto print:hidden">
            <div
              className="fixed -inset-10 bg-slate-900/65 backdrop-blur-md animate-in fade-in duration-150"
              onClick={() => setModalRecolherAberto(false)}
              aria-hidden="true"
            />
            <div className="relative z-10 bg-white rounded-2xl shadow-2xl max-w-xl w-full flex flex-col max-h-[90vh] overflow-hidden border border-slate-200 animate-in zoom-in-95 duration-150">
              <div className="px-6 py-4 bg-amber-800 text-white flex justify-between items-center shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-amber-700/80 rounded-xl text-amber-200">
                    <Package className="w-5 h-5 text-amber-200" />
                  </div>
                  <div>
                    <h3 className="font-bold text-base md:text-lg">Registrar Recolhimento de Cilindro</h3>
                    <p className="text-xs text-amber-200">Coleta e destinação de casco vazio</p>
                  </div>
                </div>
                <button
                  onClick={() => setModalRecolherAberto(false)}
                  className="rounded-xl p-1.5 text-white/80 hover:bg-white/10 hover:text-white transition"
                  title="Fechar"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleConfirmarRecolhimento} className="flex flex-col flex-1 overflow-hidden min-h-0">
                <div className="flex-1 overflow-y-auto p-6 space-y-4 text-sm text-slate-700">
                  <div className="bg-amber-50 p-3.5 rounded-xl border border-amber-200 text-amber-950 space-y-1">
                    <span className="block font-bold text-base">Paciente: {cilindroParaRecolher.paciente_nome}</span>
                    <span className="text-xs text-amber-800 block">
                      Cilindro <strong>{cilindroParaRecolher.tipo_cilindro.replace("m3", "m³")}</strong> ({cilindroParaRecolher.quantidade} unidade(s))
                    </span>
                    <span className="text-xs block text-amber-700 font-medium">
                      Origem: {cilindroParaRecolher.motivo_origem}
                    </span>
                  </div>

                  <div>
                    <Label className="text-xs font-semibold text-slate-700">Data do Recolhimento / Coleta *</Label>
                    <Input
                      type="date"
                      required
                      className="h-10 text-sm mt-1"
                      value={formRecolher.data_recolhimento}
                      onChange={(e) => setFormRecolher({ ...formRecolher, data_recolhimento: e.target.value })}
                    />
                  </div>

                  <div>
                    <Label className="text-xs font-semibold text-slate-700">Responsável pelo Recolhimento / Motorista *</Label>
                    <Input
                      required
                      className="h-10 text-sm mt-1"
                      placeholder="Nome do motorista ou funcionário da empresa"
                      value={formRecolher.recolhido_por}
                      onChange={(e) => setFormRecolher({ ...formRecolher, recolhido_por: e.target.value })}
                    />
                  </div>

                  <div>
                    <Label className="text-xs font-semibold text-slate-700">Empresa Destino do Vaso / Fornecedora</Label>
                    <select
                      value={formRecolher.empresa_id}
                      onChange={(e) => setFormRecolher({ ...formRecolher, empresa_id: e.target.value })}
                      className="w-full mt-1 px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 bg-white shadow-xs focus:ring-2 focus:ring-amber-500 font-medium"
                    >
                      <option value="">Empresa Padrão / Contratada</option>
                      {empresas.map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {emp.nome_fantasia || emp.razao_social || emp.nome}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <Label className="text-xs font-semibold text-slate-700">Observações / Guia de Coleta</Label>
                    <Input
                      className="h-10 text-sm mt-1"
                      placeholder="Número do canhoto de recolha, lacre..."
                      value={formRecolher.observacoes}
                      onChange={(e) => setFormRecolher({ ...formRecolher, observacoes: e.target.value })}
                    />
                  </div>
                </div>

                <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end gap-3 shrink-0">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setModalRecolherAberto(false)}
                    className="h-10 px-4 text-sm"
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="submit"
                    disabled={salvando}
                    className="h-10 px-5 text-sm font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-md"
                  >
                    {salvando ? "Registrando..." : "Confirmar Coleta"}
                  </Button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

      {/* MODAL: COMPROVANTE TERMO */}
      {comprovanteId && (
        <ComprovanteEmprestimoModal
          emprestimoId={comprovanteId}
          onClose={() => setComprovanteId(null)}
        />
      )}
    </div>
  );
}
