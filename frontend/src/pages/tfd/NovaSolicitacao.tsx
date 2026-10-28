import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock,
  FlaskConical,
  Layers,
  ListOrdered,
  Plus,
  Printer,
  RotateCcw,
  Search,
  Sparkles,
  Stethoscope,
  Trash2,
  User,
  X,
} from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import {
  fetchMedicos,
  fetchUnidadesSaude,
  tfdCatalogoExames,
  tfdCriarExame,
  tfdTipos,
  tfdEspecialidades,
  tfdBuscarCids,
  labSigtap,
  pagData,
  type CatalogoProc,
  type EspecialidadeCat,
  type Exame,
  type Medico,
  type Paciente,
  type SigtapCidItem,
  type SigtapProc,
  type TipoFila,
  type UnidadeSaude,
} from "../../services/api";
import { Button, Card, Input, Label } from "../../components/ui/primitives";
import { Combobox } from "../../components/ui/combobox";
import BuscaPacienteAutocomplete from "../../components/BuscaPacienteAutocomplete";
import BotaoWhatsApp from "../../components/BotaoWhatsApp";
import ComprovanteExameModal from "../../components/ComprovanteExameModal";

function hojeISO(): string {
  return new Date().toISOString().slice(0, 10);
}

const JUST_MIN = 12;
const MEDICO_GENERICO = "Médico da Unidade / Responsável Técnico";

