import { useEffect, useState } from "react";
import {
  Printer,
  X,
  FileCheck2,
  AlertCircle,
  Building2,
  Calendar,
  User,
  Activity,
  Phone,
  MapPin,
  ShieldAlert,
} from "lucide-react";
import {
  oxigenioComprovante,
  type ComprovanteEmprestimoData,
  type ItemEmprestimo,
} from "../../services/api";
import { Button } from "../../components/ui/primitives";

interface ComprovanteModalProps {
  emprestimoId: number | null;
  onClose: () => void;
}

export default function ComprovanteEmprestimoModal({
  emprestimoId,
  onClose,
}: ComprovanteModalProps) {
  const [dados, setDados] = useState<ComprovanteEmprestimoData | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    if (!emprestimoId) {
      setDados(null);
      return;
    }
    setCarregando(true);
    setErro("");
    oxigenioComprovante(emprestimoId)
      .then((res) => {
        setDados(res);
      })
      .catch((e: any) => {
        setErro(e?.response?.data?.detail || "Erro ao carregar dados do comprovante");
      })
      .finally(() => setCarregando(false));
  }, [emprestimoId]);

  if (!emprestimoId) return null;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/70 backdrop-blur-sm flex justify-center p-4 print:p-0 print:bg-white print:static">
      <style>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 8mm 10mm;
          }
          html, body {
            width: 210mm !important;
            height: 297mm !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          body * {
            visibility: hidden;
          }
          #comprovante-a4-impressao, #comprovante-a4-impressao * {
            visibility: visible;
          }
          #comprovante-a4-impressao {
            position: absolute;
            left: 0;
            top: 0;
            width: 100% !important;
            max-width: 190mm !important;
            margin: 0 auto !important;
            padding: 0 !important;
            font-size: 11px !important;
            line-height: 1.3 !important;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>

      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full my-auto overflow-hidden border border-slate-200 print:border-none print:shadow-none print:my-0 print:max-w-none">
        {/* Barra superior de ações (oculta na impressão) */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-100 border-b border-slate-200 print:hidden no-print">
          <div className="flex items-center gap-2 text-slate-800 font-semibold">
            <FileCheck2 className="w-5 h-5 text-sky-600" />
            <span>Comprovante de Retirada & Termo de Responsabilidade</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={handlePrint}
              className="bg-sky-600 hover:bg-sky-700 text-white flex items-center gap-2 text-sm shadow-sm"
            >
              <Printer className="w-4 h-4" />
              <span>Imprimir Termo</span>
            </Button>
            <Button
              variant="outline"
              onClick={onClose}
              className="flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
            >
              <X className="w-4 h-4" />
              <span>Fechar</span>
            </Button>
          </div>
        </div>

        {/* Conteúdo do Documento */}
        <div id="comprovante-a4-impressao" className="p-6 md:p-8 space-y-4 text-slate-900 print:p-2 text-xs font-sans">
          {carregando ? (
            <div className="py-20 text-center text-slate-500">
              <div className="inline-block animate-spin w-8 h-8 border-4 border-sky-600 border-t-transparent rounded-full mb-3"></div>
              <p>Carregando dados do termo...</p>
            </div>
          ) : erro ? (
            <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg flex items-center gap-3">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>{erro}</span>
            </div>
          ) : dados ? (
            <div className="border border-slate-300 rounded-xl p-5 bg-white space-y-4 print:border-none print:p-0">
              {/* Cabeçalho Oficial SUS / Guapé */}
              <div className="text-center border-b pb-3 border-slate-300 space-y-0.5">
                <div className="font-bold text-sm md:text-base uppercase tracking-wide text-slate-900">
                  ESTADO DE MINAS GERAIS · MUNICÍPIO DE GUAPÉ
                </div>
                <div className="font-semibold text-xs text-slate-700 uppercase">
                  SECRETARIA MUNICIPAL DE SAÚDE · SISTEMA ÚNICO DE SAÚDE (SUS)
                </div>
                <div className="text-[11px] text-slate-500 uppercase">
                  SETOR DE OXIGENOTERAPIA & ASSISTÊNCIA VENTILATÓRIA DOMICILIAR
                </div>
                <div className="inline-block mt-1 px-3 py-0.5 bg-sky-100 text-sky-800 font-bold rounded-full text-[11px]">
                  TERMO DE RESPONSABILIDADE E COMPROVANTE DE ENTREGA Nº {dados.codigo_termo}
                </div>
              </div>

              {/* Informações de Emissão */}
              <div className="flex justify-between items-center text-[11px] text-slate-600 border-b border-dashed border-slate-200 pb-1.5">
                <span>Data de Emissão: <strong>{new Date(dados.data_emissao).toLocaleDateString("pt-BR")}</strong></span>
                <span>Termo de Controle: <strong>{dados.codigo_termo}</strong></span>
              </div>

              {/* 1. DADOS DO PACIENTE */}
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-slate-800 uppercase text-[11px] tracking-wider border-b border-slate-200 pb-0.5">
                  <User className="w-3.5 h-3.5 text-sky-600" />
                  <span>1. Identificação do Paciente / Beneficiário</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 bg-slate-50 p-2.5 rounded-lg border border-slate-200 text-xs">
                  <div>
                    <span className="text-slate-500 block">Nome do Paciente:</span>
                    <strong className="text-slate-900">{dados.paciente.nome}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block">CPF:</span>
                    <strong>{dados.paciente.cpf || "Não informado"}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Cartão SUS / CNS:</span>
                    <strong>{dados.paciente.cns || "Não informado"}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Nº Prontuário:</span>
                    <strong>{dados.paciente.prontuario || "—"}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Telefone:</span>
                    <strong>{dados.paciente.telefone || "Não informado"}</strong>
                  </div>
                  <div className="col-span-2 md:col-span-1">
                    <span className="text-slate-500 block">Endereço de Instalação:</span>
                    <strong className="truncate block" title={dados.paciente.endereco}>
                      {dados.paciente.endereco || "Não informado"}
                    </strong>
                  </div>
                </div>
              </div>

              {/* 2. DADOS DO RESPONSÁVEL PELA RETIRADA (se houver) */}
              {dados.responsavel_retirada?.nome && (
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 font-bold text-slate-800 uppercase text-[11px] tracking-wider border-b border-slate-200 pb-0.5">
                    <User className="w-3.5 h-3.5 text-sky-600" />
                    <span>2. Responsável Legal / Retirada</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 bg-slate-50 p-2 rounded-lg border border-slate-200 text-xs">
                    <div>
                      <span className="text-slate-500 block">Nome do Responsável:</span>
                      <strong>{dados.responsavel_retirada.nome}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block">CPF do Responsável:</span>
                      <strong>{dados.responsavel_retirada.cpf || "—"}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Parentesco / Vínculo:</span>
                      <strong>{dados.responsavel_retirada.parentesco || "Familiar"}</strong>
                    </div>
                  </div>
                </div>
              )}

              {/* 3. DADOS DOS ITENS FORNECIDOS (Suporta Multi-Item) */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 font-bold text-slate-800 uppercase text-[11px] tracking-wider border-b border-slate-200 pb-0.5">
                  <Activity className="w-3.5 h-3.5 text-sky-600" />
                  <span>3. Especificação do Equipamento / Oxigênio Fornecido</span>
                </div>

                {dados.itens && dados.itens.length > 0 ? (
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-100 text-slate-700 font-semibold uppercase text-[10px]">
                        <tr>
                          <th className="py-1.5 px-2.5">Item / Insumo</th>
                          <th className="py-1.5 px-2.5">Capacidade / Modelo</th>
                          <th className="py-1.5 px-2.5">Série / Tombamento</th>
                          <th className="py-1.5 px-2.5">Regime de Posse</th>
                          <th className="py-1.5 px-2.5 text-center">Qtd</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {dados.itens.map((it: ItemEmprestimo, idx: number) => {
                          const isMaquina = it.tipo_servico === "MAQUINA" || it.tipo_servico === "EQUIPAMENTO" || it.tipo_item === "MAQUINA";
                          const descMaquina = it.tipo_equipamento || it.equipamento_tipo || "Máquina Respiratória";
                          return (
                            <tr key={idx} className="hover:bg-slate-50">
                              <td className="py-1.5 px-2.5 font-medium text-slate-900">
                                {isMaquina
                                  ? `Equipamento Respiratório (${descMaquina})`
                                  : it.acompanha_equipamento
                                  ? "Cilindro de Apoio (Acompanha Concentrador)"
                                  : "Cilindro de Oxigênio Medicinal"}
                              </td>
                              <td className="py-1.5 px-2.5">
                                {isMaquina ? descMaquina : `Cilindro ${it.tipo_cilindro?.replace("m3", "m³")}`}
                              </td>
                              <td className="py-1.5 px-2.5 font-mono text-[11px]">
                                {isMaquina ? `Série: ${it.equipamento_serie || "—"}` : "—"}
                              </td>
                              <td className="py-1.5 px-2.5">
                                <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                                  it.posse_cilindro === "COMODATO" ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"
                                }`}>
                                  {it.posse_cilindro === "COMODATO" ? "Comodato Fornecedora" : "Próprio Município"}
                                </span>
                              </td>
                              <td className="py-1.5 px-2.5 text-center font-bold">
                                {it.quantidade}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 bg-slate-50 p-2.5 rounded-lg border border-slate-200 text-xs">
                    <div>
                      <span className="text-slate-500 block">Tipo de Serviço:</span>
                      <span className="font-semibold text-slate-900">
                        {dados.servico.tipo_servico === "MAQUINA"
                          ? `Equipamento (${dados.servico.tipo_equipamento || "CPAP/BiPAP/Concentrador"})`
                          : `Cilindro O2 (${dados.servico.tipo_cilindro || ""})`}
                      </span>
                    </div>
                    {dados.servico.tipo_servico === "MAQUINA" ? (
                      <>
                        <div>
                          <span className="text-slate-500 block">Patrimônio / Série:</span>
                          <strong>{dados.servico.equipamento_serie || dados.servico.equipamento_patrimonio || "—"}</strong>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Tipo de Equipamento:</span>
                          <strong>{dados.servico.tipo_equipamento || "—"}</strong>
                        </div>
                      </>
                    ) : (
                      <>
                        <div>
                          <span className="text-slate-500 block">Capacidade:</span>
                          <strong>{dados.servico.tipo_cilindro || "10m³"}</strong>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Quantidade:</span>
                          <strong>{dados.servico.quantidade} unidade(s)</strong>
                        </div>
                      </>
                    )}
                    <div>
                      <span className="text-slate-500 block">Data de Instalação:</span>
                      <strong>{dados.servico.data_instalacao}</strong>
                    </div>
                  </div>
                )}

                {/* Dados de Prazos e Fornecedor */}
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 pt-1">
                  <div>Data de Instalação / Retirada: <strong>{dados.servico.data_instalacao}</strong></div>
                  {dados.servico.data_prevista_troca && (
                    <div className="text-sky-700 font-semibold">Próxima Troca Prevista: <strong>{dados.servico.data_prevista_troca}</strong></div>
                  )}
                  {dados.servico.empresa_fornecedora && (
                    <div>Fornecedor Contratado: <strong>{dados.servico.empresa_fornecedora}</strong></div>
                  )}
                </div>
              </div>

              {/* 4. PRESCRIÇÃO MÉDICA & PARÂMETROS */}
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-slate-800 uppercase text-[11px] tracking-wider border-b border-slate-200 pb-0.5">
                  <Activity className="w-3.5 h-3.5 text-sky-600" />
                  <span>4. Prescrição Clínica e Parâmetros</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 bg-slate-50 p-2 rounded-lg border border-slate-200 text-xs">
                  <div>
                    <span className="text-slate-500 block">Médico Prescritor:</span>
                    <strong>{dados.prescricao.medico || "Não informado"}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block">CID-10:</span>
                    <strong>{dados.prescricao.cid || "—"}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Fluxo Oxigênio (L/min):</span>
                    <strong>{dados.servico.fluxo_oxigenio || "Conforme prescrição"}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Pressão / Parâmetros:</span>
                    <strong>{dados.servico.pressao_cpap_bipap || "—"}</strong>
                  </div>
                </div>
              </div>

              {/* 5. TERMO DE COMPROMISSO E DECLARAÇÃO LEGAL */}
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-slate-800 uppercase text-[11px] tracking-wider border-b border-slate-200 pb-0.5">
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
                  <span>5. Declaração de Responsabilidade e Normas de Uso</span>
                </div>
                <div className="p-2.5 bg-amber-50/50 rounded-lg border border-amber-200/80 text-[10.5px] text-slate-700 leading-relaxed text-justify space-y-1">
                  <p>
                    {dados.declaracao_responsabilidade}
                  </p>
                  <p>
                    <strong>Normas Obrigatórias de Segurança:</strong>
                    {" "}1. Não fumar, acender chamas ou usar óleos/graxas próximo aos cilindros e concentradores.
                    {" "}2. Manter os cilindros sempre na posição vertical e devidamente fixados em local ventilado.
                    {" "}3. O paciente ou familiar compromete-se a <strong>comunicar imediatamente a Secretaria Municipal de Saúde</strong> em caso de alta médica, internação, transferência ou óbito, providenciando a restituição incontinenti do equipamento ou cilindros em perfeito estado de conservação.
                  </p>
                </div>
              </div>

              {/* Observações Adicionais */}
              {dados.observacoes && (
                <div className="text-[11px] text-slate-600 bg-slate-50 p-2 rounded border border-slate-200">
                  <span className="font-semibold text-slate-700">Observações: </span>
                  {dados.observacoes}
                </div>
              )}

              {/* 6. CAMPOS DE ASSINATURA FÍSICA */}
              <div className="pt-6 grid grid-cols-2 gap-8 text-center text-xs">
                <div>
                  <div className="border-b border-slate-700 mx-6 mb-1.5"></div>
                  <strong className="block text-slate-900">
                    {dados.responsavel_retirada?.nome || dados.paciente.nome}
                  </strong>
                  <span className="text-slate-600 block text-[11px]">
                    CPF: {dados.responsavel_retirada?.cpf || dados.paciente.cpf || "______________________"}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    Assinatura do Paciente / Responsável Legal
                  </span>
                </div>

                <div>
                  <div className="border-b border-slate-700 mx-6 mb-1.5"></div>
                  <strong className="block text-slate-900">
                    Secretaria Municipal de Saúde de Guapé
                  </strong>
                  <span className="text-slate-600 block text-[11px]">
                    Matrícula / Carimbo do Servidor
                  </span>
                  <span className="text-[10px] text-slate-500">
                    Responsável pela Liberação / Entrega
                  </span>
                </div>
              </div>

              <div className="text-[9.5px] text-center text-slate-400 pt-2 border-t border-slate-200">
                Documento emitido eletronicamente pelo Sistema Municipal de Saúde de Guapé/MG em{" "}
                {new Date().toLocaleString("pt-BR")}. Válido como termo de cessão e comprovante oficial de entrega.
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
