import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import {
  tfdAtualizarFatura,
  tfdCriarFatura,
  tfdExcluirFatura,
  tfdFaturas,
  tfdPacientes,
  pagData,
  pagMeta,
  type Fatura,
  type Paciente,
} from "../../services/api";
import { Button, Card, Input, Label } from "../../components/ui/primitives";
import Paginacao from "../../components/Paginacao";

function brl(v: number) {
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const vazio = {
  paciente_id: "",
  procedimento: "",
  codigo_sigtap: "",
  competencia: new Date().toISOString().slice(0, 7),
  quantidade: "1",
  valor: "",
  tipo: "BPA",
  status: "pendente",
  observacoes: "",
  viagem_id: "",
};

export default function TfdFaturamento() {
  const [lista, setLista] = useState<Fatura[]>([]);
  const [comp, setComp] = useState(() => new Date().toISOString().slice(0, 7));
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(vazio);
  const [pacientes, setPacientes] = useState<Paciente[]>([]);
  const [busca, setBusca] = useState("");
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [page, setPage] = useState(1);
  const [totalRegs, setTotalRegs] = useState(0);
  const [pages, setPages] = useState(1);

  async function carregar(p = page) {
    const r = await tfdFaturas(comp || undefined, p, 100);
    setLista(pagData<Fatura>(r));
    const m = pagMeta(r);
    setTotalRegs(m.total);
    setPage(m.page);
    setPages(m.pages);
  }
  useEffect(() => {
    carregar(1).catch(() => setErro("Falha ao carregar faturamento."));
  }, [comp]);
  useEffect(() => {
    tfdPacientes(busca || undefined).then((r) => setPacientes(pagData<Paciente>(r))).catch(() => {});
  }, [busca]);

  function abrirModal(id?: number) {
    if (id) {
      const f = lista.find((x) => x.id === id);
      if (f) {
        setEditId(f.id);
        setForm({ paciente_id: String(f.paciente_id), procedimento: f.procedimento, codigo_sigtap: f.codigo_sigtap, competencia: f.competencia, quantidade: String(f.quantidade), valor: String(f.valor), tipo: f.tipo, status: f.status, observacoes: f.observacoes, viagem_id: f.viagem_id ? String(f.viagem_id) : "" });
      }
    } else {
      setEditId(null);
      setForm({ ...vazio, competencia: comp });
    }
    setModal(true);
  }

  function fecharModal() {
    setModal(false);
    setEditId(null);
    setForm({ ...vazio, competencia: comp });
    setErro("");
    setOk("");
  }

  const total = lista.reduce((s, f) => s + Number(f.total), 0);

  async function salvar() {
    setErro("");
    setOk("");
    if (!form.paciente_id || !form.procedimento || !form.competencia) {
      setErro("Paciente, procedimento e competência são obrigatórios.");
      return;
    }
    const payload: Record<string, unknown> = {
      ...form,
      paciente_id: Number(form.paciente_id),
      quantidade: Number(form.quantidade) || 1,
      valor: Number(form.valor) || 0,
      viagem_id: form.viagem_id ? Number(form.viagem_id) : null,
    };
    try {
      if (editId) {
        await tfdAtualizarFatura(editId, payload);
        fecharModal();
        setOk("Lançamento atualizado.");
      } else {
        await tfdCriarFatura(payload);
        fecharModal();
        setOk("Lançamento criado.");
      }
      await carregar();
    } catch {
      setErro("Erro ao salvar.");
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="font-display text-lg font-bold text-sus-950">Faturamento</h2>
        <input type="month" value={comp} onChange={(e) => setComp(e.target.value)} className="rounded-xl border border-sus-900/15 bg-white px-3 py-2 text-sm" />
        <span className="ml-auto rounded-xl bg-sus-900 px-3 py-2 font-display text-sm font-bold text-white">Total {brl(total)}</span>
        <Button onClick={() => abrirModal()}><Plus className="h-4 w-4" /> Novo lançamento</Button>
      </div>
      {erro && !modal && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
      {ok && <p className="mb-3 rounded-xl bg-teal/10 px-3 py-2 text-sm text-teal">{ok}</p>}

      <Card className="overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b border-sus-900/10 bg-sand text-xs uppercase text-sus-900/60">
            <th className="px-4 py-3">Paciente</th><th className="px-4 py-3">Procedimento</th><th className="px-4 py-3">Comp.</th><th className="px-4 py-3">Total</th><th className="px-4 py-3 text-right">Ações</th>
          </tr></thead>
          <tbody>
            {lista.map((f) => (
              <tr key={f.id} className="border-b border-sus-900/5 last:border-0">
                <td className="px-4 py-3 font-semibold">{f.paciente_nome}<p className="text-xs font-normal text-ink/50">{f.tipo} · {f.status}</p></td>
                <td className="px-4 py-3">{f.procedimento}<p className="text-xs text-ink/50">{f.codigo_sigtap || "—"} · qtd {f.quantidade}</p></td>
                <td className="px-4 py-3 text-xs">{f.competencia}</td>
                <td className="px-4 py-3 font-bold">{brl(f.total)}</td>
                <td className="px-4 py-3"><div className="flex justify-end gap-1">
                  <button onClick={() => abrirModal(f.id)} className="rounded-lg p-2 text-sus-800 hover:bg-sus-100"><Pencil className="h-4 w-4" /></button>
                  <button onClick={async () => { if (confirm("Excluir lançamento?")) { await tfdExcluirFatura(f.id); carregar(); } }} className="rounded-lg p-2 text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
                </div></td>
              </tr>
            ))}
            {lista.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-ink/45">Nenhum lançamento.</td></tr>}
          </tbody>
        </table>
        <Paginacao page={page} pages={pages} total={totalRegs} onPage={(p) => carregar(p).catch(() => setErro("Falha ao carregar faturamento."))} />
      </Card>

      {modal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4" onClick={fecharModal}>
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <p className="font-display text-base font-bold text-sus-950">{editId ? "Editar lançamento" : "Novo lançamento"}</p>
              <button onClick={fecharModal} className="rounded-lg p-2 text-ink/50 hover:bg-sand"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-4">
                <div className="md:col-span-2">
                  <Label>Paciente *</Label>
                  <Input placeholder="Buscar paciente…" value={busca} onChange={(e) => setBusca(e.target.value)} />
                  <select value={form.paciente_id} onChange={(e) => setForm({ ...form, paciente_id: e.target.value })} className="mt-1 w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
                    <option value="">Selecionar…</option>
                    {pacientes.slice(0, 15).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                  </select>
                </div>
                <div className="md:col-span-2"><Label>Procedimento *</Label><Input value={form.procedimento} onChange={(e) => setForm({ ...form, procedimento: e.target.value })} placeholder="Ex: Consulta especializada" /></div>
                <div><Label>Código SIGTAP</Label><Input value={form.codigo_sigtap} onChange={(e) => setForm({ ...form, codigo_sigtap: e.target.value })} placeholder="Ex: 0301010072" /></div>
                <div><Label>Competência *</Label><Input type="month" value={form.competencia} onChange={(e) => setForm({ ...form, competencia: e.target.value })} /></div>
                <div><Label>Qtd</Label><Input type="number" min={1} value={form.quantidade} onChange={(e) => setForm({ ...form, quantidade: e.target.value })} /></div>
                <div><Label>Valor unit. R$</Label><Input type="number" min={0} step="0.01" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} /></div>
                <div>
                  <Label>Tipo</Label>
                  <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })} className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
                    <option value="BPA">BPA</option>
                    <option value="APAC">APAC</option>
                  </select>
                </div>
                <div>
                  <Label>Status</Label>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
                    {["pendente", "aprovado", "rejeitado"].map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="md:col-span-2"><Label>Observações</Label><Input value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} /></div>
              </div>
              {erro && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
              <Button onClick={salvar} className="w-full"><Plus className="h-4 w-4" />{editId ? "Atualizar" : "Lançar"}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}