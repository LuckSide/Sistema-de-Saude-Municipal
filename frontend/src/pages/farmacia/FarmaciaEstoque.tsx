import { useEffect, useState } from "react";
import {
  Pill,
  Plus,
  Search,
  ShoppingCart,
  Send,
  AlertTriangle,
  CheckCircle2,
  Package,
  Calendar,
  Layers,
  FileText,
  Building2,
  Trash2,
  Edit2,
  RefreshCw,
  X,
  Clock,
  ShieldCheck,
  User,
  Activity,
} from "lucide-react";
import {
  farmaciaResumo,
  farmaciaMedicamentosListar,
  farmaciaMedicamentoCriar,
  farmaciaMedicamentoAtualizar,
  farmaciaMedicamentoExcluir,
  farmaciaMedicamentoMovimentar,
  type MedicamentoOut,
  type MedicamentoCriar,
  type MovimentacaoMedicamentoCriar,
  type FarmaciaResumoCardsOut,
} from "../../services/api";
import { Button, Card, Input, Label } from "../../components/ui/primitives";
import ExportarExcel from "../../components/ExportarExcel";

const CATEGORIAS_PADRAO = [
  "Básico / Atenção Primária",
  "Hipertensão / Diabetes",
  "Antibióticos",
  "Saúde Mental / Psicotrópicos",
  "Controlado / Portaria 344",
  "Analgésicos & Anti-inflamatórios",
  "Saúde da Mulher",
  "Pediatria",
  "Urgência & Emergência",
];

const FORMAS_FARMACEUTICAS = [
  "Comprimido",
  "Comprimido Revestido",
  "Cápsula",
  "Solução Oral / Gotas",
  "Xarope",
  "Suspensão Oral",
  "Injetável (Ampola/Frasco)",
  "Pomada / Creme",
  "Colírio / Solução Oftálmica",
  "Aerossol / Inalatório",
];

