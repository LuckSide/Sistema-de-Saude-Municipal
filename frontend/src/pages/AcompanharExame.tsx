import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CalendarDays, Clock, Cross, FlaskConical, ListOrdered, MapPin, RefreshCw } from "lucide-react";
import { tfdConsultarExamePublico, type ExamePublico } from "../services/api";
import { Card } from "../components/ui/primitives";
import { rotuloPrioridade } from "../utils/rotulos";

const STATUS_ROTULO: Record<string, string> = {
  aguardando: "Na Fila (Aguardando)",
  na_fila: "Na Fila (Aguardando)",
  agendado: "Agendado",
  recepcionado: "Recepcionado",
  realizado: "Realizado",
  coletado: "Coletado",
  cancelado: "Cancelado",
  desistiu: "Cancelado",
  faltou: "Faltou",
};

const STATUS_COR: Record<string, string> = {
  aguardando: "bg-amber-100 text-amber-800",
  na_fila: "bg-amber-100 text-amber-800",
  agendado: "bg-teal/15 text-teal",
  recepcionado: "bg-emerald-100 text-emerald-800",
  realizado: "bg-sus-900/10 text-sus-900",
  coletado: "bg-sus-900/10 text-sus-900",
  cancelado: "bg-red-100 text-red-700",
  desistiu: "bg-red-100 text-red-700",
  faltou: "bg-amber-100 text-amber-900",
};

function fmtData(d?: string | null): string {
  if (!d) return "—";
  const iso = d.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso.split("-").reverse().join("/");
  return d;
}

export default function AcompanharExame() {
  const { token } = useParams<{ token: string }>();
  const [dado, setDado] = useState<ExamePublico | null>(null);
  const [erro, setErro] = useState("");
  const [atualizando, setAtualizando] = useState(false);
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState("");

  const carregar = useCallback(async () => {
    if (!token || !/^[A-Za-z0-9-_]{10,128}$/.test(token)) {
      setErro("Link inválido.");
      return;
    }
    setAtualizando(true);
    try {
      const res = await tfdConsultarExamePublico(token);
      setDado(res);
      setErro("");
      setUltimaAtualizacao(new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
    } catch {
      setErro("Pedido não encontrado. Confira o link ou QR Code do comprovante.");
    } finally {
      setAtualizando(false);
    }
  }, [token]);

  useEffect(() => {
    carregar();
    const id = window.setInterval(carregar, 30000);
    return () => window.clearInterval(id);
  }, [carregar]);

  const statusNorm = (dado?.status || "").toLowerCase();
  const isCancelado = ["cancelado", "cancelada", "desistiu"].includes(statusNorm);
  const isLab = dado?.origem_modulo === "laboratorio";
  const localTexto = dado?.laboratorio_nome || dado?.destino || "";

  return (
    <div className="grid min-h-screen place-items-center bg-sand p-4 font-body">
      <Card className="w-full max-w-md p-6 text-center">
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-teal font-display text-xl font-extrabold text-sus-950">
          {isLab ? <FlaskConical className="h-6 w-6" strokeWidth={2.5} /> : <Cross className="h-6 w-6" strokeWidth={2.5} />}
        </div>
        <p className="font-display text-lg font-bold text-sus-950">
          Acompanhar {isLab ? "Exame de Sangue" : "Solicitação"}
        </p>
        <p className="text-xs text-ink/55">
          Saúde Guapé · acompanhamento público em tempo real (sem acesso ao sistema)
        </p>
        {dado?.protocolo && (
          <p className="mt-2 inline-block rounded-lg bg-sand px-2.5 py-1 font-mono text-xs font-bold text-sus-950">
            Pedido: {dado.protocolo}
          </p>
        )}

        {erro && <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}

        {dado && (
          <div className="mt-4 space-y-3 text-left">
            {dado.posicao && (
              <div className="rounded-2xl bg-sand/70 p-4 text-center">
                <p className="font-display text-4xl font-extrabold text-sus-950">{dado.posicao}º</p>
                <p className="flex items-center justify-center gap-1 text-xs font-semibold text-sus-900/60">
                  <ListOrdered className="h-3.5 w-3.5" />
                  posição na fila{dado.grupo_fila ? ` · ${dado.grupo_fila}` : ""}
                </p>
              </div>
            )}

            <div className="rounded-2xl border border-sus-900/10 p-4 text-sm space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${STATUS_COR[statusNorm] ?? "bg-sand text-sus-900"}`}>
                  {STATUS_ROTULO[statusNorm] || dado.status}
                </span>
                <span className="text-xs text-ink/55">Paciente: {dado.paciente_iniciais}</span>
              </div>

              <p className="font-display text-base font-bold text-sus-950">{dado.exame}</p>

              {dado.itens && dado.itens.length > 1 && (
                <ul className="list-disc pl-4 text-xs text-ink/75 space-y-0.5">
                  {dado.itens.map((it, i) => (
                    <li key={i}>{it}</li>
                  ))}
                </ul>
              )}

              <p className="text-xs text-ink/60">
                {dado.especialidade || dado.grupo_fila || "—"}
                {!isLab && dado.prioridade ? ` · prioridade ${rotuloPrioridade(dado.prioridade).toLowerCase()}` : ""}
              </p>

              <p className="flex items-center gap-1.5 text-xs text-ink/65">
                <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                Pedido em {fmtData(dado.data_pedido)}
              </p>

              {!isCancelado && dado.data_agendada ? (
                <div className="rounded-xl bg-teal/10 border border-teal/25 px-3 py-2 text-xs text-teal-950 space-y-1">
                  <p className="font-bold text-teal flex items-center gap-1.5">
                    <CalendarDays className="h-3.5 w-3.5" />
                    Marcado para {fmtData(dado.data_agendada)}
                    {dado.hora_agendada ? ` às ${dado.hora_agendada}` : ""}
                  </p>
                  {localTexto && (
                    <p className="flex items-center gap-1.5 text-sus-900 font-medium">
                      <MapPin className="h-3.5 w-3.5 text-teal shrink-0" />
                      {localTexto}
                    </p>
                  )}
                </div>
              ) : !isCancelado ? (
                <p className="flex items-center gap-1.5 text-xs font-medium text-amber-800">
                  <Clock className="h-3.5 w-3.5 shrink-0" />
                  Aguardando agendamento — sem data marcada até o momento.
                </p>
              ) : null}

              {!isCancelado && !dado.data_agendada && localTexto && (
                <p className="flex items-center gap-1.5 text-xs text-ink/60">
                  <MapPin className="h-3.5 w-3.5" /> {localTexto}
                </p>
              )}
            </div>

            <div className="flex items-center justify-between text-[11px] text-ink/50 px-1">
              <span>{ultimaAtualizacao ? `Atualizado às ${ultimaAtualizacao}` : ""}</span>
              <button
                type="button"
                onClick={carregar}
                disabled={atualizando}
                className="inline-flex items-center gap-1 font-semibold text-teal hover:underline"
              >
                <RefreshCw className={`h-3 w-3 ${atualizando ? "animate-spin" : ""}`} />
                {atualizando ? "Atualizando…" : "Atualizar status"}
              </button>
            </div>

            <p className="text-center text-[11px] text-ink/45">
              Dúvidas? Procure a UBS ou a Secretaria de Saúde. Leve o comprovante no dia do atendimento.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
