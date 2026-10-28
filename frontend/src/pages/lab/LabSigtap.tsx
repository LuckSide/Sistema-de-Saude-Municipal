import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Download,
  ExternalLink,
  Globe,
  History,
  RefreshCw,
  Sparkles,
  Upload,
} from "lucide-react";
import {
  labSigtap,
  pagData,
  pagMeta,
  sigtapBuscarAutomatico,
  sigtapImportar,
  sigtapVersoes,
  type SigtapImportOut,
  type SigtapProc,
  type SigtapVersao,
} from "../../services/api";
import { Button, Card, Input, Label } from "../../components/ui/primitives";
import Paginacao from "../../components/Paginacao";
import ExportarExcel from "../../components/ExportarExcel";

const INSTRUMENTOS = ["BPA-C", "BPA-I", "BPA-F", "AIH", "APAC", "RAAS"];

function brl(v: number | undefined): string {
  return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function LabSigtap() {
  const [q, setQ] = useState("");
  const [inst, setInst] = useState("");
  const [lista, setLista] = useState<SigtapProc[]>([]);
  const [erro, setErro] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);

  // Importação Tabela Unificada
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [competencia, setCompetencia] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 7);
  });
  const [importando, setImportando] = useState(false);
  const [buscandoAuto, setBuscandoAuto] = useState(false);
  const [avisoAuto, setAvisoAuto] = useState<{ mensagem: string; linkOficial?: string } | null>(null);
  const [preview, setPreview] = useState<SigtapImportOut | null>(null);
  const [versoes, setVersoes] = useState<SigtapVersao[]>([]);
  const [ok, setOk] = useState("");

  function buscar(p = 1) {
    labSigtap(q || undefined, inst || undefined, p, 100)
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

  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      buscar(1);
    }, 250);
    return () => clearTimeout(t);
  }, [q, inst]);

  useEffect(() => {
    carregarVersoes();
  }, []);

  async function buscarAutomatico(simular: boolean) {
    if (!/^\d{4}-\d{2}$/.test(competencia)) {
      setErro("Competência inválida (AAAA-MM).");
      return;
    }
    setBuscandoAuto(true);
    setErro("");
    setOk("");
    setAvisoAuto(null);
    try {
      const r = await sigtapBuscarAutomatico(competencia, simular);
      setPreview(r);
      if (!simular) {
        setOk(
          `Tabela do DATASUS (${competencia}) baixada e importada com sucesso: ${r.inseridos} inseridos, ${r.atualizados} atualizados.`,
        );
        carregarVersoes();
        buscar(1);
      } else {
        setOk(`Simulação concluída com sucesso (${competencia}): ${r.processados} registros validados.`);
      }
    } catch (e: unknown) {
      const detalhe =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        "O serviço de download automático do portal DATASUS/SIGTAP está temporariamente indisponível ou inacessível no momento. Por favor, acesse a fonte oficial do DATASUS (http://sigtap.datasus.gov.br/tabela-unificada/app/download.jsp), baixe o arquivo mensal compactado (.zip) da Tabela Unificada e utilize a importação manual de arquivo logo abaixo.";
      setAvisoAuto({
        mensagem: detalhe,
        linkOficial: "http://sigtap.datasus.gov.br/tabela-unificada/app/download.jsp",
      });
    } finally {
      setBuscandoAuto(false);
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
        <h2 className="font-display text-lg font-bold text-sus-950">Tabela SIGTAP</h2>
        <span className="ml-auto"><ExportarExcel url="/api/lab/sigtap/exportar" arquivo="sigtap" params={{ q: q.trim() || undefined, instrumento: inst || undefined }} /></span>
      </div>

      <Card className="mb-4 p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="md:col-span-2">
            <Label>Busca rápida</Label>
            <Input placeholder="Código ou descrição do procedimento…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div>
            <Label>Instrumento</Label>
            <select value={inst} onChange={(e) => setInst(e.target.value)} className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
              <option value="">Todos</option>
              {INSTRUMENTOS.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
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
              <th className="px-4 py-3">Descrição</th>
              <th className="px-4 py-3">Complexidade</th>
              <th className="px-4 py-3">Instrumento</th>
              <th className="px-4 py-3">Valores SA/SP/SH</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((s) => (
              <tr key={s.id ?? s.codigo} className="border-b border-sus-900/5 last:border-0">
                <td className="px-4 py-3 font-mono font-semibold">{s.codigo}</td>
                <td className="px-4 py-3">{s.descricao}</td>
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

        {/* Bloco 1: Integração de Download Automático */}
        <div className="rounded-2xl border border-teal/25 bg-teal/5 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-bold text-sm text-sus-950 flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-teal" /> Download Automático Direto do DATASUS
              </p>
              <p className="text-xs text-ink/65 mt-0.5">
                Busca diretamente no portal oficial do SIGTAP a tabela unificada mensal da competência selecionada.
              </p>
            </div>
            <a
              href="http://sigtap.datasus.gov.br/tabela-unificada/app/download.jsp"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl border border-sus-900/15 bg-white px-3 py-1.5 text-xs font-semibold text-sus-900 hover:bg-sand transition"
            >
              <ExternalLink className="h-3.5 w-3.5 text-sus-900/60" />
              Fonte Oficial: DATASUS (download.jsp)
            </a>
          </div>

          <div className="flex flex-wrap items-end gap-2.5 pt-1">
            <div>
              <Label className="text-xs">Competência (AAAA-MM)</Label>
              <Input
                type="month"
                value={competencia}
                onChange={(e) => setCompetencia(e.target.value)}
                className="mt-1 bg-white"
              />
            </div>
            <Button
              type="button"
              onClick={() => buscarAutomatico(false)}
              disabled={buscandoAuto || importando}
              className="!bg-teal !text-sus-950 font-bold flex items-center gap-1.5 !w-auto"
            >
              <Download className="h-4 w-4" />
              {buscandoAuto ? "Conectando ao DATASUS…" : "Buscar Tabela Automática (SIGTAP/Datasus)"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => buscarAutomatico(true)}
              disabled={buscandoAuto || importando}
              className="!w-auto bg-white"
            >
              Simular Busca Automática
            </Button>
          </div>

          {/* Aviso informativo e amigável em caso de indisponibilidade da fonte DATASUS */}
          {avisoAuto && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-950 space-y-2 mt-3 animate-in fade-in">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-1.5 flex-1">
                  <p className="font-bold text-sm text-amber-950">
                    Aviso de Conexão com o Portal DATASUS
                  </p>
                  <p className="leading-relaxed text-amber-900">
                    {avisoAuto.mensagem}
                  </p>
                  <div className="pt-2 flex flex-wrap items-center gap-3">
                    <a
                      href={avisoAuto.linkOficial || "http://sigtap.datasus.gov.br/tabela-unificada/app/download.jsp"}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-amber-700 px-3 py-1.5 font-bold text-white hover:bg-amber-800 transition"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Acessar Portal Oficial SIGTAP (download.jsp)
                    </a>
                    <span className="text-[11px] font-medium text-amber-800">
                      💡 <b>Como proceder:</b> Baixe o arquivo (.zip) mensal no link acima e faça o upload manual no formulário abaixo.
                    </span>
                  </div>
                </div>
              </div>
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
