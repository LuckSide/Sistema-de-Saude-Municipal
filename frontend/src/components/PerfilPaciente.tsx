import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, ExternalLink, ListOrdered, MapPin, User } from "lucide-react";
import { tfdPerfilPaciente, type PacientePerfil } from "../services/api";
import ExportarExcel from "./ExportarExcel";

function fmtNasc(s: string | null): string {
  if (!s || typeof s !== "string") return "—";
  const base = s.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(base)) return "—";
  return base.split("-").reverse().join("/");
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

export default function PerfilPaciente({ pid }: { pid: number }) {
  const navigate = useNavigate();
  const [perfil, setPerfil] = useState<PacientePerfil | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    setPerfil(null);
    setErro("");
    tfdPerfilPaciente(pid).then(setPerfil).catch(() => setErro("Falha ao carregar perfil."));
  }, [pid]);

  if (erro) return <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>;
  if (!perfil) return <p className="py-6 text-center text-sm text-ink/50">Carregando perfil…</p>;

  const p = perfil.paciente;
  return (
    <div className="space-y-4">
      {/* Cabeçalho do perfil */}
      <section className="rounded-2xl border border-sus-900/10 p-4">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-sus-900/50">
            <User className="h-3.5 w-3.5" /> Dados pessoais
          </p>
          <span className="rounded-md bg-sus-900/10 px-2.5 py-0.5 text-xs font-mono font-bold text-sus-900">
            Prontuário: {p.codigo_prontuario || `PR-${String(p.id).padStart(5, "0")}`}
          </span>
        </div>
        <p className="mt-1 font-display text-lg font-bold text-sus-950">{p.nome}</p>
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

      {/* Painel de demanda reprimida */}
      <section className="rounded-2xl border border-sus-900/10 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-sus-900/50">
            <ListOrdered className="h-3.5 w-3.5" /> Demanda reprimida · {perfil.demanda.length} solicitação(ões) ativa(s)
          </p>
          {perfil.demanda.length > 0 && (
            <span className="ml-auto"><ExportarExcel url={`/api/tfd/pacientes/${pid}/demanda/exportar`} arquivo="demanda_reprimida" /></span>
          )}
        </div>
        {perfil.demanda.length === 0 ? (
          <p className="mt-3 rounded-xl bg-sand/60 px-3 py-4 text-center text-xs text-ink/55">
            Nenhuma solicitação pendente ou ativa para este paciente.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            {(() => {
              // Ordenação estritamente cronológica por tempo de espera (data do pedido / inclusão mais antiga primeiro)
              const ordenados = [...perfil.demanda].sort((a, b) => {
                const da = a.data_pedido || a.data_inclusao || "";
                const db = b.data_pedido || b.data_inclusao || "";
                return da.localeCompare(db);
              });
              // Agrupamento por Procedimento
              const grupos = new Map<string, typeof perfil.demanda>();
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
                    <table className="w-full min-w-[700px] text-left text-xs">
                      <thead>
                        <tr className="border-b border-sus-900/10 bg-sand/50 text-[11px] uppercase text-sus-900/60">
                          <th className="px-3 py-2">Data do Pedido / Inclusão</th>
                          <th className="px-3 py-2">Especialidade</th>
                          <th className="px-3 py-2">Classificação de risco</th>
                          <th className="px-3 py-2">Posição na fila</th>
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2 text-right">Ação</th>
                        </tr>
                      </thead>
                      <tbody>
                        {itens.map((d) => (
                          <tr
                            key={d.id}
                            onClick={() => navigate(`/fila-exames?registro=${d.id}&q=${d.id}`)}
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
                                  navigate(`/fila-exames?registro=${d.id}&q=${d.id}`);
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
          Listagem agrupada por Procedimento e ordenada estritamente por ordem cronológica (tempo de espera).
        </p>
      </section>
    </div>
  );
}
