import React, { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Calendar,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Coins,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Ticket,
  User,
  Users,
  Wallet,
  X,
} from "lucide-react";
import {
  labBaixarArtefato,
  labCalcularPreviaLote,
  labConsolidarLote,
  labDefinirOrcamento,
  labListarLotes,
  labListarOrcamentos,
  labObterLote,
  labObterOrcamento,
  labsListar,
  type LabLote,
  type LabLotePrevia,
  type LabOrcamento,
  type Laboratorio,
} from "../../services/api";
import { Button, Card, Input, Label, Select } from "../../components/ui/primitives";
import { useAuth } from "../../hooks/useAuth";

function getMesAtualIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function fmtMoeda(val: number | undefined | null): string {
  if (val === undefined || val === null || isNaN(val)) return "R$ 0,00";
  return val.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtDataBr(iso?: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

export default function LabOrcamentoLotes() {
  const { user } = useAuth();
  const [competencia, setCompetencia] = useState<string>(getMesAtualIso());
  const [orcamento, setOrcamento] = useState<LabOrcamento | null>(null);
  const [lotes, setLotes] = useState<LabLote[]>([]);
  const [laboratorios, setLaboratorios] = useState<Laboratorio[]>([]);
  const [carregando, setCarregando] = useState<boolean>(true);
  const [erroMsg, setErroMsg] = useState<string>("");

  // Modal Definir Orçamento
  const [modalOrcamentoAberto, setModalOrcamentoAberto] = useState<boolean>(false);
  const [valorTetoInput, setValorTetoInput] = useState<string>("");
  const [obsOrcamentoInput, setObsOrcamentoInput] = useState<string>("");
  const [salvandoOrcamento, setSalvandoOrcamento] = useState<boolean>(false);

  // Modal Assistente de Lançamento em Lote (Wizard)
  const [wizardAberto, setWizardAberto] = useState<boolean>(false);
  const [etapaWizard, setEtapaWizard] = useState<1 | 2 | 3 | 4>(1);

  // Estado do Formulário do Wizard
  const [formLabId, setFormLabId] = useState<number>(0);
  const [formValor, setFormValor] = useState<string>("");
  const [formDatas, setFormDatas] = useState<string[]>([]);
  const [novaDataInput, setNovaDataInput] = useState<string>("");
  const [dataInicioIntervalo, setDataInicioIntervalo] = useState<string>("");
  const [dataFimIntervalo, setDataFimIntervalo] = useState<string>("");
  const [pularFinsSemana, setPularFinsSemana] = useState<boolean>(true);
  const [formHora, setFormHora] = useState<string>("07:00");
  const [formObs, setFormObs] = useState<string>("");

  // Prévia e Consolidação
  const [calculandoPrevia, setCalculandoPrevia] = useState<boolean>(false);
  const [previaResultado, setPreviaResultado] = useState<LabLotePrevia | null>(null);
  const [consolidandoLote, setConsolidandoLote] = useState<boolean>(false);
  const [loteSucesso, setLoteSucesso] = useState<LabLote | null>(null);

  // Modal Visualizar Detalhes do Lote
  const [loteDetalhe, setLoteDetalhe] = useState<LabLote | null>(null);
  const [carregandoDetalhe, setCarregandoDetalhe] = useState<boolean>(false);

  // Carrega dados iniciais
  const carregarDados = async (comp: string) => {
    setCarregando(true);
    setErroMsg("");
    try {
      const [labsRes, lotesRes] = await Promise.all([
        labsListar(true),
        labListarLotes(comp),
      ]);
      setLaboratorios(labsRes);
      setLotes(lotesRes);

      try {
        const orcRes = await labObterOrcamento(comp);
        setOrcamento(orcRes);
      } catch (err: any) {
        // Se 404, não há orçamento ainda
        setOrcamento(null);
      }
    } catch (e: any) {
      setErroMsg("Falha ao carregar informações de orçamento e lotes.");
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregarDados(competencia);
  }, [competencia]);

  // Navegação de mês
  const navegarMes = (delta: number) => {
    const [yStr, mStr] = competencia.split("-");
    const d = new Date(parseInt(yStr, 10), parseInt(mStr, 10) - 1 + delta, 1);
    const novoY = d.getFullYear();
    const novoM = String(d.getMonth() + 1).padStart(2, "0");
    setCompetencia(`${novoY}-${novoM}`);
  };

  // Salvar Orçamento Mensal
  const handleSalvarOrcamento = async (e: React.FormEvent) => {
    e.preventDefault();
    const num = parseFloat(valorTetoInput.replace(",", "."));
    if (isNaN(num) || num < 0) {
      alert("Informe um valor numérico válido para o teto financeiro.");
      return;
    }
    setSalvandoOrcamento(true);
    try {
      const salvo = await labDefinirOrcamento({
        competencia,
        teto_mensal: num,
        observacoes: obsOrcamentoInput,
      });
      setOrcamento(salvo);
      setModalOrcamentoAberto(false);
      setValorTetoInput("");
      setObsOrcamentoInput("");
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Erro ao salvar teto mensal.");
    } finally {
      setSalvandoOrcamento(false);
    }
  };

  // Abrir Wizard
  const handleAbrirWizard = () => {
    setWizardAberto(true);
    setEtapaWizard(1);
    setFormLabId(laboratorios[0]?.id || 0);
    setFormValor("");
    setFormDatas([]);
    setNovaDataInput("");
    setDataInicioIntervalo("");
    setDataFimIntervalo("");
    setFormHora("07:00");
    setFormObs("");
    setPreviaResultado(null);
    setLoteSucesso(null);
  };

  // Adicionar data única
  const handleAdicionarData = () => {
    if (!novaDataInput) return;
    if (formDatas.includes(novaDataInput)) {
      alert("Esta data já foi adicionada.");
      return;
    }
    const novas = [...formDatas, novaDataInput].sort();
    setFormDatas(novas);
    setNovaDataInput("");
  };

  // Adicionar intervalo de datas
  const handleAdicionarIntervalo = () => {
    if (!dataInicioIntervalo || !dataFimIntervalo) {
      alert("Selecione data de início e data de fim.");
      return;
    }
    if (dataInicioIntervalo > dataFimIntervalo) {
      alert("Data de início não pode ser posterior à data de fim.");
      return;
    }
    const inicio = new Date(dataInicioIntervalo + "T00:00:00");
    const fim = new Date(dataFimIntervalo + "T00:00:00");
    const datasGeradas: string[] = [];

    const cursor = new Date(inicio);
    while (cursor <= fim) {
      const diaSemana = cursor.getDay(); // 0 = Dom, 6 = Sáb
      if (!pularFinsSemana || (diaSemana !== 0 && diaSemana !== 6)) {
        const y = cursor.getFullYear();
        const m = String(cursor.getMonth() + 1).padStart(2, "0");
        const d = String(cursor.getDate()).padStart(2, "0");
        datasGeradas.push(`${y}-${m}-${d}`);
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    const uniao = Array.from(new Set([...formDatas, ...datasGeradas])).sort();
    setFormDatas(uniao);
  };

  // Remover data selecionada
  const handleRemoverData = (dataParaRemover: string) => {
    setFormDatas(formDatas.filter((d) => d !== dataParaRemover));
  };

  // Passo 1 -> Passo 2: Calcular Prévia do Lote
  const handleCalcularPrevia = async () => {
    if (!formLabId) {
      alert("Selecione o laboratório conveniado.");
      return;
    }
    const vLim = parseFloat(formValor.replace(",", "."));
    if (isNaN(vLim) || vLim <= 0) {
      alert("Informe um valor limite válido maior que zero.");
      return;
    }
    if (formDatas.length === 0) {
      alert("Adicione ao menos uma data de agendamento.");
      return;
    }

    setCalculandoPrevia(true);
    try {
      const res = await labCalcularPreviaLote({
        competencia,
        laboratorio_id: formLabId,
        valor_limite: vLim,
        datas_agendamento: formDatas,
        hora_padrao: formHora || "07:00",
      });
      setPreviaResultado(res);
      setEtapaWizard(2);
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Erro ao calcular prévia do lote.");
    } finally {
      setCalculandoPrevia(false);
    }
  };

  // Passo 4: Confirmar Consolidação Atômica
  const handleConfirmarConsolidacao = async () => {
    if (!previaResultado) return;
    if (previaResultado.bloqueado) {
      alert("Não é possível consolidar o lote enquanto houver bloqueios ou déficit de vagas.");
      return;
    }
    const filaIds = previaResultado.pacientes.map((p) => p.fila_id);
    setConsolidandoLote(true);
    try {
      const loteCriado = await labConsolidarLote({
        competencia,
        laboratorio_id: formLabId,
        valor_solicitado: previaResultado.valor_solicitado,
        datas_agendamento: formDatas,
        hora_padrao: formHora || "07:00",
        fila_ids_confirmados: filaIds,
        observacoes: formObs,
      });
      setLoteSucesso(loteCriado);
      setEtapaWizard(4);
      carregarDados(competencia);
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Erro ao consolidar lote atômico.");
    } finally {
      setConsolidandoLote(false);
    }
  };

  // Download de artefatos
  const handleBaixarArtefato = async (loteId: number, tipo: "comprovantes_zip" | "relatorio_xlsx", nomeFallback: string) => {
    try {
      const blob = await labBaixarArtefato(loteId, tipo);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nomeFallback;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert("Falha ao baixar o arquivo.");
    }
  };

  // Abrir detalhes de um lote
  const handleVerDetalhesLote = async (id: number) => {
    setCarregandoDetalhe(true);
    try {
      const l = await labObterLote(id);
      setLoteDetalhe(l);
    } catch (e) {
      alert("Falha ao carregar detalhes do lote.");
    } finally {
      setCarregandoDetalhe(false);
    }
  };

  // Render do Card de Saldo
  const saldoCor = useMemo(() => {
    if (!orcamento) return "text-slate-600";
    if (orcamento.saldo_disponivel <= 0) return "text-rose-600";
    if (orcamento.percentual_consumido > 80) return "text-amber-600";
    return "text-emerald-700";
  }, [orcamento]);

  return (
    <div className="space-y-6">
      {/* Header com Navegação de Competência e Ações Principais */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-display flex items-center gap-2">
            <Coins className="h-7 w-7 text-teal" />
            Controle de Orçamento e Lotes de Exames
          </h1>
          <p className="mt-1 text-sm text-ink/70">
            Definição do teto financeiro mensal, cálculo prioritário da fila por SIGTAP e agendamento atômico com distribuição de cotas.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Seletor de Competência (Mês/Ano) */}
          <div className="flex items-center rounded-xl border border-sus-900/15 bg-white p-1 shadow-xs">
            <button
              onClick={() => navegarMes(-1)}
              className="rounded-lg p-1.5 text-sus-900 hover:bg-sus-50 transition"
              title="Mês anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-3 text-sm font-bold font-mono text-sus-950">
              {competencia}
            </span>
            <button
              onClick={() => navegarMes(1)}
              className="rounded-lg p-1.5 text-sus-900 hover:bg-sus-50 transition"
              title="Próximo mês"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <Button
            variant="outline"
            onClick={() => {
              setValorTetoInput(orcamento?.teto_mensal ? String(orcamento.teto_mensal) : "");
              setObsOrcamentoInput(orcamento?.observacoes || "");
              setModalOrcamentoAberto(true);
            }}
            className="flex items-center gap-1.5"
          >
            <Wallet className="h-4 w-4 text-teal" />
            {orcamento ? "Ajustar Teto Mensal" : "Definir Teto Mensal"}
          </Button>

          <Button
            onClick={handleAbrirWizard}
            className="flex items-center gap-2 bg-teal hover:bg-teal-700 text-white shadow-xs"
          >
            <Plus className="h-4 w-4" />
            Novo Lote de Exames
          </Button>
        </div>
      </div>

      {erroMsg && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-sm text-rose-800 flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-rose-600 shrink-0" />
          <span>{erroMsg}</span>
        </div>
      )}

      {/* Cards de Indicadores do Mês */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* Card 1: Teto Mensal */}
        <Card className="p-5 border-sus-900/10 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-ink/60 uppercase tracking-wider">
              Teto Mensal ({competencia})
            </span>
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-teal/10 text-teal">
              <Coins className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 text-2xl font-bold font-mono text-slate-900">
            {orcamento ? fmtMoeda(orcamento.teto_mensal) : "Não definido"}
          </div>
          <div className="mt-2 text-xs text-ink/60 flex items-center gap-1">
            {orcamento ? (
              <span>Atualizado por: {orcamento.atualizado_por || "Secretaria de Saúde"}</span>
            ) : (
              <span className="text-amber-700 font-medium">Defina um teto para controlar a liberação</span>
            )}
          </div>
        </Card>

        {/* Card 2: Valor Consumido */}
        <Card className="p-5 border-sus-900/10 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-ink/60 uppercase tracking-wider">
              Valor Já Consumido
            </span>
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-sky-100 text-sky-800">
              <Layers className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 text-2xl font-bold font-mono text-slate-900">
            {fmtMoeda(orcamento?.valor_consumido || 0)}
          </div>
          <div className="mt-2">
            <div className="flex items-center justify-between text-xs text-ink/60 mb-1">
              <span>{orcamento?.lotes_count || lotes.length} lote(s) consolidado(s)</span>
              <span className="font-semibold">{orcamento?.percentual_consumido || 0}%</span>
            </div>
            <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-teal transition-all duration-500"
                style={{ width: `${Math.min(100, orcamento?.percentual_consumido || 0)}%` }}
              />
            </div>
          </div>
        </Card>

        {/* Card 3: Saldo Disponível */}
        <Card className="p-5 border-sus-900/10 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-ink/60 uppercase tracking-wider">
              Saldo Orçamentário Restante
            </span>
            <div className={`grid h-8 w-8 place-items-center rounded-lg ${
              (orcamento?.saldo_disponivel || 0) > 0 ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
            }`}>
              <Wallet className="h-4 w-4" />
            </div>
          </div>
          <div className={`mt-3 text-2xl font-bold font-mono ${saldoCor}`}>
            {orcamento ? fmtMoeda(orcamento.saldo_disponivel) : "—"}
          </div>
          <div className="mt-2 text-xs text-ink/60">
            {orcamento && orcamento.saldo_disponivel <= 0 ? (
              <span className="text-rose-600 font-semibold">Teto financeiro atingido</span>
            ) : orcamento ? (
              <span>Disponível para novos lançamentos</span>
            ) : (
              <span>Aguardando teto</span>
            )}
          </div>
        </Card>
      </div>

      {/* Histórico de Lotes do Mês */}
      <Card className="overflow-hidden border-sus-900/10 shadow-xs">
        <div className="border-b border-sus-900/10 bg-sus-50/50 p-4 sm:flex sm:items-center sm:justify-between">
          <div>
            <h3 className="font-semibold text-slate-900 flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-teal" />
              Lotes Liberados na Competência ({competencia})
            </h3>
            <p className="text-xs text-ink/60 mt-0.5">
              Histórico com relatórios, comprovantes de agendamento e prestação de contas.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => carregarDados(competencia)}
            className="mt-2 sm:mt-0 flex items-center gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Atualizar
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-700">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold uppercase text-slate-600">
              <tr>
                <th className="px-4 py-3">Código do Lote</th>
                <th className="px-4 py-3">Data/Hora Emissão</th>
                <th className="px-4 py-3">Laboratório</th>
                <th className="px-4 py-3 text-center">Pacientes</th>
                <th className="px-4 py-3 text-center">Exames</th>
                <th className="px-4 py-3 text-right">Valor Consumido</th>
                <th className="px-4 py-3">Criado Por</th>
                <th className="px-4 py-3 text-right">Downloads / Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {carregando ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-sm text-ink/60">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-teal mb-2" />
                    Carregando lotes de exames...
                  </td>
                </tr>
              ) : lotes.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-sm text-ink/50">
                    Nenhum lote liberado nesta competência. Clique em "Novo Lote de Exames" para iniciar.
                  </td>
                </tr>
              ) : (
                lotes.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-4 py-3 font-mono font-bold text-sus-950">
                      <span className="bg-sus-900/10 px-2 py-0.5 rounded text-xs">
                        {l.codigo_lote}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-ink/70">
                      {new Date(l.created_at).toLocaleString("pt-BR")}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {l.laboratorio_nome}
                    </td>
                    <td className="px-4 py-3 text-center font-bold text-slate-900">
                      {l.qtd_pacientes}
                    </td>
                    <td className="px-4 py-3 text-center text-xs">
                      {l.qtd_exames}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-teal">
                      {fmtMoeda(l.valor_consumido)}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink/60 truncate max-w-xs">
                      {l.criado_por || "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* Download Comprovantes ZIP */}
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 px-2 text-xs border-emerald-300 text-emerald-800 hover:bg-emerald-50"
                          title="Baixar ZIP com Comprovantes de Todos os Pacientes"
                          onClick={() => handleBaixarArtefato(l.id, "comprovantes_zip", l.arquivo_comprovantes_nome || `comprovantes_${l.codigo_lote}.zip`)}
                        >
                          <Download className="h-3.5 w-3.5 mr-1 text-emerald-700" />
                          Comprovantes (.ZIP)
                        </Button>

                        {/* Download Excel XLSX */}
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 px-2 text-xs border-sky-300 text-sky-800 hover:bg-sky-50"
                          title="Baixar Relatório em Planilha Excel"
                          onClick={() => handleBaixarArtefato(l.id, "relatorio_xlsx", l.arquivo_excel_nome || `relatorio_${l.codigo_lote}.xlsx`)}
                        >
                          <FileSpreadsheet className="h-3.5 w-3.5 mr-1 text-sky-700" />
                          Planilha (.XLSX)
                        </Button>

                        {/* Ver Detalhes */}
                        <button
                          onClick={() => handleVerDetalhesLote(l.id)}
                          className="p-1.5 rounded-lg text-slate-600 hover:bg-slate-100 transition"
                          title="Visualizar detalhes do lote"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ==================================================================== */}
      {/* MODAL DEFINIR ORÇAMENTO MENSAL */}
      {/* ==================================================================== */}
      {modalOrcamentoAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <h3 className="font-bold text-lg text-slate-900 flex items-center gap-2">
                <Coins className="h-5 w-5 text-teal" />
                Definir Teto Financeiro Mensal
              </h3>
              <button
                onClick={() => setModalOrcamentoAberto(false)}
                className="p-1 rounded-lg text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSalvarOrcamento} className="mt-4 space-y-4">
              <div>
                <Label>Competência Alvo (Mês/Ano)</Label>
                <Input value={competencia} disabled className="bg-slate-100 font-mono font-bold" />
              </div>

              <div>
                <Label htmlFor="tetoInput">Teto Orçamentário Máximo (R$) *</Label>
                <div className="relative mt-1">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">
                    R$
                  </span>
                  <Input
                    id="tetoInput"
                    placeholder="Ex: 5000,00"
                    value={valorTetoInput}
                    onChange={(e) => setValorTetoInput(e.target.value)}
                    className="pl-10 font-mono font-bold text-base"
                    required
                    autoFocus
                  />
                </div>
                <p className="mt-1 text-xs text-ink/60">
                  Limite financeiro estipulado pela Secretaria para a liberação de exames laboratoriais neste mês.
                </p>
              </div>

              <div>
                <Label htmlFor="obsInput">Observações ou Justificativa Administrativa</Label>
                <textarea
                  id="obsInput"
                  rows={2}
                  value={obsOrcamentoInput}
                  onChange={(e) => setObsOrcamentoInput(e.target.value)}
                  placeholder="Ex: Dotação orçamentária Q4 / Contrato vigente com Laboratório"
                  className="w-full rounded-xl border border-sus-900/15 p-2.5 text-sm outline-none focus:border-teal"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setModalOrcamentoAberto(false)}
                  disabled={salvandoOrcamento}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={salvandoOrcamento} className="bg-teal hover:bg-teal-700 text-white">
                  {salvandoOrcamento ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                  Salvar Teto Mensal
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL WIZARD: ASSISTENTE DE LANÇAMENTO EM LOTE */}
      {/* ==================================================================== */}
      {wizardAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 overflow-y-auto">
          <div className="w-full max-w-4xl rounded-2xl bg-white shadow-2xl border border-slate-200 flex flex-col max-h-[90vh] my-auto">
            {/* Cabeçalho do Wizard */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/70 rounded-t-2xl">
              <div>
                <h3 className="font-bold text-lg text-slate-900 flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-teal" />
                  Assistente de Lançamento em Lote de Exames
                </h3>
                <p className="text-xs text-ink/60 mt-0.5">
                  Competência: <strong>{competencia}</strong> · Saldo disponível:{" "}
                  <strong className={saldoCor}>{orcamento ? fmtMoeda(orcamento.saldo_disponivel) : "Sem teto"}</strong>
                </p>
              </div>
              <button
                onClick={() => setWizardAberto(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Stepper Visual */}
            <div className="grid grid-cols-4 border-b border-slate-200 bg-white text-xs font-semibold text-center">
              <div className={`p-3 flex items-center justify-center gap-1.5 border-b-2 ${
                etapaWizard === 1 ? "border-teal text-teal font-bold bg-teal/5" : "border-transparent text-slate-500"
              }`}>
                <span className="grid h-5 w-5 place-items-center rounded-full bg-current text-[10px] text-white font-bold">1</span>
                Configuração
              </div>
              <div className={`p-3 flex items-center justify-center gap-1.5 border-b-2 ${
                etapaWizard === 2 ? "border-teal text-teal font-bold bg-teal/5" : "border-transparent text-slate-500"
              }`}>
                <span className="grid h-5 w-5 place-items-center rounded-full bg-current text-[10px] text-white font-bold">2</span>
                Cálculo & Fila
              </div>
              <div className={`p-3 flex items-center justify-center gap-1.5 border-b-2 ${
                etapaWizard === 3 ? "border-teal text-teal font-bold bg-teal/5" : "border-transparent text-slate-500"
              }`}>
                <span className="grid h-5 w-5 place-items-center rounded-full bg-current text-[10px] text-white font-bold">3</span>
                Cotas de Vagas
              </div>
              <div className={`p-3 flex items-center justify-center gap-1.5 border-b-2 ${
                etapaWizard === 4 ? "border-teal text-teal font-bold bg-teal/5" : "border-transparent text-slate-500"
              }`}>
                <span className="grid h-5 w-5 place-items-center rounded-full bg-current text-[10px] text-white font-bold">4</span>
                Confirmação
              </div>
            </div>

            {/* Corpo do Wizard por Etapa */}
            <div className="p-6 overflow-y-auto flex-1 space-y-5">
              {/* ETAPA 1: CONFIGURAÇÃO */}
              {etapaWizard === 1 && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <Label>Laboratório Conveniado *</Label>
                      <Select
                        value={String(formLabId)}
                        onChange={(e) => setFormLabId(parseInt(e.target.value, 10))}
                        className="mt-1"
                      >
                        {laboratorios.map((lab) => (
                          <option key={lab.id} value={lab.id}>
                            {lab.nome}
                          </option>
                        ))}
                      </Select>
                    </div>

                    <div>
                      <Label>Valor a Liberar neste Lote (R$) *</Label>
                      <div className="relative mt-1">
                        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">
                          R$
                        </span>
                        <Input
                          placeholder="Ex: 1000,00"
                          value={formValor}
                          onChange={(e) => setFormValor(e.target.value)}
                          className="pl-10 font-mono font-bold"
                        />
                      </div>
                      {orcamento && (
                        <p className="mt-1 text-xs text-ink/60">
                          Saldo mensal disponível: <strong>{fmtMoeda(orcamento.saldo_disponivel)}</strong>
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Seleção de Datas de Agendamento */}
                  <div className="rounded-xl border border-sus-900/10 p-4 bg-slate-50/50 space-y-3">
                    <Label className="flex items-center gap-2 text-slate-900 font-semibold">
                      <CalendarDays className="h-4 w-4 text-teal" />
                      Datas de Coleta e Agendamento
                    </Label>

                    {/* Modo 1: Intervalo de Datas */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
                      <div>
                        <span className="text-xs text-slate-500 block mb-1">De:</span>
                        <Input
                          type="date"
                          value={dataInicioIntervalo}
                          onChange={(e) => setDataInicioIntervalo(e.target.value)}
                          className="h-9 text-xs"
                        />
                      </div>
                      <div>
                        <span className="text-xs text-slate-500 block mb-1">Até:</span>
                        <Input
                          type="date"
                          value={dataFimIntervalo}
                          onChange={(e) => setDataFimIntervalo(e.target.value)}
                          className="h-9 text-xs"
                        />
                      </div>
                      <div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={handleAdicionarIntervalo}
                          className="w-full h-9 text-xs"
                        >
                          Adicionar Intervalo
                        </Button>
                      </div>
                    </div>

                    {/* Modo 2: Data específica avulsa */}
                    <div className="flex items-center gap-2 pt-2 border-t border-slate-200/60">
                      <div className="flex-1">
                        <span className="text-xs text-slate-500 block mb-1">Ou adicione dia específico:</span>
                        <Input
                          type="date"
                          value={novaDataInput}
                          onChange={(e) => setNovaDataInput(e.target.value)}
                          className="h-9 text-xs"
                        />
                      </div>
                      <div className="pt-5">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={handleAdicionarData}
                          className="h-9 text-xs"
                        >
                          Adicionar Dia
                        </Button>
                      </div>
                    </div>

                    {/* Chips de datas selecionadas */}
                    <div className="pt-2">
                      <span className="text-xs font-semibold text-slate-600 block mb-1.5">
                        Datas Selecionadas ({formDatas.length}):
                      </span>
                      {formDatas.length === 0 ? (
                        <p className="text-xs text-rose-600 font-medium italic">
                          Nenhuma data adicionada ainda.
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-1 bg-white rounded-lg border border-slate-200">
                          {formDatas.map((d) => (
                            <span
                              key={d}
                              className="inline-flex items-center gap-1 rounded-md bg-teal/10 px-2 py-1 text-xs font-mono font-semibold text-teal border border-teal/20"
                            >
                              {fmtDataBr(d)}
                              <button
                                type="button"
                                onClick={() => handleRemoverData(d)}
                                className="text-teal hover:text-rose-600"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <Label>Horário Padrão de Recepção/Coleta</Label>
                      <Input
                        type="time"
                        value={formHora}
                        onChange={(e) => setFormHora(e.target.value)}
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label>Observações do Lote (Opcional)</Label>
                      <Input
                        placeholder="Ex: Liberação prioritária para pacientes do PSF Centro"
                        value={formObs}
                        onChange={(e) => setFormObs(e.target.value)}
                        className="mt-1"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* ETAPA 2: PROCESSAMENTO E CÁLCULO DA FILA */}
              {etapaWizard === 2 && previaResultado && (
                <div className="space-y-4">
                  {/* Resumo Financeiro da Prévia */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs">
                    <div>
                      <span className="text-slate-500 block">Valor Solicitado:</span>
                      <strong className="text-sm font-mono text-slate-900">{fmtMoeda(previaResultado.valor_solicitado)}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Total Calculado (SIGTAP):</span>
                      <strong className="text-sm font-mono text-teal">{fmtMoeda(previaResultado.valor_consumido_estimado)}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Pacientes Contemplados:</span>
                      <strong className="text-sm text-slate-900">{previaResultado.total_pacientes_contemplados}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Total de Exames:</span>
                      <strong className="text-sm text-slate-900">{previaResultado.total_exames_contemplados}</strong>
                    </div>
                  </div>

                  {previaResultado.motivos_bloqueio.length > 0 && (
                    <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-1">
                      <div className="font-bold flex items-center gap-1.5">
                        <AlertTriangle className="h-4 w-4 text-amber-700" />
                        Avisos e Restrições Detectadas:
                      </div>
                      <ul className="list-disc pl-5 space-y-0.5">
                        {previaResultado.motivos_bloqueio.map((m, idx) => (
                          <li key={idx}>{m}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Tabela de Pacientes Contemplados */}
                  <div>
                    <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                      Fila Prioritária Selecionada (Ordenação Cronológica e Clínica):
                    </h4>
                    <div className="max-h-72 overflow-y-auto border border-slate-200 rounded-xl">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-100 border-b border-slate-200 font-semibold text-slate-700 sticky top-0">
                          <tr>
                            <th className="px-3 py-2">Prontuário / Paciente</th>
                            <th className="px-3 py-2">Prioridade</th>
                            <th className="px-3 py-2">Data Solicitação</th>
                            <th className="px-3 py-2">Dia Alocado</th>
                            <th className="px-3 py-2">Procedimentos SIGTAP</th>
                            <th className="px-3 py-2 text-right">Custo Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {previaResultado.pacientes.map((p) => (
                            <tr key={p.fila_id} className="hover:bg-slate-50">
                              <td className="px-3 py-2 font-medium">
                                <div className="font-semibold text-slate-900">{p.paciente_nome}</div>
                                <div className="text-[11px] text-slate-500 font-mono">
                                  {p.paciente_prontuario} · CPF: {p.paciente_cpf || "—"}
                                </div>
                              </td>
                              <td className="px-3 py-2">
                                <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${
                                  p.prioridade === "urgente"
                                    ? "bg-rose-100 text-rose-800"
                                    : p.prioridade === "alta"
                                    ? "bg-amber-100 text-amber-800"
                                    : "bg-slate-100 text-slate-700"
                                }`}>
                                  {p.prioridade.toUpperCase()}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-slate-600">
                                {fmtDataBr(p.data_solicitacao)}
                              </td>
                              <td className="px-3 py-2 font-mono font-semibold text-teal">
                                {fmtDataBr(p.data_agendada_sugerida || "")}
                              </td>
                              <td className="px-3 py-2 max-w-xs truncate text-[11px] text-slate-600">
                                {p.procedimentos.map((pr) => pr.descricao).join(", ")}
                              </td>
                              <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">
                                {fmtMoeda(p.valor_total)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* ETAPA 3: REVISÃO E ALERTAS DE VAGAS */}
              {etapaWizard === 3 && previaResultado && (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                    <h4 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                      <Ticket className="h-4 w-4 text-teal" />
                      Cruzamento de Pacientes com Cotas de Vagas do Laboratório
                    </h4>
                    <p className="text-xs text-ink/70 mt-1">
                      O sistema distribui os {previaResultado.total_pacientes_contemplados} pacientes entre as datas selecionadas e verifica a disponibilidade de vagas.
                    </p>
                  </div>

                  {/* Alerta de Déficit de Vagas (Bloqueante) */}
                  {previaResultado.tem_deficit_vagas ? (
                    <div className="p-4 rounded-xl bg-rose-50 border border-rose-300 text-rose-900 space-y-2">
                      <div className="flex items-center gap-2 font-bold text-sm text-rose-800">
                        <AlertCircle className="h-5 w-5 text-rose-600 shrink-0" />
                        Bloqueio: Faltam vagas para alocar todos os exames selecionados
                      </div>
                      <p className="text-xs">
                        Déficit total identificado: <strong>{previaResultado.deficit_total_vagas} vaga(s)</strong>.
                        O agendamento atômico não pode ser confirmado até que haja cotas suficientes em todas as datas.
                      </p>
                      <div className="text-xs bg-white/70 p-2.5 rounded-lg border border-rose-200">
                        <strong>Ação sugerida:</strong> {previaResultado.sugestao_acao}
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 flex items-center gap-3">
                      <CheckCircle2 className="h-6 w-6 text-emerald-600 shrink-0" />
                      <div className="text-xs">
                        <div className="font-bold text-sm">Cotas de Vagas Validadas com Sucesso!</div>
                        Todas as datas possuem vagas suficientes para a alocação dos exames.
                      </div>
                    </div>
                  )}

                  {/* Tabela de Distribuição Diária */}
                  <div className="overflow-x-auto border border-slate-200 rounded-xl">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-100 border-b border-slate-200 font-semibold text-slate-700">
                        <tr>
                          <th className="px-3 py-2.5">Data Agendada</th>
                          <th className="px-3 py-2.5 text-center">Pacientes Alocados</th>
                          <th className="px-3 py-2.5 text-right">Custo do Dia</th>
                          <th className="px-3 py-2.5 text-center">Vagas Totais</th>
                          <th className="px-3 py-2.5 text-center">Vagas Ocupadas</th>
                          <th className="px-3 py-2.5 text-center">Vagas Livres</th>
                          <th className="px-3 py-2.5 text-center">Situação da Cota</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {previaResultado.distribuicao_dias.map((d) => (
                          <tr key={String(d.data)} className={d.status !== "ok" ? "bg-rose-50/50" : "hover:bg-slate-50"}>
                            <td className="px-3 py-2.5 font-bold font-mono text-slate-900">
                              {fmtDataBr(String(d.data))}
                            </td>
                            <td className="px-3 py-2.5 text-center font-bold text-teal">
                              {d.pacientes_alocados}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono font-semibold">
                              {fmtMoeda(d.valor_dia)}
                            </td>
                            <td className="px-3 py-2.5 text-center text-slate-600">
                              {d.vagas_totais}
                            </td>
                            <td className="px-3 py-2.5 text-center text-slate-600">
                              {d.vagas_ocupadas}
                            </td>
                            <td className="px-3 py-2.5 text-center font-bold">
                              {d.vagas_livres}
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              {d.status === "ok" ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                                  <Check className="h-3 w-3" /> Cota Suficiente
                                </span>
                              ) : d.status === "sem_vaga_cadastrada" ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800">
                                  <AlertCircle className="h-3 w-3" /> Sem Cotas no Lab
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800">
                                  <AlertCircle className="h-3 w-3" /> Déficit de {d.deficit} vaga(s)
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ETAPA 4: CONFIRMAÇÃO E CELEBRAÇÃO */}
              {etapaWizard === 4 && loteSucesso && (
                <div className="py-6 text-center space-y-4">
                  <div className="grid h-16 w-16 place-items-center rounded-2xl bg-emerald-100 text-emerald-700 mx-auto">
                    <CheckCircle2 className="h-10 w-10" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-900">
                      Lote Consolidado com Sucesso!
                    </h3>
                    <p className="text-sm font-mono font-bold text-teal mt-1">
                      {loteSucesso.codigo_lote}
                    </p>
                    <p className="text-xs text-ink/70 mt-1 max-w-md mx-auto">
                      Foram agendados <strong>{loteSucesso.qtd_pacientes} pacientes</strong> totalizando{" "}
                      <strong>{loteSucesso.qtd_exames} exames SIGTAP</strong> e consumo de{" "}
                      <strong>{fmtMoeda(loteSucesso.valor_consumido)}</strong>.
                    </p>
                  </div>

                  {/* Botões de Download Imediato */}
                  <div className="flex flex-wrap items-center justify-center gap-3 pt-3">
                    <Button
                      onClick={() => handleBaixarArtefato(loteSucesso.id, "comprovantes_zip", loteSucesso.arquivo_comprovantes_nome || `comprovantes_${loteSucesso.codigo_lote}.zip`)}
                      className="bg-emerald-700 hover:bg-emerald-800 text-white flex items-center gap-2"
                    >
                      <Download className="h-4 w-4" />
                      Baixar Todos os Comprovantes (.ZIP)
                    </Button>

                    <Button
                      variant="outline"
                      onClick={() => handleBaixarArtefato(loteSucesso.id, "relatorio_xlsx", loteSucesso.arquivo_excel_nome || `relatorio_${loteSucesso.codigo_lote}.xlsx`)}
                      className="border-sky-300 text-sky-800 hover:bg-sky-50 flex items-center gap-2"
                    >
                      <FileSpreadsheet className="h-4 w-4 text-sky-600" />
                      Baixar Planilha do Lote (.XLSX)
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Rodapé com Navegação do Wizard */}
            <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/50 rounded-b-2xl">
              <div>
                {etapaWizard > 1 && etapaWizard < 4 && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEtapaWizard((prev) => (prev - 1) as any)}
                    disabled={consolidandoLote}
                    className="flex items-center gap-1.5"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Voltar
                  </Button>
                )}
              </div>

              <div className="flex items-center gap-2">
                {etapaWizard === 1 && (
                  <Button
                    onClick={handleCalcularPrevia}
                    disabled={calculandoPrevia}
                    className="bg-teal hover:bg-teal-700 text-white flex items-center gap-1.5"
                  >
                    {calculandoPrevia ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                    Calcular Prévia do Lote
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                )}

                {etapaWizard === 2 && (
                  <Button
                    onClick={() => setEtapaWizard(3)}
                    className="bg-teal hover:bg-teal-700 text-white flex items-center gap-1.5"
                  >
                    Revisar Cotas de Vagas
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                )}

                {etapaWizard === 3 && (
                  <Button
                    onClick={handleConfirmarConsolidacao}
                    disabled={previaResultado?.bloqueado || consolidandoLote}
                    className="bg-emerald-700 hover:bg-emerald-800 text-white flex items-center gap-2 shadow-xs disabled:opacity-50"
                  >
                    {consolidandoLote ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CheckCircle2 className="h-4 w-4" />}
                    Confirmar Agendamento Atômico
                  </Button>
                )}

                {etapaWizard === 4 && (
                  <Button
                    onClick={() => setWizardAberto(false)}
                    className="bg-teal hover:bg-teal-700 text-white"
                  >
                    Concluir e Fechar
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL DETALHES DO LOTE */}
      {/* ==================================================================== */}
      {loteDetalhe && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 overflow-y-auto">
          <div className="w-full max-w-3xl rounded-2xl bg-white shadow-2xl border border-slate-200 flex flex-col max-h-[85vh] my-auto">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/70 rounded-t-2xl">
              <div>
                <h3 className="font-bold text-lg text-slate-900 flex items-center gap-2">
                  <FileText className="h-5 w-5 text-teal" />
                  Detalhes do Lote: {loteDetalhe.codigo_lote}
                </h3>
                <p className="text-xs text-ink/60 mt-0.5">
                  Emitido em {new Date(loteDetalhe.created_at).toLocaleString("pt-BR")} por {loteDetalhe.criado_por}
                </p>
              </div>
              <button
                onClick={() => setLoteDetalhe(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs">
                <div>
                  <span className="text-slate-500 block">Laboratório:</span>
                  <strong className="text-slate-900">{loteDetalhe.laboratorio_nome}</strong>
                </div>
                <div>
                  <span className="text-slate-500 block">Total Consumido:</span>
                  <strong className="text-teal font-mono">{fmtMoeda(loteDetalhe.valor_consumido)}</strong>
                </div>
                <div>
                  <span className="text-slate-500 block">Pacientes:</span>
                  <strong className="text-slate-900">{loteDetalhe.qtd_pacientes}</strong>
                </div>
                <div>
                  <span className="text-slate-500 block">Total Exames:</span>
                  <strong className="text-slate-900">{loteDetalhe.qtd_exames}</strong>
                </div>
              </div>

              {/* Botões de Download */}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleBaixarArtefato(loteDetalhe.id, "comprovantes_zip", loteDetalhe.arquivo_comprovantes_nome || `comprovantes_${loteDetalhe.codigo_lote}.zip`)}
                  className="text-xs text-emerald-800 border-emerald-300 hover:bg-emerald-50 flex items-center gap-1.5"
                >
                  <Download className="h-3.5 w-3.5" />
                  Baixar Comprovantes (.ZIP)
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleBaixarArtefato(loteDetalhe.id, "relatorio_xlsx", loteDetalhe.arquivo_excel_nome || `relatorio_${loteDetalhe.codigo_lote}.xlsx`)}
                  className="text-xs text-sky-800 border-sky-300 hover:bg-sky-50 flex items-center gap-1.5"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  Baixar Planilha (.XLSX)
                </Button>
              </div>

              {/* Lista de Pacientes do Lote */}
              <div>
                <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                  Pacientes Contemplados no Lote:
                </h4>
                <div className="border border-slate-200 rounded-xl overflow-hidden max-h-64 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 border-b border-slate-200 font-semibold text-slate-700 sticky top-0">
                      <tr>
                        <th className="px-3 py-2">Ordem</th>
                        <th className="px-3 py-2">Paciente / Prontuário</th>
                        <th className="px-3 py-2">Data Agendada</th>
                        <th className="px-3 py-2">Exames</th>
                        <th className="px-3 py-2 text-right">Valor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(loteDetalhe.itens || []).map((it) => (
                        <tr key={it.id} className="hover:bg-slate-50">
                          <td className="px-3 py-2 font-mono text-slate-500">#{it.ordem_selecao}</td>
                          <td className="px-3 py-2">
                            <div className="font-semibold text-slate-900">{it.paciente_nome}</div>
                            <div className="text-[11px] text-slate-500 font-mono">{it.paciente_prontuario}</div>
                          </td>
                          <td className="px-3 py-2 font-mono">{fmtDataBr(it.data_agendada)}</td>
                          <td className="px-3 py-2 max-w-xs truncate text-[11px] text-slate-600">
                            {(it.exames || []).map((e: any) => e.descricao || e.codigo).join(", ")}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">
                            {fmtMoeda(it.valor_consumido)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 flex justify-end bg-slate-50/50 rounded-b-2xl">
              <Button onClick={() => setLoteDetalhe(null)} variant="outline">
                Fechar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
