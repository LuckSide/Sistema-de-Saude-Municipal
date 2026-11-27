import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, Ban, Bus, Calendar, CheckCircle2, ClipboardList, Clock, FileText, FlaskConical, MapPin, Printer, User, X } from "lucide-react";
import { labObterComprovante, labObterComprovanteFilaPsf, tfdObterComprovante, tfdObterComprovantePorPedido, type ComprovanteExame } from "../services/api";
import { Button } from "./ui/primitives";
import BotaoWhatsApp from "./BotaoWhatsApp";
import { useBackdropClose } from "../hooks/useBackdropClose";
import { gerarQrDataUri } from "../utils/qrSvg";

interface ComprovanteExameModalProps {
  solicitacaoId?: number | null;
  filaPsfId?: number | null;
  exameId?: number | null;
  numeroPedido?: string | null;
  comprovanteInicial?: ComprovanteExame | null;
  onClose: () => void;
}

function formatarDataBR(valor?: string | null): string {
  const s = (valor || "").trim();
  if (!s) return "—";
  const iso = s.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [a, m, d] = iso.split("-");
    return `${d}/${m}/${a}`;
  }
  return s;
}

function formatarDataHoraBR(valor?: string | null): string {
  const s = (valor || "").trim();
  if (!s) return "—";
  const matchIso = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (matchIso) {
    const [, a, m, d, hh, mm] = matchIso;
    return `${d}/${m}/${a} ${hh}:${mm}`;
  }
  return s;
}

function formatarPrioridade(valor?: string | null): string {
  const s = (valor || "").trim().toLowerCase();
  if (!s) return "Rotina";
  const mapa: Record<string, string> = {
    urgente: "Urgente",
    alta: "Alta Prioridade",
    eletiva: "Eletiva",
    rotina: "Rotina",
  };
  return mapa[s] || s.charAt(0).toUpperCase() + s.slice(1);
}

function formatarStatusLabel(status?: string | null, isInclusaoFila?: boolean): string {
  const s = (status || "").trim().toLowerCase();
  const mapa: Record<string, string> = {
    na_fila: "Na Fila (Aguardando)",
    aguardando: "Na Fila (Aguardando)",
    pendente: "Pendente na Fila",
    fila: "Na Fila (Aguardando)",
    agendado: "Agendado",
    recepcionado: "Recepcionado",
    realizado: "Realizado",
    realizada: "Realizado",
    coletado: "Coletado",
    concluido: "Concluído",
    compareceu: "Compareceu",
    cancelado: "Cancelado",
    cancelada: "Cancelado",
    desistiu: "Cancelado (Desistência)",
    recusado: "Cancelado / Recusado",
    faltou: "Faltou",
  };
  if (mapa[s]) return mapa[s];
  if (isInclusaoFila) return "Na Fila (Aguardando)";
  return status || "—";
}

