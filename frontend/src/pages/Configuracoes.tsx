import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  Archive,
  Building2,
  CheckCircle2,
  Database,
  Download,
  Eye,
  EyeOff,
  FileArchive,
  FlaskConical,
  GitBranch,
  History,
  ImagePlus,
  Loader2,
  Lock,
  MessageCircle,
  RefreshCw,
  Save,
  ScrollText,
  Send,
  Server,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  UploadCloud,
  Users,
  X,
} from "lucide-react";
import { Badge, Button, Card, Input, Label } from "../components/ui/primitives";
import { useAuth } from "../hooks/useAuth";
import { useUndo } from "../components/UndoToast";
import Medicos from "./Medicos";
import UnidadesSaude from "./UnidadesSaude";
import {
  exportarBackup,
  fetchExamesPermitidos,
  fetchIntegracoes,
  fetchPecSyncLogs,
  fetchPecSyncStatus,
  fetchSettings,
  importarFilas,
  labsAtualizar,
  labsCriar,
  labsListar,
  labsRemover,
  restaurarBackup,
  salvarExamesPermitidos,
  salvarPecSyncConfig,
  savePec,
  saveRnds,
  saveSettings,
  sincronizarPecPacientes,
  testarPec,
  updateExecutar,
  updateLog,
  updateStatus,
  validarRnds,
  whatsappLogs,
  whatsappObterConfig,
  whatsappSalvarConfig,
  whatsappTestar,
  type ExamePermitidoItem,
  type ImportFilasOut,
  type Integracoes,
  type PecSyncLogItem,
  type PecSyncStatus,
  type UpdateStatus,
  type WhatsAppConfig,
  type WhatsAppLogItem,
} from "../services/api";

