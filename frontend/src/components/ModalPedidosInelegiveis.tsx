import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  UserX,
  CheckCircle2,
  Loader2,
  X,
  RefreshCw,
  CheckSquare,
  Square,
  Calendar,
} from "lucide-react";
import { Button } from "./ui/primitives";
import {
  tfdAnalisarPedidosInelegiveis,
  tfdDarBaixaPedidosInelegiveis,
  labAnalisarPedidosInelegiveis,
  labDarBaixaPedidosInelegiveis,
  type AnalisePedidosInelegiveisOut,
  type PedidoInelegivelItem,
} from "../services/api";

interface Props {
  aberto: boolean;
  onClose: () => void;
  onSuccess: () => void;
  tipoFila: "tfd" | "psf";
  titulo?: string;
}

export default function ModalPedidosInelegiveis({
  aberto,
  onClose,
  onSuccess,
  tipoFila,
  titulo,
}: Props) {
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [analise, setAnalise] = useState<AnalisePedidosInelegiveisOut | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (aberto) {
      carregarAnalise();
    } else {
      setAnalise(null);
      setErro(null);
      setSelecionados(new Set());
    }
  }, [aberto, tipoFila]);

  async function carregarAnalise() {
    setCarregando(true);
    setErro(null);
    try {
      const res =
        tipoFila === "tfd"
          ? await tfdAnalisarPedidosInelegiveis()
          : await labAnalisarPedidosInelegiveis();
      setAnalise(res);
      // Pré-seleciona todos os pedidos encontrados para facilitar a baixa em lote
      setSelecionados(new Set(res.pedidos.map((p) => p.id)));
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Erro ao consultar pedidos inelegíveis da fila.");
    } finally {
      setCarregando(false);
    }
  }

  function toggleSelecionado(id: number) {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelecionarTodos() {
    if (!analise) return;
    if (selecionados.size === analise.pedidos.length) {
      setSelecionados(new Set());
    } else {
      setSelecionados(new Set(analise.pedidos.map((p) => p.id)));
    }
  }

  async function executarBaixa() {
    if (selecionados.size === 0) return;
    setSalvando(true);
    setErro(null);
    try {
      const ids = Array.from(selecionados);
      if (tipoFila === "tfd") {
        await tfdDarBaixaPedidosInelegiveis({ ids });
      } else {
        await labDarBaixaPedidosInelegiveis({ ids });
      }
      onSuccess();
      onClose();
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Erro ao dar baixa nos pedidos selecionados.");
      setSalvando(false);
    }
  }

  if (!aberto) return null;

  const totalPedidos = analise?.total_pedidos ?? 0;
  const todosSelecionados = totalPedidos > 0 && selecionados.size === totalPedidos;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div
        className="fixed -inset-10 bg-sus-950/60 backdrop-blur-md animate-in fade-in duration-200"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative z-10 w-full max-w-4xl max-h-[90vh] flex flex-col bg-white rounded-2xl shadow-2xl border border-sus-900/10 overflow-hidden">
        {/* Cabeçalho */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-sus-900/10 bg-rose-50/70">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-rose-100 text-rose-700">
              <UserX className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-display text-lg font-bold text-sus-950">
                {titulo || "Análise de Pedidos com Inelegibilidade Cadastral"}
              </h3>
              <p className="text-xs text-ink/70">
                {tipoFila === "tfd"
                  ? "Fila de Regulação Geral e Consultas (TFD)"
                  : "Fila de Exames Laboratoriais (PSF)"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-ink/50 hover:text-sus-950 hover:bg-black/5 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Corpo do Modal */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          {erro && (
            <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs font-medium">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-red-600" />
              <span>{erro}</span>
            </div>
          )}

          {carregando ? (
            <div className="flex flex-col items-center justify-center py-12 text-ink/50 gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-teal" />
              <p className="text-sm font-semibold">Analisando cadastros e vínculos da fila...</p>
            </div>
          ) : analise ? (
            <>
              {/* Cards de Resumo */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3.5 rounded-xl bg-sand/40 border border-sus-900/10 flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-ink/60">
                      Total Inelegíveis
                    </p>
                    <p className="text-2xl font-black text-rose-700">{analise.total_pedidos}</p>
                  </div>
                  <span className="p-2 rounded-lg bg-rose-100 text-rose-700">
                    <UserX className="h-5 w-5" />
                  </span>
                </div>

                <div className="p-3.5 rounded-xl bg-sand/40 border border-sus-900/10 flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-ink/60">
                      Registro de Óbito
                    </p>
                    <p className="text-2xl font-black text-red-800">{analise.pedidos_obito}</p>
                  </div>
                  <span className="p-2 rounded-lg bg-red-100 text-red-700">
                    <AlertTriangle className="h-5 w-5" />
                  </span>
                </div>

                <div className="p-3.5 rounded-xl bg-sand/40 border border-sus-900/10 flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-ink/60">
                      Mudança de Município
                    </p>
                    <p className="text-2xl font-black text-amber-800">
                      {analise.pedidos_mudanca}
                    </p>
                  </div>
                  <span className="p-2 rounded-lg bg-amber-100 text-amber-800">
                    <Calendar className="h-5 w-5" />
                  </span>
                </div>
              </div>

              {totalPedidos === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 px-4 text-center rounded-xl border border-teal/20 bg-teal/5">
                  <CheckCircle2 className="h-10 w-10 text-teal mb-2" />
                  <h4 className="text-base font-bold text-sus-950">
                    Nenhum pedido inelegível encontrado!
                  </h4>
                  <p className="text-xs text-ink/70 max-w-md mt-1">
                    Todos os pedidos ativos nesta fila pertencem a pacientes com cadastro regular e ativo
                    no sistema. Nenhuma ação necessária.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <button
                      type="button"
                      onClick={toggleSelecionarTodos}
                      className="inline-flex items-center gap-1.5 font-bold text-teal hover:underline cursor-pointer"
                    >
                      {todosSelecionados ? (
                        <>
                          <CheckSquare className="h-4 w-4" /> Desmarcar todos
                        </>
                      ) : (
                        <>
                          <Square className="h-4 w-4" /> Selecionar todos ({totalPedidos})
                        </>
                      )}
                    </button>
                    <span className="text-ink/60 font-semibold">
                      {selecionados.size} de {totalPedidos} selecionado(s) para baixa
                    </span>
                  </div>

                  {/* Tabela de Pedidos */}
                  <div className="border border-sus-900/10 rounded-xl overflow-hidden shadow-2xs max-h-72 overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-sand/60 text-ink/70 font-semibold sticky top-0 border-b border-sus-900/10">
                        <tr>
                          <th className="py-2.5 px-3 w-10 text-center">Sel.</th>
                          <th className="py-2.5 px-3">Pedido</th>
                          <th className="py-2.5 px-3">Paciente</th>
                          <th className="py-2.5 px-3">Situação Cadastral</th>
                          <th className="py-2.5 px-3">Procedimento / Fila</th>
                          <th className="py-2.5 px-3">Data</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-sus-900/5">
                        {analise.pedidos.map((p: PedidoInelegivelItem) => {
                          const isSel = selecionados.has(p.id);
                          const isObito = p.situacao_cadastral === "obito";
                          const isMudanca = p.situacao_cadastral === "mudanca_municipio";

                          return (
                            <tr
                              key={p.id}
                              onClick={() => toggleSelecionado(p.id)}
                              className={`cursor-pointer transition hover:bg-rose-50/40 ${
                                isSel ? "bg-rose-50/20" : ""
                              }`}
                            >
                              <td className="py-2 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  checked={isSel}
                                  onChange={() => toggleSelecionado(p.id)}
                                  className="h-4 w-4 rounded border-sus-900/20 text-rose-600 focus:ring-rose-500 cursor-pointer"
                                />
                              </td>
                              <td className="py-2 px-3 font-mono font-bold text-sus-900 whitespace-nowrap">
                                {p.codigo_curto || p.codigo_solicitacao || `PED-${p.id}`}
                              </td>
                              <td className="py-2 px-3">
                                <p className="font-semibold text-sus-950">{p.paciente_nome}</p>
                                {p.paciente_cpf && (
                                  <span className="text-[10px] text-ink/50">CPF: {p.paciente_cpf}</span>
                                )}
                              </td>
                              <td className="py-2 px-3">
                                {isObito ? (
                                  <span className="inline-flex items-center gap-1 rounded bg-red-100 text-red-800 border border-red-300 px-1.5 py-0.5 text-[10px] font-bold">
                                    <AlertTriangle className="h-3 w-3 text-red-600" />
                                    Óbito
                                  </span>
                                ) : isMudanca ? (
                                  <span className="inline-flex items-center gap-1 rounded bg-amber-100 text-amber-800 border border-amber-300 px-1.5 py-0.5 text-[10px] font-bold">
                                    Mudança de Município
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 rounded bg-zinc-100 text-zinc-800 border border-zinc-300 px-1.5 py-0.5 text-[10px] font-bold">
                                    Inativo
                                  </span>
                                )}
                                {p.motivo_situacao && (
                                  <p className="text-[10px] text-ink/50 truncate max-w-[200px]" title={p.motivo_situacao}>
                                    {p.motivo_situacao}
                                  </p>
                                )}
                              </td>
                              <td className="py-2 px-3">
                                <p className="font-medium text-sus-950 truncate max-w-[220px]" title={p.exame || p.especialidade}>
                                  {p.exame || p.especialidade || "Exame"}
                                </p>
                                <span className="text-[10px] text-ink/50">
                                  {p.tipo_fila || p.unidade_psf || "Fila"}
                                </span>
                              </td>
                              <td className="py-2 px-3 whitespace-nowrap text-ink/70">
                                {p.data_pedido || p.data_solicitacao || "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <p className="text-[11px] text-ink/60 italic">
                    * Ao dar baixa, os pedidos selecionados serão marcados como cancelados por motivo cadastral,
                    com histórico auditável registrado no prontuário do paciente e unificação de cadastros duplicados.
                  </p>
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* Rodapé de Ações */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-sus-900/10 bg-sand/30">
          <Button
            type="button"
            variant="ghost"
            onClick={carregarAnalise}
            disabled={carregando || salvando}
            className="flex items-center gap-1.5 text-xs text-ink/70 hover:text-sus-950"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${carregando ? "animate-spin" : ""}`} /> Recarregar
          </Button>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={salvando}
              className="text-xs"
            >
              Fechar
            </Button>

            {totalPedidos > 0 && (
              <Button
                type="button"
                onClick={executarBaixa}
                disabled={selecionados.size === 0 || salvando}
                className="bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm disabled:opacity-50"
              >
                {salvando ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Processando baixa...
                  </>
                ) : (
                  <>
                    <UserX className="h-4 w-4" />
                    Dar Baixa em {selecionados.size} Pedido(s)
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
