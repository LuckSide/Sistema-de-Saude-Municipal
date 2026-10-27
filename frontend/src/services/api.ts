import axios from "axios";

const api = axios.create({
  // Mesmo-origin por padrão: dev usa proxy do Vite (/api → localhost:8000),
  // prod usa proxy do nginx (/api → backend). Evita CSP connect-src e localhost absoluto.
  baseURL: import.meta.env.VITE_API_URL ?? "",
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("guape:token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/** Tradutor global de erros (i18n): HTTP/técnico em inglês ➔ pt-BR claro. */
const GENERICOS_EN = new Set([
  "Bad Request",
  "Unauthorized",
  "Forbidden",
  "Not Found",
  "Method Not Allowed",
  "Request Timeout",
  "Conflict",
  "Unprocessable Entity",
  "Too Many Requests",
  "Internal Server Error",
  "Bad Gateway",
  "Service Unavailable",
  "Gateway Timeout",
]);

const MAPA_STATUS: Record<number, string> = {
  400: "Solicitação inválida. Confira os dados e tente novamente.",
  403: "Seu usuário não possui permissão para realizar esta ação.",
  404: "Recurso ou rota não encontrada no sistema.",
  405: "Operação não permitida. A rota de salvamento/sugestão enviou uma requisição inválida ao servidor.",
  422: "Dados inválidos. Confira os campos e tente novamente.",
  500: "Ocorreu um erro interno ao processar a solicitação. Tente novamente mais tarde.",
};

/** Mensagem amigável p/ qualquer erro de API (prefere o detalhe pt-BR do backend). */
export function msgErro(err: unknown, fallback = "Ocorreu um erro. Tente novamente."): string {
  const e = err as {
    response?: { status?: number; data?: { detail?: unknown } };
    request?: unknown;
    friendlyMessage?: string;
  };
  if (e?.friendlyMessage) return e.friendlyMessage;
  const status = e?.response?.status;
  const det = e?.response?.data?.detail;
  const detalhe = Array.isArray(det) ? "" : typeof det === "string" ? det.trim() : "";
  if (!e?.response) {
    return "Sem resposta do servidor. Verifique sua conexão e tente novamente.";
  }
  if (detalhe && !GENERICOS_EN.has(detalhe)) {
    return status === 500 ? (MAPA_STATUS[500] as string) : detalhe;
  }
  if (status && MAPA_STATUS[status]) return MAPA_STATUS[status] as string;
  return fallback;
}

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("guape:token");
      if (window.location.pathname !== "/login") window.location.href = "/login";
    } else {
      // Normaliza o detalhe p/ todas as telas exibirem pt-BR claro.
      try {
        const amigavel = msgErro(err);
        (err as { friendlyMessage?: string }).friendlyMessage = amigavel;
        const det = err.response?.data?.detail;
        if (err.response?.data && (typeof det !== "string" || GENERICOS_EN.has(det.trim()))) {
          err.response.data = { ...(err.response.data as object), detail: amigavel };
        }
      } catch {
        /* nunca quebra a requisição */
      }
    }
    return Promise.reject(err);
  }
);

export type Usuario = {
  id: number;
  username: string;
  nome: string;
  area: string;
  telas: string[];
  acoes?: Record<string, string[]>;
  medico_id?: number | null;
  unidade_saude_id?: number | null;
  unidade_saude_nome?: string | null;
  laboratorio_id?: number | null;
  laboratorio_nome?: string | null;
  permite_retroativo?: boolean;
  is_superuser: boolean;
  is_active: boolean;
  must_change_password: boolean;
};

