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
  ativo: boolean;
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
  pec_usuario: string;
  pec_senha_configurada: boolean;
  pec_database_configurada: boolean;
  pec_database_resumo: string;
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
  api.post<{ ok: boolean; fonte_efetiva: string; detalhe: string; latencia_ms?: number }>("/api/integracoes/pec/testar").then((r) => r.data);
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
  id: number; user_id: number | null; user_name: string; action: string;
  entity: string; entity_id: number | null; details: string; timestamp: string;
};
export const fetchAuditLogs = (params: { data_de?: string; data_ate?: string; usuario?: string; acao?: string; entidade?: string; page?: number; limit?: number }) =>
  api.get<Pagina<AuditLog> | AuditLog[]>("/api/auditoria/logs", { params }).then((r) => r.data);
export const fetchAuditFiltros = () =>
  api.get<{ acoes: string[]; entidades: string[]; usuarios: string[] }>("/api/auditoria/filtros").then((r) => r.data);
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
  nome: string;
  cpf: string;
  cns: string;
  nascimento: string | null;
  telefone: string;
  endereco: string;
  endereco_numero: string;
  complemento?: string;
  bairro: string;
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
  viagem_fila_id?: number | null;
  tratamento?: string;
  unidade?: string;
  hora_consulta?: string;
  observacoes?: string;
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
  codigo_curto?: string;
  numero_pedido?: string;
  public_token?: string;
  posicao?: number | null;
  total_fila?: number | null;
  grupo_fila?: string;
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
  data_de?: string;
  data_ate?: string;
  agendada_em?: string;
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
export const tfdFiltrosOpcoes = (status?: string) =>
  api.get<FiltrosOpcoes>("/api/tfd/exames/filtros-opcoes", { params: { status } }).then((r) => r.data);

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

export const tfdExames = (statusOrParams?: string | FilaExamesParams) => {
  const params =
    typeof statusOrParams === "string" ? { status: statusOrParams || undefined } : statusOrParams;
  return api.get<Pagina<Exame> | Exame[]>("/api/tfd/exames", { params }).then((r) => r.data);
};
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

export const tfdCatalogoExames = (q?: string, tipo_fila?: string) =>
  api.get<CatalogoProc[]>("/api/tfd/exames/catalogo", { params: { q, tipo_fila } }).then((r) => r.data);
export const tfdRegenerarTokenExame = (id: number) =>
  api.post<Exame>(`/api/tfd/exames/${id}/regenerar-token`).then((r) => r.data);
export const tfdRecepcionarExame = (id: number) =>
  api.post<Exame>(`/api/tfd/exames/${id}/recepcionar`).then((r) => r.data);
export const tfdEstornarRecepcaoExame = (id: number) =>
  api.post<Exame>(`/api/tfd/exames/${id}/estornar-recepcao`).then((r) => r.data);
export const tfdAtendimentoStatus = (id: number, status: "faltou" | "realizado" | "cancelado", resultado?: string) =>
  api.post<Exame>(`/api/tfd/exames/${id}/atendimento-status`, { status, resultado: resultado ?? "" }).then((r) => r.data);
export const tfdConsultarExamePublico = (token: string) =>
  api.get<ExamePublico>(`/api/tfd/public/exames/${token}`).then((r) => r.data);

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

export const labSigtap = (q?: string, instrumento?: string, page?: number, limit?: number) =>
  api
    .get<Pagina<SigtapProc> | SigtapProc[]>("/api/lab/sigtap", { params: { q, instrumento, page, limit } })
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
export type Laboratorio = { id: number; nome: string; ativo: boolean };

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
  unidade_psf: string;
  medico_solicitante: string;
  medico: string;
  data_solicitacao: string;
  observacoes: string;
  obs: string;
  status: string;
  criado_em: string;
};

