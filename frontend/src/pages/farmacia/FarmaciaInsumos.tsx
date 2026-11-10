import { useEffect, useState } from "react";
import {
  Package,
  Plus,
  Search,
  ShoppingCart,
  Send,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  Layers,
  Building2,
  Trash2,
  Edit2,
  RefreshCw,
  X,
  Clock,
  ShieldAlert,
  ArrowDownRight,
  ArrowUpRight,
} from "lucide-react";
import {
  farmaciaInsumosListar,
  farmaciaInsumoCriar,
  farmaciaInsumoAtualizar,
  farmaciaInsumoExcluir,
  farmaciaInsumoMovimentar,
  type InsumoInternoOut,
  type InsumoInternoCriar,
  type MovimentacaoInsumoCriar,
} from "../../services/api";
import { Button, Card, Input, Label } from "../../components/ui/primitives";
import ExportarExcel from "../../components/ExportarExcel";

const CATEGORIAS_INSUMO = [
  "EPIs & Proteção",
  "Injetáveis & Aplicação",
  "Curativos & Suturas",
  "Higiene & Assepsia",
  "Diagnóstico Rápido & Testes",
  "Material de Escritório & Impressos",
  "Outros Insumos Hospitalares",
];

const UNIDADES_MEDIDA = [
  "unidade",
  "caixa c/ 50",
  "caixa c/ 100",
  "pacote",
  "pacote c/ 10",
  "frasco",
  "par",
  "rolo",
  "litro",
];

const POSTOS_DESTINO_PADRAO = [
  "PSF 01 - Centro / Sede",
  "PSF 02 - Bairro São José",
  "PSF 03 - Zona Rural / Aparecida",
  "Pronto Atendimento Municipal (PA)",
  "Sala de Vacinas Central",
  "Laboratório Municipal de Análises",
  "Ambulatório de Especialidades",
  "Vigilância Sanitária e Epidemiológica",
  "Almoxarifado Central / Reserva",
];

