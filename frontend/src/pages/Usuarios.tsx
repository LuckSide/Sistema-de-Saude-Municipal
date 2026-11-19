import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Copy,
  KeyRound,
  Link2,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserCog,
  Users,
  X,
} from "lucide-react";
import {
  createUsuario,
  deleteUsuario,
  fetchMedicos,
  fetchUnidadesSaude,
  fetchUsuarios,
  fetchUsuariosResumo,
  labsListar,
  resetSenhaUsuario,
  updateUsuario,
  pagData,
  pagMeta,
  type Laboratorio,
  type Medico,
  type Paciente,
  type UnidadeSaude,
  type Usuario,
  type UsuariosResumo,
} from "../services/api";
import { Badge, Button, Card, Input, Label, Select, cn } from "../components/ui/primitives";
import Paginacao from "../components/Paginacao";
import ExportarExcel from "../components/ExportarExcel";
import PermissoesTree from "../components/PermissoesTree";
import BuscaPacienteAutocomplete from "../components/BuscaPacienteAutocomplete";
import { useConfirm } from "../components/ConfirmDialog";
import { ACOES, MODULOS, concedida, type Acao } from "../permissoes";

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

function sugerirUsername(nome: string): string {
  const limpo = nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (limpo.length === 0) return "";
  if (limpo.length === 1) return limpo[0].slice(0, 30);
  return `${limpo[0]}.${limpo[limpo.length - 1]}`.slice(0, 45);
}

function resumirModulos(telas: string[]): { rotulo: string; qtd: number }[] {
  const resumo: { rotulo: string; qtd: number }[] = [];
  for (const m of MODULOS) {
    const filhos = m.filhos ?? [];
    if (filhos.length === 0) {
      if (telas.includes(m.codigo)) resumo.push({ rotulo: m.rotulo, qtd: 1 });
      continue;
    }
    const marcadas = filhos.filter((f) => concedida(telas, f.codigo)).length;
    if (marcadas > 0 || telas.includes(m.codigo)) {
      resumo.push({ rotulo: m.rotulo, qtd: marcadas || 1 });
    }
  }
  return resumo;
}

const PRESETS_PERMISSAO: { rotulo: string; area: "painel" | "ferramentas"; telas: string[] }[] = [
  {
    rotulo: "Operador TFD",
    area: "painel",
    telas: ["dashboard", "tfd_resumo", "tfd_viagens", "tfd_pacientes", "tfd_exames", "tfd_agenda", "tfd_relatorio_agendados", "tfd_frota", "tfd_motoristas"],
  },
  {
    rotulo: "Recepção PSF",
    area: "painel",
    telas: ["dashboard", "tfd_pacientes", "tfd_fila_lancamento", "lab_fila"],
  },
  {
    rotulo: "Médico",
    area: "painel",
    telas: ["dashboard", "tfd_medico", "tfd_pacientes", "tfd_exames"],
  },
  {
    rotulo: "Laboratório",
    area: "painel",
    telas: ["dashboard", "lab_recepcao", "lab_marcacao", "lab_fila", "lab_agenda"],
  },
  {
    rotulo: "Farmácia",
    area: "painel",
    telas: ["dashboard", "farmacia_estoque", "farmacia_validade", "farmacia_links", "farmacia_insumos"],
  },
  {
    rotulo: "Oxigênio",
    area: "painel",
    telas: ["dashboard", "oxigenio_estoque", "oxigenio_equipamentos", "oxigenio_emprestimos", "oxigenio_empresas", "oxigenio_relatorios"],
  },
];

type Form = {
  username: string;
  nome: string;
  area: string;
  telas: string[];
  acoes: Record<string, Acao[]>;
  medico_id: string;
  unidade_saude_id: string;
  laboratorio_id: string;
  paciente_id: string;
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
  paciente_id: "",
  permite_retroativo: true,
  is_superuser: false,
  is_active: true,
};

