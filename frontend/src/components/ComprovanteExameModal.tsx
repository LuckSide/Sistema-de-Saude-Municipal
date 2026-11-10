import { useEffect, useState } from "react";
import { AlertCircle, Bus, Calendar, Clock, FileText, FlaskConical, MapPin, Printer, QrCode, User, X } from "lucide-react";
import { labObterComprovante, tfdObterComprovante, tfdObterComprovantePorPedido, type ComprovanteExame } from "../services/api";
import { Button } from "./ui/primitives";
import BotaoWhatsApp from "./BotaoWhatsApp";
import { useBackdropClose } from "../hooks/useBackdropClose";

interface ComprovanteExameModalProps {
  solicitacaoId?: number | null;
  exameId?: number | null;
  numeroPedido?: string | null;
  comprovanteInicial?: ComprovanteExame | null;
  onClose: () => void;
}

export default function ComprovanteExameModal({
  solicitacaoId,
  exameId,
  numeroPedido,
  comprovanteInicial,
  onClose,
}: ComprovanteExameModalProps) {
  const [comprovante, setComprovante] = useState<ComprovanteExame | null>(comprovanteInicial || null);
  const [loading, setLoading] = useState<boolean>(!comprovanteInicial && Boolean(solicitacaoId || exameId || numeroPedido));
  const [erro, setErro] = useState<string>("");

  useEffect(() => {
    if (comprovanteInicial) {
      setComprovante(comprovanteInicial);
      setLoading(false);
      return;
    }
    if (!solicitacaoId && !exameId && !numeroPedido) return;

    setLoading(true);
    setErro("");

    const prom = exameId
      ? tfdObterComprovante(exameId)
      : numeroPedido
      ? tfdObterComprovantePorPedido(numeroPedido)
      : labObterComprovante(solicitacaoId!);

    prom
      .then((data) => {
        setComprovante(data);
      })
      .catch((err) => {
        setErro(err?.response?.data?.detail || "Falha ao carregar o comprovante do exame.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [solicitacaoId, exameId, numeroPedido, comprovanteInicial]);

  const imprimir = () => {
    window.print();
  };

  const backdrop = useBackdropClose(onClose);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-sus-950/70 p-3 sm:p-5 print:p-0 print:bg-white print:static print:z-auto"
      {...backdrop}
    >
      {/* Estilo exclusivo para impressão */}
      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #area-comprovante-print, #area-comprovante-print * {
            visibility: visible;
          }
          #area-comprovante-print {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            margin: 0;
            padding: 1.5cm;
            box-shadow: none;
            border: none;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>

      <div
        id="area-comprovante-print"
        className="relative max-h-[95vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white p-6 sm:p-8 shadow-2xl print:max-h-none print:max-w-none print:rounded-none print:p-0 print:shadow-none"
      >
        {/* Barra superior de ações (não impressa) */}
        <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-sus-900/10 pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal/10 text-teal">
              <FileText className="h-5 w-5" />
            </span>
            <span className="font-display text-base font-bold text-sus-950">
              Comprovante de Agendamento
            </span>
          </div>
          <div className="flex items-center gap-2">
            {(exameId || (comprovante && comprovante.id)) && (
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
              <Printer className="h-4 w-4" /> Imprimir Comprovante
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
            <div className="border-b-2 border-sus-900/20 pb-4 text-center">
              <p className="text-xs uppercase font-bold tracking-wider text-sus-900/70">
                República Federativa do Brasil · Sistema Único de Saúde (SUS)
              </p>
              <h1 className="font-display text-lg sm:text-xl font-black uppercase text-sus-950">
                Prefeitura Municipal de Guapé
              </h1>
              <h2 className="text-xs sm:text-sm font-bold text-teal">
                Secretaria Municipal de Saúde · Setor de Regulação e Exames
              </h2>
              <div className="mt-2 inline-block rounded-md border border-sus-900/20 bg-sand/50 px-3 py-1 text-xs font-semibold">
                {comprovante.exige_preparo
                  ? "COMPROVANTE OFICIAL DE AGENDAMENTO DE EXAMES DE SANGUE"
                  : "COMPROVANTE OFICIAL DE AGENDAMENTO"}
              </div>
            </div>

            {/* Protocolo, Identificação e QR Code */}
            <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-4 rounded-2xl bg-sand/30 p-4 text-xs border border-sus-900/10">
              <div className="space-y-1.5 flex-1 w-full sm:w-auto">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-ink/60">Protocolo da Solicitação: </span>
                  <span className="font-mono font-bold text-sm text-sus-950">
                    {comprovante.numero_pedido || comprovante.protocolo || `#${comprovante.id}`}
                  </span>
                </div>
                {comprovante.codigo_curto && comprovante.codigo_curto !== comprovante.protocolo && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-ink/60">Código de Referência: </span>
                    <span className="font-mono font-bold text-teal">{comprovante.codigo_curto}</span>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-3 pt-0.5">
                  <div>
                    <span className="text-ink/60">Status: </span>
                    <span className="rounded bg-teal/15 px-2 py-0.5 font-bold uppercase text-teal text-[11px]">
                      {comprovante.status}
                    </span>
                  </div>
                  <div>
                    <span className="text-ink/60">Emitido em: </span>
                    <span className="font-semibold">{comprovante.emitido_em}</span>
                  </div>
                </div>
              </div>

              {/* QR Code de Identificação Exclusiva */}
              {comprovante.qr_code_url && (
                <div className="flex flex-col items-center justify-center p-2 rounded-xl bg-white border border-sus-900/15 shadow-sm text-center shrink-0">
                  <img
                    src={comprovante.qr_code_url}
                    alt="QR Code da Solicitação"
                    className="h-24 w-24 object-contain print:h-28 print:w-28"
                    loading="eager"
                  />
                  <span className="text-[10px] font-mono font-bold text-ink/75 mt-1">
                    {comprovante.codigo_curto || comprovante.protocolo}
                  </span>
                  <span className="text-[9px] text-teal font-semibold tracking-tight">Leitura Rápida / Balcão</span>
                </div>
              )}
            </div>

            {/* Dados do Paciente */}
            <div className="mt-4 rounded-xl border border-sus-900/10 p-3.5">
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase text-sus-900/70">
                <User className="h-3.5 w-3.5 text-teal" /> Identificação do Paciente
              </h3>
              <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <div className="col-span-2 sm:col-span-2">
                  <p className="text-[10px] text-ink/60">Nome Completo</p>
                  <p className="font-bold text-sm text-sus-950">{comprovante.paciente_nome}</p>
                </div>
                <div>
                  <p className="text-[10px] text-ink/60">CPF</p>
                  <p className="font-medium font-mono">{comprovante.paciente_cpf || "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] text-ink/60">Cartão SUS (CNS)</p>
                  <p className="font-medium font-mono">{comprovante.paciente_cns || "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] text-ink/60">Prontuário</p>
                  <p className="font-medium font-mono">{comprovante.paciente_prontuario || "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] text-ink/60">Data de Nascimento</p>
                  <p className="font-medium">{comprovante.paciente_nascimento || "—"}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-[10px] text-ink/60">Unidade Solicitante / Médico</p>
                  <p className="font-medium">
                    {comprovante.unidade_psf || "Secretaria de Saúde"}
                    {comprovante.medico_solicitante ? ` · Dr(a). ${comprovante.medico_solicitante}` : ""}
                  </p>
                </div>
              </div>
            </div>

            {/* Dados do Agendamento e Laboratório */}
            <div className="mt-4 rounded-xl border border-teal/20 bg-teal/5 p-3.5">
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase text-teal">
                <FlaskConical className="h-3.5 w-3.5" /> Local e Data da Coleta
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <p className="text-[10px] text-ink/60 flex items-center gap-1">
                    <Calendar className="h-3 w-3 text-teal" /> Data do Exame
                  </p>
                  <p className="text-sm font-bold text-sus-950">
                    {comprovante.data_agendada
                      ? comprovante.data_agendada.split("-").reverse().join("/")
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-ink/60 flex items-center gap-1">
                    <Clock className="h-3 w-3 text-teal" /> Horário de Coleta
                  </p>
                  <p className="text-sm font-bold text-sus-950">
                    {comprovante.hora_agendada || "07:00 às 09:00"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-ink/60 flex items-center gap-1">
                    <MapPin className="h-3 w-3 text-teal" /> Laboratório Conveniado
                  </p>
                  <p className="text-sm font-bold text-teal">
                    {comprovante.laboratorio_nome || "Laboratório Municipal"}
                  </p>
                </div>
              </div>
            </div>

            {/* Transporte Municipal Vinculado (Oculto se sem viagem vinculada) */}
            {comprovante.transporte && comprovante.transporte.possui_viagem && (
              <div className="mt-4 rounded-xl border border-teal/30 bg-teal/5 p-3.5 text-xs text-sus-950">
                <div className="flex items-center justify-between border-b border-teal/15 pb-1.5 mb-2">
                  <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase text-teal">
                    <Bus className="h-3.5 w-3.5" /> Transporte Municipal Vinculado (TFD)
                  </h3>
                  {comprovante.transporte.viagem_id && (
                    <span className="font-mono text-[10px] text-teal font-bold">
                      Viagem #{comprovante.transporte.viagem_id}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <span className="text-[10px] text-ink/60 block font-semibold">Veículo / Modelo:</span>
                    <span className="font-bold text-sus-950">{comprovante.transporte.veiculo}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-ink/60 block font-semibold">Ponto de Saída:</span>
                    <span className="font-bold text-sus-950">{comprovante.transporte.ponto_saida}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-ink/60 block font-semibold">Horário de Saída:</span>
                    <span className="font-bold text-teal">{comprovante.transporte.horario_saida}</span>
                  </div>
                </div>
                {(comprovante.transporte.destino || comprovante.transporte.motorista || comprovante.transporte.acompanhante) && (
                  <div className="mt-2 pt-1.5 border-t border-teal/15 flex flex-wrap gap-x-4 text-[11px] text-ink/75">
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
            {comprovante.instrucoes_transporte && (
              <div className="mt-4 rounded-xl border border-sus-900/15 bg-sand/40 p-3.5 text-xs text-sus-950">
                <h4 className="flex items-center gap-1.5 font-bold text-teal uppercase text-[11px] mb-1">
                  <Bus className="h-3.5 w-3.5" /> Instruções Adicionais para o Paciente:
                </h4>
                <p className="text-ink/80 whitespace-pre-wrap">{comprovante.instrucoes_transporte}</p>
              </div>
            )}

            {/* Relação de Exames */}
            {(() => {
              const temPreparo = Boolean(
                comprovante.exige_preparo &&
                  ((comprovante.itens || []).some((it) => it.preparo_especifico) ||
                    (comprovante.jejum_horas && comprovante.jejum_horas !== "Sem necessidade de jejum alimentar"))
              );

              return (
                <div className="mt-4">
                  <h3 className="mb-1.5 text-xs font-bold uppercase text-sus-900/70">
                    Procedimentos / Exames Solicitados ({comprovante.itens?.length || 0})
                  </h3>
                  <div className="overflow-hidden rounded-xl border border-sus-900/10">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-sand/60 text-ink/75">
                        <tr>
                          <th className="px-3 py-2 font-semibold">Código SIGTAP</th>
                          <th className="px-3 py-2 font-semibold">Procedimento / Exame</th>
                          {temPreparo && <th className="px-3 py-2 font-semibold">Preparo / Cuidados</th>}
                          <th className="px-3 py-2 text-center font-semibold">Qtd</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-sus-900/10">
                        {(comprovante.itens || []).map((it, idx) => (
                          <tr key={idx} className="hover:bg-sand/20">
                            <td className="px-3 py-2 font-mono text-ink/70">
                              {it.procedimento_codigo || "—"}
                            </td>
                            <td className="px-3 py-2 font-medium text-sus-950">
                              {it.procedimento_descricao}
                            </td>
                            {temPreparo && (
                              <td className="px-3 py-2">
                                {it.preparo_especifico ? (
                                  <span className="inline-block rounded-md bg-amber-100/80 px-2 py-0.5 text-[10px] font-semibold text-amber-900 border border-amber-300">
                                    {it.preparo_especifico}
                                  </span>
                                ) : (
                                  <span className="text-ink/40 text-[11px]">—</span>
                                )}
                              </td>
                            )}
                            <td className="px-3 py-2 text-center font-semibold">
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

            {/* Orientações Clínicas e Preparo (Apenas para Exames de Sangue / Laboratoriais) */}
            {comprovante.exige_preparo && (comprovante.jejum_horas || (comprovante.preparo_instrucoes && comprovante.preparo_instrucoes.length > 0)) && (
              <div className="mt-4 rounded-xl border-2 border-amber-300 bg-amber-50/70 p-3.5 text-xs text-amber-950">
                <div className="flex items-center gap-1.5 font-bold text-amber-900 mb-2">
                  <AlertCircle className="h-4 w-4 text-amber-600" />
                  <span>INSTRUÇÕES DE PREPARO E JEJUM CLÍNICO:</span>
                </div>
                {comprovante.jejum_horas && (
                  <p className="font-semibold text-sm text-amber-950 mb-1">
                    ⏱️ Jejum: {comprovante.jejum_horas}
                  </p>
                )}
                <ul className="list-disc pl-5 space-y-1 text-xs text-amber-900/90">
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
            <div className="mt-8 pt-4 border-t border-sus-900/20 text-xs">
              <div className="grid grid-cols-2 gap-8 text-center pt-8">
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
              <p className="mt-6 text-[10px] text-center text-ink/40">
                Documento gerado pelo Sistema Municipal de Regulação de Saúde de Guapé em {comprovante.emitido_em}.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
