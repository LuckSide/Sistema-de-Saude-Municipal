import { useEffect, useState } from "react";
import { Copy, KeyRound, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  createUsuario,
  deleteUsuario,
  fetchMedicos,
  fetchUnidadesSaude,
  fetchUsuarios,
  labsListar,
  resetSenhaUsuario,
  updateUsuario,
  pagData,
  pagMeta,
  type Laboratorio,
  type Medico,
  type UnidadeSaude,
  type Usuario,
} from "../services/api";
import { Button, Card, Input, Label, Select } from "../components/ui/primitives";
import Paginacao from "../components/Paginacao";
import ExportarExcel from "../components/ExportarExcel";
import PermissoesTree from "../components/PermissoesTree";
import { ACOES, type Acao } from "../permissoes";

const ACAO_SET = new Set(ACOES.map((a) => a.id));

function sanitizarAcoes(raw: unknown): Record<string, Acao[]> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, Acao[]> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(v)) continue;
    const limpas = v.filter((a): a is Acao => typeof a === "string" && ACAO_SET.has(a as Acao));
    if (limpas.length) out[k] = limpas;
  }
  return out;
}

type Form = {
  username: string;
  nome: string;
  area: string;
  telas: string[];
  acoes: Record<string, Acao[]>;
  medico_id: string;
  unidade_saude_id: string;
  laboratorio_id: string;
  permite_retroativo: boolean;
  is_superuser: boolean;
  is_active: boolean;
};

const vazio: Form = {
  username: "",
  nome: "",
  area: "painel",
  telas: ["dashboard"],
  acoes: {},
  medico_id: "",
  unidade_saude_id: "",
  laboratorio_id: "",
  permite_retroativo: true,
  is_superuser: false,
  is_active: true,
};

