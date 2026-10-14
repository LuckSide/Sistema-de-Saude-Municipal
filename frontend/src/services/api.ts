import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:8000",
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("guape:token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("guape:token");
      if (window.location.pathname !== "/login") window.location.href = "/login";
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

export const fetchMe = () => api.get<Usuario>("/api/me").then((r) => r.data);
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

export type SystemSettings = { cidade: string; uf: string; subtitulo: string };
export const fetchSettingsPublic = () =>
  api.get<SystemSettings>("/api/settings/public").then((r) => r.data);
export const fetchSettings = () =>
  api.get<SystemSettings>("/api/settings").then((r) => r.data);
export const saveSettings = (p: SystemSettings) =>
  api.put<SystemSettings>("/api/settings", p).then((r) => r.data);

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

// ---------- TFD ----------
export type Paciente = {
  id: number;
  nome: string;
  cpf: string;
  cns: string;
  nascimento: string | null;
  telefone: string;
  endereco: string;
  observacoes: string;
};

export type Veiculo = {
  id: number;
  placa: string;
  modelo: string;
  capacidade: number;
  tipo: string;
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
  status: string;
  finalidade: string;
  observacoes: string;
  passageiros: number;
  veiculo_placa: string;
};

export type Destino = {
  id: number;
  nome_destino: string;
  hospital_referencia: string;
  procedimento_sigtap: string;
  ativo: boolean;
};

export type Passageiro = {
  id: number;
  viagem_id: number;
  paciente_id: number;
  acompanhante: string;
  presente: boolean;
  paciente_nome: string;
};

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
  status: string;
  data_pedido: string;
  data_agendada: string | null;
  destino: string;
  observacoes: string;
  paciente_nome: string;
  codigo_curto?: string;
  public_token?: string;
  posicao?: number | null;
  total_fila?: number | null;
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
export type ExameLotePayload = {
  ids: number[];
  status?: string;
  data_agendada?: string | null;
  limpar_data_agendada?: boolean;
  destino?: string;
  prioridade?: string;
  observacoes?: string;
};
export const tfdAtualizarExamesLote = (p: ExameLotePayload) =>
  api.put<{ atualizados: number; nao_encontrados: number[] }>("/api/tfd/exames/lote", p).then((r) => r.data);
export const tfdExcluirExame = (id: number) =>
  api.delete(`/api/tfd/exames/${id}`);
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

export const labsListar = () =>
  api.get<Laboratorio[]>("/api/exames/laboratorios").then((r) => r.data);

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