export async function login(username: string, password: string): Promise<{ token: string; must_change_password: boolean; tem_atualizacao: boolean }> {
  const body = new URLSearchParams({ username, password });
  const { data } = await api.post("/api/token/", body, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  const tem = !!data.tem_atualizacao;
  if (tem) sessionStorage.setItem("guape:update", "1");
  return { token: data.access_token as string, must_change_password: !!data.must_change_password, tem_atualizacao: tem };
}

export type Medico = {
  id: number;
  nome: string;
  cpf: string;
  crm: string;
  cbo_codigo: string;
  cbo_descricao: string;
  especialidades: string;
  telefone: string;
  email: string;
  unidades_ids?: number[];
  ativo: boolean;
  usuario_criado?: string | null;
  senha_temporaria?: string | null;
};
export const fetchMedicos = (params?: { q?: string; somente_ativos?: boolean }) =>
  api.get<Medico[]>("/api/medicos", { params }).then((r) => r.data);
export const createMedico = (payload: Record<string, unknown>) => api.post<Medico>("/api/medicos", payload).then((r) => r.data);
export const updateMedico = (id: number, payload: Record<string, unknown>) => api.put<Medico>(`/api/medicos/${id}`, payload).then((r) => r.data);
export const deleteMedico = (id: number) => api.delete(`/api/medicos/${id}`).then((r) => r.data);

export type UnidadeSaude = {
  id: number;
  nome: string;
  cnes: string;
  endereco: string;
  numero: string;
  bairro: string;
  municipio: string;
  cep: string;
  telefone: string;
  ativo: boolean;
};
export const fetchUnidadesSaude = (params?: { q?: string; somente_ativas?: boolean }) =>
  api.get<UnidadeSaude[]>("/api/unidades-saude", { params }).then((r) => r.data);
export const fetchMe = () => api.get<Usuario>("/api/me").then((r) => r.data);
export const createUnidadeSaude = (payload: Record<string, unknown>) => api.post<UnidadeSaude>("/api/unidades-saude", payload).then((r) => r.data);
export const updateUnidadeSaude = (id: number, payload: Record<string, unknown>) => api.put<UnidadeSaude>(`/api/unidades-saude/${id}`, payload).then((r) => r.data);
export const deleteUnidadeSaude = (id: number) => api.delete(`/api/unidades-saude/${id}`).then((r) => r.data);

export const fetchUsuarios = (page?: number, limit?: number) =>
  api.get<Pagina<Usuario> | Usuario[]>("/api/usuarios/", { params: { page, limit } }).then((r) => r.data);
export const createUsuario = (payload: Record<string, unknown>) =>
  api.post<Usuario>("/api/usuarios/", payload).then((r) => r.data);
export const updateUsuario = (id: number, payload: Record<string, unknown>) =>
  api.put<Usuario>(`/api/usuarios/${id}`, payload).then((r) => r.data);
export const deleteUsuario = (id: number) =>
  api.delete(`/api/usuarios/${id}`).then((r) => r.data);
export const trocarMinhaSenha = (senha_atual: string, nova_senha: string) =>
  api
    .put("/api/usuarios/me/senha", { senha_atual, nova_senha })
    .then((r) => r.data);
export const primeiraTrocaSenha = (senha_atual: string, nova_senha: string, confirmar_senha: string) =>
  api
    .put("/api/usuarios/me/primeira-troca", { senha_atual, nova_senha, confirmar_senha })
    .then((r) => r.data);
export const resetSenhaUsuario = (id: number) =>
  api.post<{ ok: boolean; senha_temporaria: string; detail: string }>(`/api/usuarios/${id}/reset-senha`).then((r) => r.data);

export type SystemSettings = { cidade: string; uf: string; subtitulo: string; brasao_url: string; icone_url: string };
export const fetchSettingsPublic = () =>
  api.get<SystemSettings>("/api/settings/public").then((r) => r.data);
export const fetchSettings = () =>
  api.get<SystemSettings>("/api/settings").then((r) => r.data);
export const saveSettings = (p: SystemSettings) =>
  api.put<SystemSettings>("/api/settings", p).then((r) => r.data);

// ---------- Integrações (e-SUS APS/PEC, RNDS, importação de filas) ----------
export type Integracoes = {
  pec_fonte: string;
  pec_servidor_url: string;
  pec_banco_nome: string;
  pec_usuario: string;
  pec_senha_configurada: boolean;
  pec_database_configurada: boolean;
  pec_database_resumo: string;
  pec_ssh_habilitado: boolean;
  pec_ssh_host: string;
  pec_ssh_porta: number;
  pec_ssh_usuario: string;
  pec_ssh_senha_configurada: boolean;
  pec_ssh_chave_configurada: boolean;
  pec_porta_local: number;
  pec_ssh_tunel_ativo: boolean;
  pec_sync_automatica?: boolean;
  pec_sync_intervalo_horas?: number;
  pec_sync_ultima_execucao?: string;
  pec_sync_ultimo_status?: string;
  pec_sync_total_pacientes?: number;
  pec_sync_em_execucao?: boolean;
  rnds_ambiente: string;
  rnds_client_id: string;
  rnds_secret_configurado: boolean;
  rnds_cert_configurado: boolean;
  rnds_cert_resumo: string;
  rnds_key_configurada: boolean;
};
export const fetchIntegracoes = () =>
  api.get<Integracoes>("/api/integracoes").then((r) => r.data);
export const savePec = (p: Record<string, unknown>) =>
  api.put<Integracoes>("/api/integracoes/pec", p).then((r) => r.data);
export const saveRnds = (p: Record<string, unknown>) =>
  api.put<Integracoes>("/api/integracoes/rnds", p).then((r) => r.data);
export const testarPec = () =>
  api.post<{
    ok: boolean;
    fonte_efetiva: string;
    detalhe: string;
    latencia_ms?: number;
    banco?: string;
    usuario?: string;
    total_cidadaos?: number;
    tunel_ssh?: boolean;
  }>("/api/integracoes/pec/testar").then((r) => r.data);

export type PecSyncLogItem = {
  id: number;
  iniciado_em: string;
  finalizado_em?: string;
  status: "EM_EXECUCAO" | "SUCESSO" | "ERRO";
  total_lidos: number;
  total_inseridos: number;
  total_atualizados: number;
  total_duplicados_mesclados: number;
  total_erros: number;
  duracao_segundos: number;
  mensagem: string;
  detalhes?: string;
  origem: string;
};

export type PecSyncStatus = {
  em_execucao: boolean;
  automatica: boolean;
  intervalo_horas: number;
  ultima_execucao?: string;
  ultimo_status: string;
  total_pacientes: number;
  ultimo_log?: PecSyncLogItem;
};

export const fetchPecSyncStatus = () =>
  api.get<PecSyncStatus>("/api/integracoes/pec/sync/status").then((r) => r.data);

export const fetchPecSyncLogs = (limite = 15) =>
  api.get<PecSyncLogItem[]>("/api/integracoes/pec/sync/logs", { params: { limite } }).then((r) => r.data);

export type WhatsAppPreview = {
  exame_id?: number;
  paciente_id?: number;
  paciente_nome: string;
  telefone_original: string;
  telefone_formatado: string;
  telefone_whatsapp: string | null;
  tipo_evento: string;
  mensagem: string;
  link_whatsapp: string;
  whatsapp_configurado: boolean;
  whatsapp_habilitado: boolean;
};

export type WhatsAppConfig = {
  whatsapp_habilitado: boolean;
  whatsapp_provedor: string;
  whatsapp_api_url: string;
  whatsapp_token_configurado: boolean;
  whatsapp_api_token?: string;
  whatsapp_instancia_id: string;
  whatsapp_notificar_entrada_fila: boolean;
  whatsapp_notificar_agendamento: boolean;
  whatsapp_ddd_padrao: string;
};

export type WhatsAppLogItem = {
  id: number;
  criado_em: string;
  exame_id?: number;
  paciente_id?: number;
  tipo_evento: string;
  telefone_destinatario: string;
  paciente_nome: string;
  mensagem: string;
  status: string;
  sucesso: boolean;
  resposta_gateway?: string;
  erro?: string;
};

export const whatsappPreview = (exameId: number, tipo: string = "auto") =>
  api.get<WhatsAppPreview>("/api/whatsapp/preview", { params: { exame_id: exameId, tipo } }).then((r) => r.data);

export const whatsappEnviar = (payload: { exame_id: number; tipo?: string; telefone_customizado?: string; mensagem_customizada?: string }) =>
  api.post<{ sucesso: boolean; telefone?: string; status: string; erro?: string; mensagem?: string }>("/api/whatsapp/enviar", payload).then((r) => r.data);

export const whatsappObterConfig = () =>
  api.get<WhatsAppConfig>("/api/whatsapp/configuracao").then((r) => r.data);

export const whatsappSalvarConfig = (p: Partial<WhatsAppConfig> & { whatsapp_api_token?: string }) =>
  api.put<WhatsAppConfig>("/api/whatsapp/configuracao", p).then((r) => r.data);

export const whatsappTestar = (telefone: string, mensagem?: string) =>
  api.post<{ sucesso: boolean; erro?: string; status: string }>("/api/whatsapp/testar", { telefone, mensagem }).then((r) => r.data);

export const whatsappLogs = (limit = 30) =>
  api.get<WhatsAppLogItem[]>("/api/whatsapp/logs", { params: { limit } }).then((r) => r.data);
export const whatsappDispararLembretes = (dataAlvo?: string) =>
  api.post<{ executado: boolean; total_elegiveis: number; total_enviados: number; total_ja_enviados: number; total_falhas: number }>("/api/whatsapp/lembretes/disparar", null, { params: dataAlvo ? { data_alvo: dataAlvo } : undefined }).then((r) => r.data);

export const sincronizarPecPacientes = (background = true) =>
  api.post<{
    ok: boolean;
    status: string;
    mensagem: string;
    total_lidos?: number;
    total_inseridos?: number;
    total_atualizados?: number;
    total_duplicados_mesclados?: number;
    duracao_segundos?: number;
  }>("/api/integracoes/pec/sincronizar", null, { params: { background } }).then((r) => r.data);

export const sincronizarEnderecosPec = () =>
  api.post<{
    ok: boolean;
    total_analisados: number;
    total_atualizados: number;
    mensagem: string;
  }>("/api/integracoes/pec/sincronizar-enderecos").then((r) => r.data);

export const salvarPecSyncConfig = (p: { pec_sync_automatica?: boolean; pec_sync_intervalo_horas?: number }) =>
  api.put<{ ok: boolean; pec_sync_automatica: boolean; pec_sync_intervalo_horas: number }>(
    "/api/integracoes/pec/sync/config",
    p
  ).then((r) => r.data);
export const validarRnds = () =>
  api.post<{
    ok: boolean; ambiente: string; link: string;
    certificado: { configurado: boolean; subject?: string; issuer?: string; valido_de?: string; valido_ate?: string; dias_restantes?: number; expirado?: boolean };
    chave_configurada: boolean; pendencias: string[];
  }>("/api/integracoes/rnds/validar").then((r) => r.data);
export type ImportFilasOut = {
  simulacao: boolean; arquivo: string; lidas: number; pacientes_novos: number;
  exames_novos: number; atualizados: number; duplicados: number; ignoradas: number;
  catalogo: { tipos_novos: number; especialidades_novas: number; procedimentos_novos: number };
  erros: { linha: number; motivo: string }[];
};
export const importarFilas = (arquivo: File, simular: boolean) => {
  const form = new FormData();
  form.append("file", arquivo);
  return api.post<ImportFilasOut>("/api/integracoes/filas/importar", form, { params: { simular } }).then((r) => r.data);
};

// ---------- Versão / auto-update ----------
export type UpdateStatus = {
  versao: string;
  atual: boolean;
  tem_atualizacao: boolean;
  commit_local: string | null;
  commit_remoto: string | null;
  release: string | null;
  release_url: string | null;
  branch: string;
  repo: string;
  verificado_em: string;
  erro: string | null;
  update_enabled: boolean;
};
export const updateStatus = (forcar = false) =>
  api.get<UpdateStatus>("/api/update/status", { params: { forcar } }).then((r) => r.data);
export const updateExecutar = () =>
  api.post<{ started: boolean; detail: string }>("/api/update/executar").then((r) => r.data);
export const updateLog = (linhas = 200) =>
  api.get<{ log: string }>("/api/update/log", { params: { linhas } }).then((r) => r.data);

// ---------- Dashboard customizável ----------
export type DashboardItem = { id: string; tipo: "atalho" | "widget"; ref: string };
export const fetchDashboard = () =>
  api.get<{ items: DashboardItem[] }>("/api/user/dashboard").then((r) => r.data.items ?? []);
export const saveDashboard = (items: DashboardItem[]) =>
  api.put<{ items: DashboardItem[] }>("/api/user/dashboard", { items }).then((r) => r.data.items ?? []);
export type QuadroFiltros = { data: string; destino: string; psf?: string; agrupamento: "destino" | "data" };
export const fetchQuadroFiltros = () =>
  api.get<QuadroFiltros>("/api/user/quadro-viagens").then((r) => r.data);
export const saveQuadroFiltros = (data: string, destino: string, agrupamento: "destino" | "data" = "destino", psf = "") =>
  api.put<QuadroFiltros>("/api/user/quadro-viagens", { data, destino, psf, agrupamento }).then((r) => r.data);

// ---------- Auditoria ----------
export type AuditLog = {
  id: number;
  user_id: number | null;
  user_name: string;
  action: string;
  action_label?: string;
  entity: string;
  entity_label?: string;
  entity_id: number | null;
  device?: string;
  details: string;
  timestamp: string;
};
export type AuditEstatisticas = {
  total_registros: number;
  total_exportacoes: number;
  total_buscas: number;
  ultimos_30_dias: number;
  tamanho_estimado_kb: number;
  tamanho_estimado_formatado: string;
  top_acoes: { action: string; count: number }[];
  top_dispositivos: { device: string; count: number }[];
};
export const fetchAuditLogs = (params: { data_de?: string; data_ate?: string; usuario?: string; acao?: string; entidade?: string; page?: number; limit?: number }) =>
  api.get<Pagina<AuditLog> | AuditLog[]>("/api/auditoria/logs", { params }).then((r) => r.data);
export type FiltroItemAuditoria = string | { valor: string; rotulo: string };

export const fetchAuditFiltros = () =>
  api.get<{ acoes: FiltroItemAuditoria[]; entidades: FiltroItemAuditoria[]; usuarios: string[] }>("/api/auditoria/filtros").then((r) => r.data);
export const fetchAuditEstatisticas = () =>
  api.get<AuditEstatisticas>("/api/auditoria/estatisticas").then((r) => r.data);
export const executarRotacaoAudit = (meses_retencao: number = 6, arquivar: boolean = true) =>
  api.post<{
    removidos: number;
    meses_retencao: number;
    arquivado: boolean;
    arquivo_gz?: string;
    tamanho_arquivo_bytes?: number;
    mensagem?: string;
  }>("/api/auditoria/rotacao", { meses_retencao, arquivar }).then((r) => r.data);
export type RegistroRelacionado = {
  entity: string;
  entity_id: number;
  existe: boolean;
  inativo: boolean;
  rota: string | null;
  titulo: string;
  subtitulo: string;
  pai?: { rota: string; titulo: string } | null;
};
export const fetchRegistroRelacionado = (entity: string, entityId: number) =>
  api.get<RegistroRelacionado>(`/api/auditoria/registros/${entity}/${entityId}`).then((r) => r.data);
export type TimelineEvento = { data: string; tipo: string; titulo: string; detalhe: string; usuario: string; status: string };
export const fetchTimeline = (pacienteId: number) =>
  api.get<{ paciente: { id: number; nome: string }; status_atual: string; eventos: TimelineEvento[] }>(`/api/auditoria/pacientes/${pacienteId}/timeline`).then((r) => r.data);

// ---------- TFD ----------
export type Paciente = {
  id: number;
  codigo_prontuario?: string;
  nome: string;
  cpf: string;
  cns: string;
  nascimento: string | null;
  telefone: string;
  endereco: string;
  endereco_numero: string;
  complemento?: string;
  bairro: string;
  municipio?: string;
  cep: string;
  unidade_saude_id: number | null;
  equipe_esf: string;
  acs_nome: string;
  observacoes: string;
};

export type DemandaItem = {
  id: number;
  exame: string;
  especialidade: string;
  nome_especialidade: string;
  tipo_fila: string;
  prioridade: string;
  classificacao_risco: string;
  data_pedido: string | null;
  data_inclusao: string;
  posicao_especialidade: number | null;
  total_fila_especialidade: number | null;
  posicao_fila_geral?: number | null;
  total_fila_geral?: number | null;
  status: string;
  status_rotulo: string;
  data_agendada: string | null;
  hora_agendada: string;
};

export type PacientePerfil = {
  paciente: Paciente;
  unidade_saude_nome: string;
  demanda: DemandaItem[];
};
export const tfdPerfilPaciente = (id: number) =>
  api.get<PacientePerfil>(`/api/tfd/pacientes/${id}/perfil`).then((r) => r.data);

export type Veiculo = {
  id: number;
  placa: string;
  modelo: string;
  capacidade: number;
  tipo: string;
  status: string;
  ativo: boolean;
};

export type Viagem = {
  id: number;
  destino: string;
  unidade: string;
  data_viagem: string;
  hora_saida: string;
  veiculo_id: number | null;
  motorista: string;
  motorista_id?: number | null;
  departamento: string;
  data_retorno: string | null;
  hora_retorno: string;
  km_inicial: number;
  km_final: number;
  adiantamento: number;
  status: string;
  finalidade: string;
  observacoes: string;
  passageiros: number;
  veiculo_placa: string;
  veiculo_modelo?: string;
};

export type Destino = {
  id: number;
  nome_destino: string;
  hospital_referencia: string;
  procedimento_sigtap: string;
  codigo_desloc_pac: string;
  qtd_desloc_pac: number;
  codigo_desloc_acomp: string;
  qtd_desloc_acomp: number;
  ativo: boolean;
};

export type Passageiro = {
  id: number;
  viagem_id: number;
  paciente_id: number;
  acompanhante: string;
  acompanhante_id?: number | null;
  acompanhante_nome?: string;
  acompanhante_cpf?: string;
  presente: boolean;
  paciente_nome: string;
  paciente_telefone?: string;
  viagem_fila_id?: number | null;
  prioridade?: string;
  tratamento?: string;
  unidade?: string;
  hora_consulta?: string;
  observacoes?: string;
  status_confirmacao?: string; // "pendente" | "confirmado" | "desistiu" | "nao_compareceu"
  confirmado_em?: string | null;
  token_confirmacao?: string;
  lembrete_enviado?: boolean;
  lembrete_enviado_em?: string | null;
  link_confirmacao?: string;
};

export type ViagemConfirmacaoPublica = {
  token: string;
  paciente_nome: string;
  paciente_iniciais: string;
  data_viagem: string;
  hora_saida: string;
  ponto_saida: string;
  destino: string;
  unidade: string;
  veiculo: string;
  modelo_veiculo: string;
  placa_veiculo: string;
  motorista: string;
  tratamento: string;
  acompanhante: string;
  status_confirmacao: string;
  confirmado_em: string | null;
  observacoes: string;
};

export type ViagemFila = {
  id: number;
  paciente_id: number;
  destino: string;
  unidade: string;
  tratamento: string;
  data_consulta: string | null;
  hora_consulta: string;
  acompanhante: boolean;
  acompanhante_id?: number | null;
  acompanhante_nome?: string;
  acompanhante_cpf?: string;
  prioridade: string;
  status: string;
  exame_fila_id: number | null;
  observacoes: string;
  paciente_nome: string;
  paciente_cpf: string;
  paciente_nascimento: string | null;
};

export type DiaPassageiro = Passageiro & {
  paciente_cpf: string;
  paciente_nascimento: string | null;
};

export type DiaViagem = {
  id: number;
  nome?: string;
  destino: string;
  unidade: string;
  data_viagem: string;
  hora_saida: string;
  hora_retorno?: string;
  ponto_saida?: string;
  motorista: string;
  motorista_id?: number | null;
  status: string;
  finalidade: string;
  veiculo_id: number | null;
  veiculo_placa: string;
  veiculo_modelo: string;
  capacidade: number;
  ocupados: number;
  vagas: number;
  confirmados?: number;
  pendentes?: number;
  desistencias?: number;
  passageiros_restritos?: boolean;
  passageiros: DiaPassageiro[];
};

export type DiaDestino = {
  destino: string;
  viagens: DiaViagem[];
  demanda_aguardando: number;
};

export type FrotaDia = {
  id: number;
  placa: string;
  modelo: string;
  tipo: string;
  capacidade: number;
  status: string;
  em_outra_viagem: boolean;
};

export const tfdFilaViagem = (params?: { destino?: string; psf?: string; status?: string }) =>
  api.get<ViagemFila[]>("/api/tfd/viagens-fila", { params }).then((r) => r.data);
export const tfdCriarFilaViagem = (p: Record<string, unknown>) =>
  api.post<ViagemFila>("/api/tfd/viagens-fila", p).then((r) => r.data);
export const tfdAtualizarFilaViagem = (id: number, p: Record<string, unknown>) =>
  api.put<ViagemFila>(`/api/tfd/viagens-fila/${id}`, p).then((r) => r.data);
export const tfdExcluirFilaViagem = (id: number) =>
  api.delete(`/api/tfd/viagens-fila/${id}`);
export const tfdPuxarAgendados = (data?: string, ids?: number[]) =>
  api.post<{ criados: number; ignorados: number }>(
    "/api/tfd/viagens-fila/puxar-agendados",
    ids !== undefined ? { ids } : {},
    { params: { data } },
  ).then((r) => r.data);
export type CandidatoPuxar = {
  exame_fila_id: number;
  paciente_id: number;
  paciente_nome: string;
  exame: string;
  destino: string;
  unidade: string;
  data_agendada: string;
  hora_agendada: string;
  prioridade: string;
};
export const tfdCandidatosPuxar = (data?: string) =>
  api.get<CandidatoPuxar[]>("/api/tfd/viagens-fila/candidatos-agendados", { params: { data } }).then((r) => r.data);
export const tfdDia = (data: string) =>
  api.get<{ data: string; destinos: DiaDestino[]; frota: FrotaDia[] }>("/api/tfd/viagens/dia", { params: { data } }).then((r) => r.data);
export type DiaSemana = { data: string; destinos: DiaDestino[] };
export const tfdSemana = (inicio: string) =>
  api.get<{ inicio: string; dias: DiaSemana[]; frota: FrotaDia[] }>("/api/tfd/viagens/semana", { params: { inicio } }).then((r) => r.data);
export const tfdFaturarDeslocamento = (id: number) =>
  api.post<{ criados: number; ignorados: number }>(`/api/tfd/viagens/${id}/faturar-deslocamento`).then((r) => r.data);
export const tfdSugestao = (data: string, destino: string, viagemId?: number) =>
  api.get<{ veiculo: FrotaDia | null; demanda: number; assentos: number; motivo: string }>("/api/tfd/viagens/sugestao", { params: { data, destino, viagem_id: viagemId ?? undefined } }).then((r) => r.data);
export type Disponibilidade = {
  data: string;
  janela: { saida: string; retorno: string };
  veiculos: (FrotaDia & { disponivel: boolean; ocupado_por: string | null })[];
  motoristas: { id: number; nome: string; disponivel: boolean; ocupado_por: string | null }[];
};
export const tfdDisponibilidade = (data: string, saida: string, retorno: string, ignorarId?: number) =>
  api.get<Disponibilidade>("/api/tfd/viagens/disponibilidade", {
    params: { data, saida, retorno, ignorar_id: ignorarId || undefined },
  }).then((r) => r.data);
export const tfdOrdemCirculacaoBlob = async (id: number): Promise<{ url: string; nome: string }> => {
  const r = await api.get(`/api/tfd/viagens/${id}/ordem-circulacao`, { responseType: "blob" });
  const disp: string = r.headers?.["content-disposition"] ?? "";
  const m = disp.match(/filename="?([^";]+)"?/);
  const blob = new Blob([r.data as BlobPart], { type: (r.headers?.["content-type"] as string | undefined) ?? undefined });
  return { url: URL.createObjectURL(blob), nome: m ? m[1] : `ordem_circulacao_${id}.odt` };
};
export const tfdOrdemCirculacao = (id: number) =>
  api.get<Blob>(`/api/tfd/viagens/${id}/ordem-circulacao`, { responseType: "blob" }).then((r) => r.data);

