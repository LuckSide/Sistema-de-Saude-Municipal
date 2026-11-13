import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Clock,
  Download,
  ExternalLink,
  Globe,
  History,
  Layers,
  RefreshCw,
  Sparkles,
  Upload,
} from "lucide-react";
import {
  labSigtap,
  msgErro,
  pagData,
  pagMeta,
  sigtapArvore,
  sigtapAutoSyncConfig,
  sigtapAutoSyncExecutar,
  sigtapAutoSyncStatus,
  sigtapImportar,
  sigtapVersoes,
  type SigtapArvore,
  type SigtapAutoSyncStatus,
  type SigtapImportOut,
  type SigtapProc,
  type SigtapVersao,
} from "../../services/api";
import { Button, Card, Input, Label, Select } from "../../components/ui/primitives";
import { Combobox } from "../../components/ui/combobox";
import Paginacao from "../../components/Paginacao";
import ExportarExcel from "../../components/ExportarExcel";

const INSTRUMENTOS = ["BPA-C", "BPA-I", "BPA-F", "AIH", "APAC", "RAAS"];

function brl(v: number | undefined): string {
  return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function LabSigtap() {
  const [q, setQ] = useState("");
  const [inst, setInst] = useState("");
  const [apenasLab, setApenasLab] = useState(false);
  const [grupoCodigo, setGrupoCodigo] = useState("");
  const [subgrupoCodigo, setSubgrupoCodigo] = useState("");
  const [cboCodigo, setCboCodigo] = useState("");
  const [arvore, setArvore] = useState<SigtapArvore | null>(null);
  const [lista, setLista] = useState<SigtapProc[]>([]);
  const [erro, setErro] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);

  // Importação e Atualização Agendada (Tabela Unificada DATASUS)
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [competencia, setCompetencia] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 7);
  });
  const [importando, setImportando] = useState(false);
  const [avisoAuto, setAvisoAuto] = useState<{ mensagem: string; linkOficial?: string } | null>(null);
  const [preview, setPreview] = useState<SigtapImportOut | null>(null);
  const [versoes, setVersoes] = useState<SigtapVersao[]>([]);
  const [autoSync, setAutoSync] = useState<SigtapAutoSyncStatus | null>(null);
  const [salvandoAutoSync, setSalvandoAutoSync] = useState(false);
  const [executandoAutoSync, setExecutandoAutoSync] = useState(false);
  const [ok, setOk] = useState("");

  function buscar(p = 1) {
    labSigtap(
      q || undefined,
      inst || undefined,
      p,
      100,
      apenasLab,
      grupoCodigo || undefined,
      subgrupoCodigo || undefined,
      cboCodigo || undefined,
    )
      .then((r) => {
        setLista(pagData<SigtapProc>(r));
        const m = pagMeta(r);
        setTotal(m.total);
        setPage(m.page);
        setPages(m.pages);
      })
      .catch(() => setErro("Falha ao buscar tabela."));
  }

  function carregarVersoes() {
    sigtapVersoes().then(setVersoes).catch(() => {});
  }

  function carregarAutoSync() {
    sigtapAutoSyncStatus().then(setAutoSync).catch(() => {});
  }

  useEffect(() => {
    let cancel = false;
    sigtapArvore({
      grupo_codigo: grupoCodigo || undefined,
      subgrupo_codigo: subgrupoCodigo || undefined,
      cbo: cboCodigo || undefined,
    })
      .then((res) => {
        if (!cancel) setArvore(res);
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, [grupoCodigo, subgrupoCodigo, cboCodigo]);

  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      buscar(1);
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, inst, apenasLab, grupoCodigo, subgrupoCodigo, cboCodigo]);

  useEffect(() => {
    carregarVersoes();
    carregarAutoSync();
  }, []);

  const opcoesCboArvore = useMemo(() => {
    return (arvore?.cbos ?? []).map((c) => ({
      value: c.cbo,
      label: c.descricao ? `${c.cbo} · ${c.descricao}` : `CBO ${c.cbo}`,
      sub: c.cbo ? `CBO ${c.cbo}` : undefined,
      keywords: `${c.cbo} ${c.descricao}`,
    }));
  }, [arvore]);

  async function atualizarConfigAutoSync(patch: { sigtap_sync_automatica?: boolean; sigtap_sync_intervalo_horas?: number }) {
    setSalvandoAutoSync(true);
    setErro("");
    try {
      const payload = { ...patch, sigtap_sync_intervalo_horas: 24 };
      const novo = await sigtapAutoSyncConfig(payload);
      setAutoSync((prev) =>
        prev
          ? { ...prev, ...novo }
          : {
              sigtap_sync_automatica: novo.sigtap_sync_automatica,
              sigtap_sync_intervalo_horas: 24,
              sigtap_sync_ultima_execucao: null,
              sigtap_sync_ultimo_status: "",
              sigtap_sync_ultima_competencia: "",
              sigtap_sync_ultimo_erro: "",
              em_execucao: false,
            },
      );
      setOk("Configuração de sincronização diária da Tabela Unificada atualizada.");
    } catch (e: unknown) {
      setErro(msgErro(e, "Falha ao atualizar configuração automática do SIGTAP."));
    } finally {
      setSalvandoAutoSync(false);
    }
  }

  async function sincronizarAgora() {
    setExecutandoAutoSync(true);
    setErro("");
    setOk("");
    setAvisoAuto(null);
    try {
      const res = await sigtapAutoSyncExecutar(competencia || undefined, false);
      carregarAutoSync();
      const st = String(res.status || "").toUpperCase();
      if (st === "SUCESSO" && res.ok) {
        setPreview(res as unknown as SigtapImportOut);
        setOk(
          `Sincronização concluída com sucesso (${String(res.competencia || competencia)}): ${Number(res.inseridos || 0)} inseridos, ${Number(res.atualizados || 0)} atualizados.`,
        );
        carregarVersoes();
        buscar(1);
      } else if (st === "SEM_NOVIDADE") {
        setOk(
          String(
            res.mensagem ||
              `A Tabela Unificada (${String(res.competencia || competencia)}) já está atualizada com a versão oficial do DATASUS.`,
          ),
        );
      } else if (st === "INDISPONIVEL" || st === "ERRO" || res.ok === false) {
        setAvisoAuto({
          mensagem: String(
            res.mensagem ||
              "O portal ou FTP do DATASUS/SIGTAP não respondeu no momento. Utilize o link oficial abaixo para download manual.",
          ),
          linkOficial: String(res.link_oficial || "http://sigtap.datasus.gov.br/tabela-unificada/app/download.jsp"),
        });
      } else {
        setOk(String(res.mensagem || "Sincronização concluída."));
      }
    } catch (e: unknown) {
      const detalhe = msgErro(
        e,
        "Não foi possível conectar ao portal do DATASUS no momento para sincronização automática.",
      );
      setAvisoAuto({
        mensagem: detalhe,
        linkOficial: "http://sigtap.datasus.gov.br/tabela-unificada/app/download.jsp",
      });
      carregarAutoSync();
    } finally {
      setExecutandoAutoSync(false);
    }
  }

  async function importar(simular: boolean) {
    if (!arquivo) {
      setErro("Selecione o .zip ou .txt/.csv do layout SIGTAP.");
      return;
    }
    if (!/^\d{4}-\d{2}$/.test(competencia)) {
      setErro("Competência inválida (AAAA-MM).");
      return;
    }
    setImportando(true);
    setErro("");
    setOk("");
    try {
      const r = await sigtapImportar(arquivo, competencia, simular);
      setPreview(r);
      if (!simular) {
        setOk(`Carga ${competencia} aplicada: ${r.inseridos} inseridos, ${r.atualizados} atualizados.`);
        carregarVersoes();
        buscar(1);
      }
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? "Erro na importação.";
      setErro(msg);
    } finally {
      setImportando(false);
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="font-display text-lg font-bold text-sus-950">Tabela SIGTAP Completa</h2>
        <span className="ml-auto">
          <ExportarExcel
            url="/api/lab/sigtap/exportar"
            arquivo="sigtap"
            params={{
              q: q.trim() || undefined,
              instrumento: inst || undefined,
              apenas_laboratoriais: apenasLab,
              grupo_codigo: grupoCodigo || undefined,
              subgrupo_codigo: subgrupoCodigo || undefined,
              cbo: cboCodigo || undefined,
            }}
          />
        </span>
      </div>

      <Card className="mb-4 p-4 space-y-3">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="md:col-span-2">
            <Label>Busca rápida</Label>
            <Input placeholder="Código ou descrição do procedimento…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div>
            <Label>Instrumento</Label>
            <Select value={inst} onChange={(e) => setInst(e.target.value)}>
              <option value="">Todos</option>
              {INSTRUMENTOS.map((i) => <option key={i} value={i}>{i}</option>)}
            </Select>
          </div>
          <div className="flex flex-col justify-end pb-1">
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-sus-950">
              <input
                type="checkbox"
                checked={apenasLab}
                onChange={(e) => setApenasLab(e.target.checked)}
                className="h-4 w-4 rounded border-sus-900/30 text-teal"
              />
              Somente Laboratoriais (0202)
            </label>
          </div>
        </div>

        <div className="grid gap-3 border-t border-sus-900/10 pt-3 md:grid-cols-3">
          <div>
            <Label className="flex items-center gap-1.5 text-xs">
              <Layers className="h-3.5 w-3.5 text-teal" /> Área (Grupo SIGTAP)
            </Label>
            <Select
              value={grupoCodigo}
              onChange={(e) => {
                const g = e.target.value;
                setGrupoCodigo(g);
                if (subgrupoCodigo && (!g || !subgrupoCodigo.startsWith(g))) {
                  setSubgrupoCodigo("");
                }
              }}
              className="mt-1"
            >
              <option value="">Todas as áreas (Grupos 01–08)</option>
              {(arvore?.grupos ?? []).map((g) => (
                <option key={g.codigo} value={g.codigo}>
                  {g.codigo} · {g.nome}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label className="text-xs">Subgrupo SIGTAP</Label>
            <Select
              value={subgrupoCodigo}
              onChange={(e) => {
                const s = e.target.value;
                setSubgrupoCodigo(s);
                if (s.length >= 2 && !grupoCodigo) {
                  setGrupoCodigo(s.slice(0, 2));
                }
              }}
              className="mt-1"
            >
              <option value="">Todos os subgrupos</option>
              {(arvore?.subgrupos ?? [])
                .filter((s) => !grupoCodigo || s.grupo_codigo === grupoCodigo || s.codigo.startsWith(grupoCodigo))
                .map((s) => (
                  <option key={s.codigo} value={s.codigo}>
                    {s.codigo} · {s.nome}
                  </option>
                ))}
            </Select>
          </div>
          <div>
            <Label className="text-xs">CBO (Ocupação Autorizada)</Label>
            <div className="mt-1">
              <Combobox
                value={cboCodigo}
                onChange={(v) => setCboCodigo(v)}
                options={opcoesCboArvore}
                placeholder="Filtrar por CBO…"
                searchPlaceholder="Código ou ocupação CBO…"
                emptyText="Nenhum CBO nessa área/subgrupo"
                showAll={true}
              />
            </div>
          </div>
        </div>
      </Card>

      {erro && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
      {ok && <p className="mb-3 rounded-xl bg-teal/10 px-3 py-2 text-sm text-teal">{ok}</p>}

      <Card className="mb-4 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-sus-900/10 bg-sand text-xs uppercase text-sus-900/60">
              <th className="px-4 py-3">Código</th>
              <th className="px-4 py-3">Descrição / Área &amp; Subgrupo</th>
              <th className="px-4 py-3">Complexidade</th>
              <th className="px-4 py-3">Instrumento</th>
              <th className="px-4 py-3">Valores SA/SP/SH</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((s) => (
              <tr key={s.id ?? s.codigo} className="border-b border-sus-900/5 last:border-0">
                <td className="px-4 py-3 font-mono font-semibold">{s.codigo}</td>
                <td className="px-4 py-3">
                  <p className="font-medium text-sus-950">{s.descricao}</p>
                  {(s.grupo_nome || s.subgrupo_nome) && (
                    <p className="mt-0.5 text-[11px] text-ink/55">
                      {s.grupo_codigo ? `${s.grupo_codigo} ${s.grupo_nome}` : ""}
                      {s.subgrupo_codigo ? ` › ${s.subgrupo_codigo} ${s.subgrupo_nome}` : ""}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3 text-xs">{s.complexidade || "—"}</td>
                <td className="px-4 py-3 text-xs">{s.instrumento}</td>
                <td className="px-4 py-3 text-xs">{brl(s.valor_sa)} / {brl(s.valor_sp)} / {brl(s.valor_sh)}</td>
              </tr>
            ))}
            {lista.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-ink/45">Nada encontrado.</td></tr>}
          </tbody>
        </table>
        </div>
        <Paginacao page={page} pages={pages} total={total} onPage={(p) => buscar(p)} />
      </Card>

      <Card className="mb-4 p-5 space-y-5">
        <div>
          <p className="flex items-center gap-2 font-display text-base font-bold text-sus-950">
            <Globe className="h-5 w-5 text-teal" /> Atualização e Carga da Tabela Unificada (SIGTAP / DATASUS)
          </p>
          <p className="mt-1 text-xs text-ink/65 leading-relaxed">
            Mantenha o catálogo de procedimentos, valores ambulatoriais/hospitalares e compatibilidades de CBO/CID
            atualizados com a competência oficial do Ministério da Saúde.
          </p>
        </div>

        {/* Sincronização Automática com DATASUS (Rotina Diária + Disparo Imediato) */}
        <div className="rounded-2xl border border-teal/25 bg-teal/5 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-bold text-sm text-sus-950 flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-teal" /> Sincronização Automática Diária (SIGTAP / DATASUS)
              </p>
              <p className="text-xs text-ink/65 mt-0.5">
                Verifica automaticamente <b>1 vez ao dia</b> no portal oficial do DATASUS se há nova versão da Tabela Unificada e atualiza os procedimentos.
              </p>
            </div>
            {autoSync && (
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                  ["sucesso", "sem_novidade"].includes((autoSync.sigtap_sync_ultimo_status || "").toLowerCase())
                    ? "bg-emerald-100 text-emerald-800"
                    : ["erro", "indisponivel"].includes((autoSync.sigtap_sync_ultimo_status || "").toLowerCase())
                      ? "bg-amber-100 text-amber-900 border border-amber-300"
                      : "bg-sus-900/10 text-sus-900"
                }`}
              >
                Status: {autoSync.sigtap_sync_ultimo_status || "Aguardando verificação"}
                {autoSync.sigtap_sync_ultima_competencia ? ` (${autoSync.sigtap_sync_ultima_competencia})` : ""}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-3 pt-1">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-sus-900/15 bg-white px-3 py-2 text-xs font-semibold text-sus-950">
              <input
                type="checkbox"
                checked={Boolean(autoSync?.sigtap_sync_automatica ?? true)}
                disabled={salvandoAutoSync}
                onChange={(e) => atualizarConfigAutoSync({ sigtap_sync_automatica: e.target.checked })}
                className="h-4 w-4 rounded border-sus-900/30 text-teal"
              />
              Sincronização diária automática ativa (1x ao dia)
            </label>

            <div>
              <Label className="text-xs">Competência (AAAA-MM)</Label>
              <Input
                type="month"
                value={competencia}
                onChange={(e) => setCompetencia(e.target.value)}
                className="mt-1 bg-white h-9"
              />
            </div>

            {/* Único botão para fazer agora */}
            <Button
              type="button"
              onClick={sincronizarAgora}
              disabled={executandoAutoSync || importando}
              className="!bg-teal !text-sus-950 font-bold flex items-center gap-1.5 !w-auto"
            >
              <RefreshCw className={`h-4 w-4 ${executandoAutoSync ? "animate-spin" : ""}`} />
              {executandoAutoSync ? "Sincronizando com DATASUS…" : "Sincronizar Tabela Agora"}
            </Button>
          </div>

          {/* Banner de Erro/Indisponibilidade que leva diretamente ao link de download oficial do DATASUS */}
          {avisoAuto && (
            <div className="rounded-xl border border-amber-400 bg-amber-50 p-4 text-xs text-amber-950 space-y-2.5 mt-3 animate-in fade-in">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-2 flex-1">
                  <div>
                    <p className="font-bold text-sm text-amber-950">
                      Não foi possível conectar ao portal do DATASUS
                    </p>
                    <p className="leading-relaxed text-amber-900 mt-0.5">
                      {avisoAuto.mensagem}
                    </p>
                  </div>
                  <div className="pt-1 flex flex-wrap items-center gap-3">
                    <a
                      href={avisoAuto.linkOficial || "http://sigtap.datasus.gov.br/tabela-unificada/app/download.jsp"}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 rounded-xl bg-amber-700 hover:bg-amber-800 text-white font-bold px-3.5 py-2 text-xs shadow-sm transition"
                    >
                      <Download className="h-4 w-4" />
                      Baixar Tabela Oficial no DATASUS (download.jsp)
                      <ExternalLink className="h-3.5 w-3.5 opacity-80" />
                    </a>
                    <span className="text-[11px] text-amber-900/80">
                      Após baixar o arquivo <b>.zip</b> no site oficial do DATASUS, utilize o campo de <b>Importação Manual</b> abaixo para carregar a tabela no sistema.
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Exibe último aviso registrado se não estiver exibindo aviso ativo */}
          {!avisoAuto && autoSync?.sigtap_sync_ultimo_erro && (
            <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2 text-[11px] text-amber-900">
              <span>Último aviso registrado: {autoSync.sigtap_sync_ultimo_erro}</span>
              <a
                href="http://sigtap.datasus.gov.br/tabela-unificada/app/download.jsp"
                target="_blank"
                rel="noreferrer"
                className="font-bold text-amber-800 underline hover:text-amber-950 flex items-center gap-1"
              >
                Link de Download DATASUS <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
        </div>

        {/* Bloco 2: Importação Manual de Arquivo */}
        <div className="rounded-2xl border border-sus-900/15 bg-white p-4 space-y-3">
          <div>
            <p className="font-bold text-sm text-sus-950 flex items-center gap-1.5">
              <Upload className="h-4 w-4 text-sus-900" /> Importação Manual de Arquivo (.zip / .txt / .csv)
            </p>
            <p className="text-xs text-ink/65 mt-0.5">
              Envie o pacote compactado (.zip oficial) do SIGTAP ou arquivos .txt/.csv avulsos do layout FTP do DATASUS.
              A simulação permite auditar a quantidade de procedimentos, CBOs e CIDs antes de gravar no banco de dados.
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-2.5">
            <div className="flex-1 min-w-[240px]">
              <Label className="text-xs">Arquivo da Tabela Unificada (.zip / .txt / .csv / .dat) *</Label>
              <Input
                type="file"
                accept=".zip,.txt,.csv,.dat"
                onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Competência</Label>
              <Input
                type="month"
                value={competencia}
                onChange={(e) => setCompetencia(e.target.value)}
                className="mt-1"
              />
            </div>
            <Button
              onClick={() => importar(true)}
              disabled={importando || !arquivo}
              className="!w-auto"
              variant="outline"
            >
              {importando ? "Processando…" : "Simular Carga"}
            </Button>
            <Button
              onClick={() => importar(false)}
              disabled={importando || !arquivo}
              className="!bg-teal !text-sus-950 font-bold !w-auto"
            >
              Aplicar Carga Manual
            </Button>
            <a
              href="/api/lab/sigtap/modelo"
              className="inline-flex min-h-[44px] items-center rounded-xl px-3 py-2 text-xs font-bold text-sus-900 hover:bg-sus-900/5 transition"
            >
              Baixar modelo CSV
            </a>
          </div>
        </div>

        {preview && (
          <div className="rounded-2xl bg-sand/60 p-4 text-xs border border-sus-900/10 space-y-1.5">
            <p className="font-bold text-sus-950 text-sm">
              {preview.simulacao ? "📊 Relatório de Simulação" : "✅ Carga Aplicada com Sucesso"} — {preview.arquivo} · Competência {preview.competencia}
            </p>
            <p className="text-ink/75">
              Registros Processados: <b>{preview.processados}</b> · Inseridos: <b>{preview.inseridos}</b> ·
              Atualizados: <b>{preview.atualizados}</b> · Ignorados: <b>{preview.ignorados}</b> ·
              Compatibilidades CBO: <b>{preview.cbo_total}</b> · Compatibilidades CID: <b>{preview.cid_total}</b>
            </p>
            {preview.erros.length > 0 && (
              <div className="mt-2 pt-2 border-t border-sus-900/10">
                <p className="font-semibold text-red-700 mb-1">Avisos / Inconsistências na leitura:</p>
                <ul className="space-y-1 text-ink/65 max-h-32 overflow-y-auto">
                  {preview.erros.slice(0, 10).map((e, i) => (
                    <li key={i}>· {e.arquivo} linha {e.linha}: {e.motivo}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <p className="flex items-center gap-2 border-b border-sus-900/10 bg-sand px-4 py-3 font-display text-sm font-bold text-sus-950">
          <History className="h-4 w-4" /> Histórico de versões importadas
        </p>
        <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b border-sus-900/10 text-xs uppercase text-sus-900/60">
            <th className="px-4 py-3">Competência</th><th className="px-4 py-3">Arquivo</th><th className="px-4 py-3">Proc.</th><th className="px-4 py-3">Inseridos</th><th className="px-4 py-3">Atualizados</th><th className="px-4 py-3">CBO/CID</th><th className="px-4 py-3">Por</th><th className="px-4 py-3">Em</th>
          </tr></thead>
          <tbody>
            {versoes.map((v) => (
              <tr key={v.id} className="border-b border-sus-900/5 last:border-0">
                <td className="px-4 py-3 font-mono font-bold">{v.competencia}</td>
                <td className="px-4 py-3 text-xs">{v.arquivo || "—"}</td>
                <td className="px-4 py-3 text-xs">{v.total_proc}</td>
                <td className="px-4 py-3 text-xs">{v.inseridos}</td>
                <td className="px-4 py-3 text-xs">{v.atualizados}</td>
                <td className="px-4 py-3 text-xs">{v.cbo_total}/{v.cid_total}</td>
                <td className="px-4 py-3 text-xs">{v.usuario || "—"}</td>
                <td className="px-4 py-3 text-xs">{v.criado_em || "—"}</td>
              </tr>
            ))}
            {versoes.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-ink/45">Nenhuma carga registrada.</td></tr>}
          </tbody>
        </table>
        </div>
      </Card>
    </div>
  );
}
