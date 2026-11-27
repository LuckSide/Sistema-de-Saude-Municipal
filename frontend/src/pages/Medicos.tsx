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
  tfdCboEspecialidades,
  tfdEspecialidades,
  updateMedico,
} from "../services/api";
import {
  erros422,
  formataCns,
  normalizaCrm,
  toastCampos,
  validaCns,
  validaCpf,
  validaCrm,
  validaEmail,
  validaTelefone,
  UFS,
} from "../utils/validacoes";
import { Button, Card, Input, Label } from "../components/ui/primitives";
import { useUndo } from "../components/UndoToast";
import { useConfirm } from "../components/ConfirmDialog";
import ExportarExcel from "../components/ExportarExcel";
import { useBackdropClose } from "../hooks/useBackdropClose";
import { medicosPorCbo, normalizarCodigoCbo } from "../utils/medicos";

const CONSELHOS = ["CRM", "COREN", "CRF", "CRO", "CREFITO", "CRP", "CRESS", "CRN", "CRFa", "OUTROS"];
const VINCULOS = [
  { valor: "ESTATUTARIO", rotulo: "Estatutário (Concursado/Efetivo)" },
  { valor: "CLT", rotulo: "CLT (Emprego Público)" },
  { valor: "TEMPORARIO", rotulo: "Contrato Temporário" },
  { valor: "AUTONOMO_CREDENCIADO", rotulo: "Autônomo Credenciado / PJ" },
  { valor: "COOPERADO", rotulo: "Cooperado" },
];

