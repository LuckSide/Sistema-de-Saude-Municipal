import { useMemo } from "react";
import { OPCOES_PADRAO, calcularOpcoesPageSize } from "../utils/paginacaoUtils";

export { OPCOES_PADRAO, calcularOpcoesPageSize };

export interface PaginacaoProps {
  page: number;
  pages: number;
  total: number;
  onPage: (p: number) => void;
  pageSize?: number;
  onPageSize?: (size: number) => void;
  opcoesPageSize?: (number | "Todos")[];
}

export default function Paginacao({
  page,
  pages,
  total,
  onPage,
  pageSize = 100,
  onPageSize,
  opcoesPageSize = OPCOES_PADRAO,
}: PaginacaoProps) {
  if (total <= 0) return null;

  const opcoesFiltradas = useMemo(
    () => calcularOpcoesPageSize(opcoesPageSize, total),
    [opcoesPageSize, total]
  );

  const totalPages = Math.max(1, pages);
  const isTodos =
    pageSize >= 5000 ||
    (total > 0 && pageSize >= total && !opcoesFiltradas.includes(pageSize as any));

  // Gera números de página com navegação inteligente
  const nums: number[] = [];
  const ini = Math.max(1, Math.min(page - 2, totalPages - 4));
  for (let i = ini; i <= Math.min(totalPages, ini + 4); i++) {
    nums.push(i);
  }

  const btn =
    "min-w-8 h-8 rounded-lg px-2.5 text-xs font-semibold transition flex items-center justify-center disabled:cursor-not-allowed disabled:opacity-35";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-sus-900/10 bg-white px-4 py-3 print:hidden">
      {/* Contagem de registros e indicador de página */}
      <div className="flex items-center gap-2 text-xs text-ink/65">
        <span className="font-semibold text-sus-950">{total}</span>
        <span>{total === 1 ? "registro encontrado" : "registros encontrados"}</span>
        <span className="text-ink/30">·</span>
        <span>
          Página <strong className="text-sus-950">{page}</strong> de{" "}
          <strong className="text-sus-950">{totalPages}</strong>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {/* Seletor flexível de Linhas por Página (só aparece quando há opções menores que o total) */}
        {onPageSize && opcoesFiltradas.length > 0 && (
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-ink/55 text-[11px] font-medium hidden sm:inline">Exibir:</span>
            <div className="inline-flex rounded-lg border border-sus-900/15 bg-sand/40 p-0.5 shadow-2xs">
              {opcoesFiltradas.map((op) => {
                const ativo =
                  op === "Todos"
                    ? isTodos
                    : !isTodos && pageSize === op;

                return (
                  <button
                    key={String(op)}
                    type="button"
                    onClick={() => {
                      if (op === "Todos") {
                        onPageSize(99999);
                      } else {
                        onPageSize(op);
                      }
                      onPage(1);
                    }}
                    className={`rounded-md px-2 py-1 text-xs font-semibold transition ${
                      ativo
                        ? "bg-sus-900 text-white shadow-2xs"
                        : "text-ink/65 hover:bg-white hover:text-sus-950"
                    }`}
                    title={op === "Todos" ? "Exibir todos os registros de uma vez" : `Exibir ${op} registros por página`}
                  >
                    {op}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Botões de navegação por páginas (se houver mais de 1 página) */}
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button
              className={`${btn} bg-sus-900/10 text-sus-900 hover:bg-sus-900/15`}
              disabled={page <= 1}
              onClick={() => onPage(page - 1)}
              title="Página anterior"
            >
              Anterior
            </button>

            {ini > 1 && (
              <>
                <button
                  onClick={() => onPage(1)}
                  className={`${btn} bg-sus-900/10 text-sus-900 hover:bg-sus-900/15`}
                >
                  1
                </button>
                {ini > 2 && <span className="px-1 text-xs text-ink/40">…</span>}
              </>
            )}

            {nums.map((n) => (
              <button
                key={n}
                onClick={() => onPage(n)}
                className={`${btn} ${
                  n === page
                    ? "bg-sus-900 text-white shadow-2xs"
                    : "bg-sus-900/10 text-sus-900 hover:bg-sus-900/15"
                }`}
              >
                {n}
              </button>
            ))}

            {nums[nums.length - 1] < totalPages && (
              <>
                {nums[nums.length - 1] < totalPages - 1 && (
                  <span className="px-1 text-xs text-ink/40">…</span>
                )}
                <button
                  onClick={() => onPage(totalPages)}
                  className={`${btn} bg-sus-900/10 text-sus-900 hover:bg-sus-900/15`}
                >
                  {totalPages}
                </button>
              </>
            )}

            <button
              className={`${btn} bg-sus-900/10 text-sus-900 hover:bg-sus-900/15`}
              disabled={page >= totalPages}
              onClick={() => onPage(page + 1)}
              title="Próxima página"
            >
              Próxima
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
