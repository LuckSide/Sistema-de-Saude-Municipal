import { useEffect, useState } from "react";
import {
  AlertCircle,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  DollarSign,
  Download,
  FileCheck,
  FileSpreadsheet,
  FileText,
  Filter,
  FlaskConical,
  Layers,
  Lock,
  Plus,
  Printer,
  Search,
  Tag,
  Trash2,
  TrendingUp,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import {
  labBiGastosPaciente,
  labBiGastosRanking,
  labBpaConsolidado,
  labBpaExportarCsv,
  labContratoAtualizar,
  labContratoCriar,
  labContratoPrecoDefinir,
  labContratoPrecoRemover,
  labContratoPrecosListar,
  labContratosPainel,
  labFaturamentoAprovar,
  labFaturamentoRelatorio,
  labFpoCriar,
  labFpoExportarSia,
  labFpoItemAdicionar,
  labFpoListar,
  labMarcarFaturado,
  labProntos,
  labsListar,
  labSigtap,
  pagData,
  pagMeta,
  type BpaResumo,
  type LabContrato,
  type LabContratoPreco,
  type LabContratosPainel,
  type LabFaturamentoRelatorio,
  type LabFPO,
  type Laboratorio,
  type LabSol,
  type PacienteGastosGeraisItem,
  type PacienteGastosResumo,
  type SigtapProc,
} from "../../services/api";
import { Badge, Button, Card, Input, Label, Select } from "../../components/ui/primitives";
import Paginacao from "../../components/Paginacao";
import ExportarExcel from "../../components/ExportarExcel";
import { useAuth } from "../../hooks/useAuth";

type AbaFaturamento = "contratos" | "espelho" | "fpo" | "bi_pacientes" | "consolidado" | "nominal";

export default function LabFaturamento() {
  const { user } = useAuth();
  const [comp, setComp] = useState(() => new Date().toISOString().slice(0, 7));
  const [aba, setAba] = useState<AbaFaturamento>("contratos");
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  // Laboratórios disponíveis
  const [labs, setLabs] = useState<Laboratorio[]>([]);
  const [labSelecionadoId, setLabSelecionadoId] = useState<string>("");

  // ABA 1: CONTRATOS & METAS
  const [painelContratos, setPainelContratos] = useState<LabContratosPainel | null>(null);
  const [modalContratoAberto, setModalContratoAberto] = useState(false);
  const [contratoEditando, setContratoEditando] = useState<LabContrato | null>(null);
  const [formContrato, setFormContrato] = useState({
    laboratorio_id: "",
    numero_contrato: "",
    processo_licitatorio: "",
    objeto: "Prestação de serviços de análises clínicas e laboratoriais",
    data_inicio: new Date().getFullYear() + "-01-01",
    data_fim: new Date().getFullYear() + "-12-31",
    valor_total_contrato: "100000",
    valor_mensal_teto: "8000",
    cota_exames_mensal: "1200",
    gestor_contrato: "Secretaria Municipal de Saúde",
    observacoes: "",
  });

  // PREÇOS CUSTOMIZADOS DO CONTRATO
  const [modalPrecosAberto, setModalPrecosAberto] = useState(false);
  const [contratoPrecoSel, setContratoPrecoSel] = useState<LabContrato | null>(null);
  const [precosContrato, setPrecosContrato] = useState<LabContratoPreco[]>([]);
  const [buscaProcSigtap, setBuscaProcSigtap] = useState("");
  const [procsSigtapEncontrados, setProcsSigtapEncontrados] = useState<SigtapProc[]>([]);
  const [procSelecionadoPreco, setProcSelecionadoPreco] = useState<SigtapProc | null>(null);
  const [novoValorCustom, setNovoValorCustom] = useState("");
  const [justificativaPreco, setJustificativaPreco] = useState("");

  // ABA 2: ESPELHO DO PRESTADOR
  const [relatorioPrestador, setRelatorioPrestador] = useState<LabFaturamentoRelatorio | null>(null);
  const [parecerAprovacao, setParecerAprovacao] = useState("");
  const [liberarVisualizacaoLab, setLiberarVisualizacaoLab] = useState(true);

  // ABA 3: FPO & SIA/SUS
  const [fpos, setFpos] = useState<LabFPO[]>([]);
  const [modalFpoAberto, setModalFpoAberto] = useState(false);
  const [formFpo, setFormFpo] = useState({
    laboratorio_id: "",
    cnes_prestador: "",
    numero_fpo: "",
    teto_fisico_programado: "1000",
    teto_financeiro_programado: "10000",
  });

  // ABA 4: BI DE GASTOS POR PACIENTE
  const [buscaPacienteBi, setBuscaPacienteBi] = useState("");
  const [rankingBi, setRankingBi] = useState<PacienteGastosGeraisItem[]>([]);
  const [extratoPacienteBi, setExtratoPacienteBi] = useState<PacienteGastosResumo | null>(null);
  const [modalExtratoAberto, setModalExtratoAberto] = useState(false);

  // ABA 5 e 6: BPA CONSOLIDADO E NOMINAL (LEGADO COMPATÍVEL)
  const [resumoBpa, setResumoBpa] = useState<BpaResumo | null>(null);
  const [carregandoBpa, setCarregandoBpa] = useState(false);
  const [listaNominal, setListaNominal] = useState<LabSol[]>([]);
  const [selNominal, setSelNominal] = useState<number[]>([]);
  const [pageNominal, setPageNominal] = useState(1);
  const [totalNominal, setTotalNominal] = useState(0);
  const [pagesNominal, setPagesNominal] = useState(1);

  // Carrega lista inicial de laboratórios
  useEffect(() => {
    labsListar(false)
      .then((l) => {
        setLabs(l);
        if (l.length > 0 && !labSelecionadoId) {
          // Se for perfil laboratório restrito, seleciona o dele
          if (user?.laboratorio_id) {
            setLabSelecionadoId(String(user.laboratorio_id));
          } else {
            const ativo = l.find((x) => x.ativo) || l[0];
            setLabSelecionadoId(String(ativo.id));
          }
        }
      })
      .catch(() => {});
  }, [user]);

  // Carregamentos conforme aba ativa
  useEffect(() => {
    if (aba === "contratos") {
      carregarPainelContratos();
    } else if (aba === "espelho") {
      carregarEspelhoPrestador();
    } else if (aba === "fpo") {
      carregarFpos();
    } else if (aba === "bi_pacientes") {
      carregarBiRanking();
    } else if (aba === "consolidado") {
      carregarConsolidadoBpa();
    } else if (aba === "nominal") {
      carregarNominal(1);
    }
  }, [aba, comp, labSelecionadoId]);

  async function carregarPainelContratos() {
    try {
      const p = await labContratosPainel();
      setPainelContratos(p);
    } catch {
      setPainelContratos(null);
    }
  }

  async function carregarEspelhoPrestador() {
    if (!labSelecionadoId || !comp) return;
    setBusy(true);
    setErro("");
    try {
      const rel = await labFaturamentoRelatorio(Number(labSelecionadoId), comp);
      setRelatorioPrestador(rel);
      setParecerAprovacao(rel.parecer_secretaria || "");
      setLiberarVisualizacaoLab(rel.liberado_visualizacao_lab);
    } catch (e: any) {
      const msg = e?.response?.data?.detail || "Falha ao carregar espelho de faturamento.";
      setErro(msg);
      setRelatorioPrestador(null);
    } finally {
      setBusy(false);
    }
  }

  async function carregarFpos() {
    try {
      const data = await labFpoListar(comp || undefined, labSelecionadoId ? Number(labSelecionadoId) : undefined);
      setFpos(data);
    } catch {
      setFpos([]);
    }
  }

  async function carregarBiRanking() {
    try {
      const r = await labBiGastosRanking(buscaPacienteBi);
      setRankingBi(r);
    } catch {
      setRankingBi([]);
    }
  }

  async function verExtratoPaciente(pacienteId: number) {
    setBusy(true);
    try {
      const res = await labBiGastosPaciente(pacienteId);
      setExtratoPacienteBi(res);
      setModalExtratoAberto(true);
    } catch {
      setErro("Falha ao carregar extrato do paciente.");
    } finally {
      setBusy(false);
    }
  }

  async function carregarConsolidadoBpa() {
    if (!comp) return;
    setCarregandoBpa(true);
    try {
      const data = await labBpaConsolidado(comp);
      setResumoBpa(data);
    } catch {
      setResumoBpa(null);
    } finally {
      setCarregandoBpa(false);
    }
  }

  async function carregarNominal(p = pageNominal) {
    try {
      const r = await labProntos(comp || undefined, p, 100);
      setListaNominal(pagData<LabSol>(r));
      const m = pagMeta(r);
      setTotalNominal(m.total);
      setPageNominal(m.page);
      setPagesNominal(m.pages);
      setSelNominal([]);
    } catch {
      setErro("Falha ao carregar prontos.");
    }
  }

  // --- Handlers Contrato ---
  async function salvarContrato() {
    setErro("");
    setOk("");
    if (!formContrato.laboratorio_id || !formContrato.numero_contrato) {
      setErro("Preencha o laboratório e o número do contrato.");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        laboratorio_id: Number(formContrato.laboratorio_id),
        numero_contrato: formContrato.numero_contrato.trim(),
        processo_licitatorio: formContrato.processo_licitatorio.trim(),
        objeto: formContrato.objeto.trim(),
        data_inicio: formContrato.data_inicio,
        data_fim: formContrato.data_fim,
        valor_total_contrato: Number(formContrato.valor_total_contrato) || 0,
        valor_mensal_teto: Number(formContrato.valor_mensal_teto) || 0,
        cota_exames_mensal: Number(formContrato.cota_exames_mensal) || 0,
        gestor_contrato: formContrato.gestor_contrato.trim(),
        observacoes: formContrato.observacoes.trim(),
      };
      if (contratoEditando) {
        await labContratoAtualizar(contratoEditando.id, payload);
        setOk(`Contrato ${contratoEditando.numero_contrato} atualizado.`);
      } else {
        await labContratoCriar(payload);
        setOk("Novo contrato cadastrado com sucesso.");
      }
      setModalContratoAberto(false);
      setContratoEditando(null);
      await carregarPainelContratos();
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Erro ao salvar contrato.");
    } finally {
      setBusy(false);
    }
  }

  // --- Handlers Preços Customizados ---
  async function abrirPrecosContrato(c: LabContrato) {
    setContratoPrecoSel(c);
    setBusy(true);
    try {
      const precos = await labContratoPrecosListar(c.id);
      setPrecosContrato(precos);
      setProcSelecionadoPreco(null);
      setNovoValorCustom("");
      setJustificativaPreco("");
      setModalPrecosAberto(true);
    } catch {
      setErro("Falha ao carregar tabela de preços do contrato.");
    } finally {
      setBusy(false);
    }
  }

  async function pesquisarProcedimentosSigtap(termo: string) {
    setBuscaProcSigtap(termo);
    if (termo.trim().length < 2) {
      setProcsSigtapEncontrados([]);
      return;
    }
    try {
      const res = await labSigtap({ q: termo.trim(), limit: 10 });
      setProcsSigtapEncontrados(res.data);
    } catch {
      setProcsSigtapEncontrados([]);
    }
  }

  async function salvarPrecoCustomizado() {
    if (!contratoPrecoSel || !procSelecionadoPreco) {
      setErro("Selecione um procedimento para customizar o preço.");
      return;
    }
    const val = parseFloat(novoValorCustom.replace(",", "."));
    if (isNaN(val) || val <= 0) {
      setErro("Informe um valor customizado válido.");
      return;
    }
    setBusy(true);
    setErro("");
    try {
      await labContratoPrecoDefinir(contratoPrecoSel.id, {
        contrato_id: contratoPrecoSel.id,
        sigtap_id: procSelecionadoPreco.id,
        valor_customizado: val,
        vigencia_inicio: contratoPrecoSel.data_inicio,
        vigencia_fim: contratoPrecoSel.data_fim,
        justificativa: justificativaPreco.trim() || "Valor negociado em contrato",
      });
      setOk(`Preço de ${procSelecionadoPreco.descricao} customizado para R$ ${val.toFixed(2)}.`);
      const precos = await labContratoPrecosListar(contratoPrecoSel.id);
      setPrecosContrato(precos);
      setProcSelecionadoPreco(null);
      setNovoValorCustom("");
      setJustificativaPreco("");
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Erro ao salvar preço.");
    } finally {
      setBusy(false);
    }
  }

  async function removerPrecoCustomizado(precoId: number) {
    if (!contratoPrecoSel) return;
    setBusy(true);
    try {
      await labContratoPrecoRemover(contratoPrecoSel.id, precoId);
      const precos = await labContratoPrecosListar(contratoPrecoSel.id);
      setPrecosContrato(precos);
      setOk("Preço customizado removido. O procedimento voltou ao valor padrão SIGTAP.");
    } catch {
      setErro("Erro ao remover preço customizado.");
    } finally {
      setBusy(false);
    }
  }

  // --- Handlers Aprovação de Faturamento Secretaria ---
  async function aprovarFaturamento() {
    if (!relatorioPrestador) return;
    setBusy(true);
    setErro("");
    setOk("");
    try {
      await labFaturamentoAprovar({
        laboratorio_id: relatorioPrestador.laboratorio_id,
        competencia: relatorioPrestador.competencia,
        liberado_visualizacao_lab: liberarVisualizacaoLab,
        parecer_secretaria: parecerAprovacao.trim(),
      });
      setOk("Faturamento aprovado com sucesso pela Secretaria de Saúde.");
      await carregarEspelhoPrestador();
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Erro ao aprovar faturamento.");
    } finally {
      setBusy(false);
    }
  }

  // --- Handlers FPO ---
  async function salvarFpo() {
    if (!formFpo.laboratorio_id || !formFpo.numero_fpo) {
      setErro("Informe o laboratório e o número da FPO.");
      return;
    }
    setBusy(true);
    try {
      await labFpoCriar({
        laboratorio_id: Number(formFpo.laboratorio_id),
        competencia: comp,
        cnes_prestador: formFpo.cnes_prestador.trim(),
        numero_fpo: formFpo.numero_fpo.trim(),
        teto_fisico_programado: Number(formFpo.teto_fisico_programado) || 0,
        teto_financeiro_programado: Number(formFpo.teto_financeiro_programado) || 0,
      });
      setOk("Programação Orçamentária (FPO) cadastrada com sucesso.");
      setModalFpoAberto(false);
      await carregarFpos();
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Erro ao criar FPO.");
    } finally {
      setBusy(false);
    }
  }

  async function exportarSia(fpoId: number) {
    setBusy(true);
    try {
      const blob = await labFpoExportarSia(fpoId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `FPO_SIA_${comp}_LAB_${labSelecionadoId}.txt`;
      a.click();
      URL.revokeObjectURL(url);
      setOk("Arquivo SIA/SUS gerado e baixado com sucesso.");
    } catch {
      setErro("Erro ao exportar arquivo SIA/SUS.");
    } finally {
      setBusy(false);
    }
  }

  // --- Handlers Legados (BPA e Nominal) ---
  function toggleNominal(id: number) {
    setSelNominal((s) => (s.includes(id) ? s.filter((i) => i !== id) : [...s, id]));
  }

  function todosNominal() {
    setSelNominal((s) => (s.length === listaNominal.length ? [] : listaNominal.map((i) => i.id)));
  }

  async function faturarNominal() {
    setErro("");
    setOk("");
    if (selNominal.length === 0) {
      setErro("Selecione ao menos um exame realizado.");
      return;
    }
    setBusy(true);
    try {
      const r = await labMarcarFaturado(selNominal);
      setOk(`${r.atualizados ?? selNominal.length} exame(s) marcado(s) como faturado.`);
      await carregarNominal();
      await carregarConsolidadoBpa();
    } catch {
      setErro("Erro ao marcar como faturado.");
    } finally {
      setBusy(false);
    }
  }

  async function exportarBpaCsv() {
    setErro("");
    setOk("");
    if (!comp) {
      setErro("Informe a competência AAAA-MM.");
      return;
    }
    setBusy(true);
    try {
      const blob = await labBpaExportarCsv(comp);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `bpa_consolidado_${comp}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setOk("Lote BPA consolidado exportado com sucesso.");
    } catch {
      setErro("Erro ao exportar lote BPA.");
    } finally {
      setBusy(false);
    }
  }

  const ehPerfilLaboratorio = Boolean(user && !user.is_superuser && user.laboratorio_id);

  return (
    <div className="space-y-5">
      {/* Barra de Título e Controles */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-sus-950 flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-teal" /> Faturamento, Contratos & SIA-SUS · Laboratório
          </h2>
          <p className="text-xs text-ink/65">
            Gestão integrada de contratos de prestadores, limites orçamentários, preços pactuados, apuração mensal e exportação SIA/SUS.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 ml-auto">
          {/* Seletor de Laboratório (se não for restrito ao próprio) */}
          {!ehPerfilLaboratorio && (
            <div className="flex items-center gap-1.5 bg-white border border-sus-900/15 rounded-xl px-3 py-1.5 shadow-xs">
              <span className="text-xs font-semibold text-ink/60">Prestador:</span>
              <select
                value={labSelecionadoId}
                onChange={(e) => setLabSelecionadoId(e.target.value)}
                className="text-xs font-bold text-sus-950 outline-none bg-transparent"
              >
                {labs.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.nome} {!l.ativo ? "(Inativo)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Seletor de Competência */}
          <div className="flex items-center gap-1.5 bg-white border border-sus-900/15 rounded-xl px-3 py-1.5 shadow-xs">
            <span className="text-xs font-semibold text-ink/60">Competência:</span>
            <input
              type="month"
              value={comp}
              onChange={(e) => setComp(e.target.value)}
              className="text-xs font-bold text-sus-950 outline-none bg-transparent"
            />
          </div>
        </div>
      </div>

      {/* Navegação entre Abas */}
      <div className="flex flex-wrap border-b border-sus-900/15 gap-1">
        <button
          onClick={() => setAba("contratos")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-t-xl transition-colors ${
            aba === "contratos"
              ? "bg-white border-t border-x border-sus-900/15 text-teal -mb-px shadow-xs"
              : "text-ink/60 hover:text-sus-950 hover:bg-white/50"
          }`}
        >
          <Layers className="h-4 w-4" /> Gestão de Contratos & Metas
        </button>

        <button
          onClick={() => setAba("espelho")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-t-xl transition-colors ${
            aba === "espelho"
              ? "bg-white border-t border-x border-sus-900/15 text-teal -mb-px shadow-xs"
              : "text-ink/60 hover:text-sus-950 hover:bg-white/50"
          }`}
        >
          <FileCheck className="h-4 w-4" /> Espelho do Prestador (Faturamento)
        </button>

        <button
          onClick={() => setAba("fpo")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-t-xl transition-colors ${
            aba === "fpo"
              ? "bg-white border-t border-x border-sus-900/15 text-teal -mb-px shadow-xs"
              : "text-ink/60 hover:text-sus-950 hover:bg-white/50"
          }`}
        >
          <Building2 className="h-4 w-4" /> Programação FPO & SIA/SUS
        </button>

        <button
          onClick={() => setAba("bi_pacientes")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-t-xl transition-colors ${
            aba === "bi_pacientes"
              ? "bg-white border-t border-x border-sus-900/15 text-teal -mb-px shadow-xs"
              : "text-ink/60 hover:text-sus-950 hover:bg-white/50"
          }`}
        >
          <Users className="h-4 w-4" /> Auditoria & Gastos por Cidadão
        </button>

        <button
          onClick={() => setAba("consolidado")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-t-xl transition-colors ${
            aba === "consolidado"
              ? "bg-white border-t border-x border-sus-900/15 text-teal -mb-px shadow-xs"
              : "text-ink/60 hover:text-sus-950 hover:bg-white/50"
          }`}
        >
          <FlaskConical className="h-4 w-4" /> BPA Consolidado
        </button>

        <button
          onClick={() => setAba("nominal")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-t-xl transition-colors ${
            aba === "nominal"
              ? "bg-white border-t border-x border-sus-900/15 text-teal -mb-px shadow-xs"
              : "text-ink/60 hover:text-sus-950 hover:bg-white/50"
          }`}
        >
          <CheckCircle2 className="h-4 w-4" /> Relação Nominal Prontos
        </button>
      </div>

      {erro && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs font-semibold">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{erro}</span>
        </div>
      )}

      {ok && (
        <div className="flex items-center gap-2 p-3 bg-teal/10 border border-teal/20 text-teal rounded-xl text-xs font-semibold">
          <Check className="h-4 w-4 shrink-0" />
          <span>{ok}</span>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ABA 1: GESTÃO DE CONTRATOS & METAS                                        */}
      {/* ========================================================================= */}
      {aba === "contratos" && (
        <div className="space-y-4">
          {/* KPI CARDS CONTRATOS */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Card className="p-4 border-sus-900/10 shadow-xs flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase text-ink/50">Total Contratos Ativos</p>
                <p className="text-xl font-display font-bold text-sus-950 mt-1">
                  {painelContratos?.total_contratos_ativos ?? 0}
                </p>
                <p className="text-[11px] text-ink/50 mt-0.5">Prestadores conveniados</p>
              </div>
              <div className="p-2.5 bg-teal/10 text-teal rounded-xl">
                <Building2 className="h-5 w-5" />
              </div>
            </Card>

            <Card className="p-4 border-sus-900/10 shadow-xs flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase text-ink/50">Valor Global Contratado</p>
                <p className="text-xl font-display font-bold text-teal mt-1">
                  {(painelContratos?.valor_total_todos_contratos ?? 0).toLocaleString("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                  })}
                </p>
                <p className="text-[11px] text-ink/50 mt-0.5">Soma de todos os contratos</p>
              </div>
              <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-xl">
                <DollarSign className="h-5 w-5" />
              </div>
            </Card>

            <Card className="p-4 border-sus-900/10 shadow-xs flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase text-ink/50">Gasto Global Acumulado</p>
                <p className="text-xl font-display font-bold text-sus-950 mt-1">
                  {(painelContratos?.valor_total_gasto_global ?? 0).toLocaleString("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                  })}
                </p>
                <p className="text-[11px] text-ink/50 mt-0.5">Execução contratual total</p>
              </div>
              <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl">
                <TrendingUp className="h-5 w-5" />
              </div>
            </Card>

            <Card className="p-4 border-sus-900/10 shadow-xs flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase text-ink/50">Consumo Mês Vigente</p>
                <p className="text-xl font-display font-bold text-amber-600 mt-1">
                  {(painelContratos?.valor_gasto_mes_atual_global ?? 0).toLocaleString("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                  })}
                </p>
                <p className="text-[11px] text-ink/50 mt-0.5">Competência atual</p>
              </div>
              <div className="p-2.5 bg-amber-50 text-amber-600 rounded-xl">
                <Calendar className="h-5 w-5" />
              </div>
            </Card>
          </div>

          {/* BARRA DE AÇÃO */}
          {!ehPerfilLaboratorio && (
            <div className="flex justify-end">
              <Button
                type="button"
                onClick={() => {
                  setContratoEditando(null);
                  setFormContrato({
                    laboratorio_id: labSelecionadoId || (labs[0] ? String(labs[0].id) : ""),
                    numero_contrato: "",
                    processo_licitatorio: "",
                    objeto: "Prestação de serviços de análises clínicas e laboratoriais",
                    data_inicio: new Date().getFullYear() + "-01-01",
                    data_fim: new Date().getFullYear() + "-12-31",
                    valor_total_contrato: "100000",
                    valor_mensal_teto: "8000",
                    cota_exames_mensal: "1200",
                    gestor_contrato: "Secretaria Municipal de Saúde",
                    observacoes: "",
                  });
                  setModalContratoAberto(true);
                }}
                className="bg-teal hover:bg-teal/90 text-white font-bold text-xs flex items-center gap-1.5"
              >
                <Plus className="h-4 w-4" /> Novo Contrato de Prestador
              </Button>
            </div>
          )}

          {/* TABELA DE CONTRATOS */}
          <Card className="overflow-hidden border-sus-900/10 shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-sus-900/10 bg-sand text-xs uppercase text-sus-900/60">
                    <th className="px-4 py-3 font-semibold">Nº Contrato</th>
                    <th className="px-4 py-3 font-semibold">Prestador</th>
                    <th className="px-4 py-3 font-semibold">Vigência</th>
                    <th className="px-4 py-3 font-semibold text-right">Valor Total</th>
                    <th className="px-4 py-3 font-semibold text-right">Gasto Mês</th>
                    <th className="px-4 py-3 font-semibold text-right">Saldo Contrato</th>
                    <th className="px-4 py-3 font-semibold text-center">Consumo</th>
                    <th className="px-4 py-3 font-semibold text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {painelContratos?.contratos.map((c) => {
                    const pct = Math.min(100, Math.round(c.percentual_total_consumido));
                    const corBarra = pct > 90 ? "bg-red-500" : pct > 70 ? "bg-amber-500" : "bg-teal";
                    return (
                      <tr key={c.id} className="border-b border-sus-900/5 last:border-0 hover:bg-sand/30">
                        <td className="px-4 py-3">
                          <span className="font-mono font-bold text-sus-950">{c.numero_contrato}</span>
                          {c.processo_licitatorio && (
                            <p className="text-[11px] text-ink/50">{c.processo_licitatorio}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 font-semibold text-sus-950">
                          {c.laboratorio_nome}
                          <p className="text-[11px] font-normal text-ink/50">{c.gestor_contrato}</p>
                        </td>
                        <td className="px-4 py-3 text-xs text-ink/75">
                          {c.data_inicio} até {c.data_fim}
                          <p className="text-[11px] text-ink/50">{c.dias_restantes_vigencia} dias restantes</p>
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-sus-950">
                          {c.valor_total_contrato.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-amber-700">
                          {c.valor_gasto_mes_atual.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                          <p className="text-[10px] text-ink/50 font-sans">
                            Teto: {c.valor_mensal_teto.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-teal">
                          {c.saldo_total_disponivel.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="w-24 mx-auto bg-sus-900/10 rounded-full h-2 overflow-hidden">
                            <div className={`h-full ${corBarra}`} style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-[10px] font-bold text-ink/60 mt-1 block">{pct}%</span>
                        </td>
                        <td className="px-4 py-3 text-right space-x-1.5 whitespace-nowrap">
                          <Button
                            type="button"
                            onClick={() => abrirPrecosContrato(c)}
                            className="!h-7 text-[11px] bg-white border border-sus-900/15 hover:bg-sand text-sus-950"
                          >
                            <Tag className="h-3 w-3 mr-1 text-teal" /> Preços Customizados
                          </Button>
                          {!ehPerfilLaboratorio && (
                            <Button
                              type="button"
                              onClick={() => {
                                setContratoEditando(c);
                                setFormContrato({
                                  laboratorio_id: String(c.laboratorio_id),
                                  numero_contrato: c.numero_contrato,
                                  processo_licitatorio: c.processo_licitatorio,
                                  objeto: c.objeto,
                                  data_inicio: c.data_inicio,
                                  data_fim: c.data_fim,
                                  valor_total_contrato: String(c.valor_total_contrato),
                                  valor_mensal_teto: String(c.valor_mensal_teto),
                                  cota_exames_mensal: String(c.cota_exames_mensal),
                                  gestor_contrato: c.gestor_contrato,
                                  observacoes: c.observacoes,
                                });
                                setModalContratoAberto(true);
                              }}
                              className="!h-7 text-[11px] bg-white border border-sus-900/15 hover:bg-sand text-sus-950"
                            >
                              Editar
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {(!painelContratos || painelContratos.contratos.length === 0) && (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-ink/45 text-xs">
                        Nenhum contrato cadastrado até o momento.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ABA 2: ESPELHO DO PRESTADOR (RELATÓRIO DISCRIMINADO)                      */}
      {/* ========================================================================= */}
      {aba === "espelho" && (
        <div className="space-y-4">
          {relatorioPrestador ? (
            <Card className="p-6 border-sus-900/15 shadow-sm space-y-6 print:border-none print:shadow-none print:p-0">
              {/* CABEÇALHO DO ESPELHO */}
              <div className="border-b border-sus-900/10 pb-4 flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-display font-bold text-lg text-sus-950">
                      {relatorioPrestador.laboratorio_nome}
                    </span>
                    <Badge variant={relatorioPrestador.liberado_visualizacao_lab ? "success" : "warning"}>
                      {relatorioPrestador.liberado_visualizacao_lab ? "Liberado pela Secretaria" : "Pendente Aprovação"}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 text-xs text-ink/65 mt-2">
                    <p><span className="font-semibold text-sus-950">CNES:</span> {relatorioPrestador.cnes_laboratorio || "—"}</p>
                    <p><span className="font-semibold text-sus-950">Responsável:</span> {relatorioPrestador.responsavel_tecnico || "—"}</p>
                    <p><span className="font-semibold text-sus-950">Horário:</span> {relatorioPrestador.horario_funcionamento || "—"}</p>
                    <p><span className="font-semibold text-sus-950">Contrato:</span> {relatorioPrestador.numero_contrato || "Geral"}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 print:hidden">
                  <Button
                    type="button"
                    onClick={() => window.print()}
                    className="bg-white border border-sus-900/15 hover:bg-sand text-sus-950 text-xs font-bold flex items-center gap-1.5"
                  >
                    <Printer className="h-4 w-4 text-teal" /> Imprimir Relatório
                  </Button>
                </div>
              </div>

              {/* TABELA DE ITENS EXECUTADOS */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-sus-900/15 bg-sand/60 font-semibold uppercase text-sus-900/70">
                      <th className="px-3 py-2.5">Código</th>
                      <th className="px-3 py-2.5">Procedimento / Exame</th>
                      <th className="px-3 py-2.5 text-center">Origem Preço</th>
                      <th className="px-3 py-2.5 text-center">Qtd Executada</th>
                      <th className="px-3 py-2.5 text-right">Valor Unitário</th>
                      <th className="px-3 py-2.5 text-right">Total Faturado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {relatorioPrestador.itens.map((it) => (
                      <tr key={it.sigtap_id} className="border-b border-sus-900/5 hover:bg-sand/20">
                        <td className="px-3 py-2 font-mono text-ink/70">{it.codigo_procedimento}</td>
                        <td className="px-3 py-2 font-medium text-sus-950">{it.descricao_procedimento}</td>
                        <td className="px-3 py-2 text-center">
                          {it.origem_preco === "contrato_custom" ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                              Tabela Contrato
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-slate-50 text-slate-600 border border-slate-200">
                              SIGTAP SUS
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center font-bold text-sus-950">{it.quantidade}</td>
                        <td className="px-3 py-2 text-right font-mono">
                          {it.valor_unitario.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-teal">
                          {it.valor_total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                        </td>
                      </tr>
                    ))}
                    {relatorioPrestador.itens.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-3 py-8 text-center text-ink/40">
                          Nenhum exame executado nesta competência para este prestador.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {/* TOTALIZADOR */}
                  <tfoot>
                    <tr className="bg-sand/60 font-bold border-t-2 border-sus-900/15">
                      <td colSpan={3} className="px-3 py-3 uppercase text-sus-950">
                        Total Geral da Produção ({relatorioPrestador.competencia})
                      </td>
                      <td className="px-3 py-3 text-center text-sm text-sus-950">
                        {relatorioPrestador.total_exames}
                      </td>
                      <td className="px-3 py-3 text-right text-xs text-ink/50">—</td>
                      <td className="px-3 py-3 text-right font-mono text-base text-teal">
                        {relatorioPrestador.valor_total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* BLOCO DE GOVERNANÇA E APROVAÇÃO SECRETARIA */}
              {!ehPerfilLaboratorio && (
                <div className="p-4 bg-sand/30 border border-sus-900/10 rounded-xl space-y-3 print:hidden">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-sus-950 flex items-center gap-1.5">
                      <FileCheck className="h-4 w-4 text-teal" /> Parecer e Homologação da Secretaria Municipal de Saúde
                    </p>
                    <label className="flex items-center gap-2 text-xs font-semibold text-sus-950 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={liberarVisualizacaoLab}
                        onChange={(e) => setLiberarVisualizacaoLab(e.target.checked)}
                        className="rounded border-sus-900/20 text-teal"
                      />
                      Liberar visualização imediata no Portal do Prestador
                    </label>
                  </div>

                  <Input
                    type="text"
                    placeholder="Parecer da auditoria/conferência da Secretaria de Saúde..."
                    value={parecerAprovacao}
                    onChange={(e) => setParecerAprovacao(e.target.value)}
                    className="text-xs bg-white"
                  />

                  <div className="flex justify-end">
                    <Button
                      type="button"
                      disabled={busy}
                      onClick={aprovarFaturamento}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs"
                    >
                      <CheckCircle2 className="h-4 w-4 mr-1.5" /> Aprovar e Homologar Produção Mensal
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          ) : (
            <Card className="p-8 text-center border-sus-900/10 text-ink/50 text-xs">
              Selecione o laboratório e a competência para visualizar o espelho do faturamento.
            </Card>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* ABA 3: FPO & SIA/SUS                                                      */}
      {/* ========================================================================= */}
      {aba === "fpo" && (
        <div className="space-y-4">
          {!ehPerfilLaboratorio && (
            <div className="flex justify-end">
              <Button
                type="button"
                onClick={() => {
                  setFormFpo({
                    laboratorio_id: labSelecionadoId || (labs[0] ? String(labs[0].id) : ""),
                    cnes_prestador: "",
                    numero_fpo: `FPO-${comp.replace("-", "")}`,
                    teto_fisico_programado: "1000",
                    teto_financeiro_programado: "10000",
                  });
                  setModalFpoAberto(true);
                }}
                className="bg-teal hover:bg-teal/90 text-white font-bold text-xs flex items-center gap-1.5"
              >
                <Plus className="h-4 w-4" /> Cadastrar Programação FPO
              </Button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {fpos.map((f) => (
              <Card key={f.id} className="p-5 border-sus-900/10 shadow-xs space-y-3">
                <div className="flex items-center justify-between border-b border-sus-900/10 pb-2">
                  <div>
                    <span className="font-mono font-bold text-sm text-sus-950">{f.numero_fpo}</span>
                    <p className="text-xs text-ink/60">{f.laboratorio_nome} · Competência {f.competencia}</p>
                  </div>
                  <Badge variant="outline">{f.status}</Badge>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2 bg-sand/30 rounded-lg">
                    <p className="text-[10px] text-ink/50 font-bold uppercase">Teto Físico Programado</p>
                    <p className="font-bold text-sus-950 text-sm mt-0.5">{f.teto_fisico_programado} exames</p>
                    <p className="text-[10px] text-ink/50">Executado: {f.total_fisico_executado}</p>
                  </div>
                  <div className="p-2 bg-sand/30 rounded-lg">
                    <p className="text-[10px] text-ink/50 font-bold uppercase">Teto Financeiro</p>
                    <p className="font-bold text-teal text-sm mt-0.5">
                      {f.teto_financeiro_programado.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                    </p>
                    <p className="text-[10px] text-ink/50">
                      Executado: {f.total_financeiro_executado.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                    </p>
                  </div>
                </div>

                <div className="flex justify-end pt-2 border-t border-sus-900/5">
                  <Button
                    type="button"
                    onClick={() => exportarSia(f.id)}
                    className="bg-white border border-sus-900/15 hover:bg-sand text-sus-950 text-xs font-bold flex items-center gap-1.5"
                  >
                    <Download className="h-4 w-4 text-teal" /> Exportar Layout SIA/SUS (.txt)
                  </Button>
                </div>
              </Card>
            ))}

            {fpos.length === 0 && (
              <div className="col-span-2 p-8 text-center text-xs text-ink/45 bg-white rounded-xl border border-dashed border-sus-900/15">
                Nenhuma FPO programada para a competência selecionada.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ABA 4: AUDITORIA & GASTOS POR CIDADÃO (BI)                                */}
      {/* ========================================================================= */}
      {aba === "bi_pacientes" && (
        <div className="space-y-4">
          <Card className="p-4 border-sus-900/10 shadow-xs">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-ink/40" />
              <Input
                type="text"
                placeholder="Buscar paciente por nome ou CPF..."
                value={buscaPacienteBi}
                onChange={(e) => setBuscaPacienteBi(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && carregarBiRanking()}
                className="text-xs"
              />
              <Button type="button" onClick={carregarBiRanking} className="text-xs font-bold bg-teal text-white">
                Pesquisar
              </Button>
            </div>
          </Card>

          <Card className="overflow-hidden border-sus-900/10 shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-sus-900/10 bg-sand text-xs uppercase text-sus-900/60">
                    <th className="px-4 py-3 font-semibold">Cidadão / Paciente</th>
                    <th className="px-4 py-3 font-semibold">CPF</th>
                    <th className="px-4 py-3 font-semibold">CNS</th>
                    <th className="px-4 py-3 font-semibold text-center">Qtd Exames</th>
                    <th className="px-4 py-3 font-semibold text-right">Recursos Investidos</th>
                    <th className="px-4 py-3 font-semibold text-right">Extrato</th>
                  </tr>
                </thead>
                <tbody>
                  {rankingBi.map((p) => (
                    <tr key={p.paciente_id} className="border-b border-sus-900/5 last:border-0 hover:bg-sand/30">
                      <td className="px-4 py-3 font-semibold text-sus-950">{p.paciente_nome}</td>
                      <td className="px-4 py-3 font-mono text-xs">{p.paciente_cpf || "—"}</td>
                      <td className="px-4 py-3 font-mono text-xs">{p.paciente_cns || "—"}</td>
                      <td className="px-4 py-3 text-center font-bold text-sus-950">{p.qtd_exames}</td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-teal">
                        {p.total_gasto.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          type="button"
                          onClick={() => verExtratoPaciente(p.paciente_id)}
                          className="!h-7 text-xs bg-white border border-sus-900/15 hover:bg-sand text-sus-950"
                        >
                          Ver Histórico Completo
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {rankingBi.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-ink/45 text-xs">
                        Nenhum registro encontrado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ABA 5: BPA CONSOLIDADO (LEGADO COMPATÍVEL)                                */}
      {/* ========================================================================= */}
      {aba === "consolidado" && (
        <Card className="overflow-hidden border-sus-900/10 shadow-xs">
          <div className="p-3 bg-sand/30 border-b border-sus-900/10 flex items-center justify-between">
            <span className="text-xs font-semibold text-ink/65">
              Boletim de Produção Ambulatorial Consolidado (BPA-C)
            </span>
            <Button
              type="button"
              onClick={exportarBpaCsv}
              disabled={busy || !resumoBpa || resumoBpa.total_procedimentos === 0}
              className="!h-8 text-xs bg-teal hover:bg-teal/90 text-white font-bold"
            >
              <Download className="h-3.5 w-3.5 mr-1" /> Baixar CSV BPA
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-sus-900/10 bg-sand text-xs uppercase text-sus-900/60">
                  <th className="px-4 py-3 font-semibold">Código</th>
                  <th className="px-4 py-3 font-semibold">Procedimento SIGTAP</th>
                  <th className="px-4 py-3 font-semibold text-center">Quantidade</th>
                  <th className="px-4 py-3 font-semibold text-right">Valor Unitário</th>
                  <th className="px-4 py-3 font-semibold text-right">Valor Total</th>
                </tr>
              </thead>
              <tbody>
                {resumoBpa?.itens.map((it) => (
                  <tr key={it.codigo} className="border-b border-sus-900/5 hover:bg-sand/20">
                    <td className="px-4 py-3 font-mono text-xs">{it.codigo}</td>
                    <td className="px-4 py-3 text-xs font-medium text-sus-950">{it.descricao}</td>
                    <td className="px-4 py-3 text-center font-bold text-sus-950">{it.quantidade}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs">
                      {it.valor_unitario.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-teal text-xs">
                      {it.valor_total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                    </td>
                  </tr>
                ))}
                {(!resumoBpa || resumoBpa.itens.length === 0) && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-ink/45 text-xs">
                      Nenhum procedimento no consolidado BPA desta competência.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ========================================================================= */}
      {/* ABA 6: NOMINAL EXAMES PRONTOS (LEGADO COMPATÍVEL)                         */}
      {/* ========================================================================= */}
      {aba === "nominal" && (
        <Card className="overflow-hidden border-sus-900/10 shadow-xs">
          <div className="p-3 bg-sand/30 border-b border-sus-900/10 flex items-center justify-between">
            <span className="text-xs font-semibold text-ink/65">
              Exames coletados aguardando faturamento:
            </span>
            <Button
              type="button"
              onClick={faturarNominal}
              disabled={busy || selNominal.length === 0}
              className="!h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Marcar {selNominal.length} como Faturados
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-sus-900/10 bg-sand text-xs uppercase text-sus-900/60">
                  <th className="px-4 py-3 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={selNominal.length > 0 && selNominal.length === listaNominal.length}
                      onChange={todosNominal}
                      className="h-4 w-4 rounded border-sus-900/20 text-teal"
                    />
                  </th>
                  <th className="px-4 py-3 font-semibold">Paciente</th>
                  <th className="px-4 py-3 font-semibold">Procedimento</th>
                  <th className="px-4 py-3 font-semibold">Competência</th>
                  <th className="px-4 py-3 font-semibold">Laboratório</th>
                </tr>
              </thead>
              <tbody>
                {listaNominal.map((s) => (
                  <tr key={s.id} className="border-b border-sus-900/5 last:border-0 hover:bg-sand/30">
                    <td className="px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={selNominal.includes(s.id)}
                        onChange={() => toggleNominal(s.id)}
                        className="h-4 w-4 rounded border-sus-900/20 text-teal"
                      />
                    </td>
                    <td className="px-4 py-3 font-semibold text-sus-950">{s.paciente_nome}</td>
                    <td className="px-4 py-3 text-xs">
                      {s.procedimento_descricao}
                      <p className="text-[11px] font-mono text-ink/50">{s.procedimento_codigo}</p>
                    </td>
                    <td className="px-4 py-3 text-xs">{s.competencia}</td>
                    <td className="px-4 py-3 text-xs text-ink/75">{s.laboratorio}</td>
                  </tr>
                ))}
                {listaNominal.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-ink/45 text-xs">
                      Nenhum exame realizado pronto para faturar nesta competência.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Paginacao
            page={pageNominal}
            pages={pagesNominal}
            total={totalNominal}
            onPage={(p) => carregarNominal(p)}
          />
        </Card>
      )}

      {/* ========================================================================= */}
      {/* MODAL: NOVO / EDITAR CONTRATO                                             */}
      {/* ========================================================================= */}
      {modalContratoAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl border border-sus-900/10 space-y-4">
            <div className="flex items-center justify-between border-b border-sus-900/10 pb-3">
              <h3 className="font-display font-bold text-base text-sus-950">
                {contratoEditando ? "Editar Contrato de Prestador" : "Novo Contrato de Prestador"}
              </h3>
              <button onClick={() => setModalContratoAberto(false)} className="text-ink/40 hover:text-ink">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="col-span-2">
                <Label>Laboratório Conveniado *</Label>
                <Select
                  value={formContrato.laboratorio_id}
                  onChange={(e) => setFormContrato({ ...formContrato, laboratorio_id: e.target.value })}
                >
                  <option value="">Selecione...</option>
                  {labs.map((l) => (
                    <option key={l.id} value={l.id}>{l.nome}</option>
                  ))}
                </Select>
              </div>

              <div>
                <Label>Número do Contrato *</Label>
                <Input
                  value={formContrato.numero_contrato}
                  onChange={(e) => setFormContrato({ ...formContrato, numero_contrato: e.target.value })}
                  placeholder="Ex: 042/2026"
                />
              </div>

              <div>
                <Label>Processo Licitatório</Label>
                <Input
                  value={formContrato.processo_licitatorio}
                  onChange={(e) => setFormContrato({ ...formContrato, processo_licitatorio: e.target.value })}
                  placeholder="Ex: Pregão 015/2026"
                />
              </div>

              <div>
                <Label>Data Início *</Label>
                <Input
                  type="date"
                  value={formContrato.data_inicio}
                  onChange={(e) => setFormContrato({ ...formContrato, data_inicio: e.target.value })}
                />
              </div>

              <div>
                <Label>Data Fim / Término *</Label>
                <Input
                  type="date"
                  value={formContrato.data_fim}
                  onChange={(e) => setFormContrato({ ...formContrato, data_fim: e.target.value })}
                />
              </div>

              <div>
                <Label>Valor Total do Contrato (R$) *</Label>
                <Input
                  type="number"
                  value={formContrato.valor_total_contrato}
                  onChange={(e) => setFormContrato({ ...formContrato, valor_total_contrato: e.target.value })}
                />
              </div>

              <div>
                <Label>Teto Mensal Estimado (R$)</Label>
                <Input
                  type="number"
                  value={formContrato.valor_mensal_teto}
                  onChange={(e) => setFormContrato({ ...formContrato, valor_mensal_teto: e.target.value })}
                />
              </div>

              <div>
                <Label>Cota Exames / Mês</Label>
                <Input
                  type="number"
                  value={formContrato.cota_exames_mensal}
                  onChange={(e) => setFormContrato({ ...formContrato, cota_exames_mensal: e.target.value })}
                />
              </div>

              <div>
                <Label>Gestor / Fiscal do Contrato</Label>
                <Input
                  value={formContrato.gestor_contrato}
                  onChange={(e) => setFormContrato({ ...formContrato, gestor_contrato: e.target.value })}
                />
              </div>

              <div className="col-span-2">
                <Label>Objeto do Contrato</Label>
                <Input
                  value={formContrato.objeto}
                  onChange={(e) => setFormContrato({ ...formContrato, objeto: e.target.value })}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-sus-900/10">
              <Button type="button" onClick={() => setModalContratoAberto(false)} className="bg-white border text-ink">
                Cancelar
              </Button>
              <Button type="button" disabled={busy} onClick={salvarContrato} className="bg-teal text-white font-bold">
                {busy ? "Salvando..." : "Salvar Contrato"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: PREÇOS CUSTOMIZADOS DO CONTRATO                                    */}
      {/* ========================================================================= */}
      {modalPrecosAberto && contratoPrecoSel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl border border-sus-900/10 space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-sus-900/10 pb-3">
              <div>
                <h3 className="font-display font-bold text-base text-sus-950 flex items-center gap-1.5">
                  <Tag className="h-4 w-4 text-teal" /> Preços Customizados · Contrato {contratoPrecoSel.numero_contrato}
                </h3>
                <p className="text-xs text-ink/60">{contratoPrecoSel.laboratorio_nome}</p>
              </div>
              <button onClick={() => setModalPrecosAberto(false)} className="text-ink/40 hover:text-ink">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* ADICIONAR NOVO PREÇO */}
            <div className="p-3 bg-sand/30 border border-sus-900/10 rounded-xl space-y-2">
              <p className="text-xs font-bold text-sus-950">Pactuar Preço Diferenciado de Procedimento</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="sm:col-span-2 relative">
                  <Input
                    placeholder="Buscar exame SIGTAP por nome ou código..."
                    value={buscaProcSigtap}
                    onChange={(e) => pesquisarProcedimentosSigtap(e.target.value)}
                    className="text-xs"
                  />
                  {procsSigtapEncontrados.length > 0 && (
                    <div className="absolute top-full left-0 right-0 z-20 mt-1 max-h-48 overflow-y-auto bg-white border border-sus-900/15 rounded-xl shadow-lg">
                      {procsSigtapEncontrados.map((pr) => (
                        <button
                          key={pr.id}
                          type="button"
                          onClick={() => {
                            setProcSelecionadoPreco(pr);
                            setBuscaProcSigtap(`${pr.codigo} - ${pr.descricao}`);
                            setNovoValorCustom(String(pr.valor_sa || "0.00"));
                            setProcsSigtapEncontrados([]);
                          }}
                          className="w-full text-left px-3 py-1.5 hover:bg-sand text-xs border-b border-sus-900/5 last:border-0"
                        >
                          <span className="font-mono text-ink/50">{pr.codigo}</span> · <span className="font-medium text-sus-950">{pr.descricao}</span>
                          <span className="float-right font-mono text-teal">R$ {pr.valor_sa?.toFixed(2)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <Input
                    placeholder="Valor R$ (ex: 8.50)"
                    value={novoValorCustom}
                    onChange={(e) => setNovoValorCustom(e.target.value)}
                    className="text-xs font-mono font-bold"
                  />
                </div>
              </div>

              {procSelecionadoPreco && (
                <div className="flex items-center justify-between text-xs pt-1">
                  <span className="text-ink/65">
                    Valor SIGTAP oficial: <strong className="font-mono">R$ {procSelecionadoPreco.valor_sa?.toFixed(2)}</strong>
                  </span>
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={salvarPrecoCustomizado}
                    className="!h-7 bg-teal text-white text-xs font-bold"
                  >
                    Salvar Preço Negociado
                  </Button>
                </div>
              )}
            </div>

            {/* LISTA DE PREÇOS ATIVOS */}
            <div className="overflow-y-auto flex-1 border border-sus-900/10 rounded-xl">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-sand text-[11px] uppercase text-sus-900/60 sticky top-0">
                    <th className="px-3 py-2 font-semibold">Código</th>
                    <th className="px-3 py-2 font-semibold">Procedimento</th>
                    <th className="px-3 py-2 font-semibold text-right">SIGTAP SUS</th>
                    <th className="px-3 py-2 font-semibold text-right">Valor Contratual</th>
                    <th className="px-3 py-2 font-semibold text-center">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {precosContrato.map((p) => (
                    <tr key={p.id} className="border-b border-sus-900/5 hover:bg-sand/20">
                      <td className="px-3 py-2 font-mono">{p.codigo_sigtap}</td>
                      <td className="px-3 py-2 font-medium text-sus-950">{p.descricao_procedimento}</td>
                      <td className="px-3 py-2 text-right font-mono text-ink/50">
                        {p.valor_sigtap_padrao.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-bold text-teal">
                        {p.valor_customizado.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => removerPrecoCustomizado(p.id)}
                          className="text-red-600 hover:text-red-800 p-1"
                          title="Remover preço contratual (restaura valor SIGTAP)"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {precosContrato.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-ink/40">
                        Nenhum procedimento com preço diferenciado. Todos seguem a tabela SIGTAP oficial.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: EXTRATO COMPLETO DE PACIENTE (BI)                                  */}
      {/* ========================================================================= */}
      {modalExtratoAberto && extratoPacienteBi && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl border border-sus-900/10 space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-sus-900/10 pb-3">
              <div>
                <h3 className="font-display font-bold text-base text-sus-950">
                  {extratoPacienteBi.paciente_nome}
                </h3>
                <p className="text-xs text-ink/60">
                  CPF: {extratoPacienteBi.paciente_cpf || "—"} · CNS: {extratoPacienteBi.paciente_cns || "—"}
                </p>
              </div>
              <button onClick={() => setModalExtratoAberto(false)} className="text-ink/40 hover:text-ink">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex items-center justify-between p-3 bg-teal/10 border border-teal/20 rounded-xl">
              <div>
                <p className="text-[11px] font-bold uppercase text-teal">Recursos Municipais Consumidos</p>
                <p className="text-lg font-bold font-mono text-teal">
                  {extratoPacienteBi.total_gasto.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-bold uppercase text-ink/50">Total de Exames</p>
                <p className="text-lg font-bold text-sus-950">{extratoPacienteBi.qtd_exames}</p>
              </div>
            </div>

            <div className="overflow-y-auto flex-1 border border-sus-900/10 rounded-xl">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-sand text-[11px] uppercase text-sus-900/60 sticky top-0">
                    <th className="px-3 py-2 font-semibold">Data</th>
                    <th className="px-3 py-2 font-semibold">Laboratório</th>
                    <th className="px-3 py-2 font-semibold">Exame / Procedimento</th>
                    <th className="px-3 py-2 font-semibold text-right">Valor Unitário</th>
                  </tr>
                </thead>
                <tbody>
                  {extratoPacienteBi.itens.map((it, idx) => (
                    <tr key={idx} className="border-b border-sus-900/5 hover:bg-sand/20">
                      <td className="px-3 py-2 font-mono whitespace-nowrap">{it.data_agendada}</td>
                      <td className="px-3 py-2 text-ink/75">{it.laboratorio_nome}</td>
                      <td className="px-3 py-2 font-medium text-sus-950">
                        {it.procedimento_descricao}
                        <span className="block text-[10px] font-mono text-ink/40">{it.procedimento_codigo}</span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-bold text-teal">
                        {it.valor_unitario.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: PROGRAMAÇÃO FPO                                                    */}
      {/* ========================================================================= */}
      {modalFpoAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-sus-900/10 space-y-4">
            <div className="flex items-center justify-between border-b border-sus-900/10 pb-3">
              <h3 className="font-display font-bold text-base text-sus-950">Cadastrar Programação FPO</h3>
              <button onClick={() => setModalFpoAberto(false)} className="text-ink/40 hover:text-ink">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <Label>Laboratório / Prestador</Label>
                <Select
                  value={formFpo.laboratorio_id}
                  onChange={(e) => setFormFpo({ ...formFpo, laboratorio_id: e.target.value })}
                >
                  <option value="">Selecione...</option>
                  {labs.map((l) => (
                    <option key={l.id} value={l.id}>{l.nome}</option>
                  ))}
                </Select>
              </div>

              <div>
                <Label>CNES do Prestador</Label>
                <Input
                  value={formFpo.cnes_prestador}
                  onChange={(e) => setFormFpo({ ...formFpo, cnes_prestador: e.target.value })}
                  placeholder="Ex: 2760814"
                />
              </div>

              <div>
                <Label>Número da FPO</Label>
                <Input
                  value={formFpo.numero_fpo}
                  onChange={(e) => setFormFpo({ ...formFpo, numero_fpo: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Teto Físico (Qtd)</Label>
                  <Input
                    type="number"
                    value={formFpo.teto_fisico_programado}
                    onChange={(e) => setFormFpo({ ...formFpo, teto_fisico_programado: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Teto Financeiro (R$)</Label>
                  <Input
                    type="number"
                    value={formFpo.teto_financeiro_programado}
                    onChange={(e) => setFormFpo({ ...formFpo, teto_financeiro_programado: e.target.value })}
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-sus-900/10">
              <Button type="button" onClick={() => setModalFpoAberto(false)} className="bg-white border text-ink">
                Cancelar
              </Button>
              <Button type="button" disabled={busy} onClick={salvarFpo} className="bg-teal text-white font-bold">
                {busy ? "Salvando..." : "Salvar FPO"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
