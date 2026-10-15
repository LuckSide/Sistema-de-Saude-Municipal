import { useEffect, useState } from "react";
import { ListPlus, Plus, Trash2 } from "lucide-react";
import {
  filaPsfCriar,
  filaPsfExcluir,
  filaPsfListar,
  tfdPacientes,
  pagData,
  pagMeta,
  type FilaPsfItem,
  type Paciente,
} from "../../services/api";
import { Button, Card, Input, Label } from "../../components/ui/primitives";
import Paginacao from "../../components/Paginacao";
import ExportarExcel from "../../components/ExportarExcel";

export default function FilaPsf() {
  const [lista, setLista] = useState<FilaPsfItem[]>([]);
  const [buscaPac, setBuscaPac] = useState("");
  const [pacientes, setPacientes] = useState<Paciente[]>([]);
  const [form, setForm] = useState({
    paciente_id: "",
    unidade_psf: "",
    medico: "",
    obs: "",
  });
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);

  async function carregar(p = page) {
    const r = await filaPsfListar(undefined, undefined, p, 100);
    setLista(pagData<FilaPsfItem>(r));
    const m = pagMeta(r);
    setTotal(m.total);
    setPage(m.page);
    setPages(m.pages);
  }

  useEffect(() => {
    carregar(1).catch(() => setErro("Falha ao carregar fila."));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      tfdPacientes(buscaPac || undefined).then((r) => setPacientes(pagData<Paciente>(r))).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [buscaPac]);

  function set(k: string, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function salvar() {
    setErro("");
    setOk("");
    if (!form.paciente_id) {
      setErro("Selecione o paciente.");
      return;
    }
    if (!form.unidade_psf.trim() || !form.medico.trim()) {
      setErro("Unidade PSF e médico são obrigatórios.");
      return;
    }
    try {
      await filaPsfCriar({
        paciente_id: Number(form.paciente_id),
        unidade_psf: form.unidade_psf.trim(),
        medico: form.medico.trim(),
        obs: form.obs.trim(),
      });
      setForm({ paciente_id: "", unidade_psf: "", medico: "", obs: "" });
      setBuscaPac("");
      setOk("Pedido incluído na fila.");
      await carregar();
    } catch {
      setErro("Erro ao incluir na fila.");
    }
  }

  async function excluir(id: number) {
    if (!confirm("Remover da fila?")) return;
    try {
      await filaPsfExcluir(id);
      setOk("Removido da fila.");
      await carregar();
    } catch {
      setErro("Erro ao remover.");
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <h2 className="font-display text-lg font-bold text-sus-950">
          Fila do PSF
        </h2>
        <span className="rounded-full bg-teal/10 px-2.5 py-0.5 text-xs font-semibold text-teal">
          {total > 0 ? total : lista.length} aguardando
        </span>
        <span className="ml-auto"><ExportarExcel url="/api/exames/fila-psf/exportar" arquivo="fila_psf" /></span>
      </div>

      {erro && (
        <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
          {erro}
        </p>
      )}
      {ok && (
        <p className="mb-3 rounded-xl bg-teal/10 px-3 py-2 text-sm text-teal">
          {ok}
        </p>
      )}

      <Card className="mb-4 p-5">
        <p className="mb-3 flex items-center gap-2 font-display text-sm font-bold text-sus-950">
          <ListPlus className="h-4 w-4" /> Novo pedido da unidade
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label>Paciente *</Label>
            <Input
              placeholder="Buscar por nome…"
              value={buscaPac}
              onChange={(e) => setBuscaPac(e.target.value)}
            />
            <select
              value={form.paciente_id}
              onChange={(e) => set("paciente_id", e.target.value)}
              className="mt-1 w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm"
            >
              <option value="">Selecionar…</option>
              {pacientes.slice(0, 15).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Unidade PSF *</Label>
            <Input
              placeholder="Ex: PSF Centro"
              value={form.unidade_psf}
              onChange={(e) => set("unidade_psf", e.target.value)}
            />
          </div>
          <div>
            <Label>Médico solicitante *</Label>
            <Input
              placeholder="Nome do médico"
              value={form.medico}
              onChange={(e) => set("medico", e.target.value)}
            />
          </div>
          <div className="md:col-span-2">
            <Label>Observações</Label>
            <Input
              placeholder="Queixas, hipótese, prioridade…"
              value={form.obs}
              onChange={(e) => set("obs", e.target.value)}
            />
          </div>
        </div>
        <Button onClick={salvar} className="mt-4">
          <Plus className="h-4 w-4" /> Incluir na fila
        </Button>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-sus-900/10 bg-sand text-xs uppercase text-sus-900/60">
              <th className="px-4 py-3">Paciente</th>
              <th className="px-4 py-3">PSF / Médico</th>
              <th className="px-4 py-3">Obs</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Ação</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((f) => (
              <tr
                key={f.id}
                className="border-b border-sus-900/5 last:border-0"
              >
                <td className="px-4 py-3 font-semibold">{f.paciente_nome}</td>
                <td className="px-4 py-3 text-xs">
                  {f.unidade_psf}
                  <p className="text-ink/50">{f.medico}</p>
                </td>
                <td className="px-4 py-3 text-xs text-ink/60">
                  {f.obs || "—"}
                </td>
                <td className="px-4 py-3 text-xs">{f.status}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => excluir(f.id)}
                    className="rounded-lg p-2 text-red-600 hover:bg-red-50"
                    title="Remover"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
            {lista.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-ink/45"
                >
                  Fila vazia.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
        <Paginacao page={page} pages={pages} total={total} onPage={(p) => carregar(p).catch(() => setErro("Falha ao carregar fila."))} />
      </Card>
    </div>
  );
}
