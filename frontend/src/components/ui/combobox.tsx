import { useEffect, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "./primitives";

export type ComboOption = {
  value: string;
  label: string;
  sub?: string;
  keywords?: string;
};

/**
 * Combobox padrão Shadcn (input + painel filtrável), sem dependência externa.
 * Base HTML referência: .combo + input[role=combobox] + .combo-panel.ativo +
 * .combo-list li + .combo-vazio — sem copiar, só estrutura equivalente.
 * - click/focus abre instantaneamente lista completa;
 * - click outside global fecha;
 * - filtro tempo real case-insensitive nome + código curto;
 * - vazio exibe "Nenhum procedimento encontrado";
 * - clique atualiza input, fecha e aplica filtro via onChange.
 */
export function Combobox({
  value,
  onChange,
  options,
  placeholder = "Selecionar…",
  emptyText = "Nenhum resultado encontrado",
  searchPlaceholder = "Buscar código ou nome…",
  showAll = true,
  allLabel = "Todos",
  className,
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  options: ComboOption[];
  placeholder?: string;
  emptyText?: string;
  searchPlaceholder?: string;
  showAll?: boolean;
  allLabel?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selecionado = options.find((o) => o.value === value);

  // Click outside global fecha painel.
  useEffect(() => {
    if (!open) return;
    function fora(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function esc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [open ]);

  // Quando fecha sem seleção nova, limpa busca p/ exibir rótulo.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open ]);

  const filtradas = useMemo(() => {
    const t = query.trim().toLowerCase();
    if (!t) return options;
    return options.filter((o) =>
      `${o.value} ${o.label} ${o.sub ?? ""} ${o.keywords ?? ""}`.toLowerCase().includes(t)
    );
  }, [query, options]);

  function abrir() {
    setOpen(true);
  }

  function escolher(v: string) {
    onChange(v);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  }

  // Input exibe busca enquanto aberto, senão rótulo selecionado.
  const textoInput = open ? query : selecionado?.label ?? "";

  return (
    <div ref={ref} className={cn("combo relative", className)}>
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
        disabled={disabled}
        value={textoInput}
        placeholder={selecionado ? selecionado.label : placeholder}
        onClick={abrir}
        onFocus={abrir}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (e.key === "Enter" && filtradas.length > 0) {
            e.preventDefault();
            escolher(filtradas[0].value);
          }
        }}
        className={cn(
          "combo-input w-full h-11 rounded-xl border border-sus-900/15 bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition",
          "placeholder:text-ink/60 focus:border-sus-700 focus-visible:ring-2 focus-visible:ring-sus-700/20",
          disabled && "cursor-not-allowed bg-sand/30 opacity-60"
        )}
      />
      {/* Compat: searchPlaceholder como title p/ leitores; filtro é no próprio input. */}
      <span className="sr-only">{searchPlaceholder}</span>

      {open && (
        <div className="combo-panel ativo absolute left-0 top-full z-50 mt-1 w-full overflow-hidden rounded-xl border border-sus-900/15 bg-white shadow-xl">
          <ul className="combo-list max-h-56 overflow-y-auto py-1">
            {showAll && (
              <li>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => escolher("")}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-sand"
                >
                  <span className="font-medium text-sus-900">{allLabel}</span>
                  {!selecionado && <Check className="h-4 w-4 shrink-0 text-teal" />}
                </button>
              </li>
            )}
            {filtradas.map((o) => (
              <li key={o.value}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => escolher(o.value)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-sand"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{o.label}</span>
                    {o.sub && <span className="block truncate text-xs text-ink/50">{o.sub}</span>}
                  </span>
                  {o.value === value && <Check className="h-4 w-4 shrink-0 text-teal" />}
                </button>
              </li>
            ))}
            {filtradas.length === 0 && (
              <li className="combo-vazio px-3 py-6 text-center text-sm text-ink/45">{emptyText}</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
