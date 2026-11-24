import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Ambulance,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Coins,
  Download,
  ExternalLink,
  FileCheck,
  FileSpreadsheet,
  FileText,
  Filter,
  FlaskConical,
  Layers,
  Printer,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Stethoscope,
  User,
  UserCheck,
  Users,
  X,
  XCircle,
} from "lucide-react";
import {
  downloadBpaCsv,
  downloadBpaOut,
  fetchBpaCriticas,
  fetchBpaDemonstrativo,
  fetchBpaResumo,
  fetchUnidadesSaude,
  type BpaCritica,
  type BpaCriticasResultado,
  type BpaDemonstrativoItem,
  type BpaDemonstrativoPorCnes,
  type BpaDemonstrativoResultado,
  type BpaItemResumo,
  type BpaResumoCompleto,
  type UnidadeSaude,
} from "../services/api";
import { Badge, Button, Card, Input, Label, Select } from "../components/ui/primitives";

export default function FaturamentoBpa() {
  const mesAtual = useMemo(() => {
    const d = new Date();
    const ano = d.getFullYear();
    const mes = String(d.getMonth() + 1).padStart(2, "0");
    return `${ano}-${mes}`;
  }, []);

  const [competencia, setCompetencia] = useState(mesAtual);
  const [unidadeSelecionadaId, setUnidadeSelecionadaId] = useState<number | null>(null);
  const [unidades, setUnidades] = useState<UnidadeSaude[]>([]);

  const [resumo, setResumo] = useState<BpaResumoCompleto | null>(null);
  const [criticas, setCriticas] = useState<BpaCriticasResultado | null>(null);
  const [demonstrativo, setDemonstrativo] = useState<BpaDemonstrativoResultado | null>(null);

  const [loading, setLoading] = useState(false);
  const [loadingCriticas, setLoadingCriticas] = useState(false);
  const [loadingDemonstrativo, setLoadingDemonstrativo] = useState(false);

  const [baixandoOut, setBaixandoOut] = useState(false);
  const [baixandoCsv, setBaixandoCsv] = useState(false);
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState("");

  const [abaAtiva, setAbaAtiva] = useState<"todos" | "bpac" | "bpai" | "criticas" | "demonstrativo">("todos");
  const [termoBusca, setTermoBusca] = useState("");
  const [filtroTipoCritica, setFiltroTipoCritica] = useState<"todas" | "bloqueantes" | "avisos">("todas");
  const [modalForcarAberto, setModalForcarAberto] = useState(false);

  // Carrega Unidades de Saúde
  useEffect(() => {
    fetchUnidadesSaude({ somente_ativas: true })
      .then((data) => setUnidades(data || []))
      .catch((e) => console.warn("Falha ao carregar unidades de saúde:", e));
  }, []);

  // Carrega dados principais do BPA
  const carregarDados = async (comp = competencia, uid = unidadeSelecionadaId) => {
    setLoading(true);
    setErro("");
    try {
      const data = await fetchBpaResumo(comp, uid);
      setResumo(data);
    } catch (err: any) {
      setErro(err?.response?.data?.detail || "Erro ao carregar dados da produção ambulatorial.");
    } finally {
      setLoading(false);
    }
  };

  // Carrega Críticas Preventivas
  const carregarCriticas = async (comp = competencia, uid = unidadeSelecionadaId) => {
    setLoadingCriticas(true);
    try {
      const data = await fetchBpaCriticas(comp, uid);
      setCriticas(data);
    } catch (err: any) {
      console.warn("Falha ao carregar críticas preventivas:", err);
    } finally {
      setLoadingCriticas(false);
    }
  };

  // Carrega Demonstrativo de Faturamento
  const carregarDemonstrativo = async (comp = competencia, uid = unidadeSelecionadaId) => {
    setLoadingDemonstrativo(true);
    try {
      const data = await fetchBpaDemonstrativo(comp, uid);
      setDemonstrativo(data);
    } catch (err: any) {
      console.warn("Falha ao carregar demonstrativo de faturamento:", err);
    } finally {
      setLoadingDemonstrativo(false);
    }
  };

  useEffect(() => {
    carregarDados(competencia, unidadeSelecionadaId);
    carregarCriticas(competencia, unidadeSelecionadaId);
    if (abaAtiva === "demonstrativo") {
      carregarDemonstrativo(competencia, unidadeSelecionadaId);
    }
  }, [competencia, unidadeSelecionadaId]);

  useEffect(() => {
    if (abaAtiva === "demonstrativo" && !demonstrativo) {
      carregarDemonstrativo(competencia, unidadeSelecionadaId);
    }
  }, [abaAtiva]);

  const handleDownloadOut = async (forcar = false) => {
    setBaixandoOut(true);
    setErro("");
    setModalForcarAberto(false);
    try {
      await downloadBpaOut(competencia, unidadeSelecionadaId, forcar);
      setSucesso(
        forcar
          ? "Arquivo BPA gerado em modo auditoria (forçado)!"
          : "Arquivo oficial PA312810.OUT gerado com sucesso para importação no SIA-SUS!"
      );
      setTimeout(() => setSucesso(""), 6000);
    } catch (err: any) {
      const detalhe = err?.response?.data?.detail || "Falha ao gerar arquivo .OUT";
      setErro(detalhe);
      if (detalhe.includes("bloqueada") || detalhe.includes("inconsistência")) {
        setAbaAtiva("criticas");
      }
    } finally {
      setBaixandoOut(false);
    }
  };

  const handleDownloadCsv = async () => {
    setBaixandoCsv(true);
    setErro("");
    try {
      await downloadBpaCsv(competencia, unidadeSelecionadaId);
      setSucesso("Planilha de conferência (.CSV) exportada com sucesso!");
      setTimeout(() => setSucesso(""), 6000);
    } catch (err: any) {
      setErro(err?.response?.data?.detail || "Falha ao exportar planilha CSV");
    } finally {
      setBaixandoCsv(false);
    }
  };

  const mudarMes = (delta: number) => {
    const [anoStr, mesStr] = competencia.split("-");
    const d = new Date(parseInt(anoStr), parseInt(mesStr) - 1 + delta, 1);
    const novoAno = d.getFullYear();
    const novoMes = String(d.getMonth() + 1).padStart(2, "0");
    setCompetencia(`${novoAno}-${novoMes}`);
  };

  // Exportar Demonstrativo em CSV para Excel
  const exportarDemonstrativoExcel = () => {
    if (!demonstrativo || !demonstrativo.itens.length) return;
    const linhas: string[] = [];
    linhas.push("CNES;Unidade_Saude;Codigo_SIGTAP;Descricao_Procedimento;Instrumento;Origem;Quantidade;Valor_SA_Unitario;Valor_SH_Unitario;Valor_Total");

    demonstrativo.itens.forEach((it) => {
      linhas.push(
        `"${it.cnes}";"${it.unidade_nome}";"${it.codigo}";"${it.descricao}";"${it.instrumento}";"${it.origem}";${it.quantidade};${it.valor_ambulatorial.toFixed(2).replace(".", ",")};${it.valor_hospitalar.toFixed(2).replace(".", ",")};${it.valor_total.toFixed(2).replace(".", ",")}`
      );
    });

    const csvContent = "\uFEFF" + linhas.join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `demonstrativo_faturamento_bpa_${demonstrativo.competencia_aaaamm}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  // Filtragem dos itens de resumo
  const itensFiltrados = useMemo(() => {
    if (!resumo) return [];
    let base: (BpaItemResumo & { tipo: string })[] = [];

    if (abaAtiva === "todos" || abaAtiva === "bpac") {
      base = base.concat(resumo.itens_bpa_c.map((it) => ({ ...it, tipo: "BPA-C" })));
    }
    if (abaAtiva === "todos" || abaAtiva === "bpai") {
      base = base.concat(resumo.itens_bpa_i.map((it) => ({ ...it, tipo: "BPA-I" })));
    }

    if (!termoBusca.trim()) return base;
    const termo = termoBusca.toLowerCase();
    return base.filter(
      (it) =>
        it.procedimento.toLowerCase().includes(termo) ||
        it.descricao.toLowerCase().includes(termo) ||
        (it.paciente_nome && it.paciente_nome.toLowerCase().includes(termo)) ||
        (it.paciente_cpf && it.paciente_cpf.includes(termo)) ||
        it.origem.toLowerCase().includes(termo)
    );
  }, [resumo, abaAtiva, termoBusca]);

  // Filtragem das críticas preventivas
  const criticasFiltradas = useMemo(() => {
    if (!criticas?.criticas) return [];
    let lista = criticas.criticas;

    if (filtroTipoCritica === "bloqueantes") {
      lista = lista.filter((c) => c.tipo === "BLOQUEANTE");
    } else if (filtroTipoCritica === "avisos") {
      lista = lista.filter((c) => c.tipo === "AVISO");
    }

    if (!termoBusca.trim()) return lista;
    const t = termoBusca.toLowerCase();
    return lista.filter(
      (c) =>
        c.mensagem.toLowerCase().includes(t) ||
        c.modulo.toLowerCase().includes(t) ||
        (c.registro_identificador && c.registro_identificador.toLowerCase().includes(t)) ||
        (c.sugestao_correcao && c.sugestao_correcao.toLowerCase().includes(t))
    );
  }, [criticas, filtroTipoCritica, termoBusca]);

  const temBloqueantes = Boolean(criticas && criticas.total_bloqueantes > 0);

  return (
    <div className="space-y-5">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-sus-900/10 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-xl font-bold text-sus-950 flex items-center gap-2">
              <FileCheck className="h-6 w-6 text-teal" />
              Faturamento BPA Oficial (SIA/SUS)
            </h1>
            <span className="rounded-full bg-teal/10 px-2.5 py-0.5 text-xs font-bold text-teal border border-teal/20">
              Layout DATASUS 100%
            </span>
          </div>
          <p className="text-xs text-ink/65 mt-1">
            Geração oficial do Boletim de Produção Ambulatorial (.OUT), demonstrativos de faturamento por CNES e auditoria preventiva SIA-SUS.
          </p>
        </div>

        {/* Filtros: Seletor de Unidade e Competência */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Seletor de CNES / Unidade de Saúde */}
          <div className="flex items-center gap-1.5 bg-white p-1 rounded-xl border border-sus-900/15 shadow-xs">
            <Building2 className="h-4 w-4 text-teal ml-2 shrink-0" />
            <select
              value={unidadeSelecionadaId ?? ""}
              onChange={(e) => {
                const val = e.target.value;
                setUnidadeSelecionadaId(val ? parseInt(val, 10) : null);
              }}
              className="text-xs font-semibold bg-transparent border-0 focus:ring-0 text-sus-950 cursor-pointer pr-3"
            >
              <option value="">Todas as Unidades (Geral do Município)</option>
              {unidades.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nome} {u.cnes ? `(CNES: ${u.cnes})` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Seletor de Competência */}
          <div className="flex items-center gap-2 bg-white p-1 rounded-xl border border-sus-900/15 shadow-xs">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => mudarMes(-1)}
              title="Mês anterior"
              className="!h-8 !px-2.5 text-xs"
            >
              ◀
            </Button>
            <div className="flex items-center gap-1.5 px-2">
              <Calendar className="h-4 w-4 text-ink/50" />
              <input
                type="month"
                value={competencia}
                onChange={(e) => e.target.value && setCompetencia(e.target.value)}
                className="text-xs font-semibold bg-transparent border-0 focus:ring-0 text-sus-950 cursor-pointer"
              />
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => mudarMes(1)}
              title="Próximo mês"
              className="!h-8 !px-2.5 text-xs"
            >
              ▶
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                carregarDados();
                carregarCriticas();
                if (abaAtiva === "demonstrativo") carregarDemonstrativo();
              }}
              disabled={loading || loadingCriticas}
              className="ml-1 !h-8 !px-2.5 text-xs border-sus-900/15"
              title="Atualizar dados"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
      </div>

      {/* Alertas de Sucesso e Erro */}
      {sucesso && (
        <div className="p-3 bg-teal/10 border border-teal/25 text-teal rounded-xl flex items-center gap-2 text-xs font-medium shadow-xs">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-teal" />
          <span>{sucesso}</span>
        </div>
      )}

      {erro && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-800 rounded-xl flex items-center justify-between gap-2 text-xs font-medium shadow-xs">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
            <span>{erro}</span>
          </div>
          {temBloqueantes && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAbaAtiva("criticas")}
              className="!h-7 text-xs border-red-300 text-red-800 hover:bg-red-100"
            >
              Ver Críticas
            </Button>
          )}
        </div>
      )}

      {/* PAINEL DE CRÍTICAS PREVENTIVAS DO CNES/BPA */}
      <Card
        className={`p-4 shadow-xs border transition-colors ${
          temBloqueantes
            ? "bg-rose-50/70 border-rose-200"
            : criticas && criticas.total_avisos > 0
            ? "bg-amber-50/70 border-amber-200"
            : "bg-emerald-50/70 border-emerald-200"
        }`}
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div
              className={`p-2.5 rounded-xl shrink-0 ${
                temBloqueantes
                  ? "bg-rose-100 text-rose-700"
                  : criticas && criticas.total_avisos > 0
                  ? "bg-amber-100 text-amber-700"
                  : "bg-emerald-100 text-emerald-700"
              }`}
            >
              {temBloqueantes ? (
                <ShieldAlert className="h-6 w-6" />
              ) : criticas && criticas.total_avisos > 0 ? (
                <AlertTriangle className="h-6 w-6" />
              ) : (
                <ShieldCheck className="h-6 w-6" />
              )}
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h3
                  className={`font-display text-sm font-bold ${
                    temBloqueantes
                      ? "text-rose-950"
                      : criticas && criticas.total_avisos > 0
                      ? "text-amber-950"
                      : "text-emerald-950"
                  }`}
                >
                  {temBloqueantes
                    ? "Exportação Oficial Bloqueada - Pendências Críticas no SIA-SUS"
                    : criticas && criticas.total_avisos > 0
                    ? "Avisos Preventivos de Auditoria CNES"
                    : "Conformidade 100% Aprovada - Nenhum Erro Detectado"}
                </h3>

                {temBloqueantes ? (
                  <Badge className="bg-rose-600 text-white font-bold text-[10px] px-2 py-0.5">
                    {criticas?.total_bloqueantes} Bloqueante(s)
                  </Badge>
                ) : (
                  <Badge className="bg-emerald-600 text-white font-bold text-[10px] px-2 py-0.5">
                    Aprovado para SIA
                  </Badge>
                )}
                {criticas && criticas.total_avisos > 0 && (
                  <Badge className="bg-amber-500 text-white font-semibold text-[10px] px-2 py-0.5">
                    {criticas.total_avisos} Aviso(s)
                  </Badge>
                )}
              </div>

              <p className="text-xs text-ink/70 mt-1 max-w-2xl">
                {temBloqueantes
                  ? "O arquivo oficial .OUT não pode ser enviado ao DATASUS antes de sanar as pendências bloqueantes (profissionais sem CNS/CBO, unidades sem CNES/IBGE ou regras de idade/sexo do SIGTAP)."
                  : criticas && criticas.total_avisos > 0
                  ? "Foram identificados avisos que não bloqueiam o envio, mas que merecem atenção para evitar advertências no relatório do SIA."
                  : "Todos os profissionais, unidades e procedimentos atendem integralmente às regras do CNES e do SIGTAP."}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end md:self-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAbaAtiva("criticas")}
              className={`text-xs font-semibold !h-8 ${
                temBloqueantes
                  ? "border-rose-300 text-rose-900 bg-white hover:bg-rose-100"
                  : "border-sus-900/15 bg-white text-ink hover:bg-sand"
              }`}
            >
              Auditar Inconsistências ({criticas?.total_criticas ?? 0})
            </Button>

            {temBloqueantes && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setModalForcarAberto(true)}
                className="text-xs text-rose-800 hover:text-rose-950 underline !h-8"
              >
                Forçar Geração...
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Bloco de Ações de Exportação em Destaque */}
      <Card className="p-5 bg-white border border-teal/25 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <h3 className="font-display text-sm font-bold text-sus-950 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-teal" />
              Arquivo de Remessa Oficial SIA-SUS (Guapé - MG)
            </h3>
            <p className="text-xs text-ink/65">
              CNES:{" "}
              <span className="font-mono font-bold text-sus-950">
                {resumo?.cnes_exportado || "2146479"}
              </span>{" "}
              · IBGE: <span className="font-mono font-bold text-sus-950">312810</span> · CNPJ:{" "}
              <span className="font-mono font-bold text-sus-950">18.239.616/0001-85</span> · Código Controle:{" "}
              <span className="font-mono font-bold text-teal">
                {resumo?.controle_verificador ?? "----"}
              </span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              onClick={() => handleDownloadOut(false)}
              disabled={baixandoOut || loading || (resumo?.total_geral_itens ?? 0) === 0 || temBloqueantes}
              title={
                temBloqueantes
                  ? "Exportação travada: corrija as pendências bloqueantes no painel de críticas"
                  : "Baixar remessa oficial .OUT"
              }
              className={`font-bold shadow-xs flex items-center gap-2 px-4 py-2 text-xs transition-all ${
                temBloqueantes
                  ? "bg-gray-200 text-gray-500 cursor-not-allowed border border-gray-300"
                  : "bg-teal hover:brightness-110 text-sus-950"
              }`}
            >
              <Download className={`h-4 w-4 ${baixandoOut ? "animate-bounce" : ""}`} />
              {baixandoOut ? "Gerando .OUT..." : "Baixar Arquivo Oficial (.OUT)"}
            </Button>

            <Button
              variant="outline"
              onClick={handleDownloadCsv}
              disabled={baixandoCsv || loading || (resumo?.total_geral_itens ?? 0) === 0}
              className="border border-sus-900/15 bg-white hover:bg-sand text-ink text-xs font-semibold flex items-center gap-2 px-3.5 py-2"
            >
              <FileSpreadsheet className={`h-4 w-4 text-teal ${baixandoCsv ? "animate-pulse" : ""}`} />
              {baixandoCsv ? "Exportando..." : "Planilha Conferência (.CSV)"}
            </Button>
          </div>
        </div>
      </Card>

      {/* Cards de Métricas Principais */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Produção Ambulatorial Clínica */}
        <Card className="p-4 border-l-4 border-l-blue-600 bg-white shadow-xs">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold text-ink/55 uppercase tracking-wider">
                Ambulatório Clínico
              </p>
              <p className="font-display text-2xl font-bold text-sus-950 mt-1">
                {loading ? "..." : (resumo?.total_ambulatorial ?? 0).toLocaleString("pt-BR")}
              </p>
            </div>
            <div className="p-2.5 bg-blue-600/10 rounded-xl text-blue-600">
              <Stethoscope className="h-5 w-5" />
            </div>
          </div>
          <p className="text-[11px] text-ink/50 mt-2">
            Consultas, curativos, enfermagem e atenção básica
          </p>
        </Card>

        {/* Card 2: Exames Laboratoriais */}
        <Card className="p-4 border-l-4 border-l-teal bg-white shadow-xs">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold text-ink/55 uppercase tracking-wider">
                Exames Laboratoriais
              </p>
              <p className="font-display text-2xl font-bold text-sus-950 mt-1">
                {loading ? "..." : (resumo?.total_exames ?? 0).toLocaleString("pt-BR")}
              </p>
            </div>
            <div className="p-2.5 bg-teal/10 rounded-xl text-teal">
              <FlaskConical className="h-5 w-5" />
            </div>
          </div>
          <p className="text-[11px] text-ink/50 mt-2">
            Rotinas laboratoriais e sorologias
          </p>
        </Card>

        {/* Card 3: Viagens TFD */}
        <Card className="p-4 border-l-4 border-l-amber-500 bg-white shadow-xs">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold text-ink/55 uppercase tracking-wider">
                Viagens & TFD (Grupo 08)
              </p>
              <p className="font-display text-2xl font-bold text-sus-950 mt-1">
                {loading ? "..." : (resumo?.total_viagens_tfd ?? 0).toLocaleString("pt-BR")}
              </p>
            </div>
            <div className="p-2.5 bg-amber-500/10 rounded-xl text-amber-600">
              <Ambulance className="h-5 w-5" />
            </div>
          </div>
          <p className="text-[11px] text-ink/50 mt-2">
            Deslocamentos de pacientes e acompanhantes
          </p>
        </Card>

        {/* Card 4: Valor Total SUS */}
        <Card className="p-4 border-l-4 border-l-emerald-600 bg-white shadow-xs">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold text-ink/55 uppercase tracking-wider">
                Valor Total Estimado
              </p>
              <p className="font-display text-2xl font-bold text-emerald-700 mt-1">
                {loading
                  ? "..."
                  : (resumo?.valor_total_estimado ?? 0).toLocaleString("pt-BR", {
                      style: "currency",
                      currency: "BRL",
                    })}
              </p>
            </div>
            <div className="p-2.5 bg-emerald-600/10 rounded-xl text-emerald-600">
              <Coins className="h-5 w-5" />
            </div>
          </div>
          <p className="text-[11px] text-ink/50 mt-2">
            Tabela SIGTAP e procedimentos integrados
          </p>
        </Card>
      </div>

      {/* ABAS DE NAVEGAÇÃO */}
      <Card className="overflow-hidden border-sus-900/10 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-4 border-b border-sus-900/10 bg-sand/30">
          <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-sand p-1">
            <button
              type="button"
              onClick={() => setAbaAtiva("todos")}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                abaAtiva === "todos"
                  ? "bg-white text-sus-950 shadow-xs"
                  : "text-ink/65 hover:text-sus-950"
              }`}
            >
              Todos ({resumo?.total_geral_itens ?? 0})
            </button>
            <button
              type="button"
              onClick={() => setAbaAtiva("bpac")}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                abaAtiva === "bpac"
                  ? "bg-white text-sus-950 shadow-xs"
                  : "text-ink/65 hover:text-sus-950"
              }`}
            >
              BPA-C Consolidado ({resumo?.total_procedimentos_bpa_c ?? 0})
            </button>
            <button
              type="button"
              onClick={() => setAbaAtiva("bpai")}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                abaAtiva === "bpai"
                  ? "bg-white text-sus-950 shadow-xs"
                  : "text-ink/65 hover:text-sus-950"
              }`}
            >
              BPA-I Individualizado ({resumo?.total_procedimentos_bpa_i ?? 0})
            </button>
            <button
              type="button"
              onClick={() => setAbaAtiva("criticas")}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition flex items-center gap-1.5 ${
                abaAtiva === "criticas"
                  ? "bg-white text-sus-950 shadow-xs"
                  : "text-ink/65 hover:text-sus-950"
              }`}
            >
              <span>Críticas Preventivas</span>
              {temBloqueantes ? (
                <span className="rounded-full bg-rose-600 text-white px-1.5 py-0.2 text-[10px] font-bold">
                  {criticas?.total_bloqueantes}
                </span>
              ) : (
                <span className="rounded-full bg-gray-200 text-gray-700 px-1.5 py-0.2 text-[10px]">
                  {criticas?.total_criticas ?? 0}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setAbaAtiva("demonstrativo")}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition flex items-center gap-1.5 ${
                abaAtiva === "demonstrativo"
                  ? "bg-white text-sus-950 shadow-xs"
                  : "text-ink/65 hover:text-sus-950"
              }`}
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-teal" />
              <span>Demonstrativo de Faturamento</span>
            </button>
          </div>

          <div className="relative w-full md:w-80">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink/40 pointer-events-none" />
            <Input
              type="text"
              placeholder="Buscar por código, procedimento, paciente..."
              value={termoBusca}
              onChange={(e) => setTermoBusca(e.target.value)}
              className="!pl-9 !h-9 text-xs"
            />
          </div>
        </div>

        {/* CONTEÚDO DA ABA: CRÍTICAS PREVENTIVAS */}
        {abaAtiva === "criticas" && (
          <div className="p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sus-900/10 pb-3">
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant={filtroTipoCritica === "todas" ? "default" : "outline"}
                  onClick={() => setFiltroTipoCritica("todas")}
                  className="text-xs !h-7"
                >
                  Todas ({criticas?.total_criticas ?? 0})
                </Button>
                <Button
                  size="sm"
                  variant={filtroTipoCritica === "bloqueantes" ? "danger" : "outline"}
                  onClick={() => setFiltroTipoCritica("bloqueantes")}
                  className="text-xs !h-7"
                >
                  Bloqueantes ({criticas?.total_bloqueantes ?? 0})
                </Button>
                <Button
                  size="sm"
                  variant={filtroTipoCritica === "avisos" ? "default" : "outline"}
                  onClick={() => setFiltroTipoCritica("avisos")}
                  className="text-xs !h-7"
                >
                  Avisos ({criticas?.total_avisos ?? 0})
                </Button>
              </div>

              <div className="text-xs text-ink/50">
                Regras oficiais do SIA-SUS (Portarias SAS e algoritmo módulo 11 do Ministério da Saúde)
              </div>
            </div>

            {loadingCriticas ? (
              <div className="py-12 text-center text-ink/50">
                <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-teal border-t-transparent mb-2" />
                <p className="text-xs">Auditando banco de dados contra regras do SIA-SUS...</p>
              </div>
            ) : criticasFiltradas.length === 0 ? (
              <div className="py-12 text-center text-ink/45">
                <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500 mb-2" />
                <p className="font-semibold text-sus-950">Nenhuma inconsistência encontrada</p>
                <p className="text-xs text-ink/50 mt-1">
                  Parabéns! Todos os dados da competência selecionada estão 100% regulares.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {criticasFiltradas.map((c) => (
                  <div
                    key={c.id}
                    className={`p-3.5 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs ${
                      c.tipo === "BLOQUEANTE"
                        ? "bg-rose-50/50 border-rose-200"
                        : "bg-amber-50/50 border-amber-200"
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-0.5 rounded font-mono font-bold text-[10px] ${
                            c.tipo === "BLOQUEANTE"
                              ? "bg-rose-600 text-white"
                              : "bg-amber-500 text-white"
                          }`}
                        >
                          {c.tipo}
                        </span>

                        <span className="font-mono text-ink/55 text-[11px] font-semibold uppercase">
                          [{c.modulo}]
                        </span>

                        {c.registro_identificador && (
                          <span className="font-semibold text-sus-950">
                            {c.registro_identificador}
                          </span>
                        )}
                      </div>

                      <p className="text-ink/80 text-xs font-medium">
                        {c.mensagem}
                      </p>

                      {c.sugestao_correcao && (
                        <p className="text-[11px] text-ink/60 italic flex items-center gap-1">
                          <span className="font-semibold text-teal not-italic">Sugestão:</span> {c.sugestao_correcao}
                        </p>
                      )}
                    </div>

                    {c.link_correcao && (
                      <a
                        href={c.link_correcao}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white border border-sus-900/15 text-sus-950 hover:bg-sand text-xs font-semibold shrink-0 shadow-xs"
                      >
                        Corrigir Cadastro
                        <ExternalLink className="h-3.5 w-3.5 text-teal" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* CONTEÚDO DA ABA: DEMONSTRATIVO DE FATURAMENTO */}
        {abaAtiva === "demonstrativo" && (
          <div className="p-4 space-y-5">
            {/* Barra de Ações do Demonstrativo */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sus-900/10 pb-4">
              <div>
                <h3 className="font-display text-base font-bold text-sus-950">
                  Demonstrativo Formal de Produção Ambulatorial do SUS
                </h3>
                <p className="text-xs text-ink/65">
                  Município de Guapé (MG) · Secretaria Municipal de Saúde · Competência:{" "}
                  <span className="font-bold text-sus-950">{demonstrativo?.competencia}</span>
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={exportarDemonstrativoExcel}
                  disabled={!demonstrativo?.itens.length}
                  className="text-xs !h-8 border-sus-900/15 bg-white text-ink hover:bg-sand flex items-center gap-1.5"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5 text-teal" />
                  Exportar Excel
                </Button>

                <Button
                  size="sm"
                  onClick={() => window.print()}
                  disabled={!demonstrativo?.itens.length}
                  className="text-xs !h-8 bg-teal hover:brightness-110 text-sus-950 font-bold flex items-center gap-1.5 shadow-xs"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Imprimir Demonstrativo (A4)
                </Button>
              </div>
            </div>

            {/* Totais do Demonstrativo */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-sand/30 p-3 rounded-xl border border-sus-900/10">
              <div>
                <p className="text-[10px] uppercase font-bold text-ink/50">Procedimentos Distintos</p>
                <p className="font-mono text-lg font-bold text-sus-950 mt-0.5">
                  {demonstrativo?.total_procedimentos_distintos ?? 0}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold text-ink/50">Quantidade Total</p>
                <p className="font-mono text-lg font-bold text-sus-950 mt-0.5">
                  {(demonstrativo?.quantidade_total_geral ?? 0).toLocaleString("pt-BR")}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold text-ink/50">Total Ambulatorial (SA)</p>
                <p className="font-mono text-lg font-bold text-teal mt-0.5">
                  {(demonstrativo?.valor_total_ambulatorial ?? 0).toLocaleString("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                  })}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold text-ink/50">Valor Geral Faturado</p>
                <p className="font-mono text-lg font-bold text-emerald-700 mt-0.5">
                  {(demonstrativo?.valor_total_geral ?? 0).toLocaleString("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                  })}
                </p>
              </div>
            </div>

            {/* Tabela do Demonstrativo por CNES */}
            {loadingDemonstrativo ? (
              <div className="py-12 text-center text-ink/50">
                <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-teal border-t-transparent mb-2" />
                <p className="text-xs">Calculando demonstrativo de faturamento...</p>
              </div>
            ) : !demonstrativo || demonstrativo.itens.length === 0 ? (
              <div className="py-12 text-center text-ink/45">
                <FileText className="mx-auto h-8 w-8 text-ink/30 mb-2" />
                <p className="font-semibold text-sus-950">Nenhum faturamento registrado</p>
                <p className="text-xs text-ink/50 mt-1">
                  Não há lançamentos para o período e unidade selecionados.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {demonstrativo.por_cnes.map((grupo) => (
                  <div key={grupo.cnes} className="border border-sus-900/15 rounded-xl overflow-hidden shadow-xs">
                    {/* Cabeçalho do Grupo CNES */}
                    <div className="bg-sand/60 px-4 py-2.5 border-b border-sus-900/10 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-teal" />
                        <span className="font-bold text-sus-950 text-xs">
                          {grupo.unidade_nome}
                        </span>
                        <span className="font-mono text-[11px] bg-white px-2 py-0.5 rounded border border-sus-900/10 text-ink/70">
                          CNES: {grupo.cnes}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-xs font-semibold">
                        <span>
                          Qtd: <span className="font-mono font-bold text-sus-950">{grupo.quantidade_total}</span>
                        </span>
                        <span>
                          Subtotal:{" "}
                          <span className="font-mono font-bold text-emerald-700">
                            {grupo.valor_total.toLocaleString("pt-BR", {
                              style: "currency",
                              currency: "BRL",
                            })}
                          </span>
                        </span>
                      </div>
                    </div>

                    {/* Tabela de Procedimentos do CNES */}
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-sus-900/10 bg-white text-[11px] uppercase text-sus-900/60 font-semibold">
                          <th className="py-2.5 px-3">Código SIGTAP</th>
                          <th className="py-2.5 px-3">Descrição do Procedimento</th>
                          <th className="py-2.5 px-2">Tipo</th>
                          <th className="py-2.5 px-2">Origem</th>
                          <th className="py-2.5 px-2 text-right">Qtd</th>
                          <th className="py-2.5 px-3 text-right">Unitário SA</th>
                          <th className="py-2.5 px-3 text-right">Subtotal SUS</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-sus-900/5 bg-white">
                        {grupo.procedimentos.map((it, pIdx) => (
                          <tr key={pIdx} className="hover:bg-sand/30 transition-colors">
                            <td className="py-2 px-3 font-mono font-semibold text-sus-950">
                              {it.codigo}
                            </td>
                            <td className="py-2 px-3 text-ink font-medium max-w-sm truncate" title={it.descricao}>
                              {it.descricao}
                            </td>
                            <td className="py-2 px-2">
                              <span
                                className={`inline-block px-1.5 py-0.5 rounded font-mono text-[10px] font-bold ${
                                  it.instrumento === "BPA-C"
                                    ? "bg-teal/15 text-teal"
                                    : "bg-purple-100 text-purple-800"
                                }`}
                              >
                                {it.instrumento}
                              </span>
                            </td>
                            <td className="py-2 px-2 text-ink/60 text-[11px]">
                              {it.origem}
                            </td>
                            <td className="py-2 px-2 font-mono font-bold text-right text-sus-950">
                              {it.quantidade}
                            </td>
                            <td className="py-2 px-3 font-mono text-right text-ink/65">
                              {it.valor_ambulatorial.toLocaleString("pt-BR", {
                                style: "currency",
                                currency: "BRL",
                              })}
                            </td>
                            <td className="py-2 px-3 font-mono font-bold text-right text-emerald-700">
                              {it.valor_total.toLocaleString("pt-BR", {
                                style: "currency",
                                currency: "BRL",
                              })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* CONTEÚDO DAS ABAS DE REGISTROS (TODOS, BPA-C, BPA-I) */}
        {abaAtiva !== "criticas" && abaAtiva !== "demonstrativo" && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-sus-900/10 bg-sand text-xs uppercase text-sus-900/60 font-semibold">
                  <th className="py-3 px-3">Tipo</th>
                  <th className="py-3 px-2">Flh / Lin</th>
                  <th className="py-3 px-3">Código SIGTAP</th>
                  <th className="py-3 px-3">Descrição do Procedimento</th>
                  <th className="py-3 px-3">Origem</th>
                  <th className="py-3 px-3">Paciente / Identificação</th>
                  <th className="py-3 px-2 text-right">Qtd</th>
                  <th className="py-3 px-3 text-right">Unitário</th>
                  <th className="py-3 px-3 text-right">Total SUS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sus-900/5">
                {loading ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-ink/50">
                      <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-teal border-t-transparent mb-2" />
                      <p className="text-xs">Carregando produção do BPA...</p>
                    </td>
                  </tr>
                ) : itensFiltrados.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-ink/45">
                      <FileText className="mx-auto h-8 w-8 text-ink/30 mb-2" />
                      <p className="font-semibold text-sus-950">Nenhum procedimento encontrado</p>
                      <p className="text-xs text-ink/50 mt-1">
                        Não há registros ambulatoriais para a competência e filtro selecionados.
                      </p>
                    </td>
                  </tr>
                ) : (
                  itensFiltrados.map((it, idx) => (
                    <tr key={idx} className="hover:bg-sand/30 transition-colors">
                      <td className="py-2.5 px-3">
                        <span
                          className={`inline-block px-1.5 py-0.5 rounded font-mono text-[10px] font-bold ${
                            it.tipo === "BPA-C"
                              ? "bg-teal/15 text-teal"
                              : "bg-purple-100 text-purple-800"
                          }`}
                        >
                          {it.tipo}
                        </span>
                      </td>
                      <td className="py-2.5 px-2 font-mono text-ink/50">
                        {String(it.folha).padStart(3, "0")}/{String(it.linha).padStart(2, "0")}
                      </td>
                      <td className="py-2.5 px-3 font-mono font-semibold text-sus-950">
                        {it.procedimento}
                      </td>
                      <td className="py-2.5 px-3 text-ink font-medium max-w-xs truncate" title={it.descricao}>
                        {it.descricao}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="text-ink/65 text-[11px]">{it.origem}</span>
                      </td>
                      <td className="py-2.5 px-3 text-ink/80 max-w-xs truncate">
                        {it.paciente_nome ? (
                          <div>
                            <div className="font-semibold text-sus-950 truncate" title={it.paciente_nome}>
                              {it.paciente_nome}
                            </div>
                            <div className="text-[10px] text-ink/45 font-mono">
                              {it.paciente_cpf
                                ? `CPF: ${it.paciente_cpf}`
                                : it.paciente_cns
                                ? `CNS: ${it.paciente_cns}`
                                : ""}
                            </div>
                          </div>
                        ) : (
                          <span className="text-ink/40 italic">Consolidado Geral</span>
                        )}
                      </td>
                      <td className="py-2.5 px-2 font-mono font-bold text-right text-sus-950">
                        {it.quantidade}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-right text-ink/65">
                        {it.valor_unitario.toLocaleString("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        })}
                      </td>
                      <td className="py-2.5 px-3 font-mono font-bold text-right text-emerald-700">
                        {it.valor_total.toLocaleString("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        })}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Modal de Confirmação para Forçar Geração com Críticas */}
      {modalForcarAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="max-w-md w-full p-5 bg-white space-y-4 shadow-xl">
            <div className="flex items-center gap-2 text-rose-600 font-display font-bold">
              <AlertTriangle className="h-5 w-5" />
              <span>Forçar Geração em Modo Auditoria</span>
            </div>

            <p className="text-xs text-ink/80 leading-relaxed">
              Existem <strong className="text-rose-600">{criticas?.total_bloqueantes} pendências bloqueantes</strong> identificadas.
              A geração forçada destina-se apenas a análises e conferências de auditoria. O arquivo oficial gerado nessa condição poderá ser rejeitado pelo validador do SIA-SUS.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-sus-900/10">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setModalForcarAberto(false)}
                className="text-xs"
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                onClick={() => handleDownloadOut(true)}
                className="text-xs bg-rose-600 hover:bg-rose-700 text-white font-bold"
              >
                Confirmar e Baixar .OUT
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
