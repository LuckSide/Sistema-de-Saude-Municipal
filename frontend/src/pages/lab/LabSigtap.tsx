import { useEffect, useState } from "react";
import { labSigtap, pagData, pagMeta, type SigtapProc } from "../../services/api";
import { Card, Input, Label } from "../../components/ui/primitives";
import Paginacao from "../../components/Paginacao";

const INSTRUMENTOS = ["BPA-C", "BPA-I", "BPA-F"];

export default function LabSigtap() {
  const [q, setQ] = useState("");
  const [inst, setInst] = useState("");
  const [lista, setLista] = useState<SigtapProc[]>([]);
  const [erro, setErro] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);

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

  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      buscar(1);
    }, 250);
    return () => clearTimeout(t);
  }, [q, inst]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="font-display text-lg font-bold text-sus-950">Tabela SIGTAP</h2>
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

      <Card className="overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-sus-900/10 bg-sand text-xs uppercase text-sus-900/60">
              <th className="px-4 py-3">Código</th>
              <th className="px-4 py-3">Descrição</th>
              <th className="px-4 py-3">Complexidade</th>
              <th className="px-4 py-3">Instrumento</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((s) => (
              <tr key={s.id ?? s.codigo} className="border-b border-sus-900/5 last:border-0">
                <td className="px-4 py-3 font-mono font-semibold">{s.codigo}</td>
                <td className="px-4 py-3">{s.descricao}</td>
                <td className="px-4 py-3 text-xs">{s.complexidade || "—"}</td>
                <td className="px-4 py-3 text-xs">{s.instrumento}</td>
              </tr>
            ))}
            {lista.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-ink/45">Nada encontrado.</td></tr>}
          </tbody>
        </table>
        <Paginacao page={page} pages={pages} total={total} onPage={(p) => buscar(p)} />
      </Card>
    </div>
  );
}