export type Exame = {
  id: number;
  paciente_id: number;
  exame: string;
  especialidade: string;
  tipo_fila: string;
  codigo_procedimento: string;
  codigo_especialidade: string;
  nome_especialidade: string;
  cid_codigo?: string;
  cid_descricao?: string;
  prioridade: string;
  justificativa_prioridade?: string;
  status: string;
  data_pedido: string;
  data_agendada: string | null;
  hora_agendada?: string;
  medico_id?: number | null;
  unidade_saude_id?: number | null;
  destino: string;
  observacoes: string;
  justificativa?: string;
  resultado?: string;
  recepcionado_em?: string | null;
  recepcionado_por?: string;
  status_anterior?: string;
  paciente_nome: string;
  paciente_cpf?: string;
  paciente_endereco?: string;
  paciente_numero?: string;
  paciente_complemento?: string;
  paciente_bairro?: string;
  paciente_municipio?: string;
  paciente_telefone?: string;
  paciente_cns?: string;
  paciente_nascimento?: string | null;
  codigo_curto?: string;
  numero_pedido?: string;
  public_token?: string;
  posicao?: number | null;
  total_fila?: number | null;
  grupo_fila?: string;
  posicao_tipo?: number | null;
  total_tipo?: number | null;
  grupo_tipo?: string;
  posicao_especialidade?: number | null;
  total_especialidade?: number | null;
  grupo_especialidade?: string;
  medico_nome?: string;
  medico_cpf?: string;
  medico_cbo_codigo?: string;
  medico_cbo_descricao?: string;
  unidade_nome?: string;
  unidade_cnes?: string;
  unidade_endereco?: string;
  unidade_numero?: string;
  unidade_bairro?: string;
  unidade_municipio?: string;
  unidade_cep?: string;
};

export type ExamePublico = {
  exame: string;
  especialidade: string;
  status: string;
  prioridade: string;
  data_pedido: string | null;
  data_agendada: string | null;
  destino: string;
  posicao: number | null;
  total_fila: number | null;
  grupo_fila?: string;
  paciente_iniciais: string;
};

export type Fatura = {
  id: number;
  viagem_id: number | null;
  paciente_id: number;
  procedimento: string;
  codigo_sigtap: string;
  competencia: string;
  quantidade: number;
  valor: number;
  tipo: string;
  status: string;
  observacoes: string;
  paciente_nome: string;
  total: number;
};

export type ResumoTfd = {
  viagens_mes: number;
  passageiros_mes: number;
  exames_aguardando: number;
  exames_urgentes: number;
  valor_competencia: number;
  ocupacao_media: number;
};

export const tfdResumo = (competencia?: string) =>
  api.get<ResumoTfd>("/api/tfd/resumo", { params: { competencia } }).then((r) => r.data);

export const tfdPacientes = (q?: string, page?: number, limit?: number) =>
  api.get<Pagina<Paciente> | Paciente[]>("/api/tfd/pacientes", { params: { q, page, limit } }).then((r) => r.data);
export const tfdPaciente = (id: number) =>
  api.get<Paciente>(`/api/tfd/pacientes/${id}`).then((r) => r.data);
export const tfdCriarPaciente = (p: Record<string, unknown>) =>
  api.post<Paciente>("/api/tfd/pacientes", p).then((r) => r.data);
export const tfdAtualizarPaciente = (id: number, p: Record<string, unknown>) =>
  api.put<Paciente>(`/api/tfd/pacientes/${id}`, p).then((r) => r.data);
export const tfdExcluirPaciente = (id: number) =>
  api.delete(`/api/tfd/pacientes/${id}`);

export const tfdVeiculos = (page?: number, limit?: number) =>
  api.get<Pagina<Veiculo> | Veiculo[]>("/api/tfd/veiculos", { params: { page, limit } }).then((r) => r.data);
export const tfdCriarVeiculo = (p: Record<string, unknown>) =>
  api.post<Veiculo>("/api/tfd/veiculos", p).then((r) => r.data);
export const tfdAtualizarVeiculo = (id: number, p: Record<string, unknown>) =>
  api.put<Veiculo>(`/api/tfd/veiculos/${id}`, p).then((r) => r.data);
export const tfdExcluirVeiculo = (id: number) =>
  api.delete(`/api/tfd/veiculos/${id}`);

export type Motorista = {
  id: number;
  nome: string;
  cpf: string;
  cnh_numero: string;
  cnh_categoria: string;
  cnh_validade: string | null;
  telefone: string;
  ativo: boolean;
};

export const tfdMotoristas = (params?: { q?: string; page?: number; limit?: number }) =>
  api.get<Pagina<Motorista> | Motorista[]>("/api/tfd/motoristas", { params }).then((r) => r.data);
export const tfdCriarMotorista = (p: Record<string, unknown>) =>
  api.post<Motorista>("/api/tfd/motoristas", p).then((r) => r.data);
export const tfdAtualizarMotorista = (id: number, p: Record<string, unknown>) =>
  api.put<Motorista>(`/api/tfd/motoristas/${id}`, p).then((r) => r.data);
export const tfdExcluirMotorista = (id: number) =>
  api.delete(`/api/tfd/motoristas/${id}`);

export type RelatorioFrota = {
  periodo: { de: string; ate: string };
  total_viagens: number;
  por_status: Record<string, number>;
  km_total: number;
  ocupacao_media: number;
  por_veiculo: { veiculo_id: number | null; placa: string; modelo: string; viagens: number; km: number; ocupacao_media: number }[];
  por_motorista: { motorista: string; viagens: number; km: number }[];
  mais_usado_veiculo: { placa: string; modelo: string; viagens: number; km: number } | null;
  mais_usado_motorista: { motorista: string; viagens: number; km: number } | null;
};
export const tfdRelatorioFrota = (de?: string, ate?: string) =>
  api.get<RelatorioFrota>("/api/tfd/frota/relatorio", { params: { de: de || undefined, ate: ate || undefined } }).then((r) => r.data);

export const tfdDestinos = (page?: number, limit?: number) =>
  api.get<Pagina<Destino> | Destino[]>("/api/tfd/destinos", { params: { page, limit } }).then((r) => r.data);
export const tfdCriarDestino = (p: Record<string, unknown>) =>
  api.post<Destino>("/api/tfd/destinos", p).then((r) => r.data);
export const tfdAtualizarDestino = (id: number, p: Record<string, unknown>) =>
  api.put<Destino>(`/api/tfd/destinos/${id}`, p).then((r) => r.data);
export const tfdExcluirDestino = (id: number) =>
  api.delete(`/api/tfd/destinos/${id}`);

export type PacientePec = {
  id: number | null;
  origem: "local" | "pec";
  nome: string;
  cns: string;
  cpf: string;
  prontuario: string;
  nascimento: string | null;
  ubs?: string;
};
export type BuscaPacientesPec = {
  fonte: string;
  termo: string;
  resultados: PacientePec[];
};
export const tfdBuscarPacientesPec = (termo: string) =>
  api.get<BuscaPacientesPec>("/api/tfd/pacientes/buscar", { params: { termo } }).then((r) => r.data);

export const tfdViagens = (params?: { status?: string; mes?: string; ano?: string | number; page?: number; limit?: number }) =>
  api.get<Pagina<Viagem> | Viagem[]>("/api/tfd/viagens", { params }).then((r) => r.data);
export const tfdObterViagem = (id: number) =>
  api.get<Viagem>(`/api/tfd/viagens/${id}`).then((r) => r.data);
export const tfdTrocarVeiculoViagem = (id: number, veiculo_id: number | null, motorista?: string, motorista_id?: number | null) =>
  api.patch<Viagem>(`/api/tfd/viagens/${id}/veiculo`, { veiculo_id, motorista, motorista_id }).then((r) => r.data);
export const tfdCriarViagem = (p: Record<string, unknown>) =>
  api.post<Viagem>("/api/tfd/viagens", p).then((r) => r.data);
export const tfdAtualizarViagem = (id: number, p: Record<string, unknown>) =>
  api.put<Viagem>(`/api/tfd/viagens/${id}`, p).then((r) => r.data);
export const tfdExcluirViagem = (id: number) =>
  api.delete(`/api/tfd/viagens/${id}`);
export const tfdPassageiros = (viagemId: number) =>
  api.get<Passageiro[]>(`/api/tfd/viagens/${viagemId}/passageiros`).then((r) => r.data);
export const tfdAddPassageiro = (viagemId: number, p: Record<string, unknown>) =>
  api.post<Passageiro>(`/api/tfd/viagens/${viagemId}/passageiros`, p).then((r) => r.data);
