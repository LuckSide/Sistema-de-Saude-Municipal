import { useState, type FormEvent } from "react";
import { KeyRound, X } from "lucide-react";
import { trocarMinhaSenha } from "../services/api";
import { Button, Input, Label } from "./ui/primitives";

export default function TrocarSenhaModal({ onClose }: { onClose: () => void }) {
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirma, setConfirma] = useState("");
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErro("");
    setOk("");
    if (nova !== confirma) {
      setErro("Nova senha e confirmação não conferem.");
      return;
    }
    if (nova.length < 6) {
      setErro("Nova senha precisa de ao menos 6 caracteres.");
      return;
    }
    setBusy(true);
    try {
      await trocarMinhaSenha(atual, nova);
      setOk("Senha atualizada com sucesso.");
      setAtual("");
      setNova("");
      setConfirma("");
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } }).response?.data
          ?.detail ?? "Erro ao trocar senha.";
      setErro(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4"
      onClick={onClose}
    >
      <div
        className="rise max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-2xl bg-white p-6 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-sus-900 text-white">
              <KeyRound className="h-4 w-4" />
            </div>
            <div>
              <p className="font-display text-base font-bold text-sus-950">
                Trocar minha senha
              </p>
              <p className="text-xs text-ink/50">Conta logada · JWT</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-ink/50 hover:bg-sand"
            title="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <Label>Senha atual</Label>
            <Input
              type="password"
              value={atual}
              onChange={(e) => setAtual(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          <div>
            <Label>Nova senha</Label>
            <Input
              type="password"
              value={nova}
              onChange={(e) => setNova(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          <div>
            <Label>Confirmar nova senha</Label>
            <Input
              type="password"
              value={confirma}
              onChange={(e) => setConfirma(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          {erro && (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              {erro}
            </p>
          )}
          {ok && (
            <p className="rounded-xl bg-teal/10 px-3 py-2 text-sm font-medium text-teal">
              {ok}
            </p>
          )}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Salvando…" : "Atualizar senha"}
          </Button>
        </form>
      </div>
    </div>
  );
}
