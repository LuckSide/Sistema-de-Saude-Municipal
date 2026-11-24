import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Activity,
  Check,
  Pencil,
  Plus,
  PlusCircle,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  type UnidadeSaude,
  type UnidadeServicoEspecializado,
  type EquipeSaude,
  type Medico,
  createUnidadeSaude,
  deleteUnidadeSaude,
  fetchUnidadesSaude,
  updateUnidadeSaude,
  fetchServicosUnidade,
  createServicoUnidade,
  deleteServicoUnidade,
  fetchEquipesUnidade,
  createEquipe,
  updateEquipe,
  deleteEquipe,
  addProfissionalEquipe,
  removeProfissionalEquipe,
  fetchMedicos,
} from "../services/api";
import { Button, Card, Input, Label } from "../components/ui/primitives";
import { useUndo } from "../components/UndoToast";
import { useConfirm } from "../components/ConfirmDialog";
import {
  erros422,
  formataCns,
  toastCampos,
  validaCnes,
  validaCns,
  validaTelefone,
} from "../utils/validacoes";
import ExportarExcel from "../components/ExportarExcel";

const TIPOS_ESTABELECIMENTO = [
  { codigo: "01", descricao: "01 - POSTO DE SAÚDE" },
  { codigo: "02", descricao: "02 - CENTRO DE SAÚDE / UNIDADE BÁSICA (UBS/PSF)" },
  { codigo: "04", descricao: "04 - POLICLÍNICA" },
  { codigo: "05", descricao: "05 - HOSPITAL GERAL" },
  { codigo: "07", descricao: "07 - HOSPITAL ESPECIALIZADO" },
  { codigo: "15", descricao: "15 - UNIDADE MISTA" },
  { codigo: "20", descricao: "20 - PRONTO SOCORRO GERAL" },
  { codigo: "21", descricao: "21 - PRONTO ATENDIMENTO" },
  { codigo: "22", descricao: "22 - CONSULTÓRIO ISOLADO" },
  { codigo: "36", descricao: "36 - CLÍNICA ESPECIALIZADA / AMBULATÓRIO" },
  { codigo: "39", descricao: "39 - UNIDADE DE APOIO DIAGNOSE E TERAPIA (SADT)" },
  { codigo: "40", descricao: "40 - UNIDADE MÓVEL TERRESTRE" },
  { codigo: "42", descricao: "42 - UNIDADE MÓVEL DE URGÊNCIA/EMERGÊNCIA (SAMU)" },
  { codigo: "43", descricao: "43 - FARMÁCIA" },
  { codigo: "71", descricao: "71 - CENTRO DE APOIO À SAÚDE DA FAMÍLIA (CASF)" },
  { codigo: "72", descricao: "72 - CENTRO DE ATENÇÃO PSICOSSOCIAL (CAPS)" },
];

const SERVICOS_CNES_EXEMPLOS = [
  { servico: "106", servico_desc: "Serviço de Apoio Diagnóstico", classif: "001", classif_desc: "Patologia Clínica (Laboratório)" },
  { servico: "106", servico_desc: "Serviço de Apoio Diagnóstico", classif: "002", classif_desc: "Radiologia Geral" },
  { servico: "106", servico_desc: "Serviço de Apoio Diagnóstico", classif: "003", classif_desc: "Ultrassonografia" },
  { servico: "106", servico_desc: "Serviço de Apoio Diagnóstico", classif: "004", classif_desc: "Eletrocardiografia" },
  { servico: "112", servico_desc: "Atenção ao Pré-Natal e Parto", classif: "001", classif_desc: "Pré-Natal de Risco Habitual" },
  { servico: "112", servico_desc: "Atenção ao Pré-Natal e Parto", classif: "002", classif_desc: "Pré-Natal de Alto Risco" },
  { servico: "114", servico_desc: "Atenção à Saúde Bucal", classif: "001", classif_desc: "Atenção Básica à Saúde Bucal" },
  { servico: "115", servico_desc: "Atenção à Saúde da Mulher", classif: "001", classif_desc: "Rastreamento do Câncer Colo de Útero/Mama" },
  { servico: "120", servico_desc: "Atenção Farmacêutica", classif: "001", classif_desc: "Dispensação de Medicamentos Básicos" },
  { servico: "121", servico_desc: "Vigilância em Saúde", classif: "001", classif_desc: "Imunização / Sala de Vacinas" },
  { servico: "135", servico_desc: "Serviço de Reabilitação", classif: "001", classif_desc: "Fisioterapia" },
  { servico: "159", servico_desc: "Atenção Psicossocial", classif: "001", classif_desc: "Atendimento em Saúde Mental" },
];

const TIPOS_EQUIPE = [
  "70 - Equipe de Saúde da Família (eSF)",
  "71 - Equipe de Atenção Primária (eAP)",
  "72 - Equipe de Saúde Bucal (eSB)",
  "73 - Equipe de Consultório na Rua (eCR)",
  "76 - Equipe Multiprofissional (eMulti)",
  "74 - Equipe de Saúde Prisional (eESP)",
];

const FUNCOES_EQUIPE = [
  "MÉDICO",
  "ENFERMEIRO",
  "TÉCNICO DE ENFERMAGEM",
  "CIRURGIÃO DENTISTA",
  "AUXILIAR DE SAÚDE BUCAL",
  "AGENTE COMUNITÁRIO DE SAÚDE (ACS)",
  "FARMACÊUTICO",
  "FISIOTERAPEUTA",
  "PSICÓLOGO",
  "NUTRICIONISTA",
  "ASSISTENTE SOCIAL",
  "FONOAUDIÓLOGO",
];