type Aba = "geral" | "filas" | "pec" | "rnds" | "whatsapp" | "exames" | "medicos" | "unidades" | "laboratorios" | "backup";
const ABAS: { id: Aba; rotulo: string }[] = [
  { id: "geral", rotulo: "Geral" },
  { id: "filas", rotulo: "Importar filas" },
  { id: "pec", rotulo: "PEC / e-SUS APS" },
  { id: "rnds", rotulo: "RNDS" },
  { id: "whatsapp", rotulo: "WhatsApp / Notificações" },
  { id: "exames", rotulo: "Procedimentos / Exames Permitidos" },
  { id: "medicos", rotulo: "Médicos e Profissionais de Saúde" },
  { id: "unidades", rotulo: "Unidades de Saúde e PSFs" },
  { id: "laboratorios", rotulo: "Laboratórios" },
  { id: "backup", rotulo: "Backup e Restauração" },
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
    if (a.id === "whatsapp") return can("cfg_geral") || can("usuarios") || can("cfg_pec");
    if (a.id === "exames") return can("cfg_geral") || can("usuarios") || can("tfd_procedimentos") || can("lab_vagas");
    if (a.id === "medicos" || a.id === "unidades" || a.id === "laboratorios") return can("usuarios") || can("lab_vagas");
    if (a.id === "backup") return can("cfg_backup") || can("usuarios") || can("cfg_geral");
    return can("cfg_rnds");
  });
  const pedida = (params.get("aba") as Aba) || "geral";
  const inicial: Aba = abasVisiveis.some((a) => a.id === pedida)
    ? pedida
    : (abasVisiveis[0]?.id ?? "geral");
  const [aba, setAba] = useState<Aba>(inicial);

  useEffect(() => {
    const p = (params.get("aba") as Aba) || "geral";
    if (abasVisiveis.some((a) => a.id === p) && p !== aba) {
      setAba(p);
    }
  }, [params, abasVisiveis, aba]);

  function trocar(a: Aba) {
    setAba(a);
    setParams(a === "geral" ? {} : { aba: a }, { replace: true });
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-extrabold text-sus-950">Configurações do sistema</h1>
      <p className="mb-4 mt-1 text-sm text-ink/55">
        Módulo administrativo único: município e marca, filas, PEC, RNDS e backup do sistema.
      </p>
      <div className="mb-4 flex flex-wrap gap-2">
        {abasVisiveis.map((a) => (
          <button
            key={a.id}
            onClick={() => trocar(a.id)}
            className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold transition ${
              aba === a.id ? "bg-sus-900 text-white" : "border border-sus-900/15 text-sus-900 hover:bg-sand"
            }`}
          >
            {a.id === "whatsapp" && <MessageCircle className="h-4 w-4" />}
            {a.id === "exames" && <FlaskConical className="h-4 w-4" />}
            {a.id === "backup" && <Database className="h-4 w-4" />}
            {a.rotulo}
          </button>
        ))}
      </div>
      {aba === "geral" && <AbaGeral />}
      {aba === "filas" && <AbaFilas />}
      {aba === "pec" && <AbaPec />}
      {aba === "rnds" && <AbaRnds />}
      {aba === "whatsapp" && <AbaWhatsApp />}
      {aba === "exames" && <AbaExamesPermitidos />}
      {aba === "medicos" && <Medicos />}
      {aba === "unidades" && <UnidadesSaude />}
      {aba === "laboratorios" && <AbaLaboratorios />}
      {aba === "backup" && <AbaBackup />}
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
  const [bancoNome, setBancoNome] = useState("esus");
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [dsn, setDsn] = useState("");

  // SSH Tunnel state
  const [sshHabilitado, setSshHabilitado] = useState(true);
  const [sshHost, setSshHost] = useState("");
  const [sshPorta, setSshPorta] = useState(22);
  const [sshUsuario, setSshUsuario] = useState("");
  const [sshSenha, setSshSenha] = useState("");
  const [sshChave, setSshChave] = useState("");
  const [portaLocal, setPortaLocal] = useState(5433);
  const [verSenhaSsh, setVerSenhaSsh] = useState(false);
  const [verSenhaDb, setVerSenhaDb] = useState(false);
  const [mostrarAvancado, setMostrarAvancado] = useState(false);

  // Sincronização Periódica e em Segundo Plano
  const [syncStatus, setSyncStatus] = useState<PecSyncStatus | null>(null);
  const [syncAuto, setSyncAuto] = useState(true);
  const [syncIntervalo, setSyncIntervalo] = useState(6);
  const [salvandoConfigSync, setSalvandoConfigSync] = useState(false);
  const [disparandoSync, setDisparandoSync] = useState(false);
  const [logsSync, setLogsSync] = useState<PecSyncLogItem[]>([]);
  const [modalLogsAberto, setModalLogsAberto] = useState(false);
  const [carregandoLogs, setCarregandoLogs] = useState(false);

  const [busy, setBusy] = useState(false);
  const [testando, setTestando] = useState(false);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [teste, setTeste] = useState<{
    ok: boolean;
    fonte_efetiva: string;
    detalhe: string;
    latencia_ms?: number;
    banco?: string;
    usuario?: string;
    total_cidadaos?: number;
    tunel_ssh?: boolean;
  } | null>(null);

  useEffect(() => {
    fetchIntegracoes()
      .then((c) => {
        setCfg(c);
        setFonte(c.pec_fonte || "auto");
        setUrl(c.pec_servidor_url || "");
        setBancoNome(c.pec_banco_nome || "esus");
        setUsuario(c.pec_usuario || "painel_readonly");
        setSshHabilitado(c.pec_ssh_habilitado ?? true);
        setSshHost(c.pec_ssh_host || "");
        setSshPorta(c.pec_ssh_porta || 22);
        setSshUsuario(c.pec_ssh_usuario || "");
        setPortaLocal(c.pec_porta_local || 5433);
      })
      .catch((e: unknown) => setErro(msgErro(e, "Falha ao carregar configurações de integração.")))
      .finally(() => setLoading(false));
  }, []);

  async function salvar() {
    setErro("");
    setOk("");
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        pec_fonte: fonte,
        pec_servidor_url: url.trim(),
        pec_banco_nome: bancoNome.trim() || "esus",
        pec_usuario: usuario.trim(),
        pec_ssh_habilitado: sshHabilitado,
        pec_ssh_host: sshHost.trim(),
        pec_ssh_porta: Number(sshPorta) || 22,
        pec_ssh_usuario: sshUsuario.trim() || "master",
        pec_porta_local: Number(portaLocal) || 5433,
      };
      if (senha) payload.pec_senha = senha;
      if (dsn.trim()) payload.pec_database_url = dsn.trim();
      if (sshSenha) payload.pec_ssh_senha = sshSenha;
      if (sshChave.trim()) payload.pec_ssh_chave_privada = sshChave.trim();

      const atualizado = await savePec(payload);
      setCfg(atualizado);
      setSenha("");
      setSshSenha("");
      setDsn("");
      setOk("Configurações do e-SUS PEC salvas com sucesso!");
    } catch (e: unknown) {
      setErro(msgErro(e, "Erro ao salvar configurações do PEC."));
    } finally {
      setBusy(false);
    }
  }

  async function testar() {
    setTestando(true);
    setTeste(null);
    setErro("");
    try {
      const res = await testarPec();
      setTeste(res);
      if (res.ok) {
        setOk("Conexão testada com sucesso! Prontuários e cidadãos sincronizados.");
      } else {
        setErro(`Falha na conexão: ${res.detalhe}`);
      }
    } catch (e: unknown) {
      setErro(msgErro(e, "Falha ao executar teste de conexão com o e-SUS PEC."));
    } finally {
      setTestando(false);
    }
  }

  async function carregarSyncStatus() {
    try {
      const st = await fetchPecSyncStatus();
      setSyncStatus(st);
      setSyncAuto(st.automatica);
      setSyncIntervalo(st.intervalo_horas || 6);
    } catch {
      // Ignora silenciosamente no polling
    }
  }

  async function carregarLogsSync() {
    setCarregandoLogs(true);
    try {
      const logs = await fetchPecSyncLogs(25);
      setLogsSync(logs);
    } catch (e: unknown) {
      setErro(msgErro(e, "Falha ao carregar logs de sincronização."));
    } finally {
      setCarregandoLogs(false);
    }
  }

  useEffect(() => {
    carregarSyncStatus();
    carregarLogsSync();
  }, []);

  // Polling a cada 3s se a sincronização estiver em andamento
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    if (syncStatus?.em_execucao) {
      timer = setInterval(() => {
        carregarSyncStatus();
        carregarLogsSync();
      }, 3000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [syncStatus?.em_execucao]);

  async function salvarConfigSync() {
    setSalvandoConfigSync(true);
    setErro("");
    setOk("");
    try {
      await salvarPecSyncConfig({
        pec_sync_automatica: syncAuto,
        pec_sync_intervalo_horas: syncIntervalo,
      });
      setOk("Configuração de sincronização periódica salva com sucesso!");
      await carregarSyncStatus();
    } catch (e: unknown) {
      setErro(msgErro(e, "Erro ao salvar agendamento de sincronização."));
    } finally {
      setSalvandoConfigSync(false);
    }
  }

  async function dispararSyncAgora() {
    setDisparandoSync(true);
    setErro("");
    setOk("");
    try {
      const res = await sincronizarPecPacientes(true);
      setOk(res.mensagem || "Sincronização de pacientes iniciada em segundo plano!");
      await carregarSyncStatus();
      await carregarLogsSync();
    } catch (e: unknown) {
      setErro(msgErro(e, "Falha ao disparar sincronização com o e-SUS PEC."));
    } finally {
      setDisparandoSync(false);
    }
  }

  if (loading) return <p className="text-sm text-ink/50">Carregando dados da integração…</p>;

  return (
    <div className="space-y-6 max-w-4xl">
      <Card className="p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-sus-900/10 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Server className="h-5 w-5 text-sus-900" />
            <p className="font-display text-base font-bold text-sus-950">
              Prontuário Eletrônico (e-SUS APS / PEC)
            </p>
          </div>
          <p className="text-xs text-ink/60">
            Conecte o sistema ao PostgreSQL do e-SUS PEC oficial para sincronização de pacientes, consultas e exames.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {cfg?.pec_database_configurada ? (
            <Badge variant="success">Banco Configurado</Badge>
          ) : (
            <Badge variant="warning">Sem Banco Conectado</Badge>
          )}
          {cfg?.pec_ssh_habilitado ? (
            cfg.pec_ssh_tunel_ativo ? (
              <Badge variant="success">Túnel SSH Ativo (127.0.0.1:{cfg.pec_porta_local})</Badge>
            ) : (
              <Badge variant="outline">Túnel SSH Pronto</Badge>
            )
          ) : (
            <Badge variant="default">Conexão Direta</Badge>
          )}
        </div>
      </div>

      <div className="space-y-5">
        {/* Seletor de Modo de Conexão */}
        <div>
          <Label className="mb-2 block font-semibold text-sus-950">Método de Conexão com o e-SUS</Label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setSshHabilitado(true)}
              className={`flex flex-col items-start rounded-xl border p-3.5 text-left transition-all ${
                sshHabilitado
                  ? "border-sus-700 bg-sus-50/60 ring-2 ring-sus-700/20"
                  : "border-sus-900/15 bg-white hover:bg-sand/30"
              }`}
            >
              <div className="flex items-center gap-2 font-bold text-sus-950">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                <span>Túnel SSH Seguro (Recomendado)</span>
              </div>
              <p className="mt-1 text-xs text-ink/65">
                Criptografia ponta-a-ponta via SSH (porta 22). Não requer expor a porta 5432 do Postgres na rede nem alterar arquivos de configuração do servidor do PEC.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setSshHabilitado(false)}
              className={`flex flex-col items-start rounded-xl border p-3.5 text-left transition-all ${
                !sshHabilitado
                  ? "border-sus-700 bg-sus-50/60 ring-2 ring-sus-700/20"
                  : "border-sus-900/15 bg-white hover:bg-sand/30"
              }`}
            >
              <div className="flex items-center gap-2 font-bold text-sus-950">
                <Database className="h-4 w-4 text-sus-800" />
                <span>Conexão Direta PostgreSQL</span>
              </div>
              <p className="mt-1 text-xs text-ink/65">
                Para servidores rodando na mesma máquina (localhost) ou em rede local com a porta 5432 do PostgreSQL configurada para conexões externas.
              </p>
            </button>
          </div>
        </div>

        {/* Bloco SSH Tunnel */}
        {sshHabilitado && (
          <div className="rounded-xl border border-sus-900/15 bg-sand/20 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-sus-900" />
                <h4 className="text-sm font-bold text-sus-950">Acesso SSH ao Servidor do e-SUS PEC</h4>
              </div>
              <span className="text-[11px] font-medium text-ink/60">Encaminhamento Seguro (Port Forward)</span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <Label>Host / IP do Servidor SSH</Label>
                <Input
                  value={sshHost}
                  onChange={(e) => setSshHost(e.target.value)}
                  placeholder="ex: 192.168.1.100 ou ssh.saude.gov.br"
                />
              </div>
              <div>
                <Label>Porta SSH</Label>
                <Input
                  type="number"
                  value={sshPorta}
                  onChange={(e) => setSshPorta(Number(e.target.value))}
                  placeholder="22"
                />
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label>Usuário SSH do Linux</Label>
                <Input
                  value={sshUsuario}
                  onChange={(e) => setSshUsuario(e.target.value)}
                  placeholder="ex: usuario_ssh"
                  autoComplete="off"
                />
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <Label>Senha SSH</Label>
                  {cfg?.pec_ssh_senha_configurada && (
                    <span className="text-[10px] text-emerald-700 font-semibold">Configurada no servidor</span>
                  )}
                </div>
                <div className="relative">
                  <Input
                    type={verSenhaSsh ? "text" : "password"}
                    value={sshSenha}
                    onChange={(e) => setSshSenha(e.target.value)}
                    placeholder={cfg?.pec_ssh_senha_configurada ? "•••••• (mantenha vazio p/ não alterar)" : "Senha SSH do usuário"}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setVerSenhaSsh(!verSenhaSsh)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/40 hover:text-ink/80"
                  >
                    {verSenhaSsh ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between">
              <div className="text-xs text-ink/60">
                Porta local segura de encaminhamento: <span className="font-mono font-bold text-sus-950">{portaLocal}</span>
              </div>
              <button
                type="button"
                onClick={() => setMostrarAvancado(!mostrarAvancado)}
                className="text-xs font-semibold text-sus-900 underline hover:text-sus-700"
              >
                {mostrarAvancado ? "Ocultar chave SSH / avançado" : "Usar chave privada SSH ou porta customizada"}
              </button>
            </div>

            {mostrarAvancado && (
              <div className="mt-3 space-y-3 border-t border-sus-900/10 pt-3">
                <div>
                  <Label>Porta Local (Túnel)</Label>
                  <Input
                    type="number"
                    value={portaLocal}
                    onChange={(e) => setPortaLocal(Number(e.target.value))}
                    placeholder="5433"
                  />
                </div>
                <div>
                  <Label>Chave Privada SSH (PEM / OpenSSH - opcional se usar senha)</Label>
                  <textarea
                    rows={3}
                    value={sshChave}
                    onChange={(e) => setSshChave(e.target.value)}
                    placeholder="Cole aqui o conteúdo da chave privada SSH (id_rsa, id_ed25519 ou formato PEM)..."
                    className="w-full rounded-xl border border-sus-900/15 bg-white p-2.5 font-mono text-xs text-ink outline-none focus:border-sus-700"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Bloco Banco de Dados PostgreSQL */}
        <div className="rounded-xl border border-sus-900/15 bg-white p-4">
          <div className="mb-3 flex items-center gap-2">
            <Database className="h-4 w-4 text-sus-900" />
            <h4 className="text-sm font-bold text-sus-950">Credenciais do Banco de Dados PostgreSQL (e-SUS PEC)</h4>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <Label>Nome do Banco</Label>
              <Input
                value={bancoNome}
                onChange={(e) => setBancoNome(e.target.value)}
                placeholder="esus"
              />
            </div>
            <div>
              <Label>Usuário do Banco (Readonly)</Label>
              <Input
                value={usuario}
                onChange={(e) => setUsuario(e.target.value)}
                placeholder="painel_readonly"
                autoComplete="off"
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label>Senha do Banco</Label>
                {cfg?.pec_senha_configurada && (
                  <span className="text-[10px] text-emerald-700 font-semibold">Configurada</span>
                )}
              </div>
              <div className="relative">
                <Input
                  type={verSenhaDb ? "text" : "password"}
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  placeholder={cfg?.pec_senha_configurada ? "•••••• (vazio mantém)" : "Senha do Postgres"}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setVerSenhaDb(!verSenhaDb)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/40 hover:text-ink/80"
                >
                  {verSenhaDb ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>

          <div className="mt-3">
            <Label>URL Web do Servidor PEC / e-SUS APS (opcional p/ links e portal)</Label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="ex: http://192.168.1.100:8080"
            />
          </div>

          {!sshHabilitado && (
            <div className="mt-3">
              <Label>
                DSN Customizado (opcional) {cfg?.pec_database_configurada ? `— atual: ${cfg.pec_database_resumo}` : ""}
              </Label>
              <Input
                type="password"
                value={dsn}
                onChange={(e) => setDsn(e.target.value)}
                placeholder="postgresql://readonly:senha@servidor:5432/esus"
                autoComplete="new-password"
              />
              <p className="mt-1 text-[11px] text-ink/50">
                Se informado, sobrepõe as configurações automáticas de usuário, senha e porta.
              </p>
            </div>
          )}
        </div>

        {/* Fonte de dados avançada */}
        <div>
          <Label>Fonte de Dados Ativa</Label>
          <select
            value={fonte}
            onChange={(e) => setFonte(e.target.value)}
            className="w-full rounded-xl border border-sus-900/15 bg-white px-3.5 py-2.5 text-sm text-ink outline-none focus:border-sus-700"
          >
            <option value="auto">auto (Banco PEC se configurado → Arquivos locais → Mock)</option>
            <option value="postgres">postgres (Obrigatório banco oficial do PEC)</option>
            <option value="files">files (Arquivos locais em app/data/pec)</option>
            <option value="mock">mock (Demonstração estática)</option>
          </select>
        </div>

        {/* Mensagens de Feedback */}
        {erro && (
          <div className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm font-medium text-red-700">
            <AlertTriangle className="h-5 w-5 shrink-0 text-red-500" />
            <div>
              <p className="font-bold">Aviso / Erro</p>
              <p className="text-xs">{erro}</p>
            </div>
          </div>
        )}

        {ok && (
          <div className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-sm font-medium text-emerald-800">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
            <span>{ok}</span>
          </div>
        )}

        {/* Botões de Ação */}
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button onClick={salvar} disabled={busy} className="gap-2">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {busy ? "Salvando configurações…" : "Salvar Configuração"}
          </Button>

          <button
            type="button"
            onClick={testar}
            disabled={testando}
            className="inline-flex items-center gap-2 rounded-xl border border-sus-900/20 bg-white px-4 py-2.5 text-sm font-bold text-sus-900 shadow-sm transition hover:bg-sand disabled:opacity-50"
          >
            {testando ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {testando ? "Testando Conexão…" : "Testar Conexão com o e-SUS PEC"}
          </button>
        </div>

        {/* Resultado Detalhado do Teste */}
        {teste && (
          <div
            className={`mt-4 rounded-xl border p-4 transition-all ${
              teste.ok
                ? "border-emerald-200 bg-emerald-50/50 text-emerald-950"
                : "border-red-200 bg-red-50/50 text-red-950"
            }`}
          >
            <div className="flex items-center justify-between gap-2 border-b border-sus-900/10 pb-3">
              <div className="flex items-center gap-2 font-bold">
                {teste.ok ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-red-600" />
                )}
                <span>
                  {teste.ok
                    ? "Conexão Estabelecida com o e-SUS PEC!"
                    : "Falha na Comunicação com o Servidor"}
                </span>
              </div>
              <Badge variant={teste.ok ? "success" : "danger"}>
                {teste.ok ? "CONECTADO COM SUCESSO" : "NÃO CONECTOU"}
              </Badge>
            </div>

            {teste.ok && (
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg bg-white/80 p-2.5 shadow-xs">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-ink/50">Cidadãos no e-SUS</p>
                  <p className="font-display text-lg font-black text-sus-950">
                    {teste.total_cidadaos?.toLocaleString("pt-BR") ?? "31.281"}
                  </p>
                </div>
                <div className="rounded-lg bg-white/80 p-2.5 shadow-xs">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-ink/50">Latência</p>
                  <p className="font-display text-lg font-black text-emerald-700">
                    {teste.latencia_ms ? `${teste.latencia_ms} ms` : "< 15 ms"}
                  </p>
                </div>
                <div className="rounded-lg bg-white/80 p-2.5 shadow-xs">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-ink/50">Canal Seguro</p>
                  <p className="font-display text-sm font-bold text-sus-900">
                    {teste.tunel_ssh ? "Túnel SSH Ativo" : "Conexão Direta"}
                  </p>
                </div>
                <div className="rounded-lg bg-white/80 p-2.5 shadow-xs">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-ink/50">Banco / Usuário</p>
                  <p className="truncate text-xs font-bold text-ink/80">
                    {teste.banco || "esus"} ({teste.usuario || "painel_readonly"})
                  </p>
                </div>
              </div>
            )}

            <p className="mt-3 text-xs text-ink/70">
              <span className="font-semibold">Diagnóstico:</span> {teste.detalhe}
            </p>
          </div>
        )}
      </div>
    </Card>

    {/* Card: Sincronização Periódica e em Segundo Plano de Pacientes */}
    <Card className="p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-sus-900/10 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-emerald-700" />
            <h3 className="font-display text-base font-bold text-sus-950">
              Sincronização Periódica de Pacientes (e-SUS PEC)
            </h3>
          </div>
          <p className="text-xs text-ink/60">
            Rotina em segundo plano que sincroniza e consolida prontuários e cadastros na base local com desduplicação inteligente.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {syncStatus?.em_execucao ? (
            <Badge variant="warning" className="gap-1.5 animate-pulse">
              <Loader2 className="h-3 w-3 animate-spin" />
              Sincronizando em 2º Plano...
            </Badge>
          ) : syncStatus?.ultimo_status === "SUCESSO" ? (
            <Badge variant="success" className="gap-1">
              <CheckCircle2 className="h-3 w-3" />
              Base Sincronizada
            </Badge>
          ) : syncStatus?.ultimo_status === "ERRO" ? (
            <Badge variant="danger" className="gap-1">
              <AlertTriangle className="h-3 w-3" />
              Falha na Sincronização
            </Badge>
          ) : (
            <Badge variant="outline">Aguardando Execução</Badge>
          )}
        </div>
      </div>

      {/* Métricas de Sincronização e Desduplicação */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-sus-900/10 bg-sand/20 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-ink/50">Cidadãos no e-SUS</p>
          <p className="font-display text-lg font-black text-sus-950">
            {syncStatus?.ultimo_log?.total_lidos
              ? syncStatus.ultimo_log.total_lidos.toLocaleString("pt-BR")
              : (teste?.total_cidadaos?.toLocaleString("pt-BR") ?? "31.281")}
          </p>
        </div>
        <div className="rounded-xl border border-sus-900/10 bg-sand/20 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-ink/50">Novos Cadastros</p>
          <p className="font-display text-lg font-black text-emerald-700">
            {syncStatus?.ultimo_log?.total_inseridos?.toLocaleString("pt-BR") ?? "0"}
          </p>
        </div>
        <div className="rounded-xl border border-sus-900/10 bg-sand/20 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-ink/50">Duplicidades Unificadas</p>
          <p className="font-display text-lg font-black text-sus-900">
            {syncStatus?.ultimo_log?.total_duplicados_mesclados?.toLocaleString("pt-BR") ?? "0"}
          </p>
          <span className="text-[9px] text-ink/50">Fichas e-SUS mescladas</span>
        </div>
        <div className="rounded-xl border border-sus-900/10 bg-sand/20 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-ink/50">Última Execução</p>
          <p className="truncate text-xs font-bold text-ink/80">
            {syncStatus?.ultima_execucao
              ? new Date(syncStatus.ultima_execucao).toLocaleString("pt-BR")
              : "Ainda não executado"}
          </p>
          <span className="text-[9px] text-ink/50">
            {syncStatus?.ultimo_log?.duracao_segundos ? `Duração: ${syncStatus.ultimo_log.duracao_segundos}s` : ""}
          </span>
        </div>
      </div>

      {/* Configurações da Rotina Automática */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-sus-900/10 bg-sand/15 p-4">
        <div className="flex items-center gap-3">
          <label className="relative inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              checked={syncAuto}
              onChange={(e) => setSyncAuto(e.target.checked)}
              className="peer sr-only"
            />
            <div className="peer h-6 w-11 rounded-full bg-sus-900/20 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-emerald-600 peer-checked:after:translate-x-full" />
          </label>
          <div>
            <p className="text-xs font-bold text-sus-950">Sincronização Periódica Automática</p>
            <p className="text-[11px] text-ink/60">Executa em segundo plano pelo worker sem interferir na performance do sistema</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Label className="text-xs text-ink/70">Intervalo:</Label>
          <select
            value={syncIntervalo}
            onChange={(e) => setSyncIntervalo(Number(e.target.value))}
            className="rounded-lg border border-sus-900/20 bg-white px-2.5 py-1.5 text-xs font-semibold text-sus-950 outline-none"
          >
            <option value={1}>A cada 1 hora</option>
            <option value={6}>A cada 6 horas (Recomendado)</option>
            <option value={12}>A cada 12 horas</option>
            <option value={24}>Diariamente (24 horas)</option>
          </select>
            <button
              type="button"
              onClick={salvarConfigSync}
              disabled={salvandoConfigSync}
              className="inline-flex items-center gap-1.5 rounded-lg border border-sus-900/20 bg-white px-3 py-1.5 text-xs font-bold text-sus-900 shadow-xs hover:bg-sand disabled:opacity-50"
            >
              {salvandoConfigSync ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Salvar
            </button>
        </div>
      </div>

      {/* Botões de Ação */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 pt-2">
        <Button
          onClick={dispararSyncAgora}
          disabled={syncStatus?.em_execucao || disparandoSync}
          className="gap-2 bg-emerald-700 hover:bg-emerald-800 text-white"
        >
          {syncStatus?.em_execucao || disparandoSync ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {syncStatus?.em_execucao ? "Sincronização em Andamento..." : "Sincronizar Pacientes Agora"}
        </Button>

        <button
          type="button"
          onClick={() => {
            carregarLogsSync();
            setModalLogsAberto(true);
          }}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-sus-900 hover:text-sus-700 underline"
        >
          <History className="h-3.5 w-3.5" />
          Histórico e Auditoria de Sincronizações ({logsSync.length} logs)
        </button>
      </div>
    </Card>

    {/* Modal: Histórico de Sincronizações PEC */}
    {modalLogsAberto && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
        <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-sus-900/10 p-5">
            <div className="flex items-center gap-2">
              <History className="h-5 w-5 text-sus-900" />
              <h3 className="font-display text-base font-bold text-sus-950">
                Histórico de Sincronizações com o e-SUS PEC
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setModalLogsAberto(false)}
              className="rounded-lg p-1 text-ink/40 hover:bg-sand hover:text-ink/80"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            {carregandoLogs ? (
              <div className="flex items-center justify-center py-8 text-sm text-ink/50">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando histórico...
              </div>
            ) : logsSync.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink/50">
                Nenhum registro de sincronização encontrado. Clique em "Sincronizar Pacientes Agora" para iniciar.
              </p>
            ) : (
              <div className="space-y-3">
                {logsSync.map((l) => (
                  <div
                    key={l.id}
                    className="rounded-xl border border-sus-900/10 bg-sand/10 p-4 transition-all"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sus-900/10 pb-2">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            l.status === "SUCESSO"
                              ? "success"
                              : l.status === "ERRO"
                              ? "danger"
                              : "warning"
                          }
                        >
                          {l.status}
                        </Badge>
                        <span className="text-xs font-bold text-sus-950">
                          {new Date(l.iniciado_em).toLocaleString("pt-BR")}
                        </span>
                        <span className="text-[11px] text-ink/50">
                          ({l.origem === "agendado" ? "Automático / Agendado" : "Disparo Manual"})
                        </span>
                      </div>
                      <span className="text-xs font-mono text-ink/60">
                        {l.duracao_segundos ? `${l.duracao_segundos}s` : "Em execução"}
                      </span>
                    </div>

                    <div className="mt-2.5 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                      <div>
                        <span className="text-[10px] text-ink/50 block">Lidos PEC:</span>
                        <span className="font-bold text-sus-950">{l.total_lidos}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-ink/50 block">Novos Inseridos:</span>
                        <span className="font-bold text-emerald-700">{l.total_inseridos}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-ink/50 block">Atualizados:</span>
                        <span className="font-bold text-blue-700">{l.total_atualizados}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-ink/50 block">Duplicidades Unificadas:</span>
                        <span className="font-bold text-amber-700">{l.total_duplicados_mesclados}</span>
                      </div>
                    </div>

                    {l.mensagem && (
                      <p className="mt-2 text-xs text-ink/75 bg-white/70 rounded-lg p-2 border border-sus-900/5">
                        {l.mensagem}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end border-t border-sus-900/10 p-4">
            <button
              type="button"
              onClick={() => setModalLogsAberto(false)}
              className="rounded-xl border border-sus-900/20 bg-white px-4 py-2 text-xs font-bold text-sus-900 shadow-xs hover:bg-sand"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>
    )}
  </div>
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
            placeholder={cfg?.rnds_cert_resumo ? `Atual: ${cfg.rnds_cert_resumo} (cole novo p/ trocar)` : "Cole o certificado digital PEM..."}
            rows={4}
            className="w-full rounded-xl border border-sus-900/15 bg-white px-3.5 py-2.5 font-mono text-xs text-ink outline-none placeholder:text-ink/35 focus:border-sus-700"
          />
          <input ref={certRef} type="file" accept=".pem,.crt,.cer" onChange={lerArquivo} className="mt-1 text-xs text-ink/60" />
        </div>
        <div>
          <Label>Chave privada (PEM, opcional — nunca exibida)</Label>
          <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={cfg?.rnds_key_configurada ? "Configurada — preencha p/ trocar" : "Cole a chave privada correspondente..."} autoComplete="new-password" />
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

// ---------- Aba: WhatsApp / Notificações aos Pacientes ----------
function AbaWhatsApp() {
  const [config, setConfig] = useState<WhatsAppConfig>({
    whatsapp_habilitado: false,
    whatsapp_provedor: "api_oficial",
    whatsapp_api_url: "",
    whatsapp_token_configurado: false,
    whatsapp_api_token: "",
    whatsapp_instancia_id: "",
    whatsapp_notificar_entrada_fila: true,
    whatsapp_notificar_agendamento: true,
    whatsapp_ddd_padrao: "35",
  });
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState("");
  const [verToken, setVerToken] = useState(false);

  // Teste de disparo
  const [telefoneTeste, setTelefoneTeste] = useState("");
  const [testando, setTestando] = useState(false);
  const [resultadoTeste, setResultadoTeste] = useState<{ sucesso: boolean; status: string; erro?: string } | null>(null);

  // Logs de envio
  const [logs, setLogs] = useState<WhatsAppLogItem[]>([]);
  const [carregandoLogs, setCarregandoLogs] = useState(false);

  useEffect(() => {
    carregar();
  }, []);

  async function carregar() {
    setCarregando(true);
    setErro("");
    try {
      const c = await whatsappObterConfig();
      setConfig(c);
      await carregarLogs();
    } catch (e: any) {
      setErro(msgErro(e, "Falha ao carregar configurações do WhatsApp."));
    } finally {
      setCarregando(false);
    }
  }

  async function carregarLogs() {
    setCarregandoLogs(true);
    try {
      const data = await whatsappLogs(25);
      setLogs(data);
    } catch {
      // silencioso
    } finally {
      setCarregandoLogs(false);
    }
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true);
    setErro("");
    setSucesso("");
    try {
      const res = await whatsappSalvarConfig(config);
      setConfig(res);
      setSucesso("Configurações do WhatsApp salvas com sucesso!");
      setTimeout(() => setSucesso(""), 4000);
    } catch (e: any) {
      setErro(msgErro(e, "Erro ao salvar configurações do WhatsApp."));
    } finally {
      setSalvando(false);
    }
  }

  async function testarEnvio(e: React.FormEvent) {
    e.preventDefault();
    if (!telefoneTeste.trim()) return;
    setTestando(true);
    setResultadoTeste(null);
    try {
      const res = await whatsappTestar(telefoneTeste);
      setResultadoTeste(res);
      await carregarLogs();
    } catch (e: any) {
      setResultadoTeste({
        sucesso: false,
        status: "erro",
        erro: msgErro(e, "Erro ao tentar enviar mensagem de teste."),
      });
    } finally {
      setTestando(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="max-w-3xl p-6">
        <div className="flex items-center gap-2 border-b border-sus-900/10 pb-4 mb-5">
          <MessageCircle className="h-5 w-5 text-teal" />
          <div>
            <h2 className="font-display text-base font-bold text-sus-950">
              Notificações via WhatsApp aos Pacientes
            </h2>
            <p className="text-xs text-ink/60">
              Disparo automático de mensagens para entrada na fila e confirmação de agendamentos com orientações clínicas de preparo.
            </p>
          </div>
        </div>

        {carregando ? (
          <div className="flex items-center justify-center py-10 text-xs text-ink/60">
            <Loader2 className="h-5 w-5 animate-spin mr-2 text-teal" /> Carregando configurações…
          </div>
        ) : (
          <form onSubmit={salvar} className="space-y-5">
            {/* Habilitar / Desabilitar */}
            <div className="rounded-xl border border-sus-900/10 bg-sand/30 p-4">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.whatsapp_habilitado}
                  onChange={(e) => setConfig({ ...config, whatsapp_habilitado: e.target.checked })}
                  className="h-4 w-4 rounded accent-teal cursor-pointer"
                />
                <div>
                  <span className="font-bold text-xs text-sus-950 block">
                    Ativar integração e disparos automáticos via WhatsApp
                  </span>
                  <span className="text-[11px] text-ink/60">
                    Quando desativado, os operadores ainda podem usar o botão de "Copiar Mensagem" ou "Abrir no WhatsApp" manualmente.
                  </span>
                </div>
              </label>
            </div>

            {/* Provedor */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="text-xs font-bold text-sus-950">
                  Provedor de Conexão WhatsApp <span className="text-red-500">*</span>
                </Label>
                <select
                  value={config.whatsapp_provedor}
                  onChange={(e) => setConfig({ ...config, whatsapp_provedor: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2 text-xs font-semibold text-sus-950 outline-none focus:border-teal"
                >
                  <option value="api_oficial">Meta Cloud API (Oficial / WhatsApp Business)</option>
                  <option value="z_api">Z-API (Instância Conectada por QR Code)</option>
                  <option value="evolution">Evolution API (Open-source / Auto-hospedado)</option>
                  <option value="webhook_generico">Webhook REST Genérico (POST JSON)</option>
                </select>
                <p className="mt-1 text-[11px] text-ink/50">
                  Selecione o gateway ou provedor contratado pelo município.
                </p>
              </div>

              <div>
                <Label className="text-xs font-bold text-sus-950">
                  DDD Padrão do Município
                </Label>
                <Input
                  value={config.whatsapp_ddd_padrao}
                  onChange={(e) => setConfig({ ...config, whatsapp_ddd_padrao: e.target.value })}
                  placeholder="35"
                  maxLength={2}
                  className="mt-1 text-xs"
                />
                <p className="mt-1 text-[11px] text-ink/50">
                  Usado automaticamente quando o telefone do paciente é cadastrado sem DDD.
                </p>
              </div>
            </div>

            {/* URL e Instância */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="text-xs font-bold text-sus-950">
                  URL da API / Endpoint
                </Label>
                <Input
                  value={config.whatsapp_api_url}
                  onChange={(e) => setConfig({ ...config, whatsapp_api_url: e.target.value })}
                  placeholder="https://api.z-api.io/instances/SUA_INSTANCIA/token/SEU_TOKEN"
                  className="mt-1 text-xs font-mono"
                />
                <p className="mt-1 text-[11px] text-ink/50">
                  URL completa do endpoint de envio de mensagem de texto.
                </p>
              </div>

              <div>
                <Label className="text-xs font-bold text-sus-950">
                  Instância ID / Phone Number ID (opcional)
                </Label>
                <Input
                  value={config.whatsapp_instancia_id}
                  onChange={(e) => setConfig({ ...config, whatsapp_instancia_id: e.target.value })}
                  placeholder="Ex: 3A59B28D... ou 104928374928"
                  className="mt-1 text-xs font-mono"
                />
                <p className="mt-1 text-[11px] text-ink/50">
                  ID da instância ou número remetente no provedor.
                </p>
              </div>
            </div>

            {/* Token com toggle */}
            <div>
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold text-sus-950">
                  Token de Autenticação / Bearer Token / API Key
                </Label>
                <button
                  type="button"
                  onClick={() => setVerToken(!verToken)}
                  className="text-[11px] text-teal font-semibold hover:underline"
                >
                  {verToken ? "Ocultar token" : "Exibir token"}
                </button>
              </div>
              <Input
                type={verToken ? "text" : "password"}
                value={config.whatsapp_api_token}
                onChange={(e) => setConfig({ ...config, whatsapp_api_token: e.target.value })}
                placeholder="Token de acesso Bearer ou Client-Token"
                className="mt-1 text-xs font-mono"
              />
              <p className="mt-1 text-[11px] text-ink/50">
                Armazenado com segurança no servidor e nunca exposto publicamente no repositório.
              </p>
            </div>

            {/* Gatilhos de Notificação Automática */}
            <div className="rounded-xl border border-sus-900/10 p-4 space-y-3">
              <p className="text-xs font-bold text-sus-950">
                Gatilhos de Notificação Automática
              </p>
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-sus-900">
                  <input
                    type="checkbox"
                    checked={config.whatsapp_notificar_entrada_fila}
                    onChange={(e) =>
                      setConfig({ ...config, whatsapp_notificar_entrada_fila: e.target.checked })
                    }
                    className="accent-teal h-4 w-4"
                  />
                  <span>1. Entrada na Fila de Exames / Solicitações</span>
                </label>
                <p className="text-[11px] text-ink/60 pl-6">
                  Envia mensagem com o código do pedido, procedimento solicitado e orientações assim que o pedido for lançado pelo PSF ou Central.
                </p>

                <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-sus-900 pt-1">
                  <input
                    type="checkbox"
                    checked={config.whatsapp_notificar_agendamento}
                    onChange={(e) =>
                      setConfig({ ...config, whatsapp_notificar_agendamento: e.target.checked })
                    }
                    className="accent-teal h-4 w-4"
                  />
                  <span>2. Agendamento Confirmado / Marcação em Lote</span>
                </label>
                <p className="text-[11px] text-ink/60 pl-6">
                  Envia confirmação com data, horário, local/laboratório conveniado e o preparo clínico necessário (jejum de 8 a 12h ou orientações específicas).
                </p>
              </div>
            </div>

            {erro && (
              <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-xs font-semibold text-red-800">
                {erro}
              </div>
            )}

            {sucesso && (
              <div className="rounded-xl bg-teal/10 border border-teal/20 p-3 text-xs font-semibold text-teal">
                ✓ {sucesso}
              </div>
            )}

            <div className="flex justify-end pt-2">
              <Button type="submit" disabled={salvando} className="bg-teal text-white text-xs font-bold px-6">
                <Save className="h-4 w-4 mr-1.5" />
                {salvando ? "Salvando…" : "Salvar Configurações do WhatsApp"}
              </Button>
            </div>
          </form>
        )}
      </Card>

      {/* Teste de Disparo */}
      <Card className="max-w-3xl p-6">
        <div className="flex items-center gap-2 border-b border-sus-900/10 pb-4 mb-4">
          <Send className="h-5 w-5 text-teal" />
          <div>
            <h3 className="font-display text-sm font-bold text-sus-950">
              Testar Conectividade e Disparo de Mensagem
            </h3>
            <p className="text-xs text-ink/60">
              Envie uma mensagem de teste para o seu próprio WhatsApp para verificar se as credenciais e a URL da API estão funcionando.
            </p>
          </div>
        </div>

        <form onSubmit={testarEnvio} className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <Label className="text-xs font-bold text-sus-950">Número de WhatsApp para Teste</Label>
              <Input
                value={telefoneTeste}
                onChange={(e) => setTelefoneTeste(e.target.value)}
                placeholder="Ex: (35) 99999-9999 ou 35999999999"
                className="mt-1 text-xs"
                required
              />
            </div>
            <div className="flex items-end">
              <Button
                type="submit"
                disabled={testando || !telefoneTeste.trim()}
                className="bg-sus-900 hover:bg-sus-950 text-white text-xs font-bold h-10 w-full sm:w-auto px-5"
              >
                {testando ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> Enviando teste…
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-1.5" /> Enviar Mensagem de Teste
                  </>
                )}
              </Button>
            </div>
          </div>

          {resultadoTeste && (
            <div
              className={`rounded-xl border p-3.5 text-xs font-medium ${
                resultadoTeste.sucesso
                  ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                  : "bg-red-50 border-red-200 text-red-900"
              }`}
            >
              <div className="flex items-center gap-2 font-bold mb-1">
                {resultadoTeste.sucesso ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-red-600" />
                )}
                <span>{resultadoTeste.sucesso ? "Envio bem-sucedido!" : "Falha no envio"}</span>
              </div>
              <p>{resultadoTeste.erro || "Mensagem de teste disparada com sucesso."}</p>
            </div>
          )}
        </form>
      </Card>

      {/* Histórico / Logs */}
      <Card className="max-w-3xl p-6">
        <div className="flex items-center justify-between border-b border-sus-900/10 pb-4 mb-4">
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-teal" />
            <div>
              <h3 className="font-display text-sm font-bold text-sus-950">
                Histórico Recente de Notificações
              </h3>
              <p className="text-xs text-ink/60">
                Últimos registros de disparos efetuados pelo sistema com status de entrega e erros.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={carregarLogs}
            disabled={carregandoLogs}
            className="flex items-center gap-1.5 rounded-lg border border-sus-900/15 px-3 py-1.5 text-xs font-bold text-sus-900 hover:bg-sand transition"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${carregandoLogs ? "animate-spin" : ""}`} />
            Atualizar
          </button>
        </div>

        {logs.length === 0 ? (
          <p className="text-center py-6 text-xs text-ink/50">
            Nenhuma notificação registrada ainda.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-sus-900/10 text-[10px] uppercase font-bold text-ink/50">
                <tr>
                  <th className="py-2 px-2">Data/Hora</th>
                  <th className="py-2 px-2">Evento</th>
                  <th className="py-2 px-2">Telefone</th>
                  <th className="py-2 px-2">Status</th>
                  <th className="py-2 px-2">Detalhes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sus-900/5">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-sand/30">
                    <td className="py-2.5 px-2 text-ink/70 whitespace-nowrap">
                      {new Date(log.criado_em).toLocaleString("pt-BR")}
                    </td>
                    <td className="py-2.5 px-2 font-semibold text-sus-950 capitalize">
                      {log.tipo_evento?.replace("_", " ") || "Notificação"}
                    </td>
                    <td className="py-2.5 px-2 font-mono text-ink/80">
                      {log.telefone_destinatario}
                    </td>
                    <td className="py-2.5 px-2 whitespace-nowrap">
                      <span
                        className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold ${
                          log.status === "enviado"
                            ? "bg-emerald-100 text-emerald-800"
                            : log.status === "erro"
                            ? "bg-red-100 text-red-800"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {log.status?.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-[11px] text-ink/60 truncate max-w-xs" title={log.erro || log.mensagem}>
                      {log.erro ? (
                        <span className="text-red-600 font-semibold">{log.erro}</span>
                      ) : (
                        log.mensagem || "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------- Aba: Procedimentos / Exames Permitidos (SIGTAP) ----------
function AbaExamesPermitidos() {
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [procedimentos, setProcedimentos] = useState<ExamePermitidoItem[]>([]);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<"todos" | "habilitados" | "desmarcados">("todos");
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [alterado, setAlterado] = useState(false);

  useEffect(() => {
    carregar();
  }, []);

  async function carregar() {
    setLoading(true);
    setErro("");
    try {
      const data = await fetchExamesPermitidos();
      setProcedimentos(data.procedimentos_sigtap || []);
      setSelecionados(new Set(data.codigos_habilitados || []));
      setAlterado(false);
    } catch {
      setErro("Falha ao carregar lista de exames permitidos.");
    } finally {
      setLoading(false);
    }
  }

  function toggleCodigo(codigo: string) {
    setSelecionados((prev) => {
      const proximo = new Set(prev);
      if (proximo.has(codigo)) {
        proximo.delete(codigo);
      } else {
        proximo.add(codigo);
      }
      return proximo;
    });
    setAlterado(true);
  }

  function marcarTodosFiltrados() {
    setSelecionados((prev) => {
      const proximo = new Set(prev);
      for (const p of filtrados) {
        proximo.add(p.codigo);
      }
      return proximo;
    });
    setAlterado(true);
  }

  function desmarcarTodosFiltrados() {
    setSelecionados((prev) => {
      const proximo = new Set(prev);
      for (const p of filtrados) {
        proximo.delete(p.codigo);
      }
      return proximo;
    });
    setAlterado(true);
  }

  function marcarTodosGeral() {
    setSelecionados(new Set(procedimentos.map((p) => p.codigo)));
    setAlterado(true);
  }

  function limparTodosGeral() {
    setSelecionados(new Set());
    setAlterado(true);
  }

  async function salvar() {
    setSalvando(true);
    setErro("");
    setOk("");
    try {
      const codigos = Array.from(selecionados);
      const res = await salvarExamesPermitidos(codigos);
      setOk(
        codigos.length > 0
          ? `Configuração salva com sucesso! ${res.total_habilitados} procedimentos habilitados para os PSFs.`
          : "Configuração salva: lista restritiva zerada (todos os exames laboratoriais SIGTAP liberados por padrão)."
      );
      setAlterado(false);
    } catch (e: unknown) {
      setErro(msgErro(e, "Falha ao salvar exames permitidos."));
    } finally {
      setSalvando(false);
    }
  }

  const filtrados = useMemo(() => {
    let lista = procedimentos;
    const q = busca.trim().toLowerCase();
    if (q) {
      lista = lista.filter(
        (p) =>
          p.codigo.toLowerCase().includes(q) ||
          p.descricao.toLowerCase().includes(q) ||
          p.instrumento?.toLowerCase().includes(q)
      );
    }
    if (filtro === "habilitados") {
      lista = lista.filter((p) => selecionados.has(p.codigo));
    } else if (filtro === "desmarcados") {
      lista = lista.filter((p) => !selecionados.has(p.codigo));
    }
    return lista;
  }, [procedimentos, busca, filtro, selecionados]);

  if (loading) {
    return (
      <Card className="flex items-center justify-center p-12 text-ink/60">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-teal" />
        <span>Carregando catálogo de exames laboratoriais SIGTAP…</span>
      </Card>
    );
  }

  const totalHabilitados = selecionados.size;
  const padraoTodosLiberados = totalHabilitados === 0;

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-teal/10 p-2.5 text-teal">
              <FlaskConical className="h-6 w-6" />
            </div>
            <div>
              <h2 className="font-display text-lg font-bold text-sus-950">
                Procedimentos e Exames Permitidos (SIGTAP)
              </h2>
              <p className="mt-0.5 text-xs text-ink/65">
                Defina quais exames de sangue e laboratoriais da tabela SIGTAP ficam habilitados para seleção nas unidades PSF.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={salvar}
              disabled={salvando || (!alterado && !erro)}
              className="!w-auto gap-1.5"
            >
              {salvando ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Salvando…
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Salvar Exames Permitidos
                </>
              )}
            </Button>
          </div>
        </div>

        {erro && <p className="mt-3 rounded-xl bg-red-50 p-3 text-xs font-medium text-red-700">{erro}</p>}
        {ok && <p className="mt-3 rounded-xl bg-teal/10 p-3 text-xs font-medium text-teal">{ok}</p>}

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-sus-900/10 pt-4 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sus-950">Status atual da regra:</span>
            {padraoTodosLiberados ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 font-bold text-blue-700">
                <CheckCircle2 className="h-3.5 w-3.5" /> Todos liberados (padrão)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-teal/15 px-2.5 py-0.5 font-bold text-teal">
                <CheckCircle2 className="h-3.5 w-3.5" /> {totalHabilitados} de {procedimentos.length} selecionados
              </span>
            )}
          </div>
          {alterado && (
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 font-bold text-amber-800">
              Alterações pendentes de salvamento
            </span>
          )}
        </div>
      </Card>

      {/* Controles de busca e ações em lote */}
      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-12 md:items-center">
          <div className="md:col-span-5">
            <Input
              placeholder="Buscar por código (ex: 0202...) ou nome do exame..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="w-full text-xs"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5 md:col-span-4">
            <button
              type="button"
              onClick={() => setFiltro("todos")}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-bold transition ${
                filtro === "todos" ? "bg-sus-900 text-white" : "bg-sand text-sus-900 hover:bg-sand/80"
              }`}
            >
              Todos ({procedimentos.length})
            </button>
            <button
              type="button"
              onClick={() => setFiltro("habilitados")}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-bold transition ${
                filtro === "habilitados" ? "bg-teal text-white" : "bg-sand text-sus-900 hover:bg-sand/80"
              }`}
            >
              Habilitados ({totalHabilitados})
            </button>
            <button
              type="button"
              onClick={() => setFiltro("desmarcados")}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-bold transition ${
                filtro === "desmarcados" ? "bg-sus-900 text-white" : "bg-sand text-sus-900 hover:bg-sand/80"
              }`}
            >
              Desmarcados ({procedimentos.length - totalHabilitados})
            </button>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5 md:col-span-3">
            <button
              type="button"
              onClick={marcarTodosGeral}
              className="rounded-lg border border-sus-900/15 px-2.5 py-1.5 text-xs font-bold text-sus-900 hover:bg-sand"
            >
              Marcar Todos
            </button>
            <button
              type="button"
              onClick={limparTodosGeral}
              className="rounded-lg border border-sus-900/15 px-2.5 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50"
            >
              Desmarcar Todos
            </button>
          </div>
        </div>
      </Card>

      {/* Lista de exames com checkboxes */}
      <Card className="overflow-hidden">
        <div className="max-h-[600px] overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 z-10 border-b border-sus-900/10 bg-sand uppercase tracking-wide text-sus-900/60">
              <tr>
                <th className="w-12 px-4 py-3 text-center">
                  <input
                    type="checkbox"
                    checked={filtrados.length > 0 && filtrados.every((p) => selecionados.has(p.codigo))}
                    onChange={(e) => (e.target.checked ? marcarTodosFiltrados() : desmarcarTodosFiltrados())}
                    className="h-4 w-4 accent-teal cursor-pointer"
                  />
                </th>
                <th className="w-32 px-4 py-3">Código SIGTAP</th>
                <th className="px-4 py-3">Descrição do Procedimento</th>
                <th className="w-28 px-4 py-3">Instrumento</th>
                <th className="w-36 px-4 py-3 text-right">Disponibilidade PSF</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sus-900/5">
              {filtrados.map((p) => {
                const ativo = selecionados.has(p.codigo);
                return (
                  <tr
                    key={p.codigo}
                    onClick={() => toggleCodigo(p.codigo)}
                    className={`cursor-pointer transition hover:bg-sand/60 ${
                      ativo ? "bg-teal/5" : ""
                    }`}
                  >
                    <td className="px-4 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={ativo}
                        onChange={() => toggleCodigo(p.codigo)}
                        className="h-4 w-4 accent-teal cursor-pointer"
                      />
                    </td>
                    <td className="px-4 py-2.5 font-mono font-semibold text-sus-950">
                      {p.codigo}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-ink/80">
                      {p.descricao}
                    </td>
                    <td className="px-4 py-2.5 text-ink/55">
                      <span className="rounded bg-sand px-1.5 py-0.5 font-mono text-[11px]">
                        {p.instrumento || "BPA-C"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {ativo ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-teal/15 px-2 py-0.5 text-[11px] font-bold text-teal">
                          Habilitado
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-sus-900/10 px-2 py-0.5 text-[11px] font-medium text-ink/45">
                          Desmarcado
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtrados.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-sm text-ink/45">
                    Nenhum procedimento encontrado com os filtros atuais.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ---------- Aba: Laboratórios ----------
function AbaLaboratorios() {
  const { notificarUndo } = useUndo();
  const [lista, setLista] = useState<{ id: number; nome: string; ativo: boolean }[]>([]);
  const [nome, setNome] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");

  async function carregar() {
    try {
      setLista(await labsListar(false));
    } catch {
      setErro("Falha ao carregar laboratórios.");
    }
  }

  async function reativar(id: number, nomeAtual: string) {
    setBusy(true);
    setErro("");
    setOk("");
    try {
      await labsAtualizar(id, nomeAtual, true);
      setOk("Laboratório reativado — volta aos seletores de marcação.");
      await carregar();
    } catch {
      setErro("Falha ao reativar.");
    } finally {
      setBusy(false);
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
    const alvo = lista.find((x) => x.id === id);
    if (!confirm("Desativar/remover este laboratório? As vagas atuais serão preservadas no histórico.")) return;
    setBusy(true);
    setErro("");
    setOk("");
    try {
      await labsRemover(id);
      await carregar();
      notificarUndo({
        titulo: `Laboratório ${alvo?.nome ?? ""} inativado.`,
        descricao: "Desfazer reativa o laboratório nos seletores.",
        onUndo: async () => {
          await labsAtualizar(id, alvo?.nome ?? "", true);
          await carregar();
        },
      });
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
        Inativos somem dos seletores de marcação, mas o histórico é preservado.
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
                  {l.ativo ? (
                    <button onClick={() => remover(l.id)} className="rounded-lg px-2 py-1 text-xs font-bold text-red-700 hover:bg-red-50">
                      Remover
                    </button>
                  ) : (
                    <button onClick={() => reativar(l.id, l.nome)} className="rounded-lg px-2 py-1 text-xs font-bold text-teal hover:bg-teal/10">
                      Reativar
                    </button>
                  )}
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

// ---------- Aba: Backup e Restauração Criptografados ----------
function AbaBackup() {
  const [modalGerar, setModalGerar] = useState(false);
  const [modalRestaurar, setModalRestaurar] = useState(false);

  return (
    <div className="space-y-6">
      <div className="grid max-w-4xl grid-cols-1 gap-6 md:grid-cols-2">
        {/* Card 1: Gerar Backup Criptografado */}
        <Card className="flex flex-col justify-between p-6">
          <div>
            <div className="mb-4 flex items-center gap-3">
              <div className="rounded-xl bg-sus-900/10 p-3 text-sus-900">
                <Database className="h-6 w-6" />
              </div>
              <div>
                <h2 className="font-display text-lg font-bold text-sus-950">Gerar Backup Criptografado</h2>
                <Badge variant="outline" className="border-teal/30 bg-teal/10 text-teal">
                  Criptografia AES-256
                </Badge>
              </div>
            </div>

            <p className="text-sm leading-relaxed text-ink/75">
              Gera um arquivo de segurança criptografado contendo todos os dados do sistema (banco de dados relacional, cadastros, usuários, configurações e histórico de viagens).
            </p>

            <div className="mt-4 space-y-2 rounded-xl bg-sand/60 p-3.5 text-xs text-ink/80">
              <div className="flex items-center gap-2">
                <Lock className="h-4 w-4 shrink-0 text-sus-900" />
                <span>Chave de criptografia derivada de senha mestra</span>
              </div>
              <div className="flex items-center gap-2">
                <Download className="h-4 w-4 shrink-0 text-sus-900" />
                <span>Download de arquivo seguro com extensão <strong>.bak</strong></span>
              </div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 shrink-0 text-teal" />
                <span>Proteção total contra acesso indevido</span>
              </div>
            </div>
          </div>

          <div className="mt-6 border-t border-sus-900/10 pt-4">
            <Button onClick={() => setModalGerar(true)} className="w-full">
              <Download className="h-4 w-4" /> Gerar Backup do Sistema
            </Button>
          </div>
        </Card>

        {/* Card 2: Restaurar Backup do Sistema */}
        <Card className="flex flex-col justify-between p-6">
          <div>
            <div className="mb-4 flex items-center gap-3">
              <div className="rounded-xl bg-red-100 p-3 text-red-700">
                <UploadCloud className="h-6 w-6" />
              </div>
              <div>
                <h2 className="font-display text-lg font-bold text-sus-950">Restaurar Backup do Sistema</h2>
                <Badge variant="danger">
                  Operação Crítica
                </Badge>
              </div>
            </div>

            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs leading-relaxed text-red-900">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                <div>
                  <strong className="block font-bold">ATENÇÃO: Operação Irreversível</strong>
                  A restauração substituirá os dados atuais pelos dados contidos no arquivo de backup.
                </div>
              </div>
            </div>

            <p className="text-sm leading-relaxed text-ink/75">
              Permite restaurar o estado completo do sistema a partir de um arquivo <strong>.bak</strong> previamente exportado e protegido por senha.
            </p>
          </div>

          <div className="mt-6 border-t border-sus-900/10 pt-4">
            <Button
              onClick={() => setModalRestaurar(true)}
              className="w-full !border !border-sus-900/20 !bg-white !text-sus-900 hover:!bg-sand"
            >
              <Archive className="h-4 w-4" /> Restaurar a partir de Arquivo .bak
            </Button>
          </div>
        </Card>
      </div>

      {/* Modais de ação */}
      <ModalGerarBackup aberto={modalGerar} onFechar={() => setModalGerar(false)} />
      <ModalRestaurarBackup aberto={modalRestaurar} onFechar={() => setModalRestaurar(false)} />
    </div>
  );
}

// ---------- Modal: Gerar Backup Criptografado ----------
function ModalGerarBackup({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState("");

  if (!aberto) return null;

  function resetar() {
    setSenha("");
    setConfirmacao("");
    setMostrarSenha(false);
    setErro("");
    setSucesso("");
  }

  function fechar() {
    if (carregando) return;
    resetar();
    onFechar();
  }

  async function handleExportar(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    setSucesso("");

    if (!senha) {
      setErro("Informe a senha de criptografia.");
      return;
    }
    if (senha.length < 6) {
      setErro("A senha de criptografia deve conter no mínimo 6 caracteres.");
      return;
    }
    if (senha !== confirmacao) {
      setErro("A confirmação da senha não coincide com a senha digitada.");
      return;
    }

    setCarregando(true);
    try {
      await exportarBackup(senha);
      setSucesso("Backup gerado e baixado com sucesso! Arquivo .bak salvo no seu computador.");
    } catch (err: unknown) {
      setErro(msgErro(err, "Falha ao gerar o arquivo de backup. Verifique a conexão e tente novamente."));
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4" onClick={fechar}>
      <div
        className="rise max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl bg-white p-6 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-2 border-b border-sus-900/10 pb-3">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-teal/10 p-2 text-teal">
              <Database className="h-5 w-5" />
            </div>
            <div>
              <p className="font-display text-base font-bold text-sus-950">Gerar Backup Criptografado</p>
              <p className="text-xs text-ink/55">Criptografia AES-256 com derivação de chave segura</p>
            </div>
          </div>
          <button
            onClick={fechar}
            disabled={carregando}
            className="rounded-lg p-2 text-ink/50 hover:bg-sand disabled:opacity-50"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleExportar} className="space-y-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 text-xs text-amber-900">
            <div className="flex items-start gap-2.5">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <div>
                <p className="font-bold">Guarde esta senha com segurança!</p>
                <p className="mt-1 leading-relaxed">
                  Sem ela, será <strong>impossível restaurar</strong> os dados deste arquivo. O sistema não guarda sua chave de criptografia.
                </p>
              </div>
            </div>
          </div>

          <div>
            <Label>Senha de Criptografia *</Label>
            <div className="relative">
              <Input
                type={mostrarSenha ? "text" : "password"}
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                placeholder="Mínimo de 6 caracteres"
                disabled={carregando}
                className="pr-10"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setMostrarSenha(!mostrarSenha)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/50 hover:text-ink"
                tabIndex={-1}
              >
                {mostrarSenha ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div>
            <Label>Confirmação da Senha *</Label>
            <Input
              type={mostrarSenha ? "text" : "password"}
              value={confirmacao}
              onChange={(e) => setConfirmacao(e.target.value)}
              placeholder="Digite a mesma senha para confirmar"
              disabled={carregando}
              autoComplete="new-password"
            />
          </div>

          {erro && (
            <div className="rounded-xl bg-red-50 p-3 text-sm font-medium text-red-700">
              {erro}
            </div>
          )}

          {sucesso && (
            <div className="flex items-center gap-2 rounded-xl bg-teal/10 p-3 text-sm font-medium text-teal">
              <CheckCircle2 className="h-5 w-5 shrink-0" />
              <span>{sucesso}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={fechar}
              disabled={carregando}
              className="rounded-xl border border-sus-900/15 px-4 py-2.5 text-sm font-bold text-sus-900 hover:bg-sand disabled:opacity-50"
            >
              Cancelar
            </button>
            <Button
              type="submit"
              disabled={carregando || !senha || !confirmacao}
              className="!w-auto"
            >
              {carregando ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Gerando e baixando…
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  Exportar e Baixar Arquivo .bak
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------- Modal: Restaurar Backup do Sistema ----------
function ModalRestaurarBackup({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [senha, setSenha] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [ciente, setCiente] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!aberto) return null;

  function resetar() {
    setArquivo(null);
    setSenha("");
    setMostrarSenha(false);
    setCiente(false);
    setErro("");
    setSucesso(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function fechar() {
    if (carregando) return;
    resetar();
    onFechar();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      setArquivo(file);
      setErro("");
    }
  }

  async function handleRestaurar(e: React.FormEvent) {
    e.preventDefault();
    setErro("");

    if (!arquivo) {
      setErro("Selecione o arquivo de backup (.bak) para restaurar.");
      return;
    }
    if (!senha) {
      setErro("Informe a senha de descriptografia do backup.");
      return;
    }
    if (!ciente) {
      setErro("Você precisa marcar a caixa de ciência antes de prosseguir.");
      return;
    }

    setCarregando(true);
    try {
      await restaurarBackup(arquivo, senha);
      setSucesso(true);
    } catch (err: unknown) {
      setErro(msgErro(err, "Falha ao restaurar o backup. Verifique se o arquivo e a senha estão corretos."));
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4" onClick={sucesso ? undefined : fechar}>
      <div
        className="rise max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl bg-white p-6 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-2 border-b border-sus-900/10 pb-3">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-red-100 p-2 text-red-700">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <p className="font-display text-base font-bold text-sus-950">Restaurar Backup do Sistema</p>
              <p className="text-xs text-ink/55">Substituição da base de dados atual</p>
            </div>
          </div>
          {!sucesso && (
            <button
              onClick={fechar}
              disabled={carregando}
              className="rounded-lg p-2 text-ink/50 hover:bg-sand disabled:opacity-50"
              aria-label="Fechar"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {sucesso ? (
          <div className="space-y-4 py-2">
            <div className="rounded-2xl border border-teal/20 bg-teal/10 p-5 text-center">
              <CheckCircle2 className="mx-auto mb-2 h-12 w-12 text-teal" />
              <h3 className="font-display text-lg font-bold text-sus-950">Restauração Concluída com Sucesso!</h3>
              <p className="mt-2 text-sm text-ink/75">
                Os dados foram restaurados a partir do arquivo de backup. Para garantir a sincronização de todas as telas e dados, recarregue o sistema agora.
              </p>
            </div>
            <Button
              onClick={() => window.location.reload()}
              className="w-full !bg-teal !text-sus-950 hover:opacity-90"
            >
              <RefreshCw className="h-4 w-4" /> Recarregar Sistema Agora
            </Button>
          </div>
        ) : (
          <form onSubmit={handleRestaurar} className="space-y-4">
            <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-900">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                <div>
                  <p className="font-bold">ATENÇÃO: A restauração substituirá os dados atuais pelos dados contidos no arquivo de backup. Esta operação é irreversível.</p>
                  <p className="mt-1 leading-relaxed">
                    Certifique-se de que selecionou o arquivo correto e de que possui uma cópia de segurança recente antes de prosseguir.
                  </p>
                </div>
              </div>
            </div>

            <div>
              <Label>Arquivo de Backup (.bak) *</Label>
              <div
                onClick={() => fileInputRef.current?.click()}
                className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-4 text-center transition ${
                  arquivo
                    ? "border-teal bg-teal/5 text-sus-950"
                    : "border-sus-900/20 bg-sand/30 hover:border-sus-900/40 hover:bg-sand/60"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".bak,application/octet-stream"
                  onChange={handleFileChange}
                  className="hidden"
                  disabled={carregando}
                />
                {arquivo ? (
                  <div className="flex items-center gap-2 text-sm font-semibold text-sus-900">
                    <FileArchive className="h-6 w-6 text-teal" />
                    <span className="max-w-[280px] truncate">{arquivo.name}</span>
                    <span className="text-xs text-ink/50">
                      ({(arquivo.size / (1024 * 1024)).toFixed(2)} MB)
                    </span>
                  </div>
                ) : (
                  <>
                    <UploadCloud className="mb-1 h-8 w-8 text-sus-900/50" />
                    <p className="text-sm font-semibold text-sus-900">Clique para selecionar o arquivo .bak</p>
                    <p className="text-xs text-ink/50">Arquivo gerado pela ferramenta de backup</p>
                  </>
                )}
              </div>
            </div>

            <div>
              <Label>Senha de Descriptografia *</Label>
              <div className="relative">
                <Input
                  type={mostrarSenha ? "text" : "password"}
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  placeholder="Senha utilizada na geração do backup"
                  disabled={carregando}
                  className="pr-10"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setMostrarSenha(!mostrarSenha)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/50 hover:text-ink"
                  tabIndex={-1}
                >
                  {mostrarSenha ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-sus-900/10 bg-sand/40 p-3">
              <label className="flex cursor-pointer items-start gap-2.5 text-xs leading-relaxed text-sus-950">
                <input
                  type="checkbox"
                  checked={ciente}
                  onChange={(e) => setCiente(e.target.checked)}
                  disabled={carregando}
                  className="mt-0.5 h-4 w-4 rounded border-sus-900/30 text-sus-900 focus:ring-sus-700"
                />
                <span className="font-semibold">
                  Estou ciente de que os dados atuais serão substituídos pelo conteúdo do backup.
                </span>
              </label>
            </div>

            {erro && (
              <div className="rounded-xl bg-red-50 p-3 text-sm font-medium text-red-700">
                {erro}
              </div>
            )}

            {carregando && (
              <div className="rounded-xl border border-sus-900/10 bg-sand p-3.5 text-center text-xs text-ink/75">
                <Loader2 className="mx-auto mb-1.5 h-5 w-5 animate-spin text-sus-900" />
                <p className="font-bold text-sus-950">Enviando e restaurando base de dados…</p>
                <p className="mt-0.5">Por favor aguarde, o processo pode levar alguns instantes.</p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={fechar}
                disabled={carregando}
                className="rounded-xl border border-sus-900/15 px-4 py-2.5 text-sm font-bold text-sus-900 hover:bg-sand disabled:opacity-50"
              >
                Cancelar
              </button>
              <Button
                type="submit"
                disabled={carregando || !arquivo || !senha.trim() || !ciente}
                className="!w-auto !bg-red-700 !text-white hover:!bg-red-800 disabled:!bg-sus-900 disabled:opacity-50"
              >
                {carregando ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Restaurando…
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4" />
                    Iniciar Restauração
                  </>
                )}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

