export default function Paginacao({
  page,
  pages,
  total,
  onPage,
}: {
  page: number;
  pages: number;
  total: number;
  onPage: (p: number) => void;
}) {
  if (total <= 100 || pages <= 1) return null;
  const nums: number[] = [];
  const ini = Math.max(1, Math.min(page - 2, pages - 4));
  for (let i = ini; i <= Math.min(pages, ini + 4); i++) nums.push(i);
  const btn =
    "min-w-9 rounded-lg px-2.5 py-1.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t border-sus-900/10 bg-white px-4 py-3 print:hidden">
      <span className="mr-auto text-xs text-ink/55">
        {total} registro(s) · página {page} de {pages}
      </span>
      <button
        className={`${btn} bg-sus-900/10 text-sus-900 hover:bg-sus-900/15`}
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        Anterior
      </button>
      {nums.map((n) => (
        <button
          key={n}
          onClick={() => onPage(n)}
          className={`${btn} ${n === page ? "bg-sus-900 text-white" : "bg-sus-900/10 text-sus-900 hover:bg-sus-900/15"}`}
        >
          {n}
        </button>
      ))}
      <button
        className={`${btn} bg-sus-900/10 text-sus-900 hover:bg-sus-900/15`}
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      >
        Próxima
      </button>
    </div>
  );
}
