import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Minus, Plus, Trash2, X } from "lucide-react";
import {
  examesSolicitarLote,
  labsListar,
  labSigtap,
  tfdPacientes,
  vagasGrade,
  pagData,
  pagMeta,
  type Laboratorio,
  type Paciente,
  type SigtapProc,
  type VagaDia,
} from "../../services/api";
import { solicitarListar, mapMestre, type SolicMestre } from "../../services/api";
import { Button, Card, Input, Label } from "../../components/ui/primitives";
import Paginacao from "../../components/Paginacao";
import ExportarExcel from "../../components/ExportarExcel";
import GradeDias from "../../components/GradeDias";
import MonthPicker from "../../components/MonthPicker";

type ItemLote = { sigtap: SigtapProc; quantidade: number };

export default function LabMarcacao() {
  const [lista, setLista] = useState<SolicMestre[]>([]);
  const [labs, setLabs] = useState<Laboratorio[]>([]);
  const [modal, setModal] = useState(false);
  const [buscaPac, setBuscaPac] = useState("");
  const [pacientes, setPacientes] = useState<Paciente[]>([]);
  const [pacienteId, setPacienteId] = useState("");
  const [buscaSig, setBuscaSig] = useState("");
  const [sigtap, setSigtap] = useState<SigtapProc[]>([]);
  const [itens, setItens] = useState<ItemLote[]>([]);
  // Calendário integrado: mês + laboratório + grade de vagas
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [labId, setLabId] = useState("");
  const [grade, setGrade] = useState<VagaDia[]>([]);
  const [diaSel, setDiaSel] = useState("");
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);

  async function carregar(p = page) {
    const r = await solicitarListar({ page: p, limit: 100 });
    const arr = pagData<any>(r);
    setLista(arr.map(mapMestre));
    const m = pagMeta(r);
    setTotal(m.total);
    setPage(m.page);
    setPages(m.pages);
  }

  useEffect(() => {
    carregar(1).catch(() => setErro("Falha ao carregar solicitações."));
    labsListar().then((l) => { const ativos = l.filter((x) => x.ativo); setLabs(ativos); if (ativos.length) setLabId((atual) => atual || String(ativos[0].id)); }).catch(() => {});
  }, []);

  async function carregarGrade() {
    if (!month) return;
    try {
      setGrade(await vagasGrade(month, undefined, labId ? Number(labId) : undefined));
    } catch {
      setGrade([]);
    }
  }

  useEffect(() => {
    if (modal) carregarGrade();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal, month, labId]);

  useEffect(() => {
    if (!modal) return;
    const t = setTimeout(() => {
      tfdPacientes(buscaPac || undefined).then((r) => setPacientes(pagData<Paciente>(r))).catch(() => {});
      labSigtap(buscaSig.trim() || undefined).then((r) => setSigtap(pagData<SigtapProc>(r))).catch(() => setSigtap([]));
    }, 250);
    return () => clearTimeout(t);
  }, [buscaPac, buscaSig, modal]);

  const mapa = useMemo(() => {
    const m = new Map<string, VagaDia>();
    for (const g of grade) m.set(String(g.data).slice(0, 10), g);
    return m;
  }, [grade]);

  const sel = diaSel ? mapa.get(diaSel) : undefined;
  const labNome = labs.find((l) => String(l.id) === labId)?.nome ?? "";
  const totalItens = itens.reduce((acc, i) => acc + i.quantidade, 0);

  function setDia(d: string) {
    setDiaSel(d);
    setErro("");
  }

  function adicionarSig(s: SigtapProc) {
    setItens((atual) => {
      const ex = atual.find((i) => i.sigtap.id === s.id);
      if (ex) {
        return atual.map((i) =>
          i.sigtap.id === s.id ? { ...i, quantidade: Math.min(99, i.quantidade + 1) } : i
        );
      }
      return [...atual, { sigtap: s, quantidade: 1 }];
    });
  }

  function setQtd(id: number, qtd: number) {
    const q = Math.min(99, Math.max(1, Math.floor(qtd) || 1));
    setItens((atual) => atual.map((i) => (i.sigtap.id === id ? { ...i, quantidade: q } : i)));
  }

  function removerItem(id: number) {
    setItens((atual) => atual.filter((i) => i.sigtap.id !== id));
  }

  function fecharModal() {
    setModal(false);
    setPacienteId("");
    setItens([]);
    setBuscaPac("");
    setBuscaSig("");
    setDiaSel("");
    setErro("");
  }

  async function salvar() {
    setErro("");
    setOk("");
    if (!pacienteId) {
      setErro("Selecione o paciente.");
      return;
    }
    if (itens.length === 0) {
      setErro("Adicione ao menos um exame SIGTAP.");
      return;
    }
    if (!labId || !diaSel) {
      setErro("Escolha laboratório e dia no calendário.");
      return;
    }
    if (sel && sel.total > 0 && sel.livres <= 0) {
      setErro("Dia sem vaga livre. Escolha outro dia no calendário.");
      return;
    }
    try {
      await examesSolicitarLote({
        paciente_id: Number(pacienteId),
        data_agendada: diaSel,
        laboratorio_id: Number(labId),
        itens: itens.map((i) => ({ sigtap_id: i.sigtap.id, quantidade: i.quantidade })),
      });
      fecharModal();
      setOk(`${totalItens} exame(s) agendado(s), vaga abatida.`);
      await carregar();
      await carregarGrade();
    } catch (e: any) {
      setErro(e?.response?.data?.detail ?? "Erro ao salvar. Confira vagas livres no dia.");
    }
  }

  async function excluir(id: number) {
    setOk("");
    setErro("");
    setLista((atual) => atual.filter((m) => m.id !== id));
    setOk("Pedido removido da lista local. Use a agenda para cancelar a vaga.");
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="font-display text-lg font-bold text-sus-950">Marcação de exames</h2>
        <ExportarExcel url="/api/lab/solicitacoes/exportar" arquivo="solicitacoes_lab" />
        <Button onClick={() => setModal(true)} className="ml-auto">
          <Plus className="h-4 w-4" /> Nova solicitação
        </Button>
      </div>

      {erro && !modal && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
      {ok && <p className="mb-3 rounded-xl bg-teal/10 px-3 py-2 text-sm text-teal">{ok}</p>}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-sus-900/10 bg-sand text-xs uppercase text-sus-900/60">
              <th className="px-4 py-3">Paciente</th>
              <th className="px-4 py-3">Exames</th>
              <th className="px-4 py-3">Data / Lab</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Ação</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((m) => (
              <tr key={m.id} className="border-b border-sus-900/5 last:border-0">
                <td className="px-4 py-3 font-semibold">{m.paciente_nome}<p className="text-xs font-normal text-ink/50">#{m.id}</p></td>
                <td className="px-4 py-3 text-xs">
                  {(m.itens ?? []).map((it: any) => (
                    <p key={it.id ?? it.sigtap_id}>{it.codigo ?? it.procedimento_codigo} · {it.descricao ?? it.procedimento_descricao}{it.quantidade > 1 ? ` ×${it.quantidade}` : ""}</p>
                  ))}
                  {(m.itens ?? []).length === 0 && <span className="text-ink/45">—</span>}
                </td>
                <td className="px-4 py-3 text-xs">{String(m.data_agendada).slice(0, 10).split("-").reverse().join("/")}<p className="text-ink/50">{m.laboratorio}</p></td>
                <td className="px-4 py-3 text-xs">{m.status_auditoria || m.status}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => excluir(m.id)} className="rounded-lg p-2 text-red-600 hover:bg-red-50" title="Excluir item">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
            {lista.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-ink/45">Nenhuma solicitação.</td></tr>}
          </tbody>
        </table>
        </div>
        <Paginacao page={page} pages={pages} total={total} onPage={(p) => carregar(p).catch(() => setErro("Falha ao carregar solicitações."))} />
      </Card>

      {modal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4" onClick={fecharModal}>
          <div className="rise max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl bg-white p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <p className="font-display text-base font-bold text-sus-950">Nova solicitação</p>
              <button onClick={fecharModal} className="rounded-lg p-2 text-ink/50 hover:bg-sand"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <Label>Paciente *</Label>
                <Input placeholder="Buscar paciente…" value={buscaPac} onChange={(e) => setBuscaPac(e.target.value)} />
                <select value={pacienteId} onChange={(e) => setPacienteId(e.target.value)} className="mt-1 w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
                  <option value="">Selecionar…</option>
                  {pacientes.slice(0, 15).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                </select>
              </div>
              <div>
                <Label>Procedimentos SIGTAP * (buscar código ou descrição)</Label>
                <Input placeholder="Buscar código ou nome…" value={buscaSig} onChange={(e) => setBuscaSig(e.target.value)} />
                <div className="mt-2 max-h-44 space-y-1 overflow-auto rounded-xl border border-sus-900/10 p-2">
                  {sigtap.slice(0, 30).map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => adicionarSig(s)}
                      className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-sand"
                    >
                      <Plus className="mt-0.5 h-4 w-4 shrink-0 text-teal" />
                      <span><b>{s.codigo}</b> · {s.descricao}</span>
                    </button>
                  ))}
                  {buscaSig.trim() && sigtap.length === 0 && <p className="py-3 text-center text-xs text-ink/45">Nenhum procedimento para "{buscaSig}". Tente outro termo.</p>}
                  {!buscaSig.trim() && sigtap.length === 0 && <p className="py-3 text-center text-xs text-ink/45">Digite para buscar na tabela SIGTAP.</p>}
                </div>
              </div>
              <div>
                <Label>Exames adicionados ({totalItens})</Label>
                <div className="space-y-2">
                  {itens.map((i) => (
                    <div key={i.sigtap.id} className="flex items-center gap-2 rounded-xl border border-sus-900/10 p-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold"><b>{i.sigtap.codigo}</b> · {i.sigtap.descricao}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => setQtd(i.sigtap.id, i.quantidade - 1)} className="rounded-lg p-1.5 text-sus-900 hover:bg-sand" title="Diminuir">
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <input
                          type="number"
                          min={1}
                          max={99}
                          value={i.quantidade}
                          onChange={(e) => setQtd(i.sigtap.id, Number(e.target.value))}
                          className="w-14 rounded-lg border border-sus-900/15 px-2 py-1 text-center text-sm"
                        />
                        <button onClick={() => setQtd(i.sigtap.id, i.quantidade + 1)} className="rounded-lg p-1.5 text-sus-900 hover:bg-sand" title="Aumentar">
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <button onClick={() => removerItem(i.sigtap.id)} className="rounded-lg p-1.5 text-red-600 hover:bg-red-50" title="Excluir item">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  {itens.length === 0 && <p className="rounded-xl bg-sand/60 px-3 py-3 text-center text-xs text-ink/50">Nenhum exame adicionado.</p>}
                </div>
              </div>
              <div className="rounded-2xl border border-sus-900/10 p-4">
                <p className="mb-3 flex items-center gap-2 font-display text-sm font-bold text-sus-950">
                  <CalendarDays className="h-4 w-4" /> Dia da marcação · vagas disponíveis
                </p>
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <Label>Mês</Label>
                    <MonthPicker value={month} onChange={setMonth} />
                  </div>
                  <div>
                    <Label>Laboratório</Label>
                    <select value={labId} onChange={(e) => setLabId(e.target.value)} className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
                      <option value="">Selecionar…</option>
                      {labs.filter((l) => l.ativo).map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
                    </select>
                  </div>
                </div>
                <div className="mt-3">
                  <GradeDias month={month} mapa={mapa} diaSel={diaSel} bloqueado={!labId} onSelect={setDia} />
                </div>
                <p className="mt-2 text-xs text-ink/55">
                  {!labId ? "Selecione um laboratório para ver a disponibilidade." : diaSel ? `Dia ${diaSel.split("-").reverse().join("/")} · ${labNome}${sel ? ` · ${sel.livres} de ${sel.total} vagas livres` : ""}` : "Escolha um dia verde no calendário."}
                </p>
              </div>
              {erro && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
              <Button onClick={salvar} className="w-full"><Plus className="h-4 w-4" /> Salvar solicitação</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
