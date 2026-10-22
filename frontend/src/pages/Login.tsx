import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Ambulance, Cross, ShieldCheck } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { fetchMe } from "../services/api";
import { useCidadeDinamica, nomeCidade } from "../hooks/useCidade";
import { Button, Input, Label } from "../components/ui/primitives";

export default function Login() {
  const { login, user } = useAuth();
  const settings = useCidadeDinamica();
  const cidade = nomeCidade(settings);
  const nav = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [erro, setErro] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErro("");
    setBusy(true);
    try {
      await login(username.trim(), password);
      // user do context atualiza async; confere via API p/ redirecionar certo
      const me = await fetchMe().catch(() => user);
      nav(me?.must_change_password ? "/alterar-senha-inicial" : "/", { replace: true });
    } catch {
      setErro("Usuário ou senha inválidos.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen md:grid-cols-2">
      {/* Cabeçalho de branding mobile: empilha identidade + formulário em coluna única */}
      <div className="relative overflow-hidden bg-sus-950 text-white md:hidden">
        <div className="dot-grid absolute inset-0 opacity-30" />
        <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-teal/25 blur-3xl" />
        <div className="relative flex flex-col gap-4 p-6 pb-8">
          <div className="flex items-center gap-3">
            {settings.brasao_url ? (
              <img src={settings.brasao_url} alt={`Brasão de ${cidade}`} className="h-11 w-11 rounded-2xl bg-white/10 object-contain p-1" />
            ) : (
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-teal text-sus-950">
                <Cross className="h-6 w-6" strokeWidth={2.5} />
              </div>
            )}
            <div>
              <p className="font-display text-lg font-bold">Saúde {cidade}</p>
              <p className="text-sm text-white/60">{settings.subtitulo} · {settings.uf}</p>
            </div>
          </div>
          <h1 className="font-display text-2xl font-extrabold leading-tight">
            Gestão da saúde municipal em um só painel.
          </h1>
        </div>
      </div>
      <div className="relative hidden overflow-hidden bg-sus-950 text-white md:block">
        <div className="dot-grid absolute inset-0 opacity-30" />
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-teal/25 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-sus-700/60 blur-3xl" />
        <div className="relative flex h-full flex-col justify-between p-12">
          <div className="flex items-center gap-3">
            {settings.brasao_url ? (
              <img src={settings.brasao_url} alt={`Brasão de ${cidade}`} className="h-11 w-11 rounded-2xl bg-white/10 object-contain p-1" />
            ) : (
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-teal text-sus-950">
                <Cross className="h-6 w-6" strokeWidth={2.5} />
              </div>
            )}
            <div>
              <p className="font-display text-lg font-bold">Saúde {cidade}</p>
              <p className="text-sm text-white/60">{settings.subtitulo} · {settings.uf}</p>
            </div>
          </div>
          <div>
            <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-teal">
              <ShieldCheck className="h-4 w-4" /> Acesso restrito · Servidores SMS
            </p>
            <h1 className="max-w-md font-display text-4xl font-extrabold leading-tight">
              Gestão da saúde municipal em um só painel.
            </h1>
            <p className="mt-3 max-w-md text-sm text-white/65">
              Contas por área e tela, TFD, APS Previne Brasil e integrações e-SUS / RNDS.
            </p>
            <div className="mt-6 flex items-center gap-2 text-xs text-white/55">
              <Ambulance className="h-4 w-4" /> TFD · Frota · Exames · Faturamento
            </div>
          </div>
          <p className="text-xs text-white/40">SUS · {cidade}-{settings.uf}</p>
        </div>
      </div>

      <div className="grid place-items-center bg-sand px-6 py-10">
        <form
          onSubmit={onSubmit}
          className="rise w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-lg"
        >
          <h2 className="font-display text-2xl font-bold text-sus-950">Entrar</h2>
          <p className="mb-6 mt-1 text-sm text-ink/55">Use sua conta da Secretaria.</p>
          <div className="space-y-4">
            <div>
              <Label>Usuário</Label>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                placeholder="Digite seu usuário"
                required
                className="border-slate-300 text-slate-900 placeholder:text-slate-400 focus:border-teal focus:ring-2 focus:ring-teal/30"
              />
            </div>
            <div>
              <Label>Senha</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="Digite sua senha"
                required
                className="border-slate-300 text-slate-900 placeholder:text-slate-400 focus:border-teal focus:ring-2 focus:ring-teal/30"
              />
            </div>
            {erro && (
              <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                {erro}
              </p>
            )}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Entrando…" : "Entrar no painel"}
            </Button>
            <p className="text-center text-xs text-ink/45">
              Para criar seu acesso fale com um administrador.
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
