import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2, Search, X } from "lucide-react";
import {
  tfdAtualizarExame,
  tfdBuscarPacientesPec,
  tfdCriarExame,
  tfdExames,
  tfdExcluirExame,
  tfdPacientes,
  pagData,
  pagMeta,
  type Exame,
  type Paciente,
  type PacientePec,
} from "../../services/api";
import { Button, Card, Input, Label } from "../../components/ui/primitives";
import Paginacao from "../../components/Paginacao";
import { PRIO_ROTULO } from "../../utils/rotulos";

const STATUS = ["aguardando", "agendado", "realizado", "cancelado"];

const vazio = {
  paciente_id: "",
  exame: "",
  justificativa: "",
  especialidade: "",
  prioridade: "rotina",
  status: "aguardando",
  data_pedido: new Date().toISOString().slice(0, 10),
  data_agendada: "",
  destino: "",
  observacoes: "",
};

export default function TfdExames() {
  const [lista, setLista] = useState<Exame[]>([]);
  const [filtro, setFiltro] = useState("aguardando");
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(vazio);
  const [pacientesPec, setPacientesPec] = useState<PacientePec[]>([]);
  const [pacientesLocais, setPacientesLocais] = useState<Paciente[]>([]);
  const [buscaPac, setBuscaPac] = useState("");
  const [buscaDebounce, setBuscaDebounce] = useState("");
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);

  async function carregar(p = page) {
    const r = await tfdExames({ status: filtro || undefined, page: p, limit: 100 });
    setLista(pagData<Exame>(r));
    const m = pagMeta(r);
    setTotal(m.total);
    setPage(m.page);
    setPages(m.pages);
  }
  useEffect(() => {
    carregar(1).catch(() => setErro("Falha ao carregar fila."));
    tfdPacientes("").then((r) => setPacientesLocais(pagData<Paciente>(r))).catch(() => {});
  }, [filtro]);

  useEffect(() => {
    const t = setTimeout(() => {
      setBuscaDebounce(buscaPac);
    }, 250);
    return () => clearTimeout(t);
  }, [buscaPac]);

  useEffect(() => {
    if (!buscaDebounce || buscaDebounce.length < 2) {
      setPacientesPec([]);
      return;
    }
    tfdBuscarPacientesPec(buscaDebounce)
      .then((r) => setPacientesPec(r.resultados))
      .catch(() => setPacientesPec([]));
  }, [buscaDebounce]);

  function abrirModal(id?: number) {
    if (id) {
      const e = lista.find((x) => x.id === id);
      if (e) {
        setEditId(e.id);
        setForm({
          paciente_id: String(e.paciente_id),
          exame: e.exame,
          justificativa: e.justificativa ?? "",
          especialidade: e.especialidade,
          prioridade: e.prioridade,
          status: e.status,
          data_pedido: e.data_pedido,
          data_agendada: e.data_agendada ?? "",
          destino: e.destino,
          observacoes: e.observacoes,
        });
      }
    } else {
      setEditId(null);
      setForm({ ...vazio, data_pedido: new Date().toISOString().slice(0, 10) });
    }
    setModal(true);
  }

  function fecharModal() {
    setModal(false);
    setEditId(null);
    setForm({ ...vazio, data_pedido: new Date().toISOString().slice(0, 10) });
    setBuscaPac("");
    setBuscaDebounce("");
    setPacientesPec([]);
    setErro("");
    setOk("");
  }

  async function salvar() {
    setErro("");
    setOk("");
    if (!form.paciente_id || !form.exame || !form.data_pedido) {
      setErro("Paciente, exame e data do pedido são obrigatórios.");
      return;
    }
    if (!form.justificativa || form.justificativa.trim().length < 12) {
      setErro("A justificativa é obrigatória e deve ter pelo menos 12 caracteres.");
      return;
    }
    const payload: Record<string, unknown> = {
      ...form,
      paciente_id: Number(form.paciente_id),
      data_agendada: form.data_agendada || null,
      justificativa: form.justificativa.trim(),
    };
    try {
      if (editId) {
        await tfdAtualizarExame(editId, payload);
        fecharModal();
        setOk("Exame atualizado.");
      } else {
        await tfdCriarExame(payload);
        fecharModal();
        setOk("Exame inserido na fila.");
      }
      await carregar();
    } catch {
      setErro("Erro ao salvar.");
    }
  }

  const prioCor: Record<string, string> = {
    rotina: "bg-sus-900/10 text-sus-900",
    urgente: "bg-red-100 text-red-700",
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="font-display text-lg font-bold text-sus-950">Fila de exames</h2>
        <select value={filtro} onChange={(e) => setFiltro(e.target.value)} className="ml-auto rounded-xl border border-sus-900/15 bg-white px-3 py-2 text-sm">
          <option value="">Todos</option>
          {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <Button onClick={() => abrirModal()}><Plus className="h-4 w-4" /> Novo exame</Button>
      </div>
      {erro && !modal && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
      {ok && <p className="mb-3 rounded-xl bg-teal/10 px-3 py-2 text-sm text-teal">{ok}</p>}

      <Card className="overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b border-sus-900/10 bg-sand text-xs uppercase text-sus-900/60">
            <th className="px-4 py-3">Paciente</th><th className="px-4 py-3">Exame</th><th className="px-4 py-3">Prioridade</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Ações</th>
          </tr></thead>
          <tbody>
            {lista.map((e) => (
              <tr key={e.id} className="border-b border-sus-900/5 last:border-0">
                <td className="px-4 py-3 font-semibold">{e.paciente_nome}<p className="text-xs font-normal text-ink/50">pedido {e.data_pedido.split("-").reverse().join("/")} {e.destino ? `· ${e.destino}` : ""}</p></td>
                <td className="px-4 py-3">{e.exame}<p className="text-xs text-ink/50">{e.especialidade || "—"}</p></td>
                <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${prioCor[e.prioridade] ?? ""}`}>{PRIO_ROTULO[e.prioridade] ?? e.prioridade}</span></td>
                <td className="px-4 py-3 text-xs">{e.status}{e.data_agendada ? ` · ${e.data_agendada.split("-").reverse().join("/")}` : ""}</td>
                <td className="px-4 py-3"><div className="flex justify-end gap-1">
                  <button onClick={() => abrirModal(e.id)} className="rounded-lg p-2 text-sus-800 hover:bg-sus-100"><Pencil className="h-4 w-4" /></button>
                  <button onClick={async () => { if (confirm("Excluir da fila?")) { await tfdExcluirExame(e.id); carregar(); } }} className="rounded-lg p-2 text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
                </div></td>
              </tr>
            ))}
            {lista.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-ink/45">Fila vazia.</td></tr>}
          </tbody>
        </table>
        <Paginacao page={page} pages={pages} total={total} onPage={(p) => carregar(p).catch(() => setErro("Falha ao carregar fila."))} />
      </Card>

      {modal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4" onClick={fecharModal}>
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <p className="font-display text-base font-bold text-sus-950">{editId ? "Editar exame" : "Novo exame na fila"}</p>
              <button onClick={fecharModal} className="rounded-lg p-2 text-ink/50 hover:bg-sand"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-4">
                <div className="md:col-span-2">
                  <Label>Paciente *</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink/40" />
                    <Input
                      placeholder="Buscar paciente no PEC e-SUS (nome/CPF/CNS/prontuário)…"
                      value={buscaPac}
                      onChange={(e) => setBuscaPac(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                  {pacientesPec.length > 0 && (
                    <div className="mt-1 max-h-40 overflow-y-auto rounded-xl border border-sus-900/10 bg-white">
                      {pacientesPec.slice(0, 15).map((p) => (
                        <button
                          key={`${p.origem}-${p.id || p.cns || p.cpf || p.nome}`}
                          onClick={() => {
                            if (p.origem === "pec" && p.id === null) {
                              alert("Paciente do PEC: cadastre localmente primeiro ou selecione da lista local.");
                              return;
                            }
                            setForm({ ...form, paciente_id: String(p.id!) });
                            setBuscaPac(p.nome);
                          }}
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-sand border-b border-sus-900/5 last:border-0"
                        >
                          <div className="flex flex-col">
                            <span className="font-medium">{p.nome}</span>
                            <div className="text-xs text-ink/45 flex gap-2 flex-wrap">
                              {p.cpf && <span>{p.cpf}</span>}
                              {p.cns && <span>CNS {p.cns}</span>}
                              {p.prontuario && <span>Pront. {p.prontuario}</span>}
                              {p.nascimento && <span>Nasc. {p.nascimento.slice(0, 10).split("-").reverse().join("/")}</span>}
                              {p.ubs && <span>UBS {p.ubs}</span>}
                              <span className={p.origem === "pec" ? "text-teal" : "text-sus-900"}>{p.origem === "pec" ? "PEC" : "Local"}</span>
                            </div>
                          </div>
                          <Plus className="h-4 w-4 text-teal" />
                        </button>
                      ))}
                    </div>
                  )}
                  {buscaDebounce && buscaDebounce.length >= 2 && pacientesPec.length === 0 && (
                    <p className="mt-1 text-sm text-ink/45 text-center">Nenhum paciente encontrado.</p>
                  )}
                  <select value={form.paciente_id} onChange={(e) => setForm({ ...form, paciente_id: e.target.value })} className="mt-1 w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
                    <option value="">Ou selecionar paciente local…</option>
                    {pacientesLocais.slice(0, 20).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                  </select>
                </div>
                <div><Label>Exame *</Label><Input value={form.exame} onChange={(e) => setForm({ ...form, exame: e.target.value })} placeholder="Ex: Ressonância" /></div>
                <div className="md:col-span-2">
                  <Label>Justificativa do Pedido *</Label>
                  <Input value={form.justificativa} onChange={(e) => setForm({ ...form, justificativa: e.target.value })} placeholder="Informe a justificativa clínica do pedido..." />
                  <p className="mt-1 text-xs text-ink/50">{form.justificativa.trim().length}/12 caracteres mínimos</p>
                </div>
                <div><Label>Especialidade</Label><Input value={form.especialidade} onChange={(e) => setForm({ ...form, especialidade: e.target.value })} /></div>
                <div>
                  <Label>Prioridade</Label>
                  <select value={form.prioridade} onChange={(e) => setForm({ ...form, prioridade: e.target.value })} className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
                    {["rotina", "urgente"].map((p) => <option key={p} value={p}>{PRIO_ROTULO[p] ?? p}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Status</Label>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
                    {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div><Label>Data pedido *</Label><Input type="date" value={form.data_pedido} onChange={(e) => setForm({ ...form, data_pedido: e.target.value })} /></div>
                <div><Label>Data agendada</Label><Input type="date" value={form.data_agendada} onChange={(e) => setForm({ ...form, data_agendada: e.target.value })} /></div>
                <div className="md:col-span-2"><Label>Destino</Label><Input value={form.destino} onChange={(e) => setForm({ ...form, destino: e.target.value })} placeholder="Cidade / unidade" /></div>
                <div className="md:col-span-2"><Label>Observações</Label><Input value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} /></div>
              </div>
              {erro && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
              <Button onClick={salvar} className="w-full"><Plus className="h-4 w-4" />{editId ? "Atualizar" : "Entrar na fila"}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}