import { useEffect, ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useBackdropClose } from "../../hooks/useBackdropClose";
import { cn } from "./primitives";

export interface ModalProps {
  aberto: boolean;
  onClose: () => void;
  titulo?: ReactNode;
  descricao?: ReactNode;
  children: ReactNode;
  isDirty?: boolean;
  mensagemDirty?: string;
  className?: string;
  tamanho?: "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "4xl" | "5xl" | "full";
  esconderBotaoFechar?: boolean;
}

const TAMANHOS = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
  "3xl": "max-w-3xl",
  "4xl": "max-w-4xl",
  "5xl": "max-w-5xl",
  full: "max-w-6xl",
};

export default function Modal({
  aberto,
  onClose,
  titulo,
  descricao,
  children,
  isDirty = false,
  mensagemDirty,
  className,
  tamanho = "xl",
  esconderBotaoFechar = false,
}: ModalProps) {
  const { onMouseDown, onMouseUp, onClick, fecharProtegido } = useBackdropClose({
    onClose,
    modalAberto: aberto,
    isDirty,
    mensagemDirty,
  });

  useEffect(() => {
    if (aberto) {
      document.body.classList.add("modal-aberto");
      return () => {
        document.body.classList.remove("modal-aberto");
      };
    }
  }, [aberto]);

  if (!aberto) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 md:p-6 overflow-y-auto print:hidden">
      {/* Backdrop com blur estendido além das bordas da viewport (-inset-10 / -40px)
          para eliminar 100% da faixa branca/artefato no topo da página no Chromium */}
      <div
        className="fixed -inset-10 bg-sus-950/60 backdrop-blur-md transition-opacity animate-in fade-in duration-150 pointer-events-auto"
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onClick={onClick}
        aria-hidden="true"
      />

      <div
        className={cn(
          "relative z-10 w-full rounded-2xl bg-white shadow-2xl border border-sus-900/10 overflow-hidden my-auto max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-150",
          TAMANHOS[tamanho] || TAMANHOS.xl,
          className
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {(titulo || !esconderBotaoFechar) && (
          <div className="flex items-start justify-between gap-3 p-4 sm:p-5 border-b border-sus-900/10 bg-sand/30 shrink-0">
            <div>
              {titulo && (
                <h3 className="font-display text-base sm:text-lg font-bold text-sus-950">
                  {titulo}
                </h3>
              )}
              {descricao && (
                <p className="mt-0.5 text-xs text-ink/65 leading-relaxed">
                  {descricao}
                </p>
              )}
            </div>
            {!esconderBotaoFechar && (
              <button
                type="button"
                onClick={fecharProtegido}
                className="rounded-xl p-1.5 text-ink/40 hover:bg-sus-900/10 hover:text-ink transition shrink-0"
                title="Fechar"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
        )}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1">{children}</div>
      </div>
    </div>,
    document.body
  );
}
