import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
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
  Printer,
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
  tfdAtualizarViagem,
  tfdCriarFilaViagem,
  tfdCriarViagem,
  tfdDestinos,
  tfdExcluirFilaViagem,
  tfdExcluirViagem,
  tfdFaturarDeslocamento,
  tfdFilaViagem,
  tfdMotoristas,
  tfdObterViagem,
  tfdPacientes,
  tfdCandidatosPuxar,
  tfdDisponibilidade,
  tfdPuxarAgendados,
  tfdRemoverPassageiro,
  tfdSugestao,
  tfdSemana,
  tfdTrocarVeiculoViagem,
  tfdOrdemCirculacaoBlob,
  fetchQuadroFiltros,
  saveQuadroFiltros,
  pagData,
  type Destino,
  type DiaDestino,
  type DiaSemana,
  type DiaViagem,
  type CandidatoPuxar,
  type DiaPassageiro,
  type FrotaDia,
  type Motorista,
  type Paciente,
  type ViagemFila,
} from "../../services/api";
import { Button, Card, Input, Label } from "../../components/ui/primitives";
import { useUndo } from "../../components/UndoToast";
import { rotuloPrioridade } from "../../utils/rotulos";
import { retornoAutomatico, useDisponibilidade } from "../../hooks/useDisponibilidade";

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
  { value: "urgente", rotulo: "Urgente" },
];

const vazioFila = {
  paciente_id: "", destino: "", unidade: "", tratamento: "",
  data_consulta: "", hora_consulta: "", acompanhante: false,
  acompanhante_id: "", acompanhante_nome: "", acompanhante_cpf: "",
  prioridade: "rotina", observacoes: "",
  // Segunda etapa visível do fluxo: agendamento expandido ou só fila.
  agendar: false,
};

const NOMES_DIA = ["SEG", "TER", "QUA", "QUI", "SEX", "SÁB", "DOM"];

/** Nome dinâmico da viagem p/ cards e modais (nunca exibe só a placa). */
function nomeViagem(v: { destino: string; hora_saida: string; id: number }): string {
  const dest = (v.destino || "A definir").trim() || "A definir";
  const hora = (v.hora_saida || "").trim() || "s/ horário";
  return `Viagem - ${dest} - ${hora}`;
}

/** Seletor de motorista com "A definir" + cadastro + manual. */
function CampoMotorista({
  motoristas, motoristaId, motoristaNome, onMudar,
}: {
  motoristas: Motorista[];
  motoristaId: string;
  motoristaNome: string;
  onMudar: (id: string, nome: string) => void;
}) {
  if (motoristaId === "__manual__") {
    return (
      <div className="flex gap-1">
        <Input
          value={motoristaNome}
          onChange={(e) => onMudar("__manual__", e.target.value)}
          placeholder="Digite o nome do motorista"
          className="!py-1.5 text-[11px]"
        />
        <button
          onClick={() => onMudar("", "")}
          className="rounded-lg border border-sus-900/15 px-2 py-1.5 text-[10px] font-semibold"
          title="Voltar à lista"
        >
          Lista
        </button>
      </div>
    );
  }
  return (
    <select
      value={motoristaId}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "__manual__") {
          onMudar("__manual__", motoristaNome);
          return;
        }
        const m = motoristas.find((x) => String(x.id) === v);
        onMudar(v, m ? m.nome : "");
      }}
      className="w-full rounded-lg border border-sus-900/15 bg-white px-2 py-1.5 text-[11px]"
    >
      <option value="">A definir</option>
      {motoristas.filter((m) => m.ativo).map((m) => (
        <option key={m.id} value={m.id}>{m.nome}</option>
      ))}
      <option value="__manual__">Outro (digitar)…</option>
    </select>
  );
}

