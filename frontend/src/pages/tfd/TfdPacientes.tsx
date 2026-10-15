import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Eye, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  fetchUnidadesSaude,
  tfdAtualizarPaciente,
  tfdCriarPaciente,
  tfdExcluirPaciente,
  tfdPacientes,
  pagData,
  pagMeta,
  type Paciente,
  type UnidadeSaude,
} from "../../services/api";
import { Button, Card, Input, Label } from "../../components/ui/primitives";
import Paginacao from "../../components/Paginacao";
import ExportarExcel from "../../components/ExportarExcel";
import PerfilPaciente from "../../components/PerfilPaciente";

const vazio = { nome: "", cpf: "", cns: "", nascimento: "", telefone: "", endereco: "", endereco_numero: "", bairro: "", cep: "", unidade_saude_id: "", equipe_esf: "", acs_nome: "", observacoes: "" };

export default function TfdPacientes() {
  const [lista, setLista] = useState<Paciente[]>([]);
  const [sp] = useSearchParams();
  const [q, setQ] = useState("");
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(vazio);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [unidades, setUnidades] = useState<UnidadeSaude[]>([]);
  const [perfilId, setPerfilId] = useState<number | null>(null);

  async function carregar(p = 1) {
    const r = await tfdPacientes(q || undefined, p, 100);
    setLista(pagData<Paciente>(r));
    const m = pagMeta(r);
    setTotal(m.total);
    setPage(m.page);
    setPages(m.pages);
  }
  useEffect(() => {
    const t = setTimeout(() => carregar(1), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    carregar().catch(() => setErro("Falha ao carregar."));
    fetchUnidadesSaude().then(setUnidades).catch(() => {});
  }, []);

  useEffect(() => {
    const rid = Number(sp.get("registro"));
    if (!rid || modal) return;
    if (lista.some((x) => x.id === rid)) abrirModal(rid);
  }, [sp, lista, modal]);

  function abrirModal(id?: number) {
    if (id) {
      const p = lista.find((x) => x.id === id);
      if (p) {
        setEditId(p.id);
        setForm({ nome: p.nome, cpf: p.cpf, cns: p.cns, nascimento: p.nascimento ?? "", telefone: p.telefone, endereco: p.endereco, endereco_numero: p.endereco_numero ?? "", bairro: p.bairro ?? "", cep: p.cep ?? "", unidade_saude_id: p.unidade_saude_id ? String(p.unidade_saude_id) : "", equipe_esf: p.equipe_esf ?? "", acs_nome: p.acs_nome ?? "", observacoes: p.observacoes });
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
    if (form.nome.trim().length < 2) {
      setErro("Nome obrigatório.");
      return;
    }
    const payload: Record<string, unknown> = {
      ...form,
      nascimento: form.nascimento || null,
      unidade_saude_id: form.unidade_saude_id ? Number(form.unidade_saude_id) : null,
    };
    try {
      if (editId) {
        await tfdAtualizarPaciente(editId, payload);
        fecharModal();
        setOk("Paciente atualizado.");
      } else {
        await tfdCriarPaciente(payload);
        fecharModal();
        setOk("Paciente cadastrado.");
      }
      await carregar();
    } catch {
      setErro("Erro ao salvar.");
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="font-display text-lg font-bold text-sus-950">Pacientes</h2>
        <Input placeholder="Buscar nome/CPF…" value={q} onChange={(e) => setQ(e.target.value)} className="ml-auto max-w-xs" />
        <ExportarExcel url="/api/tfd/pacientes/exportar" arquivo="pacientes" params={{ q: q.trim() || undefined }} />
        <Button onClick={() => abrirModal()}><Plus className="h-4 w-4" /> Novo paciente</Button>
      </div>
      {erro && !modal && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
      {ok && <p className="mb-3 rounded-xl bg-teal/10 px-3 py-2 text-sm text-teal">{ok}</p>}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b border-sus-900/10 bg-sand text-xs uppercase text-sus-900/60">
            <th className="px-4 py-3">Nome</th><th className="px-4 py-3">CPF/CNS</th><th className="px-4 py-3">Telefone</th><th className="px-4 py-3 text-right">Ações</th>
          </tr></thead>
          <tbody>
            {lista.map((p) => (
              <tr key={p.id} className="border-b border-sus-900/5 last:border-0">
                <td className="px-4 py-3 font-semibold">{p.nome}<p className="text-xs font-normal text-ink/50">{p.endereco || "—"}</p></td>
                <td className="px-4 py-3 text-xs">{p.cpf || "—"}<br />{p.cns || ""}</td>
                <td className="px-4 py-3 text-xs">{p.telefone || "—"}</td>
                <td className="px-4 py-3"><div className="flex justify-end gap-1">
                  <button onClick={() => setPerfilId(p.id)} className="rounded-lg p-2 text-teal hover:bg-teal/10" title="Ver perfil e demanda"><Eye className="h-4 w-4" /></button>
                  <button onClick={() => abrirModal(p.id)} className="rounded-lg p-2 text-sus-800 hover:bg-sus-100"><Pencil className="h-4 w-4" /></button>
                  <button onClick={async () => { if (confirm("Excluir paciente?")) { await tfdExcluirPaciente(p.id); carregar(); } }} className="rounded-lg p-2 text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
                </div></td>
              </tr>
            ))}
            {lista.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-ink/45">Nenhum paciente.</td></tr>}
          </tbody>
        </table>
        </div>
        <Paginacao page={page} pages={pages} total={total} onPage={(p) => carregar(p).catch(() => setErro("Falha ao carregar."))} />
      </Card>

      {perfilId !== null && (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-sus-950/50 p-4" onClick={() => setPerfilId(null)}>
          <div className="max-h-[90vh] w-full max-w-4xl overflow-auto rounded-2xl bg-white p-6 shadow-card md:p-8" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <p className="font-display text-lg font-bold text-sus-950">Perfil do paciente</p>
              <button onClick={() => setPerfilId(null)} className="rounded-lg p-2 text-ink/50 hover:bg-sand" aria-label="Fechar"><X className="h-4 w-4" /></button>
            </div>
            <PerfilPaciente pid={perfilId} />
          </div>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4" onClick={fecharModal}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <p className="font-display text-base font-bold text-sus-950">{editId ? "Editar paciente" : "Novo paciente"}</p>
              <button onClick={fecharModal} className="rounded-lg p-2 text-ink/50 hover:bg-sand"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-4">
                <div className="md:col-span-2"><Label>Nome *</Label><Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></div>
                <div><Label>CPF</Label><Input value={form.cpf} onChange={(e) => setForm({ ...form, cpf: e.target.value })} placeholder="000.000.000-00" /></div>
                <div><Label>CNS</Label><Input value={form.cns} onChange={(e) => setForm({ ...form, cns: e.target.value })} /></div>
                <div><Label>Nascimento</Label><Input type="date" value={form.nascimento} onChange={(e) => setForm({ ...form, nascimento: e.target.value })} /></div>
                <div><Label>Telefone</Label><Input value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} /></div>
                <div className="md:col-span-2"><Label>Logradouro</Label><Input value={form.endereco} onChange={(e) => setForm({ ...form, endereco: e.target.value })} placeholder="Rua/Avenida" /></div>
                <div><Label>Nº</Label><Input value={form.endereco_numero} onChange={(e) => setForm({ ...form, endereco_numero: e.target.value })} /></div>
                <div><Label>Bairro</Label><Input value={form.bairro} onChange={(e) => setForm({ ...form, bairro: e.target.value })} /></div>
                <div><Label>CEP</Label><Input value={form.cep} onChange={(e) => setForm({ ...form, cep: e.target.value })} placeholder="00000-000" /></div>
                <div className="md:col-span-2">
                  <Label>Unidade de Saúde (PSF/USF)</Label>
                  <select value={form.unidade_saude_id} onChange={(e) => setForm({ ...form, unidade_saude_id: e.target.value })} className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
                    <option value="">Selecionar…</option>
                    {unidades.filter((u) => u.ativo).map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
                  </select>
                </div>
                <div><Label>Equipe (eSF)</Label><Input value={form.equipe_esf} onChange={(e) => setForm({ ...form, equipe_esf: e.target.value })} placeholder="Ex: eSF-01" /></div>
                <div><Label>ACS</Label><Input value={form.acs_nome} onChange={(e) => setForm({ ...form, acs_nome: e.target.value })} placeholder="Nome do agente" /></div>
                <div className="md:col-span-4"><Label>Observações</Label><Input value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} /></div>
              </div>
              {erro && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
              <Button onClick={salvar} className="w-full"><Plus className="h-4 w-4" />{editId ? "Atualizar" : "Cadastrar"}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}