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
    <div className="space-y-5">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-sus-900/10 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-xl font-bold text-sus-950 flex items-center gap-2">
              <FileCheck className="h-6 w-6 text-teal" />
              Faturamento BPA Oficial (SIA/SUS)
            </h1>
            <span className="rounded-full bg-teal/10 px-2.5 py-0.5 text-xs font-bold text-teal border border-teal/20">
              Layout DATASUS 100%
            </span>
          </div>
          <p className="text-xs text-ink/65 mt-1">
            Geração oficial do Boletim de Produção Ambulatorial (.OUT) unificando Exames Laboratoriais e Viagens/Transporte TFD (Grupo 08).
          </p>
        </div>

        {/* Seletor de Competência */}
        <div className="flex items-center gap-2 bg-white p-1 rounded-xl border border-sus-900/15 shadow-xs">
          <Button variant="ghost" size="sm" onClick={() => mudarMes(-1)} title="Mês anterior" className="!h-8 !px-2.5 text-xs">
            ◀
          </Button>
          <div className="flex items-center gap-1.5 px-2">
            <Calendar className="h-4 w-4 text-ink/50" />
            <input
              type="month"
              value={competencia}
              onChange={(e) => e.target.value && setCompetencia(e.target.value)}
              className="text-xs font-semibold bg-transparent border-0 focus:ring-0 text-sus-950 cursor-pointer"
            />
          </div>
          <Button variant="ghost" size="sm" onClick={() => mudarMes(1)} title="Próximo mês" className="!h-8 !px-2.5 text-xs">
            ▶
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => carregarDados()}
            disabled={loading}
            className="ml-1 !h-8 !px-2.5 text-xs border-sus-900/15"
            title="Atualizar dados"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Alertas */}
      {sucesso && (
        <div className="p-3 bg-teal/10 border border-teal/25 text-teal rounded-xl flex items-center gap-2 text-xs font-medium shadow-xs">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-teal" />
          <span>{sucesso}</span>
        </div>
      )}

      {erro && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-800 rounded-xl flex items-center gap-2 text-xs font-medium shadow-xs">
          <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
          <span>{erro}</span>
        </div>
      )}

      {/* Bloco de Ações de Exportação em Destaque */}
      <Card className="p-5 bg-white border border-teal/25 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <h3 className="font-display text-sm font-bold text-sus-950 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-teal" />
              Arquivo de Remessa Oficial SIA-SUS (Guapé - MG)
            </h3>
            <p className="text-xs text-ink/65">
              CNES SMS: <span className="font-mono font-bold text-sus-950">2146479</span> · IBGE:{" "}
              <span className="font-mono font-bold text-sus-950">312810</span> · CNPJ:{" "}
              <span className="font-mono font-bold text-sus-950">18.239.616/0001-85</span> · Código Controle:{" "}
              <span className="font-mono font-bold text-teal">
                {resumo?.controle_verificador ?? "----"}
              </span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              onClick={handleDownloadOut}
              disabled={baixandoOut || loading || (resumo?.total_geral_itens ?? 0) === 0}
              className="bg-teal hover:brightness-110 text-sus-950 font-bold shadow-xs flex items-center gap-2 px-4 py-2 text-xs"
            >
              <Download className={`h-4 w-4 ${baixandoOut ? "animate-bounce" : ""}`} />
              {baixandoOut ? "Gerando .OUT..." : "Baixar Arquivo Oficial (.OUT)"}
            </Button>

            <Button
              variant="outline"
              onClick={handleDownloadCsv}
              disabled={baixandoCsv || loading || (resumo?.total_geral_itens ?? 0) === 0}
              className="border border-sus-900/15 bg-white hover:bg-sand text-ink text-xs font-semibold flex items-center gap-2 px-3.5 py-2"
            >
              <FileSpreadsheet className={`h-4 w-4 text-teal ${baixandoCsv ? "animate-pulse" : ""}`} />
              {baixandoCsv ? "Exportando..." : "Planilha Conferência (.CSV)"}
            </Button>
          </div>
        </div>
      </Card>

      {/* Cards de Métricas Principais */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Exames Laboratoriais */}
        <Card className="p-4 border-l-4 border-l-teal bg-white shadow-xs">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold text-ink/55 uppercase tracking-wider">
                Exames Laboratoriais
              </p>
              <p className="font-display text-2xl font-bold text-sus-950 mt-1">
                {loading ? "..." : (resumo?.total_exames ?? 0).toLocaleString("pt-BR")}
              </p>
            </div>
            <div className="p-2.5 bg-teal/10 rounded-xl text-teal">
              <FlaskConical className="h-5 w-5" />
            </div>
          </div>
          <p className="text-[11px] text-ink/50 mt-2">
            Rotinas de sangue, urina e sorologias
          </p>
        </Card>

        {/* Card 2: Viagens TFD */}
        <Card className="p-4 border-l-4 border-l-amber-500 bg-white shadow-xs">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold text-ink/55 uppercase tracking-wider">
                Viagens & Carro (TFD)
              </p>
              <p className="font-display text-2xl font-bold text-sus-950 mt-1">
                {loading ? "..." : (resumo?.total_viagens_tfd ?? 0).toLocaleString("pt-BR")}
              </p>
            </div>
            <div className="p-2.5 bg-amber-500/10 rounded-xl text-amber-600">
              <Ambulance className="h-5 w-5" />
            </div>
          </div>
          <p className="text-[11px] text-ink/50 mt-2">
            Deslocamentos de pacientes e acompanhantes
          </p>
        </Card>

        {/* Card 3: Linhas e Folhas */}
        <Card className="p-4 border-l-4 border-l-indigo-500 bg-white shadow-xs">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold text-ink/55 uppercase tracking-wider">
                Produção BPA Gravada
              </p>
              <p className="font-display text-2xl font-bold text-sus-950 mt-1">
                {loading ? "..." : `${resumo?.total_linhas ?? 0} lin`}
              </p>
            </div>
            <div className="p-2.5 bg-indigo-500/10 rounded-xl text-indigo-600">
              <Layers className="h-5 w-5" />
            </div>
          </div>
          <p className="text-[11px] text-ink/50 mt-2">
            {resumo?.total_folhas ?? 0} folhas · {resumo?.total_procedimentos_bpa_c ?? 0} BPA-C + {resumo?.total_procedimentos_bpa_i ?? 0} BPA-I
          </p>
        </Card>

        {/* Card 4: Valor Total SUS */}
        <Card className="p-4 border-l-4 border-l-emerald-600 bg-white shadow-xs">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold text-ink/55 uppercase tracking-wider">
                Valor Estimado SUS
              </p>
              <p className="font-display text-2xl font-bold text-emerald-700 mt-1">
                {loading ? "..." : (resumo?.valor_total_estimado ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
              </p>
            </div>
            <div className="p-2.5 bg-emerald-600/10 rounded-xl text-emerald-600">
              <Coins className="h-5 w-5" />
            </div>
          </div>
          <p className="text-[11px] text-ink/50 mt-2">
            Tabela SIGTAP e deslocamentos
          </p>
        </Card>
      </div>

      {/* Seção de Conferência e Auditoria dos Registros */}
      <Card className="overflow-hidden border-sus-900/10 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-4 border-b border-sus-900/10 bg-sand/30">
          <div className="flex items-center gap-1.5 rounded-xl bg-sand p-1">
            <button
              type="button"
              onClick={() => setAbaAtiva("todos")}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                abaAtiva === "todos"
                  ? "bg-white text-sus-950 shadow-xs"
                  : "text-ink/65 hover:text-sus-950"
              }`}
            >
              Todos ({resumo?.total_geral_itens ?? 0})
            </button>
            <button
              type="button"
              onClick={() => setAbaAtiva("bpac")}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                abaAtiva === "bpac"
                  ? "bg-white text-sus-950 shadow-xs"
                  : "text-ink/65 hover:text-sus-950"
              }`}
            >
              BPA-C Consolidado ({resumo?.total_procedimentos_bpa_c ?? 0})
            </button>
            <button
              type="button"
              onClick={() => setAbaAtiva("bpai")}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                abaAtiva === "bpai"
                  ? "bg-white text-sus-950 shadow-xs"
                  : "text-ink/65 hover:text-sus-950"
              }`}
            >
              BPA-I Individualizado ({resumo?.total_procedimentos_bpa_i ?? 0})
            </button>
          </div>

          <div className="relative w-full md:w-80">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink/40 pointer-events-none" />
            <Input
              type="text"
              placeholder="Buscar por código, exame, paciente..."
              value={termoBusca}
              onChange={(e) => setTermoBusca(e.target.value)}
              className="!pl-9 !h-9 text-xs"
            />
          </div>
        </div>

        {/* Tabela de Itens */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-sus-900/10 bg-sand text-xs uppercase text-sus-900/60 font-semibold">
                <th className="py-3 px-3">Tipo</th>
                <th className="py-3 px-2">Flh / Lin</th>
                <th className="py-3 px-3">Código SIGTAP</th>
                <th className="py-3 px-3">Descrição do Procedimento</th>
                <th className="py-3 px-3">Origem</th>
                <th className="py-3 px-3">Paciente / Identificação</th>
                <th className="py-3 px-2 text-right">Qtd</th>
                <th className="py-3 px-3 text-right">Unitário</th>
                <th className="py-3 px-3 text-right">Total SUS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sus-900/5">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-ink/50">
                    <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-teal border-t-transparent mb-2" />
                    <p className="text-xs">Carregando produção do BPA...</p>
                  </td>
                </tr>
              ) : itensFiltrados.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-ink/45">
                    <FileText className="mx-auto h-8 w-8 text-ink/30 mb-2" />
                    <p className="font-semibold text-sus-950">Nenhum procedimento encontrado</p>
                    <p className="text-xs text-ink/50 mt-1">
                      Não há registros ambulatoriais para a competência e filtro selecionados.
                    </p>
                  </td>
                </tr>
              ) : (
                itensFiltrados.map((it, idx) => (
                  <tr
                    key={idx}
                    className="hover:bg-sand/30 transition-colors"
                  >
                    <td className="py-2.5 px-3">
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded font-mono text-[10px] font-bold ${
                          it.tipo === "BPA-C"
                            ? "bg-teal/15 text-teal"
                            : "bg-purple-100 text-purple-800"
                        }`}
                      >
                        {it.tipo}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 font-mono text-ink/50">
                      {String(it.folha).padStart(3, "0")}/{String(it.linha).padStart(2, "0")}
                    </td>
                    <td className="py-2.5 px-3 font-mono font-semibold text-sus-950">
                      {it.procedimento}
                    </td>
                    <td className="py-2.5 px-3 text-ink font-medium max-w-xs truncate" title={it.descricao}>
                      {it.descricao}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="text-ink/65 text-[11px]">
                        {it.origem}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-ink/80 max-w-xs truncate">
                      {it.paciente_nome ? (
                        <div>
                          <div className="font-semibold text-sus-950 truncate" title={it.paciente_nome}>
                            {it.paciente_nome}
                          </div>
                          <div className="text-[10px] text-ink/45 font-mono">
                            {it.paciente_cpf ? `CPF: ${it.paciente_cpf}` : it.paciente_cns ? `CNS: ${it.paciente_cns}` : ""}
                          </div>
                        </div>
                      ) : (
                        <span className="text-ink/40 italic">Consolidado Geral</span>
                      )}
                    </td>
                    <td className="py-2.5 px-2 font-mono font-bold text-right text-sus-950">
                      {it.quantidade}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-right text-ink/65">
                      {it.valor_unitario.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                    </td>
                    <td className="py-2.5 px-3 font-mono font-bold text-right text-emerald-700">
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
