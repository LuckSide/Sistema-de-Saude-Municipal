import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Building2, Pencil, Plus, Search, Trash2, X, Phone, Mail, MapPin } from "lucide-react";
import { type Prestador, createPrestador, deletePrestador, fetchPrestadores, updatePrestador } from "../services/api";
import { Button, Card, Input, Label } from "../components/ui/primitives";
import { useUndo } from "../components/UndoToast";
import { useConfirm } from "../components/ConfirmDialog";
import { erros422, toastCampos, validaCnes, validaTelefone } from "../utils/validacoes";
import ExportarExcel from "../components/ExportarExcel";

const vazio: Omit<Prestador, "id"> = {
  razao_social: "",
  nome_fantasia: "",
  cnpj: "",
  cnes: "",
  tipo_entidade: "hospital",
  responsavel_nome: "",
  responsavel_telefone: "",
  email: "",
  telefone: "",
  endereco: "",
  municipio: "Guapé",
  ativo: true,
  observacoes: "",
};

export default function Prestadores() {
  const { notificarUndo } = useUndo();
  const { confirmar } = useConfirm();
  const [lista, setLista] = useState<Prestador[]>([]);
  const [sp] = useSearchParams();
  const [form, setForm] = useState<Omit<Prestador, "id">>(vazio);
  const [editId, setEditId] = useState<number | null>(null);
  const [modal, setModal] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [erroModal, setErroModal] = useState("");
  const [erros, setErros] = useState<Record<string, string>>({});
  const [ok, setOk] = useState("");

  const [buscaTabela, setBuscaTabela] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<"todos" | "ativos" | "inativos">("todos");
  const [filtroTipo, setFiltroTipo] = useState<string>("todos");

  const prestadoresFiltrados = useMemo(() => {
    let res = lista;
    if (filtroStatus === "ativos") res = res.filter((p) => p.ativo);
    if (filtroStatus === "inativos") res = res.filter((p) => !p.ativo);
    if (filtroTipo !== "todos") res = res.filter((p) => (p.tipo_entidade || "").toLowerCase() === filtroTipo.toLowerCase());

    const termo = buscaTabela.trim().toLowerCase();
    if (!termo) return res;
    return res.filter((p) => {
      const texto = `${p.razao_social} ${p.nome_fantasia || ""} ${p.cnpj || ""} ${p.cnes || ""} ${p.responsavel_nome || ""} ${p.municipio || ""} ${p.tipo_entidade || ""}`.toLowerCase();
      return texto.includes(termo);
    });
  }, [lista, buscaTabela, filtroStatus, filtroTipo]);

  const ROTULOS: Record<string, string> = {
    razao_social: "Razão Social",
    cnpj: "CNPJ",
    cnes: "CNES",
    telefone: "Telefone",
  };

  const borda = (c: string) => (erros[c] ? "!border-red-500 focus:!border-red-500" : "");
  const msg = (c: string) =>
    erros[c] ? <p className="mt-1 text-xs font-medium text-red-600">{erros[c]}</p> : null;

  async function carregar() {
    try {
      setLista(await fetchPrestadores());
    } catch {
      setErro("Falha ao carregar prestadores.");
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  useEffect(() => {
    const rid = Number(sp.get("registro"));
    if (!rid || modal) return;
    const m = lista.find((x) => x.id === rid);
    if (m) abrir(m);
  }, [sp, lista, modal]);

  function abrir(p?: Prestador) {
    setErroModal("");
    setErros({});
    setOk("");
    if (p) {
      setEditId(p.id);
      setForm({
        razao_social: p.razao_social,
        nome_fantasia: p.nome_fantasia ?? "",
        cnpj: p.cnpj ?? "",
        cnes: p.cnes ?? "",
        tipo_entidade: p.tipo_entidade ?? "hospital",
        responsavel_nome: p.responsavel_nome ?? "",
        responsavel_telefone: p.responsavel_telefone ?? "",
        email: p.email ?? "",
        telefone: p.telefone ?? "",
        endereco: p.endereco ?? "",
        municipio: p.municipio ?? "Guapé",
        ativo: p.ativo,
        observacoes: p.observacoes ?? "",
      });
    } else {
      setEditId(null);
      setForm(vazio);
    }
    setModal(true);
  }

  function fechar() {
    setModal(false);
    setEditId(null);
    setForm(vazio);
    setErroModal("");
    setErros({});
  }

  async function salvar() {
    setErroModal("");
    const e: Record<string, string> = {};
    if (form.razao_social.trim().length < 2) e.razao_social = "Razão Social é obrigatória (mínimo 2 caracteres).";
    if (form.cnes) {
      const cnes = validaCnes(form.cnes);
      if (cnes) e.cnes = cnes;
    }
    if (form.telefone) {
      const tel = validaTelefone(form.telefone);
      if (tel) e.telefone = tel;
    }
    if (Object.keys(e).length > 0) {
      setErros(e);
      setErroModal(toastCampos(e, ROTULOS));
      return;
    }
    setSalvando(true);
    try {
      if (editId) {
        await updatePrestador(editId, form);
        setOk("Prestador atualizado com sucesso.");
      } else {
        await createPrestador(form);
        setOk("Prestador cadastrado com sucesso.");
      }
      fechar();
      await carregar();
    } catch (err: unknown) {
      const deCampo = erros422(err, ROTULOS);
      if (Object.keys(deCampo).length > 0) {
        setErros(deCampo);
        setErroModal(toastCampos(deCampo, ROTULOS));
        return;
      }
      const detalhe = (err as { response?: { data?: { detail?: unknown } } }).response?.data?.detail;
      setErroModal(typeof detalhe === "string" ? detalhe : "Erro ao salvar prestador.");
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(p: Prestador) {
    const okConf = await confirmar({
      titulo: `Inativar prestador ${p.razao_social}`,
      descricao: `Deseja realmente inativar o prestador ${p.razao_social}? O histórico e contratos associados serão mantidos.`,
      textoConfirmar: "Sim, Inativar",
      variante: "danger",
    });
    if (!okConf) return;
    try {
      await deletePrestador(p.id);
      await carregar();
      notificarUndo({
        titulo: `Prestador ${p.razao_social} inativado.`,
        descricao: "Desfazer reativa o prestador.",
        onUndo: async () => {
          await updatePrestador(p.id, { ativo: true });
          await carregar();
        },
      });
    } catch {
      setErro("Falha ao inativar prestador.");
    }
  }

  const tipoBadge = (t: string) => {
    switch ((t || "").toLowerCase()) {
      case "hospital":
        return <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-800">Hospital / Santa Casa</span>;
      case "laboratorio":
        return <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[11px] font-semibold text-purple-800">Laboratório</span>;
      case "clinica":
        return <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-semibold text-teal-800">Clínica</span>;
      case "filantropico":
        return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Filantrópico</span>;
      default:
        return <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-semibold text-stone-800">{t || "Geral"}</span>;
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-sus-950 flex items-center gap-2">
            <Building2 className="h-6 w-6 text-teal" /> Prestadores de Serviços
          </h1>
          <p className="text-xs text-ink/60 mt-1">
            Gestão estruturada de entidades externas credenciadas, Santa Casa, hospitais, clínicas e laboratórios conveniados.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportarExcel rota="/api/prestadores/exportar" nomeArquivo="prestadores" rotulo="Exportar Prestadores" />
          <Button onClick={() => abrir()} className="bg-teal text-white hover:bg-teal/90 gap-1.5 shadow-sm">
            <Plus className="h-4 w-4" /> Novo Prestador
          </Button>
        </div>
      </div>

      {erro && <div className="rounded-xl bg-red-50 p-4 text-sm font-semibold text-red-700">{erro}</div>}
      {ok && <div className="rounded-xl bg-teal/10 p-4 text-sm font-semibold text-teal">{ok}</div>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-4 border-sus-900/10">
          <p className="text-xs font-semibold text-ink/60 uppercase tracking-wider">Total de Prestadores</p>
          <p className="text-2xl font-black text-sus-950 mt-1">{lista.length}</p>
        </Card>
        <Card className="p-4 border-sus-900/10">
          <p className="text-xs font-semibold text-ink/60 uppercase tracking-wider">Ativos / Conveniados</p>
          <p className="text-2xl font-black text-teal mt-1">{lista.filter((x) => x.ativo).length}</p>
        </Card>
        <Card className="p-4 border-sus-900/10">
          <p className="text-xs font-semibold text-ink/60 uppercase tracking-wider">Hospitais & Entidades</p>
          <p className="text-2xl font-black text-blue-700 mt-1">
            {lista.filter((x) => ["hospital", "filantropico"].includes((x.tipo_entidade || "").toLowerCase())).length}
          </p>
        </Card>
      </div>

      <Card className="overflow-hidden border border-sus-900/10 shadow-sm">
        <div className="p-4 border-b border-sus-900/10 flex flex-col md:flex-row items-center justify-between gap-3 bg-sand/30">
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-ink/40" />
            <Input
              value={buscaTabela}
              onChange={(e) => setBuscaTabela(e.target.value)}
              placeholder="Buscar por razão, CNPJ, CNES..."
              className="pl-9 text-xs"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
            <select
              value={filtroTipo}
              onChange={(e) => setFiltroTipo(e.target.value)}
              className="rounded-xl border border-sus-900/20 bg-white px-3 py-1.5 text-xs font-medium text-sus-950"
            >
              <option value="todos">Todos os Tipos</option>
              <option value="hospital">Hospitais / Santa Casa</option>
              <option value="laboratorio">Laboratórios</option>
              <option value="clinica">Clínicas</option>
              <option value="filantropico">Filantrópicos</option>
            </select>
            <div className="flex rounded-xl border border-sus-900/20 bg-white p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setFiltroStatus("todos")}
                className={`px-3 py-1 rounded-lg font-medium transition ${
                  filtroStatus === "todos" ? "bg-sus-900 text-white" : "text-ink/60 hover:text-sus-950"
                }`}
              >
                Todos
              </button>
              <button
                type="button"
                onClick={() => setFiltroStatus("ativos")}
                className={`px-3 py-1 rounded-lg font-medium transition ${
                  filtroStatus === "ativos" ? "bg-sus-900 text-white" : "text-ink/60 hover:text-sus-950"
                }`}
              >
                Ativos
              </button>
              <button
                type="button"
                onClick={() => setFiltroStatus("inativos")}
                className={`px-3 py-1 rounded-lg font-medium transition ${
                  filtroStatus === "inativos" ? "bg-sus-900 text-white" : "text-ink/60 hover:text-sus-950"
                }`}
              >
                Inativos
              </button>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-sand/60 text-sus-900/70 border-b border-sus-900/10 font-bold uppercase">
                <th className="px-4 py-3">Prestador / Razão Social</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">CNPJ / CNES</th>
                <th className="px-4 py-3">Responsável</th>
                <th className="px-4 py-3">Contato & Endereço</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sus-900/10 bg-white">
              {prestadoresFiltrados.map((p) => (
                <tr key={p.id} className="hover:bg-sand/20 transition-colors">
                  <td className="px-4 py-3 font-semibold text-sus-950">
                    <div>{p.razao_social}</div>
                    {p.nome_fantasia && <div className="text-[11px] font-normal text-ink/60">{p.nome_fantasia}</div>}
                  </td>
                  <td className="px-4 py-3">{tipoBadge(p.tipo_entidade)}</td>
                  <td className="px-4 py-3 font-mono text-[11px]">
                    {p.cnpj && <div>CNPJ: {p.cnpj}</div>}
                    {p.cnes && <div className="text-ink/60">CNES: {p.cnes}</div>}
                    {!p.cnpj && !p.cnes && <span className="text-ink/40">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    {p.responsavel_nome ? (
                      <div>
                        <div className="font-medium text-sus-950">{p.responsavel_nome}</div>
                        {p.responsavel_telefone && (
                          <div className="text-[11px] text-ink/60">{p.responsavel_telefone}</div>
                        )}
                      </div>
                    ) : (
                      <span className="text-ink/40">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink/70">
                    <div className="flex items-center gap-1">
                      {p.telefone && <span className="flex items-center gap-0.5"><Phone className="h-3 w-3" /> {p.telefone}</span>}
                      {p.email && <span className="flex items-center gap-0.5 ml-2"><Mail className="h-3 w-3" /> {p.email}</span>}
                    </div>
                    {p.endereco && (
                      <div className="flex items-center gap-1 text-[11px] text-ink/50 mt-0.5">
                        <MapPin className="h-3 w-3 shrink-0" /> {p.endereco} - {p.municipio}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        p.ativo ? "bg-teal/15 text-teal" : "bg-red-100 text-red-700"
                      }`}
                    >
                      {p.ativo ? "Ativo" : "Inativo"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => abrir(p)}
                        className="h-8 w-8 p-0 text-sus-900 hover:bg-sand"
                        title="Editar Prestador"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => excluir(p)}
                        className="h-8 w-8 p-0 text-red-600 hover:bg-red-50"
                        title="Inativar Prestador"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {prestadoresFiltrados.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-ink/50">
                    Nenhum prestador encontrado com os filtros atuais.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <Card className="w-full max-w-2xl overflow-hidden bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-sus-900/10 px-6 py-4 bg-sand/30">
              <h2 className="text-base font-bold text-sus-950 flex items-center gap-2">
                <Building2 className="h-5 w-5 text-teal" />
                {editId ? "Editar Prestador de Serviço" : "Cadastrar Prestador de Serviço"}
              </h2>
              <button onClick={fechar} className="rounded-lg p-1 text-ink/40 hover:bg-sand hover:text-sus-950">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
              {erroModal && <div className="rounded-xl bg-red-50 p-3 text-xs font-semibold text-red-700">{erroModal}</div>}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <Label className="text-xs font-bold text-sus-950">Razão Social / Nome Oficial *</Label>
                  <Input
                    value={form.razao_social}
                    onChange={(e) => setForm({ ...form, razao_social: e.target.value })}
                    placeholder="Ex: Santa Casa de Misericórdia de Guapé"
                    className={`mt-1 text-xs ${borda("razao_social")}`}
                  />
                  {msg("razao_social")}
                </div>

                <div>
                  <Label className="text-xs font-bold text-sus-950">Nome Fantasia</Label>
                  <Input
                    value={form.nome_fantasia}
                    onChange={(e) => setForm({ ...form, nome_fantasia: e.target.value })}
                    placeholder="Ex: Santa Casa"
                    className="mt-1 text-xs"
                  />
                </div>

                <div>
                  <Label className="text-xs font-bold text-sus-950">Tipo de Entidade</Label>
                  <select
                    value={form.tipo_entidade}
                    onChange={(e) => setForm({ ...form, tipo_entidade: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-sus-900/20 bg-white px-3 py-2 text-xs font-medium text-sus-950"
                  >
                    <option value="hospital">Hospital / Santa Casa</option>
                    <option value="laboratorio">Laboratório Externo</option>
                    <option value="clinica">Clínica Especializada</option>
                    <option value="filantropico">Entidade Filantrópica</option>
                    <option value="outro">Outro Prestador</option>
                  </select>
                </div>

                <div>
                  <Label className="text-xs font-bold text-sus-950">CNPJ</Label>
                  <Input
                    value={form.cnpj}
                    onChange={(e) => setForm({ ...form, cnpj: e.target.value })}
                    placeholder="00.000.000/0000-00"
                    className={`mt-1 text-xs ${borda("cnpj")}`}
                  />
                  {msg("cnpj")}
                </div>

                <div>
                  <Label className="text-xs font-bold text-sus-950">CNES</Label>
                  <Input
                    value={form.cnes}
                    onChange={(e) => setForm({ ...form, cnes: e.target.value })}
                    placeholder="Código CNES (7 dígitos)"
                    className={`mt-1 text-xs ${borda("cnes")}`}
                  />
                  {msg("cnes")}
                </div>

                <div>
                  <Label className="text-xs font-bold text-sus-950">Responsável Nome</Label>
                  <Input
                    value={form.responsavel_nome}
                    onChange={(e) => setForm({ ...form, responsavel_nome: e.target.value })}
                    placeholder="Ex: Dr. Roberto / Provedor"
                    className="mt-1 text-xs"
                  />
                </div>

                <div>
                  <Label className="text-xs font-bold text-sus-950">Telefone do Responsável</Label>
                  <Input
                    value={form.responsavel_telefone}
                    onChange={(e) => setForm({ ...form, responsavel_telefone: e.target.value })}
                    placeholder="(35) 99999-0000"
                    className="mt-1 text-xs"
                  />
                </div>

                <div>
                  <Label className="text-xs font-bold text-sus-950">Telefone Principal</Label>
                  <Input
                    value={form.telefone}
                    onChange={(e) => setForm({ ...form, telefone: e.target.value })}
                    placeholder="(35) 3561-0000"
                    className={`mt-1 text-xs ${borda("telefone")}`}
                  />
                  {msg("telefone")}
                </div>

                <div>
                  <Label className="text-xs font-bold text-sus-950">E-mail de Contato</Label>
                  <Input
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="contato@santacasa.org.br"
                    className="mt-1 text-xs"
                  />
                </div>

                <div className="sm:col-span-2">
                  <Label className="text-xs font-bold text-sus-950">Endereço Completo</Label>
                  <Input
                    value={form.endereco}
                    onChange={(e) => setForm({ ...form, endereco: e.target.value })}
                    placeholder="Rua, número, bairro"
                    className="mt-1 text-xs"
                  />
                </div>

                <div>
                  <Label className="text-xs font-bold text-sus-950">Município</Label>
                  <Input
                    value={form.municipio}
                    onChange={(e) => setForm({ ...form, municipio: e.target.value })}
                    placeholder="Guapé"
                    className="mt-1 text-xs"
                  />
                </div>

                <div className="flex items-center gap-2 pt-6">
                  <label className="flex items-center gap-2 text-xs font-bold text-sus-950 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.ativo}
                      onChange={(e) => setForm({ ...form, ativo: e.target.checked })}
                      className="rounded border-sus-900/20 text-teal"
                    />
                    Prestador Ativo / Habilitado
                  </label>
                </div>

                <div className="sm:col-span-2">
                  <Label className="text-xs font-bold text-sus-950">Observações Adicionais</Label>
                  <textarea
                    value={form.observacoes}
                    onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
                    rows={2}
                    placeholder="Informações sobre convênios, especialidades atendidas..."
                    className="mt-1 w-full rounded-xl border border-sus-900/20 bg-white p-2 text-xs font-medium text-sus-950"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-sus-900/10 bg-sand/30 px-6 py-4">
              <Button variant="outline" onClick={fechar} disabled={salvando} className="text-xs">
                Cancelar
              </Button>
              <Button onClick={salvar} disabled={salvando} className="bg-teal text-white hover:bg-teal/90 text-xs">
                {salvando ? "Salvando..." : editId ? "Salvar Alterações" : "Cadastrar Prestador"}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