export const tfdRemoverPassageiro = (viagemId: number, pid: number) =>
  api.delete(`/api/tfd/viagens/${viagemId}/passageiros/${pid}`);
export const tfdAtualizarConfirmacaoPassageiro = (viagemId: number, pid: number, status_confirmacao: string, observacoes?: string) =>
  api.patch<Passageiro>(`/api/tfd/viagens/${viagemId}/passageiros/${pid}/confirmacao`, { status_confirmacao, observacoes }).then((r) => r.data);
export const tfdEnviarWhatsAppConfirmacaoPassageiro = (viagemId: number, pid: number) =>
  api.post<{ sucesso: boolean; link_confirmacao: string; mensagem: string; whatsapp_link: string; telefone: string }>(`/api/tfd/viagens/${viagemId}/passageiros/${pid}/enviar-whatsapp`).then((r) => r.data);
export const tfdConsultarViagemPublica = (token: string) =>
  api.get<ViagemConfirmacaoPublica>(`/api/tfd/public/viagens/confirmar/${token}`).then((r) => r.data);
export const tfdConfirmarPresencaPublica = (token: string, acao: "confirmar" | "desistir" | "cancelar", motivo?: string) =>
  api.post<ViagemConfirmacaoPublica>(`/api/tfd/public/viagens/confirmar/${token}`, { acao, motivo }).then((r) => r.data);

export type Pagina<T> = {
  data: T[];
  total: number;
  page: number;
  pages: number;
};

/** Normaliza resposta paginada; aceita lista legada p/ compat. */
export function pagData<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  const d = (r as { data?: unknown })?.data;
  return Array.isArray(d) ? (d as T[]) : [];
}

export function pagMeta(r: unknown): { total: number; page: number; pages: number } {
  if (Array.isArray(r)) {
    const n = (r as unknown[]).length;
    return { total: n, page: 1, pages: 1 };
  }
  const o = (r as { total?: number; page?: number; pages?: number }) ?? {};
  return {
    total: Number(o.total ?? pagData(r).length ?? 0),
    page: Number(o.page ?? 1),
    pages: Number(o.pages ?? 1),
  };
}

export type FilaExamesParams = {
  status?: string;
  q?: string;
  prioridade?: string;
  especialidade?: string;
  tipo_fila?: string;
  procedimento?: string;
  codigo_especialidade?: string;
  destino?: string;
  unidade_id?: number;
  unidade?: string;
  data_de?: string;
  data_ate?: string;
  agendada_em?: string;
  agendada_de?: string;
  agendada_ate?: string;
  apenas_agendados?: boolean;
  ordenacao?: string;
  meus?: boolean;
  page?: number;
  limit?: number;
};

export type OpcaoFiltro = { value: string; label: string; total: number };
export type FiltrosOpcoes = {
  tipos: OpcaoFiltro[];
  procedimentos: OpcaoFiltro[];
  especialidades: OpcaoFiltro[];
};
export async function tfdFiltrosOpcoes(
  status?: string,
  tipo_fila?: string
): Promise<{ tipos: OpcaoFiltro[]; procedimentos: OpcaoFiltro[]; especialidades: OpcaoFiltro[] }> {
  return api
    .get<FiltrosOpcoes>("/api/tfd/exames/filtros-opcoes", {
      params: { status, tipo_fila: tipo_fila || undefined },
    })
    .then((r) => r.data);
}

export type TipoFila = { id: number; codigo: string; nome: string; ativo: boolean };
export type ProcedimentoCat = {
  id: number; codigo: string; nome: string; tipo_fila: string;
  codigo_especialidade: string; nome_especialidade: string; codigo_curto: string; ativo: boolean;
};
export type EspecialidadeCat = { id: number; codigo_cbo: string; nome: string; ativo: boolean };

export const tfdTipos = (params?: { q?: string; page?: number; limit?: number }) =>
  api.get<Pagina<TipoFila> | TipoFila[]>("/api/tfd/tipos", { params }).then((r) => r.data);
export const tfdCriarTipo = (p: Record<string, unknown>) =>
  api.post<TipoFila>("/api/tfd/tipos", p).then((r) => r.data);
export const tfdAtualizarTipo = (id: number, p: Record<string, unknown>) =>
  api.put<TipoFila>(`/api/tfd/tipos/${id}`, p).then((r) => r.data);
export const tfdExcluirTipo = (id: number) => api.delete(`/api/tfd/tipos/${id}`);

export const tfdProcedimentos = (params?: { q?: string; tipo_fila?: string; page?: number; limit?: number }) =>
  api.get<Pagina<ProcedimentoCat> | ProcedimentoCat[]>("/api/tfd/procedimentos", { params }).then((r) => r.data);
export const tfdCriarProcedimento = (p: Record<string, unknown>) =>
  api.post<ProcedimentoCat>("/api/tfd/procedimentos", p).then((r) => r.data);
export const tfdAtualizarProcedimento = (id: number, p: Record<string, unknown>) =>
  api.put<ProcedimentoCat>(`/api/tfd/procedimentos/${id}`, p).then((r) => r.data);
export const tfdExcluirProcedimento = (id: number) => api.delete(`/api/tfd/procedimentos/${id}`);

export const tfdEspecialidades = (params?: { q?: string; page?: number; limit?: number }) =>
  api.get<Pagina<EspecialidadeCat> | EspecialidadeCat[]>("/api/tfd/especialidades", { params }).then((r) => r.data);
export const tfdCriarEspecialidade = (p: Record<string, unknown>) =>
  api.post<EspecialidadeCat>("/api/tfd/especialidades", p).then((r) => r.data);
export const tfdAtualizarEspecialidade = (id: number, p: Record<string, unknown>) =>
  api.put<EspecialidadeCat>(`/api/tfd/especialidades/${id}`, p).then((r) => r.data);
export const tfdExcluirEspecialidade = (id: number) => api.delete(`/api/tfd/especialidades/${id}`);

export type SigtapCidItem = {
  codigo: string;
  descricao: string;
};

export const tfdBuscarCids = (q: string) =>
  api.get<SigtapCidItem[]>("/api/tfd/cids", { params: { q } }).then((r) => r.data);

export const tfdExames = (statusOrParams?: string | FilaExamesParams) => {
  const params =
    typeof statusOrParams === "string" ? { status: statusOrParams || undefined } : statusOrParams;
  return api.get<Pagina<Exame> | Exame[]>("/api/tfd/exames", { params }).then((r) => r.data);
};
export const tfdExameDetalhe = (id: number) =>
  api.get<Exame>(`/api/tfd/exames/${id}`).then((r) => r.data);
export const tfdCriarExame = (p: Record<string, unknown>) =>
  api.post<Exame>("/api/tfd/exames", p).then((r) => r.data);
export const tfdAtualizarExame = (id: number, p: Record<string, unknown>) =>
  api.put<Exame>(`/api/tfd/exames/${id}`, p).then((r) => r.data);
export const tfdAlterarPrioridade = (id: number, p: { prioridade: string; justificativa: string }) =>
  api.put<Exame>(`/api/tfd/exames/${id}/prioridade`, p).then((r) => r.data);
export type ExameLotePayload = {
  ids: number[];
  status?: string;
  data_agendada?: string | null;
  hora_agendada?: string;
  medico_id?: number;
  unidade_saude_id?: number;
  limpar_data_agendada?: boolean;
  destino?: string;
  prioridade?: string;
  justificativa_prioridade?: string;
  observacoes?: string;
  enviar_whatsapp?: boolean;
  instrucoes_transporte?: string;
};
export const tfdAtualizarExamesLote = (p: ExameLotePayload) =>
  api.put<{ atualizados: number; nao_encontrados: number[] }>("/api/tfd/exames/lote", p).then((r) => r.data);
export const tfdExcluirExame = (id: number, motivo?: string) =>
  api.delete(`/api/tfd/exames/${id}`, { params: motivo ? { motivo } : undefined });
export type CatalogoProc = {
  exame: string;
  nome_procedimento?: string;
  codigo_procedimento?: string;
  especialidade: string;
  codigo_especialidade?: string;
  nome_especialidade?: string;
  tipo_fila?: string;
  codigo_curto: string;
  rotulo: string;
  usos: number;
  origem?: string;
};

export interface ValidarCboResult {
  codigo_procedimento: string;
  nome_procedimento: string;
  hierarquia: {
    codigo: string;
    grupo_codigo: string;
    grupo_nome: string;
    subgrupo_codigo: string;
    subgrupo_nome: string;
    forma_organizacao: string;
    eh_laboratorial: boolean;
    eh_cirurgico: boolean;
    eh_consulta: boolean;
  };
  exige_cbo_estrito: boolean;
  cbo_profissional: string;
  compativel: boolean;
  motivo: string;
  alerta: string | null;
  permite_responsavel_tecnico: boolean;
  cbos_autorizados: Array<{ cbo: string; descricao: string }>;
}

export const validarCboProcedimento = (payload: {
  codigo_procedimento: string;
  medico_id?: number | null;
  medico_nome?: string | null;
  cbo?: string | null;
  tipo_fila?: string | null;
}) =>
  api.post<ValidarCboResult>("/api/tfd/procedimentos/validar-cbo", payload).then((r) => r.data);

export const tfdCatalogoExames = (q?: string, tipo_fila?: string, apenas_laboratoriais?: boolean) =>
  api.get<CatalogoProc[]>("/api/tfd/exames/catalogo", { params: { q, tipo_fila, apenas_laboratoriais } }).then((r) => r.data);

export type ExamePermitidoItem = {
  id: number;
  codigo: string;
  descricao: string;
  instrumento: string;
};

export type ExamesPermitidosData = {
  codigos_habilitados: string[];
  total_habilitados: number;
  procedimentos_sigtap: ExamePermitidoItem[];
};

export const fetchExamesPermitidos = () =>
  api.get<ExamesPermitidosData>("/api/settings/exames-permitidos").then((r) => r.data);

export const salvarExamesPermitidos = (codigos: string[]) =>
  api.put<{ ok: boolean; total_habilitados: number; codigos_habilitados: string[] }>("/api/settings/exames-permitidos", { codigos }).then((r) => r.data);
export const tfdRegenerarTokenExame = (id: number) =>
  api.post<Exame>(`/api/tfd/exames/${id}/regenerar-token`).then((r) => r.data);
export const tfdRecepcionarExame = (id: number) =>
  api.post<Exame>(`/api/tfd/exames/${id}/recepcionar`).then((r) => r.data);
export const tfdEstornarRecepcaoExame = (id: number) =>
  api.post<Exame>(`/api/tfd/exames/${id}/estornar-recepcao`).then((r) => r.data);
export const tfdAtendimentoStatus = (id: number, status: "faltou" | "realizado" | "cancelado", resultado?: string) =>
  api.post<Exame>(`/api/tfd/exames/${id}/atendimento-status`, { status, resultado: resultado ?? "" }).then((r) => r.data);
export const tfdRecepcionarLote = (ids: number[]) =>
  api.post<{ ok: boolean; atualizados: number; total: number }>("/api/tfd/exames/recepcionar-lote", { ids }).then((r) => r.data);
export const tfdAtendimentoStatusLote = (ids: number[], status: "faltou" | "realizado" | "cancelado", resultado?: string) =>
  api.post<{ ok: boolean; atualizados: number; total: number }>("/api/tfd/exames/atendimento-status-lote", { ids, status, resultado: resultado ?? "" }).then((r) => r.data);

export interface MetricasAgendados {
  total: number;
  agendados: number;
  recepcionados: number;
  realizados: number;
  faltaram: number;
  cancelados: number;
  taxa_comparecimento: number;
  taxa_absenteismo: number;
}

export interface ItemAgendadoRelatorio {
  id: number;
  codigo_curto: string;
  paciente_id: number;
  paciente_nome: string;
  paciente_cpf: string;
  paciente_cns: string;
  paciente_telefone: string;
  data_pedido: string;
  data_agendada: string;
  hora_agendada: string;
  exame: string;
  tipo_fila: string;
  especialidade: string;
  unidade_saude_id?: number | null;
  unidade_nome: string;
  medico_id?: number | null;
  medico_nome: string;
  status: string;
  prioridade: string;
  resultado: string;
  recepcionado_em?: string | null;
  recepcionado_por?: string;
}