export default function FarmaciaInsumos() {
  const [insumos, setInsumos] = useState<InsumoInternoOut[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [apenasEstoqueBaixo, setApenasEstoqueBaixo] = useState(false);

  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState("");

  // Modal Insumo (Cadastro/Edição)
  const [modalInsumoAberto, setModalInsumoAberto] = useState(false);
  const [insumoEditando, setInsumoEditando] = useState<InsumoInternoOut | null>(null);
  const [salvandoInsumo, setSalvandoInsumo] = useState(false);

  const [formInsumo, setFormInsumo] = useState<InsumoInternoCriar>({
    codigo: "",
    nome: "",
    categoria: "EPIs & Proteção",
    unidade_medida: "unidade",
    lote: "",
    validade: "",
    estoque_atual: 0,
    estoque_minimo: 20,
    local_armazenamento: "Almoxarifado Central",
    observacoes: "",
    ativo: true,
  });

  // Modal Movimentação (Entrada / Saída para PSF)
  const [modalMovAberto, setModalMovAberto] = useState(false);
  const [insumoSelecionadoMov, setInsumoSelecionadoMov] = useState<InsumoInternoOut | null>(null);
  const [salvandoMov, setSalvandoMov] = useState(false);

  const [formMov, setFormMov] = useState<MovimentacaoInsumoCriar>({
    insumo_id: 0,
    tipo: "SAIDA_PSF",
    quantidade: 10,
    unidade_destino: "PSF 01 - Centro / Sede",
    responsavel_recebimento: "",
    documento_referencia: "",
    observacoes: "",
  });

  async function carregarDados() {
    setCarregando(true);
    setErro("");
    try {
      const lista = await farmaciaInsumosListar({ somente_ativos: true });
      setInsumos(lista);
    } catch {
      setErro("Falha ao carregar catálogo de insumos.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregarDados();
  }, []);

  // Filtragem
  const filtrados = insumos.filter((item) => {
    if (apenasEstoqueBaixo && item.estoque_atual > item.estoque_minimo) return false;
    if (filtroCategoria && item.categoria !== filtroCategoria) return false;
    if (busca.trim()) {
      const t = busca.toLowerCase();
      const matchNome = item.nome.toLowerCase().includes(t);
      const matchCodigo = item.codigo.toLowerCase().includes(t);
      const matchLote = (item.lote || "").toLowerCase().includes(t);
      const matchLocal = (item.local_armazenamento || "").toLowerCase().includes(t);
      return matchNome || matchCodigo || matchLote || matchLocal;
    }
    return true;
  });

  // Métricas
  const totalInsumos = insumos.length;
  const totalEstoqueBaixo = insumos.filter((i) => i.estoque_atual <= i.estoque_minimo).length;
  const totalZerados = insumos.filter((i) => i.estoque_atual <= 0).length;
  const totalProximosValidade = insumos.filter(
    (i) => i.status_validade === "PROXIMO_VENCIMENTO" || i.status_validade === "VENCIDO"
  ).length;

  // Abertura Modal Cadastro
  function abrirModalNovoInsumo() {
    setInsumoEditando(null);
    setFormInsumo({
      codigo: `INS-${String(insumos.length + 1).padStart(3, "0")}`,
      nome: "",
      categoria: "EPIs & Proteção",
      unidade_medida: "unidade",
      lote: "",
      validade: "",
      estoque_atual: 0,
      estoque_minimo: 20,
      local_armazenamento: "Almoxarifado Central",
      observacoes: "",
      ativo: true,
    });
    setModalInsumoAberto(true);
  }

  function abrirModalEditarInsumo(item: InsumoInternoOut) {
    setInsumoEditando(item);
    setFormInsumo({
      codigo: item.codigo,
      nome: item.nome,
      categoria: item.categoria || "EPIs & Proteção",
      unidade_medida: item.unidade_medida || "unidade",
      lote: item.lote || "",
      validade: item.validade || "",
      estoque_atual: item.estoque_atual,
      estoque_minimo: item.estoque_minimo,
      local_armazenamento: item.local_armazenamento || "",
      observacoes: item.observacoes || "",
      ativo: item.ativo,
    });
    setModalInsumoAberto(true);
  }

  async function salvarInsumo(e: React.FormEvent) {
    e.preventDefault();
    if (!formInsumo.nome.trim()) {
      setErro("Informe o nome do insumo.");
      return;
    }

    setSalvandoInsumo(true);
    setErro("");
    try {
      const payload = {
        ...formInsumo,
        validade: formInsumo.validade || null,
      };

      if (insumoEditando) {
        await farmaciaInsumoAtualizar(insumoEditando.id, payload);
        setSucesso(`Insumo "${formInsumo.nome}" atualizado com sucesso!`);
      } else {
        await farmaciaInsumoCriar(payload);
        setSucesso(`Insumo "${formInsumo.nome}" cadastrado com sucesso!`);
      }

      setTimeout(() => setSucesso(""), 4000);
      setModalInsumoAberto(false);
      carregarDados();
    } catch (err: unknown) {
      const axErr = err as { response?: { data?: { detail?: string } } };
      setErro(axErr.response?.data?.detail || "Erro ao salvar insumo.");
    } finally {
      setSalvandoInsumo(false);
    }
  }

  async function excluirInsumo(id: number, nome: string) {
    if (!window.confirm(`Deseja realmente inativar o insumo "${nome}"?`)) return;
    try {
      await farmaciaInsumoExcluir(id);
      setSucesso(`Insumo "${nome}" inativado com sucesso!`);
      setTimeout(() => setSucesso(""), 4000);
      carregarDados();
    } catch {
      setErro("Erro ao excluir insumo.");
    }
  }

  // Abertura Modal Movimentação
  function abrirModalMovimentacao(item: InsumoInternoOut, tipo: string) {
    setInsumoSelecionadoMov(item);
    setFormMov({
      insumo_id: item.id,
      tipo: tipo,
      quantidade: tipo.startsWith("SAIDA") ? Math.min(10, item.estoque_atual || 1) : 50,
      unidade_destino: tipo.startsWith("SAIDA") ? "PSF 01 - Centro / Sede" : "",
      responsavel_recebimento: "",
      documento_referencia: "",
      observacoes: "",
    });
    setModalMovAberto(true);
  }

  async function registrarMovimentacao(e: React.FormEvent) {
    e.preventDefault();
    if (!insumoSelecionadoMov) return;

    if (formMov.quantidade <= 0) {
      setErro("A quantidade deve ser maior que zero.");
      return;
    }

    if (formMov.tipo.startsWith("SAIDA") && formMov.quantidade > insumoSelecionadoMov.estoque_atual) {
      setErro(
        `Saldo insuficiente em estoque (${insumoSelecionadoMov.estoque_atual} ${insumoSelecionadoMov.unidade_medida}).`
      );
      return;
    }

    setSalvandoMov(true);
    setErro("");
    try {
      await farmaciaInsumoMovimentar(formMov);
      setSucesso(
        `Movimentação (${formMov.tipo}) de ${formMov.quantidade} ${insumoSelecionadoMov.unidade_medida}(s) registrada!`
      );
      setTimeout(() => setSucesso(""), 4000);
      setModalMovAberto(false);
      carregarDados();
    } catch (err: unknown) {
      const axErr = err as { response?: { data?: { detail?: string } } };
      setErro(axErr.response?.data?.detail || "Erro ao registrar movimentação de insumo.");
    } finally {
      setSalvandoMov(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/10 text-teal">
            <Package className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-sus-900">Insumos & Materiais Internos</h1>
            <p className="text-sm text-sus-900/60">
              Controle de consumo hospitalar e distribuição para postos de saúde (PSFs e PA)
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ExportarExcel
            url="/api/farmacia/insumos/exportar"
            arquivo="farmacia_insumos_internos"
            rotulo="Exportar Excel"
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

          <Button
            onClick={abrirModalNovoInsumo}
            className="flex items-center gap-2 bg-teal hover:bg-teal-700 text-white"
          >
            <Plus className="h-4 w-4" />
            Novo Insumo
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

      {/* Cards de Métricas */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-5 border border-sus-100">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-sus-900/60">
              Total de Itens
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-50 text-teal">
              <Package className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-3xl font-extrabold text-sus-900">{totalInsumos}</div>
          <p className="mt-1 text-xs text-sus-900/50">Materiais ativos no catálogo</p>
        </Card>

        <Card
          onClick={() => setApenasEstoqueBaixo(!apenasEstoqueBaixo)}
          className={`p-5 cursor-pointer transition-all border ${
            apenasEstoqueBaixo
              ? "border-amber-500 bg-amber-50/60 shadow-sm"
              : "border-amber-200 bg-amber-50/20 hover:border-amber-300"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-800">
              Estoque Baixo
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
              <AlertTriangle className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-3xl font-extrabold text-amber-900">{totalEstoqueBaixo}</div>
          <p className="mt-1 text-xs text-amber-700">Abaixo do estoque mínimo</p>
        </Card>

        <Card className="p-5 border border-red-200 bg-red-50/20">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-red-800">
              Estoque Zerado
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-100 text-red-700">
              <ShieldAlert className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-3xl font-extrabold text-red-900">{totalZerados}</div>
          <p className="mt-1 text-xs text-red-700">Sem unidades disponíveis</p>
        </Card>

        <Card className="p-5 border border-purple-100 bg-purple-50/20">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-purple-800">
              Atenção Validade
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-100 text-purple-700">
              <Clock className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-3xl font-extrabold text-purple-900">{totalProximosValidade}</div>
          <p className="mt-1 text-xs text-purple-700">Vencidos ou a vencer (&le; 30d)</p>
        </Card>
      </div>

      {/* Filtros e Busca */}
      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="relative md:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sus-900/40" />
            <input
              type="text"
              placeholder="Buscar por código, nome do insumo, lote ou local de armazenamento…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="w-full rounded-lg border border-sus-200 bg-white py-2 pl-9 pr-3 text-sm text-sus-900 placeholder:text-sus-900/40 focus:border-teal focus:outline-none focus:ring-1 focus:ring-teal"
            />
          </div>

          <div>
            <select
              value={filtroCategoria}
              onChange={(e) => setFiltroCategoria(e.target.value)}
              className="w-full rounded-lg border border-sus-200 bg-white px-3 py-2 text-sm text-sus-900 focus:border-teal focus:outline-none focus:ring-1 focus:ring-teal"
            >
              <option value="">Todas as Categorias</option>
              {CATEGORIAS_INSUMO.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {/* Tabela de Insumos */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-sus-900">
            <thead className="border-b border-sus-100 bg-sus-50/70 text-xs font-bold uppercase tracking-wider text-sus-900/60">
              <tr>
                <th className="px-4 py-3.5">Código / Insumo</th>
                <th className="px-4 py-3.5">Categoria</th>
                <th className="px-4 py-3.5">Lote / Validade</th>
                <th className="px-4 py-3.5">Localização</th>
                <th className="px-4 py-3.5 text-right">Saldo / Mínimo</th>
                <th className="px-4 py-3.5 text-center">Status</th>
                <th className="px-4 py-3.5 text-center">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sus-100">
              {carregando ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-sus-900/50">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <RefreshCw className="h-6 w-6 animate-spin text-teal" />
                      <span>Carregando insumos…</span>
                    </div>
                  </td>
                </tr>
              ) : filtrados.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-sus-900/50">
                    Nenhum insumo encontrado.
                  </td>
                </tr>
              ) : (
                filtrados.map((item) => {
                  const estoqueBaixo = item.estoque_atual <= item.estoque_minimo;
                  const zerado = item.estoque_atual <= 0;

                  return (
                    <tr
                      key={item.id}
                      className={`hover:bg-sus-50/40 transition-colors ${
                        zerado ? "bg-red-50/20" : estoqueBaixo ? "bg-amber-50/20" : ""
                      }`}
                    >
                      {/* Código e Nome */}
                      <td className="px-4 py-3">
                        <div className="font-semibold text-sus-900">{item.nome}</div>
                        <div className="text-xs text-sus-900/50">
                          {item.codigo} · {item.unidade_medida}
                        </div>
                      </td>

                      {/* Categoria */}
                      <td className="px-4 py-3">
                        <span className="inline-block rounded bg-sus-100 px-2 py-0.5 text-xs text-sus-900/70">
                          {item.categoria}
                        </span>
                      </td>

                      {/* Lote e Validade */}
                      <td className="px-4 py-3 text-xs">
                        <div className="font-medium text-sus-900">
                          {item.lote ? `Lote: ${item.lote}` : "Sem lote"}
                        </div>
                        {item.validade ? (
                          <div
                            className={`flex items-center gap-1 mt-0.5 ${
                              item.status_validade === "VENCIDO"
                                ? "text-red-700 font-semibold"
                                : item.status_validade === "PROXIMO_VENCIMENTO"
                                ? "text-amber-800 font-semibold"
                                : "text-sus-900/50"
                            }`}
                          >
                            <Calendar className="h-3 w-3" />
                            <span>
                              {new Date(item.validade + "T12:00:00").toLocaleDateString("pt-BR")}
                            </span>
                            <span>({item.contagem_regressiva_texto})</span>
                          </div>
                        ) : (
                          <div className="text-sus-900/40">Validade indet.</div>
                        )}
                      </td>

                      {/* Localização */}
                      <td className="px-4 py-3 text-xs text-sus-900/70">
                        {item.local_armazenamento || "Almoxarifado"}
                      </td>

                      {/* Saldo e Estoque Mínimo */}
                      <td className="px-4 py-3 text-right">
                        <div
                          className={`text-base font-extrabold ${
                            zerado ? "text-red-600" : estoqueBaixo ? "text-amber-700" : "text-sus-900"
                          }`}
                        >
                          {item.estoque_atual}
                        </div>
                        <div className="text-[11px] text-sus-900/50">
                          Mín: {item.estoque_minimo} {item.unidade_medida}(s)
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3 text-center">
                        {zerado ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800">
                            Zerado
                          </span>
                        ) : estoqueBaixo ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                            Estoque Baixo
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
                            Normal
                          </span>
                        )}
                      </td>

                      {/* Ações */}
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {/* Entrada */}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => abrirModalMovimentacao(item, "ENTRADA_COMPRA")}
                            className="text-emerald-700 hover:bg-emerald-50 text-xs p-1.5"
                            title="Entrada no Estoque"
                          >
                            <ArrowDownRight className="h-4 w-4" />
                          </Button>

                          {/* Saída para Posto */}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => abrirModalMovimentacao(item, "SAIDA_PSF")}
                            disabled={item.estoque_atual <= 0}
                            className="border-sus-200 text-teal hover:bg-teal-50 text-xs py-1 px-2 flex items-center gap-1"
                            title="Distribuir para PSF / Unidade de Saúde"
                          >
                            <Send className="h-3 w-3" />
                            Saída PSF
                          </Button>

                          {/* Editar */}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => abrirModalEditarInsumo(item)}
                            className="text-sus-900/60 hover:text-sus-900 p-1.5"
                            title="Editar Dados do Insumo"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>

                          {/* Excluir */}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => excluirInsumo(item.id, item.nome)}
                            className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1.5"
                            title="Inativar Insumo"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
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

      {/* Modal Cadastro/Edição de Insumo */}
      {modalInsumoAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 shadow-xl animate-in fade-in-50">
            <div className="flex items-center justify-between border-b border-sus-100 pb-3">
              <div className="flex items-center gap-2 text-sus-900">
                <Package className="h-5 w-5 text-teal" />
                <h3 className="text-lg font-bold">
                  {insumoEditando ? "Editar Insumo" : "Cadastrar Novo Insumo"}
                </h3>
              </div>
              <button
                onClick={() => setModalInsumoAberto(false)}
                className="text-sus-900/40 hover:text-sus-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={salvarInsumo} className="mt-4 space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <Label htmlFor="ins_cod">Código</Label>
                  <Input
                    id="ins_cod"
                    type="text"
                    value={formInsumo.codigo}
                    onChange={(e) => setFormInsumo({ ...formInsumo, codigo: e.target.value })}
                    required
                  />
                </div>

                <div className="sm:col-span-2">
                  <Label htmlFor="ins_nome">Nome do Insumo / Material</Label>
                  <Input
                    id="ins_nome"
                    type="text"
                    value={formInsumo.nome}
                    onChange={(e) => setFormInsumo({ ...formInsumo, nome: e.target.value })}
                    placeholder="Ex: Luva de Procedimento Látex Tam. M"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="ins_cat">Categoria</Label>
                  <select
                    id="ins_cat"
                    value={formInsumo.categoria}
                    onChange={(e) => setFormInsumo({ ...formInsumo, categoria: e.target.value })}
                    className="w-full rounded-lg border border-sus-200 bg-white px-3 py-2 text-sm text-sus-900 focus:border-teal focus:outline-none"
                    required
                  >
                    {CATEGORIAS_INSUMO.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <Label htmlFor="ins_unidade">Unidade de Medida</Label>
                  <select
                    id="ins_unidade"
                    value={formInsumo.unidade_medida}
                    onChange={(e) => setFormInsumo({ ...formInsumo, unidade_medida: e.target.value })}
                    className="w-full rounded-lg border border-sus-200 bg-white px-3 py-2 text-sm text-sus-900 focus:border-teal focus:outline-none"
                    required
                  >
                    {UNIDADES_MEDIDA.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="ins_lote">Lote</Label>
                  <Input
                    id="ins_lote"
                    type="text"
                    value={formInsumo.lote || ""}
                    onChange={(e) => setFormInsumo({ ...formInsumo, lote: e.target.value })}
                    placeholder="Ex: LOT-2026-B"
                  />
                </div>

                <div>
                  <Label htmlFor="ins_val">Data de Validade</Label>
                  <Input
                    id="ins_val"
                    type="date"
                    value={formInsumo.validade || ""}
                    onChange={(e) => setFormInsumo({ ...formInsumo, validade: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {!insumoEditando && (
                  <div>
                    <Label htmlFor="ins_est_ini">Estoque Inicial</Label>
                    <Input
                      id="ins_est_ini"
                      type="number"
                      min="0"
                      value={formInsumo.estoque_atual}
                      onChange={(e) =>
                        setFormInsumo({ ...formInsumo, estoque_atual: Number(e.target.value) })
                      }
                      required
                    />
                  </div>
                )}

                <div>
                  <Label htmlFor="ins_min">Estoque Mínimo (Alerta)</Label>
                  <Input
                    id="ins_min"
                    type="number"
                    min="0"
                    value={formInsumo.estoque_minimo}
                    onChange={(e) =>
                      setFormInsumo({ ...formInsumo, estoque_minimo: Number(e.target.value) })
                    }
                    required
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="ins_loc">Local de Armazenamento</Label>
                <Input
                  id="ins_loc"
                  type="text"
                  value={formInsumo.local_armazenamento || ""}
                  onChange={(e) =>
                    setFormInsumo({ ...formInsumo, local_armazenamento: e.target.value })
                  }
                  placeholder="Ex: Almoxarifado Central · Prateleira 2"
                />
              </div>

              <div>
                <Label htmlFor="ins_obs">Observações Adicionais</Label>
                <textarea
                  id="ins_obs"
                  rows={2}
                  value={formInsumo.observacoes || ""}
                  onChange={(e) => setFormInsumo({ ...formInsumo, observacoes: e.target.value })}
                  placeholder="Instruções de uso ou detalhes..."
                  className="w-full rounded-lg border border-sus-200 bg-white p-2 text-sm text-sus-900 focus:border-teal focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 border-t border-sus-100 pt-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setModalInsumoAberto(false)}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={salvandoInsumo}
                  className="bg-teal hover:bg-teal-700 text-white"
                >
                  {salvandoInsumo ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Salvar Insumo"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Modal de Movimentação de Insumo (Entrada ou Saída para PSF) */}
      {modalMovAberto && insumoSelecionadoMov && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-lg p-6 shadow-xl animate-in fade-in-50">
            <div className="flex items-center justify-between border-b border-sus-100 pb-3">
              <div className="flex items-center gap-2 text-sus-900">
                {formMov.tipo.startsWith("ENTRADA") ? (
                  <ShoppingCart className="h-5 w-5 text-emerald-600" />
                ) : (
                  <Send className="h-5 w-5 text-teal" />
                )}
                <h3 className="text-lg font-bold">
                  {formMov.tipo.startsWith("ENTRADA")
                    ? "Entrada de Insumo no Estoque"
                    : "Distribuição / Saída para PSF ou Unidade"}
                </h3>
              </div>
              <button
                onClick={() => setModalMovAberto(false)}
                className="text-sus-900/40 hover:text-sus-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={registrarMovimentacao} className="mt-4 space-y-4">
              <div className="rounded-lg bg-sus-50 p-3 text-sm text-sus-900">
                <div className="font-bold">{insumoSelecionadoMov.nome}</div>
                <div className="text-xs text-sus-900/60 mt-0.5">
                  Código: {insumoSelecionadoMov.codigo} · Saldo Atual:{" "}
                  <span className="font-bold text-sus-900">
                    {insumoSelecionadoMov.estoque_atual} {insumoSelecionadoMov.unidade_medida}(s)
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="tipo_mov_ins">Tipo de Movimentação</Label>
                  <select
                    id="tipo_mov_ins"
                    value={formMov.tipo}
                    onChange={(e) => setFormMov({ ...formMov, tipo: e.target.value })}
                    className="w-full rounded-lg border border-sus-200 bg-white px-3 py-2 text-sm text-sus-900 focus:border-teal focus:outline-none"
                    required
                  >
                    <option value="SAIDA_PSF">Saída para PSF / Unidade de Saúde</option>
                    <option value="ENTRADA_COMPRA">Entrada por Compra / Lote</option>
                    <option value="ENTRADA_DOACAO">Entrada por Doação / Remessa Estadual</option>
                    <option value="SAIDA_PERDA">Saída por Perda / Avaria / Descarte</option>
                    <option value="AJUSTE_INVENTARIO">Ajuste de Inventário</option>
                  </select>
                </div>

                <div>
                  <Label htmlFor="qtd_mov_ins">
                    Quantidade ({insumoSelecionadoMov.unidade_medida})
                  </Label>
                  <Input
                    id="qtd_mov_ins"
                    type="number"
                    min="1"
                    max={formMov.tipo.startsWith("SAIDA") ? insumoSelecionadoMov.estoque_atual : undefined}
                    value={formMov.quantidade}
                    onChange={(e) => setFormMov({ ...formMov, quantidade: Number(e.target.value) })}
                    required
                  />
                </div>
              </div>

              {/* Se for Saída para PSF */}
              {formMov.tipo === "SAIDA_PSF" && (
                <>
                  <div>
                    <Label htmlFor="psf_destino">Unidade de Destino / Posto de Saúde</Label>
                    <select
                      id="psf_destino"
                      value={formMov.unidade_destino}
                      onChange={(e) => setFormMov({ ...formMov, unidade_destino: e.target.value })}
                      className="w-full rounded-lg border border-sus-200 bg-white px-3 py-2 text-sm text-sus-900 focus:border-teal focus:outline-none"
                      required
                    >
                      {POSTOS_DESTINO_PADRAO.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <Label htmlFor="resp_receb">Responsável pelo Recebimento na Unidade</Label>
                    <Input
                      id="resp_receb"
                      type="text"
                      value={formMov.responsavel_recebimento || ""}
                      onChange={(e) =>
                        setFormMov({ ...formMov, responsavel_recebimento: e.target.value })
                      }
                      placeholder="Ex: Enf. Maria Clara / Farmacêutico João"
                    />
                  </div>
                </>
              )}

              <div>
                <Label htmlFor="doc_ref">Nº da Nota Fiscal ou Guia de Remessa Interna</Label>
                <Input
                  id="doc_ref"
                  type="text"
                  value={formMov.documento_referencia || ""}
                  onChange={(e) => setFormMov({ ...formMov, documento_referencia: e.target.value })}
                  placeholder="Ex: NF 10243 ou Guia 2026/04"
                />
              </div>

              <div>
                <Label htmlFor="obs_mov">Observações</Label>
                <textarea
                  id="obs_mov"
                  rows={2}
                  value={formMov.observacoes || ""}
                  onChange={(e) => setFormMov({ ...formMov, observacoes: e.target.value })}
                  placeholder="Detalhes sobre a entrega ou lote..."
                  className="w-full rounded-lg border border-sus-200 bg-white p-2 text-sm text-sus-900 focus:border-teal focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 border-t border-sus-100 pt-3">
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
                  className={`text-white ${
                    formMov.tipo.startsWith("ENTRADA")
                      ? "bg-emerald-600 hover:bg-emerald-700"
                      : "bg-teal hover:bg-teal-700"
                  }`}
                >
                  {salvandoMov ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Confirmar Movimentação"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
