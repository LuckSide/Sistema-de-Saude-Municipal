import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, Eye, Pencil, Plus, Search, Trash2, X } from "lucide-react";
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

const vazio = { nome: "", cpf: "", cns: "", nascimento: "", telefone: "", endereco: "", endereco_numero: "", complemento: "", bairro: "", cep: "", unidade_saude_id: "", equipe_esf: "", acs_nome: "", observacoes: "" };

export default function TfdPacientes() {
  const [lista, setLista] = useState<Paciente[]>([]);
  const [sp] = useSearchParams();
  const [q, setQ] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editProntuario, setEditProntuario] = useState<string>("");
  const [form, setForm] = useState(vazio);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [unidades, setUnidades] = useState<UnidadeSaude[]>([]);
  const [perfilId, setPerfilId] = useState<number | null>(null);

  async function carregar(p = 1) {
    if (!q.trim()) {
      setLista([]);
      setTotal(0);
      setPage(1);
      setPages(1);
      setCarregando(false);
      return;
    }
    setCarregando(true);
    try {
      const r = await tfdPacientes(q.trim(), p, 100);
      setLista(pagData<Paciente>(r));
      const m = pagMeta(r);
      setTotal(m.total);
      setPage(m.page);
      setPages(m.pages);
    } catch {
      setErro("Falha ao buscar pacientes.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    if (!q.trim()) {
      setLista([]);
      setTotal(0);
      setPage(1);
      setPages(1);
      return;
    }
    const t = setTimeout(() => carregar(1), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
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
        setEditProntuario(p.codigo_prontuario || `PR-${String(p.id).padStart(5, "0")}`);
        setForm({ nome: p.nome, cpf: p.cpf, cns: p.cns, nascimento: p.nascimento ?? "", telefone: p.telefone, endereco: p.endereco, endereco_numero: p.endereco_numero ?? "", complemento: p.complemento ?? "", bairro: p.bairro ?? "", cep: p.cep ?? "", unidade_saude_id: p.unidade_saude_id ? String(p.unidade_saude_id) : "", equipe_esf: p.equipe_esf ?? "", acs_nome: p.acs_nome ?? "", observacoes: p.observacoes });
      }
    } else {
      setEditId(null);
      setEditProntuario("");
      setForm(vazio);
    }
    setModal(true);
  }

  function fecharModal() {
    setModal(false);
    setEditId(null);
    setEditProntuario("");
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
      if (q.trim()) {
        await carregar(page);
      }
    } catch {
      setErro("Erro ao salvar.");
    }
  }

  const isIdentificadorEstrito = useMemo(() => {
    const limpo = q.trim();
    const digits = limpo.replace(/\D/g, "");
    if (digits.length === 11 || digits.length === 15) return true;
    if (limpo.toUpperCase().startsWith("PR-") || limpo.toUpperCase().startsWith("PR")) return true;
    return false;
  }, [q]);

  const pacienteExato = useMemo(() => {
    if (lista.length === 1 && isIdentificadorEstrito) {
      return lista[0];
    }
    return null;
  }, [lista, isIdentificadorEstrito]);

  return (
    <div>
      {/* Cabeçalho */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-sus-950">Pacientes / Usuários do SUS</h2>
          <p className="text-xs text-ink/60">Localização e gestão unificada de prontuários, cadastros e vínculos de saúde</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportarExcel url="/api/tfd/pacientes/exportar" arquivo="pacientes" params={{ q: q.trim() || undefined }} />
          <Button onClick={() => abrirModal()}><Plus className="h-4 w-4" /> Novo paciente</Button>
        </div>
      </div>

      {/* Barra de Pesquisa Centralizada */}
      <div className="mx-auto mb-6 max-w-2xl text-center">
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-sus-900/60">
            <Search className="h-5 w-5" />
          </div>
          <Input
            placeholder="Buscar por Nome, CPF, CNS ou Prontuário (ex: PR-00042)…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-12 pl-11 pr-10 text-base shadow-sm focus:ring-2 focus:ring-sus-900/20"
            autoFocus
          />
          {q && (
            <button
              onClick={() => setQ("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-ink/40 hover:bg-sand hover:text-ink transition-colors"
              title="Limpar pesquisa"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Pílulas de orientação de busca */}
        <div className="mt-2.5 flex flex-wrap items-center justify-center gap-1.5 text-xs text-ink/60">
          <span className="font-medium text-sus-900/70">Buscar por:</span>
          <button
            type="button"
            onClick={() => setQ("PR-")}
            className="rounded-full bg-sus-900/5 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-sus-900 hover:bg-sus-900/10 transition-colors"
          >
            Prontuário (PR-...)
          </button>
          <span className="text-ink/30">•</span>
          <span className="rounded-full bg-sand px-2 py-0.5 text-[11px]">CPF (11 dígitos)</span>
          <span className="text-ink/30">•</span>
          <span className="rounded-full bg-sand px-2 py-0.5 text-[11px]">Cartão SUS (CNS)</span>
          <span className="text-ink/30">•</span>
          <span className="rounded-full bg-sand px-2 py-0.5 text-[11px]">Nome completo</span>
        </div>

        {pacienteExato && (
          <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-teal/10 px-3 py-1 text-xs font-semibold text-teal shadow-xs animate-in fade-in">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Correspondência exata localizada: 1 único paciente exibido.
          </div>
        )}
      </div>

      {erro && !modal && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
      {ok && <p className="mb-3 rounded-xl bg-teal/10 px-3 py-2 text-sm text-teal">{ok}</p>}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-sus-900/10 bg-sand text-xs uppercase text-sus-900/60">
              <th className="px-4 py-3">Prontuário</th>
              <th className="px-4 py-3">Nome / Endereço</th>
              <th className="px-4 py-3">CPF / CNS</th>
              <th className="px-4 py-3">Telefone / Unidade</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {!q.trim() ? (
              <tr>
                <td colSpan={5} className="px-4 py-16 text-center">
                  <div className="mx-auto flex max-w-md flex-col items-center justify-center text-center">
                    <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-sus-900/10 text-sus-900">
                      <Search className="h-6 w-6" />
                    </div>
                    <p className="font-semibold text-sus-950">Pesquise para exibir pacientes</p>
                    <p className="mt-1 text-xs text-ink/60">
                      Digite o nome, CPF, CNS ou número do prontuário no campo central para pesquisar em tempo real na base municipal e no e-SUS PEC.
                    </p>
                  </div>
                </td>
              </tr>
            ) : carregando ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-sm text-ink/60">
                  Pesquisando pacientes...
                </td>
              </tr>
            ) : lista.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-ink/45">
                  Nenhum paciente encontrado para "{q}".
                </td>
              </tr>
            ) : (
              lista.map((p) => {
                const pront = p.codigo_prontuario || `PR-${String(p.id).padStart(5, "0")}`;
                const end = [
                  p.endereco,
                  p.endereco_numero ? `Nº ${p.endereco_numero}` : "",
                  p.bairro,
                  p.cep ? `CEP ${p.cep}` : "",
                ]
                  .filter(Boolean)
                  .join(" · ");
                const ubsNome = unidades.find((u) => u.id === p.unidade_saude_id)?.nome;
                const ehExato = pacienteExato?.id === p.id;
                return (
                  <tr
                    key={p.id}
                    className={`border-b border-sus-900/5 last:border-0 transition-colors ${
                      ehExato ? "bg-teal/5 border-l-4 border-l-teal font-medium" : "hover:bg-sand/30"
                    }`}
                  >
                    <td className="px-4 py-3 align-middle">
                      <span className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-mono font-bold ${
                        ehExato ? "bg-teal text-white shadow-xs" : "bg-sus-900/10 text-sus-900"
                      }`}>
                        {pront}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-semibold">
                      <div className="flex items-center gap-2">
                        <span>{p.nome}</span>
                        {ehExato && (
                          <span className="rounded-full bg-teal/15 px-2 py-0.5 text-[10px] font-bold text-teal">
                            Exato
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-normal text-ink/50">{end || "—"}</p>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span className="font-mono">{p.cpf || "—"}</span>
                      {p.cns && <span className="block text-[11px] font-mono text-ink/60">CNS: {p.cns}</span>}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div>{p.telefone || "—"}</div>
                      {(ubsNome || p.equipe_esf) && (
                        <div className="mt-0.5 text-[11px] text-ink/60">
                          {ubsNome ? `🏥 ${ubsNome}` : ""}{p.equipe_esf ? ` (${p.equipe_esf})` : ""}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => setPerfilId(p.id)}
                          className="rounded-lg p-2 text-teal hover:bg-teal/10"
                          title="Ver perfil e demanda"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => abrirModal(p.id)}
                          className="rounded-lg p-2 text-sus-800 hover:bg-sus-100"
                          title="Editar cadastro"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={async () => {
                            if (confirm(`Excluir paciente ${p.nome}?`)) {
                              await tfdExcluirPaciente(p.id);
                              carregar(page);
                            }
                          }}
                          className="rounded-lg p-2 text-red-600 hover:bg-red-50"
                          title="Excluir paciente"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        </div>
        {q.trim() && lista.length > 0 && (
          <Paginacao page={page} pages={pages} total={total} onPage={(p) => carregar(p).catch(() => setErro("Falha ao carregar."))} />
        )}
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
              <div className="flex items-center gap-2">
                <p className="font-display text-base font-bold text-sus-950">{editId ? "Editar paciente" : "Novo paciente"}</p>
                {editProntuario && (
                  <span className="rounded-md bg-sus-900/10 px-2 py-0.5 text-xs font-mono font-bold text-sus-900">
                    {editProntuario}
                  </span>
                )}
              </div>
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
                <div><Label>Complemento</Label><Input value={form.complemento} onChange={(e) => setForm({ ...form, complemento: e.target.value })} placeholder="Apto, bloco, casa…" /></div>
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