import { useEffect, useState } from "react";
import { CalendarClock, User } from "lucide-react";
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

export default function Timeline({ pacienteId }: { pacienteId: number }) {
  const [eventos, setEventos] = useState<TimelineEvento[]>([]);
  const [status, setStatus] = useState("");
  const [erro, setErro] = useState("");
  const [loading, setLoading] = useState(true);

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
      </div>
      <ol className="relative space-y-4 border-l-2 border-sus-900/10 pl-5">
        {eventos.map((e, i) => (
          <li key={i} className="relative">
            <span className={cn("absolute -left-[27px] top-0.5 h-3 w-3 rounded-full ring-4 ring-white", COR_TIPO[e.tipo] ?? "bg-slate-300")} />
            <p className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-ink/50">
              <CalendarClock className="h-3 w-3" />
              {e.data.split("-").reverse().join("/")}
            </p>
            <p className="text-sm font-bold text-sus-950">{e.titulo}</p>
            {e.detalhe && <p className="mt-0.5 break-words text-xs text-ink/60">{e.detalhe}</p>}
            {e.usuario && (
              <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-sus-900/10 px-2 py-0.5 text-[11px] font-semibold text-sus-900">
                <User className="h-3 w-3" /> {e.usuario}
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
