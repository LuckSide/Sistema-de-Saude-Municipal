import { useEffect, useMemo, useState } from "react";
import { CalendarDays, CalendarPlus, Expand, Minus, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  examesSolicitarLote,
  expandirSigtapIds,
  filaPsfListar,
  labsListar,
  labSigtap,
  tfdPacientes,
  vagasAtualizar,
  vagasCriar,
  vagasExcluir,
  vagasGrade,
  vagasListar,
  vagasLoteMes,
  mapVaga,
  pagData,
  pagMeta,
  type FilaPsfItem,
  type Laboratorio,
  type Paciente,
  type SigtapProc,
  type Vaga,
  type VagaDia,
} from "../../services/api";
import { Button, Card, Input, Label } from "../../components/ui/primitives";
import GradeDias from "../../components/GradeDias";
import MonthPicker from "../../components/MonthPicker";

type ItemLote = { sigtap: SigtapProc; quantidade: number };
type ModoDia = "agendar" | "vaga";

export default function VagasAgenda() {
  const [labs, setLabs] = useState<Laboratorio[]>([]);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [labId, setLabId] = useState("");
  const [grade, setGrade] = useState<VagaDia[]>([]);
  const [vagasMes, setVagasMes] = useState<Vaga[]>([]);
  const [diaSel, setDiaSel] = useState<string | null>(null);
  const [modoDia, setModoDia] = useState<ModoDia>("agendar");
  const [buscaPac, setBuscaPac] = useState("");
  const [pacientes, setPacientes] = useState<Paciente[]>([]);
  const [pacienteId, setPacienteId] = useState("");
  const [fila, setFila] = useState<FilaPsfItem[]>([]);
  const [origemFilaId, setOrigemFilaId] = useState("");
  const [buscaSig, setBuscaSig] = useState("");
  const [sigtap, setSigtap] = useState<SigtapProc[]>([]);
  const [itens, setItens] = useState<ItemLote[]>([]);
  const [vagaQtd, setVagaQtd] = useState("20");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [modalLote, setModalLote] = useState(false);
  const [modalAgend, setModalAgend] = useState(false);
  const [loteLab, setLoteLab] = useState("");
  const [loteMes, setLoteMes] = useState(() => new Date().toISOString().slice(0, 7));
  const [loteQtd, setLoteQtd] = useState("20");
  const [loteSemFds, setLoteSemFds] = useState(true);
  const [loteBusy, setLoteBusy] = useState(false);

  useEffect(() => {
    labsListar().then((l) => { setLabs(l); if (l.length && !labId) setLabId(String(l[0].id)); }).catch(() => {});
    filaPsfListar("na_fila").then((r) => setFila(pagData<FilaPsfItem>(r))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function carregar() {
    if (!month) return;
    setCarregando(true);
    try {
      const [g, v] = await Promise.all([
        vagasGrade(month, undefined, labId ? Number(labId) : undefined),
        vagasListar(`${month}-01`, `${month}-31`, labId ? Number(labId) : undefined),
      ]);
      setGrade(g);
      const arr = pagData<any>(v);
      setVagasMes(arr.map(mapVaga));
      setErro("");
    } catch {
      setErro("Falha ao carregar grade de vagas.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, labId]);

  useEffect(() => {
    if (!diaSel) return;
    const t = setTimeout(() => {
      tfdPacientes(buscaPac || undefined).then((r) => setPacientes(pagData<Paciente>(r))).catch(() => {});
      labSigtap(buscaSig || undefined).then((r) => setSigtap(pagData<SigtapProc>(r))).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [buscaPac, buscaSig, diaSel]);

  const mapa = useMemo(() => {
    const m = new Map<string, VagaDia>();
    for (const g of grade) m.set(g.data.slice(0, 10), g);
    return m;
  }, [grade]);

  const vagaPorDia = useMemo(() => {
    const m = new Map<string, Vaga>();
    for (const v of vagasMes) m.set(String(v.data).slice(0, 10), v);
    return m;
  }, [vagasMes]);

  const labNome = labs.find((l) => String(l.id) === labId)?.nome ?? "";
  const sel = diaSel ? mapa.get(diaSel) : undefined;
  const vagaDiaSel = diaSel ? vagaPorDia.get(diaSel) : undefined;
  const totalItens = itens.reduce((acc, i) => acc + i.quantidade, 0);
  const idsExpandidos = useMemo(
    () => expandirSigtapIds(itens.map((i) => ({ sigtap_id: i.sigtap.id, quantidade: i.quantidade }))),
    [itens]
  );
  const resumo = useMemo(() => {
    const total = grade.reduce((s, g) => s + (g.total ?? 0), 0);
    const livres = grade.reduce((s, g) => s + (g.livres ?? 0), 0);
    return { total, ocup: Math.max(0, total - livres), livres };
  }, [grade]);

  function hojeISO(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function abrirDia(d: string) {
    if (d < hojeISO()) {
      setErro("Dia passado indisponível (sem vagas).");
      return;
    }
    setDiaSel(d);
    setModoDia("agendar");
    setVagaQtd(String(vagaPorDia.get(d)?.vagas_totais ?? vagaPorDia.get(d)?.total ?? 20));
    setErro("");
    setOk("");
  }

  function fecharModal() {
    setDiaSel(null);
    setPacienteId("");
    setOrigemFilaId("");
    setItens([]);
    setBuscaPac("");
    setBuscaSig("");
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

  function usarFila(fid: string) {
    setOrigemFilaId(fid);
    const f = fila.find((x) => String(x.id) === fid);
    if (f) {
      setPacienteId(String(f.paciente_id));
      setBuscaPac(f.paciente_nome);
    }
  }

  async function agendar() {
    setErro("");
    setOk("");
    if (diaSel && diaSel < hojeISO()) {
      setErro("Dia passado indisponível (sem vagas).");
      return;
    }
    if (!diaSel || !pacienteId || !labId) {
      setErro("Escolha laboratório, dia e paciente.");
      return;
    }
    if (itens.length === 0) {
      setErro("Adicione ao menos um exame SIGTAP.");
      return;
    }
    if (sel && sel.total > 0 && sel.livres <= 0) {
      setErro("Dia sem vaga livre. Escolha outro dia ou amplie as vagas na aba Vagas.");
      return;
    }
    try {
      await examesSolicitarLote({
        paciente_id: Number(pacienteId),
        data_agendada: diaSel,
        laboratorio_id: Number(labId),
        itens: itens.map((i) => ({ sigtap_id: i.sigtap.id, quantidade: i.quantidade })),
        origem_fila_id: origemFilaId ? Number(origemFilaId) : null,
      });
      fecharModal();
      setOk(`Exames agendados (${totalItens} item(ns)), vaga abatida.`);
      await carregar();
      filaPsfListar("na_fila").then((r) => setFila(pagData<FilaPsfItem>(r))).catch(() => {});
    } catch (e: any) {
      setErro(e?.response?.data?.detail ?? "Erro ao agendar. Confira vagas livres no dia.");
    }
  }

  async function salvarVagaDia() {
    setErro("");
    setOk("");
    const total = Number(vagaQtd);
    if (diaSel && diaSel < hojeISO()) {
      setErro("Dia passado indisponível (sem vagas).");
      return;
    }
    if (!diaSel || !labId || !Number.isFinite(total) || total < 0) {
      setErro("Escolha laboratório e informe um quantitativo válido.");
      return;
    }
    try {
      if (vagaDiaSel) await vagasAtualizar(vagaDiaSel.id, { data: diaSel, laboratorio_id: Number(labId), vagas_totais: total });
      else await vagasCriar({ data: diaSel, laboratorio_id: Number(labId), vagas_totais: total });
      setOk(vagaDiaSel ? "Vagas do dia atualizadas." : "Vagas do dia criadas.");
      await carregar();
    } catch (e: any) {
      setErro(e?.response?.data?.detail ?? "Erro ao salvar vagas do dia.");
    }
  }

  async function excluirVagaDia() {
    if (!vagaDiaSel || !confirm("Excluir vagas deste dia?")) return;
    try {
      await vagasExcluir(vagaDiaSel.id);
      setOk("Vagas do dia excluídas.");
      await carregar();
    } catch (e: any) {
      setErro(e?.response?.data?.detail ?? "Erro ao excluir.");
    }
  }

  function fecharLote() {
    setModalLote(false);
    setErro("");
  }

  async function salvarLote() {
    setErro("");
    setOk("");
    const qtd = Number(loteQtd);
    if (!loteLab || !/^\d{4}-(0[1-9]|1[0-2])$/.test(loteMes) || !Number.isFinite(qtd) || qtd < 0 || qtd > 1000) {
      setErro("Laboratório, mês/ano e vagas por dia (0..1000) são obrigatórios.");
      return;
    }
    setLoteBusy(true);
    try {
      const [ano, mes] = loteMes.split("-").map(Number);
      const r = await vagasLoteMes({
        laboratorio_id: Number(loteLab),
        ano,
        mes,
        vagas_diarias: qtd,
        ignorar_fins_semana: loteSemFds,
      });
      setModalLote(false);
      setOk(`Mês ${r.mes_ref} liberado p/ ${r.laboratorio_nome}: ${r.criadas} criadas, ${r.atualizadas} atualizadas${r.mantidas_conflito ? `, ${r.mantidas_conflito} mantida(s) com agendamentos` : ""}${r.ignoradas_fim_semana ? `, ${r.ignoradas_fim_semana} fim de semana ignorados` : ""}${r.ignoradas_passado ? `, ${r.ignoradas_passado} dia(s) passado(s) ignorados` : ""}.`);
      setLoteQtd("20");
      await carregar();
    } catch (e: any) {
      setErro(e?.response?.data?.detail ?? "Erro ao liberar mês.");
    } finally {
      setLoteBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold text-sus-950">
          <CalendarDays className="h-5 w-5 text-sus-900" /> Vagas e agenda
        </h2>
        <div className="ml-auto flex items-center gap-2">
          {carregando && <span className="text-xs text-ink/45">Carregando grade…</span>}
          <Button onClick={() => { setLoteLab(labId || ""); setLoteMes(month); setModalLote(true); }} className="!bg-teal !text-sus-950">
            <CalendarPlus className="h-4 w-4" /> Liberar mês inteiro
          </Button>
        </div>
      </div>

      <Card className="mb-4 p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <Label>Mês</Label>
            <MonthPicker value={month} onChange={setMonth} />
          </div>
          <div>
            <Label>Laboratório</Label>
            <select value={labId} onChange={(e) => setLabId(e.target.value)} className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
              <option value="">Selecionar…</option>
              {labs.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
            </select>
          </div>
          <div className="flex items-end gap-2">
            <div className="grid flex-1 grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-sand/70 px-2 py-2">
                <p className="font-display text-sm font-bold text-sus-950">{resumo.total}</p>
                <p className="text-[10px] font-semibold uppercase text-sus-900/60">total</p>
              </div>
              <div className="rounded-xl bg-sand/70 px-2 py-2">
                <p className="font-display text-sm font-bold text-sus-950">{resumo.ocup}</p>
                <p className="text-[10px] font-semibold uppercase text-sus-900/60">ocupadas</p>
              </div>
              <div className="rounded-xl bg-teal/15 px-2 py-2">
                <p className="font-display text-sm font-bold text-sus-950">{resumo.livres}</p>
                <p className="text-[10px] font-semibold uppercase text-sus-900/60">livres</p>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {erro && !diaSel && !modalLote && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
      {ok && <p className="mb-3 rounded-xl bg-teal/10 px-3 py-2 text-sm text-teal">{ok}</p>}

      <Card className="p-4">
        <GradeDias month={month} mapa={mapa} diaSel={diaSel ?? ""} bloqueado={!labId} permitirSemVaga onSelect={abrirDia} />
        {!labId && <p className="mt-2 text-xs text-ink/50">Selecione um laboratório para ver a disponibilidade.</p>}
        <p className="mt-2 text-xs text-ink/55">Clique num dia para agendar paciente ou abrir/ajustar vagas.</p>
      </Card>

      {diaSel && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4" onClick={fecharModal}>
          <div className="rise max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl bg-white p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between gap-2">
              <p className="font-display text-base font-bold text-sus-950">
                {diaSel.split("-").reverse().join("/")} · {labNome}
                {sel ? ` · ${sel.livres} livres de ${sel.total}` : " · sem vagas"}
              </p>
              <button onClick={fecharModal} className="rounded-lg p-2 text-ink/50 hover:bg-sand"><X className="h-4 w-4" /></button>
            </div>
            <div className="mb-3 grid grid-cols-2 gap-1.5 rounded-xl bg-sand/70 p-1.5">
              {(["agendar", "vaga"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setModoDia(m)}
                  className={`rounded-lg px-3 py-2 font-display text-xs font-bold transition ${modoDia === m ? "bg-white text-sus-950 shadow-card" : "text-sus-900/60 hover:text-sus-950"}`}
                >
                  {m === "agendar" ? "Agendar paciente" : "Abrir / ajustar vagas"}
                </button>
              ))}
            </div>

            {modoDia === "vaga" ? (
              <div className="space-y-3">
                <div>
                  <Label>Quantitativo diário *</Label>
                  <Input type="number" min={0} placeholder="Ex: 20" value={vagaQtd} onChange={(e) => setVagaQtd(e.target.value)} />
                  {vagaDiaSel && (
                    <p className="mt-1 text-xs text-ink/55">
                      Atual: {vagaDiaSel.vagas_totais ?? vagaDiaSel.total} total · {vagaDiaSel.vagas_ocupadas ?? vagaDiaSel.ocupadas} ocupadas · {vagaDiaSel.vagas_livres} livres.
                    </p>
                  )}
                </div>
                {erro && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
                <Button onClick={salvarVagaDia} className="w-full"><Plus className="h-4 w-4" /> {vagaDiaSel ? "Atualizar vagas do dia" : "Abrir vagas do dia"}</Button>
                {vagaDiaSel && (
                  <button onClick={excluirVagaDia} className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-red-600 transition hover:bg-red-50">
                    <Trash2 className="h-4 w-4" /> Excluir vagas do dia
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <Label>Converter da fila do PSF (opcional)</Label>
                  <select value={origemFilaId} onChange={(e) => usarFila(e.target.value)} className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
                    <option value="">Agendamento direto…</option>
                    {fila.slice(0, 50).map((f) => <option key={f.id} value={f.id}>#{f.id} · {f.paciente_nome} · {f.unidade_psf}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Paciente *</Label>
                  <Input placeholder="Buscar paciente…" value={buscaPac} onChange={(e) => setBuscaPac(e.target.value)} />
                  <select value={pacienteId} onChange={(e) => setPacienteId(e.target.value)} className="mt-1 w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
                    <option value="">Selecionar…</option>
                    {pacientes.slice(0, 15).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Exames SIGTAP * (buscar código ou descrição)</Label>
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
                    {sigtap.length === 0 && <p className="py-3 text-center text-xs text-ink/45">Nenhum procedimento.</p>}
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
                  {idsExpandidos.length > 0 && (
                    <p className="mt-1 text-xs text-ink/55">{itens.length} procedimento(s) · {idsExpandidos.length} amostra(s) no lote.</p>
                  )}
                </div>
                {erro && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
                <Button onClick={agendar} className="w-full"><Plus className="h-4 w-4" /> Confirmar agendamento</Button>
              </div>
            )}
          </div>
        </div>
      )}

      {modalLote && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4" onClick={fecharLote}>
          <div className="rise w-full max-w-lg rounded-2xl bg-white p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <p className="font-display text-base font-bold text-sus-950">Liberar mês inteiro</p>
              <button onClick={fecharLote} className="rounded-lg p-2 text-ink/50 hover:bg-sand" aria-label="Fechar">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <Label>Laboratório *</Label>
                <select value={loteLab} onChange={(e) => setLoteLab(e.target.value)} className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
                  <option value="">Selecionar…</option>
                  {labs.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
                </select>
              </div>
              <div>
                <Label>Mês/ano de referência *</Label>
                <MonthPicker value={loteMes} onChange={setLoteMes} />
              </div>
              <div>
                <Label>Vagas por dia *</Label>
                <Input type="number" min={0} max={1000} placeholder="Ex: 20" value={loteQtd} onChange={(e) => setLoteQtd(e.target.value)} />
              </div>
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-sus-900/10 px-3 py-2.5 text-sm">
                <input type="checkbox" checked={loteSemFds} onChange={(e) => setLoteSemFds(e.target.checked)} className="h-4 w-4 accent-teal-700" />
                Ignorar fins de semana (Sáb / Dom)
              </label>
              {erro && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
              <Button onClick={salvarLote} disabled={loteBusy} className="w-full">
                <CalendarPlus className="h-4 w-4" /> {loteBusy ? "Liberando…" : "Confirmar liberação"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {vagasMes.length > 0 && (
        <Card className="mt-4 overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-sus-900/10 bg-sand px-4 py-2.5">
            <p className="font-display text-xs font-bold uppercase tracking-wide text-sus-900/70">
              Agendamentos do mês · {vagasMes.length} dia(s) com vaga
            </p>
            <Button onClick={() => setModalAgend(true)} className="!w-auto !px-3 !py-1.5 text-xs">
              <Expand className="h-3.5 w-3.5" /> Expandir agendamentos
            </Button>
          </div>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-sus-900/10 bg-sand/60 text-xs uppercase text-sus-900/60">
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">Ocupadas</th>
                <th className="px-4 py-3">Livres</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {vagasMes.slice(0, 5).map((v) => (
                <tr key={v.id} className="border-b border-sus-900/5 last:border-0">
                  <td className="px-4 py-3 font-semibold">{String(v.data).slice(0, 10).split("-").reverse().join("/")}</td>
                  <td className="px-4 py-3">{v.vagas_totais ?? v.total}</td>
                  <td className="px-4 py-3">{v.vagas_ocupadas ?? v.ocupadas}</td>
                  <td className="px-4 py-3 font-semibold text-sus-950">{v.vagas_livres ?? Math.max(0, (v.vagas_totais ?? v.total ?? 0) - (v.vagas_ocupadas ?? v.ocupadas ?? 0))}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => abrirDia(String(v.data).slice(0, 10))} className="rounded-lg p-2 text-sus-800 hover:bg-sus-100" title="Abrir dia">
                        <Pencil className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {vagasMes.length > 5 && (
            <button onClick={() => setModalAgend(true)} className="w-full bg-sand/50 px-4 py-2 text-center text-xs font-semibold text-sus-900/70 transition hover:bg-sand">
              + {vagasMes.length - 5} dia(s) · clique para expandir
            </button>
          )}
        </Card>
      )}

      {modalAgend && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4" onClick={() => setModalAgend(false)}>
          <div className="rise flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-2 border-b border-sus-900/10 px-5 py-4">
              <p className="font-display text-base font-bold text-sus-950">
                Agendamentos · {labNome || "todos"} · {vagasMes.length} dia(s)
              </p>
              <button onClick={() => setModalAgend(false)} className="rounded-lg p-2 text-ink/50 hover:bg-sand" aria-label="Fechar">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-sand">
                  <tr className="border-b border-sus-900/10 text-xs uppercase text-sus-900/60">
                    <th className="px-4 py-3">Data</th>
                    <th className="px-4 py-3">Total</th>
                    <th className="px-4 py-3">Ocupadas</th>
                    <th className="px-4 py-3">Livres</th>
                    <th className="px-4 py-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {vagasMes.map((v) => (
                    <tr key={v.id} className="border-b border-sus-900/5 last:border-0 hover:bg-sand/40">
                      <td className="px-4 py-3 font-semibold">{String(v.data).slice(0, 10).split("-").reverse().join("/")}</td>
                      <td className="px-4 py-3">{v.vagas_totais ?? v.total}</td>
                      <td className="px-4 py-3">{v.vagas_ocupadas ?? v.ocupadas}</td>
                      <td className="px-4 py-3 font-semibold text-sus-950">{v.vagas_livres ?? Math.max(0, (v.vagas_totais ?? v.total ?? 0) - (v.vagas_ocupadas ?? v.ocupadas ?? 0))}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => { setModalAgend(false); abrirDia(String(v.data).slice(0, 10)); }}
                            className="rounded-lg p-2 text-sus-800 hover:bg-sus-100"
                            title="Abrir dia"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
