import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Calendar,
  CheckCircle2,
  Clock,
  Printer,
  RefreshCw,
  UserCheck,
  UserX,
  XCircle,
} from "lucide-react";
import {
  fetchMedicos,
  fetchUnidadesSaude,
  tfdCatalogoExames,
  tfdRelatorioAgendados,
  tfdTipos,
  pagData,
  type CatalogoProc,
  type ItemAgendadoRelatorio,
  type Medico,
  type MetricasAgendados,
  type TipoFila,
  type UnidadeSaude,
} from "../../services/api";
import { Button, Card, Input, Label } from "../../components/ui/primitives";
import { Combobox } from "../../components/ui/combobox";
import ExportarExcel from "../../components/ExportarExcel";

function hojeISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function somaDias(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function getPrimeiroDiaMes(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

function getUltimoDiaMes(iso: string): string {
  const [y, m] = iso.slice(0, 7).split("-").map(Number);
  const ultimo = new Date(y, m, 0).getDate();
  return `${iso.slice(0, 7)}-${String(ultimo).padStart(2, "0")}`;
}

const STATUS_ROTULOS: Record<string, { label: string; badge: string }> = {
  aguardando: { label: "Aguardando na Fila", badge: "bg-amber-100 text-amber-800 border-amber-300" },
  pendente_conferencia: { label: "Pendente Conferência", badge: "bg-yellow-100 text-yellow-800 border-yellow-300" },
  regulado: { label: "Regulado", badge: "bg-sky-100 text-sky-800 border-sky-300" },
  agendado: { label: "Agendado", badge: "bg-blue-100 text-blue-800 border-blue-200" },
  recepcionado: { label: "Recepcionado", badge: "bg-teal/15 text-teal border-teal/30" },
  realizado: { label: "Compareceu / Realizado", badge: "bg-emerald-100 text-emerald-800 border-emerald-300" },
  faltou: { label: "Faltou", badge: "bg-amber-100 text-amber-800 border-amber-300" },
  desistiu: { label: "Desistência", badge: "bg-purple-100 text-purple-800 border-purple-300" },
  cancelado: { label: "Cancelado", badge: "bg-red-100 text-red-800 border-red-200" },
};

export default function RelatorioAgendados() {
  const hoje = hojeISO();

  // Filtros de período (padrão: mês corrente)
  const [dataDe, setDataDe] = useState<string>(getPrimeiroDiaMes(hoje));
  const [dataAte, setDataAte] = useState<string>(getUltimoDiaMes(hoje));

  // Filtros secundários e segmentação (Item 6)
  const [unidadeId, setUnidadeId] = useState<string>("");
  const [medicoId, setMedicoId] = useState<string>("");
  const [statusFiltro, setStatusFiltro] = useState<string>("");
  const [tipoFila, setTipoFila] = useState<string>("");
  const [procedimentoFiltro, setProcedimentoFiltro] = useState<string>("");
  const [segmentacao, setSegmentacao] = useState<string>("");
  const [escopo, setEscopo] = useState<string>("fila");

  // Catálogos
  const [unidades, setUnidades] = useState<UnidadeSaude[]>([]);
  const [medicos, setMedicos] = useState<Medico[]>([]);
  const [tiposFila, setTiposFila] = useState<TipoFila[]>([]);
  const [catalogoProcs, setCatalogoProcs] = useState<CatalogoProc[]>([]);

  // Opções para Combobox pesquisáveis
  const opcoesUnidades = useMemo(
    () =>
      unidades.map((u) => ({
        value: String(u.id),
        label: u.nome,
        keywords: `${u.nome} ${u.cnes || ""}`,
      })),
    [unidades],
  );

  const opcoesMedicos = useMemo(
    () =>
      medicos.map((m) => ({
        value: String(m.id),
        label: m.nome,
        sub: m.crm ? `CRM ${m.crm}` : undefined,
        keywords: `${m.nome} ${m.crm || ""}`,
      })),
    [medicos],
  );

  const opcoesTipos = useMemo(
    () =>
      tiposFila.map((t) => ({
        value: t.nome,
        label: t.nome,
        keywords: t.nome,
      })),
    [tiposFila],
  );

  const opcoesProcedimentos = useMemo(() => {
    let procs = catalogoProcs;
    if (tipoFila) {
      const tfNorm = tipoFila.trim().toLowerCase();
      const filtrados = catalogoProcs.filter(
        (p) => (p.tipo_fila || "").toLowerCase() === tfNorm || (p.tipo_fila || "").toLowerCase().includes(tfNorm),
      );
      if (filtrados.length > 0) procs = filtrados;
    }
    return procs.map((p) => ({
      value: p.exame || p.nome_procedimento || "",
      label: p.exame || p.nome_procedimento || "",
      sub: p.codigo_procedimento ? `SIGTAP ${p.codigo_procedimento}` : p.especialidade || undefined,
      keywords: `${p.codigo_curto || ""} ${p.codigo_procedimento || ""} ${p.exame || ""} ${p.especialidade || ""}`,
    }));
  }, [catalogoProcs, tipoFila]);

  const opcoesStatus = useMemo(
    () => [
      { value: "aguardando", label: "Aguardando na Fila", keywords: "aguardando fila espera" },
      { value: "pendente_conferencia", label: "Pendente Conferência", keywords: "pendente conferencia" },
      { value: "regulado", label: "Regulado", keywords: "regulado" },
      { value: "agendado", label: "Agendado (Aguardando Data)", keywords: "agendado agenda" },
      { value: "recepcionado", label: "Recepcionado (Check-in)", keywords: "recepcionado checkin presenca" },
      { value: "realizado", label: "Compareceu / Realizado", keywords: "realizado compareceu" },
      { value: "faltou", label: "Faltou (Absenteísmo)", keywords: "faltou falta absenteismo" },
      { value: "desistiu", label: "Desistência", keywords: "desistiu desistencia" },
      { value: "cancelado", label: "Cancelado", keywords: "cancelado cancelamento" },
    ],
    [],
  );

  // Dados do Relatório
  const [metricas, setMetricas] = useState<MetricasAgendados>({
    total: 0,
    agendados: 0,
    recepcionados: 0,
    realizados: 0,
    faltaram: 0,
    cancelados: 0,
    taxa_comparecimento: 0,
    taxa_absenteismo: 0,
  });
  const [itens, setItens] = useState<ItemAgendadoRelatorio[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");

  // Carrega catálogos na montagem
  useEffect(() => {
    fetchUnidadesSaude().then((u) => setUnidades(u.filter((x) => x.ativo))).catch(() => {});
    fetchMedicos().then((m) => setMedicos(m.filter((x) => x.ativo))).catch(() => {});
    tfdTipos().then((t) => setTiposFila(pagData<TipoFila>(t).filter((x) => x.ativo))).catch(() => {});
    tfdCatalogoExames().then((c) => setCatalogoProcs(c || [])).catch(() => {});
  }, []);

  async function carregarRelatorio(p = page) {
    setCarregando(true);
    setErro("");
    try {
      const res = await tfdRelatorioAgendados({
        data_de: dataDe || undefined,
        data_ate: dataAte || undefined,
        unidade_id: unidadeId ? Number(unidadeId) : undefined,
        medico_id: medicoId ? Number(medicoId) : undefined,
        status: statusFiltro || undefined,
        tipo_fila: tipoFila || undefined,
        procedimento: procedimentoFiltro || undefined,
        segmentacao: segmentacao || undefined,
        escopo: escopo || undefined,
        page: p,
        limit: 100,
      });
      setMetricas(res.metricas);
      setItens(res.itens);
      setTotal(res.total);
      setPage(res.page);
      setPages(res.pages);
    } catch {
      setErro("Falha ao carregar dados do relatório. Tente novamente.");
    } finally {
      setCarregando(false);
    }
  }

  // Recarrega quando os filtros alterarem
  useEffect(() => {
    setPage(1);
    carregarRelatorio(1).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataDe, dataAte, unidadeId, medicoId, statusFiltro, tipoFila, procedimentoFiltro, segmentacao, escopo]);

  function aplicarPeriodoPredefinido(tipo: "hoje" | "esta_semana" | "semana_passada" | "este_mes" | "mes_anterior") {
    const h = hojeISO();
    if (tipo === "hoje") {
      setDataDe(h);
      setDataAte(h);
    } else if (tipo === "esta_semana") {
      const diRef = (new Date(`${h}T12:00:00`).getDay() + 6) % 7;
      const seg = somaDias(h, -diRef);
      const dom = somaDias(seg, 6);
      setDataDe(seg);
      setDataAte(dom);
    } else if (tipo === "semana_passada") {
      const diRef = (new Date(`${h}T12:00:00`).getDay() + 6) % 7;
      const seg = somaDias(h, -diRef - 7);
      const dom = somaDias(seg, 6);
      setDataDe(seg);
      setDataAte(dom);
    } else if (tipo === "este_mes") {
      setDataDe(getPrimeiroDiaMes(h));
      setDataAte(getUltimoDiaMes(h));
    } else if (tipo === "mes_anterior") {
      const [y, m] = h.slice(0, 7).split("-").map(Number);
      const mAnt = m === 1 ? 12 : m - 1;
      const yAnt = m === 1 ? y - 1 : y;
      const isoAnt = `${yAnt}-${String(mAnt).padStart(2, "0")}-01`;
      setDataDe(getPrimeiroDiaMes(isoAnt));
      setDataAte(getUltimoDiaMes(isoAnt));
    }
  }

  return (
    <div className="w-full max-w-[1720px] mx-auto space-y-6 px-3 sm:px-6 pb-16">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-sus-950 flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-teal" />
            Relatório de Solicitações e Fila por Período
          </h1>
          <p className="text-xs text-ink/60">
            Acompanhe as solicitações inseridas na fila de espera e o fluxo consolidado por período, unidade solicitante e especialidade.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <ExportarExcel
            url="/api/tfd/relatorios/agendados/exportar"
            arquivo={`relatorio_solicitacoes_fila_${dataDe}_${dataAte}`}
            rotulo="Exportar Excel"
            params={{
              data_de: dataDe || undefined,
              data_ate: dataAte || undefined,
              unidade_id: unidadeId ? Number(unidadeId) : undefined,
              medico_id: medicoId ? Number(medicoId) : undefined,
              status: statusFiltro || undefined,
              tipo_fila: tipoFila || undefined,
              procedimento: procedimentoFiltro || undefined,
              segmentacao: segmentacao || undefined,
              escopo: escopo || undefined,
            }}
          />

          <Button
            variant="outline"
            onClick={() => window.print()}
            className="text-xs flex items-center gap-1.5 shadow-xs"
          >
            <Printer className="h-4 w-4" /> Imprimir Relatório
          </Button>

          <Button
            variant="outline"
            onClick={() => carregarRelatorio(page)}
            disabled={carregando}
            className="text-xs shadow-xs"
            title="Atualizar dados"
          >
            <RefreshCw className={`h-4 w-4 ${carregando ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Cabeçalho exclusivo para impressão */}
      <div className="hidden print:block border-b-2 border-sus-900 pb-3 mb-4">
        <h2 className="font-display text-xl font-bold text-sus-950 uppercase">
          Prefeitura Municipal de Guapé · Secretaria Municipal de Saúde
        </h2>
        <p className="text-sm font-semibold text-ink/80">
          Relatório Gerencial de Solicitações e Fila por Período
        </p>
        <p className="text-xs text-ink/60 mt-1">
          Período: <strong>{dataDe ? dataDe.split("-").reverse().join("/") : "Início"}</strong> até{" "}
          <strong>{dataAte ? dataAte.split("-").reverse().join("/") : "Fim"}</strong> · Emissão:{" "}
          {new Date().toLocaleDateString("pt-BR")} às {new Date().toLocaleTimeString("pt-BR")}
        </p>
      </div>

      {/* Cards de Métricas e Indicadores de Atendimento */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Card className="p-3.5 shadow-xs border-sus-900/10">
          <p className="text-[11px] font-bold uppercase tracking-wider text-ink/60">Total Agendados</p>
          <p className="font-display text-2xl font-black text-sus-950 mt-1">{metricas.total}</p>
          <p className="text-[10px] text-ink/50 mt-0.5">no período selecionado</p>
        </Card>

        <Card className="p-3.5 shadow-xs border-emerald-300 bg-emerald-50/40">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">Compareceram</p>
            <UserCheck className="h-4 w-4 text-emerald-600" />
          </div>
          <p className="font-display text-2xl font-black text-emerald-950 mt-1">
            {metricas.realizados + metricas.recepcionados}
          </p>
          <p className="text-[10px] font-bold text-emerald-700 mt-0.5">
            {metricas.taxa_comparecimento}% de adesão
          </p>
        </Card>

        <Card className="p-3.5 shadow-xs border-amber-300 bg-amber-50/40">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wider text-amber-800">Faltas</p>
            <UserX className="h-4 w-4 text-amber-600" />
          </div>
          <p className="font-display text-2xl font-black text-amber-950 mt-1">{metricas.faltaram}</p>
          <p className="text-[10px] font-bold text-amber-700 mt-0.5">
            {metricas.taxa_absenteismo}% absenteísmo
          </p>
        </Card>

        <Card className="p-3.5 shadow-xs border-blue-200 bg-blue-50/30">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wider text-blue-800">Aguardando</p>
            <Clock className="h-4 w-4 text-blue-600" />
          </div>
          <p className="font-display text-2xl font-black text-blue-950 mt-1">{metricas.agendados}</p>
          <p className="text-[10px] text-blue-700 mt-0.5">agendados futuros</p>
        </Card>

        <Card className="p-3.5 shadow-xs border-teal/20 bg-teal/5">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wider text-teal">Recepcionados</p>
            <CheckCircle2 className="h-4 w-4 text-teal" />
          </div>
          <p className="font-display text-2xl font-black text-sus-950 mt-1">{metricas.recepcionados}</p>
          <p className="text-[10px] text-teal mt-0.5">check-in na unidade</p>
        </Card>

        <Card className="p-3.5 shadow-xs border-red-200 bg-red-50/30">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wider text-red-800">Cancelados</p>
            <XCircle className="h-4 w-4 text-red-600" />
          </div>
          <p className="font-display text-2xl font-black text-red-950 mt-1">{metricas.cancelados}</p>
          <p className="text-[10px] text-red-700 mt-0.5">desmarcados</p>
        </Card>
      </div>

      {/* Painel de Filtros Dinâmicos */}
      <Card className="p-4 shadow-xs print:hidden space-y-3">
        {/* Linha 0: Segmentação e Escopo da Demanda */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-sus-900/10">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold text-ink/70">Escopo:</span>
            <div className="inline-flex rounded-xl border border-sus-900/15 bg-sand/50 p-1">
              {[
                { id: "fila", rotulo: "Fila de Espera (Adicionados no Período)" },
                { id: "agendados", rotulo: "Agendados (Agenda)" },
                { id: "todos", rotulo: "Todos (Fila + Agendados)" },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setEscopo(opt.id)}
                  className={`rounded-lg px-3 py-1 text-xs font-bold transition ${
                    escopo === opt.id
                      ? "bg-sus-900 text-white shadow-xs"
                      : "text-sus-900 hover:bg-white"
                  }`}
                >
                  {opt.rotulo}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold text-ink/70">Segmentação:</span>
            <div className="inline-flex rounded-xl border border-sus-900/15 bg-sand/50 p-1">
              {[
                { id: "", rotulo: "Todos os Serviços" },
                { id: "consultas", rotulo: "Consultas Especializadas" },
                { id: "exames", rotulo: "Exames Especializados" },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSegmentacao(opt.id)}
                  className={`rounded-lg px-3 py-1 text-xs font-bold transition ${
                    segmentacao === opt.id
                      ? "bg-teal text-white shadow-xs"
                      : "text-sus-900 hover:bg-white"
                  }`}
                >
                  {opt.rotulo}
                </button>
              ))}
            </div>

            {(unidadeId || medicoId || statusFiltro || tipoFila || procedimentoFiltro || segmentacao || escopo !== "fila") && (
              <Button
                variant="outline"
                onClick={() => {
                  setUnidadeId("");
                  setMedicoId("");
                  setStatusFiltro("");
                  setTipoFila("");
                  setProcedimentoFiltro("");
                  setSegmentacao("");
                  setEscopo("fila");
                }}
                className="text-xs h-7 ml-2 border-sus-900/20 text-sus-900 hover:bg-sand"
              >
                Limpar Filtros
              </Button>
            )}
          </div>
        </div>

        {/* Linha 1: Seletores de Período e Atalhos Rápidos */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-sus-950 flex items-center gap-1.5">
              <Calendar className="h-4 w-4 text-teal" /> Intervalo:
            </span>
            <Input
              type="date"
              value={dataDe}
              onChange={(e) => setDataDe(e.target.value)}
              className="!w-auto !min-h-[36px] text-xs font-semibold"
            />
            <span className="text-xs text-ink/60 font-medium">até</span>
            <Input
              type="date"
              value={dataAte}
              onChange={(e) => setDataAte(e.target.value)}
              className="!w-auto !min-h-[36px] text-xs font-semibold"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-ink/50 mr-1">Atalhos:</span>
            <button
              type="button"
              onClick={() => aplicarPeriodoPredefinido("hoje")}
              className="rounded-lg border border-sus-900/10 bg-white px-2.5 py-1 text-[11px] font-bold text-sus-900 hover:bg-sand transition"
            >
              Hoje
            </button>
            <button
              type="button"
              onClick={() => aplicarPeriodoPredefinido("esta_semana")}
              className="rounded-lg border border-sus-900/10 bg-white px-2.5 py-1 text-[11px] font-bold text-sus-900 hover:bg-sand transition"
            >
              Esta Semana
            </button>
            <button
              type="button"
              onClick={() => aplicarPeriodoPredefinido("semana_passada")}
              className="rounded-lg border border-sus-900/10 bg-white px-2.5 py-1 text-[11px] font-bold text-sus-900 hover:bg-sand transition"
            >
              Semana Passada
            </button>
            <button
              type="button"
              onClick={() => aplicarPeriodoPredefinido("este_mes")}
              className="rounded-lg border border-sus-900/10 bg-white px-2.5 py-1 text-[11px] font-bold text-sus-900 hover:bg-sand transition"
            >
              Este Mês
            </button>
            <button
              type="button"
              onClick={() => aplicarPeriodoPredefinido("mes_anterior")}
              className="rounded-lg border border-sus-900/10 bg-white px-2.5 py-1 text-[11px] font-bold text-sus-900 hover:bg-sand transition"
            >
              Mês Anterior
            </button>
          </div>
        </div>

        {/* Linha 2: Filtros de Unidade, Status, Médico, Tipo e Procedimento com busca por digitação */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5 pt-2 border-t border-sus-900/10">
          <div>
            <Label className="text-[11px] text-ink/70">Unidade Solicitante / PSF</Label>
            <div className="mt-1">
              <Combobox
                value={unidadeId}
                onChange={setUnidadeId}
                options={opcoesUnidades}
                placeholder="Todas as unidades"
                searchPlaceholder="Digitar unidade…"
                allLabel="Todas as unidades"
                emptyText="Nenhuma unidade encontrada"
              />
            </div>
          </div>

          <div>
            <Label className="text-[11px] text-ink/70">Status da Solicitação</Label>
            <div className="mt-1">
              <Combobox
                value={statusFiltro}
                onChange={setStatusFiltro}
                options={opcoesStatus}
                placeholder="Todos os status"
                searchPlaceholder="Digitar status…"
                allLabel="Todos os status"
                emptyText="Nenhum status encontrado"
              />
            </div>
          </div>

          <div>
            <Label className="text-[11px] text-ink/70">Médico(a) / Profissional</Label>
            <div className="mt-1">
              <Combobox
                value={medicoId}
                onChange={setMedicoId}
                options={opcoesMedicos}
                placeholder="Todos os profissionais"
                searchPlaceholder="Digitar profissional ou CRM…"
                allLabel="Todos os profissionais"
                emptyText="Nenhum profissional encontrado"
              />
            </div>
          </div>

          <div>
            <Label className="text-[11px] text-ink/70">Tipo de Fila / Serviço</Label>
            <div className="mt-1">
              <Combobox
                value={tipoFila}
                onChange={setTipoFila}
                options={opcoesTipos}
                placeholder="Todos os tipos"
                searchPlaceholder="Digitar tipo de serviço…"
                allLabel="Todos os tipos"
                emptyText="Nenhum tipo encontrado"
              />
            </div>
          </div>

          <div>
            <Label className="text-[11px] text-ink/70">Procedimento Específico</Label>
            <div className="mt-1">
              <Combobox
                value={procedimentoFiltro}
                onChange={setProcedimentoFiltro}
                options={opcoesProcedimentos}
                placeholder="Todos os procedimentos"
                searchPlaceholder="Digitar código ou exame…"
                allLabel="Todos os procedimentos"
                emptyText="Nenhum procedimento encontrado"
              />
            </div>
          </div>
        </div>
      </Card>

      {/* Tabela de Resultados do Relatório */}
      <Card className="overflow-hidden shadow-xs">
        <div className="border-b border-sus-900/10 bg-sand/30 px-4 py-3 flex items-center justify-between">
          <span className="font-display text-xs font-bold text-sus-950">
            Registros Encontrados: {total} registro(s) no período
          </span>
          <span className="text-[11px] text-ink/60">
            Página {page} de {pages}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-sus-900/10 bg-sand/60 text-[11px] uppercase font-bold text-sus-900/70 tracking-wider">
                <th className="px-3 py-2.5">Data Pedido / Agenda</th>
                <th className="px-3 py-2.5">ID Pedido</th>
                <th className="px-3 py-2.5">Paciente</th>
                <th className="px-3 py-2.5">Procedimento / Serviço</th>
                <th className="px-3 py-2.5">Unidade (PSF)</th>
                <th className="px-3 py-2.5">Profissional</th>
                <th className="px-3 py-2.5 text-center">Status</th>
                <th className="px-3 py-2.5">Resultado / Desfecho</th>
                <th className="px-3 py-2.5">Recepção / Check-in</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sus-900/5">
              {itens.map((it) => {
                const sConf = STATUS_ROTULOS[it.status] || {
                  label: it.status,
                  badge: "bg-gray-100 text-gray-800",
                };
                return (
                  <tr key={it.id} className="hover:bg-sand/20 transition">
                    <td className="px-3 py-2.5 font-semibold text-sus-950 whitespace-nowrap">
                      {it.data_pedido && (
                        <p className="text-xs text-sus-950 font-bold">
                          Ped: {it.data_pedido.split("-").reverse().join("/")}
                        </p>
                      )}
                      {it.data_agendada ? (
                        <p className="text-[11px] text-teal font-medium">
                          Ag: {it.data_agendada.split("-").reverse().join("/")}
                          {it.hora_agendada ? ` · ${it.hora_agendada}` : ""}
                        </p>
                      ) : (
                        <p className="text-[10px] text-ink/40">Fila (não agendado)</p>
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-ink/80">{it.codigo_curto}</td>
                    <td className="px-3 py-2.5">
                      <p className="font-bold text-sus-950">{it.paciente_nome}</p>
                      {it.paciente_cpf && (
                        <p className="text-[10px] text-ink/60 font-mono">CPF: {it.paciente_cpf}</p>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="font-semibold text-sus-950">{it.exame}</p>
                      <p className="text-[10px] text-ink/60">{it.tipo_fila || it.especialidade || "—"}</p>
                    </td>
                    <td className="px-3 py-2.5 text-ink/80">{it.unidade_nome || "—"}</td>
                    <td className="px-3 py-2.5 text-ink/80">{it.medico_nome || "—"}</td>
                    <td className="px-3 py-2.5 text-center whitespace-nowrap">
                      <span
                        className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold ${sConf.badge}`}
                      >
                        {sConf.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-ink/80 max-w-xs truncate" title={it.resultado}>
                      {it.resultado ? (
                        <span className="font-medium text-emerald-950">{it.resultado}</span>
                      ) : (
                        <span className="text-ink/40 italic">Sem resultado registrado</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-[11px] text-ink/70 whitespace-nowrap">
                      {it.recepcionado_em ? (
                        <div>
                          <p className="font-semibold text-teal">{it.recepcionado_em}</p>
                          {it.recepcionado_por && (
                            <p className="text-[10px] text-ink/50">por {it.recepcionado_por}</p>
                          )}
                        </div>
                      ) : (
                        <span className="text-ink/40">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}

              {itens.length === 0 && !carregando && (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-xs text-ink/60">
                    Nenhum registro encontrado para os filtros selecionados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Paginação */}
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-sus-900/10 px-4 py-3 print:hidden">
            <Button
              variant="outline"
              onClick={() => carregarRelatorio(page - 1)}
              disabled={page <= 1}
              className="text-xs"
            >
              Anterior
            </Button>
            <span className="text-xs text-ink/70">
              Página <strong>{page}</strong> de <strong>{pages}</strong>
            </span>
            <Button
              variant="outline"
              onClick={() => carregarRelatorio(page + 1)}
              disabled={page >= pages}
              className="text-xs"
            >
              Próxima
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
