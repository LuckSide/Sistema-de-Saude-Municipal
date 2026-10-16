import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2, X, ChartColumn } from "lucide-react";
import {
  tfdAtualizarVeiculo,
  tfdCriarVeiculo,
  tfdExcluirVeiculo,
  tfdRelatorioFrota,
  tfdVeiculos,
  pagData,
  pagMeta,
  type RelatorioFrota,
  type Veiculo,
} from "../../services/api";
import { Button, Card, Input, Label } from "../../components/ui/primitives";
import Paginacao from "../../components/Paginacao";
import ExportarExcel from "../../components/ExportarExcel";

const vazio = { placa: "", modelo: "", capacidade: "4", tipo: "carro", status: "disponivel", ativo: true };

export default function TfdFrota() {
  const [aba, setAba] = useState<"veiculos" | "relatorio">("veiculos");
  const [lista, setLista] = useState<Veiculo[]>([]);
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(vazio);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  // Relatório da frota
  const [relDe, setRelDe] = useState(() => new Date().toISOString().slice(0, 7) + "-01");
  const [relAte, setRelAte] = useState(() => new Date().toISOString().slice(0, 10));
  const [rel, setRel] = useState<RelatorioFrota | null>(null);
  const [relErro, setRelErro] = useState("");
  const [relLoading, setRelLoading] = useState(false);

  async function carregar(p = page) {
    const r = await tfdVeiculos(p, 100);
    setLista(pagData<Veiculo>(r));
    const m = pagMeta(r);
    setTotal(m.total);
    setPage(m.page);
    setPages(m.pages);
  }
  useEffect(() => {
    carregar(1).catch(() => setErro("Falha ao carregar frota."));
  }, []);

  async function carregarRelatorio() {
    setRelLoading(true);
    setRelErro("");
    try {
      setRel(await tfdRelatorioFrota(relDe || undefined, relAte || undefined));
    } catch {
      setRelErro("Falha ao carregar relatório.");
    } finally {
      setRelLoading(false);
    }
  }

  useEffect(() => {
    if (aba === "relatorio" && !rel) carregarRelatorio().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aba]);

  function abrirModal(id?: number) {
    if (id) {
      const v = lista.find((x) => x.id === id);
      if (v) {
        setEditId(v.id);
        setForm({ placa: v.placa, modelo: v.modelo, capacidade: String(v.capacidade), tipo: v.tipo, status: v.status || "disponivel", ativo: v.ativo });
      }
    } else {
      setEditId(null);
      setForm(vazio);
    }
    setModal(true);
  }

  function fecharModal() {
    setModal(false);
    setEditId(null);
    setForm(vazio);
    setErro("");
    setOk("");
  }

  async function salvar() {
    setErro("");
    setOk("");
    if (form.placa.trim().length < 7) {
      setErro("Placa obrigatória.");
      return;
    }
    const payload = { ...form, capacidade: Number(form.capacidade) || 4 };
    try {
      if (editId) {
        await tfdAtualizarVeiculo(editId, payload);
        fecharModal();
        setOk("Veículo atualizado.");
      } else {
        await tfdCriarVeiculo(payload);
        fecharModal();
        setOk("Veículo cadastrado.");
      }
      await carregar();
    } catch {
      setErro("Erro ao salvar. Placa pode já existir.");
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="font-display text-lg font-bold text-sus-950">Frota</h2>
        <div className="inline-flex rounded-xl border border-sus-900/10 bg-white p-1">
          {(["veiculos", "relatorio"] as const).map((a) => (
            <button
              key={a}
              onClick={() => setAba(a)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${aba === a ? "bg-sus-900 text-white" : "text-sus-900 hover:bg-sand"}`}
            >
              {a === "veiculos" ? "Veículos" : "Relatório"}
            </button>
          ))}
        </div>
        {aba === "veiculos" && (
          <Button onClick={() => abrirModal()} className="ml-auto"><Plus className="h-4 w-4" /> Novo veículo</Button>
        )}
        {aba === "relatorio" && (
          <span className="ml-auto">
            <ExportarExcel
              url="/api/tfd/frota/relatorio/exportar"
              arquivo="relatorio_frota"
              params={{ de: relDe || undefined, ate: relAte || undefined }}
            />
          </span>
        )}
      </div>
      {erro && !modal && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
      {ok && <p className="mb-3 rounded-xl bg-teal/10 px-3 py-2 text-sm text-teal">{ok}</p>}

      {aba === "veiculos" && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {lista.map((v) => (
              <Card key={v.id} className="p-4">
                <div className="flex items-start justify-between">
                  <p className="rounded-lg bg-sus-900 px-2.5 py-1 font-display text-sm font-bold text-white">{v.placa}</p>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${v.ativo ? "bg-teal/10 text-teal" : "bg-sus-900/10 text-sus-900/60"}`}>{v.ativo ? "ativo" : "inativo"}</span>
                </div>
                <p className="mt-2 font-semibold text-sus-950">{v.modelo || "—"}</p>
                <p className="text-xs text-ink/55">{v.tipo} · {v.capacidade} lugares · {v.status === "manutencao" ? "em manutenção" : "disponível"}</p>
                <div className="mt-2 flex gap-1">
                  <button onClick={() => abrirModal(v.id)} className="rounded-lg p-2 text-sus-800 hover:bg-sus-100"><Pencil className="h-4 w-4" /></button>
                  <button onClick={async () => { if (confirm("Excluir veículo?")) { await tfdExcluirVeiculo(v.id); carregar(); } }} className="rounded-lg p-2 text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
                </div>
              </Card>
            ))}
            {lista.length === 0 && <p className="text-sm text-ink/45">Nenhum veículo.</p>}
          </div>
          <div className="mt-3 overflow-hidden rounded-2xl border border-sus-900/10 bg-white">
            <Paginacao page={page} pages={pages} total={total} onPage={(p) => carregar(p).catch(() => setErro("Falha ao carregar frota."))} />
          </div>
        </>
      )}

      {aba === "relatorio" && (
        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex flex-wrap items-end gap-2">
              <div><Label>De</Label><Input type="date" value={relDe} onChange={(e) => setRelDe(e.target.value)} /></div>
              <div><Label>Até</Label><Input type="date" value={relAte} onChange={(e) => setRelAte(e.target.value)} /></div>
              <Button onClick={carregarRelatorio} className="!w-auto"><ChartColumn className="h-4 w-4" /> {relLoading ? "Gerando…" : "Gerar relatório"}</Button>
            </div>
            {relErro && <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{relErro}</p>}
          </Card>
          {rel && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ["Viagens no período", String(rel.total_viagens)],
                  ["Agendadas", String(rel.por_status.agendada ?? 0)],
                  ["Concluídas", String(rel.por_status.concluida ?? 0)],
                  ["Km rodados", `${rel.km_total} km`],
                  ["Ocupação média", `${Math.round(rel.ocupacao_media * 100)}%`],
                  ["Veículo mais usado", rel.mais_usado_veiculo ? `${rel.mais_usado_veiculo.placa} (${rel.mais_usado_veiculo.viagens})` : "—"],
                  ["Motorista mais usado", rel.mais_usado_motorista ? `${rel.mais_usado_motorista.motorista} (${rel.mais_usado_motorista.viagens})` : "—"],
                ].map(([k, v]) => (
                  <Card key={k} className="p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/50">{k}</p>
                    <p className="font-display text-lg font-extrabold text-sus-950">{v}</p>
                  </Card>
                ))}
              </div>
              <Card className="overflow-hidden">
                <p className="border-b border-sus-900/10 bg-sand px-4 py-3 font-display text-sm font-bold text-sus-950">Viagens por veículo</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead><tr className="border-b border-sus-900/10 text-xs uppercase text-sus-900/60">
                      <th className="px-4 py-3">Veículo</th><th className="px-4 py-3">Modelo</th>
                      <th className="px-4 py-3">Viagens</th><th className="px-4 py-3">Km</th><th className="px-4 py-3">Ocupação média</th>
                    </tr></thead>
                    <tbody>
                      {rel.por_veiculo.map((v) => (
                        <tr key={`${v.veiculo_id}-${v.placa}`} className="border-b border-sus-900/5 last:border-0">
                          <td className="px-4 py-2.5 font-mono font-bold">{v.placa}</td>
                          <td className="px-4 py-2.5">{v.modelo || "—"}</td>
                          <td className="px-4 py-2.5">{v.viagens}</td>
                          <td className="px-4 py-2.5">{v.km} km</td>
                          <td className="px-4 py-2.5">{Math.round(v.ocupacao_media * 100)}%</td>
                        </tr>
                      ))}
                      {rel.por_veiculo.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-ink/45">Sem viagens no período.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </Card>
              <Card className="overflow-hidden">
                <p className="border-b border-sus-900/10 bg-sand px-4 py-3 font-display text-sm font-bold text-sus-950">Viagens por motorista</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead><tr className="border-b border-sus-900/10 text-xs uppercase text-sus-900/60">
                      <th className="px-4 py-3">Motorista</th><th className="px-4 py-3">Viagens</th><th className="px-4 py-3">Km</th>
                    </tr></thead>
                    <tbody>
                      {rel.por_motorista.map((m) => (
                        <tr key={m.motorista} className="border-b border-sus-900/5 last:border-0">
                          <td className="px-4 py-2.5 font-semibold">{m.motorista}</td>
                          <td className="px-4 py-2.5">{m.viagens}</td>
                          <td className="px-4 py-2.5">{m.km} km</td>
                        </tr>
                      ))}
                      {rel.por_motorista.length === 0 && <tr><td colSpan={3} className="px-4 py-6 text-center text-ink/45">Sem viagens no período.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4" onClick={fecharModal}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <p className="font-display text-base font-bold text-sus-950">{editId ? "Editar veículo" : "Novo veículo"}</p>
              <button onClick={fecharModal} className="rounded-lg p-2 text-ink/50 hover:bg-sand"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-5">
                <div><Label>Placa *</Label><Input value={form.placa} onChange={(e) => setForm({ ...form, placa: e.target.value.toUpperCase() })} placeholder="ABC1D23" /></div>
                <div className="md:col-span-2"><Label>Modelo</Label><Input value={form.modelo} onChange={(e) => setForm({ ...form, modelo: e.target.value })} placeholder="Ex: Spin 1.8" /></div>
                <div><Label>Capacidade</Label><Input type="number" min={1} max={60} value={form.capacidade} onChange={(e) => setForm({ ...form, capacidade: e.target.value })} /></div>
                <div>
                  <Label>Status</Label>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
                    <option value="disponivel">Disponível</option>
                    <option value="manutencao">Em manutenção</option>
                  </select>
                </div>
                <div>
                  <Label>Tipo</Label>
                  <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })} className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
                    <option value="carro">carro</option>
                    <option value="van">van</option>
                    <option value="micro">micro</option>
                    <option value="amb">ambulância</option>
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} className="h-4 w-4 accent-teal" /> Ativo
                </label>
              </div>
              {erro && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
              <Button onClick={salvar} className="w-full"><Plus className="h-4 w-4" />{editId ? "Atualizar" : "Cadastrar veículo"}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}