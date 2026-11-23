import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Ambulance,
  Building2,
  Calendar,
  CheckCircle2,
  Coins,
  DollarSign,
  Download,
  FileCheck,
  FileSpreadsheet,
  FileText,
  Filter,
  FlaskConical,
  Layers,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";
import {
  downloadBpaCsv,
  downloadBpaOut,
  fetchBpaResumo,
  type BpaItemResumo,
  type BpaResumoCompleto,
} from "../services/api";
import { Badge, Button, Card, Input, Label } from "../components/ui/primitives";

export default function FaturamentoBpa() {
  const mesAtual = useMemo(() => {
    const d = new Date();
    const ano = d.getFullYear();
    const mes = String(d.getMonth() + 1).padStart(2, "0");
    return `${ano}-${mes}`;
  }, []);

  const [competencia, setCompetencia] = useState(mesAtual);
  const [resumo, setResumo] = useState<BpaResumoCompleto | null>(null);
  const [loading, setLoading] = useState(false);
  const [baixandoOut, setBaixandoOut] = useState(false);
  const [baixandoCsv, setBaixandoCsv] = useState(false);
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState("");
  const [abaAtiva, setAbaAtiva] = useState<"todos" | "bpac" | "bpai">("todos");
  const [termoBusca, setTermoBusca] = useState("");

  const carregarDados = async (comp = competencia) => {
    setLoading(true);
    setErro("");
    try {
      const data = await fetchBpaResumo(comp);
      setResumo(data);
    } catch (err: any) {
      setErro(err?.response?.data?.detail || "Erro ao carregar dados da produção ambulatorial.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarDados(competencia);
  }, [competencia]);

  const handleDownloadOut = async () => {
    setBaixandoOut(true);
    setErro("");
    try {
      await downloadBpaOut(competencia);
      setSucesso("Arquivo oficial PA312810.OUT gerado com sucesso para importação no SIA-SUS!");
      setTimeout(() => setSucesso(""), 6000);
    } catch (err: any) {
      setErro(err?.response?.data?.detail || "Falha ao gerar arquivo .OUT");
    } finally {
      setBaixandoOut(false);
    }
  };

  const handleDownloadCsv = async () => {
    setBaixandoCsv(true);
    setErro("");
    try {
      await downloadBpaCsv(competencia);
      setSucesso("Planilha de conferência (.CSV) exportada com sucesso!");
      setTimeout(() => setSucesso(""), 6000);
    } catch (err: any) {
      setErro(err?.response?.data?.detail || "Falha ao exportar planilha CSV");
    } finally {
      setBaixandoCsv(false);
    }
  };

  const mudarMes = (delta: number) => {
    const [anoStr, mesStr] = competencia.split("-");
    const d = new Date(parseInt(anoStr), parseInt(mesStr) - 1 + delta, 1);
    const novoAno = d.getFullYear();
    const novoMes = String(d.getMonth() + 1).padStart(2, "0");
    setCompetencia(`${novoAno}-${novoMes}`);
  };

  // Filtragem da lista para exibição
  const itensFiltrados = useMemo(() => {
    if (!resumo) return [];
    let base: (BpaItemResumo & { tipo: string })[] = [];

    if (abaAtiva === "todos" || abaAtiva === "bpac") {
      base = base.concat(resumo.itens_bpa_c.map((it) => ({ ...it, tipo: "BPA-C" })));
    }
    if (abaAtiva === "todos" || abaAtiva === "bpai") {
      base = base.concat(resumo.itens_bpa_i.map((it) => ({ ...it, tipo: "BPA-I" })));
    }

    if (!termoBusca.trim()) return base;
    const termo = termoBusca.toLowerCase();
    return base.filter(
      (it) =>
        it.procedimento.toLowerCase().includes(termo) ||
        it.descricao.toLowerCase().includes(termo) ||
        (it.paciente_nome && it.paciente_nome.toLowerCase().includes(termo)) ||
        (it.paciente_cpf && it.paciente_cpf.includes(termo)) ||
        it.origem.toLowerCase().includes(termo)
    );
  }, [resumo, abaAtiva, termoBusca]);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-200 dark:border-gray-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <FileCheck className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
              Faturamento BPA Oficial (SIA/SUS)
            </h1>
            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300">
              Layout DATASUS 100%
            </Badge>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Geração oficial do Boletim de Produção Ambulatorial (.OUT) unificando Exames Laboratoriais e Viagens/Transporte TFD (Grupo 08).
          </p>
        </div>

        {/* Seletor de Competência */}
        <div className="flex items-center gap-2 bg-white dark:bg-gray-800 p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
          <Button variant="ghost" size="sm" onClick={() => mudarMes(-1)} title="Mês anterior">
            ◀
          </Button>
          <div className="flex items-center gap-2 px-2">
            <Calendar className="h-4 w-4 text-gray-500" />
            <input
              type="month"
              value={competencia}
              onChange={(e) => e.target.value && setCompetencia(e.target.value)}
              className="text-sm font-semibold bg-transparent border-0 focus:ring-0 text-gray-800 dark:text-gray-200 cursor-pointer"
            />
          </div>
          <Button variant="ghost" size="sm" onClick={() => mudarMes(1)} title="Próximo mês">
            ▶
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => carregarDados()}
            disabled={loading}
            className="ml-1"
            title="Atualizar dados"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Alertas */}
      {sucesso && (
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 rounded-lg flex items-center gap-2 text-sm shadow-sm animate-fadeIn">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
          <span>{sucesso}</span>
        </div>
      )}

      {erro && (
        <div className="p-3 bg-red-50 dark:bg-red-950/60 border border-red-300 dark:border-red-800 text-red-800 dark:text-red-200 rounded-lg flex items-center gap-2 text-sm shadow-sm">
          <AlertCircle className="h-5 w-5 text-red-600 shrink-0" />
          <span>{erro}</span>
        </div>
      )}

      {/* Bloco de Ações de Exportação em Destaque */}
      <Card className="p-5 bg-gradient-to-r from-emerald-50/70 via-teal-50/50 to-blue-50/70 dark:from-emerald-950/20 dark:via-gray-900 dark:to-blue-950/20 border-emerald-200 dark:border-emerald-900 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-600" />
              Arquivo de Remessa Oficial SIA-SUS (Guapé - MG)
            </h3>
            <p className="text-xs text-gray-600 dark:text-gray-400">
              CNES SMS: <span className="font-mono font-bold text-gray-800 dark:text-gray-200">2146479</span> | IBGE:{" "}
              <span className="font-mono font-bold text-gray-800 dark:text-gray-200">312810</span> | CNPJ:{" "}
              <span className="font-mono font-bold text-gray-800 dark:text-gray-200">18.239.616/0001-85</span> | Código Controle:{" "}
              <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
                {resumo?.controle_verificador ?? "----"}
              </span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={handleDownloadOut}
              disabled={baixandoOut || loading || (resumo?.total_geral_itens ?? 0) === 0}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-md flex items-center gap-2 px-5 py-2.5"
            >
              <Download className={`h-4 w-4 ${baixandoOut ? "animate-bounce" : ""}`} />
              {baixandoOut ? "Gerando .OUT..." : "📥 Baixar Arquivo BPA Oficial (.OUT)"}
            </Button>

            <Button
              variant="outline"
              onClick={handleDownloadCsv}
              disabled={baixandoCsv || loading || (resumo?.total_geral_itens ?? 0) === 0}
              className="bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750 flex items-center gap-2"
            >
              <FileSpreadsheet className={`h-4 w-4 text-emerald-600 ${baixandoCsv ? "animate-pulse" : ""}`} />
              {baixandoCsv ? "Exportando..." : "📊 Planilha de Conferência (.CSV)"}
            </Button>
          </div>
        </div>
      </Card>

      {/* Cards de Métricas Principais */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Exames Laboratoriais */}
        <Card className="p-4 border-l-4 border-l-cyan-500 bg-white dark:bg-gray-800 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Exames Laboratoriais
              </p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">
                {loading ? "..." : (resumo?.total_exames ?? 0).toLocaleString("pt-BR")}
              </p>
            </div>
            <div className="p-2.5 bg-cyan-50 dark:bg-cyan-950/60 rounded-lg text-cyan-600 dark:text-cyan-400">
              <FlaskConical className="h-6 w-6" />
            </div>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            Rotinas de sangue, urina e sorologias realizadas
          </p>
        </Card>

        {/* Card 2: Viagens TFD */}
        <Card className="p-4 border-l-4 border-l-amber-500 bg-white dark:bg-gray-800 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Viagens & Carro (TFD)
              </p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">
                {loading ? "..." : (resumo?.total_viagens_tfd ?? 0).toLocaleString("pt-BR")}
              </p>
            </div>
            <div className="p-2.5 bg-amber-50 dark:bg-amber-950/60 rounded-lg text-amber-600 dark:text-amber-400">
              <Ambulance className="h-6 w-6" />
            </div>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            Deslocamentos de pacientes e acompanhantes (Grupo 08)
          </p>
        </Card>

        {/* Card 3: Linhas e Folhas */}
        <Card className="p-4 border-l-4 border-l-indigo-500 bg-white dark:bg-gray-800 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Produção BPA Gravada
              </p>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">
                {loading ? "..." : `${resumo?.total_linhas ?? 0} lin`}
              </p>
            </div>
            <div className="p-2.5 bg-indigo-50 dark:bg-indigo-950/60 rounded-lg text-indigo-600 dark:text-indigo-400">
              <Layers className="h-6 w-6" />
            </div>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            {resumo?.total_folhas ?? 0} folhas | {resumo?.total_procedimentos_bpa_c ?? 0} BPA-C + {resumo?.total_procedimentos_bpa_i ?? 0} BPA-I
          </p>
        </Card>

        {/* Card 4: Valor Total SUS */}
        <Card className="p-4 border-l-4 border-l-emerald-500 bg-white dark:bg-gray-800 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Valor Total Estimado SUS
              </p>
              <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                {loading ? "..." : (resumo?.valor_total_estimado ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
              </p>
            </div>
            <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/60 rounded-lg text-emerald-600 dark:text-emerald-400">
              <Coins className="h-6 w-6" />
            </div>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            Tabela SIGTAP ambulatorial e deslocamentos
          </p>
        </Card>
      </div>

      {/* Seção de Conferência e Auditoria dos Registros */}
      <Card className="p-4 md:p-6 bg-white dark:bg-gray-800 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-200 dark:border-gray-700 pb-4">
          <div className="flex items-center gap-2">
            <Button
              variant={abaAtiva === "todos" ? "default" : "outline"}
              size="sm"
              onClick={() => setAbaAtiva("todos")}
            >
              Todos os Itens ({resumo?.total_geral_itens ?? 0})
            </Button>
            <Button
              variant={abaAtiva === "bpac" ? "default" : "outline"}
              size="sm"
              onClick={() => setAbaAtiva("bpac")}
            >
              BPA-C Consolidado ({resumo?.total_procedimentos_bpa_c ?? 0})
            </Button>
            <Button
              variant={abaAtiva === "bpai" ? "default" : "outline"}
              size="sm"
              onClick={() => setAbaAtiva("bpai")}
            >
              BPA-I Individualizado ({resumo?.total_procedimentos_bpa_i ?? 0})
            </Button>
          </div>

          <div className="relative w-full md:w-72">
            <Search className="h-4 w-4 absolute left-3 top-2.5 text-gray-400" />
            <Input
              type="text"
              placeholder="Buscar por código, exame, paciente..."
              value={termoBusca}
              onChange={(e) => setTermoBusca(e.target.value)}
              className="pl-9 text-sm"
            />
          </div>
        </div>

        {/* Tabela de Itens */}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900/50 text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700">
                <th className="py-2.5 px-3 font-semibold">Tipo</th>
                <th className="py-2.5 px-2 font-semibold">Flh / Lin</th>
                <th className="py-2.5 px-3 font-semibold">Código SIGTAP</th>
                <th className="py-2.5 px-3 font-semibold">Descrição do Procedimento</th>
                <th className="py-2.5 px-3 font-semibold">Origem</th>
                <th className="py-2.5 px-3 font-semibold">Paciente / Identificação</th>
                <th className="py-2.5 px-2 font-semibold text-right">Qtd</th>
                <th className="py-2.5 px-3 font-semibold text-right">Unitário</th>
                <th className="py-2.5 px-3 font-semibold text-right">Total SUS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-gray-500">
                    <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-emerald-600" />
                    Carregando produção do BPA...
                  </td>
                </tr>
              ) : itensFiltrados.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-gray-500">
                    Nenhum procedimento encontrado para a competência selecionada.
                  </td>
                </tr>
              ) : (
                itensFiltrados.map((it, idx) => (
                  <tr
                    key={idx}
                    className="hover:bg-gray-50 dark:hover:bg-gray-750/50 transition-colors"
                  >
                    <td className="py-2.5 px-3">
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded font-mono text-[10px] font-bold ${
                          it.tipo === "BPA-C"
                            ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300"
                            : "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300"
                        }`}
                      >
                        {it.tipo}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 font-mono text-gray-500">
                      {String(it.folha).padStart(3, "0")}/{String(it.linha).padStart(2, "0")}
                    </td>
                    <td className="py-2.5 px-3 font-mono font-semibold text-gray-800 dark:text-gray-200">
                      {it.procedimento}
                    </td>
                    <td className="py-2.5 px-3 text-gray-800 dark:text-gray-200 font-medium max-w-xs truncate" title={it.descricao}>
                      {it.descricao}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="text-gray-600 dark:text-gray-400 text-[11px]">
                        {it.origem}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-gray-700 dark:text-gray-300 max-w-xs truncate">
                      {it.paciente_nome ? (
                        <div>
                          <div className="font-semibold text-gray-900 dark:text-gray-100 truncate" title={it.paciente_nome}>
                            {it.paciente_nome}
                          </div>
                          <div className="text-[10px] text-gray-400 font-mono">
                            {it.paciente_cpf ? `CPF: ${it.paciente_cpf}` : it.paciente_cns ? `CNS: ${it.paciente_cns}` : ""}
                          </div>
                        </div>
                      ) : (
                        <span className="text-gray-400 italic">Consolidado Geral</span>
                      )}
                    </td>
                    <td className="py-2.5 px-2 font-mono font-bold text-right text-gray-900 dark:text-gray-100">
                      {it.quantidade}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-right text-gray-600 dark:text-gray-400">
                      {it.valor_unitario.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                    </td>
                    <td className="py-2.5 px-3 font-mono font-bold text-right text-emerald-700 dark:text-emerald-400">
                      {it.valor_total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