const vazio = {
  nome: "",
  cnes: "",
  tipo_estabelecimento: "02",
  codigo_ibge: "312810",
  cnpj: "18239616000185",
  responsavel_tecnico_nome: "",
  responsavel_tecnico_cns: "",
  responsavel_tecnico_conselho: "",
  endereco: "",
  numero: "",
  bairro: "",
  municipio: "Guapé",
  cep: "37177-000",
  telefone: "",
  ativo: true,
};

export default function UnidadesSaude() {
  const { notificarUndo } = useUndo();
  const { confirmar } = useConfirm();
  const [lista, setLista] = useState<UnidadeSaude[]>([]);
  const [profissionais, setProfissionais] = useState<Medico[]>([]);
  const [sp] = useSearchParams();

  // Estados do Modal Principal
  const [form, setForm] = useState<typeof vazio>(vazio);
  const [editId, setEditId] = useState<number | null>(null);
  const [modal, setModal] = useState(false);
  const [abaAtiva, setAbaAtiva] = useState<"geral" | "servicos" | "equipes">("geral");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [erroModal, setErroModal] = useState("");
  const [erros, setErros] = useState<Record<string, string>>({});
  const [ok, setOk] = useState("");

  // Submódulos: Serviços Especializados e Equipes da Unidade aberta
  const [servicos, setServicos] = useState<UnidadeServicoEspecializado[]>([]);
  const [carregandoServicos, setCarregandoServicos] = useState(false);
  const [equipes, setEquipes] = useState<EquipeSaude[]>([]);
  const [carregandoEquipes, setCarregandoEquipes] = useState(false);

  // Form para adicionar Serviço Especializado
  const [novoServico, setNovoServico] = useState({
    servico_codigo: "",
    servico_descricao: "",
    classificacao_codigo: "",
    classificacao_descricao: "",
    caracteristica: "PROPRIO",
    cnes_terceiro: "",
  });

  // Form para criar Nova Equipe INE
  const [novaEquipe, setNovaEquipe] = useState({
    ine: "",
    nome_equipe: "",
    tipo_equipe: "70 - Equipe de Saúde da Família (eSF)",
    area: "",
  });
  const [modalNovaEquipe, setModalNovaEquipe] = useState(false);

  // Form para Vincular Profissional à Equipe
  const [equipeVinculoId, setEquipeVinculoId] = useState<number | null>(null);
  const [novoProfissionalVinculo, setNovoProfissionalVinculo] = useState({
    medico_id: 0,
    funcao: "MÉDICO",
    chs: 40,
  });

  // Filtros de busca instantânea na listagem de Unidades/PSFs
  const [buscaTabela, setBuscaTabela] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<"todos" | "ativos" | "inativos">("todos");

  const unidadesFiltradas = useMemo(() => {
    let res = lista;
    if (filtroStatus === "ativos") res = res.filter((u) => u.ativo);
    if (filtroStatus === "inativos") res = res.filter((u) => !u.ativo);
    const termo = buscaTabela.trim().toLowerCase();
    if (!termo) return res;
    return res.filter((u) => {
      const texto = `${u.nome} ${u.cnes || ""} ${u.tipo_estabelecimento || ""} ${u.responsavel_tecnico_nome || ""} ${u.cnpj || ""} ${u.endereco || ""} ${u.bairro || ""} ${u.municipio || ""} ${u.telefone || ""}`.toLowerCase();
      return texto.includes(termo);
    });
  }, [lista, buscaTabela, filtroStatus]);

  const ROTULOS: Record<string, string> = {
    nome: "Nome da unidade",
    cnes: "CNES",
    telefone: "Telefone",
    responsavel_tecnico_cns: "CNS do Responsável Técnico",
  };
  const borda = (c: string) => (erros[c] ? "!border-red-500 focus:!border-red-500" : "");
  const msg = (c: string) =>
    erros[c] ? <p className="mt-1 text-xs font-medium text-red-600">{erros[c]}</p> : null;

  async function carregar() {
    try {
      const [unis, meds] = await Promise.all([
        fetchUnidadesSaude(),
        fetchMedicos({ somente_ativos: true }).catch(() => []),
      ]);
      setLista(unis);
      setProfissionais(meds);
    } catch {
      setErro("Falha ao carregar unidades de saúde.");
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

  async function carregarServicosEEquipes(uid: number) {
    setCarregandoServicos(true);
    setCarregandoEquipes(true);
    try {
      const [srvs, eqs] = await Promise.all([
        fetchServicosUnidade(uid).catch(() => []),
        fetchEquipesUnidade(uid).catch(() => []),
      ]);
      setServicos(srvs);
      setEquipes(eqs);
    } finally {
      setCarregandoServicos(false);
      setCarregandoEquipes(false);
    }
  }

  function abrir(u?: UnidadeSaude, abaInicial: "geral" | "servicos" | "equipes" = "geral") {
    setErroModal("");
    setErros({});
    setOk("");
    setAbaAtiva(abaInicial);
    if (u) {
      setEditId(u.id);
      setForm({
        nome: u.nome,
        cnes: u.cnes,
        tipo_estabelecimento: u.tipo_estabelecimento ?? "02",
        codigo_ibge: u.codigo_ibge ?? "312810",
        cnpj: u.cnpj ?? "18239616000185",
        responsavel_tecnico_nome: u.responsavel_tecnico_nome ?? "",
        responsavel_tecnico_cns: u.responsavel_tecnico_cns ?? "",
        responsavel_tecnico_conselho: u.responsavel_tecnico_conselho ?? "",
        endereco: u.endereco,
        numero: u.numero ?? "",
        bairro: u.bairro,
        municipio: u.municipio ?? "Guapé",
        cep: u.cep ?? "37177-000",
        telefone: u.telefone,
        ativo: u.ativo,
      });
      carregarServicosEEquipes(u.id);
    } else {
      setEditId(null);
      setForm(vazio);
      setServicos([]);
      setEquipes([]);
    }
    setModal(true);
  }

  function fechar() {
    setModal(false);
    setEditId(null);
    setForm(vazio);
    setErroModal("");
    setErros({});
    setModalNovaEquipe(false);
    setEquipeVinculoId(null);
  }

  async function salvar() {
    setErroModal("");
    const e: Record<string, string> = {};
    if (form.nome.trim().length < 2) e.nome = "Nome é obrigatório.";
    const cnes = validaCnes(form.cnes);
    if (cnes) e.cnes = cnes;
    if (form.responsavel_tecnico_cns) {
      const cnsErr = validaCns(form.responsavel_tecnico_cns);
      if (cnsErr) e.responsavel_tecnico_cns = cnsErr;
    }
    const tel = validaTelefone(form.telefone);
    if (tel) e.telefone = tel;
    if (Object.keys(e).length > 0) {
      setErros(e);
      setErroModal(toastCampos(e, ROTULOS));
      return;
    }
    setSalvando(true);
    try {
      if (editId) {
        await updateUnidadeSaude(editId, form);
        setOk("Unidade de saúde atualizada.");
      } else {
        const criada = await createUnidadeSaude(form);
        setEditId(criada.id);
        setOk("Unidade cadastrada com sucesso! Agora você pode cadastrar Serviços e Equipes.");
      }
      await carregar();
    } catch (err: unknown) {
      const deCampo = erros422(err, ROTULOS);
      if (Object.keys(deCampo).length > 0) {
        setErros(deCampo);
        setErroModal(toastCampos(deCampo, ROTULOS));
        return;
      }
      const detalhe = (err as { response?: { data?: { detail?: unknown } } }).response?.data?.detail;
      setErroModal(typeof detalhe === "string" ? detalhe : "Erro ao salvar.");
    } finally {
      setSalvando(false);
    }
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
            ...snap,
            ativo: true,
          });
          await carregar();
        },
      });
    } catch {
      setErro("Falha ao inativar unidade.");
    }
  }

  // --- Handlers de Serviços Especializados ---
  async function adicionarServico() {
    if (!editId) return;
    if (!novoServico.servico_codigo || !novoServico.classificacao_codigo) {
      setErroModal("Informe ao menos o Código do Serviço e o Código da Classificação.");
      return;
    }
    try {
      await createServicoUnidade(editId, {
        ...novoServico,
        unidade_saude_id: editId,
      });
      setNovoServico({
        servico_codigo: "",
        servico_descricao: "",
        classificacao_codigo: "",
        classificacao_descricao: "",
        caracteristica: "PROPRIO",
        cnes_terceiro: "",
      });
      await carregarServicosEEquipes(editId);
    } catch (err: unknown) {
      const det = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      setErroModal(det || "Erro ao adicionar serviço especializado.");
    }
  }

  async function removerServico(sid: number) {
    if (!editId) return;
    try {
      await deleteServicoUnidade(editId, sid);
      await carregarServicosEEquipes(editId);
    } catch {
      setErroModal("Falha ao remover serviço.");
    }
  }

  // --- Handlers de Equipes INE ---
  async function salvarNovaEquipe() {
    if (!editId) return;
    const ineLimpo = novaEquipe.ine.replace(/\D/g, "");
    if (ineLimpo.length !== 10) {
      setErroModal("O Código INE da Atenção Básica deve ter exatamente 10 dígitos numéricos.");
      return;
    }
    if (novaEquipe.nome_equipe.trim().length < 2) {
      setErroModal("Informe o nome da equipe (ex: ESF 01 Centro).");
      return;
    }
    try {
      await createEquipe({
        ...novaEquipe,
        ine: ineLimpo,
        unidade_saude_id: editId,
      });
      setNovaEquipe({
        ine: "",
        nome_equipe: "",
        tipo_equipe: "70 - Equipe de Saúde da Família (eSF)",
        area: "",
      });
      setModalNovaEquipe(false);
      await carregarServicosEEquipes(editId);
    } catch (err: unknown) {
      const det = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      setErroModal(det || "Erro ao criar equipe de saúde.");
    }
  }

  async function inativarEquipe(eid: number) {
    if (!editId) return;
    try {
      await deleteEquipe(eid);
      await carregarServicosEEquipes(editId);
    } catch {
      setErroModal("Falha ao inativar equipe.");
    }
  }

  async function vincularProfissional() {
    if (!equipeVinculoId || !novoProfissionalVinculo.medico_id) {
      setErroModal("Selecione um profissional cadastrado.");
      return;
    }
    try {
      await addProfissionalEquipe(equipeVinculoId, novoProfissionalVinculo);
      setNovoProfissionalVinculo({
        medico_id: 0,
        funcao: "MÉDICO",
        chs: 40,
      });
      setEquipeVinculoId(null);
      if (editId) await carregarServicosEEquipes(editId);
    } catch (err: unknown) {
      const det = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      setErroModal(det || "Erro ao vincular profissional à equipe.");
    }
  }

  async function desvincularProfissional(equipeId: number, profissionalId: number) {
    try {
      await removeProfissionalEquipe(equipeId, profissionalId);
      if (editId) await carregarServicosEEquipes(editId);
    } catch {
      setErroModal("Falha ao remover profissional da equipe.");
    }
  }

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h1 className="font-display text-2xl font-extrabold text-sus-950">PSFs / Unidades de saúde (CNES)</h1>
        <ExportarExcel url="/api/unidades-saude/exportar" arquivo="unidades_saude" />
        <Button onClick={() => abrir()} className="ml-auto">
          <Plus className="h-4 w-4" /> Nova unidade
        </Button>
      </div>
      <p className="mb-4 mt-1 text-sm text-ink/55">
        Adequação estrutural oficial do CNES: Unidades, Serviços Especializados e Equipes de Saúde da Família (Código INE).
      </p>

      {erro && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{erro}</p>}
      {ok && <p className="mb-3 rounded-xl bg-teal/10 px-3 py-2 text-sm font-medium text-teal">{ok}</p>}

      {/* Barra de Filtro e Busca Instantânea */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sus-900/10 bg-white p-3.5 shadow-2xs">
        <div className="relative min-w-[260px] flex-1 sm:max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/40" />
          <Input
            value={buscaTabela}
            onChange={(e) => setBuscaTabela(e.target.value)}
            placeholder="Pesquisar por PSF, CNES, tipo, responsável técnico, endereço…"
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
            <thead>
              <tr className="border-b border-sus-900/10 bg-sand text-xs uppercase tracking-wide text-sus-900/60">
                <th className="px-4 py-3">Unidade / Tipo CNES</th>
                <th className="px-4 py-3">Código CNES & IBGE</th>
                <th className="px-4 py-3">Responsável Técnico</th>
                <th className="px-4 py-3">Endereço & Contato</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {unidadesFiltradas.map((u) => {
                const tipoDesc = TIPOS_ESTABELECIMENTO.find((t) => t.codigo === u.tipo_estabelecimento)?.descricao || u.tipo_estabelecimento;
                return (
                  <tr key={u.id} className="border-b border-sus-900/5 last:border-0 hover:bg-sand/30 transition">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-sus-950">{u.nome}</p>
                      <p className="text-[11px] text-ink/50 leading-tight mt-0.5">{tipoDesc}</p>
                      {u.cnpj && <p className="text-[10px] text-ink/40 font-mono">CNPJ: {u.cnpj}</p>}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <p className="font-mono font-bold text-sus-950">{u.cnes || "—"}</p>
                      <p className="text-[11px] text-ink/50">IBGE: {u.codigo_ibge || "312810"}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-ink/75">
                      {u.responsavel_tecnico_nome ? (
                        <>
                          <p className="font-medium text-sus-950">{u.responsavel_tecnico_nome}</p>
                          <p className="text-[11px] text-ink/50">
                            {u.responsavel_tecnico_conselho || ""}
                            {u.responsavel_tecnico_cns ? ` · CNS: ${formataCns(u.responsavel_tecnico_cns)}` : ""}
                          </p>
                        </>
                      ) : (
                        <span className="text-ink/40 italic">Não informado</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink/60">
                      <p>{u.endereco || "—"}{u.numero ? `, ${u.numero}` : ""}</p>
                      <p className="text-[11px] text-ink/45">{u.bairro || ""} {u.telefone ? `· Tel: ${u.telefone}` : ""}</p>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${u.ativo ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>
                        {u.ativo ? "ativo" : "inativo"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end items-center gap-1">
                        <button
                          onClick={() => abrir(u, "servicos")}
                          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-teal hover:bg-teal/10"
                          title="Serviços Especializados CNES"
                        >
                          <Activity className="h-3.5 w-3.5" /> Serviços
                        </button>
                        <button
                          onClick={() => abrir(u, "equipes")}
                          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-sus-800 hover:bg-sus-100"
                          title="Equipes INE Atenção Básica"
                        >
                          <Users className="h-3.5 w-3.5" /> Equipes
                        </button>
                        <button
                          onClick={() => abrir(u, "geral")}
                          className="rounded-lg p-1.5 text-sus-800 hover:bg-sus-100"
                          title="Editar"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => excluir(u)}
                          className="rounded-lg p-1.5 text-red-600 hover:bg-red-50"
                          title="Inativar"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
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

      {/* Modal Principal com Abas (Geral, Serviços Especializados, Equipes INE) */}
      {modal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4" onClick={fechar}>
          <div
            className="rise max-h-[92vh] w-full max-w-3xl flex flex-col overflow-hidden rounded-2xl bg-white shadow-card"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header do Modal */}
            <div className="border-b border-sus-900/10 px-6 py-4 flex items-center justify-between">
              <div>
                <p className="font-display text-lg font-bold text-sus-950">
                  {editId ? `Unidade: ${form.nome || "Editar"}` : "Nova Unidade de Saúde"}
                </p>
                <p className="text-xs text-ink/50">Adequação aos Padrões CNES do Ministério da Saúde</p>
              </div>
              <button onClick={fechar} className="rounded-lg p-2 text-ink/50 hover:bg-sand" aria-label="Fechar">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Navegação por Abas */}
            <div className="flex border-b border-sus-900/10 bg-sand/30 px-6">
              <button
                type="button"
                onClick={() => setAbaAtiva("geral")}
                className={`border-b-2 px-4 py-2.5 text-xs font-bold transition ${
                  abaAtiva === "geral"
                    ? "border-sus-900 text-sus-900 bg-white"
                    : "border-transparent text-ink/60 hover:text-sus-950"
                }`}
              >
                1. Dados Gerais & Responsável Técnico
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!editId) {
                    setErroModal("Salve os dados gerais da unidade antes de gerenciar serviços.");
                    return;
                  }
                  setAbaAtiva("servicos");
                }}
                className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-xs font-bold transition ${
                  abaAtiva === "servicos"
                    ? "border-sus-900 text-sus-900 bg-white"
                    : "border-transparent text-ink/60 hover:text-sus-950"
                } ${!editId ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <Activity className="h-3.5 w-3.5" />
                2. Serviços Especializados ({servicos.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!editId) {
                    setErroModal("Salve os dados gerais da unidade antes de gerenciar equipes.");
                    return;
                  }
                  setAbaAtiva("equipes");
                }}
                className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-xs font-bold transition ${
                  abaAtiva === "equipes"
                    ? "border-sus-900 text-sus-900 bg-white"
                    : "border-transparent text-ink/60 hover:text-sus-950"
                } ${!editId ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <Users className="h-3.5 w-3.5" />
                3. Equipes de Saúde - INE ({equipes.length})
              </button>
            </div>

            {/* Conteúdo das Abas */}
            <div className="flex-1 overflow-y-auto p-6">
              {erroModal && (
                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-700">
                  {erroModal}
                </div>
              )}

              {/* ABA 1: DADOS GERAIS */}
              {abaAtiva === "geral" && (
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="md:col-span-2">
                    <Label>Nome da unidade *</Label>
                    <Input
                      value={form.nome}
                      onChange={(e) => setForm({ ...form, nome: e.target.value })}
                      placeholder="Ex: PSF Dona Clara"
                      className={borda("nome")}
                    />
                    {msg("nome")}
                  </div>

                  <div>
                    <Label>Código CNES * (7 dígitos)</Label>
                    <Input
                      value={form.cnes}
                      onChange={(e) => setForm({ ...form, cnes: e.target.value.replace(/\D/g, "").slice(0, 7) })}
                      placeholder="7 dígitos"
                      inputMode="numeric"
                      className={borda("cnes")}
                    />
                    {msg("cnes")}
                  </div>

                  <div>
                    <Label>Tipo de Estabelecimento CNES</Label>
                    <select
                      value={form.tipo_estabelecimento}
                      onChange={(e) => setForm({ ...form, tipo_estabelecimento: e.target.value })}
                      className="w-full rounded-xl border border-sus-900/20 bg-white px-3 py-2 text-sm outline-none focus:border-teal"
                    >
                      {TIPOS_ESTABELECIMENTO.map((t) => (
                        <option key={t.codigo} value={t.codigo}>
                          {t.descricao}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <Label>Código IBGE do Município</Label>
                    <Input
                      value={form.codigo_ibge}
                      onChange={(e) => setForm({ ...form, codigo_ibge: e.target.value })}
                      placeholder="312810 (Guapé/MG)"
                    />
                  </div>

                  <div>
                    <Label>CNPJ do Estabelecimento / Mantenedora</Label>
                    <Input
                      value={form.cnpj}
                      onChange={(e) => setForm({ ...form, cnpj: e.target.value })}
                      placeholder="18239616000185"
                    />
                  </div>

                  {/* Dados do Responsável Técnico */}
                  <div className="md:col-span-2 rounded-xl border border-sus-900/10 bg-sand/20 p-3">
                    <Label className="!mb-2 font-bold text-sus-950">Responsável Técnico pela Unidade (RT)</Label>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-ink/70">Nome do RT</label>
                        <Input
                          value={form.responsavel_tecnico_nome}
                          onChange={(e) => setForm({ ...form, responsavel_tecnico_nome: e.target.value })}
                          placeholder="Dr. Nome do Responsável"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-ink/70">CNS do RT (15 dígitos)</label>
                        <Input
                          value={form.responsavel_tecnico_cns}
                          onChange={(e) => setForm({ ...form, responsavel_tecnico_cns: e.target.value.replace(/\D/g, "").slice(0, 15) })}
                          placeholder="15 dígitos"
                          inputMode="numeric"
                          className={borda("responsavel_tecnico_cns")}
                        />
                        {msg("responsavel_tecnico_cns")}
                        {form.responsavel_tecnico_cns && !erros.responsavel_tecnico_cns && validaCns(form.responsavel_tecnico_cns) === "" && (
                          <p className="mt-0.5 text-[10px] font-medium text-teal">✓ CNS válido</p>
                        )}
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-ink/70">Conselho / UF do RT</label>
                        <Input
                          value={form.responsavel_tecnico_conselho}
                          onChange={(e) => setForm({ ...form, responsavel_tecnico_conselho: e.target.value })}
                          placeholder="Ex: CRM/MG 12345"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Endereço e Contato */}
                  <div className="md:col-span-2">
                    <Label>Endereço (logradouro)</Label>
                    <Input
                      value={form.endereco}
                      onChange={(e) => setForm({ ...form, endereco: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Número</Label>
                    <Input value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} />
                  </div>
                  <div>
                    <Label>Bairro</Label>
                    <Input value={form.bairro} onChange={(e) => setForm({ ...form, bairro: e.target.value })} />
                  </div>
                  <div>
                    <Label>Município</Label>
                    <Input value={form.municipio} onChange={(e) => setForm({ ...form, municipio: e.target.value })} />
                  </div>
                  <div>
                    <Label>CEP</Label>
                    <Input value={form.cep} onChange={(e) => setForm({ ...form, cep: e.target.value })} placeholder="37177-000" />
                  </div>
                  <div>
                    <Label>Telefone</Label>
                    <Input
                      value={form.telefone}
                      onChange={(e) => setForm({ ...form, telefone: e.target.value })}
                      placeholder="DDD + número"
                      className={borda("telefone")}
                    />
                    {msg("telefone")}
                  </div>
                  <div className="flex items-center pt-6">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.ativo}
                        onChange={(e) => setForm({ ...form, ativo: e.target.checked })}
                        className="h-4 w-4 accent-teal"
                      />
                      <b>Unidade Ativa no Sistema</b>
                    </label>
                  </div>
                </div>
              )}

              {/* ABA 2: SERVIÇOS ESPECIALIZADOS (CNES) */}
              {abaAtiva === "servicos" && (
                <div className="space-y-4">
                  {/* Seletor rápido / atalhos de serviços comuns */}
                  <div className="rounded-xl border border-teal/30 bg-teal/5 p-3">
                    <p className="text-xs font-bold text-teal mb-1.5">Atalhos de Serviços Oficiais CNES:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {SERVICOS_CNES_EXEMPLOS.map((ex, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => {
                            setNovoServico({
                              servico_codigo: ex.servico,
                              servico_descricao: ex.servico_desc,
                              classificacao_codigo: ex.classif,
                              classificacao_descricao: ex.classif_desc,
                              caracteristica: "PROPRIO",
                              cnes_terceiro: "",
                            });
                          }}
                          className="rounded-lg border border-sus-900/10 bg-white px-2 py-1 text-[11px] font-medium text-ink/80 hover:bg-teal hover:text-white transition"
                        >
                          {ex.servico}.{ex.classif} - {ex.classif_desc}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Formulário de Adição de Serviço */}
                  <div className="rounded-xl border border-sus-900/15 bg-sand/30 p-3.5">
                    <p className="text-xs font-bold text-sus-950 mb-2">+ Adicionar Serviço / Classificação Especializada</p>
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <label className="block text-[11px] font-semibold text-ink/70 mb-0.5">Cód. Serviço</label>
                        <Input
                          value={novoServico.servico_codigo}
                          onChange={(e) => setNovoServico({ ...novoServico, servico_codigo: e.target.value })}
                          placeholder="Ex: 106"
                          className="!py-1 text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-ink/70 mb-0.5">Descrição do Serviço</label>
                        <Input
                          value={novoServico.servico_descricao}
                          onChange={(e) => setNovoServico({ ...novoServico, servico_descricao: e.target.value })}
                          placeholder="Ex: Serviço de Apoio Diagnóstico"
                          className="!py-1 text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-ink/70 mb-0.5">Cód. Classificação</label>
                        <Input
                          value={novoServico.classificacao_codigo}
                          onChange={(e) => setNovoServico({ ...novoServico, classificacao_codigo: e.target.value })}
                          placeholder="Ex: 001"
                          className="!py-1 text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-ink/70 mb-0.5">Descrição Classificação</label>
                        <Input
                          value={novoServico.classificacao_descricao}
                          onChange={(e) => setNovoServico({ ...novoServico, classificacao_descricao: e.target.value })}
                          placeholder="Ex: Patologia Clínica"
                          className="!py-1 text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-ink/70 mb-0.5">Característica</label>
                        <select
                          value={novoServico.caracteristica}
                          onChange={(e) => setNovoServico({ ...novoServico, caracteristica: e.target.value })}
                          className="w-full rounded-xl border border-sus-900/20 bg-white px-2 py-1.5 text-xs outline-none"
                        >
                          <option value="PROPRIO">PRÓPRIO</option>
                          <option value="TERCEIRIZADO">TERCEIRIZADO</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-ink/70 mb-0.5">CNES Terceiro (se houver)</label>
                        <Input
                          value={novoServico.cnes_terceiro}
                          onChange={(e) => setNovoServico({ ...novoServico, cnes_terceiro: e.target.value })}
                          placeholder="7 dígitos"
                          className="!py-1 text-xs"
                        />
                      </div>
                      <div className="sm:col-span-2 flex items-end">
                        <Button type="button" onClick={adicionarServico} className="w-full !py-1 text-xs">
                          <Plus className="h-3.5 w-3.5" /> Adicionar à Unidade
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Tabela de Serviços já cadastrados */}
                  <div className="rounded-xl border border-sus-900/10 overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="bg-sand/60 text-sus-900/70 border-b border-sus-900/10">
                          <th className="px-3 py-2">Serviço</th>
                          <th className="px-3 py-2">Classificação</th>
                          <th className="px-3 py-2">Característica</th>
                          <th className="px-3 py-2">CNES Terceiro</th>
                          <th className="px-3 py-2 text-right">Ação</th>
                        </tr>
                      </thead>
                      <tbody>
                        {servicos.map((s) => (
                          <tr key={s.id} className="border-b border-sus-900/5 hover:bg-sand/20">
                            <td className="px-3 py-2 font-semibold">
                              <span className="font-mono text-teal mr-1">{s.servico_codigo}</span>
                              {s.servico_descricao}
                            </td>
                            <td className="px-3 py-2">
                              <span className="font-mono mr-1 text-ink/60">{s.classificacao_codigo}</span>
                              {s.classificacao_descricao}
                            </td>
                            <td className="px-3 py-2">
                              <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                s.caracteristica === "PROPRIO" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
                              }`}>
                                {s.caracteristica}
                              </span>
                            </td>
                            <td className="px-3 py-2 font-mono text-ink/60">{s.cnes_terceiro || "—"}</td>
                            <td className="px-3 py-2 text-right">
                              <button
                                type="button"
                                onClick={() => removerServico(s.id)}
                                className="rounded p-1 text-red-600 hover:bg-red-50"
                                title="Remover"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                        {servicos.length === 0 && (
                          <tr>
                            <td colSpan={5} className="px-3 py-6 text-center text-ink/40">
                              {carregandoServicos ? "Carregando serviços..." : "Nenhum serviço especializado registrado nesta unidade."}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ABA 3: EQUIPES DE SAÚDE (INE) */}
              {abaAtiva === "equipes" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-bold text-sus-950">Equipes de Atenção Primária / Família</p>
                      <p className="text-xs text-ink/50">Código INE (10 dígitos) e vinculação de profissionais</p>
                    </div>
                    <Button
                      type="button"
                      onClick={() => setModalNovaEquipe(true)}
                      className="!py-1 text-xs"
                    >
                      <Plus className="h-3.5 w-3.5" /> Nova Equipe INE
                    </Button>
                  </div>

                  {/* Modal / Formulário inline para Criar Equipe */}
                  {modalNovaEquipe && (
                    <div className="rounded-xl border border-sus-900/20 bg-sand/40 p-3.5 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-bold text-sus-950">Cadastrar Equipe com Código INE</p>
                        <button type="button" onClick={() => setModalNovaEquipe(false)} className="text-ink/40 hover:text-ink">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                        <div>
                          <label className="block text-[11px] font-semibold text-ink/70 mb-0.5">Código INE * (10 dígitos)</label>
                          <Input
                            value={novaEquipe.ine}
                            onChange={(e) => setNovaEquipe({ ...novaEquipe, ine: e.target.value.replace(/\D/g, "").slice(0, 10) })}
                            placeholder="Ex: 0001234567"
                            inputMode="numeric"
                            className="!py-1 text-xs"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-ink/70 mb-0.5">Nome da Equipe *</label>
                          <Input
                            value={novaEquipe.nome_equipe}
                            onChange={(e) => setNovaEquipe({ ...novaEquipe, nome_equipe: e.target.value })}
                            placeholder="Ex: ESF 01 Centro"
                            className="!py-1 text-xs"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-ink/70 mb-0.5">Tipo da Equipe</label>
                          <select
                            value={novaEquipe.tipo_equipe}
                            onChange={(e) => setNovaEquipe({ ...novaEquipe, tipo_equipe: e.target.value })}
                            className="w-full rounded-xl border border-sus-900/20 bg-white px-2 py-1.5 text-xs outline-none"
                          >
                            {TIPOS_EQUIPE.map((t) => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-ink/70 mb-0.5">Área / Microárea</label>
                          <Input
                            value={novaEquipe.area}
                            onChange={(e) => setNovaEquipe({ ...novaEquipe, area: e.target.value })}
                            placeholder="Ex: Área 01 / Zona Urbana"
                            className="!py-1 text-xs"
                          />
                        </div>
                      </div>
                      <div className="flex justify-end gap-2 pt-1">
                        <Button type="button" variant="outline" onClick={() => setModalNovaEquipe(false)} className="!py-1 text-xs">
                          Cancelar
                        </Button>
                        <Button type="button" onClick={salvarNovaEquipe} className="!py-1 text-xs">
                          Salvar Equipe
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Lista de Equipes Cadastradas */}
                  <div className="space-y-3">
                    {equipes.map((eq) => (
                      <div key={eq.id} className="rounded-xl border border-sus-900/10 bg-white p-3.5 shadow-2xs">
                        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-sus-900/5 pb-2.5">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-sus-950 text-sm">{eq.nome_equipe}</span>
                              <span className="font-mono rounded bg-teal/10 px-1.5 py-0.5 text-[11px] font-bold text-teal">
                                INE: {eq.ine}
                              </span>
                              <span className={`inline-flex rounded-full px-2 py-0.2 text-[10px] font-semibold ${eq.ativo ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>
                                {eq.ativo ? "ativo" : "inativo"}
                              </span>
                            </div>
                            <p className="text-xs text-ink/60 mt-0.5">
                              {eq.tipo_equipe} {eq.area ? `· Área: ${eq.area}` : ""}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setEquipeVinculoId(eq.id);
                                setNovoProfissionalVinculo({
                                  medico_id: profissionais[0]?.id || 0,
                                  funcao: "MÉDICO",
                                  chs: 40,
                                });
                              }}
                              className="flex items-center gap-1 rounded-lg bg-sand px-2 py-1 text-xs font-semibold text-sus-900 hover:bg-sus-100"
                            >
                              <PlusCircle className="h-3.5 w-3.5 text-teal" /> Vincular Profissional
                            </button>
                            <button
                              type="button"
                              onClick={() => inativarEquipe(eq.id)}
                              className="rounded p-1 text-red-600 hover:bg-red-50"
                              title="Inativar equipe"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Modal inline para vincular profissional a esta equipe */}
                        {equipeVinculoId === eq.id && (
                          <div className="my-2.5 rounded-lg border border-teal/20 bg-teal/5 p-3">
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-xs font-bold text-teal">Vincular Profissional à {eq.nome_equipe}:</p>
                              <button type="button" onClick={() => setEquipeVinculoId(null)} className="text-ink/40 hover:text-ink">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                              <div className="sm:col-span-1">
                                <label className="block text-[11px] font-semibold text-ink/70 mb-0.5">Profissional Cadastrado</label>
                                <select
                                  value={novoProfissionalVinculo.medico_id}
                                  onChange={(e) => setNovoProfissionalVinculo({ ...novoProfissionalVinculo, medico_id: parseInt(e.target.value, 10) })}
                                  className="w-full rounded-xl border border-sus-900/20 bg-white px-2 py-1 text-xs outline-none"
                                >
                                  <option value={0}>Selecione...</option>
                                  {profissionais.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.nome} ({p.crm || p.cbo_descricao || "Sem CRM"})
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className="block text-[11px] font-semibold text-ink/70 mb-0.5">Função na Equipe</label>
                                <select
                                  value={novoProfissionalVinculo.funcao}
                                  onChange={(e) => setNovoProfissionalVinculo({ ...novoProfissionalVinculo, funcao: e.target.value })}
                                  className="w-full rounded-xl border border-sus-900/20 bg-white px-2 py-1 text-xs outline-none"
                                >
                                  {FUNCOES_EQUIPE.map((f) => (
                                    <option key={f} value={f}>{f}</option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className="block text-[11px] font-semibold text-ink/70 mb-0.5">CHS Semanal</label>
                                <div className="flex gap-1.5">
                                  <Input
                                    type="number"
                                    min={1}
                                    max={168}
                                    value={novoProfissionalVinculo.chs}
                                    onChange={(e) => setNovoProfissionalVinculo({ ...novoProfissionalVinculo, chs: parseInt(e.target.value, 10) || 40 })}
                                    className="!py-1 text-xs"
                                  />
                                  <Button type="button" onClick={vincularProfissional} className="!py-1 px-3 text-xs">
                                    <Check className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Tabela de Profissionais da Equipe */}
                        <div className="mt-2.5">
                          {eq.profissionais && eq.profissionais.length > 0 ? (
                            <table className="w-full text-left text-xs">
                              <thead>
                                <tr className="text-ink/50 border-b border-sus-900/5">
                                  <th className="py-1">Profissional</th>
                                  <th className="py-1">Função na Equipe</th>
                                  <th className="py-1">CNS / Registro</th>
                                  <th className="py-1">CHS</th>
                                  <th className="py-1 text-right">Ação</th>
                                </tr>
                              </thead>
                              <tbody>
                                {eq.profissionais.map((p) => (
                                  <tr key={p.id} className="border-b border-sus-900/5 last:border-0">
                                    <td className="py-1.5 font-medium text-sus-950">
                                      {p.medico_nome || `ID #${p.medico_id}`}
                                      {p.medico_cbo && <span className="text-[10px] text-ink/40 block">{p.medico_cbo}</span>}
                                    </td>
                                    <td className="py-1.5">
                                      <span className="font-semibold text-teal">{p.funcao}</span>
                                    </td>
                                    <td className="py-1.5 text-ink/60">
                                      {p.medico_cns ? formataCns(p.medico_cns) : p.medico_crm || "—"}
                                    </td>
                                    <td className="py-1.5 font-mono">{p.chs}h/sem</td>
                                    <td className="py-1.5 text-right">
                                      <button
                                        type="button"
                                        onClick={() => desvincularProfissional(eq.id, p.id)}
                                        className="rounded p-1 text-red-600 hover:bg-red-50"
                                        title="Desvincular"
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <p className="text-xs text-ink/40 italic py-1">
                              Nenhum profissional vinculado a esta equipe. Clique em "+ Vincular Profissional".
                            </p>
                          )}
                        </div>
                      </div>
                    ))}

                    {equipes.length === 0 && (
                      <div className="rounded-xl border border-dashed border-sus-900/20 p-6 text-center text-xs text-ink/50">
                        {carregandoEquipes ? "Carregando equipes..." : "Nenhuma equipe da atenção básica cadastrada nesta unidade. Clique no botão acima para adicionar a primeira equipe com código INE."}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Footer com botão Salvar Dados Gerais */}
            <div className="border-t border-sus-900/10 px-6 py-3.5 bg-sand/20 flex items-center justify-between">
              <span className="text-xs text-ink/50">
                {abaAtiva === "geral" ? "Campos com * são obrigatórios." : `Unidade: ${form.nome}`}
              </span>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" onClick={fechar} className="!py-1.5 text-xs">
                  Fechar
                </Button>
                {abaAtiva === "geral" && (
                  <Button type="button" onClick={salvar} disabled={salvando} className="!py-1.5 text-xs">
                    {salvando ? "Salvando…" : editId ? "Atualizar Dados Gerais" : "Salvar Unidade"}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
