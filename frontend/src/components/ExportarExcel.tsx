import { useState } from "react";
import { Download } from "lucide-react";
import api from "../services/api";

/** Botão global "Exportar para Excel (.xlsx)": baixa o XLSX gerado no
 * backend com os filtros ativos da tela (cabeçalho com relatório,
 * data/hora e usuário solicitante incluídos no arquivo). */
export default function ExportarExcel({
  url,
  params,
  arquivo,
  titulo,
  rotulo,
  className,
}: {
  url: string;
  params?: Record<string, unknown>;
  arquivo: string;
  titulo?: string;
  rotulo?: string;
  className?: string;
}) {
  const [baixando, setBaixando] = useState(false);

  async function baixar() {
    setBaixando(true);
    try {
      const r = await api.get(url, { params, responseType: "blob" });
      const disp: string = r.headers?.["content-disposition"] ?? "";
      const m = disp.match(/filename="?([^";]+)"?/);
      const nome = m ? m[1] : `${arquivo}.xlsx`;
      const blob = new Blob([r.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = nome;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch {
      alert("Falha ao exportar. Tente novamente.");
    } finally {
      setBaixando(false);
    }
  }

  return (
    <button
      type="button"
      onClick={baixar}
      disabled={baixando}
      title={titulo ?? "Exportar para Excel (.xlsx) com os filtros ativos"}
      className={
        className ??
        "inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-sus-900/10 px-3 py-2 text-xs font-bold text-sus-900 hover:bg-sus-900/15 disabled:opacity-50"
      }
    >
      <Download className="h-4 w-4" /> {baixando ? "Gerando…" : (rotulo ?? "Exportar Excel")}
    </button>
  );
}
