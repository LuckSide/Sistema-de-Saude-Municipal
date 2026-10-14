import { useEffect, useState } from "react";
import { Building2, GitBranch, RefreshCw, Save, ScrollText } from "lucide-react";
import {
  fetchSettings,
  saveSettings,
  updateExecutar,
  updateLog,
  updateStatus,
  type UpdateStatus,
} from "../services/api";
import { Button, Card, Input, Label } from "../components/ui/primitives";

export default function Configuracoes() {
  const [cidade, setCidade] = useState("Guapé");
  const [uf, setUf] = useState("MG");
  const [subtitulo, setSubtitulo] = useState("Secretaria Municipal");
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [upd, setUpd] = useState<UpdateStatus | null>(null);
  const [updMsg, setUpdMsg] = useState("");
  const [updBusy, setUpdBusy] = useState(false);
  const [log, setLog] = useState<string | null>(null);

  useEffect(() => {
    fetchSettings()
      .then((s) => {
        setCidade((s.cidade || "").trim() || "Guapé");
        setUf(((s.uf || "").trim().toUpperCase() || "MG").slice(0, 2));
        setSubtitulo((s.subtitulo || "").trim() || "Secretaria Municipal");
      })
      .catch((e: unknown) => {
        const st = (e as { response?: { status?: number } }).response?.status;
        if (st === 401) setErro("Sessão expirada. Entre novamente.");
        else if (st === 403) setErro("Sem permissão ou troca de senha pendente.");
        else setErro("Falha ao carregar configurações. Tente recarregar.");
      })
      .finally(() => setLoading(false));
    updateStatus(false).then(setUpd).catch(() => {});
  }, []);

  async function salvar() {
    setErro("");
    setOk("");
    if (cidade.trim().length < 2) {
      setErro("Nome da cidade inválido.");
      return;
    }
    setBusy(true);
    try {
      const s = await saveSettings({ cidade: cidade.trim(), uf: uf.trim().toUpperCase().slice(0, 2) || "MG", subtitulo: subtitulo.trim() || "Secretaria Municipal" });
      setCidade(s.cidade);
      setUf(s.uf);
      setSubtitulo(s.subtitulo);
      setOk(`Cidade atualizada para ${s.cidade}. Título e favicon atualizados.`);
    } catch (e: unknown) {
      const resp = (e as { response?: { status?: number; data?: { detail?: unknown } } }).response;
      const detail = resp?.data?.detail;
      if (resp?.status === 401) setErro("Sessão expirada. Entre novamente.");
      else if (resp?.status === 403) setErro("Sem permissão (admin) ou troca de senha pendente.");
      else if (typeof detail === "string" && detail) setErro(detail);
      else setErro("Erro ao salvar. Confira os campos e tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-extrabold text-sus-950">Configurações do sistema</h1>
      <p className="mb-4 mt-1 text-sm text-ink/55">
        Restrito a administradores. Nome da cidade alimenta título da aba, favicon e cabeçalhos.
      </p>
      <Card className="max-w-xl p-6">
        <p className="mb-4 flex items-center gap-2 font-display text-base font-bold text-sus-950">
          <Building2 className="h-5 w-5" /> Município
        </p>
        {loading ? (
          <p className="text-sm text-ink/50">Carregando…</p>
        ) : (
          <div className="space-y-3">
            <div>
              <Label>Nome da cidade *</Label>
              <Input value={cidade} onChange={(e) => setCidade(e.target.value)} placeholder="Ex: Guapé" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>UF</Label>
                <Input value={uf} onChange={(e) => setUf(e.target.value.toUpperCase().slice(0, 2))} placeholder="MG" maxLength={2} />
              </div>
              <div>
                <Label>Subtítulo</Label>
                <Input value={subtitulo} onChange={(e) => setSubtitulo(e.target.value)} placeholder="Secretaria Municipal" />
              </div>
            </div>
            {erro && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{erro}</p>}
            {ok && <p className="rounded-xl bg-teal/10 px-3 py-2 text-sm font-medium text-teal">{ok}</p>}
            <Button onClick={salvar} disabled={busy} className="w-full">
              <Save className="h-4 w-4" /> {busy ? "Salvando…" : "Salvar cidade"}
            </Button>
          </div>
        )}
      </Card>

      <Card className="mt-4 max-w-xl p-6">
        <p className="mb-1 flex items-center gap-2 font-display text-base font-bold text-sus-950">
          <GitBranch className="h-5 w-5" /> Versão e atualizações
        </p>
        <p className="mb-4 text-xs text-ink/55">
          Compara commit local com GitHub main. Update roda git pull + rebuild Docker em background.
        </p>
        {upd ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${upd.atual ? "bg-teal/15 text-teal" : "bg-amber-100 text-amber-900"}`}>
                {upd.atual ? "Atualizado" : "Desatualizado"}
              </span>
              <span className="font-mono text-xs text-ink/60">
                v{upd.versao} · {upd.commit_local ?? "sem-git"} → {upd.commit_remoto ?? "?"}
              </span>
            </div>
            <p className="text-xs text-ink/55">
              {upd.repo}@{upd.branch}
              {upd.release ? ` · release ${upd.release}` : ""}
              {upd.erro ? ` · ${upd.erro}` : ""}
            </p>
            {updMsg && (
              <p className="rounded-xl bg-teal/10 px-3 py-2 text-sm font-medium text-teal">{updMsg}</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={updBusy || !upd.tem_atualizacao}
                onClick={async () => {
                  if (!confirm("Atualizar agora? 1-3 min de indisponibilidade (rebuild Docker).")) return;
                  setUpdBusy(true);
                  setUpdMsg("");
                  try {
                    const r = await updateExecutar();
                    setUpdMsg(r.detail);
                  } catch (e: unknown) {
                    const d = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? "Falha ao iniciar.";
                    setUpdMsg(typeof d === "string" ? d : "Falha ao iniciar.");
                  } finally {
                    setUpdBusy(false);
                  }
                }}
              >
                <RefreshCw className="h-4 w-4" /> {updBusy ? "Iniciando…" : "Atualizar sistema"}
              </Button>
              <button
                onClick={async () => {
                  const s = await updateStatus(true).catch(() => null);
                  if (s) setUpd(s);
                }}
                className="rounded-xl border border-sus-900/15 px-3 py-2 text-xs font-bold text-sus-900 hover:bg-sand"
              >
                Rechecar GitHub
              </button>
              <button
                onClick={async () => {
                  const l = await updateLog(200).catch(() => null);
                  setLog(l ? l.log : "(falha ao ler log)");
                }}
                className="inline-flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-bold text-sus-800 hover:bg-sand"
              >
                <ScrollText className="h-4 w-4" /> Ver log
              </button>
            </div>
            {log !== null && (
              <pre className="max-h-56 overflow-auto rounded-xl bg-sus-950 p-3 font-mono text-[11px] leading-relaxed text-teal-100">
                {log || "(log vazio)"}
              </pre>
            )}
          </div>
        ) : (
          <p className="text-sm text-ink/50">Verificando versão…</p>
        )}
      </Card>
    </div>
  );
}
