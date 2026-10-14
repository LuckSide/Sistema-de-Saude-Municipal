import { useEffect, useState, useMemo } from "react";
import { Pencil, Plus, Trash2, UserPlus, X, Calendar, Search } from "lucide-react";
import {
  tfdAddPassageiro,
  tfdAtualizarViagem,
  tfdBuscarPacientesPec,
  tfdCriarViagem,
  tfdDestinos,
  tfdExcluirViagem,
  tfdPacientes,
  tfdPassageiros,
  tfdRemoverPassageiro,
  tfdVeiculos,
  tfdViagens,
  pagData,
  pagMeta,
  type Destino,
  type Paciente,
  type PacientePec,
  type Passageiro,
  type Veiculo,
  type Viagem,
} from "../../services/api";
import { Button, Card, Input, Label, Badge } from "../../components/ui/primitives";
import Paginacao from "../../components/Paginacao";

const STATUS = ["agendada", "andamento", "concluida", "cancelada"];

const vazio = {
  destino: "",
  unidade: "",
  data_viagem: "",
  hora_saida: "",
  veiculo_id: "",
  motorista: "",
  status: "agendada",
  finalidade: "consulta",
  observacoes: "",
};

export default function TfdViagens() {
  const [lista, setLista] = useState<Viagem[]>([]);
  const [statusFiltro, setStatusFiltro] = useState("");
  const [mesFiltro, setMesFiltro] = useState("");
  const [anoFiltro, setAnoFiltro] = useState("");
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(vazio);
  const [veiculos, setVeiculos] = useState<Veiculo[]>([]);
  const [destinos, setDestinos] = useState<Destino[]>([]);
  const [pacientesPec, setPacientesPec] = useState<PacientePec[]>([]);
  const [buscaPac, setBuscaPac] = useState("");
  const [buscaDebounce, setBuscaDebounce] = useState("");
  const [sel, setSel] = useState<Viagem | null>(null);
  const [pass, setPass] = useState<Passageiro[]>([]);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);

  async function carregar(p = page) {
    const params: Record<string, string | number> = { page: p, limit: 100 };
    if (statusFiltro) params.status = statusFiltro;
    if (mesFiltro) params.mes = mesFiltro;
    else if (anoFiltro) params.ano = anoFiltro;
    const r = await tfdViagens(params);
    setLista(pagData<Viagem>(r));
    const m = pagMeta(r);
    setTotal(m.total);
    setPage(m.page);
    setPages(m.pages);
  }

  useEffect(() => {
    carregar(1).catch(() => setErro("Falha ao carregar viagens."));
    tfdVeiculos().then((r) => setVeiculos(pagData<Veiculo>(r))).catch(() => {});
    tfdDestinos().then((r) => setDestinos(pagData<Destino>(r))).catch(() => {});
  }, [statusFiltro, mesFiltro, anoFiltro]);

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

  useEffect(() => {
    if (!sel) return;
    tfdPassageiros(sel.id).then(setPass).catch(() => {});
    tfdPacientes(buscaPac || undefined)
      .then((r) =>
        setPacientesPec(
          pagData<Paciente>(r).map((p) => ({
            id: p.id,
            origem: "local" as const,
            nome: p.nome,
            cns: p.cns,
            cpf: p.cpf,
            prontuario: "",
            nascimento: p.nascimento,
            ubs: "",
          }))
        )
      )
      .catch(() => {});
  }, [sel, buscaPac]);

  function abrirModal(id?: number) {
    if (id) {
      const v = lista.find((x) => x.id === id);
      if (v) {
        setEditId(v.id);
        setForm({
          destino: v.destino,
          unidade: v.unidade,
          data_viagem: v.data_viagem,
          hora_saida: v.hora_saida,
          veiculo_id: v.veiculo_id ? String(v.veiculo_id) : "",
          motorista: v.motorista,
          status: v.status,
          finalidade: v.finalidade,
          observacoes: v.observacoes,
        });
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
    if (!form.destino || !form.data_viagem) {
      setErro("Destino e data são obrigatórios.");
      return;
    }
    const payload: Record<string, unknown> = {
      ...form,
      veiculo_id: form.veiculo_id ? Number(form.veiculo_id) : null,
    };
    try {
      if (editId) await tfdAtualizarViagem(editId, payload);
      else await tfdCriarViagem(payload);
      fecharModal();
      setOk(editId ? "Viagem atualizada." : "Viagem criada.");
      await carregar();
    } catch {
      setErro("Erro ao salvar viagem.");
    }
  }

  const anoAtual = new Date().getFullYear();
  const anos = useMemo(() => Array.from({ length: 5 }, (_, i) => anoAtual - i), [anoAtual]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="font-display text-lg font-bold text-sus-950">Viagens</h2>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <select
            value={statusFiltro}
            onChange={(e) => setStatusFiltro(e.target.value)}
            className="rounded-xl border border-sus-900/15 bg-white px-3 py-2 text-sm"
          >
            <option value="">Todos status</option>
            {STATUS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-ink/50">Mês</Label>
            <Input
              type="month"
              value={mesFiltro}
              onChange={(e) => {
                const v = e.target.value;
                setMesFiltro(v);
                if (v) setAnoFiltro("");
              }}
              className="w-40"
            />
            <Label className="text-xs text-ink/50">Ano</Label>
            <select
              value={anoFiltro}
              onChange={(e) => {
                const v = e.target.value;
                setAnoFiltro(v);
                if (v) setMesFiltro("");
              }}
              className="rounded-xl border border-sus-900/15 bg-white px-3 py-2 text-sm w-28"
            >
              <option value="">—</option>
              {anos.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>
          <Button onClick={() => abrirModal()}><Plus className="h-4 w-4" /> Nova viagem</Button>
        </div>
      </div>
      {erro && !modal && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
      {ok && <p className="mb-3 rounded-xl bg-teal/10 px-3 py-2 text-sm text-teal">{ok}</p>}

      <Card className="overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b border-sus-900/10 bg-sand text-xs uppercase text-sus-900/60">
            <th className="px-4 py-3">Data</th><th className="px-4 py-3">Destino</th><th className="px-4 py-3">Veículo</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Pax</th><th className="px-4 py-3 text-right">Ações</th>
          </tr></thead>
          <tbody>
            {lista.map((v) => (
              <tr key={v.id} className="border-b border-sus-900/5 last:border-0">
                <td className="px-4 py-3 font-semibold">{v.data_viagem.split("-").reverse().join("/")} {v.hora_saida}</td>
                <td className="px-4 py-3">{v.destino}<p className="text-xs text-ink/50">{v.unidade || v.finalidade}</p></td>
                <td className="px-4 py-3 text-xs">{v.veiculo_placa || "—"}</td>
                <td className="px-4 py-3"><span className="rounded-full bg-sus-900/10 px-2 py-0.5 text-xs font-semibold">{v.status}</span></td>
                <td className="px-4 py-3">{v.passageiros}</td>
                <td className="px-4 py-3"><div className="flex justify-end gap-1">
                  <button onClick={() => setSel(v)} className="rounded-lg p-2 text-teal hover:bg-teal/10" title="Passageiros"><UserPlus className="h-4 w-4" /></button>
                  <button onClick={() => abrirModal(v.id)} className="rounded-lg p-2 text-sus-800 hover:bg-sus-100" title="Editar"><Pencil className="h-4 w-4" /></button>
                  <button onClick={async () => { if (confirm("Excluir viagem?")) { await tfdExcluirViagem(v.id); carregar(); } }} className="rounded-lg p-2 text-red-600 hover:bg-red-50" title="Excluir"><Trash2 className="h-4 w-4" /></button>
                </div></td>
              </tr>
            ))}
            {lista.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-ink/45">Nenhuma viagem.</td></tr>}
          </tbody>
        </table>
        <Paginacao page={page} pages={pages} total={total} onPage={(p) => carregar(p).catch(() => setErro("Falha ao carregar viagens."))} />
      </Card>

      {sel && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4" onClick={() => setSel(null)}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <p className="font-display text-base font-bold">Passageiros · {sel.destino} {sel.data_viagem}</p>
              <button onClick={() => setSel(null)} className="rounded-lg p-2 hover:bg-sand"><X className="h-4 w-4" /></button>
            </div>
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
              <div className="mt-2 max-h-48 overflow-y-auto rounded-xl border border-sus-900/10">
                {pacientesPec.slice(0, 15).map((p) => (
                  <button
                    key={`${p.origem}-${p.id || p.cns || p.cpf || p.nome}`}
                    onClick={async () => {
                      if (p.origem === "pec" && p.id === null) {
                        alert("Paciente do PEC: cadastre localmente primeiro ou use busca local.");
                        return;
                      }
                      await tfdAddPassageiro(sel.id, { paciente_id: p.id! });
                      setPass(await tfdPassageiros(sel.id));
                      carregar();
                    }}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-sand border-b border-sus-900/5 last:border-0"
                  >
                    <div className="flex flex-col">
                      <span className="font-medium">{p.nome}</span>
                      <div className="text-xs text-ink/45 flex gap-2 flex-wrap">
                        {p.cpf && <span>{p.cpf}</span>}
                        {p.cns && <span>CNS {p.cns}</span>}
                        {p.prontuario && <span>Pront. {p.prontuario}</span>}
                        {p.ubs && <span>UBS {p.ubs}</span>}
                        <Badge variant={p.origem === "pec" ? "success" : "outline"}>
                          {p.origem === "pec" ? "PEC" : "Local"}
                        </Badge>
                      </div>
                    </div>
                    <UserPlus className="h-4 w-4 text-teal" />
                  </button>
                ))}
              </div>
            )}
            {buscaDebounce && buscaDebounce.length >= 2 && pacientesPec.length === 0 && (
              <p className="mt-2 text-sm text-ink/45 text-center">Nenhum paciente encontrado.</p>
            )}
            <div className="mt-3 space-y-1">
              {pass.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-xl bg-sand px-3 py-2 text-sm">
                  <span className="font-medium">{p.paciente_nome}{p.acompanhante ? ` + ${p.acompanhante}` : ""}</span>
                  <button onClick={async () => { await tfdRemoverPassageiro(sel.id, p.id); setPass(await tfdPassageiros(sel.id)); carregar(); }} className="rounded-lg p-1.5 text-red-600 hover:bg-red-50"><X className="h-4 w-4" /></button>
                </div>
              ))}
              {pass.length === 0 && <p className="text-sm text-ink/45">Nenhum passageiro ainda.</p>}
            </div>
          </div>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4" onClick={fecharModal}>
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <p className="font-display text-base font-bold text-sus-950">{editId ? "Editar viagem" : "Nova viagem"}</p>
              <button onClick={fecharModal} className="rounded-lg p-2 text-ink/50 hover:bg-sand"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-4">
                <div className="md:col-span-2">
                  <Label>Destino *</Label>
                  <select
                    value={form.destino}
                    onChange={(e) => setForm({ ...form, destino: e.target.value })}
                    className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm"
                  >
                    <option value="">Selecionar destino cadastrado…</option>
                    {destinos.filter((d) => d.ativo).map((d) => (
                      <option key={d.id} value={d.nome_destino}>
                        {d.nome_destino}{d.hospital_referencia ? ` · ${d.hospital_referencia}` : ""}
                      </option>
                    ))}
                    <option value="__outro__">Outro (digitar)</option>
                  </select>
                  {form.destino === "__outro__" && (
                    <Input
                      value={form.destino === "__outro__" ? "" : form.destino}
                      onChange={(e) => setForm({ ...form, destino: e.target.value })}
                      placeholder="Digite o destino"
                      className="mt-1"
                    />
                  )}
                </div>
                <div><Label>Unidade</Label><Input value={form.unidade} onChange={(e) => setForm({ ...form, unidade: e.target.value })} placeholder="Hospital / clínica" /></div>
                <div><Label>Data *</Label><Input type="date" value={form.data_viagem} onChange={(e) => setForm({ ...form, data_viagem: e.target.value })} /></div>
                <div><Label>Hora saída</Label><Input type="time" value={form.hora_saida} onChange={(e) => setForm({ ...form, hora_saida: e.target.value })} /></div>
                <div>
                  <Label>Veículo</Label>
                  <select value={form.veiculo_id} onChange={(e) => setForm({ ...form, veiculo_id: e.target.value })} className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
                    <option value="">—</option>
                    {veiculos.filter((v) => v.ativo).map((v) => (
                      <option key={v.id} value={v.id}>{v.placa} · {v.modelo} ({v.capacidade} pax)</option>
                    ))}
                  </select>
                </div>
                <div><Label>Motorista</Label><Input value={form.motorista} onChange={(e) => setForm({ ...form, motorista: e.target.value })} /></div>
                <div>
                  <Label>Finalidade</Label>
                  <select value={form.finalidade} onChange={(e) => setForm({ ...form, finalidade: e.target.value })} className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
                    {["consulta", "exame", "cirurgia", "retorno"].map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Status</Label>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
                    {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div><Label>Observações</Label><Input value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} /></div>
              {erro && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
              <Button onClick={salvar} className="w-full"><Plus className="h-4 w-4" />{editId ? "Atualizar" : "Criar viagem"}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}