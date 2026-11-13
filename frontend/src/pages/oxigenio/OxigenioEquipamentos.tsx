import { useEffect, useState } from "react";
import {
  Stethoscope,
  Plus,
  Search,
  Filter,
  Activity,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Calendar,
  Building2,
  History,
  RotateCcw,
  User,
  Users,
  Eye,
  FileSpreadsheet,
  Edit2,
  Trash2,
  Info,
  ShieldCheck,
  Zap,
  RefreshCw,
} from "lucide-react";
import {
  oxigenioEquipamentos,
  oxigenioCriarEquipamento,
  oxigenioAtualizarEquipamento,
  oxigenioExcluirEquipamento,
  oxigenioEmprestimos,
  oxigenioRegistrarTroca,
  oxigenioListarTrocas,
  oxigenioEmpresas,
  oxigenioAlterarStatusEquipamento,
  type EquipamentoRespiratorio,
  type EmprestimoOxigenio,
  type TrocaCilindroHistorico,
  type EmpresaOxigenio,
} from "../../services/api";
import { Button, Input, Label, Badge } from "../../components/ui/primitives";
import ExportarExcel from "../../components/ExportarExcel";
import ComprovanteEmprestimoModal from "./ComprovanteEmprestimoModal";

export default function OxigenioEquipamentos() {
  const [abaAtiva, setAbaAtiva] = useState<"equipamentos" | "prazos_troca" | "inativos">("equipamentos");

  // Dados
  const [equipamentos, setEquipamentos] = useState<EquipamentoRespiratorio[]>([]);
  const [emprestimosConcentrador, setEmprestimosConcentrador] = useState<EmprestimoOxigenio[]>([]);
  const [emprestimosInativos, setEmprestimosInativos] = useState<EmprestimoOxigenio[]>([]);
  const [empresas, setEmpresas] = useState<EmpresaOxigenio[]>([]);

  // Estados de busca/filtro
  const [busca, setBusca] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<string>("");
  const [filtroStatus, setFiltroStatus] = useState<string>("");
  const [filtroPropriedade, setFiltroPropriedade] = useState<string>("");
  const [filtroEmpresa, setFiltroEmpresa] = useState<string>("");
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState("");

  // Modal Novo / Edição Equipamento
  const [modalEquipAberto, setModalEquipAberto] = useState(false);
  const [equipamentoEdicao, setEquipamentoEdicao] = useState<EquipamentoRespiratorio | null>(null);
  const [salvandoEquip, setSalvandoEquip] = useState(false);
  const [formEquip, setFormEquip] = useState({
    tipo: "CONCENTRADOR_5L",
    patrimonio: "",
    numero_serie: "",
    marca_modelo: "",
    propriedade: "PROPRIO",
    empresa_id: "",
    status: "DISPONIVEL",
    tensao_eletrica: "110V",
    horas_uso: 0,
    observacoes: "",
  });

  // Modal Registrar Troca de Cilindro
  const [modalTrocaAberto, setModalTrocaAberto] = useState(false);
  const [emprestimoSelecionado, setEmprestimoSelecionado] = useState<EmprestimoOxigenio | null>(null);
  const [salvandoTroca, setSalvandoTroca] = useState(false);
  const [formTroca, setFormTroca] = useState({
    data_troca: new Date().toISOString().slice(0, 10),
    tipo_cilindro: "10m3",
    quantidade: 1,
    responsavel_entrega: "",
    observacoes: "",
  });

  // Modal Histórico de Trocas
  const [modalHistoricoAberto, setModalHistoricoAberto] = useState(false);
  const [historicoTrocas, setHistoricoTrocas] = useState<TrocaCilindroHistorico[]>([]);
  const [carregandoHistorico, setCarregandoHistorico] = useState(false);

  // Modal Comprovante Termo
  const [comprovanteEmprestimoId, setComprovanteEmprestimoId] = useState<number | null>(null);

  // Modal Alterar Status do Equipamento
  const [modalStatusAberto, setModalStatusAberto] = useState(false);
  const [equipamentoStatus, setEquipamentoStatus] = useState<EquipamentoRespiratorio | null>(null);
  const [salvandoStatus, setSalvandoStatus] = useState(false);
  const [formStatus, setFormStatus] = useState({
    novo_status: "MANUTENCAO",
    motivo: "",
    desvincular_paciente: false,
  });

  const abrirModalStatus = (eq: EquipamentoRespiratorio) => {
    setEquipamentoStatus(eq);
    setFormStatus({
      novo_status: eq.status === "MANUTENCAO" ? "DISPONIVEL" : "MANUTENCAO",
      motivo: "",
      desvincular_paciente: false,
    });
    setModalStatusAberto(true);
  };

  const handleSalvarStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!equipamentoStatus) return;
    setSalvandoStatus(true);
    setErro("");
    try {
      await oxigenioAlterarStatusEquipamento(equipamentoStatus.id, {
        status: formStatus.novo_status,
        observacoes: formStatus.motivo,
        desvincular_paciente: formStatus.desvincular_paciente,
      });
      setSucesso(`Status do equipamento ${equipamentoStatus.numero_serie} atualizado para ${formStatus.novo_status}!`);
      setModalStatusAberto(false);
      carregarDados();
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Erro ao alterar status do equipamento");
    } finally {
      setSalvandoStatus(false);
    }
  };

  const carregarDados = async () => {
    setCarregando(true);
    setErro("");
    try {
      const [resEquip, resConc, resInativos, resEmp] = await Promise.all([
        oxigenioEquipamentos({
          tipo: filtroTipo || undefined,
          status: filtroStatus || undefined,
          propriedade: filtroPropriedade || undefined,
          empresa_id: filtroEmpresa ? Number(filtroEmpresa) : undefined,
          q: busca || undefined,
        }),
        // Busca empréstimos ativos com Concentrador para controle de prazos
        oxigenioEmprestimos({
          tipo_equipamento: "CONCENTRADOR",
          status: "ATIVO",
        }),
        // Busca inativos para histórico
        oxigenioEmprestimos({
          status: "INATIVO",
        }),
        oxigenioEmpresas({ apenas_ativas: true }),
      ]);

      setEquipamentos(resEquip);
      setEmprestimosConcentrador(resConc);
      setEmprestimosInativos(resInativos);
      setEmpresas(resEmp);
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Erro ao carregar dados de equipamentos");
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregarDados();
  }, [abaAtiva, filtroTipo, filtroStatus, filtroPropriedade, filtroEmpresa]);

  const abrirModalNovoEquip = () => {
    setEquipamentoEdicao(null);
    setFormEquip({
      tipo: "CONCENTRADOR_5L",
      patrimonio: "",
      numero_serie: "",
      marca_modelo: "",
      propriedade: "PROPRIO",
      empresa_id: "",
      status: "DISPONIVEL",
      tensao_eletrica: "110V",
      horas_uso: 0,
      observacoes: "",
    });
    setModalEquipAberto(true);
  };

  const abrirModalEditarEquip = (eq: EquipamentoRespiratorio) => {
    setEquipamentoEdicao(eq);
    setFormEquip({
      tipo: eq.tipo,
      patrimonio: eq.patrimonio || "",
      numero_serie: eq.numero_serie,
      marca_modelo: eq.marca_modelo || "",
      propriedade: eq.propriedade,
      empresa_id: eq.empresa_id ? String(eq.empresa_id) : "",
      status: eq.status,
      tensao_eletrica: eq.tensao_eletrica || "110V",
      horas_uso: eq.horas_uso || 0,
      observacoes: eq.observacoes || "",
    });
    setModalEquipAberto(true);
  };

  const handleSalvarEquipamento = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formEquip.numero_serie) {
      setErro("Informe o número de série do equipamento");
      return;
    }

    setSalvandoEquip(true);
    setErro("");
    try {
      const payload: any = {
        tipo: formEquip.tipo,
        patrimonio: formEquip.patrimonio,
        numero_serie: formEquip.numero_serie,
        marca_modelo: formEquip.marca_modelo,
        propriedade: formEquip.propriedade,
        empresa_id: formEquip.empresa_id ? Number(formEquip.empresa_id) : null,
        status: formEquip.status,
        tensao_eletrica: formEquip.tensao_eletrica,
        horas_uso: Number(formEquip.horas_uso),
        observacoes: formEquip.observacoes,
      };

      if (equipamentoEdicao) {
        await oxigenioAtualizarEquipamento(equipamentoEdicao.id, payload);
        setSucesso("Equipamento atualizado com sucesso!");
      } else {
        await oxigenioCriarEquipamento(payload);
        setSucesso("Equipamento cadastrado com sucesso!");
      }

      setModalEquipAberto(false);
      carregarDados();
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Erro ao salvar equipamento");
    } finally {
      setSalvandoEquip(false);
    }
  };

  const handleExcluirEquipamento = async (id: number) => {
    if (!window.confirm("Deseja realmente remover este equipamento do cadastro?")) return;
    try {
      await oxigenioExcluirEquipamento(id);
      setSucesso("Equipamento removido com sucesso!");
      carregarDados();
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Erro ao remover equipamento");
    }
  };

  // Troca de Cilindro
  const abrirModalTroca = (emp: EmprestimoOxigenio) => {
    setEmprestimoSelecionado(emp);
    setFormTroca({
      data_troca: new Date().toISOString().slice(0, 10),
      tipo_cilindro: emp.tipo_cilindro || "10m3",
      quantidade: 1,
      responsavel_entrega: "",
      observacoes: "",
    });
    setModalTrocaAberto(true);
  };

  const handleSalvarTroca = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emprestimoSelecionado) return;

    setSalvandoTroca(true);
    setErro("");
    try {
      await oxigenioRegistrarTroca(emprestimoSelecionado.id, {
        data_troca: formTroca.data_troca,
        tipo_cilindro: formTroca.tipo_cilindro,
        quantidade: Number(formTroca.quantidade),
        responsavel_entrega: formTroca.responsavel_entrega,
        observacoes: formTroca.observacoes,
      });

      setSucesso(`Troca registrada com sucesso! Próxima data agendada para 7 dias.`);
      setModalTrocaAberto(false);
      carregarDados();
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Erro ao registrar troca de cilindro");
    } finally {
      setSalvandoTroca(false);
    }
  };

  // Histórico de Trocas
  const abrirHistoricoTrocas = async (emp: EmprestimoOxigenio) => {
    setEmprestimoSelecionado(emp);
    setModalHistoricoAberto(true);
    setCarregandoHistorico(true);
    try {
      const trocas = await oxigenioListarTrocas(emp.id);
      setHistoricoTrocas(trocas);
    } catch (e: any) {
      setErro("Erro ao listar histórico de trocas");
    } finally {
      setCarregandoHistorico(false);
    }
  };

  // Métricas do Parque
  const totalMaquinas = equipamentos.length;
  const maquinasEmUso = equipamentos.filter((e) => e.status === "EM_USO").length;
  const maquinasDisponiveis = equipamentos.filter((e) => e.status === "DISPONIVEL").length;
  const maquinasManutencao = equipamentos.filter((e) => e.status === "MANUTENCAO").length;

  const pacientesConc = emprestimosConcentrador.length;
  const trocasAtrasadas = emprestimosConcentrador.filter((e) => e.status_prazo === "ATRASADO").length;
  const trocasHoje = emprestimosConcentrador.filter((e) => e.status_prazo === "TROCA_HOJE").length;

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Cabeçalho da Página */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-teal/10 text-teal">
            <Stethoscope className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-xl md:text-2xl font-bold text-sus-950">
                Gestão de Equipamentos Respiratórios
              </h1>
              {trocasAtrasadas > 0 && (
                <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-amber-500 text-slate-900 animate-pulse">
                  {trocasAtrasadas} {trocasAtrasadas === 1 ? "troca atrasada" : "trocas atrasadas"}
                </span>
              )}
            </div>
            <p className="text-xs text-ink/60 mt-0.5">
              Monitoramento de CPAPs, BiPAPs, Concentradores e prazos de manutenção e troca de filtros
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

      {/* CARDS DE RESUMO DO PARQUE DE MÁQUINAS */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3">
          <div className="p-3 bg-sky-100 text-sky-700 rounded-xl">
            <Stethoscope className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs text-slate-500 block">Total de Equipamentos</span>
            <strong className="text-xl font-bold text-slate-800">{totalMaquinas}</strong>
            <span className="text-[11px] text-slate-400 block">CPAP, BiPAP e Concentradores</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3">
          <div className="p-3 bg-indigo-100 text-indigo-700 rounded-xl">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs text-slate-500 block">Pacientes Ativos em Uso</span>
            <strong className="text-xl font-bold text-indigo-700">{maquinasEmUso}</strong>
            <span className="text-[11px] text-slate-400 block">Máquinas instaladas</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3">
          <div className="p-3 bg-emerald-100 text-emerald-700 rounded-xl">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs text-slate-500 block">Disponíveis no Estoque</span>
            <strong className="text-xl font-bold text-emerald-700">{maquinasDisponiveis}</strong>
            <span className="text-[11px] text-slate-400 block">Prontas para empréstimo</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3">
          <div className={`p-3 rounded-xl ${trocasAtrasadas > 0 ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs text-slate-500 block">Trocas Semanais (Prazos)</span>
            <strong className={`text-xl font-bold ${trocasAtrasadas > 0 ? "text-rose-700" : "text-slate-800"}`}>
              {trocasAtrasadas > 0 ? `${trocasAtrasadas} Atrasada(s)` : `${trocasHoje} Hoje`}
            </strong>
            <span className="text-[11px] text-slate-400 block">Concentradores ativos</span>
          </div>
        </div>
      </div>

      {/* ABAS INTERNAS */}
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 pt-2 rounded-t-xl shadow-sm">
        <button
          onClick={() => setAbaAtiva("equipamentos")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs md:text-sm font-semibold border-b-2 transition-colors ${
            abaAtiva === "equipamentos"
              ? "border-sky-600 text-sky-700 bg-sky-50/50 rounded-t-lg"
              : "border-transparent text-slate-600 hover:text-slate-900"
          }`}
        >
          <Stethoscope className="w-4 h-4" />
          <span>Equipamentos Cadastrados ({totalMaquinas})</span>
        </button>

        <button
          onClick={() => setAbaAtiva("prazos_troca")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs md:text-sm font-semibold border-b-2 transition-colors ${
            abaAtiva === "prazos_troca"
              ? "border-sky-600 text-sky-700 bg-sky-50/50 rounded-t-lg"
              : "border-transparent text-slate-600 hover:text-slate-900"
          }`}
        >
          <Clock className="w-4 h-4" />
          <span>Controle de Prazos Semanais (Concentradores)</span>
          {trocasAtrasadas > 0 && (
            <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-rose-500 text-white">
              {trocasAtrasadas}
            </span>
          )}
        </button>

        <button
          onClick={() => setAbaAtiva("inativos")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs md:text-sm font-semibold border-b-2 transition-colors ${
            abaAtiva === "inativos"
              ? "border-sky-600 text-sky-700 bg-sky-50/50 rounded-t-lg"
              : "border-transparent text-slate-600 hover:text-slate-900"
          }`}
        >
          <History className="w-4 h-4" />
          <span>Histórico de Inativos ({emprestimosInativos.length})</span>
        </button>
      </div>

      {/* ABA 1: PARQUE DE EQUIPAMENTOS */}
      {abaAtiva === "equipamentos" && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <div className="relative min-w-[220px]">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                <Input
                  placeholder="Buscar série, patrimônio, modelo..."
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  className="pl-9 text-xs"
                />
              </div>

              <select
                value={filtroTipo}
                onChange={(e) => setFiltroTipo(e.target.value)}
                className="px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white"
              >
                <option value="">Todos os Tipos</option>
                <option value="CONCENTRADOR">Concentradores (Todos)</option>
                <option value="CONCENTRADOR_5L">Concentrador 5 Litros (5L)</option>
                <option value="CONCENTRADOR_10L">Concentrador 10 Litros (10L)</option>
                <option value="CPAP">CPAP</option>
                <option value="BiPAP">BiPAP</option>
              </select>

              <select
                value={filtroStatus}
                onChange={(e) => setFiltroStatus(e.target.value)}
                className="px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white"
              >
                <option value="">Todos os Status</option>
                <option value="DISPONIVEL">Disponível no Estoque</option>
                <option value="EM_USO">Em Uso com Paciente</option>
                <option value="MANUTENCAO">Em Manutenção Técnica</option>
                <option value="INATIVO_BAIXADO">Baixado / Inativo</option>
              </select>

              <select
                value={filtroPropriedade}
                onChange={(e) => setFiltroPropriedade(e.target.value)}
                className="px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white"
              >
                <option value="">Todas as Origens</option>
                <option value="PROPRIO">Próprio do Município</option>
                <option value="LOCADO">Locado de Empresa</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <Button
                onClick={abrirModalNovoEquip}
                className="bg-sky-600 hover:bg-sky-700 text-white flex items-center gap-1.5 text-xs shadow-sm"
              >
                <Plus className="w-4 h-4" />
                <span>Novo Equipamento</span>
              </Button>
              <ExportarExcel
                url="/api/oxigenio/exportar"
                params={{ tipo: "equipamentos" }}
                arquivo="oxigenio_equipamentos"
                rotulo="Exportar Excel"
              />
            </div>
          </div>

          {/* Tabela de Equipamentos */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wider border-y border-slate-200">
                <tr>
                  <th className="py-3 px-3">Tipo / Modelo</th>
                  <th className="py-3 px-3">Patrimônio / Série</th>
                  <th className="py-3 px-3">Propriedade / Fornecedor</th>
                  <th className="py-3 px-3">Tensão / Horímetro</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3">Paciente em Uso</th>
                  <th className="py-3 px-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {equipamentos.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-slate-400">
                      Nenhum equipamento encontrado com os filtros selecionados.
                    </td>
                  </tr>
                ) : (
                  equipamentos.map((eq) => (
                    <tr key={eq.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                            eq.tipo === "CONCENTRADOR_5L" || eq.tipo === "CONCENTRADOR" ? "bg-sky-100 text-sky-800" :
                            eq.tipo === "CONCENTRADOR_10L" ? "bg-blue-100 text-blue-800" :
                            eq.tipo === "CPAP" ? "bg-indigo-100 text-indigo-800" :
                            "bg-purple-100 text-purple-800"
                          }`}>
                            {eq.tipo === "CONCENTRADOR_5L" ? "Concentrador 5L" :
                             eq.tipo === "CONCENTRADOR_10L" ? "Concentrador 10L" :
                             eq.tipo === "CONCENTRADOR" ? "Concentrador 5L" : eq.tipo}
                          </span>
                          <span className="font-medium text-slate-900">{eq.marca_modelo || "Padrão SUS"}</span>
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-mono text-slate-900 font-semibold">{eq.numero_serie}</div>
                        <div className="text-[11px] text-slate-500">Patrimônio: {eq.patrimonio || "—"}</div>
                      </td>
                      <td className="py-3 px-3">
                        <div>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                            eq.propriedade === "PROPRIO" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
                          }`}>
                            {eq.propriedade === "PROPRIO" ? "Próprio (Guapé)" : "Locado"}
                          </span>
                        </div>
                        {eq.empresa_nome && (
                          <div className="text-[11px] text-slate-600 mt-0.5">{eq.empresa_nome}</div>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        <div className="text-slate-800">{eq.tensao_eletrica || "110V"}</div>
                        <div className="text-[11px] text-slate-500">{eq.horas_uso || 0} hrs de uso</div>
                      </td>
                      <td className="py-3 px-3">
                        {eq.status === "DISPONIVEL" && (
                          <span className="px-2 py-0.5 text-[11px] font-semibold rounded bg-emerald-100 text-emerald-800">
                            Disponível
                          </span>
                        )}
                        {eq.status === "EM_USO" && (
                          <span className="px-2 py-0.5 text-[11px] font-semibold rounded bg-sky-100 text-sky-800">
                            Em Uso
                          </span>
                        )}
                        {eq.status === "MANUTENCAO" && (
                          <span className="px-2 py-0.5 text-[11px] font-semibold rounded bg-amber-100 text-amber-800">
                            Manutenção
                          </span>
                        )}
                        {eq.status === "INATIVO_BAIXADO" && (
                          <span className="px-2 py-0.5 text-[11px] font-semibold rounded bg-slate-200 text-slate-700">
                            Baixado
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        {eq.paciente_atual_nome ? (
                          <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                            <User className="w-3.5 h-3.5 text-sky-600" />
                            <span>{eq.paciente_atual_nome}</span>
                          </div>
                        ) : (
                          <span className="text-slate-400 italic">Nenhum</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {eq.emprestimo_id && (
                            <button
                              onClick={() => setComprovanteEmprestimoId(eq.emprestimo_id!)}
                              title="Ver Comprovante / Termo"
                              className="p-1.5 text-sky-600 hover:text-sky-800 hover:bg-sky-50 rounded"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            onClick={() => abrirModalStatus(eq)}
                            title="Alterar Status Operacional"
                            className="p-1.5 text-amber-600 hover:text-amber-800 hover:bg-amber-50 rounded"
                          >
                            <RefreshCw className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => abrirModalEditarEquip(eq)}
                            title="Editar Equipamento"
                            className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleExcluirEquipamento(eq.id)}
                            title="Excluir Equipamento"
                            className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ABA 2: CONTROLE DE PRAZOS DE TROCA SEMANAL (CONCENTRADORES) */}
      {abaAtiva === "prazos_troca" && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
          {/* Card explicativo das Regras do Concentrador */}
          <div className="bg-gradient-to-r from-sky-50 via-indigo-50 to-white p-4 rounded-xl border border-sky-200 text-xs text-slate-700 space-y-2">
            <div className="flex items-center gap-2 font-bold text-sky-900 text-sm">
              <Info className="w-4 h-4 text-sky-700" />
              <span>Regras Oficiais do Paciente com Concentrador de Oxigênio Domiciliar</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
              <div className="bg-white/80 p-2.5 rounded-lg border border-sky-100">
                <span className="font-semibold text-slate-900 block text-xs">1. Concentrador + Cilindro 3m³ Fixo</span>
                <span className="text-[11px] text-slate-600">
                  Cilindro de 3m³ permanente de backup para garantia vital em caso de falta de energia elétrica.
                </span>
              </div>
              <div className="bg-white/80 p-2.5 rounded-lg border border-sky-100">
                <span className="font-semibold text-slate-900 block text-xs">2. Cilindro 10m³ com Troca Semanal</span>
                <span className="text-[11px] text-slate-600">
                  1 cilindro de 10m³ emprestado com escala rígida de substituição periódica a cada 7 dias (+7 dias).
                </span>
              </div>
              <div className="bg-white/80 p-2.5 rounded-lg border border-sky-100">
                <span className="font-semibold text-slate-900 block text-xs">3. Cilindro 1m³ Situações Especiais</span>
                <span className="text-[11px] text-slate-600">
                  Cilindro de 1m³ reservado e monitorado para saídas excepcionais, consultas e transporte.
                </span>
              </div>
            </div>
          </div>

          {/* Tabela de Monitoramento de Trocas Semanais */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wider border-y border-slate-200">
                <tr>
                  <th className="py-3 px-3">Paciente / Prontuário</th>
                  <th className="py-3 px-3">Equipamento Concentrador</th>
                  <th className="py-3 px-3">Data Instalação</th>
                  <th className="py-3 px-3">Última Troca</th>
                  <th className="py-3 px-3">Próxima Troca Prevista</th>
                  <th className="py-3 px-3">Status do Prazo</th>
                  <th className="py-3 px-3 text-right">Ações de Troca</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {emprestimosConcentrador.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-slate-400">
                      Nenhum paciente ativo em uso de concentrador no momento.
                    </td>
                  </tr>
                ) : (
                  emprestimosConcentrador.map((emp) => {
                    const dias = emp.dias_para_troca ?? 0;
                    return (
                      <tr key={emp.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 px-3">
                          <div className="font-bold text-slate-900">{emp.paciente_nome}</div>
                          <div className="text-[11px] text-slate-500">
                            CPF: {emp.paciente_cpf || "—"} · Pront: {emp.paciente_prontuario || "—"}
                          </div>
                          <div className="text-[11px] text-slate-500 truncate max-w-xs">{emp.paciente_endereco}</div>
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-semibold text-sky-800">
                            {emp.tipo_equipamento === "CONCENTRADOR_10L" ? "Concentrador 10L" :
                             emp.tipo_equipamento === "CONCENTRADOR_5L" || emp.tipo_equipamento === "CONCENTRADOR" ? "Concentrador 5L" :
                             (emp.tipo_equipamento || "Concentrador de O2")}
                          </div>
                          <div className="text-[11px] text-slate-600 font-mono">
                            Série: {emp.equipamento_serie || "—"}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {emp.empresa_nome || "Fornecedor SUS"}
                          </div>
                        </td>
                        <td className="py-3 px-3 font-mono">
                          {new Date(emp.data_instalacao).toLocaleDateString("pt-BR")}
                        </td>
                        <td className="py-3 px-3 font-mono">
                          {emp.data_ultima_troca
                            ? new Date(emp.data_ultima_troca).toLocaleDateString("pt-BR")
                            : "Inicial"}
                        </td>
                        <td className="py-3 px-3 font-mono font-semibold">
                          {emp.data_prevista_troca
                            ? new Date(emp.data_prevista_troca).toLocaleDateString("pt-BR")
                            : "—"}
                        </td>
                        <td className="py-3 px-3">
                          {emp.status_prazo === "ATRASADO" && (
                            <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-rose-100 text-rose-800 flex items-center gap-1 w-max animate-pulse">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              Atrasado ({Math.abs(dias)}d)
                            </span>
                          )}
                          {emp.status_prazo === "TROCA_HOJE" && (
                            <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-amber-100 text-amber-800 flex items-center gap-1 w-max">
                              <Clock className="w-3.5 h-3.5" />
                              Troca Hoje
                            </span>
                          )}
                          {emp.status_prazo === "EM_DIA" && (
                            <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-emerald-100 text-emerald-800 flex items-center gap-1 w-max">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Em dia ({dias}d rest.)
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              size="sm"
                              onClick={() => abrirModalTroca(emp)}
                              className="bg-sky-600 hover:bg-sky-700 text-white flex items-center gap-1 text-xs shadow-sm"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>Registrar Troca</span>
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => abrirHistoricoTrocas(emp)}
                              className="text-slate-600 hover:text-slate-900 text-xs"
                            >
                              <History className="w-3.5 h-3.5" />
                            </Button>
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
      )}

      {/* ABA 3: HISTÓRICO DE PACIENTES INATIVOS */}
      {abaAtiva === "inativos" && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-slate-800 text-base">Histórico de Pacientes Inativos / Devoluções</h3>
              <p className="text-xs text-slate-500">
                Registros de encerramentos por motivo de óbito, alta médica, melhora clínica ou transferência
              </p>
            </div>
            <ExportarExcel
              url="/api/oxigenio/exportar"
              params={{ tipo: "inativos" }}
              arquivo="oxigenio_pacientes_inativos"
              rotulo="Exportar Inativos"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wider border-y border-slate-200">
                <tr>
                  <th className="py-3 px-3">Paciente / Prontuário</th>
                  <th className="py-3 px-3">Serviço Utilizado</th>
                  <th className="py-3 px-3">Data de Instalação</th>
                  <th className="py-3 px-3">Data de Devolução</th>
                  <th className="py-3 px-3">Motivo de Encerramento</th>
                  <th className="py-3 px-3">Observações do Caso</th>
                  <th className="py-3 px-3 text-right">Termo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {emprestimosInativos.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-slate-400">
                      Nenhum paciente inativo registrado no histórico.
                    </td>
                  </tr>
                ) : (
                  emprestimosInativos.map((emp) => (
                    <tr key={emp.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-3">
                        <div className="font-bold text-slate-900">{emp.paciente_nome}</div>
                        <div className="text-[11px] text-slate-500">
                          CPF: {emp.paciente_cpf || "—"} · Pront: {emp.paciente_prontuario || "—"}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        {emp.tipo_servico === "MAQUINA" || emp.tipo_servico === "EQUIPAMENTO" || emp.tipo_servico === "MISTO" ? (
                          <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-100 text-indigo-800">
                            {emp.tipo_equipamento || "Equipamento"} (Série: {emp.equipamento_serie || "—"})
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-sky-100 text-sky-800">
                            Cilindro {emp.tipo_cilindro}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 font-mono">
                        {new Date(emp.data_instalacao).toLocaleDateString("pt-BR")}
                      </td>
                      <td className="py-3 px-3 font-mono font-semibold text-slate-900">
                        {emp.data_devolucao
                          ? new Date(emp.data_devolucao).toLocaleDateString("pt-BR")
                          : "—"}
                      </td>
                      <td className="py-3 px-3">
                        {emp.motivo_inativacao === "OBITO" && (
                          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-200 text-slate-800">
                            Óbito
                          </span>
                        )}
                        {emp.motivo_inativacao === "ALTA" && (
                          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">
                            Alta Médica
                          </span>
                        )}
                        {emp.motivo_inativacao === "MELHORA_CLINICA" && (
                          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-sky-100 text-sky-800">
                            Melhora Clínica
                          </span>
                        )}
                        {emp.motivo_inativacao === "TRANSFERENCIA" && (
                          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800">
                            Transferência
                          </span>
                        )}
                        {!["OBITO", "ALTA", "MELHORA_CLINICA", "TRANSFERENCIA"].includes(emp.motivo_inativacao || "") && (
                          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700">
                            {emp.motivo_inativacao || "Outro"}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-[11px] text-slate-600 max-w-xs truncate" title={emp.observacoes}>
                        {emp.observacoes || "—"}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <button
                          onClick={() => setComprovanteEmprestimoId(emp.id)}
                          className="p-1.5 text-sky-600 hover:text-sky-800 hover:bg-sky-50 rounded"
                          title="Ver Termo"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL: NOVO / EDITAR EQUIPAMENTO */}
      {modalEquipAberto && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full overflow-hidden border border-slate-200">
            <div className="px-6 py-4 bg-sky-800 text-white flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Stethoscope className="w-5 h-5" />
                <h3 className="font-bold text-base">
                  {equipamentoEdicao ? "Editar Equipamento" : "Cadastrar Equipamento"}
                </h3>
              </div>
              <button
                onClick={() => setModalEquipAberto(false)}
                className="text-white/80 hover:text-white text-xl font-bold"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSalvarEquipamento} className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Tipo de Equipamento *</Label>
                  <select
                    value={formEquip.tipo}
                    onChange={(e) => setFormEquip({ ...formEquip, tipo: e.target.value })}
                    className="w-full mt-1 px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white"
                  >
                    <option value="CONCENTRADOR_5L">Concentrador 5 Litros (5L)</option>
                    <option value="CONCENTRADOR_10L">Concentrador 10 Litros (10L)</option>
                    <option value="CPAP">CPAP</option>
                    <option value="BiPAP">BiPAP</option>
                    {formEquip.tipo === "CONCENTRADOR" && (
                      <option value="CONCENTRADOR">Concentrador de O2 (Padrão/Legado)</option>
                    )}
                  </select>
                </div>
                <div>
                  <Label>Número de Série *</Label>
                  <Input
                    required
                    placeholder="Ex: SN-98745612"
                    value={formEquip.numero_serie}
                    onChange={(e) => setFormEquip({ ...formEquip, numero_serie: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Patrimônio / Tombamento</Label>
                  <Input
                    placeholder="Ex: PAT-00123"
                    value={formEquip.patrimonio}
                    onChange={(e) => setFormEquip({ ...formEquip, patrimonio: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Marca / Modelo</Label>
                  <Input
                    placeholder="Ex: Philips Respironics EverFlo"
                    value={formEquip.marca_modelo}
                    onChange={(e) => setFormEquip({ ...formEquip, marca_modelo: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Propriedade *</Label>
                  <select
                    value={formEquip.propriedade}
                    onChange={(e) => setFormEquip({ ...formEquip, propriedade: e.target.value })}
                    className="w-full mt-1 px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white"
                  >
                    <option value="PROPRIO">Próprio do Município</option>
                    <option value="LOCADO">Locado de Empresa</option>
                  </select>
                </div>
                <div>
                  <Label>Empresa Fornecedora / Locadora</Label>
                  <select
                    value={formEquip.empresa_id}
                    onChange={(e) => setFormEquip({ ...formEquip, empresa_id: e.target.value })}
                    className="w-full mt-1 px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white"
                  >
                    <option value="">Nenhuma / Próprio</option>
                    {empresas.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.nome_fantasia || emp.razao_social || emp.nome}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Status Atual</Label>
                  <select
                    value={formEquip.status}
                    onChange={(e) => setFormEquip({ ...formEquip, status: e.target.value })}
                    className="w-full mt-1 px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white"
                  >
                    <option value="DISPONIVEL">Disponível</option>
                    <option value="EM_USO">Em Uso</option>
                    <option value="MANUTENCAO">Manutenção</option>
                    <option value="INATIVO_BAIXADO">Baixado</option>
                  </select>
                </div>
                <div>
                  <Label>Tensão Elétrica</Label>
                  <select
                    value={formEquip.tensao_eletrica}
                    onChange={(e) => setFormEquip({ ...formEquip, tensao_eletrica: e.target.value })}
                    className="w-full mt-1 px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white"
                  >
                    <option value="110V">110V</option>
                    <option value="220V">220V</option>
                    <option value="BIVOLT">Bivolt</option>
                  </select>
                </div>
                <div>
                  <Label>Horas de Uso (Horímetro)</Label>
                  <Input
                    type="number"
                    min="0"
                    value={formEquip.horas_uso}
                    onChange={(e) => setFormEquip({ ...formEquip, horas_uso: Number(e.target.value) })}
                  />
                </div>
              </div>

              <div>
                <Label>Observações Adicionais</Label>
                <Input
                  placeholder="Informações técnicas, revisões..."
                  value={formEquip.observacoes}
                  onChange={(e) => setFormEquip({ ...formEquip, observacoes: e.target.value })}
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setModalEquipAberto(false)}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={salvandoEquip}
                  className="bg-sky-600 hover:bg-sky-700 text-white"
                >
                  {salvandoEquip ? "Salvando..." : "Salvar Equipamento"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: REGISTRAR TROCA DE CILINDRO */}
      {modalTrocaAberto && emprestimoSelecionado && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden border border-slate-200">
            <div className="px-6 py-4 bg-indigo-900 text-white flex justify-between items-center">
              <div className="flex items-center gap-2">
                <RotateCcw className="w-5 h-5" />
                <h3 className="font-bold text-base">Registrar Troca Semanal de Cilindro</h3>
              </div>
              <button
                onClick={() => setModalTrocaAberto(false)}
                className="text-white/80 hover:text-white text-xl font-bold"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSalvarTroca} className="p-6 space-y-4 text-xs">
              <div className="bg-indigo-50 p-3 rounded-xl border border-indigo-100 text-xs text-indigo-900">
                <span className="block font-bold">{emprestimoSelecionado.paciente_nome}</span>
                <span className="text-[11px] text-indigo-700">
                  Equipamento: {emprestimoSelecionado.tipo_equipamento} (Série: {emprestimoSelecionado.equipamento_serie})
                </span>
                <div className="mt-1 text-[11px] text-indigo-600">
                  Data prevista anterior: {emprestimoSelecionado.data_prevista_troca
                    ? new Date(emprestimoSelecionado.data_prevista_troca).toLocaleDateString("pt-BR")
                    : "—"}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Data Efetiva da Troca *</Label>
                  <Input
                    type="date"
                    required
                    value={formTroca.data_troca}
                    onChange={(e) => setFormTroca({ ...formTroca, data_troca: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Tipo de Cilindro Entregue</Label>
                  <select
                    value={formTroca.tipo_cilindro}
                    onChange={(e) => setFormTroca({ ...formTroca, tipo_cilindro: e.target.value })}
                    className="w-full mt-1 px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white"
                  >
                    <option value="10m3">Cilindro 10m³ (Semanal)</option>
                    <option value="3m3">Cilindro 3m³ (Reserva)</option>
                    <option value="1m3">Cilindro 1m³ (Especial)</option>
                  </select>
                </div>
              </div>

              <div>
                <Label>Motorista / Servidor Responsável pela Entrega</Label>
                <Input
                  placeholder="Nome do entregador / técnico"
                  value={formTroca.responsavel_entrega}
                  onChange={(e) => setFormTroca({ ...formTroca, responsavel_entrega: e.target.value })}
                />
              </div>

              <div>
                <Label>Observações da Troca</Label>
                <Input
                  placeholder="Troca realizada com sucesso, sem vazamentos..."
                  value={formTroca.observacoes}
                  onChange={(e) => setFormTroca({ ...formTroca, observacoes: e.target.value })}
                />
              </div>

              <p className="text-[11px] text-slate-500 italic">
                * Ao confirmar, o sistema agendará automaticamente o próximo prazo de troca para +7 dias a partir da data informada.
              </p>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setModalTrocaAberto(false)}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={salvandoTroca}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  {salvandoTroca ? "Registrando..." : "Confirmar Troca (+7 dias)"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: HISTÓRICO DE TROCAS */}
      {modalHistoricoAberto && emprestimoSelecionado && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full overflow-hidden border border-slate-200">
            <div className="px-6 py-4 bg-slate-900 text-white flex justify-between items-center">
              <div className="flex items-center gap-2">
                <History className="w-5 h-5 text-sky-400" />
                <h3 className="font-bold text-base">Histórico de Trocas de Cilindro</h3>
              </div>
              <button
                onClick={() => setModalHistoricoAberto(false)}
                className="text-white/80 hover:text-white text-xl font-bold"
              >
                ×
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                <span className="font-bold text-slate-800 block">{emprestimoSelecionado.paciente_nome}</span>
                <span className="text-[11px] text-slate-500">
                  Prontuário: {emprestimoSelecionado.paciente_prontuario || "—"} · Concentrador Série: {emprestimoSelecionado.equipamento_serie}
                </span>
              </div>

              {carregandoHistorico ? (
                <div className="text-center py-6 text-slate-400">Carregando histórico...</div>
              ) : historicoTrocas.length === 0 ? (
                <div className="text-center py-6 text-slate-400">
                  Nenhuma troca registrada ainda para este paciente.
                </div>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {historicoTrocas.map((t) => (
                    <div key={t.id} className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex justify-between items-center text-xs">
                      <div>
                        <div className="font-semibold text-slate-900">
                          Troca em {new Date(t.data_troca).toLocaleDateString("pt-BR")}
                        </div>
                        <div className="text-[11px] text-slate-600">
                          Cilindro {t.tipo_cilindro} ({t.quantidade} unid) · Entregador: {t.responsavel_entrega || "—"}
                        </div>
                        {t.observacoes && (
                          <div className="text-[10px] text-slate-500 italic mt-0.5">{t.observacoes}</div>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {new Date(t.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-end pt-3 border-t border-slate-200">
                <Button
                  variant="outline"
                  onClick={() => setModalHistoricoAberto(false)}
                >
                  Fechar
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: ALTERAR STATUS OPERACIONAL DO EQUIPAMENTO */}
      {modalStatusAberto && equipamentoStatus && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden border border-slate-200">
            <div className="px-6 py-4 bg-amber-700 text-white flex justify-between items-center">
              <div className="flex items-center gap-2">
                <RefreshCw className="w-5 h-5 text-amber-200" />
                <h3 className="font-bold text-base">Alterar Status do Equipamento</h3>
              </div>
              <button
                onClick={() => setModalStatusAberto(false)}
                className="text-white/80 hover:text-white text-xl font-bold"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSalvarStatus} className="p-6 space-y-4 text-xs">
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-1">
                <div className="flex justify-between items-center">
                  <strong className="text-slate-900 text-sm">
                    {equipamentoStatus.tipo} · {equipamentoStatus.marca_modelo || "Padrão"}
                  </strong>
                  <span className="font-mono bg-slate-200 text-slate-800 px-2 py-0.5 rounded text-[10px]">
                    Série: {equipamentoStatus.numero_serie}
                  </span>
                </div>
                <div className="text-[11px] text-slate-600">
                  Status Atual: <strong>{equipamentoStatus.status}</strong>
                </div>
                {equipamentoStatus.paciente_atual_nome && (
                  <div className="text-[11px] text-sky-800 font-semibold pt-1 border-t border-slate-200">
                    Paciente em Uso: {equipamentoStatus.paciente_atual_nome}
                  </div>
                )}
              </div>

              <div>
                <Label>Novo Status do Equipamento *</Label>
                <select
                  required
                  value={formStatus.novo_status}
                  onChange={(e) => setFormStatus({ ...formStatus, novo_status: e.target.value })}
                  className="w-full mt-1 px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white font-medium"
                >
                  <option value="DISPONIVEL">Disponível no Estoque</option>
                  <option value="MANUTENCAO">Em Manutenção / Revisão Técnica</option>
                  <option value="INATIVO_BAIXADO">Inativo / Baixado do Patrimônio</option>
                  <option value="EM_USO">Em Uso com Paciente</option>
                </select>
              </div>

              {equipamentoStatus.paciente_atual_nome && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="desvincular_paciente"
                      checked={formStatus.desvincular_paciente}
                      onChange={(e) => setFormStatus({ ...formStatus, desvincular_paciente: e.target.checked })}
                      className="rounded text-amber-600 focus:ring-amber-500"
                    />
                    <label htmlFor="desvincular_paciente" className="text-xs text-amber-950 font-semibold cursor-pointer">
                      Desvincular e encerrar empréstimo do paciente
                    </label>
                  </div>
                  <p className="text-[10px] text-amber-800 leading-tight">
                    Dica: Para trocas temporárias ou revisões sem cancelamento do plano, mantenha <strong>desmarcado</strong>. Assim o paciente continua com status <strong>ATIVO</strong> no sistema.
                  </p>
                </div>
              )}

              <div>
                <Label>Motivo / Justificativa da Alteração</Label>
                <Input
                  placeholder="Ex: Troca preventiva de filtro, manutenção no motor, calibração..."
                  value={formStatus.motivo}
                  onChange={(e) => setFormStatus({ ...formStatus, motivo: e.target.value })}
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setModalStatusAberto(false)}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={salvandoStatus}
                  className="bg-amber-600 hover:bg-amber-700 text-white"
                >
                  {salvandoStatus ? "Salvando..." : "Confirmar Alteração"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: COMPROVANTE TERMO */}
      {comprovanteEmprestimoId && (
        <ComprovanteEmprestimoModal
          emprestimoId={comprovanteEmprestimoId}
          onClose={() => setComprovanteEmprestimoId(null)}
        />
      )}
    </div>
  );
}
