import { useEffect, useMemo, useState } from "react";
import {
  ArrowRightLeft,
  Calendar,
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  Expand,
  Minus,
  Pencil,
  Plus,
  Power,
  Trash2,
  X,
} from "lucide-react";
import {
  examesSolicitarLote,
  expandirSigtapIds,
  filaPsfListar,
  labFeriadoCriar,
  labFeriadoExcluir,
  labFeriadosListar,
  labSigtap,
  labSolicitacaoAlterarStatus,
  labSolicitacaoTransferir,
  labsListar,
  mapVaga,
  pagData,
  solicitarListar,
  tfdPacientes,
  vagasAtualizar,
  vagasCriar,
  vagasExcluir,
  vagasGrade,
  vagasListar,
  vagasLoteMes,
  type FilaPsfItem,
  type LabFeriado,
  type Laboratorio,
  type Paciente,
  type SigtapProc,
  type SolicMestre,
  type Vaga,
  type VagaDia,
} from "../../services/api";
import { Button, Card, Input, Label, Select } from "../../components/ui/primitives";
import GradeDias from "../../components/GradeDias";
import MonthPicker from "../../components/MonthPicker";
import { useConfirm } from "../../components/ConfirmDialog";

type ItemLote = { sigtap: SigtapProc; quantidade: number };
type ModoDia = "agendar" | "vaga" | "agendados";

