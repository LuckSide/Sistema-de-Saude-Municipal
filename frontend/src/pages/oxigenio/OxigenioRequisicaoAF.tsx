import { useEffect, useState } from "react";
import {
  FileText,
  Printer,
  AlertTriangle,
  CheckCircle2,
  Building2,
  Calendar,
  Users,
  Activity,
  FileSpreadsheet,
  ShieldAlert,
  Send,
  RefreshCw,
  DollarSign,
  TrendingUp,
  Receipt,
  Package,
  Truck,
  BarChart3,
  Layers,
} from "lucide-react";
import {
  oxigenioRequisicaoAF,
  oxigenioRelatorioFaturamento,
  oxigenioEmpresas,
  type RequisicaoAF,
  type RelatorioFaturamento,
  type EmpresaOxigenio,
  type ItemFaturamentoPaciente,
} from "../../services/api";
import { Button, Card, Badge, Input, Label } from "../../components/ui/primitives";
import ExportarExcel from "../../components/ExportarExcel";

export default function OxigenioRequisicaoAF() {
  const [abaAtiva, setAbaAtiva] = useState<"requisicao" | "faturamento">("requisicao");

  const [requisicao, setRequisicao] = useState<RequisicaoAF | null>(null);
  const [faturamento, setFaturamento] = useState<RelatorioFaturamento | null>(null);
  const [empresas, setEmpresas] = useState<EmpresaOxigenio[]>([]);

  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  // Filtros Financeiros
  const [ano, setAno] = useState(new Date().getFullYear());
  const [mes, setMes] = useState(new Date().getMonth() + 1);
  const [empresaFaturamentoId, setEmpresaFaturamentoId] = useState<string>("");

  const carregarRequisicao = async () => {
    setCarregando(true);
    setErro("");
    try {
      const res = await oxigenioRequisicaoAF();
      setRequisicao(res);
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Erro ao gerar requisição AF");
    } finally {
      setCarregando(false);
    }
  };

  const carregarFaturamento = async () => {
    setCarregando(true);
    setErro("");
    try {
      const [resFat, resEmp] = await Promise.all([
        oxigenioRelatorioFaturamento(
          ano,
          mes,
          empresaFaturamentoId ? Number(empresaFaturamentoId) : undefined
        ),
        oxigenioEmpresas({ apenas_ativas: true }),
      ]);
      setFaturamento(resFat);
      setEmpresas(resEmp);
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Erro ao gerar relatório financeiro");
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    if (abaAtiva === "requisicao") {
      carregarRequisicao();
    } else {
      carregarFaturamento();
    }
  }, [abaAtiva, ano, mes, empresaFaturamentoId]);

  const handlePrint = () => {
    window.print();
  };

  const mesesNomes = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
  ];

  return (
    <div className="p-4 md:p-6 space-y-6">
      <style>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 8mm 10mm;
          }
          html, body {
            width: 210mm !important;
            height: 297mm !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          body * {
            visibility: hidden;
          }
          #relatorio-a4-impressao, #relatorio-a4-impressao * {
            visibility: visible;
          }
          #relatorio-a4-impressao {
            position: absolute;
            left: 0;
            top: 0;
            width: 100% !important;
            max-width: 190mm !important;
            margin: 0 auto !important;
            padding: 0 !important;
            font-size: 11px !important;
            line-height: 1.3 !important;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>

      {/* Cabeçalho da Página (Oculto na impressão) */}
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden no-print">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-teal/10 text-teal">
            <Receipt className="w-6 h-6" />
          </div>
          <div>
            <h1 className="font-display text-xl md:text-2xl font-bold text-sus-950">
              Relatórios Técnicos & Faturamento
            </h1>
            <p className="text-xs text-ink/60 mt-0.5">
              Requisições de compra AF, balanço de custos e apuração mensal de fornecedores
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {abaAtiva === "requisicao" ? (
            <>
              <Button
                variant="outline"
                onClick={carregarRequisicao}
                className="flex items-center gap-1.5 text-xs text-slate-600"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${carregando ? "animate-spin" : ""}`} />
                <span>Recalcular Previsão</span>
              </Button>
              <Button
                onClick={handlePrint}
                className="bg-sky-600 hover:bg-sky-700 text-white flex items-center gap-2 text-xs shadow-sm"
              >
                <Printer className="w-4 h-4" />
                <span>Imprimir Requisição AF</span>
              </Button>
              <ExportarExcel
                url="/api/oxigenio/exportar"
                params={{ tipo: "estoque" }}
                arquivo="oxigenio_requisicao_af"
                rotulo="Exportar Dados"
              />
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={carregarFaturamento}
                className="flex items-center gap-1.5 text-xs text-slate-600"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${carregando ? "animate-spin" : ""}`} />
                <span>Atualizar Apuração</span>
              </Button>
              <Button
                onClick={handlePrint}
                className="bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-2 text-xs shadow-sm"
              >
                <Printer className="w-4 h-4" />
                <span>Imprimir Relatório A4</span>
              </Button>
              <ExportarExcel
                url="/api/oxigenio/relatorios/faturamento/exportar"
                params={{
                  ano,
                  mes,
                  empresa_id: empresaFaturamentoId ? Number(empresaFaturamentoId) : undefined,
                }}
                arquivo={`faturamento_oxigenio_${ano}_${mes}`}
                rotulo="Exportar Excel"
              />
            </>
          )}
        </div>
      </div>

      {erro && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl flex items-center justify-between text-sm shadow-sm print:hidden no-print">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
            <span>{erro}</span>
          </div>
          <button onClick={() => setErro("")} className="text-rose-500 hover:text-rose-700 font-bold">×</button>
        </div>
      )}

      {/* ABAS SUPERIORES */}
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 pt-2 rounded-t-xl shadow-sm print:hidden no-print">
        <button
          onClick={() => setAbaAtiva("requisicao")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs md:text-sm font-semibold border-b-2 transition-colors ${
            abaAtiva === "requisicao"
              ? "border-sky-600 text-sky-700 bg-sky-50/50 rounded-t-lg"
              : "border-transparent text-slate-600 hover:text-slate-900"
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Requisição de Compra / Emissão AF</span>
        </button>

        <button
          onClick={() => setAbaAtiva("faturamento")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs md:text-sm font-semibold border-b-2 transition-colors ${
            abaAtiva === "faturamento"
              ? "border-emerald-600 text-emerald-700 bg-emerald-50/50 rounded-t-lg"
              : "border-transparent text-slate-600 hover:text-slate-900"
          }`}
        >
          <DollarSign className="w-4 h-4" />
          <span>Relatório de Faturamento & Financeiro (Empresas)</span>
        </button>
      </div>

      {/* ABA 1: REQUISIÇÃO TÉCNICA AF */}
      {abaAtiva === "requisicao" && (
        <div id="relatorio-a4-impressao" className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 md:p-8 space-y-6 text-slate-900 print:border-none print:shadow-none print:p-0">
          {carregando ? (
            <div className="py-16 text-center text-slate-400">
              <div className="inline-block animate-spin w-8 h-8 border-4 border-sky-600 border-t-transparent rounded-full mb-2"></div>
              <p className="text-xs">Calculando demanda, histórico de consumo e formulando justificativa...</p>
            </div>
          ) : requisicao ? (
            <div className="border border-slate-300 rounded-xl p-6 bg-white space-y-6 print:border-none print:p-0">
              {/* Cabeçalho da Requisição */}
              <div className="text-center border-b pb-4 border-slate-300 space-y-1">
                <div className="font-bold text-base md:text-lg uppercase tracking-wide text-slate-900">
                  PREFEITURA MUNICIPAL DE GUAPÉ · ESTADO DE MINAS GERAIS
                </div>
                <div className="font-semibold text-sm text-slate-700 uppercase">
                  {requisicao.secretaria}
                </div>
                <div className="text-xs text-slate-500 uppercase">
                  {requisicao.setor} · SISTEMA MUNICIPAL DE SAÚDE
                </div>
                <div className="inline-block mt-2 px-3 py-1 bg-sky-100 text-sky-900 font-bold rounded-full text-xs font-mono">
                  AUTORIZAÇÃO DE FORNECIMENTO / REQUISIÇÃO TÉCNICA Nº {requisicao.codigo_requisicao}
                </div>
              </div>

              {/* Metadados do Pedido */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs">
                <div>
                  <span className="text-slate-500 block">Data de Emissão:</span>
                  <strong>{new Date(requisicao.data_geracao).toLocaleDateString("pt-BR")}</strong>
                </div>
                <div>
                  <span className="text-slate-500 block">Setor Requisitante:</span>
                  <strong>{requisicao.setor}</strong>
                </div>
                <div>
                  <span className="text-slate-500 block">Destino da Demanda:</span>
                  <strong>Almoxarifado Central / Compras</strong>
                </div>
                <div>
                  <span className="text-slate-500 block">Munícipes Dependentes Ativos:</span>
                  <strong className="text-sky-700 text-sm">{requisicao.pacientes_ativos_dependentes} pacientes</strong>
                </div>
              </div>

              {/* Tabela de Levantamento de Estoque e Demanda Sugerida */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 font-bold text-slate-800 uppercase text-xs tracking-wider border-b border-slate-200 pb-1">
                  <Activity className="w-4 h-4 text-sky-600" />
                  <span>1. Demonstrativo de Saldos, Consumo e Quantidades Sugeridas</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border border-slate-200 rounded-lg">
                    <thead className="bg-slate-100 text-slate-700 font-bold uppercase text-[10px]">
                      <tr>
                        <th className="p-2.5 border-b border-slate-200">Tipo / Item</th>
                        <th className="p-2.5 border-b border-slate-200">Saldo Atual (Licitação)</th>
                        <th className="p-2.5 border-b border-slate-200">Consumo Médio / Mês</th>
                        <th className="p-2.5 border-b border-slate-200">Autonomia Prevista</th>
                        <th className="p-2.5 border-b border-slate-200">Quantidade Sugerida</th>
                        <th className="p-2.5 border-b border-slate-200">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {requisicao.itens.map((it) => (
                        <tr key={it.tipo_cilindro} className={it.urgente ? "bg-rose-50/40" : "bg-white"}>
                          <td className="p-2.5 font-semibold text-slate-900">
                            {it.descricao}
                          </td>
                          <td className="p-2.5 font-mono">
                            <span className={it.urgente ? "font-bold text-rose-700" : "text-slate-800"}>
                              {it.saldo_licitacao_atual} unids
                            </span>
                          </td>
                          <td className="p-2.5 font-mono text-slate-700">
                            {it.consumo_medio_mensal} unids / mês
                          </td>
                          <td className="p-2.5 font-mono">
                            <span className={it.urgente ? "font-bold text-rose-700" : "text-slate-800"}>
                              {it.previsao_dias_estoque} dias
                            </span>
                          </td>
                          <td className="p-2.5 font-mono font-bold text-sky-900">
                            {it.quantidade_sugerida} unids
                          </td>
                          <td className="p-2.5">
                            {it.urgente ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 inline-flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3" />
                                Crítico
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-800">
                                Estável
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Justificativa Técnica Oficial */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 font-bold text-slate-800 uppercase text-xs tracking-wider border-b border-slate-200 pb-1">
                  <FileText className="w-4 h-4 text-sky-600" />
                  <span>2. Justificativa Técnica e Fundamentação da Demanda</span>
                </div>
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-800 leading-relaxed text-justify space-y-2 whitespace-pre-line font-serif">
                  {requisicao.justificativa_tecnica}
                </div>
              </div>

              {/* Parecer e Despacho Administrativo */}
              <div className="p-4 bg-sky-50/50 rounded-xl border border-sky-100 text-xs text-slate-700 space-y-2">
                <strong className="block text-sky-900 font-semibold uppercase text-[11px]">
                  Despacho da Secretaria Municipal de Saúde:
                </strong>
                <p className="text-[11px] leading-relaxed">
                  Diante do exposto e da essencialidade contínua do fornecimento de oxigênio medicinal e suporte ventilatório aos munícipes cadastrados, encaminhe-se a presente Requisição ao Setor de Compras / Licitações para imediata emissão da respectiva <strong>Autorização de Fornecimento (AF)</strong> ou abertura de novo procedimento licitatório conforme os saldos disponíveis em ata.
                </p>
              </div>

              {/* Campos de Assinatura */}
              <div className="pt-10 grid grid-cols-2 gap-8 text-center text-xs">
                <div>
                  <div className="border-b border-slate-700 mx-6 mb-2"></div>
                  <strong className="block text-slate-900">{requisicao.solicitante_nome}</strong>
                  <span className="text-slate-600 block">{requisicao.solicitante_cargo}</span>
                  <span className="text-[11px] text-slate-500">Responsável pelo Setor Requisitante</span>
                </div>

                <div>
                  <div className="border-b border-slate-700 mx-6 mb-2"></div>
                  <strong className="block text-slate-900">Secretário(a) Municipal de Saúde</strong>
                  <span className="text-slate-600 block">Município de Guapé / MG</span>
                  <span className="text-[11px] text-slate-500">Ordenador de Despesas / Autorização</span>
                </div>
              </div>

              <div className="text-[10px] text-center text-slate-400 pt-4 border-t border-slate-200">
                Documento gerado eletronicamente pelo Sistema de Gestão de Saúde de Guapé/MG em{" "}
                {new Date().toLocaleString("pt-BR")}. Código de Controle: {requisicao.codigo_requisicao}.
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* ABA 2: RELATÓRIO DE FATURAMENTO & FINANCEIRO */}
      {abaAtiva === "faturamento" && (
        <div className="space-y-6">
          {/* BARRA DE FILTROS DO FATURAMENTO (Oculta na impressão) */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 print:hidden no-print">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <div className="flex items-center gap-1.5 font-bold text-slate-700">
                <Calendar className="w-4 h-4 text-emerald-600" />
                <span>Mês de Apuração:</span>
              </div>
              <select
                value={mes}
                onChange={(e) => setMes(Number(e.target.value))}
                className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-white"
              >
                {mesesNomes.map((nome, i) => (
                  <option key={i + 1} value={i + 1}>
                    {nome}
                  </option>
                ))}
              </select>

              <div className="flex items-center gap-1.5 font-bold text-slate-700 ml-2">
                <span>Ano:</span>
              </div>
              <Input
                type="number"
                min="2020"
                max="2035"
                value={ano}
                onChange={(e) => setAno(Number(e.target.value))}
                className="w-20 px-2 py-1 text-xs"
              />

              <div className="flex items-center gap-1.5 font-bold text-slate-700 ml-2">
                <Building2 className="w-4 h-4 text-emerald-600" />
                <span>Empresa Contratada:</span>
              </div>
              <select
                value={empresaFaturamentoId}
                onChange={(e) => setEmpresaFaturamentoId(e.target.value)}
                className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-white max-w-xs"
              >
                <option value="">Todas as Fornecedoras Ativas</option>
                {empresas.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.nome_fantasia || emp.razao_social || emp.nome}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* DOCUMENTO DO RELATÓRIO FINANCEIRO (Imprimível) */}
          <div id="relatorio-a4-impressao" className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 md:p-8 space-y-6 text-slate-900 print:border-none print:shadow-none print:p-0">
            {carregando ? (
              <div className="py-16 text-center text-slate-400">
                <div className="inline-block animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full mb-2"></div>
                <p className="text-xs">Consolidando dados de consumo, recargas e locações contratadas...</p>
              </div>
            ) : faturamento ? (
              <div className="border border-slate-300 rounded-xl p-6 bg-white space-y-6 print:border-none print:p-0">
                {/* Cabeçalho Oficial SUS / Guapé */}
                <div className="text-center border-b pb-4 border-slate-300 space-y-1">
                  <div className="font-bold text-base md:text-lg uppercase tracking-wide text-slate-900">
                    MUNICÍPIO DE GUAPÉ · SECRETARIA MUNICIPAL DE SAÚDE
                  </div>
                  <div className="font-semibold text-sm text-slate-700 uppercase">
                    RELATÓRIO FINANCEIRO DE USO E FATURAMENTO DE OXIGÊNIO E EQUIPAMENTOS
                  </div>
                  <div className="text-xs text-slate-500 uppercase font-mono">
                    COMPETÊNCIA: {mesesNomes[faturamento.mes - 1]?.toUpperCase()} / {faturamento.ano} · EMITIDO EM {new Date(faturamento.data_geracao || new Date().toISOString()).toLocaleDateString("pt-BR")}
                  </div>
                </div>

                {/* CARDS DE RESUMO FINANCEIRO */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  {/* Total Geral a Faturar */}
                  <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-200">
                    <span className="text-xs text-emerald-800 font-semibold block uppercase">
                      Total a Faturar (Período)
                    </span>
                    <strong className="text-2xl font-bold text-emerald-950 block mt-1">
                      R$ {(faturamento.total_faturamento || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </strong>
                    <span className="text-[11px] text-emerald-700 block mt-0.5">
                      Recargas + Locações vigentes
                    </span>
                  </div>

                  {/* Custos Variáveis Contínuos */}
                  <div className="bg-sky-50 p-4 rounded-xl border border-sky-200">
                    <span className="text-xs text-sky-800 font-semibold block uppercase">
                      Custos Contínuos (Recargas O2)
                    </span>
                    <strong className="text-xl font-bold text-sky-950 block mt-1">
                      R$ {(faturamento.total_custo_recargas || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </strong>
                    <span className="text-[11px] text-sky-700 block mt-0.5">
                      {faturamento.total_m3_oxigenio || 0} m³ de O2 consumidos
                    </span>
                  </div>

                  {/* Custos Fixos Mensais */}
                  <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-200">
                    <span className="text-xs text-indigo-800 font-semibold block uppercase">
                      Custos Fixos (Locações)
                    </span>
                    <strong className="text-xl font-bold text-indigo-950 block mt-1">
                      R$ {(faturamento.total_custo_locacoes || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </strong>
                    <span className="text-[11px] text-indigo-700 block mt-0.5">
                      {faturamento.total_maquinas_locadas || 0} máquina(s) locada(s)
                    </span>
                  </div>

                  {/* Munícipes Beneficiários */}
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                    <span className="text-xs text-slate-600 font-semibold block uppercase">
                      Munícipes Atendidos
                    </span>
                    <strong className="text-xl font-bold text-slate-800 block mt-1">
                      {faturamento.total_pacientes_atendidos || 0} pacientes
                    </strong>
                    <span className="text-[11px] text-slate-500 block mt-0.5">
                      Em tratamento ativo
                    </span>
                  </div>
                </div>

                {/* 1. RESUMO POR EMPRESA PRESTADORA */}
                {faturamento.faturamento_por_empresa && faturamento.faturamento_por_empresa.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 font-bold text-slate-800 uppercase text-xs tracking-wider border-b border-slate-200 pb-1">
                      <Building2 className="w-4 h-4 text-emerald-600" />
                      <span>1. Apuração e Fechamento por Fornecedora Credenciada</span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {faturamento.faturamento_por_empresa.map((emp) => (
                        <div
                          key={emp.empresa_id}
                          className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs space-y-2"
                        >
                          <div className="flex justify-between items-start gap-2">
                            <strong className="text-slate-900 text-xs font-bold leading-tight">
                              {emp.empresa_nome}
                            </strong>
                            <span className="text-[10px] font-mono font-bold bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">
                              ID #{emp.empresa_id}
                            </span>
                          </div>

                          <div className="space-y-1 text-[11px] text-slate-600 border-t border-slate-100 pt-1.5">
                            <div className="flex justify-between">
                              <span>Recargas de Oxigênio ({emp.m3_oxigenio} m³):</span>
                              <span className="font-mono font-medium text-slate-800">
                                R$ {emp.total_recargas.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span>Locação de Máquinas ({emp.maquinas_ativas} ativas):</span>
                              <span className="font-mono font-medium text-slate-800">
                                R$ {emp.total_locacoes.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </span>
                            </div>
                          </div>

                          <div className="flex justify-between items-center bg-slate-50 p-2 rounded-lg text-xs font-bold text-slate-900 border border-slate-200">
                            <span>Subtotal da Empresa:</span>
                            <span className="text-emerald-800 font-mono">
                              R$ {emp.total_geral.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 2. DEMONSTRATIVO COMPARATIVO DE LICITAÇÃO, RECARGAS E BALAS EM COMODATO */}
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 font-bold text-slate-800 uppercase text-xs tracking-wider border-b border-slate-200 pb-1">
                    <BarChart3 className="w-4 h-4 text-emerald-600" />
                    <span>2. Demonstrativo Comparativo: Licitação, Consumo Mensal e Cilindros em Posse</span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border border-slate-200 rounded-lg">
                      <thead className="bg-slate-100 text-slate-700 font-bold uppercase text-[10px]">
                        <tr>
                          <th className="p-2.5 border-b border-slate-200">Tipo de Cilindro</th>
                          <th className="p-2.5 border-b border-slate-200 text-center">Qtd Licitação</th>
                          <th className="p-2.5 border-b border-slate-200 text-center">Recargas no Mês</th>
                          <th className="p-2.5 border-b border-slate-200 text-center">Saldo Restante Licitação</th>
                          <th className="p-2.5 border-b border-slate-200 text-center">Em Pacientes</th>
                          <th className="p-2.5 border-b border-slate-200 text-center">Balas em Comodato</th>
                          <th className="p-2.5 border-b border-slate-200 text-right">Valor Unitário</th>
                          <th className="p-2.5 border-b border-slate-200 text-right">Subtotal Mês</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs">
                        {/* 10m3 */}
                        <tr className="hover:bg-slate-50">
                          <td className="p-2.5 font-semibold text-slate-900">
                            Cilindro 10m³ (Grande / Hospitalar)
                          </td>
                          <td className="p-2.5 text-center font-mono font-medium text-slate-700">
                            {faturamento.contratado_licitacao_10m3 ?? 0}
                          </td>
                          <td className="p-2.5 text-center font-mono font-bold text-sky-800">
                            {faturamento.recargas_10m3_qtd ?? faturamento.consumo_mes_10m3 ?? 0}
                          </td>
                          <td className="p-2.5 text-center font-mono font-medium text-slate-700">
                            {faturamento.saldo_restante_licitacao_10m3 ?? 0}
                          </td>
                          <td className="p-2.5 text-center font-mono font-bold text-slate-900">
                            {faturamento.cilindros_em_pacientes_10m3 ?? 0}
                          </td>
                          <td className="p-2.5 text-center font-mono text-amber-800 font-bold">
                            {faturamento.comodato_saldo_10m3 ?? 0}
                          </td>
                          <td className="p-2.5 text-right font-mono text-slate-700">
                            R$ {(faturamento.recargas_10m3_unit || 0).toFixed(2)}
                          </td>
                          <td className="p-2.5 text-right font-mono font-bold text-slate-900">
                            R$ {(faturamento.recargas_10m3_total || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                        </tr>

                        {/* 3m3 */}
                        <tr className="hover:bg-slate-50">
                          <td className="p-2.5 font-semibold text-slate-900">
                            Cilindro 3m³ (Reserva Concentrador)
                          </td>
                          <td className="p-2.5 text-center font-mono font-medium text-slate-700">
                            {faturamento.contratado_licitacao_3m3 ?? 0}
                          </td>
                          <td className="p-2.5 text-center font-mono font-bold text-sky-800">
                            {faturamento.recargas_3m3_qtd ?? faturamento.consumo_mes_3m3 ?? 0}
                          </td>
                          <td className="p-2.5 text-center font-mono font-medium text-slate-700">
                            {faturamento.saldo_restante_licitacao_3m3 ?? 0}
                          </td>
                          <td className="p-2.5 text-center font-mono font-bold text-slate-900">
                            {faturamento.cilindros_em_pacientes_3m3 ?? 0}
                          </td>
                          <td className="p-2.5 text-center font-mono text-amber-800 font-bold">
                            {faturamento.comodato_saldo_3m3 ?? 0}
                          </td>
                          <td className="p-2.5 text-right font-mono text-slate-700">
                            R$ {(faturamento.recargas_3m3_unit || 0).toFixed(2)}
                          </td>
                          <td className="p-2.5 text-right font-mono font-bold text-slate-900">
                            R$ {(faturamento.recargas_3m3_total || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                        </tr>

                        {/* 1m3 */}
                        <tr className="hover:bg-slate-50">
                          <td className="p-2.5 font-semibold text-slate-900">
                            Cilindro 1m³ (Transporte / Especial)
                          </td>
                          <td className="p-2.5 text-center font-mono font-medium text-slate-700">
                            {faturamento.contratado_licitacao_1m3 ?? 0}
                          </td>
                          <td className="p-2.5 text-center font-mono font-bold text-sky-800">
                            {faturamento.recargas_1m3_qtd ?? faturamento.consumo_mes_1m3 ?? 0}
                          </td>
                          <td className="p-2.5 text-center font-mono font-medium text-slate-700">
                            {faturamento.saldo_restante_licitacao_1m3 ?? 0}
                          </td>
                          <td className="p-2.5 text-center font-mono font-bold text-slate-900">
                            {faturamento.cilindros_em_pacientes_1m3 ?? 0}
                          </td>
                          <td className="p-2.5 text-center font-mono text-amber-800 font-bold">
                            {faturamento.comodato_saldo_1m3 ?? 0}
                          </td>
                          <td className="p-2.5 text-right font-mono text-slate-700">
                            R$ {(faturamento.recargas_1m3_unit || 0).toFixed(2)}
                          </td>
                          <td className="p-2.5 text-right font-mono font-bold text-slate-900">
                            R$ {(faturamento.recargas_1m3_total || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                        </tr>
                      </tbody>
                      <tfoot className="bg-slate-50 font-bold border-t-2 border-slate-300 text-xs">
                        <tr>
                          <td className="p-2.5 uppercase text-slate-700">
                            Totais Consolidados:
                          </td>
                          <td className="p-2.5 text-center font-mono">
                            {(faturamento.contratado_licitacao_10m3 || 0) + (faturamento.contratado_licitacao_3m3 || 0) + (faturamento.contratado_licitacao_1m3 || 0)}
                          </td>
                          <td className="p-2.5 text-center font-mono text-sky-900">
                            {(faturamento.recargas_10m3_qtd || 0) + (faturamento.recargas_3m3_qtd || 0) + (faturamento.recargas_1m3_qtd || 0)}
                          </td>
                          <td className="p-2.5 text-center font-mono">
                            {(faturamento.saldo_restante_licitacao_10m3 || 0) + (faturamento.saldo_restante_licitacao_3m3 || 0) + (faturamento.saldo_restante_licitacao_1m3 || 0)}
                          </td>
                          <td className="p-2.5 text-center font-mono">
                            {(faturamento.cilindros_em_pacientes_10m3 || 0) + (faturamento.cilindros_em_pacientes_3m3 || 0) + (faturamento.cilindros_em_pacientes_1m3 || 0)}
                          </td>
                          <td className="p-2.5 text-center font-mono text-amber-900">
                            {(faturamento.comodato_saldo_10m3 || 0) + (faturamento.comodato_saldo_3m3 || 0) + (faturamento.comodato_saldo_1m3 || 0)}
                          </td>
                          <td className="p-2.5 text-right uppercase text-[10px] text-slate-500">
                            Total Recargas:
                          </td>
                          <td className="p-2.5 text-right font-mono text-emerald-800">
                            R$ {(faturamento.subtotal_recargas || faturamento.total_custo_recargas || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>

                {/* 3. HISTÓRICO DE ENTREGAS E ABASTECIMENTOS NO MÊS */}
                {faturamento.historico_abastecimentos && faturamento.historico_abastecimentos.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 font-bold text-slate-800 uppercase text-xs tracking-wider border-b border-slate-200 pb-1">
                      <Truck className="w-4 h-4 text-emerald-600" />
                      <span>3. Registro de Entregas e Abastecimentos no Mês (Abas Oficiais)</span>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border border-slate-200 rounded-lg">
                        <thead className="bg-slate-100 text-slate-700 font-semibold uppercase text-[10px]">
                          <tr>
                            <th className="p-2.5 border-b border-slate-200">Data</th>
                            <th className="p-2.5 border-b border-slate-200">Descrição / Tipo Insumo</th>
                            <th className="p-2.5 border-b border-slate-200 text-center">Quantidade</th>
                            <th className="p-2.5 border-b border-slate-200 text-right">Valor Unitário</th>
                            <th className="p-2.5 border-b border-slate-200 text-right">Valor Total</th>
                            <th className="p-2.5 border-b border-slate-200">Nº NF / Documento</th>
                            <th className="p-2.5 border-b border-slate-200">Fornecedora</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-xs">
                          {faturamento.historico_abastecimentos.map((abs, idx) => (
                            <tr key={idx} className="hover:bg-slate-50">
                              <td className="p-2.5 font-mono text-slate-600 whitespace-nowrap">
                                {abs.data ? new Date(abs.data + "T00:00:00").toLocaleDateString("pt-BR") : "—"}
                              </td>
                              <td className="p-2.5 font-medium text-slate-800">
                                {abs.descricao}
                              </td>
                              <td className="p-2.5 text-center font-mono font-bold text-slate-900">
                                {abs.quantidade}
                              </td>
                              <td className="p-2.5 text-right font-mono text-slate-700">
                                R$ {abs.valor_unitario.toFixed(2)}
                              </td>
                              <td className="p-2.5 text-right font-mono font-bold text-slate-900">
                                R$ {abs.valor_total.toFixed(2)}
                              </td>
                              <td className="p-2.5 font-mono text-slate-600 text-[11px]">
                                {abs.numero_nf || "—"}
                              </td>
                              <td className="p-2.5 text-slate-700">
                                {abs.empresa || "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="bg-slate-50 font-bold border-t-2 border-slate-300 text-xs">
                          <tr>
                            <td colSpan={2} className="p-2.5 uppercase text-slate-700">
                              Total Entregue no Mês ({faturamento.historico_abastecimentos.length} entregas):
                            </td>
                            <td className="p-2.5 text-center font-mono text-sky-900">
                              {faturamento.historico_abastecimentos.reduce((acc, it) => acc + it.quantidade, 0)}
                            </td>
                            <td></td>
                            <td className="p-2.5 text-right font-mono text-emerald-800">
                              R$ {faturamento.historico_abastecimentos.reduce((acc, it) => acc + it.valor_total, 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td colSpan={2}></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                )}

                {/* 4. TABELA DETALHADA DE ITENS FATURADOS */}
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 font-bold text-slate-800 uppercase text-xs tracking-wider border-b border-slate-200 pb-1">
                    <Receipt className="w-4 h-4 text-emerald-600" />
                    <span>4. Detalhamento por Paciente, Insumo e Categoria Orçamentária</span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border border-slate-200 rounded-lg">
                      <thead className="bg-slate-100 text-slate-700 font-semibold uppercase text-[10px]">
                        <tr>
                          <th className="p-2.5 border-b border-slate-200">Paciente / Prontuário</th>
                          <th className="p-2.5 border-b border-slate-200">Item / Serviço</th>
                          <th className="p-2.5 border-b border-slate-200">Classificação Orçamentária</th>
                          <th className="p-2.5 border-b border-slate-200 text-center">Qtd / m³</th>
                          <th className="p-2.5 border-b border-slate-200 text-right">Valor Unitário</th>
                          <th className="p-2.5 border-b border-slate-200 text-right">Subtotal (R$)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs">
                        {(!faturamento.itens || faturamento.itens.length === 0) ? (
                          <tr>
                            <td colSpan={6} className="text-center py-8 text-slate-400">
                              Nenhum lançamento de uso ou locação encontrado para a competência selecionada.
                            </td>
                          </tr>
                        ) : (
                          faturamento.itens.map((it: ItemFaturamentoPaciente, idx: number) => (
                            <tr key={idx} className="hover:bg-slate-50">
                              <td className="p-2.5">
                                <div className="font-semibold text-slate-900">{it.paciente_nome}</div>
                                <div className="text-[10px] text-slate-500">Prontuário: {it.prontuario || "—"}</div>
                              </td>
                              <td className="p-2.5 font-medium text-slate-800">
                                {it.item_descricao}
                              </td>
                              <td className="p-2.5">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  it.tipo_custo === "VARIAVEL_RECARGA"
                                    ? "bg-sky-100 text-sky-800"
                                    : "bg-indigo-100 text-indigo-800"
                                }`}>
                                  {it.tipo_custo === "VARIAVEL_RECARGA" ? "Variável (Recarga m³)" : "Fixo Mensal (Locação)"}
                                </span>
                              </td>
                              <td className="p-2.5 text-center font-bold">
                                {it.quantidade}
                              </td>
                              <td className="p-2.5 text-right font-mono">
                                R$ {it.valor_unitario.toFixed(2)}
                              </td>
                              <td className="p-2.5 text-right font-mono font-bold text-slate-900">
                                R$ {it.subtotal.toFixed(2)}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                      {faturamento.itens && faturamento.itens.length > 0 && (
                        <tfoot className="bg-slate-50 font-bold border-t-2 border-slate-300 text-xs">
                          <tr>
                            <td colSpan={5} className="p-3 text-right uppercase text-slate-700">
                              Total Geral Liquidado / A Faturar:
                            </td>
                            <td className="p-3 text-right text-emerald-800 font-mono text-sm">
                              R$ {(faturamento.total_faturamento || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </div>

                {/* Campos de Assinatura e Conferência */}
                <div className="pt-8 grid grid-cols-2 gap-8 text-center text-xs">
                  <div>
                    <div className="border-b border-slate-700 mx-6 mb-2"></div>
                    <strong className="block text-slate-900">Setor de Oxigenoterapia Domiciliar</strong>
                    <span className="text-slate-600 block">Conferência Técnica de Consumo</span>
                    <span className="text-[11px] text-slate-500">SMS / Guapé - MG</span>
                  </div>

                  <div>
                    <div className="border-b border-slate-700 mx-6 mb-2"></div>
                    <strong className="block text-slate-900">Secretaria Municipal de Saúde</strong>
                    <span className="text-slate-600 block">Autorização e Liquidação de Despesa</span>
                    <span className="text-[11px] text-slate-500">Gestão do Fundo Municipal de Saúde</span>
                  </div>
                </div>

                <div className="text-[10px] text-center text-slate-400 pt-4 border-t border-slate-200">
                  Relatório emitido para fins de prestação de contas, liquidação de despesa e faturamento da empresa contratada.
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
