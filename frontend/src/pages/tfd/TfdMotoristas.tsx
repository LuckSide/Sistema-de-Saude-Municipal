import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import {
  tfdAtualizarMotorista,
  tfdCriarMotorista,
  tfdExcluirMotorista,
  tfdMotoristas,
  pagData,
  pagMeta,
  type Motorista,
} from "../../services/api";
import { Button, Card, Input, Label } from "../../components/ui/primitives";
import { useUndo } from "../../components/UndoToast";
import {
  erros422,
  toastCampos,
  validaCnh,
  validaCnhValidade,
  validaCpf,
  validaTelefone,
} from "../../utils/validacoes";
import Paginacao from "../../components/Paginacao";

const CATEGORIAS = ["", "A", "B", "C", "D", "E", "AB", "AC", "AD", "AE"];

const vazio = {
  nome: "", cpf: "", cnh_numero: "", cnh_categoria: "",
  cnh_validade: "", telefone: "", ativo: true,
};

function fmtValidade(s: string | null): string {
  if (!s) return "—";
  const b = s.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(b) ? b.split("-").reverse().join("/") : s;
}

export default function TfdMotoristas() {
  const { notificarUndo } = useUndo();
  const [lista, setLista] = useState<Motorista[]>([]);
  const [q, setQ] = useState("");
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(vazio);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [erros, setErros] = useState<Record<string, string>>({});
  const ROTULOS: Record<string, string> = {
    nome: "Nome completo", cpf: "CPF", cnh_numero: "CNH",
    cnh_validade: "Validade da CNH", telefone: "Telefone",
  };
  const borda = (c: string) => (erros[c] ? "!border-red-500 focus:!border-red-500" : "");
  const campoMsg = (c: string) =>
    erros[c] ? <p className="mt-1 text-xs font-medium text-red-600">{erros[c]}</p> : null;
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);

  async function carregar(p = 1, busca = q) {
    const r = await tfdMotoristas({ q: busca.trim() || undefined, page: p, limit: 100 });
    setLista(pagData<Motorista>(r));
    const m = pagMeta(r);
    setTotal(m.total);
    setPage(m.page);
    setPages(m.pages);
  }

  useEffect(() => {
    carregar(1).catch(() => setErro("Falha ao carregar motoristas."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(() => carregar(1).catch(() => {}), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function abrirModal(id?: number) {
    setErro("");
    setErros({});
    setOk("");
    if (id) {
      const m = lista.find((x) => x.id === id);
      if (m) {
        setEditId(m.id);
        setForm({
          nome: m.nome, cpf: m.cpf, cnh_numero: m.cnh_numero,
          cnh_categoria: m.cnh_categoria, cnh_validade: (m.cnh_validade || "").slice(0, 10),
          telefone: m.telefone, ativo: m.ativo,
        });
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
  }

  async function salvar() {
    setErro("");
    setOk("");
    const e: Record<string, string> = {};
    if (form.nome.trim().length < 2) e.nome = "Nome é obrigatório.";
    const cpf = validaCpf(form.cpf);
    if (cpf) e.cpf = cpf;
    const cnh = validaCnh(form.cnh_numero);
    if (cnh) e.cnh_numero = cnh;
    const val = validaCnhValidade(form.cnh_validade);
    if (val) e.cnh_validade = val;
    const tel = validaTelefone(form.telefone);
    if (tel) e.telefone = tel;
    if (Object.keys(e).length > 0) {
      setErros(e);
      setErro(toastCampos(e, ROTULOS));
      return;
    }
    const payload: Record<string, unknown> = {
      nome: form.nome.trim(),
      cpf: form.cpf.replace(/\D/g, "").slice(0, 11),
      cnh_numero: form.cnh_numero.trim(),
      cnh_categoria: form.cnh_categoria,
      cnh_validade: form.cnh_validade || null,
      telefone: form.telefone.trim(),
      ativo: form.ativo,
    };
    try {
      if (editId) await tfdAtualizarMotorista(editId, payload);
      else await tfdCriarMotorista(payload);
      fecharModal();
      setOk(editId ? "Motorista atualizado." : "Motorista cadastrado.");
      await carregar(page);
    } catch (err: unknown) {
      const deCampo = erros422(err, ROTULOS);
      const detalhe = (err as { response?: { data?: { detail?: unknown } } }).response?.data?.detail;
      const texto = typeof detalhe === "string" ? detalhe : "";
      const extra: Record<string, string> = { ...deCampo };
      if (Object.keys(extra).length === 0 && texto.includes("CPF")) extra.cpf = texto;
      if (Object.keys(extra).length > 0) {
        setErros(extra);
        setErro(toastCampos(extra, ROTULOS));
        return;
      }
      setErro(texto || "Erro ao salvar.");
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="font-display text-lg font-bold text-sus-950">Motoristas</h2>
        <span className="rounded-full bg-teal/10 px-2.5 py-0.5 text-xs font-semibold text-teal">
          {total} cadastrado(s)
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button onClick={() => abrirModal()}><Plus className="h-4 w-4" /> Novo motorista</Button>
        </div>
      </div>
      {erro && !modal && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
      {ok && <p className="mb-3 rounded-xl bg-teal/10 px-3 py-2 text-sm text-teal">{ok}</p>}

      <Card className="mb-4 p-4">
        <Label>Buscar por nome ou CPF</Label>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ex: José Silva ou CPF…" />
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-sus-900/10 bg-sand text-xs uppercase text-sus-900/60">
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">CPF</th>
                <th className="px-4 py-3">CNH</th>
                <th className="px-4 py-3">Validade</th>
                <th className="px-4 py-3">Telefone</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((m) => (
                <tr key={m.id} className="border-b border-sus-900/5 last:border-0">
                  <td className="px-4 py-3 font-semibold">{m.nome}</td>
                  <td className="px-4 py-3 font-mono text-xs">{m.cpf || "—"}</td>
                  <td className="px-4 py-3 text-xs">{m.cnh_numero ? `${m.cnh_numero}${m.cnh_categoria ? ` · cat. ${m.cnh_categoria}` : ""}` : "—"}</td>
                  <td className="px-4 py-3 text-xs">{fmtValidade(m.cnh_validade)}</td>
                  <td className="px-4 py-3 text-xs">{m.telefone || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${m.ativo ? "bg-teal/10 text-teal" : "bg-sus-900/10 text-sus-900/60"}`}>
                      {m.ativo ? "Ativo" : "Inativo"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => abrirModal(m.id)} className="rounded-lg p-2 text-sus-800 hover:bg-sus-100" title="Editar"><Pencil className="h-4 w-4" /></button>
                      <button
                        onClick={async () => {
                          if (!confirm(`Excluir/inativar ${m.nome}? Vinculado a viagens, será apenas inativado.`)) return;
                          const snap = { ...m };
                          try {
                            await tfdExcluirMotorista(m.id);
                            await carregar(page);
                            notificarUndo({
                              titulo: `Motorista ${snap.nome} excluído/inativado.`,
                              descricao: "Desfazer reativa ou recadastra o motorista.",
                              onUndo: async () => {
                                try {
                                  await tfdAtualizarMotorista(snap.id, {
                                    nome: snap.nome, cpf: snap.cpf,
                                    cnh_numero: snap.cnh_numero,
                                    cnh_categoria: snap.cnh_categoria,
                                    cnh_validade: snap.cnh_validade,
                                    telefone: snap.telefone, ativo: true,
                                  });
                                } catch {
                                  await tfdCriarMotorista({
                                    nome: snap.nome, cpf: snap.cpf,
                                    cnh_numero: snap.cnh_numero,
                                    cnh_categoria: snap.cnh_categoria,
                                    cnh_validade: snap.cnh_validade,
                                    telefone: snap.telefone, ativo: true,
                                  });
                                }
                                await carregar(page);
                              },
                            });
                          } catch {
                            setErro("Erro ao excluir.");
                          }
                        }}
                        className="rounded-lg p-2 text-red-600 hover:bg-red-50"
                        title="Excluir/inativar"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {lista.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-ink/45">Nenhum motorista.</td></tr>}
            </tbody>
          </table>
        </div>
        <Paginacao page={page} pages={pages} total={total} onPage={(p) => carregar(p).catch(() => setErro("Falha ao carregar."))} />
      </Card>

      {modal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4" onClick={fecharModal}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <p className="font-display text-base font-bold text-sus-950">{editId ? "Editar motorista" : "Novo motorista"}</p>
              <button onClick={fecharModal} className="rounded-lg p-2 text-ink/50 hover:bg-sand" aria-label="Fechar"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="md:col-span-2"><Label>Nome completo *</Label><Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Nome completo" className={borda("nome")} />{campoMsg("nome")}</div>
              <div><Label>CPF *</Label><Input value={form.cpf} onChange={(e) => setForm({ ...form, cpf: e.target.value.replace(/\D/g, "").slice(0, 11) })} placeholder="Somente números" inputMode="numeric" className={borda("cpf")} />{campoMsg("cpf")}</div>
              <div><Label>Telefone</Label><Input value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} placeholder="DDD + número" className={borda("telefone")} />{campoMsg("telefone")}</div>
              <div><Label>CNH (número) *</Label><Input value={form.cnh_numero} onChange={(e) => setForm({ ...form, cnh_numero: e.target.value.replace(/\D/g, "").slice(0, 11) })} placeholder="11 dígitos" inputMode="numeric" className={borda("cnh_numero")} />{campoMsg("cnh_numero")}</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Categoria</Label>
                  <select value={form.cnh_categoria} onChange={(e) => setForm({ ...form, cnh_categoria: e.target.value })} className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
                    {CATEGORIAS.map((c) => <option key={c} value={c}>{c || "—"}</option>)}
                  </select>
                </div>
                <div><Label>Validade *</Label><Input type="date" value={form.cnh_validade} onChange={(e) => setForm({ ...form, cnh_validade: e.target.value })} className={borda("cnh_validade")} />{campoMsg("cnh_validade")}</div>
              </div>
              <label className="flex items-center gap-2 text-sm md:col-span-2">
                <input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} className="h-4 w-4 accent-teal" /> Ativo
              </label>
            </div>
            {erro && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
            <Button onClick={salvar} className="mt-4 w-full"><Plus className="h-4 w-4" />{editId ? "Atualizar" : "Cadastrar motorista"}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
