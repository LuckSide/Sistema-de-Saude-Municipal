import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Building2,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
  Phone,
  Mail,
  MapPin,
  FlaskConical,
  Clock,
  Key,
  ShieldCheck,
  CheckCircle2,
  RotateCcw,
} from "lucide-react";
import {
  type Prestador,
  createPrestador,
  deletePrestador,
  fetchPrestadores,
  updatePrestador,
  type Laboratorio,
  labsListar,
  labsCriar,
  labsAtualizar,
  labsRemover,
} from "../services/api";
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
  const [sp, setSp] = useSearchParams();
  const [abaAtiva, setAbaAtiva] = useState<"prestadores" | "laboratorios">(
    sp.get("aba") === "laboratorios" ? "laboratorios" : "prestadores"
  );

  // --- Estados de Prestadores Gerais ---
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

  // --- Estados de Laboratórios Conveniados ---
  const [labsLista, setLabsLista] = useState<Laboratorio[]>([]);
  const [labNome, setLabNome] = useState("");
  const [labResponsavelTecnico, setLabResponsavelTecnico] = useState("");
  const [labHorarioFuncionamento, setLabHorarioFuncionamento] = useState("07:00 às 17:00");
  const [labCriarUsuarioAcesso, setLabCriarUsuarioAcesso] = useState(true);
  const [labCredenciaisCriadas, setLabCredenciaisCriadas] = useState<{ usuario: string; senha: string } | null>(null);
  const [labBusy, setLabBusy] = useState(false);
  const [labErro, setLabErro] = useState("");
  const [labOk, setLabOk] = useState("");
  const [labBusca, setLabBusca] = useState("");

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

  const labsFiltrados = useMemo(() => {
    const termo = labBusca.trim().toLowerCase();
    if (!termo) return labsLista;
    return labsLista.filter((l) =>
      `${l.nome} ${l.responsavel_tecnico || ""} ${l.horario_funcionamento || ""}`.toLowerCase().includes(termo)
    );
  }, [labsLista, labBusca]);

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

  async function carregarLabs() {
    try {
      setLabsLista(await labsListar(false));
    } catch {
      setLabErro("Falha ao carregar laboratórios conveniados.");
    }
  }

  useEffect(() => {
    carregar();
    carregarLabs();
  }, []);

  useEffect(() => {
    const paramAba = sp.get("aba");
    if (paramAba === "laboratorios" || paramAba === "prestadores") {
      setAbaAtiva(paramAba);
    }
  }, [sp]);

  async function adicionarLab() {
    if (labNome.trim().length < 2) {
      setLabErro("Nome do laboratório inválido (mínimo 2 caracteres).");
      return;
    }
    setLabBusy(true);
    setLabErro("");
    setLabOk("");
    setLabCredenciaisCriadas(null);
    try {
      const res = await labsCriar({
        nome: labNome.trim(),
        ativo: true,
        responsavel_tecnico: labResponsavelTecnico.trim(),
        horario_funcionamento: labHorarioFuncionamento.trim(),
        criar_usuario_acesso: labCriarUsuarioAcesso,
      });
      setLabNome("");
      setLabResponsavelTecnico("");
      setLabOk("Laboratório conveniado adicionado com sucesso.");
      if (res.usuario_criado && res.senha_temporaria) {
        setLabCredenciaisCriadas({ usuario: res.usuario_criado, senha: res.senha_temporaria });
      }
      await carregarLabs();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? "Falha.";
      setLabErro(typeof d === "string" ? d : "Falha ao criar laboratório.");
    } finally {
      setLabBusy(false);
    }
  }

  async function reativarLab(id: number, nomeAtual: string) {
    setLabBusy(true);
    setLabErro("");
    setLabOk("");
    try {
      await labsAtualizar(id, { nome: nomeAtual, ativo: true });
      setLabOk(`Laboratório ${nomeAtual} reativado com sucesso.`);
      await carregarLabs();
    } catch {
      setLabErro("Falha ao reativar laboratório.");
    } finally {
      setLabBusy(false);
    }
  }

  async function removerLab(id: number) {
    const alvo = labsLista.find((x) => x.id === id);
    const okConf = await confirmar({
      titulo: `Desativar laboratório ${alvo?.nome ?? ""}`,
      descricao: "Deseja realmente desativar este laboratório? As vagas e agendamentos atuais serão preservados no histórico.",
      textoConfirmar: "Sim, Desativar",
      variante: "danger",
    });
    if (!okConf) return;
    setLabBusy(true);
    setLabErro("");
    setLabOk("");
    try {
      await labsRemover(id);
      await carregarLabs();
      notificarUndo({
        titulo: `Laboratório ${alvo?.nome ?? ""} inativado.`,
        descricao: "Desfazer reativa o laboratório nos seletores.",
        onUndo: async () => {
          await labsAtualizar(id, { nome: alvo?.nome ?? "", ativo: true });
          await carregarLabs();
        },
      });
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? "Falha.";
      setLabErro(typeof d === "string" ? d : "Falha ao desativar laboratório.");
    } finally {
      setLabBusy(false);
    }
  }

  async function excluirLabPermanente(id: number) {
    const alvo = labsLista.find((x) => x.id === id);
    const okConf = await confirmar({
      titulo: `Excluir PERMANENTEMENTE ${alvo?.nome ?? ""}`,
      descricao: `ATENÇÃO: Deseja apagar definitivamente o laboratório "${alvo?.nome ?? ""}" do banco de dados? Esta ação é irreversível e só será permitida se não houver exames ou faturas vinculadas.`,
      textoConfirmar: "Sim, Excluir Definitivamente",
      variante: "danger",
    });
    if (!okConf) return;
    setLabBusy(true);
    setLabErro("");
    setLabOk("");
    try {
      await labsRemover(id, true);
      await carregarLabs();
      setLabOk(`Laboratório "${alvo?.nome ?? ""}" excluído permanentemente do banco de dados.`);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? "Falha ao excluir permanentemente.";
      setLabErro(typeof d === "string" ? d : "Falha ao excluir permanentemente o laboratório.");
    } finally {
      setLabBusy(false);
    }
  }

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

  async function excluirPrestadorPermanente(p: Prestador) {
    const okConf = await confirmar({
      titulo: `Excluir PERMANENTEMENTE prestador ${p.razao_social}`,
      descricao: `ATENÇÃO: Deseja apagar definitivamente o prestador "${p.razao_social}" do banco de dados? Esta operação não pode ser desfeita.`,
      textoConfirmar: "Sim, Excluir Definitivamente",
      variante: "danger",
    });
    if (!okConf) return;
    try {
      await deletePrestador(p.id, true);
      await carregar();
      setOk(`Prestador "${p.razao_social}" excluído permanentemente.`);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? "Falha ao excluir permanentemente prestador.";
      setErro(typeof d === "string" ? d : "Falha ao excluir permanentemente prestador.");
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
            <Building2 className="h-6 w-6 text-teal" /> Prestadores e Laboratórios
          </h1>
          <p className="text-xs text-ink/60 mt-1">
            Gestão unificada de entidades credenciadas, Santa Casa, hospitais, clínicas e laboratórios conveniados de exames.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {abaAtiva === "prestadores" ? (
            <>
              <ExportarExcel url="/api/prestadores/exportar" arquivo="prestadores" rotulo="Exportar Prestadores" />
              <Button onClick={() => abrir()} className="bg-teal text-white hover:bg-teal/90 gap-1.5 shadow-sm">
                <Plus className="h-4 w-4" /> Novo Prestador
              </Button>
            </>
          ) : (
            <Button
              onClick={() => {
                const el = document.getElementById("novo-lab-form");
                el?.scrollIntoView({ behavior: "smooth" });
              }}
              className="bg-teal text-white hover:bg-teal/90 gap-1.5 shadow-sm"
            >
              <Plus className="h-4 w-4" /> Cadastrar Laboratório
            </Button>
          )}
        </div>
      </div>

      {/* Navegação por Abas Unificadas */}
      <div className="flex border-b border-sus-900/10 gap-2">
        <button
          type="button"
          onClick={() => {
            setAbaAtiva("prestadores");
            setSp((prev) => {
              prev.set("aba", "prestadores");
              return prev;
            });
          }}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-bold transition-colors ${
            abaAtiva === "prestadores"
              ? "border-teal text-teal"
              : "border-transparent text-ink/60 hover:text-sus-950"
          }`}
        >
          <Building2 className="h-4 w-4" />
          Prestadores e Entidades ({lista.length})
        </button>
        <button
          type="button"
          onClick={() => {
            setAbaAtiva("laboratorios");
            setSp((prev) => {
              prev.set("aba", "laboratorios");
              return prev;
            });
          }}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-bold transition-colors ${
            abaAtiva === "laboratorios"
              ? "border-teal text-teal"
              : "border-transparent text-ink/60 hover:text-sus-950"
          }`}
        >
          <FlaskConical className="h-4 w-4" />
          Laboratórios Conveniados ({labsLista.length})
        </button>
      </div>

      {/* ABA 1: PRESTADORES GERAIS */}
      {abaAtiva === "prestadores" && (
        <div className="space-y-6">
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
                            onClick={() => (p.ativo ? excluir(p) : updatePrestador(p.id, { ativo: true }).then(() => carregar()))}
                            className="h-8 px-2 text-amber-700 hover:bg-amber-50 text-xs font-semibold"
                            title={p.ativo ? "Inativar Prestador" : "Reativar Prestador"}
                          >
                            <RotateCcw className="h-3.5 w-3.5 mr-1" /> {p.ativo ? "Inativar" : "Reativar"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => excluirPrestadorPermanente(p)}
                            className="h-8 px-2 text-red-600 hover:bg-red-50 text-xs font-semibold"
                            title="Excluir Permanentemente do Banco de Dados"
                          >
                            <Trash2 className="h-3.5 w-3.5 mr-1" /> Excluir
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
        </div>
      )}

      {/* ABA 2: LABORATÓRIOS CONVENIADOS */}
      {abaAtiva === "laboratorios" && (
        <div className="space-y-6">
          {labErro && <div className="rounded-xl bg-red-50 p-4 text-sm font-semibold text-red-700">{labErro}</div>}
          {labOk && <div className="rounded-xl bg-teal/10 p-4 text-sm font-semibold text-teal">{labOk}</div>}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Card className="p-4 border-sus-900/10">
              <p className="text-xs font-semibold text-ink/60 uppercase tracking-wider">Total de Laboratórios</p>
              <p className="text-2xl font-black text-sus-950 mt-1">{labsLista.length}</p>
            </Card>
            <Card className="p-4 border-sus-900/10">
              <p className="text-xs font-semibold text-ink/60 uppercase tracking-wider">Ativos / Conveniados</p>
              <p className="text-2xl font-black text-teal mt-1">{labsLista.filter((x) => x.ativo).length}</p>
            </Card>
            <Card className="p-4 border-sus-900/10">
              <p className="text-xs font-semibold text-ink/60 uppercase tracking-wider">Inativos / Pausados</p>
              <p className="text-2xl font-black text-amber-700 mt-1">{labsLista.filter((x) => !x.ativo).length}</p>
            </Card>
          </div>

          {/* Card de Cadastro de Novo Laboratório */}
          <Card id="novo-lab-form" className="p-6 border border-sus-900/10 shadow-sm space-y-4">
            <div>
              <p className="flex items-center gap-2 font-display text-base font-bold text-sus-950">
                <FlaskConical className="h-5 w-5 text-teal" /> Cadastrar Laboratório Conveniado
              </p>
              <p className="text-xs text-ink/55 mt-1">
                Cadastre laboratórios prestadores com responsável técnico, horário de funcionamento e geração automática de acesso restrito à recepção.
              </p>
            </div>

            <div className="p-4 bg-sand/30 border border-sus-900/10 rounded-xl space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <Label className="text-[11px] font-bold">Nome do Laboratório *</Label>
                  <Input
                    value={labNome}
                    onChange={(e) => setLabNome(e.target.value)}
                    placeholder="Ex: Laboratório São Lucas"
                    className="text-xs mt-1"
                  />
                </div>
                <div>
                  <Label className="text-[11px] font-bold">Responsável Técnico</Label>
                  <Input
                    value={labResponsavelTecnico}
                    onChange={(e) => setLabResponsavelTecnico(e.target.value)}
                    placeholder="Ex: Dr. Roberto / Dra. Ana"
                    className="text-xs mt-1"
                  />
                </div>
                <div>
                  <Label className="text-[11px] font-bold">Horário de Funcionamento</Label>
                  <Input
                    value={labHorarioFuncionamento}
                    onChange={(e) => setLabHorarioFuncionamento(e.target.value)}
                    placeholder="Ex: 07:00 às 17:00"
                    className="text-xs mt-1"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-sus-900/10">
                <label className="flex items-center gap-2 text-xs font-medium text-sus-950 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={labCriarUsuarioAcesso}
                    onChange={(e) => setLabCriarUsuarioAcesso(e.target.checked)}
                    className="rounded border-sus-900/20 text-teal"
                  />
                  <span>Gerar credenciais de acesso restrito automaticamente para a recepção do laboratório</span>
                </label>

                <Button
                  disabled={labBusy}
                  onClick={adicionarLab}
                  className="bg-teal text-white font-bold text-xs !h-9 shadow-xs"
                >
                  {labBusy ? "Salvando…" : "Adicionar Laboratório"}
                </Button>
              </div>
            </div>

            {labCredenciaisCriadas && (
              <div className="rounded-xl border border-teal/20 bg-teal/10 p-4 text-xs space-y-1">
                <p className="font-bold text-teal flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4" /> Conta de Acesso Criada com Sucesso para o Laboratório:
                </p>
                <p className="text-sus-950 font-mono text-sm mt-1">
                  Usuário: <strong>{labCredenciaisCriadas.usuario}</strong> | Senha Provisória:{" "}
                  <strong>{labCredenciaisCriadas.senha}</strong>
                </p>
                <p className="text-[11px] text-ink/60">
                  O laboratório terá acesso restrito exclusivamente à conferência de seus pedidos e recepção de coletas.
                </p>
              </div>
            )}
          </Card>

          {/* Tabela de Laboratórios */}
          <Card className="overflow-hidden border border-sus-900/10 shadow-sm">
            <div className="p-4 border-b border-sus-900/10 flex flex-col md:flex-row items-center justify-between gap-3 bg-sand/30">
              <div className="relative w-full md:w-80">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-ink/40" />
                <Input
                  value={labBusca}
                  onChange={(e) => setLabBusca(e.target.value)}
                  placeholder="Buscar por nome, responsável ou horário..."
                  className="pl-9 text-xs"
                />
              </div>
              <span className="text-xs text-ink/60 font-medium">
                Mostrando {labsFiltrados.length} laboratório(s)
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-sand/60 text-sus-900/70 border-b border-sus-900/10 font-bold uppercase">
                    <th className="px-4 py-3">ID</th>
                    <th className="px-4 py-3">Laboratório Conveniado</th>
                    <th className="px-4 py-3">Responsável Técnico</th>
                    <th className="px-4 py-3">Horário de Funcionamento</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sus-900/10 bg-white">
                  {labsFiltrados.map((l) => (
                    <tr key={l.id} className="hover:bg-sand/20 transition-colors">
                      <td className="px-4 py-3 font-mono text-ink/60">#{l.id}</td>
                      <td className="px-4 py-3 font-bold text-sus-950">
                        <div className="flex items-center gap-2">
                          <FlaskConical className="h-4 w-4 text-teal shrink-0" />
                          <span>{l.nome}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-ink/75 font-medium">{l.responsavel_tecnico || "—"}</td>
                      <td className="px-4 py-3 text-ink/75">
                        <div className="flex items-center gap-1.5">
                          <Clock className="h-3 w-3 text-ink/40" />
                          <span>{l.horario_funcionamento || "—"}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${
                            l.ativo ? "bg-teal/15 text-teal" : "bg-red-100 text-red-700"
                          }`}
                        >
                          {l.ativo ? "Ativo" : "Inativo"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {l.ativo ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removerLab(l.id)}
                              className="h-8 px-2 text-amber-700 hover:bg-amber-50 text-xs font-semibold"
                              title="Desativar Laboratório"
                            >
                              <RotateCcw className="h-3.5 w-3.5 mr-1" /> Desativar
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => reativarLab(l.id, l.nome)}
                              className="h-8 px-2 text-teal hover:bg-teal/10 text-xs font-semibold"
                              title="Reativar Laboratório"
                            >
                              <RotateCcw className="h-3.5 w-3.5 mr-1" /> Reativar
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => excluirLabPermanente(l.id)}
                            className="h-8 px-2 text-red-600 hover:bg-red-50 text-xs font-semibold"
                            title="Excluir Permanentemente do Banco de Dados"
                          >
                            <Trash2 className="h-3.5 w-3.5 mr-1" /> Excluir
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {labsFiltrados.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-ink/50">
                        Nenhum laboratório conveniado cadastrado ou encontrado com a busca.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

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
