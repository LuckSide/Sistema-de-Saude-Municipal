import { lazy, type ComponentType } from "react";

/**
 * Envolve um import dinâmico com retentativas automáticas e recarregamento limpo caso o chunk
 * antigo não exista mais após uma nova implantação / atualização em produção.
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  componentImport: () => Promise<{ default: T }>
) {
  return lazy(async () => {
    const pageHasBeenForceRefreshed = window.sessionStorage.getItem(
      "guape:chunk_reload"
    );

    try {
      const component = await componentImport();
      window.sessionStorage.removeItem("guape:chunk_reload");
      return component;
    } catch (error: any) {
      const errorMsg = String(error?.message || error || "");
      const isDynamicImportError =
        errorMsg.includes("dynamically imported module") ||
        errorMsg.includes("Failed to fetch dynamically imported module") ||
        errorMsg.includes("Importing a module script failed");

      if (isDynamicImportError && !pageHasBeenForceRefreshed) {
        window.sessionStorage.setItem("guape:chunk_reload", "true");
        window.location.reload();
        // Retorna promessa pendente enquanto a página recarrega
        return new Promise<{ default: T }>(() => {});
      }

      throw error;
    }
  });
}
