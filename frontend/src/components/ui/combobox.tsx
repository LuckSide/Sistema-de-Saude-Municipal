import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
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
 * - navegação por teclado (ArrowUp, ArrowDown, Enter, Escape);
 * - filtro tempo real case-insensitive nome + código curto;
 * - vazio exibe "Nenhum resultado encontrado";
 * - clique/Enter atualiza input, fecha e aplica filtro via onChange.
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
  const [cursorIndex, setCursorIndex] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

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
  }, [open]);

  // Quando fecha sem seleção nova, limpa busca p/ exibir rótulo e reseta cursor.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setCursorIndex(-1);
    }
  }, [open]);

  const filtradas = useMemo(() => {
    const t = query.trim().toLowerCase();
    if (!t) return options;
    return options.filter((o) =>
      `${o.value} ${o.label} ${o.sub ?? ""} ${o.keywords ?? ""}`.toLowerCase().includes(t)
    );
  }, [query, options]);

  // Lista total de itens navegáveis (inclui "Todos" quando showAll=true)
  const totalItens = (showAll ? 1 : 0) + filtradas.length;

  function abrir() {
    setOpen(true);
    setCursorIndex(-1);
  }

  function escolher(v: string) {
    onChange(v);
    setQuery("");
    setOpen(false);
    setCursorIndex(-1);
    inputRef.current?.blur();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }

    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter")) {
      e.preventDefault();
      setOpen(true);
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursorIndex((prev) => (prev + 1 < totalItens ? prev + 1 : 0));
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursorIndex((prev) => (prev - 1 >= 0 ? prev - 1 : totalItens - 1));
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      if (cursorIndex >= 0) {
        if (showAll && cursorIndex === 0) {
          escolher("");
        } else {
          const idx = showAll ? cursorIndex - 1 : cursorIndex;
          if (filtradas[idx]) {
            escolher(filtradas[idx].value);
          }
        }
      } else if (filtradas.length > 0) {
        escolher(filtradas[0].value);
      }
    }
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
          setCursorIndex(-1);
        }}
        onKeyDown={handleKeyDown}
        className={cn(
          "combo-input w-full h-11 rounded-xl border border-sus-900/15 bg-white pl-3.5 pr-10 py-2.5 text-sm text-ink outline-none transition cursor-pointer",
          "placeholder:text-ink/60 focus:border-sus-700 focus-visible:ring-2 focus-visible:ring-sus-700/20",
          disabled && "cursor-not-allowed bg-sand/30 opacity-60"
        )}
      />
      <ChevronDown
        className={cn(
          "pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-sus-900/60 transition-transform duration-200",
          open && "rotate-180"
        )}
      />
      {/* Compat: searchPlaceholder como title p/ leitores; filtro é no próprio input. */}
      <span className="sr-only">{searchPlaceholder}</span>

      {open && (
        <div className="combo-panel ativo absolute left-0 top-full z-50 mt-1 w-full overflow-hidden rounded-xl border border-sus-900/15 bg-white shadow-xl">
          <ul ref={listRef} className="combo-list max-h-56 overflow-y-auto py-1">
            {showAll && (
              <li>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => escolher("")}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition",
                    cursorIndex === 0 ? "bg-sand font-semibold" : "hover:bg-sand"
                  )}
                >
                  <span className="font-medium text-sus-900">{allLabel}</span>
                  {!selecionado && <Check className="h-4 w-4 shrink-0 text-teal" />}
                </button>
              </li>
            )}
            {filtradas.map((o, idx) => {
              const itemIndex = showAll ? idx + 1 : idx;
              const isHighlight = cursorIndex === itemIndex;
              return (
                <li key={o.value}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => escolher(o.value)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition",
                      isHighlight ? "bg-sand font-semibold" : "hover:bg-sand"
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{o.label}</span>
                      {o.sub && <span className="block truncate text-xs text-ink/50">{o.sub}</span>}
                    </span>
                    {o.value === value && <Check className="h-4 w-4 shrink-0 text-teal" />}
                  </button>
                </li>
              );
            })}
            {filtradas.length === 0 && (
              <li className="combo-vazio px-3 py-6 text-center text-sm text-ink/45">{emptyText}</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