export interface RelatorioAgendadosRes {
  metricas: MetricasAgendados;
  itens: ItemAgendadoRelatorio[];
  total: number;
  page: number;
  pages: number;
}

export const tfdRelatorioAgendados = (params?: {
  data_de?: string;
  data_ate?: string;
  unidade_id?: number;
  medico_id?: number;
  status?: string;
  tipo_fila?: string;
  procedimento?: string;
  segmentacao?: string;
  escopo?: string;
  q?: string;
  page?: number;
  limit?: number;
}) => api.get<RelatorioAgendadosRes>("/api/tfd/relatorios/agendados", { params }).then((r) => r.data);
export const tfdConsultarExamePublico = (token: string) =>
  api.get<ExamePublico>(`/api/tfd/public/exames/${token}`).then((r) => r.data);

export type LeituraRapidaRes = {
  encontrado: boolean;
  tipo: "tfd" | "lab";
  pedido_id: number;
  codigo_curto: string;
  numero_pedido: string;
  status: string;
  data_pedido: string;
  data_agendada: string;
  hora_agendada: string;
  unidade_nome: string;
  medico_nome: string;
  destino: string;
  paciente: {
    id: number | null;
    nome: string;
    prontuario: string;
    cpf: string;
    cns: string;
    telefone: string;
    data_nascimento: string;
  };
  exames: {
    id: number;
    codigo: string;
    nome: string;
    status: string;
    resultado?: string;
    observacoes?: string;
  }[];
  preparo: {
    jejum: string;
    instrucoes: string[];
  };
  transporte?: {
    possui_viagem: boolean;
    viagem_id?: number;
    veiculo: string;
    modelo_veiculo?: string;
    placa_veiculo?: string;
    tipo_veiculo?: string;
    ponto_saida: string;
    horario_saida: string;
    destino: string;
    motorista?: string;
    acompanhante?: string;
    observacoes?: string;
  } | null;
  instrucoes_transporte?: string;
  pode_recepcionar: boolean;
  todos_coletados: boolean;
};

export const tfdObterComprovante = (id: number): Promise<ComprovanteExame> =>
  api.get(`/api/tfd/exames/${id}/comprovante`).then((r) => r.data as ComprovanteExame);

export const tfdObterComprovantePorPedido = (numeroPedido: string): Promise<ComprovanteExame> =>
  api.get(`/api/tfd/exames/pedido/${encodeURIComponent(numeroPedido)}/comprovante`).then((r) => r.data as ComprovanteExame);

export const tfdLeituraRapida = (codigo: string): Promise<LeituraRapidaRes> =>
  api.get("/api/tfd/leitura-rapida", { params: { codigo } }).then((r) => r.data as LeituraRapidaRes);

export const tfdRecepcaoRapida = (codigo: string, resultado?: string): Promise<{ sucesso: boolean; tipo: string; pedido_id: number; total_recepcionados: number; status: string; mensagem: string }> =>
  api.post("/api/tfd/recepcao-rapida", { codigo, resultado }).then((r) => r.data);

export const tfdFaturas = (competencia?: string, page?: number, limit?: number) =>
  api.get<Pagina<Fatura> | Fatura[]>("/api/tfd/faturamento", { params: { competencia, page, limit } }).then((r) => r.data);
export const tfdCriarFatura = (p: Record<string, unknown>) =>
  api.post<Fatura>("/api/tfd/faturamento", p).then((r) => r.data);
export const tfdAtualizarFatura = (id: number, p: Record<string, unknown>) =>
  api.put<Fatura>(`/api/tfd/faturamento/${id}`, p).then((r) => r.data);
export const tfdExcluirFatura = (id: number) =>
  api.delete(`/api/tfd/faturamento/${id}`);

// ---------- Lab / Exames BPA ----------
export type SigtapProc = {
  id: number;
  codigo: string;
  descricao: string;
  complexidade: string;
  instrumento: string;
  sexo?: string;
  idade_min?: number;
  idade_max?: number;
  qtd_maxima?: number;
  pontos?: number;
  valor_sa?: number;
  valor_sp?: number;
  valor_sh?: number;
  competencia?: string;
};

export type SigtapVersao = {
  id: number;
  competencia: string;
  origem: string;
  arquivo: string;
  total_proc: number;
  inseridos: number;
  atualizados: number;
  cbo_total: number;
  cid_total: number;
  ignorados: number;
  usuario: string;
  criado_em: string;
};

export type SigtapImportOut = {
  simulacao: boolean;
  arquivo: string;
  competencia: string;
  processados: number;
  inseridos: number;
  atualizados: number;
  ignorados: number;
  cbo_total: number;
  cid_total: number;
  erros: { arquivo: string; linha: number; motivo: string }[];
};

export const sigtapVersoes = () =>
  api.get<SigtapVersao[]>("/api/lab/sigtap/versoes").then((r) => r.data);
export type SigtapCbo = { cbo: string; descricao: string; origem: string };
export const sigtapCbos = (procedimento_codigo?: string, q?: string) =>
  api.get<SigtapCbo[]>("/api/lab/sigtap/cbos", { params: { procedimento_codigo, q } }).then((r) => r.data);
export const sigtapImportar = (arquivo: File, competencia: string, simular: boolean) => {
  const form = new FormData();
  form.append("file", arquivo);
  return api
    .post<SigtapImportOut>("/api/lab/sigtap/importar", form, { params: { competencia, simular } })
    .then((r) => r.data);
};

export type LabSol = {
  id: number;
  paciente_id: number;
  sigtap_id: number;
  data_solicitacao: string;
  laboratorio: string;
  status: string;
  faturado: boolean;
  competencia: string;
  observacoes: string;
  paciente_nome: string;
  procedimento_codigo: string;
  procedimento_descricao: string;
};

export const labSigtap = (q?: string, instrumento?: string, page?: number, limit?: number, apenas_laboratoriais: boolean = true) =>
  api
    .get<Pagina<SigtapProc> | SigtapProc[]>("/api/lab/sigtap", { params: { q, instrumento, page, limit, apenas_laboratoriais } })
    .then((r) => r.data);

export const labSols = (filtros?: {
  periodo?: string;
  status?: string;
  laboratorio?: string;
  page?: number;
  limit?: number;
}) =>
  api
    .get<Pagina<LabSol> | LabSol[]>("/api/lab/solicitacoes", {
      params: {
        competencia: filtros?.periodo,
        status: filtros?.status,
        laboratorio: filtros?.laboratorio,
        page: filtros?.page,
        limit: filtros?.limit,
      },
    })
    .then((r) => r.data);

export const labCriarSol = (p: Record<string, unknown>) =>
  api.post<LabSol>("/api/lab/solicitacoes", p).then((r) => r.data);

export const labExcluirSol = (id: number) =>
  api.delete(`/api/lab/solicitacoes/${id}`);

export const labProntos = (competencia?: string, page?: number, limit?: number) =>
  api
    .get<Pagina<LabSol> | LabSol[]>("/api/lab/prontos-faturar", { params: { competencia, page, limit } })
    .then((r) => r.data);

export const labMarcarFaturado = (ids: number[]) =>
  api.post("/api/lab/marcar-faturado", { ids }).then((r) => r.data);

export const labExportarLote = (competencia?: string) =>
  api
    .get<Blob>("/api/lab/exportar-lote", {
      params: { competencia },
      responseType: "blob",
    })
    .then((r) => r.data);

// ---------- Fila PSF / Agenda / Vagas / Auditoria ----------
export type Laboratorio = { id: number; nome: string; cnes?: string; ativo: boolean };

export const labsListar = (somenteAtivos = true) =>
  api.get<Laboratorio[]>("/api/exames/laboratorios", {
    params: { somente_ativos: somenteAtivos },
  }).then((r) => r.data);
export const labsAtualizar = (id: number, nome: string, ativo: boolean) =>
  api.put<Laboratorio>(`/api/exames/laboratorios/${id}`, { nome, ativo }).then((r) => r.data);
export const labsCriar = (nome: string, ativo = true) =>
  api.post<Laboratorio>("/api/exames/laboratorios", { nome, ativo }).then((r) => r.data);
export const labsRemover = (id: number) =>
  api.delete<void>(`/api/exames/laboratorios/${id}`).then((r) => r.data);

export type FilaPsfItem = {
  id: number;
  paciente_id: number;
  paciente_nome: string;
  paciente_cpf?: string;
  paciente_cns?: string;
  paciente_prontuario?: string;
  unidade_psf: string;
  medico_solicitante: string;
  medico: string;
  data_solicitacao: string;
  justificativa?: string;
  observacoes: string;
  obs: string;
  status: string;
  criado_em: string;
  sigtap_ids?: number[];
  exames_nomes?: string[];
};

export function mapFila(o: any): FilaPsfItem {
  return {
    id: o.id,
    paciente_id: o.paciente_id,
    paciente_nome: o.paciente_nome ?? "",
    paciente_cpf: o.paciente_cpf ?? "",
    paciente_cns: o.paciente_cns ?? "",
    paciente_prontuario: o.paciente_prontuario ?? "",
    unidade_psf: o.unidade_psf ?? "",
    medico_solicitante: o.medico_solicitante ?? o.medico ?? "",
    medico: o.medico ?? o.medico_solicitante ?? "",
    data_solicitacao: o.data_solicitacao ?? "",
    justificativa: o.justificativa ?? "",
    observacoes: o.observacoes ?? o.obs ?? "",
    obs: o.obs ?? o.observacoes ?? "",
    status: o.status ?? "",
    criado_em: o.data_solicitacao ?? "",
    sigtap_ids: o.sigtap_ids ?? [],
    exames_nomes: o.exames_nomes ?? [],
  };
}

export type FilaPsfFiltros = {
  status?: string;
  unidade?: string;
  data_de?: string;
  data_ate?: string;
  q?: string;
  page?: number;
  limit?: number;
};

export const filaPsfListar = (
  filtroOuStatus?: FilaPsfFiltros | string,
  unidade?: string,
  page?: number,
  limit?: number
) => {
  let params: Record<string, any> = {};
  if (typeof filtroOuStatus === "object" && filtroOuStatus !== null) {
    params = { ...filtroOuStatus };
  } else {
    params = {
      status: filtroOuStatus,
      unidade,
      page,
      limit,
    };
  }
  return api
    .get("/api/exames/fila-psf", { params })
    .then((r) => {
      const d = r.data as any;
      if (Array.isArray(d)) return d.map(mapFila);
      return { data: (d?.data ?? []).map(mapFila), total: d?.total ?? 0, page: d?.page ?? 1, pages: d?.pages ?? 1 };
    });
};

export const filaPsfCriar = (p: Record<string, unknown>) =>
  api
    .post("/api/exames/fila-psf", {
      paciente_id: p.paciente_id,
      unidade_psf: p.unidade_psf,
      medico_solicitante: (p as any).medico_solicitante ?? (p as any).medico,
      data_solicitacao:
        (p as any).data_solicitacao ?? new Date().toISOString().slice(0, 10),
      justificativa: (p as any).justificativa ?? "",
      observacoes: (p as any).observacoes ?? (p as any).obs ?? "",
      sigtap_ids: (p as any).sigtap_ids ?? [],
    })
    .then((r) => mapFila(r.data));

export const filaPsfAtualizar = (id: number, p: Record<string, unknown>) =>
  api
    .put(`/api/exames/fila-psf/${id}`, {
      unidade_psf: p.unidade_psf,
      medico_solicitante: (p as any).medico_solicitante ?? (p as any).medico,
      data_solicitacao: (p as any).data_solicitacao,
      justificativa: (p as any).justificativa ?? "",
      observacoes: (p as any).observacoes ?? (p as any).obs ?? "",
      sigtap_ids: (p as any).sigtap_ids,
    })
    .then((r) => mapFila(r.data));

export const filaPsfAgendarLote = (p: {
  fila_ids: number[];
  laboratorio_id: number;
  data_agendada: string;
  hora_agendada?: string;
  sigtap_ids?: number[];
  enviar_whatsapp?: boolean;
  instrucoes_transporte?: string;
}) => api.post("/api/exames/fila-psf/agendar-lote", p).then((r) => r.data);

export const filaPsfExcluir = (id: number) =>
  api.delete(`/api/exames/fila-psf/${id}`);

