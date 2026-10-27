import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  Bus,
  Calendar,
  CalendarDays,
  CheckCircle2,
  Edit2,
  FlaskConical,
  Layers,
  MessageSquare,
  Minus,
  Plus,
  RotateCcw,
  Search,
  Stethoscope,
  Trash2,
  User,
  X,
} from "lucide-react";
import {
  filaPsfCriar,
  filaPsfAtualizar,
  filaPsfExcluir,
  filaPsfListar,
  filaPsfAgendarLote,
  fetchMedicos,
  fetchUnidadesSaude,
  labsListar,
  labSigtap,
  pagData,
  pagMeta,
  type FilaPsfItem,
  type Laboratorio,
  type Medico,
  type Paciente,
  type SigtapProc,
  type UnidadeSaude,
} from "../../services/api";
import { Button, Card, Input, Label } from "../../components/ui/primitives";
import Paginacao from "../../components/Paginacao";
import ExportarExcel from "../../components/ExportarExcel";
import { Combobox, type ComboOption } from "../../components/ui/combobox";
import BuscaPacienteAutocomplete from "../../components/BuscaPacienteAutocomplete";
import { useAuth } from "../../hooks/useAuth";

const MEDICO_GENERICO = "Médico da Unidade / Responsável Técnico";

function fmtData(s?: string) {
  if (!s) return "—";
  const [a, m, d] = s.slice(0, 10).split("-");
  return a && m && d ? `${d}/${m}/${a}` : s;
}

