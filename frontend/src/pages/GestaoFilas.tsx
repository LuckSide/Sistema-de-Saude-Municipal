import { useEffect, useMemo, useState } from "react";
import {
  ListOrdered,
  Plus,
  Search,
  Filter,
  Edit2,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  FlaskConical,
  ShieldCheck,
  ShieldAlert,
  Activity,
  Layers,
  HelpCircle,
  Stethoscope,
  RefreshCw,
  X,
  Sparkles,
  Tag,
  Settings2,
  Building2,
} from "lucide-react";
import {
  tfdTipos,
  tfdCriarTipo,
  tfdAtualizarTipo,
  tfdExcluirTipo,
  tfdRedefinirRegrasPadrao,
  tfdEspecialidades,
  fetchMedicos,
  fetchUnidadesSaude,
  type TipoFila,
  type EspecialidadeCat,
  type Medico,
  type UnidadeSaude,
  pagData,
  pagMeta,
} from "../services/api";
import { Badge, Button, Card, Input, Label, Select } from "../components/ui/primitives";
import { useConfirm } from "../components/ConfirmDialog";
import { formatarSubMedico, isMedicoGenericoNome } from "../utils/medicos";

const TIPOS_FILA_CONFIG: {
  id: string;
  rotulo: string;
  descricao: string;
  corBadge: string;
}[] = [
  {
    id: "REGULACAO_GERAL",
    rotulo: "Regulação Geral",
    descricao: "Fila regular de consultas especializadas, exames de imagem e regulação municipal.",
    corBadge: "bg-teal-50 text-teal-800 border-teal-200",
  },
  {
    id: "EXAME_LABORATORIAL",
    rotulo: "Exame Laboratorial",
    descricao: "Exames de sangue e análises clínicas vinculados diretamente ao módulo de Laboratório.",
    corBadge: "bg-purple-50 text-purple-800 border-purple-200",
  },
  {
    id: "ALTA_COMPLEXIDADE",
    rotulo: "Alta Complexidade",
    descricao: "Procedimentos de alta complexidade, cirurgias eletivas e regulação estadual/regional.",
    corBadge: "bg-amber-50 text-amber-800 border-amber-200",
  },
];

const ESPECIALIDADES_SUGERIDAS = [
  { cbo: "225120", nome: "Cardiologia" },
  { cbo: "225225", nome: "Cirurgia Geral" },
  { cbo: "225125", nome: "Clínica Médica" },
  { cbo: "225135", nome: "Dermatologia" },
  { cbo: "225155", nome: "Endocrinologia e Metabologia" },
  { cbo: "225165", nome: "Gastroenterologia" },
  { cbo: "225250", nome: "Ginecologia e Obstetrícia" },
  { cbo: "225270", nome: "Ortopedia e Traumatologia" },
  { cbo: "225275", nome: "Otorrinolaringologia" },
  { cbo: "225124", nome: "Pediatria" },
  { cbo: "225112", nome: "Neurologia" },
  { cbo: "225260", nome: "Neurocirurgia" },
  { cbo: "225265", nome: "Oftalmologia" },
  { cbo: "225180", nome: "Pneumologia" },
  { cbo: "225133", "nome": "Psiquiatria" },
  { cbo: "225320", nome: "Radiologia e Diagnóstico por Imagem" },
  { cbo: "225195", nome: "Reumatologia" },
  { cbo: "225285", nome: "Urologia" },
  { cbo: "225210", nome: "Angiologia e Cirurgia Vascular" },
  { cbo: "225215", nome: "Cirurgia Cardiovascular" },
  { cbo: "225109", nome: "Nefrologia" },
  { cbo: "225181", nome: "Geriatria" },
  { cbo: "225103", nome: "Infectologia" },
  { cbo: "225122", nome: "Oncologia Clínica" },
  { cbo: "225185", nome: "Hematologia e Hemoterapia" },
  { cbo: "225142", nome: "Medicina de Família e Comunidade" },
  { cbo: "225271", nome: "Mastologia" },
  { cbo: "225310", nome: "Patologia Clínica / Medicina Laboratorial" },
  { cbo: "225305", nome: "Anatomia Patológica e Citopatologia" },
  { cbo: "225315", nome: "Medicina Nuclear" },
  { cbo: "225320", nome: "Cirurgia Plástica" },
  { cbo: "225240", nome: "Cirurgia Pediátrica" },
  { cbo: "225215", nome: "Cirurgia Cardiovascular" },
  { cbo: "225235", nome: "Coloproctologia" },
  { cbo: "225110", nome: "Alergia e Imunologia" },
  { cbo: "225151", nome: "Anestesiologia" },
  { cbo: "225140", nome: "Nutrologia" },
  { cbo: "225226", nome: "Pequena Cirurgia" },
];

function extrairCbos(cbosStr: string | undefined): string[] {
  if (!cbosStr) return [];
  const s = cbosStr.trim();
  if (s.startsWith("[") && s.endsWith("]")) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) {
        return parsed.map((x) => String(typeof x === "object" ? x?.cbo || x?.codigo || "" : x).trim()).filter(Boolean);
      }
    } catch {
      // fallback
    }
  }
  return s
    .replace(/;/g, ",")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function extrairIdsInteiros(raw: string | undefined): number[] {
  if (!raw) return [];
  const s = raw.trim();
  if (s.startsWith("[") && s.endsWith("]")) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) {
        return [...new Set(parsed.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0))];
      }
    } catch {
      // fallback
    }
  }
  return [
    ...new Set(
      s
        .replace(/;/g, ",")
        .split(",")
        .map((x) => Number(x.trim()))
        .filter((n) => Number.isFinite(n) && n > 0)
    ),
  ];
}