export function mapFila(o: any): FilaPsfItem {
  return {
    id: o.id,
    paciente_id: o.paciente_id,
    paciente_nome: o.paciente_nome ?? "",
    unidade_psf: o.unidade_psf ?? "",
    medico_solicitante: o.medico_solicitante ?? o.medico ?? "",
    medico: o.medico ?? o.medico_solicitante ?? "",
    data_solicitacao: o.data_solicitacao ?? "",
    observacoes: o.observacoes ?? o.obs ?? "",
    obs: o.obs ?? o.observacoes ?? "",
    status: o.status ?? "",
    criado_em: o.data_solicitacao ?? "",
  };
}

export const filaPsfListar = (status?: string, unidade?: string, page?: number, limit?: number) =>
  api
    .get("/api/exames/fila-psf", { params: { status, unidade, page, limit } })
    .then((r) => {
      const d = r.data as any;
      if (Array.isArray(d)) return d.map(mapFila);
      return { data: (d?.data ?? []).map(mapFila), total: d?.total ?? 0, page: d?.page ?? 1, pages: d?.pages ?? 1 };
    });

export const filaPsfCriar = (p: Record<string, unknown>) =>
  api
    .post("/api/exames/fila-psf", {
      paciente_id: p.paciente_id,
      unidade_psf: p.unidade_psf,
      medico_solicitante: (p as any).medico_solicitante ?? (p as any).medico,
      data_solicitacao:
        (p as any).data_solicitacao ?? new Date().toISOString().slice(0, 10),
      observacoes: (p as any).observacoes ?? (p as any).obs ?? "",
    })
    .then((r) => mapFila(r.data));

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
  data_agendada: string;
  laboratorio_id: number;
  laboratorio_nome: string;
  laboratorio: string;
  status: string;
  status_auditoria: string;
  observacao_laboratorio: string;
  observacoes: string;
  itens: { id: number; solicitacao_id: number; sigtap_id: number; quantidade: number; status_auditoria: string; observacao: string; procedimento_codigo: string; procedimento_descricao: string; codigo: string; descricao: string; conferido: boolean; divergente: boolean }[];
};

export function mapMestre(o: any): SolicMestre {
  return {
    id: o.id,
    paciente_id: o.paciente_id,
    paciente_nome: o.paciente_nome ?? "",
    data_agendada: typeof o.data_agendada === "string" ? o.data_agendada : String(o.data_agendada ?? ""),
    laboratorio_id: o.laboratorio_id,
    laboratorio_nome: o.laboratorio_nome ?? "",
    laboratorio: o.laboratorio_nome ?? o.laboratorio ?? "",
    status: o.status ?? "",
    status_auditoria: o.status_auditoria ?? "",
    observacao_laboratorio: o.observacao_laboratorio ?? "",
    observacoes: o.observacao_laboratorio ?? "",
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

export const examesSolicitar = (p: { paciente_id: number; data_agendada: string; laboratorio_id: number; sigtap_ids?: number[]; itens?: ExameLoteItem[]; origem_fila_id?: number | null }) =>
  api.post("/api/exames/solicitacoes", p).then((r) => mapMestre(r.data));

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
}) => {
  const itens = p.itens ? normalizarItens(p.itens) : undefined;
  return examesSolicitar({
    paciente_id: p.paciente_id,
    data_agendada: p.data_agendada,
    laboratorio_id: p.laboratorio_id,
    itens,
    sigtap_ids: itens ? undefined : p.sigtap_ids,
    origem_fila_id: p.origem_fila_id,
  });
};
export const solicitarListar = (filtros?: { status_auditoria?: string; laboratorio_id?: number; page?: number; limit?: number }) =>
  api.get("/api/exames/solicitacoes", { params: filtros }).then((r) => {
    const d = r.data as any;
    if (Array.isArray(d)) return d.map(mapMestre);
    return { data: (d?.data ?? []).map(mapMestre), total: d?.total ?? 0, page: d?.page ?? 1, pages: d?.pages ?? 1 };
  });

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

export default api;