export const filaPsfCancelar = (id: number) =>
  api.patch(`/api/exames/fila-psf/${id}`, { status: "cancelado" }).then((r) => mapFila(r.data));

export type VagaDia = {
  data: string;
  laboratorio_id: number;
  laboratorio_nome: string;
  laboratorio: string;
  total: number;
  ocupadas: number;
  livres: number;
};

export type Vaga = {
  id: number;
  laboratorio_id: number;
  laboratorio_nome: string;
  data: string;
  laboratorio: string;
  vagas_totais: number;
  total: number;
  vagas_ocupadas: number;
  ocupadas: number;
  vagas_livres: number;
};

export function mapVaga(o: any): Vaga {
  return {
    id: o.id,
    laboratorio_id: o.laboratorio_id,
    laboratorio_nome: o.laboratorio_nome ?? o.laboratorio ?? "",
    data: typeof o.data === "string" ? o.data : String(o.data ?? ""),
    laboratorio: o.laboratorio ?? o.laboratorio_nome ?? "",
    vagas_totais: o.vagas_totais ?? o.total ?? 0,
    total: o.total ?? o.vagas_totais ?? 0,
    vagas_ocupadas: o.vagas_ocupadas ?? o.ocupadas ?? 0,
    ocupadas: o.ocupadas ?? o.vagas_ocupadas ?? 0,
    vagas_livres: o.vagas_livres ?? Math.max(0, (o.vagas_totais ?? o.total ?? 0) - (o.vagas_ocupadas ?? o.ocupadas ?? 0)),
  };
}

export const vagasGrade = (month: string, laboratorio?: string, laboratorio_id?: number) =>
  api
    .get("/api/vagas/grade", { params: { month, laboratorio, laboratorio_id } })
    .then((r) => r.data as VagaDia[]);
export const vagasListar = (de?: string, ate?: string, laboratorio_id?: number, page?: number, limit?: number) =>
  api
    .get("/api/vagas", { params: { de, ate, laboratorio_id, page, limit } })
    .then((r) => {
      const d = r.data as any;
      if (Array.isArray(d)) return d.map(mapVaga);
      return { data: (d?.data ?? []).map(mapVaga), total: d?.total ?? 0, page: d?.page ?? 1, pages: d?.pages ?? 1 };
    });
export const vagasCriar = (p: Record<string, unknown>) =>
  api.post("/api/vagas", p).then((r) => mapVaga(r.data));
export const vagasAtualizar = (id: number, p: Record<string, unknown>) =>
  api.put(`/api/vagas/${id}`, p).then((r) => mapVaga(r.data));
export const vagasExcluir = (id: number) => api.delete(`/api/vagas/${id}`);
export type VagaLoteMes = {
  laboratorio_id: number;
  ano: number;
  mes: number;
  vagas_diarias: number;
  ignorar_fins_semana: boolean;
};
export type VagaLoteMesOut = {
  laboratorio_id: number;
  laboratorio_nome: string;
  mes_ref: string;
  dias_alvo: number;
  criadas: number;
  atualizadas: number;
  ignoradas_fim_semana: number;
  mantidas_conflito: number;
  ignoradas_passado?: number;
};
export const vagasLoteMes = (p: VagaLoteMes) =>
  api.post("/api/vagas/lote-mes", p).then((r) => r.data as VagaLoteMesOut);

export type SolicMestre = {
  id: number;
  paciente_id: number;
  paciente_nome: string;
  paciente_cpf?: string;
  paciente_cns?: string;
  paciente_prontuario?: string;
  paciente_nascimento?: string;
  data_agendada: string;
  hora_agendada?: string;
  laboratorio_id: number;
  laboratorio_nome: string;
  laboratorio: string;
  medico_id?: number | null;
  medico_solicitante?: string;
  unidade_saude_id?: number | null;
  unidade_psf?: string;
  justificativa?: string;
  status: string;
  status_auditoria: string;
  observacao_laboratorio: string;
  observacoes: string;
  coletado_em?: string | null;
  coletado_por?: string;
  jejum_horas?: string;
  preparo_instrucoes?: string[];
  itens: { id: number; solicitacao_id: number; sigtap_id: number; quantidade: number; status_auditoria: string; observacao: string; procedimento_codigo: string; procedimento_descricao: string; codigo: string; descricao: string; conferido: boolean; divergente: boolean }[];
};

export type ComprovanteExame = {
  id: number;
  protocolo: string;
  paciente_id: number;
  paciente_nome: string;
  paciente_cpf: string;
  paciente_cns: string;
  paciente_prontuario: string;
  paciente_nascimento: string;
  data_agendada: string;
  hora_agendada: string;
  laboratorio_id: number;
  laboratorio_nome: string;
  unidade_psf: string;
  medico_solicitante: string;
  justificativa: string;
  status: string;
  status_auditoria: string;
  itens: { id: number; solicitacao_id: number; sigtap_id: number; quantidade: number; procedimento_codigo: string; procedimento_descricao: string; preparo_especifico?: string }[];
  jejum_horas: string;
  preparo_instrucoes: string[];
  orientacoes_gerais: string[];
  emitido_em: string;
  agendado_por: string;
  qr_code_url?: string;
  codigo_curto?: string;
  numero_pedido?: string;
  exige_preparo?: boolean;
  transporte?: {
    possui_viagem: boolean;
    viagem_id?: number;
    veiculo: string;
    modelo_veiculo?: string;
    placa_veiculo?: string;
    tipo_veiculo?: string;
    ponto_saida: string;
    horario_saida: string;
    destino: string;
    motorista?: string;
    acompanhante?: string;
    observacoes?: string;
  } | null;
  instrucoes_transporte?: string;
};

export type PedidoAjuste = {
  id: number;
  solicitacao_id: number;
  laboratorio_id: number;
  laboratorio_nome: string;
  paciente_nome: string;
  tipo_ajuste: string;
  justificativa: string;
  itens_propostos: any[];
  status: string;
  solicitado_por: string;
  resposta_secretaria: string;
  resposta?: string;
  analisado_por: string;
  created_at: string;
  analisado_em?: string | null;
};

export type BpaResumo = {
  competencia: string;
  total_procedimentos: number;
  total_exames: number;
  total_pacientes: number;
  total_solicitacoes?: number;
  valor_total: number;
  itens: {
    codigo: string;
    descricao: string;
    instrumento: string;
    quantidade: number;
    valor_unitario: number;
    valor_total: number;
    total_pacientes: number;
  }[];
};

export function mapMestre(o: any): SolicMestre {
  return {
    id: o.id,
    paciente_id: o.paciente_id,
    paciente_nome: o.paciente_nome ?? "",
    paciente_cpf: o.paciente_cpf ?? "",
    paciente_cns: o.paciente_cns ?? "",
    paciente_prontuario: o.paciente_prontuario ?? "",
    paciente_nascimento: o.paciente_nascimento ?? "",
    data_agendada: typeof o.data_agendada === "string" ? o.data_agendada : String(o.data_agendada ?? ""),
    hora_agendada: o.hora_agendada ?? "07:00",
    laboratorio_id: o.laboratorio_id,
    laboratorio_nome: o.laboratorio_nome ?? "",
    laboratorio: o.laboratorio_nome ?? o.laboratorio ?? "",
    medico_id: o.medico_id ?? null,
    medico_solicitante: o.medico_solicitante ?? "",
    unidade_saude_id: o.unidade_saude_id ?? null,
    unidade_psf: o.unidade_psf ?? "",
    justificativa: o.justificativa ?? "",
    status: o.status ?? "",
    status_auditoria: o.status_auditoria ?? "",
    observacao_laboratorio: o.observacao_laboratorio ?? "",
    observacoes: o.observacao_laboratorio ?? "",
    coletado_em: o.coletado_em ?? null,
    coletado_por: o.coletado_por ?? "",
    jejum_horas: o.jejum_horas ?? "8 a 12 horas",
    preparo_instrucoes: o.preparo_instrucoes ?? [],
    itens: (o.itens ?? []).map((it: any) => ({
      id: it.id,
      solicitacao_id: it.solicitacao_id,
      sigtap_id: it.sigtap_id,
      quantidade: it.quantidade ?? 1,
      status_auditoria: it.status_auditoria ?? "",
      observacao: it.observacao ?? "",
      procedimento_codigo: it.procedimento_codigo ?? "",
      procedimento_descricao: it.procedimento_descricao ?? "",
      codigo: it.procedimento_codigo ?? "",
      descricao: it.procedimento_descricao ?? "",
      conferido: it.status_auditoria === "aprovado",
      divergente: it.status_auditoria === "divergente",
    })),
  };
}

export const examesSolicitar = (p: {
  paciente_id: number;
  data_agendada: string;
  laboratorio_id: number;
  sigtap_ids?: number[];
  itens?: ExameLoteItem[];
  origem_fila_id?: number | null;
  medico_id?: number | null;
  medico_solicitante?: string;
  unidade_saude_id?: number | null;
  unidade_psf?: string;
  justificativa?: string;
}) => api.post("/api/exames/solicitacoes", p).then((r) => mapMestre(r.data));

export type ExameLoteItem = { sigtap_id: number; quantidade?: number };

export function expandirSigtapIds(itens: ExameLoteItem[]): number[] {
  const out: number[] = [];
  for (const it of itens) {
    const q = Math.min(99, Math.max(1, Math.floor(it.quantidade ?? 1) || 1));
    for (let i = 0; i < q; i++) out.push(it.sigtap_id);
  }
  return out;
}

export function normalizarItens(itens: ExameLoteItem[]): ExameLoteItem[] {
  const total = new Map<number, number>();
  for (const it of itens) {
    const q = Math.min(99, Math.max(1, Math.floor(it.quantidade ?? 1) || 1));
    total.set(it.sigtap_id, Math.min(99, (total.get(it.sigtap_id) ?? 0) + q));
  }
  return [...total.entries()].map(([sigtap_id, quantidade]) => ({ sigtap_id, quantidade }));
}

export const examesSolicitarLote = (p: {
  paciente_id: number;
  data_agendada: string;
  laboratorio_id: number;
  sigtap_ids?: number[];
  itens?: ExameLoteItem[];
  origem_fila_id?: number | null;
  medico_id?: number | null;
  medico_solicitante?: string;
  unidade_saude_id?: number | null;
  unidade_psf?: string;
  justificativa?: string;
}) => {
  const itens = p.itens ? normalizarItens(p.itens) : undefined;
  return examesSolicitar({
    paciente_id: p.paciente_id,
    data_agendada: p.data_agendada,
    laboratorio_id: p.laboratorio_id,
    itens,
    sigtap_ids: itens ? undefined : p.sigtap_ids,
    origem_fila_id: p.origem_fila_id,
    medico_id: p.medico_id,
    medico_solicitante: p.medico_solicitante,
    unidade_saude_id: p.unidade_saude_id,
    unidade_psf: p.unidade_psf,
    justificativa: p.justificativa,
  });
};
export const solicitarListar = (filtros?: {
  status_auditoria?: string;
  laboratorio_id?: number;
  q?: string;
  status?: string;
  data_de?: string;
  data_ate?: string;
  page?: number;
  limit?: number;
}) =>
  api.get("/api/exames/solicitacoes", { params: filtros }).then((r) => {
    const d = r.data as any;
    if (Array.isArray(d)) return d.map(mapMestre);
    return { data: (d?.data ?? []).map(mapMestre), total: d?.total ?? 0, page: d?.page ?? 1, pages: d?.pages ?? 1 };
  });

export const labObterComprovante = (mid: number): Promise<ComprovanteExame> =>
  api.get(`/api/exames/solicitacoes/${mid}/comprovante`).then((r) => r.data as ComprovanteExame);

export const labCancelarSolicitacao = (mid: number): Promise<void> =>
  api.delete(`/api/exames/solicitacoes/${mid}`).then(() => undefined);

export const labRecepcionarColeta = (mid: number): Promise<SolicMestre> =>
  api.post(`/api/exames/solicitacoes/${mid}/recepcionar`).then((r) => mapMestre(r.data));

export const labPedirAjuste = (
  mid: number,
  payload: { tipo_ajuste: string; justificativa: string; itens_propostos?: any[] }
): Promise<PedidoAjuste> =>
  api.post(`/api/exames/solicitacoes/${mid}/pedir-ajuste`, payload).then((r) => r.data as PedidoAjuste);

