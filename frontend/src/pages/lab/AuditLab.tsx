import { useEffect, useState } from "react";
import {
  CheckCircle2,
  AlertTriangle,
  FileSearch,
  Send,
  X,
  Clock,
  Layers,
  Check,
  Ban,
  MessageSquare,
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
import { Button, Card, Label } from "../../components/ui/primitives";
import Paginacao from "../../components/Paginacao";

const STATUS = ["pendente_conferencia", "aprovado", "divergente", "aguardando_autorizacao_sec"];

export default function AuditLab() {
  const [aba, setAba] = useState<"auditoria" | "ajustes">("auditoria");

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

        {/* Abas */}
        <div className="flex items-center gap-1.5 rounded-2xl bg-sand/60 p-1">
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
          <button
            type="button"
            onClick={() => setAba("ajustes")}
            className={`flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition ${
              aba === "ajustes"
                ? "bg-white text-sus-950 shadow-xs"
                : "text-ink/65 hover:text-sus-950"
            }`}
          >
            <span>Ajustes Solicitados</span>
            {pendentesCount > 0 && (
              <span className="rounded-full bg-amber-500 px-1.5 py-0.2 text-[10px] font-bold text-white">
                {pendentesCount}
              </span>
            )}
          </button>
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
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-ink/65">
              Filtrar por status de auditoria:
            </span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="rounded-xl border border-sus-900/15 bg-white px-3 py-1.5 text-xs outline-none focus:border-teal"
            >
              <option value="">Todos os status</option>
              {STATUS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
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
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-ink/65">
              Filtrar pedidos de ajuste:
            </span>
            <select
              value={filtroStatusAjuste}
              onChange={(e) => setFiltroStatusAjuste(e.target.value)}
              className="rounded-xl border border-sus-900/15 bg-white px-3 py-1.5 text-xs outline-none focus:border-teal"
            >
              <option value="todos">Todos</option>
              <option value="pendente">Apenas Pendentes de Análise</option>
              <option value="aprovado">Aprovados</option>
              <option value="rejeitado">Rejeitados</option>
            </select>
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
                  Não existem divergências ou pedidos de modificação pendentes para o filtro atual.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-sus-900/10 bg-sand text-xs uppercase text-sus-900/60">
                      <th className="px-4 py-3 font-semibold">Paciente / Pedido</th>
                      <th className="px-4 py-3 font-semibold">Laboratório</th>
                      <th className="px-4 py-3 font-semibold">Tipo de Ajuste</th>
                      <th className="px-4 py-3 font-semibold">Justificativa</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3 text-right font-semibold">Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pedidosAjuste.map((p) => (
                      <tr key={p.id} className="border-b border-sus-900/5 last:border-0 hover:bg-sand/30">
                        <td className="px-4 py-3">
                          <p className="font-semibold text-sus-950">{p.paciente_nome}</p>
                          <span className="font-mono text-xs text-ink/50">Pedido #{p.solicitacao_id}</span>
                        </td>
                        <td className="px-4 py-3 text-xs text-ink/75 font-medium">
                          {p.laboratorio_nome}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <span className="rounded bg-sand px-2 py-0.5 font-medium text-sus-950">
                            {p.tipo_ajuste.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-ink/75 max-w-sm">
                          <p className="truncate" title={p.justificativa}>
                            {p.justificativa}
                          </p>
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
                              setRespostaAnalise(p.resposta || "");
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
              </div>

              <div>
                <Label>Despacho / Resposta da Secretaria de Saúde</Label>
                <textarea
                  rows={3}
                  value={respostaAnalise}
                  onChange={(e) => setRespostaAnalise(e.target.value)}
                  placeholder="Insira o parecer de aprovação ou motivo da rejeição..."
                  className="w-full rounded-xl border border-sus-900/15 bg-white p-3 text-sm text-ink outline-none focus:border-teal"
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
                <div className="pt-2 text-center text-xs text-ink/50">
                  Pedido já analisado por {pedidoModal.analisado_por || "auditor"} em{" "}
                  {pedidoModal.analisado_em ? new Date(pedidoModal.analisado_em).toLocaleDateString("pt-BR") : "—"}.
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
