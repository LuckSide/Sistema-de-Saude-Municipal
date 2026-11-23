import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  CheckCircle2,
  AlertTriangle,
  FileSearch,
  FileCheck,
  Send,
  X,
  Check,
  Ban,
  MessageSquare,
  ShieldAlert,
  Search,
  Clock,
} from "lucide-react";
import {
  auditListar,
  auditMarcar,
  auditSolicitarAutorizacao,
  labListarPedidosAjuste,
  labAnalisarPedidoAjuste,
  mapAudit,
  pagData,
  pagMeta,
  type AuditItem,
  type PedidoAjuste,
} from "../../services/api";
import { Button, Card, Input, Label, Select } from "../../components/ui/primitives";
import Paginacao from "../../components/Paginacao";

const STATUS = ["pendente_conferencia", "aprovado", "divergente", "aguardando_autorizacao_sec"];

export default function AuditLab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const abaInicial = searchParams.get("aba") === "ajustes" ? "ajustes" : "auditoria";
  const [aba, setAbaState] = useState<"auditoria" | "ajustes">(abaInicial);

  const setAba = (novaAba: "auditoria" | "ajustes") => {
    setAbaState(novaAba);
    setSearchParams(novaAba === "ajustes" ? { aba: "ajustes" } : {}, { replace: true });
  };

  // Estado da Auditoria
  const [status, setStatus] = useState("");
  const [lista, setLista] = useState<AuditItem[]>([]);
  const [sel, setSel] = useState<AuditItem | null>(null);
  const [obs, setObs] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);

  // Estado dos Pedidos de Ajuste
  const [pedidosAjuste, setPedidosAjuste] = useState<PedidoAjuste[]>([]);
  const [carregandoAjustes, setCarregandoAjustes] = useState(false);
  const [filtroStatusAjuste, setFiltroStatusAjuste] = useState<string>("pendente");
  const [buscaAjuste, setBuscaAjuste] = useState("");
  const [pedidoModal, setPedidoModal] = useState<PedidoAjuste | null>(null);
  const [respostaAnalise, setRespostaAnalise] = useState("");
  const [analisando, setAnalisando] = useState(false);

  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");

  async function carregarAuditoria(p = page) {
    const r = await auditListar(status || undefined, p, 100);
    const arr = pagData<any>(r);
    setLista(arr.map(mapAudit));
    const m = pagMeta(r);
    setTotal(m.total);
    setPage(m.page);
    setPages(m.pages);
  }

  async function carregarAjustes() {
    setCarregandoAjustes(true);
    try {
      const res = await labListarPedidosAjuste(
        filtroStatusAjuste !== "todos" ? filtroStatusAjuste : undefined
      );
      setPedidosAjuste(res);
    } catch {
      setErro("Falha ao carregar pedidos de ajuste.");
    } finally {
      setCarregandoAjustes(false);
    }
  }

  useEffect(() => {
    if (aba === "auditoria") {
      carregarAuditoria(1).catch(() => setErro("Falha ao carregar auditoria."));
    } else {
      carregarAjustes();
    }
  }, [aba, status, filtroStatusAjuste]);

  // Carrega contagem de pendências no início
  useEffect(() => {
    labListarPedidosAjuste("pendente")
      .then((res) => {
        setPedidosAjuste(res);
      })
      .catch(() => {});
  }, []);

  async function validarItem(item_id: number, novo: "aprovado" | "divergente" | "pendente_conferencia") {
    if (!sel) return;
    setErro("");
    try {
      const atual = await auditMarcar(
        sel.id,
        sel.status_auditoria || "pendente_conferencia",
        sel.observacao_laboratorio || "",
        [{ item_id, status: novo }]
      );
      setSel(atual);
      setLista((l) => l.map((a) => (a.id === atual.id ? atual : a)));
      setOk("Item conferido.");
    } catch (e: any) {
      setErro(e?.response?.data?.detail ?? "Erro ao validar item.");
    }
  }

  async function marcar(novoStatus: "aprovado" | "divergente") {
    if (!sel) return;
    setErro("");
    setOk("");
    try {
      await auditMarcar(sel.id, novoStatus, obs);
      setSel(null);
      setObs("");
      setOk(`Pedido marcado como ${novoStatus}.`);
      await carregarAuditoria();
    } catch (e: any) {
      setErro(e?.response?.data?.detail ?? "Erro ao marcar pedido.");
    }
  }

  async function solicitar() {
    if (!sel) return;
    setErro("");
    setOk("");
    try {
      await auditSolicitarAutorizacao(sel.id);
      setSel(null);
      setObs("");
      setOk("Autorização solicitada à secretaria.");
      await carregarAuditoria();
    } catch (e: any) {
      setErro(e?.response?.data?.detail ?? "Erro ao solicitar autorização.");
    }
  }

  async function processarAnalise(aprovado: boolean) {
    if (!pedidoModal) return;
    setAnalisando(true);
    setErro("");
    try {
      await labAnalisarPedidoAjuste(pedidoModal.id, {
        aprovado,
        resposta: respostaAnalise.trim(),
      });
      setOk(`Pedido de ajuste ${aprovado ? "aprovado" : "rejeitado"} com sucesso.`);
      setPedidoModal(null);
      setRespostaAnalise("");
      await carregarAjustes();
    } catch (e: any) {
      setErro(e?.response?.data?.detail ?? "Erro ao analisar pedido de ajuste.");
    } finally {
      setAnalisando(false);
    }
  }

  const pendentesCount = pedidosAjuste.filter((x) => x.status === "pendente").length;

  const pedidosAjusteFiltrados = pedidosAjuste.filter((p) => {
    if (!buscaAjuste.trim()) return true;
    const q = buscaAjuste.toLowerCase();
    return (
      (p.paciente_nome && p.paciente_nome.toLowerCase().includes(q)) ||
      (p.laboratorio_nome && p.laboratorio_nome.toLowerCase().includes(q)) ||
      String(p.solicitacao_id).includes(q) ||
      (p.justificativa && p.justificativa.toLowerCase().includes(q)) ||
      (p.tipo_ajuste && p.tipo_ajuste.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-4">
      {/* Cabeçalho e Abas de Navegação */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sus-900/10 pb-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-lg font-bold text-sus-950">
            <FileSearch className="h-5 w-5 text-teal" /> Regulação e Auditoria Laboratorial
          </h2>
          <p className="text-xs text-ink/65">
            Conferência de itens faturáveis e análise de divergências notificadas pelos laboratórios.
          </p>
        </div>

        {/* Abas e Navegação */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-2xl bg-sand/60 p-1">
            <button
              type="button"
              onClick={() => setAba("ajustes")}
              className={`flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition ${
                aba === "ajustes"
                  ? "bg-white text-sus-950 shadow-xs"
                  : "text-ink/65 hover:text-sus-950"
              }`}
            >
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
              <span>Contestações e Ajustes</span>
              {pendentesCount > 0 && (
                <span className="rounded-full bg-amber-500 px-1.5 py-0.2 text-[10px] font-bold text-white">
                  {pendentesCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setAba("auditoria")}
              className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition ${
                aba === "auditoria"
                  ? "bg-white text-sus-950 shadow-xs"
                  : "text-ink/65 hover:text-sus-950"
              }`}
            >
              Conferência de Exames
            </button>
          </div>

          <Link
            to="/lab/auditoria-laudos"
            className="flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-3 py-1.5 text-xs font-semibold transition"
          >
            <FileCheck className="h-3.5 w-3.5" />
            Laudos com Inconsistência
          </Link>
        </div>
      </div>

      {erro && (
        <p className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700 font-medium">
          {erro}
        </p>
      )}
      {ok && (
        <p className="rounded-xl bg-teal/10 px-4 py-2 text-sm text-teal font-medium">
          {ok}
        </p>
      )}

      {/* ABA 1: CONFERÊNCIA DE EXAMES (AUDITORIA) */}
      {aba === "auditoria" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-ink/65">
              Filtrar por status de auditoria:
            </span>
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-auto min-w-[180px] !h-9 text-xs"
            >
              <option value="">Todos os status</option>
              {STATUS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </div>

          <Card className="overflow-hidden border-sus-900/10 shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-sus-900/10 bg-sand text-xs uppercase text-sus-900/60">
                    <th className="px-4 py-3 font-semibold">Paciente</th>
                    <th className="px-4 py-3 font-semibold">Data / Laboratório</th>
                    <th className="px-4 py-3 font-semibold">Itens</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 text-right font-semibold">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((a) => (
                    <tr key={a.id} className="border-b border-sus-900/5 last:border-0 hover:bg-sand/30">
                      <td className="px-4 py-3 font-semibold text-sus-950">
                        {a.paciente_nome}
                        <p className="text-xs font-normal text-ink/50">Pedido #{a.id}</p>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {String(a.data_agendada).slice(0, 10).split("-").reverse().join("/")}
                        <p className="text-ink/60 font-medium">{a.laboratorio}</p>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <span className="rounded bg-sand px-1.5 py-0.5 font-bold">
                          {a.itens?.length ?? 0} exame(s)
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <span className="rounded-md bg-amber-50 px-2 py-0.5 font-semibold text-amber-800 border border-amber-200">
                          {a.status_auditoria || a.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          onClick={() => {
                            setSel(a);
                            setObs(a.observacao_laboratorio ?? "");
                          }}
                          className="!h-8 px-3 text-xs"
                        >
                          <FileSearch className="h-3.5 w-3.5" /> Conferir
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {lista.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-ink/45">
                        Nenhum pedido pendente de conferência nesta consulta.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <Paginacao
              page={page}
              pages={pages}
              total={total}
              onPage={(p) => carregarAuditoria(p).catch(() => setErro("Falha ao carregar auditoria."))}
            />
          </Card>
        </div>
      )}

      {/* ABA 2: PEDIDOS DE AJUSTE DO LABORATÓRIO */}
      {aba === "ajustes" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex-1 min-w-[240px] max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/40 pointer-events-none" />
              <Input
                value={buscaAjuste}
                onChange={(e) => setBuscaAjuste(e.target.value)}
                placeholder="Buscar paciente, laboratório, pedido, justificativa..."
                className="!pl-9 !h-9 text-xs"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-ink/65">
                Filtrar status:
              </span>
              <Select
                value={filtroStatusAjuste}
                onChange={(e) => setFiltroStatusAjuste(e.target.value)}
                className="w-auto min-w-[180px] !h-9 text-xs"
              >
                <option value="todos">Todos os status</option>
                <option value="pendente">Apenas Pendentes de Análise</option>
                <option value="aprovado">Aprovados</option>
                <option value="rejeitado">Rejeitados</option>
              </Select>
            </div>
          </div>

          <Card className="overflow-hidden border-sus-900/10 shadow-xs">
            {carregandoAjustes ? (
              <div className="py-12 text-center text-ink/50">
                <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-teal border-t-transparent mb-2" />
                <p className="text-xs">Carregando pedidos de ajuste...</p>
              </div>
            ) : pedidosAjuste.length === 0 ? (
              <div className="p-10 text-center text-ink/45">
                <CheckCircle2 className="mx-auto h-8 w-8 text-teal/40 mb-2" />
                <p className="font-semibold text-sus-950">Nenhum pedido de ajuste encontrado</p>
                <p className="text-xs text-ink/50 mt-1">
                  Não existem contestações ou pedidos de modificação para o filtro de status atual.
                </p>
              </div>
            ) : pedidosAjusteFiltrados.length === 0 ? (
              <div className="p-10 text-center text-ink/45">
                <FileSearch className="mx-auto h-8 w-8 text-ink/30 mb-2" />
                <p className="font-semibold text-sus-950">Nenhum registro encontrado</p>
                <p className="text-xs text-ink/50 mt-1">
                  Nenhum pedido de ajuste corresponde ao termo pesquisado: "{buscaAjuste}".
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-sus-900/10 bg-sand text-xs uppercase text-sus-900/60">
                      <th className="px-4 py-3 font-semibold">Paciente / Pedido</th>
                      <th className="px-4 py-3 font-semibold">Laboratório / Data</th>
                      <th className="px-4 py-3 font-semibold">Tipo de Ajuste</th>
                      <th className="px-4 py-3 font-semibold">Justificativa</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3 text-right font-semibold">Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pedidosAjusteFiltrados.map((p) => (
                      <tr key={p.id} className="border-b border-sus-900/5 last:border-0 hover:bg-sand/30">
                        <td className="px-4 py-3">
                          <p className="font-semibold text-sus-950">{p.paciente_nome}</p>
                          <span className="font-mono text-xs text-ink/50">Pedido #{p.solicitacao_id}</span>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <p className="font-medium text-ink/80">{p.laboratorio_nome}</p>
                          <span className="text-ink/50 text-[11px] flex items-center gap-1 mt-0.5">
                            <Clock className="h-3 w-3" />
                            {p.created_at ? new Date(p.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—"}
                          </span>
                          {p.solicitado_por && (
                            <span className="text-[10px] text-ink/40 block">Por: {p.solicitado_por}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <span className="rounded bg-sand px-2 py-0.5 font-medium text-sus-950">
                            {p.tipo_ajuste.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-ink/75 max-w-sm">
                          <p className="truncate font-medium text-sus-900" title={p.justificativa}>
                            {p.justificativa}
                          </p>
                          {p.itens_propostos && Array.isArray(p.itens_propostos) && p.itens_propostos.length > 0 && (
                            <span className="mt-0.5 inline-block text-[10px] text-teal font-semibold">
                              + {p.itens_propostos.length} item(ns) proposto(s)
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <span
                            className={`rounded-md px-2 py-0.5 font-semibold uppercase text-[10px] ${
                              p.status === "aprovado"
                                ? "bg-emerald-100 text-emerald-800"
                                : p.status === "rejeitado"
                                ? "bg-red-100 text-red-700"
                                : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            {p.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            onClick={() => {
                              setPedidoModal(p);
                              setRespostaAnalise(p.resposta || p.resposta_secretaria || "");
                            }}
                            className="!h-8 px-3 text-xs"
                          >
                            <MessageSquare className="h-3.5 w-3.5" />
                            {p.status === "pendente" ? "Analisar" : "Ver Detalhes"}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Modal de Análise do Pedido de Ajuste */}
      {pedidoModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-sus-950/60 p-3 sm:p-5"
          onClick={() => setPedidoModal(null)}
        >
          <div
            className="rise max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between border-b border-sus-900/10 pb-3">
              <div>
                <h3 className="font-display text-base font-bold text-sus-950 flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-600" />
                  Análise de Pedido de Ajuste #{pedidoModal.id}
                </h3>
                <p className="mt-0.5 text-xs text-ink/65">
                  Paciente: <strong>{pedidoModal.paciente_nome}</strong> · Lab: <strong>{pedidoModal.laboratorio_nome}</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPedidoModal(null)}
                className="rounded-xl p-2 text-ink/50 hover:bg-sand transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="rounded-xl bg-sand/30 p-3 border border-sus-900/10 space-y-1">
                <p className="text-[10px] text-ink/50 uppercase font-bold">Tipo de Ajuste</p>
                <p className="font-semibold text-sus-950">{pedidoModal.tipo_ajuste.replace(/_/g, " ")}</p>
                <p className="text-[10px] text-ink/50 uppercase font-bold mt-2">Justificativa do Laboratório</p>
                <p className="text-ink/85">{pedidoModal.justificativa}</p>
                {pedidoModal.solicitado_por && (
                  <p className="text-[10px] text-ink/50 pt-1">
                    Enviado por: <strong>{pedidoModal.solicitado_por}</strong> em{" "}
                    {pedidoModal.created_at ? new Date(pedidoModal.created_at).toLocaleString("pt-BR") : "—"}
                  </p>
                )}
              </div>

              {pedidoModal.itens_propostos && Array.isArray(pedidoModal.itens_propostos) && pedidoModal.itens_propostos.length > 0 && (
                <div className="rounded-xl border border-sus-900/10 p-3">
                  <p className="text-[10px] text-ink/50 uppercase font-bold mb-2">Itens / Procedimentos Propostos</p>
                  <div className="space-y-1.5">
                    {pedidoModal.itens_propostos.map((it: any, idx: number) => (
                      <div key={idx} className="flex items-center justify-between rounded-lg bg-sand/40 px-2.5 py-1.5 text-xs">
                        <span className="font-medium text-sus-950">{it.codigo || it.sigtap_id || "Exame"} - {it.descricao || it.nome || "Item"}</span>
                        {it.quantidade && <span className="font-semibold text-ink/60">Qtd: {it.quantidade}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <Label>Despacho / Resposta da Secretaria de Saúde</Label>
                <textarea
                  rows={3}
                  value={respostaAnalise}
                  onChange={(e) => setRespostaAnalise(e.target.value)}
                  placeholder="Insira o parecer de aprovação ou motivo da rejeição..."
                  className="w-full rounded-xl border border-sus-900/15 bg-white p-3 text-sm text-ink outline-none focus:border-teal disabled:bg-sand/30 disabled:text-ink/70"
                  disabled={pedidoModal.status !== "pendente"}
                />
              </div>

              {pedidoModal.status === "pendente" ? (
                <div className="flex items-center justify-end gap-2 pt-3 border-t border-sus-900/10">
                  <Button
                    type="button"
                    onClick={() => processarAnalise(false)}
                    disabled={analisando}
                    className="border border-red-200 bg-white text-red-600 hover:bg-red-50 !h-9 text-xs"
                  >
                    <Ban className="h-3.5 w-3.5" /> Rejeitar Ajuste
                  </Button>
                  <Button
                    type="button"
                    onClick={() => processarAnalise(true)}
                    disabled={analisando}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white !h-9 text-xs"
                  >
                    <Check className="h-3.5 w-3.5" /> Aprovar Ajuste
                  </Button>
                </div>
              ) : (
                <div className="pt-2 text-center text-xs text-ink/50 border-t border-sus-900/10">
                  Pedido já analisado por <strong>{pedidoModal.analisado_por || "auditor"}</strong> em{" "}
                  {pedidoModal.analisado_em ? new Date(pedidoModal.analisado_em).toLocaleString("pt-BR") : "—"}.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal Legado de Detalhes do Pedido Físico */}
      {sel && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4" onClick={() => setSel(null)}>
          <div className="rise max-h-[90vh] w-full max-w-xl overflow-auto rounded-2xl bg-white p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <p className="font-display text-base font-bold text-sus-950">Pedido físico × sistema · #{sel.id}</p>
              <button onClick={() => setSel(null)} className="rounded-lg p-2 text-ink/50 hover:bg-sand"><X className="h-4 w-4" /></button>
            </div>
            <p className="mb-3 text-sm text-ink/60">
              <b>{sel.paciente_nome}</b> · {sel.laboratorio} · {String(sel.data_agendada).slice(0, 10).split("-").reverse().join("/")}
            </p>
            <div className="space-y-2">
              {(sel.itens ?? []).map((it) => (
                <div key={it.id ?? it.sigtap_id} className={`flex items-center gap-2 rounded-xl border p-3 text-sm ${it.divergente ? "border-red-200 bg-red-50" : it.conferido ? "border-teal/30 bg-teal/10" : "border-sus-900/10"}`}>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{it.codigo} · {it.descricao}{it.quantidade > 1 ? ` ×${it.quantidade}` : ""}</p>
                    <p className="text-xs text-ink/55">{it.status_auditoria}{it.quantidade > 1 ? ` · qtd ${it.quantidade}` : ""}</p>
                  </div>
                  <button onClick={() => validarItem(it.id, "aprovado")} className="rounded-lg p-2 text-teal hover:bg-teal/10" title="Validar item">
                    <CheckCircle2 className="h-4 w-4" />
                  </button>
                  <button onClick={() => validarItem(it.id, "divergente")} className="rounded-lg p-2 text-red-600 hover:bg-red-100" title="Marcar divergente">
                    <AlertTriangle className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {(sel.itens ?? []).length === 0 && <p className="py-4 text-center text-sm text-ink/45">Pedido sem itens.</p>}
            </div>
            <div className="mt-4">
              <Label>Observação do laboratório</Label>
              <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm" placeholder="Divergência, item incorreto, motivo…" />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={() => marcar("aprovado")} className="bg-teal text-sus-950 !h-9 text-xs"><CheckCircle2 className="h-4 w-4" /> Aprovar pedido</Button>
              <Button onClick={() => marcar("divergente")} className="bg-red-600 !h-9 text-xs"><AlertTriangle className="h-4 w-4" /> Marcar divergente</Button>
              <Button onClick={solicitar} className="!h-9 text-xs"><Send className="h-4 w-4" /> Solicitar autorização</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
