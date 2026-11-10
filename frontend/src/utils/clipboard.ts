/**
 * Utilitário seguro para cópia de texto para a área de transferência (Clipboard).
 * Suporta navegador moderno via `navigator.clipboard.writeText` e possui
 * fallback robusto via elemento temporário para ambientes HTTP/iframe/permissões restritas.
 */
export async function copiarTextoClipboard(texto: string): Promise<boolean> {
  if (!texto) return false;

  // 1. Tenta API moderna navigator.clipboard
  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === "function"
  ) {
    try {
      await navigator.clipboard.writeText(texto);
      return true;
    } catch {
      // Falha silenciosa para tentar o fallback manual
    }
  }

  // 2. Fallback cross-browser via elemento textarea oculto
  try {
    const el = document.createElement("textarea");
    el.value = texto;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.top = "0";
    el.style.left = "-9999px";
    el.style.opacity = "0";
    el.style.pointerEvents = "none";
    document.body.appendChild(el);

    el.focus();
    el.select();
    el.setSelectionRange(0, 99999);

    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}
