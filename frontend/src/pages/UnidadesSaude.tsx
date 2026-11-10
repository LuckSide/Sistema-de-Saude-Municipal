import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { type UnidadeSaude, createUnidadeSaude, deleteUnidadeSaude, fetchUnidadesSaude, updateUnidadeSaude } from "../services/api";
import { Button, Card, Input, Label } from "../components/ui/primitives";
import { useUndo } from "../components/UndoToast";
import { useConfirm } from "../components/ConfirmDialog";
import { erros422, toastCampos, validaCnes, validaTelefone } from "../utils/validacoes";
import ExportarExcel from "../components/ExportarExcel";

const vazio = { nome: "", cnes: "", endereco: "", numero: "", bairro: "", municipio: "", cep: "", telefone: "", ativo: true };

export default function UnidadesSaude() {
  const { notificarUndo } = useUndo();
  const { confirmar } = useConfirm();
  const [lista, setLista] = useState<UnidadeSaude[]>([]);
  const [sp] = useSearchParams();
  const [form, setForm] = useState<typeof vazio>(vazio);
  const [editId, setEditId] = useState<number | null>(null);
  const [modal, setModal] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [erroModal, setErroModal] = useState("");
  const [erros, setErros] = useState<Record<string, string>>({});
  const [ok, setOk] = useState("");

  // Filtros de busca instantânea na listagem de Unidades/PSFs (Requisito 3)
  const [buscaTabela, setBuscaTabela] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<"todos" | "ativos" | "inativos">("todos");

  const unidadesFiltradas = useMemo(() => {
    let res = lista;
    if (filtroStatus === "ativos") res = res.filter((u) => u.ativo);
    if (filtroStatus === "inativos") res = res.filter((u) => !u.ativo);
    const termo = buscaTabela.trim().toLowerCase();
    if (!termo) return res;
    return res.filter((u) => {
      const texto = `${u.nome} ${u.cnes || ""} ${u.endereco || ""} ${u.bairro || ""} ${u.municipio || ""} ${u.telefone || ""}`.toLowerCase();
      return texto.includes(termo);
    });
  }, [lista, buscaTabela, filtroStatus]);

  const ROTULOS: Record<string, string> = { nome: "Nome da unidade", cnes: "CNES", telefone: "Telefone" };
  const borda = (c: string) => (erros[c] ? "!border-red-500 focus:!border-red-500" : "");
  const msg = (c: string) =>
    erros[c] ? <p className="mt-1 text-xs font-medium text-red-600">{erros[c]}</p> : null;

  async function carregar() { try { setLista(await fetchUnidadesSaude()); } catch { setErro("Falha ao carregar unidades."); } }
  useEffect(() => { carregar(); }, []);
  useEffect(() => {
    const rid = Number(sp.get("registro"));
    if (!rid || modal) return;
    const m = lista.find((x) => x.id === rid);
    if (m) abrir(m);
  }, [sp, lista, modal]);

  function abrir(u?: UnidadeSaude) {
    setErroModal(""); setErros({}); setOk("");
    if (u) { setEditId(u.id); setForm({ nome: u.nome, cnes: u.cnes, endereco: u.endereco, numero: u.numero ?? "", bairro: u.bairro, municipio: u.municipio ?? "", cep: u.cep ?? "", telefone: u.telefone, ativo: u.ativo }); }
    else { setEditId(null); setForm(vazio); }
    setModal(true);
  }
  function fechar() { setModal(false); setEditId(null); setForm(vazio); setErroModal(""); setErros({}); }

  async function salvar() {
    setErroModal("");
    const e: Record<string, string> = {};
    if (form.nome.trim().length < 2) e.nome = "Nome é obrigatório.";
    const cnes = validaCnes(form.cnes);
    if (cnes) e.cnes = cnes;
    const tel = validaTelefone(form.telefone);
    if (tel) e.telefone = tel;
    if (Object.keys(e).length > 0) {
      setErros(e);
      setErroModal(toastCampos(e, ROTULOS));
      return;
    }
    setSalvando(true);
    try {
      if (editId) { await updateUnidadeSaude(editId, form); setOk("Unidade atualizada."); }
      else { await createUnidadeSaude(form); setOk("Unidade cadastrada."); }
      fechar(); await carregar();
    } catch (err: unknown) {
      const deCampo = erros422(err, ROTULOS);
      if (Object.keys(deCampo).length > 0) {
        setErros(deCampo);
        setErroModal(toastCampos(deCampo, ROTULOS));
        return;
      }
      const detalhe = (err as { response?: { data?: { detail?: unknown } } }).response?.data?.detail;
      setErroModal(typeof detalhe === "string" ? detalhe : "Erro ao salvar.");
    } finally { setSalvando(false); }
  }
  async function excluir(u: UnidadeSaude) {
    const ok = await confirmar({
      titulo: `Inativar unidade ${u.nome}`,
      descricao: `Deseja realmente inativar a unidade ${u.nome}? Você poderá reativá-la a qualquer momento.`,
      textoConfirmar: "Sim, Inativar",
      variante: "danger",
    });
    if (!ok) return;
    const snap = { ...u };
    try {
      await deleteUnidadeSaude(u.id);
      await carregar();
      notificarUndo({
        titulo: `Unidade ${snap.nome} inativada.`,
        descricao: "Desfazer reativa o cadastro.",
        onUndo: async () => {
          await updateUnidadeSaude(snap.id, {
            nome: snap.nome, cnes: snap.cnes, endereco: snap.endereco,
            numero: snap.numero ?? "", bairro: snap.bairro,
            municipio: snap.municipio ?? "", cep: snap.cep ?? "",
            telefone: snap.telefone, ativo: true,
          });
          await carregar();
        },
      });
    }
    catch { setErro("Falha ao inativar."); }
  }

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h1 className="font-display text-2xl font-extrabold text-sus-950">PSFs / Unidades de saúde</h1>
        <ExportarExcel url="/api/unidades-saude/exportar" arquivo="unidades_saude" />
        <Button onClick={() => abrir()} className="ml-auto"><Plus className="h-4 w-4" /> Nova unidade</Button>
      </div>
      <p className="mb-4 mt-1 text-sm text-ink/55">Gerenciamento de PSFs e unidades básicas de saúde.</p>
      {erro && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{erro}</p>}
      {ok && <p className="mb-3 rounded-xl bg-teal/10 px-3 py-2 text-sm font-medium text-teal">{ok}</p>}

      {/* Barra de Filtro e Busca Instantânea em PSFs/Unidades (Requisito 3) */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sus-900/10 bg-white p-3.5 shadow-2xs">
        <div className="relative min-w-[260px] flex-1 sm:max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/40" />
          <Input
            value={buscaTabela}
            onChange={(e) => setBuscaTabela(e.target.value)}
            placeholder="Pesquisar por nome do PSF, CNES, endereço, bairro…"
            className="pl-9 pr-8 text-xs"
          />
          {buscaTabela && (
            <button
              type="button"
              onClick={() => setBuscaTabela("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink/40 hover:text-sus-950"
              title="Limpar busca"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl border border-sus-900/10 bg-sand/40 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setFiltroStatus("todos")}
              className={`rounded-lg px-2.5 py-1 font-semibold transition ${
                filtroStatus === "todos"
                  ? "bg-sus-900 text-white shadow-2xs"
                  : "text-ink/65 hover:text-sus-950"
              }`}
            >
              Todas ({lista.length})
            </button>
            <button
              type="button"
              onClick={() => setFiltroStatus("ativos")}
              className={`rounded-lg px-2.5 py-1 font-semibold transition ${
                filtroStatus === "ativos"
                  ? "bg-sus-900 text-white shadow-2xs"
                  : "text-ink/65 hover:text-sus-950"
              }`}
            >
              Ativas ({lista.filter((u) => u.ativo).length})
            </button>
            <button
              type="button"
              onClick={() => setFiltroStatus("inativos")}
              className={`rounded-lg px-2.5 py-1 font-semibold transition ${
                filtroStatus === "inativos"
                  ? "bg-sus-900 text-white shadow-2xs"
                  : "text-ink/65 hover:text-sus-950"
              }`}
            >
              Inativas ({lista.filter((u) => !u.ativo).length})
            </button>
          </div>
          <span className="text-xs text-ink/50 ml-1">
            {unidadesFiltradas.length} de {lista.length}
          </span>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b border-sus-900/10 bg-sand text-xs uppercase tracking-wide text-sus-900/60">
            <th className="px-4 py-3">Nome</th><th className="px-4 py-3">CNES</th><th className="px-4 py-3">Endereço</th><th className="px-4 py-3">Bairro</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Ações</th>
          </tr></thead>
          <tbody>
            {unidadesFiltradas.map((u) => (
              <tr key={u.id} className="border-b border-sus-900/5 last:border-0 hover:bg-sand/30 transition">
                <td className="px-4 py-3 font-semibold text-sus-950">{u.nome}</td>
                <td className="px-4 py-3 text-xs text-ink/60">{u.cnes || "—"}</td>
                <td className="px-4 py-3 text-xs text-ink/60">{u.endereco || "—"} {u.telefone ? `· ${u.telefone}` : ""}</td>
                <td className="px-4 py-3 text-xs text-ink/60">{u.bairro || "—"}</td>
                <td className="px-4 py-3 text-xs">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${u.ativo ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>
                    {u.ativo ? "ativo" : "inativo"}
                  </span>
                </td>
                <td className="px-4 py-3"><div className="flex justify-end gap-1">
                  <button onClick={() => abrir(u)} className="rounded-lg p-2 text-sus-800 hover:bg-sus-100" title="Editar"><Pencil className="h-4 w-4" /></button>
                  <button onClick={() => excluir(u)} className="rounded-lg p-2 text-red-600 hover:bg-red-50" title="Inativar"><Trash2 className="h-4 w-4" /></button>
                </div></td>
              </tr>
            ))}
            {unidadesFiltradas.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-ink/45">
                  {buscaTabela ? `Nenhuma unidade encontrada para “${buscaTabela}”.` : "Nenhuma unidade cadastrada."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </Card>

      {modal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4" onClick={fechar}>
          <div className="rise max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl bg-white p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between gap-2">
              <p className="font-display text-base font-bold text-sus-950">{editId ? "Editar unidade" : "Nova unidade"}</p>
              <button onClick={fechar} className="rounded-lg p-2 text-ink/50 hover:bg-sand" aria-label="Fechar"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="md:col-span-2"><Label>Nome da unidade *</Label><Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Ex: PSF Dona Clara" className={borda("nome")} />{msg("nome")}</div>
              <div><Label>Código CNES *</Label><Input value={form.cnes} onChange={(e) => setForm({ ...form, cnes: e.target.value.replace(/\D/g, "").slice(0, 7) })} placeholder="7 dígitos" inputMode="numeric" className={borda("cnes")} />{msg("cnes")}</div>
              <div><Label>Telefone</Label><Input value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} placeholder="DDD + número" className={borda("telefone")} />{msg("telefone")}</div>
              <div className="md:col-span-2"><Label>Endereço (logradouro)</Label><Input value={form.endereco} onChange={(e) => setForm({ ...form, endereco: e.target.value })} /></div>
              <div><Label>Número</Label><Input value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} /></div>
              <div><Label>Bairro</Label><Input value={form.bairro} onChange={(e) => setForm({ ...form, bairro: e.target.value })} /></div>
              <div><Label>Município</Label><Input value={form.municipio} onChange={(e) => setForm({ ...form, municipio: e.target.value })} /></div>
              <div><Label>CEP</Label><Input value={form.cep} onChange={(e) => setForm({ ...form, cep: e.target.value })} placeholder="00000-000" /></div>
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
