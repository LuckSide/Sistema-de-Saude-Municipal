import { useEffect, useState } from "react";
import { History, Upload } from "lucide-react";
import {
  labSigtap,
  pagData,
  pagMeta,
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

      <Card className="mb-4 p-4">
        <p className="mb-1 flex items-center gap-2 font-display text-base font-bold text-sus-950">
          <Upload className="h-4 w-4" /> Importação da Tabela Unificada (SIGTAP/DATASUS)
        </p>
        <p className="mb-3 text-xs text-ink/55">
          Envie o .zip mensal oficial ou .txt/.csv do layout (procedimentos com código de 10 dígitos, valores SA/SP/SH,
          CBOs e CIDs compatíveis). Simule antes de aplicar. Fonte: sigtap.datasus.gov.br/tabela-unificada.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <Label>Arquivo (.zip / .txt / .csv)</Label>
            <Input type="file" accept=".zip,.txt,.csv,.dat" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
          </div>
          <div>
            <Label>Competência (AAAA-MM)</Label>
            <Input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} />
          </div>
          <Button onClick={() => importar(true)} disabled={importando || !arquivo}>
            {importando ? "Processando…" : "Simular"}
          </Button>
          <Button onClick={() => importar(false)} disabled={importando || !arquivo} className="!bg-teal !text-sus-950">
            Aplicar carga
          </Button>
          <a href="/api/lab/sigtap/modelo" className="inline-flex min-h-[44px] items-center rounded-xl px-3 py-2 text-xs font-bold text-sus-900 hover:bg-sus-900/5">
            Baixar modelo CSV
          </a>
        </div>
        {preview && (
          <div className="mt-3 rounded-2xl bg-sand/60 p-4 text-xs">
            <p className="font-bold text-sus-950">
              {preview.simulacao ? "Simulação" : "Carga aplicada"} — {preview.arquivo} · competência {preview.competencia}
            </p>
            <p className="mt-1 text-ink/70">
              Processados: <b>{preview.processados}</b> · Inseridos: <b>{preview.inseridos}</b> ·
              Atualizados: <b>{preview.atualizados}</b> · Ignorados: <b>{preview.ignorados}</b> ·
              CBOs: <b>{preview.cbo_total}</b> · CIDs: <b>{preview.cid_total}</b>
            </p>
            {preview.erros.length > 0 && (
              <ul className="mt-2 space-y-1 text-ink/60">
                {preview.erros.slice(0, 10).map((e, i) => (
                  <li key={i}>· {e.arquivo} linha {e.linha}: {e.motivo}</li>
                ))}
              </ul>
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
