import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  Bus,
  Calendar,
  CalendarDays,
  CheckCircle2,
  Edit2,
  Eye,
  Filter,
  FlaskConical,
  Layers,
  MapPin,
  MessageSquare,
  Minus,
  Plus,
  Printer,
  RotateCcw,
  Search,
  Stethoscope,
  Trash2,
  User,
  UserX,
  X,
} from "lucide-react";
import {
  filaPsfCriar,
  filaPsfAtualizar,
  filaPsfExcluir,
  filaPsfListar,
  filaPsfAgendarLote,
  fetchMedicos,
  fetchUnidadesSaude,
  labsListar,
  labSigtap,
  labVerificarDuplicidade,
  tfdTipos,
  tfdEspecialidades,
  pagData,
  pagMeta,
  type FilaPsfItem,
  type Laboratorio,
  type Medico,
  type Paciente,
  type SigtapProc,
  type TipoFila,
  type UnidadeSaude,
  type PedidoDuplicadoLab,
  type EspecialidadeCat,
} from "../../services/api";
import { Button, Card, Input, Label, Select } from "../../components/ui/primitives";
import Paginacao from "../../components/Paginacao";
import ExportarExcel from "../../components/ExportarExcel";
import { Combobox, type ComboOption } from "../../components/ui/combobox";
import BuscaPacienteAutocomplete from "../../components/BuscaPacienteAutocomplete";
import AlertaPedidoDuplicado from "../../components/AlertaPedidoDuplicado";
import { useAuth } from "../../hooks/useAuth";
import { useConfirm } from "../../components/ConfirmDialog";
import ModalPedidosInelegiveis from "../../components/ModalPedidosInelegiveis";
import ComprovanteExameModal from "../../components/ComprovanteExameModal";
import { acoesEfetivas, type Acao } from "../../permissoes";
import { useBackdropClose } from "../../hooks/useBackdropClose";

const MEDICO_GENERICO = "Médico da Unidade / Responsável Técnico";

function fmtData(s?: string) {
  if (!s) return "—";
  const [a, m, d] = s.slice(0, 10).split("-");
  return a && m && d ? `${d}/${m}/${a}` : s;
}

function tempoEspera(s?: string | null): string {
  if (!s) return "";
  const base = s.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(base)) return "";
  const [ano, mes, dia] = base.split("-").map(Number);
  const dt = new Date(ano, mes - 1, dia);
  if (isNaN(dt.getTime())) return "";
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const dias = Math.floor((hoje.getTime() - dt.getTime()) / (1000 * 60 * 60 * 24));
  if (dias < 0) return "";
  if (dias === 0) return "hoje";
  if (dias === 1) return "1 dia";
  if (dias < 30) return `${dias} dias`;
  const meses = Math.floor(dias / 30.4375);
  return meses < 12 ? `${meses} ${meses === 1 ? "mês" : "meses"}` : `${Math.floor(dias / 365.25)}a`;
}

function formatarEnderecoPaciente(p?: {
  endereco?: string;
  endereco_numero?: string;
  complemento?: string;
  bairro?: string;
  municipio?: string;
  cep?: string;
} | null): string {
  if (!p) return "";
  const log = [p.endereco, p.endereco_numero ? `nº ${p.endereco_numero}` : ""].filter(Boolean).join(", ");
  return [log, p.complemento, p.bairro, p.municipio, p.cep ? `CEP ${p.cep}` : ""].filter(Boolean).join(" · ");
}

