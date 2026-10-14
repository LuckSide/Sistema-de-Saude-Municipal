import { useEffect, useState } from "react";
import { ArrowUpCircle, CheckCircle2, Loader2, RefreshCw, ScrollText, XCircle } from "lucide-react";
import {
  updateExecutar,
  updateLog,
  updateStatus,
  type UpdateStatus,
} from "../services/api";
import { Button } from "../components/ui/primitives";

/** Banner de update p/ admin — checa login (sessionStorage) + revalida na API. */
export default function UpdateBanner() {
  const [st, setSt] = useState<UpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [log, setLog] = useState<string | null>(null);
  const [dismiss, setDismiss] = useState(false);

  useEffect(() => {
    let vivo = true;
    // Só bate na API se login sinalizou update — evita GitHub rate-limit a cada acesso.
    if (sessionStorage.getItem("guape:update") !== "1") return;
    updateStatus(false)
      .then((s) => vivo && setSt(s))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  if (dismiss || !st?.tem_atualizacao) return null;

  async function atualizar() {
    if (!confirm("Atualizar sistema agora? Baixa código (git pull), rebuild Docker e reinicia containers. Indisponibilidade de 1-3 min.")) return;
    setBusy(true);
    setMsg("");
    try {
      const r = await updateExecutar();
      setMsg(r.detail);
      sessionStorage.removeItem("guape:update");
      updateLog(60)
        .then((l) => setLog(l.log))
        .catch(() => {});
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? "Falha ao iniciar atualização.";
      setMsg(typeof d === "string" ? d : "Falha ao iniciar atualização.");
    } finally {
      setBusy(false);
    }
  }

  async function rechecar() {
    setBusy(true);
    try {
      const s = await updateStatus(true);
      setSt(s);
      if (!s.tem_atualizacao) sessionStorage.removeItem("guape:update");
    } finally {
      setBusy(false);
    }
  }

  async function verLog() {
    try {
      const l = await updateLog(200);
      setLog(l.log);
    } catch {
      setLog("(falha ao ler log)");
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
            Nova atualização disponível{st.release ? ` (${st.release})` : ""}
          </p>
          <p className="text-sm text-amber-900/70">
            Local <code className="font-mono font-bold">{st.commit_local ?? "?"}</code>
            {" → "}remoto <code className="font-mono font-bold">{st.commit_remoto ?? "?"}</code>
            {" · "}{st.repo}@{st.branch} · versão {st.versao}
            {st.erro ? ` · ${st.erro}` : ""}
          </p>
          {st.release_url && /^https:\/\/github\.com\//.test(st.release_url) && (
            <a href={st.release_url} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-amber-800 underline">
              Ver release no GitHub
            </a>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={atualizar} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {busy ? "Atualizando…" : "Atualizar sistema"}
          </Button>
          <button onClick={rechecar} disabled={busy} className="rounded-xl border border-amber-300 px-3 py-2 text-xs font-bold text-amber-900 hover:bg-amber-100">
            Rechecar
          </button>
          <button onClick={verLog} className="inline-flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100">
            <ScrollText className="h-4 w-4" /> Log
          </button>
          <button onClick={() => setDismiss(true)} className="rounded-lg p-2 text-amber-700 hover:bg-amber-100" aria-label="Dispensar">
            ✕
          </button>
        </div>
      </div>
      {msg && (
        <p className="mt-3 flex items-center gap-2 rounded-xl bg-white/70 px-3 py-2 text-sm font-medium text-amber-900">
          <CheckCircle2 className="h-4 w-4" /> {msg}
        </p>
      )}
      {log !== null && (
        <pre className="mt-3 max-h-56 overflow-auto rounded-xl bg-sus-950 p-3 font-mono text-[11px] leading-relaxed text-teal-100">
          {log || "(log vazio)"}
        </pre>
      )}
      {st.erro && (
        <p className="mt-2 flex items-center gap-1 text-xs text-amber-800">
          <XCircle className="h-3.5 w-3.5" /> {st.erro}
        </p>
      )}
    </div>
  );
}

export function VersaoRodape({ st }: { st: UpdateStatus | null }) {
  if (!st) return null;
  return (
    <p className="mt-6 text-center text-[11px] text-ink/40">
      v{st.versao} · {st.commit_local ?? "sem-git"} · {st.repo}@{st.branch} ·{" "}
      {st.atual ? "atualizado" : "desatualizado"}
    </p>
  );
}
