import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  Archive,
  Braces,
  CheckCircle2,
  Database,
  ExternalLink,
  FileSpreadsheet,
  HardDrive,
  Monitor,
  RotateCcw,
  ScrollText,
  Search,
  ShieldAlert,
  Smartphone,
  X,
} from "lucide-react";
import { Badge, Button, Card, Input, Label } from "../components/ui/primitives";
import Paginacao from "../components/Paginacao";
import ExportarExcel from "../components/ExportarExcel";
import {
  fetchAuditEstatisticas,
  fetchAuditFiltros,
  fetchAuditLogs,
  fetchRegistroRelacionado,
  executarRotacaoAudit,
  pagData,
  pagMeta,
  type AuditEstatisticas,
  type AuditLog,
  type RegistroRelacionado,
} from "../services/api";

const ACAO_LABEL: Record<string, string> = {
  EXPORT_EXCEL: "Exportação de relatório (Excel)",
  EXPORT_CSV: "Exportação de arquivo (CSV)",
  SEARCH: "Pesquisa / Consulta de dados",
  AUDIT_ROTATION: "Rotação e arquivamento de logs",
  AUTH_CREATE: "Login / Autenticação",
  EXAM_CREATE: "Inclusão na fila de exames",
  EXAM_UPDATE: "Atualização de exame/agendamento",
  EXAM_DELETE: "Cancelamento de exame",
  EXAM_REMOVE: "Remoção da fila de espera",
  EXAM_TOKEN: "Regeneração de link do exame",
  PATIENT_CREATE: "Cadastro de paciente",
  PATIENT_UPDATE: "Atualização de cadastro",
  PATIENT_DELETE: "Exclusão de paciente",
  TRIP_CREATE: "Agendamento de viagem",
  TRIP_UPDATE: "Atualização de viagem",
  TRIP_DELETE: "Cancelamento de viagem",
  PASSENGER_CREATE: "Alocação de passageiro",
  PASSENGER_DELETE: "Desalocação de passageiro",
  DESTINATION_CREATE: "Cadastro de destino",
  DESTINATION_UPDATE: "Atualização de destino",
  DESTINATION_DELETE: "Remoção de destino",
  VEHICLE_CREATE: "Cadastro de veículo",
  VEHICLE_UPDATE: "Atualização de veículo",
  VEHICLE_DELETE: "Inativação de veículo",
  USER_CREATE: "Criação de usuário / permissão",
  USER_UPDATE: "Atualização de usuário",
  USER_DELETE: "Exclusão de conta de usuário",
  USER_PASSWORD: "Alteração de senha",
  DOCTOR_CREATE: "Cadastro de médico",
  DOCTOR_UPDATE: "Atualização de médico",
  DOCTOR_DELETE: "Inativação de médico",
  UNIT_CREATE: "Cadastro de unidade de saúde",
  UNIT_UPDATE: "Atualização de unidade de saúde",
  UNIT_DELETE: "Inativação de unidade de saúde",
  BACKUP_EXPORT: "Geração de backup criptografado",
  BACKUP_RESTORE: "Restauração de dados do sistema",
  APAC_CREATE: "Solicitação de APAC",
  APAC_UPDATE: "Atualização de APAC",
  APAC_AUTHORIZE: "Autorização de APAC",
  APAC_REJECT: "Indeferimento de APAC",
  APAC_RETURN: "Devolução de APAC",
  APAC_LOT: "Geração de remessa APAC-Mag",
  SETTINGS_UPDATE: "Atualização de configurações",
  INTEGRATION_CREATE: "Configuração de integração",
  INTEGRATION_UPDATE: "Atualização de integração",
  INTEGRATION_IMPORT: "Sincronização / Importação de dados",
};

const ENTIDADE_LABEL: Record<string, string> = {
  EXAM: "Fila de exames",
  PATIENT: "Paciente",
  PACIENTES: "Pacientes",
  PACIENTES_AUTOCOMPLETE: "Busca de Pacientes",
  TRIP: "Viagem",
  PASSENGER: "Passageiro em viagem",
  DESTINATION: "Destino",
  VEHICLE: "Veículo / Frota",
  USER: "Conta de usuário",
  DOCTOR: "Médico",
  MEDICOS: "Médicos",
  UNIT: "Unidade de saúde (PSF)",
  UNIDADES_SAUDE: "Unidades de saúde",
  TRIPQUEUE: "Fila de viagem",
  CATALOG: "Catálogo de exames",
  PROCEDIMENTOS: "Procedimentos",
  BILLING: "Faturamento",
  REQUEST: "Solicitação laboratorial",
  QUEUE: "Fila do PSF",
  SLOT: "Vaga em agenda",
  LAB: "Laboratório",
  SIGTAP: "Tabela SIGTAP",
  SETTINGS: "Configurações",
  INTEGRATION: "Importação / Integração",
  SYSTEM: "Sistema",
  DASHBOARD: "Dashboard",
  REPORT: "Relatório",
  AUDIT: "Auditoria",
  BACKUP: "Backup do Sistema",
  APAC: "APAC / Alta Complexidade",
  APAC_LOTE: "Lote de Faturamento APAC",
};

