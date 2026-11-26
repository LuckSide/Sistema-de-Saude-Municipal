import { useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Circle, Eye, EyeOff, KeyRound, X } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { trocarMinhaSenha } from "../services/api";
import { avaliarRequisitosSenha, validarForcaSenha } from "../utils/validacoes";
import { Button, Input, Label } from "./ui/primitives";

export default function TrocarSenhaModal({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirma, setConfirma] = useState("");
  const [mostrarAtual, setMostrarAtual] = useState(false);
  const [mostrarNova, setMostrarNova] = useState(false);
  const [mostrarConfirma, setMostrarConfirma] = useState(false);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  const reqs = avaliarRequisitosSenha(nova, user?.username ?? "");
  const erroForca = nova ? validarForcaSenha(nova, user?.username ?? "") : null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErro("");
    setOk("");
    const erroSenha = validarForcaSenha(nova, user?.username ?? "");
    if (erroSenha) {
      setErro(erroSenha);
      return;
    }
    if (nova !== confirma) {
      setErro("Nova senha e confirmação não conferem.");
      return;
    }
    if (nova === atual) {
      setErro("A nova senha deve ser diferente da senha atual.");
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

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div
        className="fixed -inset-10 bg-sus-950/60 backdrop-blur-md animate-in fade-in duration-150"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="relative z-10 max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl animate-in zoom-in-95 duration-150"
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
            <div className="relative mt-1">
              <Input
                type={mostrarAtual ? "text" : "password"}
                value={atual}
                onChange={(e) => setAtual(e.target.value)}
                autoComplete="current-password"
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
            <Label>Nova senha (mín. 8)</Label>
            <div className="relative mt-1">
              <Input
                type={mostrarNova ? "text" : "password"}
                value={nova}
                onChange={(e) => setNova(e.target.value)}
                autoComplete="new-password"
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
            <ul className="mt-2 space-y-1 rounded-xl bg-sand/60 p-2.5 text-[11px]">
              {[
                { ok: reqs.minimoCaracteres, txt: "Mínimo de 8 caracteres" },
                { ok: reqs.letraENumeroOuEspecial, txt: "Letras + número ou caractere especial" },
                { ok: reqs.semCaractereRepetidoOuNumerica, txt: "Não ser só números nem caractere repetido" },
                { ok: reqs.semSequenciaOuComum, txt: "Sem sequências (1234, abcd, qwer) ou senhas fáceis" },
                { ok: reqs.diferenteDoUsuario, txt: "Diferente do seu nome de usuário" },
              ].map((item) => (
                <li
                  key={item.txt}
                  className={`flex items-center gap-1.5 ${
                    item.ok ? "font-medium text-teal" : "text-ink/60"
                  }`}
                >
                  {item.ok ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <Circle className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <span>{item.txt}</span>
                </li>
              ))}
            </ul>
            {nova && erroForca && (
              <p className="mt-1.5 text-xs font-medium text-amber-700">{erroForca}</p>
            )}
          </div>
          <div>
            <Label>Confirmar nova senha</Label>
            <div className="relative mt-1">
              <Input
                type={mostrarConfirma ? "text" : "password"}
                value={confirma}
                onChange={(e) => setConfirma(e.target.value)}
                autoComplete="new-password"
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
    </div>,
    document.body
  );
}