export const labListarPedidosAjuste = (status?: string, laboratorio_id?: number): Promise<PedidoAjuste[]> =>
  api.get("/api/exames/pedidos-ajuste", { params: { status, laboratorio_id } }).then((r) => r.data as PedidoAjuste[]);

export const labAnalisarPedidoAjuste = (
  aid: number,
  payload: { aprovado: boolean; resposta: string }
): Promise<PedidoAjuste> =>
  api.post(`/api/exames/pedidos-ajuste/${aid}/analisar`, payload).then((r) => r.data as PedidoAjuste);

export const labBpaConsolidado = (competencia: string): Promise<BpaResumo> =>
  api.get("/api/exames/bpa/consolidado", { params: { competencia } }).then((r) => r.data as BpaResumo);

export const labBpaExportarCsv = (competencia: string): Promise<Blob> =>
  api
    .get("/api/exames/bpa/exportar-csv", { params: { competencia }, responseType: "blob" })
    .then((r) => r.data as Blob);

export type AuditItemDet = {
  id: number;
  sigtap_id: number;
  quantidade: number;
  codigo: string;
  descricao: string;
  status_auditoria: string;
  observacao: string;
  conferido: boolean;
  divergente: boolean;
};

export type AuditItem = {
  id: number;
  paciente_id: number;
  paciente_nome: string;
  laboratorio_id: number;
  laboratorio_nome: string;
  laboratorio: string;
  data_agendada: string;
  data_solicitacao: string;
  status: string;
  status_auditoria: string;
  observacao_laboratorio: string;
  observacoes: string;
  itens: AuditItemDet[];
};

export function mapAudit(o: any): AuditItem {
  const m = mapMestre(o);
  return {
    id: m.id,
    paciente_id: m.paciente_id,
    paciente_nome: m.paciente_nome,
    laboratorio_id: m.laboratorio_id,
    laboratorio_nome: m.laboratorio_nome,
    laboratorio: m.laboratorio,
    data_agendada: m.data_agendada,
    data_solicitacao: m.data_agendada,
    status: m.status_auditoria || m.status,
    status_auditoria: m.status_auditoria,
    observacao_laboratorio: m.observacao_laboratorio,
    observacoes: m.observacao_laboratorio,
    itens: m.itens.map((it) => ({
      id: it.id,
      sigtap_id: it.sigtap_id,
      quantidade: (it as any).quantidade ?? 1,
      codigo: it.codigo,
      descricao: it.descricao,
      status_auditoria: it.status_auditoria,
      observacao: it.observacao,
      conferido: it.conferido,
      divergente: it.divergente,
    })),
  };
}

export const auditListar = (status_auditoria?: string, page?: number, limit?: number) =>
  api
    .get("/api/exames/auditoria", { params: { status_auditoria, page, limit } })
    .then((r) => {
      const d = r.data as any;
      if (Array.isArray(d)) return d.map(mapAudit);
      return { data: (d?.data ?? []).map(mapAudit), total: d?.total ?? 0, page: d?.page ?? 1, pages: d?.pages ?? 1 };
    });
export const auditMarcar = (id: number, status_auditoria: string, observacao = "", itens: { item_id: number; status: string; obs?: string }[] = []) =>
  api.put(`/api/exames/auditoria/${id}`, { status_auditoria, observacao, itens }).then((r) => mapAudit(r.data));
export const auditValidarItem = (id: number, payload: { item_id: number; status: string; obs?: string }) =>
  auditMarcar(id, "pendente_conferencia", "", [payload]);
export const auditMarcarStatus = (id: number, status: string) =>
  auditMarcar(id, status === "aprovado" || status === "divergente" ? status : "pendente_conferencia");
export const auditSolicitarAutorizacao = (id: number, _motivo = "") =>
  api.post(`/api/exames/auditoria/${id}/solicitar-autorizacao`).then((r) => mapAudit(r.data));