const CAMPO_LABEL: Record<string, string> = {
  data_agendada: "Data Agendada",
  data_pedido: "Data do Pedido",
  data_viagem: "Data da Viagem",
  data_consulta: "Data da Consulta",
  data_retorno: "Data de Retorno",
  nascimento: "Data de Nascimento",
  hora_agendada: "Hora Agendada",
  hora_saida: "Hora de Saída",
  hora_retorno: "Hora de Retorno",
  hora_consulta: "Horário da Consulta",
  prioridade: "Prioridade",
  justificativa_prioridade: "Justificativa da Prioridade",
  status: "Status",
  destino: "Destino",
  unidade: "Unidade",
  unidade_nome: "Unidade de Atendimento",
  motorista: "Motorista",
  departamento: "Departamento",
  veiculo_id: "Veículo",
  medico_id: "Médico",
  paciente_id: "Paciente",
  exame: "Exame",
  especialidade: "Especialidade",
  nome_especialidade: "Especialidade",
  tipo_fila: "Tipo de Fila",
  codigo_procedimento: "Código do Procedimento",
  observacoes: "Observações",
  motivo_remocao: "Motivo da Remoção",
  tratamento: "Tratamento",
  acompanhante: "Acompanhante",
  presente: "Presente",
  placa: "Placa",
  modelo: "Modelo",
  capacidade: "Capacidade",
  nome: "Nome",
  cpf: "CPF",
  cns: "CNS",
  telefone: "Telefone",
  endereco: "Endereço",
  km_inicial: "Km Inicial",
  km_final: "Km Final",
  adiantamento: "Adiantamento (R$)",
  finalidade: "Finalidade",
  competencia: "Competência",
  device: "Dispositivo / Navegador",
};

const VALOR_LABEL: Record<string, string> = {
  rotina: "Eletivo",
  urgente: "Priorizado",
  aguardando: "Aguardando",
  agendado: "Agendado",
  realizado: "Realizado",
  cancelado: "Cancelado",
  alocado: "Alocado",
};

function rotuloCampo(c: string): string {
  if (CAMPO_LABEL[c]) return CAMPO_LABEL[c];
  return c.replace(/_/g, " ").replace(/^\w/, (m) => m.toUpperCase());
}

function fmtValor(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s.slice(0, 10)) && s.length <= 10) {
    return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
  }
  return VALOR_LABEL[s.toLowerCase()] ?? s;
}

function fmtDataHoraSegundo(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function fmtDataHora(iso: string): string {
  try {
    const d = new Date(iso);
    const data = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
    const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    return `${data}, ${hora}`;
  } catch {
    return iso;
  }
}

function renderDeviceBadge(device?: string) {
  if (!device) return <span className="text-ink/40 text-xs">—</span>;
  const isMobile = device.includes("Mobile") || device.includes("Android") || device.includes("iOS");
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-sand/80 px-2 py-1 text-xs text-sus-950 font-medium border border-sus-900/10">
      {isMobile ? <Smartphone className="h-3.5 w-3.5 text-sus-700 shrink-0" /> : <Monitor className="h-3.5 w-3.5 text-sus-700 shrink-0" />}
      <span className="truncate max-w-[150px]" title={device}>{device}</span>
    </span>
  );
}

type Mudanca = { campo: string; de: string; para: string };

function parseDetalhe(raw: string): { mudancas: Mudanca[]; corpo: Record<string, unknown> | null; rawObj: Record<string, unknown> | null } {
  try {
    const d = JSON.parse(raw || "null");
    if (!d || typeof d !== "object") return { mudancas: [], corpo: null, rawObj: null };
    const mudancas = Array.isArray(d.mudancas) ? d.mudancas : [];
    const corpo = d.body && typeof d.body === "object" ? d.body : null;
    return { mudancas, corpo, rawObj: d };
  } catch {
    return { mudancas: [], corpo: null, rawObj: null };
  }
}

