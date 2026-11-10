import { useMemo } from "react";
import { X } from "lucide-react";
import { Badge, Card } from "./ui/primitives";
import type { PecIndicadorDetalhe, PecSerie } from "../services/pec";

function Linha({ serie, meta }: { serie: PecSerie[]; meta: number }) {
  const pts = useMemo(() => {
    const W = 560, H = 180, P = 28;
    const max = Math.max(100, meta, ...serie.map((s) => s.perc));
    const x = (i: number) => (serie.length <= 1 ? W / 2 : P + (i * (W - 2 * P)) / (serie.length - 1));
    const y = (v: number) => H - P - (v / max) * (H - 2 * P);
    const linha = serie.map((s, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(s.perc).toFixed(1)}`).join(" ");
    return { W, H, P, x, y, linha };
  }, [serie, meta]);
  if (!serie.length) return <p className="text-sm text-ink/50">Sem série histórica.</p>;
  return (
    <svg viewBox={`0 0 ${pts.W} ${pts.H}`} className="w-full" role="img" aria-label="Evolução do indicador">
      {[0, 25, 50, 75, 100].map((g) => (
        <g key={g}>
          <line x1={pts.P} x2={pts.W - pts.P} y1={pts.y(g)} y2={pts.y(g)} stroke="#0a3d62" strokeOpacity="0.12" />
          <text x={4} y={pts.y(g) + 4} fontSize="10" fill="#0a3d62" opacity="0.55">{g}%</text>
        </g>
      ))}
      <line x1={pts.P} x2={pts.W - pts.P} y1={pts.y(meta)} y2={pts.y(meta)} stroke="#d97706" strokeDasharray="6 4" strokeWidth="1.5" />
      <text x={pts.W - pts.P - 52} y={pts.y(meta) - 6} fontSize="10" fontWeight="700" fill="#d97706">meta {meta}%</text>
      <path d={pts.linha} fill="none" stroke="#0e7c6b" strokeWidth="2.5" strokeLinecap="round" />
      {serie.map((s, i) => (
        <g key={s.periodo}>
          <circle cx={pts.x(i)} cy={pts.y(s.perc)} r="4.5" fill="#0e7c6b" stroke="#fff" strokeWidth="2" />
          <text x={pts.x(i)} y={pts.H - 8} fontSize="10" textAnchor="middle" fill="#0a3d62">{s.periodo}</text>
          <text x={pts.x(i)} y={pts.y(s.perc) - 10} fontSize="11" fontWeight="700" textAnchor="middle" fill="#0a3d62">{s.perc}%</text>
        </g>
      ))}
    </svg>
  );
}

export default function IndicadorDetalhe({
  detalhe,
  onClose,
}: {
  detalhe: PecIndicadorDetalhe;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4" onClick={onClose}>
      <div className="rise max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl bg-white p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <p className="font-display text-base font-bold text-sus-950">{detalhe.indicador} · {detalhe.nome}</p>
            <p className="text-xs text-ink/55">Bloco {detalhe.bloco} · meta {detalhe.meta}% · atual <b>{detalhe.perc_atual}%</b></p>
          </div>
          <div className="flex items-center gap-2">
            <Badge>{detalhe.status}</Badge>
            <button onClick={onClose} className="rounded-lg p-2 text-ink/50 hover:bg-sand" aria-label="Fechar">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <Card className="p-4">
          <p className="mb-2 font-display text-sm font-bold text-sus-950">Evolução histórica</p>
          <Linha serie={detalhe.serie} meta={detalhe.meta} />
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            {detalhe.serie.map((s) => (
              <div key={s.periodo} className="rounded-xl bg-sand/60 px-2 py-1.5 text-center">
                <p className="font-bold">{s.periodo}</p>
                <p>{s.num}/{s.den} · {s.perc}%</p>
              </div>
            ))}
          </div>
        </Card>
        <Card className="mt-3 border-teal/30 p-4">
          <p className="font-display text-sm font-bold text-sus-950">Passos para melhorar o indicador</p>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-ink/75">
            {detalhe.acoes.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
          <p className="mt-2 text-xs text-ink/50">Base: diretrizes MS p/ novo cofinanciamento APS.</p>
        </Card>
      </div>
    </div>
  );
}
