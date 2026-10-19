import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Ambulance,
  ClipboardList,
  ReceiptText,
  Users,
} from "lucide-react";
import { tfdResumo, type ResumoTfd } from "../../services/api";
import { Card } from "../../components/ui/primitives";

function brl(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function TfdResumo() {
  const [res, setRes] = useState<ResumoTfd | null>(null);
  const [comp, setComp] = useState(() => new Date().toISOString().slice(0, 7));

  useEffect(() => {
    tfdResumo(comp).then(setRes).catch(() => setRes(null));
  }, [comp]);

  const cards = [
    { label: "Viagens no mês", valor: res?.viagens_mes ?? "—", icon: Ambulance, to: "/tfd/viagens" },
    { label: "Passageiros", valor: res?.passageiros_mes ?? "—", icon: Users, to: "/tfd/viagens" },
    { label: "Procedimentos aguardando", valor: res?.exames_aguardando ?? "—", icon: ClipboardList, to: "/fila-exames" },
    { label: "Valor competência", valor: res ? brl(res.valor_competencia) : "—", icon: ReceiptText, to: "/tfd/faturamento" },
  ];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="text-sm font-semibold text-sus-900">Competência</label>
        <input
          type="month"
          value={comp}
          onChange={(e) => setComp(e.target.value)}
          className="rounded-xl border border-sus-900/15 bg-white px-3 py-2 text-sm outline-none focus:border-sus-700"
        />
        {res && (
          <span className="text-xs text-ink/55">
            {res.exames_urgentes} urgentes · ocupação {res.ocupacao_media}%
          </span>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c, i) => (
          <Link key={c.label} to={c.to}>
            <Card className={`rise rise-${i + 1} p-5 transition hover:-translate-y-0.5`}>
              <div className="mb-3 grid h-10 w-10 place-items-center rounded-xl bg-sus-900 text-white">
                <c.icon className="h-5 w-5" />
              </div>
              <p className="font-display text-2xl font-extrabold text-sus-950">{c.valor}</p>
              <p className="mt-0.5 text-sm text-ink/55">{c.label}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
