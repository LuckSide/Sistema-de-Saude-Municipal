import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock,
  ExternalLink,
  History,
  Layers,
  ListOrdered,
  MapPin,
  Stethoscope,
  User,
} from "lucide-react";
import { tfdPerfilPaciente, type PacientePerfil } from "../services/api";
import ExportarExcel from "./ExportarExcel";

function fmtNasc(s: string | null): string {
  if (!s || typeof s !== "string") return "—";
  const base = s.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(base)) return "—";
  return base.split("-").reverse().join("/");
}

function fmtDataHora(s?: string | null): string {
  if (!s || typeof s !== "string") return "—";
  const base = s.slice(0, 10);
  const data = /^\d{4}-\d{2}-\d{2}$/.test(base) ? base.split("-").reverse().join("/") : s;
  const horaMatch = s.match(/T(\d{2}:\d{2})/);
  return horaMatch ? `${data} ${horaMatch[1]}` : data;
}

function enderecoCompleto(p: PacientePerfil["paciente"]): string {
  const partes = [
    p.endereco,
    p.endereco_numero ? `Nº ${p.endereco_numero}` : "",
    p.complemento ?? "",
    p.bairro,
    p.cep ? `CEP ${p.cep}` : "",
  ].filter(Boolean);
  return partes.join(" · ") || "—";
}

const RISCO_COR: Record<string, string> = {
  Eletivo: "bg-sus-900/10 text-sus-900",
  Urgente: "bg-red-100 text-red-700",
  Priorizado: "bg-red-100 text-red-700",
};

