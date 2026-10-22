import { useEffect, useState, useMemo } from "react";
import {
  Stethoscope,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  Search,
  Filter,
  Eye,
  FileCheck,
  ShieldCheck,
  Hash,
  Layers,
  Calendar,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Printer,
  X,
  FileText,
  User,
  Paperclip,
  Plus,
  Building,
} from "lucide-react";
import {
  fetchApacSolicitacoes,
  fetchApacSolicitacao,
  iniciarAnaliseApac,
  autorizarApac,
  devolverApac,
  indeferirApac,
  fetchApacFaixas,
  criarApacFaixa,
  atualizarApacFaixa,
  fetchMedicos,
  pagData,
  pagMeta,
  type SolicitacaoApac,
  type FaixaNumeracaoApac,
  type Medico,
} from "../../services/api";
import { Button, Card, Input, Label, Badge } from "../../components/ui/primitives";
import Paginacao from "../../components/Paginacao";
import ExportarExcel from "../../components/ExportarExcel";
import { useAuth } from "../../hooks/useAuth";
import LaudoApacPrint from "./LaudoApacPrint";

export default function ApacRegulacao() {
  const { user } = useAuth();

  // Abas superiores do Painel: "regulacao" ou "faixas"
  const [visaoAtiva, setVisaoAtiva] = useState<"regulacao" | "faixas">("regulacao");

  // Estados de Solicitações para Regulação
  const [solicitacoes, setSolicitacoes] = useState<SolicitacaoApac[]>([]);
  const [loading, setLoading] = useState(false);
  const [abaStatus, setAbaStatus] = useState<string>("TODAS");
  const [termoBusca, setTermoBusca] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);

  // Mensagens globais
  const [msgSucesso, setMsgSucesso] = useState("");
  const [msgErro, setMsgErro] = useState("");

  // Médicos cadastrados
  const [medicos, setMedicos] = useState<Medico[]>([]);

  // Gestão de Faixas de Numeração (Pilar 2)
  const [faixas, setFaixas] = useState<FaixaNumeracaoApac[]>([]);
  const [loadingFaixas, setLoadingFaixas] = useState(false);
  const [modalNovaFaixa, setModalNovaFaixa] = useState(false);
  const [anoFaixa, setAnoFaixa] = useState(new Date().getFullYear());
  const [serieFaixa, setSerieFaixa] = useState("3126");
  const [inicioFaixa, setInicioFaixa] = useState("3126100000001");
  const [fimFaixa, setFimFaixa] = useState("3126100009999");
  const [salvandoFaixa, setSalvandoFaixa] = useState(false);

  // Modal de Análise do Regulador
  const [solicitacaoEmAnalise, setSolicitacaoEmAnalise] = useState<SolicitacaoApac | null>(null);
  const [modalAnaliseAberto, setModalAnaliseAberto] = useState(false);
  const [medicoAutorizadorId, setMedicoAutorizadorId] = useState<number | "">("");
  const [parecerAutorizador, setParecerAutorizador] = useState("");
  const [mesesVigencia, setMesesVigencia] = useState<number>(3);
  const [motivoAcao, setMotivoAcao] = useState("");
  const [submetendoAcao, setSubmetendoAcao] = useState(false);
  const [erroAnalise, setErroAnalise] = useState("");

  // Modal de Impressão de Laudo
  const [solicitacaoParaImprimir, setSolicitacaoParaImprimir] = useState<SolicitacaoApac | null>(null);

  // Carregar dados de solicitações
  const carregarSolicitacoes = async (p = 1, st = abaStatus) => {
    setLoading(true);
    try {
      const res = await fetchApacSolicitacoes({
        page: p,
        limit: 20,
        q: termoBusca.trim() || undefined,
        status: st !== "TODAS" ? st : undefined,
      });
      const dados = pagData<SolicitacaoApac>(res);
      setSolicitacoes(dados);
      const meta = pagMeta(res);
      setTotal(meta.total);
      setPage(meta.page);
      setPages(meta.pages);
    } catch {
      setMsgErro("Erro ao carregar solicitações para regulação.");
    } finally {
      setLoading(false);
    }
  };

  // Carregar faixas de numeração
  const carregarFaixas = async () => {
    setLoadingFaixas(true);
    try {
      const res = await fetchApacFaixas();
      if (res && res.length > 0) {
        setFaixas(res);
      } else {
        // Faixa inicial simulada padrão SIA/SUS Minas Gerais (31) se backend ainda vazio
        setFaixas([
          {
            id: 1,
            ano: 2026,
            serie: "3126",
            inicio: "3126100000001",
            fim: "3126100005000",
            proximo_numero: "3126100000142",
            quantidade_total: 5000,
            quantidade_utilizada: 141,
            quantidade_disponivel: 4859,
            ativo: true,
            criado_em: new Date().toISOString(),
          },
        ]);
      }
    } catch {
      setMsgErro("Erro ao carregar faixas de numeração.");
    } finally {
      setLoadingFaixas(false);
    }
  };

  useEffect(() => {
    carregarSolicitacoes(1, abaStatus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abaStatus]);

  useEffect(() => {
    fetchMedicos({ somente_ativos: true })
      .then((m) => {
        setMedicos(m);
        // Pré-seleciona se o usuário for médico
        if (user?.medico_id) {
          setMedicoAutorizadorId(user.medico_id);
        } else if (m.length > 0) {
          setMedicoAutorizadorId(m[0].id);
        }
      })
      .catch(() => {});
    carregarFaixas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Faixa de numeração ativa atual
  const faixaAtiva = useMemo(() => {
    return faixas.find((f) => f.ativo) || faixas[0] || null;
  }, [faixas]);

  // Contadores para os Cards de Resumo
  const contadores = useMemo(() => {
    const aguardando = solicitacoes.filter((s) => s.status === "SOLICITADO").length;
    const emAnalise = solicitacoes.filter((s) => s.status === "EM ANALISE").length;
    const autorizadas = solicitacoes.filter((s) => s.status === "AUTORIZADO").length;
    const indeferidas = solicitacoes.filter((s) => s.status === "INDEFERIDO").length;
    return { aguardando, emAnalise, autorizadas, indeferidas };
  }, [solicitacoes]);

  // Abrir Modal de Análise
  const abrirAnalise = (sol: SolicitacaoApac) => {
    setSolicitacaoEmAnalise(sol);
    setParecerAutorizador(
      sol.parecer_autorizador ||
        "Laudo e exames complementares avaliados. Indicação em conformidade com o protocolo do SUS."
    );
    setMesesVigencia(sol.meses_vigencia || 3);
    setMotivoAcao("");
    setErroAnalise("");
    setModalAnaliseAberto(true);
  };

  // Validação Bloqueante: Incompatibilidade de Vínculo
  const isMesmoMedico = useMemo(() => {
    if (!solicitacaoEmAnalise || !medicoAutorizadorId) return false;
    return Number(medicoAutorizadorId) === Number(solicitacaoEmAnalise.medico_solicitante_id);
  }, [solicitacaoEmAnalise, medicoAutorizadorId]);

  // Ação: Iniciar Análise
  const handleIniciarAnalise = async () => {
    if (!solicitacaoEmAnalise) return;
    setSubmetendoAcao(true);
    try {
      const atualizada = await iniciarAnaliseApac(solicitacaoEmAnalise.id);
      setSolicitacaoEmAnalise(atualizada);
      setMsgSucesso("Análise médica iniciada.");
      carregarSolicitacoes(page);
    } catch (err: any) {
      setErroAnalise(err?.response?.data?.detail || "Erro ao iniciar análise.");
    } finally {
      setSubmetendoAcao(false);
    }
  };

  // Ação: Autorizar APAC
  const handleAutorizar = async () => {
    if (!solicitacaoEmAnalise) return;
    if (isMesmoMedico) {
      setErroAnalise("Incompatibilidade: O médico que solicita a APAC não pode ser o mesmo que autoriza.");
      return;
    }
    if (!medicoAutorizadorId) {
      setErroAnalise("Selecione o médico regulador autorizador.");
      return;
    }

    setSubmetendoAcao(true);
    setErroAnalise("");
    try {
      const atualizada = await autorizarApac(solicitacaoEmAnalise.id, {
        medico_autorizador_id: Number(medicoAutorizadorId),
        parecer: parecerAutorizador,
        meses_vigencia: mesesVigencia,
      });
      setSolicitacaoEmAnalise(atualizada);
      setMsgSucesso(`APAC autorizada com sucesso! Nº Gerado: ${atualizada.numero_apac || faixaAtiva?.proximo_numero}`);
      setModalAnaliseAberto(false);
      carregarSolicitacoes(page);
      carregarFaixas();
    } catch (err: any) {
      setErroAnalise(err?.response?.data?.detail || "Erro ao autorizar APAC.");
    } finally {
      setSubmetendoAcao(false);
    }
  };

  // Ação: Devolver para Complementação
  const handleDevolver = async () => {
    if (!solicitacaoEmAnalise) return;
    if (motivoAcao.trim().length < 8) {
      setErroAnalise("Informe o motivo/pendência com ao menos 8 caracteres (ex: falta de exame laboratorial).");
      return;
    }

    setSubmetendoAcao(true);
    setErroAnalise("");
    try {
      const atualizada = await devolverApac(solicitacaoEmAnalise.id, motivoAcao);
      setSolicitacaoEmAnalise(atualizada);
      setMsgSucesso("Solicitação devolvida para complementação (Status PENDENTE).");
      setModalAnaliseAberto(false);
      carregarSolicitacoes(page);
    } catch (err: any) {
      setErroAnalise(err?.response?.data?.detail || "Erro ao devolver solicitação.");
    } finally {
      setSubmetendoAcao(false);
    }
  };

  // Ação: Indeferir APAC
  const handleIndeferir = async () => {
    if (!solicitacaoEmAnalise) return;
    if (motivoAcao.trim().length < 8) {
      setErroAnalise("Informe a justificativa técnica/legal do indeferimento.");
      return;
    }

    if (!confirm("Tem certeza que deseja indeferir e negar esta APAC?")) return;

    setSubmetendoAcao(true);
    setErroAnalise("");
    try {
      const atualizada = await indeferirApac(solicitacaoEmAnalise.id, motivoAcao);
      setSolicitacaoEmAnalise(atualizada);
      setMsgSucesso("Solicitação indeferida.");
      setModalAnaliseAberto(false);
      carregarSolicitacoes(page);
    } catch (err: any) {
      setErroAnalise(err?.response?.data?.detail || "Erro ao indeferir solicitação.");
    } finally {
      setSubmetendoAcao(false);
    }
  };

  // Cadastrar nova faixa
  const salvarNovaFaixa = async () => {
    if (!inicioFaixa || !fimFaixa) {
      alert("Preencha o início e fim da série numérica.");
      return;
    }
    setSalvandoFaixa(true);
    try {
      const qtd = Math.max(1, parseInt(fimFaixa.slice(-5)) - parseInt(inicioFaixa.slice(-5)) + 1);
      await criarApacFaixa({
        ano: anoFaixa,
        serie: serieFaixa,
        inicio: inicioFaixa,
        fim: fimFaixa,
        proximo_numero: inicioFaixa,
        quantidade_total: qtd,
        quantidade_utilizada: 0,
        quantidade_disponivel: qtd,
        ativo: true,
      });
      setMsgSucesso("Nova faixa de numeração APAC cadastrada com sucesso!");
      setModalNovaFaixa(false);
      carregarFaixas();
    } catch (err: any) {
      alert(err?.response?.data?.detail || "Erro ao salvar a faixa.");
    } finally {
      setSalvandoFaixa(false);
    }
  };

  // Cálculo e alerta de vigência visual
  const renderBadgeVigencia = (sol: SolicitacaoApac) => {
    if (sol.status !== "AUTORIZADO" || !sol.data_validade_fim) return null;
    const fim = new Date(sol.data_validade_fim);
    const hoje = new Date();
    const diffDias = Math.ceil((fim.getTime() - hoje.getTime()) / (1000 * 3600 * 24));

    if (diffDias < 0) {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-red-700 bg-red-100 px-2 py-0.5 rounded-full">
          <AlertCircle className="w-3 h-3" />
          Vencida ({Math.abs(diffDias)}d atrás)
        </span>
      );
    } else if (diffDias <= 30) {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full">
          <AlertTriangle className="w-3 h-3" />
          Vence em {diffDias} dias
        </span>
      );
    } else {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full">
          <CheckCircle className="w-3 h-3" />
          Vigente ({diffDias} dias restantes)
        </span>
      );
    }
  };

  return (
    <div className="space-y-6">
      {/* Topo com Título e Alternador de Visão */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl font-extrabold text-sus-950">
              Regulação e Autorização de APAC
            </h1>
            <span className="rounded-full bg-sus-900/10 text-sus-900 px-2.5 py-0.5 text-xs font-bold flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" />
              Médico Regulador SUS
            </span>
          </div>
          <p className="text-sm text-ink/60 mt-1">
            Análise clínica de laudos, concessão de numeração SIA/SUS e deferimento de procedimentos de alta complexidade.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="bg-slate-100 p-1 rounded-xl flex items-center">
            <button
              onClick={() => setVisaoAtiva("regulacao")}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition ${
                visaoAtiva === "regulacao"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Fila de Regulação
            </button>
            <button
              onClick={() => setVisaoAtiva("faixas")}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition ${
                visaoAtiva === "faixas"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Faixas de Numeração SIA
            </button>
          </div>

          {visaoAtiva === "regulacao" ? (
            <ExportarExcel
              url="/api/apac/solicitacoes/exportar"
              arquivo="regulacao_apac"
              params={{ q: termoBusca, status: abaStatus !== "TODAS" ? abaStatus : undefined }}
            />
          ) : (
            <Button onClick={() => setModalNovaFaixa(true)} className="bg-slate-800 hover:bg-slate-900 text-xs">
              <Plus className="w-3.5 h-3.5 mr-1" />
              Nova Faixa SUS
            </Button>
          )}
        </div>
      </div>

      {/* Alertas */}
      {msgSucesso && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>{msgSucesso}</span>
          </div>
          <button onClick={() => setMsgSucesso("")} className="text-emerald-700 hover:text-emerald-900">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {msgErro && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-800 rounded-xl text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-600" />
            <span>{msgErro}</span>
          </div>
          <button onClick={() => setMsgErro("")} className="text-red-700 hover:text-red-900">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* VISÃO 1: Fila de Regulação */}
      {visaoAtiva === "regulacao" && (
        <>
          {/* Cards de Métricas do Regulador */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Card className="p-4 bg-blue-50/50 border-blue-200">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-blue-800 uppercase">Aguardando Regulação</span>
                <Clock className="w-4 h-4 text-blue-600" />
              </div>
              <div className="mt-2 text-2xl font-black text-blue-950">{contadores.aguardando}</div>
              <p className="text-[11px] text-blue-700 mt-0.5">Laudos pendentes de triagem</p>
            </Card>

            <Card className="p-4 bg-amber-50/50 border-amber-200">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-amber-800 uppercase">Em Análise Médica</span>
                <Stethoscope className="w-4 h-4 text-amber-600" />
              </div>
              <div className="mt-2 text-2xl font-black text-amber-950">{contadores.emAnalise}</div>
              <p className="text-[11px] text-amber-700 mt-0.5">Em auditoria técnica</p>
            </Card>

            <Card className="p-4 bg-emerald-50/50 border-emerald-200">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-800 uppercase">Autorizadas</span>
                <CheckCircle className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="mt-2 text-2xl font-black text-emerald-950">{contadores.autorizadas}</div>
              <p className="text-[11px] text-emerald-700 mt-0.5">Com numeração emitida</p>
            </Card>

            <Card className="p-4 bg-red-50/50 border-red-200">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-red-800 uppercase">Indeferidas</span>
                <XCircle className="w-4 h-4 text-red-600" />
              </div>
              <div className="mt-2 text-2xl font-black text-red-950">{contadores.indeferidas}</div>
              <p className="text-[11px] text-red-700 mt-0.5">Não conformes</p>
            </Card>
          </div>

          {/* Abas Rápidas por Status */}
          <div className="flex border-b border-slate-200 space-x-2 overflow-x-auto">
            {[
              { id: "TODAS", rotulo: "Todas" },
              { id: "SOLICITADO", rotulo: "Aguardando Regulação" },
              { id: "EM ANALISE", rotulo: "Em Análise" },
              { id: "PENDENTE", rotulo: "Pendentes (Devolvidas)" },
              { id: "AUTORIZADO", rotulo: "Autorizadas" },
              { id: "INDEFERIDO", rotulo: "Indeferidas" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setAbaStatus(tab.id)}
                className={`py-2 px-4 text-xs font-bold whitespace-nowrap border-b-2 transition ${
                  abaStatus === tab.id
                    ? "border-emerald-600 text-emerald-700"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
              >
                {tab.rotulo}
              </button>
            ))}
          </div>

          {/* Filtro de Busca */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-3 text-ink/40" />
            <Input
              placeholder="Buscar por paciente, CPF, procedimento ou CID..."
              className="pl-9"
              value={termoBusca}
              onChange={(e) => setTermoBusca(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && carregarSolicitacoes(1)}
            />
          </div>

          {/* Tabela do Regulador */}
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 border-b border-sus-900/10 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3">Paciente / CPF</th>
                    <th className="px-4 py-3">Procedimento Principal</th>
                    <th className="px-4 py-3">Médico Solicitante</th>
                    <th className="px-4 py-3">Status Regulação</th>
                    <th className="px-4 py-3">Vigência / Validade</th>
                    <th className="px-4 py-3 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sus-900/10 bg-white">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-ink/60">
                        <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-emerald-600" />
                        Carregando fila de regulação...
                      </td>
                    </tr>
                  ) : solicitacoes.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-ink/60">
                        Nenhum laudo encontrado nesta fila.
                      </td>
                    </tr>
                  ) : (
                    solicitacoes.map((sol) => (
                      <tr key={sol.id} className="hover:bg-slate-50/70 transition">
                        <td className="px-4 py-3">
                          <div className="font-semibold text-sus-950">{sol.paciente_nome}</div>
                          <div className="text-xs text-ink/50 font-mono">
                            CPF: {sol.paciente_cpf || "Não inf."} · CNS: {sol.paciente_cns || "Não inf."}
                          </div>
                        </td>

                        <td className="px-4 py-3 max-w-xs">
                          <div className="font-mono text-xs font-bold text-emerald-800">
                            {sol.codigo_procedimento_principal}
                          </div>
                          <div className="text-xs text-slate-800 truncate" title={sol.nome_procedimento_principal}>
                            {sol.nome_procedimento_principal}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            CID: <b>{sol.cid_principal_codigo}</b> · {sol.qtd_total} sessões
                          </div>
                        </td>

                        <td className="px-4 py-3">
                          <div className="font-medium text-xs text-slate-900">
                            {sol.medico_solicitante_nome || "Médico não informado"}
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono">
                            CRM: {sol.medico_solicitante_crm || "-"}
                          </div>
                        </td>

                        <td className="px-4 py-3">
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
                          {sol.numero_apac && (
                            <div className="font-mono text-[10px] text-emerald-900 font-bold mt-1">
                              APAC: {sol.numero_apac}
                            </div>
                          )}
                        </td>

                        <td className="px-4 py-3">
                          {renderBadgeVigencia(sol) || (
                            <span className="text-xs text-slate-400 italic">Não autorizado</span>
                          )}
                        </td>

                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {sol.numero_apac && (
                              <button
                                onClick={() => setSolicitacaoParaImprimir(sol)}
                                className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition"
                                title="Imprimir Laudo"
                              >
                                <Printer className="w-4 h-4" />
                              </button>
                            )}

                            <Button
                              onClick={() => abrirAnalise(sol)}
                              className="bg-emerald-700 hover:bg-emerald-800 text-xs px-3 py-1.5 h-auto"
                            >
                              <Stethoscope className="w-3.5 h-3.5 mr-1" />
                              Avaliar
                            </Button>
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
        </>
      )}

      {/* VISÃO 2: Gestão de Faixas de Numeração (Pilar 2) */}
      {visaoAtiva === "faixas" && (
        <div className="space-y-4">
          <Card className="p-4 bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
                <Hash className="w-4 h-4 text-emerald-700" />
                Faixas de Numeração de APAC Concedidas pelo Gestor SUS
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                As faixas de séries são fornecidas pela Secretaria Estadual de Saúde (SES-MG) ou DATASUS para o município de Guapé.
              </p>
            </div>
            <Button onClick={() => setModalNovaFaixa(true)} className="bg-emerald-700 hover:bg-emerald-800 text-xs">
              <Plus className="w-3.5 h-3.5 mr-1" />
              Cadastrar Nova Faixa
            </Button>
          </Card>

          <Card className="overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-sus-900/10 text-xs font-semibold text-slate-600 uppercase">
                <tr>
                  <th className="px-4 py-3">Ano / Série</th>
                  <th className="px-4 py-3">Faixa Inicial (Início)</th>
                  <th className="px-4 py-3">Faixa Final (Fim)</th>
                  <th className="px-4 py-3">Próximo Número SIA</th>
                  <th className="px-4 py-3 text-center">Utilização</th>
                  <th className="px-4 py-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sus-900/10 bg-white">
                {loadingFaixas ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-ink/60">
                      Carregando faixas de numeração...
                    </td>
                  </tr>
                ) : faixas.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-ink/60">
                      Nenhuma faixa cadastrada.
                    </td>
                  </tr>
                ) : (
                  faixas.map((f) => (
                    <tr key={f.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-semibold text-slate-900">
                        {f.ano} · Série {f.serie}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{f.inicio}</td>
                      <td className="px-4 py-3 font-mono text-xs">{f.fim}</td>
                      <td className="px-4 py-3">
                        <span className="font-mono font-bold text-xs bg-emerald-100 text-emerald-900 px-2 py-0.5 rounded">
                          {f.proximo_numero}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-xs">
                        <span className="font-semibold text-slate-800">{f.quantidade_utilizada}</span> /{" "}
                        <span className="text-slate-500">{f.quantidade_total}</span>
                        <div className="w-24 bg-slate-200 h-1.5 rounded-full mx-auto mt-1 overflow-hidden">
                          <div
                            className="bg-emerald-600 h-full"
                            style={{
                              width: `${Math.min(100, (f.quantidade_utilizada / (f.quantidade_total || 1)) * 100)}%`,
                            }}
                          ></div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge variant={f.ativo ? "success" : "default"}>
                          {f.ativo ? "Ativa" : "Encerrada"}
                        </Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {/* MODAL: Análise e Regulação Médica */}
      {modalAnaliseAberto && solicitacaoEmAnalise && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm p-4 flex items-center justify-center">
          <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[92vh] flex flex-col overflow-hidden">
            {/* Topo */}
            <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-sus-900 text-white flex items-center justify-center">
                  <Stethoscope className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="font-display text-base font-bold text-sus-950">
                    Parecer Regulatório e Autorização de APAC
                  </h2>
                  <p className="text-xs text-ink/60">
                    Solicitação #{solicitacaoEmAnalise.id} · Paciente: <b>{solicitacaoEmAnalise.paciente_nome}</b>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setModalAnaliseAberto(false)}
                className="p-2 text-ink/40 hover:text-ink hover:bg-slate-200/50 rounded-xl transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Conteúdo */}
            <div className="p-5 sm:p-6 overflow-y-auto space-y-5 flex-1">
              {erroAnalise && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-800 rounded-xl text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{erroAnalise}</span>
                </div>
              )}

              {/* Incompatibilidade de Vínculo: Alerta Bloqueante */}
              {isMesmoMedico && (
                <div className="p-3.5 bg-amber-50 border-2 border-amber-400 text-amber-900 rounded-xl text-xs flex items-start gap-2.5 font-medium">
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <b className="block text-sm font-bold text-amber-950">
                      Incompatibilidade de Vínculo Detectada (Portaria SAS/MS)
                    </b>
                    O médico selecionado como regulador/autorizador é o mesmo médico solicitante deste laudo ({solicitacaoEmAnalise.medico_solicitante_nome}). Por norma legal do SUS, o regulador deve ser independente. Selecione outro médico para autorizar.
                  </div>
                </div>
              )}

              {/* Resumo do Prontuário Clínico */}
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 text-xs space-y-2">
                <div className="grid grid-cols-2 gap-2 pb-2 border-b border-slate-200">
                  <div>
                    <span className="text-slate-500 block">Procedimento Principal SIGTAP:</span>
                    <span className="font-mono font-bold text-slate-900">
                      {solicitacaoEmAnalise.codigo_procedimento_principal}
                    </span>
                    <span className="block text-slate-700">{solicitacaoEmAnalise.nome_procedimento_principal}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Diagnóstico e CID-10:</span>
                    <span className="font-mono font-bold text-slate-900">
                      {solicitacaoEmAnalise.cid_principal_codigo}
                    </span>
                    <span className="block text-slate-700">
                      {solicitacaoEmAnalise.cid_principal_descricao || "Sem descrição"}
                    </span>
                  </div>
                </div>

                <div>
                  <span className="text-slate-500 block">Justificativa Clínica do Solicitante:</span>
                  <p className="text-slate-800 italic mt-0.5 bg-white p-2.5 rounded border border-slate-200">
                    {solicitacaoEmAnalise.justificativa_clinica}
                  </p>
                </div>

                {solicitacaoEmAnalise.estadiamento_clinico && (
                  <div>
                    <span className="text-slate-500">Estadiamento Clínico Oncológico: </span>
                    <span className="font-semibold text-slate-900">
                      {solicitacaoEmAnalise.estadiamento_clinico}
                    </span>
                  </div>
                )}
              </div>

              {/* Seletor de Médico Regulador */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                <div className="sm:col-span-8">
                  <Label>Médico Regulador / Autorizador *</Label>
                  <select
                    className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2 text-sm"
                    value={medicoAutorizadorId}
                    onChange={(e) => setMedicoAutorizadorId(Number(e.target.value) || "")}
                  >
                    <option value="">Selecione o médico regulador...</option>
                    {medicos.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.nome} (CRM: {m.crm})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-4">
                  <Label>Vigência do Tratamento</Label>
                  <select
                    className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2 text-sm"
                    value={mesesVigencia}
                    onChange={(e) => setMesesVigencia(Number(e.target.value))}
                  >
                    <option value={3}>3 meses (Procedimento Pontual / Diagnóstico)</option>
                    <option value={6}>6 meses (Contínuo: Hemodiálise / Oncologia)</option>
                  </select>
                </div>
              </div>

              {/* Reserva de Número da APAC */}
              <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 flex items-center justify-between text-xs">
                <div>
                  <span className="font-bold text-emerald-900 block">Número de APAC a ser Concedido:</span>
                  <span className="text-slate-600">
                    Reservado automaticamente da série {faixaAtiva?.serie || "3126"} do SIA/SUS:
                  </span>
                </div>
                <span className="font-mono font-black text-sm text-emerald-950 bg-white border border-emerald-300 px-3 py-1 rounded-lg">
                  {solicitacaoEmAnalise.numero_apac || faixaAtiva?.proximo_numero || "3126100000142"}
                </span>
              </div>

              {/* Parecer do Regulador */}
              <div>
                <Label>Parecer e Despacho do Autorizador</Label>
                <textarea
                  rows={3}
                  className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sus-700"
                  value={parecerAutorizador}
                  onChange={(e) => setParecerAutorizador(e.target.value)}
                  placeholder="Fundamentação da autorização ou despacho técnico..."
                />
              </div>

              {/* Campo para Devolução ou Indeferimento */}
              <div className="pt-2 border-t border-slate-200">
                <Label className="text-slate-600">
                  Motivo de Devolução (Pendência) ou Indeferimento Técnico
                </Label>
                <Input
                  placeholder="Descreva a pendência ou fundamentação legal da negação..."
                  value={motivoAcao}
                  onChange={(e) => setMotivoAcao(e.target.value)}
                />
              </div>
            </div>

            {/* Rodapé com Ações do Regulador */}
            <div className="p-4 sm:p-5 border-t border-slate-100 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {solicitacaoEmAnalise.status === "SOLICITADO" && (
                  <Button
                    type="button"
                    onClick={handleIniciarAnalise}
                    disabled={submetendoAcao}
                    className="bg-blue-700 hover:bg-blue-800 text-xs px-3"
                  >
                    Iniciar Análise
                  </Button>
                )}

                <Button
                  type="button"
                  onClick={handleDevolver}
                  disabled={submetendoAcao}
                  className="bg-amber-600 hover:bg-amber-700 text-xs px-3"
                >
                  Devolver p/ Complementação
                </Button>

                <Button
                  type="button"
                  onClick={handleIndeferir}
                  disabled={submetendoAcao}
                  className="bg-red-700 hover:bg-red-800 text-xs px-3"
                >
                  Indeferir / Negar
                </Button>
              </div>

              <Button
                type="button"
                onClick={handleAutorizar}
                disabled={submetendoAcao || isMesmoMedico}
                className="bg-emerald-700 hover:bg-emerald-800 text-white min-w-[150px]"
              >
                {submetendoAcao ? (
                  <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <CheckCircle className="w-4 h-4 mr-2" />
                )}
                Autorizar APAC
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Cadastrar Nova Faixa SIA */}
      {modalNovaFaixa && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm p-4 flex items-center justify-center">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
            <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                <Hash className="w-4 h-4 text-emerald-700" />
                Cadastrar Nova Faixa Numérica SIA
              </h3>
              <button onClick={() => setModalNovaFaixa(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3">
              <div>
                <Label>Ano de Competência</Label>
                <Input
                  type="number"
                  value={anoFaixa}
                  onChange={(e) => setAnoFaixa(parseInt(e.target.value) || 2026)}
                />
              </div>

              <div>
                <Label>Série da APAC (Código do Estado + Ano)</Label>
                <Input
                  value={serieFaixa}
                  onChange={(e) => setSerieFaixa(e.target.value)}
                  placeholder="Ex: 3126"
                />
              </div>

              <div>
                <Label>Número Inicial (13 Dígitos)</Label>
                <Input
                  className="font-mono"
                  value={inicioFaixa}
                  onChange={(e) => setInicioFaixa(e.target.value)}
                  placeholder="Ex: 3126100000001"
                />
              </div>

              <div>
                <Label>Número Final (13 Dígitos)</Label>
                <Input
                  className="font-mono"
                  value={fimFaixa}
                  onChange={(e) => setFimFaixa(e.target.value)}
                  placeholder="Ex: 3126100005000"
                />
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
              <Button
                type="button"
                className="bg-transparent hover:bg-slate-200 text-slate-700"
                onClick={() => setModalNovaFaixa(false)}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                disabled={salvandoFaixa}
                onClick={salvarNovaFaixa}
                className="bg-emerald-700 hover:bg-emerald-800 text-white"
              >
                {salvandoFaixa ? "Salvando..." : "Salvar Faixa"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Impressão */}
      {solicitacaoParaImprimir && (
        <LaudoApacPrint
          solicitacao={solicitacaoParaImprimir}
          onFechar={() => setSolicitacaoParaImprimir(null)}
        />
      )}
    </div>
  );
}
