import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, Undo2, X } from "lucide-react";

export const UNDO_MS = 5000;

/** TESTE: true = toast não some sozinho (só sai no Desfazer/X).
 *  Produção: false = auto-dismiss em 5s (UNDO_MS). */
const STICKY_TESTE = false;

type UndoPendente = {
  id: number;
  titulo: string;
  descricao?: string;
  onUndo: () => Promise<void> | void;
};

type Aviso = { id: number; texto: string };

type UndoCtx = {
  notificarUndo: (a: Omit<UndoPendente, "id">) => void;
};

const Ctx = createContext<UndoCtx | null>(null);

export function useUndo(): UndoCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useUndo fora do UndoToastProvider");
  return ctx;
}

/** Toasts globais de desfazer (canto inferior direito, 5s p/ reverter). */
export function UndoToastProvider({ children }: { children: ReactNode }) {
  const [pendentes, setPendentes] = useState<UndoPendente[]>([]);
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const seq = useRef(1);

  const remover = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
    setPendentes((l) => l.filter((x) => x.id !== id));
  }, []);

  const notificarUndo = useCallback(
    (a: Omit<UndoPendente, "id">) => {
      const id = seq.current++;
      setPendentes((l) => [...l.slice(-2), { ...a, id }]);
      if (!STICKY_TESTE) {
        timers.current.set(
          id,
          setTimeout(() => remover(id), UNDO_MS),
        );
      }
    },
    [remover],
  );

  async function desfazer(p: UndoPendente) {
    const t = timers.current.get(p.id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(p.id);
    }
    setPendentes((l) => l.filter((x) => x.id !== p.id));
    try {
      await p.onUndo();
      const id = seq.current++;
      setAvisos((l) => [...l, { id, texto: "Ação desfeita com sucesso!" }]);
      setTimeout(() => setAvisos((l) => l.filter((x) => x.id !== id)), 3000);
    } catch {
      const id = seq.current++;
      setAvisos((l) => [...l, { id, texto: "Não foi possível desfazer." }]);
      setTimeout(() => setAvisos((l) => l.filter((x) => x.id !== id)), 3000);
    }
  }

  const value = useMemo(() => ({ notificarUndo }), [notificarUndo]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-[min(92vw,380px)] flex-col gap-2 print:hidden" aria-live="polite">
        {pendentes.map((p) => (
          <div key={p.id} className="pointer-events-auto overflow-hidden rounded-2xl bg-sus-950 text-white shadow-card">
            <div className="flex items-start gap-2 p-4 pb-3">
              <Undo2 className="mt-0.5 h-5 w-5 shrink-0 text-teal" />
              <div className="min-w-0 flex-1">
                <p className="font-display text-sm font-bold">{p.titulo}</p>
                {p.descricao && <p className="mt-0.5 text-xs text-white/65">{p.descricao}</p>}
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => desfazer(p)}
                    className="rounded-xl bg-teal px-3 py-1.5 text-xs font-bold text-sus-950 hover:brightness-110"
                  >
                    Desfazer
                  </button>
                  <button
                    onClick={() => remover(p.id)}
                    className="rounded-xl bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/15"
                    aria-label="Dispensar"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
            <div className="h-1 bg-white/10">
              <div
                key={`bar-${p.id}`}
                className="h-full bg-teal undo-bar"
                style={STICKY_TESTE ? { animation: "none", width: "100%" } : undefined}
              />
            </div>
          </div>
        ))}
        {avisos.map((a) => (
          <div key={a.id} className="pointer-events-auto flex items-center gap-2 rounded-2xl bg-teal px-4 py-3 text-sm font-bold text-sus-950 shadow-card">
            <CheckCircle2 className="h-4 w-4" /> {a.texto}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
