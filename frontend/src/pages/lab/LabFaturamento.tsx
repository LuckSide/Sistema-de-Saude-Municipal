import { useEffect, useState } from "react";
import { CheckCheck, Download, FileSpreadsheet, FileText, FlaskConical, Layers, TrendingUp, Users } from "lucide-react";
import {
  labExportarLote,
  labMarcarFaturado,
  labProntos,
  labBpaConsolidado,
  labBpaExportarCsv,
  pagData,
  pagMeta,
  type LabSol,
  type BpaResumo,
} from "../../services/api";
import { Button, Card, Input, Label } from "../../components/ui/primitives";
import Paginacao from "../../components/Paginacao";
import ExportarExcel from "../../components/ExportarExcel";

export default function LabFaturamento() {
  const [comp, setComp] = useState(() => new Date().toISOString().slice(0, 7));
  const [aba, setAba] = useState<"consolidado" | "nominal">("consolidado");

  // Dados consolidados BPA
  const [resumoBpa, setResumoBpa] = useState<BpaResumo | null>(null);
  const [carregandoBpa, setCarregandoBpa] = useState(false);

  // Lista nominal de itens prontos
  const [lista, setLista] = useState<LabSol[]>([]);
  const [sel, setSel] = useState<number[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);

  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  async function carregarConsolidado() {
    if (!comp) return;
    setCarregandoBpa(true);
    try {
      const data = await labBpaConsolidado(comp);
      setResumoBpa(data);
    } catch {
      setResumoBpa(null);
    } finally {
      setCarregandoBpa(false);
    }
  }

  async function carregarNominal(p = page) {
    const r = await labProntos(comp || undefined, p, 100);
    setLista(pagData<LabSol>(r));
    const m = pagMeta(r);
    setTotal(m.total);
    setPage(m.page);
    setPages(m.pages);
    setSel([]);
  }

  useEffect(() => {
    carregarConsolidado();
    carregarNominal(1).catch(() => setErro("Falha ao carregar prontos."));
  }, [comp]);

  function toggle(id: number) {
    setSel((s) => (s.includes(id) ? s.filter((i) => i !== id) : [...s, id]));
  }

  function todos() {
    setSel((s) => (s.length === lista.length ? [] : lista.map((i) => i.id)));
  }

  async function faturar() {
    setErro("");
    setOk("");
    if (sel.length === 0) {
      setErro("Selecione ao menos um exame realizado.");
      return;
    }
    setBusy(true);
    try {
      const r = await labMarcarFaturado(sel);
      setOk(`${r.atualizados ?? sel.length} exame(s) marcado(s) como faturado.`);
      await carregarNominal();
      await carregarConsolidado();
    } catch {
      setErro("Erro ao marcar como faturado.");
    } finally {
      setBusy(false);
    }
  }

  async function exportarBpaCsv() {
    setErro("");
    setOk("");
    if (!comp) {
      setErro("Informe a competência AAAA-MM.");
      return;
    }
    setBusy(true);
    try {
      const blob = await labBpaExportarCsv(comp);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `bpa_consolidado_${comp}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setOk("Lote BPA consolidado exportado com sucesso.");
    } catch {
      setErro("Erro ao exportar lote BPA.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Barra de Título e Controles */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-sus-950 flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-teal" /> Faturamento BPA · Exames Laboratoriais
          </h2>
          <p className="text-xs text-ink/65">
            Consolidação ambulatorial da produção de exames laboratoriais (Boletim de Produção Ambulatorial - BPA).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 ml-auto">
          <div className="flex items-center gap-1.5 bg-white border border-sus-900/15 rounded-xl px-3 py-1.5 shadow-xs">
            <span className="text-xs font-semibold text-ink/60">Competência:</span>
            <input
              type="month"
              value={comp}
              onChange={(e) => setComp(e.target.value)}
              className="text-xs font-bold text-sus-950 outline-none bg-transparent"
            />
          </div>

          <Button
            type="button"
            onClick={exportarBpaCsv}
            disabled={busy || !resumoBpa || resumoBpa.total_procedimentos === 0}
            className="!h-10 text-xs bg-teal hover:bg-teal/90 text-white font-bold flex items-center gap-1.5 shadow-sm"
          >
            <Download className="h-4 w-4" /> Exportar BPA (CSV / SIA-SUS)
          </Button>

          <ExportarExcel
            url="/api/lab/solicitacoes/exportar"
            arquivo={`faturamento_lab_${comp}`}
            params={{ competencia: comp || undefined }}
          />
        </div>
      </div>

      {erro && (
        <div className="rounded-xl bg-red-50 p-3.5 text-sm font-medium text-red-700">
          {erro}
        </div>
      )}
      {ok && (
        <div className="rounded-xl bg-teal/10 p-3.5 text-sm font-medium text-teal">
          {ok}
        </div>
      )}

      {/* KPI Cards de Faturamento */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Card className="p-4 border-sus-900/10">
          <div className="flex items-center justify-between text-ink/50 mb-1">
            <span className="text-[11px] font-bold uppercase">Pacientes Atendidos</span>
            <Users className="h-4 w-4 text-teal" />
          </div>
          <p className="font-display text-2xl font-black text-sus-950">
            {resumoBpa?.total_pacientes ?? 0}
          </p>
          <span className="text-[10px] text-ink/50">competência {comp}</span>
        </Card>

        <Card className="p-4 border-sus-900/10">
          <div className="flex items-center justify-between text-ink/50 mb-1">
            <span className="text-[11px] font-bold uppercase">Solicitações Coletadas</span>
            <FlaskConical className="h-4 w-4 text-teal" />
          </div>
          <p className="font-display text-2xl font-black text-sus-950">
            {resumoBpa?.total_solicitacoes ?? 0}
          </p>
          <span className="text-[10px] text-ink/50">pedidos recepcionados</span>
        </Card>

        <Card className="p-4 border-sus-900/10">
          <div className="flex items-center justify-between text-ink/50 mb-1">
            <span className="text-[11px] font-bold uppercase">Total de Procedimentos</span>
            <Layers className="h-4 w-4 text-teal" />
          </div>
          <p className="font-display text-2xl font-black text-sus-950">
            {resumoBpa?.total_procedimentos ?? 0}
          </p>
          <span className="text-[10px] text-ink/50">exames laboratoriais realizados</span>
        </Card>

        <Card className="p-4 border-sus-900/10 bg-teal/5 border-teal/20">
          <div className="flex items-center justify-between text-teal mb-1">
            <span className="text-[11px] font-bold uppercase">Valor Aprovado BPA</span>
            <TrendingUp className="h-4 w-4" />
          </div>
          <p className="font-display text-2xl font-black text-teal">
            {(resumoBpa?.valor_total ?? 0).toLocaleString("pt-BR", {
              style: "currency",
              currency: "BRL",
            })}
          </p>
          <span className="text-[10px] text-ink/50">tabela SIGTAP SUS</span>
        </Card>
      </div>

      {/* Seletor de Abas */}
      <div className="flex items-center gap-1.5 rounded-2xl bg-sand/60 p-1 w-fit">
        <button
          type="button"
          onClick={() => setAba("consolidado")}
          className={`rounded-xl px-4 py-1.5 text-xs font-semibold transition ${
            aba === "consolidado"
              ? "bg-white text-sus-950 shadow-xs"
              : "text-ink/65 hover:text-sus-950"
          }`}
        >
          Produção Consolidada BPA (SIGTAP)
        </button>
        <button
          type="button"
          onClick={() => setAba("nominal")}
          className={`rounded-xl px-4 py-1.5 text-xs font-semibold transition ${
            aba === "nominal"
              ? "bg-white text-sus-950 shadow-xs"
              : "text-ink/65 hover:text-sus-950"
          }`}
        >
          Relação Nominal de Exames Prontos
        </button>
      </div>

      {/* ABA 1: PRODUÇÃO CONSOLIDADA BPA */}
      {aba === "consolidado" && (
        <Card className="overflow-hidden border-sus-900/10 shadow-xs">
          {carregandoBpa ? (
            <div className="py-12 text-center text-ink/50">
              <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-teal border-t-transparent mb-2" />
              <p className="text-xs font-medium">Consolidando produção BPA da competência...</p>
            </div>
          ) : !resumoBpa || resumoBpa.itens.length === 0 ? (
            <div className="p-10 text-center text-ink/45">
              <FlaskConical className="mx-auto h-8 w-8 text-ink/30 mb-2" />
              <p className="font-semibold text-sus-950">Nenhum exame coletado nesta competência</p>
              <p className="text-xs text-ink/50 mt-1">
                Certifique-se de que os exames do mês foram marcados como <strong>coletados</strong> no módulo do laboratório.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-sus-900/10 bg-sand text-xs uppercase text-sus-900/60">
                    <th className="px-4 py-3 font-semibold">Código SIGTAP</th>
                    <th className="px-4 py-3 font-semibold">Procedimento Ambulatorial</th>
                    <th className="px-4 py-3 text-center font-semibold">Qtd Aprovada</th>
                    <th className="px-4 py-3 text-right font-semibold">Valor Unitário</th>
                    <th className="px-4 py-3 text-right font-semibold">Valor Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sus-900/5">
                  {resumoBpa.itens.map((it, idx) => (
                    <tr key={idx} className="hover:bg-sand/30 transition">
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-ink/75">
                        {it.codigo}
                      </td>
                      <td className="px-4 py-3 font-medium text-sus-950 text-xs sm:text-sm">
                        {it.descricao}
                      </td>
                      <td className="px-4 py-3 text-center font-bold text-sus-950 text-xs">
                        {it.quantidade}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-ink/75">
                        {it.valor_unitario.toLocaleString("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        })}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-teal text-xs">
                        {it.valor_total.toLocaleString("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        })}
                      </td>
                    </tr>
                  ))}
                  {/* Linha de Totalização */}
                  <tr className="bg-sand/40 font-bold border-t-2 border-sus-900/10">
                    <td colSpan={2} className="px-4 py-3 text-xs uppercase text-sus-950">
                      Total Consolidado da Competência {comp}
                    </td>
                    <td className="px-4 py-3 text-center font-bold text-sus-950 text-sm">
                      {resumoBpa.total_procedimentos}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-ink/50">—</td>
                    <td className="px-4 py-3 text-right font-mono text-sm text-teal">
                      {resumoBpa.valor_total.toLocaleString("pt-BR", {
                        style: "currency",
                        currency: "BRL",
                      })}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* ABA 2: RELAÇÃO NOMINAL DE EXAMES PRONTOS */}
      {aba === "nominal" && (
        <Card className="overflow-hidden border-sus-900/10 shadow-xs">
          <div className="p-3 bg-sand/30 border-b border-sus-900/10 flex items-center justify-between">
            <span className="text-xs font-semibold text-ink/65">
              Exames coletados aguardando faturamento:
            </span>
            <Button
              type="button"
              onClick={faturar}
              disabled={busy || sel.length === 0}
              className="!h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
            >
              <CheckCheck className="h-3.5 w-3.5" /> Marcar {sel.length} como Faturados
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-sus-900/10 bg-sand text-xs uppercase text-sus-900/60">
                  <th className="px-4 py-3 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={sel.length > 0 && sel.length === lista.length}
                      onChange={todos}
                      className="h-4 w-4 rounded border-sus-900/20 text-teal"
                    />
                  </th>
                  <th className="px-4 py-3 font-semibold">Paciente</th>
                  <th className="px-4 py-3 font-semibold">Procedimento</th>
                  <th className="px-4 py-3 font-semibold">Competência</th>
                  <th className="px-4 py-3 font-semibold">Laboratório</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((s) => (
                  <tr key={s.id} className="border-b border-sus-900/5 last:border-0 hover:bg-sand/30">
                    <td className="px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={sel.includes(s.id)}
                        onChange={() => toggle(s.id)}
                        className="h-4 w-4 rounded border-sus-900/20 text-teal"
                      />
                    </td>
                    <td className="px-4 py-3 font-semibold text-sus-950">{s.paciente_nome}</td>
                    <td className="px-4 py-3 text-xs">
                      {s.procedimento_descricao}
                      <p className="text-[11px] font-mono text-ink/50">{s.procedimento_codigo}</p>
                    </td>
                    <td className="px-4 py-3 text-xs">{s.competencia}</td>
                    <td className="px-4 py-3 text-xs text-ink/75">{s.laboratorio}</td>
                  </tr>
                ))}
                {lista.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-ink/45">
                      Nenhum exame realizado pronto para faturar nesta competência.
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
            onPage={(p) => carregarNominal(p).catch(() => setErro("Falha ao carregar prontos."))}
          />
        </Card>
      )}
    </div>
  );
}
