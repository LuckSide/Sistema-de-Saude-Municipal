import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CalendarDays, Cross, ListOrdered, MapPin } from "lucide-react";
import { tfdConsultarExamePublico, type ExamePublico } from "../services/api";
import { Card } from "../components/ui/primitives";
import { rotuloPrioridade } from "../utils/rotulos";

export default function AcompanharExame() {
  const { token } = useParams<{ token: string }>();
  const [dado, setDado] = useState<ExamePublico | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    if (!token || !/^[A-Za-z0-9-_]{10,128}$/.test(token)) {
      setErro("Link inválido.");
      return;
    }
    tfdConsultarExamePublico(token).then(setDado).catch(() => setErro("Pedido não encontrado. Confira o link/QR Code."));
  }, [token]);

  const statusCor: Record<string, string> = {
    aguardando: "bg-amber-100 text-amber-800",
    agendado: "bg-teal/15 text-teal",
    realizado: "bg-sus-900/10 text-sus-900",
    cancelado: "bg-sus-900/10 text-ink/50",
  };

  return (
    <div className="grid min-h-screen place-items-center bg-sand p-4 font-body">
      <Card className="w-full max-w-md p-6 text-center">
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-teal font-display text-xl font-extrabold text-sus-950">
          <Cross className="h-6 w-6" strokeWidth={2.5} />
        </div>
        <p className="font-display text-lg font-bold text-sus-950">Acompanhar pedido</p>
        <p className="text-xs text-ink/55">Saúde Guapé · consulta sem login</p>
        {erro && <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
        {dado && (
          <div className="mt-4 space-y-3 text-left">
            <div className="rounded-2xl bg-sand/70 p-4 text-center">
              <p className="font-display text-4xl font-extrabold text-sus-950">
                {dado.posicao ? `${dado.posicao}º` : "—"}
              </p>
              <p className="flex items-center justify-center gap-1 text-xs font-semibold text-sus-900/60">
                <ListOrdered className="h-3.5 w-3.5" />
                {dado.posicao ? `posição na fila${dado.grupo_fila ? ` ${dado.grupo_fila}` : ""}` : "fora da fila ativa"}
              </p>
            </div>
            <div className="rounded-2xl border border-sus-900/10 p-4 text-sm">
              <p className="flex items-center justify-between gap-2">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${statusCor[dado.status] ?? "bg-sand"}`}>{dado.status}</span>
                <span className="text-xs text-ink/55">paciente {dado.paciente_iniciais}</span>
              </p>
              <p className="mt-2 font-display text-base font-bold text-sus-950">{dado.exame}</p>
              <p className="text-xs text-ink/55">{dado.especialidade || "—"} · prioridade {rotuloPrioridade(dado.prioridade).toLowerCase()}</p>
              <p className="mt-2 flex items-center gap-1.5 text-xs text-ink/60">
                <CalendarDays className="h-3.5 w-3.5" />
                pedido {dado.data_pedido ? dado.data_pedido.slice(0, 10).split("-").reverse().join("/") : "—"}
                {dado.data_agendada ? ` · marcado ${dado.data_agendada.slice(0, 10).split("-").reverse().join("/")}` : ""}
              </p>
              {dado.data_agendada && (
                <p className="mt-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-teal/20 px-3 py-1 text-xs font-bold text-teal ring-1 ring-teal/30">
                    <CalendarDays className="h-3.5 w-3.5" /> Procedimento marcado para {dado.data_agendada.slice(0, 10).split("-").reverse().join("/")}
                  </span>
                </p>
              )}
              {dado.destino && (
                <p className="mt-1 flex items-center gap-1.5 text-xs text-ink/60">
                  <MapPin className="h-3.5 w-3.5" /> {dado.destino}
                </p>
              )}
            </div>
            <p className="text-center text-[11px] text-ink/45">
              Dúvidas? Procure a UBS ou a Secretaria de Saúde. Leve este comprovante no dia do exame.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
