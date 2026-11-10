import { useEffect, useState } from "react";
import {
  Wind,
  Package,
  Plus,
  ShoppingCart,
  AlertTriangle,
  CheckCircle2,
  TrendingDown,
  Building2,
  Calendar,
  Users,
  Activity,
  BarChart3,
  RefreshCw,
  FileSpreadsheet,
  FileCheck,
  ShieldAlert,
  ArrowRightLeft,
  History,
  Database,
} from "lucide-react";
import {
  oxigenioResumoEstoque,
  oxigenioEmpresas,
  oxigenioLicitacoes,
  oxigenioCriarCompra,
  oxigenioCriarLicitacao,
  oxigenioCriarComodato,
  oxigenioListarComodato,
  oxigenioSeedDadosReais,
  type EstoqueOxigenioResumo,
  type EmpresaOxigenio,
  type LicitacaoOxigenio,
  type ComodatoMovimentacao,
} from "../../services/api";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";
import { Button, Card, Input, Label, Badge } from "../../components/ui/primitives";
import ExportarExcel from "../../components/ExportarExcel";

export default function OxigenioPainelEstoque() {
  const [resumo, setResumo] = useState<EstoqueOxigenioResumo | null>(null);
  const [empresas, setEmpresas] = useState<EmpresaOxigenio[]>([]);
  const [licitacoes, setLicitacoes] = useState<LicitacaoOxigenio[]>([]);
  const [filtroEmpresaId, setFiltroEmpresaId] = useState<number | undefined>(undefined);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState("");

  // Modais
  const [modalCompraAberto, setModalCompraAberto] = useState(false);
  const [modalLicitacaoAberto, setModalLicitacaoAberto] = useState(false);
  const [modalComodatoAberto, setModalComodatoAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);

  // Form Compra
  const [formCompra, setFormCompra] = useState({
    licitacao_id: "",
    data_compra: new Date().toISOString().slice(0, 10),
    numero_nf: "",
    qtd_10m3: "",
    qtd_3m3: "",
    qtd_1m3: "",
    valor_total: "",
    responsavel_recebimento: "",
    observacoes: "",
  });

  // Form Licitação
  const [formLicitacao, setFormLicitacao] = useState({
    empresa_id: "",
    numero_licitacao: "",
    numero_contrato: "",
    ano: String(new Date().getFullYear()),
    data_inicio: new Date().toISOString().slice(0, 10),
    data_fim: new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().slice(0, 10),
    objeto: "Fornecimento parcelado de oxigênio medicinal e gases hospitalares para a rede municipal de saúde",
    qtd_contratada_10m3: "",
    qtd_contratada_3m3: "",
    qtd_contratada_1m3: "",
    valor_unitario_10m3: "",
    valor_unitario_3m3: "",
    valor_unitario_1m3: "",
    valor_recarga_m3: "",
    locacao_mensal_concentrador: "",
    locacao_mensal_concentrador_5l: "",
    locacao_mensal_concentrador_10l: "",
    locacao_mensal_cpap: "",
    locacao_mensal_bipap: "",
    locacao_mensal_cilindro: "",
    saldo_alerta_minimo_pct: "20",
    observacoes: "",
  });
  const [personalizarPrecos, setPersonalizarPrecos] = useState(false);

  // Form Comodato
  const [formComodato, setFormComodato] = useState({
    empresa_id: "",
    tipo_movimentacao: "ENTRADA_COMODATO" as "ENTRADA_COMODATO" | "DEVOLUCAO_EMPRESA",
    tipo_cilindro: "10m3",
    quantidade: "1",
    numero_nota_remessa: "",
    data_movimentacao: new Date().toISOString().slice(0, 10),
    observacoes: "",
  });

  // Histórico de Comodato e Seed
  const [modalHistoricoComodato, setModalHistoricoComodato] = useState(false);
  const [historicoComodato, setHistoricoComodato] = useState<ComodatoMovimentacao[]>([]);
  const [carregandoHistorico, setCarregandoHistorico] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);

  // Helper anti-bloqueio de "0" inicial
  const handleNumChange = (
    setter: React.Dispatch<React.SetStateAction<any>>,
    campo: string,
    valStr: string
  ) => {
    const limpo = valStr.replace(/[^0-9.,]/g, "").replace(",", ".");
    setter((prev: any) => ({ ...prev, [campo]: limpo }));
  };

  const handleEmpresaLicitacaoChange = (empIdStr: string) => {
    const emp = empresas.find((e) => String(e.id) === empIdStr);
    setFormLicitacao((prev) => ({
      ...prev,
      empresa_id: empIdStr,
      valor_unitario_10m3: emp?.valor_unitario_10m3 ? String(emp.valor_unitario_10m3) : prev.valor_unitario_10m3,
      valor_unitario_3m3: emp?.valor_unitario_3m3 ? String(emp.valor_unitario_3m3) : prev.valor_unitario_3m3,
      valor_unitario_1m3: emp?.valor_unitario_1m3 ? String(emp.valor_unitario_1m3) : prev.valor_unitario_1m3,
      valor_recarga_m3: emp?.valor_recarga_m3 ? String(emp.valor_recarga_m3) : prev.valor_recarga_m3,
      locacao_mensal_concentrador: emp?.locacao_mensal_concentrador_5l ? String(emp.locacao_mensal_concentrador_5l) : (emp?.locacao_mensal_concentrador ? String(emp.locacao_mensal_concentrador) : prev.locacao_mensal_concentrador),
      locacao_mensal_concentrador_5l: emp?.locacao_mensal_concentrador_5l ? String(emp.locacao_mensal_concentrador_5l) : (emp?.locacao_mensal_concentrador ? String(emp.locacao_mensal_concentrador) : prev.locacao_mensal_concentrador_5l),
      locacao_mensal_concentrador_10l: emp?.locacao_mensal_concentrador_10l ? String(emp.locacao_mensal_concentrador_10l) : prev.locacao_mensal_concentrador_10l,
      locacao_mensal_cpap: emp?.locacao_mensal_cpap ? String(emp.locacao_mensal_cpap) : prev.locacao_mensal_cpap,
      locacao_mensal_bipap: emp?.locacao_mensal_bipap ? String(emp.locacao_mensal_bipap) : prev.locacao_mensal_bipap,
      locacao_mensal_cilindro: emp?.locacao_mensal_cilindro ? String(emp.locacao_mensal_cilindro) : prev.locacao_mensal_cilindro,
    }));
  };

  const carregarDados = async () => {
    setCarregando(true);
    setErro("");
    try {
      const [resEstoque, resEmp, resLic] = await Promise.all([
        oxigenioResumoEstoque(filtroEmpresaId ? { empresa_id: filtroEmpresaId } : undefined),
        oxigenioEmpresas({ apenas_ativas: true }),
        oxigenioLicitacoes(filtroEmpresaId ? { empresa_id: filtroEmpresaId } : undefined),
      ]);
      setResumo(resEstoque);
      setEmpresas(resEmp);
      setLicitacoes(resLic);
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Erro ao carregar dados do painel de oxigênio");
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregarDados();
  }, [filtroEmpresaId]);

  const handleSalvarCompra = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formCompra.licitacao_id) {
      setErro("Selecione a licitação vinculada à compra");
      return;
    }
    const totalQtd = Number(formCompra.qtd_10m3) + Number(formCompra.qtd_3m3) + Number(formCompra.qtd_1m3);
    if (totalQtd <= 0) {
      setErro("Informe ao menos uma quantidade de cilindro comprada");
      return;
    }

    setSalvando(true);
    setErro("");
    try {
      await oxigenioCriarCompra({
        licitacao_id: Number(formCompra.licitacao_id),
        data_compra: formCompra.data_compra,
        numero_nf: formCompra.numero_nf,
        qtd_10m3: Number(formCompra.qtd_10m3),
        qtd_3m3: Number(formCompra.qtd_3m3),
        qtd_1m3: Number(formCompra.qtd_1m3),
        valor_total: Number(formCompra.valor_total),
        responsavel_recebimento: formCompra.responsavel_recebimento,
        observacoes: formCompra.observacoes,
      });
      setSucesso("Entrada de cilindros registrada com sucesso! Estoque atualizado.");
      setModalCompraAberto(false);
      setFormCompra({
        licitacao_id: "",
        data_compra: new Date().toISOString().slice(0, 10),
        numero_nf: "",
        qtd_10m3: "",
        qtd_3m3: "",
        qtd_1m3: "",
        valor_total: "",
        responsavel_recebimento: "",
        observacoes: "",
      });
      carregarDados();
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Erro ao registrar compra de oxigênio");
    } finally {
      setSalvando(false);
    }
  };

  const abrirModalNovaLicitacao = () => {
    const primeiraEmpresa = empresas[0];
    setFormLicitacao({
      empresa_id: primeiraEmpresa ? String(primeiraEmpresa.id) : "",
      numero_licitacao: "",
      numero_contrato: "",
      ano: String(new Date().getFullYear()),
      data_inicio: new Date().toISOString().slice(0, 10),
      data_fim: new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().slice(0, 10),
      objeto: "Fornecimento parcelado de oxigênio medicinal e gases hospitalares para a rede municipal de saúde",
      qtd_contratada_10m3: "",
      qtd_contratada_3m3: "",
      qtd_contratada_1m3: "",
      valor_unitario_10m3: "",
      valor_unitario_3m3: "",
      valor_unitario_1m3: "",
      valor_recarga_m3: "",
      locacao_mensal_concentrador: "",
      locacao_mensal_concentrador_5l: "",
      locacao_mensal_concentrador_10l: "",
      locacao_mensal_cpap: "",
      locacao_mensal_bipap: "",
      locacao_mensal_cilindro: "",
      saldo_alerta_minimo_pct: "20",
      observacoes: "",
    });
    setPersonalizarPrecos(false);
    setModalLicitacaoAberto(true);
  };

  const handleSalvarLicitacao = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formLicitacao.empresa_id || !formLicitacao.numero_licitacao) {
      setErro("Preencha a empresa e o número da licitação");
      return;
    }

    const emp = empresas.find((item) => String(item.id) === formLicitacao.empresa_id);

    // Valores unitários calculados automaticamente da tabela da empresa (ou customizados caso o usuário tenha expandido)
    const val10 = (personalizarPrecos && Number(formLicitacao.valor_unitario_10m3) > 0)
      ? Number(formLicitacao.valor_unitario_10m3)
      : Number(emp?.valor_unitario_10m3 || 0);

    const val3 = (personalizarPrecos && Number(formLicitacao.valor_unitario_3m3) > 0)
      ? Number(formLicitacao.valor_unitario_3m3)
      : Number(emp?.valor_unitario_3m3 || 0);

    const val1 = (personalizarPrecos && Number(formLicitacao.valor_unitario_1m3) > 0)
      ? Number(formLicitacao.valor_unitario_1m3)
      : Number(emp?.valor_unitario_1m3 || 0);

    const valRec = (personalizarPrecos && Number(formLicitacao.valor_recarga_m3) > 0)
      ? Number(formLicitacao.valor_recarga_m3)
      : Number(emp?.valor_recarga_m3 || 0);

    const locConc5L = Number(emp?.locacao_mensal_concentrador_5l || emp?.locacao_mensal_concentrador || 0);
    const locConc10L = Number(emp?.locacao_mensal_concentrador_10l || 0);
    const locCpap = Number(emp?.locacao_mensal_cpap || 0);
    const locBipap = Number(emp?.locacao_mensal_bipap || 0);
    const locCil = Number(emp?.locacao_mensal_cilindro || 0);

    setSalvando(true);
    setErro("");
    try {
      await oxigenioCriarLicitacao({
        empresa_id: Number(formLicitacao.empresa_id),
        numero_licitacao: formLicitacao.numero_licitacao,
        numero_contrato: formLicitacao.numero_contrato,
        ano: Number(formLicitacao.ano) || new Date().getFullYear(),
        data_inicio: formLicitacao.data_inicio,
        data_fim: formLicitacao.data_fim,
        objeto: formLicitacao.objeto,
        qtd_contratada_10m3: Number(formLicitacao.qtd_contratada_10m3) || 0,
        qtd_contratada_3m3: Number(formLicitacao.qtd_contratada_3m3) || 0,
        qtd_contratada_1m3: Number(formLicitacao.qtd_contratada_1m3) || 0,
        valor_unitario_10m3: val10,
        valor_unitario_3m3: val3,
        valor_unitario_1m3: val1,
        valor_recarga_m3: valRec,
        locacao_mensal_concentrador: locConc5L,
        locacao_mensal_concentrador_5l: locConc5L,
        locacao_mensal_concentrador_10l: locConc10L,
        locacao_mensal_cpap: locCpap,
        locacao_mensal_bipap: locBipap,
        locacao_mensal_cilindro: locCil,
        saldo_alerta_minimo_pct: Number(formLicitacao.saldo_alerta_minimo_pct) || 20,
        observacoes: formLicitacao.observacoes,
      });
      setSucesso("Contrato / Licitação cadastrado com sucesso!");
      setModalLicitacaoAberto(false);
      carregarDados();
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Erro ao criar licitação");
    } finally {
      setSalvando(false);
    }
  };

  const handleSalvarComodato = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formComodato.empresa_id) {
      setErro("Selecione a empresa contratada / parceira");
      return;
    }
    if (Number(formComodato.quantidade) <= 0) {
      setErro("A quantidade deve ser maior que zero");
      return;
    }

    setSalvando(true);
    setErro("");
    try {
      await oxigenioCriarComodato({
        empresa_id: Number(formComodato.empresa_id),
        tipo_movimentacao: formComodato.tipo_movimentacao,
        tipo_cilindro: formComodato.tipo_cilindro,
        quantidade: Number(formComodato.quantidade),
        numero_nota_remessa: formComodato.numero_nota_remessa,
        data_movimentacao: formComodato.data_movimentacao,
        observacoes: formComodato.observacoes,
      });
      setSucesso(
        `Movimentação de Comodato (${
          formComodato.tipo_movimentacao === "ENTRADA_COMODATO" ? "Recebimento" : "Devolução"
        }) registrada com sucesso!`
      );
      setModalComodatoAberto(false);
      setFormComodato({
        empresa_id: "",
        tipo_movimentacao: "ENTRADA_COMODATO",
        tipo_cilindro: "10m3",
        quantidade: "1",
        numero_nota_remessa: "",
        data_movimentacao: new Date().toISOString().slice(0, 10),
        observacoes: "",
      });
      carregarDados();
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Erro ao registrar movimentação de comodato");
    } finally {
      setSalvando(false);
    }
  };

  const abrirHistoricoComodato = async () => {
    setModalHistoricoComodato(true);
    setCarregandoHistorico(true);
    try {
      const res = await oxigenioListarComodato(filtroEmpresaId ? { empresa_id: filtroEmpresaId } : undefined);
      setHistoricoComodato(res);
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Erro ao carregar histórico de comodato");
    } finally {
      setCarregandoHistorico(false);
    }
  };

  const handleSincronizarPlanilhaOficial = async () => {
    if (
      !window.confirm(
        "Atenção: Esta ação realizará a limpeza de testes e carregará todos os dados oficiais da planilha Oxigênio (1)(1).xlsx (empresas, contratos, CPAPs, BiPAPs, Concentradores 5L/10L ativos/inativos, abastecimentos e comodato). Deseja continuar?"
      )
    ) {
      return;
    }
    setSincronizando(true);
    setErro("");
    try {
      const res = await oxigenioSeedDadosReais();
      setSucesso(res.mensagem || "Dados oficiais importados com sucesso a partir da planilha!");
      carregarDados();
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Erro ao sincronizar dados da planilha oficial");
    } finally {
      setSincronizando(false);
    }
  };

  const totalAlertas = (resumo?.saldos_cilindros?.filter((s) => s.alerta_baixo)?.length || 0) +
    (resumo?.trocas_pendentes_atrasadas || 0);

  const empresaLicitacaoSelecionada = empresas.find((e) => String(e.id) === formLicitacao.empresa_id);

  const precoUnit10 = (personalizarPrecos && formLicitacao.valor_unitario_10m3)
    ? Number(formLicitacao.valor_unitario_10m3)
    : Number(empresaLicitacaoSelecionada?.valor_unitario_10m3 || 0);

  const precoUnit3 = (personalizarPrecos && formLicitacao.valor_unitario_3m3)
    ? Number(formLicitacao.valor_unitario_3m3)
    : Number(empresaLicitacaoSelecionada?.valor_unitario_3m3 || 0);

  const precoUnit1 = (personalizarPrecos && formLicitacao.valor_unitario_1m3)
    ? Number(formLicitacao.valor_unitario_1m3)
    : Number(empresaLicitacaoSelecionada?.valor_unitario_1m3 || 0);

  const qtd10 = Number(formLicitacao.qtd_contratada_10m3) || 0;
  const qtd3 = Number(formLicitacao.qtd_contratada_3m3) || 0;
  const qtd1 = Number(formLicitacao.qtd_contratada_1m3) || 0;

  const subtotal10 = qtd10 * precoUnit10;
  const subtotal3 = qtd3 * precoUnit3;
  const subtotal1 = qtd1 * precoUnit1;
  const valorTotalCalculado = subtotal10 + subtotal3 + subtotal1;

  const obterEscopoItem = (item: {
    empresa_id: number;
    servicos?: string[];
    fornece_oxigenio?: boolean;
    loca_equipamentos?: boolean;
  }) => {
    const emp = empresas.find((e) => e.id === item.empresa_id);
    const sList = (item.servicos && item.servicos.length > 0) ? item.servicos : (emp?.servicos || []);

    const temOxigenio = item.fornece_oxigenio !== undefined
      ? item.fornece_oxigenio
      : (sList.length === 0 || sList.includes("OXIGENIO_MEDICINAL") || sList.some((s) => s.toLowerCase().includes("oxigenio")));

    const temEquipamento = item.loca_equipamentos !== undefined
      ? item.loca_equipamentos
      : (sList.length === 0 || sList.some((s) =>
          ["LOCACAO_CONCENTRADOR", "LOCACAO_CONCENTRADOR_5L", "LOCACAO_CONCENTRADOR_10L", "LOCACAO_CPAP", "LOCACAO_BIPAP"].includes(s) ||
          s.toLowerCase().includes("locacao") ||
          s.toLowerCase().includes("concentrador") ||
          s.toLowerCase().includes("cpap") ||
          s.toLowerCase().includes("bipap") ||
          s.toLowerCase().includes("maquina")
        ));

    if (temOxigenio && temEquipamento) {
      return { temOxigenio: true, temEquipamento: true, rotulo: "Gases & Equipamentos", cor: "bg-teal-50 text-teal-800 border-teal-200" };
    }
    if (temOxigenio) {
      return { temOxigenio: true, temEquipamento: false, rotulo: "Oxigênio Medicinal", cor: "bg-sky-50 text-sky-800 border-sky-200" };
    }
    if (temEquipamento) {
      return { temOxigenio: false, temEquipamento: true, rotulo: "Locação de Equipamentos", cor: "bg-purple-50 text-purple-800 border-purple-200" };
    }
    return { temOxigenio: false, temEquipamento: false, rotulo: "Serviços de Apoio", cor: "bg-slate-50 text-slate-700 border-slate-200" };
  };

  const empresaFiltro = empresas.find((e) => e.id === filtroEmpresaId);
  const escopoFiltro = empresaFiltro ? obterEscopoItem({ empresa_id: empresaFiltro.id, servicos: empresaFiltro.servicos }) : null;

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Cabeçalho da Página */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-teal/10 text-teal">
            <Wind className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-xl md:text-2xl font-bold text-sus-950">
                Estoque de Oxigênio & Licitações
              </h1>
              {totalAlertas > 0 && (
                <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-amber-500 text-slate-900 animate-pulse">
                  {totalAlertas} {totalAlertas === 1 ? "alerta pendente" : "alertas pendentes"}
                </span>
              )}
            </div>
            <p className="text-xs text-ink/60 mt-0.5">
              Controle de saldos contratados em licitação, cilindros de 10m³, 3m³ e 1m³ e entradas de compra
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

      {/* Barra de Filtro e Ações Globais */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-slate-700 font-medium">
            <Building2 className="w-4 h-4 text-sky-600" />
            <span>Filtrar por Empresa:</span>
          </div>
          <select
            value={filtroEmpresaId || ""}
            onChange={(e) => setFiltroEmpresaId(e.target.value ? Number(e.target.value) : undefined)}
            className="px-3 py-1.5 text-sm rounded-lg border border-slate-300 bg-white text-slate-800 focus:ring-2 focus:ring-sky-500"
          >
            <option value="">Todas as Empresas Credenciadas</option>
            {empresas.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.nome_fantasia || emp.razao_social || emp.nome} ({emp.cnpj})
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            size="sm"
            onClick={carregarDados}
            className="flex items-center gap-1.5 text-xs text-slate-600"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${carregando ? "animate-spin" : ""}`} />
            <span>Atualizar</span>
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => setModalComodatoAberto(true)}
            variant="outline"
            className="border-amber-500 text-amber-800 hover:bg-amber-50 flex items-center gap-2 text-sm"
          >
            <ArrowRightLeft className="w-4 h-4 text-amber-600" />
            <span>Movimentar Comodato</span>
          </Button>
          <Button
            onClick={() => setModalCompraAberto(true)}
            className="bg-sky-600 hover:bg-sky-700 text-white flex items-center gap-2 text-sm shadow-sm"
          >
            <ShoppingCart className="w-4 h-4" />
            <span>Entrada de Compras</span>
          </Button>
          <Button
            onClick={abrirModalNovaLicitacao}
            variant="outline"
            className="border-sky-600 text-sky-700 hover:bg-sky-50 flex items-center gap-2 text-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Nova Licitação</span>
          </Button>
          <Button
            onClick={handleSincronizarPlanilhaOficial}
            disabled={sincronizando}
            variant="outline"
            className="border-slate-300 text-slate-700 hover:bg-slate-100 flex items-center gap-2 text-sm"
            title="Importa dados da planilha oficial (Concentradores, CPAP, BiPAP e Abastecimentos)"
          >
            <Database className={`w-4 h-4 text-emerald-600 ${sincronizando ? "animate-spin" : ""}`} />
            <span>{sincronizando ? "Importando..." : "Importar Planilha Oficial"}</span>
          </Button>
          <ExportarExcel
            url="/api/oxigenio/exportar"
            params={{ tipo: "estoque", empresa_id: filtroEmpresaId }}
            arquivo="oxigenio_estoque_licitacoes"
            rotulo="Exportar Excel"
          />
        </div>
      </div>

      {/* Alerta contextual quando a empresa filtrada não fornece oxigênio */}
      {escopoFiltro && !escopoFiltro.temOxigenio && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-900 flex items-center gap-3 shadow-sm">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
          <div>
            A empresa selecionada (<strong>{empresaFiltro?.nome_fantasia || empresaFiltro?.razao_social}</strong>) atua exclusivamente com <strong>{escopoFiltro.rotulo}</strong>, não possuindo fornecimento de cilindros ou cotas de oxigênio medicinal. As cotas e estoques de oxigênio abaixo não se aplicam a este fornecedor.
          </div>
        </div>
      )}

      {/* CARDS DE SALDO DE ESTOQUE E LICITAÇÃO (10m³, 3m³, 1m³) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {resumo?.saldos_cilindros?.map((cil) => {
          const nomeTipo = cil.tipo === "10m3" ? "Cilindro 10m³ (Grande / Hospitalar)" :
                           cil.tipo === "3m3" ? "Cilindro 3m³ (Reserva Concentrador)" :
                           "Cilindro 1m³ (Transporte / Especial)";
          const pct = Math.max(0, Math.min(100, cil.pct_saldo_licitacao));

          return (
            <div
              key={cil.tipo}
              className={`rounded-2xl p-5 border transition-shadow shadow-sm ${
                cil.alerta_baixo
                  ? "bg-rose-50/50 border-rose-300 ring-1 ring-rose-200"
                  : "bg-white border-slate-200 hover:shadow-md"
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div
                    className={`p-2.5 rounded-xl ${
                      cil.alerta_baixo ? "bg-rose-100 text-rose-700" : "bg-sky-100 text-sky-700"
                    }`}
                  >
                    <Package className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-800 text-base">{nomeTipo}</h3>
                    <span className="text-xs text-slate-500 font-mono">Tamanho: {cil.tipo}</span>
                  </div>
                </div>
                {cil.alerta_baixo ? (
                  <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-rose-200 text-rose-800 flex items-center gap-1 animate-pulse">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Estoque Baixo
                  </span>
                ) : (
                  <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-emerald-100 text-emerald-800 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Saldo Seguro
                  </span>
                )}
              </div>

              {/* Barra de Progresso do Saldo Contratado */}
              <div className="space-y-1.5 my-4">
                <div className="flex justify-between text-xs text-slate-600 font-medium">
                  <span>Saldo na Licitação</span>
                  <span className={cil.alerta_baixo ? "text-rose-700 font-bold" : "text-slate-800"}>
                    {cil.saldo_licitacao} unids ({pct.toFixed(0)}%)
                  </span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2.5 overflow-hidden">
                  <div
                    className={`h-2.5 rounded-full transition-all duration-500 ${
                      cil.alerta_baixo
                        ? "bg-rose-500"
                        : pct < 40
                        ? "bg-amber-500"
                        : "bg-emerald-500"
                    }`}
                    style={{ width: `${pct}%` }}
                  ></div>
                </div>
              </div>

              {/* Grade de Indicadores Detalhados */}
              <div className="grid grid-cols-2 gap-2 text-xs pt-3 border-t border-slate-100">
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                  <span className="text-slate-500 block">Total Contratado:</span>
                  <strong className="text-sm text-slate-800 font-semibold">{cil.contratado} unids</strong>
                </div>
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                  <span className="text-slate-500 block">Total Comprado:</span>
                  <strong className="text-sm text-slate-800 font-semibold">{cil.comprado} unids</strong>
                </div>
                <div className="bg-sky-50 p-2.5 rounded-lg border border-sky-100">
                  <span className="text-sky-700 block">Em Uso (Pacientes):</span>
                  <strong className="text-sm text-sky-900 font-bold">{cil.em_uso} cilindros</strong>
                </div>
                <div className="bg-rose-50 p-2.5 rounded-lg border border-rose-200">
                  <span className="text-rose-700 block font-medium">Cilindros Vazios:</span>
                  <strong className="text-sm text-rose-900 font-bold">{cil.vazios ?? 0} vazios</strong>
                </div>
                <div className="col-span-2 bg-emerald-50 p-2.5 rounded-xl border border-emerald-200 flex items-center justify-between">
                  <div>
                    <span className="text-emerald-800 font-bold block text-xs">Cheios Prontos p/ Uso:</span>
                    <span className="text-[10px] text-emerald-600">(Estoque útil livre, excluindo vazios)</span>
                  </div>
                  <strong className="text-base text-emerald-900 font-black">{cil.saldo_estoque_disponivel} unids</strong>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* PAINEL DESTACADO DE CILINDROS VAZIOS (RETORNADOS / AGUARDANDO RECOLHIMENTO) */}
      <div className="bg-white rounded-2xl border-2 border-rose-200 p-5 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-rose-100 text-rose-700">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-slate-900 text-base">
                  Painel de Controle de Cilindros Vazios
                </h3>
                <span className="px-2.5 py-0.5 text-xs font-bold rounded-full bg-rose-100 text-rose-800 border border-rose-300">
                  Estoque Inativo / Aguardando Recolhimento
                </span>
              </div>
              <p className="text-xs text-slate-600">
                Diferenciação clara entre cilindros cheios prontos para entrega imediata e cilindros vazios retornados de pacientes que aguardam coleta/troca
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <a
              href="/oxigenio/emprestimos"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white shadow-sm transition"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Ver Fila de Recolhimento</span>
            </a>
          </div>
        </div>

        {/* 4 Cards de Vazios por Tamanho e Comparativo */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-1">
          <div className="p-3.5 rounded-xl border border-rose-200 bg-rose-50/70 text-xs space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-700">Total Geral de Vazios</span>
              <AlertTriangle className="w-4 h-4 text-rose-600" />
            </div>
            <div className="text-2xl font-black text-rose-700">
              {resumo?.total_cilindros_vazios_pendentes ?? 0} <span className="text-xs font-normal text-slate-600">cilindros</span>
            </div>
            <p className="text-[11px] text-slate-500">
              Aguardando recolhimento pelas empresas contratadas
            </p>
          </div>

          <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 text-xs space-y-1">
            <span className="font-bold text-slate-700 block">Vazios 10m³ (Grande)</span>
            <div className="text-2xl font-black text-slate-800">
              {resumo?.vazios_10m3 ?? resumo?.saldos_cilindros?.find((s) => s.tipo === "10m3")?.vazios ?? 0} <span className="text-xs font-normal text-slate-500">unids</span>
            </div>
            <p className="text-[11px] text-slate-500">
              Hospitalar / Domiciliar contínuo
            </p>
          </div>

          <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 text-xs space-y-1">
            <span className="font-bold text-slate-700 block">Vazios 3m³ (Concentrador)</span>
            <div className="text-2xl font-black text-slate-800">
              {resumo?.vazios_3m3 ?? resumo?.saldos_cilindros?.find((s) => s.tipo === "3m3")?.vazios ?? 0} <span className="text-xs font-normal text-slate-500">unids</span>
            </div>
            <p className="text-[11px] text-slate-500">
              Reserva de segurança retornada
            </p>
          </div>

          <div className="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50/70 text-xs space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-bold text-emerald-800">Estoque Útil (Cheios)</span>
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="text-2xl font-black text-emerald-700">
              {resumo?.total_cilindros_cheios_disponiveis ?? (resumo?.saldos_cilindros?.reduce((acc, c) => acc + c.saldo_estoque_disponivel, 0) ?? 0)} <span className="text-xs font-normal text-emerald-700">cheios</span>
            </div>
            <p className="text-[11px] text-emerald-600">
              Prontos para uso imediato em novos atendimentos
            </p>
          </div>
        </div>
      </div>

      {/* SEÇÃO DE COMODATO & RASTREIO DE CILINDROS VAZIOS */}
      <div className="bg-gradient-to-r from-amber-50/60 via-slate-50 to-white rounded-2xl border border-amber-200/90 p-5 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-xl bg-amber-100 text-amber-800">
              <Package className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-slate-900 text-base">
                  Cilindros em Regime de Comodato (Propriedade da Fornecedora)
                </h3>
                <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-amber-200 text-amber-900">
                  Devolução Obrigatória
                </span>
              </div>
              <p className="text-xs text-slate-600">
                Controle de vasilhames cedidos pelas empresas prestadoras, saldos a restituir e pendências de recolhimento
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={abrirHistoricoComodato}
              className="border-amber-400 text-amber-800 hover:bg-amber-100 flex items-center gap-1.5 text-xs bg-white shadow-xs"
            >
              <History className="w-3.5 h-3.5 text-amber-700" />
              <span>Ver Histórico de Movimentações</span>
            </Button>
            <Button
              size="sm"
              onClick={() => setModalComodatoAberto(true)}
              className="bg-amber-600 hover:bg-amber-700 text-white flex items-center gap-1.5 text-xs shadow-sm"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
              <span>Registrar Entrada / Devolução Comodato</span>
            </Button>
          </div>
        </div>

        {/* Indicadores de Comodato e Cilindros Vazios */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Card 10m³ Comodato */}
          <div className="bg-white p-3.5 rounded-xl border border-slate-200 text-xs space-y-1">
            <div className="flex justify-between items-center">
              <span className="font-bold text-slate-700">Cilindro 10m³</span>
              <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono">Comodato</span>
            </div>
            <div className="text-lg font-bold text-amber-900">
              {resumo?.saldos_comodato?.find(s => s.tipo_cilindro === "10m3")?.saldo_em_comodato ?? 0} unids
            </div>
            <div className="text-[11px] text-slate-500">
              Recebidos: {resumo?.saldos_comodato?.find(s => s.tipo_cilindro === "10m3")?.total_recebido ?? 0} · Devolvidos: {resumo?.saldos_comodato?.find(s => s.tipo_cilindro === "10m3")?.total_devolvido ?? 0}
            </div>
          </div>

          {/* Card 3m³ Comodato */}
          <div className="bg-white p-3.5 rounded-xl border border-slate-200 text-xs space-y-1">
            <div className="flex justify-between items-center">
              <span className="font-bold text-slate-700">Cilindro 3m³</span>
              <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono">Comodato</span>
            </div>
            <div className="text-lg font-bold text-amber-900">
              {resumo?.saldos_comodato?.find(s => s.tipo_cilindro === "3m3")?.saldo_em_comodato ?? 0} unids
            </div>
            <div className="text-[11px] text-slate-500">
              Recebidos: {resumo?.saldos_comodato?.find(s => s.tipo_cilindro === "3m3")?.total_recebido ?? 0} · Devolvidos: {resumo?.saldos_comodato?.find(s => s.tipo_cilindro === "3m3")?.total_devolvido ?? 0}
            </div>
          </div>

          {/* Card 1m³ Comodato */}
          <div className="bg-white p-3.5 rounded-xl border border-slate-200 text-xs space-y-1">
            <div className="flex justify-between items-center">
              <span className="font-bold text-slate-700">Cilindro 1m³</span>
              <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono">Comodato</span>
            </div>
            <div className="text-lg font-bold text-amber-900">
              {resumo?.saldos_comodato?.find(s => s.tipo_cilindro === "1m3")?.saldo_em_comodato ?? 0} unids
            </div>
            <div className="text-[11px] text-slate-500">
              Recebidos: {resumo?.saldos_comodato?.find(s => s.tipo_cilindro === "1m3")?.total_recebido ?? 0} · Devolvidos: {resumo?.saldos_comodato?.find(s => s.tipo_cilindro === "1m3")?.total_devolvido ?? 0}
            </div>
          </div>

          {/* Card Cilindros Vazios Pendentes */}
          <div className={`p-3.5 rounded-xl border text-xs space-y-1 ${(resumo?.total_cilindros_vazios_pendentes ?? 0) > 0 ? "bg-rose-50 border-rose-300" : "bg-emerald-50 border-emerald-200"}`}>
            <div className="flex justify-between items-center">
              <span className="font-bold text-slate-800">Cilindros Vazios a Recolher</span>
              <AlertTriangle className={`w-4 h-4 ${(resumo?.total_cilindros_vazios_pendentes ?? 0) > 0 ? "text-rose-600" : "text-emerald-600"}`} />
            </div>
            <div className={`text-lg font-bold ${(resumo?.total_cilindros_vazios_pendentes ?? 0) > 0 ? "text-rose-700" : "text-emerald-700"}`}>
              {resumo?.total_cilindros_vazios_pendentes ?? 0} pendente(s)
            </div>
            <div className="text-[11px] text-slate-600">
              {(resumo?.total_cilindros_vazios_pendentes ?? 0) > 0
                ? "Aguardando coleta / troca pela fornecedora"
                : "Sem acúmulo de cilindros vazios"}
            </div>
          </div>
        </div>
      </div>

      {/* CARDS DE RESUMO DE PACIENTES ATIVOS E PRAZOS DE TROCA */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Pacientes em Oxigênio */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3">
          <div className="p-3 bg-sky-100 text-sky-700 rounded-xl">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs text-slate-500 block">Pacientes em Oxigênio</span>
            <strong className="text-xl font-bold text-slate-800">
              {resumo?.pacientes_ativos_oxigenio ?? 0}
            </strong>
            <span className="text-[11px] text-slate-400 block">Cilindros domiciliares</span>
          </div>
        </div>

        {/* Pacientes em Máquinas (CPAP/BiPAP/Concentrador) */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3">
          <div className="p-3 bg-indigo-100 text-indigo-700 rounded-xl">
            <Activity className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs text-slate-500 block">Pacientes em Máquinas</span>
            <strong className="text-xl font-bold text-slate-800">
              {resumo?.pacientes_ativos_maquinas ?? 0}
            </strong>
            <span className="text-[11px] text-indigo-600 block">
              {resumo?.pacientes_ativos_concentrador ?? 0} Conc. ({(resumo?.pacientes_ativos_concentrador_5l ?? 0)} 5L · {(resumo?.pacientes_ativos_concentrador_10l ?? 0)} 10L) · {resumo?.pacientes_ativos_cpap ?? 0} CPAP · {resumo?.pacientes_ativos_bipap ?? 0} BiPAP
            </span>
          </div>
        </div>

        {/* Alertas de Trocas Atrasadas */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3">
          <div className={`p-3 rounded-xl ${(resumo?.trocas_pendentes_atrasadas ?? 0) > 0 ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-600"}`}>
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs text-slate-500 block">Trocas Semanais Atrasadas</span>
            <strong className={`text-xl font-bold ${(resumo?.trocas_pendentes_atrasadas ?? 0) > 0 ? "text-rose-700" : "text-slate-800"}`}>
              {resumo?.trocas_pendentes_atrasadas ?? 0}
            </strong>
            <span className="text-[11px] text-slate-400 block">Prazo &gt; 7 dias esgotado</span>
          </div>
        </div>

        {/* Trocas Previstas Hoje e 7 dias */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3">
          <div className="p-3 bg-amber-100 text-amber-700 rounded-xl">
            <Calendar className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs text-slate-500 block">Trocas para Esta Semana</span>
            <strong className="text-xl font-bold text-slate-800">
              {(resumo?.trocas_pendentes_hoje ?? 0) + (resumo?.trocas_proximos_7_dias ?? 0)}
            </strong>
            <span className="text-[11px] text-amber-700 block">
              {resumo?.trocas_pendentes_hoje ?? 0} para hoje · {resumo?.trocas_proximos_7_dias ?? 0} nos próx. 7 dias
            </span>
          </div>
        </div>
      </div>

      {/* SEÇÃO DE ESTATÍSTICAS E GRÁFICOS (RECHARTS) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-sky-600" />
              <h3 className="font-bold text-slate-800 text-base">Consumo Mensal de Oxigênio (Últimos 6 meses)</h3>
            </div>
            <span className="text-xs text-slate-500 font-medium">Quantidade total de cilindros comprados / repostos</span>
          </div>

          <div className="h-72 w-full">
            {resumo?.consumo_mensal && resumo.consumo_mensal.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={resumo.consumo_mensal} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="mes" tick={{ fontSize: 12, fill: "#64748b" }} />
                  <YAxis tick={{ fontSize: 12, fill: "#64748b" }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#ffffff", borderRadius: "8px", border: "1px solid #e2e8f0", fontSize: "12px" }}
                  />
                  <Legend wrapperStyle={{ fontSize: "12px" }} />
                  <Bar dataKey="cilindros_10m3" name="Cilindro 10m³" fill="#0284c7" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="cilindros_3m3" name="Cilindro 3m³" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="cilindros_1m3" name="Cilindro 1m³" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-400 text-sm">
                Nenhum dado de consumo registrado no período recente.
              </div>
            )}
          </div>
        </div>

        {/* Distribuição por Empresa Credenciada */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-indigo-600" />
            <h3 className="font-bold text-slate-800 text-base">Empresas Fornecedoras</h3>
          </div>
          <p className="text-xs text-slate-500">
            Resumo de compras e máquinas vinculadas por empresa prestadora.
          </p>

          <div className="space-y-3 overflow-y-auto max-h-72 pr-1">
            {resumo?.consumo_por_empresa && resumo.consumo_por_empresa.length > 0 ? (
              resumo.consumo_por_empresa.map((item) => {
                const escopo = obterEscopoItem(item);
                return (
                  <div key={item.empresa_id} className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-2">
                    <div className="flex justify-between items-start gap-2">
                      <div className="min-w-0">
                        <strong className="text-slate-800 text-sm block leading-tight truncate">{item.empresa_nome}</strong>
                        <span className={`inline-block px-2 py-0.5 text-[10px] rounded-full border font-medium mt-1 ${escopo.cor}`}>
                          {escopo.rotulo}
                        </span>
                      </div>

                      {/* Badge superior direito dinâmico conforme o escopo da empresa */}
                      {escopo.temOxigenio ? (
                        <span className="font-mono bg-sky-100 text-sky-800 px-2 py-0.5 rounded text-[11px] font-semibold whitespace-nowrap shrink-0">
                          {item.total_cilindros} cilindros
                        </span>
                      ) : escopo.temEquipamento ? (
                        <span className="font-mono bg-purple-100 text-purple-800 px-2 py-0.5 rounded text-[11px] font-semibold whitespace-nowrap shrink-0">
                          {item.equipamentos_cadastrados} {item.equipamentos_cadastrados === 1 ? "máquina" : "máquinas"}
                        </span>
                      ) : null}
                    </div>

                    {/* Exibe consumo/gasto de cilindros SOMENTE se a empresa fornecer oxigênio */}
                    {escopo.temOxigenio && (
                      <div className="space-y-1 pt-1.5 border-t border-slate-200/80">
                        <div className="text-[11px] text-slate-500 font-medium flex justify-between">
                          <span>Compras de Oxigênio:</span>
                          <span className="font-semibold text-slate-700">{item.total_cilindros} un.</span>
                        </div>
                        <div className="grid grid-cols-3 gap-1 text-[11px] text-slate-600 bg-white p-2 rounded-lg border border-slate-200/70">
                          <div>10m³: <strong className="text-slate-900">{item.compras_10m3}</strong></div>
                          <div>3m³: <strong className="text-slate-900">{item.compras_3m3}</strong></div>
                          <div>1m³: <strong className="text-slate-900">{item.compras_1m3}</strong></div>
                        </div>
                        {(item.valor_total_compras ?? 0) > 0 && (
                          <div className="text-[11px] text-slate-600 flex justify-between pt-0.5">
                            <span>Gasto acumulado:</span>
                            <strong className="text-emerald-700">
                              R$ {(item.valor_total_compras ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </strong>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Exibe máquinas cadastradas SOMENTE se a empresa atuar com locação de equipamentos */}
                    {escopo.temEquipamento && (
                      <div className={`text-[11px] text-indigo-700 pt-1.5 ${escopo.temOxigenio ? "border-t border-slate-200/80" : ""}`}>
                        <div className="flex justify-between items-center bg-indigo-50/70 px-2.5 py-1.5 rounded-lg border border-indigo-100">
                          <span>Máquinas da empresa:</span>
                          <strong className="text-indigo-900 font-bold">
                            {item.equipamentos_cadastrados} {item.equipamentos_cadastrados === 1 ? "aparelho" : "aparelhos"}
                          </strong>
                        </div>
                        {(item.equipamentos_em_uso ?? 0) > 0 && (
                          <div className="text-[10px] text-slate-500 mt-0.5 text-right font-medium">
                            ({item.equipamentos_em_uso} em uso com pacientes)
                          </div>
                        )}
                      </div>
                    )}

                    {/* Caso a empresa não forneça oxigênio nem máquinas */}
                    {!escopo.temOxigenio && !escopo.temEquipamento && (
                      <div className="text-[11px] text-slate-500 italic bg-white p-2 rounded-lg border border-slate-200/60">
                        Prestadora de apoio ou insumos (sem fornecimento de oxigênio ou máquinas).
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="text-center py-8 text-slate-400 text-xs">
                Nenhuma empresa ativa encontrada.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* TABELA DE LICITAÇÕES VIGENTES & CONTRATOS */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden space-y-4 p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-slate-800 text-base">Licitações & Saldos Contratuais Vigentes</h3>
            <p className="text-xs text-slate-500">
              Acompanhamento de cotas licitadas, vigência de contrato e alertas de renovação
            </p>
          </div>
          <Button
            size="sm"
            onClick={abrirModalNovaLicitacao}
            className="bg-sky-600 hover:bg-sky-700 text-white flex items-center gap-1.5 text-xs self-start md:self-auto"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Adicionar Licitação</span>
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wider border-y border-slate-200">
              <tr>
                <th className="py-3 px-3">Licitação / Contrato</th>
                <th className="py-3 px-3">Empresa Contratada</th>
                <th className="py-3 px-3">Vigência</th>
                <th className="py-3 px-3">Saldo 10m³</th>
                <th className="py-3 px-3">Saldo 3m³</th>
                <th className="py-3 px-3">Saldo 1m³</th>
                <th className="py-3 px-3">Status do Contrato</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {licitacoes.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-slate-400">
                    Nenhuma licitação cadastrada no momento. Clique em "Nova Licitação" para começar.
                  </td>
                </tr>
              ) : (
                licitacoes.map((lic) => (
                  <tr key={lic.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-3">
                      <div className="font-semibold text-slate-900">{lic.numero_licitacao}</div>
                      <div className="text-[11px] text-slate-500">Contrato: {lic.numero_contrato || "—"} ({lic.ano})</div>
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-medium text-slate-800">{lic.empresa_nome}</div>
                    </td>
                    <td className="py-3 px-3 font-mono text-[11px]">
                      {new Date(lic.data_inicio).toLocaleDateString("pt-BR")} até {new Date(lic.data_fim).toLocaleDateString("pt-BR")}
                    </td>
                    <td className="py-3 px-3">
                      <span className={`font-semibold ${lic.saldo_disponivel_10m3 < (lic.qtd_contratada_10m3 * 0.2) ? "text-rose-600" : "text-slate-800"}`}>
                        {lic.saldo_disponivel_10m3}
                      </span>
                      <span className="text-slate-400"> / {lic.qtd_contratada_10m3}</span>
                    </td>
                    <td className="py-3 px-3">
                      <span className={`font-semibold ${lic.saldo_disponivel_3m3 < (lic.qtd_contratada_3m3 * 0.2) ? "text-rose-600" : "text-slate-800"}`}>
                        {lic.saldo_disponivel_3m3}
                      </span>
                      <span className="text-slate-400"> / {lic.qtd_contratada_3m3}</span>
                    </td>
                    <td className="py-3 px-3">
                      <span className={`font-semibold ${lic.saldo_disponivel_1m3 < (lic.qtd_contratada_1m3 * 0.2) ? "text-rose-600" : "text-slate-800"}`}>
                        {lic.saldo_disponivel_1m3}
                      </span>
                      <span className="text-slate-400"> / {lic.qtd_contratada_1m3}</span>
                    </td>
                    <td className="py-3 px-3">
                      {lic.alerta_esgotando ? (
                        <span className="px-2 py-0.5 text-[11px] font-semibold rounded bg-rose-100 text-rose-800 inline-flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          Saldo Crítico
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 text-[11px] font-medium rounded bg-emerald-100 text-emerald-800 inline-flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          Regular
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL: REGISTRAR COMPRA / ENTRADA DE CILINDROS */}
      {modalCompraAberto && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full overflow-hidden border border-slate-200">
            <div className="px-6 py-4 bg-sky-800 text-white flex justify-between items-center">
              <div className="flex items-center gap-2">
                <ShoppingCart className="w-5 h-5" />
                <h3 className="font-bold text-base">Registrar Entrada de Compras (Cilindros)</h3>
              </div>
              <button
                onClick={() => setModalCompraAberto(false)}
                className="text-white/80 hover:text-white text-xl font-bold"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSalvarCompra} className="p-6 space-y-4 text-xs">
              <div>
                <Label>Licitação / Contrato Vinculado *</Label>
                <select
                  required
                  value={formCompra.licitacao_id}
                  onChange={(e) => setFormCompra({ ...formCompra, licitacao_id: e.target.value })}
                  className="w-full mt-1 px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white"
                >
                  <option value="">Selecione a Licitação</option>
                  {licitacoes.map((lic) => (
                    <option key={lic.id} value={lic.id}>
                      {lic.numero_licitacao} - {lic.empresa_nome} (Contrato: {lic.numero_contrato || "—"})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Data da Compra / Entrada *</Label>
                  <Input
                    type="date"
                    required
                    value={formCompra.data_compra}
                    onChange={(e) => setFormCompra({ ...formCompra, data_compra: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Número da Nota Fiscal (NF)</Label>
                  <Input
                    placeholder="Ex: NF-e 12458"
                    value={formCompra.numero_nf}
                    onChange={(e) => setFormCompra({ ...formCompra, numero_nf: e.target.value })}
                  />
                </div>
              </div>

              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2">
                <span className="font-bold text-slate-800 block text-xs">Quantidades Recebidas por Tipo de Cilindro:</span>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label>Cilindros 10m³</Label>
                    <Input
                      type="text"
                      inputMode="numeric"
                      placeholder="0"
                      value={formCompra.qtd_10m3}
                      onChange={(e) => handleNumChange(setFormCompra, "qtd_10m3", e.target.value)}
                    />
                  </div>
                  <div>
                    <Label>Cilindros 3m³</Label>
                    <Input
                      type="text"
                      inputMode="numeric"
                      placeholder="0"
                      value={formCompra.qtd_3m3}
                      onChange={(e) => handleNumChange(setFormCompra, "qtd_3m3", e.target.value)}
                    />
                  </div>
                  <div>
                    <Label>Cilindros 1m³</Label>
                    <Input
                      type="text"
                      inputMode="numeric"
                      placeholder="0"
                      value={formCompra.qtd_1m3}
                      onChange={(e) => handleNumChange(setFormCompra, "qtd_1m3", e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Valor Total da Nota (R$)</Label>
                  <Input
                    type="text"
                    inputMode="decimal"
                    placeholder="0,00"
                    value={formCompra.valor_total}
                    onChange={(e) => handleNumChange(setFormCompra, "valor_total", e.target.value)}
                  />
                </div>
                <div>
                  <Label>Responsável pelo Recebimento</Label>
                  <Input
                    placeholder="Servidor que conferiu"
                    value={formCompra.responsavel_recebimento}
                    onChange={(e) => setFormCompra({ ...formCompra, responsavel_recebimento: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <Label>Observações Adicionais</Label>
                <Input
                  placeholder="Lote, lacres, observações da carga..."
                  value={formCompra.observacoes}
                  onChange={(e) => setFormCompra({ ...formCompra, observacoes: e.target.value })}
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setModalCompraAberto(false)}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={salvando}
                  className="bg-sky-600 hover:bg-sky-700 text-white"
                >
                  {salvando ? "Registrando..." : "Confirmar Entrada de Estoque"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: NOVA LICITAÇÃO / CONTRATO */}
      {modalLicitacaoAberto && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-xl w-full overflow-hidden border border-slate-200">
            <div className="px-6 py-4 bg-slate-900 text-white flex justify-between items-center">
              <div className="flex items-center gap-2">
                <FileCheck className="w-5 h-5 text-sky-400" />
                <h3 className="font-bold text-base">Cadastrar Nova Licitação / Contrato</h3>
              </div>
              <button
                onClick={() => setModalLicitacaoAberto(false)}
                className="text-white/80 hover:text-white text-xl font-bold"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSalvarLicitacao} className="p-6 space-y-4 text-xs">
              <div>
                <Label>Empresa Fornecedora *</Label>
                <select
                  required
                  value={formLicitacao.empresa_id}
                  onChange={(e) => handleEmpresaLicitacaoChange(e.target.value)}
                  className="w-full mt-1 px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white"
                >
                  <option value="">Selecione a Empresa</option>
                  {empresas.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.nome_fantasia || emp.razao_social || emp.nome} (CNPJ: {emp.cnpj})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Nº da Licitação *</Label>
                  <Input
                    required
                    placeholder="Ex: Pregão 015/2026"
                    value={formLicitacao.numero_licitacao}
                    onChange={(e) => setFormLicitacao({ ...formLicitacao, numero_licitacao: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Nº do Contrato</Label>
                  <Input
                    placeholder="Ex: Contrato 042/2026"
                    value={formLicitacao.numero_contrato}
                    onChange={(e) => setFormLicitacao({ ...formLicitacao, numero_contrato: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Ano Exercício</Label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    placeholder="2026"
                    value={formLicitacao.ano}
                    onChange={(e) => handleNumChange(setFormLicitacao, "ano", e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Início da Vigência</Label>
                  <Input
                    type="date"
                    value={formLicitacao.data_inicio}
                    onChange={(e) => setFormLicitacao({ ...formLicitacao, data_inicio: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Fim da Vigência</Label>
                  <Input
                    type="date"
                    value={formLicitacao.data_fim}
                    onChange={(e) => setFormLicitacao({ ...formLicitacao, data_fim: e.target.value })}
                  />
                </div>
              </div>

              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2">
                <span className="font-bold text-slate-800 block text-xs">Quantidades Contratadas na Licitação:</span>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label>Cota 10m³ (unids)</Label>
                    <Input
                      type="text"
                      inputMode="numeric"
                      placeholder="0"
                      value={formLicitacao.qtd_contratada_10m3}
                      onChange={(e) => handleNumChange(setFormLicitacao, "qtd_contratada_10m3", e.target.value)}
                    />
                  </div>
                  <div>
                    <Label>Cota 3m³ (unids)</Label>
                    <Input
                      type="text"
                      inputMode="numeric"
                      placeholder="0"
                      value={formLicitacao.qtd_contratada_3m3}
                      onChange={(e) => handleNumChange(setFormLicitacao, "qtd_contratada_3m3", e.target.value)}
                    />
                  </div>
                  <div>
                    <Label>Cota 1m³ (unids)</Label>
                    <Input
                      type="text"
                      inputMode="numeric"
                      placeholder="0"
                      value={formLicitacao.qtd_contratada_1m3}
                      onChange={(e) => handleNumChange(setFormLicitacao, "qtd_contratada_1m3", e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* CÁLCULO AUTOMÁTICO DOS PREÇOS COM BASE NA EMPRESA E QUANTIDADE */}
              <div className="bg-sky-50/70 p-3.5 rounded-xl border border-sky-200 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-bold text-sky-950 block text-xs">
                      Cálculo Automático dos Preços (Tabela da Empresa & Quantidade)
                    </span>
                    <span className="text-[11px] text-sky-700">
                      Os preços e subtotais são calculados automaticamente multiplicando a cota inserida pelos valores contratados da empresa.
                    </span>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-200 text-sky-900">
                    {empresaLicitacaoSelecionada ? "Valores Vinculados da Empresa" : "Selecione uma Empresa"}
                  </span>
                </div>

                {/* Cards de Subtotais por Cilindro */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                  {/* 10m³ */}
                  <div className="bg-white p-2.5 rounded-lg border border-sky-100 shadow-xs flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800 text-xs">Cilindro 10m³</span>
                      <span className="text-[11px] font-mono text-slate-500">{qtd10} unids</span>
                    </div>
                    <div className="text-[11px] text-slate-600 mt-1">
                      Unitário Empresa: <strong className="text-slate-800">R$ {precoUnit10.toFixed(2)}</strong>
                    </div>
                    <div className="mt-1 pt-1 border-t border-slate-100 flex items-center justify-between text-xs">
                      <span className="text-slate-500 font-medium">Subtotal:</span>
                      <strong className="text-sky-900 font-mono font-bold">
                        R$ {subtotal10.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </strong>
                    </div>
                  </div>

                  {/* 3m³ */}
                  <div className="bg-white p-2.5 rounded-lg border border-sky-100 shadow-xs flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800 text-xs">Cilindro 3m³</span>
                      <span className="text-[11px] font-mono text-slate-500">{qtd3} unids</span>
                    </div>
                    <div className="text-[11px] text-slate-600 mt-1">
                      Unitário Empresa: <strong className="text-slate-800">R$ {precoUnit3.toFixed(2)}</strong>
                    </div>
                    <div className="mt-1 pt-1 border-t border-slate-100 flex items-center justify-between text-xs">
                      <span className="text-slate-500 font-medium">Subtotal:</span>
                      <strong className="text-sky-900 font-mono font-bold">
                        R$ {subtotal3.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </strong>
                    </div>
                  </div>

                  {/* 1m³ */}
                  <div className="bg-white p-2.5 rounded-lg border border-sky-100 shadow-xs flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800 text-xs">Cilindro 1m³</span>
                      <span className="text-[11px] font-mono text-slate-500">{qtd1} unids</span>
                    </div>
                    <div className="text-[11px] text-slate-600 mt-1">
                      Unitário Empresa: <strong className="text-slate-800">R$ {precoUnit1.toFixed(2)}</strong>
                    </div>
                    <div className="mt-1 pt-1 border-t border-slate-100 flex items-center justify-between text-xs">
                      <span className="text-slate-500 font-medium">Subtotal:</span>
                      <strong className="text-sky-900 font-mono font-bold">
                        R$ {subtotal1.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </strong>
                    </div>
                  </div>
                </div>

                {/* Card de Valor Total Calculado */}
                <div className="p-3 bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-xl flex items-center justify-between">
                  <div>
                    <span className="text-[11px] font-bold text-emerald-800 uppercase tracking-wide block">
                      Valor Total Contratado (Calculado)
                    </span>
                    <span className="text-[11px] text-emerald-700">
                      Soma das cotas multiplicadas pelos valores unitários da empresa
                    </span>
                  </div>
                  <div className="text-right">
                    <strong className="text-xl font-black text-emerald-900 font-mono">
                      R$ {valorTotalCalculado.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </strong>
                  </div>
                </div>

                {/* Tarja com preços de serviços e locações da empresa */}
                {empresaLicitacaoSelecionada && (
                  <div className="p-2 bg-white/80 rounded-lg border border-sky-200/60 text-[11px] text-slate-600 space-y-1">
                    <span className="font-bold text-slate-700 block text-[10px] uppercase tracking-wider">
                      Outros Valores Contratados na Empresa (Informativo):
                    </span>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-x-2 gap-y-0.5 text-[10px]">
                      <div>Recarga m³: <strong className="text-slate-900">R$ {Number(empresaLicitacaoSelecionada.valor_recarga_m3 || 0).toFixed(2)}</strong></div>
                      <div>Conc. 5L: <strong className="text-slate-900">R$ {Number(empresaLicitacaoSelecionada.locacao_mensal_concentrador_5l || empresaLicitacaoSelecionada.locacao_mensal_concentrador || 0).toFixed(2)}/mês</strong></div>
                      <div>Conc. 10L: <strong className="text-slate-900">R$ {Number(empresaLicitacaoSelecionada.locacao_mensal_concentrador_10l || 0).toFixed(2)}/mês</strong></div>
                      <div>CPAP: <strong className="text-slate-900">R$ {Number(empresaLicitacaoSelecionada.locacao_mensal_cpap || 0).toFixed(2)}/mês</strong></div>
                    </div>
                  </div>
                )}

                {/* Aviso se a empresa não tiver preços */}
                {empresaLicitacaoSelecionada && precoUnit10 === 0 && precoUnit3 === 0 && precoUnit1 === 0 && (
                  <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg text-[11px] text-amber-800 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>
                      A empresa selecionada ainda não possui valores cadastrados. Você pode definir os preços diretamente na tela de <strong>Empresas & Fornecedores</strong> ou personalizar abaixo.
                    </span>
                  </div>
                )}

                {/* Toggle Opcional para Personalizar caso queira sobrescrever */}
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => setPersonalizarPrecos(!personalizarPrecos)}
                    className="text-[11px] font-semibold text-sky-700 hover:text-sky-900 underline"
                  >
                    {personalizarPrecos ? "Ocultar personalização de preços unitários" : "Deseja personalizar os valores unitários desta licitação? (Opcional)"}
                  </button>
                </div>

                {personalizarPrecos && (
                  <div className="pt-2 border-t border-sky-200/80 space-y-2">
                    <span className="text-[11px] font-bold text-slate-700 block">Personalização Pontual de Valores (Opcional):</span>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      <div>
                        <Label className="text-[10px]">Unid. 10m³ (R$)</Label>
                        <Input
                          type="text"
                          inputMode="decimal"
                          placeholder={String(empresaLicitacaoSelecionada?.valor_unitario_10m3 || "0,00")}
                          value={formLicitacao.valor_unitario_10m3}
                          onChange={(e) => handleNumChange(setFormLicitacao, "valor_unitario_10m3", e.target.value)}
                        />
                      </div>
                      <div>
                        <Label className="text-[10px]">Unid. 3m³ (R$)</Label>
                        <Input
                          type="text"
                          inputMode="decimal"
                          placeholder={String(empresaLicitacaoSelecionada?.valor_unitario_3m3 || "0,00")}
                          value={formLicitacao.valor_unitario_3m3}
                          onChange={(e) => handleNumChange(setFormLicitacao, "valor_unitario_3m3", e.target.value)}
                        />
                      </div>
                      <div>
                        <Label className="text-[10px]">Unid. 1m³ (R$)</Label>
                        <Input
                          type="text"
                          inputMode="decimal"
                          placeholder={String(empresaLicitacaoSelecionada?.valor_unitario_1m3 || "0,00")}
                          value={formLicitacao.valor_unitario_1m3}
                          onChange={(e) => handleNumChange(setFormLicitacao, "valor_unitario_1m3", e.target.value)}
                        />
                      </div>
                      <div>
                        <Label className="text-[10px]">Recarga/m³ (R$)</Label>
                        <Input
                          type="text"
                          inputMode="decimal"
                          placeholder={String(empresaLicitacaoSelecionada?.valor_recarga_m3 || "0,00")}
                          value={formLicitacao.valor_recarga_m3}
                          onChange={(e) => handleNumChange(setFormLicitacao, "valor_recarga_m3", e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Alerta Mínimo de Saldo (%)</Label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    placeholder="20"
                    value={formLicitacao.saldo_alerta_minimo_pct}
                    onChange={(e) => handleNumChange(setFormLicitacao, "saldo_alerta_minimo_pct", e.target.value)}
                  />
                  <span className="text-[10px] text-slate-500">Dispara alerta quando saldo for &lt; este valor (Padrão: 20%)</span>
                </div>
                <div>
                  <Label>Objeto do Contrato</Label>
                  <Input
                    value={formLicitacao.objeto}
                    onChange={(e) => setFormLicitacao({ ...formLicitacao, objeto: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setModalLicitacaoAberto(false)}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={salvando}
                  className="bg-sky-600 hover:bg-sky-700 text-white"
                >
                  {salvando ? "Gravando..." : "Salvar Licitação"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: MOVIMENTAÇÃO DE CILINDROS EM COMODATO */}
      {modalComodatoAberto && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full overflow-hidden border border-slate-200">
            <div className="px-6 py-4 bg-amber-700 text-white flex justify-between items-center">
              <div className="flex items-center gap-2">
                <ArrowRightLeft className="w-5 h-5 text-amber-200" />
                <h3 className="font-bold text-base">Movimentação de Comodato (Cilindros)</h3>
              </div>
              <button
                onClick={() => setModalComodatoAberto(false)}
                className="text-white/80 hover:text-white text-xl font-bold"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSalvarComodato} className="p-6 space-y-4 text-xs">
              <div>
                <Label>Empresa Fornecedora / Credenciada *</Label>
                <select
                  required
                  value={formComodato.empresa_id}
                  onChange={(e) => setFormComodato({ ...formComodato, empresa_id: e.target.value })}
                  className="w-full mt-1 px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white"
                >
                  <option value="">Selecione a Empresa</option>
                  {empresas.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.nome_fantasia || emp.razao_social || emp.nome} (CNPJ: {emp.cnpj})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Tipo de Movimentação *</Label>
                  <select
                    value={formComodato.tipo_movimentacao}
                    onChange={(e) => setFormComodato({ ...formComodato, tipo_movimentacao: e.target.value as "ENTRADA_COMODATO" | "DEVOLUCAO_EMPRESA" })}
                    className="w-full mt-1 px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white font-medium"
                  >
                    <option value="ENTRADA_COMODATO">Recebimento (Entrada com o Município)</option>
                    <option value="DEVOLUCAO_EMPRESA">Devolução à Fornecedora (Saída)</option>
                  </select>
                </div>
                <div>
                  <Label>Data da Movimentação *</Label>
                  <Input
                    type="date"
                    required
                    value={formComodato.data_movimentacao}
                    onChange={(e) => setFormComodato({ ...formComodato, data_movimentacao: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Tipo de Cilindro *</Label>
                  <select
                    value={formComodato.tipo_cilindro}
                    onChange={(e) => setFormComodato({ ...formComodato, tipo_cilindro: e.target.value })}
                    className="w-full mt-1 px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white"
                  >
                    <option value="10m3">Cilindro 10m³ (Grande / Hospitalar)</option>
                    <option value="3m3">Cilindro 3m³ (Reserva Concentrador)</option>
                    <option value="1m3">Cilindro 1m³ (Transporte / Especial)</option>
                  </select>
                </div>
                <div>
                  <Label>Quantidade *</Label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    placeholder="1"
                    required
                    value={formComodato.quantidade}
                    onChange={(e) => handleNumChange(setFormComodato, "quantidade", e.target.value)}
                  />
                </div>
              </div>

              <div>
                <Label>Nº Nota Fiscal de Remessa / Guia</Label>
                <Input
                  placeholder="Ex: NF Remessa 5521"
                  value={formComodato.numero_nota_remessa}
                  onChange={(e) => setFormComodato({ ...formComodato, numero_nota_remessa: e.target.value })}
                />
              </div>

              <div>
                <Label>Observações</Label>
                <Input
                  placeholder="Motorista, placa do veículo, estado dos vasilhames..."
                  value={formComodato.observacoes}
                  onChange={(e) => setFormComodato({ ...formComodato, observacoes: e.target.value })}
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setModalComodatoAberto(false)}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={salvando}
                  className="bg-amber-600 hover:bg-amber-700 text-white"
                >
                  {salvando ? "Salvando..." : "Confirmar Movimentação"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: HISTÓRICO DE MOVIMENTAÇÕES DE COMODATO */}
      {modalHistoricoComodato && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-4xl w-full overflow-hidden border border-slate-200 max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 bg-amber-800 text-white flex justify-between items-center">
              <div className="flex items-center gap-2">
                <History className="w-5 h-5 text-amber-200" />
                <div>
                  <h3 className="font-bold text-base">Histórico de Movimentações de Comodato</h3>
                  <p className="text-[11px] text-amber-200">
                    Registro de entradas (balas cedidas) e devoluções para as fornecedoras
                  </p>
                </div>
              </div>
              <button
                onClick={() => setModalHistoricoComodato(false)}
                className="text-white/80 hover:text-white text-xl font-bold"
              >
                ×
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 space-y-4">
              {carregandoHistorico ? (
                <div className="py-12 text-center text-slate-400">
                  <div className="inline-block animate-spin w-8 h-8 border-4 border-amber-600 border-t-transparent rounded-full mb-2"></div>
                  <p className="text-xs">Carregando histórico de movimentações...</p>
                </div>
              ) : historicoComodato.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-xs">
                  Nenhuma movimentação de comodato registrada até o momento.
                </div>
              ) : (
                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 text-slate-700 font-bold uppercase text-[10px]">
                      <tr>
                        <th className="p-3 border-b">Data</th>
                        <th className="p-3 border-b">Empresa</th>
                        <th className="p-3 border-b">Tipo</th>
                        <th className="p-3 border-b">Cilindro</th>
                        <th className="p-3 border-b text-center">Quantidade</th>
                        <th className="p-3 border-b">Doc / Remessa</th>
                        <th className="p-3 border-b">Responsável / Obs</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {historicoComodato.map((mov) => {
                        const isEntrada =
                          mov.tipo_movimentacao === "ENTRADA_COMODATO" || mov.tipo_movimentacao === "ENTRADA";
                        return (
                          <tr key={mov.id} className="hover:bg-slate-50">
                            <td className="p-3 font-mono text-slate-600 whitespace-nowrap">
                              {mov.data_movimento || mov.data_movimentacao
                                ? new Date(
                                    (mov.data_movimento || mov.data_movimentacao) + "T00:00:00"
                                  ).toLocaleDateString("pt-BR")
                                : "—"}
                            </td>
                            <td className="p-3 font-medium text-slate-800">
                              {mov.empresa_nome || "—"}
                            </td>
                            <td className="p-3">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold inline-flex items-center gap-1 ${
                                  isEntrada
                                    ? "bg-emerald-100 text-emerald-800"
                                    : "bg-amber-100 text-amber-800"
                                }`}
                              >
                                {isEntrada ? "Entrada (Cedido)" : "Devolução"}
                              </span>
                            </td>
                            <td className="p-3 font-semibold text-slate-700">
                              {mov.tipo_cilindro}
                            </td>
                            <td className="p-3 text-center font-bold text-slate-900 font-mono">
                              {mov.quantidade} unids
                            </td>
                            <td className="p-3 text-slate-600 font-mono text-[11px]">
                              {mov.numero_nota_remessa || mov.numero_documento || "—"}
                            </td>
                            <td className="p-3 text-slate-500 text-[11px]">
                              {mov.observacoes || mov.responsavel || "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex justify-between items-center text-xs">
              <span className="text-slate-500">
                Total de registros: <strong>{historicoComodato.length}</strong>
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setModalHistoricoComodato(false)}
              >
                Fechar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