export default function FarmaciaEstoque() {
  const [resumo, setResumo] = useState<FarmaciaResumoCardsOut | null>(null);
  const [medicamentos, setMedicamentos] = useState<MedicamentoOut[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [filtroStatusEstoque, setFiltroStatusEstoque] = useState("");

  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState("");

  // Modais
  const [modalMedAberto, setModalMedAberto] = useState(false);
  const [medEditando, setMedEditando] = useState<MedicamentoOut | null>(null);
  const [salvandoMed, setSalvandoMed] = useState(false);

  const [formMed, setFormMed] = useState<MedicamentoCriar>({
    codigo: "",
    nome: "",
    principio_ativo: "",
    dosagem: "",
    forma_farmaceutica: "Comprimido",
    unidade_medida: "comprimido",
    categoria: "Básico / Atenção Primária",
    fabricante: "",
    lote: "",
    validade: "",
    estoque_atual: 0,
    estoque_minimo: 20,
    requer_receita: true,
    controlado: false,
    localizacao_prateleira: "",
    observacoes: "",
    ativo: true,
  });

  const [modalMovAberto, setModalMovAberto] = useState(false);
  const [movTipo, setMovTipo] = useState<"ENTRADA" | "SAIDA">("SAIDA");
  const [salvandoMov, setSalvandoMov] = useState(false);
  const [formMov, setFormMov] = useState<MovimentacaoMedicamentoCriar>({
    medicamento_id: 0,
    tipo: "SAIDA_DISPENSACAO",
    quantidade: 1,
    lote: "",
    validade: "",
    documento_referencia: "",
    paciente_nome: "",
    paciente_cpf: "",
    paciente_cns: "",
    prescritor_nome: "",
    prescritor_crm: "",
    motivo_descarte: "",
    observacoes: "",
  });

  const carregarDados = async () => {
    setCarregando(true);
    setErro("");
    try {
      const [resResumo, resMeds] = await Promise.all([
        farmaciaResumo(),
        farmaciaMedicamentosListar({
          q: busca.trim() || undefined,
          categoria: filtroCategoria || undefined,
          status_estoque: filtroStatusEstoque || undefined,
          somente_ativos: true,
        }),
      ]);
      setResumo(resResumo);
      setMedicamentos(resMeds);
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Erro ao carregar dados da farmácia");
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregarDados();
  }, [filtroCategoria, filtroStatusEstoque]);

  const handleBuscaSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    carregarDados();
  };

  // Abrir Modal Novo Medicamento
  const abrirModalNovoMed = () => {
    setMedEditando(null);
    setFormMed({
      codigo: `MED-${Math.floor(100 + Math.random() * 900)}`,
      nome: "",
      principio_ativo: "",
      dosagem: "",
      forma_farmaceutica: "Comprimido",
      unidade_medida: "comprimido",
      categoria: "Básico / Atenção Primária",
      fabricante: "",
      lote: "",
      validade: "",
      estoque_atual: 0,
      estoque_minimo: 20,
      requer_receita: true,
      controlado: false,
      localizacao_prateleira: "",
      observacoes: "",
      ativo: true,
    });
    setModalMedAberto(true);
  };

  // Abrir Modal Editar Medicamento
  const abrirModalEditarMed = (med: MedicamentoOut) => {
    setMedEditando(med);
    setFormMed({
      codigo: med.codigo,
      nome: med.nome,
      principio_ativo: med.principio_ativo || "",
      dosagem: med.dosagem || "",
      forma_farmaceutica: med.forma_farmaceutica || "Comprimido",
      unidade_medida: med.unidade_medida || "comprimido",
      categoria: med.categoria || "Básico / Atenção Primária",
      fabricante: med.fabricante || "",
      lote: med.lote || "",
      validade: med.validade || "",
      estoque_atual: med.estoque_atual,
      estoque_minimo: med.estoque_minimo,
      requer_receita: med.requer_receita,
      controlado: med.controlado,
      localizacao_prateleira: med.localizacao_prateleira || "",
      observacoes: med.observacoes || "",
      ativo: med.ativo,
    });
    setModalMedAberto(true);
  };

  const salvarMedicamento = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formMed.nome.trim()) {
      setErro("Informe o nome do medicamento.");
      return;
    }
    setSalvandoMed(true);
    setErro("");
    try {
      if (medEditando) {
        await farmaciaMedicamentoAtualizar(medEditando.id, formMed);
        setSucesso(`Medicamento "${formMed.nome}" atualizado com sucesso.`);
      } else {
        await farmaciaMedicamentoCriar(formMed);
        setSucesso(`Medicamento "${formMed.nome}" cadastrado com sucesso.`);
      }
      setModalMedAberto(false);
      await carregarDados();
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Erro ao salvar medicamento.");
    } finally {
      setSalvandoMed(false);
    }
  };

  const inativarMedicamento = async (med: MedicamentoOut) => {
    if (!confirm(`Deseja realmente inativar o medicamento "${med.nome}"?`)) return;
    try {
      await farmaciaMedicamentoExcluir(med.id);
      setSucesso(`Medicamento "${med.nome}" inativado com sucesso.`);
      await carregarDados();
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Erro ao inativar medicamento.");
    }
  };

  // Abrir Modal de Movimentação Rápida
  const abrirModalMov = (tipo: "ENTRADA" | "SAIDA", med?: MedicamentoOut) => {
    setMovTipo(tipo);
    setFormMov({
      medicamento_id: med ? med.id : (medicamentos[0]?.id || 0),
      tipo: tipo === "ENTRADA" ? "ENTRADA_COMPRA" : "SAIDA_DISPENSACAO",
      quantidade: 1,
      lote: med?.lote || "",
      validade: med?.validade || "",
      documento_referencia: "",
      paciente_nome: "",
      paciente_cpf: "",
      paciente_cns: "",
      prescritor_nome: "",
      prescritor_crm: "",
      motivo_descarte: "",
      observacoes: "",
    });
    setModalMovAberto(true);
  };

  const salvarMovimentacao = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formMov.medicamento_id) {
      setErro("Selecione o medicamento para movimentar.");
      return;
    }
    if (formMov.quantidade <= 0) {
      setErro("A quantidade deve ser maior que zero.");
      return;
    }
    setSalvandoMov(true);
    setErro("");
    try {
      const res = await farmaciaMedicamentoMovimentar(formMov);
      setSucesso(
        `Movimentação de ${formMov.quantidade} unidade(s) registrada com sucesso. Novo saldo: ${res.saldo_posterior}.`
      );
      setModalMovAberto(false);
      await carregarDados();
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Erro ao registrar movimentação.");
    } finally {
      setSalvandoMov(false);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Cabeçalho da Página */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-teal/10 text-teal">
            <Pill className="w-6 h-6" />
          </div>
          <div>
            <h1 className="font-display text-xl md:text-2xl font-bold text-sus-950">
              Farmácia Municipal · Medicamentos & Estoque
            </h1>
            <p className="text-xs text-ink/60 mt-0.5">
              Controle de estoque, registro de entradas, dispensações para pacientes e rastreabilidade de lotes
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => abrirModalMov("ENTRADA")}
            className="bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5 text-xs shadow-sm"
          >
            <ShoppingCart className="w-4 h-4" />
            <span>Entrada / Compra</span>
          </Button>

          <Button
            onClick={() => abrirModalMov("SAIDA")}
            className="bg-sky-600 hover:bg-sky-700 text-white flex items-center gap-1.5 text-xs shadow-sm"
          >
            <Send className="w-4 h-4" />
            <span>Dispensar Paciente</span>
          </Button>

          <Button
            onClick={abrirModalNovoMed}
            className="bg-sus-900 hover:bg-sus-950 text-white flex items-center gap-1.5 text-xs shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Novo Medicamento</span>
          </Button>

          <ExportarExcel
            url="/api/farmacia/validade/exportar"
            arquivo="farmacia_estoque_medicamentos"
            rotulo="Exportar Excel"
          />
        </div>
      </div>

      {erro && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl flex items-center justify-between text-sm shadow-sm">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
            <span>{erro}</span>
          </div>
          <button onClick={() => setErro("")} className="text-rose-500 hover:text-rose-700 font-bold">×</button>
        </div>
      )}

      {sucesso && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl flex items-center justify-between text-sm shadow-sm">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span>{sucesso}</span>
          </div>
          <button onClick={() => setSucesso("")} className="text-emerald-500 hover:text-emerald-700 font-bold">×</button>
        </div>
      )}

      {/* CARDS DE RESUMO EM TEMPO REAL */}
      <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-5 gap-3.5">
        <Card className="p-4 bg-white border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Medicamentos Ativos</span>
            <Package className="w-4 h-4 text-sky-600" />
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2">
            {resumo?.total_medicamentos || 0}
          </p>
          <span className="text-[11px] text-slate-500 mt-0.5 block">Itens cadastrados</span>
        </Card>

        <Card className="p-4 bg-white border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Estoque Baixo / Crítico</span>
            <AlertTriangle className="w-4 h-4 text-amber-500" />
          </div>
          <p className="text-2xl font-bold text-amber-600 mt-2">
            {resumo?.total_estoque_baixo || 0}
          </p>
          <span className="text-[11px] text-amber-700 mt-0.5 block">Abaixo do mínimo</span>
        </Card>

        <Card className="p-4 bg-white border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Estoque Zerado</span>
            <Activity className="w-4 h-4 text-rose-600" />
          </div>
          <p className="text-2xl font-bold text-rose-600 mt-2">
            {resumo?.total_estoque_zerado || 0}
          </p>
          <span className="text-[11px] text-rose-700 mt-0.5 block">Em falta no município</span>
        </Card>

        <Card className="p-4 bg-white border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Próximos a Vencer</span>
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <p className="text-2xl font-bold text-amber-700 mt-2">
            {resumo?.total_proximos_vencimento || 0}
          </p>
          <span className="text-[11px] text-amber-800 mt-0.5 block">Validade &lt; 30 dias</span>
        </Card>

        <Card className="p-4 bg-white border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Dispensações no Mês</span>
            <Send className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-2xl font-bold text-emerald-700 mt-2">
            {resumo?.total_dispensacoes_mes || 0}
          </p>
          <span className="text-[11px] text-emerald-800 mt-0.5 block">Saídas para pacientes</span>
        </Card>
      </div>

      {/* BARRA DE FILTROS E BUSCA */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
        <form onSubmit={handleBuscaSubmit} className="flex-1 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <Input
              placeholder="Buscar por nome do medicamento, princípio ativo, dosagem ou lote..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="pl-9 text-xs h-9"
            />
          </div>
          <Button type="submit" variant="outline" size="sm" className="text-xs h-9">
            Buscar
          </Button>
        </form>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={filtroCategoria}
            onChange={(e) => setFiltroCategoria(e.target.value)}
            className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-white text-slate-700 h-9"
          >
            <option value="">Todas as Categorias</option>
            {CATEGORIAS_PADRAO.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          <select
            value={filtroStatusEstoque}
            onChange={(e) => setFiltroStatusEstoque(e.target.value)}
            className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-white text-slate-700 h-9"
          >
            <option value="">Status Estoque (Todos)</option>
            <option value="BAIXO">Estoque Baixo / Crítico</option>
            <option value="ZERADO">Apenas Zerados</option>
            <option value="NORMAL">Estoque Normal</option>
          </select>

          <Button
            variant="outline"
            size="sm"
            onClick={carregarDados}
            title="Atualizar lista"
            className="h-9 px-2.5 text-slate-600"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${carregando ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* TABELA DE MEDICAMENTOS */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="bg-sand/40 text-sus-950 font-bold uppercase tracking-wider text-[10px] border-b border-sus-900/10">
              <tr>
                <th className="py-2.5 px-3">Código</th>
                <th className="py-2.5 px-3">Medicamento / Princípio Ativo</th>
                <th className="py-2.5 px-3">Dosagem & Forma</th>
                <th className="py-2.5 px-3">Categoria</th>
                <th className="py-2.5 px-3">Lote & Validade</th>
                <th className="py-2.5 px-3">Contagem Regressiva</th>
                <th className="py-2.5 px-3 text-center">Saldo Atual</th>
                <th className="py-2.5 px-3 text-center">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {carregando ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <div className="inline-block animate-spin w-6 h-6 border-2 border-teal border-t-transparent rounded-full mb-2"></div>
                    <p>Carregando estoque de medicamentos...</p>
                  </td>
                </tr>
              ) : medicamentos.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-500">
                    Nenhum medicamento encontrado com os filtros selecionados.
                  </td>
                </tr>
              ) : (
                medicamentos.map((med) => {
                  const isVencido = med.status_validade === "VENCIDO";
                  const isProximo = med.status_validade === "PROXIMO_VENCIMENTO";

                  return (
                    <tr
                      key={med.id}
                      className={`hover:bg-slate-50/80 transition-colors ${
                        isVencido ? "bg-red-50/40" : isProximo ? "bg-amber-50/40" : ""
                      }`}
                    >
                      <td className="py-3 px-3 font-mono font-medium text-slate-500">
                        {med.codigo}
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-bold text-slate-900">{med.nome}</div>
                        {med.principio_ativo && (
                          <div className="text-[11px] text-slate-500 font-medium">
                            {med.principio_ativo}
                          </div>
                        )}
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {med.controlado && (
                            <span className="px-1.5 py-0.2 text-[9px] font-bold rounded bg-purple-100 text-purple-800 border border-purple-200">
                              Portaria 344
                            </span>
                          )}
                          {med.requer_receita && (
                            <span className="px-1.5 py-0.2 text-[9px] font-bold rounded bg-slate-100 text-slate-700 border border-slate-200">
                              Receita Obrigatória
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <span className="font-semibold text-slate-800">{med.dosagem || "—"}</span>
                        <span className="block text-[11px] text-slate-500">{med.forma_farmaceutica}</span>
                      </td>
                      <td className="py-3 px-3">
                        <span className="inline-block px-2 py-0.5 text-[10px] font-bold rounded-md bg-sky-50 text-sky-800 border border-sky-200">
                          {med.categoria}
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-mono text-slate-800">Lote: {med.lote || "—"}</div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-slate-400" />
                          <span>{med.validade ? med.validade.split("-").reverse().join("/") : "Sem data"}</span>
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-lg border ${
                            isVencido
                              ? "bg-red-100 text-red-900 border-red-300"
                              : isProximo
                              ? "bg-amber-100 text-amber-900 border-amber-300"
                              : "bg-emerald-50 text-emerald-800 border-emerald-200"
                          }`}
                        >
                          <Clock className="w-3 h-3 shrink-0" />
                          <span>{med.contagem_regressiva_texto || "—"}</span>
                        </span>
                      </td>
                      <td className="py-3 px-3 text-center">
                        <div className="text-sm font-extrabold text-slate-900">
                          {med.estoque_atual}{" "}
                          <span className="text-[10px] font-normal text-slate-500 lowercase">
                            {med.unidade_medida}s
                          </span>
                        </div>
                        <span
                          className={`inline-block px-1.5 py-0.2 text-[9px] font-bold rounded uppercase mt-0.5 ${
                            med.status_estoque === "ZERADO"
                              ? "bg-red-100 text-red-800 border border-red-300"
                              : med.status_estoque === "CRITICO"
                              ? "bg-rose-100 text-rose-800 border border-rose-300"
                              : med.status_estoque === "BAIXO"
                              ? "bg-amber-100 text-amber-800 border border-amber-300"
                              : "bg-emerald-100 text-emerald-800 border border-emerald-200"
                          }`}
                        >
                          {med.status_estoque === "ZERADO"
                            ? "Zerado"
                            : med.status_estoque === "CRITICO"
                            ? "Crítico"
                            : med.status_estoque === "BAIXO"
                            ? "Estoque Baixo"
                            : "Disponível"}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => abrirModalMov("SAIDA", med)}
                            title="Dispensar para paciente"
                            className="p-1.5 text-sky-700 hover:bg-sky-50 rounded-lg transition"
                          >
                            <Send className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => abrirModalMov("ENTRADA", med)}
                            title="Dar entrada no estoque"
                            className="p-1.5 text-emerald-700 hover:bg-emerald-50 rounded-lg transition"
                          >
                            <ShoppingCart className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => abrirModalEditarMed(med)}
                            title="Editar medicamento"
                            className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg transition"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => inativarMedicamento(med)}
                            title="Inativar medicamento"
                            className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL: NOVO / EDITAR MEDICAMENTO */}
      {modalMedAberto && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-slate-200">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2">
                <Pill className="w-5 h-5 text-teal" />
                <h3 className="font-bold text-slate-800 text-base">
                  {medEditando ? "Editar Medicamento" : "Novo Medicamento"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setModalMedAberto(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ×
              </button>
            </div>

            <form onSubmit={salvarMedicamento} className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <Label>Código / Registro *</Label>
                  <Input
                    required
                    value={formMed.codigo}
                    onChange={(e) => setFormMed({ ...formMed, codigo: e.target.value })}
                    placeholder="Ex: MED-101"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label>Nome do Medicamento *</Label>
                  <Input
                    required
                    value={formMed.nome}
                    onChange={(e) => setFormMed({ ...formMed, nome: e.target.value })}
                    placeholder="Ex: Dipirona Monoidratada"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <Label>Princípio Ativo</Label>
                  <Input
                    value={formMed.principio_ativo || ""}
                    onChange={(e) => setFormMed({ ...formMed, principio_ativo: e.target.value })}
                    placeholder="Ex: Dipirona"
                  />
                </div>
                <div>
                  <Label>Dosagem</Label>
                  <Input
                    value={formMed.dosagem || ""}
                    onChange={(e) => setFormMed({ ...formMed, dosagem: e.target.value })}
                    placeholder="Ex: 500 mg ou 50mg/ml"
                  />
                </div>
                <div>
                  <Label>Forma Farmacêutica</Label>
                  <select
                    value={formMed.forma_farmaceutica}
                    onChange={(e) => setFormMed({ ...formMed, forma_farmaceutica: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white"
                  >
                    {FORMAS_FARMACEUTICAS.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <Label>Categoria</Label>
                  <select
                    value={formMed.categoria}
                    onChange={(e) => setFormMed({ ...formMed, categoria: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white"
                  >
                    {CATEGORIAS_PADRAO.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>Unidade de Medida</Label>
                  <Input
                    value={formMed.unidade_medida}
                    onChange={(e) => setFormMed({ ...formMed, unidade_medida: e.target.value })}
                    placeholder="comprimido, frasco, ampola..."
                  />
                </div>
                <div>
                  <Label>Fabricante / Laboratório</Label>
                  <Input
                    value={formMed.fabricante || ""}
                    onChange={(e) => setFormMed({ ...formMed, fabricante: e.target.value })}
                    placeholder="Ex: Medley, EMS, Eurofarma"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
                <div>
                  <Label>Lote</Label>
                  <Input
                    value={formMed.lote || ""}
                    onChange={(e) => setFormMed({ ...formMed, lote: e.target.value })}
                    placeholder="Ex: L-2026A"
                  />
                </div>
                <div>
                  <Label>Data de Validade</Label>
                  <Input
                    type="date"
                    value={formMed.validade || ""}
                    onChange={(e) => setFormMed({ ...formMed, validade: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Estoque Mínimo (Alerta)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={formMed.estoque_minimo}
                    onChange={(e) => setFormMed({ ...formMed, estoque_minimo: Number(e.target.value) })}
                  />
                </div>
              </div>

              {!medEditando && (
                <div>
                  <Label>Estoque Inicial</Label>
                  <Input
                    type="number"
                    min={0}
                    value={formMed.estoque_atual}
                    onChange={(e) => setFormMed({ ...formMed, estoque_atual: Number(e.target.value) })}
                    placeholder="Quantidade inicial em estoque"
                  />
                </div>
              )}

              <div className="flex flex-wrap items-center gap-6 pt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formMed.requer_receita}
                    onChange={(e) => setFormMed({ ...formMed, requer_receita: e.target.checked })}
                    className="rounded text-teal focus:ring-teal"
                  />
                  <span>Exige Apresentação de Receita Médica</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formMed.controlado}
                    onChange={(e) => setFormMed({ ...formMed, controlado: e.target.checked })}
                    className="rounded text-purple-600 focus:ring-purple-500"
                  />
                  <span className="font-semibold text-purple-900">Medicamento Controlado (Portaria 344)</span>
                </label>
              </div>

              <div>
                <Label>Localização na Farmácia / Prateleira</Label>
                <Input
                  value={formMed.localizacao_prateleira || ""}
                  onChange={(e) => setFormMed({ ...formMed, localizacao_prateleira: e.target.value })}
                  placeholder="Ex: Armário A · Prateleira 2"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setModalMedAberto(false)}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={salvandoMed}
                  className="bg-teal hover:bg-teal/90 text-white"
                >
                  {salvandoMed ? "Salvando..." : medEditando ? "Salvar Alterações" : "Cadastrar Medicamento"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: MOVIMENTAÇÃO DE ESTOQUE (ENTRADA OU DISPENSAÇÃO) */}
      {modalMovAberto && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto border border-slate-200">
            <div
              className={`px-6 py-4 border-b flex items-center justify-between ${
                movTipo === "ENTRADA" ? "bg-emerald-50 text-emerald-900 border-emerald-200" : "bg-sky-50 text-sky-900 border-sky-200"
              }`}
            >
              <div className="flex items-center gap-2">
                {movTipo === "ENTRADA" ? <ShoppingCart className="w-5 h-5 text-emerald-700" /> : <Send className="w-5 h-5 text-sky-700" />}
                <h3 className="font-bold text-base">
                  {movTipo === "ENTRADA" ? "Lançar Entrada no Estoque" : "Dispensação para Paciente / Saída"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setModalMovAberto(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ×
              </button>
            </div>

            <form onSubmit={salvarMovimentacao} className="p-6 space-y-4 text-xs">
              <div>
                <Label>Medicamento *</Label>
                <select
                  required
                  value={formMov.medicamento_id}
                  onChange={(e) => setFormMov({ ...formMov, medicamento_id: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white"
                >
                  <option value={0}>Selecione o medicamento...</option>
                  {medicamentos.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nome} ({m.dosagem}) · Saldo Atual: {m.estoque_atual} {m.unidade_medida}s
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Tipo de Movimento</Label>
                  <select
                    value={formMov.tipo}
                    onChange={(e) => setFormMov({ ...formMov, tipo: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white"
                  >
                    {movTipo === "ENTRADA" ? (
                      <>
                        <option value="ENTRADA_COMPRA">Entrada por Compra (NF)</option>
                        <option value="ENTRADA_DOACAO">Entrada por Doação</option>
                        <option value="ENTRADA_REMESSA">Remessa Estadual / Regional</option>
                      </>
                    ) : (
                      <>
                        <option value="SAIDA_DISPENSACAO">Dispensação para Paciente</option>
                        <option value="SAIDA_PERDA">Perda / Descarte / Avaria</option>
                        <option value="SAIDA_TRANSFERENCIA">Transferência entre Unidades</option>
                      </>
                    )}
                  </select>
                </div>
                <div>
                  <Label>Quantidade *</Label>
                  <Input
                    required
                    type="number"
                    min={1}
                    value={formMov.quantidade}
                    onChange={(e) => setFormMov({ ...formMov, quantidade: Number(e.target.value) })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Lote</Label>
                  <Input
                    value={formMov.lote || ""}
                    onChange={(e) => setFormMov({ ...formMov, lote: e.target.value })}
                    placeholder="Lote atualizado"
                  />
                </div>
                <div>
                  <Label>Nova Validade (opcional)</Label>
                  <Input
                    type="date"
                    value={formMov.validade || ""}
                    onChange={(e) => setFormMov({ ...formMov, validade: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <Label>{movTipo === "ENTRADA" ? "Nº da Nota Fiscal / Pedido" : "Nº da Receita / Guia de Atendimento"}</Label>
                <Input
                  value={formMov.documento_referencia || ""}
                  onChange={(e) => setFormMov({ ...formMov, documento_referencia: e.target.value })}
                  placeholder="Ex: NF-2026/001 ou REC-8899"
                />
              </div>

              {movTipo === "SAIDA" && formMov.tipo === "SAIDA_DISPENSACAO" && (
                <div className="bg-sky-50/60 p-3.5 rounded-xl border border-sky-200 space-y-3">
                  <span className="font-bold text-sky-950 block">Dados do Paciente & Prescrição</span>
                  <div>
                    <Label>Nome do Paciente</Label>
                    <Input
                      value={formMov.paciente_nome || ""}
                      onChange={(e) => setFormMov({ ...formMov, paciente_nome: e.target.value })}
                      placeholder="Nome completo do paciente"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label>CPF</Label>
                      <Input
                        value={formMov.paciente_cpf || ""}
                        onChange={(e) => setFormMov({ ...formMov, paciente_cpf: e.target.value })}
                        placeholder="000.000.000-00"
                      />
                    </div>
                    <div>
                      <Label>CNS (Cartão SUS)</Label>
                      <Input
                        value={formMov.paciente_cns || ""}
                        onChange={(e) => setFormMov({ ...formMov, paciente_cns: e.target.value })}
                        placeholder="700000000000000"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label>Médico Prescritor</Label>
                      <Input
                        value={formMov.prescritor_nome || ""}
                        onChange={(e) => setFormMov({ ...formMov, prescritor_nome: e.target.value })}
                        placeholder="Dr(a). Solicitante"
                      />
                    </div>
                    <div>
                      <Label>CRM</Label>
                      <Input
                        value={formMov.prescritor_crm || ""}
                        onChange={(e) => setFormMov({ ...formMov, prescritor_crm: e.target.value })}
                        placeholder="CRM/UF"
                      />
                    </div>
                  </div>
                </div>
              )}

              {formMov.tipo === "SAIDA_PERDA" && (
                <div>
                  <Label>Motivo do Descarte / Perda</Label>
                  <Input
                    value={formMov.motivo_descarte || ""}
                    onChange={(e) => setFormMov({ ...formMov, motivo_descarte: e.target.value })}
                    placeholder="Ex: Medicamento vencido, quebra de frasco, lote recolhido"
                  />
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setModalMovAberto(false)}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={salvandoMov}
                  className={movTipo === "ENTRADA" ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-sky-600 hover:bg-sky-700 text-white"}
                >
                  {salvandoMov ? "Gravando..." : movTipo === "ENTRADA" ? "Confirmar Entrada" : "Confirmar Dispensação"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
