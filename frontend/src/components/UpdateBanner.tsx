import { useEffect, useState } from "react";
import { ArrowUpCircle, Terminal } from "lucide-react";
import { Link } from "react-router-dom";
import {
  updateStatus,
  type UpdateStatus,
} from "../services/api";

/** Banner de aviso de nova versão no GitHub p/ admin. Atualização realizada via scripts no servidor. */
export default function UpdateBanner() {
  const [st, setSt] = useState<UpdateStatus | null>(null);
  const [dismiss, setDismiss] = useState(false);

  useEffect(() => {
    let vivo = true;
    // Só consulta se login sinalizou update — evita rate-limit a cada acesso.
    if (sessionStorage.getItem("guape:update") !== "1") return;
    updateStatus(false)
      .then((s) => vivo && setSt(s))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  if (dismiss || !st?.tem_atualizacao) return null;

  return (
    <div className="rise mb-6 rounded-2xl border border-amber-300 bg-amber-50 p-4 shadow-card print:hidden">
      <div className="flex flex-wrap items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-2xl bg-amber-400 text-amber-950">
          <ArrowUpCircle className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-base font-bold text-amber-950">
            Nova versão disponível no GitHub · v{st.versao} ({st.commit_remoto ?? "novo commit"})
          </p>
          <p className="text-sm text-amber-900/75">
            Execute o script de atualização no servidor via terminal para aplicar. Detalhes em Configurações → Geral.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/configuracoes?aba=geral"
            className="inline-flex items-center gap-1.5 rounded-xl border border-amber-400 bg-white px-3 py-2 text-xs font-bold text-amber-900 hover:bg-amber-100"
          >
            <Terminal className="h-3.5 w-3.5" /> Ver versão
          </Link>
          <button
            onClick={() => setDismiss(true)}
            className="grid min-h-[44px] min-w-[44px] place-items-center rounded-lg p-2 text-amber-700 hover:bg-amber-100"
            aria-label="Dispensar"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}

export function VersaoRodape({ st }: { st: UpdateStatus | null }) {
  if (!st) return null;
  return (
    <p className="mt-6 text-center text-[11px] text-ink/40">
      v{st.versao} · {st.atual ? "atualizado" : "desatualizado"}
    </p>
  );
}