export default function GestaoFilas() {
  const [filas, setFilas] = useState<TipoFila[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState("");

  // Filtros
  const [busca, setBusca] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<string>("todos");
  const [filtroRestricao, setFiltroRestricao] = useState<string>("todos"); // todos, estritos, flexiveis
  const [filtroStatus, setFiltroStatus] = useState<string>("todos");

  // Paginação
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);

  // Especialidades cadastradas no sistema para o seletor de CBO
  const [especialidadesSistema, setEspecialidadesSistema] = useState<EspecialidadeCat[]>([]);
  const [medicosSistema, setMedicosSistema] = useState<Medico[]>([]);
  const [unidadesSistema, setUnidadesSistema] = useState<UnidadeSaude[]>([]);
  const [buscaMedicoRegra, setBuscaMedicoRegra] = useState("");
  const [buscaUnidadeRegra, setBuscaUnidadeRegra] = useState("");

  // Modal Novo / Edição
  const [modalAberto, setModalAberto] = useState(false);
  const [filaEdicao, setFilaEdicao] = useState<TipoFila | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [redefinindo, setRedefinindo] = useState(false);
  const [erroModal, setErroModal] = useState("");

  // Estado do formulário de regras
  const [form, setForm] = useState({
    codigo: "",
    nome: "",
    tipo_fila: "REGULACAO_GERAL",
    ativo: true,
    cbos_permitidos: [] as string[],
    exigir_cbo_estrito: false,
    prefixos_sigtap: "",
    excluir_prefixos_sigtap: "",
    especialidade_padrao: "",
    cbo_padrao: "",
    sinonimos: "",
    descricao_regras: "",
    medicos_permitidos: [] as number[],
    unidades_permitidas: [] as number[],
  });

  // Campo auxiliar para adicionar CBO
  const [cboParaAdicionar, setCboParaAdicionar] = useState("");

  const { confirmar } = useConfirm();

  // Carrega catálogo de especialidades, médicos e unidades do sistema
  useEffect(() => {
    tfdEspecialidades({ limit: 1000 })
      .then((res) => {
        const lista = pagData<EspecialidadeCat>(res);
        setEspecialidadesSistema(lista);
      })
      .catch(() => {});
    fetchMedicos({ somente_ativos: true })
      .then((m) => setMedicosSistema(m.filter((x) => x.ativo && !isMedicoGenericoNome(x.nome))))
      .catch(() => {});
    fetchUnidadesSaude()
      .then((u) => setUnidadesSistema(u.filter((x) => x.ativo)))
      .catch(() => {});
  }, []);

  // Lista consolidada de CBOs disponíveis (do sistema + padrão)
  const mapaCbosDisponiveis = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const esp of ESPECIALIDADES_SUGERIDAS) {
      mapa.set(esp.cbo, esp.nome);
    }
    for (const esp of especialidadesSistema) {
      if (esp.codigo_cbo && esp.nome) {
        mapa.set(esp.codigo_cbo.trim(), esp.nome.trim());
      }
    }
    return mapa;
  }, [especialidadesSistema]);

  const listaCbosParaSelecao = useMemo(() => {
    const arr: { cbo: string; nome: string }[] = [];
    mapaCbosDisponiveis.forEach((nome, cbo) => {
      arr.push({ cbo, nome });
    });
    return arr.sort((a, b) => a.nome.localeCompare(b.nome));
  }, [mapaCbosDisponiveis]);

  async function carregarFilas(p = page) {
    setCarregando(true);
    setErro("");
    try {
      const params: { q?: string; tipo_fila?: string; ativos?: boolean; page: number; limit: number } = {
        page: p,
        limit: 100,
      };
      if (busca.trim()) params.q = busca.trim();
      if (filtroTipo !== "todos") params.tipo_fila = filtroTipo;
      if (filtroStatus === "ativos") params.ativos = true;
      if (filtroStatus === "inativos") params.ativos = false;

      const r = await tfdTipos(params);
      let data = pagData<TipoFila>(r);
      const meta = pagMeta(r);

      // Filtro local adicional de restrição CBO
      if (filtroRestricao === "estritos") {
        data = data.filter((f) => f.exigir_cbo_estrito || (extrairCbos(f.cbos_permitidos).length > 0 && f.exigir_cbo_estrito));
      } else if (filtroRestricao === "flexiveis") {
        data = data.filter((f) => !f.exigir_cbo_estrito);
      }

      setFilas(data);
      setTotal(meta.total);
      setPage(meta.page);
      setPages(meta.pages);
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Erro ao carregar lista de tipos de serviço.");
      setFilas([]);
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregarFilas(1);
  }, [busca, filtroTipo, filtroRestricao, filtroStatus]);

  function abrirModalCriacao() {
    setFilaEdicao(null);
    setForm({
      codigo: "",
      nome: "",
      tipo_fila: "REGULACAO_GERAL",
      ativo: true,
      cbos_permitidos: [],
      exigir_cbo_estrito: false,
      prefixos_sigtap: "",
      excluir_prefixos_sigtap: "",
      especialidade_padrao: "",
      cbo_padrao: "",
      sinonimos: "",
      descricao_regras: "",
      medicos_permitidos: [],
      unidades_permitidas: [],
    });
    setBuscaMedicoRegra("");
    setBuscaUnidadeRegra("");
    setCboParaAdicionar("");
    setErroModal("");
    setModalAberto(true);
  }

  function abrirModalEdicao(f: TipoFila) {
    setFilaEdicao(f);
    const cbosArray = extrairCbos(f.cbos_permitidos);
    setForm({
      codigo: f.codigo || "",
      nome: f.nome || "",
      tipo_fila: f.tipo_fila || "REGULACAO_GERAL",
      ativo: f.ativo,
      cbos_permitidos: cbosArray,
      exigir_cbo_estrito: Boolean(f.exigir_cbo_estrito),
      prefixos_sigtap: f.prefixos_sigtap || "",
      excluir_prefixos_sigtap: f.excluir_prefixos_sigtap || "",
      especialidade_padrao: f.especialidade_padrao || "",
      cbo_padrao: f.cbo_padrao || "",
      sinonimos: f.sinonimos || "",
      descricao_regras: f.descricao_regras || "",
      medicos_permitidos: extrairIdsInteiros(f.medicos_permitidos),
      unidades_permitidas: extrairIdsInteiros(f.unidades_permitidas),
    });
    setBuscaMedicoRegra("");
    setBuscaUnidadeRegra("");
    setCboParaAdicionar("");
    setErroModal("");
    setModalAberto(true);
  }

  function adicionarCbo(cboCode: string) {
    const limpo = cboCode.trim();
    if (!limpo) return;
    if (form.cbos_permitidos.includes(limpo)) {
      setCboParaAdicionar("");
      return;
    }
    const novos = [...form.cbos_permitidos, limpo];
    let novaEspPadrao = form.especialidade_padrao;
    let novoCboPadrao = form.cbo_padrao;
    if (!novaEspPadrao && mapaCbosDisponiveis.has(limpo)) {
      novaEspPadrao = mapaCbosDisponiveis.get(limpo) || "";
      novoCboPadrao = limpo;
    }
    setForm({
      ...form,
      cbos_permitidos: novos,
      especialidade_padrao: novaEspPadrao,
      cbo_padrao: novoCboPadrao,
    });
    setCboParaAdicionar("");
  }

  function removerCbo(cboCode: string) {
    const novos = form.cbos_permitidos.filter((c) => c !== cboCode);
    setForm({
      ...form,
      cbos_permitidos: novos,
      cbo_padrao: form.cbo_padrao === cboCode ? (novos[0] || "") : form.cbo_padrao,
      especialidade_padrao: form.cbo_padrao === cboCode ? (mapaCbosDisponiveis.get(novos[0]) || "") : form.especialidade_padrao,
    });
  }

  function limparTodosCbosForm() {
    setForm({
      ...form,
      cbos_permitidos: [],
      cbo_padrao: "",
      especialidade_padrao: "",
    });
  }

  // Remoção Rápida de CBO direto na listagem da tabela
  async function removerCboRapido(f: TipoFila, cboCode: string) {
    const cbosAtuais = extrairCbos(f.cbos_permitidos);
    const novosCbos = cbosAtuais.filter((c) => c !== cboCode);
    const espRemovida = mapaCbosDisponiveis.get(cboCode) || cboCode;
    const ok = await confirmar({
      titulo: `Remover CBO ${cboCode}`,
      descricao: `Deseja desvincular a especialidade "${espRemovida}" (${cboCode}) do tipo de serviço "${f.nome}"?`,
      textoConfirmar: "Remover CBO",
      textoCancelar: "Cancelar",
      variante: "danger",
    });
    if (!ok) return;

    try {
      await tfdAtualizarTipo(f.id, {
        codigo: f.codigo,
        nome: f.nome,
        tipo_fila: f.tipo_fila,
        ativo: f.ativo,
        cbos_permitidos: JSON.stringify(novosCbos),
        exigir_cbo_estrito: f.exigir_cbo_estrito,
        prefixos_sigtap: f.prefixos_sigtap,
        excluir_prefixos_sigtap: f.excluir_prefixos_sigtap,
        especialidade_padrao: f.cbo_padrao === cboCode ? "" : f.especialidade_padrao,
        cbo_padrao: f.cbo_padrao === cboCode ? "" : f.cbo_padrao,
        sinonimos: f.sinonimos,
        descricao_regras: f.descricao_regras,
        medicos_permitidos: f.medicos_permitidos || "",
        unidades_permitidas: f.unidades_permitidas || "",
      });
      setSucesso(`CBO ${cboCode} (${espRemovida}) removido com sucesso de "${f.nome}".`);
      carregarFilas(page);
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Erro ao remover CBO do serviço.");
    }
  }

  async function handleSalvar(e: React.FormEvent) {
    e.preventDefault();
    if (!form.codigo.trim() || !form.nome.trim()) {
      setErroModal("Preencha o código identificador e o nome do tipo de serviço.");
      return;
    }

    setSalvando(true);
    setErroModal("");
    try {
      const payload = {
        codigo: form.codigo.trim().toUpperCase(),
        nome: form.nome.trim(),
        tipo_fila: form.tipo_fila,
        ativo: form.ativo,
        cbos_permitidos: JSON.stringify(form.cbos_permitidos),
        exigir_cbo_estrito: form.exigir_cbo_estrito,
        prefixos_sigtap: form.prefixos_sigtap.trim(),
        excluir_prefixos_sigtap: form.excluir_prefixos_sigtap.trim(),
        especialidade_padrao: form.especialidade_padrao.trim(),
        cbo_padrao: form.cbo_padrao.trim(),
        sinonimos: form.sinonimos.trim(),
        descricao_regras: form.descricao_regras.trim(),
        medicos_permitidos: form.medicos_permitidos.length > 0 ? JSON.stringify(form.medicos_permitidos) : "",
        unidades_permitidas: form.unidades_permitidas.length > 0 ? JSON.stringify(form.unidades_permitidas) : "",
      };

      if (filaEdicao) {
        await tfdAtualizarTipo(filaEdicao.id, payload);
        setSucesso(`Tipo de serviço "${form.nome}" atualizado com sucesso!`);
      } else {
        await tfdCriarTipo(payload);
        setSucesso(`Tipo de serviço "${form.nome}" criado com sucesso!`);
      }
      setModalAberto(false);
      carregarFilas(page);
    } catch (err: any) {
      setErroModal(err?.response?.data?.detail || "Erro ao salvar regras do tipo de serviço.");
    } finally {
      setSalvando(false);
    }
  }

  async function handleRedefinirPadroes() {
    const ok = await confirmar({
      titulo: "Restaurar Regras Padrão SUS / Vivver",
      descricao:
        "Deseja inicializar as regras padrão para todos os tipos de serviço? Isso preencherá os CBOs autorizados padrão (ex: Cardiologia para exames cardiológicos, Radiologia para ultrassom/tomo, Cirurgia Geral para cirurgias) nos serviços que ainda não tiverem regras configuradas.",
      textoConfirmar: "Restaurar Regras",
      textoCancelar: "Cancelar",
      variante: "primary",
    });
    if (!ok) return;

    setRedefinindo(true);
    setErro("");
    try {
      const res = await tfdRedefinirRegrasPadrao(false);
      setSucesso(res.mensagem || "Regras padrão aplicadas com sucesso!");
      carregarFilas(1);
    } catch (err: any) {
      setErro(err?.response?.data?.detail || "Erro ao redefinir regras padrão.");
    } finally {
      setRedefinindo(false);
    }
  }

  async function alternarStatus(f: TipoFila) {
    try {
      await tfdAtualizarTipo(f.id, {
        codigo: f.codigo,
        nome: f.nome,
        tipo_fila: f.tipo_fila || "REGULACAO_GERAL",
        ativo: !f.ativo,
        cbos_permitidos: f.cbos_permitidos || "",
        exigir_cbo_estrito: Boolean(f.exigir_cbo_estrito),
        prefixos_sigtap: f.prefixos_sigtap || "",
        excluir_prefixos_sigtap: f.excluir_prefixos_sigtap || "",
        especialidade_padrao: f.especialidade_padrao || "",
        cbo_padrao: f.cbo_padrao || "",
        sinonimos: f.sinonimos || "",
        descricao_regras: f.descricao_regras || "",
        medicos_permitidos: f.medicos_permitidos || "",
        unidades_permitidas: f.unidades_permitidas || "",
      });
      setSucesso(`Serviço "${f.nome}" ${f.ativo ? "desativado" : "ativado"} com sucesso.`);
      carregarFilas(page);
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Erro ao alterar status do serviço.");
    }
  }

  async function handleExcluir(f: TipoFila) {
    const ok = await confirmar({
      titulo: "Excluir Tipo de Serviço",
      descricao: `Deseja realmente remover o serviço "${f.nome}" (${f.codigo})? Procedimentos vinculados perderão essa categorização de regras.`,
      textoConfirmar: "Excluir",
      textoCancelar: "Cancelar",
      variante: "danger",
    });
    if (!ok) return;

    try {
      await tfdExcluirTipo(f.id);
      setSucesso(`Tipo de serviço "${f.nome}" removido com sucesso.`);
      carregarFilas(page);
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Erro ao excluir serviço.");
    }
  }

  function getBadgeTipo(tipo: string | undefined) {
    const conf = TIPOS_FILA_CONFIG.find((c) => c.id === tipo) || TIPOS_FILA_CONFIG[0];
    return (
      <span
        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${conf.corBadge}`}
        title={conf.descricao}
      >
        {tipo === "EXAME_LABORATORIAL" && <FlaskConical className="h-3 w-3" />}
        {tipo === "REGULACAO_GERAL" && <Layers className="h-3 w-3" />}
        {tipo === "ALTA_COMPLEXIDADE" && <Activity className="h-3 w-3" />}
        {conf.rotulo}
      </span>
    );
  }

  const totalRestritos = useMemo(
    () => filas.filter((f) => f.exigir_cbo_estrito || extrairCbos(f.cbos_permitidos).length > 0).length,
    [filas]
  );
  const totalLaboratoriais = useMemo(
    () => filas.filter((f) => f.tipo_fila === "EXAME_LABORATORIAL").length,
    [filas]
  );

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-sus-950 flex items-center gap-2">
            <Settings2 className="h-6 w-6 text-teal" /> Organização de Tipos de Serviço & Regras CBO
          </h2>
          <p className="text-sm text-ink/70">
            Controle centralizado dos tipos de exames e serviços: vincule quais CBOs médicos podem solicitar ou realizar cada procedimento (ex: restringir exames cardiológicos a cardiologistas).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleRedefinirPadroes}
            disabled={redefinindo}
            className="gap-2 text-xs border-sus-900/20 text-sus-900 hover:bg-sand"
          >
            <RefreshCw className={`h-4 w-4 ${redefinindo ? "animate-spin" : ""}`} />
            {redefinindo ? "Inicializando..." : "Restaurar Regras Padrão SUS"}
          </Button>
          <Button onClick={abrirModalCriacao} className="gap-2 bg-teal hover:bg-teal-700 text-white shadow-sm text-xs">
            <Plus className="h-4 w-4" /> Novo Tipo de Serviço
          </Button>
        </div>
      </div>

      {/* Alertas */}
      {erro && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{erro}</span>
        </div>
      )}
      {sucesso && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{sucesso}</span>
        </div>
      )}

      {/* Cards de Resumo */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-4 bg-white border border-sus-900/10">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-ink/60 uppercase tracking-wider">Total de Serviços</p>
              <h3 className="text-2xl font-extrabold text-sus-950 mt-1">{total || filas.length}</h3>
              <p className="text-[11px] text-ink/50 mt-0.5">Cadastrados no catálogo municipal</p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-teal-50 flex items-center justify-center text-teal">
              <ListOrdered className="h-5 w-5" />
            </div>
          </div>
        </Card>

        <Card className="p-4 bg-white border border-sus-900/10">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-ink/60 uppercase tracking-wider">Regras de CBO Ativas</p>
              <h3 className="text-2xl font-extrabold text-teal mt-1">{totalRestritos}</h3>
              <p className="text-[11px] text-ink/50 mt-0.5">Com CBOs especializados liberados</p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-teal-50 flex items-center justify-center text-teal">
              <ShieldCheck className="h-5 w-5" />
            </div>
          </div>
        </Card>

        <Card className="p-4 bg-white border border-sus-900/10">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-ink/60 uppercase tracking-wider">Serviços Laboratoriais</p>
              <h3 className="text-2xl font-extrabold text-purple-700 mt-1">{totalLaboratoriais}</h3>
              <p className="text-[11px] text-ink/50 mt-0.5">Integrados ao fluxo laboratorial</p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-purple-50 flex items-center justify-center text-purple-700">
              <FlaskConical className="h-5 w-5" />
            </div>
          </div>
        </Card>
      </div>

      {/* Barra de Filtros */}
      <Card className="p-4 bg-white border border-sus-900/10">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Busca Texto */}
          <div>
            <Label className="text-xs font-semibold text-ink/70">Buscar Serviço / CBO / Prefixo</Label>
            <div className="relative mt-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-ink/40" />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Ex: Cardio, 225120, USG, ECG..."
                className="pl-9 text-xs"
              />
            </div>
          </div>

          {/* Categoria */}
          <div>
            <Label className="text-xs font-semibold text-ink/70">Categoria do Fluxo</Label>
            <Select
              value={filtroTipo}
              onChange={(e) => setFiltroTipo(e.target.value)}
              className="mt-1 text-xs"
            >
              <option value="todos">Todas as Categorias</option>
              <option value="REGULACAO_GERAL">Regulação Geral / TFD</option>
              <option value="EXAME_LABORATORIAL">Exames Laboratoriais</option>
              <option value="ALTA_COMPLEXIDADE">Alta Complexidade / Cirurgias</option>
            </Select>
          </div>

          {/* Filtro Restrição CBO */}
          <div>
            <Label className="text-xs font-semibold text-ink/70">Restrição de CBO</Label>
            <Select
              value={filtroRestricao}
              onChange={(e) => setFiltroRestricao(e.target.value)}
              className="mt-1 text-xs"
            >
              <option value="todos">Todos os Serviços</option>
              <option value="estritos">Apenas com CBOs Restritos</option>
              <option value="flexiveis">Livre / Qualquer Especialidade</option>
            </Select>
          </div>

          {/* Status Ativo */}
          <div>
            <Label className="text-xs font-semibold text-ink/70">Status</Label>
            <Select
              value={filtroStatus}
              onChange={(e) => setFiltroStatus(e.target.value)}
              className="mt-1 text-xs"
            >
              <option value="todos">Todos (Ativos e Inativos)</option>
              <option value="ativos">Apenas Ativos</option>
              <option value="inativos">Apenas Inativos</option>
            </Select>
          </div>
        </div>
      </Card>

      {/* Lista de Tipos de Serviço */}
      <Card className="overflow-hidden border border-sus-900/10">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-sand/60 text-sus-950 font-bold border-b border-sus-900/10">
              <tr>
                <th className="p-3 w-16">Código</th>
                <th className="p-3">Tipo de Serviço / Destino</th>
                <th className="p-3">CBOs Médicos Liberados</th>
                <th className="p-3">Regra de Validação</th>
                <th className="p-3">Vínculo SIGTAP & Especialidade</th>
                <th className="p-3 text-center w-24">Status</th>
                <th className="p-3 text-right w-28">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sus-900/10">
              {carregando ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-ink/60">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto text-teal mb-2" />
                    Carregando tipos de serviço e regras de CBO...
                  </td>
                </tr>
              ) : filas.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-ink/60">
                    Nenhum tipo de serviço encontrado para os filtros selecionados.
                  </td>
                </tr>
              ) : (
                filas.map((f) => {
                  const cbosArr = extrairCbos(f.cbos_permitidos);
                  const detalhes = f.cbos_detalhes || [];
                  return (
                    <tr key={f.id} className="hover:bg-sand/30 transition-colors">
                      {/* Código */}
                      <td className="p-3 font-mono font-bold text-sus-900">
                        {f.codigo || "—"}
                      </td>

                      {/* Nome e Destino */}
                      <td className="p-3">
                        <div className="font-bold text-sus-950 text-sm">{f.nome}</div>
                        <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                          {getBadgeTipo(f.tipo_fila)}
                          {f.sinonimos && (
                            <span className="text-[10px] text-ink/50 bg-ink/5 px-2 py-0.5 rounded-md" title={`Sinônimos: ${f.sinonimos}`}>
                              Atalhos: {f.sinonimos.split(",").slice(0, 3).join(", ")}
                              {f.sinonimos.split(",").length > 3 ? "..." : ""}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* CBOs Liberados com Remoção Rápida */}
                      <td className="p-3 max-w-xs">
                        {cbosArr.length === 0 ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-ink/60 bg-gray-50 border border-gray-200 px-2 py-0.5 rounded-md">
                            Livre (qualquer especialidade médica)
                          </span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {cbosArr.map((cboCode) => {
                              const d = detalhes.find((x) => x.cbo === cboCode);
                              const nomeEsp = d?.descricao || mapaCbosDisponiveis.get(cboCode) || `CBO ${cboCode}`;
                              return (
                                <span
                                  key={cboCode}
                                  className="inline-flex items-center gap-1 text-[11px] font-semibold bg-teal-50 text-teal-900 border border-teal-200/80 px-2 py-0.5 rounded-md group"
                                  title={`${cboCode} - ${nomeEsp}`}
                                >
                                  <Stethoscope className="h-3 w-3 text-teal" />
                                  <span className="font-mono text-[10px] text-teal-700">{cboCode}</span>
                                  <span>{nomeEsp}</span>
                                  <button
                                    type="button"
                                    onClick={() => removerCboRapido(f, cboCode)}
                                    className="ml-0.5 text-ink/40 hover:text-red-700 hover:bg-red-50 rounded p-0.5 transition"
                                    title={`Remover CBO ${cboCode} deste serviço`}
                                  >
                                    <X className="h-2.5 w-2.5" />
                                  </button>
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </td>

                      {/* Regra de Validação */}
                      <td className="p-3">
                        {f.exigir_cbo_estrito ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-900 border border-amber-300">
                            <ShieldAlert className="h-3 w-3 text-amber-600" />
                            CBO Estrito Obrigatório
                          </span>
                        ) : cbosArr.length > 0 ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-800 border border-emerald-200">
                            <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                            Orientativo / Recomendado
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-gray-50 text-gray-700 border border-gray-200">
                            Atenção Básica / Livre
                          </span>
                        )}
                      </td>

                      {/* Vínculo SIGTAP & Especialidade Padrão */}
                      <td className="p-3">
                        {f.especialidade_padrao && (
                          <div className="font-semibold text-sus-900 text-xs">
                            {f.especialidade_padrao} {f.cbo_padrao ? `(${f.cbo_padrao})` : ""}
                          </div>
                        )}
                        {f.prefixos_sigtap ? (
                          <div className="mt-0.5 text-[11px] text-ink/60 font-mono">
                            Prefixos: {f.prefixos_sigtap}
                          </div>
                        ) : (
                          <div className="text-[11px] text-ink/40">Sem prefixos fixos</div>
                        )}
                      </td>

                      {/* Status */}
                      <td className="p-3 text-center">
                        <button
                          type="button"
                          onClick={() => alternarStatus(f)}
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold border transition ${
                            f.ativo
                              ? "bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100"
                              : "bg-red-50 text-red-800 border-red-200 hover:bg-red-100"
                          }`}
                          title={f.ativo ? "Clique para desativar este tipo de serviço" : "Clique para ativar"}
                        >
                          {f.ativo ? "Ativo" : "Inativo"}
                        </button>
                      </td>

                      {/* Ações */}
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => abrirModalEdicao(f)}
                            className="h-8 px-2.5 text-xs text-sus-900 border-sus-900/20 hover:bg-sand gap-1 font-semibold"
                            title="Editar regras e CBOs permitidos"
                          >
                            <Edit2 className="h-3.5 w-3.5" /> Editar Regras
                          </Button>
                          <button
                            type="button"
                            onClick={() => handleExcluir(f)}
                            className="p-1.5 text-ink/40 hover:text-red-700 hover:bg-red-50 rounded-lg transition"
                            title="Excluir tipo de serviço"
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

        {/* Paginação */}
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-sus-900/10 px-4 py-3 bg-white">
            <span className="text-xs text-ink/60">
              Página {page} de {pages} ({total} tipos cadastrados)
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => carregarFilas(page - 1)}
                className="text-xs"
              >
                Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pages}
                onClick={() => carregarFilas(page + 1)}
                className="text-xs"
              >
                Próxima
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Modal de Criação / Edição de Regras */}
      {modalAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs overflow-y-auto">
          <Card className="w-full max-w-2xl p-6 space-y-5 shadow-2xl my-8 max-h-[90vh] overflow-y-auto">
            {/* Header Modal */}
            <div className="flex items-center justify-between border-b border-sus-900/10 pb-3">
              <div>
                <h3 className="text-base font-bold text-sus-950 flex items-center gap-2">
                  <Settings2 className="h-5 w-5 text-teal" />
                  {filaEdicao ? `Editar Regras: ${filaEdicao.nome}` : "Novo Tipo de Serviço"}
                </h3>
                <p className="text-xs text-ink/60 mt-0.5">
                  Configure identificação, CBOs liberados para este serviço e parâmetros de validação SIGTAP.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalAberto(false)}
                className="text-ink/40 hover:text-ink/80 text-xl font-bold p-1 rounded-lg"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {erroModal && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{erroModal}</span>
              </div>
            )}

            <form onSubmit={handleSalvar} className="space-y-5">
              {/* Bloco 1: Identificação Básica */}
              <div className="bg-sand/30 p-4 rounded-xl border border-sus-900/10 space-y-3">
                <h4 className="text-xs font-bold text-sus-950 uppercase tracking-wider flex items-center gap-1.5">
                  <ListOrdered className="h-4 w-4 text-teal" /> 1. Identificação do Serviço
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs font-semibold">Código / Sigla *</Label>
                    <Input
                      value={form.codigo}
                      onChange={(e) => setForm({ ...form, codigo: e.target.value.toUpperCase() })}
                      placeholder="Ex: CARD, USG, TOMO, CIR"
                      className="mt-1 font-mono uppercase text-xs"
                      required
                    />
                    <p className="mt-0.5 text-[10px] text-ink/50">Código interno ou sigla oficial (ex: CARD).</p>
                  </div>

                  <div>
                    <Label className="text-xs font-semibold">Nome do Tipo de Serviço *</Label>
                    <Input
                      value={form.nome}
                      onChange={(e) => setForm({ ...form, nome: e.target.value })}
                      placeholder="Ex: EXAMES CARDIOLOGICOS"
                      className="mt-1 text-xs"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs font-semibold">Categoria do Fluxo *</Label>
                    <Select
                      value={form.tipo_fila}
                      onChange={(e) => setForm({ ...form, tipo_fila: e.target.value })}
                      className="mt-1 text-xs"
                      required
                    >
                      <option value="REGULACAO_GERAL">Regulação Geral (Consultas, Imagens e Fila Municipal)</option>
                      <option value="EXAME_LABORATORIAL">Exame Laboratorial (Módulo de Sangue / Laboratórios)</option>
                      <option value="ALTA_COMPLEXIDADE">Alta Complexidade (Cirurgias Eletivas / Regulação Regional)</option>
                    </Select>
                  </div>

                  <div className="flex items-center gap-2 pt-5">
                    <input
                      type="checkbox"
                      id="modal-chk-ativo"
                      checked={form.ativo}
                      onChange={(e) => setForm({ ...form, ativo: e.target.checked })}
                      className="rounded border-sus-900/20 text-teal focus:ring-teal"
                    />
                    <Label htmlFor="modal-chk-ativo" className="text-xs font-medium cursor-pointer">
                      Tipo de Serviço Ativo para Lançamentos
                    </Label>
                  </div>
                </div>
              </div>

              {/* Bloco 2: Liberação de CBOs (Requisito Principal do Usuário) */}
              <div className="bg-teal-50/40 p-4 rounded-xl border border-teal-200/60 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-teal-950 uppercase tracking-wider flex items-center gap-1.5">
                    <Stethoscope className="h-4 w-4 text-teal" /> 2. Liberação de CBOs & Especialidades Médicas
                  </h4>
                  <div className="flex items-center gap-2">
                    {form.cbos_permitidos.length > 0 && (
                      <button
                        type="button"
                        onClick={limparTodosCbosForm}
                        className="text-[11px] font-semibold text-red-600 hover:text-red-800 hover:underline"
                        title="Remover todas as restrições e liberar para qualquer médico"
                      >
                        Limpar todos os CBOs
                      </button>
                    )}
                    <span className="text-[11px] font-semibold text-teal-800 bg-teal-100/70 px-2 py-0.5 rounded-md">
                      {form.cbos_permitidos.length} CBO(s) liberado(s)
                    </span>
                  </div>
                </div>
                <p className="text-[11px] text-ink/70">
                  Adicione os CBOs médicos autorizados a requisitar ou realizar este serviço (ex: liberar apenas Cardiologia para exames cardiológicos).
                </p>

                {/* Seletor / Adicionador de CBO */}
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <Label className="text-xs font-semibold text-sus-950">Selecione uma Especialidade / CBO</Label>
                    <Select
                      value={cboParaAdicionar}
                      onChange={(e) => setCboParaAdicionar(e.target.value)}
                      className="mt-1 text-xs"
                    >
                      <option value="">Selecione para adicionar…</option>
                      {listaCbosParaSelecao.map((item) => (
                        <option
                          key={item.cbo}
                          value={item.cbo}
                          disabled={form.cbos_permitidos.includes(item.cbo)}
                        >
                          {item.cbo} — {item.nome} {form.cbos_permitidos.includes(item.cbo) ? "(Já adicionado)" : ""}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <Button
                    type="button"
                    onClick={() => {
                      if (cboParaAdicionar) adicionarCbo(cboParaAdicionar);
                    }}
                    disabled={!cboParaAdicionar || form.cbos_permitidos.includes(cboParaAdicionar)}
                    className="bg-teal hover:bg-teal-700 text-white text-xs h-9 px-3 gap-1 shrink-0"
                  >
                    <Plus className="h-3.5 w-3.5" /> Adicionar CBO
                  </Button>
                </div>

                {/* Lista de CBOs Liberados como Badges com botão X */}
                <div className="pt-2">
                  <Label className="text-xs font-semibold text-sus-950 block mb-1.5">
                    CBOs atualmente liberados para este serviço:
                  </Label>
                  {form.cbos_permitidos.length === 0 ? (
                    <div className="p-3 bg-white border border-dashed border-sus-900/20 rounded-xl text-center text-xs text-ink/60">
                      Nenhum CBO restrito configurado. Qualquer médico (inclusive clínicos gerais da atenção primária) poderá solicitar este exame.
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2 p-2 bg-white rounded-xl border border-teal-200 min-h-[46px] items-center">
                      {form.cbos_permitidos.map((cboCode) => {
                        const nomeEsp = mapaCbosDisponiveis.get(cboCode) || `CBO ${cboCode}`;
                        return (
                          <span
                            key={cboCode}
                            className="inline-flex items-center gap-1.5 bg-teal-50 text-teal-950 border border-teal-300 text-xs font-semibold px-2.5 py-1 rounded-lg shadow-2xs"
                          >
                            <Stethoscope className="h-3.5 w-3.5 text-teal" />
                            <span className="font-mono text-[11px] text-teal-700">{cboCode}</span>
                            <span>{nomeEsp}</span>
                            <button
                              type="button"
                              onClick={() => removerCbo(cboCode)}
                              className="text-teal-700 hover:text-red-700 hover:bg-red-50 rounded p-0.5 ml-1 transition"
                              title="Remover CBO"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Toggle de Restrição Estrita */}
                <div className="bg-white p-3 rounded-xl border border-teal-200 mt-2 space-y-1">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="chk-estrito-cbo"
                      checked={form.exigir_cbo_estrito}
                      onChange={(e) => setForm({ ...form, exigir_cbo_estrito: e.target.checked })}
                      className="rounded border-sus-900/20 text-teal focus:ring-teal"
                    />
                    <Label htmlFor="chk-estrito-cbo" className="text-xs font-bold text-sus-950 cursor-pointer flex items-center gap-1.5">
                      <ShieldAlert className="h-4 w-4 text-amber-600" /> Exigir CBO estrito no lançamento de exames
                    </Label>
                  </div>
                  <p className="text-[11px] text-ink/70 pl-6">
                    {form.exigir_cbo_estrito
                      ? "Restrição estrita ATIVA: apenas médicos com os CBOs liberados acima poderão ser vinculados sem divergência. Médicos não autorizados serão sinalizados no sistema."
                      : "Modo orientativo: médicos com outros CBOs poderão ser selecionados com aviso informativo orientando a especialidade requerida."}
                  </p>
                </div>

                {/* Especialidade e CBO Padrão */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <div>
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold">Especialidade Médica Padrão</Label>
                      {form.especialidade_padrao && (
                        <button
                          type="button"
                          onClick={() => setForm({ ...form, especialidade_padrao: "", cbo_padrao: "" })}
                          className="text-[10px] text-ink/45 hover:text-red-600"
                        >
                          Limpar
                        </button>
                      )}
                    </div>
                    <Input
                      value={form.especialidade_padrao}
                      onChange={(e) => setForm({ ...form, especialidade_padrao: e.target.value })}
                      placeholder="Ex: Cardiologia"
                      className="mt-1 text-xs"
                    />
                    <p className="mt-0.5 text-[10px] text-ink/50">Sugerida automaticamente no formulário.</p>
                  </div>

                  <div>
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold">CBO Padrão</Label>
                      {form.cbo_padrao && (
                        <button
                          type="button"
                          onClick={() => setForm({ ...form, cbo_padrao: "" })}
                          className="text-[10px] text-ink/45 hover:text-red-600"
                        >
                          Limpar
                        </button>
                      )}
                    </div>
                    <Input
                      value={form.cbo_padrao}
                      onChange={(e) => setForm({ ...form, cbo_padrao: e.target.value })}
                      placeholder="Ex: 225120"
                      className="mt-1 font-mono text-xs"
                    />
                    <p className="mt-0.5 text-[10px] text-ink/50">Código do CBO correspondente à especialidade padrão.</p>
                  </div>
                </div>
              </div>

              {/* Bloco 3: Vínculos com SIGTAP e Busca */}
              <div className="bg-sand/30 p-4 rounded-xl border border-sus-900/10 space-y-3">
                <h4 className="text-xs font-bold text-sus-950 uppercase tracking-wider flex items-center gap-1.5">
                  <Tag className="h-4 w-4 text-teal" /> 3. Vínculos com SIGTAP e Atalhos de Busca
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold">Prefixos SIGTAP Permitidos</Label>
                      {form.prefixos_sigtap && (
                        <button
                          type="button"
                          onClick={() => setForm({ ...form, prefixos_sigtap: "" })}
                          className="text-[10px] text-ink/45 hover:text-red-600"
                        >
                          Limpar
                        </button>
                      )}
                    </div>
                    <Input
                      value={form.prefixos_sigtap}
                      onChange={(e) => setForm({ ...form, prefixos_sigtap: e.target.value })}
                      placeholder="Ex: 021102, 020501, 0406"
                      className="mt-1 font-mono text-xs"
                    />
                    <p className="mt-0.5 text-[10px] text-ink/50">Códigos ou prefixos do SIGTAP separados por vírgula.</p>
                  </div>

                  <div>
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold">Prefixos SIGTAP a Excluir</Label>
                      {form.excluir_prefixos_sigtap && (
                        <button
                          type="button"
                          onClick={() => setForm({ ...form, excluir_prefixos_sigtap: "" })}
                          className="text-[10px] text-ink/45 hover:text-red-600"
                        >
                          Limpar
                        </button>
                      )}
                    </div>
                    <Input
                      value={form.excluir_prefixos_sigtap}
                      onChange={(e) => setForm({ ...form, excluir_prefixos_sigtap: e.target.value })}
                      placeholder="Ex: 0202 (não trazer exames de sangue)"
                      className="mt-1 font-mono text-xs"
                    />
                    <p className="mt-0.5 text-[10px] text-ink/50">Prefixos a ignorar na busca de procedimentos.</p>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold">Sinônimos e Apelidos de Busca</Label>
                    {form.sinonimos && (
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, sinonimos: "" })}
                        className="text-[10px] text-ink/45 hover:text-red-600"
                      >
                        Limpar
                      </button>
                    )}
                  </div>
                  <Input
                    value={form.sinonimos}
                    onChange={(e) => setForm({ ...form, sinonimos: e.target.value })}
                    placeholder="Ex: CARD, CARDIO, CARDIOLOGIA, ECG, ECO, HOLTER, MAPA"
                    className="mt-1 text-xs"
                  />
                  <p className="mt-0.5 text-[10px] text-ink/50">
                    Termos que os operadores digitam para localizar este tipo de serviço e seus exames.
                  </p>
                </div>

                <div>
                  <Label className="text-xs font-semibold">Orientações Operacionais / Descrição das Regras</Label>
                  <textarea
                    value={form.descricao_regras}
                    onChange={(e) => setForm({ ...form, descricao_regras: e.target.value })}
                    placeholder="Instruções e diretrizes de atendimento exibidas aos operadores..."
                    rows={2}
                    className="mt-1 w-full rounded-xl border border-sus-900/20 bg-white p-2 text-xs focus:border-teal focus:outline-hidden"
                  />
                </div>
              </div>

              {/* Bloco 4: Médicos e Unidades Liberadas para esta Fila */}
              <div className="bg-purple-50/40 p-4 rounded-xl border border-purple-200/70 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-xs font-bold text-sus-950 uppercase tracking-wider flex items-center gap-1.5">
                    <Building2 className="h-4 w-4 text-purple-700" /> 4. Médicos e Unidades Liberadas
                  </h4>
                  <span className="text-[11px] font-semibold text-purple-800 bg-purple-100/70 px-2 py-0.5 rounded-md">
                    {form.unidades_permitidas.length === 0 ? "Todas as unidades" : `${form.unidades_permitidas.length} unidade(s)`} ·{" "}
                    {form.medicos_permitidos.length === 0 ? "Todos os médicos" : `${form.medicos_permitidos.length} médico(s)`}
                  </span>
                </div>
                <p className="text-[11px] text-ink/70">
                  Selecione quais unidades de saúde e quais médicos podem lançar nesta fila (ideal para filas de exames de sangue). Deixar vazio libera para todas as unidades ou todos os médicos ativos.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Unidades Liberadas */}
                  <div className="rounded-xl border border-sus-900/10 bg-white p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="!mb-0 text-xs font-bold text-sus-950">Unidades Liberadas</Label>
                      {form.unidades_permitidas.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setForm({ ...form, unidades_permitidas: [] })}
                          className="text-[10px] font-semibold text-red-600 hover:underline"
                        >
                          Liberar todas
                        </button>
                      )}
                    </div>
                    <Input
                      value={buscaUnidadeRegra}
                      onChange={(e) => setBuscaUnidadeRegra(e.target.value)}
                      placeholder="Filtrar unidade ou CNES…"
                      className="text-xs !h-8"
                    />
                    <div className="max-h-36 overflow-y-auto divide-y divide-sus-900/5 text-xs">
                      {unidadesSistema
                        .filter((u) => {
                          const t = buscaUnidadeRegra.trim().toLowerCase();
                          return !t || u.nome.toLowerCase().includes(t) || (u.cnes || "").includes(t);
                        })
                        .map((u) => {
                          const checked = form.unidades_permitidas.includes(u.id);
                          return (
                            <label key={u.id} className="flex items-center gap-2 py-1.5 px-1 cursor-pointer hover:bg-sand/40 rounded">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() =>
                                  setForm((prev) => ({
                                    ...prev,
                                    unidades_permitidas: checked
                                      ? prev.unidades_permitidas.filter((id) => id !== u.id)
                                      : [...prev.unidades_permitidas, u.id],
                                  }))
                                }
                                className="rounded border-sus-900/20 text-teal focus:ring-teal"
                              />
                              <span className="flex-1 truncate font-medium text-sus-950">{u.nome}</span>
                            </label>
                          );
                        })}
                    </div>
                  </div>

                  {/* Médicos Liberados */}
                  <div className="rounded-xl border border-sus-900/10 bg-white p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="!mb-0 text-xs font-bold text-sus-950">Médicos Liberados</Label>
                      {form.medicos_permitidos.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setForm({ ...form, medicos_permitidos: [] })}
                          className="text-[10px] font-semibold text-red-600 hover:underline"
                        >
                          Liberar todos
                        </button>
                      )}
                    </div>
                    <Input
                      value={buscaMedicoRegra}
                      onChange={(e) => setBuscaMedicoRegra(e.target.value)}
                      placeholder="Filtrar médico, CRM, CBO ou especialidade…"
                      className="text-xs !h-8"
                    />
                    <div className="max-h-36 overflow-y-auto divide-y divide-sus-900/5 text-xs">
                      {medicosSistema
                        .filter((m) => {
                          const t = buscaMedicoRegra.trim().toLowerCase();
                          if (!t) return true;
                          return (
                            m.nome.toLowerCase().includes(t) ||
                            (m.crm || "").toLowerCase().includes(t) ||
                            (m.cbo_codigo || "").toLowerCase().includes(t) ||
                            (m.especialidade || "").toLowerCase().includes(t) ||
                            (m.especialidades || "").toLowerCase().includes(t)
                          );
                        })
                        .map((m) => {
                          const checked = form.medicos_permitidos.includes(m.id);
                          const sub = formatarSubMedico(m);
                          return (
                            <label key={m.id} className="flex items-start gap-2 py-1.5 px-1 cursor-pointer hover:bg-sand/40 rounded">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() =>
                                  setForm((prev) => ({
                                    ...prev,
                                    medicos_permitidos: checked
                                      ? prev.medicos_permitidos.filter((id) => id !== m.id)
                                      : [...prev.medicos_permitidos, m.id],
                                  }))
                                }
                                className="mt-0.5 rounded border-sus-900/20 text-teal focus:ring-teal"
                              />
                              <span className="flex-1 min-w-0">
                                <span className="block truncate font-semibold text-sus-950">{m.nome}</span>
                                {sub && <span className="block truncate text-[10px] text-ink/60">{sub}</span>}
                              </span>
                            </label>
                          );
                        })}
                    </div>
                  </div>
                </div>
              </div>

              {/* Botões do Rodapé */}
              <div className="flex justify-end gap-2 border-t border-sus-900/10 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setModalAberto(false)}
                  className="text-xs"
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={salvando}
                  className="bg-teal hover:bg-teal-700 text-white text-xs gap-1.5"
                >
                  {salvando ? "Salvando..." : filaEdicao ? "Atualizar Regras" : "Criar Tipo de Serviço"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
