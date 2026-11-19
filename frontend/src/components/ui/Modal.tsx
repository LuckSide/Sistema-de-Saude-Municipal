import { ReactNode } from "react";
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
  tamanho?: "sm" | "md" | "lg" | "xl" | "2xl" | "4xl" | "full";
  esconderBotaoFechar?: boolean;
}

const TAMANHOS = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
  "4xl": "max-w-4xl",
  full: "max-w-5xl",
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

  if (!aberto) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 md:p-6 bg-sus-950/60 backdrop-blur-xs overflow-y-auto print:hidden animate-in fade-in duration-150"
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onClick={onClick}
    >
      <div
        className={cn(
          "w-full rounded-2xl bg-white shadow-2xl border border-sus-900/10 overflow-hidden my-auto max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-150",
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
    </div>
  );
}
