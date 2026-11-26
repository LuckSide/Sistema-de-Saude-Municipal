import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, KeyRound, ShieldCheck } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { primeiraTrocaSenha } from "../services/api";
import { Button, Input, Label } from "../components/ui/primitives";

export default function AlterarSenhaInicial() {
  const { user, refreshMe, logout } = useAuth();
  const nav = useNavigate();
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirma, setConfirma] = useState("");
  const [mostrarAtual, setMostrarAtual] = useState(false);
  const [mostrarNova, setMostrarNova] = useState(false);
  const [mostrarConfirma, setMostrarConfirma] = useState(false);
  const [erro, setErro] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErro("");
    if (!atual.trim()) {
      setErro("Informe a senha atual (temporária) utilizada para entrar.");
      return;
    }
    if (nova !== confirma) {
      setErro("Nova senha e confirmação não conferem.");
      return;
    }
    if (nova.length < 6) {
      setErro("Nova senha precisa de ao menos 6 caracteres.");
      return;
    }
    if (nova === atual) {
      setErro("A nova senha deve ser diferente da senha atual temporária.");
      return;
    }
    setBusy(true);
    try {
      await primeiraTrocaSenha(nova, confirma, atual);
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
            <h2 className="font-display text-xl font-bold text-sus-950">Defina sua nova senha</h2>
            <p className="text-xs text-ink/55">
              {user ? `Conta ${user.username} · primeiro acesso` : "Primeiro acesso"}
            </p>
          </div>
        </div>
        <p className="mb-4 flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
          <ShieldCheck className="h-4 w-4 shrink-0" /> Crie sua senha pessoal definitiva para liberar o acesso ao sistema.
        </p>
        <div className="space-y-3">
          <div>
            <Label>Senha atual (temporária)</Label>
            <div className="relative mt-1">
              <Input
                type={mostrarAtual ? "text" : "password"}
                value={atual}
                onChange={(e) => setAtual(e.target.value)}
                autoComplete="current-password"
                placeholder="Digite a senha temporária recebida"
                required
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setMostrarAtual((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition"
                tabIndex={-1}
                aria-label={mostrarAtual ? "Ocultar senha" : "Ver senha"}
              >
                {mostrarAtual ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div>
            <Label>Nova senha pessoal (mín. 6)</Label>
            <div className="relative mt-1">
              <Input
                type={mostrarNova ? "text" : "password"}
                value={nova}
                onChange={(e) => setNova(e.target.value)}
                autoComplete="new-password"
                placeholder="Digite a nova senha"
                required
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setMostrarNova((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition"
                tabIndex={-1}
                aria-label={mostrarNova ? "Ocultar senha" : "Ver senha"}
              >
                {mostrarNova ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div>
            <Label>Confirmar nova senha</Label>
            <div className="relative mt-1">
              <Input
                type={mostrarConfirma ? "text" : "password"}
                value={confirma}
                onChange={(e) => setConfirma(e.target.value)}
                autoComplete="new-password"
                placeholder="Repita a nova senha"
                required
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setMostrarConfirma((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition"
                tabIndex={-1}
                aria-label={mostrarConfirma ? "Ocultar senha" : "Ver senha"}
              >
                {mostrarConfirma ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
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
