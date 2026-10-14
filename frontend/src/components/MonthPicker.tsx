import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "./ui/primitives";

const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function mesLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return `${MESES[m - 1]} ${y}`;
}

export default function MonthPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (month: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [anoVisao, setAnoVisao] = useState(() => Number(value.split("-")[0]) || new Date().getFullYear());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setAnoVisao(Number(value.split("-")[0]) || new Date().getFullYear());
  }, [value]);

  useEffect(() => {
    if (!aberto) return;
    function fora(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false);
    }
    function esc(e: KeyboardEvent) {
      if (e.key === "Escape") setAberto(false);
    }
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  function escolher(mes: number) {
    onChange(`${anoVisao}-${String(mes).padStart(2, "0")}`);
    setAberto(false);
  }

  const [anoAtual, mesAtual] = value.split("-").map(Number);
  const navBtn =
    "rounded-lg p-2 text-sus-950 transition hover:bg-sand active:scale-95 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div ref={ref} className="relative">
      <div className="flex items-center justify-between rounded-xl border border-sus-900/15 bg-white px-1.5 py-1.5">
        <button
          type="button"
          onClick={() => onChange(shiftMonth(value, -1))}
          className={navBtn}
          title="Mês anterior"
          aria-label="Mês anterior"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setAberto((a) => !a)}
          className="flex items-center gap-2 rounded-lg px-3 py-1.5 font-display text-sm font-bold text-sus-950 transition hover:bg-sand"
          title="Escolher mês e ano"
          aria-expanded={aberto}
        >
          <CalendarDays className="h-4 w-4 text-teal" />
          {mesLabel(value)}
        </button>
        <button
          type="button"
          onClick={() => onChange(shiftMonth(value, 1))}
          className={navBtn}
          title="Próximo mês"
          aria-label="Próximo mês"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {aberto && (
        <div className="rise absolute left-0 right-0 top-full z-30 mt-2 rounded-2xl border border-sus-900/10 bg-white p-4 shadow-xl">
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setAnoVisao((a) => a - 1)}
              className={navBtn}
              title="Ano anterior"
              aria-label="Ano anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <p className="font-display text-sm font-bold text-sus-950">{anoVisao}</p>
            <button
              type="button"
              onClick={() => setAnoVisao((a) => a + 1)}
              className={navBtn}
              title="Próximo ano"
              aria-label="Próximo ano"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {MESES.map((nome, i) => {
              const ativo = anoVisao === anoAtual && i + 1 === mesAtual;
              return (
                <button
                  key={nome}
                  type="button"
                  onClick={() => escolher(i + 1)}
                  className={cn(
                    "rounded-xl px-2 py-2 font-body text-xs font-semibold transition active:scale-95",
                    ativo
                      ? "bg-sus-900 text-white shadow-card"
                      : "bg-white text-sus-950 hover:bg-sand"
                  )}
                >
                  {nome.slice(0, 3)}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => {
              const hoje = new Date().toISOString().slice(0, 7);
              onChange(hoje);
              setAberto(false);
            }}
            className="mt-3 w-full rounded-xl border border-sus-900/10 bg-white px-3 py-2 font-body text-xs font-bold text-sus-950 transition hover:bg-sand active:scale-[.99]"
          >
            Voltar ao mês atual
          </button>
        </div>
      )}
    </div>
  );
}
