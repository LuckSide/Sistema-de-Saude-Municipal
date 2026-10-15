import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { ACOES, MODULOS, acoesEfetivas, descendentes, type Acao, type NoPermissao } from "../permissoes";
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
      <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
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
    return (
      <label className={cn("flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-sand", recuo && "ml-7")}>
        <input
          type="checkbox"
          checked={marcado}
          onChange={() => alternarTelas([no.codigo], !marcado)}
          className="h-4 w-4 shrink-0 accent-sus-900"
        />
        <no.icone className="h-4 w-4 shrink-0 text-sus-800" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">{no.rotulo}</span>
          {no.rota && <span className="block truncate font-mono text-[11px] text-ink/45">{no.rota}</span>}
        </span>
        <Pills codigos={[no.codigo]} />
      </label>
    );
  }

  return (
    <div className="space-y-2">
      {MODULOS.map((m) => {
        const desc = descendentes(m);
        const n = desc.filter((c) => telas.includes(c)).length;
        const todos = n === desc.length;
        const aberto = abertos[m.codigo] ?? true;
        return (
          <div key={m.codigo} className="rounded-xl border border-sus-900/15">
            <div
              className="flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 hover:bg-sand"
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
                <span className="block text-[11px] text-ink/50">{n}/{desc.length} marcadas · V ver · C criar · E editar · X excluir</span>
              </span>
              <Pills codigos={desc} />
            </div>
            {aberto && (
              <div className="space-y-0.5 px-2 pb-2">
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
      <p className="text-[11px] text-ink/50">
        Marcar o módulo seleciona todas as subtelas. Sem ajuste de ação = acesso total (comportamento atual).
      </p>
    </div>
  );
}
