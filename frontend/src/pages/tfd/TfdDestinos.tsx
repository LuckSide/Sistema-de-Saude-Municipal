import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2, ShieldCheck, ShieldOff, X } from "lucide-react";
import {
  tfdCriarDestino,
  tfdAtualizarDestino,
  tfdExcluirDestino,
  tfdDestinos,
  pagData,
  pagMeta,
  type Destino,
} from "../../services/api";
import { Badge, Button, Card, Input, Label } from "../../components/ui/primitives";
import Paginacao from "../../components/Paginacao";

const vazio = { nome_destino: "", hospital_referencia: "", procedimento_sigtap: "", codigo_desloc_pac: "", qtd_desloc_pac: "", codigo_desloc_acomp: "", qtd_desloc_acomp: "", ativo: true };

export default function TfdDestinos() {
  const [lista, setLista] = useState<Destino[]>([]);
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(vazio);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);

  async function carregar(p = page) {
    const r = await tfdDestinos(p, 100);
    setLista(pagData<Destino>(r));
    const m = pagMeta(r);
    setTotal(m.total);
    setPage(m.page);
    setPages(m.pages);
  }
  useEffect(() => {
    carregar(1).catch(() => setErro("Falha ao carregar destinos."));
  }, []);

  function abrirModal(id?: number) {
    if (id) {
      const d = lista.find((x) => x.id === id);
      if (d) {
        setEditId(d.id);
        setForm({ nome_destino: d.nome_destino, hospital_referencia: d.hospital_referencia, procedimento_sigtap: d.procedimento_sigtap, codigo_desloc_pac: d.codigo_desloc_pac ?? "", qtd_desloc_pac: d.qtd_desloc_pac ? String(d.qtd_desloc_pac) : "", codigo_desloc_acomp: d.codigo_desloc_acomp ?? "", qtd_desloc_acomp: d.qtd_desloc_acomp ? String(d.qtd_desloc_acomp) : "", ativo: d.ativo });
      }
    } else {
      setEditId(null);
      setForm(vazio);
    }
    setModal(true);
  }

  function fecharModal() {
    setModal(false);
    setEditId(null);
    setForm(vazio);
    setErro("");
    setOk("");
  }

  async function salvar() {
    setErro("");
    setOk("");
    if (!form.nome_destino.trim()) {
      setErro("Nome do destino é obrigatório.");
      return;
    }
    const payload = { ...form, qtd_desloc_pac: Number(form.qtd_desloc_pac) || 0, qtd_desloc_acomp: Number(form.qtd_desloc_acomp) || 0 };
    try {
      if (editId) {
        await tfdAtualizarDestino(editId, payload);
        fecharModal();
        setOk("Destino atualizado.");
      } else {
        await tfdCriarDestino(payload);
        fecharModal();
        setOk("Destino cadastrado.");
      }
      await carregar();
    } catch {
      setErro("Erro ao salvar destino.");
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="font-display text-lg font-bold text-sus-950">Destinos de Viagem (TFD)</h2>
        <Button onClick={() => abrirModal()} className="ml-auto"><Plus className="h-4 w-4" /> Novo destino</Button>
      </div>
      {erro && !modal && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
      {ok && <p className="mb-3 rounded-xl bg-teal/10 px-3 py-2 text-sm text-teal">{ok}</p>}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-sus-900/10 bg-sand text-xs uppercase text-sus-900/60">
              <th className="px-4 py-3">Destino</th>
              <th className="px-4 py-3">Hospital referência</th>
              <th className="px-4 py-3">Desloc. paciente</th>
              <th className="px-4 py-3">Desloc. acomp.</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((d) => (
              <tr key={d.id} className="border-b border-sus-900/5 last:border-0">
                <td className="px-4 py-3 font-semibold">{d.nome_destino}</td>
                <td className="px-4 py-3 text-xs text-ink/60">{d.hospital_referencia || "—"}</td>
                <td className="px-4 py-3 text-xs font-mono">{d.codigo_desloc_pac || "—"}{d.qtd_desloc_pac ? ` ×${d.qtd_desloc_pac}` : ""}</td>
                <td className="px-4 py-3 text-xs font-mono">{d.codigo_desloc_acomp || "—"}{d.qtd_desloc_acomp ? ` ×${d.qtd_desloc_acomp}` : ""}</td>
                <td className="px-4 py-3">
                  <Badge variant={d.ativo ? "success" : "outline"}>
                    {d.ativo ? <ShieldCheck className="h-3 w-3" /> : <ShieldOff className="h-3 w-3" />}
                    {d.ativo ? "Ativo" : "Inativo"}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <button onClick={() => abrirModal(d.id)} className="rounded-lg p-2 text-sus-800 hover:bg-sus-100" title="Editar"><Pencil className="h-4 w-4" /></button>
                    <button onClick={async () => { if (confirm("Excluir destino?")) { await tfdExcluirDestino(d.id); carregar(); } }} className="rounded-lg p-2 text-red-600 hover:bg-red-50" title="Excluir"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
            {lista.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-ink/45">
                  Nenhum destino cadastrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
        <Paginacao page={page} pages={pages} total={total} onPage={(p) => carregar(p).catch(() => setErro("Falha ao carregar destinos."))} />
      </Card>

      {modal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4" onClick={fecharModal}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <p className="font-display text-base font-bold text-sus-950">{editId ? "Editar destino" : "Novo destino"}</p>
              <button onClick={fecharModal} className="rounded-lg p-2 text-ink/50 hover:bg-sand"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-4">
                <div className="md:col-span-2">
                  <Label>Nome do destino *</Label>
                  <Input value={form.nome_destino} onChange={(e) => setForm({ ...form, nome_destino: e.target.value })} placeholder="Ex: Belo Horizonte" />
                </div>
                <div>
                  <Label>Hospital de referência</Label>
                  <Input value={form.hospital_referencia} onChange={(e) => setForm({ ...form, hospital_referencia: e.target.value })} placeholder="Ex: Hospital das Clínicas" />
                </div>
                <div>
                  <Label>Procedimento SIGTAP</Label>
                  <Input value={form.procedimento_sigtap} onChange={(e) => setForm({ ...form, procedimento_sigtap: e.target.value })} placeholder="Código" />
                </div>
                <div>
                  <Label>Cód. desloc. paciente</Label>
                  <Input value={form.codigo_desloc_pac} onChange={(e) => setForm({ ...form, codigo_desloc_pac: e.target.value.replace(/\D/g, "").slice(0, 10) })} placeholder="9999900108" inputMode="numeric" />
                </div>
                <div>
                  <Label>Qtd. paciente (×50km)</Label>
                  <Input type="number" min={0} value={form.qtd_desloc_pac} onChange={(e) => setForm({ ...form, qtd_desloc_pac: e.target.value })} />
                </div>
                <div>
                  <Label>Cód. desloc. acomp.</Label>
                  <Input value={form.codigo_desloc_acomp} onChange={(e) => setForm({ ...form, codigo_desloc_acomp: e.target.value.replace(/\D/g, "").slice(0, 10) })} placeholder="9999900109" inputMode="numeric" />
                </div>
                <div>
                  <Label>Qtd. acomp. (×50km)</Label>
                  <Input type="number" min={0} value={form.qtd_desloc_acomp} onChange={(e) => setForm({ ...form, qtd_desloc_acomp: e.target.value })} />
                </div>
                <div className="flex items-end">
                  <Label className="w-full">Ativo</Label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} className="rounded border-sus-900/30" />
                    <span className="text-sm">Sim</span>
                  </label>
                </div>
              </div>
              {erro && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
              <Button onClick={salvar} className="w-full"><Plus className="h-4 w-4" />{editId ? "Atualizar" : "Cadastrar destino"}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}