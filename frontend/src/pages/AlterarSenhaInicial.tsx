import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, ShieldCheck } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { primeiraTrocaSenha } from "../services/api";
import { Button, Input, Label } from "../components/ui/primitives";

export default function AlterarSenhaInicial() {
  const { user, refreshMe, logout } = useAuth();
  const nav = useNavigate();
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirma, setConfirma] = useState("");
  const [erro, setErro] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErro("");
    if (nova !== confirma) {
      setErro("Nova senha e confirmação não conferem.");
      return;
    }
    if (nova.length < 6) {
      setErro("Nova senha precisa de ao menos 6 caracteres.");
      return;
    }
    if (nova === atual) {
      setErro("Nova senha deve ser diferente da temporária.");
      return;
    }
    setBusy(true);
    try {
      await primeiraTrocaSenha(atual, nova, confirma);
      const me = await refreshMe();
      if (me.must_change_password) {
        setErro("Troca registrada, mas flag segue ativa. Tente de novo.");
        return;
      }
      nav("/", { replace: true });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } }).response?.data
          ?.detail ?? "Erro ao definir senha.";
      setErro(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-sand px-6 py-10">
      <form onSubmit={onSubmit} className="rise w-full max-w-sm rounded-2xl bg-white p-6 shadow-card">
        <div className="mb-4 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-sus-900 text-white">
            <KeyRound className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-display text-xl font-bold text-sus-950">Defina sua senha</h2>
            <p className="text-xs text-ink/55">
              {user ? `Conta ${user.username} · primeiro acesso` : "Primeiro acesso"}
            </p>
          </div>
        </div>
        <p className="mb-4 flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
          <ShieldCheck className="h-4 w-4" /> Troca obrigatória: acesso liberado após salvar.
        </p>
        <div className="space-y-3">
          <div>
            <Label>Senha temporária recebida</Label>
            <Input type="password" value={atual} onChange={(e) => setAtual(e.target.value)} autoComplete="current-password" required />
          </div>
          <div>
            <Label>Nova senha pessoal (mín. 6)</Label>
            <Input type="password" value={nova} onChange={(e) => setNova(e.target.value)} autoComplete="new-password" required />
          </div>
          <div>
            <Label>Confirmar nova senha</Label>
            <Input type="password" value={confirma} onChange={(e) => setConfirma(e.target.value)} autoComplete="new-password" required />
          </div>
          {erro && (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{erro}</p>
          )}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Salvando…" : "Salvar e entrar"}
          </Button>
          <button type="button" onClick={logout} className="w-full rounded-xl px-4 py-2 text-xs font-semibold text-ink/50 hover:bg-sand">
            Sair e usar outra conta
          </button>
        </div>
      </form>
    </div>
  );
}
