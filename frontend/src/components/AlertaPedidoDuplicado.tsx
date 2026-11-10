import { useState } from "react";
import {
  AlertTriangle,
  ExternalLink,
  Eye,
  Calendar,
  User,
  Building2,
  Clock,
  CheckCircle2,
  X,
  FileText,
  FlaskConical,
  ArrowRight,
  ShieldAlert,
} from "lucide-react";
import { Button } from "./ui/primitives";
import type { PedidoDuplicadoTfd, PedidoDuplicadoLab } from "../services/api";

interface AlertaPedidoDuplicadoProps {
  pedido: PedidoDuplicadoTfd | PedidoDuplicadoLab | null;
  tipoModulo?: "tfd" | "lab";
  onProsseguir?: () => void;
  onCancelar?: () => void;
  className?: string;
}

export default function AlertaPedidoDuplicado({
  pedido,
  tipoModulo = "tfd",
  onProsseguir,
  onCancelar,
  className = "",
}: AlertaPedidoDuplicadoProps) {
  const [modalDetalhesAberto, setModalDetalhesAberto] = useState(false);

  if (!pedido) return null;

  const nomeProcedimento = "exame" in pedido ? pedido.exame : pedido.procedimento;
  const dataCadastro = "data_pedido" in pedido ? pedido.data_pedido : pedido.data;
  const idOuCodigo = "codigo_curto" in pedido ? pedido.codigo_curto : `#${pedido.id}`;

  const abrirLinkVisualizacao = () => {
    if (pedido.link_visualizacao) {
      window.open(pedido.link_visualizacao, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <>
      {/* BANNER DE ALERTA DE DUPLICIDADE EM TEMPO REAL */}
      <div
        className={`rounded-2xl border-2 border-amber-400 bg-gradient-to-r from-amber-50 via-orange-50/50 to-amber-50 p-4 shadow-md transition-all animate-in fade-in slide-in-from-top-2 duration-300 ${className}`}
      >
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2.5 bg-amber-100 text-amber-800 rounded-xl shrink-0 mt-0.5 border border-amber-300 shadow-sm animate-pulse">
              <AlertTriangle className="w-5 h-5" />
            </div>

            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full text-xs font-black uppercase tracking-wide bg-amber-200 text-amber-900 border border-amber-300">
                  Atenção — Pedido Duplicado Ativo
                </span>
                <span className="font-mono text-[11px] font-bold text-amber-800 bg-white/80 px-2 py-0.5 rounded border border-amber-200">
                  {idOuCodigo}
                </span>
              </div>

              <h4 className="text-sm md:text-base font-bold text-amber-950">
                Já existe um pedido idêntico ativo para este paciente
              </h4>

              <p className="text-xs text-amber-900 leading-relaxed">
                Foi localizado um pedido ativo de{" "}
                <strong className="text-amber-950 bg-amber-100/80 px-1.5 py-0.5 rounded">
                  {nomeProcedimento}
                </strong>{" "}
                já cadastrado e pendente de realização no sistema. Verifique os dados abaixo antes de prosseguir.
              </p>
            </div>
          </div>

          {/* Botão de Acesso Direto Principal */}
          <div className="flex flex-wrap md:flex-col items-center gap-2 shrink-0 self-end md:self-auto">
            <Button
              type="button"
              onClick={abrirLinkVisualizacao}
              className="bg-amber-600 hover:bg-amber-700 text-white flex items-center gap-1.5 text-xs font-bold shadow-sm"
              title="Abrir o pedido existente em nova aba para conferência"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Visualizar Pedido Anterior</span>
            </Button>
            <button
              type="button"
              onClick={() => setModalDetalhesAberto(true)}
              className="text-xs text-amber-800 hover:text-amber-950 font-semibold underline underline-offset-2 flex items-center gap-1"
            >
              <Eye className="w-3 h-3" />
              <span>Ver detalhes na tela</span>
            </button>
          </div>
        </div>

        {/* GRADE DE DETALHES ESSENCIAIS DO PEDIDO EXISTENTE */}
        <div className="mt-3.5 pt-3 border-t border-amber-200/80 grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs text-amber-950">
          <div className="bg-white/80 p-2.5 rounded-xl border border-amber-200/80">
            <span className="text-[11px] text-amber-800/80 flex items-center gap-1 font-medium">
              <Calendar className="w-3 h-3 text-amber-600" />
              Data do Cadastro:
            </span>
            <strong className="block text-slate-900 font-bold mt-0.5">{dataCadastro || "—"}</strong>
          </div>

          <div className="bg-white/80 p-2.5 rounded-xl border border-amber-200/80">
            <span className="text-[11px] text-amber-800/80 flex items-center gap-1 font-medium">
              <User className="w-3 h-3 text-amber-600" />
              Profissional:
            </span>
            <strong className="block text-slate-900 font-bold mt-0.5 truncate" title={pedido.profissional}>
              {pedido.profissional || "Médico Solicitante"}
            </strong>
          </div>

          <div className="bg-white/80 p-2.5 rounded-xl border border-amber-200/80">
            <span className="text-[11px] text-amber-800/80 flex items-center gap-1 font-medium">
              <Building2 className="w-3 h-3 text-amber-600" />
              Unidade de Origem:
            </span>
            <strong className="block text-slate-900 font-bold mt-0.5 truncate" title={pedido.unidade}>
              {pedido.unidade || "Unidade de Saúde"}
            </strong>
          </div>

          <div className="bg-white/80 p-2.5 rounded-xl border border-amber-200/80">
            <span className="text-[11px] text-amber-800/80 flex items-center gap-1 font-medium">
              <Clock className="w-3 h-3 text-amber-600" />
              Status Atual:
            </span>
            <span className="inline-block px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-300 mt-0.5">
              {pedido.status_rotulo || pedido.status}
            </span>
          </div>
        </div>

        {/* BARRA DE AÇÕES DO OPERADOR (PROSSEGUIR OU CANCELAR) */}
        <div className="mt-3 pt-2.5 border-t border-amber-200/80 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] text-amber-800 italic">
            * O operador pode consultar o histórico anterior ou optar por manter este novo lançamento caso seja justificável.
          </span>

          <div className="flex items-center gap-2">
            {onCancelar && (
              <Button
                type="button"
                variant="outline"
                onClick={onCancelar}
                className="text-xs text-slate-700 hover:text-slate-900 border-amber-300 hover:bg-amber-100/60"
              >
                Limpar / Trocar Procedimento
              </Button>
            )}

            {onProsseguir && (
              <Button
                type="button"
                onClick={onProsseguir}
                className="bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold"
              >
                Prosseguir Mesmo com Duplicidade
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* MODAL IN-PLACE PARA INSPEÇÃO COMPLETA DO PEDIDO ANTERIOR */}
      {modalDetalhesAberto && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-200 animate-in zoom-in-95 duration-200">
            <div className="px-5 py-4 bg-amber-600 text-white flex justify-between items-center">
              <div className="flex items-center gap-2 font-bold text-sm">
                <ShieldAlert className="w-5 h-5 text-amber-200" />
                <span>Pedido Ativo Existente · Detalhes Cadastrais</span>
              </div>
              <button
                type="button"
                onClick={() => setModalDetalhesAberto(false)}
                className="text-white/80 hover:text-white text-xl font-bold"
              >
                ×
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs text-slate-700">
              <div className="bg-amber-50 p-3 rounded-xl border border-amber-200 space-y-1">
                <div className="flex justify-between items-center">
                  <span className="text-amber-900 font-bold text-sm">{nomeProcedimento}</span>
                  <span className="font-mono text-xs font-bold bg-amber-200 text-amber-900 px-2 py-0.5 rounded">
                    {idOuCodigo}
                  </span>
                </div>
                <div className="text-[11px] text-amber-800">
                  Status: <strong>{pedido.status_rotulo || pedido.status}</strong>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
                <div>
                  <span className="text-slate-500 block">Data da Solicitação:</span>
                  <strong className="text-slate-900">{dataCadastro || "—"}</strong>
                </div>
                <div>
                  <span className="text-slate-500 block">Profissional Solicitante:</span>
                  <strong className="text-slate-900">{pedido.profissional || "Médico"}</strong>
                </div>
                <div>
                  <span className="text-slate-500 block">Unidade de Saúde:</span>
                  <strong className="text-slate-900">{pedido.unidade || "—"}</strong>
                </div>
                {"laboratorio" in pedido && pedido.laboratorio && (
                  <div>
                    <span className="text-slate-500 block">Laboratório Vinculado:</span>
                    <strong className="text-slate-900">{pedido.laboratorio}</strong>
                  </div>
                )}
                {"data_agendada" in pedido && pedido.data_agendada && (
                  <div>
                    <span className="text-slate-500 block">Data Agendada:</span>
                    <strong className="text-sky-800">
                      {pedido.data_agendada} {pedido.hora_agendada ? `às ${pedido.hora_agendada}` : ""}
                    </strong>
                  </div>
                )}
                {"prioridade" in pedido && (
                  <div>
                    <span className="text-slate-500 block">Prioridade Clínica:</span>
                    <strong className="uppercase">{pedido.prioridade || "Rotina"}</strong>
                  </div>
                )}
              </div>

              <p className="text-[11px] text-slate-500 leading-relaxed">
                Este pedido já se encontra registrado na base municipal de regulação e em processamento. Para evitar filas infladas ou duplicidade de agendamentos para o mesmo cidadão, recomenda-se acessar o pedido existente.
              </p>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setModalDetalhesAberto(false)}
                >
                  Fechar Detalhes
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    setModalDetalhesAberto(false);
                    abrirLinkVisualizacao();
                  }}
                  className="bg-amber-600 hover:bg-amber-700 text-white flex items-center gap-1.5 font-bold"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Acessar Pedido Anterior</span>
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
