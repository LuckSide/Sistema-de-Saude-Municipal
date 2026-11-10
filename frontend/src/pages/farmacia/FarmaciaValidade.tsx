import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Clock,
  Calendar,
  Search,
  CheckCircle2,
  Trash2,
  Pill,
  RefreshCw,
  Edit2,
  X,
  Layers,
  ShieldAlert,
} from "lucide-react";
import {
  farmaciaValidadeListar,
  farmaciaMedicamentoMovimentar,
  farmaciaMedicamentoAtualizar,
  type MedicamentoOut,
} from "../../services/api";
import { Button, Card, Input, Label } from "../../components/ui/primitives";
import ExportarExcel from "../../components/ExportarExcel";

type TabFiltro = "todos" | "vencidos" | "proximos" | "ok";

export default function FarmaciaValidade() {
  const [medicamentos, setMedicamentos] = useState<MedicamentoOut[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState("");
  const [abaAtiva, setAbaAtiva] = useState<TabFiltro>("todos");
  const [categoriaFiltro, setCategoriaFiltro] = useState("");

  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState("");

  // Modal de Baixa / Descarte de Item Vencido
  const [modalBaixaAberto, setModalBaixaAberto] = useState(false);
  const [medSelecionado, setMedSelecionado] = useState<MedicamentoOut | null>(null);
  const [qtdBaixa, setQtdBaixa] = useState<number>(0);
  const [motivoBaixa, setMotivoBaixa] = useState("Vencimento do lote");
  const [obsBaixa, setObsBaixa] = useState("");
  const [salvandoBaixa, setSalvandoBaixa] = useState(false);

  // Modal de Atualização de Validade/Lote
  const [modalEditarAberto, setModalEditarAberto] = useState(false);
  const [novoLote, setNovoLote] = useState("");
  const [novaValidade, setNovaValidade] = useState("");
  const [novaLocalizacao, setNovaLocalizacao] = useState("");
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);

  async function carregarDados() {
    setCarregando(true);
    setErro("");
    try {
      const lista = await farmaciaValidadeListar({ apenas_atencao: false });
      setMedicamentos(lista);
    } catch {
      setErro("Falha ao carregar controle de validade.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregarDados();
  }, []);

  // Contagens dos cards de métricas
  const totalVencidos = medicamentos.filter((m) => m.status_validade === "VENCIDO").length;
  const totalProximos = medicamentos.filter((m) => m.status_validade === "PROXIMO_VENCIMENTO").length;
  const totalEmDia = medicamentos.filter((m) => m.status_validade === "VALIDO").length;
  const totalGeral = medicamentos.length;

  // Filtragem
  const filtrados = medicamentos.filter((m) => {
    if (abaAtiva === "vencidos" && m.status_validade !== "VENCIDO") return false;
    if (abaAtiva === "proximos" && m.status_validade !== "PROXIMO_VENCIMENTO") return false;
    if (abaAtiva === "ok" && m.status_validade !== "VALIDO") return false;

    if (categoriaFiltro && m.categoria !== categoriaFiltro) return false;

    if (busca.trim()) {
      const t = busca.toLowerCase();
      const matchNome = m.nome.toLowerCase().includes(t);
      const matchPrincipio = (m.principio_ativo || "").toLowerCase().includes(t);
      const matchCodigo = m.codigo.toLowerCase().includes(t);
      const matchLote = (m.lote || "").toLowerCase().includes(t);
      return matchNome || matchPrincipio || matchCodigo || matchLote;
    }

    return true;
  });

  // Categorias disponíveis
  const categoriasUnicas = Array.from(new Set(medicamentos.map((m) => m.categoria).filter(Boolean)));

  // Abertura do modal de descarte
  function abrirModalBaixa(med: MedicamentoOut) {
    setMedSelecionado(med);
    setQtdBaixa(med.estoque_atual);
    setMotivoBaixa(
      med.status_validade === "VENCIDO"
        ? "Descarte por expiração da data de validade"
        : "Descarte por avaria ou término da vida útil"
    );
    setObsBaixa(`Lote ${med.lote || "N/D"} - Validade ${med.validade || "N/D"}`);
    setModalBaixaAberto(true);
  }

  async function confirmarBaixa(e: React.FormEvent) {
    e.preventDefault();
    if (!medSelecionado) return;
    if (qtdBaixa <= 0) {
      setErro("A quantidade para baixa deve ser maior que zero.");
      return;
    }
    if (qtdBaixa > medSelecionado.estoque_atual) {
      setErro(`A quantidade excede o estoque atual (${medSelecionado.estoque_atual} ${medSelecionado.unidade_medida}).`);
      return;
    }

    setSalvandoBaixa(true);
    setErro("");
    try {
      await farmaciaMedicamentoMovimentar({
        medicamento_id: medSelecionado.id,
        tipo: "SAIDA_PERDA",
        quantidade: qtdBaixa,
        lote: medSelecionado.lote || "",
        validade: medSelecionado.validade || undefined,
        motivo_descarte: motivoBaixa,
        observacoes: obsBaixa,
      });

      setSucesso(`Baixa de descarte do lote ${medSelecionado.lote || ""} registrada com sucesso!`);
      setTimeout(() => setSucesso(""), 4000);
      setModalBaixaAberto(false);
      carregarDados();
    } catch (err: unknown) {
      const axErr = err as { response?: { data?: { detail?: string } } };
      setErro(axErr.response?.data?.detail || "Erro ao registrar descarte do medicamento.");
    } finally {
      setSalvandoBaixa(false);
    }
  }

  // Abertura do modal de edição de lote/validade
  function abrirModalEditar(med: MedicamentoOut) {
    setMedSelecionado(med);
    setNovoLote(med.lote || "");
    setNovaValidade(med.validade || "");
    setNovaLocalizacao(med.localizacao_prateleira || "");
    setModalEditarAberto(true);
  }

  async function confirmarEdicao(e: React.FormEvent) {
    e.preventDefault();
    if (!medSelecionado) return;

    setSalvandoEdicao(true);
    setErro("");
    try {
      await farmaciaMedicamentoAtualizar(medSelecionado.id, {
        lote: novoLote,
        validade: novaValidade || null,
        localizacao_prateleira: novaLocalizacao,
      });

      setSucesso("Dados de lote e validade atualizados com sucesso!");
      setTimeout(() => setSucesso(""), 4000);
      setModalEditarAberto(false);
      carregarDados();
    } catch (err: unknown) {
      const axErr = err as { response?: { data?: { detail?: string } } };
      setErro(axErr.response?.data?.detail || "Erro ao atualizar dados de validade.");
    } finally {
      setSalvandoEdicao(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-sus-900">Controle de Validade & Lotes</h1>
              <p className="text-sm text-sus-900/60">
                Monitoramento com alertas visuais por cor e contagem regressiva dinâmica
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ExportarExcel
            url="/api/farmacia/validade/exportar"
            arquivo="farmacia_controle_validade"
            rotulo="Exportar Relatório (.xlsx)"
          />
          <Button
            variant="outline"
            onClick={carregarDados}
            disabled={carregando}
            className="flex items-center gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${carregando ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Alertas */}
      {erro && (
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <AlertTriangle className="h-5 w-5 shrink-0 text-red-600" />
          <div className="flex-1 font-medium">{erro}</div>
          <button onClick={() => setErro("")} className="text-red-600 hover:text-red-800">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {sucesso && (
        <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
          <div className="flex-1 font-medium">{sucesso}</div>
          <button onClick={() => setSucesso("")} className="text-emerald-600 hover:text-emerald-800">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Cards de Métricas e Alertas Rápidos */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Vencidos - Alerta Vermelho */}
        <Card
          onClick={() => setAbaAtiva("vencidos")}
          className={`cursor-pointer transition-all border-2 p-5 ${
            abaAtiva === "vencidos"
              ? "border-red-500 bg-red-50/70 shadow-sm"
              : "border-red-200 bg-red-50/30 hover:border-red-300"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-red-800">
              Medicamentos Vencidos
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-100 text-red-700">
              <ShieldAlert className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-red-900">{totalVencidos}</span>
            <span className="text-xs text-red-700 font-medium">lote(s) expirado(s)</span>
          </div>
          <p className="mt-2 text-xs text-red-600">Requer baixa imediata / descarte sanitário</p>
        </Card>

        {/* Próximos do Vencimento - Alerta Amarelo */}
        <Card
          onClick={() => setAbaAtiva("proximos")}
          className={`cursor-pointer transition-all border-2 p-5 ${
            abaAtiva === "proximos"
              ? "border-amber-500 bg-amber-50/70 shadow-sm"
              : "border-amber-200 bg-amber-50/30 hover:border-amber-300"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-800">
              A Vencer (&le; 30 dias)
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
              <AlertTriangle className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-amber-900">{totalProximos}</span>
            <span className="text-xs text-amber-700 font-medium">lote(s) em atenção</span>
          </div>
          <p className="mt-2 text-xs text-amber-600">Priorizar dispensação no balcão</p>
        </Card>

        {/* Em Dia / Válidos - Verde */}
        <Card
          onClick={() => setAbaAtiva("ok")}
          className={`cursor-pointer transition-all border-2 p-5 ${
            abaAtiva === "ok"
              ? "border-emerald-500 bg-emerald-50/70 shadow-sm"
              : "border-sus-100 bg-white hover:border-emerald-200"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">
              Validade em Dia
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-emerald-900">{totalEmDia}</span>
            <span className="text-xs text-emerald-700 font-medium">lotes regulares</span>
          </div>
          <p className="mt-2 text-xs text-sus-900/50">Validade superior a 30 dias</p>
        </Card>

        {/* Total Sob Monitoramento */}
        <Card
          onClick={() => setAbaAtiva("todos")}
          className={`cursor-pointer transition-all border-2 p-5 ${
            abaAtiva === "todos"
              ? "border-teal bg-teal-50/30 shadow-sm"
              : "border-sus-100 bg-white hover:border-sus-200"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-sus-900/70">
              Total Monitorado
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-100 text-teal-800">
              <Layers className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-sus-900">{totalGeral}</span>
            <span className="text-xs text-sus-900/50 font-medium">lotes ativos</span>
          </div>
          <p className="mt-2 text-xs text-sus-900/50">Todos os medicamentos com validade</p>
        </Card>
      </div>

      {/* Barra de Filtros e Busca */}
      <Card className="p-4 space-y-4">
        {/* Abas Rápidas */}
        <div className="flex flex-wrap items-center gap-2 border-b border-sus-100 pb-3">
          <button
            onClick={() => setAbaAtiva("todos")}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              abaAtiva === "todos"
                ? "bg-sus-900 text-white"
                : "bg-sus-50 text-sus-900/70 hover:bg-sus-100"
            }`}
          >
            Todos ({totalGeral})
          </button>
          <button
            onClick={() => setAbaAtiva("vencidos")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              abaAtiva === "vencidos"
                ? "bg-red-600 text-white"
                : "bg-red-50 text-red-700 hover:bg-red-100 border border-red-200"
            }`}
          >
            <ShieldAlert className="h-3.5 w-3.5" />
            Vencidos ({totalVencidos})
          </button>
          <button
            onClick={() => setAbaAtiva("proximos")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              abaAtiva === "proximos"
                ? "bg-amber-500 text-white"
                : "bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200"
            }`}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            Próximos do Vencimento ({totalProximos})
          </button>
          <button
            onClick={() => setAbaAtiva("ok")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              abaAtiva === "ok"
                ? "bg-emerald-600 text-white"
                : "bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200"
            }`}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Em Dia ({totalEmDia})
          </button>
        </div>

        {/* Inputs de Filtro */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="relative md:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sus-900/40" />
            <input
              type="text"
              placeholder="Buscar por medicamento, princípio ativo, código ou número do lote…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="w-full rounded-lg border border-sus-200 bg-white py-2 pl-9 pr-3 text-sm text-sus-900 placeholder:text-sus-900/40 focus:border-teal focus:outline-none focus:ring-1 focus:ring-teal"
            />
          </div>

          <div>
            <select
              value={categoriaFiltro}
              onChange={(e) => setCategoriaFiltro(e.target.value)}
              className="w-full rounded-lg border border-sus-200 bg-white px-3 py-2 text-sm text-sus-900 focus:border-teal focus:outline-none focus:ring-1 focus:ring-teal"
            >
              <option value="">Todas as Categorias</option>
              {categoriasUnicas.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {/* Tabela de Monitoramento de Validade */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-sus-900">
            <thead className="border-b border-sus-100 bg-sus-50/70 text-xs font-bold uppercase tracking-wider text-sus-900/60">
              <tr>
                <th className="px-4 py-3.5">Medicamento</th>
                <th className="px-4 py-3.5">Lote / Local</th>
                <th className="px-4 py-3.5">Data de Validade</th>
                <th className="px-4 py-3.5">Situação & Contagem Regressiva</th>
                <th className="px-4 py-3.5 text-right">Saldo Atual</th>
                <th className="px-4 py-3.5 text-center">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sus-100">
              {carregando ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-sus-900/50">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <RefreshCw className="h-6 w-6 animate-spin text-teal" />
                      <span>Carregando dados de validade…</span>
                    </div>
                  </td>
                </tr>
              ) : filtrados.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-sus-900/50">
                    Nenhum medicamento encontrado para os critérios selecionados.
                  </td>
                </tr>
              ) : (
                filtrados.map((med) => {
                  const isVencido = med.status_validade === "VENCIDO";
                  const isProximo = med.status_validade === "PROXIMO_VENCIMENTO";

                  return (
                    <tr
                      key={med.id}
                      className={`transition-colors ${
                        isVencido
                          ? "bg-red-50/40 hover:bg-red-50/70"
                          : isProximo
                          ? "bg-amber-50/40 hover:bg-amber-50/70"
                          : "hover:bg-sus-50/50"
                      }`}
                    >
                      {/* Medicamento */}
                      <td className="px-4 py-3">
                        <div className="flex items-start gap-2.5">
                          <div
                            className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                              isVencido
                                ? "bg-red-100 text-red-700"
                                : isProximo
                                ? "bg-amber-100 text-amber-700"
                                : "bg-teal-50 text-teal-700"
                            }`}
                          >
                            <Pill className="h-3.5 w-3.5" />
                          </div>
                          <div>
                            <div className="font-semibold text-sus-900">{med.nome}</div>
                            <div className="text-xs text-sus-900/50">
                              {med.codigo} {med.principio_ativo ? `· ${med.principio_ativo}` : ""}
                            </div>
                            <div className="mt-0.5 inline-block rounded bg-sus-100/70 px-1.5 py-0.5 text-[10px] text-sus-900/70">
                              {med.categoria}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Lote e Local */}
                      <td className="px-4 py-3 text-xs">
                        <div className="font-semibold text-sus-900">
                          {med.lote ? `Lote: ${med.lote}` : "Sem lote"}
                        </div>
                        <div className="text-sus-900/50">
                          {med.localizacao_prateleira || "Local não informado"}
                        </div>
                      </td>

                      {/* Data de Validade */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-sus-900">
                          <Calendar className="h-3.5 w-3.5 text-sus-900/40" />
                          {med.validade
                            ? new Date(med.validade + "T12:00:00").toLocaleDateString("pt-BR")
                            : "Não informada"}
                        </div>
                      </td>

                      {/* Situação e Contagem Regressiva (DESTAQUE VISUAL AMARELO/VERMELHO) */}
                      <td className="px-4 py-3">
                        {isVencido ? (
                          <div className="inline-flex flex-col items-start gap-0.5">
                            <span className="inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-100 px-2.5 py-1 text-xs font-bold text-red-800 shadow-sm animate-pulse">
                              <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-red-700" />
                              VENCIDO
                            </span>
                            <span className="text-[11px] font-semibold text-red-700 pl-1">
                              {med.contagem_regressiva_texto}
                            </span>
                          </div>
                        ) : isProximo ? (
                          <div className="inline-flex flex-col items-start gap-0.5">
                            <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-900 shadow-sm">
                              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-700" />
                              A VENCER (&le; 30d)
                            </span>
                            <span className="text-[11px] font-semibold text-amber-800 pl-1">
                              {med.contagem_regressiva_texto}
                            </span>
                          </div>
                        ) : (
                          <div className="inline-flex flex-col items-start gap-0.5">
                            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800">
                              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                              Em Dia
                            </span>
                            <span className="text-[11px] text-sus-900/60 pl-1">
                              {med.contagem_regressiva_texto}
                            </span>
                          </div>
                        )}
                      </td>

                      {/* Saldo Atual */}
                      <td className="px-4 py-3 text-right">
                        <div className="font-extrabold text-sm text-sus-900">
                          {med.estoque_atual}
                        </div>
                        <div className="text-[11px] text-sus-900/50">
                          {med.unidade_medida}(s)
                        </div>
                      </td>

                      {/* Ações */}
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {isVencido && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => abrirModalBaixa(med)}
                              className="border-red-300 bg-red-50 text-red-700 hover:bg-red-100 text-xs py-1 px-2.5 flex items-center gap-1"
                              title="Registrar baixa/descarte por vencimento"
                            >
                              <Trash2 className="h-3 w-3" />
                              Baixa Descarte
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => abrirModalEditar(med)}
                            className="text-sus-900/70 hover:text-sus-900 hover:bg-sus-100 text-xs py-1 px-2"
                            title="Editar lote ou data de validade"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Modal de Baixa por Descarte Sanitário / Vencimento */}
      {modalBaixaAberto && medSelecionado && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-lg p-6 shadow-xl animate-in fade-in-50">
            <div className="flex items-center justify-between border-b border-sus-100 pb-3">
              <div className="flex items-center gap-2 text-red-600">
                <Trash2 className="h-5 w-5" />
                <h3 className="text-lg font-bold">Baixa por Descarte Sanitário / Vencimento</h3>
              </div>
              <button
                onClick={() => setModalBaixaAberto(false)}
                className="text-sus-900/40 hover:text-sus-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={confirmarBaixa} className="mt-4 space-y-4">
              <div className="rounded-lg bg-red-50 p-3 text-sm text-red-900">
                <div className="font-bold">{medSelecionado.nome}</div>
                <div className="text-xs text-red-700 mt-0.5">
                  Lote: <span className="font-semibold">{medSelecionado.lote || "N/D"}</span> · Saldo
                  em Estoque: <span className="font-bold">{medSelecionado.estoque_atual} {medSelecionado.unidade_medida}(s)</span>
                </div>
              </div>

              <div>
                <Label htmlFor="qtd_baixa">Quantidade a descartar / dar baixa</Label>
                <Input
                  id="qtd_baixa"
                  type="number"
                  min="1"
                  max={medSelecionado.estoque_atual}
                  value={qtdBaixa}
                  onChange={(e) => setQtdBaixa(Number(e.target.value))}
                  required
                />
              </div>

              <div>
                <Label htmlFor="motivo_baixa">Motivo do Descarte</Label>
                <select
                  id="motivo_baixa"
                  value={motivoBaixa}
                  onChange={(e) => setMotivoBaixa(e.target.value)}
                  className="w-full rounded-lg border border-sus-200 bg-white px-3 py-2 text-sm text-sus-900 focus:border-teal focus:outline-none"
                  required
                >
                  <option value="Descarte por expiração da data de validade">
                    Descarte por expiração da data de validade
                  </option>
                  <option value="Avaria ou alteração de aspecto / embalagem violada">
                    Avaria ou alteração de aspecto / embalagem violada
                  </option>
                  <option value="Recolhimento sanitário pela Anvisa / Fabricante">
                    Recolhimento sanitário pela Anvisa / Fabricante
                  </option>
                  <option value="Quebra acidental ou contaminação">
                    Quebra acidental ou contaminação
                  </option>
                </select>
              </div>

              <div>
                <Label htmlFor="obs_baixa">Observações / Número do Termo de Inutilização</Label>
                <textarea
                  id="obs_baixa"
                  rows={2}
                  value={obsBaixa}
                  onChange={(e) => setObsBaixa(e.target.value)}
                  placeholder="Ex: Termo de Descarte Farmacêutico nº 2026/012..."
                  className="w-full rounded-lg border border-sus-200 bg-white p-2 text-sm text-sus-900 focus:border-teal focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 border-t border-sus-100 pt-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setModalBaixaAberto(false)}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={salvandoBaixa}
                  className="bg-red-600 hover:bg-red-700 text-white flex items-center gap-1.5"
                >
                  {salvandoBaixa ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  Confirmar Baixa Definitiva
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Modal de Atualização de Lote e Validade */}
      {modalEditarAberto && medSelecionado && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-md p-6 shadow-xl animate-in fade-in-50">
            <div className="flex items-center justify-between border-b border-sus-100 pb-3">
              <div className="flex items-center gap-2 text-sus-900">
                <Edit2 className="h-5 w-5 text-teal" />
                <h3 className="text-lg font-bold">Atualizar Lote & Validade</h3>
              </div>
              <button
                onClick={() => setModalEditarAberto(false)}
                className="text-sus-900/40 hover:text-sus-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={confirmarEdicao} className="mt-4 space-y-4">
              <div className="rounded-lg bg-sus-50 p-3 text-sm text-sus-900">
                <div className="font-bold">{medSelecionado.nome}</div>
                <div className="text-xs text-sus-900/60 mt-0.5">
                  Código: {medSelecionado.codigo} · Saldo: {medSelecionado.estoque_atual}{" "}
                  {medSelecionado.unidade_medida}(s)
                </div>
              </div>

              <div>
                <Label htmlFor="novo_lote">Número do Lote</Label>
                <Input
                  id="novo_lote"
                  type="text"
                  value={novoLote}
                  onChange={(e) => setNovoLote(e.target.value)}
                  placeholder="Ex: LOT-2026-X"
                />
              </div>

              <div>
                <Label htmlFor="nova_validade">Data de Validade</Label>
                <Input
                  id="nova_validade"
                  type="date"
                  value={novaValidade}
                  onChange={(e) => setNovaValidade(e.target.value)}
                />
              </div>

              <div>
                <Label htmlFor="nova_loc">Localização / Prateleira</Label>
                <Input
                  id="nova_loc"
                  type="text"
                  value={novaLocalizacao}
                  onChange={(e) => setNovaLocalizacao(e.target.value)}
                  placeholder="Ex: Prateleira B · Gaveta 3"
                />
              </div>

              <div className="flex justify-end gap-2 border-t border-sus-100 pt-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setModalEditarAberto(false)}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={salvandoEdicao}
                  className="bg-teal hover:bg-teal-700 text-white"
                >
                  {salvandoEdicao ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Salvar Alterações"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
