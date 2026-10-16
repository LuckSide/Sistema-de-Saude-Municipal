import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Braces, ExternalLink, ScrollText, X } from "lucide-react";
import { Badge, Button, Card, Input, Label } from "../components/ui/primitives";
import Paginacao from "../components/Paginacao";
import ExportarExcel from "../components/ExportarExcel";
import {
  fetchAuditFiltros,
  fetchAuditLogs,
  fetchRegistroRelacionado,
  pagData,
  pagMeta,
  type AuditLog,
  type RegistroRelacionado,
} from "../services/api";

const ACAO_LABEL: Record<string, string> = {
  EXAM_CREATE: "Criação de pedido",
  EXAM_UPDATE: "Atualização de Exame",
  EXAM_DELETE: "Remoção de Exame",
  EXAM_REMOVE: "Remoção da Fila de Espera",
  EXAM_TOKEN: "Regeneração de link",
  PATIENT_CREATE: "Cadastro de paciente",
  PATIENT_UPDATE: "Atualização de paciente",
  PATIENT_DELETE: "Remoção de paciente",
  TRIP_CREATE: "Criação de viagem",
  TRIP_UPDATE: "Atualização de viagem",
  TRIP_DELETE: "Remoção de viagem",
  PASSENGER_CREATE: "Inclusão de passageiro",
  PASSENGER_DELETE: "Remoção de passageiro",
  USER_CREATE: "Criação de conta",
  USER_UPDATE: "Atualização de conta",
  USER_PASSWORD: "Troca de senha",
  DOCTOR_CREATE: "Cadastro de médico",
  DOCTOR_UPDATE: "Atualização de médico",
  UNIT_CREATE: "Cadastro de unidade",
  UNIT_UPDATE: "Atualização de unidade",
};

const ENTIDADE_LABEL: Record<string, string> = {
  EXAM: "Fila de exames (pedido)",
  PATIENT: "Paciente",
  TRIP: "Viagem",
  PASSENGER: "Passageiro em viagem",
  DESTINATION: "Destino",
  VEHICLE: "Veículo / Frota",
  USER: "Conta de usuário",
  DOCTOR: "Médico",
  UNIT: "Unidade de saúde (PSF)",
  TRIPQUEUE: "Fila de viagem",
  CATALOG: "Catálogo de exames",
  BILLING: "Faturamento",
  REQUEST: "Solicitação",
  QUEUE: "Fila do PSF",
  SLOT: "Vaga",
  LAB: "Laboratório",
  SIGTAP: "SIGTAP",
  SETTINGS: "Configurações",
  INTEGRATION: "Importação / Integração",
  SYSTEM: "Sistema",
  DASHBOARD: "Dashboard",
  REPORT: "Relatório",
  AUDIT: "Auditoria",
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
  nome_especialidade: "Especialidade (CBO)",
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
};

