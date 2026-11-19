import { useRef, useCallback, useEffect } from "react";
import { useConfirm } from "../components/ConfirmDialog";

export interface UseBackdropCloseOptions {
  onClose?: () => void;
  modalAberto?: boolean;
  aberto?: boolean;
  isDirty?: boolean;
  mensagemDirty?: string;
  fecharComEsc?: boolean;
}

/**
 * Hook para fechar modais com segurança:
 * 1. Previne fechamento por arrasto ("drag-to-close bug"):
 *    Se o usuário clica dentro do diálogo (ex: para selecionar texto) e solta o mouse
 *    fora (no backdrop), o modal NÃO fecha. Só fecha se o mousedown E o mouseup/click ocorrerem
 *    estritamente no próprio backdrop.
 * 2. Proteção contra perda de dados (Dirty State):
 *    Se houver alterações pendentes (isDirty === true), intercepta qualquer tentativa de
 *    fechamento (clique fora, tecla ESC ou fecharProtegido) e solicita confirmação via ConfirmDialog.
 * 3. Bloqueia scroll do fundo enquanto o modal estiver aberto, prevenindo scroll chaining.
 */
export function useBackdropClose(
  onCloseOrOptions?: (() => void) | UseBackdropCloseOptions,
  modalAbertoLegacy = true
) {
  let onClose: (() => void) | undefined;
  let modalAberto = modalAbertoLegacy;
  let isDirty = false;
  let mensagemDirty = "Há dados preenchidos ou modificados no formulário. Deseja realmente descartar as alterações e fechar?";
  let fecharComEsc = true;

  if (typeof onCloseOrOptions === "function") {
    onClose = onCloseOrOptions;
  } else if (onCloseOrOptions && typeof onCloseOrOptions === "object") {
    onClose = onCloseOrOptions.onClose;
    modalAberto = onCloseOrOptions.aberto ?? onCloseOrOptions.modalAberto ?? true;
    isDirty = !!onCloseOrOptions.isDirty;
    if (onCloseOrOptions.mensagemDirty) mensagemDirty = onCloseOrOptions.mensagemDirty;
    if (onCloseOrOptions.fecharComEsc !== undefined) fecharComEsc = onCloseOrOptions.fecharComEsc;
  }

  const isMouseDownOnBackdrop = useRef(false);
  const isMouseUpOnBackdrop = useRef(false);

  // Hook de confirmação caso o Provider esteja montado
  let confirmarFn: ((opcoes: any) => Promise<boolean>) | null = null;
  try {
    const { confirmar } = useConfirm();
    confirmarFn = confirmar;
  } catch {
    confirmarFn = null;
  }

  const fecharProtegido = useCallback(async () => {
    if (!onClose) return;
    if (isDirty) {
      if (confirmarFn) {
        const confirmou = await confirmarFn({
          titulo: "Descartar alterações?",
          descricao: mensagemDirty,
          textoConfirmar: "Descartar e Fechar",
          textoCancelar: "Continuar Editando",
          variante: "danger",
        });
        if (!confirmou) return;
      } else {
        const confirmou = window.confirm(mensagemDirty);
        if (!confirmou) return;
      }
    }
    onClose();
  }, [onClose, isDirty, mensagemDirty, confirmarFn]);

  // Previne scroll do background da página enquanto o modal estiver visível
  useEffect(() => {
    if (!modalAberto) return;
    const body = document.body;
    const scrollAnterior = body.style.overflow;
    body.classList.add("modal-aberto");
    body.style.overflow = "hidden";

    return () => {
      body.classList.remove("modal-aberto");
      body.style.overflow = scrollAnterior;
    };
  }, [modalAberto]);

  // Suporte a fechamento com tecla Escape (ESC) protegido por dirty state
  useEffect(() => {
    if (!modalAberto || !fecharComEsc) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Esc") {
        e.preventDefault();
        e.stopPropagation();
        fecharProtegido();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [modalAberto, fecharComEsc, fecharProtegido]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    isMouseDownOnBackdrop.current = e.target === e.currentTarget;
    isMouseUpOnBackdrop.current = false;
  }, []);

  const onMouseUp = useCallback((e: React.MouseEvent) => {
    isMouseUpOnBackdrop.current = isMouseDownOnBackdrop.current && e.target === e.currentTarget;
  }, []);

  const onClick = useCallback(
    (e: React.MouseEvent) => {
      if (isMouseDownOnBackdrop.current && isMouseUpOnBackdrop.current && e.target === e.currentTarget) {
        fecharProtegido();
      }
      isMouseDownOnBackdrop.current = false;
      isMouseUpOnBackdrop.current = false;
    },
    [fecharProtegido]
  );

  return {
    onMouseDown,
    onMouseUp,
    onClick,
    fecharProtegido,
  };
}
