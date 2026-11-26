/**
 * Neutraliza CSV/Formula Injection em celulas exportadas para Excel/LibreOffice Calc.
 */
export function sanitizarCelulaCsv(valor: unknown): string {
  const texto = valor === null || valor === undefined ? "" : String(valor);
  if (!texto) return "";
  const seguro = /^[=+\-@\t\r]/.test(texto) ? `'${texto}` : texto;
  return `"${seguro.replace(/"/g, '""')}"`;
}
