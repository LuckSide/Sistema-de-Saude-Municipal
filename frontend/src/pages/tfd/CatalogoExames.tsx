import { useEffect, useState } from "react";
import { Pencil, Plus, Search, ShieldCheck, ShieldOff, Trash2, X } from "lucide-react";
import {
  pagData,
  pagMeta,
  tfdAtualizarEspecialidade,
  tfdAtualizarProcedimento,
  tfdAtualizarTipo,
  tfdCriarEspecialidade,
  tfdCriarProcedimento,
  tfdCriarTipo,
  tfdEspecialidades,
  tfdExcluirEspecialidade,
  tfdExcluirProcedimento,
  tfdExcluirTipo,
  tfdProcedimentos,
  tfdTipos,
  type EspecialidadeCat,
  type ProcedimentoCat,
  type TipoFila,
} from "../../services/api";
import { Badge, Button, Card, Input, Label } from "../../components/ui/primitives";
import Paginacao from "../../components/Paginacao";
import { useBackdropClose } from "../../hooks/useBackdropClose";

type Aba = "tipos" | "procedimentos" | "especialidades";

const vazioTipo = { codigo: "", nome: "", ativo: true };
const vazioProc = {
  codigo: "", nome: "", tipo_fila: "", codigo_especialidade: "",
  nome_especialidade: "", codigo_curto: "", ativo: true,
};
const vazioEsp = { codigo_cbo: "", nome: "", ativo: true };

