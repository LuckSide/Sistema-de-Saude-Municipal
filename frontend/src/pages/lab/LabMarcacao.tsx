import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock,
  FlaskConical,
  Minus,
  Plus,
  Printer,
  Search,
  Stethoscope,
  Trash2,
  User,
  X,
  XCircle,
} from "lucide-react";
import {
  examesSolicitarLote,
  fetchMedicos,
  fetchUnidadesSaude,
  labsListar,
  labSigtap,
  tfdPacientes,
  vagasGrade,
  pagData,
  solicitarListar,
  mapMestre,
  labCancelarSolicitacao,
  type Laboratorio,
  type Medico,
  type Paciente,
  type SigtapProc,
  type UnidadeSaude,
  type VagaDia,
  type SolicMestre,
} from "../../services/api";
import { Button, Card, Input, Label } from "../../components/ui/primitives";
import GradeDias from "../../components/GradeDias";
import MonthPicker from "../../components/MonthPicker";
import { Combobox, type ComboOption } from "../../components/ui/combobox";
import BuscaPacienteAutocomplete from "../../components/BuscaPacienteAutocomplete";
import ComprovanteExameModal from "../../components/ComprovanteExameModal";
import { useAuth } from "../../hooks/useAuth";

type ItemLote = { sigtap: SigtapProc; quantidade: number };

