import { useEffect, useState } from "react";
import { AlertCircle, Calendar, Clock, FileText, FlaskConical, MapPin, Printer, User, X } from "lucide-react";
import { labObterComprovante, type ComprovanteExame } from "../services/api";
import { Button } from "./ui/primitives";

interface ComprovanteExameModalProps {
  solicitacaoId?: number | null;
  comprovanteInicial?: ComprovanteExame | null;
  onClose: () => void;
}

export default function ComprovanteExameModal({
  solicitacaoId,
  comprovanteInicial,
  onClose,
}: ComprovanteExameModalProps) {
  const [comprovante, setComprovante] = useState<ComprovanteExame | null>(comprovanteInicial || null);
  const [loading, setLoading] = useState<boolean>(!comprovanteInicial && !!solicitacaoId);
  const [erro, setErro] = useState<string>("");

  useEffect(() => {
    if (comprovanteInicial) {
      setComprovante(comprovanteInicial);
      setLoading(false);
      return;
    }
    if (!solicitacaoId) return;

    setLoading(true);
    setErro("");
    labObterComprovante(solicitacaoId)
      .then((data) => {
        setComprovante(data);
      })
      .catch((err) => {
        setErro(err?.response?.data?.detail || "Falha ao carregar o comprovante do exame.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [solicitacaoId, comprovanteInicial]);

  const imprimir = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-sus-950/70 p-3 sm:p-5 print:p-0 print:bg-white print:static print:z-auto">
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
        <div className="no-print mb-6 flex items-center justify-between border-b border-sus-900/10 pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal/10 text-teal">
              <FileText className="h-5 w-5" />
            </span>
            <span className="font-display text-base font-bold text-sus-950">
              Comprovante de Agendamento
            </span>
          </div>
          <div className="flex items-center gap-2">
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
                COMPROVANTE OFICIAL DE AGENDAMENTO DE EXAMES DE SANGUE
              </div>
            </div>

            {/* Protocolo e Identificação */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-sand/30 p-3 text-xs border border-sus-900/10">
              <div>
                <span className="text-ink/60">Protocolo: </span>
                <span className="font-mono font-bold text-sus-950">{comprovante.protocolo || `#${comprovante.id}`}</span>
              </div>
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

            {/* Relação de Exames */}
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
                        <td className="px-3 py-2 text-center font-semibold">
                          {it.quantidade || 1}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Orientações Clínicas e Preparo */}
            <div className="mt-4 rounded-xl border-2 border-amber-300 bg-amber-50/70 p-3.5 text-xs text-amber-950">
              <div className="flex items-center gap-1.5 font-bold text-amber-900 mb-2">
                <AlertCircle className="h-4 w-4 text-amber-600" />
                <span>INSTRUÇÕES DE PREPARO E JEJUM CLÍNICO:</span>
              </div>
              <p className="font-semibold text-sm text-amber-950 mb-1">
                ⏱️ Jejum: {comprovante.jejum_horas || "8 a 12 horas"}
              </p>
              <ul className="list-disc pl-5 space-y-1 text-xs text-amber-900/90">
                {(comprovante.preparo_instrucoes || []).map((prep, i) => (
                  <li key={i}>{prep}</li>
                ))}
                {(comprovante.orientacoes_gerais || []).map((ori, i) => (
                  <li key={`ori-${i}`}>{ori}</li>
                ))}
              </ul>
            </div>

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
