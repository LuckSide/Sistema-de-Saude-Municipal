import { useEffect, useState } from "react";
import { CheckCheck, Download } from "lucide-react";
import {
  labExportarLote,
  labMarcarFaturado,
  labProntos,
  pagData,
  pagMeta,
  type LabSol,
} from "../../services/api";
import { Button, Card, Input, Label } from "../../components/ui/primitives";
import Paginacao from "../../components/Paginacao";

export default function LabFaturamento() {
  const [comp, setComp] = useState(() => new Date().toISOString().slice(0, 7));
  const [lista, setLista] = useState<LabSol[]>([]);
  const [sel, setSel] = useState<number[]>([]);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);

  async function carregar(p = page) {
    const r = await labProntos(comp || undefined, p, 100);
    setLista(pagData<LabSol>(r));
    const m = pagMeta(r);
    setTotal(m.total);
    setPage(m.page);
    setPages(m.pages);
    setSel([]);
  }

  useEffect(() => {
    carregar(1).catch(() => setErro("Falha ao carregar prontos."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comp]);

  function toggle(id: number) {
    setSel((s) => (s.includes(id) ? s.filter((i) => i !== id) : [...s, id]));
  }

  function todos() {
    setSel((s) => (s.length === lista.length ? [] : lista.map((i) => i.id)));
  }

  async function faturar() {
    setErro("");
    setOk("");
    if (sel.length === 0) {
      setErro("Selecione ao menos um exame realizado.");
      return;
    }
    setBusy(true);
    try {
      const r = await labMarcarFaturado(sel);
      setOk(`${r.atualizados ?? sel.length} exame(s) marcado(s) como faturado.`);
      await carregar();
    } catch {
      setErro("Erro ao marcar como faturado.");
    } finally {
      setBusy(false);
    }
  }

  async function exportar() {
    setErro("");
    setOk("");
    if (!comp) {
      setErro("Informe a competência AAAA-MM.");
      return;
    }
    setBusy(true);
    try {
      const blob = await labExportarLote(comp);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `lote_bpa_${comp}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setOk("Lote BPA consolidado exportado em CSV.");
    } catch {
      setErro("Erro ao exportar lote.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="font-display text-lg font-bold text-sus-950">Faturamento BPA</h2>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Input type="month" value={comp} onChange={(e) => setComp(e.target.value)} className="!w-auto" />
          <Button onClick={faturar} disabled={busy}>
            <CheckCheck className="h-4 w-4" /> Marcar como Faturado
          </Button>
          <Button onClick={exportar} disabled={busy} className="!bg-teal !text-sus-950">
            <Download className="h-4 w-4" /> Exportar Lote BPA
          </Button>
        </div>
      </div>

      {erro && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
      {ok && <p className="mb-3 rounded-xl bg-teal/10 px-3 py-2 text-sm font-medium text-teal">{ok}</p>}

      <Card className="overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-sus-900/10 bg-sand text-xs uppercase text-sus-900/60">
              <th className="px-4 py-3">
                <input type="checkbox" checked={sel.length > 0 && sel.length === lista.length} onChange={todos} />
              </th>
              <th className="px-4 py-3">Paciente</th>
              <th className="px-4 py-3">Procedimento</th>
              <th className="px-4 py-3">Competência</th>
              <th className="px-4 py-3">Laboratório</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((s) => (
              <tr key={s.id} className="border-b border-sus-900/5 last:border-0">
                <td className="px-4 py-3">
                  <input type="checkbox" checked={sel.includes(s.id)} onChange={() => toggle(s.id)} />
                </td>
                <td className="px-4 py-3 font-semibold">{s.paciente_nome}</td>
                <td className="px-4 py-3">{s.procedimento_descricao}<p className="text-xs text-ink/50">{s.procedimento_codigo}</p></td>
                <td className="px-4 py-3 text-xs">{s.competencia}</td>
                <td className="px-4 py-3 text-xs">{s.laboratorio}</td>
              </tr>
            ))}
            {lista.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-ink/45">Nenhum realizado pronto para faturar.</td></tr>}
          </tbody>
        </table>
        <Paginacao page={page} pages={pages} total={total} onPage={(p) => carregar(p).catch(() => setErro("Falha ao carregar prontos."))} />
      </Card>

      <p className="mt-3 text-xs text-ink/50">
        <Label>Como funciona</Label>
        Realizados não faturados da competência. Marque como faturado e exporte o lote consolidado (codigo,qtd).
      </p>
    </div>
  );
}