export default function Usuarios() {
  const [lista, setLista] = useState<Usuario[]>([]);
  const [form, setForm] = useState<Form>(vazio);
  const [editId, setEditId] = useState<number | null>(null);
  const [modal, setModal] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [erroModal, setErroModal] = useState("");
  const [ok, setOk] = useState("");
  const [temporaria, setTemporaria] = useState<{ user: string; senha: string } | null>(null);
  const [resetando, setResetando] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [medicos, setMedicos] = useState<Medico[]>([]);
  const [unidades, setUnidades] = useState<UnidadeSaude[]>([]);
  const [labs, setLabs] = useState<Laboratorio[]>([]);

  async function carregar(p = page) {
    try {
      const r = await fetchUsuarios(p, 100);
      setLista(pagData<Usuario>(r));
      const m = pagMeta(r);
      setTotal(m.total);
      setPage(m.page);
      setPages(m.pages);
    } catch {
      setErro("Falha ao carregar usuários.");
    }
  }
  useEffect(() => {
    carregar(1).catch(() => setErro("Falha ao carregar usuários."));
    fetchMedicos().then(setMedicos).catch(() => {});
    fetchUnidadesSaude().then(setUnidades).catch(() => {});
    labsListar().then(setLabs).catch(() => {});
  }, []);

  async function salvar() {
    setErroModal("");
    setOk("");
    setTemporaria(null);
    if (!editId && !form.username.trim()) {
      setErroModal("Usuário é obrigatório.");
      return;
    }
    if (form.telas.length === 0) {
      setErroModal("Selecione ao menos 1 tela permitida.");
      return;
    }
    setSalvando(true);
    try {
      if (editId) {
        await updateUsuario(editId, {
          nome: form.nome,
          area: form.area,
          telas: form.telas,
          acoes: form.acoes,
          medico_id: form.medico_id ? Number(form.medico_id) : null,
          unidade_saude_id: form.unidade_saude_id ? Number(form.unidade_saude_id) : null,
          laboratorio_id: form.laboratorio_id ? Number(form.laboratorio_id) : null,
          permite_retroativo: form.permite_retroativo,
          is_superuser: form.is_superuser,
          is_active: form.is_active,
        });
        setOk("Usuário atualizado.");
        fecharModal();
      } else {
        const { medico_id, unidade_saude_id, laboratorio_id, ...resto } = form;
        const r = await createUsuario({
          ...resto,
          medico_id: medico_id ? Number(medico_id) : null,
          unidade_saude_id: unidade_saude_id ? Number(unidade_saude_id) : null,
          laboratorio_id: laboratorio_id ? Number(laboratorio_id) : null,
          gerar_temporaria: true,
        });
        const senha = (r as unknown as { senha_temporaria?: string }).senha_temporaria ?? "";
        setTemporaria({ user: form.username.trim(), senha });
        setOk(`Conta ${form.username.trim()} criada com senha temporária.`);
        fecharModal();
      }
      await carregar();
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } }).response?.data
          ?.detail ?? "Erro ao salvar.";
      setErroModal(msg);
    } finally {
      setSalvando(false);
    }
  }

  function abrirModal(u?: Usuario) {
    setErroModal("");
    setOk("");
    setTemporaria(null);
    if (u) {
      setEditId(u.id);
      setForm({
        username: u.username,
        nome: u.nome,
        area: u.area,
        telas: u.telas,
        acoes: sanitizarAcoes(u.acoes),
        medico_id: u.medico_id ? String(u.medico_id) : "",
        unidade_saude_id: u.unidade_saude_id ? String(u.unidade_saude_id) : "",
        laboratorio_id: u.laboratorio_id ? String(u.laboratorio_id) : "",
        permite_retroativo: u.permite_retroativo !== false,
        is_superuser: u.is_superuser,
        is_active: u.is_active,
      });
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
    setErroModal("");
  }

  async function resetar(u: Usuario) {
    if (!confirm(`Resetar senha de ${u.username}? Nova temporária + troca obrigatória no próximo login.`)) return;
    setResetando(u.id);
    setErro("");
    setOk("");
    setTemporaria(null);
    try {
      const r = await resetSenhaUsuario(u.id);
      setTemporaria({ user: u.username, senha: r.senha_temporaria });
      setOk(`Senha de ${u.username} resetada. Entregue a temporária.`);
      await carregar();
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } }).response?.data
          ?.detail ?? "Erro ao resetar senha.";
      setErro(msg);
    } finally {
      setResetando(null);
    }
  }

  function copiar(s: string) {
    navigator.clipboard?.writeText(s).catch(() => {});
  }

  async function excluir(id: number) {
    if (!confirm("Excluir usuário?")) return;
    try {
      await deleteUsuario(id);
      if (editId === id) fecharModal();
      setOk("Usuário excluído.");
      await carregar();
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } }).response?.data
          ?.detail ?? "Erro ao excluir.";
      setErro(msg);
    }
  }

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h1 className="font-display text-2xl font-extrabold text-sus-950">
          Contas
        </h1>
        <ExportarExcel url="/api/usuarios/exportar" arquivo="usuarios" />
        <Button onClick={() => abrirModal()} className="ml-auto">
          <Plus className="h-4 w-4" /> Nova conta
        </Button>
      </div>
      <p className="mb-4 mt-1 text-sm text-ink/55">
        CRUD restrito a superusers. Senha nunca exibida — só temporária 1 vez na criação/reset.
      </p>

      {erro && !modal && (
        <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          {erro}
        </p>
      )}
      {ok && (
        <p className="mb-3 rounded-xl bg-teal/10 px-3 py-2 text-sm font-medium text-teal">
          {ok}
        </p>
      )}
      {temporaria && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
          <KeyRound className="h-4 w-4 text-amber-700" />
          <span className="font-semibold text-amber-900">
            Temporária de {temporaria.user}:
          </span>
          <code className="rounded-lg bg-white px-2.5 py-1 font-mono text-sm font-bold text-sus-950">
            {temporaria.senha}
          </code>
          <button
            onClick={() => copiar(temporaria.senha)}
            className="inline-flex items-center gap-1 rounded-lg bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-900 hover:bg-amber-200"
          >
            <Copy className="h-3.5 w-3.5" /> Copiar
          </button>
          <button
            onClick={() => setTemporaria(null)}
            className="ml-auto rounded-lg px-2 py-1 text-xs text-amber-700 hover:bg-amber-100"
          >
            Ocultar (não mostra de novo)
          </button>
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-sus-900/10 bg-sand text-xs uppercase tracking-wide text-sus-900/60">
              <th className="px-4 py-3">Usuário</th>
              <th className="px-4 py-3">Área</th>
              <th className="px-4 py-3">Telas</th>
              <th className="px-4 py-3">Flags</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((u) => (
              <tr key={u.id} className="border-b border-sus-900/5 last:border-0">
                <td className="px-4 py-3">
                  <p className="font-semibold text-sus-950">{u.username}</p>
                  <p className="text-xs text-ink/50">{u.nome || "—"}</p>
                  {(u.unidade_saude_nome || unidades.find((x) => x.id === u.unidade_saude_id)?.nome) && (
                    <span className="mt-0.5 inline-block rounded-md bg-teal/10 px-1.5 py-0.5 text-[10px] font-semibold text-teal">
                      🏥 {u.unidade_saude_nome || unidades.find((x) => x.id === u.unidade_saude_id)?.nome}
                    </span>
                  )}
                  {(u.laboratorio_nome || labs.find((x) => x.id === u.laboratorio_id)?.nome) && (
                    <span className="mt-0.5 ml-1 inline-block rounded-md bg-purple-50 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700 border border-purple-200">
                      🧪 {u.laboratorio_nome || labs.find((x) => x.id === u.laboratorio_id)?.nome}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">{u.area}</td>
                <td className="px-4 py-3 text-xs text-ink/60">
                  {u.telas.join(", ") || "—"}
                </td>
                <td className="px-4 py-3 text-xs">
                  {u.is_superuser ? "★ super " : ""}
                  {u.is_active ? "ativo" : "inativo"}
                  {u.must_change_password ? " · troca pendente" : ""}
                  {u.medico_id ? ` · médico #${u.medico_id}` : ""}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <button
                      onClick={() => abrirModal(u)}
                      className="rounded-lg p-2 text-sus-800 hover:bg-sus-100"
                      title="Editar"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => resetar(u)}
                      disabled={resetando === u.id}
                      className="rounded-lg p-2 text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                      title="Resetar senha (nova temporária + troca obrigatória)"
                    >
                      <KeyRound className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => excluir(u.id)}
                      className="rounded-lg p-2 text-red-600 hover:bg-red-50"
                      title="Excluir"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {lista.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-ink/45">
                  Nenhum usuário.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
        <Paginacao page={page} pages={pages} total={total} onPage={(p) => carregar(p)} />
      </Card>

      {modal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4" onClick={fecharModal}>
          <div className="rise max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl bg-white p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between gap-2">
              <p className="font-display text-base font-bold text-sus-950">
                {editId ? `Editar conta #${editId}` : "Nova conta (temporária automática)"}
              </p>
              <button onClick={fecharModal} className="rounded-lg p-2 text-ink/50 hover:bg-sand" aria-label="Fechar">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <Label>Usuário (login) *</Label>
                <Input
                  value={form.username}
                  disabled={editId !== null}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  placeholder="ex: maria.tfd"
                />
              </div>
              <div>
                <Label>Nome</Label>
                <Input
                  value={form.nome}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })}
                  placeholder="Nome completo"
                />
              </div>
              {!editId && (
                <p className="rounded-xl bg-sand/70 px-3 py-2 text-xs text-ink/60">
                  Senha temporária gerada automaticamente (hash bcrypt) + troca obrigatória no 1º login. Exibida 1 vez após criar.
                </p>
              )}
              <div>
                <Label>Área</Label>
                <Select
                  value={form.area}
                  onChange={(e) => setForm({ ...form, area: e.target.value })}
                >
                  <option value="painel">painel</option>
                  <option value="ferramentas">ferramentas</option>
                </Select>
              </div>
              <div>
                <Label>Unidade de Saúde / PSF do Usuário</Label>
                <Select
                  value={form.unidade_saude_id}
                  onChange={(e) => setForm({ ...form, unidade_saude_id: e.target.value })}
                >
                  <option value="">Nenhuma / Secretaria Central</option>
                  {unidades.filter((u) => u.ativo).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nome}
                    </option>
                  ))}
                </Select>
                <p className="mt-1 text-xs text-ink/50">
                  Unidade padrão atribuída a este operador para preenchimento automático em formulários de exames e filas.
                </p>
              </div>
              <div>
                <Label>Médico vinculado (perfil Médico)</Label>
                <Select
                  value={form.medico_id}
                  onChange={(e) => setForm({ ...form, medico_id: e.target.value })}
                >
                  <option value="">Nenhum (não é médico)</option>
                  {medicos.filter((m) => m.ativo).map((m) => (
                    <option key={m.id} value={m.id}>{m.nome}{m.crm ? ` · ${m.crm}` : ""}</option>
                  ))}
                </Select>
                <p className="mt-1 text-xs text-ink/50">
                  Combine com a tela <b>Painel Médico</b> nas permissões. Só o médico vinculado edita prioridade/justificativa dos próprios encaminhamentos.
                </p>
              </div>
              <div>
                <Label>Laboratório Conveniado Vinculado</Label>
                <Select
                  value={form.laboratorio_id}
                  onChange={(e) => setForm({ ...form, laboratorio_id: e.target.value })}
                >
                  <option value="">Nenhum / Não vinculado a laboratório</option>
                  {labs.filter((l) => l.ativo).map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.nome} {l.cnes ? `(CNES: ${l.cnes})` : ""}
                    </option>
                  ))}
                </Select>
                <p className="mt-1 text-xs text-ink/50">
                  Atribui o usuário a um laboratório conveniado específico, restringindo o acesso exclusivamente aos pedidos e coletas desta unidade.
                </p>
              </div>
              <div>
                <Label>Permissões — módulos, telas e ações *</Label>
                <PermissoesTree
                  telas={form.telas}
                  acoes={form.acoes}
                  onChange={(telas, acoes) => setForm((f) => ({ ...f, telas, acoes }))}
                />
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.permite_retroativo}
                    onChange={(e) => setForm({ ...form, permite_retroativo: e.target.checked })}
                    className="h-4 w-4 accent-teal"
                  />
                  Permitir lançamentos retroativos
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.is_superuser}
                    onChange={(e) => setForm({ ...form, is_superuser: e.target.checked })}
                    className="h-4 w-4 accent-sus-900"
                  />
                  Superuser
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                    className="h-4 w-4 accent-teal"
                  />
                  Ativo
                </label>
              </div>
              {erroModal && (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                  {erroModal}
                </p>
              )}
              <Button onClick={salvar} disabled={salvando} className="w-full">
                {editId ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {salvando ? "Salvando…" : editId ? "Atualizar" : "Criar com temporária"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
