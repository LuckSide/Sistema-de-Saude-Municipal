import { useRef, useCallback, useEffect } from "react";

/**
 * Hook para fechar modais com segurança:
 * 1. Previne fechamento por arrasto ("drag-to-close bug"):
 *    Se o usuário clica dentro do diálogo (ex: para selecionar texto) e solta o mouse
 *    fora (no backdrop), o modal NÃO fecha. Só fecha se o mousedown E o click ocorrerem
 *    estritamente no próprio backdrop.
 * 2. Bloqueia scroll do fundo enquanto o modal estiver aberto, prevenindo scroll chaining.
 */
export function useBackdropClose(onClose?: () => void, modalAberto = true) {
  const isMouseDownOnBackdrop = useRef(false);

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

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    isMouseDownOnBackdrop.current = e.target === e.currentTarget;
  }, []);

  const onClick = useCallback(
    (e: React.MouseEvent) => {
      if (isMouseDownOnBackdrop.current && e.target === e.currentTarget) {
        onClose?.();
      }
      isMouseDownOnBackdrop.current = false;
    },
    [onClose]
  );

  return {
    onMouseDown,
    onClick,
  };
}