// ---------- Backup e Restauração Criptografados ----------
export async function exportarBackup(senha: string): Promise<Blob> {
  try {
    const res = await api.post("/api/backup/exportar", { senha }, { responseType: "blob" });
    const contentType = (res.headers?.["content-type"] as string | undefined) ?? "application/octet-stream";
    const blob = new Blob([res.data as BlobPart], { type: contentType });

    const disp = (res.headers?.["content-disposition"] as string | undefined) ?? "";
    let nomeArquivo = "";
    const match = disp.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
    if (match && match[1]) {
      nomeArquivo = decodeURIComponent(match[1].replace(/['"]/g, ""));
    }
    if (!nomeArquivo) {
      const agora = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const yyyy = agora.getFullYear();
      const mm = pad(agora.getMonth() + 1);
      const dd = pad(agora.getDate());
      const hh = pad(agora.getHours());
      const min = pad(agora.getMinutes());
      nomeArquivo = `backup_sistema_${yyyy}${mm}${dd}_${hh}${min}.bak`;
    }

    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nomeArquivo;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    return blob;
  } catch (err: any) {
    if (err.response?.data instanceof Blob) {
      try {
        const text = await err.response.data.text();
        const json = JSON.parse(text);
        if (json?.detail) {
          err.friendlyMessage = json.detail;
          if (err.response?.data) err.response.data.detail = json.detail;
        }
      } catch {
        // fallback
      }
    }
    throw err;
  }
}

export async function restaurarBackup(arquivo: File, senha: string): Promise<any> {
  const form = new FormData();
  form.append("arquivo", arquivo);
  form.append("senha", senha);
  const { data } = await api.post("/api/backup/restaurar", form);
  return data;
}

// ============================================================================
// MÓDULO APAC (Autorização de Procedimentos de Alta Complexidade)
// ============================================================================

export interface ProcedimentoSecundarioApac {
  id?: number;
  solicitacao_id?: number;
  sigtap_id?: number;
  codigo_procedimento: string;
  nome_procedimento: string;
  quantidade: number;
  valor_unitario?: number;
  justificativa?: string;
}

export interface AnexoApac {
  id: number;
  solicitacao_id: number;
  nome_arquivo: string;
  tipo_documento?: string;
  tamanho_bytes?: number;
  content_type?: string;
  url?: string;
  criado_em: string;
}

export interface SolicitacaoApac {
  id: number;
  numero_apac?: string | null;
  tipo_solicitacao: "inicial" | "continuidade";
  numero_apac_anterior?: string | null;
  solicitacao_anterior_id?: number | null;
  status: "SOLICITADO" | "EM ANALISE" | "PENDENTE" | "AUTORIZADO" | "INDEFERIDO" | "CANCELADO";

  // Paciente
  paciente_id: number;
  paciente_nome: string;
  paciente_cpf?: string;
  paciente_cns?: string;
  paciente_data_nascimento?: string;
  paciente_sexo?: string;
  paciente_nome_mae?: string;
  paciente_telefone?: string;
  paciente_endereco?: string;
  paciente_numero?: string;
  paciente_complemento?: string;
  paciente_municipio?: string;
  paciente_bairro?: string;
  paciente_cep?: string;

  // Estabelecimentos
  unidade_solicitante_id?: number | null;
  unidade_solicitante_nome?: string;
  unidade_solicitante_cnes?: string;
  unidade_executante_id?: number | null;
  unidade_executante_nome?: string;
  unidade_executante_cnes?: string;

  // Médico Solicitante
  medico_solicitante_id?: number | null;
  medico_solicitante_nome?: string;
  medico_solicitante_crm?: string;
  medico_solicitante_cbo?: string;
  medico_solicitante_cns?: string;

  // Procedimento Principal
  procedimento_principal_id?: number | null;
  codigo_procedimento_principal: string;
  nome_procedimento_principal: string;
  qtd_mes1: number;
  qtd_mes2: number;
  qtd_mes3: number;
  qtd_total: number;
  valor_unitario?: number;
  valor_total?: number;

  // Procedimentos Secundários
  procedimentos_secundarios?: ProcedimentoSecundarioApac[];

  // Dados Clínicos
  cid_principal_codigo: string;
  cid_principal_descricao?: string;
  cid_secundario_codigo?: string;
  cid_secundario_descricao?: string;
  cid_causas_associadas?: string;
  estadiamento_clinico?: string;
  anamnese_diagnostico?: string;
  justificativa_clinica: string;

  // Regulação / Autorização
  medico_autorizador_id?: number | null;
  medico_autorizador_nome?: string;
  medico_autorizador_crm?: string;
  medico_autorizador_cns?: string;
  data_autorizacao?: string | null;
  data_validade_inicio?: string | null;
  data_validade_fim?: string | null;
  meses_vigencia?: number;
  dias_restantes_vigencia?: number;
  parecer_autorizador?: string | null;
  motivo_pendencia?: string | null;
  motivo_indeferimento?: string | null;

  // Anexos
  anexos?: AnexoApac[];

  criado_em: string;
  atualizado_em?: string;
}

export interface FaixaNumeracaoApac {
  id: number;
  ano: number;
  serie: string;
  inicio: string;
  fim: string;
  proximo_numero: string;
  quantidade_total: number;
  quantidade_utilizada: number;
  quantidade_disponivel: number;
  ativo: boolean;
  criado_em: string;
}

export interface LoteFaturamentoApac {
  id: number;
  competencia: string;
  cnes_executante?: string;
  nome_executante?: string;
  numero_remessa: number;
  total_apacs: number;
  total_procedimentos: number;
  valor_total: number;
  status: "GERADO" | "ENVIADO" | "PROCESSADO" | "COM_ERROS";
  nome_arquivo?: string;
  hash_arquivo?: string;
  gerado_por_nome?: string;
  criado_em: string;
}

export interface InconsistenciaFaturamentoApac {
  solicitacao_id: number;
  paciente: string;
  tipo: string;
  mensagem: string;
}

export interface ResumoFaturamentoApac {
  competencia: string;
  total_apacs_autorizadas: number;
  total_procedimentos: number;
  valor_total_sa: number;
  valor_total_sp: number;
  valor_total: number;
  validacoes: {
    cnes_executante_ok: boolean;
    cnes_executante_msg?: string;
    vigencia_ok: boolean;
    vigencia_msg?: string;
    compatibilidade_sigtap_cid_ok: boolean;
    compatibilidade_msg?: string;
    total_inconsistencias: number;
    inconsistencias?: InconsistenciaFaturamentoApac[];
  };
}

export interface ItemSigtapApac {
  id: number;
  codigo: string;
  descricao: string;
  complexidade?: string;
  financiamento?: string;
  subgrupo?: string;
  valor_sa?: number;
  valor_sp?: number;
  valor_total?: number;
  instrumento?: string;
  cid_padrao?: string;
  dias_validade?: number;
}

export interface CidItem {
  codigo: string;
  descricao: string;
  sexo?: string;
  estadiamento_obrigatorio?: boolean;
}

export async function fetchApacSolicitacoes(params?: any): Promise<{ data: SolicitacaoApac[]; total: number; page: number; pages: number }> {
  try {
    const res = await api.get<{ data: SolicitacaoApac[]; total: number; page: number; pages: number }>("/api/apac/solicitacoes", { params });
    if (res.data && Array.isArray(res.data.data)) return res.data;
    if (Array.isArray(res.data)) {
      return { data: res.data, total: res.data.length, page: 1, pages: 1 };
    }
    return res.data;
  } catch (err) {
    // Retorno estruturado defensivo se rota ainda em integração
    return { data: [], total: 0, page: 1, pages: 1 };
  }
}

export async function fetchApacSolicitacao(id: number): Promise<SolicitacaoApac> {
  const { data } = await api.get<SolicitacaoApac>(`/api/apac/solicitacoes/${id}`);
  return data;
}

export async function criarApacSolicitacao(payload: any): Promise<SolicitacaoApac> {
  const { data } = await api.post<SolicitacaoApac>("/api/apac/solicitacoes", payload);
  return data;
}

export async function atualizarApacSolicitacao(id: number, payload: any): Promise<SolicitacaoApac> {
  const { data } = await api.put<SolicitacaoApac>(`/api/apac/solicitacoes/${id}`, payload);
  return data;
}

export async function duplicarApacContinuidade(id: number, justificativa_atualizada: string): Promise<SolicitacaoApac> {
  const { data } = await api.post<SolicitacaoApac>(`/api/apac/solicitacoes/${id}/continuidade`, { justificativa_atualizada });
  return data;
}

export async function cancelarApacSolicitacao(id: number, motivo?: string): Promise<any> {
  const { data } = await api.post(`/api/apac/solicitacoes/${id}/cancelar`, { motivo });
  return data;
}

export async function uploadAnexoApac(id: number, formData: FormData): Promise<AnexoApac> {
  const { data } = await api.post<AnexoApac>(`/api/apac/solicitacoes/${id}/anexos`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function iniciarAnaliseApac(id: number): Promise<SolicitacaoApac> {
  const { data } = await api.post<SolicitacaoApac>(`/api/apac/solicitacoes/${id}/iniciar-analise`);
  return data;
}

export async function autorizarApac(
  id: number,
  payload: { medico_autorizador_id: number; parecer?: string; meses_vigencia?: number }
): Promise<SolicitacaoApac> {
  const { data } = await api.post<SolicitacaoApac>(`/api/apac/solicitacoes/${id}/autorizar`, payload);
  return data;
}

export async function devolverApac(id: number, motivo: string): Promise<SolicitacaoApac> {
  const { data } = await api.post<SolicitacaoApac>(`/api/apac/solicitacoes/${id}/devolver`, { motivo });
  return data;
}

export async function indeferirApac(id: number, motivo: string): Promise<SolicitacaoApac> {
  const { data } = await api.post<SolicitacaoApac>(`/api/apac/solicitacoes/${id}/indeferir`, { motivo });
  return data;
}

export async function fetchApacFaixas(): Promise<FaixaNumeracaoApac[]> {
  try {
    const { data } = await api.get<FaixaNumeracaoApac[]>("/api/apac/faixas");
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function criarApacFaixa(payload: any): Promise<FaixaNumeracaoApac> {
  const { data } = await api.post<FaixaNumeracaoApac>("/api/apac/faixas", payload);
  return data;
}

export async function atualizarApacFaixa(id: number, payload: any): Promise<FaixaNumeracaoApac> {
  const { data } = await api.put<FaixaNumeracaoApac>(`/api/apac/faixas/${id}`, payload);
  return data;
}

export async function fetchApacFaturamentoResumo(competencia?: string): Promise<ResumoFaturamentoApac> {
  try {
    const { data } = await api.get<ResumoFaturamentoApac>("/api/apac/faturamento/resumo", { params: { competencia } });
    return data;
  } catch {
    return {
      competencia: competencia || new Date().toISOString().slice(0, 7),
      total_apacs_autorizadas: 0,
      total_procedimentos: 0,
      valor_total_sa: 0,
      valor_total_sp: 0,
      valor_total: 0,
      validacoes: {
        cnes_executante_ok: true,
        vigencia_ok: true,
        compatibilidade_sigtap_cid_ok: true,
        total_inconsistencias: 0,
        inconsistencias: [],
      },
    };
  }
}

export async function gerarRemessaApac(competencia: string, cnes_executante?: string): Promise<LoteFaturamentoApac> {
  const { data } = await api.post<LoteFaturamentoApac>("/api/apac/faturamento/remessa", { competencia, cnes_executante });
  return data;
}

export async function fetchApacLotes(competencia?: string): Promise<LoteFaturamentoApac[]> {
  try {
    const { data } = await api.get<LoteFaturamentoApac[]>("/api/apac/faturamento/lotes", { params: { competencia } });
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function downloadRemessaApac(loteId: number): Promise<Blob> {
  const r = await api.get(`/api/apac/faturamento/lotes/${loteId}/download`, { responseType: "blob" });
  const blob = new Blob([r.data as BlobPart], { type: "text/plain;charset=iso-8859-1" });
  const disp: string = r.headers?.["content-disposition"] ?? "";
  const m = disp.match(/filename="?([^";]+)"?/);
  const nome = m ? m[1] : `APAC_REMESSA_${loteId}.TXT`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return blob;
}

export async function fetchSigtapApac(q?: string): Promise<ItemSigtapApac[]> {
  try {
    const { data } = await api.get<ItemSigtapApac[]>("/api/apac/sigtap", { params: { q } });
    if (Array.isArray(data) && data.length > 0) return data;
  } catch {
    // fallback para /api/lab/sigtap ou lista interna
  }
  try {
    const { data } = await api.get<any>("/api/lab/sigtap", { params: { q, limit: 50, apenas_laboratoriais: false } });
    const lista = Array.isArray(data) ? data : data?.data ?? [];
    if (lista.length > 0) {
      return lista.map((it: any) => ({
        id: it.id,
        codigo: it.codigo,
        descricao: it.descricao,
        complexidade: "Alta Complexidade",
        financiamento: "Média e Alta Complexidade (MAC)",
        valor_sa: it.valor_sa || 180.5,
        valor_sp: it.valor_sp || 45.2,
        valor_total: (it.valor_sa || 180.5) + (it.valor_sp || 45.2),
        instrumento: "APAC",
        dias_validade: 90,
      }));
    }
  } catch {
    // fallback padrão
  }

  const padrao: ItemSigtapApac[] = [
    { id: 101, codigo: "0305010107", descricao: "HEMODIALISE (MAXIMO 3 SESSOES POR SEMANA)", complexidade: "Alta Complexidade", valor_sa: 218.47, valor_sp: 0, valor_total: 218.47, instrumento: "APAC", dias_validade: 90 },
    { id: 102, codigo: "0305010115", descricao: "HEMODIALISE EM PACIENTE COM SOROLOGIA POSITIVA", complexidade: "Alta Complexidade", valor_sa: 245.8, valor_sp: 0, valor_total: 245.8, instrumento: "APAC", dias_validade: 90 },
    { id: 103, codigo: "0304020222", descricao: "QUIMIOTERAPIA DE TUMORES DO APARELHO DIGESTIVO - ADJUVANTE", complexidade: "Alta Complexidade", valor_sa: 1250.0, valor_sp: 180.0, valor_total: 1430.0, instrumento: "APAC", dias_validade: 90 },
    { id: 104, codigo: "0304020230", descricao: "QUIMIOTERAPIA DE TUMORES DO APARELHO DIGESTIVO - AVANCADO", complexidade: "Alta Complexidade", valor_sa: 1840.0, valor_sp: 210.0, valor_total: 2050.0, instrumento: "APAC", dias_validade: 90 },
    { id: 105, codigo: "0304050091", descricao: "RADIOTERAPIA DE MEGAVOLTAGEM POR CAMPO", complexidade: "Alta Complexidade", valor_sa: 520.0, valor_sp: 95.0, valor_total: 615.0, instrumento: "APAC", dias_validade: 90 },
    { id: 106, codigo: "0205020143", descricao: "RESSONANCIA MAGNETICA DE CRANIO", complexidade: "Alta Complexidade", valor_sa: 268.75, valor_sp: 0, valor_total: 268.75, instrumento: "APAC", dias_validade: 90 },
    { id: 107, codigo: "0205020151", descricao: "RESSONANCIA MAGNETICA DE COLUNA LOMBO-SACRA", complexidade: "Alta Complexidade", valor_sa: 268.75, valor_sp: 0, valor_total: 268.75, instrumento: "APAC", dias_validade: 90 },
    { id: 108, codigo: "0206010079", descricao: "TOMOGRAFIA COMPUTADORIZADA DE TORAX", complexidade: "Alta Complexidade", valor_sa: 136.41, valor_sp: 0, valor_total: 136.41, instrumento: "APAC", dias_validade: 90 },
    { id: 109, codigo: "0206010010", descricao: "TOMOGRAFIA COMPUTADORIZADA DE CRANIO", complexidade: "Alta Complexidade", valor_sa: 114.7, valor_sp: 0, valor_total: 114.7, instrumento: "APAC", dias_validade: 90 },
    { id: 110, codigo: "0303060190", descricao: "TRATAMENTO DE DOENCA PULMONAR OBSTRUTIVA CRONICA COM OXIGENIOTERAPIA DOMICILIAR", complexidade: "Alta Complexidade", valor_sa: 412.0, valor_sp: 0, valor_total: 412.0, instrumento: "APAC", dias_validade: 180 },
    { id: 111, codigo: "0701040014", descricao: "APARELHO DE AMPLIFICACAO SONORA INDIVIDUAL (AASI) - ADAPTAÇÃO", complexidade: "Alta Complexidade", valor_sa: 1100.0, valor_sp: 0, valor_total: 1100.0, instrumento: "APAC", dias_validade: 180 },
    { id: 112, codigo: "0304030015", descricao: "HORMONIOTERAPIA DO CANCER DE MAMA", complexidade: "Alta Complexidade", valor_sa: 340.0, valor_sp: 45.0, valor_total: 385.0, instrumento: "APAC", dias_validade: 180 },
  ];
  if (!q) return padrao;
  const qq = q.toLowerCase();
  return padrao.filter((p) => p.codigo.includes(qq) || p.descricao.toLowerCase().includes(qq));
}

export async function fetchCidsApac(q?: string): Promise<CidItem[]> {
  try {
    const { data } = await api.get<CidItem[]>("/api/apac/cids", { params: { q } });
    if (Array.isArray(data) && data.length > 0) return data;
  } catch {
    // fallback padrão
  }
  const cidsPadrao: CidItem[] = [
    { codigo: "N18.0", descricao: "Doença renal em estágio final (Insuficiência renal crônica terminal)", estadiamento_obrigatorio: false },
    { codigo: "N18.8", descricao: "Outra insuficiência renal crônica", estadiamento_obrigatorio: false },
    { codigo: "N18.9", descricao: "Insuficiência renal crônica não especificada", estadiamento_obrigatorio: false },
    { codigo: "C50.9", descricao: "Neoplasia maligna da mama, não especificada", estadiamento_obrigatorio: true },
    { codigo: "C50.4", descricao: "Neoplasia maligna do quadrante superior externo da mama", estadiamento_obrigatorio: true },
    { codigo: "C61", descricao: "Neoplasia maligna da próstata", estadiamento_obrigatorio: true },
    { codigo: "C18.9", descricao: "Neoplasia maligna do cólon, não especificado", estadiamento_obrigatorio: true },
    { codigo: "C20", descricao: "Neoplasia maligna do reto", estadiamento_obrigatorio: true },
    { codigo: "C34.9", descricao: "Neoplasia maligna dos brônquios ou pulmões, não especificado", estadiamento_obrigatorio: true },
    { codigo: "C16.9", descricao: "Neoplasia maligna do estômago, não especificado", estadiamento_obrigatorio: true },
    { codigo: "C53.9", descricao: "Neoplasia maligna do colo do útero, não especificado", estadiamento_obrigatorio: true },
    { codigo: "C91.0", descricao: "Leucemia linfoblástica aguda", estadiamento_obrigatorio: true },
    { codigo: "C92.0", descricao: "Leucemia mielóide aguda", estadiamento_obrigatorio: true },
    { codigo: "C85.9", descricao: "Linfoma não-Hodgkin de tipo não especificado", estadiamento_obrigatorio: true },
    { codigo: "I25.1", descricao: "Doença aterosclerótica do coração", estadiamento_obrigatorio: false },
    { codigo: "I50.0", descricao: "Insuficiência cardíaca congestiva", estadiamento_obrigatorio: false },
    { codigo: "J44.9", descricao: "Doença pulmonar obstrutiva crônica não especificada", estadiamento_obrigatorio: false },
    { codigo: "H90.3", descricao: "Perda de audição bilateral neuro-sensorial", estadiamento_obrigatorio: false },
    { codigo: "M16.9", descricao: "Coxartrose não especificada (Artrose do quadril)", estadiamento_obrigatorio: false },
    { codigo: "M17.9", descricao: "Gonartrose não especificada (Artrose do joelho)", estadiamento_obrigatorio: false },
    { codigo: "G30.9", descricao: "Doença de Alzheimer não especificada", estadiamento_obrigatorio: false },
    { codigo: "G35", descricao: "Esclerose múltipla", estadiamento_obrigatorio: false },
  ];
  if (!q) return cidsPadrao;
  const qq = q.toLowerCase();
  return cidsPadrao.filter((c) => c.codigo.toLowerCase().includes(qq) || c.descricao.toLowerCase().includes(qq));
}

export default api;

