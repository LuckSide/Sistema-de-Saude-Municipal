import { useEffect, useMemo, useState } from "react";
import { Building2, CalendarClock, Filter, Stethoscope, User } from "lucide-react";
import { fetchTimeline, type TimelineEvento } from "../services/api";
import { cn } from "./ui/primitives";

const COR_TIPO: Record<string, string> = {
  cadastro: "bg-sus-900",
  fila: "bg-amber-500",
  agendamento: "bg-teal",
  transporte: "bg-violet-500",
  movimentacao: "bg-slate-400",
  remocao: "bg-red-500",
};

/** Timeline do paciente. Quando `filtrarProcedimento` é informado, exibe
 * apenas eventos que mencionem aquele procedimento no título ou detalhe. */
export default function Timeline({
  pacienteId,
  filtrarProcedimento,
}: {
  pacienteId: number;
  /** Se fornecido, filtra a linha do tempo para exibir apenas eventos
   * relacionados a este procedimento/exame. */
  filtrarProcedimento?: string;
}) {
  const [eventos, setEventos] = useState<TimelineEvento[]>([]);
  const [status, setStatus] = useState("");
  const [erro, setErro] = useState("");
  const [loading, setLoading] = useState(true);
  const [mostrarSoProc, setMostrarSoProc] = useState(!!filtrarProcedimento);

  useEffect(() => {
    setLoading(true);
    fetchTimeline(pacienteId)
      .then((r) => {
        setEventos(r.eventos ?? []);
        setStatus(r.status_atual ?? "");
      })
      .catch(() => setErro("Falha ao carregar linha do tempo."))
      .finally(() => setLoading(false));
  }, [pacienteId]);

  // Quando o procedimento muda externamente, ativa o filtro automaticamente.
  useEffect(() => {
    setMostrarSoProc(!!filtrarProcedimento);
  }, [filtrarProcedimento]);

  /** Filtra eventos pelo procedimento selecionado (busca por termo completo, nome ou código). */
  const eventosFiltrados = useMemo(() => {
    if (!mostrarSoProc || !filtrarProcedimento) return eventos;
    const termo = filtrarProcedimento.trim().toLowerCase();
    if (!termo) return eventos;
    const match = termo.match(/^([0-9.\-]+)\s*-\s*(.+)$/);
    const codigo = match ? match[1].trim() : "";
    const nome = match ? match[2].trim() : termo;
    return eventos.filter((e) => {
      const texto = `${e.titulo} ${e.detalhe}`.toLowerCase();
      if (texto.includes(termo)) return true;
      if (nome && nome.length >= 3 && texto.includes(nome)) return true;
      if (codigo && codigo.length >= 4 && texto.includes(codigo)) return true;
      return false;
    });
  }, [eventos, mostrarSoProc, filtrarProcedimento]);

  if (loading) return <p className="text-xs text-ink/45">Carregando linha do tempo…</p>;
  if (erro) return <p className="text-xs text-red-600">{erro}</p>;
  if (eventos.length === 0) return <p className="text-xs text-ink/45">Sem eventos registrados.</p>;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="font-display text-sm font-bold text-sus-950">Linha do tempo</p>
        {status && (
          <span className="rounded-full bg-teal/15 px-2.5 py-0.5 text-xs font-bold text-teal">{status}</span>
        )}
        {/* Botão de filtro por procedimento — só aparece se houver um procedimento selecionado */}
        {filtrarProcedimento && (
          <button
            type="button"
            onClick={() => setMostrarSoProc((v) => !v)}
            className={cn(
              "ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold transition",
              mostrarSoProc
                ? "bg-sus-900 text-white"
                : "bg-sus-900/10 text-sus-900 hover:bg-sus-900/15"
            )}
            title={
              mostrarSoProc
                ? "Exibindo apenas eventos deste procedimento — clique para ver todos"
                : "Clique para filtrar apenas eventos deste procedimento"
            }
          >
            <Filter className="h-3 w-3" />
            {mostrarSoProc ? "Filtrado por procedimento" : "Filtrar por procedimento"}
          </button>
        )}
        {mostrarSoProc && filtrarProcedimento && eventosFiltrados.length === 0 && (
          <p className="w-full text-xs text-ink/45">
            Nenhum evento encontrado para este procedimento.{" "}
            <button
              type="button"
              onClick={() => setMostrarSoProc(false)}
              className="text-sus-900 underline"
            >
              Ver todos
            </button>
          </p>
        )}
      </div>

      {mostrarSoProc && filtrarProcedimento && (
        <p className="mb-3 rounded-xl bg-sus-900/5 px-3 py-2 text-xs text-sus-900">
          <span className="font-bold">Filtro ativo:</span> {filtrarProcedimento}
          {" "}
          <span className="text-ink/45">({eventosFiltrados.length} de {eventos.length} eventos)</span>
        </p>
      )}

      <ol className="relative space-y-4 border-l-2 border-sus-900/10 pl-5">
        {eventosFiltrados.map((e, i) => (
          <li key={i} className="relative">
            <span className={cn("absolute -left-[27px] top-0.5 h-3 w-3 rounded-full ring-4 ring-white", COR_TIPO[e.tipo] ?? "bg-slate-300")} />
            <p className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-ink/50">
              <CalendarClock className="h-3 w-3" />
              {e.data.split("-").reverse().join("/")}
            </p>
            <p className="text-sm font-bold text-sus-950">{e.titulo}</p>
            {e.detalhe && (
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink/75">
                {e.detalhe.split(" · ").map((part, idx) => {
                  const p = part.trim();
                  if (!p) return null;
                  if (p.startsWith("Unidade:") || p.startsWith("Unidade de Cadastro:")) {
                    return (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-1 rounded-md border border-teal/20 bg-teal/10 px-2 py-0.5 text-[11px] font-semibold text-teal-800"
                      >
                        <Building2 className="h-3 w-3 text-teal" />
                        {p}
                      </span>
                    );
                  }
                  if (p.startsWith("Profissional Requisitante:") || p.startsWith("Médico:")) {
                    return (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-800"
                      >
                        <Stethoscope className="h-3 w-3 text-sky-600" />
                        {p}
                      </span>
                    );
                  }
                  if (p.startsWith("Prioridade")) {
                    return (
                      <span
                        key={idx}
                        className="inline-flex items-center rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700"
                      >
                        {p}
                      </span>
                    );
                  }
                  return (
                    <span
                      key={idx}
                      className="inline-flex items-center rounded-md bg-sand/60 px-2 py-0.5 text-[11px] text-ink/70"
                    >
                      {p}
                    </span>
                  );
                })}
              </div>
            )}
            {e.usuario && (
              <p className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-sus-900/10 px-2 py-0.5 text-[11px] font-semibold text-sus-900">
                <User className="h-3 w-3" /> Responsável / Operador: {e.usuario}
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
