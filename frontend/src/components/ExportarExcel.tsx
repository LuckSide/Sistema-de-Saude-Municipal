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
  const [erro, setErro] = useState("");

  async function baixar() {
    setBaixando(true);
    setErro("");
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
      setErro("Falha ao exportar.");
      setTimeout(() => setErro(""), 3500);
    } finally {
      setBaixando(false);
    }
  }

  return (
    <div className="relative inline-flex flex-col items-end">
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
      {erro && (
        <span className="absolute top-full mt-1 whitespace-nowrap rounded-md bg-red-600 px-2 py-0.5 text-[11px] font-bold text-white shadow-md z-10 animate-in fade-in">
          {erro}
        </span>
      )}
    </div>
  );
}
