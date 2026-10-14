import { cn } from "./ui/primitives";

export type DiaInfo = { total: number; livres: number };

const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function hojeISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Grade mensal alinhada Dom–Sáb, cores sóbrias do design system (sem vermelho). */
export default function GradeDias({
  month,
  mapa,
  diaSel,
  bloqueado,
  permitirSemVaga,
  onSelect,
}: {
  month: string;
  mapa: Map<string, DiaInfo>;
  diaSel: string;
  bloqueado?: boolean;
  permitirSemVaga?: boolean;
  onSelect: (d: string) => void;
}) {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return <p className="py-6 text-center text-sm text-ink/45">Informe um mês válido.</p>;
  const hoje = hojeISO();
  const deslocamento = new Date(y, m - 1, 1).getDay(); // 0 = domingo
  const n = new Date(y, m, 0).getDate();
  const cells: (string | null)[] = [
    ...Array<string | null>(deslocamento).fill(null),
    ...Array.from({ length: n }, (_, i) => {
      const d = String(i + 1).padStart(2, "0");
      return `${y}-${String(m).padStart(2, "0")}-${d}`;
    }),
  ];

  return (
    <div>
      <div className="mb-1.5 grid grid-cols-7 gap-1.5">
        {SEMANA.map((s) => (
          <p key={s} className="py-1 text-center font-display text-[11px] font-bold uppercase tracking-wide text-sus-900/60">
            {s}
          </p>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((d, i) => {
          if (!d) return <span key={`vazio-${i}`} />;
          const g = mapa.get(d);
          const total = g?.total ?? 0;
          const livres = g?.livres ?? 0;
          const ocup = Math.max(0, total - livres);
          const ativa = diaSel === d;
          const ehHoje = d === hoje;
          const passado = d < hoje;
          const semVaga = total === 0 || passado;
          const desab = bloqueado || (semVaga && !permitirSemVaga) || passado;
          const cheio = total > 0 && livres <= 0;
          return (
            <button
              key={d}
              type="button"
              disabled={desab}
              onClick={() => onSelect(d)}
              title={passado ? "Dia passado indisponível" : semVaga ? "Sem vagas cadastradas" : `Total ${total} · ${ocup} ocupadas · ${livres} livres`}
              className={cn(
                "min-h-[64px] rounded-xl border bg-white p-1.5 text-left font-body transition active:scale-[.98]",
                "disabled:cursor-not-allowed disabled:opacity-60",
                ativa
                  ? "border-sus-900 bg-sus-900 text-white shadow-card"
                  : "text-sus-950 hover:border-teal/50",
                !ativa && ehHoje && "ring-2 ring-teal ring-offset-1",
                !ativa && semVaga && "border-sus-900/10",
                !ativa && passado && "bg-sand/60",
                !ativa && !semVaga && !cheio && "border-teal/30 bg-teal/10",
                !ativa && cheio && "border-sus-900/20 bg-sand"
              )}
            >
              <span className="flex items-center justify-between">
                <span className={cn("font-display text-xs font-bold", ativa ? "text-white" : "text-sus-950")}>
                  {d.slice(8)}
                </span>
                {!ativa && ehHoje && (
                  <span className="rounded-full bg-teal px-1.5 py-px text-[9px] font-bold uppercase text-white">
                    hoje
                  </span>
                )}
              </span>
              {semVaga ? (
                <span className={cn("mt-1 block text-[10px] font-medium", ativa ? "text-white/80" : "text-sus-950/40")}>
                  {passado ? "passado" : permitirSemVaga && !bloqueado ? "+ abrir vagas" : "sem vaga"}
                </span>
              ) : (
                <span className="mt-1 block">
                  <span className={cn("block text-[10px] font-bold", ativa ? "text-white" : "text-sus-950")}>
                    {livres} livres
                  </span>
                  <span className={cn("block text-[10px]", ativa ? "text-white/75" : "text-sus-950/55")}>
                    {total} total · {ocup} ocup
                  </span>
                  <span className={cn("mt-1 block h-1 overflow-hidden rounded-full", ativa ? "bg-white/25" : "bg-sus-900/10")}>
                    <span
                      className={cn("block h-full rounded-full", ativa ? "bg-white" : "bg-teal")}
                      style={{ width: `${total ? Math.min(100, Math.round((ocup / total) * 100)) : 0}%` }}
                    />
                  </span>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
