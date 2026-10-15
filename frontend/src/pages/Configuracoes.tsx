import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Building2, FlaskConical, GitBranch, ImagePlus, RefreshCw, Save, ScrollText, Stethoscope, MapPin } from "lucide-react";
import { Badge, Button, Card, Input, Label } from "../components/ui/primitives";
import { useAuth } from "../hooks/useAuth";
import Medicos from "./Medicos";
import UnidadesSaude from "./UnidadesSaude";
import {
  fetchIntegracoes,
  fetchSettings,
  importarFilas,
  savePec,
  labsCriar,
  labsListar,
  labsRemover,
  saveRnds,
  saveSettings,
  testarPec,
  updateExecutar,
  updateLog,
  updateStatus,
  validarRnds,
  type ImportFilasOut,
  type Integracoes,
  type UpdateStatus,
} from "../services/api";

type Aba = "geral" | "filas" | "pec" | "rnds" | "medicos" | "unidades" | "laboratorios";
const ABAS: { id: Aba; rotulo: string }[] = [
  { id: "geral", rotulo: "Geral" },
  { id: "filas", rotulo: "Importar filas" },
  { id: "pec", rotulo: "PEC / e-SUS APS" },
  { id: "rnds", rotulo: "RNDS" },
  { id: "medicos", rotulo: "Médicos e Profissionais de Saúde" },
  { id: "unidades", rotulo: "Unidades de Saúde e PSFs" },
  { id: "laboratorios", rotulo: "Laboratórios" },
];

function msgErro(e: unknown, padrao: string): string {
  const d = (e as { response?: { status?: number; data?: { detail?: unknown } } }).response;
  if (d?.status === 401) return "Sessão expirada. Entre novamente.";
  if (d?.status === 403) return "Sem permissão ou troca de senha pendente.";
  if (typeof d?.data?.detail === "string" && d.data.detail) return d.data.detail;
  return padrao;
}

export default function Configuracoes() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  // Abas condicionais à matriz (pai "integracoes" implica as 4 via can()).
  // "usuarios" mantém acesso à Geral como antes da granularidade.
  // Médicos/PSFs exigem "usuarios" (mesma regra das telas standalone —
  // nada é concedido a quem não tinha).
  const abasVisiveis = ABAS.filter((a) => {
    if (a.id === "geral") return can("cfg_geral") || can("usuarios");
    if (a.id === "filas") return can("cfg_filas");
    if (a.id === "pec") return can("cfg_pec");
    if (a.id === "medicos" || a.id === "unidades" || a.id === "laboratorios") return can("usuarios") || can("lab_vagas");
    return can("cfg_rnds");
  });
  const pedida = (params.get("aba") as Aba) || "geral";
  const inicial: Aba = abasVisiveis.some((a) => a.id === pedida)
    ? pedida
    : (abasVisiveis[0]?.id ?? "geral");
  const [aba, setAba] = useState<Aba>(inicial);

  function trocar(a: Aba) {
    setAba(a);
    setParams(a === "geral" ? {} : { aba: a }, { replace: true });
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-extrabold text-sus-950">Configurações do sistema</h1>
      <p className="mb-4 mt-1 text-sm text-ink/55">
        Módulo administrativo único: município e marca, filas, PEC e RNDS.
      </p>
      <div className="mb-4 flex flex-wrap gap-2">
        {abasVisiveis.map((a) => (
          <button
            key={a.id}
            onClick={() => trocar(a.id)}
            className={`rounded-xl px-4 py-2 text-sm font-bold transition ${
              aba === a.id ? "bg-sus-900 text-white" : "border border-sus-900/15 text-sus-900 hover:bg-sand"
            }`}
          >
            {a.rotulo}
          </button>
        ))}
      </div>
      {aba === "geral" && <AbaGeral />}
      {aba === "filas" && <AbaFilas />}
      {aba === "pec" && <AbaPec />}
      {aba === "rnds" && <AbaRnds />}
      {aba === "medicos" && <Medicos />}
      {aba === "unidades" && <UnidadesSaude />}
      {aba === "laboratorios" && <AbaLaboratorios />}
    </div>
  );
}