export default function QuadroViagens() {
  const { can, retroativoBloqueado, podeEditarPassadas } = useAuth();
  const { notificarUndo } = useUndo();
  const RETRO_MSG = "Seu perfil não possui permissão para realizar lançamentos com datas retroativas.";
  const PASSADA_MSG = "Seu perfil não possui permissão para alterar viagens de datas passadas.";
  const hoje = hojeISO();
  const podeEditar = can("tfd_viagens");
  // Gestão de frota restrita: vê o quadro e gerencia veículos/motoristas, sem PII de pacientes.
  const podeGerirFrota = podeEditar || can("tfd_frota_gestao");
  const podeVerPacientes = podeEditar;
  const podeFaturar = can("tfd_faturamento");
  const [dia, setDia] = useState(hojeISO());
  // Quantidade de dias visíveis na grade (desktop padrão 5; mobile sempre 1).
  const [qtdDias, setQtdDias] = useState(5);
  const [semana, setSemana] = useState<DiaSemana[]>([]);
  const [frota, setFrota] = useState<FrotaDia[]>([]);
  const [fila, setFila] = useState<ViagemFila[]>([]);
  const [buscaDestino, setBuscaDestino] = useState("");
  const [buscaPsf, setBuscaPsf] = useState("");
  // Filtros avançados da visão semanal (persistidos por operador).
  const [filtroDia, setFiltroDia] = useState("");
  const [agrupFila, setAgrupFila] = useState<"destino" | "data">("destino");
  const [prefsProntas, setPrefsProntas] = useState(false);
  // Mobile (<=768px): grade semanal vira Visão Diária (1 dia por vez).
  const [ehMobile, setEhMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const fn = (e: MediaQueryListEvent) => setEhMobile(e.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  const [pacientes, setPacientes] = useState<Paciente[]>([]);
  const [buscaPac, setBuscaPac] = useState("");
  const [modalFila, setModalFila] = useState(false);
  const [editFila, setEditFila] = useState<number | null>(null);
  const [formFila, setFormFila] = useState(vazioFila);
  const [buscaAcomp, setBuscaAcomp] = useState("");
  // Gestão direta da viagem no card semanal.
  const [editViagem, setEditViagem] = useState<DiaViagem | null>(null);
  const [formViagem, setFormViagem] = useState({ destino: "", data_viagem: "", hora_saida: "", hora_retorno: "", motorista: "", motorista_id: "", observacoes: "" });
  const [destinos, setDestinos] = useState<Destino[]>([]);
  const [trocaVeiculo, setTrocaVeiculo] = useState<DiaViagem | null>(null);
  const [trocaVeiculoId, setTrocaVeiculoId] = useState("");
  const [trocaMotorista, setTrocaMotorista] = useState("");
  const [trocaMotoristaId, setTrocaMotoristaId] = useState("");
  const [excluirViagem, setExcluirViagem] = useState<DiaViagem | null>(null);
  const [reagendar, setReagendar] = useState<{
    vid: number; origem: string; destino: string;
    nome: string; passageiros: number;
    hora_saida: string; hora_retorno: string;
    conflitoVeiculo: string | null; conflitoMotorista: string | null;
  } | null>(null);
  const [reagendando, setReagendando] = useState(false);
  const [puxarAberto, setPuxarAberto] = useState(false);
  const [candidatos, setCandidatos] = useState<CandidatoPuxar[]>([]);
  const [selCand, setSelCand] = useState<Set<number>>(new Set());
  const [candLoading, setCandLoading] = useState(false);
  const [selFila, setSelFila] = useState<number | null>(null);
  const [alocandoEm, setAlocandoEm] = useState<string | null>(null);
  const [novoVeiculo, setNovoVeiculo] = useState({ veiculo_id: "", motorista: "", motorista_id: "", hora: "", retorno: "" });
  const [motoristas, setMotoristas] = useState<Motorista[]>([]);
  const [novoDestino, setNovoDestino] = useState("");
  const [sugestao, setSugestao] = useState<Record<string, string>>({});
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [visualizarOrdem, setVisualizarOrdem] = useState<DiaViagem | null>(null);

  useEffect(() => {
    if (visualizarOrdem) {
      document.body.classList.add("imprimindo-ordem");
    } else {
      document.body.classList.remove("imprimindo-ordem");
    }
    return () => {
      document.body.classList.remove("imprimindo-ordem");
    };
  }, [visualizarOrdem]);

  const dataCriacao = alocandoEm
    ? (alocandoEm.startsWith("nova:") ? alocandoEm.slice(5) : alocandoEm.split("|")[0])
    : "";
  const { disp: dispCriacao } = useDisponibilidade(
    dataCriacao, novoVeiculo.hora, novoVeiculo.retorno, null, alocandoEm !== null,
  );
  const veiculosLivresCriacao = dispCriacao
    ? dispCriacao.veiculos.filter((f) => f.disponivel)
    : frota;
  const motoristasLivresCriacao = dispCriacao
    ? motoristas.filter((m) => dispCriacao.motoristas.find((d) => d.id === m.id)?.disponivel !== false)
    : motoristas;
  // Edição: disponibilidade da janela editada (ignora a própria viagem).
  const { disp: dispEdicao } = useDisponibilidade(
    formViagem.data_viagem, formViagem.hora_saida, formViagem.hora_retorno,
    editViagem?.id ?? null, editViagem !== null,
  );
  const motoristasLivresEdicao = dispEdicao
    ? motoristas.filter((m) => dispEdicao.motoristas.find((d) => d.id === m.id)?.disponivel !== false
      || String(m.id) === String(formViagem.motorista_id))
    : motoristas;
  // Troca: disponibilidade da janela da viagem (ignora ela própria).
  const { disp: dispTroca } = useDisponibilidade(
    trocaVeiculo?.data_viagem ?? "", trocaVeiculo?.hora_saida ?? "",
    trocaVeiculo?.hora_retorno ?? "", trocaVeiculo?.id ?? null, trocaVeiculo !== null,
  );
  const veiculosLivresTroca = dispTroca
    ? dispTroca.veiculos.filter((f) => f.disponivel || String(f.id) === String(trocaVeiculo?.veiculo_id))
    : frota;
  const motoristasLivresTroca = dispTroca
    ? motoristas.filter((m) => dispTroca.motoristas.find((d) => d.id === m.id)?.disponivel !== false
      || String(m.id) === String(trocaMotoristaId))
    : motoristas;

  const diasSemana = useMemo(
    () => Array.from({ length: ehMobile ? 1 : qtdDias }, (_, i) => somaDias(dia, i)),
    [dia, ehMobile, qtdDias]
  );

  async function recarregar(ini = dia) {
    try {
      if (podeVerPacientes) {
        const [sem, fl] = await Promise.all([
          tfdSemana(ini),
          tfdFilaViagem({
            destino: buscaDestino.trim() || undefined,
            psf: buscaPsf.trim() || undefined,
          }),
        ]);
        setSemana(sem.dias);
        setFrota(sem.frota);
        setFila(fl);
      } else {
        const sem = await tfdSemana(ini);
        setSemana(sem.dias);
        setFrota(sem.frota);
        setFila([]);
      }
    } catch {
      setErro("Falha ao carregar quadro.");
    }
  }

  useEffect(() => {
    recarregar().catch(() => setErro("Falha ao carregar quadro."));
    tfdPacientes("").then((r) => setPacientes(pagData<Paciente>(r))).catch(() => {});
    tfdMotoristas({ limit: 200 }).then((r) => setMotoristas(pagData<Motorista>(r))).catch(() => {});
    tfdDestinos(1, 500).then((r) => setDestinos(pagData<Destino>(r))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dia]);

  // Restaura os filtros da visão semanal salvos no perfil do operador (1x).
  useEffect(() => {
    fetchQuadroFiltros()
      .then((p) => {
        if (p.data) setFiltroDia(p.data);
        if (p.destino) setBuscaDestino(p.destino);
        if (p.psf) setBuscaPsf(p.psf);
        if (p.agrupamento === "data" || p.agrupamento === "destino") setAgrupFila(p.agrupamento);
      })
      .catch(() => {})
      .finally(() => setPrefsProntas(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persiste filtros por operador (debounce p/ não gravar a cada tecla).
  useEffect(() => {
    if (!prefsProntas) return;
    const t = setTimeout(() => {
      saveQuadroFiltros(filtroDia, buscaDestino.trim().toUpperCase(), agrupFila, buscaPsf.trim().toUpperCase()).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [filtroDia, buscaDestino, buscaPsf, agrupFila, prefsProntas]);

  useEffect(() => {
    const t = setTimeout(() => recarregar().catch(() => {}), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buscaDestino, buscaPsf]);

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
  function dragViagem(e: React.DragEvent, v: DiaViagem, origem: string) {
    e.dataTransfer.setData("text/viagem", JSON.stringify({ vid: v.id, origem }));
    e.dataTransfer.effectAllowed = "move";
    setArrastando(`viag:${v.id}:${origem}`);
  }
  function viagemArrastada(): { vid: number; origem: string } | null {
    if (!arrastando?.startsWith("viag:")) return null;
    const [, vid, origem] = arrastando.split(":");
    const n = Number(vid);
    if (!n || !/^\d{4}-\d{2}-\d{2}$/.test(origem || "")) return null;
    return { vid: n, origem };
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
    let viagemAlvo: DiaViagem | undefined;
    for (const d of semana) {
      viagemAlvo = d.destinos.flatMap((x) => x.viagens).find((v) => v.id === vid);
      if (viagemAlvo) break;
    }
    if (viagemAlvo && viagemAlvo.data_viagem < hoje && !podeEditarPassadas) {
      setErro(PASSADA_MSG);
      setArrastando(null);
      return;
    }
    const f = fila.find((x) => x.id === fid);
    if (!f) return;
    if (!destinoCompativel(f.destino, destVeiculo)) {
      setErro(msgDestino(f.destino));
      setArrastando(null);
      return;
    }
    setErro("");
    try {
      const criado = await tfdAddPassageiro(vid, {
        paciente_id: f.paciente_id,
        acompanhante: f.acompanhante_nome || (f.acompanhante ? "Sim" : ""),
        acompanhante_id: f.acompanhante_id ?? null,
        acompanhante_cpf: f.acompanhante_cpf || "",
        viagem_fila_id: f.id,
        tratamento: f.tratamento,
        unidade: f.unidade,
        hora_consulta: f.hora_consulta,
        observacoes: f.observacoes || "",
      });
      setSelFila(null);
      await recarregar();
      notificarUndo({
        titulo: `${f.paciente_nome} alocado(a).`,
        descricao: "Desfazer devolve o paciente à fila de espera.",
        onUndo: async () => {
          await tfdRemoverPassageiro(vid, criado.id);
          await recarregar();
        },
      });
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
      let destinoViagem: DiaViagem | undefined;
      for (const d of semana) {
        if (!origem) origem = d.destinos.flatMap((x) => x.viagens).find((v) => v.id === vidOrigem);
        if (!destinoViagem) destinoViagem = d.destinos.flatMap((x) => x.viagens).find((v) => v.id === vidDestino);
        if (origem && destinoViagem) break;
      }
      if (((origem && origem.data_viagem < hoje) || (destinoViagem && destinoViagem.data_viagem < hoje)) && !podeEditarPassadas) {
        setErro(PASSADA_MSG);
        return;
      }
      const p = origem?.passageiros.find((x) => x.id === passId);
      if (!p || !origem) return;
      if (!destinoCompativel(origem.destino, destDestino)) {
        setErro(msgDestino(origem.destino));
        return;
      }
      const criado = await tfdAddPassageiro(vidDestino, {
        paciente_id: p.paciente_id,
        acompanhante: p.acompanhante,
        acompanhante_id: p.acompanhante_id ?? null,
        acompanhante_cpf: p.acompanhante_cpf ?? "",
        tratamento: p.tratamento,
        unidade: p.unidade,
        hora_consulta: p.hora_consulta,
        observacoes: p.observacoes || "",
      });
      await tfdRemoverPassageiro(vidOrigem, passId);
      await recarregar();
      notificarUndo({
        titulo: "Passageiro movido.",
        descricao: `Desfazer retorna ${p.paciente_nome} à viagem de origem.`,
        onUndo: async () => {
          await tfdAddPassageiro(vidOrigem, {
            paciente_id: p.paciente_id,
            acompanhante: p.acompanhante,
            acompanhante_id: p.acompanhante_id ?? null,
            acompanhante_cpf: p.acompanhante_cpf ?? "",
            viagem_fila_id: p.viagem_fila_id ?? null,
            tratamento: p.tratamento,
            unidade: p.unidade,
            hora_consulta: p.hora_consulta,
            observacoes: p.observacoes || "",
          }).catch(() => null);
          await tfdRemoverPassageiro(vidDestino, criado.id).catch(() => null);
          await recarregar();
        },
      });
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? "Falha ao mover.";
      setErro(msg);
    } finally {
      setArrastando(null);
    }
  }

  async function devolver(vid: number, passId: number) {
    setErro("");
    let snap: DiaPassageiro | null = null;
    let viagemAlvo: DiaViagem | undefined;
    for (const d of semana) {
      for (const v of d.destinos.flatMap((x) => x.viagens)) {
        if (v.id !== vid) continue;
        viagemAlvo = v;
        const achou = v.passageiros.find((x) => x.id === passId);
        if (achou) { snap = achou; break; }
      }
      if (snap) break;
    }
    if (viagemAlvo && viagemAlvo.data_viagem < hoje && !podeEditarPassadas) {
      setErro(PASSADA_MSG);
      setArrastando(null);
      return;
    }
    try {
      await tfdRemoverPassageiro(vid, passId);
      await recarregar();
      if (snap) {
        const s2: DiaPassageiro = snap;
        notificarUndo({
          titulo: "Devolvido à fila de espera.",
          descricao: `Desfazer realoca ${s2.paciente_nome} na viagem.`,
          onUndo: async () => {
            await tfdAddPassageiro(vid, {
              paciente_id: s2.paciente_id,
              acompanhante: s2.acompanhante,
              acompanhante_id: s2.acompanhante_id ?? null,
              acompanhante_cpf: s2.acompanhante_cpf ?? "",
              viagem_fila_id: s2.viagem_fila_id ?? null,
              tratamento: s2.tratamento,
              unidade: s2.unidade,
              hora_consulta: s2.hora_consulta,
              observacoes: s2.observacoes || "",
            });
            await recarregar();
          },
        });
      } else {
        setOk("Devolvido à fila de espera.");
      }
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
    if (data < hoje && !podeEditarPassadas) {
      setErro(PASSADA_MSG);
      return;
    }
    setErro("");
    try {
      const mid = /^\d+$/.test(novoVeiculo.motorista_id) ? Number(novoVeiculo.motorista_id) : null;
      await tfdCriarViagem({
        destino,
        data_viagem: data,
        hora_saida: novoVeiculo.hora || "05:00",
        hora_retorno: novoVeiculo.retorno || retornoAutomatico(novoVeiculo.hora || "05:00"),
        veiculo_id: novoVeiculo.veiculo_id ? Number(novoVeiculo.veiculo_id) : null,
        motorista_id: mid,
        motorista: novoVeiculo.motorista,
        status: "agendada",
      });
      setAlocandoEm(null);
      setNovoVeiculo({ veiculo_id: "", motorista: "", motorista_id: "", hora: "", retorno: "" });
      setOk("Veículo alocado ao destino.");
      await recarregar();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? "Erro ao criar viagem.";
      setErro(msg);
    }
  }

  async function sugerir(data: string, destino: string, viagemId?: number) {
    try {
      const r = await tfdSugestao(data, destino, viagemId);
      const chave = viagemId ? `viag:${viagemId}` : `${data}|${destino}`;
      setSugestao((s) => ({ ...s, [chave]: r.veiculo ? `${r.veiculo.modelo || r.veiculo.placa} (${r.veiculo.placa}) — ${r.motivo}` : r.motivo }));
      if (r.veiculo) {
        if (viagemId) {
          await tfdTrocarVeiculoViagem(viagemId, r.veiculo.id).catch(() => null);
          setOk(`Veículo sugerido aplicado: ${r.veiculo.modelo || r.veiculo.placa} (${r.veiculo.placa}).`);
          await recarregar();
        } else {
          setAlocandoEm(`${data}|${destino}`);
          setNovoVeiculo((n) => ({ ...n, veiculo_id: String(r.veiculo!.id) }));
        }
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

  async function soltarViagem(destino: string, raw?: string) {
    setArrastando(null);
    if (!podeGerirFrota) return;
    let info: { vid: number; origem: string } | null = null;
    try {
      const o = JSON.parse(raw || "{}");
      if (o.vid && o.origem) info = { vid: Number(o.vid), origem: String(o.origem) };
    } catch { info = null; }
    info = info ?? viagemArrastada();
    if (!info || info.origem === destino) return;
    if ((info.origem < hoje || destino < hoje) && !podeEditarPassadas) {
      setErro(PASSADA_MSG);
      return;
    }
    if (retroativoBloqueado && destino < hoje) {
      setErro(RETRO_MSG);
      return;
    }
    setErro("");
    try {
      const full = await tfdObterViagem(info.vid);
      const disp = await tfdDisponibilidade(
        destino, full.hora_saida || "", full.hora_retorno || "", info.vid,
      ).catch(() => null);
      let conflitoVeiculo: string | null = null;
      let conflitoMotorista: string | null = null;
      if (disp) {
        if (full.veiculo_id) {
          const vx = disp.veiculos.find((x) => x.id === full.veiculo_id);
          if (vx && !vx.disponivel) conflitoVeiculo = vx.ocupado_por || "outra viagem";
        }
        const norm = (x: string) => (x || "").trim().toUpperCase();
        if (full.motorista_id) {
          const mx = disp.motoristas.find((x) => x.id === full.motorista_id);
          if (mx && !mx.disponivel) conflitoMotorista = mx.ocupado_por || mx.nome;
        } else if (norm(full.motorista)) {
          const mx = disp.motoristas.find((x) => norm(x.nome) === norm(full.motorista) && !x.disponivel);
          if (mx) conflitoMotorista = mx.ocupado_por || mx.nome;
        }
      }
      const nPass = semana.flatMap((d) => d.destinos.flatMap((x) => x.viagens))
        .find((x) => x.id === info!.vid)?.passageiros.length ?? 0;
      setReagendar({
        vid: info.vid, origem: info.origem, destino,
        nome: nomeViagem({ destino: full.destino, hora_saida: full.hora_saida || "", id: full.id }),
        passageiros: nPass,
        hora_saida: full.hora_saida || "", hora_retorno: full.hora_retorno || "",
        conflitoVeiculo, conflitoMotorista,
      });
    } catch {
      setErro("Falha ao preparar reagendamento.");
    }
  }

  async function confirmarReagendar() {
    if (!reagendar || reagendando) return;
    if ((reagendar.origem < hoje || reagendar.destino < hoje) && !podeEditarPassadas) {
      setErro(PASSADA_MSG);
      return;
    }
    setReagendando(true);
    setErro("");
    try {
      const full = await tfdObterViagem(reagendar.vid);
      await tfdAtualizarViagem(reagendar.vid, {
        destino: full.destino,
        unidade: full.unidade,
        data_viagem: reagendar.destino,
        hora_saida: full.hora_saida,
        veiculo_id: reagendar.conflitoVeiculo ? null : full.veiculo_id,
        motorista_id: reagendar.conflitoMotorista
          ? null
          : (full.motorista_id ?? null),
        motorista: reagendar.conflitoMotorista ? "" : full.motorista,
        departamento: full.departamento,
        data_retorno: full.data_retorno,
        hora_retorno: full.hora_retorno,
        km_inicial: full.km_inicial,
        km_final: full.km_final,
        adiantamento: full.adiantamento,
        status: full.status,
        finalidade: full.finalidade,
        observacoes: full.observacoes,
      });
      // Snapshot pré-mudança (`full`): desfazer volta data + vínculos originais.
      const snapAntes = { ...full };
      const diaOrigem = reagendar.origem;
      const diaDestino = reagendar.destino;
      const vidAlvo = reagendar.vid;
      const nomeReag = reagendar.nome;
      const teveConflito = !!(reagendar.conflitoVeiculo || reagendar.conflitoMotorista);
      setReagendar(null);
      await recarregar();
      notificarUndo({
        titulo: `${nomeReag} reagendada para ${fmtDia(diaDestino)}.`,
        descricao: `De ${fmtDia(diaOrigem)} para ${fmtDia(diaDestino)}. Desfazer retorna à data original.` +
          (teveConflito ? " (Veículo/motorista foram para A definir.)" : ""),
        onUndo: async () => {
          const antes = snapAntes;
          await tfdAtualizarViagem(vidAlvo, {
            destino: antes.destino, unidade: antes.unidade,
            data_viagem: diaOrigem,
            hora_saida: antes.hora_saida, hora_retorno: antes.hora_retorno,
            veiculo_id: antes.veiculo_id,
            motorista_id: antes.motorista_id ?? null, motorista: antes.motorista,
            departamento: antes.departamento, data_retorno: antes.data_retorno,
            km_inicial: antes.km_inicial, km_final: antes.km_final,
            adiantamento: antes.adiantamento, status: antes.status,
            finalidade: antes.finalidade, observacoes: antes.observacoes,
          });
          await recarregar();
        },
      });
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? "Erro ao reagendar.";
      setErro(msg);
    } finally {
      setReagendando(false);
    }
  }

  async function abrirPuxar() {
    setErro("");
    setCandLoading(true);
    try {
      const lista = await tfdCandidatosPuxar();
      setCandidatos(lista);
      setSelCand(new Set(lista.map((c) => c.exame_fila_id)));
      setPuxarAberto(true);
    } catch {
      setErro("Falha ao buscar agendados.");
    } finally {
      setCandLoading(false);
    }
  }

  async function confirmarPuxar() {
    setErro("");
    try {
      const r = await tfdPuxarAgendados(undefined, [...selCand]);
      setPuxarAberto(false);
      setOk(
        `${r.criados} agendado(s) puxados para a fila.` +
        (r.ignorados ? ` ${r.ignorados} deixado(s) de fora.` : "")
      );
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
        acompanhante_id: f.acompanhante_id ? String(f.acompanhante_id) : "",
        acompanhante_nome: f.acompanhante_nome || "",
        acompanhante_cpf: f.acompanhante_cpf || "",
        prioridade: f.prioridade, observacoes: f.observacoes,
        agendar: !!(f.data_consulta || f.hora_consulta),
      });
      setBuscaPac(f.paciente_nome);
      setBuscaAcomp(f.acompanhante_nome || "");
    } else {
      setEditFila(null);
      setFormFila(vazioFila);
      setBuscaPac("");
      setBuscaAcomp("");
    }
    setModalFila(true);
  }

  async function salvarFila() {
    if (!formFila.paciente_id || !formFila.destino.trim()) {
      setErro("Paciente e destino são obrigatórios.");
      return;
    }
    // Segunda etapa do fluxo: agendamento expandido exige data.
    if (formFila.agendar && !formFila.data_consulta) {
      setErro("Agendamento exige a data da consulta.");
      return;
    }
    if (formFila.acompanhante_id && Number(formFila.acompanhante_id) === Number(formFila.paciente_id)) {
      setErro("Acompanhante não pode ser o próprio paciente.");
      return;
    }
    const payload: Record<string, unknown> = {
      paciente_id: Number(formFila.paciente_id),
      destino: formFila.destino.trim().toUpperCase(),
      unidade: formFila.unidade,
      tratamento: formFila.tratamento,
      // Sem agendamento expandido, não fixa data (fila contínua).
      data_consulta: formFila.agendar ? formFila.data_consulta || null : null,
      hora_consulta: formFila.agendar ? formFila.hora_consulta : "",
      acompanhante_id: formFila.acompanhante && formFila.acompanhante_id ? Number(formFila.acompanhante_id) : null,
      acompanhante_nome: formFila.acompanhante ? formFila.acompanhante_nome.trim() : "",
      acompanhante_cpf: formFila.acompanhante ? formFila.acompanhante_cpf.replace(/\D/g, "").slice(0, 11) : "",
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

  // Gestão direta da viagem no card semanal: editar / trocar veículo / excluir.
  async function abrirEditarViagem(v: DiaViagem) {
    if (v.data_viagem < hoje && !podeEditarPassadas) {
      setErro(PASSADA_MSG);
      return;
    }
    setErro("");
    try {
      const full = await tfdObterViagem(v.id);
      setEditViagem(v);
      setFormViagem({
        destino: full.destino || v.destino || "",
        data_viagem: (full.data_viagem || "").slice(0, 10),
        hora_saida: full.hora_saida || "",
        hora_retorno: full.hora_retorno || "",
        motorista: full.motorista || "",
        motorista_id: full.motorista_id ? String(full.motorista_id) : "",
        observacoes: full.observacoes || "",
      });
    } catch {
      setErro("Falha ao carregar viagem.");
    }
  }

  async function salvarEdicaoViagem() {
    if (!editViagem) return;
    if (!formViagem.data_viagem) {
      setErro("Data da viagem é obrigatória.");
      return;
    }
    if (!formViagem.destino.trim()) {
      setErro("Destino da viagem é obrigatório.");
      return;
    }
    if (((editViagem && editViagem.data_viagem < hoje) || formViagem.data_viagem < hoje) && !podeEditarPassadas) {
      setErro(PASSADA_MSG);
      return;
    }
    if (retroativoBloqueado && formViagem.data_viagem < hoje) {
      setErro(RETRO_MSG);
      return;
    }
    setErro("");
    try {
      const full = await tfdObterViagem(editViagem.id);
      const mid = /^\d+$/.test(formViagem.motorista_id) ? Number(formViagem.motorista_id) : null;
      await tfdAtualizarViagem(editViagem.id, {
        destino: formViagem.destino.trim().toUpperCase(),
        unidade: full.unidade,
        data_viagem: formViagem.data_viagem,
        hora_saida: formViagem.hora_saida,
        hora_retorno: formViagem.hora_retorno || retornoAutomatico(formViagem.hora_saida || "05:00"),
        veiculo_id: full.veiculo_id,
        motorista_id: mid,
        motorista: formViagem.motorista,
        departamento: full.departamento,
        data_retorno: full.data_retorno,
        km_inicial: full.km_inicial,
        km_final: full.km_final,
        adiantamento: full.adiantamento,
        status: full.status,
        finalidade: full.finalidade,
        observacoes: formViagem.observacoes,
      });
      setEditViagem(null);
      setOk("Viagem atualizada.");
      await recarregar();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? "Erro ao atualizar viagem.";
      setErro(msg);
    }
  }

  function abrirTrocaVeiculo(v: DiaViagem) {
    if (v.data_viagem < hoje && !podeEditarPassadas) {
      setErro(PASSADA_MSG);
      return;
    }
    setTrocaVeiculo(v);
    setTrocaVeiculoId(v.veiculo_id ? String(v.veiculo_id) : "");
    setTrocaMotorista(v.motorista || "");
    setTrocaMotoristaId(v.motorista_id ? String(v.motorista_id) : "");
  }

  async function confirmarTrocaVeiculo() {
    if (!trocaVeiculo) return;
    if (trocaVeiculo.data_viagem < hoje && !podeEditarPassadas) {
      setErro(PASSADA_MSG);
      return;
    }
    setErro("");
    try {
      const mid = /^\d+$/.test(trocaMotoristaId) ? Number(trocaMotoristaId) : null;
      await tfdTrocarVeiculoViagem(
        trocaVeiculo.id,
        trocaVeiculoId ? Number(trocaVeiculoId) : null,
        trocaMotorista,
        mid,
      );
      setTrocaVeiculo(null);
      setOk("Veículo atualizado.");
      await recarregar();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? "Erro ao trocar veículo.";
      setErro(msg);
    }
  }

  async function confirmarExclusaoViagem() {
    if (!excluirViagem) return;
    if (excluirViagem.data_viagem < hoje && !podeEditarPassadas) {
      setErro(PASSADA_MSG);
      return;
    }
    setErro("");
    try {
      const alvo = excluirViagem;
      const full = await tfdObterViagem(alvo.id).catch(() => null);
      const pax = [...alvo.passageiros];
      await tfdExcluirViagem(alvo.id);
      setExcluirViagem(null);
      await recarregar();
      if (full) {
        const snap = {
          destino: full.destino, unidade: full.unidade, data_viagem: full.data_viagem,
          hora_saida: full.hora_saida, hora_retorno: full.hora_retorno,
          veiculo_id: full.veiculo_id, motorista_id: full.motorista_id ?? null,
          motorista: full.motorista, departamento: full.departamento,
          data_retorno: full.data_retorno,
          km_inicial: full.km_inicial, km_final: full.km_final,
          adiantamento: full.adiantamento, status: full.status,
          finalidade: full.finalidade, observacoes: full.observacoes,
        };
        notificarUndo({
          titulo: `${nomeViagem(alvo)} excluída.`,
          descricao: `Desfazer recria a viagem com ${pax.length} passageiro(s).`,
          onUndo: async () => {
            const nova = await tfdCriarViagem({
              destino: snap.destino, unidade: snap.unidade, data_viagem: snap.data_viagem,
              hora_saida: snap.hora_saida, hora_retorno: snap.hora_retorno,
              veiculo_id: snap.veiculo_id, motorista_id: snap.motorista_id,
              motorista: snap.motorista, departamento: snap.departamento,
              data_retorno: snap.data_retorno, km_inicial: snap.km_inicial,
              km_final: snap.km_final, adiantamento: snap.adiantamento,
              status: snap.status, finalidade: snap.finalidade,
              observacoes: snap.observacoes,
            });
            for (const q of pax) {
              await tfdAddPassageiro(nova.id, {
                paciente_id: q.paciente_id,
                acompanhante: q.acompanhante,
                acompanhante_id: q.acompanhante_id ?? null,
                acompanhante_cpf: q.acompanhante_cpf ?? "",
                viagem_fila_id: q.viagem_fila_id ?? null,
                tratamento: q.tratamento,
                unidade: q.unidade,
                hora_consulta: q.hora_consulta,
              }).catch(() => null);
            }
            await recarregar();
          },
        });
      } else {
        setOk("Viagem excluída. Passageiros devolvidos à fila de espera.");
      }
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? "Erro ao excluir viagem.";
      setErro(msg);
    }
  }

  const pacFiltrados = buscaPac.trim().length < 2 ? [] : pacientes.filter((p) =>
    `${p.nome} ${p.cpf} ${p.cns}`.toLowerCase().includes(buscaPac.trim().toLowerCase())
  ).slice(0, 10);

  const acompFiltrados = buscaAcomp.trim().length < 2 ? [] : pacientes.filter((p) =>
    `${p.nome} ${p.cpf} ${p.cns}`.toLowerCase().includes(buscaAcomp.trim().toLowerCase())
    && String(p.id) !== String(formFila.paciente_id)
  ).slice(0, 10);

  const destArrasto = destinoArrastado();

  // Fila filtrada p/ exibição (backend já filtra por destino; dia filtra aqui).
  const filaFiltrada = filaAguardando.filter((f) =>
    !filtroDia || (f.data_consulta || "").slice(0, 10) === filtroDia
  );

  // Grupos da fila conforme o modo de visualização.
  const gruposFila: { chave: string; titulo: string; itens: typeof filaFiltrada }[] = (() => {
    const mapa = new Map<string, typeof filaFiltrada>();
    for (const f of filaFiltrada) {
      const chave = agrupFila === "data"
        ? ((f.data_consulta || "").slice(0, 10) || "sem-data")
        : (f.destino || "A definir");
      if (!mapa.has(chave)) mapa.set(chave, []);
      mapa.get(chave)!.push(f);
    }
    const tit = (c: string) =>
      agrupFila === "data" ? (c === "sem-data" ? "Sem data agendada" : fmtDia(c)) : c;
    return [...mapa.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([chave, itens]) => ({ chave, titulo: tit(chave), itens }));
  })();

  function destinosDoDia(d: DiaSemana): DiaDestino[] {
    const mapa = new Map<string, DiaDestino>();
    const termoCidade = buscaDestino.trim().toUpperCase();
    const termoPsf = buscaPsf.trim().toUpperCase();
    for (const x of d.destinos) {
      // Filtro cidade destino na grade (exclui PSF de origem).
      if (termoCidade && !x.destino.toUpperCase().includes(termoCidade)) continue;
      let viagens = x.viagens;
      // Filtro PSF origem na grade: casa Viagem.unidade.
      if (termoPsf) {
        viagens = viagens.filter((v) =>
          (v.unidade || "").toUpperCase().includes(termoPsf),
        );
        if (viagens.length === 0) continue;
      }
      mapa.set(x.destino, { ...x, viagens });
    }
    // Só fila com data marcada p/ este dia gera card; fila contínua usa "+ Criar Nova Viagem".
    for (const f of filaAguardando) {
      if ((f.data_consulta || "").slice(0, 10) !== d.data) continue;
      if (!mapa.has(f.destino)) {
        mapa.set(f.destino, { destino: f.destino, viagens: [], demanda_aguardando: 0 });
      }
    }
    return [...mapa.values()].sort((a, b) => a.destino.localeCompare(b.destino));
  }

  // Alvos touch maiores no mobile (44px).
  const toque = ehMobile ? "min-h-[44px] min-w-[44px] !px-3" : "";

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold text-sus-950">
          <Bus className="h-5 w-5 text-sus-900" /> Quadro de viagens e frota
        </h2>
        <span className="rounded-full bg-teal/10 px-2.5 py-0.5 text-xs font-semibold text-teal">
          {fmtDia(dia)} a {fmtDia(somaDias(dia, (ehMobile ? 1 : qtdDias) - 1))} · {filaAguardando.length} na fila
        </span>
        {!ehMobile && (
          <div className="ml-auto inline-flex items-center gap-1 rounded-xl border border-sus-900/10 bg-white p-1" title="Dias visíveis na grade">
            <span className="px-2 text-[11px] font-bold text-ink/55">Dias:</span>
            {([1, 3, 5, 7] as const).map((n) => (
              <button
                key={n}
                onClick={() => setQtdDias(n)}
                aria-pressed={qtdDias === n}
                className={`min-h-[44px] min-w-[44px] rounded-lg px-3 py-1.5 text-xs font-bold transition ${qtdDias === n ? "bg-sus-900 text-white" : "text-sus-900 hover:bg-sand"}`}
              >
                {n}
              </button>
            ))}
          </div>
        )}
      </div>

      {ehMobile && (() => {
        const diHoje = (new Date(`${dia}T12:00:00`).getDay() + 6) % 7;
        const segunda = somaDias(dia, -diHoje);
        const semanaPills = Array.from({ length: 7 }, (_, i) => somaDias(segunda, i));
        return (
        <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Dias da semana">
          {semanaPills.map((d) => {
            const di = (new Date(`${d}T12:00:00`).getDay() + 6) % 7;
            const ativo = d === dia;
            return (
              <button
                key={d}
                role="tab"
                aria-selected={ativo}
                onClick={() => setDia(d)}
                className={`flex min-h-[44px] min-w-[52px] flex-1 flex-col items-center justify-center rounded-xl px-2 py-1.5 text-xs font-bold transition ${
                  ativo ? "bg-sus-900 text-white" : "bg-white text-sus-900 shadow-sm"
                }`}
              >
                <span className={`text-[10px] uppercase ${ativo ? "text-white/70" : "text-ink/50"}`}>{NOMES_DIA[di]}</span>
                <span>{d.slice(8, 10)}/{d.slice(5, 7)}</span>
              </button>
            );
          })}
        </div>
        );
      })()}

      {/* Navegação semanal (no mobile: dia a dia com Anterior/Próximo acima) */}
      <Card className="mb-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setDia(somaDias(dia, -(ehMobile ? 1 : qtdDias)))} aria-label="Período anterior" className="grid min-h-[44px] min-w-[44px] place-items-center rounded-xl bg-sus-900/10 text-sus-900 hover:bg-sus-900/15" title="Período anterior"><ChevronsLeft className="h-4 w-4" /></button>
          <button onClick={() => setDia(somaDias(dia, -1))} aria-label="Dia anterior" className="grid min-h-[44px] min-w-[44px] place-items-center rounded-xl bg-sus-900/10 text-sus-900 hover:bg-sus-900/15" title="Dia anterior"><ArrowLeft className="h-4 w-4" /></button>
          <Input type="date" value={dia} onChange={(e) => e.target.value && setDia(e.target.value)} className="!w-auto" />
          <button onClick={() => setDia(somaDias(dia, 1))} aria-label="Próximo dia" className="grid min-h-[44px] min-w-[44px] place-items-center rounded-xl bg-sus-900/10 text-sus-900 hover:bg-sus-900/15" title="Próximo dia"><ArrowRight className="h-4 w-4" /></button>
          <button onClick={() => setDia(somaDias(dia, (ehMobile ? 1 : qtdDias)))} aria-label="Próximo período" className="grid min-h-[44px] min-w-[44px] place-items-center rounded-xl bg-sus-900/10 text-sus-900 hover:bg-sus-900/15" title="Próximo período"><ChevronsRight className="h-4 w-4" /></button>
          <button onClick={() => setDia(hojeISO())} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-teal px-3 py-2 text-xs font-bold text-white hover:brightness-110">
            <CalendarDays className="h-4 w-4" /> Hoje
          </button>
        </div>
      </Card>

      {erro && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
      {ok && <p className="mb-3 rounded-xl bg-teal/10 px-3 py-2 text-sm text-teal">{ok}</p>}

      <div className="space-y-3">
        {/* Grade semanal primeiro; fila de espera embaixo */}
        {/* Grade semanal: N dias lado a lado (padrão 5 no desktop; 1 no mobile) */}
        <section className="overflow-x-auto pb-2">
          <div
            className={
              ehMobile
                ? "grid grid-cols-1 gap-2"
                : `grid gap-2 ${qtdDias >= 6 ? "min-w-[980px] min-[1400px]:min-w-0" : "min-w-0"}`
            }
            style={ehMobile ? undefined : { gridTemplateColumns: `repeat(${qtdDias}, minmax(0, 1fr))` }}
          >
            {(ehMobile ? [dia] : diasSemana).map((data) => {
              const di = (new Date(`${data}T12:00:00`).getDay() + 6) % 7;
              const diaInfo = semana.find((d) => d.data === data);
              const colunas = diaInfo ? destinosDoDia(diaInfo) : [];
              const temViagem = colunas.some((c) => c.viagens.length > 0);
              const recebendoViagem = !!viagemArrastada() && viagemArrastada()?.origem !== data;
              return (
                <div
                  key={data}
                  onDragOver={(e) => { if (viagemArrastada() && podeGerirFrota && (data >= hoje || podeEditarPassadas)) e.preventDefault(); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (data < hoje && !podeEditarPassadas) {
                      setErro(PASSADA_MSG);
                      return;
                    }
                    soltarViagem(data, e.dataTransfer.getData("text/viagem"));
                  }}
                  className={`rounded-2xl border p-2.5 ${data === hojeISO() ? "border-teal bg-teal/5" : "border-sus-900/10 bg-white"} ${recebendoViagem ? "ring-2 ring-teal/50" : ""}`}
                >
                  {/* Topo do dia com data e botão de Nova Viagem alinhado à direita */}
                  <div className="mb-2.5 flex items-center justify-between gap-1 border-b border-sus-900/10 pb-1.5">
                    <div className="min-w-0">
                      <span className="block text-[11px] font-bold uppercase tracking-wider text-ink/60 leading-none">
                        {NOMES_DIA[di]}
                      </span>
                      <span className="font-display text-sm font-extrabold text-sus-950 leading-tight">
                        {data.slice(8, 10)}/{data.slice(5, 7)}
                      </span>
                    </div>
                    {podeGerirFrota && (data >= hoje || podeEditarPassadas) && (
                      <button
                        type="button"
                        onClick={() => {
                          if (alocandoEm === `nova:${data}`) {
                            setAlocandoEm(null);
                          } else {
                            setAlocandoEm(`nova:${data}`);
                            setNovoDestino("");
                            setNovoVeiculo({
                              veiculo_id: "",
                              motorista: "",
                              motorista_id: "",
                              hora: "05:00",
                              retorno: retornoAutomatico("05:00"),
                            });
                          }
                        }}
                        className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-bold transition shrink-0 ${
                          alocandoEm === `nova:${data}`
                            ? "border-teal bg-teal text-white shadow-sm"
                            : "border-teal/30 bg-teal/5 text-teal hover:border-teal hover:bg-teal hover:text-white"
                        }`}
                        title={`Criar nova viagem para ${data.slice(8, 10)}/${data.slice(5, 7)}`}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>Viagem</span>
                      </button>
                    )}
                  </div>

                  {/* Formulário de criação de nova viagem neste dia */}
                  {podeGerirFrota && (data >= hoje || podeEditarPassadas) && alocandoEm === `nova:${data}` && (
                    <div className="mb-2.5 rounded-xl border border-teal/40 bg-white p-2.5 text-xs shadow-sm">
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="font-bold text-teal text-xs">Nova Viagem ({data.slice(8, 10)}/{data.slice(5, 7)})</span>
                        <button
                          type="button"
                          onClick={() => setAlocandoEm(null)}
                          className="rounded p-0.5 text-ink/50 hover:bg-sand/60 hover:text-ink"
                          title="Fechar formulário"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <Label>Cidade de destino *</Label>
                      <select
                        value={destinos.some((d) => d.nome_destino === novoDestino) ? novoDestino : ""}
                        onChange={(e) => setNovoDestino(e.target.value.toUpperCase())}
                        className="w-full rounded-lg border border-sus-900/15 bg-white px-2.5 py-2 text-xs"
                      >
                        <option value="">Selecionar destino cadastrado…</option>
                        {destinos.filter((d) => d.ativo).map((d) => (
                          <option key={d.id} value={d.nome_destino}>
                            {d.nome_destino}{d.hospital_referencia ? ` · ${d.hospital_referencia}` : ""}
                          </option>
                        ))}
                      </select>
                      {!destinos.some((d) => d.nome_destino === novoDestino) && novoDestino && (
                        <p className="mt-1 text-[11px] text-ink/60">Destino atual: <b>{novoDestino}</b> (fora da tabela cadastrada).</p>
                      )}
                      <div className="mt-1.5">
                        <Label>Veículo</Label>
                        <select
                          value={novoVeiculo.veiculo_id}
                          onChange={(e) => setNovoVeiculo({ ...novoVeiculo, veiculo_id: e.target.value })}
                          className="w-full rounded-lg border border-sus-900/15 bg-white px-2.5 py-2 text-xs"
                        >
                          <option value="">A definir carro</option>
                          {veiculosLivresCriacao.filter((f) => f.status === "disponivel").map((f) => (
                            <option key={f.id} value={f.id}>{f.placa} ({f.capacidade}){f.em_outra_viagem ? " · em outra viagem" : ""}</option>
                          ))}
                        </select>
                        {dispCriacao && (
                          <p className="mt-1 text-[11px] text-ink/60">
                            {veiculosLivresCriacao.length} veículo(s) livre(s) na janela
                            {novoVeiculo.hora ? ` ${novoVeiculo.hora}→${novoVeiculo.retorno || retornoAutomatico(novoVeiculo.hora)}` : ""}.
                          </p>
                        )}
                      </div>
                      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                        <div>
                          <Label>Motorista</Label>
                          <CampoMotorista
                            motoristas={motoristasLivresCriacao}
                            motoristaId={novoVeiculo.motorista_id}
                            motoristaNome={novoVeiculo.motorista}
                            onMudar={(id, nome) => setNovoVeiculo({ ...novoVeiculo, motorista_id: id, motorista: nome })}
                          />
                        </div>
                        <div>
                          <Label>Saída</Label>
                          <Input
                            type="time"
                            value={novoVeiculo.hora}
                            onChange={(e) => {
                              const h = e.target.value;
                              setNovoVeiculo({ ...novoVeiculo, hora: h, retorno: novoVeiculo.retorno || retornoAutomatico(h) });
                            }}
                            className="!py-2 text-xs"
                          />
                        </div>
                      </div>
                      <div className="mt-1.5">
                        <Label>Retorno (auto +9h, editável)</Label>
                        <Input
                          type="time"
                          value={novoVeiculo.retorno}
                          onChange={(e) => setNovoVeiculo({ ...novoVeiculo, retorno: e.target.value })}
                          placeholder={retornoAutomatico(novoVeiculo.hora || "05:00")}
                          className="!py-2 text-xs"
                        />
                      </div>
                      <div className="mt-2 flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => criarViagemDestino(data, novoDestino.trim().toUpperCase())}
                          className="flex-1 rounded-lg bg-teal px-3 py-2 text-xs font-bold text-white hover:brightness-110"
                        >
                          Confirmar
                        </button>
                        <button
                          type="button"
                          onClick={() => setAlocandoEm(null)}
                          className="rounded-lg border border-sus-900/15 px-3 py-2 text-xs font-semibold"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}

                  {!temViagem && alocandoEm !== `nova:${data}` && (
                    <div className="py-3 text-center">
                      <p className="text-xs font-medium text-ink/40">Sem viagens</p>
                    </div>
                  )}
                  {colunas.map((dd) => (
                    <div key={dd.destino} className="mb-2.5 rounded-xl bg-sand/50 p-2.5">
                      <div className="mb-1.5 flex items-center gap-1.5">
                        <p className="truncate text-xs font-extrabold text-sus-950">{dd.destino}</p>
                        {podeGerirFrota && (data >= hoje || podeEditarPassadas) && (
                          <button onClick={() => sugerir(data, dd.destino)} className="ml-auto rounded-lg bg-teal/10 p-1.5 text-teal hover:bg-teal/20" title="Sugerir veículo">
                            <Sparkles className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                      {sugestao[`${data}|${dd.destino}`] && (
                        <p className="mb-1.5 rounded-lg bg-teal/10 px-2.5 py-1 text-xs font-semibold text-teal">{sugestao[`${data}|${dd.destino}`]}</p>
                      )}
                      {dd.viagens.map((v) => {
                        const chave = `${v.id}`;
                        const bloqueado = !!destArrasto && !destinoCompativel(destArrasto, v.destino);
                        const arrastViag = arrastando?.startsWith("viag:") ?? false;
                        return (
                          <div
                            key={chave}
                            draggable={podeGerirFrota && (data >= hoje || podeEditarPassadas)}
                            onDragStart={(e) => {
                              if (data < hoje && !podeEditarPassadas) {
                                e.preventDefault();
                                setErro(PASSADA_MSG);
                                return;
                              }
                              if (podeGerirFrota) dragViagem(e, v, data);
                            }}
                            onDragEnd={() => setArrastando(null)}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              e.preventDefault();
                              const tv = e.dataTransfer.getData("text/viagem");
                              if (tv) {
                                e.stopPropagation();
                                if (data < hoje && !podeEditarPassadas) {
                                  setErro(PASSADA_MSG);
                                  return;
                                }
                                soltarViagem(data, tv);
                                return;
                              }
                              if (!podeEditar) { setArrastando(null); return; }
                              const f = e.dataTransfer.getData("text/fila");
                              if (f) {
                                if (data < hoje && !podeEditarPassadas) {
                                  setErro(PASSADA_MSG);
                                  setArrastando(null);
                                  return;
                                }
                                if (v.veiculo_id && v.vagas <= 0) { setErro(`Veículo ${v.veiculo_placa || ""} lotado.`); setArrastando(null); return; }
                                alocar(Number(f), v.id, v.destino);
                                return;
                              }
                              const d = e.dataTransfer.getData("text/pass");
                              if (d) {
                                if (data < hoje && !podeEditarPassadas) {
                                  setErro(PASSADA_MSG);
                                  setArrastando(null);
                                  return;
                                }
                                const [vid, pid] = d.split(":").map(Number);
                                mover(vid, pid, v.id, v.destino);
                              }
                            }}
                            className={`mb-2 rounded-xl border bg-white p-2.5 ${bloqueado ? "border-red-400 ring-1 ring-red-300" : arrastando ? "border-dashed border-teal" : "border-sus-900/15"} ${podeGerirFrota ? "cursor-grab active:cursor-grabbing" : ""} ${arrastViag && arrastando === `viag:${v.id}:${data}` ? "opacity-50" : ""}`}
                            title={bloqueado && destArrasto ? msgDestino(destArrasto) : nomeViagem(v)}
                          >
                            <p className="truncate text-xs font-extrabold text-sus-950" title={v.nome || nomeViagem(v)}>
                              {v.nome || nomeViagem(v)}
                            </p>
                            <div className="mt-1 flex items-center gap-1.5 text-xs">
                              <p className="truncate rounded bg-sus-900/10 px-2 py-0.5 font-display font-bold text-sus-900" title={v.veiculo_id ? (v.veiculo_placa ? `${v.veiculo_modelo || "Veículo"} · placa ${v.veiculo_placa}` : (v.veiculo_modelo || "Veículo")) : "Viagem sem veículo — A definir carro"}>{v.veiculo_id ? (v.veiculo_modelo || "Veículo") : "A definir carro"}</p>
                              <span className="ml-auto shrink-0 font-extrabold text-xs" title={v.veiculo_placa ? `Placa ${v.veiculo_placa}` : "Sem veículo"}>{v.ocupados}/{v.capacidade || "—"}</span>
                            </div>
                            {v.veiculo_placa && v.veiculo_modelo && (
                              <p className="mt-0.5 truncate text-[11px] font-medium text-ink/60" title={`Placa ${v.veiculo_placa}`}>Placa {v.veiculo_placa}</p>
                            )}
                            {!v.veiculo_id && v.passageiros.length > 0 && (
                              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                <p className="w-full truncate text-xs font-bold text-amber-700" title={`${v.passageiros.length} passageiro(s) sem veículo`}>
                                  Sem veículo · {v.passageiros.length} passageiro(s)
                                </p>
                                {podeGerirFrota && (
                                  <button onClick={() => sugerir(v.data_viagem, v.destino, v.id)} className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-900 hover:bg-amber-200" title={`Sugerir veículo p/ ${v.ocupados} assento(s) ocupado(s)`}>
                                    <Sparkles className="h-3.5 w-3.5" /> Sugerir veículo
                                  </button>
                                )}
                              </div>
                            )}
                            {sugestao[`viag:${v.id}`] && (
                              <p className="mt-1 rounded-lg bg-teal/10 px-2.5 py-1 text-xs font-semibold text-teal">{sugestao[`viag:${v.id}`]}</p>
                            )}
                            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sus-900/10">
                              <div
                                className={`h-full rounded-full ${v.capacidade && v.ocupados >= v.capacidade ? "bg-red-500" : v.capacidade && v.ocupados >= v.capacidade * 0.75 ? "bg-amber-500" : "bg-teal"}`}
                                style={{ width: v.capacidade ? `${Math.min(100, (v.ocupados / v.capacidade) * 100)}%` : "0%" }}
                              />
                            </div>
                            {v.capacidade > 0 && v.ocupados >= v.capacidade && (
                              <p className="mt-1 text-xs font-bold text-red-600">Lotado</p>
                            )}
                            {bloqueado && destArrasto && (
                              <p className="mt-1 text-xs font-bold text-red-600">Destino diferente</p>
                            )}
                            <p className="mt-1 truncate text-[11px] font-medium text-ink/70">{v.motorista || "Motorista a definir"}{v.hora_saida ? ` · ${v.hora_saida}→${v.hora_retorno || retornoAutomatico(v.hora_saida)}` : ""}</p>
                            {podeVerPacientes ? (
                            <div className="mt-1.5 space-y-1">
                              {v.passageiros.map((p) => {
                                const acomp = (p.acompanhante_nome || p.acompanhante || "").trim();
                                return (
                                <div
                                  key={p.id}
                                  draggable={podeEditar && (data >= hoje || podeEditarPassadas)}
                                  onDragStart={(e) => {
                                    if (data < hoje && !podeEditarPassadas) {
                                      e.preventDefault();
                                      setErro(PASSADA_MSG);
                                      return;
                                    }
                                    dragPass(e, v.id, p.id);
                                  }}
                                  onDragEnd={() => setArrastando(null)}
                                  className="flex items-center gap-1.5 rounded-lg bg-sand/80 px-2 py-1.5 text-xs"
                                >
                                  <span className="min-w-0 flex-1 truncate font-semibold text-sus-950" title={acomp ? `${p.paciente_nome} + ${acomp} (Acompanhante de ${p.paciente_nome})` : p.paciente_nome}>
                                    <span className="inline-flex items-center gap-1.5 max-w-full">
                                      <span className="truncate">{p.paciente_nome}</span>
                                      {p.prioridade ? (
                                        <span className={`shrink-0 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold leading-none ${p.prioridade === "urgente" ? "bg-red-100 text-red-700" : "bg-sus-900/10 text-sus-900"}`}>
                                          {rotuloPrioridade(p.prioridade)}
                                        </span>
                                      ) : null}
                                    </span>
                                    {acomp && <span className="block truncate text-[11px] font-normal text-ink/60">{acomp} (Acompanhante de {p.paciente_nome})</span>}
                                  </span>
                                  {acomp && <span className="shrink-0 rounded-full bg-teal/15 px-1.5 text-[10px] font-bold text-teal" title={acomp}>+1</span>}
                                  {podeEditar && (data >= hoje || podeEditarPassadas) && (
                                    <button onClick={() => devolver(v.id, p.id)} className="ml-auto rounded p-1 text-ink/40 hover:bg-red-50 hover:text-red-600" title="Devolver à fila"><X className="h-3.5 w-3.5" /></button>
                                  )}
                                </div>
                                );
                              })}
                            </div>
                            ) : (
                            <p className="mt-1.5 rounded-lg bg-sand/70 px-2 py-1 text-xs text-ink/65">
                              {v.ocupados} passageiro(s) · detalhe restrito ao TFD
                            </p>
                            )}
                            <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-sus-900/5 pt-1.5">
                              {selFila && (!v.veiculo_id || v.vagas > 0) && podeEditar && (data >= hoje || podeEditarPassadas) && (
                                <button onClick={() => alocar(selFila, v.id, v.destino)} className="inline-flex min-h-[32px] items-center gap-1 rounded-lg bg-teal px-2 py-1 text-xs font-bold text-white hover:brightness-110" title={v.veiculo_id ? "Alocar paciente selecionado" : "Alocar paciente (viagem sem veículo)"}>
                                  <UserPlus className="h-3.5 w-3.5" />
                                </button>
                              )}
                              {podeVerPacientes && (
                                <>
                                  <button onClick={() => setVisualizarOrdem(v)} className="inline-flex min-h-[32px] items-center gap-1 rounded-lg bg-sus-900/10 px-2 py-1 text-xs font-bold text-sus-900 hover:bg-sus-900/15" title="Visualizar / Imprimir Ordem de Viagem">
                                    <Printer className="h-3.5 w-3.5" />
                                  </button>
                                  <button onClick={() => baixarDocx(v)} className="inline-flex min-h-[32px] items-center gap-1 rounded-lg bg-sus-900/10 px-2 py-1 text-xs font-bold text-sus-900 hover:bg-sus-900/15" title="Baixar Ordem de Circulação (.docx)">
                                    <FileDown className="h-3.5 w-3.5" />
                                  </button>
                                </>
                              )}
                              {podeFaturar && (
                                <button onClick={() => faturar(v)} className="inline-flex min-h-[32px] items-center gap-1 rounded-lg bg-teal/10 px-2 py-1 text-xs font-bold text-teal hover:bg-teal/20" title="Gerar faturamento de deslocamento SIGTAP">
                                  <ReceiptText className="h-3.5 w-3.5" />
                                </button>
                              )}
                              {podeEditar && (data >= hoje || podeEditarPassadas) && (
                                <button onClick={() => abrirEditarViagem(v)} className="inline-flex min-h-[32px] items-center gap-1 rounded-lg bg-sus-900/10 px-2 py-1 text-xs font-bold text-sus-900 hover:bg-sus-900/15" title="Editar viagem (data, horário, motorista, observações)">
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                              )}
                              {podeGerirFrota && (data >= hoje || podeEditarPassadas) && (
                                <>
                                  <button onClick={() => abrirTrocaVeiculo(v)} className="inline-flex min-h-[32px] items-center gap-1 rounded-lg bg-sus-900/10 px-2 py-1 text-xs font-bold text-sus-900 hover:bg-sus-900/15" title="Trocar veículo/motorista">
                                    <Bus className="h-3.5 w-3.5" />
                                  </button>
                                </>
                              )}
                              {podeEditar && (data >= hoje || podeEditarPassadas) && (
                                  <button onClick={() => setExcluirViagem(v)} className="inline-flex min-h-[32px] items-center gap-1 rounded-lg bg-red-50 px-2 py-1 text-xs font-bold text-red-600 hover:bg-red-100 ml-auto" title="Excluir viagem (passageiros voltam à fila)">
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                                            {podeGerirFrota && (data >= hoje || podeEditarPassadas) && (
                        alocandoEm === `${data}|${dd.destino}` ? (
                          <div className="rounded-xl border border-teal/40 bg-white p-2.5 text-xs">
                            <Label>Veículo</Label>
                            <select value={novoVeiculo.veiculo_id} onChange={(e) => setNovoVeiculo({ ...novoVeiculo, veiculo_id: e.target.value })} className="w-full rounded-lg border border-sus-900/15 bg-white px-2.5 py-2 text-xs">
                              <option value="">A definir carro</option>
                              {veiculosLivresCriacao.filter((f) => f.status === "disponivel").map((f) => (
                                <option key={f.id} value={f.id}>{f.placa} ({f.capacidade}){f.em_outra_viagem ? " · em outra viagem" : ""}</option>
                              ))}
                            </select>
                            {dispCriacao && (
                              <p className="mt-1 text-[11px] text-ink/60">
                                {veiculosLivresCriacao.length} veículo(s) livre(s) na janela
                                {novoVeiculo.hora ? ` ${novoVeiculo.hora}→${novoVeiculo.retorno || retornoAutomatico(novoVeiculo.hora)}` : ""}.
                              </p>
                            )}
                            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                              <div><Label>Motorista</Label><CampoMotorista motoristas={motoristasLivresCriacao} motoristaId={novoVeiculo.motorista_id} motoristaNome={novoVeiculo.motorista} onMudar={(id, nome) => setNovoVeiculo({ ...novoVeiculo, motorista_id: id, motorista: nome })} /></div>
                              <div><Label>Saída</Label><Input type="time" value={novoVeiculo.hora} onChange={(e) => { const h = e.target.value; setNovoVeiculo({ ...novoVeiculo, hora: h, retorno: novoVeiculo.retorno || retornoAutomatico(h) }); }} className="!py-2 text-xs" /></div>
                            </div>
                            <div className="mt-1.5"><Label>Retorno (auto +9h, editável)</Label><Input type="time" value={novoVeiculo.retorno} onChange={(e) => setNovoVeiculo({ ...novoVeiculo, retorno: e.target.value })} placeholder={retornoAutomatico(novoVeiculo.hora || "05:00")} className="!py-2 text-xs" /></div>
                            <div className="mt-2 flex gap-1.5">
                              <button onClick={() => criarViagemDestino(data, dd.destino)} className="flex-1 rounded-lg bg-teal px-3 py-2 text-xs font-bold text-white hover:brightness-110">Confirmar</button>
                              <button onClick={() => setAlocandoEm(null)} className="rounded-lg border border-sus-900/15 px-3 py-2 text-xs font-semibold">Cancelar</button>
                            </div>
                          </div>
                        ) : (
                          <button onClick={() => { setAlocandoEm(`${data}|${dd.destino}`); setNovoVeiculo({ veiculo_id: "", motorista: "", motorista_id: "", hora: "05:00", retorno: retornoAutomatico("05:00") }); }} className="w-full rounded-xl border border-dashed border-sus-900/25 px-2 py-2 text-xs font-bold text-sus-900/70 hover:border-teal hover:text-teal">
                            + Veículo
                          </button>
                        )
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </section>

        {/* Fila de espera — painel inferior (restrito: só TFD vê PII) */}
        {!podeVerPacientes && (
          <p className="rounded-2xl border border-sus-900/10 bg-white p-4 text-xs text-ink/55">
            Quadro em modo gestão de frota: veículos e motoristas liberados; pacientes e fila de espera ocultos para este perfil.
          </p>
        )}
        {podeVerPacientes && (
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
            <p className="font-display text-sm font-bold text-sus-950">Fila de espera ({filaFiltrada.length})</p>
            <Input
              type="date"
              value={filtroDia}
              onChange={(e) => setFiltroDia(e.target.value)}
              className="!w-auto !py-2 text-xs"
              title="Filtrar por dia específico"
            />
            <Input value={buscaDestino} onChange={(e) => setBuscaDestino(e.target.value.toUpperCase())} placeholder="Cidade destino…" title="Filtrar por cidade de destino" className="!w-44 !py-2 text-xs" />
            <Input value={buscaPsf} onChange={(e) => setBuscaPsf(e.target.value.toUpperCase())} placeholder="PSF origem…" title="Filtrar por PSF de origem" className="!w-44 !py-2 text-xs" />
            {(filtroDia || buscaDestino.trim() || buscaPsf.trim()) && (
              <button
                onClick={() => { setFiltroDia(""); setBuscaDestino(""); setBuscaPsf(""); }}
                className="rounded-xl border border-sus-900/15 px-3 py-2 text-xs font-bold text-sus-900 hover:bg-sand"
                title="Limpar filtros da fila"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            <div className="inline-flex items-center gap-1 rounded-xl border border-sus-900/10 bg-sand/50 p-1" title="Modo de visualização da fila">
              <span className="px-2 text-[11px] font-bold text-ink/55">Agrupar fila por:</span>
              {(["destino", "data"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setAgrupFila(m)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${agrupFila === m ? "bg-sus-900 text-white" : "text-sus-900 hover:bg-white"}`}
                >
                  {m === "destino" ? "Cidade/Destino" : "Dia/Data"}
                </button>
              ))}
            </div>
            {podeEditar && (
              <button onClick={abrirPuxar} disabled={candLoading} className="rounded-xl bg-sus-900/10 px-3 py-2 text-xs font-bold text-sus-900 hover:bg-sus-900/15 disabled:opacity-50">
                {candLoading ? "Buscando…" : "Puxar agendados para a fila"}
              </button>
            )}
            {podeEditar && (
              <button onClick={() => abrirFilaModal()} className="ml-auto rounded-lg bg-teal p-2 text-white hover:brightness-110" title="Novo na fila"><Plus className="h-4 w-4" /></button>
            )}
          </div>
          {(filtroDia || buscaDestino.trim() || buscaPsf.trim()) && (
            <p className="mb-2 text-xs text-ink/55">
              Fila filtrada{filtroDia ? ` · dia ${fmtDia(filtroDia)}` : ""}{buscaDestino.trim() ? ` · cidade “${buscaDestino.trim()}”` : ""}{buscaPsf.trim() ? ` · PSF “${buscaPsf.trim()}”` : ""} — salva no seu perfil.
            </p>
          )}
          <div className="max-h-[42vh] space-y-3 overflow-y-auto pr-1">
            {gruposFila.map((g) => (
              <div key={g.chave}>
                <p className="mb-1.5 flex items-center gap-2 text-xs font-extrabold uppercase tracking-wide text-sus-900/70">
                  <span className="rounded-lg bg-sus-900/10 px-2.5 py-1">{g.titulo}</span>
                  <span className="font-semibold normal-case text-ink/45">{g.itens.length} paciente(s)</span>
                </p>
                <div className="grid gap-1.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                  {g.itens.map((f) => (
              <div
                key={f.id}
                draggable={podeEditar}
                onDragStart={(e) => dragFila(e, f.id)}
                onDragEnd={() => setArrastando(null)}
                onClick={() => setSelFila(selFila === f.id ? null : f.id)}
                className={`min-w-0 cursor-pointer rounded-lg border p-1.5 text-[11px] leading-tight ${selFila === f.id ? "border-teal bg-teal/5 ring-1 ring-teal" : "border-sus-900/10 bg-sand/50 hover:border-teal/40"}`}
              >
                <div className="flex items-center gap-1 min-w-0">
                  <span className="truncate font-bold text-sus-950">{f.paciente_nome}</span>
                  <span className={`shrink-0 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold leading-none ${f.prioridade === "urgente" ? "bg-red-100 text-red-700" : "bg-sus-900/10 text-sus-900"}`}>
                    {rotuloPrioridade(f.prioridade)}
                  </span>
                </div>
                <p className="truncate text-ink/55">Nasc. {fmtNasc(f.paciente_nascimento)} · {f.paciente_cpf || "sem CPF"}</p>
                <p className="truncate font-semibold text-sus-900">{f.destino}</p>
                <p className="truncate text-ink/55">{f.unidade || "—"}{f.hora_consulta ? ` · ${f.hora_consulta}` : ""}</p>
                {f.acompanhante && (
                  <p className="mt-1 flex flex-wrap gap-1">
                    <span className="rounded-full bg-teal/15 px-1.5 py-px font-semibold text-teal" title={f.acompanhante_nome || f.acompanhante_cpf || "com acompanhante"}>c/ acomp.{f.acompanhante_nome ? ` · ${f.acompanhante_nome}` : ""}</span>
                  </p>
                )}
                {podeEditar && (
                  <div className="mt-1 flex gap-1">
                    <button onClick={(ev) => { ev.stopPropagation(); abrirFilaModal(f); }} className="rounded-md p-1 text-sus-800 hover:bg-sus-100" title="Editar"><Pencil className="h-3 w-3" /></button>
                    <button onClick={async (ev) => { ev.stopPropagation(); if (confirm("Excluir da fila de viagem?")) { await tfdExcluirFilaViagem(f.id); recarregar(); } }} className="rounded-md p-1 text-red-600 hover:bg-red-50" title="Excluir"><Trash2 className="h-3 w-3" /></button>
                  </div>
                )}
              </div>
            ))}
                </div>
              </div>
            ))}
            {gruposFila.length === 0 && <p className="py-6 text-center text-xs text-ink/45">Fila vazia. Arraste passageiros de volta para cá.</p>}
          </div>
        </section>
        )}
      </div>

      {puxarAberto && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4" onClick={() => setPuxarAberto(false)}>
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 pb-3">
              <div>
                <p className="font-display text-base font-bold text-sus-950">Puxar agendados para a fila</p>
                <p className="mt-0.5 text-xs text-ink/55">
                  {candidatos.length} agendado(s) fora da fila. Desmarque quem <b>não</b> precisa de transporte.
                </p>
              </div>
              <button onClick={() => setPuxarAberto(false)} className="rounded-lg p-2 text-ink/50 hover:bg-sand" aria-label="Fechar"><X className="h-4 w-4" /></button>
            </div>
            <div className="flex gap-2 px-6 pb-2">
              <button
                onClick={() => setSelCand(new Set(candidatos.map((c) => c.exame_fila_id)))}
                className="rounded-xl bg-sus-900/10 px-3 py-1.5 text-xs font-bold text-sus-900 hover:bg-sus-900/15"
              >
                Marcar todos
              </button>
              <button
                onClick={() => setSelCand(new Set())}
                className="rounded-xl border border-sus-900/15 px-3 py-1.5 text-xs font-bold text-sus-900 hover:bg-sand"
              >
                Desmarcar todos
              </button>
              <span className="ml-auto self-center text-xs font-semibold text-teal">{selCand.size} selecionado(s)</span>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto px-6 py-2">
              {candidatos.map((c) => {
                const marcado = selCand.has(c.exame_fila_id);
                return (
                  <label
                    key={c.exame_fila_id}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-xs transition ${marcado ? "border-teal bg-teal/5" : "border-sus-900/10 bg-sand/40 opacity-70"}`}
                  >
                    <input
                      type="checkbox"
                      checked={marcado}
                      onChange={() => setSelCand((s) => {
                        const n = new Set(s);
                        if (n.has(c.exame_fila_id)) n.delete(c.exame_fila_id);
                        else n.add(c.exame_fila_id);
                        return n;
                      })}
                      className="mt-0.5 h-4 w-4 accent-teal"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="truncate font-bold text-sus-950">{c.paciente_nome}</span>
                        <span className={`shrink-0 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold leading-none ${c.prioridade === "urgente" ? "bg-red-100 text-red-700" : "bg-sus-900/10 text-sus-900"}`}>
                          {rotuloPrioridade(c.prioridade)}
                        </span>
                      </div>
                      <p className="truncate text-ink/70">{c.exame}</p>
                      <p className="mt-0.5 text-ink/55">
                        {c.destino}{c.data_agendada ? ` · ${fmtDia(c.data_agendada)}` : ""}{c.hora_agendada ? ` ${c.hora_agendada}` : ""}
                      </p>
                    </div>
                  </label>
                );
              })}
              {candidatos.length === 0 && (
                <p className="py-8 text-center text-xs text-ink/45">Nenhum agendado fora da fila. Nada a puxar.</p>
              )}
            </div>
            <div className="flex gap-2 border-t border-sus-900/10 p-4">
              <Button onClick={confirmarPuxar} disabled={candidatos.length === 0} className="flex-1">
                <Plus className="h-4 w-4" /> Adicionar {selCand.size} à fila
              </Button>
              <button onClick={() => setPuxarAberto(false)} className="rounded-xl border border-sus-900/15 px-4 py-2.5 text-sm font-bold text-sus-900 hover:bg-sand">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {reagendar && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4" onClick={() => setReagendar(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl bg-white p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <p className="font-display text-base font-bold text-sus-950">Confirmar reagendamento</p>
              <button onClick={() => setReagendar(null)} className="rounded-lg p-2 text-ink/50 hover:bg-sand" aria-label="Fechar"><X className="h-4 w-4" /></button>
            </div>
            <div className="rounded-2xl bg-sand/60 p-4 text-sm">
              <p className="font-bold text-sus-950">{reagendar.nome}</p>
              <p className="mt-1 text-ink/70">
                De <b>{fmtDia(reagendar.origem)}</b> para <b>{fmtDia(reagendar.destino)}</b>
                {reagendar.hora_saida ? ` · saída ${reagendar.hora_saida}${reagendar.hora_retorno ? ` → ${reagendar.hora_retorno}` : ""}` : ""}
              </p>
              <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
                {reagendar.passageiros} passageiro(s) vinculado(s) serão reagendados junto.
              </p>
              {(reagendar.conflitoVeiculo || reagendar.conflitoMotorista) && (
                <div className="mt-2 space-y-1 rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                  <p>Conflito no novo dia/horário:</p>
                  {reagendar.conflitoVeiculo && <p>· Veículo ocupado ({reagendar.conflitoVeiculo}) — será definido como <b>A definir</b>.</p>}
                  {reagendar.conflitoMotorista && <p>· Motorista ocupado ({reagendar.conflitoMotorista}) — será definido como <b>A definir</b>.</p>}
                </div>
              )}
            </div>
            {erro && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
            <div className="mt-4 flex gap-2">
              <Button onClick={confirmarReagendar} disabled={reagendando} className="flex-1">
                {reagendando ? "Reagendando…" : "Confirmar reagendamento"}
              </Button>
              <button onClick={() => setReagendar(null)} className="rounded-xl border border-sus-900/15 px-4 py-2.5 text-sm font-bold text-sus-900 hover:bg-sand">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

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
                <Input value={buscaPac} onChange={(e) => { setBuscaPac(e.target.value); setFormFila({ ...formFila, paciente_id: "" }); }} placeholder="Buscar nome/CPF/CNS…" />
                {pacFiltrados.length > 0 && !formFila.paciente_id && (
                  <div className="mt-1 max-h-36 overflow-y-auto rounded-xl border border-sus-900/10">
                    {pacFiltrados.map((p) => (
                      <button key={p.id} onClick={() => { setFormFila({ ...formFila, paciente_id: String(p.id) }); setBuscaPac(p.nome); }} className="block w-full px-3 py-2 text-left text-sm hover:bg-sand">
                        <b>{p.nome}</b> <span className="text-xs text-ink/50">{p.cpf || "sem CPF"}{p.nascimento ? ` · Nasc. ${fmtNasc(p.nascimento)}` : ""}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div><Label>Cidade de destino *</Label><Input value={formFila.destino} onChange={(e) => setFormFila({ ...formFila, destino: e.target.value.toUpperCase() })} placeholder="Ex: BELO HORIZONTE" /></div>
              <div><Label>Unidade / hospital</Label><Input value={formFila.unidade} onChange={(e) => setFormFila({ ...formFila, unidade: e.target.value })} /></div>
              <div className="md:col-span-2"><Label>Tratamento / exame</Label><Input value={formFila.tratamento} onChange={(e) => setFormFila({ ...formFila, tratamento: e.target.value })} /></div>
              <div className="md:col-span-2">
                <button
                  type="button"
                  onClick={() => setFormFila({ ...formFila, agendar: !formFila.agendar })}
                  aria-expanded={formFila.agendar}
                  className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition ${formFila.agendar ? "border-teal bg-teal/5" : "border-sus-900/15 bg-sand/40 hover:border-teal/50"}`}
                >
                  <span>
                    <span className="block text-[11px] font-bold uppercase tracking-wide text-sus-900/55">Agendamento</span>
                    <span className="block text-xs text-ink/55">{formFila.agendar ? "Etapa 2 expandida: data e horário da consulta." : "Etapa 2: expandir para marcar data e horário."}</span>
                  </span>
                  <span className={`rounded-full px-3 py-1.5 text-xs font-bold ${formFila.agendar ? "bg-teal text-white" : "bg-sus-900/10 text-sus-900"}`}>
                    {formFila.agendar ? "Ocultar" : "Agendar Atendimento"}
                  </span>
                </button>
              </div>
              {formFila.agendar && (
              <>
              <div><Label>Data da consulta *</Label><Input type="date" value={formFila.data_consulta} onChange={(e) => setFormFila({ ...formFila, data_consulta: e.target.value })} /></div>
              <div><Label>Horário da consulta</Label><Input type="time" value={formFila.hora_consulta} onChange={(e) => setFormFila({ ...formFila, hora_consulta: e.target.value })} /></div>
              </>
              )}
              <div>
                <Label>Risco / prioridade</Label>
                <select value={formFila.prioridade} onChange={(e) => setFormFila({ ...formFila, prioridade: e.target.value })} className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
                  {PRIOS.map((p) => <option key={p.value} value={p.value}>{p.rotulo}</option>)}
                </select>
              </div>
              <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={formFila.acompanhante} onChange={(e) => { const v = e.target.checked; setFormFila({ ...formFila, acompanhante: v, ...(v ? {} : { acompanhante_id: "", acompanhante_nome: "", acompanhante_cpf: "" }) }); if (!v) setBuscaAcomp(""); }} className="h-4 w-4 accent-teal" /> Com acompanhante</label>
              {formFila.acompanhante && (
                <div className="grid gap-3 rounded-2xl border border-teal/30 bg-teal/5 p-3 md:col-span-2">
                  <div className="md:col-span-2">
                    <Label>Buscar acompanhante no sistema (nome ou CPF)</Label>
                    <Input
                      value={formFila.acompanhante_id ? (formFila.acompanhante_nome || buscaAcomp) : buscaAcomp}
                      onChange={(e) => { setBuscaAcomp(e.target.value); setFormFila({ ...formFila, acompanhante_id: "", acompanhante_nome: e.target.value, acompanhante_cpf: formFila.acompanhante_cpf }); }}
                      placeholder="Digite nome ou CPF do acompanhante…"
                    />
                    {acompFiltrados.length > 0 && !formFila.acompanhante_id && (
                      <div className="mt-1 max-h-36 overflow-y-auto rounded-xl border border-sus-900/10 bg-white">
                        {acompFiltrados.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => {
                              setFormFila({ ...formFila, acompanhante_id: String(p.id), acompanhante_nome: p.nome, acompanhante_cpf: p.cpf || "" });
                              setBuscaAcomp(p.nome);
                            }}
                            className="block w-full px-3 py-2 text-left text-sm hover:bg-sand"
                          >
                            <b>{p.nome}</b> <span className="text-xs text-ink/50">{p.cpf || "sem CPF"}{p.nascimento ? ` · Nasc. ${fmtNasc(p.nascimento)}` : ""}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {formFila.acompanhante_id && (
                      <p className="mt-1 text-xs text-teal">
                        Vinculado ao cadastro #{formFila.acompanhante_id}.{" "}
                        <button
                          onClick={() => { setFormFila({ ...formFila, acompanhante_id: "", acompanhante_nome: "", acompanhante_cpf: "" }); setBuscaAcomp(""); }}
                          className="font-bold underline"
                        >
                          Desvincular (preenchimento manual)
                        </button>
                      </p>
                    )}
                  </div>
                  <div>
                    <Label>Nome completo do acompanhante</Label>
                    <Input
                      value={formFila.acompanhante_nome}
                      onChange={(e) => setFormFila({ ...formFila, acompanhante_nome: e.target.value, ...(formFila.acompanhante_id ? {} : {}) })}
                      placeholder="Nome completo (manual ou da busca)"
                    />
                  </div>
                  <div>
                    <Label>CPF do acompanhante</Label>
                    <Input
                      value={formFila.acompanhante_cpf}
                      onChange={(e) => setFormFila({ ...formFila, acompanhante_cpf: e.target.value.replace(/\D/g, "").slice(0, 11) })}
                      placeholder="Somente números"
                      inputMode="numeric"
                    />
                  </div>
                </div>
              )}
              <div className="md:col-span-2"><Label>Observações</Label><Input value={formFila.observacoes} onChange={(e) => setFormFila({ ...formFila, observacoes: e.target.value })} /></div>
            </div>
            {erro && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
            <Button onClick={salvarFila} className="mt-4 w-full"><Plus className="h-4 w-4" />{editFila ? "Atualizar" : "Entrar na fila"}</Button>
          </div>
        </div>
      )}

      {editViagem && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4" onClick={() => setEditViagem(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl bg-white p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <p className="font-display text-base font-bold text-sus-950">
                Editar {nomeViagem(editViagem)} · {fmtDia(editViagem.data_viagem)}
              </p>
              <button onClick={() => setEditViagem(null)} className="rounded-lg p-2 text-ink/50 hover:bg-sand" aria-label="Fechar"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div><Label>Data *</Label><Input type="date" value={formViagem.data_viagem} min={!podeEditarPassadas ? hoje : (retroativoBloqueado ? hoje : undefined)} onChange={(e) => setFormViagem({ ...formViagem, data_viagem: e.target.value })} /></div>
              <div>
                <Label>Destino *</Label>
                <select value={formViagem.destino} onChange={(e) => setFormViagem({ ...formViagem, destino: e.target.value })} className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
                  <option value="">Selecionar destino cadastrado…</option>
                  {destinos.filter((d) => d.ativo).map((d) => (
                    <option key={d.id} value={d.nome_destino}>
                      {d.nome_destino}{d.hospital_referencia ? ` · ${d.hospital_referencia}` : ""}
                    </option>
                  ))}
                  {formViagem.destino && !destinos.some((d) => d.nome_destino === formViagem.destino) && (
                    <option value={formViagem.destino}>{formViagem.destino} (atual)</option>
                  )}
                </select>
              </div>
              <div><Label>Horário de saída</Label><Input type="time" value={formViagem.hora_saida} onChange={(e) => { const h = e.target.value; setFormViagem({ ...formViagem, hora_saida: h, hora_retorno: formViagem.hora_retorno || retornoAutomatico(h) }); }} /></div>
              <div><Label>Horário de retorno (auto +9h, editável)</Label><Input type="time" value={formViagem.hora_retorno} onChange={(e) => setFormViagem({ ...formViagem, hora_retorno: e.target.value })} placeholder={retornoAutomatico(formViagem.hora_saida || "05:00")} /></div>
              <div className="md:col-span-2"><Label>Motorista</Label><CampoMotorista motoristas={motoristasLivresEdicao} motoristaId={formViagem.motorista_id} motoristaNome={formViagem.motorista} onMudar={(id, nome) => setFormViagem({ ...formViagem, motorista_id: id, motorista: nome })} /></div>
              <div className="md:col-span-2"><Label>Observações</Label><Input value={formViagem.observacoes} onChange={(e) => setFormViagem({ ...formViagem, observacoes: e.target.value })} placeholder="Observações da viagem" /></div>
            </div>
            {erro && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
            <div className="mt-4 flex gap-2">
              <Button onClick={salvarEdicaoViagem} className="flex-1"><Pencil className="h-4 w-4" /> Salvar alterações</Button>
              <button onClick={() => setEditViagem(null)} className="rounded-xl border border-sus-900/15 px-4 py-2.5 text-sm font-bold text-sus-900 hover:bg-sand">Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {trocaVeiculo && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4" onClick={() => setTrocaVeiculo(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl bg-white p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <p className="font-display text-base font-bold text-sus-950">
                Trocar veículo · {nomeViagem(trocaVeiculo)} ({fmtDia(trocaVeiculo.data_viagem)})
              </p>
              <button onClick={() => setTrocaVeiculo(null)} className="rounded-lg p-2 text-ink/50 hover:bg-sand" aria-label="Fechar"><X className="h-4 w-4" /></button>
            </div>
            <p className="mb-3 text-xs text-ink/55">
              Atual: <b>{trocaVeiculo.veiculo_placa || "sem veículo"}</b> · {trocaVeiculo.ocupados}/{trocaVeiculo.capacidade || "—"} ocupados.
            </p>
            <div className="grid gap-3">
              <div>
                <Label>Veículo *</Label>
                <select value={trocaVeiculoId} onChange={(e) => setTrocaVeiculoId(e.target.value)} className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
                  <option value="">A definir carro (sem veículo)</option>
                  {veiculosLivresTroca.filter((f) => f.status === "disponivel").map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.placa} · {f.modelo} ({f.capacidade} pax){f.em_outra_viagem && String(f.id) !== String(trocaVeiculo.veiculo_id) ? " · em outra viagem" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div><Label>Motorista</Label><CampoMotorista motoristas={motoristasLivresTroca} motoristaId={trocaMotoristaId} motoristaNome={trocaMotorista} onMudar={(id, nome) => { setTrocaMotoristaId(id); setTrocaMotorista(nome); }} /></div>
              {dispTroca && (
                <p className="text-xs text-ink/55">
                  Janela {trocaVeiculo?.hora_saida || "—"}→{trocaVeiculo?.hora_retorno || retornoAutomatico(trocaVeiculo?.hora_saida || "05:00")}: {veiculosLivresTroca.length} veículo(s) livre(s).
                </p>
              )}
            </div>
            {erro && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
            <div className="mt-4 flex gap-2">
              <Button onClick={confirmarTrocaVeiculo} className="flex-1"><Bus className="h-4 w-4" /> Confirmar troca</Button>
              <button onClick={() => setTrocaVeiculo(null)} className="rounded-xl border border-sus-900/15 px-4 py-2.5 text-sm font-bold text-sus-900 hover:bg-sand">Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {excluirViagem && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4" onClick={() => setExcluirViagem(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl bg-white p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <p className="font-display text-base font-bold text-sus-950">Excluir viagem</p>
              <button onClick={() => setExcluirViagem(null)} className="rounded-lg p-2 text-ink/50 hover:bg-sand" aria-label="Fechar"><X className="h-4 w-4" /></button>
            </div>
            <p className="text-sm text-ink/70">
              Excluir <b>{nomeViagem(excluirViagem)}</b> em <b>{fmtDia(excluirViagem.data_viagem)}</b>?
            </p>
            <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
              {excluirViagem.passageiros.length} passageiro(s) retornarão automaticamente à fila de espera.
            </p>
            {erro && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
            <div className="mt-4 flex gap-2">
              <button onClick={confirmarExclusaoViagem} className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white hover:brightness-110">
                <Trash2 className="mr-1 inline h-4 w-4" /> Excluir e devolver à fila
              </button>
              <button onClick={() => setExcluirViagem(null)} className="rounded-xl border border-sus-900/15 px-4 py-2.5 text-sm font-bold text-sus-900 hover:bg-sand">Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {visualizarOrdem && createPortal(
        <div
          id="ordem-overlay"
          className="fixed inset-0 z-50 overflow-y-auto bg-sus-950/60 p-4 print:p-0 print:bg-white"
          onClick={() => setVisualizarOrdem(null)}
        >
          <div
            id="ordem-print"
            className="mx-auto my-4 w-full max-w-4xl rounded-2xl bg-white p-6 shadow-2xl print:my-0 print:max-w-none print:rounded-none print:p-0 print:shadow-none"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Barra de ações - escondida na impressão */}
            <div className="ordem-acoes mb-4 flex items-center justify-between border-b border-sus-900/10 pb-3 print:hidden">
              <div className="flex items-center gap-2">
                <Printer className="h-5 w-5 text-sus-900" />
                <h3 className="font-display text-base font-bold text-sus-950">
                  Ordem de Circulação de Veículo
                </h3>
                <span className="rounded-full bg-teal/10 px-2.5 py-0.5 text-xs font-semibold text-teal">
                  {visualizarOrdem.destino} · {fmtDia(visualizarOrdem.data_viagem)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-sus-900 px-3.5 py-2 text-xs font-bold text-white hover:bg-sus-800 shadow-sm"
                  title="Imprimir documento oficial"
                >
                  <Printer className="h-4 w-4" />
                  Imprimir
                </button>
                <button
                  onClick={() => baixarDocx(visualizarOrdem)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-sus-900/20 bg-white px-3 py-2 text-xs font-bold text-sus-900 hover:bg-sand"
                  title="Baixar em formato Word (.docx)"
                >
                  <FileDown className="h-4 w-4" />
                  Baixar DOCX
                </button>
                <button
                  onClick={() => setVisualizarOrdem(null)}
                  className="rounded-xl p-2 text-ink/50 hover:bg-sand"
                  aria-label="Fechar"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Documento oficial formatado */}
            <div className="font-sans text-black leading-tight">
              {/* Cabeçalho */}
              <div className="text-center mb-3">
                <p className="text-[11px] font-bold uppercase tracking-wider text-black">
                  Prefeitura Municipal de Guapé · Secretaria Municipal de Saúde
                </p>
                <h2 className="text-xs md:text-sm font-extrabold uppercase mt-1 tracking-tight">
                  Ordem de Circulação de Veículos e Prestação de Contas de Viagem
                </h2>
              </div>

              {/* Tabela de Dados do Veículo e Viagem */}
              <table className="w-full border-collapse border border-black text-[10px] md:text-[11px] mb-3 table-fixed">
                <tbody>
                  <tr className="border-b border-black">
                    <td className="border-r border-black p-1.5 font-bold bg-gray-50 w-1/4">VEÍCULO</td>
                    <td className="border-r border-black p-1.5 w-1/4">{visualizarOrdem.veiculo_modelo || "—"}</td>
                    <td className="border-r border-black p-1.5 font-bold bg-gray-50 w-1/6">PLACA</td>
                    <td className="p-1.5 w-1/3 font-semibold">{visualizarOrdem.veiculo_placa || "—"}</td>
                  </tr>
                  <tr className="border-b border-black">
                    <td className="border-r border-black p-1.5 font-bold bg-gray-50">DESTINO</td>
                    <td className="border-r border-black p-1.5">{visualizarOrdem.destino || "—"}</td>
                    <td className="border-r border-black p-1.5 font-bold bg-gray-50">DEPARTAMENTO</td>
                    <td className="p-1.5">{visualizarOrdem.unidade || "Saúde"}</td>
                  </tr>
                  <tr className="border-b border-black">
                    <td className="border-r border-black p-1.5 font-bold bg-gray-50">MOTORISTA/FAVORECIDO</td>
                    <td colSpan={3} className="p-1.5 font-semibold">{visualizarOrdem.motorista || "—"}</td>
                  </tr>
                  <tr className="border-b border-black">
                    <td className="border-r border-black p-1 font-bold bg-gray-50">Data saída:</td>
                    <td className="border-r border-black p-1">{fmtDia(visualizarOrdem.data_viagem)}</td>
                    <td className="border-r border-black p-1 font-bold bg-gray-50">Hora saída:</td>
                    <td className="p-1">{visualizarOrdem.hora_saida || "—"}</td>
                  </tr>
                  <tr className="border-b border-black">
                    <td className="border-r border-black p-1 font-bold bg-gray-50">Data retorno:</td>
                    <td className="border-r border-black p-1">{fmtDia(visualizarOrdem.data_viagem)}</td>
                    <td className="border-r border-black p-1 font-bold bg-gray-50">Hora retorno:</td>
                    <td className="p-1">{visualizarOrdem.hora_retorno || "—"}</td>
                  </tr>
                  <tr>
                    <td className="border-r border-black p-1 font-bold bg-gray-50">Km inicial:</td>
                    <td className="border-r border-black p-1">__________</td>
                    <td className="border-r border-black p-1 font-bold bg-gray-50">Km final:</td>
                    <td className="p-1">__________</td>
                  </tr>
                </tbody>
              </table>

              {/* Despesas de Viagem */}
              <div className="mb-3">
                <p className="text-[11px] font-bold uppercase mb-1 tracking-wide">Despesas de Viagem</p>
                <table className="w-full border-collapse border border-black text-[10px] table-fixed">
                  <thead>
                    <tr className="border-b border-black bg-gray-100">
                      <th className="border-r border-black p-1 text-left w-1/3">Despesa</th>
                      <th className="border-r border-black p-1 text-center w-1/3">Valor (R$)</th>
                      <th className="p-1 text-center w-1/3">Vistos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {["Alimentação", "Hospedagem", "Combustível", "Peças", "Serviços", "Pedágio / Ônibus / Outros"].map((item) => (
                      <tr key={item} className="border-b border-black h-5">
                        <td className="border-r border-black px-1.5 py-0.5">{item}</td>
                        <td className="border-r border-black px-1.5 py-0.5 text-center"></td>
                        <td className="px-1.5 py-0.5 text-center"></td>
                      </tr>
                    ))}
                    <tr className="font-bold bg-gray-50 h-5">
                      <td className="border-r border-black px-1.5 py-0.5">TOTAL</td>
                      <td className="border-r border-black px-1.5 py-0.5 text-center">R$</td>
                      <td className="px-1.5 py-0.5"></td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Assinaturas */}
              <div className="grid grid-cols-2 gap-3 mb-4 text-[10px]">
                <div className="border-t border-black pt-1 text-center">
                  <p className="font-bold">Favorecido / Motorista</p>
                </div>
                <div className="border-t border-black pt-1 text-center">
                  <p className="font-bold">Chefe do Departamento</p>
                </div>
              </div>

              {/* Quebra de página no documento oficial caso necessário */}
              <div className="ordem-quebra-pagina my-3 border-t-2 border-dashed border-gray-300 print:border-none"></div>

              {/* Relação de Passageiros */}
              <div className="text-center mb-2">
                <h3 className="text-xs md:text-sm font-extrabold uppercase tracking-tight">
                  Relação de Passageiros
                </h3>
                <p className="text-[10px] text-gray-600">
                  {visualizarOrdem.passageiros?.length || 0} passageiro(s) agendado(s) · {visualizarOrdem.destino}
                </p>
              </div>

              {/* Tabela de Passageiros Centralizada na Página */}
              <div className="w-full flex justify-center">
                <table
                  className="w-full border-collapse border border-black text-[10px] md:text-[11px] leading-tight"
                  style={{ margin: "0 auto" }}
                >
                  <thead>
                    <tr className="border-b border-black bg-gray-100 font-bold text-center">
                      <th className="border-r border-black p-1 w-8">Nº</th>
                      <th className="border-r border-black p-1 text-left">Passageiro</th>
                      <th className="border-r border-black p-1 w-20">Data Nasc.</th>
                      <th className="border-r border-black p-1 text-left">Tratamento / Observação</th>
                      <th className="border-r border-black p-1 text-left w-28">Unidade</th>
                      <th className="border-r border-black p-1 w-16">Horário</th>
                      <th className="p-1 text-left w-24">Cidade</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Linhas preenchidas + completadas até 15 para impressão equilibrada */}
                    {Array.from({ length: Math.max(15, visualizarOrdem.passageiros?.length || 0) }).map((_, idx) => {
                      const p = visualizarOrdem.passageiros?.[idx];
                      const tratObs = p
                        ? [p.tratamento, p.observacoes ? `Obs.: ${p.observacoes}` : ""].filter(Boolean).join(" - ")
                        : "";
                      return (
                        <tr key={idx} className="border-b border-black h-6">
                          <td className="border-r border-black p-1 text-center font-bold">
                            {String(idx + 1).padStart(2, "0")}
                          </td>
                          <td className="border-r border-black px-1.5 py-0.5 truncate max-w-[180px]">
                            {p?.paciente_nome ? (
                              <div>
                                <span className="font-semibold">{p.paciente_nome}</span>
                                {p.acompanhante_nome && (
                                  <span className="block text-[9px] text-gray-600">
                                    Acomp: {p.acompanhante_nome}
                                  </span>
                                )}
                              </div>
                            ) : ""}
                          </td>
                          <td className="border-r border-black p-1 text-center">
                            {p ? fmtNasc(p.paciente_nascimento) : ""}
                          </td>
                          <td className="border-r border-black px-1.5 py-0.5 truncate max-w-[160px]">
                            {tratObs}
                          </td>
                          <td className="border-r border-black px-1.5 py-0.5 truncate max-w-[120px]">
                            {p?.unidade || ""}
                          </td>
                          <td className="border-r border-black p-1 text-center font-semibold">
                            {p?.hora_consulta || ""}
                          </td>
                          <td className="px-1.5 py-0.5 truncate max-w-[100px]">
                            {p ? (visualizarOrdem.destino || "") : ""}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
