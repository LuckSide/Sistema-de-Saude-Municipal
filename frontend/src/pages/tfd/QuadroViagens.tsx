import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bus,
  CalendarDays,
  ChevronsLeft,
  ChevronsRight,
  FileDown,
  Pencil,
  Plus,
  ReceiptText,
  Sparkles,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import {
  tfdAddPassageiro,
  tfdAtualizarFilaViagem,
  tfdCriarFilaViagem,
  tfdCriarViagem,
  tfdExcluirFilaViagem,
  tfdExcluirViagem,
  tfdFaturarDeslocamento,
  tfdFilaViagem,
  tfdPacientes,
  tfdPuxarAgendados,
  tfdRemoverPassageiro,
  tfdSugestao,
  tfdSemana,
  tfdOrdemCirculacaoBlob,
  pagData,
  type DiaDestino,
  type DiaSemana,
  type DiaViagem,
  type FrotaDia,
  type Paciente,
  type ViagemFila,
} from "../../services/api";
import { Button, Card, Input, Label } from "../../components/ui/primitives";
import { rotuloPrioridade } from "../../utils/rotulos";

function hojeISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function somaDias(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function fmtDia(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join("/") : iso;
}
function fmtNasc(s: string | null): string {
  if (!s) return "—";
  const b = s.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(b) ? b.split("-").reverse().join("/") : "—";
}
const normDest = (s: string) => (s || "").trim().toUpperCase();

const PRIOS = [
  { value: "rotina", rotulo: "Eletivo" },
  { value: "prioritaria", rotulo: "Prioritário" },
  { value: "urgente", rotulo: "Urgente" },
];

const vazioFila = {
  paciente_id: "", destino: "", unidade: "", tratamento: "",
  data_consulta: "", hora_consulta: "", acompanhante: false,
  prioridade: "rotina", observacoes: "",
};

const NOMES_DIA = ["SEG", "TER", "QUA", "QUI", "SEX", "SÁB", "DOM"];

export default function QuadroViagens() {
  const { can } = useAuth();
  const podeEditar = can("tfd_viagens");
  const podeFaturar = can("tfd_faturamento");
  const [dia, setDia] = useState(hojeISO());
  const [semana, setSemana] = useState<DiaSemana[]>([]);
  const [frota, setFrota] = useState<FrotaDia[]>([]);
  const [fila, setFila] = useState<ViagemFila[]>([]);
  const [buscaDestino, setBuscaDestino] = useState("");
  const [pacientes, setPacientes] = useState<Paciente[]>([]);
  const [buscaPac, setBuscaPac] = useState("");
  const [modalFila, setModalFila] = useState(false);
  const [editFila, setEditFila] = useState<number | null>(null);
  const [formFila, setFormFila] = useState(vazioFila);
  const [selFila, setSelFila] = useState<number | null>(null);
  const [alocandoEm, setAlocandoEm] = useState<string | null>(null);
  const [novoVeiculo, setNovoVeiculo] = useState({ veiculo_id: "", motorista: "", hora: "" });
  const [novoDestino, setNovoDestino] = useState("");
  const [sugestao, setSugestao] = useState<Record<string, string>>({});
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [arrastando, setArrastando] = useState<string | null>(null);

  const diasSemana = useMemo(
    () => Array.from({ length: 7 }, (_, i) => somaDias(dia, i)),
    [dia]
  );

  async function recarregar(ini = dia) {
    try {
      const [sem, fl] = await Promise.all([
        tfdSemana(ini),
        tfdFilaViagem({ destino: buscaDestino.trim() || undefined }),
      ]);
      setSemana(sem.dias);
      setFrota(sem.frota);
      setFila(fl);
    } catch {
      setErro("Falha ao carregar quadro.");
    }
  }

  useEffect(() => {
    recarregar().catch(() => setErro("Falha ao carregar quadro."));
    tfdPacientes("").then((r) => setPacientes(pagData<Paciente>(r))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dia]);

  useEffect(() => {
    const t = setTimeout(() => recarregar().catch(() => {}), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buscaDestino]);

  const filaAguardando = fila.filter((f) => f.status === "aguardando");

  function destinoCompativel(destFila: string, destVeiculo: string): boolean {
    return normDest(destFila) === normDest(destVeiculo);
  }
  function msgDestino(destFila: string): string {
    return `O paciente só pode ser alocado em veículos cadastrados para o mesmo destino (ex: ${destFila}).`;
  }

  function dragFila(e: React.DragEvent, fid: number) {
    e.dataTransfer.setData("text/fila", String(fid));
    setArrastando(`fila:${fid}`);
  }
  function dragPass(e: React.DragEvent, vid: number, pid: number) {
    e.dataTransfer.setData("text/pass", `${vid}:${pid}`);
    setArrastando(`pass:${vid}:${pid}`);
  }
  function destinoArrastado(): string | null {
    if (!arrastando) return null;
    if (arrastando.startsWith("fila:")) {
      return fila.find((x) => x.id === Number(arrastando.slice(5)))?.destino ?? null;
    }
    const [vid, pid] = arrastando.slice(5).split(":").map(Number);
    for (const d of semana) {
      for (const v of d.destinos.flatMap((x) => x.viagens)) {
        if (v.id === vid && v.passageiros.some((p) => p.id === pid)) return v.destino;
      }
    }
    return null;
  }

  async function alocar(fid: number, vid: number, destVeiculo: string) {
    const f = fila.find((x) => x.id === fid);
    if (!f) return;
    if (!destinoCompativel(f.destino, destVeiculo)) {
      setErro(msgDestino(f.destino));
      setArrastando(null);
      return;
    }
    setErro("");
    try {
      await tfdAddPassageiro(vid, {
        paciente_id: f.paciente_id,
        acompanhante: f.acompanhante ? "Sim" : "",
        viagem_fila_id: f.id,
        tratamento: f.tratamento,
        unidade: f.unidade,
        hora_consulta: f.hora_consulta,
      });
      setSelFila(null);
      setOk(`${f.paciente_nome} alocado(a).`);
      await recarregar();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? "Falha ao alocar.";
      setErro(msg);
    } finally {
      setArrastando(null);
    }
  }

  async function mover(vidOrigem: number, passId: number, vidDestino: number, destDestino: string) {
    if (vidOrigem === vidDestino) return;
    setErro("");
    try {
      let origem: DiaViagem | undefined;
      for (const d of semana) {
        origem = d.destinos.flatMap((x) => x.viagens).find((v) => v.id === vidOrigem);
        if (origem) break;
      }
      const p = origem?.passageiros.find((x) => x.id === passId);
      if (!p || !origem) return;
      if (!destinoCompativel(origem.destino, destDestino)) {
        setErro(msgDestino(origem.destino));
        return;
      }
      await tfdAddPassageiro(vidDestino, {
        paciente_id: p.paciente_id,
        acompanhante: p.acompanhante,
        tratamento: p.tratamento,
        unidade: p.unidade,
        hora_consulta: p.hora_consulta,
      });
      await tfdRemoverPassageiro(vidOrigem, passId);
      setOk("Passageiro movido.");
      await recarregar();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? "Falha ao mover.";
      setErro(msg);
    } finally {
      setArrastando(null);
    }
  }

  async function devolver(vid: number, passId: number) {
    setErro("");
    try {
      await tfdRemoverPassageiro(vid, passId);
      setOk("Devolvido à fila de espera.");
      await recarregar();
    } catch {
      setErro("Falha ao devolver.");
    } finally {
      setArrastando(null);
    }
  }

  async function criarViagemDestino(data: string, destino: string) {
    if (!destino.trim()) {
      setErro("Informe a cidade de destino.");
      return;
    }
    if (!novoVeiculo.veiculo_id) {
      setErro("Escolha o veículo.");
      return;
    }
    setErro("");
    try {
      await tfdCriarViagem({
        destino,
        data_viagem: data,
        hora_saida: novoVeiculo.hora || "05:00",
        veiculo_id: Number(novoVeiculo.veiculo_id),
        motorista: novoVeiculo.motorista,
        status: "agendada",
      });
      setAlocandoEm(null);
      setNovoVeiculo({ veiculo_id: "", motorista: "", hora: "" });
      setOk("Veículo alocado ao destino.");
      await recarregar();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? "Erro ao criar viagem.";
      setErro(msg);
    }
  }

  async function sugerir(data: string, destino: string) {
    try {
      const r = await tfdSugestao(data, destino);
      const chave = `${data}|${destino}`;
      setSugestao((s) => ({ ...s, [chave]: r.veiculo ? `${r.veiculo.placa} — ${r.motivo}` : r.motivo }));
      if (r.veiculo) {
        setAlocandoEm(chave);
        setNovoVeiculo((n) => ({ ...n, veiculo_id: String(r.veiculo!.id) }));
      }
    } catch {
      setErro("Falha ao sugerir veículo.");
    }
  }

  async function faturar(v: DiaViagem) {
    if (!confirm(`Gerar faturamento de deslocamento (${v.destino}) com ${v.passageiros.length} passageiro(s)?`)) return;
    setErro("");
    try {
      const r = await tfdFaturarDeslocamento(v.id);
      setOk(`Faturamento gerado: ${r.criados} lançamento(s), ${r.ignorados} ignorado(s).`);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? "Falha ao faturar.";
      setErro(msg);
    }
  }

  async function baixarDocx(v: DiaViagem) {
    try {
      const blob = await tfdOrdemCirculacaoBlob(v.id);
      const { url, nome } = blob;
      const a = document.createElement("a");
      a.href = url;
      a.download = nome;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch {
      setErro("Falha ao gerar documento.");
    }
  }

  async function puxar() {
    setErro("");
    try {
      const r = await tfdPuxarAgendados();
      setOk(`${r.criados} agendado(s) puxados para a fila.`);
      await recarregar();
    } catch {
      setErro("Falha ao puxar agendados.");
    }
  }

  function abrirFilaModal(f?: ViagemFila) {
    if (f) {
      setEditFila(f.id);
      setFormFila({
        paciente_id: String(f.paciente_id), destino: f.destino, unidade: f.unidade,
        tratamento: f.tratamento, data_consulta: (f.data_consulta || "").slice(0, 10),
        hora_consulta: f.hora_consulta, acompanhante: f.acompanhante,
        prioridade: f.prioridade, observacoes: f.observacoes,
      });
      setBuscaPac(f.paciente_nome);
    } else {
      setEditFila(null);
      setFormFila(vazioFila);
      setBuscaPac("");
    }
    setModalFila(true);
  }

  async function salvarFila() {
    if (!formFila.paciente_id || !formFila.destino.trim()) {
      setErro("Paciente e destino são obrigatórios.");
      return;
    }
    const payload: Record<string, unknown> = {
      ...formFila,
      paciente_id: Number(formFila.paciente_id),
      destino: formFila.destino.trim().toUpperCase(),
      data_consulta: formFila.data_consulta || null,
    };
    try {
      if (editFila) await tfdAtualizarFilaViagem(editFila, payload);
      else await tfdCriarFilaViagem(payload);
      setModalFila(false);
      setOk(editFila ? "Registro atualizado." : "Paciente entrou na fila de viagem.");
      await recarregar();
    } catch {
      setErro("Erro ao salvar.");
    }
  }

  const pacFiltrados = buscaPac.trim().length < 2 ? [] : pacientes.filter((p) =>
    `${p.nome} ${p.cpf} ${p.cns}`.toLowerCase().includes(buscaPac.trim().toLowerCase())
  ).slice(0, 10);

  const destArrasto = destinoArrastado();

  function destinosDoDia(d: DiaSemana): DiaDestino[] {
    const mapa = new Map<string, DiaDestino>();
    for (const x of d.destinos) mapa.set(x.destino, x);
    // Só fila com data marcada p/ este dia gera card; fila contínua usa "+ Criar Nova Viagem".
    for (const f of filaAguardando) {
      if ((f.data_consulta || "").slice(0, 10) !== d.data) continue;
      if (!mapa.has(f.destino)) {
        mapa.set(f.destino, { destino: f.destino, viagens: [], demanda_aguardando: 0 });
      }
    }
    return [...mapa.values()].sort((a, b) => a.destino.localeCompare(b.destino));
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold text-sus-950">
          <Bus className="h-5 w-5 text-sus-900" /> Quadro de viagens e frota
        </h2>
        <span className="rounded-full bg-teal/10 px-2.5 py-0.5 text-xs font-semibold text-teal">
          {fmtDia(dia)} a {fmtDia(somaDias(dia, 6))} · {filaAguardando.length} na fila
        </span>
      </div>

      {/* Navegação semanal */}
      <Card className="mb-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setDia(somaDias(dia, -7))} className="rounded-xl bg-sus-900/10 p-2.5 text-sus-900 hover:bg-sus-900/15" title="Semana anterior"><ChevronsLeft className="h-4 w-4" /></button>
          <button onClick={() => setDia(somaDias(dia, -1))} className="rounded-xl bg-sus-900/10 p-2.5 text-sus-900 hover:bg-sus-900/15" title="Dia anterior"><ArrowLeft className="h-4 w-4" /></button>
          <Input type="date" value={dia} onChange={(e) => e.target.value && setDia(e.target.value)} className="!w-auto" />
          <button onClick={() => setDia(somaDias(dia, 1))} className="rounded-xl bg-sus-900/10 p-2.5 text-sus-900 hover:bg-sus-900/15" title="Próximo dia"><ArrowRight className="h-4 w-4" /></button>
          <button onClick={() => setDia(somaDias(dia, 7))} className="rounded-xl bg-sus-900/10 p-2.5 text-sus-900 hover:bg-sus-900/15" title="Próxima semana"><ChevronsRight className="h-4 w-4" /></button>
          <button onClick={() => setDia(hojeISO())} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-teal px-3 py-2 text-xs font-bold text-white hover:brightness-110">
            <CalendarDays className="h-4 w-4" /> Hoje
          </button>
        </div>
      </Card>

      {erro && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
      {ok && <p className="mb-3 rounded-xl bg-teal/10 px-3 py-2 text-sm text-teal">{ok}</p>}

      <div className="space-y-3">
        {/* Grade semanal primeiro; fila de espera embaixo */}
        {/* Grade semanal: 7 dias lado a lado */}
        <section className="overflow-x-auto pb-2">
          <div className="grid min-w-[980px] grid-cols-7 gap-2 min-[1400px]:min-w-0" style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}>
            {diasSemana.map((data) => {
              const di = (new Date(`${data}T12:00:00`).getDay() + 6) % 7;
              const diaInfo = semana.find((d) => d.data === data);
              const colunas = diaInfo ? destinosDoDia(diaInfo) : [];
              const temViagem = colunas.some((c) => c.viagens.length > 0);
              return (
                <div key={data} className={`rounded-2xl border p-2 ${data === hojeISO() ? "border-teal bg-teal/5" : "border-sus-900/10 bg-white"}`}>
                  <p className="mb-2 text-center">
                    <span className="block text-[10px] font-bold uppercase text-ink/50">{NOMES_DIA[di]}</span>
                    <span className="font-display text-sm font-extrabold text-sus-950">{data.slice(8, 10)}/{data.slice(5, 7)}</span>
                  </p>
                  {!temViagem && (
                    <div className="py-2 text-center">
                      <p className="mb-2 text-[11px] text-ink/40">Sem viagens</p>
                      {podeEditar && (
                        <button onClick={() => { setAlocandoEm(`nova:${data}`); setNovoDestino(""); setNovoVeiculo({ veiculo_id: "", motorista: "", hora: "05:00" }); }} className="w-full rounded-xl border border-sus-900/20 bg-white px-2 py-2.5 text-[11px] font-bold text-sus-900 hover:border-teal hover:text-teal">
                          + Criar Nova Viagem
                        </button>
                      )}
                    </div>
                  )}
                  {colunas.map((dd) => (
                    <div key={dd.destino} className="mb-2 rounded-xl bg-sand/50 p-2">
                      <div className="mb-1 flex items-center gap-1">
                        <p className="truncate text-[11px] font-extrabold text-sus-950">{dd.destino}</p>
                        {podeEditar && (
                          <button onClick={() => sugerir(data, dd.destino)} className="ml-auto rounded-lg bg-teal/10 p-1.5 text-teal hover:bg-teal/20" title="Sugerir veículo">
                            <Sparkles className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      {sugestao[`${data}|${dd.destino}`] && (
                        <p className="mb-1 rounded-lg bg-teal/10 px-2 py-1 text-[10px] font-semibold text-teal">{sugestao[`${data}|${dd.destino}`]}</p>
                      )}
                      {dd.viagens.map((v) => {
                        const chave = `${v.id}`;
                        const bloqueado = !!destArrasto && !destinoCompativel(destArrasto, v.destino);
                        return (
                          <div
                            key={chave}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              e.preventDefault();
                              const f = e.dataTransfer.getData("text/fila");
                              if (f) {
                                if (v.vagas <= 0) { setErro(`Veículo ${v.veiculo_placa || ""} lotado.`); setArrastando(null); return; }
                                alocar(Number(f), v.id, v.destino);
                                return;
                              }
                              const d = e.dataTransfer.getData("text/pass");
                              if (d) {
                                const [vid, pid] = d.split(":").map(Number);
                                mover(vid, pid, v.id, v.destino);
                              }
                            }}
                            className={`mb-1.5 rounded-lg border bg-white p-2 ${bloqueado ? "border-red-400 ring-1 ring-red-300" : arrastando ? "border-dashed border-teal" : "border-sus-900/15"}`}
                            title={bloqueado && destArrasto ? msgDestino(destArrasto) : undefined}
                          >
                            <div className="flex items-center gap-1 text-[11px]">
                              <p className="rounded bg-sus-900 px-1.5 py-0.5 font-display font-bold text-white">{v.veiculo_placa || "—"}</p>
                              <span className="ml-auto font-bold">{v.ocupados}/{v.capacidade || "—"}</span>
                            </div>
                            <div className="mt-1 h-1 overflow-hidden rounded-full bg-sus-900/10">
                              <div
                                className={`h-full rounded-full ${v.capacidade && v.ocupados >= v.capacidade ? "bg-red-500" : v.capacidade && v.ocupados >= v.capacidade * 0.75 ? "bg-amber-500" : "bg-teal"}`}
                                style={{ width: v.capacidade ? `${Math.min(100, (v.ocupados / v.capacidade) * 100)}%` : "0%" }}
                              />
                            </div>
                            {v.capacidade > 0 && v.ocupados >= v.capacidade && (
                              <p className="mt-0.5 text-[10px] font-bold text-red-600">Lotado</p>
                            )}
                            {bloqueado && destArrasto && (
                              <p className="mt-0.5 text-[10px] font-bold text-red-600">Destino diferente</p>
                            )}
                            <p className="mt-0.5 truncate text-[10px] text-ink/55">{v.motorista || "s/ motorista"}{v.hora_saida ? ` · ${v.hora_saida}` : ""}</p>
                            <div className="mt-1 space-y-1">
                              {v.passageiros.map((p) => (
                                <div
                                  key={p.id}
                                  draggable={podeEditar}
                                  onDragStart={(e) => dragPass(e, v.id, p.id)}
                                  onDragEnd={() => setArrastando(null)}
                                  className="flex items-center gap-1 rounded-md bg-sand/70 px-1.5 py-1 text-[10px]"
                                >
                                  <span className="truncate font-semibold">{p.paciente_nome}</span>
                                  {p.acompanhante && <span className="rounded-full bg-teal/15 px-1 text-[9px] font-bold text-teal">+1</span>}
                                  {podeEditar && (
                                    <button onClick={() => devolver(v.id, p.id)} className="ml-auto rounded p-0.5 text-ink/40 hover:bg-red-50 hover:text-red-600" title="Devolver à fila"><X className="h-3 w-3" /></button>
                                  )}
                                </div>
                              ))}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {selFila && v.vagas > 0 && podeEditar && (
                                <button onClick={() => alocar(selFila, v.id, v.destino)} className="inline-flex items-center gap-0.5 rounded-md bg-teal px-1.5 py-1 text-[10px] font-bold text-white hover:brightness-110" title="Alocar paciente selecionado">
                                  <UserPlus className="h-3 w-3" />
                                </button>
                              )}
                              <button onClick={() => baixarDocx(v)} className="inline-flex items-center gap-0.5 rounded-md bg-sus-900/10 px-1.5 py-1 text-[10px] font-bold text-sus-900 hover:bg-sus-900/15" title="Ordem de Circulação (.docx)">
                                <FileDown className="h-3 w-3" />
                              </button>
                              {podeFaturar && (
                                <button onClick={() => faturar(v)} className="inline-flex items-center gap-0.5 rounded-md bg-teal/10 px-1.5 py-1 text-[10px] font-bold text-teal hover:bg-teal/20" title="Gerar faturamento de deslocamento SIGTAP">
                                  <ReceiptText className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                                            {podeEditar && (
                        alocandoEm === `${data}|${dd.destino}` ? (
                          <div className="rounded-lg border border-teal/40 bg-white p-2 text-[11px]">
                            <Label>Veículo</Label>
                            <select value={novoVeiculo.veiculo_id} onChange={(e) => setNovoVeiculo({ ...novoVeiculo, veiculo_id: e.target.value })} className="w-full rounded-lg border border-sus-900/15 bg-white px-2 py-1.5 text-[11px]">
                              <option value="">Selecionar…</option>
                              {frota.filter((f) => f.status === "disponivel").map((f) => (
                                <option key={f.id} value={f.id}>{f.placa} ({f.capacidade}){f.em_outra_viagem ? " · em outra viagem" : ""}</option>
                              ))}
                            </select>
                            <div className="mt-1 grid grid-cols-2 gap-1">
                              <div><Label>Motorista</Label><Input value={novoVeiculo.motorista} onChange={(e) => setNovoVeiculo({ ...novoVeiculo, motorista: e.target.value })} className="!py-1.5 text-[11px]" /></div>
                              <div><Label>Saída</Label><Input type="time" value={novoVeiculo.hora} onChange={(e) => setNovoVeiculo({ ...novoVeiculo, hora: e.target.value })} className="!py-1.5 text-[11px]" /></div>
                            </div>
                            <div className="mt-1 flex gap-1">
                              <button onClick={() => criarViagemDestino(data, dd.destino)} className="flex-1 rounded-lg bg-teal px-2 py-1.5 text-[10px] font-bold text-white hover:brightness-110">Confirmar</button>
                              <button onClick={() => setAlocandoEm(null)} className="rounded-lg border border-sus-900/15 px-2 py-1.5 text-[10px] font-semibold">Cancelar</button>
                            </div>
                          </div>
                        ) : (
                          <button onClick={() => { setAlocandoEm(`${data}|${dd.destino}`); setNovoVeiculo({ veiculo_id: "", motorista: "", hora: "05:00" }); }} className="w-full rounded-lg border border-dashed border-sus-900/25 px-1 py-1.5 text-[10px] font-bold text-sus-900/70 hover:border-teal hover:text-teal">
                            + Veículo
                          </button>
                        )
                      )}
                    </div>
                  ))}
                  {podeEditar && alocandoEm === `nova:${data}` && (
                        <div className="rounded-lg border border-teal/40 bg-white p-2 text-[11px]">
                          <Label>Cidade de destino *</Label>
                          <Input value={novoDestino} onChange={(e) => setNovoDestino(e.target.value.toUpperCase())} placeholder="Ex: BELO HORIZONTE" className="!py-1.5 text-[11px]" />
                          <div className="mt-1"><Label>Veículo</Label>
                            <select value={novoVeiculo.veiculo_id} onChange={(e) => setNovoVeiculo({ ...novoVeiculo, veiculo_id: e.target.value })} className="w-full rounded-lg border border-sus-900/15 bg-white px-2 py-1.5 text-[11px]">
                              <option value="">Selecionar…</option>
                              {frota.filter((f) => f.status === "disponivel").map((f) => (
                                <option key={f.id} value={f.id}>{f.placa} ({f.capacidade}){f.em_outra_viagem ? " · em outra viagem" : ""}</option>
                              ))}
                            </select>
                          </div>
                          <div className="mt-1 grid grid-cols-2 gap-1">
                            <div><Label>Motorista</Label><Input value={novoVeiculo.motorista} onChange={(e) => setNovoVeiculo({ ...novoVeiculo, motorista: e.target.value })} className="!py-1.5 text-[11px]" /></div>
                            <div><Label>Saída</Label><Input type="time" value={novoVeiculo.hora} onChange={(e) => setNovoVeiculo({ ...novoVeiculo, hora: e.target.value })} className="!py-1.5 text-[11px]" /></div>
                          </div>
                          <div className="mt-1 flex gap-1">
                            <button onClick={() => criarViagemDestino(data, novoDestino.trim().toUpperCase())} className="flex-1 rounded-lg bg-teal px-2 py-1.5 text-[10px] font-bold text-white hover:brightness-110">Confirmar</button>
                            <button onClick={() => setAlocandoEm(null)} className="rounded-lg border border-sus-900/15 px-2 py-1.5 text-[10px] font-semibold">Cancelar</button>
                          </div>
                        </div>
                      )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Fila de espera — painel inferior */}
        <section
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const d = e.dataTransfer.getData("text/pass");
            if (d) {
              const [vid, pid] = d.split(":").map(Number);
              devolver(vid, pid);
            }
          }}
          className={`rounded-2xl border bg-white p-3 ${arrastando?.startsWith("pass:") ? "border-dashed border-teal ring-2 ring-teal/30" : "border-sus-900/10"}`}
        >
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <p className="font-display text-sm font-bold text-sus-950">Fila de espera ({filaAguardando.length})</p>
            <Input value={buscaDestino} onChange={(e) => setBuscaDestino(e.target.value)} placeholder="Filtrar destino…" className="!w-52 !py-2 text-xs" />
            {podeEditar && (
              <button onClick={puxar} className="rounded-xl bg-sus-900/10 px-3 py-2 text-xs font-bold text-sus-900 hover:bg-sus-900/15">
                Puxar agendados para a fila
              </button>
            )}
            {podeEditar && (
              <button onClick={() => abrirFilaModal()} className="ml-auto rounded-lg bg-teal p-2 text-white hover:brightness-110" title="Novo na fila"><Plus className="h-4 w-4" /></button>
            )}
          </div>
          <div className="grid max-h-[42vh] gap-2 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filaAguardando.map((f) => (
              <div
                key={f.id}
                draggable={podeEditar}
                onDragStart={(e) => dragFila(e, f.id)}
                onDragEnd={() => setArrastando(null)}
                onClick={() => setSelFila(selFila === f.id ? null : f.id)}
                className={`cursor-pointer rounded-xl border p-2.5 text-xs ${selFila === f.id ? "border-teal bg-teal/5 ring-1 ring-teal" : "border-sus-900/10 bg-sand/50 hover:border-teal/40"}`}
              >
                <p className="font-bold text-sus-950">{f.paciente_nome}</p>
                <p className="text-ink/55">Nasc. {fmtNasc(f.paciente_nascimento)} · {f.paciente_cpf || "sem CPF"}</p>
                <p className="mt-1 font-semibold text-sus-900">{f.destino}</p>
                <p className="text-ink/55">{f.unidade || "—"}{f.hora_consulta ? ` · ${f.hora_consulta}` : ""}</p>
                <p className="mt-1 flex flex-wrap gap-1">
                  <span className="rounded-full bg-sus-900/10 px-2 py-0.5 font-semibold">{rotuloPrioridade(f.prioridade)}</span>
                  {f.acompanhante && <span className="rounded-full bg-teal/15 px-2 py-0.5 font-semibold text-teal">c/ acompanhante</span>}
                </p>
                {podeEditar && (
                  <div className="mt-1 flex gap-1">
                    <button onClick={(ev) => { ev.stopPropagation(); abrirFilaModal(f); }} className="rounded-lg p-1.5 text-sus-800 hover:bg-sus-100" title="Editar"><Pencil className="h-3.5 w-3.5" /></button>
                    <button onClick={async (ev) => { ev.stopPropagation(); if (confirm("Excluir da fila de viagem?")) { await tfdExcluirFilaViagem(f.id); recarregar(); } }} className="rounded-lg p-1.5 text-red-600 hover:bg-red-50" title="Excluir"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                )}
              </div>
            ))}
            {filaAguardando.length === 0 && <p className="py-6 text-center text-xs text-ink/45">Fila vazia. Arraste passageiros de volta para cá.</p>}
          </div>
        </section>
      </div>

      {modalFila && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4" onClick={() => setModalFila(false)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl bg-white p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <p className="font-display text-base font-bold text-sus-950">{editFila ? "Editar fila de viagem" : "Novo na fila de viagem"}</p>
              <button onClick={() => setModalFila(false)} className="rounded-lg p-2 text-ink/50 hover:bg-sand" aria-label="Fechar"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="md:col-span-2">
                <Label>Paciente *</Label>
                <Input value={buscaPac} onChange={(e) => { setBuscaPac(e.target.value); setFormFila({ ...formFila, paciente_id: "" }); }} placeholder="Buscar nome/CPF…" />
                {pacFiltrados.length > 0 && !formFila.paciente_id && (
                  <div className="mt-1 max-h-36 overflow-y-auto rounded-xl border border-sus-900/10">
                    {pacFiltrados.map((p) => (
                      <button key={p.id} onClick={() => { setFormFila({ ...formFila, paciente_id: String(p.id) }); setBuscaPac(p.nome); }} className="block w-full px-3 py-2 text-left text-sm hover:bg-sand">
                        <b>{p.nome}</b> <span className="text-xs text-ink/50">{p.cpf || ""}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div><Label>Cidade de destino *</Label><Input value={formFila.destino} onChange={(e) => setFormFila({ ...formFila, destino: e.target.value.toUpperCase() })} placeholder="Ex: BELO HORIZONTE" /></div>
              <div><Label>Unidade / hospital</Label><Input value={formFila.unidade} onChange={(e) => setFormFila({ ...formFila, unidade: e.target.value })} /></div>
              <div className="md:col-span-2"><Label>Tratamento / exame</Label><Input value={formFila.tratamento} onChange={(e) => setFormFila({ ...formFila, tratamento: e.target.value })} /></div>
              <div><Label>Data da consulta</Label><Input type="date" value={formFila.data_consulta} onChange={(e) => setFormFila({ ...formFila, data_consulta: e.target.value })} /></div>
              <div><Label>Horário da consulta</Label><Input type="time" value={formFila.hora_consulta} onChange={(e) => setFormFila({ ...formFila, hora_consulta: e.target.value })} /></div>
              <div>
                <Label>Risco / prioridade</Label>
                <select value={formFila.prioridade} onChange={(e) => setFormFila({ ...formFila, prioridade: e.target.value })} className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
                  {PRIOS.map((p) => <option key={p.value} value={p.value}>{p.rotulo}</option>)}
                </select>
              </div>
              <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={formFila.acompanhante} onChange={(e) => setFormFila({ ...formFila, acompanhante: e.target.checked })} className="h-4 w-4 accent-teal" /> Com acompanhante</label>
              <div className="md:col-span-2"><Label>Observações</Label><Input value={formFila.observacoes} onChange={(e) => setFormFila({ ...formFila, observacoes: e.target.value })} /></div>
            </div>
            {erro && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
            <Button onClick={salvarFila} className="mt-4 w-full"><Plus className="h-4 w-4" />{editFila ? "Atualizar" : "Entrar na fila"}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