// ---------- Geral: município + marca + versão ----------
function AbaGeral() {
  const [cidade, setCidade] = useState("Guapé");
  const [uf, setUf] = useState("MG");
  const [subtitulo, setSubtitulo] = useState("Secretaria Municipal");
  const [brasao, setBrasao] = useState("");
  const [icone, setIcone] = useState("");
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
        setBrasao((s.brasao_url || "").trim());
        setIcone((s.icone_url || "").trim());
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
      const s = await saveSettings({
        cidade: cidade.trim(),
        uf: uf.trim().toUpperCase().slice(0, 2) || "MG",
        subtitulo: subtitulo.trim() || "Secretaria Municipal",
        brasao_url: brasao.trim(),
        icone_url: icone.trim(),
      });
      setCidade(s.cidade);
      setUf(s.uf);
      setSubtitulo(s.subtitulo);
      setBrasao(s.brasao_url || "");
      setIcone(s.icone_url || "");
      setOk(`Cidade atualizada para ${s.cidade}. Título, marca e favicon atualizados.`);
    } catch (e: unknown) {
      setErro(msgErro(e, "Erro ao salvar. Confira os campos e tente de novo."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
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
              <Input value={cidade} onChange={(e) => setCidade(e.target.value)} placeholder="Ex: Nome da cidade" />
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
          <ImagePlus className="h-5 w-5" /> Marca: brasão e ícone
        </p>
        <p className="mb-4 text-xs text-ink/55">
          Brasão aparece no menu lateral e no login; ícone substitui o favicon gerado.
          Use URL https://… ou data:image/…. Vazio mantém o padrão.
        </p>
        <div className="space-y-3">
          <div>
            <Label>URL do brasão / logo</Label>
            <Input value={brasao} onChange={(e) => setBrasao(e.target.value)} placeholder="https://…" autoComplete="off" />
          </div>
          <div>
            <Label>URL do ícone (favicon)</Label>
            <Input value={icone} onChange={(e) => setIcone(e.target.value)} placeholder="https://… .png/.svg" autoComplete="off" />
          </div>
          {(brasao.trim() || icone.trim()) && (
            <div className="flex items-center gap-3 rounded-xl bg-sand px-3 py-2">
              {brasao.trim() && <img src={brasao.trim()} alt="Prévia do brasão" className="h-10 w-10 rounded-lg bg-white object-contain p-0.5" />}
              {icone.trim() && <img src={icone.trim()} alt="Prévia do ícone" className="h-8 w-8 rounded-lg bg-white object-contain p-0.5" />}
              <span className="text-xs text-ink/55">Prévia — salva junto com a cidade acima.</span>
            </div>
          )}
        </div>
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
    </>
  );
}

// ---------- Filas: upload CSV/XLSX ----------
function AbaFilas() {
  const [arq, setArq] = useState<File | null>(null);
  const [simular, setSimular] = useState(true);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");
  const [res, setRes] = useState<ImportFilasOut | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function enviar() {
    setErro("");
    setRes(null);
    if (!arq) {
      setErro("Escolha um arquivo .csv ou .xlsx.");
      return;
    }
    setBusy(true);
    try {
      setRes(await importarFilas(arq, simular));
    } catch (e: unknown) {
      setErro(msgErro(e, "Falha ao importar."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="max-w-2xl p-6">
      <p className="mb-1 font-display text-base font-bold text-sus-950">Carga massiva de fila de espera</p>
      <p className="mb-4 text-xs text-ink/55">
        CSV (delimitador , ; | ou tab, UTF-8/Latin-1) ou Excel .xlsx com cabeçalho na 1ª linha.
        Colunas aceitas: nome_paciente, cpf_paciente, numero_cartao, data_nascimento, telefone,
        codigo_procedimento, nome_procedimento, servico_tipo_nome, data_hora_solicitacao, urgencia,
        observacao, unidade_referencia. Máx 10MB / 20 mil linhas. Idempotente (reenvio não duplica).
      </p>
      <div className="space-y-3">
        <div>
          <Label>Arquivo (.csv / .xlsx)</Label>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.xlsm"
            onChange={(e) => setArq(e.target.files?.[0] ?? null)}
            className="w-full rounded-xl border border-sus-900/15 bg-white px-3.5 py-2.5 text-sm text-ink file:mr-3 file:rounded-lg file:border-0 file:bg-sus-900 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-white"
          />
          {arq && <p className="mt-1 text-xs text-ink/55">{arq.name} · {(arq.size / 1024).toFixed(0)} KB</p>}
        </div>
        <label className="flex items-center gap-2 text-sm text-ink/70">
          <input type="checkbox" checked={simular} onChange={(e) => setSimular(e.target.checked)} className="h-4 w-4 accent-teal-700" />
          Simular primeiro (não grava — mostra o que seria importado)
        </label>
        {erro && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{erro}</p>}
        <Button onClick={enviar} disabled={busy || !arq} className="w-full">
          {busy ? "Importando…" : simular ? "Simular importação" : "Importar e gravar"}
        </Button>
      </div>
      {res && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={res.simulacao ? "warning" : "success"}>{res.simulacao ? "SIMULAÇÃO — nada gravado" : "IMPORTADO"}</Badge>
            <span className="font-mono text-xs text-ink/60">{res.arquivo}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            {[
              ["Lidas", res.lidas],
              ["Pacientes novos", res.pacientes_novos],
              ["Exames novos", res.exames_novos],
              ["Atualizados", res.atualizados],
              ["Duplicados", res.duplicados],
              ["Ignoradas", res.ignoradas],
            ].map(([k, v]) => (
              <div key={k as string} className="rounded-xl bg-sand px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/50">{k}</p>
                <p className="font-display text-lg font-extrabold text-sus-950">{v}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-ink/55">
            Catálogo: +{res.catalogo.tipos_novos} tipos, +{res.catalogo.especialidades_novas} especialidades, +{res.catalogo.procedimentos_novos} procedimentos.
          </p>
          {res.simulacao && res.exames_novos + res.pacientes_novos > 0 && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
              Conferiu? Desmarque “Simular” e envie de novo para gravar.
            </p>
          )}
          {res.erros.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-bold uppercase tracking-wide text-ink/50">Linhas com problema (máx 25)</p>
              <ul className="max-h-40 space-y-1 overflow-auto rounded-xl bg-sus-950 p-3 font-mono text-[11px] text-teal-100">
                {res.erros.map((e, i) => (
                  <li key={i}>linha {e.linha}: {e.motivo}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ---------- PEC: conexão e teste ----------
function AbaPec() {
  const [cfg, setCfg] = useState<Integracoes | null>(null);
  const [loading, setLoading] = useState(true);
  const [fonte, setFonte] = useState("auto");
  const [url, setUrl] = useState("");
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [dsn, setDsn] = useState("");
  const [busy, setBusy] = useState(false);
  const [testando, setTestando] = useState(false);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [teste, setTeste] = useState<{ ok: boolean; fonte_efetiva: string; detalhe: string; latencia_ms?: number } | null>(null);

  useEffect(() => {
    fetchIntegracoes()
      .then((c) => {
        setCfg(c);
        setFonte(c.pec_fonte);
        setUrl(c.pec_servidor_url);
        setUsuario(c.pec_usuario);
      })
      .catch((e: unknown) => setErro(msgErro(e, "Falha ao carregar.")))
      .finally(() => setLoading(false));
  }, []);

  async function salvar() {
    setErro("");
    setOk("");
    setBusy(true);
    try {
      const payload: Record<string, unknown> = { pec_fonte: fonte, pec_servidor_url: url.trim(), pec_usuario: usuario.trim() };
      if (senha) payload.pec_senha = senha;
      if (dsn.trim()) payload.pec_database_url = dsn.trim();
      setCfg(await savePec(payload));
      setSenha("");
      setDsn("");
      setOk("Conexão PEC salva. Fonte e banco efetivos atualizados.");
    } catch (e: unknown) {
      setErro(msgErro(e, "Erro ao salvar."));
    } finally {
      setBusy(false);
    }
  }

  async function testar() {
    setTestando(true);
    setTeste(null);
    try {
      setTeste(await testarPec());
    } catch (e: unknown) {
      setErro(msgErro(e, "Falha ao testar."));
    } finally {
      setTestando(false);
    }
  }

  if (loading) return <p className="text-sm text-ink/50">Carregando…</p>;

  return (
    <Card className="max-w-2xl p-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <p className="font-display text-base font-bold text-sus-950">Prontuário Eletrônico (e-SUS APS / PEC)</p>
        {cfg?.pec_database_configurada
          ? <Badge variant="success">banco configurado</Badge>
          : <Badge variant="warning">sem banco — mock/arquivos</Badge>}
      </div>
      <div className="space-y-3">
        <div>
          <Label>Fonte de dados</Label>
          <select value={fonte} onChange={(e) => setFonte(e.target.value)} className="w-full rounded-xl border border-sus-900/15 bg-white px-3.5 py-2.5 text-sm text-ink outline-none focus:border-sus-700">
            <option value="auto">auto (banco → arquivos → mock)</option>
            <option value="postgres">postgres (banco PEC readonly)</option>
            <option value="files">files (app/data/pec)</option>
            <option value="mock">mock (demonstração)</option>
          </select>
        </div>
        <div>
          <Label>URL do servidor PEC / e-SUS APS</Label>
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://pec.saude.exemplo:8443" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Usuário</Label>
            <Input value={usuario} onChange={(e) => setUsuario(e.target.value)} placeholder="readonly_user" autoComplete="off" />
          </div>
          <div>
            <Label>Senha {cfg?.pec_senha_configurada ? "(configurada — preencha p/ trocar)" : ""}</Label>
            <Input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="••••••" autoComplete="new-password" />
          </div>
        </div>
        <div>
          <Label>Banco PEC (DSN readonly) {cfg?.pec_database_configurada ? `— atual: ${cfg.pec_database_resumo}` : ""}</Label>
          <Input type="password" value={dsn} onChange={(e) => setDsn(e.target.value)} placeholder="postgresql://readonly:senha@host:5432/pec_db" autoComplete="new-password" />
          <p className="mt-1 text-[11px] text-ink/50">Somente leitura. Preencha para trocar; vazio mantém o atual. Sem isso, usa PEC_DATABASE_URL do servidor.</p>
        </div>
        {erro && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{erro}</p>}
        {ok && <p className="rounded-xl bg-teal/10 px-3 py-2 text-sm font-medium text-teal">{ok}</p>}
        <div className="flex flex-wrap gap-2">
          <Button onClick={salvar} disabled={busy}>{busy ? "Salvando…" : "Salvar conexão"}</Button>
          <button onClick={testar} disabled={testando} className="rounded-xl border border-sus-900/15 px-4 py-2.5 text-sm font-bold text-sus-900 hover:bg-sand disabled:opacity-50">
            {testando ? "Testando…" : "Testar conexão"}
          </button>
        </div>
        {teste && (
          <div className={`rounded-xl px-3 py-2 text-sm font-medium ${teste.ok ? "bg-teal/10 text-teal" : "bg-red-50 text-red-700"}`}>
            <Badge variant={teste.ok ? "success" : "danger"}>{teste.ok ? "OK" : "FALHA"}</Badge>{" "}
            fonte {teste.fonte_efetiva} · {teste.detalhe}
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------- RNDS: credenciais e certificado ----------
function AbaRnds() {
  const [cfg, setCfg] = useState<Integracoes | null>(null);
  const [loading, setLoading] = useState(true);
  const [amb, setAmb] = useState("homologacao");
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [cert, setCert] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [validando, setValidando] = useState(false);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [val, setVal] = useState<{
    ok: boolean; ambiente: string; link: string;
    certificado: { configurado: boolean; subject?: string; dias_restantes?: number; valido_ate?: string; expirado?: boolean };
    chave_configurada: boolean; pendencias: string[];
  } | null>(null);
  const certRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchIntegracoes()
      .then((c) => {
        setCfg(c);
        setAmb(c.rnds_ambiente);
        setClientId(c.rnds_client_id);
      })
      .catch((e: unknown) => setErro(msgErro(e, "Falha ao carregar.")))
      .finally(() => setLoading(false));
  }, []);

  function lerArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => setCert(String(r.result ?? ""));
    r.readAsText(f);
  }

  async function salvar() {
    setErro("");
    setOk("");
    setBusy(true);
    try {
      const payload: Record<string, unknown> = { rnds_ambiente: amb, rnds_client_id: clientId.trim() };
      if (secret) payload.rnds_secret = secret;
      if (cert.trim()) payload.rnds_cert_pem = cert.trim();
      if (key.trim()) payload.rnds_key_pem = key.trim();
      setCfg(await saveRnds(payload));
      setSecret("");
      setKey("");
      setOk("Credenciais RNDS salvas.");
    } catch (e: unknown) {
      setErro(msgErro(e, "Erro ao salvar."));
    } finally {
      setBusy(false);
    }
  }

  async function validar() {
    setValidando(true);
    setVal(null);
    try {
      setVal(await validarRnds());
    } catch (e: unknown) {
      setErro(msgErro(e, "Falha ao validar."));
    } finally {
      setValidando(false);
    }
  }

  if (loading) return <p className="text-sm text-ink/50">Carregando…</p>;

  return (
    <Card className="max-w-2xl p-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <p className="font-display text-base font-bold text-sus-950">RNDS — Rede Nacional de Dados em Saúde</p>
        <Badge variant={amb === "producao" ? "danger" : "warning"}>{amb === "producao" ? "PRODUÇÃO" : "HOMOLOGAÇÃO"}</Badge>
        {cfg?.rnds_cert_configurado ? <Badge variant="success">certificado enviado</Badge> : <Badge variant="warning">sem certificado</Badge>}
      </div>
      <div className="space-y-3">
        <div>
          <Label>Ambiente</Label>
          <select value={amb} onChange={(e) => setAmb(e.target.value)} className="w-full rounded-xl border border-sus-900/15 bg-white px-3.5 py-2.5 text-sm text-ink outline-none focus:border-sus-700">
            <option value="homologacao">Homologação</option>
            <option value="producao">Produção</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Client ID</Label>
            <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="client-id-rnds" autoComplete="off" />
          </div>
          <div>
            <Label>Secret {cfg?.rnds_secret_configurado ? "(configurado — preencha p/ trocar)" : ""}</Label>
            <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="••••••" autoComplete="new-password" />
          </div>
        </div>
        <div>
          <Label>Certificado digital X.509 (PEM)</Label>
          <textarea
            value={cert || ""}
            onChange={(e) => setCert(e.target.value)}
            placeholder={cfg?.rnds_cert_resumo ? `Atual: ${cfg.rnds_cert_resumo} (cole novo p/ trocar)` : "-----BEGIN CERTIFICATE----- …"}
            rows={4}
            className="w-full rounded-xl border border-sus-900/15 bg-white px-3.5 py-2.5 font-mono text-xs text-ink outline-none placeholder:text-ink/35 focus:border-sus-700"
          />
          <input ref={certRef} type="file" accept=".pem,.crt,.cer" onChange={lerArquivo} className="mt-1 text-xs text-ink/60" />
        </div>
        <div>
          <Label>Chave privada (PEM, opcional — nunca exibida)</Label>
          <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={cfg?.rnds_key_configurada ? "Configurada — preencha p/ trocar" : "-----BEGIN PRIVATE KEY----- …"} autoComplete="new-password" />
        </div>
        {erro && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{erro}</p>}
        {ok && <p className="rounded-xl bg-teal/10 px-3 py-2 text-sm font-medium text-teal">{ok}</p>}
        <div className="flex flex-wrap gap-2">
          <Button onClick={salvar} disabled={busy}>{busy ? "Salvando…" : "Salvar credenciais"}</Button>
          <button onClick={validar} disabled={validando} className="rounded-xl border border-sus-900/15 px-4 py-2.5 text-sm font-bold text-sus-900 hover:bg-sand disabled:opacity-50">
            {validando ? "Validando…" : "Validar e ver status"}
          </button>
        </div>
        {val && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant={val.ok ? "success" : "danger"}>link {val.link}</Badge>
              <span className="text-xs text-ink/60">ambiente {val.ambiente}</span>
              {val.certificado.configurado && typeof val.certificado.dias_restantes === "number" && (
                <span className="text-xs text-ink/60">
                  cert válido até {val.certificado.valido_ate} ({val.certificado.dias_restantes} dias)
                </span>
              )}
              {val.chave_configurada && <Badge variant="outline">chave OK</Badge>}
            </div>
            {val.pendencias.length > 0 && (
              <ul className="list-disc space-y-1 rounded-xl bg-amber-50 px-6 py-3 text-xs font-medium text-amber-900">
                {val.pendencias.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------- Aba: Laboratórios ----------
function AbaLaboratorios() {
  const [lista, setLista] = useState<{ id: number; nome: string; ativo: boolean }[]>([]);
  const [nome, setNome] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");

  async function carregar() {
    try {
      setLista(await labsListar());
    } catch {
      setErro("Falha ao carregar laboratórios.");
    }
  }
  useEffect(() => {
    carregar();
  }, []);

  async function adicionar() {
    if (nome.trim().length < 2) {
      setErro("Nome inválido.");
      return;
    }
    setBusy(true);
    setErro("");
    setOk("");
    try {
      await labsCriar(nome.trim(), true);
      setNome("");
      setOk("Laboratório adicionado.");
      await carregar();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? "Falha.";
      setErro(typeof d === "string" ? d : "Falha ao criar.");
    } finally {
      setBusy(false);
    }
  }

  async function remover(id: number) {
    if (!confirm("Desativar/remover este laboratório? As vagas atuais serão preservadas no histórico.")) return;
    setBusy(true);
    setErro("");
    setOk("");
    try {
      await labsRemover(id);
      setOk("Laboratório removido (inativado).");
      await carregar();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? "Falha.";
      setErro(typeof d === "string" ? d : "Falha ao remover.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="max-w-2xl p-6">
      <p className="mb-1 flex items-center gap-2 font-display text-base font-bold text-sus-950">
        <FlaskConical className="h-5 w-5" /> Laboratórios
      </p>
      <p className="mb-4 text-xs text-ink/55">
        Cadastre e remova laboratórios usados na agenda de vagas, solicitações e BPA.
      </p>
      <div className="mb-4 flex gap-2">
        <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do laboratório" />
        <Button disabled={busy} onClick={adicionar}>{busy ? "Salvando…" : "Adicionar"}</Button>
      </div>
      {erro && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
      {ok && <p className="mb-3 rounded-xl bg-teal/10 px-3 py-2 text-sm text-teal">{ok}</p>}
      <div className="overflow-x-auto rounded-xl border border-sus-900/10">
        <table className="w-full text-left text-sm">
          <thead><tr className="bg-sand text-xs uppercase text-sus-900/60">
            <th className="px-3 py-2">ID</th>
            <th className="px-3 py-2">Laboratório</th>
            <th className="px-3 py-2">Ativo</th>
            <th className="px-3 py-2 text-right">Ações</th>
          </tr></thead>
          <tbody>
            {lista.map((l) => (
              <tr key={l.id} className="border-t border-sus-900/5">
                <td className="px-3 py-2 font-mono text-xs">{l.id}</td>
                <td className="px-3 py-2 font-medium">{l.nome}</td>
                <td className="px-3 py-2 text-xs">{l.ativo ? "Sim" : "Não"}</td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => remover(l.id)} className="rounded-lg px-2 py-1 text-xs font-bold text-red-700 hover:bg-red-50">
                    Remover
                  </button>
                </td>
              </tr>
            ))}
            {lista.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-ink/45">Nenhum laboratório.</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