export default function VagasAgenda() {
  const { confirmar } = useConfirm();
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
  const [vagaTipoServico, setVagaTipoServico] = useState("rotina");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");

  // Manejo de Agendados do Dia
  const [agendadosDia, setAgendadosDia] = useState<SolicMestre[]>([]);
  const [carregandoAgendados, setCarregandoAgendados] = useState(false);
  const [solicTransferir, setSolicTransferir] = useState<SolicMestre | null>(null);
  const [transfNovaData, setTransfNovaData] = useState("");
  const [transfNovoLabId, setTransfNovoLabId] = useState("");
  const [transfMotivo, setTransfMotivo] = useState("");
  const [transferindo, setTransferindo] = useState(false);

  // Feriados & Bloqueios
  const [modalFeriados, setModalFeriados] = useState(false);
  const [feriados, setFeriados] = useState<LabFeriado[]>([]);
  const [carregandoFeriados, setCarregandoFeriados] = useState(false);
  const [novoFeriadoData, setNovoFeriadoData] = useState("");
  const [novoFeriadoDesc, setNovoFeriadoDesc] = useState("");
  const [novoFeriadoBloquear, setNovoFeriadoBloquear] = useState(true);
  const [novoFeriadoLabId, setNovoFeriadoLabId] = useState("");
  const [salvandoFeriado, setSalvandoFeriado] = useState(false);

  // Liberação em Lote no Mês
  const [modalLote, setModalLote] = useState(false);
  const [modalAgend, setModalAgend] = useState(false);
  const [loteLab, setLoteLab] = useState("");
  const [loteMes, setLoteMes] = useState(() => new Date().toISOString().slice(0, 7));
  const [loteQtd, setLoteQtd] = useState("20");
  const [loteTipoServico, setLoteTipoServico] = useState("rotina");
  const [loteSemFds, setLoteSemFds] = useState(true);
  const [loteBloquearFeriados, setLoteBloquearFeriados] = useState(true);
  const [loteBusy, setLoteBusy] = useState(false);

  useEffect(() => {
    labsListar()
      .then((l) => {
        const ativos = l.filter((x) => x.ativo);
        setLabs(ativos);
        if (ativos.length && !labId) setLabId(String(ativos[0].id));
      })
      .catch(() => {});
    filaPsfListar("na_fila")
      .then((r) => setFila(pagData<FilaPsfItem>(r)))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function carregar() {
    if (!month) return;
    setCarregando(true);
    try {
      const [ano, mes] = month.split("-").map(Number);
      const ultimoDia = new Date(ano, mes, 0).getDate();
      const ateData = `${month}-${String(ultimoDia).padStart(2, "0")}`;

      const [g, v] = await Promise.all([
        vagasGrade(month, undefined, labId ? Number(labId) : undefined),
        vagasListar(`${month}-01`, ateData, labId ? Number(labId) : undefined),
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
      tfdPacientes(buscaPac || undefined)
        .then((r) => setPacientes(pagData<Paciente>(r)))
        .catch(() => {});
      labSigtap(buscaSig || undefined)
        .then((r) => setSigtap(pagData<SigtapProc>(r)))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [buscaPac, buscaSig, diaSel]);

  async function carregarAgendadosDia(d: string) {
    setCarregandoAgendados(true);
    try {
      const res = await solicitarListar({
        data_de: d,
        data_ate: d,
        laboratorio_id: labId ? Number(labId) : undefined,
        limit: 100,
      });
      setAgendadosDia(Array.isArray(res) ? res : res.data);
    } catch {
      setAgendadosDia([]);
    } finally {
      setCarregandoAgendados(false);
    }
  }

  useEffect(() => {
    if (diaSel && modoDia === "agendados") {
      carregarAgendadosDia(diaSel);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diaSel, modoDia, labId]);

  async function carregarFeriados() {
    setCarregandoFeriados(true);
    try {
      const res = await labFeriadosListar(labId ? Number(labId) : undefined);
      setFeriados(res);
    } catch {
      setFeriados([]);
    } finally {
      setCarregandoFeriados(false);
    }
  }

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
    const v = vagaPorDia.get(d);
    setVagaQtd(String(v?.vagas_totais ?? v?.total ?? 20));
    setVagaTipoServico((v?.tipo_servico as string) || "rotina");
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
    setSolicTransferir(null);
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
      filaPsfListar("na_fila")
        .then((r) => setFila(pagData<FilaPsfItem>(r)))
        .catch(() => {});
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
      if (vagaDiaSel) {
        await vagasAtualizar(vagaDiaSel.id, {
          data: diaSel,
          laboratorio_id: Number(labId),
          vagas_totais: total,
          tipo_servico: vagaTipoServico,
        });
      } else {
        await vagasCriar({
          data: diaSel,
          laboratorio_id: Number(labId),
          vagas_totais: total,
          tipo_servico: vagaTipoServico,
        });
      }
      setOk(vagaDiaSel ? "Vagas do dia atualizadas." : "Vagas do dia criadas.");
      await carregar();
    } catch (e: any) {
      setErro(e?.response?.data?.detail ?? "Erro ao salvar vagas do dia.");
    }
  }

  async function excluirVagaDia() {
    if (!vagaDiaSel) return;
    const dataFmt = vagaDiaSel.data ? vagaDiaSel.data.split("-").reverse().join("/") : diaSel || "";
    const ok = await confirmar({
      titulo: `Excluir vagas de ${dataFmt}`,
      descricao: `Deseja realmente excluir as vagas configuradas para o dia ${dataFmt}?`,
      textoConfirmar: "Sim, Excluir",
      variante: "danger",
    });
    if (!ok) return;
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
        bloquear_feriados: loteBloquearFeriados,
        tipo_servico: loteTipoServico,
      });
      setModalLote(false);
      setOk(
        `Mês ${r.mes_ref} liberado p/ ${r.laboratorio_nome}: ${r.criadas} criadas, ${r.atualizadas} atualizadas${
          r.mantidas_conflito ? `, ${r.mantidas_conflito} mantida(s) com agendamentos` : ""
        }${r.ignoradas_fim_semana ? `, ${r.ignoradas_fim_semana} fim de semana ignorados` : ""}${
          r.ignoradas_passado ? `, ${r.ignoradas_passado} dia(s) passado(s) ignorados` : ""
        }.`
      );
      setLoteQtd("20");
      await carregar();
    } catch (e: any) {
      setErro(e?.response?.data?.detail ?? "Erro ao liberar mês.");
    } finally {
      setLoteBusy(false);
    }
  }

  // Manejo de Agendamentos: Transferência
  async function executarTransferencia() {
    if (!solicTransferir || !transfNovaData) {
      setErro("Selecione a nova data para a transferência.");
      return;
    }
    setTransferindo(true);
    setErro("");
    try {
      await labSolicitacaoTransferir(solicTransferir.id, {
        nova_data: transfNovaData,
        novo_laboratorio_id: transfNovoLabId ? Number(transfNovoLabId) : undefined,
        motivo: transfMotivo.trim() || undefined,
      });
      setOk(
        `Solicitação de ${solicTransferir.paciente_nome} transferida com sucesso para ${transfNovaData
          .split("-")
          .reverse()
          .join("/")}.`
      );
      setSolicTransferir(null);
      setTransfNovaData("");
      setTransfMotivo("");
      if (diaSel) carregarAgendadosDia(diaSel);
      await carregar();
    } catch (e: any) {
      setErro(e?.response?.data?.detail ?? "Erro ao transferir agendamento.");
    } finally {
      setTransferindo(false);
    }
  }

  // Manejo de Agendamentos: Ativar / Desativar
  async function alternarStatusAgendado(solic: SolicMestre, novoStatus: string) {
    const acao = novoStatus === "desativado" ? "desativar" : "reativar";
    const sim = await confirmar({
      titulo: `${acao === "desativar" ? "Desativar" : "Reativar"} Agendamento`,
      descricao: `Deseja realmente ${acao} o agendamento de ${solic.paciente_nome}? ${
        acao === "desativar"
          ? "A vaga ocupada neste dia será liberada imediatamente."
          : "Uma vaga será reocupada."
      }`,
      textoConfirmar: `Sim, ${acao}`,
      variante: acao === "desativar" ? "danger" : "primary",
    });
    if (!sim) return;
    try {
      await labSolicitacaoAlterarStatus(solic.id, {
        status: novoStatus,
        motivo: `${acao === "desativar" ? "Desativado" : "Reativado"} pelo operador na agenda`,
      });
      setOk(
        `Agendamento de ${solic.paciente_nome} ${
          novoStatus === "desativado" ? "desativado (vaga liberada)" : "reativado"
        }.`
      );
      if (diaSel) carregarAgendadosDia(diaSel);
      await carregar();
    } catch (e: any) {
      setErro(e?.response?.data?.detail ?? `Erro ao ${acao} agendamento.`);
    }
  }

  // Feriados & Bloqueios: Adicionar
  async function adicionarFeriado() {
    if (!novoFeriadoData || !novoFeriadoDesc.trim()) {
      setErro("Data e descrição do feriado são obrigatórios.");
      return;
    }
    setSalvandoFeriado(true);
    setErro("");
    try {
      await labFeriadoCriar({
        data: novoFeriadoData,
        descricao: novoFeriadoDesc.trim(),
        bloquear_agendamento: novoFeriadoBloquear,
        laboratorio_id: novoFeriadoLabId ? Number(novoFeriadoLabId) : null,
      });
      setNovoFeriadoDesc("");
      setNovoFeriadoData("");
      await carregarFeriados();
      await carregar();
      setOk("Feriado / bloqueio adicionado com sucesso.");
    } catch (e: any) {
      setErro(e?.response?.data?.detail ?? "Erro ao cadastrar feriado.");
    } finally {
      setSalvandoFeriado(false);
    }
  }

  // Feriados & Bloqueios: Remover
  async function removerFeriado(id: number) {
    const sim = await confirmar({
      titulo: "Remover Bloqueio / Feriado",
      descricao: "Deseja remover este feriado da agenda laboratorial?",
      textoConfirmar: "Sim, remover",
      variante: "danger",
    });
    if (!sim) return;
    try {
      await labFeriadoExcluir(id);
      await carregarFeriados();
      await carregar();
      setOk("Feriado removido.");
    } catch (e: any) {
      setErro(e?.response?.data?.detail ?? "Erro ao remover feriado.");
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold text-sus-950">
          <CalendarDays className="h-5 w-5 text-sus-900" /> Vagas e agenda
        </h2>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {carregando && <span className="text-xs text-ink/45">Carregando grade…</span>}
          <Button
            variant="outline"
            onClick={() => {
              setModalFeriados(true);
              carregarFeriados();
            }}
            className="flex items-center gap-1.5"
          >
            <Calendar className="h-4 w-4 text-amber-600" /> Feriados & Bloqueios
          </Button>
          <Button
            onClick={() => {
              setLoteLab(labId || "");
              setLoteMes(month);
              setModalLote(true);
            }}
            className="!bg-teal !text-sus-950 flex items-center gap-1.5"
          >
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
            <Select value={labId} onChange={(e) => setLabId(e.target.value)}>
              <option value="">Selecionar…</option>
              {labs
                .filter((l) => l.ativo)
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.nome}
                  </option>
                ))}
            </Select>
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

      {erro && !diaSel && !modalLote && !modalFeriados && (
        <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>
      )}
      {ok && <p className="mb-3 rounded-xl bg-teal/10 px-3 py-2 text-sm text-teal">{ok}</p>}

      <Card className="p-4">
        <GradeDias
          month={month}
          mapa={mapa}
          diaSel={diaSel ?? ""}
          bloqueado={!labId}
          permitirSemVaga
          onSelect={abrirDia}
        />
        {!labId && <p className="mt-2 text-xs text-ink/50">Selecione um laboratório para ver a disponibilidade.</p>}
        <p className="mt-2 text-xs text-ink/55">Clique num dia para agendar paciente, abrir/ajustar vagas ou gerenciar agendamentos.</p>
      </Card>

      {/* Modal de Detalhes do Dia */}
      {diaSel && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4" onClick={fecharModal}>
          <div
            className="rise max-h-[90vh] w-full max-w-xl overflow-auto rounded-2xl bg-white p-6 shadow-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-2">
              <p className="font-display text-base font-bold text-sus-950">
                {diaSel.split("-").reverse().join("/")} · {labNome}
                {sel ? ` · ${sel.livres} livres de ${sel.total}` : " · sem vagas"}
              </p>
              <button onClick={fecharModal} className="rounded-lg p-2 text-ink/50 hover:bg-sand">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mb-3 grid grid-cols-3 gap-1.5 rounded-xl bg-sand/70 p-1.5">
              {(
                [
                  { id: "agendar", label: "Agendar" },
                  { id: "vaga", label: "Ajustar Vagas" },
                  { id: "agendados", label: "Agendados" },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setModoDia(m.id)}
                  className={`rounded-lg px-2.5 py-2 font-display text-xs font-bold transition ${
                    modoDia === m.id
                      ? "bg-white text-sus-950 shadow-card"
                      : "text-sus-900/60 hover:text-sus-950"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {/* ABA 1: Ajustar Vagas */}
            {modoDia === "vaga" && (
              <div className="space-y-3">
                <div>
                  <Label>Quantitativo diário *</Label>
                  <Input
                    type="number"
                    min={0}
                    placeholder="Ex: 20"
                    value={vagaQtd}
                    onChange={(e) => setVagaQtd(e.target.value)}
                  />
                  {vagaDiaSel && (
                    <p className="mt-1 text-xs text-ink/55">
                      Atual: {vagaDiaSel.vagas_totais ?? vagaDiaSel.total} total ·{" "}
                      {vagaDiaSel.vagas_ocupadas ?? vagaDiaSel.ocupadas} ocupadas · {vagaDiaSel.vagas_livres} livres.
                    </p>
                  )}
                </div>
                <div>
                  <Label>Tipo de Serviço / Categoria da Vaga</Label>
                  <Select value={vagaTipoServico} onChange={(e) => setVagaTipoServico(e.target.value)}>
                    <option value="rotina">Exames de Rotina (Padrão)</option>
                    <option value="labcon">Labcon / Específico</option>
                    <option value="urgencia">Urgência / Prioritário</option>
                  </Select>
                </div>
                {erro && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
                <Button onClick={salvarVagaDia} className="w-full">
                  <Plus className="h-4 w-4" /> {vagaDiaSel ? "Atualizar vagas do dia" : "Abrir vagas do dia"}
                </Button>
                {vagaDiaSel && (
                  <button
                    onClick={excluirVagaDia}
                    className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-red-600 transition hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4" /> Excluir vagas do dia
                  </button>
                )}
              </div>
            )}

            {/* ABA 2: Agendar Paciente */}
            {modoDia === "agendar" && (
              <div className="space-y-3">
                <div>
                  <Label>Converter da fila do PSF (opcional)</Label>
                  <Select value={origemFilaId} onChange={(e) => usarFila(e.target.value)}>
                    <option value="">Agendamento direto…</option>
                    {fila.slice(0, 50).map((f) => (
                      <option key={f.id} value={f.id}>
                        #{f.id} · {f.paciente_nome} · {f.unidade_psf}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label>Paciente *</Label>
                  <Input placeholder="Buscar paciente…" value={buscaPac} onChange={(e) => setBuscaPac(e.target.value)} />
                  <Select value={pacienteId} onChange={(e) => setPacienteId(e.target.value)} className="mt-1">
                    <option value="">Selecionar…</option>
                    {pacientes.slice(0, 15).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nome}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label>Exames SIGTAP * (buscar código ou descrição)</Label>
                  <Input
                    placeholder="Buscar código ou nome…"
                    value={buscaSig}
                    onChange={(e) => setBuscaSig(e.target.value)}
                  />
                  <div className="mt-2 max-h-44 space-y-1 overflow-auto rounded-xl border border-sus-900/10 p-2">
                    {sigtap.slice(0, 30).map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => adicionarSig(s)}
                        className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-sand"
                      >
                        <Plus className="mt-0.5 h-4 w-4 shrink-0 text-teal" />
                        <span>
                          <b>{s.codigo}</b> · {s.descricao}
                        </span>
                      </button>
                    ))}
                    {sigtap.length === 0 && <p className="py-3 text-center text-xs text-ink/45">Nenhum procedimento.</p>}
                  </div>
                </div>
                <div>
                  <Label>Exames adicionados ({totalItens})</Label>
                  <div className="space-y-2">
                    {itens.map((i) => (
                      <div
                        key={i.sigtap.id}
                        className="flex items-center gap-2 rounded-xl border border-sus-900/10 p-2 text-sm"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold">
                            <b>{i.sigtap.codigo}</b> · {i.sigtap.descricao}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setQtd(i.sigtap.id, i.quantidade - 1)}
                            className="rounded-lg p-1.5 text-sus-900 hover:bg-sand"
                            title="Diminuir"
                          >
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
                          <button
                            onClick={() => setQtd(i.sigtap.id, i.quantidade + 1)}
                            className="rounded-lg p-1.5 text-sus-900 hover:bg-sand"
                            title="Aumentar"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <button
                          onClick={() => removerItem(i.sigtap.id)}
                          className="rounded-lg p-1.5 text-red-600 hover:bg-red-50"
                          title="Excluir item"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                    {itens.length === 0 && (
                      <p className="rounded-xl bg-sand/60 px-3 py-3 text-center text-xs text-ink/50">
                        Nenhum exame adicionado.
                      </p>
                    )}
                  </div>
                  {idsExpandidos.length > 0 && (
                    <p className="mt-1 text-xs text-ink/55">
                      {itens.length} procedimento(s) · {idsExpandidos.length} amostra(s) no lote.
                    </p>
                  )}
                </div>
                {erro && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
                <Button onClick={agendar} className="w-full">
                  <Plus className="h-4 w-4" /> Confirmar agendamento
                </Button>
              </div>
            )}

            {/* ABA 3: Manejo de Agendados (Transferir, Ativar, Desativar) */}
            {modoDia === "agendados" && (
              <div className="space-y-3">
                {carregandoAgendados ? (
                  <p className="py-6 text-center text-xs text-ink/50">Carregando pacientes agendados…</p>
                ) : agendadosDia.length === 0 ? (
                  <div className="rounded-xl bg-sand/50 p-6 text-center text-xs text-ink/60">
                    Nenhum paciente agendado para esta data.
                  </div>
                ) : (
                  <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                    {agendadosDia.map((solic) => {
                      const desativado = solic.status === "desativado" || solic.status === "cancelado";
                      return (
                        <div
                          key={solic.id}
                          className={`rounded-xl border p-3 text-xs transition ${
                            desativado
                              ? "border-dashed border-red-200 bg-red-50/40 opacity-75"
                              : "border-sus-900/10 bg-white shadow-xs"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="font-bold text-sus-950 text-sm">{solic.paciente_nome}</p>
                              <div className="flex flex-wrap items-center gap-2 text-ink/60 mt-0.5">
                                {solic.paciente_cpf && <span>CPF: {solic.paciente_cpf}</span>}
                                {solic.paciente_prontuario && <span>Pront: {solic.paciente_prontuario}</span>}
                                <span>· {solic.itens?.length ?? 0} exame(s)</span>
                              </div>
                              <div className="mt-1 flex items-center gap-2">
                                <span
                                  className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                                    desativado
                                      ? "bg-red-100 text-red-800"
                                      : solic.status === "coletado"
                                      ? "bg-teal/15 text-teal-800"
                                      : "bg-amber-100 text-amber-800"
                                  }`}
                                >
                                  {desativado ? "DESATIVADO" : solic.status.toUpperCase()}
                                </span>
                                {solic.laboratorio_nome && (
                                  <span className="text-[10px] text-ink/50 font-medium">
                                    {solic.laboratorio_nome}
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setSolicTransferir(solic);
                                  setTransfNovaData("");
                                  setTransfNovoLabId(labId || "");
                                  setTransfMotivo("");
                                }}
                                className="!h-8 !px-2 text-xs flex items-center gap-1"
                                title="Transferir agendamento para outro dia"
                              >
                                <ArrowRightLeft className="h-3.5 w-3.5 text-blue-600" />
                                Transferir
                              </Button>

                              {desativado ? (
                                <button
                                  type="button"
                                  onClick={() => alternarStatusAgendado(solic, "agendado")}
                                  className="inline-flex h-8 items-center gap-1 rounded-lg bg-teal/10 px-2 font-bold text-teal text-xs hover:bg-teal/20 transition"
                                  title="Reativar agendamento"
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5" /> Reativar
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => alternarStatusAgendado(solic, "desativado")}
                                  className="inline-flex h-8 items-center gap-1 rounded-lg bg-red-50 px-2 font-semibold text-red-600 text-xs hover:bg-red-100 transition"
                                  title="Desativar agendamento e liberar vaga"
                                >
                                  <Power className="h-3.5 w-3.5" /> Desativar
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal de Transferir Agendamento */}
      {solicTransferir && (
        <div
          className="fixed inset-0 z-60 grid place-items-center bg-sus-950/60 p-4"
          onClick={() => setSolicTransferir(null)}
        >
          <div
            className="rise w-full max-w-md rounded-2xl bg-white p-5 shadow-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between border-b border-sus-900/10 pb-3">
              <p className="font-display text-base font-bold text-sus-950 flex items-center gap-1.5">
                <ArrowRightLeft className="h-4 w-4 text-blue-600" /> Transferir Agendamento
              </p>
              <button
                onClick={() => setSolicTransferir(null)}
                className="rounded-lg p-1.5 text-ink/50 hover:bg-sand"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-xs text-ink/75 mb-3">
              Paciente: <b>{solicTransferir.paciente_nome}</b>
              <br />
              Data Atual: <b>{diaSel?.split("-").reverse().join("/")}</b>
            </p>

            <div className="space-y-3">
              <div>
                <Label>Nova Data do Agendamento *</Label>
                <Input
                  type="date"
                  min={hojeISO()}
                  value={transfNovaData}
                  onChange={(e) => setTransfNovaData(e.target.value)}
                />
              </div>

              <div>
                <Label>Laboratório Destino</Label>
                <Select value={transfNovoLabId} onChange={(e) => setTransfNovoLabId(e.target.value)}>
                  {labs
                    .filter((l) => l.ativo)
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.nome}
                      </option>
                    ))}
                </Select>
              </div>

              <div>
                <Label>Justificativa / Motivo da Transferência</Label>
                <Input
                  placeholder="Ex: Pedido do paciente, indisponibilidade médica…"
                  value={transfMotivo}
                  onChange={(e) => setTransfMotivo(e.target.value)}
                />
              </div>

              {erro && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{erro}</p>}

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setSolicTransferir(null)}>
                  Cancelar
                </Button>
                <Button
                  onClick={executarTransferencia}
                  disabled={transferindo || !transfNovaData}
                  className="!bg-teal !text-sus-950 font-bold"
                >
                  {transferindo ? "Transferindo…" : "Confirmar Transferência"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Feriados & Bloqueios */}
      {modalFeriados && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4"
          onClick={() => setModalFeriados(false)}
        >
          <div
            className="rise flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-sus-900/10 px-5 py-4">
              <div>
                <p className="font-display text-base font-bold text-sus-950 flex items-center gap-2">
                  <Calendar className="h-5 w-5 text-amber-600" /> Feriados & Bloqueios da Agenda
                </p>
                <p className="text-xs text-ink/60 mt-0.5">
                  Cadastre feriados ou manutenções para bloquear automaticamente a geração de vagas e agendamentos.
                </p>
              </div>
              <button
                onClick={() => setModalFeriados(false)}
                className="rounded-lg p-2 text-ink/50 hover:bg-sand"
                aria-label="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="overflow-y-auto p-5 space-y-4">
              {/* Formulário de Novo Feriado */}
              <div className="rounded-xl border border-sus-900/10 bg-sand/40 p-4 space-y-3">
                <p className="text-xs font-bold uppercase tracking-wider text-sus-950">
                  Adicionar Feriado / Bloqueio
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label>Data do Feriado / Bloqueio *</Label>
                    <Input
                      type="date"
                      value={novoFeriadoData}
                      onChange={(e) => setNovoFeriadoData(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label>Laboratório (opcional)</Label>
                    <Select value={novoFeriadoLabId} onChange={(e) => setNovoFeriadoLabId(e.target.value)}>
                      <option value="">Todos os Laboratórios (Geral)</option>
                      {labs.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.nome}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>

                <div>
                  <Label>Descrição / Motivo do Bloqueio *</Label>
                  <Input
                    placeholder="Ex: Feriado Municipal - Padroeiro, Recesso de Fim de Ano…"
                    value={novoFeriadoDesc}
                    onChange={(e) => setNovoFeriadoDesc(e.target.value)}
                  />
                </div>

                <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-sus-950">
                  <input
                    type="checkbox"
                    checked={novoFeriadoBloquear}
                    onChange={(e) => setNovoFeriadoBloquear(e.target.checked)}
                    className="h-4 w-4 rounded accent-teal-700"
                  />
                  Bloquear geração de vagas e agendamentos neste dia
                </label>

                {erro && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{erro}</p>}

                <Button
                  onClick={adicionarFeriado}
                  disabled={salvandoFeriado || !novoFeriadoData || !novoFeriadoDesc.trim()}
                  className="!bg-teal !text-sus-950 font-bold"
                >
                  <Plus className="h-4 w-4" /> {salvandoFeriado ? "Salvando…" : "Cadastrar Feriado / Bloqueio"}
                </Button>
              </div>

              {/* Tabela de Feriados Cadastrados */}
              <div className="rounded-xl border border-sus-900/10 overflow-hidden">
                <p className="bg-sand/60 px-4 py-2.5 text-xs font-bold text-sus-900/70 border-b border-sus-900/10">
                  Bloqueios Ativos ({feriados.length})
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-sus-900/10 bg-sand/30 text-ink/60 uppercase">
                        <th className="px-3 py-2.5">Data</th>
                        <th className="px-3 py-2.5">Descrição</th>
                        <th className="px-3 py-2.5">Escopo</th>
                        <th className="px-3 py-2.5">Bloqueio</th>
                        <th className="px-3 py-2.5 text-right">Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {carregandoFeriados ? (
                        <tr>
                          <td colSpan={5} className="py-6 text-center text-ink/45">
                            Carregando feriados…
                          </td>
                        </tr>
                      ) : feriados.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-6 text-center text-ink/45">
                            Nenhum feriado ou bloqueio cadastrado.
                          </td>
                        </tr>
                      ) : (
                        feriados.map((f) => (
                          <tr key={f.id} className="border-b border-sus-900/5 last:border-0 hover:bg-sand/20">
                            <td className="px-3 py-2.5 font-bold font-mono">
                              {f.data.split("-").reverse().join("/")}
                            </td>
                            <td className="px-3 py-2.5 font-medium">{f.descricao}</td>
                            <td className="px-3 py-2.5 text-ink/65">
                              {f.laboratorio_nome || "Geral (Todos)"}
                            </td>
                            <td className="px-3 py-2.5">
                              <span
                                className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                  f.bloquear_agendamento
                                    ? "bg-red-100 text-red-800"
                                    : "bg-amber-100 text-amber-800"
                                }`}
                              >
                                {f.bloquear_agendamento ? "Bloqueado" : "Apenas Informativo"}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <button
                                onClick={() => removerFeriado(f.id)}
                                className="rounded p-1 text-red-600 hover:bg-red-50"
                                title="Remover feriado"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Liberar Mês Inteiro */}
      {modalLote && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4" onClick={fecharLote}>
          <div
            className="rise w-full max-w-lg rounded-2xl bg-white p-6 shadow-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <p className="font-display text-base font-bold text-sus-950">Liberar mês inteiro</p>
              <button onClick={fecharLote} className="rounded-lg p-2 text-ink/50 hover:bg-sand" aria-label="Fechar">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <Label>Laboratório *</Label>
                <Select value={loteLab} onChange={(e) => setLoteLab(e.target.value)}>
                  <option value="">Selecionar…</option>
                  {labs.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.nome}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Mês/ano de referência *</Label>
                <MonthPicker value={loteMes} onChange={setLoteMes} />
              </div>
              <div>
                <Label>Vagas por dia *</Label>
                <Input
                  type="number"
                  min={0}
                  max={1000}
                  placeholder="Ex: 20"
                  value={loteQtd}
                  onChange={(e) => setLoteQtd(e.target.value)}
                />
              </div>
              <div>
                <Label>Tipo de Serviço / Categoria da Vaga</Label>
                <Select value={loteTipoServico} onChange={(e) => setLoteTipoServico(e.target.value)}>
                  <option value="rotina">Exames de Rotina (Padrão)</option>
                  <option value="labcon">Labcon / Específico</option>
                  <option value="urgencia">Urgência / Prioritário</option>
                </Select>
              </div>
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-sus-900/10 px-3 py-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={loteSemFds}
                  onChange={(e) => setLoteSemFds(e.target.checked)}
                  className="h-4 w-4 accent-teal-700"
                />
                Ignorar fins de semana (Sáb / Dom)
              </label>
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-sus-900/10 px-3 py-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={loteBloquearFeriados}
                  onChange={(e) => setLoteBloquearFeriados(e.target.checked)}
                  className="h-4 w-4 accent-teal-700"
                />
                Bloquear dias com Feriados / Bloqueios cadastrados
              </label>
              {erro && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
              <Button onClick={salvarLote} disabled={loteBusy} className="w-full">
                <CalendarPlus className="h-4 w-4" /> {loteBusy ? "Liberando…" : "Confirmar liberação"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Tabela de Vagas no Mês */}
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
          <div className="overflow-x-auto">
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
                    <td className="px-4 py-3 font-semibold">
                      {String(v.data).slice(0, 10).split("-").reverse().join("/")}
                    </td>
                    <td className="px-4 py-3">{v.vagas_totais ?? v.total}</td>
                    <td className="px-4 py-3">{v.vagas_ocupadas ?? v.ocupadas}</td>
                    <td className="px-4 py-3 font-semibold text-sus-950">
                      {v.vagas_livres ??
                        Math.max(0, (v.vagas_totais ?? v.total ?? 0) - (v.vagas_ocupadas ?? v.ocupadas ?? 0))}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => abrirDia(String(v.data).slice(0, 10))}
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
          {vagasMes.length > 5 && (
            <button
              onClick={() => setModalAgend(true)}
              className="w-full bg-sand/50 px-4 py-2 text-center text-xs font-semibold text-sus-900/70 transition hover:bg-sand"
            >
              + {vagasMes.length - 5} dia(s) · clique para expandir
            </button>
          )}
        </Card>
      )}

      {/* Modal Expandido de Agendamentos */}
      {modalAgend && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4"
          onClick={() => setModalAgend(false)}
        >
          <div
            className="rise flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-card"
            onClick={(e) => e.stopPropagation()}
          >
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
                      <td className="px-4 py-3 font-semibold">
                        {String(v.data).slice(0, 10).split("-").reverse().join("/")}
                      </td>
                      <td className="px-4 py-3">{v.vagas_totais ?? v.total}</td>
                      <td className="px-4 py-3">{v.vagas_ocupadas ?? v.ocupadas}</td>
                      <td className="px-4 py-3 font-semibold text-sus-950">
                        {v.vagas_livres ??
                          Math.max(0, (v.vagas_totais ?? v.total ?? 0) - (v.vagas_ocupadas ?? v.ocupadas ?? 0))}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => {
                              setModalAgend(false);
                              abrirDia(String(v.data).slice(0, 10));
                            }}
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
