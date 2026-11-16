import { useEffect, useState } from "react";
import {
  AlertCircle,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  FileCheck,
  FileText,
  FlaskConical,
  Lock,
  Printer,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import {
  type Laboratorio,
  type LabFaturamentoRelatorio,
  labFaturamentoRelatorio,
  labsListar,
  fetchMe,
  type Usuario,
} from "../../services/api";
import { Button, Card, Label } from "../../components/ui/primitives";

function mesAtual(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function mesAnterior(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function formatBRL(valor: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(valor || 0);
}

export default function PortalLaboratorio() {
  const [currentUser, setCurrentUser] = useState<Usuario | null>(null);
  const [laboratorios, setLaboratorios] = useState<Laboratorio[]>([]);
  const [labId, setLabId] = useState<number>(0);
  const [competencia, setCompetencia] = useState<string>(mesAnterior());
  const [relatorio, setRelatorio] = useState<LabFaturamentoRelatorio | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erroBloqueio, setErroBloqueio] = useState<string>("");
  const [erroGeral, setErroGeral] = useState<string>("");

  useEffect(() => {
    async function init() {
      try {
        const u = await fetchMe();
        setCurrentUser(u);
        const labs = await labsListar(true);
        setLaboratorios(labs);

        if (u.laboratorio_id) {
          setLabId(u.laboratorio_id);
        } else if (labs.length > 0) {
          setLabId(labs[0].id);
        }
      } catch {
        setErroGeral("Falha ao inicializar o portal do laboratório.");
      }
    }
    init();
  }, []);

  async function carregarRelatorio(idLaboratorio: number, comp: string) {
    if (!idLaboratorio || !comp) return;
    setCarregando(true);
    setErroBloqueio("");
    setErroGeral("");
    setRelatorio(null);

    try {
      const data = await labFaturamentoRelatorio(idLaboratorio, comp);
      setRelatorio(data);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: { detail?: string } } };
      if (axiosErr.response?.status === 403) {
        const msg = axiosErr.response.data?.detail || "A produção deste mês ainda não foi liberada pela Secretaria de Saúde.";
        setErroBloqueio(msg);
      } else {
        const msg = axiosErr.response?.data?.detail || "Erro ao consultar faturamento do laboratório.";
        setErroGeral(typeof msg === "string" ? msg : "Erro ao carregar dados.");
      }
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    if (labId > 0 && competencia) {
      carregarRelatorio(labId, competencia);
    }
  }, [labId, competencia]);

  const labSelecionado = laboratorios.find((l) => l.id === labId);
  const podeTrocarLab = !currentUser?.laboratorio_id || currentUser.is_superuser;

  return (
    <div className="space-y-6 p-6 max-w-7xl mx-auto">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-sus-900/10 pb-4 print:hidden">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-sus-950 flex items-center gap-2">
            <FlaskConical className="h-6 w-6 text-teal" /> Portal do Prestador · Produção e Faturamento
          </h1>
          <p className="text-xs text-ink/60 mt-1">
            Espelho de produção mensal homologada e demonstrativo financeiro para prestadores conveniados.
          </p>
        </div>

        {relatorio && !erroBloqueio && (
          <Button
            onClick={() => window.print()}
            className="bg-sus-900 text-white hover:bg-sus-950 gap-1.5 shadow-sm print:hidden"
          >
            <Printer className="h-4 w-4" /> Imprimir Relatório
          </Button>
        )}
      </div>

      {/* Controles de Seleção */}
      <Card className="p-4 bg-sand/30 border border-sus-900/10 print:hidden shadow-sm">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
          {podeTrocarLab ? (
            <div>
              <Label className="text-xs font-bold text-sus-950">Laboratório Prestador</Label>
              <select
                value={labId}
                onChange={(e) => setLabId(Number(e.target.value))}
                className="mt-1 w-full rounded-xl border border-sus-900/20 bg-white px-3 py-2 text-xs font-semibold text-sus-950"
              >
                {laboratorios.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.nome}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <Label className="text-xs font-bold text-sus-950">Laboratório</Label>
              <div className="mt-1 p-2 rounded-xl bg-white border border-sus-900/20 text-xs font-bold text-sus-950">
                {labSelecionado?.nome || "Laboratório Vinculado"}
              </div>
            </div>
          )}

          <div>
            <Label className="text-xs font-bold text-sus-950">Competência de Referência (Mês/Ano)</Label>
            <input
              type="month"
              value={competencia}
              onChange={(e) => setCompetencia(e.target.value)}
              className="mt-1 w-full rounded-xl border border-sus-900/20 bg-white px-3 py-2 text-xs font-bold text-sus-950"
            />
          </div>

          <div>
            <Button
              onClick={() => carregarRelatorio(labId, competencia)}
              disabled={carregando}
              className="w-full bg-teal text-white hover:bg-teal/90 text-xs font-bold !h-10"
            >
              {carregando ? "Consultando..." : "Consultar Produção"}
            </Button>
          </div>
        </div>
      </Card>

      {/* Bloqueio / Trava de visualização da Secretaria de Saúde */}
      {erroBloqueio && (
        <Card className="p-8 border-2 border-amber-300 bg-amber-50/70 rounded-2xl shadow-sm text-center max-w-3xl mx-auto space-y-4">
          <div className="inline-flex p-4 bg-amber-100 rounded-full text-amber-700">
            <Lock className="h-10 w-10" />
          </div>
          <h2 className="text-lg font-black text-amber-950">Produção Mensal em Auditoria pela Secretaria</h2>
          <p className="text-xs text-amber-900/80 leading-relaxed max-w-xl mx-auto">
            {erroBloqueio}
          </p>
          <div className="pt-2 text-[11px] text-amber-800/60 font-medium">
            Por determinação da Secretaria Municipal de Saúde, o espelho final de faturamento é liberado apenas após a
            conclusão da conferência dos laudos, fechamento da competência e emissão do parecer formal da pasta.
          </div>
        </Card>
      )}

      {erroGeral && (
        <div className="rounded-xl bg-red-50 p-4 text-xs font-semibold text-red-700 border border-red-200">
          {erroGeral}
        </div>
      )}

      {/* Relatório Liberado e Aprovado */}
      {relatorio && !erroBloqueio && (
        <div className="space-y-6">
          {/* Card de Homologação */}
          <div className="rounded-2xl border border-teal/30 bg-teal/5 p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-teal/20 p-2.5 text-teal">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <div>
                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-teal uppercase tracking-wider">
                  <ShieldCheck className="h-3.5 w-3.5" /> Produção Homologada & Aprovada
                </span>
                <h3 className="text-sm font-black text-sus-950 mt-0.5">
                  Faturamento Liberado pela Secretaria Municipal de Saúde
                </h3>
                {relatorio.aprovado_por && (
                  <p className="text-xs text-ink/60 mt-0.5">
                    Homologado por: <strong>{relatorio.aprovado_por}</strong>
                    {relatorio.aprovado_em && ` em ${new Date(relatorio.aprovado_em).toLocaleDateString("pt-BR")}`}
                  </p>
                )}
              </div>
            </div>

            {relatorio.parecer_secretaria && (
              <div className="text-xs bg-white/80 p-3 rounded-xl border border-teal/20 max-w-md">
                <span className="font-bold text-teal block mb-0.5">Parecer da Secretaria:</span>
                <span className="text-ink/75 italic">{relatorio.parecer_secretaria}</span>
              </div>
            )}
          </div>

          {/* Cards de Métricas Financeiras */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <Card className="p-4 border-sus-900/10">
              <p className="text-[11px] font-semibold text-ink/60 uppercase tracking-wider">Total de Pedidos</p>
              <p className="text-2xl font-black text-sus-950 mt-1">
                {relatorio.total_solicitacoes ?? (relatorio as unknown as { qtd_solicitacoes: number }).qtd_solicitacoes ?? 0}
              </p>
              <p className="text-[10px] text-ink/50 mt-0.5">Pacientes atendidos</p>
            </Card>

            <Card className="p-4 border-sus-900/10">
              <p className="text-[11px] font-semibold text-ink/60 uppercase tracking-wider">Total de Procedimentos</p>
              <p className="text-2xl font-black text-sus-950 mt-1">
                {relatorio.total_exames ?? (relatorio as unknown as { qtd_exames_total: number }).qtd_exames_total ?? 0}
              </p>
              <p className="text-[10px] text-ink/50 mt-0.5">Exames executados</p>
            </Card>

            <Card className="p-4 border-sus-900/10">
              <p className="text-[11px] font-semibold text-ink/60 uppercase tracking-wider">Total Bruto Apurado</p>
              <p className="text-2xl font-black text-sus-950 mt-1">
                {formatBRL(relatorio.valor_total ?? (relatorio as unknown as { valor_total_bruto: number }).valor_total_bruto ?? 0)}
              </p>
              <p className="text-[10px] text-ink/50 mt-0.5">Tabela contratual / SIGTAP</p>
            </Card>

            <Card className="p-4 border-sus-900/10 bg-teal/5 border-teal/20">
              <p className="text-[11px] font-bold text-teal uppercase tracking-wider">Valor Líquido Aprovado</p>
              <p className="text-2xl font-black text-teal mt-1">
                {formatBRL(relatorio.valor_aprovado ?? (relatorio as unknown as { valor_total_liquido: number }).valor_total_liquido ?? 0)}
              </p>
              <p className="text-[10px] text-teal/70 mt-0.5">Disponível para faturamento</p>
            </Card>
          </div>

          {/* Tabela Detalhada de Procedimentos */}
          <Card className="overflow-hidden border border-sus-900/10 shadow-sm">
            <div className="p-4 border-b border-sus-900/10 bg-sand/30 flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-sus-950 flex items-center gap-2">
                  <FileText className="h-4 w-4 text-teal" /> Demonstrativo de Itens Executados · Competência {competencia}
                </h3>
                <p className="text-[11px] text-ink/60 mt-0.5">
                  Prestador: <strong>{relatorio.laboratorio_nome}</strong> | Contrato: <strong>{relatorio.numero_contrato || "Vigente"}</strong>
                </p>
              </div>
              <span className="text-xs font-bold text-sus-900 bg-white px-2.5 py-1 rounded-lg border border-sus-900/15">
                {(relatorio.itens || (relatorio as unknown as { itens_agrupados: unknown[] }).itens_agrupados || []).length} procedimentos
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-sand/60 text-sus-900/70 border-b border-sus-900/10 font-bold uppercase">
                    <th className="px-4 py-3">Código SIGTAP</th>
                    <th className="px-4 py-3">Descrição do Exame</th>
                    <th className="px-4 py-3 text-center">Quantidade</th>
                    <th className="px-4 py-3 text-right">Valor Unitário</th>
                    <th className="px-4 py-3 text-right">Valor Total</th>
                    <th className="px-4 py-3 text-center">Origem Tabela</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sus-900/10 bg-white">
                  {(relatorio.itens || (relatorio as unknown as { itens_agrupados: unknown[] }).itens_agrupados || []).map((it, idx) => {
                    const item = it as unknown as {
                      sigtap_id: number;
                      codigo_procedimento: string;
                      descricao_procedimento: string;
                      quantidade_executada: number;
                      valor_unitario: number;
                      valor_total: number;
                      origem_preco: string;
                    };
                    return (
                      <tr key={idx} className="hover:bg-sand/20 transition-colors">
                        <td className="px-4 py-3 font-mono font-bold text-sus-950">{item.codigo_procedimento}</td>
                        <td className="px-4 py-3 font-medium text-sus-950">{item.descricao_procedimento}</td>
                        <td className="px-4 py-3 text-center font-bold text-sus-950">{item.quantidade_executada}</td>
                        <td className="px-4 py-3 text-right font-mono">{formatBRL(item.valor_unitario)}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-teal">{formatBRL(item.valor_total)}</td>
                        <td className="px-4 py-3 text-center">
                          {item.origem_preco === "contrato_customizado" ? (
                            <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-bold text-purple-800">
                              Contrato Customizado
                            </span>
                          ) : (
                            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold text-stone-700">
                              SIGTAP SUS
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-sand/40 border-t-2 border-sus-900/20 font-bold text-sus-950 text-xs">
                    <td colSpan={2} className="px-4 py-3 uppercase">Total Geral Aprovado</td>
                    <td className="px-4 py-3 text-center">
                      {(relatorio.itens || (relatorio as unknown as { itens_agrupados: unknown[] }).itens_agrupados || []).reduce(
                        (acc, i) => acc + ((i as unknown as { quantidade_executada: number }).quantidade_executada || 0),
                        0
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">—</td>
                    <td className="px-4 py-3 text-right font-mono text-sm text-teal">
                      {formatBRL(relatorio.valor_aprovado ?? (relatorio as unknown as { valor_total_liquido: number }).valor_total_liquido ?? 0)}
                    </td>
                    <td className="px-4 py-3 text-center">—</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