const VALOR_LABEL: Record<string, string> = {
  rotina: "Eletivo",
  urgente: "Urgente",
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

type Mudanca = { campo: string; de: string; para: string };

function parseDetalhe(raw: string): { mudancas: Mudanca[]; corpo: Record<string, unknown> | null } {
  try {
    const d = JSON.parse(raw || "null");
    if (!d || typeof d !== "object") return { mudancas: [], corpo: null };
    const mudancas = Array.isArray(d.mudancas) ? d.mudancas : [];
    const corpo = d.body && typeof d.body === "object" ? d.body : null;
    return { mudancas, corpo };
  } catch {
    return { mudancas: [], corpo: null };
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
  const navigate = useNavigate();

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    const acao = ACAO_LABEL[l.action] ?? l.action.replace(/_/g, " ");
    const alvo = l.entity_id ? `${l.entity}#${l.entity_id}` : l.entity;
    return `${acao} em ${alvo} por ${l.user_name || "sistema"} em ${fmtDataHora(l.timestamp)}.`;
  }

  const paramsFiltro = {
    data_de: de || undefined, data_ate: ate || undefined,
    usuario: usuario.trim() || undefined, acao: acao || undefined,
    entidade: entidade || undefined,
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-display text-2xl font-extrabold text-sus-950">Auditoria</h1>
        <span className="ml-auto flex gap-2">
          <ExportarExcel url="/api/auditoria/logs/exportar" arquivo="auditoria" params={paramsFiltro} />
          <ExportarExcel url="/api/auditoria/logs/exportar-csv" arquivo="auditoria" params={paramsFiltro} titulo="Exportar CSV" rotulo="Exportar CSV" />
        </span>
      </div>
      <p className="mb-4 mt-1 text-sm text-ink/55">
        Trilha de ações críticas (escritas na API). Restrito a superusers.
      </p>
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
              <option value="">Todas</option>
              {filtros.acoes.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <Label>Módulo</Label>
            <select value={entidade} onChange={(e) => setEntidade(e.target.value)} className="w-full rounded-xl border border-sus-900/15 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-sus-700">
              <option value="">Todos</option>
              {filtros.entidades.map((e) => <option key={e} value={e}>{e}</option>)}
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
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-sus-900/10 bg-sand text-xs uppercase text-sus-900/60">
                <th className="px-4 py-3">Data/hora</th>
                <th className="px-4 py-3">Usuário</th>
                <th className="px-4 py-3">Ação</th>
                <th className="px-4 py-3">Registro (ID)</th>
                <th className="px-4 py-3">Resumo das mudanças</th>
                <th className="px-4 py-3 text-right">Detalhes</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((l) => {
                const { mudancas, corpo } = parseDetalhe(l.details);
                return (
                  <tr key={l.id} onClick={() => abrirDetalhes(l)} className="cursor-pointer border-b border-sus-900/5 align-top transition hover:bg-sand/40 last:border-0">
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs">{fmtDataHora(l.timestamp)}</td>
                    <td className="px-4 py-2.5 font-medium">{l.user_name || "—"}</td>
                    <td className="px-4 py-2.5">
                      <p className="font-semibold text-sus-950">{ACAO_LABEL[l.action] ?? l.action.replace(/_/g, " ")}</p>
                      <p className="font-mono text-[11px] text-ink/50">({l.action})</p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-ink/60">{l.entity}{l.entity_id ? `#${l.entity_id}` : ""}</td>
                    <td className="min-w-64 px-4 py-2.5 text-xs">
                      {mudancas.length > 0 ? (
                        <ul className="space-y-1">
                          {mudancas.slice(0, 4).map((m, i) => (
                            <li key={i}>
                              <b>{rotuloCampo(m.campo)}:</b> alterado de <b>{fmtValor(m.de)}</b> para <b>{fmtValor(m.para)}</b>
                            </li>
                          ))}
                          {mudancas.length > 4 && <li className="text-ink/45">+{mudancas.length - 4} campo(s)…</li>}
                        </ul>
                      ) : corpo ? (
                        <ul className="space-y-1">
                          {Object.entries(corpo).slice(0, 4).map(([k, v]) => (
                            <li key={k}><b>{rotuloCampo(k)}:</b> {fmtValor(v)}</li>
                          ))}
                          {Object.keys(corpo).length > 4 && <li className="text-ink/45">+{Object.keys(corpo).length - 4} campo(s)…</li>}
                        </ul>
                      ) : (
                        <span className="text-ink/45">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); abrirDetalhes(l); }}
                          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-sus-900/10 px-3 py-2 text-xs font-bold text-sus-900 hover:bg-sus-900/15"
                          title="Ver detalhes">
                          Detalhes
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setRawAberto(l); }}
                          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-sus-900/10 px-3 py-2 text-xs font-bold text-sus-900 hover:bg-sus-900/15"
                          title="Ver JSON bruto">
                          <Braces className="h-4 w-4" /> JSON
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {lista.length === 0 && !loading && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-ink/45">Nenhum registro.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Paginacao page={page} pages={pages} total={total} onPage={(p) => carregar(p)} />
      </Card>

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

      {selecionado && (() => {
        const { mudancas, corpo } = parseDetalhe(selecionado.details);
        const det = (() => { try { return JSON.parse(selecionado.details || "null"); } catch { return null; } })();
        const status = (det && typeof det === "object" && "status" in det) ? (det as { status?: unknown }).status : null;
        return (
          <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4" onClick={fecharDetalhes}>
            <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl bg-white p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
              <div className="mb-4 flex items-center justify-between">
                <p className="font-display text-lg font-extrabold text-sus-950">
                  Detalhes do evento
                </p>
                <button onClick={fecharDetalhes} className="rounded-lg p-2 text-ink/50 hover:bg-sand" aria-label="Fechar"><X className="h-4 w-4" /></button>
              </div>

              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{ACAO_LABEL[selecionado.action] ?? selecionado.action}</Badge>
                  <span className="font-mono text-xs text-ink/50">({selecionado.action})</span>
                  {typeof status === "number" && (
                    <Badge variant={status >= 200 && status < 300 ? "success" : status >= 400 ? "danger" : "warning"}>
                      Resultado: {status}
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-ink/75">{descricaoEvento(selecionado)}</p>

                <Card className="p-4">
                  <p className="mb-2 font-display text-sm font-bold text-sus-950">Informações principais</p>
                  <dl className="grid grid-cols-1 gap-y-2 sm:grid-cols-2">
                    <div><dt className="text-[11px] uppercase tracking-wide text-ink/45">Data e hora</dt><dd className="text-sm font-medium text-sus-950">{fmtDataHoraSegundo(selecionado.timestamp)}</dd></div>
                    <div><dt className="text-[11px] uppercase tracking-wide text-ink/45">Usuário responsável</dt><dd className="text-sm font-medium text-sus-950">{selecionado.user_name || "—"}{selecionado.user_id ? ` (#${selecionado.user_id})` : ""}</dd></div>
                    <div><dt className="text-[11px] uppercase tracking-wide text-ink/45">Módulo / entidade</dt><dd className="text-sm font-medium text-sus-950">{ENTIDADE_LABEL[selecionado.entity] ?? selecionado.entity}</dd></div>
                    <div><dt className="text-[11px] uppercase tracking-wide text-ink/45">Identificador do registro</dt><dd className="text-sm font-medium text-sus-950">{selecionado.entity_id ?? "— (sem vínculo)"}</dd></div>
                  </dl>
                </Card>

                {mudancas.length > 0 && (
                  <Card className="p-4">
                    <p className="mb-2 font-display text-sm font-bold text-sus-950">Campos alterados</p>
                    <ul className="space-y-1 text-sm">
                      {mudancas.map((m, i) => (
                        <li key={i} className="rounded-xl bg-sand px-3 py-2">
                          <b>{rotuloCampo(m.campo)}:</b> alterado de <b>{fmtValor(m.de)}</b> para <b>{fmtValor(m.para)}</b>
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}

                {corpo && mudancas.length === 0 && (
                  <Card className="p-4">
                    <p className="mb-2 font-display text-sm font-bold text-sus-950">Dados informados</p>
                    <ul className="space-y-1 text-sm">
                      {Object.entries(corpo).map(([k, v]) => (
                        <li key={k} className="rounded-xl bg-sand px-3 py-2">
                          <b>{rotuloCampo(k)}:</b> {fmtValor(v)}
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}

                {det?.antes && typeof det.antes === "object" && (
                  <Card className="p-4">
                    <p className="mb-2 font-display text-sm font-bold text-sus-950">Dados anteriores (registro excluído)</p>
                    <ul className="space-y-1 text-sm">
                      {Object.entries(det.antes as Record<string, unknown>).map(([k, v]) => (
                        <li key={k} className="rounded-xl bg-sand px-3 py-2">
                          <b>{rotuloCampo(k)}:</b> {fmtValor(v)}
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}

                {selecionado.entity_id && (
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
                    {!relLoading && !relErro && !rel && !relErro && (
                      <p className="text-sm text-ink/55">Consultando registro relacionado…</p>
                    )}
                  </Card>
                )}

                <details className="rounded-xl border border-sus-900/10 bg-sand p-3">
                  <summary className="cursor-pointer text-xs font-bold text-sus-900">Dados técnicos do evento (JSON original)</summary>
                  <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-sus-950 p-3 font-mono text-[11px] text-white">
                    {JSON.stringify(det ?? JSON.parse(selecionado.details || "null"), null, 2)}
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