export default function NovaSolicitacao() {
  const navigate = useNavigate();
  const { user, isTfdCentral, isLancamentoRestrito } = useAuth();

  // Estados dos Catálogos
  const [tiposFila, setTiposFila] = useState<TipoFila[]>([]);
  const [procedimentosTodos, setProcedimentosTodos] = useState<CatalogoProc[]>([]);
  const [procedimentosFiltrados, setProcedimentosFiltrados] = useState<CatalogoProc[]>([]);
  const [medicos, setMedicos] = useState<Medico[]>([]);
  const [unidades, setUnidades] = useState<UnidadeSaude[]>([]);
  const [carregandoCatalogos, setCarregandoCatalogos] = useState(true);

  // Seleções do Formulário
  const [pacienteSelecionado, setPacienteSelecionado] = useState<Paciente | null>(null);

  // Hierarquia: 1º Tipo de Serviço -> 2º Procedimento
  const [tipoServico, setTipoServico] = useState("");
  const [procedimentoSel, setProcedimentoSel] = useState<CatalogoProc | null>(null);
  const [procTexto, setProcTexto] = useState("");
  const [buscaProc, setBuscaProc] = useState("");
  const [procFoco, setProcFoco] = useState(false);
  const [codigoProcedimento, setCodigoProcedimento] = useState("");
  const [especialidade, setEspecialidade] = useState("");
  const [codigoEspecialidade, setCodigoEspecialidade] = useState("");

  // Origem e Data
  const [unidadeId, setUnidadeId] = useState<string>("");
  const [medicoId, setMedicoId] = useState<string>("");
  const [dataPedido, setDataPedido] = useState<string>(hojeISO());

  // Dados Clínicos
  const [prioridade, setPrioridade] = useState<"rotina" | "urgente">("rotina");
  const [justificativa, setJustificativa] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [numeroPedido, setNumeroPedido] = useState("");
  const [cidCodigo, setCidCodigo] = useState("");
  const [cidDescricao, setCidDescricao] = useState("");
  const [buscaCid, setBuscaCid] = useState("");
  const [cidsSugeridos, setCidsSugeridos] = useState<SigtapCidItem[]>([]);
  const [buscandoCid, setBuscandoCid] = useState(false);

  useEffect(() => {
    if (!buscaCid || buscaCid.trim().length < 1) {
      setCidsSugeridos([]);
      return;
    }
    const t = setTimeout(() => {
      setBuscandoCid(true);
      tfdBuscarCids(buscaCid.trim())
        .then(setCidsSugeridos)
        .catch(() => setCidsSugeridos([]))
        .finally(() => setBuscandoCid(false));
    }, 250);
    return () => clearTimeout(t);
  }, [buscaCid]);

  // Agendamento Direto (Apenas TFD Central)
  const [agendamentoDireto, setAgendamentoDireto] = useState(false);
  const [dataAgendada, setDataAgendada] = useState("");
  const [horaAgendada, setHoraAgendada] = useState("08:00");

  // Feedback e Controle
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [criado, setCriado] = useState<Exame | null>(null);
  const [abrirComprovante, setAbrirComprovante] = useState(false);
  const [modalConfirmacao, setModalConfirmacao] = useState(false);
  const [procedimentosAdicionados, setProcedimentosAdicionados] = useState<{
    codigo: string;
    nome: string;
    especialidade?: string;
    codigo_especialidade?: string;
    tipo_fila: string;
  }[]>([]);

  const [especialidadesCadastradas, setEspecialidadesCadastradas] = useState<EspecialidadeCat[]>([]);
  const [procedimentosDinamicos, setProcedimentosDinamicos] = useState<CatalogoProc[]>([]);
  const [buscandoProc, setBuscandoProc] = useState(false);

  // Inicializa dados e permissões padrão
  useEffect(() => {
    let cancelado = false;
    Promise.all([
      tfdTipos().catch(() => []),
      tfdCatalogoExames().catch(() => []),
      tfdEspecialidades({ limit: 500, ativos: true }).catch(() => ({ data: [] })),
      fetchMedicos().catch(() => []),
      fetchUnidadesSaude().catch(() => []),
    ]).then(([resTipos, resProcs, resEsps, resMeds, resUnis]) => {
      if (cancelado) return;
      const tipos = pagData<TipoFila>(resTipos).filter((t) => t.ativo);
      setTiposFila(tipos);
      const procs = (resProcs as CatalogoProc[]) || [];
      setProcedimentosTodos(procs);
      const esps = pagData<EspecialidadeCat>(resEsps).filter((e) => e.ativo);
      setEspecialidadesCadastradas(esps);
      setMedicos(resMeds.filter((m) => m.ativo));
      setUnidades(resUnis.filter((u) => u.ativo));

      // Unidade padrão: se usuário PSF tem unidade vinculada
      if (user?.unidade_saude_id) {
        setUnidadeId(String(user.unidade_saude_id));
      } else if (resUnis.length > 0) {
        setUnidadeId(String(resUnis[0].id));
      }

      // Médico padrão: Médico da Unidade
      const medGen = resMeds.find(
        (m) => m.nome.includes("Responsável Técnico") || m.nome.includes("Médico da Unidade"),
      );
      if (medGen) {
        setMedicoId(String(medGen.id));
      }

      setCarregandoCatalogos(false);
    });

    return () => {
      cancelado = true;
    };
  }, [user]);

  // Se o usuário não for TFD Central, força data no dia atual e unidade no seu PSF
  useEffect(() => {
    if (!isTfdCentral) {
      setDataPedido(hojeISO());
      if (user?.unidade_saude_id) {
        setUnidadeId(String(user.unidade_saude_id));
      }
      setAgendamentoDireto(false);
    }
  }, [isTfdCentral, user]);

  // Regra 3: Hierarquia de Seleção (Serviço -> Procedimento)
  useEffect(() => {
    if (!tipoServico) {
      setProcedimentosFiltrados(procedimentosTodos);
      return;
    }
    const tNorm = tipoServico.trim().toLowerCase();
    const filtrados = procedimentosTodos.filter(
      (p) => (p.tipo_fila || "").toLowerCase() === tNorm || (p.tipo_fila || "").toLowerCase().includes(tNorm),
    );
    setProcedimentosFiltrados(filtrados.length > 0 ? filtrados : procedimentosTodos);

    // Se o procedimento atual não pertencer ao novo serviço selecionado, limpa-o
    if (procedimentoSel && (procedimentoSel.tipo_fila || "").toLowerCase() !== tNorm) {
      setProcedimentoSel(null);
      setProcTexto("");
      setCodigoProcedimento("");
    }
  }, [tipoServico, procedimentosTodos, procedimentoSel]);

  // Busca inteligente via API quando o operador digita no campo de procedimento
  useEffect(() => {
    const termo = buscaProc.trim();
    if (!termo || termo.length < 2) {
      setProcedimentosDinamicos([]);
      setBuscandoProc(false);
      return;
    }
    setBuscandoProc(true);
    const t = setTimeout(() => {
      tfdCatalogoExames(termo, tipoServico || undefined, undefined, especialidade || undefined)
        .then((res) => {
          setProcedimentosDinamicos(res || []);
        })
        .catch(() => setProcedimentosDinamicos([]))
        .finally(() => setBuscandoProc(false));
    }, 200);
    return () => clearTimeout(t);
  }, [buscaProc, tipoServico, especialidade]);

  // Filtro inteligente de procedimentos: busca por nome, código SIGTAP, código curto, especialidade
  const opcoesProcFiltradas = useMemo(() => {
    let base = tipoServico ? procedimentosFiltrados : procedimentosTodos;
    if (especialidade) {
      const espNorm = especialidade.trim().toLowerCase();
      const filtradosPorEsp = base.filter(
        (p) =>
          (p.especialidade || p.nome_especialidade || "").toLowerCase().includes(espNorm) ||
          (p.codigo_especialidade || "").toLowerCase().includes(espNorm),
      );
      if (filtradosPorEsp.length > 0) {
        base = filtradosPorEsp;
      }
    }

    const t = buscaProc.trim().toLowerCase();
    if (!t) return base.slice(0, 60);

    const locais = base.filter((p) => {
      const txt = `${p.codigo_curto || ""} ${p.codigo_procedimento || ""} ${p.exame || p.nome_procedimento || ""} ${p.especialidade || p.nome_especialidade || ""} ${p.tipo_fila || ""}`.toLowerCase();
      return txt.includes(t);
    });

    const mapaProcs = new Map<string, CatalogoProc>();
    for (const p of locais) {
      const k = p.codigo_procedimento || p.exame || p.nome_procedimento;
      if (k) mapaProcs.set(k, p);
    }
    for (const p of procedimentosDinamicos) {
      const k = p.codigo_procedimento || p.exame || p.nome_procedimento;
      if (k && !mapaProcs.has(k)) mapaProcs.set(k, p);
    }
    return Array.from(mapaProcs.values()).slice(0, 60);
  }, [buscaProc, procedimentosFiltrados, procedimentosTodos, tipoServico, especialidade, procedimentosDinamicos]);

  function escolherProcedimento(p: CatalogoProc) {
    handleSelecionarProcedimento(p);
    if (p.tipo_fila && (!tipoServico || tipoServico !== p.tipo_fila)) {
      setTipoServico(p.tipo_fila);
    }
    setBuscaProc("");
    setProcFoco(false);
  }

  function handleSelecionarProcedimento(p: CatalogoProc | null) {
    setProcedimentoSel(p);
    if (p) {
      setProcTexto(p.exame || p.nome_procedimento || "");
      setCodigoProcedimento(p.codigo_procedimento || "");
      if (p.especialidade || p.nome_especialidade) {
        setEspecialidade(p.especialidade || p.nome_especialidade || "");
      }
      if (p.codigo_especialidade) {
        setCodigoEspecialidade(p.codigo_especialidade);
      }
      if (p.tipo_fila && !tipoServico) {
        setTipoServico(p.tipo_fila);
      }
    } else {
      setProcTexto("");
      setCodigoProcedimento("");
    }
  }

  function adicionarProcedimentoLista() {
    const nome = procTexto.trim() || procedimentoSel?.exame || "";
    if (nome.length < 2) return;
    if (procedimentosAdicionados.some((p) => p.nome === nome || (p.codigo && p.codigo === codigoProcedimento))) {
      return;
    }
    setProcedimentosAdicionados([
      ...procedimentosAdicionados,
      {
        codigo: codigoProcedimento,
        nome,
        especialidade,
        codigo_especialidade: codigoEspecialidade,
        tipo_fila: tipoServico,
      },
    ]);
    setProcedimentoSel(null);
    setProcTexto("");
    setCodigoProcedimento("");
  }

  // SIGTAP para Exames Laboratoriais
  const isLaboratorial = useMemo(() => {
    const t = (tipoServico || "").toUpperCase();
    return t.includes("LABORAT") || t.includes("SANGUE");
  }, [tipoServico]);
  const [buscaSig, setBuscaSig] = useState("");
  const [sigtapResultados, setSigtapResultados] = useState<SigtapProc[]>([]);
  const [buscandoSig, setBuscandoSig] = useState(false);

  useEffect(() => {
    if (!isLaboratorial) {
      setSigtapResultados([]);
      return;
    }
    setBuscandoSig(true);
    const t = setTimeout(() => {
      labSigtap(buscaSig.trim() || undefined)
        .then((r) => setSigtapResultados(pagData<SigtapProc>(r)))
        .catch(() => setSigtapResultados([]))
        .finally(() => setBuscandoSig(false));
    }, 250);
    return () => clearTimeout(t);
  }, [buscaSig, isLaboratorial]);

  function adicionarSigtapItem(s: SigtapProc) {
    if (procedimentosAdicionados.some((p) => p.codigo === s.codigo || p.nome === s.descricao)) {
      return;
    }
    setProcedimentosAdicionados([
      ...procedimentosAdicionados,
      {
        codigo: s.codigo,
        nome: s.descricao,
        especialidade: "PATOLOGIA CLINICA",
        codigo_especialidade: "0202",
        tipo_fila: "EXAMES LABORATORIAIS",
      },
    ]);
    setCodigoProcedimento(s.codigo);
    setProcTexto(s.descricao);
    setEspecialidade("PATOLOGIA CLINICA");
  }

  function removerProcedimentoLista(index: number) {
    setProcedimentosAdicionados(procedimentosAdicionados.filter((_, idx) => idx !== index));
  }

  function limparFormulario() {
    setPacienteSelecionado(null);
    setTipoServico("");
    setProcedimentoSel(null);
    setProcTexto("");
    setCodigoProcedimento("");
    setEspecialidade("");
    setCodigoEspecialidade("");
    setJustificativa("");
    setObservacoes("");
    setNumeroPedido("");
    setCidCodigo("");
    setCidDescricao("");
    setBuscaCid("");
    setCidsSugeridos([]);
    setPrioridade("rotina");
    setProcedimentosAdicionados([]);
    setCriado(null);
    setErro("");
    setAbrirComprovante(false);
    if (!isTfdCentral) {
      setDataPedido(hojeISO());
      if (user?.unidade_saude_id) setUnidadeId(String(user.unidade_saude_id));
    }
  }

  function obterListaFinalProcs() {
    const listaFinalProcs = [...procedimentosAdicionados];
    const nomeProcAtual = procTexto.trim() || procedimentoSel?.exame || "";
    if (nomeProcAtual.length >= 2) {
      if (!listaFinalProcs.some((p) => p.nome === nomeProcAtual || (p.codigo && p.codigo === codigoProcedimento))) {
        listaFinalProcs.push({
          codigo: codigoProcedimento,
          nome: nomeProcAtual,
          especialidade: especialidade.trim(),
          codigo_especialidade: codigoEspecialidade.trim(),
          tipo_fila: tipoServico,
        });
      }
    }
    return listaFinalProcs;
  }

  function submeter(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    setCriado(null);

    if (!pacienteSelecionado?.id) {
      setErro("Selecione um paciente para a solicitação.");
      return;
    }
    if (!tipoServico) {
      setErro("Selecione o Tipo de Serviço da solicitação.");
      return;
    }

    const listaFinalProcs = obterListaFinalProcs();
    if (listaFinalProcs.length === 0) {
      setErro("Informe pelo menos um procedimento ou exame a ser realizado.");
      return;
    }

    if (!unidadeId) {
      setErro("Selecione a Unidade Solicitante / PSF.");
      return;
    }

    if (!medicoId) {
      setErro("Selecione o(a) Médico(a) Requisitante.");
      return;
    }

    if (!justificativa.trim() || justificativa.trim().length < JUST_MIN) {
      setErro(`A Justificativa Clínica é obrigatória e deve conter no mínimo ${JUST_MIN} caracteres.`);
      return;
    }

    if (agendamentoDireto && (!dataAgendada || !unidadeId || !medicoId)) {
      setErro("Para agendamento direto, informe a data agendada, unidade e médico.");
      return;
    }

    // Abre a tela de confirmação antes de gravar no banco de dados
    setModalConfirmacao(true);
  }

  async function confirmarGravacaoDefinitiva() {
    setSalvando(true);
    setErro("");
    try {
      const listaFinalProcs = obterListaFinalProcs();
      const numPedidoEfetivo =
        numeroPedido.trim() ||
        `PED-${hojeISO().replace(/-/g, "")}-${Math.floor(100000 + Math.random() * 900000)}`;

      let primeiroCriado: Exame | null = null;

      for (const proc of listaFinalProcs) {
        const payload: Record<string, unknown> = {
          paciente_id: pacienteSelecionado!.id,
          paciente_nome: pacienteSelecionado!.nome,
          tipo_fila: proc.tipo_fila || tipoServico,
          exame: proc.codigo ? `${proc.codigo} · ${proc.nome}` : proc.nome,
          codigo_procedimento: proc.codigo || undefined,
          especialidade: proc.especialidade || especialidade.trim() || undefined,
          codigo_especialidade: proc.codigo_especialidade || codigoEspecialidade.trim() || undefined,
          unidade_saude_id: unidadeId ? Number(unidadeId) : undefined,
          medico_id: medicoId ? Number(medicoId) : undefined,
          data_pedido: isTfdCentral ? dataPedido : hojeISO(),
          prioridade: isLancamentoRestrito ? "rotina" : prioridade,
          justificativa: justificativa.trim(),
          cid_codigo: cidCodigo || undefined,
          cid_descricao: cidDescricao || undefined,
          observacoes: observacoes.trim() || undefined,
          numero_pedido: numPedidoEfetivo,
        };

        if (agendamentoDireto && isTfdCentral) {
          payload.data_agendada = dataAgendada;
          payload.hora_agendada = horaAgendada;
          payload.status = "agendado";
        } else {
          payload.status = "aguardando";
        }

        const res = await tfdCriarExame(payload);
        if (!primeiroCriado) primeiroCriado = res;
      }

      setModalConfirmacao(false);
      setCriado(primeiroCriado);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : null;
      setErro(msg || "Falha ao cadastrar solicitação. Verifique os dados informados.");
      setModalConfirmacao(false);
    } finally {
      setSalvando(false);
    }
  }

  const opcoesUnidades = useMemo(
    () =>
      unidades.map((u) => ({
        value: String(u.id),
        label: u.nome,
        sub: u.cnes ? `CNES ${u.cnes}` : undefined,
        keywords: `${u.nome} ${u.cnes || ""}`,
      })),
    [unidades],
  );

  const opcoesMedicos = useMemo(
    () =>
      medicos.map((m) => ({
        value: String(m.id),
        label: m.nome,
        sub: m.crm ? `CRM ${m.crm}` : undefined,
        keywords: `${m.nome} ${m.crm || ""}`,
      })),
    [medicos],
  );

  const opcoesEspecialidades = useMemo(() => {
    const mapa = new Map<string, { nome: string; cbo?: string }>();
    // 1. Especialidades cadastradas e oficiais na base
    for (const e of especialidadesCadastradas) {
      const nome = (e.nome || "").trim();
      if (nome && !mapa.has(nome)) {
        mapa.set(nome, { nome, cbo: e.codigo_cbo });
      }
    }
    // 2. Especialidades complementares presentes no catálogo de procedimentos
    for (const p of procedimentosTodos) {
      const esp = (p.especialidade || p.nome_especialidade || "").trim();
      if (esp && !mapa.has(esp)) {
        mapa.set(esp, { nome: esp, cbo: p.codigo_especialidade });
      }
    }
    return Array.from(mapa.values())
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
      .map((e) => ({
        value: e.nome,
        label: e.nome,
        sub: e.cbo ? `CBO ${e.cbo}` : undefined,
        keywords: `${e.nome} ${e.cbo || ""}`,
      }));
  }, [especialidadesCadastradas, procedimentosTodos]);

  const unidNomeAtual = useMemo(() => {
    const u = unidades.find((x) => String(x.id) === String(unidadeId));
    return u?.nome || user?.unidade_saude_nome || "Unidade não vinculada";
  }, [unidades, unidadeId, user]);

  const medNomeAtual = useMemo(() => {
    const m = medicos.find((x) => String(x.id) === String(medicoId));
    return m?.nome || (m?.crm ? `Dr(a). CRM ${m.crm}` : "Médico da Unidade");
  }, [medicos, medicoId]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-16">
      {/* Breadcrumb e Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-xs text-ink/60 mb-1">
            <Link to="/fila-exames" className="hover:text-sus-900 transition font-medium">
              Solicitações
            </Link>
            <ChevronRight className="h-3 w-3" />
            <span className="font-semibold text-sus-950">Nova Solicitação</span>
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-sus-950 flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-teal" />
            Lançamento de Nova Solicitação
          </h1>
          <p className="text-xs text-ink/60">
            Cadastre novos pedidos regulados para a fila de espera ou agendamento direto com validação instantânea.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link to="/fila-exames">
            <Button variant="outline" className="text-xs">
              <ListOrdered className="h-4 w-4" /> Ver Fila de Espera
            </Button>
          </Link>
          <Link to="/tfd/agendamentos">
            <Button variant="outline" className="text-xs">
              <Calendar className="h-4 w-4" /> Agenda e Recepção
            </Button>
          </Link>
        </div>
      </div>

      {/* Banner de Sucesso pós-criação */}
      {criado && (
        <Card className="border-2 border-emerald-500 bg-emerald-50/60 p-5 shadow-sm">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-7 w-7 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-display text-base font-bold text-emerald-950">
                  Solicitação cadastrada com sucesso!
                </p>
                <p className="text-xs text-emerald-800 mt-0.5">
                  Identificador do pedido:{" "}
                  <strong className="font-mono bg-emerald-200/70 px-1.5 py-0.5 rounded text-emerald-950">
                    {criado.codigo_curto || `EX-${criado.id}`}
                  </strong>{" "}
                  · Paciente: <strong>{criado.paciente_nome}</strong>
                </p>
                <p className="text-xs text-emerald-700 mt-1">
                  Status atual:{" "}
                  <span className="font-bold uppercase tracking-wider text-[11px] bg-white px-2 py-0.5 rounded border border-emerald-300">
                    {criado.status === "agendado" ? "📅 Agendado Direto" : "⏳ Na Fila de Espera"}
                  </span>
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
              <BotaoWhatsApp
                exameId={criado.id}
                exame={criado}
                tipo={criado.status === "agendado" ? "agendamento" : "entrada_fila"}
                variante="completo"
              />
              <Button
                type="button"
                onClick={() => setAbrirComprovante(true)}
                variant="outline"
                className="border-emerald-600 text-emerald-800 hover:bg-emerald-100 text-xs font-semibold flex items-center gap-1.5 !h-9"
              >
                <Printer className="h-4 w-4" /> Comprovante com QR Code
              </Button>
              <Button
                onClick={limparFormulario}
                className="bg-emerald-700 hover:bg-emerald-800 text-white text-xs"
              >
                <Plus className="h-4 w-4" /> Lançar Outra Solicitação
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate("/fila-exames")}
                className="border-emerald-600 text-emerald-800 hover:bg-emerald-100 text-xs"
              >
                Ir para Fila
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Alerta de Erro */}
      {erro && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-800">
          <AlertCircle className="h-5 w-5 shrink-0 text-red-600" />
          <span>{erro}</span>
        </div>
      )}

      {/* Formulário Principal com Prevenção de Enter */}
      <form
        onSubmit={submeter}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA") {
            e.preventDefault();
          }
        }}
        className="space-y-6"
      >
        {/* Bloco 1: Identificação do Paciente (Primeiro Campo) */}
        <Card className="p-5 shadow-xs">
          <div className="flex items-center justify-between border-b border-sus-900/10 pb-3 mb-4">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-teal" />
              <h2 className="font-display text-sm font-bold text-sus-950">
                1. Identificação do Paciente
              </h2>
            </div>
            <span className="text-[11px] font-semibold text-teal bg-teal/10 px-2.5 py-0.5 rounded-full">
              Primeiro Passo Obrigatório
            </span>
          </div>

          <BuscaPacienteAutocomplete
            pacienteId={pacienteSelecionado?.id || ""}
            pacienteInicial={pacienteSelecionado}
            onSelect={(p) => setPacienteSelecionado(p)}
            label="Paciente Solicitante"
            placeholder="Digite o nome, CPF, CNS ou número do prontuário para pesquisar…"
            obrigatorio
          />

          {pacienteSelecionado && (
            <div className="mt-3 rounded-xl border border-sus-900/10 bg-sand/30 p-3 text-xs flex flex-wrap gap-x-6 gap-y-1">
              <div>
                <span className="text-ink/60">CPF:</span>{" "}
                <strong className="text-sus-950 font-mono">
                  {pacienteSelecionado.cpf || "Não informado"}
                </strong>
              </div>
              <div>
                <span className="text-ink/60">Cartão SUS (CNS):</span>{" "}
                <strong className="text-sus-950 font-mono">
                  {pacienteSelecionado.cns || "Não informado"}
                </strong>
              </div>
              <div>
                <span className="text-ink/60">Prontuário:</span>{" "}
                <strong className="text-sus-950 font-mono">
                  {pacienteSelecionado.codigo_prontuario?.replace(/^PR-0*/, "") || pacienteSelecionado.id || "—"}
                </strong>
              </div>
              {pacienteSelecionado.municipio && (
                <div>
                  <span className="text-ink/60">Município:</span>{" "}
                  <strong className="text-sus-950">{pacienteSelecionado.municipio}</strong>
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Bloco 2: Data do Pedido, Procedimento Correspondente e Especialidade */}
        <Card className="p-5 shadow-xs">
          <div className="flex items-center justify-between border-b border-sus-900/10 pb-3 mb-4">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-teal" />
              <h2 className="font-display text-sm font-bold text-sus-950">
                2. Data do Pedido, Procedimento Correspondente e Especialidade
              </h2>
            </div>
          </div>

          {/* 2.1 Data do Pedido */}
          <div className="mb-4 rounded-xl border border-sus-900/10 bg-sand/20 p-3.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <Label className="text-xs font-bold text-sus-950">
                  Data do Pedido / Solicitação <span className="text-red-500">*</span>
                </Label>
                <p className="text-[11px] text-ink/60">
                  Data constante no pedido médico ou encaminhamento do paciente.
                </p>
              </div>
              <div className="w-full sm:w-64">
                {isTfdCentral ? (
                  <Input
                    type="date"
                    value={dataPedido}
                    onChange={(e) => setDataPedido(e.target.value)}
                    className="h-10 text-xs font-semibold"
                    required
                  />
                ) : (
                  <div>
                    <Input
                      type="date"
                      value={hojeISO()}
                      disabled
                      className="h-10 bg-sand/40 font-semibold text-sus-950 cursor-not-allowed text-xs"
                    />
                    <span className="block mt-0.5 text-[10px] text-amber-800 font-medium">
                      Operadores de PSF: lançamento para a data atual.
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 2.2 Seleção de Serviço e Especialidade */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Passo 1: Tipo de Serviço */}
            <div>
              <Label className="text-xs font-bold text-sus-950">
                Tipo de Serviço <span className="text-red-500">*</span>
              </Label>
              <select
                value={tipoServico}
                onChange={(e) => setTipoServico(e.target.value)}
                className="mt-1 w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-xs font-semibold text-sus-950 outline-none transition focus:border-teal focus:ring-2 focus:ring-teal/20"
                required
              >
                <option value="">Selecione o Tipo de Serviço…</option>
                {tiposFila.map((tf) => (
                  <option key={tf.id} value={tf.nome}>
                    {tf.nome}
                  </option>
                ))}
                {!tiposFila.some((t) => t.nome === "CONSULTAS ESPECIALIZADAS") && (
                  <option value="CONSULTAS ESPECIALIZADAS">CONSULTAS ESPECIALIZADAS</option>
                )}
                {!tiposFila.some((t) => t.nome === "ULTRASSONOGRAFIA") && (
                  <option value="ULTRASSONOGRAFIA">ULTRASSONOGRAFIA</option>
                )}
                {!tiposFila.some((t) => t.nome === "EXAMES LABORATORIAIS") && (
                  <option value="EXAMES LABORATORIAIS">EXAMES LABORATORIAIS</option>
                )}
              </select>
              <p className="mt-1 text-[11px] text-ink/60">
                Filtra automaticamente o catálogo de procedimentos e exames correspondentes.
              </p>
            </div>

            {/* Especialidade Médica */}
            <div>
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold text-sus-950">
                  Especialidade Médica
                </Label>
                {especialidade && (
                  <button
                    type="button"
                    onClick={() => {
                      setEspecialidade("");
                      setCodigoEspecialidade("");
                    }}
                    className="text-[10px] text-red-600 font-semibold hover:underline"
                  >
                    Limpar
                  </button>
                )}
              </div>
              <div className="mt-1">
                <Combobox
                  value={especialidade}
                  onChange={(v) => {
                    setEspecialidade(v);
                    const opt = opcoesEspecialidades.find((o) => o.value === v);
                    if (opt?.sub) {
                      const cboMatch = opt.sub.match(/\d+/);
                      if (cboMatch) setCodigoEspecialidade(cboMatch[0]);
                    }
                    const it = procedimentosTodos.find((p) => (p.especialidade || p.nome_especialidade) === v);
                    if (it?.codigo_especialidade) setCodigoEspecialidade(it.codigo_especialidade);
                  }}
                  options={opcoesEspecialidades}
                  placeholder="Buscar ou selecionar especialidade médica…"
                  searchPlaceholder="Digite o nome da especialidade ou CBO…"
                  emptyText="Nenhuma especialidade encontrada"
                  showAll={false}
                />
              </div>
              <p className="mt-1 text-[11px] text-ink/60">
                Preenchida automaticamente ao selecionar o procedimento correspondente.
              </p>
            </div>
          </div>

          {/* Passo 2: Procedimento Correspondente com Busca Inteligente */}
          <div className="mt-4 pt-4 border-t border-sus-900/10">
            <Label className="text-xs font-bold text-sus-950 flex items-center justify-between">
              <span>Procedimento Correspondente <span className="text-red-500">*</span></span>
              {isLaboratorial && (
                <span className="text-[10px] text-teal font-semibold flex items-center gap-1">
                  <FlaskConical className="h-3 w-3" /> Tabela SIGTAP Laboratorial
                </span>
              )}
            </Label>

            {isLaboratorial ? (
              <div className="mt-1 space-y-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink/40" />
                  <Input
                    placeholder="Buscar exame laboratorial (ex: hemograma, glicose, EAS)..."
                    value={buscaSig}
                    onChange={(e) => setBuscaSig(e.target.value)}
                    className="pl-9 text-xs"
                  />
                </div>
                <div className="max-h-36 space-y-1 overflow-auto rounded-xl border border-sus-900/10 p-2 bg-sand/30">
                  {sigtapResultados.slice(0, 30).map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => adicionarSigtapItem(s)}
                      className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-white transition"
                    >
                      <Plus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal" />
                      <span>
                        <b>{s.codigo}</b> · {s.descricao}
                      </span>
                    </button>
                  ))}
                  {buscaSig.trim() && sigtapResultados.length === 0 && (
                    <p className="py-2 text-center text-xs text-ink/45">
                      Nenhum exame laboratorial encontrado para "{buscaSig}".
                    </p>
                  )}
                  {!buscaSig.trim() && sigtapResultados.length === 0 && !buscandoSig && (
                    <p className="py-2 text-center text-xs text-ink/45">
                      Digite para consultar exames laboratoriais na tabela SIGTAP.
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="relative mt-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink/40 pointer-events-none" />
                  <Input
                    placeholder={
                      tipoServico
                        ? `Buscar procedimento em ${tipoServico} por nome, código SIGTAP ou sigla…`
                        : "Buscar procedimento por código SIGTAP, sigla ou nome…"
                    }
                    value={buscaProc}
                    onChange={(e) => {
                      setBuscaProc(e.target.value);
                      setProcFoco(true);
                    }}
                    onFocus={() => setProcFoco(true)}
                    onBlur={() => setTimeout(() => setProcFoco(false), 250)}
                    className="pl-9 pr-9 text-xs"
                    autoComplete="off"
                  />
                  {(buscaProc || procedimentoSel || procTexto) && (
                    <button
                      type="button"
                      onClick={() => {
                        setBuscaProc("");
                        handleSelecionarProcedimento(null);
                        setProcFoco(false);
                      }}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink/40 hover:text-ink transition"
                      title="Limpar procedimento"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {/* Procedimento Selecionado Badge */}
                {(procedimentoSel || procTexto) && (
                  <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1.5 rounded-xl border border-teal/20 bg-teal/5 px-3 py-2 text-xs">
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-teal shrink-0" />
                      <div>
                        <p className="font-bold text-sus-950">
                          {codigoProcedimento ? `${codigoProcedimento} · ` : ""}
                          {procTexto || procedimentoSel?.exame}
                        </p>
                        <p className="text-[11px] text-ink/60">
                          {tipoServico ? `${tipoServico} · ` : ""}
                          {especialidade ? `Especialidade: ${especialidade}` : ""}
                        </p>
                      </div>
                    </div>
                    <span className="rounded bg-teal/15 px-2 py-0.5 text-[10px] font-bold text-teal">
                      Selecionado
                    </span>
                  </div>
                )}

                {/* Dropdown com Busca Inteligente */}
                {procFoco && (
                  <div className="absolute left-0 right-0 z-30 mt-1 max-h-56 overflow-y-auto rounded-xl border border-sus-900/10 bg-white shadow-card">
                    <p className="sticky top-0 border-b border-sus-900/5 bg-sand/80 px-3 py-1.5 text-[11px] font-semibold text-sus-900/60 flex items-center justify-between">
                      <span>
                        {opcoesProcFiltradas.length > 0
                          ? `${opcoesProcFiltradas.length} procedimento(s) encontrado(s) — clique para selecionar`
                          : buscandoProc
                          ? "Pesquisando no catálogo..."
                          : "Nenhum procedimento encontrado"}
                      </span>
                      {buscandoProc && (
                        <span className="text-[10px] text-teal font-bold flex items-center gap-1">
                          <span className="h-1.5 w-1.5 rounded-full bg-teal animate-ping" />
                          Buscando no SIGTAP...
                        </span>
                      )}
                    </p>
                    {opcoesProcFiltradas.map((p, idx) => (
                      <button
                        key={`${p.codigo_curto || p.codigo_procedimento || idx}-${p.exame}`}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => escolherProcedimento(p)}
                        className="flex w-full items-start justify-between gap-2 border-b border-sus-900/5 px-3 py-2 text-left text-xs last:border-0 hover:bg-teal/5 transition"
                      >
                        <div>
                          <span className="font-bold text-sus-950">
                            {p.codigo_curto ? `${p.codigo_curto} · ` : ""}
                            {p.exame || p.nome_procedimento}
                          </span>
                          <span className="block text-[11px] text-ink/50">
                            {p.codigo_procedimento ? `SIGTAP ${p.codigo_procedimento}` : ""}
                            {p.especialidade ? ` · ${p.especialidade}` : ""}
                            {p.tipo_fila ? ` · ${p.tipo_fila}` : ""}
                          </span>
                        </div>
                        <Plus className="h-4 w-4 shrink-0 text-teal mt-0.5" />
                      </button>
                    ))}
                    {buscaProc.trim().length >= 2 && (
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setProcTexto(buscaProc.trim());
                          setProcedimentoSel(null);
                          setBuscaProc("");
                          setProcFoco(false);
                        }}
                        className="flex w-full items-center gap-2 border-t border-sus-900/10 bg-sand/30 px-3 py-2 text-left text-xs font-semibold text-teal hover:bg-teal/10 transition"
                      >
                        <Plus className="h-3.5 w-3.5" /> Usar texto digitado: “{buscaProc.trim()}”
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={adicionarProcedimentoLista}
                disabled={!tipoServico || (!procTexto.trim() && !procedimentoSel)}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-teal hover:text-teal-700 disabled:opacity-40 transition"
              >
                <Plus className="h-3.5 w-3.5" /> Adicionar outro exame a este pedido
              </button>
              {procedimentosAdicionados.length > 0 && (
                <span className="text-xs font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                  {procedimentosAdicionados.length} exame(s) agrupado(s) neste pedido
                </span>
              )}
            </div>

            {procedimentosAdicionados.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2 rounded-xl bg-sand/40 p-3 border border-sus-900/10">
                <p className="w-full text-[11px] font-bold uppercase tracking-wider text-sus-900/60 mb-0.5">
                  Exames que farão parte deste mesmo pedido unificado:
                </p>
                {procedimentosAdicionados.map((it, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-sus-950 border border-sus-900/15 shadow-2xs"
                  >
                    {it.codigo ? <strong className="font-mono text-teal">{it.codigo} · </strong> : null}
                    <span>{it.nome}</span>
                    <button
                      type="button"
                      onClick={() => removerProcedimentoLista(idx)}
                      className="text-red-500 hover:text-red-700 ml-1.5 p-0.5"
                      title="Remover este exame"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Dados Complementares do Procedimento */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 pt-3 border-t border-sus-900/10">
            <div>
              <Label className="text-[11px] text-ink/70">Código SIGTAP</Label>
              <Input
                value={codigoProcedimento}
                onChange={(e) => setCodigoProcedimento(e.target.value)}
                placeholder="Ex: 0205020186"
                className="mt-1 text-xs font-mono"
              />
            </div>
            <div>
              <Label className="text-[11px] text-ink/70">
                Nº do Pedido / Guia <span className="text-ink/40">(Gerado automaticamente se vazio)</span>
              </Label>
              <Input
                value={numeroPedido}
                onChange={(e) => setNumeroPedido(e.target.value)}
                placeholder="Automático (ex: PED-20261027-123456)"
                className="mt-1 text-xs font-mono uppercase"
              />
            </div>
          </div>
        </Card>

        {/* Bloco 3: Origem do Pedido, Unidade e Médico */}
        <Card className="p-5 shadow-xs">
          <div className="flex items-center justify-between border-b border-sus-900/10 pb-3 mb-4">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-teal" />
              <h2 className="font-display text-sm font-bold text-sus-950">
                3. Origem e Profissional Solicitante
              </h2>
            </div>
            {!isTfdCentral && (
              <span className="text-[11px] font-semibold text-amber-800 bg-amber-100 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Restrito à Unidade do Operador
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Unidade Solicitante com busca inteligente Combobox */}
            <div>
              <Label className="text-xs font-bold text-sus-950">
                PSF / Unidade Solicitante <span className="text-red-500">*</span>
              </Label>
              {isTfdCentral ? (
                <div className="mt-1">
                  <Combobox
                    value={unidadeId}
                    onChange={(v) => setUnidadeId(v)}
                    options={opcoesUnidades}
                    placeholder="Buscar PSF / Unidade Solicitante…"
                    searchPlaceholder="Digite o nome do PSF ou CNES…"
                    emptyText="Nenhuma unidade encontrada"
                    showAll={false}
                  />
                </div>
              ) : (
                <div className="mt-1">
                  <Input
                    value={unidNomeAtual}
                    disabled
                    className="bg-sand/40 font-semibold text-sus-950 cursor-not-allowed text-xs"
                  />
                  <p className="mt-1 text-[11px] text-ink/60">
                    Usuários de PSF só podem lançar pedidos vinculados à sua própria unidade.
                  </p>
                </div>
              )}
            </div>

            {/* Médico Requisitante com busca inteligente Combobox */}
            <div>
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold text-sus-950">
                  Médico(a) Requisitante <span className="text-red-500">*</span>
                </Label>
                <button
                  type="button"
                  onClick={() => {
                    const mGen = medicos.find((m) =>
                      m.nome.includes("Responsável Técnico") || m.nome.includes("Médico da Unidade"),
                    );
                    if (mGen) setMedicoId(String(mGen.id));
                  }}
                  className="text-[10px] font-bold text-teal hover:underline"
                >
                  Usar Médico da Unidade
                </button>
              </div>
              <div className="mt-1">
                <Combobox
                  value={medicoId}
                  onChange={(v) => setMedicoId(v)}
                  options={opcoesMedicos}
                  placeholder="Buscar Médico(a) Requisitante…"
                  searchPlaceholder="Digite o nome do médico ou CRM…"
                  emptyText="Nenhum médico encontrado"
                  showAll={false}
                />
              </div>
            </div>
          </div>
        </Card>

        {/* Bloco 4: Dados Clínicos e Prioridade */}
        <Card className="p-5 shadow-xs">
          <div className="flex items-center gap-2 border-b border-sus-900/10 pb-3 mb-4">
            <Stethoscope className="h-4 w-4 text-teal" />
            <h2 className="font-display text-sm font-bold text-sus-950">
              4. Dados Clínicos e Prioridade
            </h2>
          </div>

          <div className="space-y-4">
            {/* Classificação de Prioridade */}
            <div>
              <Label className="text-xs font-bold text-sus-950">Classificação de Prioridade</Label>
              <div className="mt-1.5 flex flex-wrap gap-3">
                <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                  <input
                    type="radio"
                    name="prio"
                    value="rotina"
                    checked={prioridade === "rotina"}
                    onChange={() => setPrioridade("rotina")}
                    className="accent-teal h-4 w-4"
                  />
                  <span className="rounded-md bg-sus-900/10 px-2 py-0.5 text-sus-900 font-bold">
                    Eletivo / Rotina (Fila normal regulada)
                  </span>
                </label>
                <label
                  className={`flex items-center gap-2 text-xs font-medium ${
                    isLancamentoRestrito ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
                  }`}
                >
                  <input
                    type="radio"
                    name="prio"
                    value="urgente"
                    disabled={isLancamentoRestrito}
                    checked={prioridade === "urgente"}
                    onChange={() => setPrioridade("urgente")}
                    className="accent-red-600 h-4 w-4"
                  />
                  <span className="rounded-md bg-red-100 px-2 py-0.5 text-red-700 font-bold">
                    Prioridade Urgente
                  </span>
                </label>
              </div>
              {isLancamentoRestrito && (
                <p className="mt-1 text-[11px] text-ink/60">
                  Seu perfil de lançamento restrito permite cadastros em fila na prioridade de rotina.
                </p>
              )}
            </div>

            {/* Campo CID-10 com busca inteligente */}
            <div>
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold text-sus-950 flex items-center gap-1.5">
                  <ClipboardList className="h-3.5 w-3.5 text-teal" /> Diagnóstico / CID-10 (opcional)
                </Label>
                {cidCodigo && (
                  <button
                    type="button"
                    onClick={() => {
                      setCidCodigo("");
                      setCidDescricao("");
                      setBuscaCid("");
                    }}
                    className="text-[11px] font-bold text-red-600 hover:underline"
                  >
                    Remover CID
                  </button>
                )}
              </div>
              {cidCodigo ? (
                <div className="mt-1 flex items-center justify-between rounded-xl border border-teal/40 bg-teal/10 px-3 py-2 text-xs">
                  <div>
                    <span className="font-mono font-bold text-teal">{cidCodigo}</span>
                    <span className="ml-2 font-medium text-sus-950">{cidDescricao}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setCidCodigo("");
                      setCidDescricao("");
                      setBuscaCid("");
                    }}
                    className="rounded p-1 text-ink/40 hover:text-red-600"
                    title="Remover CID"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="relative mt-1">
                  <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink/40" />
                  <Input
                    value={buscaCid}
                    onChange={(e) => setBuscaCid(e.target.value)}
                    placeholder="Pesquise por código ou nome do CID-10 (ex: J06, cefaleia, diabetes)…"
                    className="pl-9 text-xs"
                  />
                  {buscandoCid && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-ink/45">
                      Buscando…
                    </span>
                  )}
                  {cidsSugeridos.length > 0 && (
                    <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-xl border border-sus-900/15 bg-white shadow-lg">
                      {cidsSugeridos.map((c) => (
                        <button
                          key={c.codigo}
                          type="button"
                          onClick={() => {
                            setCidCodigo(c.codigo);
                            setCidDescricao(c.descricao);
                            setBuscaCid("");
                            setCidsSugeridos([]);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-teal/10 transition"
                        >
                          <span className="rounded bg-teal/15 px-1.5 py-0.5 font-mono font-bold text-teal">
                            {c.codigo}
                          </span>
                          <span className="truncate text-ink/80">{c.descricao}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Justificativa Clínica Obrigatória */}
            <div>
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold text-sus-950">
                  Justificativa Clínica e Hipótese Diagnóstica <span className="text-red-500">*</span> (mínimo {JUST_MIN} caracteres)
                </Label>
                <span className={`text-[11px] font-semibold ${justificativa.trim().length >= JUST_MIN ? "text-emerald-700" : "text-amber-800"}`}>
                  {justificativa.trim().length} / {JUST_MIN} caracteres {justificativa.trim().length >= JUST_MIN ? "✓" : `(faltam ${JUST_MIN - justificativa.trim().length})`}
                </span>
              </div>
              <textarea
                value={justificativa}
                onChange={(e) => setJustificativa(e.target.value)}
                rows={3}
                placeholder="Descreva a indicação clínica, sintomas ou observações do médico solicitante (obrigatório, mínimo 12 caracteres)…"
                className={`mt-1 w-full rounded-xl border p-3 text-xs outline-none transition focus:ring-2 ${
                  justificativa.trim().length > 0 && justificativa.trim().length < JUST_MIN
                    ? "border-amber-400 focus:border-amber-500 focus:ring-amber-200"
                    : "border-sus-900/15 focus:border-teal focus:ring-teal/20"
                }`}
                required
              />
            </div>

            {/* Observações Gerais */}
            <div>
              <Label className="text-[11px] text-ink/70">Observações adicionais (opcional)</Label>
              <textarea
                value={observacoes}
                onChange={(e) => setObservacoes(e.target.value)}
                rows={2}
                placeholder="Ex: Paciente necessita de cadeira de rodas, jejum especial ou contato com acompanhante…"
                className="mt-1 w-full rounded-xl border border-sus-900/15 bg-white p-2.5 text-xs outline-none transition focus:border-teal"
              />
            </div>
          </div>
        </Card>

        {/* Bloco 5: Opção de Agendamento Direto (Apenas TFD Central) */}
        {isTfdCentral && (
          <Card className="p-5 shadow-xs border-dashed border-sus-900/20">
            <div className="flex items-center justify-between border-b border-sus-900/10 pb-3 mb-3">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-teal" />
                <h2 className="font-display text-sm font-bold text-sus-950">
                  5. Modo de Inclusão: Fila vs. Agendamento Direto
                </h2>
              </div>
              <span className="text-[11px] text-teal font-semibold">Exclusivo Central TFD</span>
            </div>

            <div className="space-y-3">
              <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer text-sus-950">
                <input
                  type="checkbox"
                  checked={agendamentoDireto}
                  onChange={(e) => setAgendamentoDireto(e.target.checked)}
                  className="accent-teal h-4 w-4"
                />
                Marcar data de agendamento diretamente (ignorar espera na fila)
              </label>

              {agendamentoDireto && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <div>
                    <Label className="text-xs font-bold text-sus-950">Data do Atendimento</Label>
                    <Input
                      type="date"
                      value={dataAgendada}
                      onChange={(e) => setDataAgendada(e.target.value)}
                      className="mt-1 text-xs"
                      required={agendamentoDireto}
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-bold text-sus-950">Horário</Label>
                    <Input
                      type="time"
                      value={horaAgendada}
                      onChange={(e) => setHoraAgendada(e.target.value)}
                      className="mt-1 text-xs"
                      required={agendamentoDireto}
                    />
                  </div>
                </div>
              )}
            </div>
          </Card>
        )}

        {/* Botões de Ação Finais */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={limparFormulario}
            disabled={salvando}
            className="text-xs"
          >
            <RotateCcw className="h-4 w-4" /> Limpar Campos
          </Button>

          <Button
            type="submit"
            disabled={salvando}
            className="bg-teal text-white hover:brightness-110 shadow-sm text-xs font-bold px-6 py-2.5"
          >
            {salvando ? (
              "Processando…"
            ) : agendamentoDireto ? (
              <>
                <Calendar className="h-4 w-4" /> Confirmar e Agendar Direto
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" /> Incluir Solicitação na Fila
              </>
            )}
          </Button>
        </div>
      </form>

      {/* Modal de Confirmação antes de Gravar Definitivamente no Banco */}
      {modalConfirmacao && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4">
          <div
            className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-sus-900/10 pb-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-teal" />
                <h3 className="font-display text-base font-bold text-sus-950">
                  Confirmar Lançamento de Solicitação
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setModalConfirmacao(false)}
                className="rounded-lg p-1 text-ink/50 hover:bg-sand"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-xs text-ink/70">
              Revise atentamente os dados do pedido antes de gravar na fila de regulação:
            </p>

            <div className="rounded-xl border border-sus-900/10 bg-sand/20 p-4 text-xs space-y-2.5">
              <div className="flex justify-between border-b border-sus-900/5 pb-2">
                <span className="text-ink/60 font-medium">Paciente:</span>
                <span className="font-bold text-sus-950 text-right">{pacienteSelecionado?.nome}</span>
              </div>
              {pacienteSelecionado?.cpf && (
                <div className="flex justify-between border-b border-sus-900/5 pb-2">
                  <span className="text-ink/60 font-medium">CPF:</span>
                  <span className="font-mono text-sus-950">{pacienteSelecionado.cpf}</span>
                </div>
              )}
              <div className="flex justify-between border-b border-sus-900/5 pb-2">
                <span className="text-ink/60 font-medium">Data do Pedido:</span>
                <span className="font-semibold text-sus-950">
                  {dataPedido.split("-").reverse().join("/")}
                </span>
              </div>
              <div className="flex justify-between border-b border-sus-900/5 pb-2">
                <span className="text-ink/60 font-medium">Tipo de Serviço:</span>
                <span className="font-semibold text-teal">{tipoServico}</span>
              </div>
              <div className="flex justify-between border-b border-sus-900/5 pb-2">
                <span className="text-ink/60 font-medium">Procedimento(s):</span>
                <span className="font-bold text-sus-950 text-right">
                  {codigoProcedimento ? `${codigoProcedimento} · ` : ""}
                  {procTexto.trim() || procedimentoSel?.exame}
                  {procedimentosAdicionados.length > 0 && ` (+${procedimentosAdicionados.length} agrupados)`}
                </span>
              </div>
              {especialidade && (
                <div className="flex justify-between border-b border-sus-900/5 pb-2">
                  <span className="text-ink/60 font-medium">Especialidade:</span>
                  <span className="font-semibold text-sus-950">{especialidade}</span>
                </div>
              )}
              <div className="flex justify-between border-b border-sus-900/5 pb-2">
                <span className="text-ink/60 font-medium">PSF / Unidade:</span>
                <span className="font-medium text-sus-950 text-right">{unidNomeAtual}</span>
              </div>
              <div className="flex justify-between border-b border-sus-900/5 pb-2">
                <span className="text-ink/60 font-medium">Médico(a):</span>
                <span className="font-medium text-sus-950 text-right">{medNomeAtual}</span>
              </div>
              <div className="flex justify-between border-b border-sus-900/5 pb-2">
                <span className="text-ink/60 font-medium">Prioridade:</span>
                <span className={`rounded px-2 py-0.5 font-bold uppercase text-[10px] ${prioridade === "urgente" ? "bg-red-100 text-red-800" : "bg-teal/15 text-teal"}`}>
                  {prioridade === "urgente" ? "Prioridade Urgente" : "Rotina / Eletivo"}
                </span>
              </div>
              {cidCodigo && (
                <div className="flex justify-between border-b border-sus-900/5 pb-2">
                  <span className="text-ink/60 font-medium">Diagnóstico / CID:</span>
                  <span className="font-mono text-sus-950">{cidCodigo} · {cidDescricao}</span>
                </div>
              )}
              <div className="flex flex-col gap-1 border-b border-sus-900/5 pb-2">
                <span className="text-ink/60 font-medium">Justificativa Clínica:</span>
                <p className="font-medium text-sus-950 italic bg-white p-2 rounded-lg border border-sus-900/10">
                  "{justificativa.trim()}"
                </p>
              </div>
              <div className="flex justify-between pt-1">
                <span className="text-ink/60 font-medium">Nº do Pedido:</span>
                <span className="font-mono text-ink/80">
                  {numeroPedido.trim() || "Gerado automaticamente em segundo plano"}
                </span>
              </div>
              {agendamentoDireto && (
                <div className="flex justify-between pt-1 text-teal font-semibold">
                  <span>Agendamento Direto:</span>
                  <span>{dataAgendada.split("-").reverse().join("/")} às {horaAgendada}</span>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                type="button"
                onClick={() => setModalConfirmacao(false)}
                disabled={salvando}
                className="text-xs"
              >
                Voltar e Corrigir
              </Button>
              <Button
                type="button"
                onClick={confirmarGravacaoDefinitiva}
                disabled={salvando}
                className="bg-teal text-white hover:brightness-110 text-xs font-bold shadow-sm"
              >
                {salvando ? "Gravando no Banco…" : "Confirmar e Gravar Pedido"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {abrirComprovante && criado && (
        <ComprovanteExameModal
          exameId={criado.id}
          numeroPedido={criado.numero_pedido}
          onClose={() => setAbrirComprovante(false)}
        />
      )}
    </div>
  );
}
