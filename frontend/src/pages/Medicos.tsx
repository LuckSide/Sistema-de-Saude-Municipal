import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { type Medico, createMedico, deleteMedico, fetchMedicos, updateMedico } from "../services/api";
import { Button, Card, Input, Label } from "../components/ui/primitives";
import ExportarExcel from "../components/ExportarExcel";

const vazio = { nome: "", cpf: "", crm: "", cbo_codigo: "", cbo_descricao: "", especialidades: "", telefone: "", email: "", ativo: true };

export default function Medicos() {
  const [lista, setLista] = useState<Medico[]>([]);
  const [sp] = useSearchParams();
  const [form, setForm] = useState<typeof vazio>(vazio);
  const [editId, setEditId] = useState<number | null>(null);
  const [modal, setModal] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [erroModal, setErroModal] = useState("");
  const [ok, setOk] = useState("");

  async function carregar() {
    try { setLista(await fetchMedicos()); }
    catch { setErro("Falha ao carregar médicos."); }
  }
  useEffect(() => { carregar(); }, []);
  useEffect(() => {
    const rid = Number(sp.get("registro"));
    if (!rid || modal) return;
    const m = lista.find((x) => x.id === rid);
    if (m) abrir(m);
  }, [sp, lista, modal]);

  function abrir(m?: Medico) {
    setErroModal(""); setOk("");
    if (m) { setEditId(m.id); setForm({ nome: m.nome, cpf: m.cpf, crm: m.crm, cbo_codigo: m.cbo_codigo ?? "", cbo_descricao: m.cbo_descricao ?? "", especialidades: m.especialidades, telefone: m.telefone, email: m.email, ativo: m.ativo }); }
    else { setEditId(null); setForm(vazio); }
    setModal(true);
  }
  function fechar() { setModal(false); setEditId(null); setForm(vazio); setErroModal(""); }

  async function salvar() {
    setErroModal("");
    if (!form.nome.trim()) { setErroModal("Nome é obrigatório."); return; }
    setSalvando(true);
    try {
      if (editId) { await updateMedico(editId, form); setOk("Médico atualizado."); }
      else { await createMedico(form); setOk("Médico cadastrado."); }
      fechar(); await carregar();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? "Erro ao salvar.";
      setErroModal(msg);
    } finally { setSalvando(false); }
  }
  async function excluir(m: Medico) {
    if (!confirm(`Inativar ${m.nome}?`)) return;
    try { await deleteMedico(m.id); setOk("Médico inativado."); await carregar(); }
    catch { setErro("Falha ao inativar."); }
  }

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h1 className="font-display text-2xl font-extrabold text-sus-950">Médicos / profissionais</h1>
        <ExportarExcel url="/api/medicos/exportar" arquivo="medicos" />
        <Button onClick={() => abrir()} className="ml-auto"><Plus className="h-4 w-4" /> Novo médico</Button>
      </div>
      <p className="mb-4 mt-1 text-sm text-ink/55">Cadastro administrativo de médicos e profissionais de saúde.</p>
      {erro && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{erro}</p>}
      {ok && <p className="mb-3 rounded-xl bg-teal/10 px-3 py-2 text-sm font-medium text-teal">{ok}</p>}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b border-sus-900/10 bg-sand text-xs uppercase tracking-wide text-sus-900/60">
            <th className="px-4 py-3">Nome</th><th className="px-4 py-3">CRM</th><th className="px-4 py-3">Especialidades</th><th className="px-4 py-3">Contato</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Ações</th>
          </tr></thead>
          <tbody>
            {lista.map((m) => (
              <tr key={m.id} className="border-b border-sus-900/5 last:border-0">
                <td className="px-4 py-3"><p className="font-semibold text-sus-950">{m.nome}</p><p className="text-xs text-ink/50">{m.cpf || "—"}</p></td>
                <td className="px-4 py-3">{m.crm || "—"}<p className="text-xs text-ink/50">{m.cbo_codigo ? `CBO ${m.cbo_codigo}` : ""}{m.cbo_descricao ? ` · ${m.cbo_descricao}` : ""}</p></td>
                <td className="px-4 py-3 text-xs text-ink/60">{m.especialidades || "—"}</td>
                <td className="px-4 py-3 text-xs text-ink/60">{m.telefone || "—"} {m.email ? `· ${m.email}` : ""}</td>
                <td className="px-4 py-3 text-xs">{m.ativo ? "ativo" : "inativo"}</td>
                <td className="px-4 py-3"><div className="flex justify-end gap-1">
                  <button onClick={() => abrir(m)} className="rounded-lg p-2 text-sus-800 hover:bg-sus-100" title="Editar"><Pencil className="h-4 w-4" /></button>
                  <button onClick={() => excluir(m)} className="rounded-lg p-2 text-red-600 hover:bg-red-50" title="Inativar"><Trash2 className="h-4 w-4" /></button>
                </div></td>
              </tr>
            ))}
            {lista.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-ink/45">Nenhum médico.</td></tr>}
          </tbody>
        </table>
        </div>
      </Card>

      {modal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4" onClick={fechar}>
          <div className="rise max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl bg-white p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between gap-2">
              <p className="font-display text-base font-bold text-sus-950">{editId ? "Editar médico" : "Novo médico"}</p>
              <button onClick={fechar} className="rounded-lg p-2 text-ink/50 hover:bg-sand" aria-label="Fechar"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="md:col-span-2"><Label>Nome completo *</Label><Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></div>
              <div><Label>CPF</Label><Input value={form.cpf} onChange={(e) => setForm({ ...form, cpf: e.target.value })} /></div>
              <div><Label>CRM / registro</Label><Input value={form.crm} onChange={(e) => setForm({ ...form, crm: e.target.value })} /></div>
              <div><Label>CBO (código)</Label><Input value={form.cbo_codigo} onChange={(e) => setForm({ ...form, cbo_codigo: e.target.value.replace(/\D/g, "").slice(0, 6) })} placeholder="Ex: 225125" inputMode="numeric" /></div>
              <div className="md:col-span-2"><Label>CBO (descrição)</Label><Input value={form.cbo_descricao} onChange={(e) => setForm({ ...form, cbo_descricao: e.target.value })} placeholder="Ex: Médico clínico" /></div>
              <div className="md:col-span-2"><Label>Especialidade(s)</Label><Input value={form.especialidades} onChange={(e) => setForm({ ...form, especialidades: e.target.value })} placeholder="separar por vírgula" /></div>
              <div><Label>Telefone</Label><Input value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} /></div>
              <div><Label>E-mail</Label><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} className="h-4 w-4 accent-teal" /> Ativo</label>
            </div>
            {erroModal && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{erroModal}</p>}
            <Button onClick={salvar} disabled={salvando} className="mt-4 w-full">{salvando ? "Salvando…" : editId ? "Atualizar" : "Cadastrar"}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