export default function PerfilPaciente({
  pid,
  onVerExame,
}: {
  pid: number;
  onVerExame?: (exameId: number) => void;
}) {
  const navigate = useNavigate();
  const [perfil, setPerfil] = useState<PacientePerfil | null>(null);
  const [erro, setErro] = useState("");
  const [abaDemanda, setAbaDemanda] = useState<"espera" | "realizados" | "historico">("espera");
  const [modoVisao, setModoVisao] = useState<"geral" | "procedimento">("geral");

  const itensEspera = useMemo(() => {
    return (perfil?.demanda || []).filter((d) => (d.status || "").toLowerCase() === "aguardando");
  }, [perfil]);

  const itensRealizados = useMemo(() => {
    return (perfil?.demanda || []).filter((d) => (d.status || "").toLowerCase() !== "aguardando");
  }, [perfil]);

  const historico = useMemo(() => perfil?.historico ?? [], [perfil]);

  const abrirExame = (id: number, tipoFila?: string) => {
    if (tipoFila && (tipoFila.includes("PSF") || tipoFila.includes("SANGUE"))) {
      navigate(`/lab/fila?q=${id}`);
      return;
    }
    if (onVerExame) {
      onVerExame(id);
    } else {
      navigate(`/fila-exames?registro=${id}&q=${id}`);
    }
  };

  useEffect(() => {
    setPerfil(null);
    setErro("");
    tfdPerfilPaciente(pid).then(setPerfil).catch(() => setErro("Falha ao carregar perfil."));
  }, [pid]);

  if (erro) return <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>;
  if (!perfil) return <p className="py-6 text-center text-sm text-ink/50">Carregando perfil…</p>;

  const p = perfil.paciente;
  const situacao = (p.situacao_cadastral || "ativo").toLowerCase();
  const isInativoCadastral = situacao !== "ativo";
  return (
    <div className="space-y-4">
      {/* Cabeçalho do perfil */}
      <section className={`rounded-2xl border p-4 ${isInativoCadastral ? "border-red-300 bg-red-50/40" : "border-sus-900/10"}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-sus-900/50">
            <User className="h-3.5 w-3.5" /> Dados pessoais
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {situacao === "obito" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-600 px-2.5 py-0.5 text-xs font-bold text-white shadow-2xs">
                <AlertTriangle className="h-3 w-3" /> Óbito{p.data_obito ? ` (${fmtNasc(p.data_obito)})` : ""}
              </span>
            )}
            {situacao === "mudanca_municipio" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-600 px-2.5 py-0.5 text-xs font-bold text-white shadow-2xs">
                <AlertTriangle className="h-3 w-3" /> Mudança de Município
              </span>
            )}
            {isInativoCadastral && situacao !== "obito" && situacao !== "mudanca_municipio" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-700 px-2.5 py-0.5 text-xs font-bold text-white shadow-2xs">
                <AlertTriangle className="h-3 w-3" /> {p.situacao_cadastral}
              </span>
            )}
            <span className="rounded-md bg-sus-900/10 px-2.5 py-0.5 text-xs font-mono font-bold text-sus-900">
              Prontuário: {p.codigo_prontuario || `PR-${String(p.id).padStart(5, "0")}`}
            </span>
          </div>
        </div>
        <p className="mt-1 font-display text-lg font-bold text-sus-950">{p.nome}</p>
        {isInativoCadastral && (
          <div className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
            <strong>Situação cadastral (e-SUS PEC):</strong>{" "}
            {p.motivo_situacao || (situacao === "obito" ? "Óbito registrado" : "Mudança de município")}.
            {" "}Pedidos ativos na fila de espera foram baixados automaticamente e registrados no histórico do prontuário.
          </div>
        )}
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2.5 text-xs md:grid-cols-3">
          <div><dt className="text-ink/45">Nome completo</dt><dd className="font-semibold">{p.nome}</dd></div>
          <div><dt className="text-ink/45">Prontuário / ID</dt><dd className="font-semibold font-mono text-sus-900">{p.codigo_prontuario || `PR-${String(p.id).padStart(5, "0")}`}</dd></div>
          <div><dt className="text-ink/45">CPF</dt><dd className="font-semibold">{p.cpf || "—"}</dd></div>
          <div><dt className="text-ink/45">Cartão SUS (CNS)</dt><dd className="font-semibold">{p.cns || "—"}</dd></div>
          <div><dt className="text-ink/45">Data de nascimento</dt><dd className="font-semibold">{fmtNasc(p.nascimento)}</dd></div>
          <div><dt className="text-ink/45">Telefone</dt><dd className="font-semibold">{p.telefone || "—"}</dd></div>
          <div className="col-span-2 md:col-span-3"><dt className="text-ink/45">Endereço</dt><dd className="font-semibold">{enderecoCompleto(p)}</dd></div>
        </dl>
      </section>

      {/* Vinculação APS / PSF */}
      <section className="rounded-2xl border border-teal/25 bg-teal/5 p-4">
        <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-sus-900/60">
          <MapPin className="h-3.5 w-3.5" /> Vinculação APS / PSF
        </p>
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2.5 text-xs md:grid-cols-3">
          <div><dt className="text-ink/45">Unidade de Saúde (PSF/USF)</dt><dd className="font-semibold">{perfil.unidade_saude_nome || "—"}</dd></div>
          <div><dt className="text-ink/45">Equipe de Saúde da Família (eSF)</dt><dd className="font-semibold">{p.equipe_esf || "—"}</dd></div>
          <div><dt className="text-ink/45">Agente Comunitário de Saúde (ACS)</dt><dd className="font-semibold">{p.acs_nome || "—"}</dd></div>
        </dl>
      </section>

      {/* Painel de demanda reprimida e histórico de procedimentos */}
      <section className="rounded-2xl border border-sus-900/10 p-4">
        {/* Cabeçalho com Abas Principais: Fila de Espera vs Procedimentos Já Realizados */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sus-900/10 pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setAbaDemanda("espera")}
              className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold transition shadow-xs ${
                abaDemanda === "espera"
                  ? "bg-teal text-white shadow-teal/20"
                  : "bg-sand/60 text-sus-900/70 hover:bg-sand hover:text-sus-950 border border-sus-900/10"
              }`}
            >
              <Clock className="h-4 w-4" />
              <span>Fila de Espera</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                abaDemanda === "espera" ? "bg-white/20 text-white" : "bg-teal/10 text-teal"
              }`}>
                {itensEspera.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setAbaDemanda("realizados")}
              className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold transition shadow-xs ${
                abaDemanda === "realizados"
                  ? "bg-emerald-600 text-white shadow-emerald-600/20"
                  : "bg-sand/60 text-sus-900/70 hover:bg-sand hover:text-sus-950 border border-sus-900/10"
              }`}
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>Procedimentos Já Realizados</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                abaDemanda === "realizados" ? "bg-white/20 text-white" : "bg-emerald-600/10 text-emerald-700"
              }`}>
                {itensRealizados.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setAbaDemanda("historico")}
              className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold transition shadow-xs ${
                abaDemanda === "historico"
                  ? "bg-sus-900 text-white shadow-sus-900/20"
                  : "bg-sand/60 text-sus-900/70 hover:bg-sand hover:text-sus-950 border border-sus-900/10"
              }`}
            >
              <History className="h-4 w-4" />
              <span>Histórico do Prontuário</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                abaDemanda === "historico" ? "bg-white/20 text-white" : "bg-sus-900/10 text-sus-900"
              }`}>
                {historico.length}
              </span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {abaDemanda === "espera" && itensEspera.length > 0 && (
              <div className="flex items-center gap-1 rounded-xl bg-sand/60 p-1 border border-sus-900/10">
                <button
                  type="button"
                  onClick={() => setModoVisao("geral")}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                    modoVisao === "geral"
                      ? "bg-sus-900 text-white shadow-2xs"
                      : "text-sus-900/70 hover:text-sus-950"
                  }`}
                  title="Visualizar todas as solicitações do paciente na Fila Geral de forma unificada"
                >
                  <Layers className="h-3.5 w-3.5" /> Fila Geral (Unificada)
                </button>
                <button
                  type="button"
                  onClick={() => setModoVisao("procedimento")}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                    modoVisao === "procedimento"
                      ? "bg-sus-900 text-white shadow-2xs"
                      : "text-sus-900/70 hover:text-sus-950"
                  }`}
                  title="Visualizar solicitações agrupadas por procedimento"
                >
                  <ListOrdered className="h-3.5 w-3.5" /> Por Procedimento
                </button>
              </div>
            )}

            {perfil.demanda.length > 0 && (
              <ExportarExcel url={`/api/tfd/pacientes/${pid}/demanda/exportar`} arquivo="demanda_reprimida" />
            )}
          </div>
        </div>

        {/* Conteúdo da Aba 1: Fila de Espera */}
        {abaDemanda === "espera" && (
          <div>
            {itensEspera.length === 0 ? (
              <p className="mt-3 rounded-xl bg-sand/60 px-3 py-4 text-center text-xs text-ink/55">
                Nenhuma solicitação aguardando na fila de espera para este paciente na regulação.
              </p>
            ) : (
              <div className="mt-4 space-y-4">
                {(() => {
                  const ordenados = [...itensEspera].sort((a, b) => {
                    const da = a.data_pedido || a.data_inclusao || "";
                    const db = b.data_pedido || b.data_inclusao || "";
                    return da.localeCompare(db);
                  });

                  if (modoVisao === "geral") {
                    return (
                      <div className="overflow-hidden rounded-xl border border-sus-900/10 bg-white">
                        <div className="flex items-center justify-between border-b border-sus-900/10 bg-sus-900/5 px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <Layers className="h-4 w-4 text-teal" />
                            <h4 className="font-display text-xs font-bold uppercase tracking-wide text-sus-950">
                              Visão Unificada da Fila Geral de Regulação
                            </h4>
                          </div>
                          <span className="rounded-full bg-white px-2.5 py-0.5 text-[11px] font-semibold text-sus-900 shadow-xs">
                            {ordenados.length} {ordenados.length === 1 ? "solicitação pendente" : "solicitações pendentes"}
                          </span>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[800px] text-left text-xs">
                            <thead>
                              <tr className="border-b border-sus-900/10 bg-sand/50 text-[11px] uppercase text-sus-900/60">
                                <th className="px-3 py-2.5">Data Pedido</th>
                                <th className="px-3 py-2.5">Procedimento / Exame</th>
                                <th className="px-3 py-2.5">Especialidade / Fila</th>
                                <th className="px-3 py-2.5">Risco</th>
                                <th className="px-3 py-2.5">Posição Fila Geral</th>
                                <th className="px-3 py-2.5">Posição Especialidade</th>
                                <th className="px-3 py-2.5">Status</th>
                                <th className="px-3 py-2.5 text-right">Ação</th>
                              </tr>
                            </thead>
                            <tbody>
                              {ordenados.map((d) => (
                                <tr
                                  key={d.id}
                                  onClick={() => abrirExame(d.id, d.tipo_fila)}
                                  className="group cursor-pointer border-b border-sus-900/5 transition-colors last:border-0 hover:bg-teal/10"
                                  title="Clique para abrir e gerenciar na Fila de Exames"
                                >
                                  <td className="px-3 py-2 font-semibold text-sus-950">
                                    {d.data_pedido ? d.data_pedido.split("-").reverse().join("/") : (d.data_inclusao || "—")}
                                  </td>
                                  <td className="px-3 py-2 font-bold text-sus-950">
                                    {d.exame || "—"}
                                  </td>
                                  <td className="px-3 py-2">
                                    <p className="font-semibold text-sus-900">
                                      {d.nome_especialidade || d.especialidade || d.tipo_fila || "—"}
                                    </p>
                                    {d.tipo_fila && d.tipo_fila !== (d.nome_especialidade || d.especialidade) && (
                                      <span className="text-[10px] text-ink/50 block">{d.tipo_fila}</span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2">
                                    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold leading-none ${RISCO_COR[d.classificacao_risco] ?? "bg-sand"}`}>
                                      {d.classificacao_risco}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 font-semibold">
                                    {d.posicao_fila_geral ? (
                                      <span className="text-teal font-extrabold">{d.posicao_fila_geral}º da Fila Geral</span>
                                    ) : (
                                      <span className="text-ink/40">—</span>
                                    )}
                                    {d.total_fila_geral ? (
                                      <span className="block text-[10px] font-normal text-ink/50">de {d.total_fila_geral} total</span>
                                    ) : null}
                                  </td>
                                  <td className="px-3 py-2 font-semibold">
                                    {d.posicao_especialidade ? `${d.posicao_especialidade}º da fila` : "—"}
                                    {d.total_fila_especialidade ? (
                                      <span className="block text-[10px] font-normal text-ink/50">de {d.total_fila_especialidade} na área</span>
                                    ) : null}
                                  </td>
                                  <td className="px-3 py-2">
                                    <span className="font-semibold">{d.status_rotulo}</span>
                                    {d.data_agendada && (
                                      <span className="mt-0.5 flex items-center gap-1 text-[11px] text-ink/50">
                                        <CalendarDays className="h-3 w-3" />
                                        {d.data_agendada.slice(0, 10).split("-").reverse().join("/")}{d.hora_agendada ? ` · ${d.hora_agendada}` : ""}
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        abrirExame(d.id, d.tipo_fila);
                                      }}
                                      className="inline-flex items-center gap-1 rounded-lg border border-sus-900/15 bg-white px-2 py-1 text-[11px] font-bold text-sus-900 shadow-2xs transition-colors hover:bg-sus-900 hover:text-white"
                                      title="Abrir solicitação na fila"
                                    >
                                      <ExternalLink className="h-3.5 w-3.5" />
                                      <span>Ver na fila</span>
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  }

                  const grupos = new Map<string, typeof itensEspera>();
                  for (const item of ordenados) {
                    const proc = item.exame?.trim() || "Procedimento não especificado";
                    if (!grupos.has(proc)) grupos.set(proc, []);
                    grupos.get(proc)!.push(item);
                  }

                  return Array.from(grupos.entries()).map(([proc, itens]) => (
                    <div key={proc} className="overflow-hidden rounded-xl border border-sus-900/10 bg-white">
                      <div className="flex items-center justify-between border-b border-sus-900/10 bg-sus-900/5 px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full bg-teal" />
                          <h4 className="font-display text-xs font-bold uppercase tracking-wide text-sus-950">{proc}</h4>
                        </div>
                        <span className="rounded-full bg-white px-2.5 py-0.5 text-[11px] font-semibold text-sus-900 shadow-xs">
                          {itens.length} {itens.length === 1 ? "solicitação" : "solicitações"}
                        </span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[750px] text-left text-xs">
                          <thead>
                            <tr className="border-b border-sus-900/10 bg-sand/50 text-[11px] uppercase text-sus-900/60">
                              <th className="px-3 py-2">Data do Pedido</th>
                              <th className="px-3 py-2">Especialidade</th>
                              <th className="px-3 py-2">Classificação de risco</th>
                              <th className="px-3 py-2">Posição na Fila Geral</th>
                              <th className="px-3 py-2">Posição na Especialidade</th>
                              <th className="px-3 py-2">Status</th>
                              <th className="px-3 py-2 text-right">Ação</th>
                            </tr>
                          </thead>
                          <tbody>
                            {itens.map((d) => (
                              <tr
                                key={d.id}
                                onClick={() => abrirExame(d.id, d.tipo_fila)}
                                className="group cursor-pointer border-b border-sus-900/5 transition-colors last:border-0 hover:bg-teal/10"
                                title="Clique para visualizar e gerenciar esta solicitação na Fila de Exames"
                              >
                                <td className="px-3 py-2 font-semibold">
                                  {d.data_pedido ? d.data_pedido.split("-").reverse().join("/") : (d.data_inclusao || "—")}
                                </td>
                                <td className="px-3 py-2">
                                  <p className="font-semibold text-sus-950">{d.nome_especialidade || d.especialidade || d.tipo_fila || "—"}</p>
                                </td>
                                <td className="px-3 py-2">
                                  <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold leading-none ${RISCO_COR[d.classificacao_risco] ?? "bg-sand"}`}>
                                    {d.classificacao_risco}
                                  </span>
                                </td>
                                <td className="px-3 py-2 font-semibold">
                                  {d.posicao_fila_geral ? (
                                    <span className="text-teal font-extrabold">{d.posicao_fila_geral}º Fila Geral</span>
                                  ) : "—"}
                                  {d.total_fila_geral ? <span className="block font-normal text-ink/45">de {d.total_fila_geral} total</span> : null}
                                </td>
                                <td className="px-3 py-2 font-semibold">
                                  {d.posicao_especialidade ? `${d.posicao_especialidade}º da fila` : "—"}
                                  {d.total_fila_especialidade ? <span className="block font-normal text-ink/45">de {d.total_fila_especialidade} na especialidade</span> : null}
                                </td>
                                <td className="px-3 py-2">
                                  <span className="font-semibold">{d.status_rotulo}</span>
                                  {d.data_agendada && (
                                    <span className="mt-1 flex items-center gap-1 text-ink/50">
                                      <CalendarDays className="h-3 w-3" />
                                      {d.data_agendada.slice(0, 10).split("-").reverse().join("/")}{d.hora_agendada ? ` · ${d.hora_agendada}` : ""}
                                    </span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      abrirExame(d.id, d.tipo_fila);
                                    }}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-sus-900/15 bg-white px-2.5 py-1 text-[11px] font-bold text-sus-900 shadow-2xs transition-colors hover:bg-sus-900 hover:text-white"
                                    title="Abrir solicitação na fila"
                                  >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                    <span>Ver na fila</span>
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ));
                })()}
              </div>
            )}
            <p className="mt-3 text-[11px] text-ink/45">
              {modoVisao === "geral"
                ? "Fila de Espera (Visão Geral): exibe todas as solicitações pendentes de agendamento em ordem cronológica de inclusão."
                : "Fila de Espera (Por Procedimento): solicitações pendentes agrupadas pelo tipo de procedimento."}
            </p>
          </div>
        )}

        {/* Conteúdo da Aba 2: Procedimentos Já Realizados / Histórico de Execução */}
        {abaDemanda === "realizados" && (
          <div>
            {itensRealizados.length === 0 ? (
              <p className="mt-3 rounded-xl bg-sand/60 px-3 py-4 text-center text-xs text-ink/55">
                Nenhum procedimento com agendamento ou execução registrada no histórico deste paciente.
              </p>
            ) : (
              <div className="mt-4 overflow-hidden rounded-xl border border-sus-900/10 bg-white">
                <div className="flex items-center justify-between border-b border-sus-900/10 bg-emerald-50 px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                    <h4 className="font-display text-xs font-bold uppercase tracking-wide text-emerald-950">
                      Histórico de Execuções e Procedimentos Marcados
                    </h4>
                  </div>
                  <span className="rounded-full bg-white px-2.5 py-0.5 text-[11px] font-bold text-emerald-800 shadow-xs">
                    {itensRealizados.length} {itensRealizados.length === 1 ? "registro" : "registros"}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[850px] text-left text-xs">
                    <thead>
                      <tr className="border-b border-sus-900/10 bg-sand/50 text-[11px] uppercase text-sus-900/60">
                        <th className="px-3 py-2.5">Data Execução / Agendamento</th>
                        <th className="px-3 py-2.5">Procedimento / Exame</th>
                        <th className="px-3 py-2.5">Especialidade / CBO</th>
                        <th className="px-3 py-2.5">Profissional Responsável</th>
                        <th className="px-3 py-2.5">Unidade de Saúde</th>
                        <th className="px-3 py-2.5">Status</th>
                        <th className="px-3 py-2.5">Resultado / Laudo</th>
                        <th className="px-3 py-2.5 text-right">Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {itensRealizados
                        .slice()
                        .sort((a, b) => {
                          const da = a.realizado_em || a.data_agendada || a.data_pedido || "";
                          const db = b.realizado_em || b.data_agendada || b.data_pedido || "";
                          return db.localeCompare(da); // Mais recente primeiro
                        })
                        .map((d) => {
                          const dataRef = d.realizado_em || d.data_agendada || d.data_pedido || "";
                          const dataFmt = dataRef ? dataRef.slice(0, 10).split("-").reverse().join("/") : "—";
                          const horaFmt = d.hora_agendada ? ` · ${d.hora_agendada}` : "";

                          return (
                            <tr
                              key={d.id}
                              onClick={() => abrirExame(d.id, d.tipo_fila)}
                              className="group cursor-pointer border-b border-sus-900/5 transition-colors last:border-0 hover:bg-emerald-50/50"
                              title="Clique para abrir detalhes do registro"
                            >
                              <td className="px-3 py-2.5 font-semibold text-sus-950">
                                <div>{dataFmt}{horaFmt}</div>
                                {d.realizado_em && (
                                  <span className="text-[10px] text-emerald-700 font-normal">Realizado</span>
                                )}
                                {!d.realizado_em && d.data_agendada && (
                                  <span className="text-[10px] text-blue-700 font-normal">Agendado</span>
                                )}
                              </td>
                              <td className="px-3 py-2.5 font-bold text-sus-950">
                                {d.exame || "—"}
                              </td>
                              <td className="px-3 py-2.5">
                                <span className="font-semibold text-sus-900">
                                  {d.nome_especialidade || d.especialidade || d.tipo_fila || "—"}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-ink/75">
                                {d.medico_nome ? (
                                  <span className="inline-flex items-center gap-1 font-medium">
                                    <Stethoscope className="h-3 w-3 text-sus-900/40" />
                                    {d.medico_nome}
                                  </span>
                                ) : (
                                  <span className="text-ink/40">—</span>
                                )}
                              </td>
                              <td className="px-3 py-2.5 text-ink/75">
                                {d.unidade_nome || "—"}
                              </td>
                              <td className="px-3 py-2.5">
                                <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold ${
                                  (d.status || "").toLowerCase() === "realizado"
                                    ? "bg-emerald-100 text-emerald-800"
                                    : (d.status || "").toLowerCase() === "agendado"
                                    ? "bg-blue-100 text-blue-800"
                                    : "bg-sand text-ink/75"
                                }`}>
                                  {d.status_rotulo || d.status}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-ink/70">
                                {d.resultado ? (
                                  <span className="font-medium text-emerald-900 bg-emerald-50 px-1.5 py-0.5 rounded text-[11px]">
                                    {d.resultado}
                                  </span>
                                ) : (
                                  <span className="text-ink/40 text-[11px] italic">Sem laudo anexo</span>
                                )}
                              </td>
                              <td className="px-3 py-2.5 text-right">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    abrirExame(d.id, d.tipo_fila);
                                  }}
                                  className="inline-flex items-center gap-1 rounded-lg border border-sus-900/15 bg-white px-2 py-1 text-[11px] font-bold text-sus-900 shadow-2xs transition-colors hover:bg-sus-900 hover:text-white"
                                  title="Ver detalhes da solicitação"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                  <span>Ver detalhes</span>
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <p className="mt-3 text-[11px] text-ink/45">
              Histórico de Procedimentos: exibe procedimentos já realizados ou marcados pelo paciente com baixa automática na fila de espera.
            </p>
          </div>
        )}

        {abaDemanda === "historico" && (
          <div className="mt-3 space-y-2.5">
            {historico.length === 0 ? (
              <p className="rounded-xl border border-sus-900/10 bg-sand/30 px-4 py-6 text-center text-xs text-ink/55">
                Nenhum evento de baixa cadastral ou movimentação automática registrado para este paciente.
              </p>
            ) : (
              historico.map((h, idx) => {
                const ev = (h.tipo_evento || "").toLowerCase();
                const isObitoEv = ev.includes("obito");
                const isMudancaEv = ev.includes("mudanca");
                const rotulo = isObitoEv
                  ? "Baixa por Óbito"
                  : isMudancaEv
                    ? "Baixa por Mudança de Município"
                    : h.tipo_evento;
                const corBadge = isObitoEv
                  ? "bg-red-100 text-red-800 border-red-200"
                  : isMudancaEv
                    ? "bg-amber-100 text-amber-800 border-amber-200"
                    : "bg-sus-900/10 text-sus-900 border-sus-900/15";
                return (
                  <div
                    key={h.id ?? `${h.tipo_evento}-${idx}`}
                    className="rounded-xl border border-sus-900/10 bg-white p-3 text-xs shadow-2xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${corBadge}`}>
                        {rotulo}
                      </span>
                      <span className="font-mono text-[11px] text-ink/55">
                        {fmtDataHora(h.registrado_em)}
                      </span>
                    </div>
                    {h.motivo && (
                      <p className="mt-1.5 font-semibold text-sus-950">{h.motivo}</p>
                    )}
                    {h.descricao && (
                      <p className="mt-0.5 text-ink/75">{h.descricao}</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink/55">
                      <span>Origem: <strong className="text-ink/80">{h.origem || "—"}</strong></span>
                      <span>Exames baixados: <strong className="text-ink/80">{h.exames_baixados_qtd ?? 0}</strong></span>
                      {h.exames_baixados_ids && (
                        <span>Protocolos/IDs: <strong className="font-mono text-ink/80">{h.exames_baixados_ids}</strong></span>
                      )}
                      <span>Registrado por: <strong className="text-ink/80">{h.registrado_por || "—"}</strong></span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </section>
    </div>
  );
}