export default function FilaPsf() {
  const { user } = useAuth();
  const [lista, setLista] = useState<FilaPsfItem[]>([]);
  const [unidades, setUnidades] = useState<UnidadeSaude[]>([]);
  const [medicos, setMedicos] = useState<Medico[]>([]);
  const [labs, setLabs] = useState<Laboratorio[]>([]);

  // Modais
  const [modalAberto, setModalAberto] = useState(false);
  const [itemEditando, setItemEditando] = useState<FilaPsfItem | null>(null);

  const [modalLote, setModalLote] = useState(false);
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set());
  const [loteLabId, setLoteLabId] = useState("");
  const [loteData, setLoteData] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [loteHora, setLoteHora] = useState("07:00");
  const [loteInstrucoes, setLoteInstrucoes] = useState("");
  const [loteEnviarWhatsapp, setLoteEnviarWhatsapp] = useState(true);
  const [loteSalvando, setLoteSalvando] = useState(false);

  // Form de Pedido (Criar / Editar)
  const [pacienteSelecionado, setPacienteSelecionado] = useState<Paciente | null>(null);
  const [form, setForm] = useState({
    paciente_id: "",
    unidade_psf: "",
    medico: MEDICO_GENERICO,
    data_solicitacao: new Date().toISOString().slice(0, 10),
    justificativa: "",
    obs: "",
  });

  // Procedimentos SIGTAP (Exames de Sangue)
  const [buscaSig, setBuscaSig] = useState("");
  const [sigtap, setSigtap] = useState<SigtapProc[]>([]);
  const [itens, setItens] = useState<{ sigtap: SigtapProc; quantidade: number }[]>([]);

  useEffect(() => {
    if (!modalAberto) return;
    const t = setTimeout(() => {
      labSigtap(buscaSig.trim() || undefined)
        .then((r) => setSigtap(pagData<SigtapProc>(r)))
        .catch(() => setSigtap([]));
    }, 250);
    return () => clearTimeout(t);
  }, [buscaSig, modalAberto]);

  function adicionarSig(s: SigtapProc) {
    setItens((prev) => {
      const idx = prev.findIndex((i) => i.sigtap.id === s.id);
      if (idx >= 0) {
        const cp = [...prev];
        cp[idx] = { ...cp[idx], quantidade: cp[idx].quantidade + 1 };
        return cp;
      }
      return [...prev, { sigtap: s, quantidade: 1 }];
    });
  }

  function removerItem(sigtapId: number) {
    setItens((prev) => prev.filter((i) => i.sigtap.id !== sigtapId));
  }

  function setQtd(sigtapId: number, qtd: number) {
    if (qtd <= 0) return removerItem(sigtapId);
    setItens((prev) =>
      prev.map((i) => (i.sigtap.id === sigtapId ? { ...i, quantidade: Math.min(99, qtd) } : i))
    );
  }

  const totalItens = itens.reduce((acc, i) => acc + i.quantidade, 0);

  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [salvando, setSalvando] = useState(false);
  const [carregando, setCarregando] = useState(false);

  // Filtros Avançados da Fila
  const [termoBusca, setTermoBusca] = useState("");
  const [filtroUnidade, setFiltroUnidade] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("todos");
  const [dataDe, setDataDe] = useState("");
  const [dataAte, setDataAte] = useState("");

  async function carregar(p = page) {
    setCarregando(true);
    setErro("");
    try {
      const r = await filaPsfListar({
        status: filtroStatus !== "todos" ? filtroStatus : undefined,
        unidade: filtroUnidade || undefined,
        data_de: dataDe || undefined,
        data_ate: dataAte || undefined,
        q: termoBusca.trim() || undefined,
        page: p,
        limit: 100,
      });
      setLista(pagData<FilaPsfItem>(r));
      const m = pagMeta(r);
      setTotal(m.total);
      setPage(m.page);
      setPages(m.pages);
    } catch {
      setErro("Falha ao carregar fila de exames.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    fetchUnidadesSaude()
      .then((u) => setUnidades(u.filter((x) => x.ativo)))
      .catch(() => {});
    fetchMedicos({ somente_ativos: true })
      .then((m) => setMedicos(m.filter((x) => x.ativo)))
      .catch(() => {});
    labsListar()
      .then((l) => {
        const ativ = l.filter((x) => x.ativo);
        setLabs(ativ);
        if (ativ.length > 0) setLoteLabId(String(ativ[0].id));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    carregar(1);
  }, [filtroStatus, filtroUnidade, dataDe, dataAte]);

  useEffect(() => {
    const t = setTimeout(() => {
      carregar(1);
    }, 300);
    return () => clearTimeout(t);
  }, [termoBusca]);

  function limparFiltros() {
    setTermoBusca("");
    setFiltroUnidade("");
    setFiltroStatus("todos");
    setDataDe("");
    setDataAte("");
  }

  const temFiltroAtivo = Boolean(
    termoBusca.trim() || filtroUnidade || filtroStatus !== "todos" || dataDe || dataAte
  );

  function set(k: string, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // Preenche unidade padrão pelo perfil do usuário logado
  const unidPadraoUsuario = useMemo(() => {
    if (user?.unidade_saude_id) {
      const u = unidades.find((x) => x.id === user.unidade_saude_id);
      if (u) return u.nome;
    }
    return user?.unidade_saude_nome || "";
  }, [unidades, user]);

  function abrirModalNovo() {
    setItemEditando(null);
    setPacienteSelecionado(null);
    setItens([]);
    setBuscaSig("");
    setForm({
      paciente_id: "",
      unidade_psf: unidPadraoUsuario || (unidades[0]?.nome ?? ""),
      medico: MEDICO_GENERICO,
      data_solicitacao: new Date().toISOString().slice(0, 10),
      justificativa: "",
      obs: "",
    });
    setErro("");
    setModalAberto(true);
  }

  function abrirModalEditar(item: FilaPsfItem) {
    setItemEditando(item);
    setPacienteSelecionado({
      id: item.paciente_id,
      nome: item.paciente_nome,
      cpf: item.paciente_cpf || "",
      cns: item.paciente_cns || "",
      prontuario: item.paciente_prontuario || "",
    } as unknown as Paciente);
    setItens(
      (item.sigtap_ids || []).map((id, idx) => ({
        sigtap: {
          id,
          codigo: "",
          descricao: (item.exames_nomes && item.exames_nomes[idx]) || `Exame SIGTAP #${id}`,
        } as SigtapProc,
        quantidade: 1,
      }))
    );
    setBuscaSig("");
    setForm({
      paciente_id: String(item.paciente_id),
      unidade_psf: item.unidade_psf || "",
      medico: item.medico || MEDICO_GENERICO,
      data_solicitacao: item.data_solicitacao || new Date().toISOString().slice(0, 10),
      justificativa: item.justificativa || "",
      obs: item.obs || "",
    });
    setErro("");
    setModalAberto(true);
  }

  function fecharModal() {
    setModalAberto(false);
    setItemEditando(null);
  }

  // Opções para o Combobox de Filtro de Unidades (inclui "Todas")
  const opcoesFiltroUnidades = useMemo<ComboOption[]>(() => {
    return [
      { value: "", label: "🏥 Todas as unidades / PSFs", sub: "Sem filtro de unidade" },
      ...unidades.map((u) => ({
        value: u.nome,
        label: u.nome,
        sub: u.cnes ? `CNES: ${u.cnes}` : undefined,
      })),
    ];
  }, [unidades]);

  // Opções para o Combobox de Unidades (Formulário)
  const opcoesUnidades = useMemo<ComboOption[]>(() => {
    return unidades.map((u) => ({
      value: u.nome,
      label: u.nome,
      sub: u.cnes ? `CNES: ${u.cnes}` : undefined,
    }));
  }, [unidades]);

  // Opções para o Combobox de Médicos
  const opcoesMedicos = useMemo<ComboOption[]>(() => {
    const opts: ComboOption[] = [
      {
        value: MEDICO_GENERICO,
        label: `🏥 ${MEDICO_GENERICO}`,
        sub: "Padrão para postos de saúde da família (PSF)",
      },
    ];
    medicos.forEach((m) => {
      if (!m.nome.includes("Responsável Técnico") && !m.nome.includes("Médico da Unidade")) {
        opts.push({
          value: m.nome,
          label: m.nome,
          sub: m.crm ? `CRM: ${m.crm}${m.cbo_codigo ? ` · CBO: ${m.cbo_codigo}` : ""}` : undefined,
        });
      }
    });
    return opts;
  }, [medicos]);

  async function salvarPedido() {
    setErro("");
    setOk("");
    if (!form.paciente_id) {
      setErro("Selecione o paciente através da busca inteligente.");
      return;
    }
    if (!form.data_solicitacao) {
      setErro("Informe a data do pedido.");
      return;
    }
    if (!form.unidade_psf.trim()) {
      setErro("Selecione o PSF / unidade de origem solicitante.");
      return;
    }
    if (!form.medico.trim()) {
      setErro("Selecione o médico requisitante.");
      return;
    }
    if (itens.length === 0) {
      setErro("Selecione pelo menos um exame SIGTAP para adicionar ao pedido.");
      return;
    }
    if (form.justificativa.trim().length < 12) {
      setErro("A justificativa clínica deve conter no mínimo 12 caracteres.");
      return;
    }

    const sigtap_ids: number[] = [];
    itens.forEach((it) => {
      for (let i = 0; i < it.quantidade; i++) {
        sigtap_ids.push(it.sigtap.id);
      }
    });

    setSalvando(true);
    try {
      if (itemEditando) {
        await filaPsfAtualizar(itemEditando.id, {
          unidade_psf: form.unidade_psf.trim(),
          medico: form.medico.trim(),
          data_solicitacao: form.data_solicitacao,
          justificativa: form.justificativa.trim(),
          obs: form.obs.trim(),
          sigtap_ids,
        });
        setOk(`Pedido de ${itemEditando.paciente_nome} atualizado com sucesso.`);
      } else {
        await filaPsfCriar({
          paciente_id: Number(form.paciente_id),
          unidade_psf: form.unidade_psf.trim(),
          medico: form.medico.trim(),
          data_solicitacao: form.data_solicitacao,
          justificativa: form.justificativa.trim(),
          obs: form.obs.trim(),
          sigtap_ids,
        });
        setOk("Pedido incluído na fila de exames com sucesso.");
      }
      fecharModal();
      await carregar();
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Erro ao salvar pedido na fila.");
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(id: number) {
    if (!confirm("Remover este pedido da fila de exames?")) return;
    try {
      await filaPsfExcluir(id);
      setOk("Pedido removido da fila.");
      setSelecionados((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
      await carregar();
    } catch {
      setErro("Erro ao remover pedido.");
    }
  }

  // Lógica de seleção múltipla
  function toggleSelecionado(id: number) {
    setSelecionados((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function toggleSelecionarTodos() {
    if (selecionados.size === lista.length && lista.length > 0) {
      setSelecionados(new Set());
    } else {
      setSelecionados(new Set(lista.map((x) => x.id)));
    }
  }

  async function executarAgendamentoLote() {
    if (selecionados.size === 0) return;
    if (!loteLabId) {
      alert("Selecione o laboratório conveniado.");
      return;
    }
    if (!loteData) {
      alert("Selecione a data do agendamento.");
      return;
    }

    setLoteSalvando(true);
    try {
      const res = await filaPsfAgendarLote({
        fila_ids: Array.from(selecionados),
        laboratorio_id: Number(loteLabId),
        data_agendada: loteData,
        hora_agendada: loteHora || "07:00",
        enviar_whatsapp: loteEnviarWhatsapp,
        instrucoes_transporte: loteInstrucoes.trim(),
      });
      setModalLote(false);
      setSelecionados(new Set());
      setOk(
        `Marcação em lote concluída com sucesso! ${res.total_agendados || selecionados.size} paciente(s) agendado(s).`
      );
      await carregar();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Erro ao realizar marcação em lote.");
    } finally {
      setLoteSalvando(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Barra de Cabeçalho e Ações Principais */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h2 className="font-display text-xl font-bold text-sus-950">
            Fila de exames
          </h2>
          <span className="rounded-full bg-teal/10 px-3 py-0.5 text-xs font-semibold text-teal">
            {total > 0 ? total : lista.length} aguardando
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 ml-auto">
          <ExportarExcel
            url="/api/exames/fila-psf/exportar"
            arquivo={selecionados.size > 0 ? `fila_exames_selecionados_${selecionados.size}` : "fila_exames_filtrada"}
            rotulo={selecionados.size > 0 ? `Exportar selecionados (${selecionados.size})` : "Exportar Excel"}
            params={{
              ...(selecionados.size > 0 ? { ids: Array.from(selecionados).join(",") } : {}),
              ...(filtroStatus !== "todos" ? { status: filtroStatus } : {}),
              ...(filtroUnidade ? { unidade: filtroUnidade } : {}),
              ...(dataDe ? { data_de: dataDe } : {}),
              ...(dataAte ? { data_ate: dataAte } : {}),
              ...(termoBusca.trim() ? { q: termoBusca.trim() } : {}),
            }}
          />

          {/* Botão de Agendamento em Lote */}
          <Button
            onClick={() => setModalLote(true)}
            disabled={selecionados.size === 0}
            className={`border border-teal bg-white text-teal hover:bg-teal/10 shadow-xs ${
              selecionados.size > 0 ? "border-2 border-teal font-bold" : ""
            }`}
          >
            <Layers className="h-4 w-4" />
            {selecionados.size > 0
              ? `Marcar lote (${selecionados.size} selecionados)`
              : "Marcar lote mensal"}
          </Button>

          {/* Botão Principal para abrir Dialog de Novo Pedido */}
          <Button onClick={abrirModalNovo} className="flex items-center gap-1.5 shadow-sm">
            <Plus className="h-4 w-4" /> Novo pedido na fila
          </Button>
        </div>
      </div>

      {erro && (
        <p className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700 font-medium">
          {erro}
        </p>
      )}
      {ok && (
        <p className="rounded-xl bg-teal/10 px-4 py-2.5 text-sm text-teal font-medium">
          {ok}
        </p>
      )}

      {/* Barra de Filtros: Período, PSF e Busca de Paciente */}
      <Card className="p-4 sm:p-5 border-sus-900/10 shadow-xs space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          {/* Busca Geral / Paciente */}
          <div className="md:col-span-4">
            <Label className="text-xs font-bold text-sus-950 flex items-center gap-1.5 mb-1.5">
              <Search className="h-3.5 w-3.5 text-teal" /> Paciente ou Procedimento
            </Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink/40" />
              <Input
                value={termoBusca}
                onChange={(e) => setTermoBusca(e.target.value)}
                placeholder="Nome do paciente, CPF, prontuário ou exame…"
                className="pl-9 h-10 text-xs bg-white"
              />
              {termoBusca && (
                <button
                  type="button"
                  onClick={() => setTermoBusca("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink/40 hover:text-ink/80 transition"
                  title="Limpar busca"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Busca por PSF / Unidade de Origem */}
          <div className="md:col-span-3">
            <Label className="text-xs font-bold text-sus-950 flex items-center gap-1.5 mb-1.5">
              <Building2 className="h-3.5 w-3.5 text-teal" /> PSF / Unidade
            </Label>
            <Combobox
              value={filtroUnidade}
              onChange={setFiltroUnidade}
              options={opcoesFiltroUnidades}
              placeholder="Todas as unidades / PSFs…"
              searchPlaceholder="Digite o nome do PSF…"
              emptyText="Nenhuma unidade encontrada"
              showAll={false}
              className="h-10 text-xs"
            />
          </div>

          {/* Período: Data Inicial e Data Final */}
          <div className="md:col-span-3">
            <Label className="text-xs font-bold text-sus-950 flex items-center gap-1.5 mb-1.5">
              <Calendar className="h-3.5 w-3.5 text-teal" /> Período da Solicitação
            </Label>
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="date"
                value={dataDe}
                onChange={(e) => setDataDe(e.target.value)}
                title="Data inicial do pedido"
                className="h-10 text-xs"
              />
              <Input
                type="date"
                value={dataAte}
                onChange={(e) => setDataAte(e.target.value)}
                title="Data final do pedido"
                className="h-10 text-xs"
              />
            </div>
          </div>

          {/* Status e Ações */}
          <div className="md:col-span-2 flex items-center gap-2">
            <div className="flex-1">
              <Label className="text-xs font-bold text-sus-950 mb-1.5 block">
                Status
              </Label>
              <select
                value={filtroStatus}
                onChange={(e) => setFiltroStatus(e.target.value)}
                className="h-10 w-full rounded-xl border border-sus-900/15 bg-white px-2.5 text-xs font-medium text-sus-950 outline-none transition focus:border-teal"
              >
                <option value="todos">Todos</option>
                <option value="na_fila">Na Fila (Aguardando)</option>
                <option value="agendado">Agendado</option>
              </select>
            </div>

            {temFiltroAtivo && (
              <Button
                type="button"
                onClick={limparFiltros}
                className="h-10 px-3 bg-white border border-sus-900/15 text-sus-900 hover:bg-sand text-xs mt-auto shrink-0"
                title="Limpar todos os filtros"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* Resumo dos filtros ativos */}
        <div className="flex flex-wrap items-center justify-between text-[11px] text-ink/60 pt-2 border-t border-sus-900/5 gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span>
              Exibindo <strong>{lista.length}</strong> de <strong>{total}</strong> pedido(s) na fila
            </span>
            {carregando && (
              <span className="text-teal font-semibold animate-pulse flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-teal animate-ping" />
                Atualizando lista…
              </span>
            )}
          </div>

          {temFiltroAtivo && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-teal font-medium">Filtros ativos:</span>
              {filtroUnidade && (
                <span className="rounded-md bg-teal/10 px-1.5 py-0.5 text-teal font-semibold">
                  PSF: {filtroUnidade}
                </span>
              )}
              {(dataDe || dataAte) && (
                <span className="rounded-md bg-teal/10 px-1.5 py-0.5 text-teal font-semibold">
                  Período: {dataDe ? fmtData(dataDe) : "Início"} até {dataAte ? fmtData(dataAte) : "Hoje"}
                </span>
              )}
              {termoBusca.trim() && (
                <span className="rounded-md bg-teal/10 px-1.5 py-0.5 text-teal font-semibold">
                  Busca: "{termoBusca.trim()}"
                </span>
              )}
              {filtroStatus !== "todos" && (
                <span className="rounded-md bg-teal/10 px-1.5 py-0.5 text-teal font-semibold">
                  Status: {filtroStatus}
                </span>
              )}
              <button
                type="button"
                onClick={limparFiltros}
                className="text-xs text-red-600 hover:underline font-semibold ml-1"
              >
                Limpar
              </button>
            </div>
          )}
        </div>
      </Card>

      {/* Tabela de Pedidos na Fila */}
      <Card className="overflow-hidden border-sus-900/10 shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-sus-900/10 bg-sand text-xs uppercase text-sus-900/60">
                <th className="px-4 py-3 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={lista.length > 0 && selecionados.size === lista.length}
                    onChange={toggleSelecionarTodos}
                    className="h-4 w-4 rounded border-sus-900/20 text-teal focus:ring-teal"
                    title="Selecionar todos os pedidos desta página"
                  />
                </th>
                <th className="px-4 py-3 font-semibold">Data Pedido</th>
                <th className="px-4 py-3 font-semibold">Paciente</th>
                <th className="px-4 py-3 font-semibold">PSF / Origem</th>
                <th className="px-4 py-3 font-semibold">Médico Requisitante</th>
                <th className="px-4 py-3 font-semibold">Exames Solicitados</th>
                <th className="px-4 py-3 font-semibold">Justificativa / Obs</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 text-right font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((f) => {
                const isSelected = selecionados.has(f.id);
                return (
                  <tr
                    key={f.id}
                    className={`border-b border-sus-900/5 last:border-0 hover:bg-sand/30 transition ${
                      isSelected ? "bg-teal/5" : ""
                    }`}
                  >
                    <td className="px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelecionado(f.id)}
                        className="h-4 w-4 rounded border-sus-900/20 text-teal focus:ring-teal"
                      />
                    </td>
                    <td className="px-4 py-3 text-xs font-semibold text-sus-950 whitespace-nowrap">
                      {fmtData(f.data_solicitacao)}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-sus-950">{f.paciente_nome}</p>
                      <div className="flex items-center gap-2 text-xs text-ink/50">
                        {f.paciente_cpf && <span>CPF: {f.paciente_cpf}</span>}
                        {f.paciente_prontuario && <span>Pront.: {f.paciente_prontuario}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-ink/75 font-medium">{f.unidade_psf}</td>
                    <td className="px-4 py-3 text-xs text-ink/75">{f.medico}</td>
                    <td className="px-4 py-3 text-xs max-w-xs">
                      {f.exames_nomes && f.exames_nomes.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {f.exames_nomes.map((nome, idx) => (
                            <span
                              key={idx}
                              className="inline-block rounded-md bg-teal/10 px-1.5 py-0.5 text-[10px] font-semibold text-teal"
                              title={nome}
                            >
                              {nome}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-ink/40 text-[11px]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink/65 max-w-xs">
                      {f.justificativa && (
                        <p className="font-medium text-sus-950 truncate" title={f.justificativa}>
                          {f.justificativa}
                        </p>
                      )}
                      {f.obs && <p className="italic text-[11px] truncate" title={f.obs}>{f.obs}</p>}
                      {!f.justificativa && !f.obs && "—"}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span className="rounded-md bg-amber-50 px-2 py-0.5 font-semibold text-amber-700 border border-amber-200">
                        {f.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => abrirModalEditar(f)}
                          className="rounded-lg p-1.5 text-teal hover:bg-teal/10 transition"
                          title="Editar pedido"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => excluir(f.id)}
                          className="rounded-lg p-1.5 text-red-600 hover:bg-red-50 transition"
                          title="Remover da fila"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {lista.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-ink/45">
                    Nenhum pedido aguardando na fila de exames.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Paginacao
          page={page}
          pages={pages}
          total={total}
          onPage={(p) => carregar(p).catch(() => setErro("Falha ao carregar fila."))}
        />
      </Card>

      {/* DIALOG (MODAL) PARA NOVO OU EDITAR PEDIDO NA FILA */}
      {modalAberto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-sus-950/60 p-3 sm:p-5"
          onClick={fecharModal}
        >
          <div
            className="rise max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white p-6 sm:p-8 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Cabeçalho do Dialog */}
            <div className="mb-5 flex items-start justify-between border-b border-sus-900/10 pb-4">
              <div>
                <h3 className="font-display text-lg font-bold text-sus-950 flex items-center gap-2">
                  <FlaskConical className="h-5 w-5 text-teal" />
                  {itemEditando ? "Editar pedido na fila de exames" : "Novo pedido na fila de exames"}
                </h3>
                <p className="mt-1 text-xs text-ink/65">
                  Os pedidos lançados pelos PSFs aguardam o loteamento mensal de vagas gerido pela Secretaria de Saúde.
                </p>
              </div>
              <button
                type="button"
                onClick={fecharModal}
                className="rounded-xl p-2 text-ink/50 hover:bg-sand transition"
                title="Fechar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Formulário Simétrico e Padronizado */}
            <div className="space-y-4">
              {/* Seção 1: Paciente e Origem do Pedido */}
              <div className="rounded-2xl border border-sus-900/10 p-4 space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wide text-sus-900/70 flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5 text-teal" /> 1. Paciente e Origem do Pedido
                </h4>

                <BuscaPacienteAutocomplete
                  pacienteId={form.paciente_id}
                  pacienteInicial={pacienteSelecionado}
                  onSelect={(p) => {
                    setPacienteSelecionado(p);
                    set("paciente_id", p ? String(p.id) : "");
                  }}
                  label="Paciente"
                  obrigatorio
                />

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
                  <div>
                    <div className="flex items-center min-h-[26px] mb-1.5">
                      <Label className="!mb-0 flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5 text-teal" /> Data do Pedido *
                      </Label>
                    </div>
                    <Input
                      type="date"
                      value={form.data_solicitacao}
                      onChange={(e) => set("data_solicitacao", e.target.value)}
                    />
                    <p className="mt-1.5 text-[11px] text-ink/50">
                      Data da requisição médica.
                    </p>
                  </div>

                  <div>
                    <div className="flex items-center min-h-[26px] mb-1.5">
                      <Label className="!mb-0 flex items-center gap-1.5">
                        <Building2 className="h-3.5 w-3.5 text-teal" /> PSF / Unidade *
                      </Label>
                    </div>
                    <Combobox
                      value={form.unidade_psf}
                      onChange={(v) => set("unidade_psf", v)}
                      options={opcoesUnidades}
                      placeholder="Buscar unidade de saúde…"
                      searchPlaceholder="Digite o nome da unidade…"
                      emptyText="Nenhuma unidade encontrada"
                      showAll={false}
                    />
                    {user?.unidade_saude_nome && form.unidade_psf === user.unidade_saude_nome ? (
                      <p className="mt-1.5 text-[11px] text-teal font-medium">
                        ✓ Unidade vinculada ao seu usuário
                      </p>
                    ) : (
                      <p className="mt-1.5 text-[11px] text-ink/50">
                        Posto de saúde requisitante.
                      </p>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center justify-between min-h-[26px] mb-1.5">
                      <Label className="!mb-0 flex items-center gap-1.5">
                        <Stethoscope className="h-3.5 w-3.5 text-teal" /> Médico(a) *
                      </Label>
                      <button
                        type="button"
                        onClick={() => set("medico", MEDICO_GENERICO)}
                        className="inline-flex items-center rounded-md bg-teal/10 px-2 py-0.5 text-[10px] font-bold text-teal hover:bg-teal/20 transition"
                        title="Redefinir para Médico da Unidade"
                      >
                        🏥 Médico Unidade
                      </button>
                    </div>
                    <Combobox
                      value={form.medico}
                      onChange={(v) => set("medico", v)}
                      options={opcoesMedicos}
                      placeholder="Buscar médico requisitante…"
                      searchPlaceholder="Digite o nome do médico ou CRM…"
                      emptyText="Nenhum médico encontrado"
                      showAll={false}
                    />
                    <p className="mt-1.5 text-[11px] text-ink/50">
                      Médico(a) solicitante.
                    </p>
                  </div>
                </div>
              </div>

              {/* Seção 2: Procedimentos SIGTAP (Exames de Sangue) */}
              <div className="rounded-2xl border border-sus-900/10 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wide text-sus-900/70 flex items-center gap-1.5">
                    <FlaskConical className="h-3.5 w-3.5 text-teal" /> 2. Procedimentos SIGTAP *
                  </h4>
                  <span className="text-xs font-bold text-teal">
                    {totalItens} {totalItens === 1 ? "exame adicionado" : "exames adicionados"}
                  </span>
                </div>

                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-ink/40" />
                  <Input
                    className="pl-9"
                    placeholder="Buscar código ou nome do exame laboratorial na tabela SIGTAP…"
                    value={buscaSig}
                    onChange={(e) => setBuscaSig(e.target.value)}
                  />
                </div>

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
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {itens.map((i) => (
                    <div
                      key={i.sigtap.id}
                      className="flex items-center gap-2 rounded-xl border border-sus-900/10 bg-white p-2 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-sus-950">
                          <b>{i.sigtap.codigo || `#${i.sigtap.id}`}</b> · {i.sigtap.descricao}
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
                      Nenhum exame adicionado ao pedido ainda. Pesquise e adicione acima.
                    </p>
                  )}
                </div>
              </div>

              {/* Seção 3: Justificativa Clínica e Observações */}
              <div className="rounded-2xl border border-sus-900/10 p-4 space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <Label className="!mb-0">3. Justificativa Clínica do Pedido *</Label>
                    <span
                      className={`text-[11px] font-bold ${
                        form.justificativa.trim().length < 12 ? "text-amber-600" : "text-teal"
                      }`}
                    >
                      {form.justificativa.trim().length}/12 caracteres mínimos
                    </span>
                  </div>
                  <textarea
                    rows={3}
                    maxLength={500}
                    value={form.justificativa}
                    onChange={(e) => set("justificativa", e.target.value)}
                    placeholder="Informe a indicação/justificativa clínica do pedido de exames (mínimo de 12 caracteres)..."
                    className={`w-full rounded-xl border bg-white px-3 py-2 text-xs outline-none transition focus:border-teal ${
                      form.justificativa.length > 0 && form.justificativa.trim().length < 12
                        ? "border-red-400 focus:border-red-500"
                        : "border-sus-900/15"
                    }`}
                  />
                  {form.justificativa.trim().length > 0 && form.justificativa.trim().length < 12 && (
                    <p className="mt-1 text-[11px] text-red-600 font-medium">
                      A justificativa deve conter pelo menos 12 caracteres para validar o pedido.
                    </p>
                  )}
                </div>

                <div>
                  <Label>Observações Adicionais (opcional)</Label>
                  <Input
                    placeholder="Orientações específicas, sintomas, prioridades…"
                    value={form.obs}
                    onChange={(e) => set("obs", e.target.value)}
                  />
                </div>
              </div>

              {erro && (
                <div className="rounded-xl bg-red-50 p-3 text-xs text-red-700 font-medium">
                  {erro}
                </div>
              )}

              {/* Botões do Rodapé */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-sus-900/10">
                <Button
                  type="button"
                  onClick={fecharModal}
                  className="border border-sus-900/15 bg-white text-ink hover:bg-sand"
                >
                  Cancelar
                </Button>
                <Button onClick={salvarPedido} disabled={salvando}>
                  <CheckCircle2 className="h-4 w-4" />
                  {salvando
                    ? "Salvando…"
                    : itemEditando
                    ? "Salvar alterações"
                    : "Confirmar inclusão na fila"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE AGENDAMENTO EM LOTE MENSAL */}
      {modalLote && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-sus-950/60 p-3 sm:p-5"
          onClick={() => setModalLote(false)}
        >
          <div
            className="rise max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between border-b border-sus-900/10 pb-3">
              <div>
                <h3 className="font-display text-base font-bold text-sus-950 flex items-center gap-2">
                  <Layers className="h-5 w-5 text-teal" />
                  Marcação mensal em lote ({selecionados.size} pedidos)
                </h3>
                <p className="mt-0.5 text-xs text-ink/65">
                  Agende os pedidos selecionados para o laboratório conveniado de destino.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalLote(false)}
                className="rounded-xl p-2 text-ink/50 hover:bg-sand transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <Label>Laboratório Conveniado *</Label>
                <select
                  value={loteLabId}
                  onChange={(e) => setLoteLabId(e.target.value)}
                  className="w-full h-11 rounded-xl border border-sus-900/15 bg-white px-3.5 text-sm outline-none focus:border-teal"
                >
                  {labs.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.nome} {l.cnes ? `(CNES: ${l.cnes})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Data do Agendamento *</Label>
                  <Input
                    type="date"
                    value={loteData}
                    onChange={(e) => setLoteData(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Horário da Coleta</Label>
                  <Input
                    type="text"
                    value={loteHora}
                    onChange={(e) => setLoteHora(e.target.value)}
                    placeholder="07:00"
                  />
                </div>
              </div>

              <div>
                <Label className="flex items-center gap-1.5">
                  <Bus className="h-3.5 w-3.5 text-teal" />
                  Instruções Adicionais / Transporte para o Paciente
                </Label>
                <textarea
                  value={loteInstrucoes}
                  onChange={(e) => setLoteInstrucoes(e.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder="Ex: Aguardar na prefeitura às 07h para o transporte do exame..."
                  className="w-full rounded-xl border border-sus-900/15 bg-white p-2.5 text-xs outline-none focus:border-teal"
                />
                <p className="mt-0.5 text-[10px] text-ink/50">
                  Esse texto será incluído automaticamente no comprovante impresso e na mensagem do WhatsApp.
                </p>
              </div>

              <div className="rounded-xl border border-emerald-500/20 bg-emerald-50/50 p-3">
                <label className="flex items-center gap-2.5 text-xs font-semibold text-emerald-950 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={loteEnviarWhatsapp}
                    onChange={(e) => setLoteEnviarWhatsapp(e.target.checked)}
                    className="h-4 w-4 rounded border-emerald-400 text-teal focus:ring-teal"
                  />
                  <MessageSquare className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span>Enviar confirmação via WhatsApp para os pacientes selecionados</span>
                </label>
              </div>

              <div className="rounded-xl bg-sand/40 p-3 border border-sus-900/10">
                <p className="font-bold text-sus-950 mb-1">
                  Pacientes selecionados para agendamento ({selecionados.size}):
                </p>
                <ul className="list-disc pl-4 space-y-0.5 text-[11px] text-ink/75 max-h-36 overflow-y-auto">
                  {lista
                    .filter((x) => selecionados.has(x.id))
                    .map((x) => (
                      <li key={x.id}>
                        <strong>{x.paciente_nome}</strong> · {x.unidade_psf}
                      </li>
                    ))}
                </ul>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-sus-900/10">
                <Button
                  type="button"
                  onClick={() => setModalLote(false)}
                  className="border border-sus-900/15 bg-white text-ink hover:bg-sand"
                >
                  Cancelar
                </Button>
                <Button onClick={executarAgendamentoLote} disabled={loteSalvando}>
                  <CalendarDays className="h-4 w-4" />
                  {loteSalvando ? "Processando lote..." : "Confirmar Agendamento em Lote"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