export default function ComprovanteExameModal({
  solicitacaoId,
  filaPsfId,
  exameId,
  numeroPedido,
  comprovanteInicial,
  onClose,
}: ComprovanteExameModalProps) {
  const [comprovante, setComprovante] = useState<ComprovanteExame | null>(comprovanteInicial || null);
  const [loading, setLoading] = useState<boolean>(
    !comprovanteInicial && Boolean(solicitacaoId || filaPsfId || exameId || numeroPedido)
  );
  const [erro, setErro] = useState<string>("");

  useEffect(() => {
    if (comprovanteInicial) {
      setComprovante(comprovanteInicial);
      setLoading(false);
      return;
    }
    if (!solicitacaoId && !filaPsfId && !exameId && !numeroPedido) return;

    setLoading(true);
    setErro("");

    const prom = filaPsfId
      ? labObterComprovanteFilaPsf(filaPsfId)
      : exameId
      ? tfdObterComprovante(exameId)
      : numeroPedido
      ? tfdObterComprovantePorPedido(numeroPedido)
      : labObterComprovante(solicitacaoId!);

    prom
      .then((data) => {
        setComprovante(data);
      })
      .catch((err) => {
        setErro(err?.response?.data?.detail || "Falha ao carregar o comprovante.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [solicitacaoId, filaPsfId, exameId, numeroPedido, comprovanteInicial]);

  const statusNorm = (comprovante?.status || "").trim().toLowerCase();
  const isCancelado = Boolean(
    comprovante &&
      (comprovante.tipo_comprovante === "cancelado" ||
        ["cancelado", "cancelada", "desistiu", "recusado"].includes(statusNorm))
  );
  const isRealizado = Boolean(
    comprovante &&
      !isCancelado &&
      (comprovante.tipo_comprovante === "realizado" ||
        ["realizado", "realizada", "coletado", "concluido", "concluida", "compareceu"].includes(statusNorm))
  );
  const isSolicitacao = Boolean(comprovante?.origem_modulo === "solicitacao");
  const isInclusaoFila = Boolean(
    comprovante &&
      !isCancelado &&
      !isRealizado &&
      (comprovante.tipo_comprovante === "inclusao_fila" ||
        (!comprovante.data_agendada &&
          ["na_fila", "aguardando", "pendente", "fila"].includes(statusNorm)))
  );

  const codigoDocumento = (
    comprovante?.codigo_solicitacao ||
    comprovante?.numero_pedido ||
    comprovante?.protocolo ||
    comprovante?.codigo_curto ||
    (comprovante?.id ? `Solicitacao-${comprovante.id}` : "")
  ).trim();

  // Garante que ao salvar como PDF (botão Imprimir ou Ctrl+P) o nome padrão seja o número da solicitação/pedido
  useEffect(() => {
    if (!codigoDocumento) return;
    const tituloAnterior = document.title;
    document.title = codigoDocumento;
    return () => {
      document.title = tituloAnterior;
    };
  }, [codigoDocumento]);

  const imprimir = () => {
    const tituloAnterior = document.title;
    if (codigoDocumento) {
      document.title = codigoDocumento;
    }
    const restaurarAposImpressao = () => {
      // Enquanto o modal permanecer aberto, mantém o código do documento para Ctrl+P; ao fechar o useEffect restaura
      window.removeEventListener("afterprint", restaurarAposImpressao);
      if (!codigoDocumento) {
        document.title = tituloAnterior;
      }
    };
    window.addEventListener("afterprint", restaurarAposImpressao);
    window.print();
  };

  const backdrop = useBackdropClose(onClose);

  const tituloModal = isCancelado
    ? isSolicitacao
      ? "Comprovante de Solicitação Cancelada"
      : "Comprovante de Exame Cancelado"
    : isSolicitacao
    ? isInclusaoFila
      ? "Comprovante de Solicitação na Fila"
      : "Comprovante de Solicitação"
    : isInclusaoFila
    ? "Comprovante de Inclusão na Fila"
    : "Comprovante de Agendamento de Exames";

  const tituloCabecalhoDocumento = isCancelado
    ? isSolicitacao
      ? "COMPROVANTE DE SOLICITAÇÃO CANCELADA"
      : "COMPROVANTE DE EXAME DE SANGUE CANCELADO"
    : isSolicitacao
    ? isInclusaoFila
      ? "COMPROVANTE DE SOLICITAÇÃO NA FILA DE ESPERA"
      : isRealizado
      ? "COMPROVANTE DE SOLICITAÇÃO REALIZADA"
      : "COMPROVANTE OFICIAL DE AGENDAMENTO DE SOLICITAÇÃO"
    : isInclusaoFila
    ? "COMPROVANTE DE INCLUSÃO NA FILA DE EXAMES DE SANGUE"
    : isRealizado
    ? "COMPROVANTE DE COLETA DE EXAMES DE SANGUE"
    : "COMPROVANTE OFICIAL DE AGENDAMENTO DE EXAMES DE SANGUE";

  const modalContent = (
    <div
      id="comprovante-print-portal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-sus-950/70 p-3 sm:p-5 print:p-0 print:bg-white print:static print:z-auto"
      {...backdrop}
    >
      {/* Estilo exclusivo para impressão A4 sem cabeçalho/rodapé do navegador e sem páginas em branco */}
      <style>{`
        @page {
          size: A4 portrait;
          margin: 0;
        }
        @media print {
          html, body {
            width: 210mm !important;
            height: auto !important;
            min-height: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #fff !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          body > *:not(#comprovante-print-portal) {
            display: none !important;
          }
          #comprovante-print-portal {
            position: static !important;
            inset: auto !important;
            display: block !important;
            width: 100% !important;
            height: auto !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #fff !important;
          }
          #area-comprovante-print {
            position: static !important;
            width: 100% !important;
            max-width: 100% !important;
            max-height: none !important;
            overflow: visible !important;
            margin: 0 !important;
            padding: 8mm 10mm !important;
            border-radius: 0 !important;
            box-shadow: none !important;
            border: none !important;
            font-size: 11px !important;
            line-height: 1.25 !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>

      <div
        id="area-comprovante-print"
        className="relative max-h-[95vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white p-6 sm:p-8 shadow-2xl print:max-h-none print:max-w-none print:rounded-none print:shadow-none"
      >
        {/* Barra superior de ações (não impressa) */}
        <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-sus-900/10 pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal/10 text-teal">
              <FileText className="h-5 w-5" />
            </span>
            <span className="font-display text-base font-bold text-sus-950">{tituloModal}</span>
          </div>
          <div className="flex items-center gap-2">
            {!filaPsfId && !isCancelado && (exameId || (comprovante && comprovante.id)) && (
              <BotaoWhatsApp
                exameId={exameId || (comprovante ? comprovante.id : 0)}
                exame={comprovante}
                tipo={comprovante?.data_agendada ? "agendamento" : "entrada_fila"}
                variante="compacto"
              />
            )}
            <Button
              type="button"
              onClick={imprimir}
              className="flex items-center gap-1.5 border border-teal bg-white text-teal hover:bg-teal/10 !h-9 !py-1 text-xs"
              disabled={loading || !comprovante}
            >
              <Printer className="h-4 w-4" /> Imprimir / Salvar PDF
            </Button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl p-2 text-ink/50 hover:bg-sand transition"
              title="Fechar"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {loading && (
          <div className="py-12 text-center text-ink/60">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-teal border-t-transparent mb-3" />
            <p className="text-sm font-medium">Carregando dados do comprovante...</p>
          </div>
        )}

        {erro && (
          <div className="my-6 rounded-2xl bg-red-50 p-4 text-center text-sm text-red-700">
            <p className="font-semibold">{erro}</p>
            <Button onClick={onClose} className="mt-3 !h-9 text-xs">
              Fechar
            </Button>
          </div>
        )}

        {comprovante && !loading && (
          <div className="text-sus-950">
            {/* Cabeçalho Oficial SUS / Guapé */}
            <div className="border-b-2 border-sus-900/20 pb-4 print:pb-1.5 print:border-b text-center">
              <p className="text-xs print:text-[9px] uppercase font-bold tracking-wider text-sus-900/70">
                República Federativa do Brasil · Sistema Único de Saúde (SUS)
              </p>
              <h1 className="font-display text-lg sm:text-xl print:text-base font-black uppercase text-sus-950">
                Prefeitura Municipal de Guapé
              </h1>
              <h2 className="text-xs sm:text-sm print:text-[11px] font-bold text-teal">
                {isSolicitacao
                  ? "Secretaria Municipal de Saúde · Central de Regulação e Solicitações"
                  : "Secretaria Municipal de Saúde · Setor de Laboratório e Exames de Sangue"}
              </h2>
              <div
                className={`mt-2 print:mt-1 inline-block rounded-md border px-3 py-1 print:px-2 print:py-0.5 text-xs print:text-[10px] font-semibold ${
                  isCancelado
                    ? "border-red-300 bg-red-50 text-red-800"
                    : "border-sus-900/20 bg-sand/50 text-sus-950"
                }`}
              >
                {tituloCabecalhoDocumento}
              </div>
            </div>

            {/* Protocolo, Identificação e QR Code */}
            <div className="mt-4 print:mt-2 flex flex-col sm:flex-row items-center justify-between gap-4 print:gap-2 rounded-2xl print:rounded-xl bg-sand/30 p-4 print:p-2 text-xs border border-sus-900/10">
              <div className="space-y-1.5 print:space-y-0.5 flex-1 w-full sm:w-auto">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-ink/60">
                    {isSolicitacao ? "Número da Solicitação: " : "Protocolo do Pedido: "}
                  </span>
                  <span className="font-mono font-bold text-sm print:text-xs text-sus-950">
                    {codigoDocumento}
                  </span>
                </div>
                {comprovante.codigo_curto && comprovante.codigo_curto !== codigoDocumento && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-ink/60">Código de Referência: </span>
                    <span className="font-mono font-bold text-teal">{comprovante.codigo_curto}</span>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-3 pt-0.5">
                  <div>
                    <span className="text-ink/60">Situação: </span>
                    <span
                      className={`rounded px-2 py-0.5 font-bold uppercase text-[11px] print:text-[10px] ${
                        isCancelado
                          ? "bg-red-100 text-red-800"
                          : isInclusaoFila
                          ? "bg-amber-100 text-amber-900"
                          : "bg-teal/15 text-teal"
                      }`}
                    >
                      {formatarStatusLabel(comprovante.status, isInclusaoFila)}
                    </span>
                  </div>
                  <div>
                    <span className="text-ink/60">Emitido em: </span>
                    <span className="font-semibold">{formatarDataHoraBR(comprovante.emitido_em)}</span>
                  </div>
                </div>
              </div>

              {/* QR Code de Acompanhamento Público em Tempo Real */}
              {(() => {
                const origin = typeof window !== "undefined" ? window.location.origin : "";
                const tokenUrl = comprovante.public_token
                  ? `${origin}/acompanhar/${encodeURIComponent(comprovante.public_token)}`
                  : comprovante.acompanhar_path
                  ? `${origin}${comprovante.acompanhar_path}`
                  : comprovante.qr_code_url || "";
                if (!tokenUrl) return null;
                return (
                  <div className="flex flex-col items-center justify-center p-2 print:p-1.5 rounded-xl bg-white border border-sus-900/15 shadow-sm text-center shrink-0">
                    <img
                      src={gerarQrDataUri(tokenUrl)}
                      alt="QR Code para acompanhar a solicitação no site"
                      className="h-28 w-28 object-contain print:h-20 print:w-20"
                      loading="eager"
                    />
                    <span className="text-[10px] print:text-[9px] font-mono font-bold text-ink/75 mt-1">
                      {codigoDocumento}
                    </span>
                    <span className="text-[9px] print:text-[8px] font-semibold text-teal mt-0.5">
                      Acompanhe pelo QR Code
                    </span>
                  </div>
                );
              })()}
            </div>

            {/* Dados do Paciente */}
            <div className="mt-4 print:mt-2 rounded-xl border border-sus-900/10 p-3.5 print:p-2 text-xs print:text-[11px]">
              <h3 className="mb-2 print:mb-1 flex items-center gap-1.5 text-xs print:text-[10px] font-bold uppercase text-sus-900/70">
                <User className="h-3.5 w-3.5 print:h-3 print:w-3 text-teal" /> Identificação do Paciente
              </h3>
              <div className="grid grid-cols-2 gap-2 print:gap-1 text-xs print:text-[11px] sm:grid-cols-4">
                <div className="col-span-2 sm:col-span-2">
                  <p className="text-[10px] print:text-[9px] text-ink/60">Nome Completo</p>
                  <p className="font-bold text-sm print:text-xs text-sus-950">{comprovante.paciente_nome}</p>
                </div>
                <div>
                  <p className="text-[10px] print:text-[9px] text-ink/60">CPF</p>
                  <p className="font-medium font-mono">{comprovante.paciente_cpf || "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] print:text-[9px] text-ink/60">Cartão SUS (CNS)</p>
                  <p className="font-medium font-mono">{comprovante.paciente_cns || "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] print:text-[9px] text-ink/60">Prontuário</p>
                  <p className="font-medium font-mono">{comprovante.paciente_prontuario || "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] print:text-[9px] text-ink/60">Data de Nascimento</p>
                  <p className="font-medium">{formatarDataBR(comprovante.paciente_nascimento)}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-[10px] print:text-[9px] text-ink/60">Unidade Solicitante / Profissional</p>
                  <p className="font-medium">
                    {comprovante.unidade_psf || "Secretaria de Saúde"}
                    {comprovante.medico_solicitante ? ` · Dr(a). ${comprovante.medico_solicitante}` : ""}
                  </p>
                </div>
              </div>
            </div>

            {/* Bloco Principal: Cancelamento | Solicitação (TFD/Regulação) | Exames de Sangue */}
            {isCancelado ? (
              <div className="mt-4 print:mt-2 rounded-xl border border-red-300 bg-red-50/50 p-3.5 print:p-2 text-xs print:text-[11px]">
                <h3 className="mb-2 print:mb-1 flex items-center gap-1.5 text-xs print:text-[10px] font-bold uppercase text-red-800">
                  <Ban className="h-3.5 w-3.5 print:h-3 print:w-3 text-red-700" /> Registro de Cancelamento
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 print:gap-1 text-xs print:text-[11px]">
                  <div>
                    <p className="text-[10px] print:text-[9px] text-ink/60">Situação Final</p>
                    <p className="text-sm print:text-xs font-bold text-red-800">
                      {formatarStatusLabel(comprovante.status)}
                    </p>
                  </div>
                  {(comprovante.data_pedido || comprovante.data_solicitacao) && (
                    <div>
                      <p className="text-[10px] print:text-[9px] text-ink/60">Data da Solicitação</p>
                      <p className="text-sm print:text-xs font-bold text-sus-950">
                        {formatarDataBR(comprovante.data_pedido || comprovante.data_solicitacao)}
                      </p>
                    </div>
                  )}
                  {(comprovante.tipo_fila || comprovante.fila_nome || comprovante.especialidade) && (
                    <div>
                      <p className="text-[10px] print:text-[9px] text-ink/60">
                        {isSolicitacao ? "Tipo de Serviço / Especialidade" : "Fila / Categoria"}
                      </p>
                      <p className="text-xs sm:text-sm print:text-xs font-semibold text-sus-950">
                        {comprovante.tipo_fila || comprovante.fila_nome || comprovante.especialidade}
                      </p>
                    </div>
                  )}
                </div>
                {(comprovante.motivo_cancelamento || comprovante.justificativa) && (
                  <div className="mt-2.5 pt-2 border-t border-red-200 text-xs print:text-[10px] space-y-1">
                    {comprovante.motivo_cancelamento && (
                      <div>
                        <span className="text-[10px] text-red-900/75 font-semibold block">Motivo / Observação do Cancelamento:</span>
                        <p className="text-sus-950 font-medium">{comprovante.motivo_cancelamento}</p>
                      </div>
                    )}
                    {comprovante.justificativa && (
                      <div>
                        <span className="text-[10px] text-ink/60 font-semibold block">Justificativa Clínica Original:</span>
                        <p className="text-sus-950 font-medium">{comprovante.justificativa}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : isSolicitacao ? (
              <div
                className={`mt-4 print:mt-2 rounded-xl border p-3.5 print:p-2 text-xs print:text-[11px] ${
                  isInclusaoFila
                    ? "border-amber-300/70 bg-amber-50/40"
                    : "border-teal/25 bg-teal/5"
                }`}
              >
                <h3
                  className={`mb-2 print:mb-1 flex items-center gap-1.5 text-xs print:text-[10px] font-bold uppercase ${
                    isInclusaoFila ? "text-amber-900" : "text-teal"
                  }`}
                >
                  {isRealizado ? (
                    <CheckCircle2 className="h-3.5 w-3.5 print:h-3 print:w-3 text-teal" />
                  ) : (
                    <ClipboardList
                      className={`h-3.5 w-3.5 print:h-3 print:w-3 ${
                        isInclusaoFila ? "text-amber-700" : "text-teal"
                      }`}
                    />
                  )}
                  Dados da Solicitação {isInclusaoFila ? "(Fila de Espera)" : ""}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 print:gap-1.5 text-xs print:text-[11px]">
                  <div>
                    <p className="text-[10px] print:text-[9px] text-ink/60 flex items-center gap-1">
                      <Calendar className="h-3 w-3 print:h-2.5 print:w-2.5 text-teal" /> Data da Solicitação
                    </p>
                    <p className="text-sm print:text-xs font-bold text-sus-950">
                      {formatarDataBR(comprovante.data_pedido || comprovante.data_solicitacao)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] print:text-[9px] text-ink/60">Tipo de Serviço / Fila</p>
                    <p className="text-xs sm:text-sm print:text-xs font-bold text-sus-950">
                      {comprovante.tipo_fila || comprovante.fila_nome || "Solicitação Ambulatorial / TFD"}
                    </p>
                    {comprovante.especialidade &&
                      comprovante.especialidade !== (comprovante.tipo_fila || comprovante.fila_nome) && (
                        <p className="text-[10px] text-ink/70 font-medium mt-0.5">
                          Especialidade: {comprovante.especialidade}
                        </p>
                      )}
                  </div>
                  <div>
                    <p className="text-[10px] print:text-[9px] text-ink/60">Classificação / Prioridade</p>
                    <p className="text-xs sm:text-sm print:text-xs font-bold text-sus-950">
                      {formatarPrioridade(comprovante.prioridade)}
                    </p>
                  </div>

                  <div>
                    <p className="text-[10px] print:text-[9px] text-ink/60 flex items-center gap-1">
                      <MapPin className="h-3 w-3 print:h-2.5 print:w-2.5 text-teal" /> Local / Destino de Atendimento
                    </p>
                    <p className="text-xs sm:text-sm print:text-xs font-bold text-sus-950">
                      {comprovante.destino ||
                        (!isInclusaoFila ? comprovante.laboratorio_nome : "") ||
                        "A definir pela Regulação"}
                    </p>
                  </div>

                  {!isInclusaoFila && comprovante.data_agendada ? (
                    <>
                      <div>
                        <p className="text-[10px] print:text-[9px] text-ink/60 flex items-center gap-1">
                          <Calendar className="h-3 w-3 print:h-2.5 print:w-2.5 text-teal" /> Data Agendada
                        </p>
                        <p className="text-sm print:text-xs font-bold text-teal">
                          {formatarDataBR(comprovante.data_agendada)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] print:text-[9px] text-ink/60 flex items-center gap-1">
                          <Clock className="h-3 w-3 print:h-2.5 print:w-2.5 text-teal" /> Horário Previsto
                        </p>
                        <p className="text-sm print:text-xs font-bold text-sus-950">
                          {comprovante.hora_agendada || "A confirmar na unidade"}
                        </p>
                      </div>
                    </>
                  ) : (
                    <div className="sm:col-span-2">
                      <p className="text-[10px] print:text-[9px] text-ink/60 flex items-center gap-1">
                        <Clock className="h-3 w-3 print:h-2.5 print:w-2.5 text-amber-700" /> Situação do Agendamento
                      </p>
                      <p className="text-xs sm:text-sm print:text-xs font-bold text-amber-900">
                        Em fila de espera — sem data marcada até confirmação pela Regulação
                      </p>
                    </div>
                  )}
                </div>

                {comprovante.justificativa && (
                  <div className="mt-2.5 pt-2 border-t border-sus-900/10 text-xs print:text-[10px]">
                    <span className="text-[10px] text-ink/60 font-semibold block">Justificativa / Indicação Clínica:</span>
                    <p className="text-sus-950 font-medium">{comprovante.justificativa}</p>
                  </div>
                )}
              </div>
            ) : isInclusaoFila ? (
              <div className="mt-4 print:mt-2 rounded-xl border border-amber-300/70 bg-amber-50/40 p-3.5 print:p-2 text-xs print:text-[11px]">
                <h3 className="mb-2 print:mb-1 flex items-center gap-1.5 text-xs print:text-[10px] font-bold uppercase text-amber-900">
                  <FlaskConical className="h-3.5 w-3.5 print:h-3 print:w-3 text-amber-700" /> Situação na Fila de Exames de Sangue
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 print:gap-1 text-xs print:text-[11px]">
                  <div>
                    <p className="text-[10px] print:text-[9px] text-ink/60 flex items-center gap-1">
                      <Calendar className="h-3 w-3 print:h-2.5 print:w-2.5 text-amber-700" /> Data do Pedido
                    </p>
                    <p className="text-sm print:text-xs font-bold text-sus-950">
                      {formatarDataBR(comprovante.data_pedido || comprovante.data_solicitacao)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] print:text-[9px] text-ink/60 flex items-center gap-1">
                      <Clock className="h-3 w-3 print:h-2.5 print:w-2.5 text-amber-700" /> Situação
                    </p>
                    <p className="text-xs sm:text-sm print:text-xs font-bold text-amber-900">
                      Aguardando agendamento em lote na Fila Municipal
                    </p>
                    {comprovante.fila_nome && (
                      <p className="text-[10px] text-ink/70 font-medium mt-0.5">Fila: {comprovante.fila_nome}</p>
                    )}
                  </div>
                  <div>
                    <p className="text-[10px] print:text-[9px] text-ink/60 flex items-center gap-1">
                      <MapPin className="h-3 w-3 print:h-2.5 print:w-2.5 text-amber-700" /> Laboratório
                    </p>
                    <p className="text-xs sm:text-sm print:text-xs font-bold text-sus-950">
                      {comprovante.laboratorio_nome || "A definir no agendamento / Fila Municipal"}
                    </p>
                  </div>
                </div>
                {comprovante.justificativa && (
                  <div className="mt-2.5 pt-2 border-t border-amber-300/50 text-xs print:text-[10px]">
                    <span className="text-[10px] text-ink/60 font-semibold block">Justificativa Clínica:</span>
                    <p className="text-sus-950 font-medium">{comprovante.justificativa}</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-4 print:mt-2 rounded-xl border border-teal/20 bg-teal/5 p-3.5 print:p-2 text-xs print:text-[11px]">
                <h3 className="mb-2 print:mb-1 flex items-center gap-1.5 text-xs print:text-[10px] font-bold uppercase text-teal">
                  <FlaskConical className="h-3.5 w-3.5 print:h-3 print:w-3" /> Local e Data da Coleta
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 print:gap-1 text-xs print:text-[11px]">
                  <div>
                    <p className="text-[10px] print:text-[9px] text-ink/60 flex items-center gap-1">
                      <Calendar className="h-3 w-3 print:h-2.5 print:w-2.5 text-teal" /> Data do Exame
                    </p>
                    <p className="text-sm print:text-xs font-bold text-sus-950">
                      {formatarDataBR(comprovante.data_agendada)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] print:text-[9px] text-ink/60 flex items-center gap-1">
                      <Clock className="h-3 w-3 print:h-2.5 print:w-2.5 text-teal" /> Horário de Coleta
                    </p>
                    <p className="text-sm print:text-xs font-bold text-sus-950">
                      {comprovante.hora_agendada || "07:00 às 09:00"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] print:text-[9px] text-ink/60 flex items-center gap-1">
                      <MapPin className="h-3 w-3 print:h-2.5 print:w-2.5 text-teal" /> Laboratório Conveniado
                    </p>
                    <p className="text-sm print:text-xs font-bold text-teal">
                      {comprovante.laboratorio_nome || "Laboratório Municipal"}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Transporte Municipal Vinculado (Oculto para cancelados, fila sem data ou sem viagem vinculada) */}
            {!isCancelado && !isInclusaoFila && comprovante.transporte && comprovante.transporte.possui_viagem && (
              <div className="mt-4 print:mt-2 rounded-xl border border-teal/30 bg-teal/5 p-3.5 print:p-2 text-xs print:text-[11px] text-sus-950">
                <div className="flex items-center justify-between border-b border-teal/15 pb-1.5 print:pb-0.5 mb-2 print:mb-1">
                  <h3 className="flex items-center gap-1.5 text-xs print:text-[10px] font-bold uppercase text-teal">
                    <Bus className="h-3.5 w-3.5 print:h-3 print:w-3" /> Transporte Municipal Vinculado (TFD)
                  </h3>
                  {comprovante.transporte.viagem_id && (
                    <span className="font-mono text-[10px] print:text-[9px] text-teal font-bold">
                      Viagem #{comprovante.transporte.viagem_id}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 print:gap-1 text-xs print:text-[11px]">
                  <div>
                    <span className="text-[10px] print:text-[9px] text-ink/60 block font-semibold">Veículo / Modelo:</span>
                    <span className="font-bold text-sus-950">{comprovante.transporte.veiculo}</span>
                  </div>
                  <div>
                    <span className="text-[10px] print:text-[9px] text-ink/60 block font-semibold">Ponto de Saída:</span>
                    <span className="font-bold text-sus-950">{comprovante.transporte.ponto_saida}</span>
                  </div>
                  <div>
                    <span className="text-[10px] print:text-[9px] text-ink/60 block font-semibold">Horário de Saída:</span>
                    <span className="font-bold text-teal">{comprovante.transporte.horario_saida}</span>
                  </div>
                </div>
                {(comprovante.transporte.destino || comprovante.transporte.motorista || comprovante.transporte.acompanhante) && (
                  <div className="mt-2 print:mt-1 pt-1.5 print:pt-0.5 border-t border-teal/15 flex flex-wrap gap-x-4 text-[11px] print:text-[10px] text-ink/75">
                    {comprovante.transporte.destino && (
                      <span>Destino: <b>{comprovante.transporte.destino}</b></span>
                    )}
                    {comprovante.transporte.motorista && (
                      <span>Motorista: <b>{comprovante.transporte.motorista}</b></span>
                    )}
                    {comprovante.transporte.acompanhante && (
                      <span>Acompanhante: <b>{comprovante.transporte.acompanhante}</b></span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Instruções Adicionais / Orientações de Transporte */}
            {!isCancelado && comprovante.instrucoes_transporte && (
              <div className="mt-4 print:mt-2 rounded-xl border border-sus-900/15 bg-sand/40 p-3.5 print:p-2 text-xs print:text-[11px] text-sus-950">
                <h4 className="flex items-center gap-1.5 font-bold text-teal uppercase text-[11px] print:text-[10px] mb-1 print:mb-0.5">
                  <Bus className="h-3.5 w-3.5 print:h-3 print:w-3" /> Instruções Adicionais para o Paciente:
                </h4>
                <p className="text-ink/80 whitespace-pre-wrap">{comprovante.instrucoes_transporte}</p>
              </div>
            )}

            {/* Relação de Exames / Procedimentos */}
            {(() => {
              const temPreparo = Boolean(
                !isCancelado &&
                  !isInclusaoFila &&
                  !isRealizado &&
                  comprovante.exige_preparo &&
                  ((comprovante.itens || []).some((it) => it.preparo_especifico) ||
                    (comprovante.jejum_horas && comprovante.jejum_horas !== "Sem necessidade de jejum alimentar"))
              );

              return (
                <div className="mt-4 print:mt-2">
                  <h3 className="mb-1.5 print:mb-1 text-xs print:text-[10px] font-bold uppercase text-sus-900/70">
                    {isSolicitacao ? "Procedimentos / Atendimentos Solicitados" : "Procedimentos / Exames Solicitados"} ({comprovante.itens?.length || 0})
                  </h3>
                  <div className="overflow-hidden rounded-xl border border-sus-900/10">
                    <table className="w-full text-left text-xs print:text-[11px]">
                      <thead className="bg-sand/60 text-ink/75">
                        <tr>
                          <th className="px-3 py-2 print:py-1 print:px-2 font-semibold">Código SIGTAP</th>
                          <th className="px-3 py-2 print:py-1 print:px-2 font-semibold">
                            {isSolicitacao ? "Procedimento / Serviço" : "Procedimento / Exame"}
                          </th>
                          {temPreparo && <th className="px-3 py-2 print:py-1 print:px-2 font-semibold">Preparo / Cuidados</th>}
                          <th className="px-3 py-2 print:py-1 print:px-2 text-center font-semibold">Qtd</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-sus-900/10">
                        {(comprovante.itens || []).map((it, idx) => (
                          <tr key={idx} className="hover:bg-sand/20">
                            <td className="px-3 py-2 print:py-1 print:px-2 font-mono text-ink/70">
                              {it.procedimento_codigo || "—"}
                            </td>
                            <td className="px-3 py-2 print:py-1 print:px-2 font-medium text-sus-950">
                              {it.procedimento_descricao}
                            </td>
                            {temPreparo && (
                              <td className="px-3 py-2 print:py-1 print:px-2">
                                {it.preparo_especifico ? (
                                  <span className="inline-block rounded-md bg-amber-100/80 px-2 py-0.5 text-[10px] print:text-[9px] font-semibold text-amber-900 border border-amber-300">
                                    {it.preparo_especifico}
                                  </span>
                                ) : (
                                  <span className="text-ink/40 text-[11px] print:text-[10px]">—</span>
                                )}
                              </td>
                            )}
                            <td className="px-3 py-2 print:py-1 print:px-2 text-center font-semibold">
                              {it.quantidade || 1}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}

            {/* Orientações de Acompanhamento na Fila OU Instruções de Preparo */}
            {!isCancelado && isInclusaoFila && comprovante.orientacoes_gerais && comprovante.orientacoes_gerais.length > 0 && (
              <div className="mt-4 print:mt-2 rounded-xl border-2 border-teal/30 bg-teal/5 p-3.5 print:p-2 text-xs print:text-[11px] text-sus-950">
                <div className="flex items-center gap-1.5 font-bold text-teal mb-2 print:mb-1">
                  <AlertCircle className="h-4 w-4 print:h-3.5 print:w-3.5 text-teal" />
                  <span>ORIENTAÇÕES DE ACOMPANHAMENTO NA FILA:</span>
                </div>
                <ul className="list-disc pl-5 space-y-1 print:space-y-0.5 text-xs print:text-[10px] text-sus-900">
                  {comprovante.orientacoes_gerais.map((ori, i) => (
                    <li key={`fila-ori-${i}`}>{ori}</li>
                  ))}
                </ul>
              </div>
            )}

            {!isCancelado && !isInclusaoFila && !isRealizado && comprovante.exige_preparo && (comprovante.jejum_horas || (comprovante.preparo_instrucoes && comprovante.preparo_instrucoes.length > 0)) && (
              <div className="mt-4 print:mt-2 rounded-xl border-2 border-amber-300 bg-amber-50/70 p-3.5 print:p-2 text-xs print:text-[11px] text-amber-950">
                <div className="flex items-center gap-1.5 font-bold text-amber-900 mb-2 print:mb-1">
                  <AlertCircle className="h-4 w-4 print:h-3.5 print:w-3.5 text-amber-600" />
                  <span>INSTRUÇÕES DE PREPARO E JEJUM CLÍNICO:</span>
                </div>
                {comprovante.jejum_horas && (
                  <p className="font-semibold text-sm print:text-xs text-amber-950 mb-1">
                    ⏱️ Jejum: {comprovante.jejum_horas}
                  </p>
                )}
                <ul className="list-disc pl-5 space-y-1 print:space-y-0.5 text-xs print:text-[10px] text-amber-900/90">
                  {(comprovante.preparo_instrucoes || []).map((prep, i) => (
                    <li key={i}>{prep}</li>
                  ))}
                  {(comprovante.orientacoes_gerais || []).map((ori, i) => (
                    <li key={`ori-${i}`}>{ori}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Rodapé e Assinaturas */}
            <div className="mt-8 print:mt-3 pt-4 print:pt-2 border-t border-sus-900/20 text-xs print:text-[10px]">
              <div className="grid grid-cols-2 gap-8 print:gap-4 text-center pt-8 print:pt-3">
                <div>
                  <div className="border-t border-sus-900/40 pt-1 font-semibold text-ink/75">
                    Assinatura do Paciente / Responsável
                  </div>
                </div>
                <div>
                  <div className="border-t border-sus-900/40 pt-1 font-semibold text-ink/75">
                    Secretaria Municipal de Saúde / Carimbo
                  </div>
                </div>
              </div>
              <p className="mt-6 print:mt-2 text-[10px] print:text-[8px] text-center text-ink/40">
                Documento gerado pelo Sistema Municipal de Regulação de Saúde de Guapé em {formatarDataHoraBR(comprovante.emitido_em)}.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  if (typeof document === "undefined") {
    return modalContent;
  }
  return createPortal(modalContent, document.body);
}
