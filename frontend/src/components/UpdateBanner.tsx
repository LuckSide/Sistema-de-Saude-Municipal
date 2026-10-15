import { useEffect, useState } from "react";
import { ArrowUpCircle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import {
  updateExecutar,
  type UpdateStatus,
} from "../services/api";
import { Button } from "../components/ui/primitives";

/** Banner de update p/ admin — só versão. Detalhes GitHub ficam em Configurações. */
export default function UpdateBanner() {
  const [st, setSt] = useState<UpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [dismiss, setDismiss] = useState(false);

  useEffect(() => {
    let vivo = true;
    // Só consulta se login sinalizou update — evita rate-limit a cada acesso.
    if (sessionStorage.getItem("guape:update") !== "1") return;
    import("../services/api").then(({ updateStatus }) =>
      updateStatus(false)
        .then((s) => vivo && setSt(s))
        .catch(() => {})
    );
    return () => {
      vivo = false;
    };
  }, []);

  if (dismiss || !st?.tem_atualizacao) return null;

  async function atualizar() {
    if (!confirm("Atualizar sistema agora? Baixa código, rebuild Docker e reinicia containers. Indisponibilidade de 1-3 min.")) return;
    setBusy(true);
    setMsg("");
    try {
      const r = await updateExecutar();
      setMsg(r.detail);
      sessionStorage.removeItem("guape:update");
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? "Falha ao iniciar atualização.";
      setMsg(typeof d === "string" ? d : "Falha ao iniciar atualização.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rise mb-6 rounded-2xl border border-amber-300 bg-amber-50 p-4 shadow-card print:hidden">
      <div className="flex flex-wrap items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-2xl bg-amber-400 text-amber-950">
          <ArrowUpCircle className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-base font-bold text-amber-950">
            Nova atualização disponível · v{st.versao}
          </p>
          <p className="text-sm text-amber-900/70">
            Veja detalhes e logs em Configurações → Geral.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={atualizar} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {busy ? "Atualizando…" : "Atualizar sistema"}
          </Button>
          <button onClick={() => setDismiss(true)} className="grid min-h-[44px] min-w-[44px] place-items-center rounded-lg p-2 text-amber-700 hover:bg-amber-100" aria-label="Dispensar">
            ✕
          </button>
        </div>
      </div>
      {msg && (
        <p className="mt-3 flex items-center gap-2 rounded-xl bg-white/70 px-3 py-2 text-sm font-medium text-amber-900">
          <CheckCircle2 className="h-4 w-4" /> {msg}
        </p>
      )}
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