function usuarioParaPaciente(u: Usuario): Paciente | null {
  if (!u.paciente_id) return null;
  return {
    id: u.paciente_id,
    nome: u.paciente_nome || u.nome || u.username,
    cpf: u.paciente_cpf || "",
    cns: u.paciente_cns || "",
    nascimento: u.paciente_nascimento ?? null,
    telefone: u.paciente_telefone || "",
    endereco: "",
    endereco_numero: "",
    bairro: "",
    cep: "",
    unidade_saude_id: u.unidade_saude_id ?? null,
    equipe_esf: "",
    acs_nome: "",
    observacoes: "",
  };
}

export default function Usuarios() {
  const { confirmar } = useConfirm();
  const [lista, setLista] = useState<Usuario[]>([]);
  const [resumo, setResumo] = useState<UsuariosResumo | null>(null);
  const [carregando, setCarregando] = useState(false);

  // Busca e filtros
  const [busca, setBusca] = useState("");
  const [filtroArea, setFiltroArea] = useState("");
  const [filtroPerfil, setFiltroPerfil] = useState("");

  // Modal e formulário
  const [form, setForm] = useState<Form>(vazio);
  const [editId, setEditId] = useState<number | null>(null);
  const [editUserObj, setEditUserObj] = useState<Usuario | null>(null);
  const [pacienteVinculado, setPacienteVinculado] = useState<Paciente | null>(null);
  const [usernameEditadoManual, setUsernameEditadoManual] = useState(false);
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
  const [pageSize, setPageSize] = useState(50);

  const [medicos, setMedicos] = useState<Medico[]>([]);
  const [unidades, setUnidades] = useState<UnidadeSaude[]>([]);
  const [labs, setLabs] = useState<Laboratorio[]>([]);

  async function carregar(
    p = page,
    limite = pageSize,
    qVal = busca,
    areaVal = filtroArea,
    filtroVal = filtroPerfil
  ) {
    setCarregando(true);
    try {
      const [r, res] = await Promise.all([
        fetchUsuarios(p, limite, {
          q: qVal.trim() || undefined,
          area: areaVal || undefined,
          filtro: filtroVal || undefined,
        }),
        fetchUsuariosResumo().catch(() => null),
      ]);
      setLista(pagData<Usuario>(r));
      const m = pagMeta(r);
      setTotal(m.total);
      setPage(m.page);
      setPages(m.pages);
      if (res) setResumo(res);
    } catch {
      setErro("Falha ao carregar usuários.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregar(1, pageSize, "", "", "").catch(() => setErro("Falha ao carregar usuários."));
    fetchMedicos().then(setMedicos).catch(() => {});
    fetchUnidadesSaude().then(setUnidades).catch(() => {});
    labsListar().then(setLabs).catch(() => {});
  }, []);

  // Debounce na busca e filtros server-side
  useEffect(() => {
    const t = setTimeout(() => {
      carregar(1, pageSize, busca, filtroArea, filtroPerfil);
    }, 250);
    return () => clearTimeout(t);
  }, [busca, filtroArea, filtroPerfil]);

  function selecionarPessoa(pac: Paciente | null) {
    setPacienteVinculado(pac);
    if (!pac) {
      setForm((f) => ({ ...f, paciente_id: "" }));
      return;
    }
    setForm((f) => {
      const proximoNome = !f.nome.trim() || (!editId && pacienteVinculado?.nome === f.nome)
        ? pac.nome
        : f.nome;
      const proximoUsername =
        !editId && !usernameEditadoManual
          ? sugerirUsername(pac.nome) || f.username
          : f.username;
      const proximaUnidade =
        !f.unidade_saude_id && pac.unidade_saude_id
          ? String(pac.unidade_saude_id)
          : f.unidade_saude_id;
      return {
        ...f,
        paciente_id: String(pac.id),
        nome: proximoNome,
        username: proximoUsername,
        unidade_saude_id: proximaUnidade,
      };
    });
  }

  async function salvar() {
    setErroModal("");
    setOk("");
    setTemporaria(null);

    if (!editId && !form.paciente_id) {
      setErroModal("Selecione a pessoa do município na lista de pacientes para vincular ao novo usuário.");
      return;
    }
    if (!editId && !form.username.trim()) {
      setErroModal("Usuário (login) é obrigatório.");
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
          acoes: sanitizarAcoes(form.acoes),
          medico_id: form.medico_id ? Number(form.medico_id) : null,
          unidade_saude_id: form.unidade_saude_id ? Number(form.unidade_saude_id) : null,
          laboratorio_id: form.laboratorio_id ? Number(form.laboratorio_id) : null,
          paciente_id: form.paciente_id ? Number(form.paciente_id) : null,
          permite_retroativo: form.permite_retroativo,
          is_superuser: form.is_superuser,
          is_active: form.is_active,
        });
        setOk(`Usuário ${form.username} atualizado com sucesso.`);
        fecharModal();
      } else {
        const { medico_id, unidade_saude_id, laboratorio_id, paciente_id, ...resto } = form;
        const r = await createUsuario({
          ...resto,
          medico_id: medico_id ? Number(medico_id) : null,
          unidade_saude_id: unidade_saude_id ? Number(unidade_saude_id) : null,
          laboratorio_id: laboratorio_id ? Number(laboratorio_id) : null,
          paciente_id: paciente_id ? Number(paciente_id) : null,
          gerar_temporaria: true,
        });
        const senha = (r as unknown as { senha_temporaria?: string }).senha_temporaria ?? "";
        setTemporaria({ user: form.username.trim(), senha });
        setOk(`Conta ${form.username.trim()} criada e vinculada com senha temporária.`);
        fecharModal();
      }
      await carregar(page, pageSize, busca, filtroArea, filtroPerfil);
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
      setEditUserObj(u);
      setPacienteVinculado(usuarioParaPaciente(u));
      setUsernameEditadoManual(true);
      setForm({
        username: u.username,
        nome: u.nome,
        area: u.area,
        telas: u.telas,
        acoes: sanitizarAcoes(u.acoes),
        medico_id: u.medico_id ? String(u.medico_id) : "",
        unidade_saude_id: u.unidade_saude_id ? String(u.unidade_saude_id) : "",
        laboratorio_id: u.laboratorio_id ? String(u.laboratorio_id) : "",
        paciente_id: u.paciente_id ? String(u.paciente_id) : "",
        permite_retroativo: u.permite_retroativo !== false,
        is_superuser: u.is_superuser,
        is_active: u.is_active,
      });
    } else {
      setEditId(null);
      setEditUserObj(null);
      setPacienteVinculado(null);
      setUsernameEditadoManual(false);
      setForm(vazio);
    }
    setModal(true);
  }

  function fecharModal() {
    setModal(false);
    setEditId(null);
    setEditUserObj(null);
    setPacienteVinculado(null);
    setUsernameEditadoManual(false);
    setForm(vazio);
    setErroModal("");
  }

  async function resetar(u: Usuario) {
    const confirmado = await confirmar({
      titulo: `Resetar senha de ${u.username}`,
      descricao: `Deseja gerar uma senha temporária para o usuário ${u.username}? O usuário deverá alterá-la no próximo login.`,
      textoConfirmar: "Gerar Senha Temporária",
      variante: "warning",
    });
    if (!confirmado) return;
    setResetando(u.id);
    setErro("");
    setOk("");
    setTemporaria(null);
    try {
      const r = await resetSenhaUsuario(u.id);
      setTemporaria({ user: u.username, senha: r.senha_temporaria });
      setOk(`Senha de ${u.username} resetada. Entregue a senha temporária ao operador.`);
      await carregar(page, pageSize, busca, filtroArea, filtroPerfil);
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
    const userObj = lista.find((x) => x.id === id);
    const confirmado = await confirmar({
      titulo: "Excluir usuário",
      descricao: `Deseja realmente excluir permanentemente a conta de ${userObj?.username || "usuário"}?`,
      textoConfirmar: "Sim, Excluir",
      variante: "danger",
    });
    if (!confirmado) return;
    try {
      await deleteUsuario(id);
      if (editId === id) fecharModal();
      setOk("Usuário excluído.");
      await carregar(page, pageSize, busca, filtroArea, filtroPerfil);
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } }).response?.data
          ?.detail ?? "Erro ao excluir.";
      setErro(msg);
    }
  }

  const temFiltroAtivo = !!(busca.trim() || filtroArea || filtroPerfil);
  const unidadesPorId = useMemo(
    () => new Map(unidades.map((u) => [u.id, u.nome])),
    [unidades]
  );
  const labsPorId = useMemo(
    () => new Map(labs.map((l) => [l.id, l.nome])),
    [labs]
  );
  const medicosPorId = useMemo(
    () => new Map(medicos.map((m) => [m.id, m.nome])),
    [medicos]
  );

  return (
    <div className="space-y-5">
      {/* Cabeçalho alinhado à identidade visual do sistema */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-teal/10 p-2.5 text-teal">
            <UserCog className="h-6 w-6" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-extrabold text-sus-950">
              Usuários e Acessos
            </h1>
            <p className="mt-0.5 text-sm text-ink/60">
              Contas vinculadas a moradores cadastrados no município, lotação operacional e permissões granulares por tela.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportarExcel url="/api/usuarios/exportar" arquivo="usuarios" />
          <Button onClick={() => abrirModal()}>
            <Plus className="h-4 w-4" /> Novo Usuário
          </Button>
        </div>
      </div>

      {/* Cards de resumo ocupando toda a largura */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card
          onClick={() => setFiltroPerfil("")}
          className={cn(
            "cursor-pointer p-4 transition hover:border-sus-700/30",
            filtroPerfil === "" && "ring-2 ring-sus-900/15"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink/55">Total de Contas</span>
            <Users className="h-4 w-4 text-sus-800" />
          </div>
          <p className="mt-1.5 font-display text-2xl font-extrabold text-sus-950">
            {resumo ? resumo.total : total}
          </p>
          <p className="mt-0.5 text-xs text-ink/55">
            {resumo ? `${resumo.ativos} ativas · ${resumo.inativos} inativas` : "Cadastradas no sistema"}
          </p>
        </Card>

        <Card
          onClick={() => setFiltroPerfil(filtroPerfil === "superuser" ? "" : "superuser")}
          className={cn(
            "cursor-pointer p-4 transition hover:border-sus-700/30",
            filtroPerfil === "superuser" && "border-sus-900 ring-2 ring-sus-900/15"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink/55">Superusuários</span>
            <ShieldCheck className="h-4 w-4 text-sus-900" />
          </div>
          <p className="mt-1.5 font-display text-2xl font-extrabold text-sus-950">
            {resumo ? resumo.superusers : "—"}
          </p>
          <p className="mt-0.5 text-xs text-ink/55">Acesso administrativo total</p>
        </Card>

        <Card
          onClick={() => setFiltroPerfil(filtroPerfil === "com_vinculo" ? "" : "com_vinculo")}
          className={cn(
            "cursor-pointer p-4 transition hover:border-teal/40",
            filtroPerfil === "com_vinculo" && "border-teal ring-2 ring-teal/20"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink/55">Pessoa Vinculada</span>
            <UserCheck className="h-4 w-4 text-teal" />
          </div>
          <p className="mt-1.5 font-display text-2xl font-extrabold text-teal">
            {resumo ? resumo.com_vinculo : "—"}
          </p>
          <p className="mt-0.5 text-xs text-ink/55">Ligadas ao cadastro municipal</p>
        </Card>

        <Card
          onClick={() => setFiltroPerfil(filtroPerfil === "sem_vinculo" ? "" : "sem_vinculo")}
          className={cn(
            "cursor-pointer p-4 transition hover:border-amber-400/60",
            filtroPerfil === "sem_vinculo" && "border-amber-400 bg-amber-50/40 ring-2 ring-amber-400/20"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink/55">Sem Vínculo</span>
            <Link2 className="h-4 w-4 text-amber-600" />
          </div>
          <p className="mt-1.5 font-display text-2xl font-extrabold text-amber-700">
            {resumo ? resumo.sem_vinculo : "—"}
          </p>
          <p className="mt-0.5 text-xs text-ink/55">Clique para filtrar e vincular</p>
        </Card>
      </div>

      {erro && !modal && (
        <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
          <span>{erro}</span>
          <button onClick={() => setErro("")} className="text-red-500 hover:text-red-700">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {ok && (
        <div className="flex items-center justify-between rounded-xl border border-teal/25 bg-teal/10 px-4 py-3 text-sm font-medium text-sus-950">
          <span>{ok}</span>
          <button onClick={() => setOk("")} className="text-sus-800/60 hover:text-sus-950">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {temporaria && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm shadow-sm">
          <KeyRound className="h-4 w-4 text-amber-700" />
          <span className="font-semibold text-amber-900">
            Senha temporária de {temporaria.user}:
          </span>
          <code className="rounded-lg bg-white px-2.5 py-1 font-mono text-sm font-bold text-sus-950 ring-1 ring-amber-200">
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
            className="ml-auto rounded-lg px-2 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100"
          >
            Ocultar (não exibe novamente)
          </button>
        </div>
      )}

      {/* Barra de busca e filtros ocupando toda a largura */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[260px] flex-1">
            <Label>Buscar conta ou pessoa</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/45" />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por usuário (login), nome, CPF ou CNS da pessoa…"
                className="pl-10 pr-9"
              />
              {busca && (
                <button
                  type="button"
                  onClick={() => setBusca("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/45 hover:text-ink"
                  aria-label="Limpar busca"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          <div className="w-full sm:w-52">
            <Label>Perfil / Vínculo</Label>
            <Select value={filtroPerfil} onChange={(e) => setFiltroPerfil(e.target.value)}>
              <option value="">Todos os usuários</option>
              <option value="com_vinculo">Com pessoa vinculada</option>
              <option value="sem_vinculo">Sem vínculo (pendente)</option>
              <option value="ativos">Apenas ativos</option>
              <option value="inativos">Apenas inativos</option>
              <option value="superuser">Superusuários</option>
              <option value="medicos">Médicos vinculados</option>
            </Select>
          </div>

          <div className="w-full sm:w-44">
            <Label>Área</Label>
            <Select value={filtroArea} onChange={(e) => setFiltroArea(e.target.value)}>
              <option value="">Todas as áreas</option>
              <option value="painel">painel</option>
              <option value="ferramentas">ferramentas</option>
            </Select>
          </div>

          {temFiltroAtivo && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setBusca("");
                setFiltroArea("");
                setFiltroPerfil("");
              }}
            >
              <X className="h-4 w-4" /> Limpar
            </Button>
          )}
        </div>
      </Card>

      {/* Tabela ampla de contas */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-sus-900/10 bg-sand text-xs uppercase tracking-wide text-sus-900/65">
                <th className="px-4 py-3.5">Usuário</th>
                <th className="px-4 py-3.5">Pessoa do Município (Cadastro)</th>
                <th className="px-4 py-3.5">Lotação / Vínculos</th>
                <th className="px-4 py-3.5">Módulos e Permissões</th>
                <th className="px-4 py-3.5">Status</th>
                <th className="px-4 py-3.5 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sus-900/5">
              {lista.map((u) => {
                const unidadeNome =
                  u.unidade_saude_nome || (u.unidade_saude_id ? unidadesPorId.get(u.unidade_saude_id) : undefined);
                const labNome =
                  u.laboratorio_nome || (u.laboratorio_id ? labsPorId.get(u.laboratorio_id) : undefined);
                const medicoNome = u.medico_id ? medicosPorId.get(u.medico_id) : undefined;
                const modulosResumo = u.is_superuser ? [] : resumirModulos(u.telas);

                return (
                  <tr key={u.id} className="transition hover:bg-sand/35">
                    <td className="px-4 py-3.5 align-top">
                      <div className="flex items-start gap-3">
                        <div
                          className={cn(
                            "grid h-9 w-9 shrink-0 place-items-center rounded-full font-display text-sm font-bold",
                            u.is_superuser
                              ? "bg-sus-900 text-white"
                              : u.is_active
                                ? "bg-teal/15 text-teal"
                                : "bg-slate-200 text-slate-600"
                          )}
                        >
                          {(u.nome || u.username || "?").slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-sus-950">{u.username}</p>
                          <p className="text-xs text-ink/60">{u.nome || "Sem nome informado"}</p>
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-3.5 align-top">
                      {u.paciente_id ? (
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1.5">
                            <UserCheck className="h-3.5 w-3.5 shrink-0 text-teal" />
                            <span className="font-semibold text-sus-950">
                              {u.paciente_nome || `Pessoa #${u.paciente_id}`}
                            </span>
                          </div>
                          <p className="font-mono text-[11px] text-ink/55">
                            {u.paciente_cpf ? `CPF: ${u.paciente_cpf}` : "Sem CPF"}
                            {u.paciente_cns ? ` · CNS: ${u.paciente_cns}` : ""}
                          </p>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="warning">Sem vínculo com pessoa</Badge>
                          <button
                            type="button"
                            onClick={() => abrirModal(u)}
                            className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-50"
                          >
                            <Link2 className="h-3 w-3" /> Vincular
                          </button>
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3.5 align-top">
                      <div className="flex flex-wrap gap-1.5">
                        <Badge variant="outline">{u.area}</Badge>
                        {unidadeNome && (
                          <span className="inline-flex items-center rounded-md bg-teal/10 px-2 py-0.5 text-[11px] font-semibold text-teal">
                            🏥 {unidadeNome}
                          </span>
                        )}
                        {labNome && (
                          <span className="inline-flex items-center rounded-md border border-purple-200 bg-purple-50 px-2 py-0.5 text-[11px] font-semibold text-purple-700">
                            🧪 {labNome}
                          </span>
                        )}
                        {u.medico_id && (
                          <span className="inline-flex items-center rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-800">
                            🩺 {medicoNome || `Médico #${u.medico_id}`}
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="px-4 py-3.5 align-top">
                      {u.is_superuser ? (
                        <Badge>Acesso Total (Superuser)</Badge>
                      ) : modulosResumo.length > 0 ? (
                        <div className="flex max-w-md flex-wrap gap-1" title={u.telas.join(", ")}>
                          {modulosResumo.slice(0, 5).map((m) => (
                            <span
                              key={m.rotulo}
                              className="rounded-md bg-sus-900/5 px-2 py-0.5 text-[11px] font-medium text-sus-900"
                            >
                              {m.rotulo} ({m.qtd})
                            </span>
                          ))}
                          {modulosResumo.length > 5 && (
                            <span className="rounded-md bg-sand px-2 py-0.5 text-[11px] font-semibold text-ink/60">
                              +{modulosResumo.length - 5} módulos
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-ink/45">—</span>
                      )}
                    </td>

                    <td className="px-4 py-3.5 align-top">
                      <div className="flex flex-wrap gap-1">
                        <Badge variant={u.is_active ? "success" : "danger"}>
                          {u.is_active ? "Ativo" : "Inativo"}
                        </Badge>
                        {u.is_superuser && <Badge variant="outline">★ Super</Badge>}
                        {u.must_change_password && <Badge variant="warning">Troca pendente</Badge>}
                        {u.permite_retroativo === false && <Badge variant="outline">Sem retroativo</Badge>}
                      </div>
                    </td>

                    <td className="px-4 py-3.5 text-right align-top">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => abrirModal(u)}
                          className="rounded-lg p-2 text-sus-800 hover:bg-sus-100"
                          title="Editar conta e permissões"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => resetar(u)}
                          disabled={resetando === u.id}
                          className="rounded-lg p-2 text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                          title="Resetar senha (gera nova temporária)"
                        >
                          <KeyRound className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => excluir(u.id)}
                          className="rounded-lg p-2 text-red-600 hover:bg-red-50"
                          title="Excluir conta"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {!carregando && lista.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-ink/50">
                    {temFiltroAtivo
                      ? "Nenhum usuário encontrado para os filtros aplicados."
                      : "Nenhum usuário cadastrado."}
                  </td>
                </tr>
              )}
              {carregando && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-ink/50">
                    Carregando contas…
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
          pageSize={pageSize}
          onPageSize={(sz) => {
            setPageSize(sz);
            carregar(1, sz, busca, filtroArea, filtroPerfil);
          }}
          onPage={(p) => carregar(p, pageSize, busca, filtroArea, filtroPerfil)}
        />
      </Card>

      {/* Modal amplo em 2 colunas aproveitando espaço horizontal */}
      {modal && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-sus-950/55 p-3 md:p-6"
          onClick={fecharModal}
        >
          <div
            className="rise flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-card"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Cabeçalho fixo do modal */}
            <div className="flex items-center justify-between gap-3 border-b border-sus-900/10 bg-sand/40 px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-teal/15 p-2 text-teal">
                  <UserCog className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-display text-lg font-bold text-sus-950">
                    {editId
                      ? `Editar conta · ${editUserObj?.username || `#${editId}`}`
                      : "Novo Usuário do Sistema"}
                  </h2>
                  <p className="text-xs text-ink/55">
                    {editId
                      ? "Atualize os dados da conta, vínculo com morador cadastrado e permissões de acesso."
                      : "Busque a pessoa cadastrada no município, configure a lotação e defina as permissões por tela."}
                  </p>
                </div>
              </div>
              <button
                onClick={fecharModal}
                className="rounded-lg p-2 text-ink/50 hover:bg-sand"
                aria-label="Fechar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Corpo rolável em 2 colunas largas */}
            <div className="flex-1 overflow-y-auto p-6">
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                {/* Coluna Esquerda: Pessoa do Município + Dados da Conta + Lotação */}
                <div className="space-y-4 lg:col-span-5">
                  {/* Bloco Pessoa do Município */}
                  <div className="rounded-2xl border border-teal/25 bg-teal/5 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-display text-xs font-bold uppercase tracking-wide text-sus-950">
                        Pessoa do Município (Cadastro Municipal)
                      </span>
                      {!editId ? (
                        <Badge>Obrigatório</Badge>
                      ) : !form.paciente_id ? (
                        <Badge variant="warning">Sem vínculo</Badge>
                      ) : (
                        <Badge variant="success">Vinculada</Badge>
                      )}
                    </div>

                    {editId && !form.paciente_id && (
                      <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                        <span>
                          Esta conta foi cadastrada sem vínculo com uma pessoa da lista de pacientes. Busque abaixo para adicionar os dados cadastrais.
                        </span>
                      </div>
                    )}

                    <BuscaPacienteAutocomplete
                      pacienteId={form.paciente_id}
                      pacienteInicial={pacienteVinculado}
                      onSelect={selecionarPessoa}
                      label="Buscar pessoa cadastrada (nome, CPF ou CNS)"
                      obrigatorio={!editId}
                      placeholder="Digite nome, CPF, CNS ou prontuário…"
                    />

                    {pacienteVinculado && form.nome.trim() !== pacienteVinculado.nome.trim() && (
                      <button
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, nome: pacienteVinculado.nome }))}
                        className="text-xs font-semibold text-teal hover:underline"
                      >
                        Sincronizar nome da conta com "{pacienteVinculado.nome}"
                      </button>
                    )}
                  </div>

                  {/* Dados de acesso */}
                  <div className="rounded-2xl border border-sus-900/10 p-4 space-y-3">
                    <p className="font-display text-xs font-bold uppercase tracking-wide text-sus-900/70">
                      Credenciais e Identificação
                    </p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <Label>Usuário (login) *</Label>
                        <Input
                          value={form.username}
                          disabled={editId !== null}
                          onChange={(e) => {
                            setUsernameEditadoManual(true);
                            setForm({ ...form, username: e.target.value });
                          }}
                          placeholder="ex: maria.silva"
                        />
                      </div>
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
                    </div>

                    <div>
                      <Label>Nome de exibição na conta</Label>
                      <Input
                        value={form.nome}
                        onChange={(e) => setForm({ ...form, nome: e.target.value })}
                        placeholder="Preenchido pelo cadastro da pessoa selecionada"
                      />
                    </div>

                    {!editId && (
                      <p className="rounded-xl bg-sand/70 px-3 py-2 text-xs text-ink/65">
                        Uma senha temporária (bcrypt) será gerada automaticamente e exibida 1 vez após criar. Troca obrigatória no 1º acesso.
                      </p>
                    )}
                  </div>

                  {/* Lotações e vínculos operacionais */}
                  <div className="rounded-2xl border border-sus-900/10 p-4 space-y-3">
                    <p className="font-display text-xs font-bold uppercase tracking-wide text-sus-900/70">
                      Lotação e Vínculos Operacionais
                    </p>

                    <div>
                      <Label>Unidade de Saúde / PSF</Label>
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
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <Label>Médico vinculado</Label>
                        <Select
                          value={form.medico_id}
                          onChange={(e) => setForm({ ...form, medico_id: e.target.value })}
                        >
                          <option value="">Nenhum</option>
                          {medicos.filter((m) => m.ativo).map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.nome}
                              {m.crm ? ` · ${m.crm}` : ""}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div>
                        <Label>Laboratório conveniado</Label>
                        <Select
                          value={form.laboratorio_id}
                          onChange={(e) => setForm({ ...form, laboratorio_id: e.target.value })}
                        >
                          <option value="">Nenhum</option>
                          {labs.filter((l) => l.ativo).map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.nome}
                            </option>
                          ))}
                        </Select>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-4 pt-1">
                      <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                        <input
                          type="checkbox"
                          checked={form.permite_retroativo}
                          onChange={(e) => setForm({ ...form, permite_retroativo: e.target.checked })}
                          className="h-4 w-4 accent-teal"
                        />
                        Lançamentos retroativos
                      </label>
                      <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                        <input
                          type="checkbox"
                          checked={form.is_superuser}
                          onChange={(e) => setForm({ ...form, is_superuser: e.target.checked })}
                          className="h-4 w-4 accent-sus-900"
                        />
                        Superuser
                      </label>
                      <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                        <input
                          type="checkbox"
                          checked={form.is_active}
                          onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                          className="h-4 w-4 accent-teal"
                        />
                        Conta ativa
                      </label>
                    </div>
                  </div>
                </div>

                {/* Coluna Direita: Permissões Granulares */}
                <div className="flex flex-col space-y-3 lg:col-span-7">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <Label className="mb-0">Permissões — módulos, telas e ações *</Label>
                      <p className="text-xs text-ink/55">
                        {form.is_superuser
                          ? "Superusuário possui acesso irrestrito a todas as telas."
                          : `${form.telas.length} permissão(ões) selecionada(s).`}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {PRESETS_PERMISSAO.map((preset) => (
                        <button
                          key={preset.rotulo}
                          type="button"
                          onClick={() =>
                            setForm((f) => ({
                              ...f,
                              area: preset.area,
                              telas: preset.telas,
                              acoes: {},
                            }))
                          }
                          className="rounded-lg border border-sus-900/15 bg-sand/50 px-2.5 py-1 text-[11px] font-semibold text-sus-900 transition hover:bg-sus-100"
                        >
                          {preset.rotulo}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="max-h-[58vh] overflow-y-auto rounded-2xl border border-sus-900/10 bg-sand/20 p-3">
                    <PermissoesTree
                      telas={form.telas}
                      acoes={form.acoes}
                      onChange={(telas, acoes) => setForm((f) => ({ ...f, telas, acoes }))}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Rodapé fixo do modal */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-sus-900/10 bg-sand/30 px-6 py-4">
              <div className="min-w-0 flex-1">
                {erroModal && (
                  <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                    {erroModal}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" onClick={fecharModal} disabled={salvando}>
                  Cancelar
                </Button>
                <Button onClick={salvar} disabled={salvando}>
                  {editId ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                  {salvando ? "Salvando…" : editId ? "Salvar Alterações" : "Criar com Senha Temporária"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