export default function Auditoria() {
  const [lista, setLista] = useState<AuditLog[]>([]);
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [usuario, setUsuario] = useState("");
  const [acao, setAcao] = useState("");
  const [entidade, setEntidade] = useState("");
  const [filtros, setFiltros] = useState<{ acoes: string[]; entidades: string[]; usuarios: string[] }>({ acoes: [], entidades: [], usuarios: [] });
  const [erro, setErro] = useState("");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [rawAberto, setRawAberto] = useState<AuditLog | null>(null);
  const [selecionado, setSelecionado] = useState<AuditLog | null>(null);
  const [rel, setRel] = useState<RegistroRelacionado | null>(null);
  const [relLoading, setRelLoading] = useState(false);
  const [relErro, setRelErro] = useState("");

  // Métricas e Rotação de Logs
  const [estatisticas, setEstatisticas] = useState<AuditEstatisticas | null>(null);
  const [modalRotacaoAberto, setModalRotacaoAberto] = useState(false);
  const [rotacaoMeses, setRotacaoMeses] = useState(6);
  const [rotacaoArquivar, setRotacaoArquivar] = useState(true);
  const [executandoRotacao, setExecutandoRotacao] = useState(false);
  const [sucessoRotacao, setSucessoRotacao] = useState("");
  const [erroRotacao, setErroRotacao] = useState("");

  const navigate = useNavigate();

  async function carregarEstatisticas() {
    try {
      const stats = await fetchAuditEstatisticas();
      setEstatisticas(stats);
    } catch {
      // Endpoint restrito a superuser ou erro temporário
    }
  }

  async function carregar(p = 1) {
    setLoading(true);
    setErro("");
    try {
      const r = await fetchAuditLogs({
        data_de: de || undefined, data_ate: ate || undefined,
        usuario: usuario.trim() || undefined, acao: acao || undefined,
        entidade: entidade || undefined, page: p, limit: 100,
      });
      setLista(pagData<AuditLog>(r));
      const m = pagMeta(r);
      setTotal(m.total);
      setPage(m.page);
      setPages(m.pages);
    } catch (e: unknown) {
      const st = (e as { response?: { status?: number } }).response?.status;
      setErro(st === 403 ? "Restrito a superusers." : "Falha ao carregar logs.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAuditFiltros().then(setFiltros).catch(() => {});
    carregar(1);
    carregarEstatisticas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function dispararRotacao() {
    setExecutandoRotacao(true);
    setErroRotacao("");
    setSucessoRotacao("");
    try {
      const res = await executarRotacaoAudit(rotacaoMeses, rotacaoArquivar);
      const msg = res.mensagem || `${res.removidos} registro(s) com mais de ${rotacaoMeses} meses foram removidos com sucesso.`;
      setSucessoRotacao(msg);
      carregar(1);
      carregarEstatisticas();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      setErroRotacao(msg || "Falha ao executar a política de rotação de logs.");
    } finally {
      setExecutandoRotacao(false);
    }
  }

  async function abrirDetalhes(l: AuditLog) {
    setSelecionado(l);
    setRel(null);
    setRelErro("");
    if (l.entity_id) {
      setRelLoading(true);
      try {
        setRel(await fetchRegistroRelacionado(l.entity, l.entity_id));
      } catch (e: unknown) {
        const st = (e as { response?: { status?: number } }).response?.status;
        setRelErro(st === 403
          ? "Você não tem permissão para visualizar este registro."
          : "Navegação direta não disponível para este evento.");
      } finally {
        setRelLoading(false);
      }
    }
  }

  function fecharDetalhes() {
    setSelecionado(null);
    setRel(null);
    setRelErro("");
  }

  function descricaoEvento(l: AuditLog): string {
    const acaoTexto = l.action_label || ACAO_LABEL[l.action] || l.action.replace(/_/g, " ");
    const entidadeTexto = l.entity_label || ENTIDADE_LABEL[l.entity] || l.entity;
    const alvo = l.entity_id ? `${entidadeTexto} #${l.entity_id}` : entidadeTexto;
    return `${acaoTexto} em ${alvo} realizada por ${l.user_name || "sistema"} em ${fmtDataHora(l.timestamp)}.`;
  }

  const paramsFiltro = {
    data_de: de || undefined, data_ate: ate || undefined,
    usuario: usuario.trim() || undefined, acao: acao || undefined,
    entidade: entidade || undefined,
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-display text-2xl font-extrabold text-sus-950">Auditoria & Rastreabilidade</h1>
        <span className="ml-auto flex flex-wrap gap-2">
          <Button
            onClick={() => { setModalRotacaoAberto(true); setErroRotacao(""); setSucessoRotacao(""); }}
            className="!w-auto bg-amber-600 hover:bg-amber-700 text-white"
            title="Gerenciar política de retenção e rotação de logs antigos">
            <Archive className="h-4 w-4" /> Política de Retenção
          </Button>
          <ExportarExcel url="/api/auditoria/logs/exportar" arquivo="auditoria" params={paramsFiltro} />
          <ExportarExcel url="/api/auditoria/logs/exportar-csv" arquivo="auditoria" params={paramsFiltro} titulo="Exportar CSV" rotulo="Exportar CSV" />
        </span>
      </div>
      <p className="mb-4 mt-1 text-sm text-ink/55">
        Trilha de auditoria em tempo real, rastreamento de exportações, pesquisas de usuários e rotação de dados.
      </p>

      {/* Cards de Métricas e Eficiência */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4 flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sus-900/10 text-sus-900">
            <Database className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-ink/50">Total de Registros</p>
            <p className="text-xl font-extrabold text-sus-950">{estatisticas?.total_registros ?? total}</p>
            <p className="text-[11px] text-ink/60">Últimos 30 dias: {estatisticas?.ultimos_30_dias ?? 0}</p>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
            <FileSpreadsheet className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-ink/50">Exportações Excel</p>
            <p className="text-xl font-extrabold text-emerald-700">{estatisticas?.total_exportacoes ?? 0}</p>
            <p className="text-[11px] text-ink/60">Relatórios auditados com sucesso</p>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
            <Search className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-ink/50">Pesquisas Rastreadas</p>
            <p className="text-xl font-extrabold text-blue-700">{estatisticas?.total_buscas ?? 0}</p>
            <p className="text-[11px] text-ink/60">Consultas de pacientes e catálogo</p>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
            <HardDrive className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-ink/50">Armazenamento Otimizado</p>
            <p className="text-xl font-extrabold text-amber-800">{estatisticas?.tamanho_estimado_formatado || "Calculando…"}</p>
            <p className="text-[11px] text-ink/60">Índices B-Tree &amp; Rotação ativa</p>
          </div>
        </Card>
      </div>

      {/* Filtros de Consulta */}
      <Card className="mb-4 p-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <div>
            <Label>De</Label>
            <Input type="date" value={de} onChange={(e) => setDe(e.target.value)} />
          </div>
          <div>
            <Label>Até</Label>
            <Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
          </div>
          <div>
            <Label>Usuário</Label>
            <Input value={usuario} onChange={(e) => setUsuario(e.target.value)} placeholder="Nome ou usuário" list="audit-usuarios" />
            <datalist id="audit-usuarios">
              {filtros.usuarios.map((u) => <option key={u} value={u} />)}
            </datalist>
          </div>
          <div>
            <Label>Ação</Label>
            <select value={acao} onChange={(e) => setAcao(e.target.value)} className="w-full rounded-xl border border-sus-900/15 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-sus-700">
              <option value="">Todas as Ações</option>
              {filtros.acoes.map((a) => (
                <option key={a} value={a}>{ACAO_LABEL[a] || a}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Módulo / Entidade</Label>
            <select value={entidade} onChange={(e) => setEntidade(e.target.value)} className="w-full rounded-xl border border-sus-900/15 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-sus-700">
              <option value="">Todos os Módulos</option>
              {filtros.entidades.map((e) => (
                <option key={e} value={e}>{ENTIDADE_LABEL[e] || e}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <Button onClick={() => { setPage(1); carregar(1); }} disabled={loading} className="w-full">
              <ScrollText className="h-4 w-4" /> {loading ? "Buscando…" : "Filtrar"}
            </Button>
          </div>
        </div>
      </Card>

      {erro && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{erro}</p>}

      {/* Tabela de Logs */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-sus-900/10 bg-sand text-xs uppercase text-sus-900/60">
                <th className="px-4 py-3">Data/hora</th>
                <th className="px-4 py-3">Usuário</th>
                <th className="px-4 py-3">Dispositivo / Navegador</th>
                <th className="px-4 py-3">Ação</th>
                <th className="px-4 py-3">Módulo (ID)</th>
                <th className="px-4 py-3">Resumo da Operação</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((l) => {
                const { mudancas, corpo, rawObj } = parseDetalhe(l.details);
                const isExport = l.action === "EXPORT_EXCEL" || l.action === "EXPORT";
                const isSearch = l.action === "SEARCH";
                const isRotation = l.action === "AUDIT_ROTATION";

                return (
                  <tr key={l.id} onClick={() => abrirDetalhes(l)} className="cursor-pointer border-b border-sus-900/5 align-top transition hover:bg-sand/40 last:border-0">
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs font-mono">{fmtDataHora(l.timestamp)}</td>
                    <td className="px-4 py-2.5 font-medium text-sus-950">{l.user_name || "—"}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {renderDeviceBadge(l.device)}
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="font-semibold text-sus-950">
                        {l.action_label || ACAO_LABEL[l.action] || l.action.replace(/_/g, " ")}
                      </p>
                      <span className="font-mono text-[11px] text-ink/40">({l.action})</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-ink/70">
                      <span className="font-medium text-sus-900">{l.entity_label || ENTIDADE_LABEL[l.entity] || l.entity}</span>
                      {l.entity_id ? <span className="ml-1 font-mono text-ink/45">#{l.entity_id}</span> : ""}
                    </td>
                    <td className="min-w-64 px-4 py-2.5 text-xs">
                      {/* Caso Especial: Exportação Excel */}
                      {isExport && rawObj && (
                        <div className="flex flex-col gap-0.5 rounded-lg bg-emerald-50/70 p-2 border border-emerald-600/15">
                          <span className="font-semibold text-emerald-950 inline-flex items-center gap-1.5">
                            <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                            {String(rawObj.titulo || rawObj.modulo || "Relatório")}
                          </span>
                          <span className="text-[11px] text-emerald-800">
                            {rawObj.total_registros != null ? `${rawObj.total_registros} linha(s) gerada(s)` : "Planilha exportada"}
                          </span>
                        </div>
                      )}

                      {/* Caso Especial: Pesquisa / Consulta */}
                      {isSearch && rawObj && (
                        <div className="flex flex-col gap-0.5 rounded-lg bg-blue-50/70 p-2 border border-blue-600/15">
                          <span className="font-semibold text-blue-950 inline-flex items-center gap-1.5">
                            <Search className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                            Termo: "{String(rawObj.termo || "")}"
                          </span>
                          <span className="text-[11px] text-blue-800">
                            Módulo: {String(rawObj.modulo || l.entity)} · {rawObj.total_resultados != null ? `${rawObj.total_resultados} resultado(s)` : "Consulta realizada"}
                          </span>
                        </div>
                      )}

                      {/* Caso Especial: Rotação de Logs */}
                      {isRotation && rawObj && (
                        <div className="flex flex-col gap-0.5 rounded-lg bg-amber-50/70 p-2 border border-amber-600/15">
                          <span className="font-semibold text-amber-950 inline-flex items-center gap-1.5">
                            <Archive className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                            Expurgo de logs &gt; {String(rawObj.meses_retencao ?? 6)} meses
                          </span>
                          <span className="text-[11px] text-amber-800">
                            {String(rawObj.registros_removidos ?? 0)} registro(s) purgados do banco
                          </span>
                        </div>
                      )}

                      {/* Alterações convencionais de campos (Diff) */}
                      {!isExport && !isSearch && !isRotation && (
                        mudancas.length > 0 ? (
                          <ul className="space-y-1">
                            {mudancas.slice(0, 3).map((m, i) => (
                              <li key={i}>
                                <b>{rotuloCampo(m.campo)}:</b> {fmtValor(m.de)} ➔ <b>{fmtValor(m.para)}</b>
                              </li>
                            ))}
                            {mudancas.length > 3 && <li className="text-ink/45">+{mudancas.length - 3} campo(s)…</li>}
                          </ul>
                        ) : corpo ? (
                          <ul className="space-y-1">
                            {Object.entries(corpo).slice(0, 3).map(([k, v]) => (
                              <li key={k}><b>{rotuloCampo(k)}:</b> {fmtValor(v)}</li>
                            ))}
                            {Object.keys(corpo).length > 3 && <li className="text-ink/45">+{Object.keys(corpo).length - 3} campo(s)…</li>}
                          </ul>
                        ) : (
                          <span className="text-ink/45">—</span>
                        )
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <div className="flex justify-end gap-1.5">
                        <button
                          onClick={(e) => { e.stopPropagation(); abrirDetalhes(l); }}
                          className="inline-flex min-h-[36px] items-center gap-1 rounded-xl bg-sus-900/10 px-2.5 py-1.5 text-xs font-bold text-sus-900 hover:bg-sus-900/15"
                          title="Ver detalhes">
                          Detalhes
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setRawAberto(l); }}
                          className="inline-flex min-h-[36px] items-center gap-1 rounded-xl bg-sus-900/10 px-2.5 py-1.5 text-xs font-bold text-sus-900 hover:bg-sus-900/15"
                          title="Ver JSON bruto">
                          <Braces className="h-3.5 w-3.5" /> JSON
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {lista.length === 0 && !loading && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-ink/45">Nenhum registro encontrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Paginacao page={page} pages={pages} total={total} onPage={(p) => carregar(p)} />
      </Card>

      {/* Modal de Política de Retenção e Rotação de Logs */}
      {modalRotacaoAberto && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4" onClick={() => !executandoRotacao && setModalRotacaoAberto(false)}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
                  <Archive className="h-5 w-5" />
                </div>
                <p className="font-display text-lg font-extrabold text-sus-950">
                  Política de Retenção e Rotação
                </p>
              </div>
              <button
                disabled={executandoRotacao}
                onClick={() => setModalRotacaoAberto(false)}
                className="rounded-lg p-2 text-ink/50 hover:bg-sand"
                aria-label="Fechar">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4">
              <p className="text-sm text-ink/75 leading-relaxed">
                Para manter a performance instantânea das consultas e evitar o consumo excessivo de disco, você pode expurgar logs com mais de N meses. Os registros eliminados do banco podem ser salvos em arquivos compactados <code className="rounded bg-sand px-1.5 py-0.5 text-xs font-mono">.json.gz</code> no servidor.
              </p>

              <div className="rounded-xl border border-amber-500/20 bg-amber-50/50 p-3.5 text-xs text-amber-900">
                <p className="font-bold flex items-center gap-1.5 mb-1">
                  <ShieldAlert className="h-4 w-4 text-amber-700 shrink-0" />
                  Boas Práticas de Auditoria em Saúde Pública
                </p>
                A recomendação padrão é manter 6 ou 12 meses de logs na base ativa e arquivar dados anteriores de forma compactada.
              </div>

              <div>
                <Label>Período de Retenção (preservar logs dos últimos):</Label>
                <select
                  value={rotacaoMeses}
                  onChange={(e) => setRotacaoMeses(Number(e.target.value))}
                  disabled={executandoRotacao}
                  className="mt-1 w-full rounded-xl border border-sus-900/15 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-sus-700">
                  <option value={3}>3 Meses (Expurgar anteriores a 90 dias)</option>
                  <option value={6}>6 Meses (Recomendado)</option>
                  <option value={12}>12 Meses (1 Ano)</option>
                  <option value={24}>24 Meses (2 Anos)</option>
                </select>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="chk-arquivar"
                  checked={rotacaoArquivar}
                  onChange={(e) => setRotacaoArquivar(e.target.checked)}
                  disabled={executandoRotacao}
                  className="h-4 w-4 rounded border-sus-900/20 text-sus-900 focus:ring-sus-700"
                />
                <label htmlFor="chk-arquivar" className="text-sm text-sus-950 font-medium cursor-pointer">
                  Gerar arquivo compactado (.json.gz) no servidor antes da exclusão
                </label>
              </div>

              {sucessoRotacao && (
                <div className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-xs font-semibold text-emerald-800">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  {sucessoRotacao}
                </div>
              )}

              {erroRotacao && (
                <div className="flex items-center gap-2 rounded-xl bg-red-50 p-3 text-xs font-semibold text-red-800">
                  <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
                  {erroRotacao}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t border-sus-900/10">
                <button
                  type="button"
                  onClick={() => setModalRotacaoAberto(false)}
                  disabled={executandoRotacao}
                  className="rounded-xl border border-sus-900/20 bg-white px-4 py-2.5 text-sm font-semibold text-sus-900 hover:bg-sand disabled:opacity-50">
                  Fechar
                </button>
                <Button
                  onClick={dispararRotacao}
                  disabled={executandoRotacao}
                  className="bg-amber-600 hover:bg-amber-700 text-white font-bold">
                  {executandoRotacao ? "Executando Rotação…" : "Executar Rotação Agora"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal JSON Bruto */}
      {rawAberto && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4" onClick={() => setRawAberto(null)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl bg-white p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <p className="font-display text-base font-bold text-sus-950">
                JSON bruto · {rawAberto.action} {rawAberto.entity}{rawAberto.entity_id ? `#${rawAberto.entity_id}` : ""}
              </p>
              <button onClick={() => setRawAberto(null)} className="rounded-lg p-2 text-ink/50 hover:bg-sand" aria-label="Fechar"><X className="h-4 w-4" /></button>
            </div>
            <pre className="overflow-x-auto rounded-xl bg-sus-950 p-4 font-mono text-xs text-white">
              {JSON.stringify(JSON.parse(rawAberto.details || "null") ?? null, null, 2)}
            </pre>
          </div>
        </div>
      )}

      {/* Modal de Detalhes Humanizados */}
      {selecionado && (() => {
        const { mudancas, corpo, rawObj } = parseDetalhe(selecionado.details);
        const status = (rawObj && typeof rawObj === "object" && "status" in rawObj) ? (rawObj as { status?: unknown }).status : null;
        const isExport = selecionado.action === "EXPORT_EXCEL" || selecionado.action === "EXPORT";
        const isSearch = selecionado.action === "SEARCH";

        return (
          <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4" onClick={fecharDetalhes}>
            <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl bg-white p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
              <div className="mb-4 flex items-center justify-between">
                <p className="font-display text-lg font-extrabold text-sus-950">
                  Detalhes do Evento de Auditoria
                </p>
                <button onClick={fecharDetalhes} className="rounded-lg p-2 text-ink/50 hover:bg-sand" aria-label="Fechar"><X className="h-4 w-4" /></button>
              </div>

              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{selecionado.action_label || ACAO_LABEL[selecionado.action] || selecionado.action}</Badge>
                  <span className="font-mono text-xs text-ink/40">({selecionado.action})</span>
                  {typeof status === "number" && (
                    <Badge variant={status >= 200 && status < 300 ? "success" : status >= 400 ? "danger" : "warning"}>
                      Status HTTP: {status}
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-ink/75">{descricaoEvento(selecionado)}</p>

                <Card className="p-4">
                  <p className="mb-2 font-display text-sm font-bold text-sus-950">Metadados da Operação</p>
                  <dl className="grid grid-cols-1 gap-y-2 sm:grid-cols-2 text-sm">
                    <div>
                      <dt className="text-[11px] uppercase tracking-wide text-ink/45">Data e Hora</dt>
                      <dd className="font-medium text-sus-950 font-mono">{fmtDataHoraSegundo(selecionado.timestamp)}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] uppercase tracking-wide text-ink/45">Usuário Responsável</dt>
                      <dd className="font-medium text-sus-950">{selecionado.user_name || "—"}{selecionado.user_id ? ` (ID: ${selecionado.user_id})` : ""}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] uppercase tracking-wide text-ink/45">Dispositivo / Navegador</dt>
                      <dd className="mt-0.5">{renderDeviceBadge(selecionado.device)}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] uppercase tracking-wide text-ink/45">Módulo / Registro</dt>
                      <dd className="font-medium text-sus-950">
                        {selecionado.entity_label || ENTIDADE_LABEL[selecionado.entity] || selecionado.entity}
                        {selecionado.entity_id ? ` (#${selecionado.entity_id})` : " (Geral)"}
                      </dd>
                    </div>
                  </dl>
                </Card>

                {/* Exibição Estruturada de Exportações */}
                {isExport && rawObj ? (
                  <Card className="p-4 border-emerald-600/20 bg-emerald-50/20">
                    <p className="mb-2 font-display text-sm font-bold text-emerald-950 flex items-center gap-1.5">
                      <FileSpreadsheet className="h-4 w-4 text-emerald-700" />
                      Dados da Exportação Gerada
                    </p>
                    <div className="space-y-2 text-sm">
                      <p><b>Título do Relatório:</b> {String(rawObj.titulo || rawObj.modulo || "Planilha")}</p>
                      <p><b>Total de Linhas:</b> {String(rawObj.total_registros ?? "—")}</p>
                      {Boolean(rawObj.filtros && typeof rawObj.filtros === "object" && Object.keys(rawObj.filtros as object).length > 0) && (
                        <div>
                          <p className="font-bold text-xs uppercase tracking-wide text-ink/50 mt-2">Filtros Aplicados:</p>
                          <ul className="mt-1 list-disc list-inside space-y-0.5 text-xs text-ink/80">
                            {Object.entries(rawObj.filtros as Record<string, unknown>).map(([fk, fv]) => (
                              <li key={fk}><b>{rotuloCampo(fk)}:</b> {String(fv)}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </Card>
                ) : null}

                {/* Exibição Estruturada de Consultas/Buscas */}
                {isSearch && rawObj ? (
                  <Card className="p-4 border-blue-600/20 bg-blue-50/20">
                    <p className="mb-2 font-display text-sm font-bold text-blue-950 flex items-center gap-1.5">
                      <Search className="h-4 w-4 text-blue-700" />
                      Dados da Pesquisa Realizada
                    </p>
                    <div className="space-y-1 text-sm">
                      <p><b>Termo Buscado:</b> <span className="font-semibold text-blue-900">"{String(rawObj.termo || "")}"</span></p>
                      <p><b>Módulo Consultado:</b> {String(rawObj.modulo || selecionado.entity)}</p>
                      <p><b>Total de Resultados Encontrados:</b> {String(rawObj.total_resultados ?? "—")}</p>
                    </div>
                  </Card>
                ) : null}

                {mudancas.length > 0 ? (
                  <Card className="p-4">
                    <p className="mb-2 font-display text-sm font-bold text-sus-950">Campos alterados (Diff)</p>
                    <ul className="space-y-1.5 text-sm">
                      {mudancas.map((m, i) => (
                        <li key={i} className="rounded-xl bg-sand px-3 py-2 border border-sus-900/10">
                          <b>{rotuloCampo(m.campo)}:</b> alterado de <span className="text-red-700 line-through mr-1">{fmtValor(m.de)}</span> para <span className="text-emerald-700 font-semibold">{fmtValor(m.para)}</span>
                        </li>
                      ))}
                    </ul>
                  </Card>
                ) : null}

                {Boolean(corpo && mudancas.length === 0 && !isExport && !isSearch) ? (
                  <Card className="p-4">
                    <p className="mb-2 font-display text-sm font-bold text-sus-950">Dados informados</p>
                    <ul className="space-y-1 text-sm">
                      {Object.entries(corpo!).map(([k, v]) => (
                        <li key={k} className="rounded-xl bg-sand px-3 py-2">
                          <b>{rotuloCampo(k)}:</b> {fmtValor(v)}
                        </li>
                      ))}
                    </ul>
                  </Card>
                ) : null}

                {Boolean(rawObj?.antes && typeof rawObj.antes === "object") ? (
                  <Card className="p-4">
                    <p className="mb-2 font-display text-sm font-bold text-sus-950">Dados anteriores (registro excluído)</p>
                    <ul className="space-y-1 text-sm">
                      {Object.entries(rawObj!.antes as Record<string, unknown>).map(([k, v]) => (
                        <li key={k} className="rounded-xl bg-sand px-3 py-2">
                          <b>{rotuloCampo(k)}:</b> {fmtValor(v)}
                        </li>
                      ))}
                    </ul>
                  </Card>
                ) : null}

                {selecionado.entity_id ? (
                  <Card className="p-4">
                    <p className="mb-2 font-display text-sm font-bold text-sus-950">Registro relacionado</p>
                    {relLoading && <p className="text-sm text-ink/55">Consultando…</p>}
                    {!relLoading && relErro && <p className="text-sm text-red-700">{relErro}</p>}
                    {!relLoading && !relErro && rel && !rel.existe && (
                      <p className="text-sm text-ink/60">Registro indisponível — use os dados históricos acima.</p>
                    )}
                    {!relLoading && !relErro && rel && rel.existe && (
                      <div className="space-y-2">
                        <p className="text-sm font-semibold text-sus-950">{rel.titulo || `#${rel.entity_id}`}</p>
                        {rel.subtitulo && <p className="text-xs text-ink/60">{rel.subtitulo}</p>}
                        {rel.pai && <p className="text-xs text-ink/45">Vinculado a: {rel.pai.titulo}</p>}
                        {rel.rota && (
                          <Button
                            onClick={() => {
                              const base = rel.rota as string;
                              const url = `${base}${base.includes("?") ? "&" : "?"}registro=${selecionado.entity_id}`;
                              navigate(url, { state: { relatedEntity: selecionado.entity, relatedId: selecionado.entity_id } });
                              fecharDetalhes();
                            }}
                            className="!w-auto">
                            <ExternalLink className="h-4 w-4" /> Ver registro relacionado
                          </Button>
                        )}
                      </div>
                    )}
                  </Card>
                ) : null}

                <details className="rounded-xl border border-sus-900/10 bg-sand p-3">
                  <summary className="cursor-pointer text-xs font-bold text-sus-900">Dados técnicos do evento (JSON original)</summary>
                  <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-sus-950 p-3 font-mono text-[11px] text-white">
                    {JSON.stringify(rawObj ?? JSON.parse(selecionado.details || "null"), null, 2)}
                  </pre>
                </details>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
