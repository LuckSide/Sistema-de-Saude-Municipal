import { useState } from "react";
import { CheckSquare, ChevronDown, Search, Square, X } from "lucide-react";
import {
  ACOES,
  EXCLUSIVAS,
  MODULOS,
  acoesEfetivas,
  descendentes,
  todosCodigos,
  type Acao,
  type NoPermissao,
} from "../permissoes";
import { cn } from "./ui/primitives";

const TODAS: Acao[] = ["ver", "criar", "editar", "excluir"];

function semDesvio(acoes: Record<string, Acao[]>, codigo: string): Record<string, Acao[]> {
  if (!(codigo in acoes)) return acoes;
  const c = { ...acoes };
  delete c[codigo];
  return c;
}

export default function PermissoesTree({
  telas,
  acoes,
  onChange,
}: {
  telas: string[];
  acoes: Record<string, Acao[]>;
  onChange: (telas: string[], acoes: Record<string, Acao[]>) => void;
}) {
  const [abertos, setAbertos] = useState<Record<string, boolean>>(
    Object.fromEntries(MODULOS.map((m) => [m.codigo, true]))
  );
  const [filtro, setFiltro] = useState("");

  function alternarTelas(codigos: string[], ligar: boolean) {
    const set = new Set(telas);
    for (const c of codigos) {
      if (ligar) set.add(c);
      else set.delete(c);
    }
    let novasAcoes = { ...acoes };
    if (!ligar) for (const c of codigos) novasAcoes = semDesvio(novasAcoes, c);
    onChange([...set], novasAcoes);
  }

  function definirAcao(codigos: string[], acao: Acao, ligar: boolean) {
    const novas = { ...acoes };
    for (const c of codigos) {
      const atual = new Set(acoesEfetivas(acoes, c));
      if (ligar) atual.add(acao);
      else atual.delete(acao);
      const lista = TODAS.filter((a) => atual.has(a));
      if (lista.length === TODAS.length) delete novas[c];
      else novas[c] = lista;
    }
    onChange(telas, novas);
  }

  function Pills({ codigos }: { codigos: string[] }) {
    return (
      <span className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
        {ACOES.map((a) => {
          const efetivas = codigos.map((c) => new Set(acoesEfetivas(acoes, c)));
          const todos = efetivas.every((s) => s.has(a.id));
          const algum = efetivas.some((s) => s.has(a.id));
          return (
            <button
              key={a.id}
              type="button"
              title={`${todos ? "Remover" : "Permitir"}: ${a.rotulo}`}
              onClick={() => definirAcao(codigos, a.id, !todos)}
              className={cn(
                "rounded-md px-1.5 py-0.5 font-mono text-[11px] font-bold transition",
                todos
                  ? "bg-teal text-white"
                  : algum
                    ? "bg-amber-200 text-amber-900"
                    : "bg-sus-900/10 text-sus-900/50 hover:bg-sus-900/20"
              )}
            >
              {a.rotulo[0]}
            </button>
          );
        })}
      </span>
    );
  }

  function LinhaNo({ no, recuo }: { no: NoPermissao; recuo: boolean }) {
    const marcado = telas.includes(no.codigo);
    const exclusiva = EXCLUSIVAS.has(no.codigo);
    return (
      <label
        className={cn(
          "flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 transition hover:bg-sand",
          recuo && "ml-6",
          marcado && "bg-teal/5"
        )}
      >
        <input
          type="checkbox"
          checked={marcado}
          onChange={() => alternarTelas([no.codigo], !marcado)}
          className="h-4 w-4 shrink-0 accent-sus-900"
        />
        <no.icone className={cn("h-4 w-4 shrink-0", marcado ? "text-teal" : "text-sus-800/70")} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium text-ink">{no.rotulo}</span>
            {exclusiva && (
              <span
                title="Permissão exclusiva: não é herdada ao marcar apenas o módulo pai"
                className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800"
              >
                Exclusiva
              </span>
            )}
          </span>
          {no.rota && (
            <span className="block truncate font-mono text-[11px] text-ink/45">
              {no.rota} · <span className="text-ink/35">{no.codigo}</span>
            </span>
          )}
        </span>
        <Pills codigos={[no.codigo]} />
      </label>
    );
  }

  const termo = filtro.trim().toLowerCase();
  const modulosFiltrados = MODULOS.map((m) => {
    if (!termo) return m;
    const batePai =
      m.rotulo.toLowerCase().includes(termo) ||
      m.codigo.toLowerCase().includes(termo) ||
      (m.rota || "").toLowerCase().includes(termo);
    const filhosBatendo = (m.filhos ?? []).filter(
      (f) =>
        f.rotulo.toLowerCase().includes(termo) ||
        f.codigo.toLowerCase().includes(termo) ||
        (f.rota || "").toLowerCase().includes(termo)
    );
    if (batePai) return m;
    if (filhosBatendo.length > 0) return { ...m, filhos: filhosBatendo };
    return null;
  }).filter((m): m is NoPermissao => m !== null);

  const todosMarcados = todosCodigos();

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-sus-900/10 bg-sand/50 p-2">
        <div className="relative min-w-[190px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink/45" />
          <input
            type="text"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="Filtrar tela, módulo ou rota…"
            className="h-8 w-full rounded-lg border border-sus-900/15 bg-white pl-8 pr-7 text-xs text-ink outline-none focus:border-sus-700"
          />
          {filtro && (
            <button
              type="button"
              onClick={() => setFiltro("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-ink/45 hover:text-ink"
              aria-label="Limpar filtro"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => onChange(todosMarcados, {})}
            className="inline-flex items-center gap-1 rounded-lg border border-sus-900/15 bg-white px-2 py-1 text-[11px] font-semibold text-sus-900 hover:bg-sus-50"
          >
            <CheckSquare className="h-3 w-3 text-teal" /> Todas
          </button>
          <button
            type="button"
            onClick={() => onChange(["dashboard"], {})}
            className="inline-flex items-center gap-1 rounded-lg border border-sus-900/15 bg-white px-2 py-1 text-[11px] font-semibold text-ink/75 hover:bg-sand"
          >
            <Square className="h-3 w-3" /> Mínimo
          </button>
          <button
            type="button"
            onClick={() => setAbertos(Object.fromEntries(MODULOS.map((m) => [m.codigo, true])))}
            className="rounded-lg border border-sus-900/15 bg-white px-2 py-1 text-[11px] font-semibold text-ink/75 hover:bg-sand"
          >
            Expandir
          </button>
          <button
            type="button"
            onClick={() => setAbertos(Object.fromEntries(MODULOS.map((m) => [m.codigo, false])))}
            className="rounded-lg border border-sus-900/15 bg-white px-2 py-1 text-[11px] font-semibold text-ink/75 hover:bg-sand"
          >
            Recolher
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {modulosFiltrados.map((m) => {
          const desc = descendentes(m);
          const n = desc.filter((c) => telas.includes(c)).length;
          const todos = n === desc.length;
          const aberto = termo ? true : (abertos[m.codigo] ?? true);
          return (
            <div key={m.codigo} className="overflow-hidden rounded-xl border border-sus-900/15 bg-white">
              <div
                className="flex cursor-pointer items-center gap-2.5 bg-sand/30 px-3 py-2 hover:bg-sand/70"
                onClick={() => setAbertos((a) => ({ ...a, [m.codigo]: !aberto }))}
              >
                <ChevronDown className={cn("h-4 w-4 shrink-0 text-ink/50 transition", !aberto && "-rotate-90")} />
                <input
                  ref={(el) => {
                    if (el) el.indeterminate = !todos && n > 0;
                  }}
                  type="checkbox"
                  checked={todos}
                  onChange={() => alternarTelas(desc, !todos)}
                  onClick={(e) => e.stopPropagation()}
                  className="h-4 w-4 shrink-0 accent-sus-900"
                  aria-label={m.rotulo}
                />
                <m.icone className="h-[18px] w-[18px] shrink-0 text-sus-900" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-sm font-bold text-sus-950">{m.rotulo}</span>
                  <span className="block text-[11px] text-ink/50">
                    {n}/{desc.length} marcadas · V ver · C criar · E editar · X excluir
                  </span>
                </span>
                <Pills codigos={desc} />
              </div>
              {aberto && (
                <div className="space-y-0.5 px-2 py-1.5">
                  {(m.filhos ?? []).map((f) => (
                    <LinhaNo key={f.codigo} no={f} recuo />
                  ))}
                  {!(m.filhos ?? []).length && (
                    <p className="px-9 py-1 text-xs text-ink/45">Módulo sem subtelas — a marcação acima libera tudo.</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {modulosFiltrados.length === 0 && (
          <p className="rounded-xl border border-dashed border-sus-900/15 py-6 text-center text-xs text-ink/50">
            Nenhuma tela ou rota encontrada para "{filtro}".
          </p>
        )}
      </div>

      <p className="text-[11px] text-ink/50">
        Marcar o módulo libera as subtelas padrão (exceto telas marcadas como <b>Exclusiva</b>, que exigem seleção individual). Sem ajuste de ação = acesso total na tela.
      </p>
    </div>
  );
}