export default function CatalogoExames() {
  const [aba, setAba] = useState<Aba>("tipos");
  const [q, setQ] = useState("");
  const [tipos, setTipos] = useState<TipoFila[]>([]);
  const [procs, setProcs] = useState<ProcedimentoCat[]>([]);
  const [esps, setEsps] = useState<EspecialidadeCat[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [formTipo, setFormTipo] = useState(vazioTipo);
  const [formProc, setFormProc] = useState(vazioProc);
  const [formEsp, setFormEsp] = useState(vazioEsp);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");

  const modalBackdrop = useBackdropClose(fecharModal, modal);

  async function carregar(p = 1, abaAtual = aba, busca = q) {
    const params = { q: busca.trim() || undefined, page: p, limit: 100 };
    if (abaAtual === "tipos") {
      const r = await tfdTipos(params);
      setTipos(pagData<TipoFila>(r));
      const m = pagMeta(r);
      setTotal(m.total); setPage(m.page); setPages(m.pages);
    } else if (abaAtual === "procedimentos") {
      const r = await tfdProcedimentos(params);
      setProcs(pagData<ProcedimentoCat>(r));
      const m = pagMeta(r);
      setTotal(m.total); setPage(m.page); setPages(m.pages);
    } else {
      const r = await tfdEspecialidades(params);
      setEsps(pagData<EspecialidadeCat>(r));
      const m = pagMeta(r);
      setTotal(m.total); setPage(m.page); setPages(m.pages);
    }
  }

  useEffect(() => {
    setPage(1);
    carregar(1, aba, "").catch(() => setErro("Falha ao carregar catálogo."));
    setQ("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aba]);

  function abrirModal(id?: number) {
    setErro(""); setOk("");
    if (aba === "tipos") {
      if (id) {
        const t = tipos.find((x) => x.id === id);
        if (t) { setEditId(t.id); setFormTipo({ codigo: t.codigo, nome: t.nome, ativo: t.ativo }); }
      } else { setEditId(null); setFormTipo(vazioTipo); }
    } else if (aba === "procedimentos") {
      if (id) {
        const t = procs.find((x) => x.id === id);
        if (t) {
          setEditId(t.id);
          setFormProc({
            codigo: t.codigo, nome: t.nome, tipo_fila: t.tipo_fila,
            codigo_especialidade: t.codigo_especialidade,
            nome_especialidade: t.nome_especialidade,
            codigo_curto: t.codigo_curto, ativo: t.ativo,
          });
        }
      } else { setEditId(null); setFormProc(vazioProc); }
    } else {
      if (id) {
        const t = esps.find((x) => x.id === id);
        if (t) { setEditId(t.id); setFormEsp({ codigo_cbo: t.codigo_cbo, nome: t.nome, ativo: t.ativo }); }
      } else { setEditId(null); setFormEsp(vazioEsp); }
    }
    setModal(true);
  }

  function fecharModal() {
    setModal(false); setEditId(null);
    setFormTipo(vazioTipo); setFormProc(vazioProc); setFormEsp(vazioEsp);
    setErro("");
  }

  async function salvar() {
    setErro(""); setOk(""); setSalvando(true);
    try {
      if (aba === "tipos") {
        if (formTipo.nome.trim().length < 2) throw new Error("Nome do tipo é obrigatório.");
        const payload = { ...formTipo, codigo: formTipo.codigo.trim(), nome: formTipo.nome.trim().toUpperCase() };
        if (editId) await tfdAtualizarTipo(editId, payload);
        else await tfdCriarTipo(payload);
        setOk(editId ? "Tipo atualizado." : "Tipo cadastrado.");
      } else if (aba === "procedimentos") {
        if (!formProc.codigo.trim() || formProc.nome.trim().length < 2) throw new Error("Código e nome do procedimento são obrigatórios.");
        const payload = {
          ...formProc,
          codigo: formProc.codigo.trim(),
          nome: formProc.nome.trim().toUpperCase(),
          tipo_fila: formProc.tipo_fila.trim().toUpperCase(),
          codigo_especialidade: formProc.codigo_especialidade.replace(/\D/g, "").slice(0, 6),
          nome_especialidade: formProc.nome_especialidade.trim(),
          codigo_curto: formProc.codigo_curto.trim().toUpperCase(),
        };
        if (editId) await tfdAtualizarProcedimento(editId, payload);
        else await tfdCriarProcedimento(payload);
        setOk(editId ? "Procedimento atualizado." : "Procedimento cadastrado.");
      } else {
        const cbo = formEsp.codigo_cbo ? formEsp.codigo_cbo.replace(/\D/g, "").slice(0, 6) : "";
        if (formEsp.nome.trim().length < 2) throw new Error("O nome da especialidade é obrigatório.");
        const payload = { codigo_cbo: cbo, nome: formEsp.nome.trim(), ativo: formEsp.ativo };
        if (editId) await tfdAtualizarEspecialidade(editId, payload);
        else await tfdCriarEspecialidade(payload);
        setOk(editId ? "Especialidade atualizada." : "Especialidade cadastrada.");
      }
      fecharModal();
      await carregar(page);
    } catch (e: any) {
      setErro(e?.response?.data?.detail || e?.message || "Erro ao salvar.");
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(id: number) {
    if (!confirm("Inativar/excluir este registro?")) return;
    try {
      if (aba === "tipos") await tfdExcluirTipo(id);
      else if (aba === "procedimentos") await tfdExcluirProcedimento(id);
      else await tfdExcluirEspecialidade(id);
      setOk("Registro excluído.");
      await carregar(page);
    } catch {
      setErro("Erro ao excluir.");
    }
  }

  function buscar(e?: React.FormEvent) {
    e?.preventDefault();
    carregar(1, aba, q).catch(() => setErro("Falha ao buscar."));
  }

  const titulo =
    aba === "tipos" ? "Tipos de fila" :
    aba === "procedimentos" ? "Procedimentos" : "Especialidades";

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="font-display text-lg font-bold text-sus-950">Catálogo de Procedimentos</h2>
        <span className="rounded-full bg-teal/10 px-2.5 py-0.5 text-xs font-semibold text-teal">
          {total} registro(s)
        </span>
        <Button onClick={() => abrirModal()} className="ml-auto"><Plus className="h-4 w-4" /> Novo</Button>
      </div>
      {erro && !modal && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
      {ok && <p className="mb-3 rounded-xl bg-teal/10 px-3 py-2 text-sm text-teal">{ok}</p>}

      <Card className="mb-4 p-4">
        <div className="mb-3 flex flex-wrap gap-2">
          {(
            [
              { id: "tipos", label: "Tipos de fila" },
              { id: "procedimentos", label: "Procedimentos" },
              { id: "especialidades", label: "Especialidades" },
            ] as { id: Aba; label: string }[]
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setAba(t.id)}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                aba === t.id ? "bg-sus-900 text-white" : "bg-sand text-sus-900 hover:bg-sus-900/10"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <form onSubmit={buscar} className="flex flex-wrap items-end gap-2">
          <div className="min-w-52 flex-1">
            <Label>Buscar {titulo.toLowerCase()}</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/40" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={
                  aba === "especialidades"
                    ? "Ex: radiologia, 225320…"
                    : aba === "procedimentos"
                      ? "Ex: mamografia, 0205020186, MAMO…"
                      : "Ex: ultrassonografia…"
                }
                className="pl-10"
              />
            </div>
          </div>
          <Button type="submit"><Search className="h-4 w-4" /> Buscar</Button>
          <button
            type="button"
            onClick={() => { setQ(""); carregar(1, aba, "").catch(() => {}); }}
            className="rounded-xl px-4 py-2.5 text-sm font-semibold text-sus-900 hover:bg-sus-900/5"
          >
            Limpar
          </button>
        </form>
        <p className="mt-2 text-xs text-ink/50">
          Tipos e CBOs alimentam os filtros da Fila de exames com contagem. Procedimentos alimentam o autocomplete do pedido.
        </p>
      </Card>

      <Card className="overflow-hidden">
        {aba === "tipos" && (
          <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-sus-900/10 bg-sand text-xs uppercase text-sus-900/60">
              <th className="px-4 py-3">ID e-SUS</th><th className="px-4 py-3">Tipo de fila</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Ações</th>
            </tr></thead>
            <tbody>
              {tipos.map((t) => (
                <tr key={t.id} className="border-b border-sus-900/5 last:border-0">
                  <td className="px-4 py-3 font-mono text-xs">{t.codigo || "—"}</td>
                  <td className="px-4 py-3 font-semibold">{t.nome}</td>
                  <td className="px-4 py-3">
                    <Badge variant={t.ativo ? "success" : "outline"}>
                      {t.ativo ? <ShieldCheck className="h-3 w-3" /> : <ShieldOff className="h-3 w-3" />}
                      {t.ativo ? "Ativo" : "Inativo"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3"><div className="flex justify-end gap-1">
                    <button onClick={() => abrirModal(t.id)} className="rounded-lg p-2 text-sus-800 hover:bg-sus-100" title="Editar"><Pencil className="h-4 w-4" /></button>
                    <button onClick={() => excluir(t.id)} className="rounded-lg p-2 text-red-600 hover:bg-red-50" title="Excluir"><Trash2 className="h-4 w-4" /></button>
                  </div></td>
                </tr>
              ))}
              {tipos.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-ink/45">Nenhum tipo cadastrado.</td></tr>}
            </tbody>
          </table>
          </div>
        )}
        {aba === "procedimentos" && (
          <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-sus-900/10 bg-sand text-xs uppercase text-sus-900/60">
              <th className="px-4 py-3">Código</th><th className="px-4 py-3">Procedimento</th><th className="px-4 py-3">Tipo / CBO</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Ações</th>
            </tr></thead>
            <tbody>
              {procs.map((t) => (
                <tr key={t.id} className="border-b border-sus-900/5 last:border-0">
                  <td className="px-4 py-3 font-mono text-xs">{t.codigo}{t.codigo_curto ? <span className="block text-teal">· {t.codigo_curto}</span> : null}</td>
                  <td className="px-4 py-3 font-semibold">{t.nome}</td>
                  <td className="px-4 py-3 text-xs text-ink/60">
                    {t.tipo_fila || "—"}
                    {t.codigo_especialidade ? <span className="block">CBO {t.codigo_especialidade}{t.nome_especialidade ? ` · ${t.nome_especialidade}` : ""}</span> : null}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={t.ativo ? "success" : "outline"}>
                      {t.ativo ? <ShieldCheck className="h-3 w-3" /> : <ShieldOff className="h-3 w-3" />}
                      {t.ativo ? "Ativo" : "Inativo"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3"><div className="flex justify-end gap-1">
                    <button onClick={() => abrirModal(t.id)} className="rounded-lg p-2 text-sus-800 hover:bg-sus-100" title="Editar"><Pencil className="h-4 w-4" /></button>
                    <button onClick={() => excluir(t.id)} className="rounded-lg p-2 text-red-600 hover:bg-red-50" title="Excluir"><Trash2 className="h-4 w-4" /></button>
                  </div></td>
                </tr>
              ))}
              {procs.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-ink/45">Nenhum procedimento cadastrado.</td></tr>}
            </tbody>
          </table>
          </div>
        )}
        {aba === "especialidades" && (
          <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-sus-900/10 bg-sand text-xs uppercase text-sus-900/60">
              <th className="px-4 py-3">CBO</th><th className="px-4 py-3">Especialidade</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Ações</th>
            </tr></thead>
            <tbody>
              {esps.map((t) => (
                <tr key={t.id} className="border-b border-sus-900/5 last:border-0">
                  <td className="px-4 py-3 font-mono text-xs">
                    {t.codigo_cbo ? (
                      <span className="font-bold">{t.codigo_cbo}</span>
                    ) : (
                      <span className="rounded bg-sus-900/10 px-1.5 py-0.5 font-sans text-[11px] font-normal text-ink/50">
                        Geral / Sem CBO
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-semibold">{t.nome}</td>
                  <td className="px-4 py-3">
                    <Badge variant={t.ativo ? "success" : "outline"}>
                      {t.ativo ? <ShieldCheck className="h-3 w-3" /> : <ShieldOff className="h-3 w-3" />}
                      {t.ativo ? "Ativo" : "Inativo"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3"><div className="flex justify-end gap-1">
                    <button onClick={() => abrirModal(t.id)} className="rounded-lg p-2 text-sus-800 hover:bg-sus-100" title="Editar"><Pencil className="h-4 w-4" /></button>
                    <button onClick={() => excluir(t.id)} className="rounded-lg p-2 text-red-600 hover:bg-red-50" title="Excluir"><Trash2 className="h-4 w-4" /></button>
                  </div></td>
                </tr>
              ))}
              {esps.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-ink/45">Nenhuma especialidade cadastrada.</td></tr>}
            </tbody>
          </table>
          </div>
        )}
        <Paginacao page={page} pages={pages} total={total} onPage={(p) => carregar(p).catch(() => setErro("Falha ao carregar catálogo."))} />
      </Card>

      {modal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4" {...modalBackdrop}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <p className="font-display text-base font-bold text-sus-950">
                {editId ? `Editar ${titulo.toLowerCase()}` : `Novo ${titulo.toLowerCase()}`}
              </p>
              <button onClick={fecharModal} className="rounded-lg p-2 text-ink/50 hover:bg-sand" aria-label="Fechar"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3">
              {aba === "tipos" && (
                <div className="grid gap-3 md:grid-cols-3">
                  <div><Label>ID e-SUS</Label><Input value={formTipo.codigo} onChange={(e) => setFormTipo({ ...formTipo, codigo: e.target.value })} placeholder="Ex: 31" /></div>
                  <div className="md:col-span-2"><Label>Nome do tipo *</Label><Input value={formTipo.nome} onChange={(e) => setFormTipo({ ...formTipo, nome: e.target.value.toUpperCase() })} placeholder="Ex: ULTRASSONOGRAFIA" /></div>
                  <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={formTipo.ativo} onChange={(e) => setFormTipo({ ...formTipo, ativo: e.target.checked })} className="rounded border-sus-900/30" /> Ativo</label>
                </div>
              )}
              {aba === "procedimentos" && (
                <div className="grid gap-3 md:grid-cols-2">
                  <div><Label>Código procedimento *</Label><Input value={formProc.codigo} onChange={(e) => setFormProc({ ...formProc, codigo: e.target.value })} placeholder="Ex: 0205020186" /></div>
                  <div><Label>Código curto</Label><Input value={formProc.codigo_curto} onChange={(e) => setFormProc({ ...formProc, codigo_curto: e.target.value.toUpperCase() })} placeholder="Ex: USG-TV" /></div>
                  <div className="md:col-span-2"><Label>Nome procedimento *</Label><Input value={formProc.nome} onChange={(e) => setFormProc({ ...formProc, nome: e.target.value.toUpperCase() })} placeholder="Ex: ULTRASSONOGRAFIA TRANSVAGINAL" /></div>
                  <div><Label>Tipo de fila</Label><Input value={formProc.tipo_fila} onChange={(e) => setFormProc({ ...formProc, tipo_fila: e.target.value.toUpperCase() })} placeholder="Ex: ULTRASSONOGRAFIA" /></div>
                  <div><Label>CBO padrão</Label><Input value={formProc.codigo_especialidade} onChange={(e) => setFormProc({ ...formProc, codigo_especialidade: e.target.value.replace(/\D/g, "").slice(0, 6) })} placeholder="Ex: 225320" inputMode="numeric" /></div>
                  <div className="md:col-span-2">
                    <Label>Nome especialidade</Label>
                    <Input
                      value={formProc.nome_especialidade}
                      onChange={(e) => {
                        const val = e.target.value;
                        const match = esps.find((x) => x.nome.toLowerCase() === val.toLowerCase());
                        setFormProc({
                          ...formProc,
                          nome_especialidade: val,
                          codigo_especialidade: match?.codigo_cbo || formProc.codigo_especialidade,
                        });
                      }}
                      placeholder="Ex: Médico em radiologia e diagnóstico por imagem"
                      list="proc-especialidades-list"
                    />
                    <datalist id="proc-especialidades-list">
                      {esps.map((esp) => (
                        <option key={esp.id} value={esp.nome}>
                          {esp.codigo_cbo ? `CBO ${esp.codigo_cbo} · ` : ""}{esp.nome}
                        </option>
                      ))}
                    </datalist>
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={formProc.ativo} onChange={(e) => setFormProc({ ...formProc, ativo: e.target.checked })} className="rounded border-sus-900/30" /> Ativo</label>
                </div>
              )}
              {aba === "especialidades" && (
                <div className="grid gap-3 md:grid-cols-3">
                  <div><Label>Código CBO (opcional)</Label><Input value={formEsp.codigo_cbo} onChange={(e) => setFormEsp({ ...formEsp, codigo_cbo: e.target.value.replace(/\D/g, "").slice(0, 6) })} placeholder="Ex: 225320 (opcional)" inputMode="numeric" /></div>
                  <div className="md:col-span-2"><Label>Nome especialidade *</Label><Input value={formEsp.nome} onChange={(e) => setFormEsp({ ...formEsp, nome: e.target.value })} placeholder="Ex: Médico em radiologia e diagnóstico por imagem" /></div>
                  <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={formEsp.ativo} onChange={(e) => setFormEsp({ ...formEsp, ativo: e.target.checked })} className="rounded border-sus-900/30" /> Ativo</label>
                </div>
              )}
              {erro && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
              <Button onClick={salvar} disabled={salvando} className="w-full"><Plus className="h-4 w-4" />{salvando ? "Salvando…" : editId ? "Atualizar" : "Cadastrar"}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
