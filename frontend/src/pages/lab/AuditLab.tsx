import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, FileSearch, Send, X } from "lucide-react";
import {
  auditListar,
  auditMarcar,
  auditSolicitarAutorizacao,
  mapAudit,
  pagData,
  pagMeta,
  type AuditItem,
} from "../../services/api";
import { Button, Card, Label } from "../../components/ui/primitives";
import Paginacao from "../../components/Paginacao";

const STATUS = ["pendente_conferencia", "aprovado", "divergente", "aguardando_autorizacao_sec"];

export default function AuditLab() {
  const [status, setStatus] = useState("");
  const [lista, setLista] = useState<AuditItem[]>([]);
  const [sel, setSel] = useState<AuditItem | null>(null);
  const [obs, setObs] = useState("");
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);

  async function carregar(p = page) {
    const r = await auditListar(status || undefined, p, 100);
    const arr = pagData<any>(r);
    setLista(arr.map(mapAudit));
    const m = pagMeta(r);
    setTotal(m.total);
    setPage(m.page);
    setPages(m.pages);
  }

  useEffect(() => {
    carregar(1).catch(() => setErro("Falha ao carregar auditoria."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function validarItem(item_id: number, novo: "aprovado" | "divergente" | "pendente_conferencia") {
    if (!sel) return;
    setErro("");
    try {
      const atual = await auditMarcar(sel.id, sel.status_auditoria || "pendente_conferencia", sel.observacao_laboratorio || "", [
        { item_id, status: novo },
      ]);
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
      await carregar();
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
      await carregar();
    } catch (e: any) {
      setErro(e?.response?.data?.detail ?? "Erro ao solicitar autorização.");
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold text-sus-950">
          <FileSearch className="h-5 w-5" /> Auditoria laboratorial
        </h2>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="ml-auto rounded-xl border border-sus-900/15 bg-white px-3 py-2 text-sm">
          <option value="">Todos</option>
          {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {erro && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
      {ok && <p className="mb-3 rounded-xl bg-teal/10 px-3 py-2 text-sm text-teal">{ok}</p>}

      <Card className="overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-sus-900/10 bg-sand text-xs uppercase text-sus-900/60">
              <th className="px-4 py-3">Paciente</th>
              <th className="px-4 py-3">Data / Lab</th>
              <th className="px-4 py-3">Itens</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Conferir</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((a) => (
              <tr key={a.id} className="border-b border-sus-900/5 last:border-0">
                <td className="px-4 py-3 font-semibold">{a.paciente_nome}<p className="text-xs font-normal text-ink/50">#{a.id}</p></td>
                <td className="px-4 py-3 text-xs">{String(a.data_agendada).slice(0, 10).split("-").reverse().join("/")}<p className="text-ink/50">{a.laboratorio}</p></td>
                <td className="px-4 py-3 text-xs">{a.itens?.length ?? 0}</td>
                <td className="px-4 py-3 text-xs">{a.status_auditoria || a.status}</td>
                <td className="px-4 py-3 text-right">
                  <Button onClick={() => { setSel(a); setObs(a.observacao_laboratorio ?? ""); }} className="px-3 py-1.5 text-xs">
                    <FileSearch className="h-3.5 w-3.5" /> Abrir
                  </Button>
                </td>
              </tr>
            ))}
            {lista.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-ink/45">Nada pendente.</td></tr>}
          </tbody>
        </table>
        <Paginacao page={page} pages={pages} total={total} onPage={(p) => carregar(p).catch(() => setErro("Falha ao carregar auditoria."))} />
      </Card>

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
              <Button onClick={() => marcar("aprovado")} className="bg-teal text-sus-950"><CheckCircle2 className="h-4 w-4" /> Aprovar pedido</Button>
              <Button onClick={() => marcar("divergente")} className="bg-red-600"><AlertTriangle className="h-4 w-4" /> Marcar divergente</Button>
              <Button onClick={solicitar}><Send className="h-4 w-4" /> Solicitar autorização</Button>
            </div>
            {erro && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