const vazio = {
  nome: "",
  cpf: "",
  cns: "",
  crm: "",
  conselho_tipo: "CRM",
  conselho_uf: "MG",
  cbo_codigo: "",
  cbo_descricao: "",
  especialidade: "",
  especialidades: "",
  vinculo: "ESTATUTARIO",
  chs_total: 40,
  chs_ambulatorial: 40,
  chs_hospitalar: 0,
  chs_outros: 0,
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
  const [formInicial, setFormInicial] = useState<typeof vazio>(vazio);
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
  const [espsPorCbo, setEspsPorCbo] = useState<{ codigo_cbo: string; nome: string }[]>([]);

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
      const texto = `${m.nome} ${m.cns || ""} ${m.crm || ""} ${m.conselho_tipo || ""} ${m.conselho_uf || ""} ${m.vinculo || ""} ${m.cpf || ""} ${m.cbo_codigo || ""} ${m.cbo_descricao || ""} ${m.especialidade || ""} ${m.especialidades || ""} ${m.telefone || ""} ${m.email || ""} ${unis}`.toLowerCase();
      return texto.includes(termo);
    });
  }, [lista, buscaTabela, filtroStatus, unidades]);

  const isDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(formInicial), [form, formInicial]);
  const backdrop = useBackdropClose({ onClose: fechar, aberto: modal, isDirty });

  const ROTULOS: Record<string, string> = {
    nome: "Nome completo",
    cpf: "CPF",
    cns: "Cartão Nacional de Saúde (CNS)",
    crm: "Registro do Conselho",
    conselho_tipo: "Tipo de Conselho",
    conselho_uf: "UF do Conselho",
    vinculo: "Vínculo Empregatício",
    chs_total: "Carga Horária Semanal (CHS)",
    telefone: "Telefone",
    email: "E-mail",
  };
  const borda = (c: string) => (erros[c] ? "!border-red-500 focus:!border-red-500" : "");
  const msg = (c: string) =>
    erros[c] ? <p className="mt-1 text-xs font-medium text-red-600">{erros[c]}</p> : null;

  function validar(f: typeof vazio): Record<string, string> {
    const e: Record<string, string> = {};
    const cpf = validaCpf(f.cpf);
    if (cpf) e.cpf = cpf;
    if (f.cns) {
      const cnsErr = validaCns(f.cns);
      if (cnsErr) e.cns = cnsErr;
    }
    const crmTexto = f.crm.trim().includes("/") || /[A-Z]{2}/i.test(f.crm)
      ? f.crm
      : `${f.conselho_tipo || "CRM"}/${f.conselho_uf || "MG"} ${f.crm}`.trim();
    const crm = validaCrm(crmTexto);
    if (crm) e.crm = crm;
    const tel = validaTelefone(f.telefone);
    if (tel) e.telefone = tel;
    const mail = validaEmail(f.email);
    if (mail) e.email = mail;
    if (f.chs_total < 0 || f.chs_total > 168) e.chs_total = "CHS deve ser entre 0 e 168 horas semanais.";
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
    if (!modal) {
      setEspsPorCbo([]);
      return;
    }
    const cbo = normalizarCodigoCbo(form.cbo_codigo);
    if (cbo.length < 4) {
      setEspsPorCbo([]);
      return;
    }
    let cancel = false;
    tfdCboEspecialidades(cbo)
      .then((res) => {
        if (!cancel) setEspsPorCbo(res?.especialidades ?? []);
      })
      .catch(() => {
        if (!cancel) setEspsPorCbo([]);
      });
    return () => {
      cancel = true;
    };
  }, [modal, form.cbo_codigo]);

  const especialidadesFiltradasModal = useMemo(() => {
    const cbo = normalizarCodigoCbo(form.cbo_codigo);
    if (cbo.length < 4) return especialidadesCadastradas.slice(0, 12);
    const mapa = new Map<string, { id: number | string; nome: string; codigo_cbo: string }>();
    for (const e of espsPorCbo) {
      if (e.nome && !mapa.has(e.nome.toLowerCase())) {
        mapa.set(e.nome.toLowerCase(), { id: `${e.codigo_cbo}-${e.nome}`, nome: e.nome, codigo_cbo: e.codigo_cbo });
      }
    }
    for (const e of especialidadesCadastradas) {
      const ec = normalizarCodigoCbo(e.codigo_cbo);
      if (ec && ec === cbo && !mapa.has(e.nome.toLowerCase())) {
        mapa.set(e.nome.toLowerCase(), { id: e.id, nome: e.nome, codigo_cbo: ec });
      }
    }
    return Array.from(mapa.values());
  }, [form.cbo_codigo, espsPorCbo, especialidadesCadastradas]);

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
      const val = {
        nome: m.nome,
        cpf: m.cpf,
        cns: m.cns ?? "",
        crm: m.crm,
        conselho_tipo: m.conselho_tipo ?? "CRM",
        conselho_uf: m.conselho_uf ?? "MG",
        cbo_codigo: m.cbo_codigo ?? "",
        cbo_descricao: m.cbo_descricao ?? "",
        especialidade: m.especialidade ?? "",
        especialidades: m.especialidades,
        vinculo: m.vinculo ?? "ESTATUTARIO",
        chs_total: m.chs_total ?? 40,
        chs_ambulatorial: m.chs_ambulatorial ?? 40,
        chs_hospitalar: m.chs_hospitalar ?? 0,
        chs_outros: m.chs_outros ?? 0,
        telefone: m.telefone,
        email: m.email,
        ativo: m.ativo,
        unidades_ids: m.unidades_ids ? [...m.unidades_ids] : [],
      };
      setForm(val);
      setFormInicial(val);
    } else {
      setEditId(null);
      setForm(vazio);
      setFormInicial(vazio);
    }
    setBuscaCbo("");
    setModal(true);
  }
  function fechar() {
    setModal(false);
    setEditId(null);
    setForm(vazio);
    setFormInicial(vazio);
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

    // Validação Relacional Estrita CBO x Especialidades (SIGTAP)
    const cboClean = (form.cbo_codigo || "").replace(/\D/g, "");
    if (cboClean.length >= 4 && form.especialidades.trim()) {
      const selecionadas = form.especialidades.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
      const autorizadasNomes = new Set(
        especialidadesFiltradasModal.map((x) => x.nome.trim().toLowerCase())
      );
      if (autorizadasNomes.size > 0) {
        const invalidas = selecionadas.filter((s) => !autorizadasNomes.has(s));
        if (invalidas.length > 0) {
          setErroModal(
            `A(s) especialidade(s) "${invalidas.join(", ")}" não são autorizadas no SIGTAP para o CBO ${form.cbo_codigo}. Selecione apenas especialidades vinculadas ao profissional.`
          );
          return;
        }
      }
    }

    setSalvando(true);
    try {
      const espPrincipal = (form.especialidade || form.especialidades.split(",")[0] || "").trim();
      let espsLista = form.especialidades.trim();
      if (espPrincipal && !espsLista) {
        espsLista = espPrincipal;
      }
      const crmTexto = form.crm.trim().includes("/") || /[A-Z]{2}/i.test(form.crm)
        ? form.crm
        : `${form.conselho_tipo || "CRM"}/${form.conselho_uf || "MG"} ${form.crm}`.trim();
      const payload = {
        ...form,
        especialidade: espPrincipal,
        especialidades: espsLista,
        crm: normalizaCrm(crmTexto),
        unidades_ids: form.unidades_ids,
      };
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
            <th className="px-4 py-3">Profissional</th>
            <th className="px-4 py-3">Conselho / CNS</th>
            <th className="px-4 py-3">Vínculo & CHS</th>
            <th className="px-4 py-3">Unidades de Atuação (PSF)</th>
            <th className="px-4 py-3">Especialidades / CBO</th>
            <th className="px-4 py-3">Contato</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3 text-right">Ações</th>
          </tr></thead>
          <tbody>
            {medicosFiltrados.map((m) => (
              <tr key={m.id} className="border-b border-sus-900/5 last:border-0 hover:bg-sand/30 transition">
                <td className="px-4 py-3">
                  <p className="font-semibold text-sus-950">{m.nome}</p>
                  <p className="text-xs text-ink/50">CPF: {m.cpf || "—"}</p>
                </td>
                <td className="px-4 py-3 text-xs">
                  <p className="font-semibold text-sus-950">{m.conselho_tipo || "CRM"}/{m.conselho_uf || "MG"} {m.crm || "—"}</p>
                  <p className="text-ink/60 font-mono text-[11px]">{m.cns ? formataCns(m.cns) : "CNS não informado"}</p>
                </td>
                <td className="px-4 py-3 text-xs">
                  <span className="inline-flex rounded bg-sus-900/5 px-1.5 py-0.5 text-[11px] font-semibold text-sus-900">
                    {m.vinculo || "ESTATUTÁRIO"}
                  </span>
                  <p className="text-ink/60 text-[11px] mt-0.5">
                    <b>{m.chs_total ?? 40}h</b> sem. (Amb: {m.chs_ambulatorial ?? 40}h{m.chs_hospitalar ? ` | Hosp: ${m.chs_hospitalar}h` : ""}{m.chs_outros ? ` | Outros: ${m.chs_outros}h` : ""})
                  </p>
                </td>
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
                <td className="px-4 py-3 text-xs text-ink/60">
                  {m.especialidade && <p className="font-semibold text-sus-950">{m.especialidade}</p>}
                  <p className="text-[11px] text-ink/50">{m.especialidades || "—"}</p>
                  <p className="text-[10px] text-ink/40 mt-0.5">{m.cbo_codigo ? `CBO ${m.cbo_codigo}` : ""}{m.cbo_descricao ? ` · ${m.cbo_descricao}` : ""}</p>
                </td>
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
                <td colSpan={8} className="px-4 py-8 text-center text-ink/45">
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
              <div>
                <Label>CPF *</Label>
                <Input
                  value={form.cpf}
                  onChange={(e) => setForm({ ...form, cpf: e.target.value })}
                  placeholder="Somente números"
                  inputMode="numeric"
                  className={borda("cpf")}
                />
                {msg("cpf")}
              </div>

              <div>
                <Label>Cartão Nacional de Saúde (CNS)</Label>
                <Input
                  value={form.cns}
                  onChange={(e) => setForm({ ...form, cns: e.target.value.replace(/\D/g, "").slice(0, 15) })}
                  placeholder="15 dígitos numéricos"
                  inputMode="numeric"
                  className={borda("cns")}
                />
                {msg("cns")}
                {form.cns && !erros.cns && validaCns(form.cns) === "" && (
                  <p className="mt-0.5 text-[10px] font-medium text-teal">✓ CNS válido ({formataCns(form.cns)})</p>
                )}
              </div>

              {/* Registro no Conselho de Classe */}
              <div className="md:col-span-2 rounded-xl border border-sus-900/10 bg-sand/20 p-3">
                <Label className="!mb-2 font-bold text-sus-950">Registro no Conselho Profissional *</Label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-ink/70">Conselho</label>
                    <select
                      value={form.conselho_tipo}
                      onChange={(e) => setForm({ ...form, conselho_tipo: e.target.value })}
                      className="w-full rounded-xl border border-sus-900/20 bg-white px-3 py-2 text-sm outline-none focus:border-teal"
                    >
                      {CONSELHOS.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-ink/70">UF</label>
                    <select
                      value={form.conselho_uf}
                      onChange={(e) => setForm({ ...form, conselho_uf: e.target.value })}
                      className="w-full rounded-xl border border-sus-900/20 bg-white px-3 py-2 text-sm outline-none focus:border-teal"
                    >
                      {Array.from(UFS).sort().map((uf) => (
                        <option key={uf} value={uf}>{uf}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-ink/70">Número do Registro *</label>
                    <Input
                      value={form.crm}
                      onChange={(e) => setForm({ ...form, crm: e.target.value })}
                      placeholder="Ex: 123456"
                      className={borda("crm")}
                    />
                    {msg("crm")}
                  </div>
                </div>
              </div>

              {/* Vínculo e Carga Horária Semanal (CHS) */}
              <div className="md:col-span-2 rounded-xl border border-sus-900/10 bg-sand/20 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <Label className="!mb-0 font-bold text-sus-950">Vínculo e Carga Horária Semanal (CHS)</Label>
                  <span className="text-[11px] text-ink/50">Diretrizes oficiais do CNES</span>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
                  <div className="sm:col-span-2 lg:col-span-2">
                    <label className="mb-1 block text-xs font-semibold text-ink/70">Vínculo</label>
                    <select
                      value={form.vinculo}
                      onChange={(e) => setForm({ ...form, vinculo: e.target.value })}
                      className="w-full rounded-xl border border-sus-900/20 bg-white px-3 py-2 text-sm outline-none focus:border-teal"
                    >
                      {VINCULOS.map((v) => (
                        <option key={v.valor} value={v.valor}>{v.rotulo}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-ink/70">CHS Total</label>
                    <Input
                      type="number"
                      min={0}
                      max={168}
                      value={form.chs_total}
                      onChange={(e) => setForm({ ...form, chs_total: parseInt(e.target.value, 10) || 0 })}
                      className={borda("chs_total")}
                    />
                    {msg("chs_total")}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-ink/70">Ambulatorial</label>
                    <Input
                      type="number"
                      min={0}
                      max={168}
                      value={form.chs_ambulatorial}
                      onChange={(e) => {
                        const amb = parseInt(e.target.value, 10) || 0;
                        setForm({
                          ...form,
                          chs_ambulatorial: amb,
                          chs_total: amb + form.chs_hospitalar + form.chs_outros,
                        });
                      }}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-ink/70">Hospitalar</label>
                    <Input
                      type="number"
                      min={0}
                      max={168}
                      value={form.chs_hospitalar}
                      onChange={(e) => {
                        const hosp = parseInt(e.target.value, 10) || 0;
                        setForm({
                          ...form,
                          chs_hospitalar: hosp,
                          chs_total: form.chs_ambulatorial + hosp + form.chs_outros,
                        });
                      }}
                    />
                  </div>
                </div>
              </div>
              <div>
                <Label>CBO (código)</Label>
                <Input
                  value={form.cbo_codigo}
                  onChange={(e) => {
                    const codLimpo = normalizarCodigoCbo(e.target.value);
                    setForm({ ...form, cbo_codigo: codLimpo });
                    setBuscaCbo(codLimpo);
                  }}
                  placeholder="Ex: 225125 ou 5151F1"
                />
              </div>
              <div className="md:col-span-2"><Label>CBO (descrição — SIGTAP)</Label><Input value={buscaCbo || form.cbo_descricao} onChange={(e) => { setBuscaCbo(e.target.value); setForm({ ...form, cbo_descricao: e.target.value }); }} placeholder="Buscar CBO na tabela SIGTAP…" list="cbo-sigtap-list" /></div>
              {cbos.length > 0 && (
                <div className="md:col-span-2 -mt-1 max-h-44 overflow-y-auto rounded-xl border border-sus-900/10 bg-white">
                  {cbos.slice(0, 30).map((c) => {
                    const profsCbo = c.profissionais ?? medicosPorCbo(lista, c.cbo, c.descricao);
                    return (
                      <button key={`${c.cbo}-${c.descricao}`} type="button" onClick={() => { setForm({ ...form, cbo_codigo: c.cbo, cbo_descricao: c.descricao }); setBuscaCbo(""); setCbos([]); }} className="block w-full border-b border-sus-900/5 px-3 py-2 text-left text-sm hover:bg-sand last:border-0">
                        <div className="flex items-center justify-between gap-2">
                          <span><b>{c.cbo}</b> <span className="text-xs text-ink/70">{c.descricao}</span></span>
                          <span className="text-[11px] font-semibold text-teal shrink-0">
                            {profsCbo.length > 0 ? `${profsCbo.length} prof.` : c.origem}
                          </span>
                        </div>
                        {profsCbo.length > 0 && (
                          <p className="mt-0.5 text-[11px] text-ink/50 truncate">
                            Profissionais: {profsCbo.slice(0, 4).map((p) => p.nome).join(", ")}{profsCbo.length > 4 ? ` (+${profsCbo.length - 4})` : ""}
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
              {normalizarCodigoCbo(form.cbo_codigo).length >= 5 && (() => {
                const profsMesmoCbo = medicosPorCbo(lista, form.cbo_codigo, form.cbo_descricao).filter((p) => p.id !== editId);
                if (profsMesmoCbo.length === 0) return null;
                return (
                  <div className="md:col-span-2 rounded-xl border border-teal/20 bg-teal/5 px-3 py-2 text-[11px] text-sus-950">
                    <span className="font-bold text-teal-900">
                      Outros profissionais ativos com CBO {normalizarCodigoCbo(form.cbo_codigo)} ({profsMesmoCbo.length}):
                    </span>{" "}
                    {profsMesmoCbo.slice(0, 8).map((p) => p.nome).join(", ")}
                    {profsMesmoCbo.length > 8 ? ` e mais ${profsMesmoCbo.length - 8}` : ""}.
                  </div>
                );
              })()}
              <div className="md:col-span-2">
                <Label>Especialidade Principal (Atuação primária)</Label>
                <Input
                  value={form.especialidade}
                  onChange={(e) => setForm({ ...form, especialidade: e.target.value })}
                  placeholder="Ex: Clínico Geral, Cardiologia, Pediatria, Ginecologia..."
                />
                <span className="text-[11px] text-ink/50">
                  Preenchida automaticamente nos formulários e filas ao selecionar este médico.
                </span>
              </div>
              <div className="md:col-span-2">
                <Label>
                  Especialidade(s){" "}
                  {normalizarCodigoCbo(form.cbo_codigo).length >= 4 && (
                    <span className="ml-1 text-[10px] font-normal text-teal">
                      (vinculadas ao CBO {form.cbo_codigo})
                    </span>
                  )}
                </Label>
                <div className="relative">
                  <Input
                    value={form.especialidades}
                    onChange={(e) => setForm({ ...form, especialidades: e.target.value })}
                    placeholder="Digite ou selecione uma especialidade (separar por vírgula)"
                  />
                </div>
                {(() => {
                  const cboClean = normalizarCodigoCbo(form.cbo_codigo);
                  if (cboClean.length < 4 || !form.especialidades.trim()) return null;
                  const selecionadas = form.especialidades.split(",").map((s) => s.trim()).filter(Boolean);
                  const autorizadasNomes = new Set(especialidadesFiltradasModal.map((x) => x.nome.trim().toLowerCase()));
                  if (autorizadasNomes.size === 0) return null;
                  const invalidas = selecionadas.filter((s) => !autorizadasNomes.has(s.toLowerCase()));
                  if (invalidas.length === 0) return null;
                  return (
                    <div className="mt-1.5 flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900">
                      <span>
                        ⚠️ Especialidade(s) não autorizada(s) para este CBO: <b>{invalidas.join(", ")}</b>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const validas = selecionadas.filter((s) => autorizadasNomes.has(s.toLowerCase()));
                          setForm({ ...form, especialidades: validas.join(", ") });
                        }}
                        className="font-bold underline text-amber-950 ml-2 cursor-pointer"
                      >
                        Remover incompatíveis
                      </button>
                    </div>
                  );
                })()}
                {especialidadesFiltradasModal.length > 0 ? (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {especialidadesFiltradasModal.slice(0, 12).map((esp) => {
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
                              const novas = atuais.filter((s) => s.toLowerCase() !== esp.nome.toLowerCase());
                              setForm({
                                ...form,
                                especialidades: novas.join(", "),
                                especialidade: form.especialidade.toLowerCase() === esp.nome.toLowerCase() ? (novas[0] || "") : form.especialidade,
                              });
                            } else {
                              setForm({
                                ...form,
                                especialidade: form.especialidade || esp.nome,
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
                ) : form.cbo_codigo.replace(/\D/g, "").length >= 4 ? (
                  <p className="mt-1 text-[11px] text-ink/55">
                    Nenhuma especialidade correspondente encontrada para o CBO {form.cbo_codigo}.
                  </p>
                ) : null}
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
