import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AlertCircle, AlertTriangle, HelpCircle, X } from "lucide-react";
import { Button } from "./ui/primitives";

export type ConfirmOptions = {
  titulo: string;
  descricao?: ReactNode;
  textoConfirmar?: string;
  textoCancelar?: string;
  variante?: "danger" | "warning" | "primary";
};

type ConfirmContextType = {
  confirmar: (opcoes: ConfirmOptions) => Promise<boolean>;
};

const ConfirmContext = createContext<ConfirmContextType | null>(null);

export function useConfirm(): ConfirmContextType {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm deve ser utilizado dentro de um ConfirmDialogProvider");
  }
  return ctx;
}

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [dialogo, setDialogo] = useState<{
    opcoes: ConfirmOptions;
    resolve: (valor: boolean) => void;
  } | null>(null);

  const confirmar = useCallback((opcoes: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setDialogo({ opcoes, resolve });
    });
  }, []);

  const fechar = useCallback((resultado: boolean) => {
    if (dialogo) {
      dialogo.resolve(resultado);
      setDialogo(null);
    }
  }, [dialogo]);

  const value = useMemo(() => ({ confirmar }), [confirmar]);

  const variante = dialogo?.opcoes.variante ?? "danger";

  return (
    <ConfirmContext.Provider value={value}>
      {children}

      {dialogo && (
        <div
          className="fixed inset-0 z-[100] grid place-items-center bg-sus-950/60 p-4 print:hidden backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => fechar(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") fechar(false);
            }}
          >
            <div className="flex items-start gap-3.5">
              <div
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
                  variante === "danger"
                    ? "bg-red-100 text-red-600"
                    : variante === "warning"
                    ? "bg-amber-100 text-amber-700"
                    : "bg-teal/15 text-teal"
                }`}
              >
                {variante === "danger" ? (
                  <AlertTriangle className="h-6 w-6" />
                ) : variante === "warning" ? (
                  <AlertCircle className="h-6 w-6" />
                ) : (
                  <HelpCircle className="h-6 w-6" />
                )}
              </div>

              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-base font-bold text-sus-950">
                    {dialogo.opcoes.titulo}
                  </h3>
                  <button
                    type="button"
                    onClick={() => fechar(false)}
                    className="rounded-lg p-1 text-ink/40 hover:bg-slate-100 hover:text-ink/80 transition"
                    aria-label="Fechar"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {dialogo.opcoes.descricao && (
                  <div className="mt-2 text-xs leading-relaxed text-ink/70">
                    {dialogo.opcoes.descricao}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2.5">
              <Button
                type="button"
                variant="outline"
                onClick={() => fechar(false)}
                className="h-10 text-xs px-4"
              >
                {dialogo.opcoes.textoCancelar || "Cancelar"}
              </Button>
              <Button
                type="button"
                variant={variante === "danger" ? "danger" : "default"}
                onClick={() => fechar(true)}
                autoFocus
                className={`h-10 text-xs px-4 font-bold shadow-sm ${
                  variante === "primary" ? "bg-teal text-white hover:brightness-110" : ""
                }`}
              >
                {dialogo.opcoes.textoConfirmar || (variante === "danger" ? "Confirmar Exclusão" : "Confirmar")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
