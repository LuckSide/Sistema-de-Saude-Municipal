import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Building2, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import {
  type Medico,
  type SigtapCbo,
  type UnidadeSaude,
  type EspecialidadeCat,
  createMedico,
  deleteMedico,
  fetchMedicos,
  fetchUnidadesSaude,
  pagData,
  sigtapCbos,
  tfdEspecialidades,
  updateMedico,
} from "../services/api";
import {
  erros422,
  normalizaCrm,
  toastCampos,
  validaCpf,
  validaCrm,
  validaEmail,
  validaTelefone,
} from "../utils/validacoes";
import { Button, Card, Input, Label } from "../components/ui/primitives";
import { useUndo } from "../components/UndoToast";
import { useConfirm } from "../components/ConfirmDialog";
import ExportarExcel from "../components/ExportarExcel";
import { useBackdropClose } from "../hooks/useBackdropClose";

const vazio = {
  nome: "",
  cpf: "",
  crm: "",
  cbo_codigo: "",
  cbo_descricao: "",
  especialidades: "",
  telefone: "",
  email: "",
  ativo: true,
  unidades_ids: [] as number[],
};

export default function Medicos() {
  const { notificarUndo } = useUndo();
  const { confirmar } = useConfirm();
  const [lista, setLista] = useState<Medico[]>([]);
  const [unidades, setUnidades] = useState<UnidadeSaude[]>([]);
  const [sp] = useSearchParams();
  const [form, setForm] = useState<typeof vazio>(vazio);
  const [editId, setEditId] = useState<number | null>(null);
  const [modal, setModal] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [erroModal, setErroModal] = useState("");
  const [erros, setErros] = useState<Record<string, string>>({});
  const [ok, setOk] = useState("");
  const [cbos, setCbos] = useState<SigtapCbo[]>([]);
  const [buscaCbo, setBuscaCbo] = useState("");
  const [buscaUnidade, setBuscaUnidade] = useState("");
  const [buscaEsp, setBuscaEsp] = useState("");
  const [especialidadesCadastradas, setEspecialidadesCadastradas] = useState<EspecialidadeCat[]>([]);

  // Filtros de busca instantânea na listagem (Requisito 3)
  const [buscaTabela, setBuscaTabela] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<"todos" | "ativos" | "inativos">("todos");

  const medicosFiltrados = useMemo(() => {
    let res = lista;
    if (filtroStatus === "ativos") res = res.filter((m) => m.ativo);
    if (filtroStatus === "inativos") res = res.filter((m) => !m.ativo);
    const termo = buscaTabela.trim().toLowerCase();
    if (!termo) return res;
    return res.filter((m) => {
      const unis = (m.unidades_ids || [])
        .map((uid) => unidades.find((u) => u.id === uid)?.nome || "")
        .join(" ");
      const texto = `${m.nome} ${m.crm || ""} ${m.cpf || ""} ${m.cbo_codigo || ""} ${m.cbo_descricao || ""} ${m.especialidades || ""} ${m.telefone || ""} ${m.email || ""} ${unis}`.toLowerCase();
      return texto.includes(termo);
    });
  }, [lista, buscaTabela, filtroStatus, unidades]);

  const backdrop = useBackdropClose(fechar, modal);

  const ROTULOS: Record<string, string> = {
    nome: "Nome completo", cpf: "CPF", crm: "CRM", telefone: "Telefone", email: "E-mail",
  };
  const borda = (c: string) => (erros[c] ? "!border-red-500 focus:!border-red-500" : "");
  const msg = (c: string) =>
    erros[c] ? <p className="mt-1 text-xs font-medium text-red-600">{erros[c]}</p> : null;

  function validar(f: typeof vazio): Record<string, string> {
    const e: Record<string, string> = {};
    const cpf = validaCpf(f.cpf);
    if (cpf) e.cpf = cpf;
    const crm = validaCrm(f.crm);
    if (crm) e.crm = crm;
    const tel = validaTelefone(f.telefone);
    if (tel) e.telefone = tel;
    const mail = validaEmail(f.email);
    if (mail) e.email = mail;
    return e;
  }

  async function carregar() {
    try {
      const [meds, unis, esps] = await Promise.all([
        fetchMedicos(),
        fetchUnidadesSaude(),
        tfdEspecialidades({ limit: 200 }).catch(() => []),
      ]);
      setLista(meds);
      setUnidades(unis);
      setEspecialidadesCadastradas(pagData<EspecialidadeCat>(esps));
    } catch {
      setErro("Falha ao carregar médicos e unidades de saúde.");
    }
  }
  useEffect(() => { carregar(); }, []);
  useEffect(() => {
    if (!modal) return;
    const t = setTimeout(() => {
      sigtapCbos("", buscaCbo.trim() || undefined).then(setCbos).catch(() => setCbos([]));
    }, 250);
    return () => clearTimeout(t);
  }, [modal, buscaCbo]);
  useEffect(() => {
    const rid = Number(sp.get("registro"));
    if (!rid || modal) return;
    const m = lista.find((x) => x.id === rid);
    if (m) abrir(m);
  }, [sp, lista, modal]);

  function abrir(m?: Medico) {
    setErroModal(""); setErros({}); setOk("");
    if (m) {
      setEditId(m.id);
      setForm({
        nome: m.nome,
        cpf: m.cpf,
        crm: m.crm,
        cbo_codigo: m.cbo_codigo ?? "",
        cbo_descricao: m.cbo_descricao ?? "",
        especialidades: m.especialidades,
        telefone: m.telefone,
        email: m.email,
        ativo: m.ativo,
        unidades_ids: m.unidades_ids ? [...m.unidades_ids] : [],
      });
    } else {
      setEditId(null);
      setForm(vazio);
    }
    setBuscaCbo("");
    setModal(true);
  }
  function fechar() {
    setModal(false);
    setEditId(null);
    setForm(vazio);
    setErroModal("");
    setErros({});
    setBuscaCbo("");
    setBuscaUnidade("");
    setBuscaEsp("");
  }

  async function salvar() {
    setErroModal("");
    const injecao: Record<string, string> = {};
    if (form.nome.trim().length < 2) injecao.nome = "Nome é obrigatório.";
    const e = { ...validar(form), ...injecao };
    if (Object.keys(e).length > 0) {
      setErros(e);
      setErroModal(toastCampos(e, ROTULOS));
      return;
    }
    setSalvando(true);
    try {
      const payload = { ...form, crm: normalizaCrm(form.crm), unidades_ids: form.unidades_ids };
      if (editId) {
        await updateMedico(editId, payload);
        setOk("Médico atualizado com sucesso.");
      } else {
        const criado = await createMedico(payload);
        if (criado?.usuario_criado && criado?.senha_temporaria) {
          setOk(`Médico cadastrado com sucesso! Usuário criado: "${criado.usuario_criado}" | Senha provisória: "${criado.senha_temporaria}".`);
        } else {
          setOk("Médico cadastrado com sucesso.");
        }
      }
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
  async function excluir(m: Medico) {
    const ok = await confirmar({
      titulo: `Inativar médico(a) ${m.nome}`,
      descricao: `Deseja realmente inativar o cadastro de ${m.nome}? Você poderá reativá-lo a qualquer momento.`,
      textoConfirmar: "Sim, Inativar",
      variante: "danger",
    });
    if (!ok) return;
    const snap = { ...m };
    try {
      await deleteMedico(m.id);
      await carregar();
      notificarUndo({
        titulo: `Médico ${snap.nome} inativado.`,
        descricao: "Desfazer reativa o cadastro.",
        onUndo: async () => {
          await updateMedico(snap.id, {
            nome: snap.nome, cpf: snap.cpf, crm: snap.crm,
            cbo_codigo: snap.cbo_codigo ?? "",
            cbo_descricao: snap.cbo_descricao ?? "",
            especialidades: snap.especialidades,
            telefone: snap.telefone, email: snap.email, ativo: true,
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
        <h1 className="font-display text-2xl font-extrabold text-sus-950">Médicos / profissionais</h1>
        <ExportarExcel url="/api/medicos/exportar" arquivo="medicos" />
        <Button onClick={() => abrir()} className="ml-auto"><Plus className="h-4 w-4" /> Novo médico</Button>
      </div>
      <p className="mb-4 mt-1 text-sm text-ink/55">Cadastro administrativo de médicos e profissionais de saúde.</p>
      {erro && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{erro}</p>}
      {ok && <p className="mb-3 rounded-xl bg-teal/10 px-3 py-2 text-sm font-medium text-teal">{ok}</p>}

      {/* Barra de Filtro e Busca Instantânea (Requisito 3) */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sus-900/10 bg-white p-3.5 shadow-2xs">
        <div className="relative min-w-[260px] flex-1 sm:max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/40" />
          <Input
            value={buscaTabela}
            onChange={(e) => setBuscaTabela(e.target.value)}
            placeholder="Pesquisar por nome, CRM, CBO, especialidade, unidade…"
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
              Todos ({lista.length})
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
              Ativos ({lista.filter((m) => m.ativo).length})
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
              Inativos ({lista.filter((m) => !m.ativo).length})
            </button>
          </div>
          <span className="text-xs text-ink/50 ml-1">
            {medicosFiltrados.length} de {lista.length}
          </span>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b border-sus-900/10 bg-sand text-xs uppercase tracking-wide text-sus-900/60">
            <th className="px-4 py-3">Nome</th>
            <th className="px-4 py-3">CRM</th>
            <th className="px-4 py-3">Unidades de Atuação (PSF)</th>
            <th className="px-4 py-3">Especialidades</th>
            <th className="px-4 py-3">Contato</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3 text-right">Ações</th>
          </tr></thead>
          <tbody>
            {medicosFiltrados.map((m) => (
              <tr key={m.id} className="border-b border-sus-900/5 last:border-0 hover:bg-sand/30 transition">
                <td className="px-4 py-3"><p className="font-semibold text-sus-950">{m.nome}</p><p className="text-xs text-ink/50">{m.cpf || "—"}</p></td>
                <td className="px-4 py-3">{m.crm || "—"}<p className="text-xs text-ink/50">{m.cbo_codigo ? `CBO ${m.cbo_codigo}` : ""}{m.cbo_descricao ? ` · ${m.cbo_descricao}` : ""}</p></td>
                <td className="px-4 py-3">
                  {m.unidades_ids && m.unidades_ids.length > 0 ? (
                    <div className="flex flex-wrap gap-1 max-w-[240px]">
                      {m.unidades_ids.map((uid) => {
                        const u = unidades.find((x) => x.id === uid);
                        return u ? (
                          <span key={uid} className="inline-flex items-center rounded-md bg-teal/10 px-1.5 py-0.5 text-[10px] font-semibold text-teal">
                            {u.nome}
                          </span>
                        ) : null;
                      })}
                    </div>
                  ) : (
                    <span className="text-xs text-ink/40">Todas / Não restrito</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-ink/60">{m.especialidades || "—"}</td>
                <td className="px-4 py-3 text-xs text-ink/60">{m.telefone || "—"} {m.email ? `· ${m.email}` : ""}</td>
                <td className="px-4 py-3 text-xs">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${m.ativo ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>
                    {m.ativo ? "ativo" : "inativo"}
                  </span>
                </td>
                <td className="px-4 py-3"><div className="flex justify-end gap-1">
                  <button onClick={() => abrir(m)} className="rounded-lg p-2 text-sus-800 hover:bg-sus-100" title="Editar"><Pencil className="h-4 w-4" /></button>
                  <button onClick={() => excluir(m)} className="rounded-lg p-2 text-red-600 hover:bg-red-50" title="Inativar"><Trash2 className="h-4 w-4" /></button>
                </div></td>
              </tr>
            ))}
            {medicosFiltrados.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-ink/45">
                  {buscaTabela ? `Nenhum profissional encontrado para “${buscaTabela}”.` : "Nenhum médico cadastrado."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </Card>

      {modal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4" {...backdrop}>
          <div className="rise max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl bg-white p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between gap-2">
              <p className="font-display text-base font-bold text-sus-950">{editId ? "Editar médico" : "Novo médico"}</p>
              <button onClick={fechar} className="rounded-lg p-2 text-ink/50 hover:bg-sand" aria-label="Fechar"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="md:col-span-2"><Label>Nome completo *</Label><Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} className={borda("nome")} />{msg("nome")}</div>
              <div><Label>CPF *</Label><Input value={form.cpf} onChange={(e) => setForm({ ...form, cpf: e.target.value })} placeholder="Somente números" inputMode="numeric" className={borda("cpf")} />{msg("cpf")}</div>
              <div><Label>CRM / registro *</Label><Input value={form.crm} onChange={(e) => setForm({ ...form, crm: e.target.value })} placeholder="Ex: CRM/MG 123456" className={borda("crm")} />{msg("crm")}</div>
              <div><Label>CBO (código)</Label><Input value={form.cbo_codigo} onChange={(e) => { setForm({ ...form, cbo_codigo: e.target.value.replace(/\D/g, "").slice(0, 6) }); setBuscaCbo(e.target.value.replace(/\D/g, "").slice(0, 6)); }} placeholder="Ex: 225125" inputMode="numeric" /></div>
              <div className="md:col-span-2"><Label>CBO (descrição — SIGTAP)</Label><Input value={buscaCbo || form.cbo_descricao} onChange={(e) => { setBuscaCbo(e.target.value); setForm({ ...form, cbo_descricao: e.target.value }); }} placeholder="Buscar CBO na tabela SIGTAP…" list="cbo-sigtap-list" /></div>
              {cbos.length > 0 && (
                <div className="md:col-span-2 -mt-1 max-h-36 overflow-y-auto rounded-xl border border-sus-900/10 bg-white">
                  {cbos.slice(0, 20).map((c) => (
                    <button key={`${c.cbo}-${c.descricao}`} type="button" onClick={() => { setForm({ ...form, cbo_codigo: c.cbo, cbo_descricao: c.descricao }); setBuscaCbo(""); setCbos([]); }} className="block w-full px-3 py-2 text-left text-sm hover:bg-sand">
                      <b>{c.cbo}</b> <span className="text-xs text-ink/50">{c.descricao} · {c.origem}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="md:col-span-2">
                <Label>Especialidade(s)</Label>
                <div className="relative">
                  <Input
                    value={form.especialidades}
                    onChange={(e) => setForm({ ...form, especialidades: e.target.value })}
                    placeholder="Digite ou selecione uma especialidade (separar por vírgula)"
                  />
                </div>
                {especialidadesCadastradas.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {especialidadesCadastradas.slice(0, 10).map((esp) => {
                      const jaTem = (form.especialidades || "")
                        .split(",")
                        .map((s) => s.trim().toLowerCase())
                        .includes(esp.nome.toLowerCase());
                      return (
                        <button
                          key={esp.id}
                          type="button"
                          onClick={() => {
                            const atuais = form.especialidades
                              ? form.especialidades.split(",").map((s) => s.trim()).filter(Boolean)
                              : [];
                            if (jaTem) {
                              setForm({
                                ...form,
                                especialidades: atuais.filter((s) => s.toLowerCase() !== esp.nome.toLowerCase()).join(", "),
                              });
                            } else {
                              setForm({
                                ...form,
                                especialidades: [...atuais, esp.nome].join(", "),
                              });
                            }
                          }}
                          className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition ${
                            jaTem
                              ? "bg-teal text-white shadow-2xs"
                              : "bg-sand hover:bg-teal/15 text-sus-900 border border-sus-900/10"
                          }`}
                        >
                          {jaTem ? "✓ " : "+ "}{esp.nome}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div><Label>Telefone</Label><Input value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} placeholder="DDD + número" className={borda("telefone")} />{msg("telefone")}</div>
              <div><Label>E-mail</Label><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="usuario@dominio.ext" className={borda("email")} />{msg("email")}</div>

              {/* Vínculo com Unidades de Saúde / PSF */}
              <div className="md:col-span-2">
                <div className="mb-1.5 flex items-center justify-between">
                  <Label className="!mb-0 flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5 text-teal" />
                    Unidades de Saúde / PSF de Atuação ({form.unidades_ids.length} selecionada{form.unidades_ids.length === 1 ? "" : "s"})
                  </Label>
                  <div className="flex gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, unidades_ids: unidades.filter((u) => u.ativo).map((u) => u.id) })}
                      className="font-bold text-teal hover:underline"
                    >
                      Todas
                    </button>
                    <span className="text-ink/30">|</span>
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, unidades_ids: [] })}
                      className="font-bold text-red-600 hover:underline"
                    >
                      Nenhuma
                    </button>
                  </div>
                </div>

                {/* Campo de pesquisa por digitação para unidades */}
                <div className="relative mb-2">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink/40" />
                  <Input
                    value={buscaUnidade}
                    onChange={(e) => setBuscaUnidade(e.target.value)}
                    placeholder="Pesquisar unidade por nome ou CNES…"
                    className="pl-8 !py-1 text-xs"
                  />
                  {buscaUnidade && (
                    <button
                      type="button"
                      onClick={() => setBuscaUnidade("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink/40 hover:text-ink"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                <div className="grid max-h-40 grid-cols-1 gap-2 overflow-y-auto rounded-xl border border-sus-900/10 bg-sand/30 p-2.5 sm:grid-cols-2">
                  {unidades
                    .filter(
                      (u) =>
                        u.ativo &&
                        (!buscaUnidade.trim() ||
                          u.nome.toLowerCase().includes(buscaUnidade.toLowerCase()) ||
                          (u.cnes && u.cnes.includes(buscaUnidade.trim())))
                    )
                    .map((u) => {
                      const marcado = form.unidades_ids.includes(u.id);
                      return (
                        <label
                          key={u.id}
                          className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-xs transition ${
                            marcado ? "border-teal bg-teal/10 font-bold text-teal" : "border-sus-900/10 bg-white text-ink/75 hover:bg-sand"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={marcado}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setForm((f) => ({
                                ...f,
                                unidades_ids: checked
                                  ? [...f.unidades_ids, u.id]
                                  : f.unidades_ids.filter((id) => id !== u.id),
                              }));
                            }}
                            className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-teal"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate leading-tight">{u.nome}</p>
                            {u.cnes && <p className="text-[10px] font-normal text-ink/45">CNES: {u.cnes}</p>}
                          </div>
                        </label>
                      );
                    })}
                  {unidades.filter(
                    (u) =>
                      u.ativo &&
                      (!buscaUnidade.trim() ||
                        u.nome.toLowerCase().includes(buscaUnidade.toLowerCase()) ||
                        (u.cnes && u.cnes.includes(buscaUnidade.trim())))
                  ).length === 0 && (
                    <p className="col-span-2 py-3 text-center text-xs text-ink/45">
                      {buscaUnidade ? "Nenhuma unidade encontrada para esta busca." : "Nenhuma unidade de saúde cadastrada."}
                    </p>
                  )}
                </div>
              </div>

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