export default function FilaPsf() {
  const { confirmar } = useConfirm();
  const auth = useAuth();
  const { user, can } = auth;
  const canAction = (tela: string, acao: "ver" | "criar" | "editar" | "excluir"): boolean => {
    if (typeof (auth as any).canAction === "function") {
      return Boolean((auth as any).canAction(tela, acao));
    }
    if (!user) return false;
    if (user.is_superuser) return true;
    if (!can(tela) && !can("lab")) return false;
    return acoesEfetivas((user.acoes ?? {}) as Record<string, Acao[]>, tela).includes(acao);
  };
  const podeCriar = canAction("lab_fila", "criar");
  const podeEditar = canAction("lab_fila", "editar");
  const podeExcluir = canAction("lab_fila", "excluir");
  const usuarioRestritoUnidade = Boolean(
    user?.unidade_saude_id && !user?.is_superuser && !can("lab") && !can("lab_marcacao") && !can("lab_agenda")
  );
  const [lista, setLista] = useState<FilaPsfItem[]>([]);
  const [unidades, setUnidades] = useState<UnidadeSaude[]>([]);
  const [medicos, setMedicos] = useState<Medico[]>([]);
  const [labs, setLabs] = useState<Laboratorio[]>([]);
  const [listaEspecialidades, setListaEspecialidades] = useState<EspecialidadeCat[]>([]);

  // Modais
  const [modalAberto, setModalAberto] = useState(false);
  const [modalInelegiveisAberto, setModalInelegiveisAberto] = useState(false);
  const [itemEditando, setItemEditando] = useState<FilaPsfItem | null>(null);
  const [detalheItem, setDetalheItem] = useState<FilaPsfItem | null>(null);
  const [pedidoCriado, setPedidoCriado] = useState<FilaPsfItem | null>(null);
  const [comprovanteFilaId, setComprovanteFilaId] = useState<number | null>(null);

  const [modalLote, setModalLote] = useState(false);
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set());
  const [loteLabId, setLoteLabId] = useState("");
  const [loteData, setLoteData] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [loteHora, setLoteHora] = useState("07:00");
  const [loteInstrucoes, setLoteInstrucoes] = useState("");
  const [loteEnviarWhatsapp, setLoteEnviarWhatsapp] = useState(true);
  const [loteSalvando, setLoteSalvando] = useState(false);

  // Form de Pedido (Criar / Editar)
  const [pacienteSelecionado, setPacienteSelecionado] = useState<Paciente | null>(null);
  const [form, setForm] = useState({
    paciente_id: "",
    fila_id: "",
    tipo_fila: "",
    especialidade: "",
    unidade_psf: "",
    unidade_saude_id: "",
    medico: MEDICO_GENERICO,
    prioridade: "rotina",
    data_solicitacao: new Date().toISOString().slice(0, 10),
    data_pedido: new Date().toISOString().slice(0, 10),
    justificativa: "",
    obs: "",
  });

  // Procedimentos SIGTAP (Exames de Sangue)
  const [buscaSig, setBuscaSig] = useState("");
  const [feedbackExame, setFeedbackExame] = useState("");
  const [sigtap, setSigtap] = useState<SigtapProc[]>([]);
  const [itens, setItens] = useState<{ sigtap: SigtapProc; quantidade: number }[]>([]);

  // Verificação de Pedidos Duplicados em Tempo Real (Fila de Exames PSF)
  const [duplicidadeFila, setDuplicidadeFila] = useState<PedidoDuplicadoLab | null>(null);
  const [verificandoDuplicidadeFila, setVerificandoDuplicidadeFila] = useState(false);
  const [ignorarDuplicidadeFila, setIgnorarDuplicidadeFila] = useState(false);

  useEffect(() => {
    if (itemEditando || !form.paciente_id || itens.length === 0) {
      setDuplicidadeFila(null);
      return;
    }

    setIgnorarDuplicidadeFila(false);

    const sigtapIds = itens.map((i) => i.sigtap.id).join(",");
    const t = setTimeout(() => {
      setVerificandoDuplicidadeFila(true);
      labVerificarDuplicidade({
        paciente_id: Number(form.paciente_id),
        sigtap_ids: sigtapIds,
      })
        .then((res) => {
          if (res.duplicado && res.pedido) {
            setDuplicidadeFila(res.pedido);
          } else {
            setDuplicidadeFila(null);
          }
        })
        .catch(() => {
          setDuplicidadeFila(null);
        })
        .finally(() => {
          setVerificandoDuplicidadeFila(false);
        });
    }, 250);

    return () => clearTimeout(t);
  }, [itemEditando, form.paciente_id, itens]);

  useEffect(() => {
    if (!modalAberto) return;
    const tfAtual = (form.tipo_fila || form.especialidade || "").trim();
    const t = setTimeout(() => {
      labSigtap(
        buscaSig.trim() || undefined,
        undefined,
        undefined,
        undefined,
        true,
        undefined,
        undefined,
        undefined,
        tfAtual || undefined
      )
        .then((r) => setSigtap(pagData<SigtapProc>(r)))
        .catch(() => setSigtap([]));
    }, 250);
    return () => clearTimeout(t);
  }, [buscaSig, modalAberto, form.tipo_fila, form.especialidade]);

  useEffect(() => {
    if (!feedbackExame) return;
    const t = window.setTimeout(() => setFeedbackExame(""), 2500);
    return () => window.clearTimeout(t);
  }, [feedbackExame]);

  function adicionarSig(s: SigtapProc) {
    setItens((prev) => {
      const idx = prev.findIndex((i) => i.sigtap.id === s.id);
      if (idx >= 0) {
        const cp = [...prev];
        cp[idx] = { ...cp[idx], quantidade: cp[idx].quantidade + 1 };
        return cp;
      }
      return [...prev, { sigtap: s, quantidade: 1 }];
    });
    setBuscaSig("");
    setFeedbackExame(`Exame "${s.descricao}" adicionado ao pedido!`);
  }

  function removerItem(sigtapId: number) {
    setItens((prev) => prev.filter((i) => i.sigtap.id !== sigtapId));
  }

  function setQtd(sigtapId: number, qtd: number) {
    if (qtd <= 0) return removerItem(sigtapId);
    setItens((prev) =>
      prev.map((i) => (i.sigtap.id === sigtapId ? { ...i, quantidade: Math.min(99, qtd) } : i))
    );
  }

  const totalItens = itens.reduce((acc, i) => acc + i.quantidade, 0);

  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [salvando, setSalvando] = useState(false);
  const [carregando, setCarregando] = useState(false);

  // Filtros Avançados da Fila
  const [filasLab, setFilasLab] = useState<TipoFila[]>([]);
  const [filtroFilaId, setFiltroFilaId] = useState("");
  const [filtrosAvancados, setFiltrosAvancados] = useState(false);
  const [filtroEspecialidade, setFiltroEspecialidade] = useState("");
  const [filtroPrioridade, setFiltroPrioridade] = useState("");
  const [termoBusca, setTermoBusca] = useState("");
  const [filtroUnidade, setFiltroUnidade] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("na_fila");
  const [dataDe, setDataDe] = useState("");
  const [dataAte, setDataAte] = useState("");

  async function carregar(p = page) {
    setCarregando(true);
    setErro("");
    try {
      const r = await filaPsfListar({
        fila_id: filtroFilaId ? Number(filtroFilaId) : undefined,
        status: filtroStatus !== "todos" ? filtroStatus : undefined,
        unidade: filtroUnidade || undefined,
        especialidade: filtroEspecialidade.trim() || undefined,
        prioridade: filtroPrioridade || undefined,
        data_de: dataDe || undefined,
        data_ate: dataAte || undefined,
        q: termoBusca.trim() || undefined,
        page: p,
        limit: 100,
      });
      setLista(pagData<FilaPsfItem>(r));
      const m = pagMeta(r);
      setTotal(m.total);
      setPage(m.page);
      setPages(m.pages);
    } catch {
      setErro("Falha ao carregar fila de exames.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    fetchUnidadesSaude()
      .then((u) => setUnidades(u.filter((x) => x.ativo)))
      .catch(() => {});
    fetchMedicos({ somente_ativos: true })
      .then((m) => setMedicos(m.filter((x) => x.ativo)))
      .catch(() => {});
    tfdEspecialidades({ limit: 300 })
      .then((r) => setListaEspecialidades(pagData<EspecialidadeCat>(r)))
      .catch(() => {});
    labsListar()
      .then((l) => {
        const ativ = l.filter((x) => x.ativo);
        setLabs(ativ);
        if (ativ.length > 0) setLoteLabId(String(ativ[0].id));
      })
      .catch(() => {});
    // Busca dinâmica de filas registradas como exame de laboratório/sangue
    tfdTipos({ tipo_fila: "EXAME_LABORATORIAL", ativos: true, limit: 100 })
      .then((r) => {
        const data = pagData<TipoFila>(r);
        if (data.length > 0) {
          setFilasLab(data);
        } else {
          tfdTipos({ ativos: true, limit: 100 })
            .then((res) => {
              const all = pagData<TipoFila>(res);
              const labOnly = all.filter(
                (x) =>
                  x.tipo_fila === "EXAME_LABORATORIAL" ||
                  /lab|sangue|bioquim|rotina|hiperdia|gineco|pediat|caps|pré-natal/i.test(x.nome)
              );
              setFilasLab(labOnly.length > 0 ? labOnly : all);
            })
            .catch(() => {});
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    carregar(1);
  }, [filtroFilaId, filtroStatus, filtroUnidade, filtroPrioridade, dataDe, dataAte]);

  useEffect(() => {
    const t = setTimeout(() => {
      carregar(1);
    }, 300);
    return () => clearTimeout(t);
  }, [termoBusca, filtroEspecialidade]);

  function limparFiltros() {
    setFiltroFilaId("");
    setTermoBusca("");
    setFiltroUnidade("");
    setFiltroEspecialidade("");
    setFiltroPrioridade("");
    setFiltroStatus("na_fila");
    setDataDe("");
    setDataAte("");
  }

  const temFiltroAtivo = Boolean(
    filtroFilaId ||
      termoBusca.trim() ||
      filtroUnidade ||
      filtroEspecialidade.trim() ||
      filtroPrioridade ||
      filtroStatus !== "na_fila" ||
      dataDe ||
      dataAte
  );

  function set(k: string, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // Preenche unidade padrão pelo perfil do usuário logado
  const unidPadraoUsuario = useMemo(() => {
    if (user?.unidade_saude_id) {
      const u = unidades.find((x) => x.id === user.unidade_saude_id);
      if (u) return u.nome;
    }
    return user?.unidade_saude_nome || "";
  }, [unidades, user]);

  function abrirModalNovo() {
    setItemEditando(null);
    setPacienteSelecionado(null);
    setItens([]);
    setBuscaSig("");
    setFeedbackExame("");
    const unidInitNome = unidPadraoUsuario || (unidades[0]?.nome ?? "");
    const unidInitObj = unidades.find((x) => x.nome === unidInitNome);
    setForm({
      paciente_id: "",
      fila_id: filtroFilaId || (filasLab[0] ? String(filasLab[0].id) : ""),
      tipo_fila: "",
      especialidade: "",
      unidade_psf: unidInitNome,
      unidade_saude_id: unidInitObj ? String(unidInitObj.id) : (user?.unidade_saude_id ? String(user.unidade_saude_id) : ""),
      medico: MEDICO_GENERICO,
      prioridade: "rotina",
      data_solicitacao: new Date().toISOString().slice(0, 10),
      data_pedido: new Date().toISOString().slice(0, 10),
      justificativa: "",
      obs: "",
    });
    setErro("");
    setDuplicidadeFila(null);
    setIgnorarDuplicidadeFila(false);
    setModalAberto(true);
  }

  function abrirModalEditar(item: FilaPsfItem) {
    setItemEditando(item);
    setPacienteSelecionado({
      id: item.paciente_id,
      nome: item.paciente_nome,
      cpf: item.paciente_cpf || "",
      cns: item.paciente_cns || "",
      codigo_prontuario: item.paciente_prontuario || "",
      endereco: item.paciente_endereco || "",
      endereco_numero: item.paciente_numero || "",
      bairro: item.paciente_bairro || "",
      municipio: item.paciente_municipio || "",
    } as unknown as Paciente);
    setItens(
      (item.sigtap_ids || []).map((id, idx) => ({
        sigtap: {
          id,
          codigo: "",
          descricao: (item.exames_nomes && item.exames_nomes[idx]) || `Exame SIGTAP #${id}`,
        } as SigtapProc,
        quantidade: 1,
      }))
    );
    setBuscaSig("");
    setFeedbackExame("");
    const unidObj = unidades.find(
      (u) => (item.unidade_saude_id && u.id === item.unidade_saude_id) || u.nome === item.unidade_psf
    );
    setForm({
      paciente_id: String(item.paciente_id),
      fila_id: item.fila_id ? String(item.fila_id) : "",
      tipo_fila: item.tipo_fila || "",
      especialidade: item.especialidade || "",
      unidade_psf: item.unidade_psf || "",
      unidade_saude_id: item.unidade_saude_id
        ? String(item.unidade_saude_id)
        : unidObj
        ? String(unidObj.id)
        : "",
      medico: item.medico || MEDICO_GENERICO,
      prioridade: item.prioridade || "rotina",
      data_solicitacao: item.data_solicitacao || new Date().toISOString().slice(0, 10),
      data_pedido: item.data_pedido || item.data_solicitacao || new Date().toISOString().slice(0, 10),
      justificativa: item.justificativa || "",
      obs: item.obs || "",
    });
    setErro("");
    setDuplicidadeFila(null);
    setIgnorarDuplicidadeFila(false);
    setModalAberto(true);
  }

  function fecharModal() {
    setModalAberto(false);
    setItemEditando(null);
    setDuplicidadeFila(null);
    setIgnorarDuplicidadeFila(false);
  }

  const isModalDirty = useMemo(() => {
    if (!modalAberto) return false;
    return Boolean(form.paciente_id || itens.length > 0 || form.justificativa.trim());
  }, [modalAberto, form.paciente_id, itens.length, form.justificativa]);

  const modalBackdrop = useBackdropClose({ onClose: fecharModal, aberto: modalAberto, isDirty: isModalDirty });
  const loteBackdrop = useBackdropClose(() => setModalLote(false), modalLote);
  const detalheBackdrop = useBackdropClose(() => setDetalheItem(null), !!detalheItem);

  // Opções para o Combobox de Filtro de Filas de Sangue / Laboratório
  const opcoesFiltroFilas = useMemo<ComboOption[]>(() => {
    return [
      { value: "", label: "🩸 Todas as Filas de Sangue / Laboratório", sub: "Sem restrição de fila" },
      ...filasLab.map((f) => ({
        value: String(f.id),
        label: `${f.codigo ? `[${f.codigo}] ` : ""}${f.nome}`,
        sub: `Fila Oficial (${f.tipo_fila})`,
      })),
    ];
  }, [filasLab]);

  // Opções para o Combobox de Filtro de Unidades (inclui "Todas")
  const opcoesFiltroUnidades = useMemo<ComboOption[]>(() => {
    return [
      { value: "", label: "🏥 Todas as unidades / PSFs", sub: "Sem filtro de unidade" },
      ...unidades.map((u) => ({
        value: u.nome,
        label: u.nome,
        sub: u.cnes ? `CNES: ${u.cnes}` : undefined,
      })),
    ];
  }, [unidades]);

  // Opções para o Combobox de Unidades (Formulário)
  const opcoesUnidades = useMemo<ComboOption[]>(() => {
    return unidades.map((u) => ({
      value: u.nome,
      label: u.nome,
      sub: u.cnes ? `CNES: ${u.cnes}` : undefined,
    }));
  }, [unidades]);

  // Opções para o Combobox de Médicos
  const opcoesMedicos = useMemo<ComboOption[]>(() => {
    const opts: ComboOption[] = [
      {
        value: MEDICO_GENERICO,
        label: `🏥 ${MEDICO_GENERICO}`,
        sub: "Padrão para postos de saúde da família (PSF)",
      },
    ];
    medicos.forEach((m) => {
      if (!m.nome.includes("Responsável Técnico") && !m.nome.includes("Médico da Unidade")) {
        opts.push({
          value: m.nome,
          label: m.nome,
          sub: m.crm ? `CRM: ${m.crm}${m.cbo_codigo ? ` · CBO: ${m.cbo_codigo}` : ""}` : undefined,
        });
      }
    });
    return opts;
  }, [medicos]);

  async function salvarPedido() {
    setErro("");
    setOk("");
    if (!form.paciente_id) {
      setErro("Selecione o paciente através da busca inteligente.");
      return;
    }
    if (!itemEditando && duplicidadeFila && !ignorarDuplicidadeFila) {
      setErro(
        "Atenção: Já existe um pedido ativo de exames de sangue para este paciente contendo os mesmos procedimentos. Avalie a situação no alerta em destaque ou clique em 'Prosseguir Mesmo com Duplicidade' para continuar."
      );
      return;
    }
    if (!form.data_solicitacao) {
      setErro("Informe a data do pedido.");
      return;
    }
    if (!form.especialidade.trim()) {
      setErro("O campo 'Especialidade' é obrigatório ao lançar o paciente na fila de exames.");
      return;
    }
    if (!form.unidade_psf.trim()) {
      setErro("Selecione o PSF / unidade de origem solicitante.");
      return;
    }
    if (!form.medico.trim()) {
      setErro("Selecione o médico requisitante.");
      return;
    }
    if (itens.length === 0) {
      setErro("Selecione pelo menos um exame SIGTAP para adicionar ao pedido.");
      return;
    }
    if (form.justificativa.trim().length < 12) {
      setErro("A justificativa clínica deve conter no mínimo 12 caracteres.");
      return;
    }

    const sigtap_ids: number[] = [];
    itens.forEach((it) => {
      for (let i = 0; i < it.quantidade; i++) {
        sigtap_ids.push(it.sigtap.id);
      }
    });

    setSalvando(true);
    const filaSel = filasLab.find((f) => String(f.id) === form.fila_id);
    const tipoFilaNome = filaSel?.nome || form.especialidade.trim();
    const filaIdNum = form.fila_id ? Number(form.fila_id) : undefined;
    const unidMatch = unidades.find((u) => u.nome === form.unidade_psf.trim());
    const unidIdNum = form.unidade_saude_id
      ? Number(form.unidade_saude_id)
      : unidMatch?.id;
    try {
      if (itemEditando) {
        await filaPsfAtualizar(itemEditando.id, {
          especialidade: form.especialidade.trim(),
          unidade_psf: form.unidade_psf.trim(),
          unidade_saude_id: unidIdNum,
          medico: form.medico.trim(),
          prioridade: form.prioridade || "rotina",
          data_solicitacao: form.data_solicitacao,
          data_pedido: form.data_pedido || form.data_solicitacao,
          justificativa: form.justificativa.trim(),
          obs: form.obs.trim(),
          sigtap_ids,
          fila_id: filaIdNum,
          tipo_fila: tipoFilaNome,
        });
        setOk(`Pedido de ${itemEditando.paciente_nome} atualizado com sucesso.`);
        fecharModal();
        await carregar();
      } else {
        const criado = await filaPsfCriar({
          paciente_id: Number(form.paciente_id),
          especialidade: form.especialidade.trim(),
          unidade_psf: form.unidade_psf.trim(),
          unidade_saude_id: unidIdNum,
          medico: form.medico.trim(),
          prioridade: form.prioridade || "rotina",
          data_solicitacao: form.data_solicitacao,
          data_pedido: form.data_pedido || form.data_solicitacao,
          justificativa: form.justificativa.trim(),
          obs: form.obs.trim(),
          sigtap_ids,
          fila_id: filaIdNum,
          tipo_fila: tipoFilaNome,
        });
        setOk(`Pedido ${criado.codigo_solicitacao || `#${criado.id}`} incluído na fila de exames com sucesso.`);
        fecharModal();
        await carregar();
        setPedidoCriado(criado);
      }
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Erro ao salvar pedido na fila.");
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(id: number) {
    const ok = await confirmar({
      titulo: "Remover pedido da fila",
      descricao: "Deseja realmente remover este pedido da fila de exames?",
      textoConfirmar: "Sim, Remover",
      variante: "danger",
    });
    if (!ok) return;
    try {
      await filaPsfExcluir(id);
      setOk("Pedido removido da fila.");
      setSelecionados((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
      await carregar();
    } catch {
      setErro("Erro ao remover pedido.");
    }
  }

  // Lógica de seleção múltipla
  function toggleSelecionado(id: number) {
    setSelecionados((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function toggleSelecionarTodos() {
    if (selecionados.size === lista.length && lista.length > 0) {
      setSelecionados(new Set());
    } else {
      setSelecionados(new Set(lista.map((x) => x.id)));
    }
  }

  async function executarAgendamentoLote() {
    if (selecionados.size === 0) return;
    if (!loteLabId) {
      setErro("Selecione o laboratório conveniado.");
      return;
    }
    if (!loteData) {
      setErro("Selecione a data do agendamento.");
      return;
    }

    setLoteSalvando(true);
    try {
      const res = await filaPsfAgendarLote({
        fila_ids: Array.from(selecionados),
        laboratorio_id: Number(loteLabId),
        data_agendada: loteData,
        hora_agendada: loteHora || "07:00",
        enviar_whatsapp: loteEnviarWhatsapp,
        instrucoes_transporte: loteInstrucoes.trim(),
      });
      setModalLote(false);
      setSelecionados(new Set());
      setOk(
        `Marcação em lote concluída com sucesso! ${res.total_agendados || selecionados.size} paciente(s) agendado(s).`
      );
      await carregar();
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Erro ao realizar marcação em lote.");
    } finally {
      setLoteSalvando(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Barra de Cabeçalho e Ações Principais */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h2 className="font-display text-xl font-bold text-sus-950">
            Fila de exames
          </h2>
          <span className="rounded-full bg-teal/10 px-3 py-0.5 text-xs font-bold text-teal border border-teal/20">
            {total} {total === 1 ? "pedido filtrado" : "pedidos filtrados"}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 ml-auto">
          <ExportarExcel
            url="/api/exames/fila-psf/exportar"
            arquivo={selecionados.size > 0 ? `fila_exames_selecionados_${selecionados.size}` : "fila_exames_filtrada"}
            rotulo={selecionados.size > 0 ? `Exportar selecionados (${selecionados.size})` : "Exportar Excel"}
            params={{
              ...(selecionados.size > 0 ? { ids: Array.from(selecionados).join(",") } : {}),
              ...(filtroStatus !== "todos" ? { status: filtroStatus } : {}),
              ...(filtroUnidade ? { unidade: filtroUnidade } : {}),
              ...(filtroPrioridade ? { prioridade: filtroPrioridade } : {}),
              ...(dataDe ? { data_de: dataDe } : {}),
              ...(dataAte ? { data_ate: dataAte } : {}),
              ...(termoBusca.trim() ? { q: termoBusca.trim() } : {}),
            }}
          />

          {/* Botão de Análise e Baixa de Inelegíveis (Óbito/Mudança) */}
          <Button
            type="button"
            onClick={() => setModalInelegiveisAberto(true)}
            className="border border-rose-300 bg-rose-50 text-rose-800 hover:bg-rose-100 shadow-xs text-xs font-bold flex items-center gap-1.5"
            title="Analisar pedidos vinculados a pacientes falecidos ou com mudança"
          >
            <UserX className="h-4 w-4 text-rose-600" />
            <span>Casos Inelegíveis (Óbito/Mudança)</span>
          </Button>

          {/* Botão de Agendamento em Lote */}
          <Button
            onClick={() => setModalLote(true)}
            disabled={selecionados.size === 0}
            className={`border border-teal bg-white text-teal hover:bg-teal/10 shadow-xs ${
              selecionados.size > 0 ? "border-2 border-teal font-bold" : ""
            }`}
          >
            <Layers className="h-4 w-4" />
            {selecionados.size > 0
              ? `Marcar lote (${selecionados.size} selecionados)`
              : "Marcar lote mensal"}
          </Button>

          {/* Botão Principal para abrir Dialog de Novo Pedido */}
          {podeCriar && (
            <Button onClick={abrirModalNovo} className="flex items-center gap-1.5 shadow-sm">
              <Plus className="h-4 w-4" /> Novo pedido na fila
            </Button>
          )}
        </div>
      </div>

      {erro && (
        <p className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700 font-medium">
          {erro}
        </p>
      )}
      {ok && (
        <p className="rounded-xl bg-teal/10 px-4 py-2.5 text-sm text-teal font-medium">
          {ok}
        </p>
      )}

      {/* Barra de Filtros: Fila de Sangue, Período, PSF e Busca de Paciente */}
      <Card className="p-4 sm:p-5 border-sus-900/10 shadow-xs space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          {/* Seletor Dinâmico por Tipo de Fila (Exame Laboratorial / Sangue) */}
          <div className="md:col-span-3">
            <Label className="text-xs font-bold text-sus-950 flex items-center gap-1.5 mb-1.5">
              <FlaskConical className="h-3.5 w-3.5 text-purple-600" /> Fila de Laboratório
            </Label>
            <Combobox
              value={filtroFilaId}
              onChange={setFiltroFilaId}
              options={opcoesFiltroFilas}
              placeholder="Todas as filas de sangue…"
              searchPlaceholder="Digite o nome da fila…"
              emptyText="Nenhuma fila encontrada"
              showAll={false}
              className="h-10 text-xs"
            />
          </div>

          {/* Busca Geral / Paciente */}
          <div className="md:col-span-3">
            <Label className="text-xs font-bold text-sus-950 flex items-center gap-1.5 mb-1.5">
              <Search className="h-3.5 w-3.5 text-teal" /> Paciente ou Procedimento
            </Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink/40" />
              <Input
                value={termoBusca}
                onChange={(e) => setTermoBusca(e.target.value)}
                placeholder="Nº do pedido, nome, CPF, prontuário ou exame…"
                className="pl-9 h-10 text-xs bg-white"
              />
              {termoBusca && (
                <button
                  type="button"
                  onClick={() => setTermoBusca("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink/40 hover:text-ink/80 transition"
                  title="Limpar busca"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Busca por PSF / Unidade de Origem */}
          <div className="md:col-span-2">
            <Label className="text-xs font-bold text-sus-950 flex items-center gap-1.5 mb-1.5">
              <Building2 className="h-3.5 w-3.5 text-teal" /> PSF / Unidade
            </Label>
            <Combobox
              value={filtroUnidade}
              onChange={setFiltroUnidade}
              options={opcoesFiltroUnidades}
              placeholder="Todas as unidades…"
              searchPlaceholder="Digite o nome do PSF…"
              emptyText="Nenhuma unidade encontrada"
              showAll={false}
              className="h-10 text-xs"
            />
          </div>

          {/* Período: Data Inicial e Data Final */}
          <div className="md:col-span-2">
            <Label className="text-xs font-bold text-sus-950 flex items-center gap-1.5 mb-1.5">
              <Calendar className="h-3.5 w-3.5 text-teal" /> Período
            </Label>
            <div className="grid grid-cols-2 gap-1.5">
              <Input
                type="date"
                value={dataDe}
                onChange={(e) => setDataDe(e.target.value)}
                title="Data inicial do pedido"
                className="h-10 text-[11px] px-1"
              />
              <Input
                type="date"
                value={dataAte}
                onChange={(e) => setDataAte(e.target.value)}
                title="Data final do pedido"
                className="h-10 text-[11px] px-1"
              />
            </div>
          </div>

          {/* Status e Ações */}
          <div className="md:col-span-2 flex items-center gap-2">
            <div className="flex-1">
              <Label className="text-xs font-bold text-sus-950 mb-1.5 block">
                Status
              </Label>
              <Select
                value={filtroStatus}
                onChange={(e) => setFiltroStatus(e.target.value)}
                className="!h-10 text-xs font-medium text-sus-950"
              >
                <option value="todos">Todos</option>
                <option value="na_fila">Na Fila (Aguardando)</option>
                <option value="fora_da_fila">Já Saíram da Fila</option>
                <option value="agendado">Agendado</option>
                <option value="realizado">Realizado</option>
                <option value="cancelado">Cancelado</option>
              </Select>
            </div>

            <Button
              type="button"
              onClick={() => setFiltrosAvancados(!filtrosAvancados)}
              className={`h-10 px-2.5 text-xs font-bold border transition mt-auto shrink-0 ${
                filtrosAvancados || filtroEspecialidade || filtroPrioridade || filtroStatus === "fora_da_fila"
                  ? "bg-teal text-white border-teal"
                  : "bg-white text-sus-900 border-sus-900/20 hover:bg-sand"
              }`}
              title="Filtros avançados da fila de espera"
            >
              <Filter className="h-3.5 w-3.5" />
            </Button>

            {temFiltroAtivo && (
              <Button
                type="button"
                onClick={limparFiltros}
                className="h-10 px-3 bg-white border border-sus-900/15 text-sus-900 hover:bg-sand text-xs mt-auto shrink-0"
                title="Limpar todos os filtros"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* Chips/Pills Dinâmicos de Seleção Rápida de Filas de Sangue */}
        {filasLab.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-2.5 border-t border-sus-900/10">
            <span className="text-[11px] font-semibold text-slate-500 mr-1 flex items-center gap-1">
              <Layers className="w-3.5 h-3.5 text-purple-600" /> Filas de Sangue:
            </span>
            <button
              type="button"
              onClick={() => setFiltroFilaId("")}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition cursor-pointer ${
                !filtroFilaId
                  ? "bg-purple-700 text-white shadow-xs"
                  : "bg-slate-100 hover:bg-slate-200 text-slate-700"
              }`}
            >
              Todas ({total})
            </button>
            {filasLab.map((f) => {
              const ativo = filtroFilaId === String(f.id);
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFiltroFilaId(ativo ? "" : String(f.id))}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition cursor-pointer flex items-center gap-1 ${
                    ativo
                      ? "bg-purple-700 text-white shadow-xs font-bold"
                      : "bg-purple-50 hover:bg-purple-100 text-purple-800 border border-purple-200/60"
                  }`}
                  title={`Filtrar apenas pedidos da fila ${f.nome}`}
                >
                  {f.nome}
                </button>
              );
            })}
          </div>
        )}

        {/* Painel Expansível de Filtros Avançados */}
        {filtrosAvancados && (
          <div className="p-3.5 bg-sand/40 border border-teal/20 rounded-xl grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
            <div>
              <Label className="text-xs font-bold text-sus-950 mb-1 block">
                Prioridade
              </Label>
              <Select
                value={filtroPrioridade}
                onChange={(e) => setFiltroPrioridade(e.target.value)}
                className="!h-9 text-xs font-medium text-sus-950 bg-white"
              >
                <option value="">Todas as prioridades</option>
                <option value="rotina">Rotina</option>
                <option value="urgente">Urgente</option>
                <option value="alta">Alta</option>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-bold text-sus-950 mb-1 block">
                Especialidade Solicitante
              </Label>
              <Input
                value={filtroEspecialidade}
                onChange={(e) => setFiltroEspecialidade(e.target.value)}
                placeholder="Filtrar por especialidade médica…"
                className="h-9 text-xs bg-white"
              />
            </div>
            <div>
              <Label className="text-xs font-bold text-sus-950 mb-1 block">
                Pesquisar Pedidos que já Saíram da Fila
              </Label>
              <Select
                value={filtroStatus}
                onChange={(e) => setFiltroStatus(e.target.value)}
                className="!h-9 text-xs font-medium text-sus-950 bg-white"
              >
                <option value="todos">Todos os Pedidos (Histórico Completo)</option>
                <option value="na_fila">Apenas na Fila (Aguardando)</option>
                <option value="fora_da_fila">✓ Apenas Pedidos que já Saíram da Fila</option>
                <option value="agendado">Somente Agendados</option>
                <option value="realizado">Somente Realizados</option>
                <option value="cancelado">Somente Cancelados</option>
              </Select>
            </div>
            <div>
              <Button
                type="button"
                onClick={() => carregar(1)}
                className="h-9 w-full bg-teal text-white text-xs font-bold flex items-center justify-center gap-1.5"
              >
                <Search className="h-3.5 w-3.5" /> Aplicar Filtros Avançados
              </Button>
            </div>
          </div>
        )}

        {/* Resumo dos filtros ativos */}
        <div className="flex flex-wrap items-center justify-between text-[11px] text-ink/60 pt-2 border-t border-sus-900/5 gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span>
              Total filtrado: <strong>{total}</strong> pedido(s) · Exibindo <strong>{lista.length}</strong> nesta página
            </span>
            {carregando && (
              <span className="text-teal font-semibold animate-pulse flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-teal animate-ping" />
                Atualizando lista…
              </span>
            )}
          </div>

          {temFiltroAtivo && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-teal font-medium">Filtros ativos:</span>
              {filtroUnidade && (
                <span className="rounded-md bg-teal/10 px-1.5 py-0.5 text-teal font-semibold">
                  PSF: {filtroUnidade}
                </span>
              )}
              {filtroPrioridade && (
                <span className="rounded-md bg-teal/10 px-1.5 py-0.5 text-teal font-semibold">
                  Prioridade: {filtroPrioridade}
                </span>
              )}
              {filtroEspecialidade.trim() && (
                <span className="rounded-md bg-teal/10 px-1.5 py-0.5 text-teal font-semibold">
                  Especialidade: {filtroEspecialidade.trim()}
                </span>
              )}
              {(dataDe || dataAte) && (
                <span className="rounded-md bg-teal/10 px-1.5 py-0.5 text-teal font-semibold">
                  Período: {dataDe ? fmtData(dataDe) : "Início"} até {dataAte ? fmtData(dataAte) : "Hoje"}
                </span>
              )}
              {termoBusca.trim() && (
                <span className="rounded-md bg-teal/10 px-1.5 py-0.5 text-teal font-semibold">
                  Busca: "{termoBusca.trim()}"
                </span>
              )}
              {filtroStatus !== "todos" && (
                <span className="rounded-md bg-teal/10 px-1.5 py-0.5 text-teal font-semibold">
                  Status: {filtroStatus}
                </span>
              )}
              <button
                type="button"
                onClick={limparFiltros}
                className="text-xs text-red-600 hover:underline font-semibold ml-1"
              >
                Limpar
              </button>
            </div>
          )}
        </div>
      </Card>

      {/* Tabela de Pedidos na Fila */}
      <Card className="overflow-hidden border-sus-900/10 shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-sus-900/10 bg-sand text-xs uppercase text-sus-900/60">
                <th className="px-4 py-3 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={lista.length > 0 && selecionados.size === lista.length}
                    onChange={toggleSelecionarTodos}
                    className="h-4 w-4 rounded border-sus-900/20 text-teal focus:ring-teal"
                    title="Selecionar todos os pedidos desta página"
                  />
                </th>
                <th className="px-4 py-3 font-semibold">Nº Pedido</th>
                <th className="px-4 py-3 font-semibold">Data Pedido</th>
                <th className="px-4 py-3 font-semibold">Paciente</th>
                <th className="px-4 py-3 font-semibold">Fila / Especialidade</th>
                <th className="px-4 py-3 font-semibold">PSF / Origem</th>
                <th className="px-4 py-3 font-semibold">Médico</th>
                <th className="px-4 py-3 font-semibold">Exames</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 text-right font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((f) => {
                const isSelected = selecionados.has(f.id);
                const numPedido = f.codigo_solicitacao || f.numero_pedido || `#${f.id}`;
                const espera = tempoEspera(f.data_pedido || f.data_solicitacao);
                const endResumo = [f.paciente_endereco, f.paciente_numero ? `nº ${f.paciente_numero}` : "", f.paciente_bairro].filter(Boolean).join(" · ");
                return (
                  <tr
                    key={f.id}
                    onClick={() => setDetalheItem(f)}
                    className={`border-b border-sus-900/5 last:border-0 hover:bg-sand/30 transition cursor-pointer ${
                      isSelected ? "bg-teal/5" : ""
                    }`}
                  >
                    <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelecionado(f.id)}
                        className="h-4 w-4 rounded border-sus-900/20 text-teal focus:ring-teal"
                      />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className="inline-flex items-center rounded bg-sus-900/10 px-2 py-0.5 text-[11px] font-mono font-bold text-sus-900"
                        title={`Protocolo do Pedido (#${f.id})`}
                      >
                        {numPedido}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs font-semibold text-sus-950 whitespace-nowrap">
                      <div>{fmtData(f.data_pedido || f.data_solicitacao)}</div>
                      {espera && (
                        <span className="text-[10px] font-medium text-amber-800">
                          há {espera}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="font-semibold text-sus-950">{f.paciente_nome}</p>
                        {f.paciente_obito_ou_mudanca && (
                          <span
                            className="inline-flex items-center gap-1 rounded bg-rose-100 text-rose-800 border border-rose-300 px-1.5 py-0.5 text-[10px] font-bold shadow-xs animate-pulse"
                            title={f.paciente_motivo_situacao ? `${f.alerta_situacao}: ${f.paciente_motivo_situacao}` : (f.alerta_situacao || "Paciente com pendência cadastral")}
                          >
                            <AlertTriangle className="h-3 w-3 text-rose-600 shrink-0" />
                            {f.alerta_situacao || "Óbito / Mudança"}
                          </span>
                        )}
                      </div>
                      {endResumo && (
                        <div className="mt-0.5 flex items-center gap-1 text-[11px] text-ink/60 truncate max-w-[280px]" title={endResumo}>
                          <MapPin className="h-3 w-3 shrink-0 text-teal" />
                          <span className="truncate">{endResumo}</span>
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-2 text-xs text-ink/50 mt-0.5">
                        {f.paciente_cpf && <span>CPF: {f.paciente_cpf}</span>}
                        {f.paciente_prontuario && <span>Pront.: {f.paciente_prontuario}</span>}
                        {(f.criado_por_nome || f.criado_por) && (
                          <span title={`Inserido por ${f.criado_por_nome || f.criado_por}`}>
                            · Por: <strong className="font-semibold text-sus-900">{f.criado_por_nome || f.criado_por}</strong>
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap">
                      {f.tipo_fila ? (
                        <span className="inline-block bg-purple-50 text-purple-700 border border-purple-200/60 px-1.5 py-0.5 rounded text-[10px] font-semibold mr-1.5">
                          {f.tipo_fila}
                        </span>
                      ) : null}
                      {f.especialidade &&
                      f.especialidade.trim().toUpperCase() !== (f.tipo_fila || "").trim().toUpperCase() ? (
                        <span className="font-semibold text-teal">{f.especialidade}</span>
                      ) : !f.tipo_fila ? (
                        <span className="font-semibold text-teal">Geral</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink/75 font-medium">{f.unidade_psf}</td>
                    <td className="px-4 py-3 text-xs text-ink/75">{f.medico}</td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      {f.exames_nomes && f.exames_nomes.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => setDetalheItem(f)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-teal/10 hover:bg-teal/20 px-2.5 py-1 text-xs font-bold text-teal transition cursor-pointer"
                          title="Clique para ver os exames detalhados deste pedido"
                        >
                          📋 {f.exames_nomes.length} {f.exames_nomes.length === 1 ? "exame" : "exames"}
                        </button>
                      ) : (
                        <span className="text-ink/40 text-[11px]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div className="flex flex-col gap-1">
                        {f.status === "agendado" ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="inline-flex items-center gap-1 w-fit rounded-md bg-teal/15 px-2 py-0.5 font-bold text-teal border border-teal/30 text-[11px]">
                              <CalendarDays className="h-3 w-3" /> Agendado
                            </span>
                            {(f.data_agendada || f.data_solicitacao) && (
                              <span className="text-[10px] text-ink/65 font-medium">
                                p/ {fmtData(f.data_agendada || f.data_solicitacao)} {f.hora_agendada ? `às ${f.hora_agendada}` : ""}
                              </span>
                            )}
                          </div>
                        ) : f.status === "na_fila" || f.status === "aguardando" ? (
                          <span className="inline-flex items-center gap-1 w-fit rounded-md bg-amber-50 px-2 py-0.5 font-semibold text-amber-700 border border-amber-200">
                            Na Fila (Aguardando)
                          </span>
                        ) : f.status === "realizado" ? (
                          <span className="inline-flex items-center gap-1 w-fit rounded-md bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700 border border-emerald-200">
                            <CheckCircle2 className="h-3 w-3" /> Realizado
                          </span>
                        ) : (
                          <span className="w-fit rounded-md bg-slate-100 px-2 py-0.5 font-semibold text-slate-600 border border-slate-200">
                            {f.status}
                          </span>
                        )}
                        {f.prioridade && f.prioridade !== "rotina" && (
                          <span
                            className={`w-fit rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                              f.prioridade === "urgente"
                                ? "bg-rose-100 text-rose-800 border border-rose-300"
                                : "bg-orange-100 text-orange-800 border border-orange-300"
                            }`}
                          >
                            {f.prioridade}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setComprovanteFilaId(f.id)}
                          className="rounded-lg p-1.5 text-teal hover:bg-teal/10 transition"
                          title="Imprimir Comprovante de Inclusão na Fila"
                        >
                          <Printer className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDetalheItem(f)}
                          className="rounded-lg p-1.5 text-sus-900 hover:bg-sand transition"
                          title="Ver detalhes do pedido"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        {podeEditar && (
                          <button
                            type="button"
                            onClick={() => abrirModalEditar(f)}
                            className="rounded-lg p-1.5 text-teal hover:bg-teal/10 transition"
                            title="Editar pedido"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                        )}
                        {podeExcluir && (
                          <button
                            type="button"
                            onClick={() => excluir(f.id)}
                            className="rounded-lg p-1.5 text-red-600 hover:bg-red-50 transition"
                            title="Remover da fila"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {lista.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-ink/45">
                    Nenhum pedido aguardando na fila de exames.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Paginacao
          page={page}
          pages={pages}
          total={total}
          onPage={(p) => carregar(p).catch(() => setErro("Falha ao carregar fila."))}
        />
      </Card>

      {/* DIALOG (MODAL) PARA NOVO OU EDITAR PEDIDO NA FILA */}
      {modalAberto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-sus-950/60 p-3 sm:p-5"
          {...modalBackdrop}
        >
          <div
            className="rise max-h-[92vh] w-full max-w-6xl overflow-y-auto rounded-3xl bg-white p-6 sm:p-8 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Cabeçalho do Dialog */}
            <div className="mb-5 flex items-start justify-between border-b border-sus-900/10 pb-4">
              <div>
                <h3 className="font-display text-lg font-bold text-sus-950 flex items-center gap-2">
                  <FlaskConical className="h-5 w-5 text-teal" />
                  {itemEditando ? "Editar pedido na fila de exames" : "Novo pedido na fila de exames"}
                </h3>
                <p className="mt-1 text-xs text-ink/65">
                  Os pedidos lançados pelos PSFs aguardam o loteamento mensal de vagas gerido pela Secretaria de Saúde.
                </p>
              </div>
              <button
                type="button"
                onClick={fecharModal}
                className="rounded-xl p-2 text-ink/50 hover:bg-sand transition"
                title="Fechar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Formulário em 2 Colunas (SIGTAP à direita) */}
            <div className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                {/* Coluna da Esquerda: Paciente, Origem e Justificativa */}
                <div className="space-y-4">
                  {/* Seção 1: Paciente e Origem do Pedido */}
                  <div className="rounded-2xl border border-sus-900/10 p-4 space-y-3">
                    <h4 className="text-xs font-bold uppercase tracking-wide text-sus-900/70 flex items-center gap-1.5">
                      <User className="h-3.5 w-3.5 text-teal" /> 1. Paciente e Origem do Pedido
                    </h4>

                    <BuscaPacienteAutocomplete
                      pacienteId={form.paciente_id}
                      pacienteInicial={pacienteSelecionado}
                      onSelect={(p) => {
                        setPacienteSelecionado(p);
                        if (!p) {
                          set("paciente_id", "");
                          return;
                        }
                        const unidPac =
                          !itemEditando && !usuarioRestritoUnidade && p.unidade_saude_id
                            ? unidades.find((u) => u.id === p.unidade_saude_id)
                            : undefined;
                        const unidNomeFallback =
                          !itemEditando && !usuarioRestritoUnidade && !unidPac
                            ? ((p as any).unidade_nome || "").trim()
                            : "";
                        setForm((prev) => ({
                          ...prev,
                          paciente_id: String(p.id),
                          ...(unidPac
                            ? { unidade_psf: unidPac.nome, unidade_saude_id: String(unidPac.id) }
                            : unidNomeFallback
                            ? { unidade_psf: unidNomeFallback, unidade_saude_id: String(p.unidade_saude_id || "") }
                            : {}),
                        }));
                      }}
                      label="Paciente"
                      obrigatorio
                    />

                    {/* Endereço e dados cadastrais do paciente logo abaixo do seletor */}
                    {pacienteSelecionado && (
                      <div className="rounded-xl border border-sus-900/10 bg-sand/30 p-3 text-xs space-y-1.5">
                        <div className="flex flex-wrap gap-x-4 gap-y-1">
                          {pacienteSelecionado.cpf && (
                            <span>
                              <span className="text-ink/60">CPF:</span>{" "}
                              <strong className="font-mono text-sus-950">{pacienteSelecionado.cpf}</strong>
                            </span>
                          )}
                          {pacienteSelecionado.cns && (
                            <span>
                              <span className="text-ink/60">CNS:</span>{" "}
                              <strong className="font-mono text-sus-950">{pacienteSelecionado.cns}</strong>
                            </span>
                          )}
                          {pacienteSelecionado.codigo_prontuario && (
                            <span>
                              <span className="text-ink/60">Pront.:</span>{" "}
                              <strong className="font-mono text-sus-950">{pacienteSelecionado.codigo_prontuario}</strong>
                            </span>
                          )}
                        </div>
                        <div className="flex items-start gap-1.5 text-ink/80">
                          <MapPin className="h-3.5 w-3.5 shrink-0 text-teal mt-0.5" />
                          <span>
                            <strong className="text-sus-950">Endereço:</strong>{" "}
                            {formatarEnderecoPaciente(pacienteSelecionado) || "Endereço não informado no cadastro"}
                          </span>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
                      <div>
                        <div className="flex items-center min-h-[26px] mb-1.5">
                          <Label className="!mb-0 flex items-center gap-1.5">
                            <Calendar className="h-3.5 w-3.5 text-teal" /> Data do Pedido *
                          </Label>
                        </div>
                        <Input
                          type="date"
                          value={form.data_pedido || form.data_solicitacao}
                          onChange={(e) => {
                            set("data_pedido", e.target.value);
                            set("data_solicitacao", e.target.value);
                          }}
                          required
                        />
                        <p className="mt-1 text-[11px] text-ink/50">
                          Data da requisição médica.
                        </p>
                      </div>

                      <div>
                        <div className="flex items-center min-h-[26px] mb-1.5">
                          <Label className="!mb-0 flex items-center gap-1.5">
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-600" /> Prioridade
                          </Label>
                        </div>
                        <Select
                          value={form.prioridade}
                          onChange={(e) => set("prioridade", e.target.value)}
                          className="text-xs !h-9"
                        >
                          <option value="rotina">Rotina</option>
                          <option value="urgente">Urgente</option>
                          <option value="alta">Alta</option>
                        </Select>
                        <p className="mt-1 text-[11px] text-ink/50">
                          Classificação clínica do pedido.
                        </p>
                      </div>

                      <div>
                        <div className="flex items-center min-h-[26px] mb-1.5">
                          <Label className="!mb-0 flex items-center gap-1.5">
                            <FlaskConical className="h-3.5 w-3.5 text-purple-600" /> Fila de Sangue
                          </Label>
                        </div>
                        <Select
                          value={form.fila_id}
                          onChange={(e) => {
                            const val = e.target.value;
                            const fObj = filasLab.find((f) => String(f.id) === val);
                            setForm((prev) => ({
                              ...prev,
                              fila_id: val,
                              tipo_fila: fObj ? fObj.nome : prev.tipo_fila,
                              especialidade: prev.especialidade || (fObj ? fObj.nome : ""),
                            }));
                          }}
                          className="text-xs !h-9"
                        >
                          <option value="">Selecione a fila…</option>
                          {filasLab.map((f) => (
                            <option key={f.id} value={String(f.id)}>
                              {f.nome}
                            </option>
                          ))}
                        </Select>
                        <p className="mt-1 text-[11px] text-ink/50">
                          Fila do laboratório.
                        </p>
                      </div>

                      <div>
                        <div className="flex items-center min-h-[26px] mb-1.5">
                          <Label className="!mb-0 flex items-center gap-1.5">
                            <Building2 className="h-3.5 w-3.5 text-teal" /> Especialidade *
                          </Label>
                        </div>
                        <Input
                          value={form.especialidade}
                          onChange={(e) => set("especialidade", e.target.value)}
                          placeholder="Ex: Clínica Geral, Pediatria…"
                          required
                          list="especialidades-lab-datalist"
                          className="text-xs"
                        />
                        <datalist id="especialidades-lab-datalist">
                          {listaEspecialidades.map((esp) => (
                            <option key={esp.id} value={esp.nome}>
                              {esp.codigo_cbo ? `CBO ${esp.codigo_cbo} · ` : ""}{esp.nome}
                            </option>
                          ))}
                        </datalist>
                        <p className="mt-1 text-[11px] text-ink/50">
                          Especialidade solicitante.
                        </p>
                      </div>

                      <div>
                        <div className="flex items-center min-h-[26px] mb-1.5">
                          <Label className="!mb-0 flex items-center gap-1.5">
                            <Building2 className="h-3.5 w-3.5 text-teal" /> PSF / Unidade *
                          </Label>
                        </div>
                        <Combobox
                          value={form.unidade_psf}
                          onChange={(v) => {
                            const uObj = unidades.find((u) => u.nome === v);
                            setForm((prev) => ({
                              ...prev,
                              unidade_psf: v,
                              unidade_saude_id: uObj ? String(uObj.id) : "",
                            }));
                          }}
                          options={opcoesUnidades}
                          placeholder="Buscar unidade de saúde…"
                          searchPlaceholder="Digite o nome da unidade…"
                          emptyText="Nenhuma unidade encontrada"
                          showAll={false}
                        />
                        {pacienteSelecionado?.unidade_saude_id &&
                        String(pacienteSelecionado.unidade_saude_id) === form.unidade_saude_id ? (
                          <p className="mt-1 text-[11px] text-teal font-medium">
                            ✓ Unidade vinculada ao cadastro do paciente
                          </p>
                        ) : user?.unidade_saude_nome && form.unidade_psf === user.unidade_saude_nome ? (
                          <p className="mt-1 text-[11px] text-teal font-medium">
                            ✓ Unidade vinculada ao seu usuário
                          </p>
                        ) : (
                          <p className="mt-1 text-[11px] text-ink/50">
                            Posto de saúde requisitante.
                          </p>
                        )}
                      </div>

                      <div>
                        <div className="flex items-center justify-between min-h-[26px] mb-1.5">
                          <Label className="!mb-0 flex items-center gap-1.5">
                            <Stethoscope className="h-3.5 w-3.5 text-teal" /> Médico(a) *
                          </Label>
                          <button
                            type="button"
                            onClick={() => {
                              setForm((prev) => ({
                                ...prev,
                                medico: MEDICO_GENERICO,
                                especialidade: prev.especialidade || "Clínica Geral",
                              }));
                            }}
                            className="inline-flex items-center rounded-md bg-teal/10 px-2 py-0.5 text-[10px] font-bold text-teal hover:bg-teal/20 transition"
                            title="Redefinir para Médico da Unidade"
                          >
                            🏥 Médico Unidade
                          </button>
                        </div>
                        <Combobox
                          value={form.medico}
                          onChange={(v) => {
                            const medObj = medicos.find((m) => m.nome === v);
                            const espMed = (medObj?.especialidade || (medObj?.especialidades ? medObj.especialidades.split(",")[0].trim() : "") || "").trim();
                            setForm((prev) => ({
                              ...prev,
                              medico: v,
                              especialidade: espMed || prev.especialidade,
                            }));
                          }}
                          options={opcoesMedicos}
                          placeholder="Buscar médico requisitante…"
                          searchPlaceholder="Digite o nome do médico ou CRM…"
                          emptyText="Nenhum médico encontrado"
                          showAll={false}
                        />
                        <p className="mt-1 text-[11px] text-ink/50">
                          Médico(a) solicitante.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Seção 3: Justificativa Clínica e Observações */}
                  <div className="rounded-2xl border border-sus-900/10 p-4 space-y-3">
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <Label className="!mb-0">3. Justificativa Clínica do Pedido *</Label>
                        <span
                          className={`text-[11px] font-bold ${
                            form.justificativa.trim().length < 12 ? "text-amber-600" : "text-teal"
                          }`}
                        >
                          {form.justificativa.trim().length}/12 caracteres mínimos
                        </span>
                      </div>
                      <textarea
                        rows={3}
                        maxLength={500}
                        value={form.justificativa}
                        onChange={(e) => set("justificativa", e.target.value)}
                        placeholder="Informe a indicação/justificativa clínica do pedido de exames (mínimo de 12 caracteres)..."
                        className={`w-full rounded-xl border bg-white px-3 py-2 text-xs outline-none transition focus:border-teal ${
                          form.justificativa.length > 0 && form.justificativa.trim().length < 12
                            ? "border-red-400 focus:border-red-500"
                            : "border-sus-900/15"
                        }`}
                      />
                      {form.justificativa.trim().length > 0 && form.justificativa.trim().length < 12 && (
                        <p className="mt-1 text-[11px] text-red-600 font-medium">
                          A justificativa deve conter pelo menos 12 caracteres para validar o pedido.
                        </p>
                      )}
                    </div>

                    <div>
                      <Label>Observações Adicionais (opcional)</Label>
                      <Input
                        placeholder="Orientações específicas, sintomas, prioridades…"
                        value={form.obs}
                        onChange={(e) => set("obs", e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                {/* Coluna da Direita: Procedimentos SIGTAP (Exames de Sangue) */}
                <div className="space-y-4">
                  <div className="rounded-2xl border border-sus-900/10 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold uppercase tracking-wide text-sus-900/70 flex items-center gap-1.5">
                        <FlaskConical className="h-3.5 w-3.5 text-teal" /> 2. Procedimentos SIGTAP *
                      </h4>
                      <span className="text-xs font-bold text-teal">
                        {totalItens} {totalItens === 1 ? "exame adicionado" : "exames adicionados"}
                      </span>
                    </div>

                    <div className="relative">
                      <Search className="absolute left-3 top-3 h-4 w-4 text-ink/40" />
                      <Input
                        className="pl-9 pr-8"
                        placeholder="Buscar código ou nome do exame laboratorial na tabela SIGTAP…"
                        value={buscaSig}
                        onChange={(e) => setBuscaSig(e.target.value)}
                      />
                      {buscaSig && (
                        <button
                          type="button"
                          onClick={() => setBuscaSig("")}
                          className="absolute right-2.5 top-2.5 text-ink/40 hover:text-ink/80 transition"
                          title="Limpar busca de exame"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>

                    {feedbackExame && (
                      <div className="flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                        <span className="truncate">{feedbackExame}</span>
                      </div>
                    )}

                    {/* Resultados da busca */}
                    <div className="max-h-48 space-y-1 overflow-auto rounded-xl border border-sus-900/10 p-2 bg-sand/30">
                      {sigtap.slice(0, 30).map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => adicionarSig(s)}
                          className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-white transition"
                        >
                          <Plus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal" />
                          <span>
                            <b>{s.codigo}</b> · {s.descricao}
                          </span>
                        </button>
                      ))}
                      {buscaSig.trim() && sigtap.length === 0 && (
                        <p className="py-2 text-center text-xs text-ink/45">
                          Nenhum exame encontrado para "{buscaSig}".
                        </p>
                      )}
                      {!buscaSig.trim() && sigtap.length === 0 && (
                        <p className="py-2 text-center text-xs text-ink/45">
                          Digite para buscar exames laboratoriais na tabela SIGTAP.
                        </p>
                      )}
                    </div>

                    {/* Lista de itens selecionados */}
                    <div className="space-y-1.5 max-h-64 overflow-y-auto">
                      {itens.map((i) => (
                        <div
                          key={i.sigtap.id}
                          className="flex items-center gap-2 rounded-xl border border-sus-900/10 bg-white p-2 text-xs"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-semibold text-sus-950">
                              <b>{i.sigtap.codigo || `#${i.sigtap.id}`}</b> · {i.sigtap.descricao}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setQtd(i.sigtap.id, i.quantidade - 1)}
                              className="rounded-lg p-1 text-sus-900 hover:bg-sand"
                              title="Diminuir"
                            >
                              <Minus className="h-3 w-3" />
                            </button>
                            <input
                              type="number"
                              min={1}
                              max={99}
                              value={i.quantidade}
                              onChange={(e) => setQtd(i.sigtap.id, Number(e.target.value))}
                              className="w-12 rounded-lg border border-sus-900/15 px-1.5 py-0.5 text-center text-xs font-bold"
                            />
                            <button
                              type="button"
                              onClick={() => setQtd(i.sigtap.id, i.quantidade + 1)}
                              className="rounded-lg p-1 text-sus-900 hover:bg-sand"
                              title="Aumentar"
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => removerItem(i.sigtap.id)}
                            className="rounded-lg p-1 text-red-600 hover:bg-red-50"
                            title="Excluir item"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                      {itens.length === 0 && (
                        <p className="rounded-xl bg-sand/60 px-3 py-2.5 text-center text-xs text-ink/50">
                          Nenhum exame adicionado ao pedido ainda. Pesquise e adicione acima.
                        </p>
                      )}
                    </div>
                  </div>

                  {/* ALERTA DE DUPLICIDADE EM TEMPO REAL */}
                  {duplicidadeFila && !ignorarDuplicidadeFila && (
                    <AlertaPedidoDuplicado
                      pedido={duplicidadeFila}
                      tipoModulo="lab"
                      onProsseguir={() => setIgnorarDuplicidadeFila(true)}
                      onCancelar={() => {
                        setItens([]);
                        setDuplicidadeFila(null);
                      }}
                    />
                  )}
                </div>
              </div>

              {erro && (
                <div className="rounded-xl bg-red-50 p-3 text-xs text-red-700 font-medium">
                  {erro}
                </div>
              )}

              {/* Botões do Rodapé */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-sus-900/10">
                <Button
                  type="button"
                  onClick={fecharModal}
                  className="border border-sus-900/15 bg-white text-ink hover:bg-sand"
                >
                  Cancelar
                </Button>
                <Button onClick={salvarPedido} disabled={salvando}>
                  <CheckCircle2 className="h-4 w-4" />
                  {salvando
                    ? "Salvando…"
                    : itemEditando
                    ? "Salvar alterações"
                    : "Confirmar inclusão na fila"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE AGENDAMENTO EM LOTE MENSAL */}
      {modalLote && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-sus-950/60 p-3 sm:p-5"
          {...loteBackdrop}
        >
          <div
            className="rise max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between border-b border-sus-900/10 pb-3">
              <div>
                <h3 className="font-display text-base font-bold text-sus-950 flex items-center gap-2">
                  <Layers className="h-5 w-5 text-teal" />
                  Marcação mensal em lote ({selecionados.size} pedidos)
                </h3>
                <p className="mt-0.5 text-xs text-ink/65">
                  Agende os pedidos selecionados para o laboratório conveniado de destino.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalLote(false)}
                className="rounded-xl p-2 text-ink/50 hover:bg-sand transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <Label>Laboratório Conveniado *</Label>
                <Select
                  value={loteLabId}
                  onChange={(e) => setLoteLabId(e.target.value)}
                >
                  {labs.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.nome} {l.cnes ? `(CNES: ${l.cnes})` : ""}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Data do Agendamento *</Label>
                  <Input
                    type="date"
                    value={loteData}
                    onChange={(e) => setLoteData(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Horário da Coleta</Label>
                  <Input
                    type="text"
                    value={loteHora}
                    onChange={(e) => setLoteHora(e.target.value)}
                    placeholder="07:00"
                  />
                </div>
              </div>

              <div>
                <Label className="flex items-center gap-1.5">
                  <Bus className="h-3.5 w-3.5 text-teal" />
                  Instruções Adicionais / Transporte para o Paciente
                </Label>
                <textarea
                  value={loteInstrucoes}
                  onChange={(e) => setLoteInstrucoes(e.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder="Ex: Aguardar na prefeitura às 07h para o transporte do exame..."
                  className="w-full rounded-xl border border-sus-900/15 bg-white p-2.5 text-xs outline-none focus:border-teal"
                />
                <p className="mt-0.5 text-[10px] text-ink/50">
                  Esse texto será incluído automaticamente no comprovante impresso e na mensagem do WhatsApp.
                </p>
              </div>

              <div className="rounded-xl border border-emerald-500/20 bg-emerald-50/50 p-3">
                <label className="flex items-center gap-2.5 text-xs font-semibold text-emerald-950 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={loteEnviarWhatsapp}
                    onChange={(e) => setLoteEnviarWhatsapp(e.target.checked)}
                    className="h-4 w-4 rounded border-emerald-400 text-teal focus:ring-teal"
                  />
                  <MessageSquare className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span>Enviar confirmação via WhatsApp para os pacientes selecionados</span>
                </label>
              </div>

              <div className="rounded-xl bg-sand/40 p-3 border border-sus-900/10">
                <p className="font-bold text-sus-950 mb-1">
                  Pacientes selecionados para agendamento ({selecionados.size}):
                </p>
                <ul className="list-disc pl-4 space-y-0.5 text-[11px] text-ink/75 max-h-36 overflow-y-auto">
                  {lista
                    .filter((x) => selecionados.has(x.id))
                    .map((x) => (
                      <li key={x.id}>
                        <strong>{x.paciente_nome}</strong> · {x.unidade_psf}
                      </li>
                    ))}
                </ul>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-sus-900/10">
                <Button
                  type="button"
                  onClick={() => setModalLote(false)}
                  className="border border-sus-900/15 bg-white text-ink hover:bg-sand"
                >
                  Cancelar
                </Button>
                <Button onClick={executarAgendamentoLote} disabled={loteSalvando}>
                  <CalendarDays className="h-4 w-4" />
                  {loteSalvando ? "Processando lote..." : "Confirmar Agendamento em Lote"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE DETALHES DO PEDIDO DA FILA */}
      {detalheItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-sus-950/60 p-3 sm:p-5"
          {...detalheBackdrop}
        >
          <div
            className="rise max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-sus-900/10 pb-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-display text-lg font-bold text-sus-950">
                    {detalheItem.paciente_nome}
                  </h3>
                  <span className="inline-flex items-center rounded bg-sus-900/10 px-2 py-0.5 text-xs font-mono font-bold text-sus-900">
                    {detalheItem.codigo_solicitacao || detalheItem.numero_pedido || `#${detalheItem.id}`}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-bold ${
                      detalheItem.status === "agendado"
                        ? "bg-teal/15 text-teal border border-teal/30"
                        : detalheItem.status === "realizado"
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        : "bg-amber-50 text-amber-700 border border-amber-200"
                    }`}
                  >
                    {detalheItem.status === "agendado" ? "Agendado" : detalheItem.status === "realizado" ? "Realizado" : "Na Fila (Aguardando)"}
                  </span>
                  {detalheItem.prioridade && detalheItem.prioridade !== "rotina" && (
                    <span
                      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold uppercase ${
                        detalheItem.prioridade === "urgente"
                          ? "bg-rose-100 text-rose-800 border border-rose-300"
                          : "bg-orange-100 text-orange-800 border border-orange-300"
                      }`}
                    >
                      {detalheItem.prioridade}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-ink/60">
                  {detalheItem.paciente_cpf && <span>CPF: <b>{detalheItem.paciente_cpf}</b></span>}
                  {detalheItem.paciente_cns && <span>CNS: <b>{detalheItem.paciente_cns}</b></span>}
                  {detalheItem.paciente_prontuario && <span>Prontuário: <b>{detalheItem.paciente_prontuario}</b></span>}
                </div>
                {(detalheItem.paciente_endereco || detalheItem.paciente_bairro) && (
                  <div className="mt-1 flex items-center gap-1 text-xs text-ink/70">
                    <MapPin className="h-3.5 w-3.5 text-teal shrink-0" />
                    <span>
                      {[
                        detalheItem.paciente_endereco,
                        detalheItem.paciente_numero ? `nº ${detalheItem.paciente_numero}` : "",
                        detalheItem.paciente_bairro,
                        detalheItem.paciente_municipio,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setDetalheItem(null)}
                className="rounded-xl p-2 text-ink/50 hover:bg-sand transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Informações da Solicitação */}
            <div className="rounded-2xl border border-sus-900/10 p-4 space-y-2 text-xs">
              <h4 className="text-[11px] font-bold uppercase tracking-wide text-sus-900/60">
                Dados da Solicitação
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
                <div>
                  <span className="text-ink/45 block">Especialidade / Fila</span>
                  <span className="font-semibold text-teal">
                    {detalheItem.tipo_fila &&
                    detalheItem.especialidade &&
                    detalheItem.tipo_fila.trim().toUpperCase() === detalheItem.especialidade.trim().toUpperCase()
                      ? detalheItem.tipo_fila
                      : `${detalheItem.especialidade || "Geral"}${
                          detalheItem.tipo_fila &&
                          detalheItem.tipo_fila.trim().toUpperCase() !== (detalheItem.especialidade || "").trim().toUpperCase()
                            ? ` (${detalheItem.tipo_fila})`
                            : ""
                        }`}
                  </span>
                </div>
                <div>
                  <span className="text-ink/45 block">Data do Pedido</span>
                  <span className="font-semibold">{fmtData(detalheItem.data_pedido || detalheItem.data_solicitacao)}</span>
                </div>
                <div>
                  <span className="text-ink/45 block">PSF / Unidade Solicitante</span>
                  <span className="font-semibold">{detalheItem.unidade_psf || "—"}</span>
                </div>
                <div>
                  <span className="text-ink/45 block">Médico(a) Requisitante</span>
                  <span className="font-semibold">{detalheItem.medico || "—"}</span>
                </div>
                <div>
                  <span className="text-ink/45 block">Inserido na Fila por</span>
                  <span className="font-semibold text-sus-950">{detalheItem.criado_por_nome || detalheItem.criado_por || "Sistema / Automático"}</span>
                </div>
                {detalheItem.agendado_por_nome && (
                  <div>
                    <span className="text-ink/45 block">Agendado por</span>
                    <span className="font-semibold text-sus-950">{detalheItem.agendado_por_nome}</span>
                  </div>
                )}
                {detalheItem.data_agendada && (
                  <div>
                    <span className="text-ink/45 block">Data Agendada</span>
                    <span className="font-semibold text-teal">{fmtData(detalheItem.data_agendada)} {detalheItem.hora_agendada ? `às ${detalheItem.hora_agendada}` : ""}</span>
                  </div>
                )}
              </div>

              {detalheItem.justificativa && (
                <div className="mt-2 pt-2 border-t border-sus-900/10">
                  <span className="text-ink/45 block mb-0.5">Justificativa Clínica:</span>
                  <p className="font-medium text-sus-950 bg-sand/30 rounded-xl p-2.5">{detalheItem.justificativa}</p>
                </div>
              )}
              {detalheItem.obs && (
                <div className="mt-1">
                  <span className="text-ink/45 block mb-0.5">Observações:</span>
                  <p className="italic text-ink/70 bg-sand/20 rounded-xl p-2">{detalheItem.obs}</p>
                </div>
              )}
            </div>

            {/* Listagem Completa de Exames */}
            <div className="rounded-2xl border border-teal/20 bg-teal/5 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wide text-sus-900/70 flex items-center gap-1.5">
                  <FlaskConical className="h-4 w-4 text-teal" />
                  Procedimentos e Exames Solicitados ({detalheItem.exames_nomes?.length || 0})
                </h4>
              </div>
              {detalheItem.exames_nomes && detalheItem.exames_nomes.length > 0 ? (
                <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
                  {detalheItem.exames_nomes.map((nome, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between rounded-xl bg-white border border-teal/20 px-3 py-2 text-xs font-semibold text-sus-950 shadow-2xs"
                    >
                      <span className="flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-teal/10 text-[10px] font-bold text-teal">
                          {idx + 1}
                        </span>
                        {nome}
                      </span>
                      {detalheItem.sigtap_ids && detalheItem.sigtap_ids[idx] ? (
                        <span className="font-mono text-[10px] text-ink/50 bg-sand/50 px-2 py-0.5 rounded">
                          SIGTAP #{detalheItem.sigtap_ids[idx]}
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-ink/50 py-2">Nenhum procedimento detalhado.</p>
              )}
            </div>

            {/* Rodapé do Modal de Detalhes */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-sus-900/10">
              <button
                type="button"
                onClick={() => setDetalheItem(null)}
                className="rounded-xl border border-sus-900/15 px-4 py-2 text-xs font-semibold text-ink hover:bg-sand transition"
              >
                Fechar
              </button>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  onClick={() => setComprovanteFilaId(detalheItem.id)}
                  className="border border-teal bg-white text-teal hover:bg-teal/10 flex items-center gap-1.5 text-xs"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Imprimir Comprovante
                </Button>
                {podeEditar && (
                  <Button
                    onClick={() => {
                      const item = detalheItem;
                      setDetalheItem(null);
                      abrirModalEditar(item);
                    }}
                    className="flex items-center gap-1.5 text-xs"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                    Editar Pedido
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DIALOG PÓS-LANÇAMENTO */}
      {pedidoCriado && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-sus-950/60 p-4"
          onClick={() => setPedidoCriado(null)}
        >
          <div
            className="rise w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-sus-900/10 pb-3">
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-emerald-100 text-emerald-700">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-display text-lg font-bold text-sus-950">
                    Pedido incluído na fila com sucesso!
                  </h3>
                  <p className="text-xs text-ink/60">
                    O pedido foi registrado na Fila Municipal de Exames de Sangue.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPedidoCriado(null)}
                className="rounded-xl p-1.5 text-ink/40 hover:bg-sand transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="rounded-2xl border border-teal/25 bg-teal/5 p-4 text-center">
              <span className="text-[11px] font-bold uppercase tracking-wider text-teal block">
                Número do Pedido Gerado
              </span>
              <p className="mt-1 font-mono text-2xl font-black text-sus-950 tracking-wide">
                {pedidoCriado.codigo_solicitacao || pedidoCriado.numero_pedido || `#${pedidoCriado.id}`}
              </p>
            </div>

            <div className="rounded-2xl border border-sus-900/10 bg-sand/30 p-3.5 text-xs space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-ink/55 block text-[11px]">Paciente</span>
                  <strong className="text-sus-950">{pedidoCriado.paciente_nome}</strong>
                </div>
                <div>
                  <span className="text-ink/55 block text-[11px]">Data do Pedido</span>
                  <strong className="text-sus-950">
                    {fmtData(pedidoCriado.data_pedido || pedidoCriado.data_solicitacao)}
                  </strong>
                </div>
                <div>
                  <span className="text-ink/55 block text-[11px]">PSF / Unidade</span>
                  <strong className="text-sus-950">{pedidoCriado.unidade_psf}</strong>
                </div>
                <div>
                  <span className="text-ink/55 block text-[11px]">Fila / Especialidade</span>
                  <strong className="text-teal">
                    {pedidoCriado.tipo_fila || pedidoCriado.especialidade || "Geral"}
                  </strong>
                </div>
              </div>
              {pedidoCriado.exames_nomes && pedidoCriado.exames_nomes.length > 0 && (
                <div className="pt-2 border-t border-sus-900/10">
                  <span className="text-ink/55 block text-[11px] mb-1">
                    Exames Solicitados ({pedidoCriado.exames_nomes.length})
                  </span>
                  <ul className="list-disc pl-4 space-y-0.5 text-sus-950 font-medium max-h-28 overflow-y-auto">
                    {pedidoCriado.exames_nomes.map((nome, idx) => (
                      <li key={idx}>{nome}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                onClick={() => {
                  const fid = pedidoCriado.id;
                  setPedidoCriado(null);
                  setComprovanteFilaId(fid);
                }}
                className="bg-teal hover:bg-teal/90 text-white font-bold flex items-center justify-center gap-2"
              >
                <Printer className="h-4 w-4" />
                Imprimir Comprovante de Inclusão na Fila
              </Button>
              {podeCriar && (
                <Button
                  type="button"
                  onClick={() => {
                    setPedidoCriado(null);
                    abrirModalNovo();
                  }}
                  className="border border-sus-900/15 bg-white text-sus-950 hover:bg-sand"
                >
                  <Plus className="h-4 w-4" />
                  Novo Pedido
                </Button>
              )}
              <Button
                type="button"
                onClick={() => setPedidoCriado(null)}
                className="border border-sus-900/15 bg-white text-ink hover:bg-sand"
              >
                Fechar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DO COMPROVANTE DE INCLUSÃO NA FILA */}
      {comprovanteFilaId !== null && (
        <ComprovanteExameModal
          filaPsfId={comprovanteFilaId}
          onClose={() => setComprovanteFilaId(null)}
        />
      )}

      {modalInelegiveisAberto && (
        <ModalPedidosInelegiveis
          aberto={modalInelegiveisAberto}
          onClose={() => setModalInelegiveisAberto(false)}
          onSuccess={() => {
            setOk("Baixa realizada com sucesso nas solicitações PSF inelegíveis!");
            carregar();
          }}
          tipoFila="psf"
          titulo="Auditoria & Baixa de Pedidos Inelegíveis (Fila PSF)"
        />
      )}
    </div>
  );
}