export default function LabMarcacao() {
  const { user } = useAuth();
  const [labs, setLabs] = useState<Laboratorio[]>([]);
  const [medicos, setMedicos] = useState<Medico[]>([]);
  const [unidades, setUnidades] = useState<UnidadeSaude[]>([]);
  const [modal, setModal] = useState(false);
  const [buscaPac, setBuscaPac] = useState("");
  const [pacientes, setPacientes] = useState<Paciente[]>([]);
  const [pacienteId, setPacienteId] = useState("");
  const [pacienteSelecionado, setPacienteSelecionado] = useState<Paciente | null>(null);
  const [unidadeId, setUnidadeId] = useState("");
  const [medicoId, setMedicoId] = useState("");
  const [justificativa, setJustificativa] = useState("");
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
  const [salvando, setSalvando] = useState(false);

  // Busca Inteligente de Pedidos Agendados
  const [termoBusca, setTermoBusca] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [pedidosEncontrados, setPedidosEncontrados] = useState<SolicMestre[]>([]);
  const [comprovanteModalId, setComprovanteModalId] = useState<number | null>(null);

  useEffect(() => {
    const q = termoBusca.trim();
    if (!q) {
      setPedidosEncontrados([]);
      setBuscando(false);
      return;
    }
    setBuscando(true);
    const t = setTimeout(() => {
      solicitarListar({ q, limit: 50 })
        .then((r) => {
          const arr = pagData<any>(r);
          setPedidosEncontrados(arr.map(mapMestre));
        })
        .catch(() => {
          setPedidosEncontrados([]);
        })
        .finally(() => {
          setBuscando(false);
        });
    }, 300);
    return () => clearTimeout(t);
  }, [termoBusca]);

  useEffect(() => {
    labsListar()
      .then((l) => {
        const ativos = l.filter((x) => x.ativo);
        setLabs(ativos);
        if (ativos.length) setLabId((atual) => atual || String(ativos[0].id));
      })
      .catch(() => {});
    fetchMedicos({ somente_ativos: true })
      .then((m) => setMedicos(m.filter((x) => x.ativo)))
      .catch(() => {});
    fetchUnidadesSaude()
      .then((u) => setUnidades(u.filter((x) => x.ativo)))
      .catch(() => {});
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
      tfdPacientes(buscaPac.trim() || undefined, 1, 100)
        .then((r) => setPacientes(pagData<Paciente>(r)))
        .catch(() => {});
      labSigtap(buscaSig.trim() || undefined)
        .then((r) => setSigtap(pagData<SigtapProc>(r)))
        .catch(() => setSigtap([]));
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

  const medicosFiltrados = useMemo(() => {
    const ativos = medicos.filter((m) => m.ativo);
    if (!unidadeId) return { daUnidade: ativos, outros: [], temFiltro: false };
    const uid = Number(unidadeId);
    const daUnidade = ativos.filter((m) => m.unidades_ids && m.unidades_ids.includes(uid));
    const outros = ativos.filter((m) => !m.unidades_ids || !m.unidades_ids.includes(uid));
    return { daUnidade, outros, temFiltro: true };
  }, [medicos, unidadeId]);

  const isOperadorPsf = Boolean(user?.unidade_saude_id && !user?.is_superuser);

  const opcoesUnidades = useMemo<ComboOption[]>(() => {
    return unidades.map((u) => ({
      value: String(u.id),
      label: u.nome,
      sub: u.cnes ? `CNES: ${u.cnes}` : undefined,
    }));
  }, [unidades]);

  const opcoesMedicos = useMemo<ComboOption[]>(() => {
    const opts: ComboOption[] = [
      {
        value: "GENERICO_UNIDADE",
        label: "🏥 Médico da Unidade / Responsável Técnico",
        sub: "Padrão da rede municipal",
      },
    ];
    if (medicosFiltrados.temFiltro && medicosFiltrados.daUnidade.length > 0) {
      medicosFiltrados.daUnidade.forEach((m) => {
        if (!m.nome.includes("Responsável Técnico") && !m.nome.includes("Médico da Unidade")) {
          opts.push({
            value: String(m.id),
            label: `⭐ ${m.nome}`,
            sub: m.crm ? `CRM: ${m.crm} (Vinculado à unidade)` : "Vinculado à unidade",
          });
        }
      });
      medicosFiltrados.outros.forEach((m) => {
        if (!m.nome.includes("Responsável Técnico") && !m.nome.includes("Médico da Unidade")) {
          opts.push({
            value: String(m.id),
            label: m.nome,
            sub: m.crm ? `CRM: ${m.crm}` : undefined,
          });
        }
      });
    } else {
      medicos.forEach((m) => {
        if (!m.nome.includes("Responsável Técnico") && !m.nome.includes("Médico da Unidade")) {
          opts.push({
            value: String(m.id),
            label: m.nome,
            sub: m.crm ? `CRM: ${m.crm}` : undefined,
          });
        }
      });
    }
    return opts;
  }, [medicos, medicosFiltrados]);

  const opcoesLabs = useMemo<ComboOption[]>(() => {
    return labs
      .filter((l) => l.ativo)
      .map((l) => ({
        value: String(l.id),
        label: l.nome,
      }));
  }, [labs]);

  function abrirModalNovo() {
    setPacienteId("");
    setPacienteSelecionado(null);
    setJustificativa("");
    setItens([]);
    setBuscaSig("");
    setDiaSel("");
    setErro("");
    // Padrão de unidade na marcação direta: Secretaria de Saúde
    const sec = unidades.find(
      (u) =>
        u.nome.toLowerCase().includes("secretaria") ||
        u.nome.toLowerCase().includes("central")
    ) || unidades[0];
    setUnidadeId(sec ? String(sec.id) : "");
    setMedicoId("GENERICO_UNIDADE");
    setModal(true);
  }

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
    setPacienteSelecionado(null);
    setUnidadeId("");
    setMedicoId("");
    setJustificativa("");
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
      setErro("Adicione ao menos um procedimento laboratorial SIGTAP.");
      return;
    }
    if (!justificativa || justificativa.trim().length < 12) {
      setErro("A justificativa clínica do pedido é obrigatória e deve ter pelo menos 12 caracteres.");
      return;
    }
    // Data é estritamente obrigatória p/ exame de sangue/laboratório.
    if (!diaSel) {
      setErro("Escolha o dia da marcação no calendário (data obrigatória).");
      return;
    }
    if (!labId) {
      setErro("Escolha o laboratório responsável.");
      return;
    }
    if (sel && sel.total > 0 && sel.livres <= 0) {
      setErro("Dia sem vaga livre no laboratório. Escolha outro dia no calendário.");
      return;
    }

    setSalvando(true);
    try {
      const isGenerico = medicoId === "GENERICO_UNIDADE";
      const medGenerico = medicos.find(
        (m) =>
          m.nome.toLowerCase().includes("responsável técnico") ||
          m.nome.toLowerCase().includes("responsavel tecnico") ||
          m.nome.toLowerCase().includes("médico da unidade") ||
          m.nome.toLowerCase().includes("medico da unidade")
      );
      const med = isGenerico ? medGenerico : medicos.find((m) => String(m.id) === medicoId);
      const uni = unidades.find((u) => String(u.id) === unidadeId);

      await examesSolicitarLote({
        paciente_id: Number(pacienteId),
        data_agendada: diaSel,
        laboratorio_id: Number(labId),
        itens: itens.map((i) => ({ sigtap_id: i.sigtap.id, quantidade: i.quantidade })),
        medico_id: isGenerico ? medGenerico?.id : (medicoId ? Number(medicoId) : undefined),
        medico_solicitante: isGenerico ? "Médico da Unidade / Responsável Técnico" : med?.nome,
        unidade_saude_id: unidadeId ? Number(unidadeId) : undefined,
        unidade_psf: uni?.nome,
        justificativa: justificativa.trim(),
      });
      fecharModal();
      setOk(`${totalItens} exame(s) agendado(s) com sucesso para o dia ${diaSel.split("-").reverse().join("/")}.`);
      if (pacienteSelecionado?.nome) {
        setTermoBusca(pacienteSelecionado.nome);
      }
      await carregarGrade();
    } catch (e: any) {
      setErro(e?.response?.data?.detail ?? "Erro ao salvar. Confira vagas livres no dia.");
    } finally {
      setSalvando(false);
    }
  }

  async function cancelarPedido(id: number) {
    if (!confirm(`Deseja realmente cancelar o agendamento do pedido #${id}?`)) return;
    try {
      await labCancelarSolicitacao(id);
      setOk(`Pedido #${id} cancelado com sucesso.`);
      setPedidosEncontrados((atual) =>
        atual.map((p) => (p.id === id ? { ...p, status: "cancelado" } : p))
      );
    } catch {
      setErro("Falha ao cancelar agendamento.");
    }
  }

  return (
    <div className="space-y-6">
      {/* Topo Limpo: Título e Botão Principal */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-sus-950">
            Marcação de exames de sangue
          </h2>
          <p className="text-xs text-ink/65">
            Localize pedidos agendados para emitir o comprovante com orientações de preparo ou efetue novas marcações.
          </p>
        </div>
        <Button onClick={abrirModalNovo} className="flex items-center gap-1.5 shadow-sm">
          <Plus className="h-4 w-4" /> Nova solicitação de exame
        </Button>
      </div>

      {erro && !modal && (
        <p className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700 font-medium">
          {erro}
        </p>
      )}
      {ok && (
        <p className="rounded-xl bg-teal/10 px-4 py-2.5 text-sm text-teal font-medium">
          {ok}
        </p>
      )}

      {/* Campo Centralizado de Busca Inteligente de Pedidos */}
      <Card className="p-4 sm:p-5 border-sus-900/10 shadow-xs">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-teal" />
          <Input
            value={termoBusca}
            onChange={(e) => setTermoBusca(e.target.value)}
            placeholder="Buscar por nome do paciente, CPF, CNS, prontuário ou nº do pedido (#)..."
            className="pl-11 pr-10 h-12 text-sm sm:text-base bg-sand/20 border-sus-900/15 focus:bg-white"
          />
          {termoBusca && (
            <button
              onClick={() => setTermoBusca("")}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-ink/40 hover:text-ink/80 transition"
              title="Limpar busca"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] text-ink/50 px-1">
          <span>Busca em tempo real de pacientes agendados</span>
          {buscando && <span className="font-medium text-teal animate-pulse">Pesquisando pedidos…</span>}
        </div>
      </Card>

      {/* Resultados da Pesquisa ou Estado Inicial Informativo */}
      {termoBusca.trim() ? (
        <div>
          {buscando ? (
            <div className="py-12 text-center text-ink/50">
              <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-teal border-t-transparent mb-2" />
              <p className="text-xs">Consultando agendamentos...</p>
            </div>
          ) : pedidosEncontrados.length === 0 ? (
            <Card className="p-8 text-center border-dashed">
              <Search className="mx-auto h-8 w-8 text-ink/30 mb-2" />
              <p className="text-sm font-semibold text-sus-950">Nenhum agendamento encontrado</p>
              <p className="mt-1 text-xs text-ink/55">
                Não encontramos pedidos para o termo "{termoBusca}". Verifique a digitação ou realize uma nova solicitação.
              </p>
              <Button onClick={abrirModalNovo} className="mt-4 border border-sus-900/20 bg-white text-sus-950 hover:bg-sand !h-9 text-xs">
                <Plus className="h-4 w-4" /> Nova solicitação de exame
              </Button>
            </Card>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-wider text-sus-900/70">
                  {pedidosEncontrados.length} agendamento(s) encontrado(s)
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {pedidosEncontrados.map((m) => (
                  <Card key={m.id} className="p-5 border-sus-900/10 hover:border-teal/30 transition shadow-xs flex flex-col justify-between">
                    <div>
                      {/* Topo do Card */}
                      <div className="flex items-start justify-between gap-2 border-b border-sus-900/10 pb-3 mb-3">
                        <div>
                          <h3 className="font-bold text-sus-950 text-base leading-snug">
                            {m.paciente_nome}
                          </h3>
                          <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-ink/65">
                            {m.paciente_cpf && <span>CPF: {m.paciente_cpf}</span>}
                            {m.paciente_prontuario && <span>Pront.: {m.paciente_prontuario}</span>}
                            {m.unidade_psf && (
                              <span className="rounded bg-sand px-1.5 py-0.5 font-medium text-sus-900">
                                {m.unidade_psf}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="font-mono text-xs font-bold text-ink/60">#{m.id}</span>
                          <div>
                            <span
                              className={`mt-1 inline-block rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${
                                m.status === "coletado"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : m.status === "cancelado"
                                  ? "bg-red-100 text-red-700"
                                  : "bg-teal/15 text-teal"
                              }`}
                            >
                              {m.status || "agendado"}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Informações de Agendamento */}
                      <div className="grid grid-cols-2 gap-2 text-xs mb-3 bg-sand/30 p-2.5 rounded-xl border border-sus-900/5">
                        <div>
                          <span className="text-[10px] text-ink/50 block">Data Agendada</span>
                          <span className="font-semibold text-sus-950">
                            {String(m.data_agendada).slice(0, 10).split("-").reverse().join("/")}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-ink/50 block">Horário Coleta</span>
                          <span className="font-semibold text-sus-950">
                            {m.hora_agendada || "07:00 às 09:00"}
                          </span>
                        </div>
                        <div className="col-span-2">
                          <span className="text-[10px] text-ink/50 block">Laboratório</span>
                          <span className="font-semibold text-teal">{m.laboratorio}</span>
                        </div>
                        {m.medico_solicitante && (
                          <div className="col-span-2">
                            <span className="text-[10px] text-ink/50 block">Médico Solicitante</span>
                            <span className="text-ink/75">Dr(a). {m.medico_solicitante}</span>
                          </div>
                        )}
                      </div>

                      {/* Exames Solicitados */}
                      <div className="mb-3">
                        <p className="text-[11px] font-bold uppercase text-sus-900/70 mb-1">
                          Exames Solicitados ({m.itens?.length || 0})
                        </p>
                        <div className="space-y-1">
                          {(m.itens || []).map((it: any, idx) => (
                            <div
                              key={idx}
                              className="text-xs text-ink/80 flex items-center justify-between border-b border-sus-900/5 pb-0.5"
                            >
                              <span className="truncate mr-2">
                                <span className="font-mono text-[10px] text-ink/50 mr-1">
                                  {it.codigo || it.procedimento_codigo}
                                </span>
                                {it.descricao || it.procedimento_descricao}
                              </span>
                              {it.quantidade > 1 && (
                                <span className="text-[10px] font-bold text-teal bg-teal/10 px-1.5 rounded">
                                  ×{it.quantidade}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Orientações de Preparo Clínico */}
                      <div className="rounded-lg bg-amber-50/70 p-2 text-[11px] text-amber-900 border border-amber-200/50 mb-4">
                        <span className="font-bold">⏱️ Jejum:</span> {m.jejum_horas || "8 a 12 horas"}
                      </div>
                    </div>

                    {/* Ações do Card */}
                    <div className="flex items-center justify-between pt-3 border-t border-sus-900/10 gap-2">
                      <Button
                        type="button"
                        onClick={() => setComprovanteModalId(m.id)}
                        className="flex-1 flex items-center justify-center gap-1.5 !h-9 text-xs bg-teal hover:bg-teal/90"
                      >
                        <Printer className="h-3.5 w-3.5" /> Imprimir Comprovante
                      </Button>

                      {m.status !== "cancelado" && m.status !== "coletado" && (
                        <Button
                          type="button"
                          onClick={() => cancelarPedido(m.id)}
                          className="border border-red-200 bg-white text-red-600 hover:bg-red-50 !h-9 text-xs"
                          title="Cancelar Agendamento"
                        >
                          <XCircle className="h-3.5 w-3.5" /> Cancelar
                        </Button>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Estado Inicial Limpo: Orientação sem poluição de lista desnecessária */
        <Card className="p-8 text-center border border-sus-900/10 bg-sand/10">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-teal/10 text-teal mb-3">
            <FlaskConical className="h-7 w-7" />
          </div>
          <h3 className="font-display text-base font-bold text-sus-950">
            Consulta de Agendamentos e Emissão de Comprovantes
          </h3>
          <p className="mx-auto mt-1 max-w-lg text-xs text-ink/65 leading-relaxed">
            Utilize o campo de busca inteligente acima para localizar qualquer pedido agendado por <strong>nome do paciente</strong>, <strong>CPF</strong>, <strong>prontuário</strong> ou <strong>número do pedido (#)</strong> para emitir o comprovante com horários e orientações de preparo ou realizar o cancelamento.
          </p>
          <div className="mt-5 flex justify-center">
            <Button onClick={abrirModalNovo} className="flex items-center gap-1.5 shadow-sm">
              <Plus className="h-4 w-4" /> Nova solicitação de exame
            </Button>
          </div>
        </Card>
      )}

      {/* Modal Redesenhado em 2 Colunas */}
      {modal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/60 p-3 sm:p-5" onClick={fecharModal}>
          <div
            className="rise max-h-[92vh] w-full max-w-6xl overflow-auto rounded-3xl bg-white p-5 sm:p-7 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Cabeçalho */}
            <div className="mb-5 flex items-start justify-between border-b border-sus-900/10 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <div className="rounded-xl bg-teal/10 p-2 text-teal">
                    <CalendarDays className="h-5 w-5" />
                  </div>
                  <h3 className="font-display text-lg sm:text-xl font-bold text-sus-950">
                    Marcação de exames de sangue
                  </h3>
                </div>
                <p className="mt-1 text-xs text-ink/65">
                  Preencha os dados clínicos e selecione o laboratório e o dia disponível no calendário integrado.
                </p>
              </div>
              <button
                onClick={fecharModal}
                className="rounded-xl p-2 text-ink/50 hover:bg-sand transition"
                aria-label="Fechar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Aviso Contextual para Operadores de PSF */}
            {isOperadorPsf && (
              <div className="mb-5 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900 flex items-start gap-3 shadow-xs">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                <div className="flex-1">
                  <p className="font-bold text-amber-950">
                    Aviso ao Operador do PSF ({user?.unidade_saude_nome || "Posto de Saúde"}):
                  </p>
                  <p className="mt-0.5 text-amber-800">
                    O fluxo padrão da sua unidade é o lançamento de pedidos na <strong>Fila de exames</strong>. A Marcação Direta realiza o agendamento imediato de cotas laboratoriais geridas pela regulação/Secretaria de Saúde.
                  </p>
                  <div className="mt-2">
                    <Link
                      to="/lab/fila"
                      className="inline-flex items-center gap-1 font-bold text-sus-900 underline hover:text-sus-700"
                    >
                      Acessar Fila de exames da unidade →
                    </Link>
                  </div>
                </div>
              </div>
            )}

            {/* Layout em 2 Colunas */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              {/* Coluna da Esquerda: Formulário do Pedido */}
              <div className="space-y-4">
                <div className="rounded-2xl border border-sus-900/10 bg-sand/20 p-4 space-y-3.5">
                  <h4 className="text-xs font-bold uppercase tracking-wide text-sus-900/70 flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5 text-teal" /> 1. Paciente e Origem do Pedido
                  </h4>

                  {/* Busca Inteligente do Paciente (Sem dropdown select tradicional) */}
                  <BuscaPacienteAutocomplete
                    pacienteId={pacienteId}
                    pacienteInicial={pacienteSelecionado}
                    onSelect={(p) => {
                      setPacienteSelecionado(p);
                      setPacienteId(p ? String(p.id) : "");
                    }}
                    label="Paciente"
                    obrigatorio
                  />

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                    <div>
                      <div className="flex items-center justify-between min-h-[26px] mb-1.5">
                        <Label className="!mb-0 flex items-center gap-1.5">
                          <Building2 className="h-3.5 w-3.5 text-teal" /> PSF / Unidade Solicitante
                        </Label>
                      </div>
                      <Combobox
                        value={unidadeId}
                        onChange={setUnidadeId}
                        options={opcoesUnidades}
                        placeholder="Buscar unidade / Secretaria…"
                        searchPlaceholder="Digite o nome da unidade…"
                        emptyText="Nenhuma unidade encontrada"
                        showAll={false}
                      />
                      <p className="mt-1.5 text-[11px] text-ink/50">
                        Padrão: Secretaria de Saúde (regulação central).
                      </p>
                    </div>

                    <div>
                      <div className="flex items-center justify-between min-h-[26px] mb-1.5">
                        <Label className="!mb-0 flex items-center gap-1.5">
                          <Stethoscope className="h-3.5 w-3.5 text-teal" /> Médico(a) Requisitante
                        </Label>
                        <button
                          type="button"
                          onClick={() => setMedicoId("GENERICO_UNIDADE")}
                          className="inline-flex items-center rounded-md bg-teal/10 px-2 py-0.5 text-[10px] font-bold text-teal hover:bg-teal/20 transition"
                          title="Definir Médico da Unidade"
                        >
                          🏥 Médico da Unidade
                        </button>
                      </div>
                      <Combobox
                        value={medicoId}
                        onChange={setMedicoId}
                        options={opcoesMedicos}
                        placeholder="Buscar médico requisitante…"
                        searchPlaceholder="Digite o nome do médico ou CRM…"
                        emptyText="Nenhum médico encontrado"
                        showAll={false}
                      />
                      <p className="mt-1.5 text-[11px] text-ink/50">
                        Padrão: Médico da Unidade / Resp. Técnico.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Exames Laboratoriais SIGTAP */}
                <div className="rounded-2xl border border-sus-900/10 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wide text-sus-900/70 flex items-center gap-1.5">
                      <FlaskConical className="h-3.5 w-3.5 text-teal" /> 2. Procedimentos SIGTAP *
                    </h4>
                    <span className="text-xs font-bold text-teal">
                      {totalItens} {totalItens === 1 ? "exame adicionado" : "exames adicionados"}
                    </span>
                  </div>

                  <Input
                    placeholder="Buscar código ou nome do exame laboratorial…"
                    value={buscaSig}
                    onChange={(e) => setBuscaSig(e.target.value)}
                  />

                  {/* Resultados da busca */}
                  <div className="max-h-36 space-y-1 overflow-auto rounded-xl border border-sus-900/10 p-2 bg-sand/30">
                    {sigtap.slice(0, 30).map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => adicionarSig(s)}
                        className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-white transition"
                      >
                        <Plus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal" />
                        <span>
                          <b>{s.codigo}</b> · {s.descricao}
                        </span>
                      </button>
                    ))}
                    {buscaSig.trim() && sigtap.length === 0 && (
                      <p className="py-2 text-center text-xs text-ink/45">
                        Nenhum exame encontrado para "{buscaSig}".
                      </p>
                    )}
                    {!buscaSig.trim() && sigtap.length === 0 && (
                      <p className="py-2 text-center text-xs text-ink/45">
                        Digite para buscar exames laboratoriais na tabela SIGTAP.
                      </p>
                    )}
                  </div>

                  {/* Lista de itens selecionados */}
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {itens.map((i) => (
                      <div
                        key={i.sigtap.id}
                        className="flex items-center gap-2 rounded-xl border border-sus-900/10 bg-white p-2 text-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold">
                            <b>{i.sigtap.codigo}</b> · {i.sigtap.descricao}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setQtd(i.sigtap.id, i.quantidade - 1)}
                            className="rounded-lg p-1 text-sus-900 hover:bg-sand"
                            title="Diminuir"
                          >
                            <Minus className="h-3 w-3" />
                          </button>
                          <input
                            type="number"
                            min={1}
                            max={99}
                            value={i.quantidade}
                            onChange={(e) => setQtd(i.sigtap.id, Number(e.target.value))}
                            className="w-12 rounded-lg border border-sus-900/15 px-1.5 py-0.5 text-center text-xs font-bold"
                          />
                          <button
                            type="button"
                            onClick={() => setQtd(i.sigtap.id, i.quantidade + 1)}
                            className="rounded-lg p-1 text-sus-900 hover:bg-sand"
                            title="Aumentar"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => removerItem(i.sigtap.id)}
                          className="rounded-lg p-1 text-red-600 hover:bg-red-50"
                          title="Excluir item"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                    {itens.length === 0 && (
                      <p className="rounded-xl bg-sand/60 px-3 py-2.5 text-center text-xs text-ink/50">
                        Nenhum exame adicionado ao pedido ainda.
                      </p>
                    )}
                  </div>
                </div>

                {/* Justificativa do Pedido */}
                <div className="rounded-2xl border border-sus-900/10 p-4">
                  <div className="flex items-center justify-between mb-1.5">
                    <Label className="!mb-0">Justificativa Clínica do Pedido *</Label>
                    <span
                      className={`text-[11px] font-bold ${
                        justificativa.trim().length < 12 ? "text-amber-600" : "text-teal"
                      }`}
                    >
                      {justificativa.trim().length}/12 caracteres mínimos
                    </span>
                  </div>
                  <textarea
                    rows={3}
                    maxLength={500}
                    value={justificativa}
                    onChange={(e) => setJustificativa(e.target.value)}
                    placeholder="Informe a indicação/justificativa clínica do pedido de exames (mínimo de 12 caracteres)..."
                    className={`w-full rounded-xl border bg-white px-3 py-2 text-xs outline-none transition focus:border-teal ${
                      justificativa.length > 0 && justificativa.trim().length < 12
                        ? "border-red-400 focus:border-red-500"
                        : "border-sus-900/15"
                    }`}
                  />
                  {justificativa.trim().length > 0 && justificativa.trim().length < 12 && (
                    <p className="mt-1 text-[11px] text-red-600 font-medium">
                      A justificativa deve conter pelo menos 12 caracteres para validar o pedido.
                    </p>
                  )}
                </div>
              </div>

              {/* Coluna da Direita: Calendário e Agendamento */}
              <div className="space-y-4">
                <div className="rounded-2xl border border-sus-900/10 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wide text-sus-950 flex items-center gap-1.5">
                      <Clock className="h-4 w-4 text-teal" /> 3. Calendário · Seleção de Vaga
                    </h4>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                    <div>
                      <div className="flex items-center min-h-[26px] mb-1.5">
                        <Label className="!mb-0">Mês de Referência</Label>
                      </div>
                      <MonthPicker value={month} onChange={setMonth} />
                      <p className="mt-1.5 text-[11px] text-ink/50">
                        Navegue pelos meses para ver cotas.
                      </p>
                    </div>
                    <div>
                      <div className="flex items-center min-h-[26px] mb-1.5">
                        <Label className="!mb-0">Laboratório Conveniado *</Label>
                      </div>
                      <Combobox
                        value={labId}
                        onChange={setLabId}
                        options={opcoesLabs}
                        placeholder="Buscar laboratório conveniado…"
                        searchPlaceholder="Digite o nome do laboratório…"
                        emptyText="Nenhum laboratório encontrado"
                        showAll={false}
                      />
                      <p className="mt-1.5 text-[11px] text-ink/50">
                        {labNome ? `Laboratório ativo: ${labNome}` : "Selecione o laboratório executor."}
                      </p>
                    </div>
                  </div>

                  {/* Calendário Interativo */}
                  <div className="rounded-xl border border-sus-900/10 bg-sand/30 p-2.5">
                    <GradeDias
                      month={month}
                      mapa={mapa}
                      diaSel={diaSel}
                      bloqueado={!labId}
                      onSelect={setDia}
                    />
                  </div>

                  {/* Resumo da vaga do dia */}
                  <div
                    className={`rounded-xl p-3 text-xs transition ${
                      !diaSel
                        ? "bg-sand/60 text-ink/65"
                        : sel && sel.livres > 0
                        ? "bg-teal/10 border border-teal/20 text-teal font-medium"
                        : "bg-red-50 border border-red-200 text-red-700 font-medium"
                    }`}
                  >
                    {!labId ? (
                      <p>Selecione um laboratório para visualizar as vagas livres no mês.</p>
                    ) : !diaSel ? (
                      <p>Clique em uma data verde no calendário para selecionar o dia da coleta.</p>
                    ) : (
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-bold text-sus-950">
                            Data selecionada: {diaSel.split("-").reverse().join("/")}
                          </p>
                          <p className="text-[11px] text-ink/65">{labNome}</p>
                        </div>
                        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold shadow-sm">
                          {sel ? `${sel.livres} de ${sel.total} vagas livres` : "Sem dados de vagas"}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Card de Resumo e Ação */}
                <div className="rounded-2xl border border-sus-900/10 bg-sand/20 p-4 space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wide text-sus-900/70">
                    Resumo da Solicitação
                  </h4>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-ink/50">Paciente:</span>
                      <p className="font-bold text-sus-950 truncate">
                        {pacienteSelecionado?.nome || pacientes.find((p) => String(p.id) === pacienteId)?.nome || "—"}
                      </p>
                    </div>
                    <div>
                      <span className="text-ink/50">Data da Coleta:</span>
                      <p className="font-bold text-sus-950">
                        {diaSel ? diaSel.split("-").reverse().join("/") : "—"}
                      </p>
                    </div>
                    <div>
                      <span className="text-ink/50">Unidade PSF:</span>
                      <p className="font-semibold text-ink/80 truncate">
                        {unidades.find((u) => String(u.id) === unidadeId)?.nome || "Não informada"}
                      </p>
                    </div>
                    <div>
                      <span className="text-ink/50">Médico:</span>
                      <p className="font-semibold text-ink/80 truncate">
                        {medicoId === "GENERICO_UNIDADE"
                          ? "🏥 Médico da Unidade / Responsável Técnico"
                          : medicos.find((m) => String(m.id) === medicoId)?.nome || "Não informado"}
                      </p>
                    </div>
                    <div className="col-span-2">
                      <span className="text-ink/50">Procedimentos:</span>
                      <p className="font-bold text-teal">
                        {totalItens} exame{totalItens === 1 ? "" : "s"} selecionado{totalItens === 1 ? "" : "s"}
                      </p>
                    </div>
                  </div>

                  {erro && (
                    <div className="rounded-xl bg-red-50 p-3 text-xs font-medium text-red-700 flex items-start gap-2">
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>{erro}</span>
                    </div>
                  )}

                  <Button
                    onClick={salvar}
                    disabled={
                      salvando ||
                      !pacienteId ||
                      itens.length === 0 ||
                      !diaSel ||
                      justificativa.trim().length < 12
                    }
                    className="w-full !py-3 text-sm font-bold"
                  >
                    {salvando ? (
                      <>Processando agendamento…</>
                    ) : (
                      <>
                        <CheckCircle2 className="h-4 w-4" /> Confirmar Marcação Direta
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Modal de Impressão do Comprovante Oficial com Preparo */}
      {comprovanteModalId && (
        <ComprovanteExameModal
          solicitacaoId={comprovanteModalId}
          onClose={() => setComprovanteModalId(null)}
        />
      )}
    </div>
  );
}
