import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Eye,
  FileCheck,
  FileText,
  Filter,
  FlaskConical,
  RefreshCw,
  Search,
  ShieldAlert,
  User,
  X,
} from "lucide-react";
import {
  labAuditoriaLaudosListar,
  labAuditoriaLaudoDecidir,
  labAbrirLaudoPdf,
  labFetchLaudoPdfBlob,
  type LabAuditoriaItem,
} from "../../services/api";
import { Button, Card, Input, Label, Select } from "../../components/ui/primitives";
import { useConfirm } from "../../components/ConfirmDialog";

export default function AuditoriaLaudos() {
  const { confirmar } = useConfirm();
  const [lista, setLista] = useState<LabAuditoriaItem[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");

  // Filtros
  const [filtroStatus, setFiltroStatus] = useState<string>("em_revisao_secretaria");
  const [busca, setBusca] = useState("");

  // Item selecionado para auditoria detalhada
  const [itemSelecionado, setItemSelecionado] = useState<LabAuditoriaItem | null>(null);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string>("");
  const [parecerAuditor, setParecerAuditor] = useState("");
  const [processandoDecisao, setProcessandoDecisao] = useState(false);

  useEffect(() => {
    let ativo = true;
    let urlCriada = "";
    if (!itemSelecionado) {
      setPdfBlobUrl("");
      return;
    }
    labFetchLaudoPdfBlob(itemSelecionado.solicitacao_id)
      .then((blob) => {
        urlCriada = URL.createObjectURL(blob);
        if (ativo) {
          setPdfBlobUrl(urlCriada);
        } else {
          URL.revokeObjectURL(urlCriada);
        }
      })
      .catch(() => {
        if (ativo) setPdfBlobUrl("");
      });
    return () => {
      ativo = false;
      if (urlCriada) URL.revokeObjectURL(urlCriada);
    };
  }, [itemSelecionado?.solicitacao_id]);

  async function carregar() {
    setCarregando(true);
    setErro("");
    try {
      const dados = await labAuditoriaLaudosListar({
        status: filtroStatus !== "todos" ? filtroStatus : undefined,
        limit: 100,
      });
      setLista(dados);
    } catch {
      setErro("Falha ao carregar fila de auditoria de laudos.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregar();
  }, [filtroStatus]);

  const listaFiltrada = lista.filter((item) => {
    if (!busca.trim()) return true;
    const q = busca.toLowerCase();
    return (
      item.paciente_nome.toLowerCase().includes(q) ||
      (item.paciente_cpf && item.paciente_cpf.includes(q)) ||
      (item.laboratorio_nome && item.laboratorio_nome.toLowerCase().includes(q)) ||
      String(item.solicitacao_id).includes(q)
    );
  });

  function abrirAuditoria(item: LabAuditoriaItem) {
    setItemSelecionado(item);
    setParecerAuditor("");
  }

  async function executarDecisao(acao: "aprovar" | "rejeitar") {
    if (!itemSelecionado) return;

    if (acao === "rejeitar" && parecerAuditor.trim().length < 5) {
      setErro("Para rejeitar o laudo, forneça um parecer justificando o motivo para o laboratório.");
      return;
    }

    const conf = await confirmar({
      titulo: acao === "aprovar" ? "Aprovar Laudo e Concluir Pedido" : "Rejeitar Laudo e Devolver ao Laboratório",
      descricao:
        acao === "aprovar"
          ? `Confirma a liberação do laudo de ${itemSelecionado.paciente_nome}? O pedido será finalizado como REALIZADO e anexado definitivamente ao Prontuário PEC do paciente.`
          : `Confirma a rejeição do laudo de ${itemSelecionado.paciente_nome}? O pedido retornará ao status COLETADO para que o laboratório realize as correções.`,
      textoConfirmar: acao === "aprovar" ? "Sim, Aprovar Laudo" : "Sim, Rejeitar Laudo",
      variante: acao === "aprovar" ? "primary" : "danger",
    });

    if (!conf) return;

    setProcessandoDecisao(true);
    setErro("");
    setOk("");

    try {
      const resp = await labAuditoriaLaudoDecidir(itemSelecionado.solicitacao_id, {
        acao,
        parecer: parecerAuditor.trim() || undefined,
      });

      setOk(resp.mensagem || `Decisão registrada com sucesso para o pedido #${itemSelecionado.solicitacao_id}.`);
      setItemSelecionado(null);
      carregar();
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Erro ao registrar decisão de auditoria.");
    } finally {
      setProcessandoDecisao(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700 border border-indigo-200">
              <ShieldAlert className="h-5 w-5" />
            </span>
            <h2 className="font-display text-xl font-bold text-sus-950">
              Secretaria de Saúde · Auditoria de Laudos com Inconsistência
            </h2>
          </div>
          <p className="mt-1 text-xs text-ink/65">
            Módulo de regulação clínica: conferência e liberação de laudos laboratoriais divergentes (exames faltantes, complementares ou divergências cadastrais).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/lab/auditoria?aba=ajustes"
            className="border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 text-xs font-semibold flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition !h-9"
          >
            <ShieldAlert className="h-3.5 w-3.5 text-amber-600" />
            Contestações e Ajustes de Exames
          </Link>
          <Button
            type="button"
            onClick={() => carregar()}
            className="border border-sus-900/15 bg-white text-ink hover:bg-sand text-xs flex items-center gap-1.5 !h-9"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Atualizar Fila
          </Button>
        </div>
      </div>

      {erro && (
        <div className="rounded-xl bg-red-50 p-3.5 text-sm font-medium text-red-700 flex items-center justify-between">
          <span>{erro}</span>
          <button onClick={() => setErro("")} className="text-red-500 hover:text-red-800">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {ok && (
        <div className="rounded-xl bg-teal/10 p-3.5 text-sm font-medium text-teal flex items-center justify-between">
          <span>{ok}</span>
          <button onClick={() => setOk("")} className="text-teal hover:opacity-75">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Barra de Filtros */}
      <Card className="p-4 border-sus-900/10 shadow-xs">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
          <div className="md:col-span-8 relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-teal" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por paciente, CPF, laboratório ou protocolo (#)..."
              className="pl-10 pr-9 !h-10 text-xs sm:text-sm"
            />
            {busca && (
              <button
                onClick={() => setBusca("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/40 hover:text-ink/80 transition"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="md:col-span-4">
            <Select
              value={filtroStatus}
              onChange={(e) => setFiltroStatus(e.target.value)}
              className="!h-10 text-xs"
            >
              <option value="em_revisao_secretaria">Pendentes de Revisão (Em Auditoria)</option>
              <option value="realizado">Aprovados / Concluídos</option>
              <option value="todos">Todos os Registros</option>
            </Select>
          </div>
        </div>
      </Card>

      {/* Lista de Auditoria */}
      {carregando ? (
        <div className="py-12 text-center text-ink/50">
          <div className="inline-block h-7 w-7 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent mb-2" />
          <p className="text-xs font-medium">Carregando pedidos em auditoria...</p>
        </div>
      ) : listaFiltrada.length === 0 ? (
        <Card className="p-10 text-center border-dashed">
          <FileCheck className="mx-auto h-8 w-8 text-ink/30 mb-2" />
          <p className="text-sm font-semibold text-sus-950">Nenhum laudo pendente de auditoria</p>
          <p className="mt-1 text-xs text-ink/55">
            Não há pedidos em revisão com os filtros selecionados.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {listaFiltrada.map((item) => {
            const isPendente = item.status === "em_revisao_secretaria";
            const temFaltantes = (item.exames_faltantes || []).length > 0;
            const temAdicionais = (item.exames_adicionais || []).length > 0;

            return (
              <Card
                key={item.solicitacao_id}
                className={`p-4 border-sus-900/10 shadow-xs transition hover:border-indigo-300 ${
                  isPendente ? "bg-white" : "bg-sand/20"
                }`}
              >
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                  {/* Dados Principais */}
                  <div className="space-y-2 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold text-ink/50 bg-sand px-2 py-0.5 rounded">
                        #{item.solicitacao_id}
                      </span>
                      <h3 className="font-bold text-base text-sus-950">{item.paciente_nome}</h3>
                      {item.paciente_cpf && (
                        <span className="text-xs text-ink/65">CPF: {item.paciente_cpf}</span>
                      )}
                      {item.unidade_psf && (
                        <span className="text-[11px] rounded bg-sand px-2 py-0.5 font-medium text-sus-900">
                          {item.unidade_psf}
                        </span>
                      )}
                      <span
                        className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${
                          isPendente
                            ? "bg-amber-100 text-amber-800 border border-amber-300"
                            : "bg-emerald-100 text-emerald-800 border border-emerald-300"
                        }`}
                      >
                        {isPendente ? "Revisão Pendente" : "Liberado / Realizado"}
                      </span>
                    </div>

                    {/* Dados do Laboratório e Justificativa */}
                    <div className="text-xs text-ink/80 space-y-1">
                      <p>
                        <strong>Laboratório Prestador:</strong> {item.laboratorio_nome || "Laboratório Conveniado"}
                      </p>
                      {item.justificativa_laboratorio && (
                        <div className="rounded-xl bg-amber-50/80 p-2.5 border border-amber-200/80 text-amber-950">
                          <p className="font-bold text-[11px] text-amber-900 flex items-center gap-1">
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                            Motivo / Justificativa do Laboratório:
                          </p>
                          <p className="mt-0.5 text-xs italic leading-relaxed">
                            "{item.justificativa_laboratorio}"
                          </p>
                          {item.justificado_em && (
                            <p className="mt-1 text-[10px] text-amber-800/70">
                              Enviado em {new Date(item.justificado_em).toLocaleString("pt-BR")}
                              {item.justificado_por && ` por ${item.justificado_por}`}
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Badges de Procedimentos Faltantes / Adicionais */}
                    <div className="flex flex-wrap gap-2 pt-1 text-xs">
                      {temFaltantes && (
                        <div className="flex items-center gap-1.5 rounded-lg bg-red-50 border border-red-200 px-2.5 py-1 text-red-900">
                          <span className="font-bold text-[10px] uppercase">Faltam ({item.exames_faltantes.length}):</span>
                          <span className="truncate max-w-xs">{item.exames_faltantes.join(", ")}</span>
                        </div>
                      )}

                      {temAdicionais && (
                        <div className="flex items-center gap-1.5 rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-1 text-amber-900">
                          <span className="font-bold text-[10px] uppercase">Adicionais ({item.exames_adicionais.length}):</span>
                          <span className="truncate max-w-xs">{item.exames_adicionais.join(", ")}</span>
                        </div>
                      )}

                      {!item.match_paciente_ok && (
                        <div className="flex items-center gap-1.5 rounded-lg bg-rose-100 border border-rose-300 px-2.5 py-1 text-rose-900 font-bold text-[11px]">
                          ⚠️ Divergência no Nome / CPF do Paciente
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Ações */}
                  <div className="flex flex-col sm:flex-row md:flex-col items-end justify-center gap-2 shrink-0">
                    <Button
                      type="button"
                      onClick={() => abrirAuditoria(item)}
                      className="!h-9 text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-bold flex items-center gap-1.5 shadow-xs w-full sm:w-auto"
                    >
                      <Eye className="h-4 w-4" /> Auditar Laudo & Decidir
                    </Button>

                    <button
                      type="button"
                      onClick={() => void labAbrirLaudoPdf(item.solicitacao_id)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-sus-900/15 bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-sand w-full sm:w-auto"
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> Abrir PDF Completo
                    </button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Modal Split View de Auditoria e Decisão */}
      {itemSelecionado && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-sus-950/70 p-2 sm:p-4"
          onClick={() => !processandoDecisao && setItemSelecionado(null)}
        >
          <div
            className="rise max-h-[96vh] w-full max-w-6xl overflow-hidden rounded-3xl bg-white shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Topo do Modal */}
            <div className="flex items-center justify-between border-b border-sus-900/10 px-6 py-4 bg-sus-900/5">
              <div>
                <h3 className="font-display text-base font-bold text-sus-950 flex items-center gap-2">
                  <ShieldAlert className="h-5 w-5 text-indigo-600" />
                  Auditoria Regulatória de Laudo Laboratorial
                </h3>
                <p className="mt-0.5 text-xs text-ink/65">
                  Paciente: <strong>{itemSelecionado.paciente_nome}</strong> · Pedido #{itemSelecionado.solicitacao_id} · {itemSelecionado.laboratorio_nome}
                </p>
              </div>
              <button
                type="button"
                disabled={processandoDecisao}
                onClick={() => setItemSelecionado(null)}
                className="rounded-xl p-2 text-ink/50 hover:bg-sand transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Conteúdo em Duas Colunas (Split View) */}
            <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Coluna Esquerda: Análise de Dados e Parecer (5 colunas) */}
              <div className="lg:col-span-5 space-y-4 text-xs">
                {/* Validação de Identidade do Paciente */}
                <div
                  className={`p-3.5 rounded-xl border ${
                    itemSelecionado.match_paciente_ok
                      ? "bg-emerald-50 border-emerald-200 text-emerald-950"
                      : "bg-red-50 border-red-200 text-red-950"
                  }`}
                >
                  <p className="font-bold flex items-center gap-1.5">
                    {itemSelecionado.match_paciente_ok ? (
                      <>
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        Identificação do Paciente Confirmada no Laudo
                      </>
                    ) : (
                      <>
                        <AlertCircle className="h-4 w-4 text-red-600" />
                        Alerta Crítico: Divergência Cadastral no Laudo!
                      </>
                    )}
                  </p>
                  <p className="mt-1 text-[11px] opacity-90">
                    O robô conferiu os dados do cabeçalho do documento com o cadastro do e-SUS PEC.
                  </p>
                </div>

                {/* Justificativa do Laboratório */}
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 space-y-1">
                  <p className="font-bold text-amber-900 flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                    Justificativa Técnica do Laboratório
                  </p>
                  <p className="text-xs text-amber-950 leading-relaxed font-medium mt-1">
                    "{itemSelecionado.justificativa_laboratorio || "Sem justificativa textual."}"
                  </p>
                  {itemSelecionado.justificado_em && (
                    <p className="text-[10px] text-amber-800/60 pt-1">
                      Data: {new Date(itemSelecionado.justificado_em).toLocaleString("pt-BR")}
                    </p>
                  )}
                </div>

                {/* Exames Solicitados vs Faltantes vs Adicionais */}
                <div className="space-y-2">
                  <p className="font-bold text-[11px] uppercase text-sus-900/70">
                    Conferência de Exames
                  </p>

                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {/* Faltantes */}
                    {(itemSelecionado.exames_faltantes || []).length > 0 && (
                      <div className="rounded-lg bg-red-50 border border-red-200 p-2.5">
                        <span className="font-bold text-[11px] text-red-900 block mb-1">
                          Exames Solicitados Não Encontrados no Laudo:
                        </span>
                        <ul className="list-disc pl-4 text-[11px] text-red-800 space-y-0.5">
                          {itemSelecionado.exames_faltantes.map((ex, idx) => (
                            <li key={idx}>{ex}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Adicionais */}
                    {(itemSelecionado.exames_adicionais || []).length > 0 && (
                      <div className="rounded-lg bg-amber-50 border border-amber-200 p-2.5">
                        <span className="font-bold text-[11px] text-amber-900 block mb-1">
                          Exames Constantes no Laudo Fora do Pedido SUS:
                        </span>
                        <ul className="list-disc pl-4 text-[11px] text-amber-800 space-y-0.5">
                          {itemSelecionado.exames_adicionais.map((ex, idx) => (
                            <li key={idx}>{ex}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Encontrados */}
                    {(itemSelecionado.exames_encontrados || []).length > 0 && (
                      <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-2.5">
                        <span className="font-bold text-[11px] text-emerald-900 block mb-1">
                          Exames Validados com Sucesso:
                        </span>
                        <ul className="list-disc pl-4 text-[11px] text-emerald-800 space-y-0.5">
                          {itemSelecionado.exames_encontrados.map((ex, idx) => (
                            <li key={idx}>{ex}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>

                {/* Parecer do Auditor */}
                <div className="space-y-1.5 pt-2 border-t border-sus-900/10">
                  <Label>Parecer do Auditor da Secretaria *</Label>
                  <textarea
                    rows={3}
                    value={parecerAuditor}
                    onChange={(e) => setParecerAuditor(e.target.value)}
                    placeholder="Registre sua decisão regulatória (obrigatório em caso de rejeição)..."
                    className="w-full rounded-xl border border-sus-900/15 bg-white p-2.5 text-xs text-ink outline-none focus:border-indigo-600"
                  />
                </div>

                {/* Botões de Decisão */}
                <div className="flex flex-col sm:flex-row gap-2 pt-2">
                  <Button
                    type="button"
                    onClick={() => executarDecisao("rejeitar")}
                    disabled={processandoDecisao}
                    className="border border-rose-300 bg-rose-50 text-rose-800 hover:bg-rose-100 flex-1 font-bold text-xs !h-10"
                  >
                    Rejeitar Laudo
                  </Button>

                  <Button
                    type="button"
                    onClick={() => executarDecisao("aprovar")}
                    disabled={processandoDecisao}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white flex-1 font-bold text-xs !h-10 shadow-xs"
                  >
                    Aprovar e Concluir Pedido
                  </Button>
                </div>
              </div>

              {/* Coluna Direita: Visualizador do PDF Integrado (7 colunas) */}
              <div className="lg:col-span-7 flex flex-col h-[520px] rounded-2xl border border-sus-900/15 overflow-hidden bg-sand/30">
                <div className="flex items-center justify-between bg-sand px-4 py-2 border-b border-sus-900/10 text-xs font-semibold text-sus-950">
                  <span className="flex items-center gap-1.5">
                    <FileText className="h-4 w-4 text-indigo-600" /> Laudo Original Enviado pelo Laboratório
                  </span>
                  <button
                    type="button"
                    onClick={() => void labAbrirLaudoPdf(itemSelecionado.solicitacao_id)}
                    className="inline-flex items-center gap-1 text-[11px] text-indigo-700 hover:underline font-bold"
                  >
                    <ExternalLink className="h-3 w-3" /> Abrir em outra aba
                  </button>
                </div>
                {pdfBlobUrl ? (
                  <iframe
                    src={pdfBlobUrl}
                    title="Laudo PDF do Paciente"
                    className="w-full flex-1 border-0"
                  />
                ) : (
                  <div className="flex-1 grid place-items-center text-xs text-ink/50">
                    Carregando documento PDF autenticado…
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
