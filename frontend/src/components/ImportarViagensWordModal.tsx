import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  FileText,
  MapPin,
  RefreshCw,
  Upload,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import {
  tfdConfirmarImportarWord,
  tfdPreviewImportarWord,
  type ImportarWordPreviewOut,
  type ViagemImportWord,
} from "../services/api";
import { Button } from "./ui/primitives";

interface ImportarViagensWordModalProps {
  aberto: boolean;
  onFechar: () => void;
  onSucesso?: () => void;
}

export default function ImportarViagensWordModal({
  aberto,
  onFechar,
  onSucesso,
}: ImportarViagensWordModalProps) {
  const [etapa, setEtapa] = useState<"upload" | "preview" | "sucesso">("upload");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportarWordPreviewOut | null>(null);
  const [resultadoSucesso, setResultadoSucesso] = useState<{
    mensagem: string;
    viagens_criadas: number;
    passageiros_vinculados: number;
    pacientes_cadastrados: number;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Travar scroll da página enquanto o modal estiver aberto
  useEffect(() => {
    if (aberto) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
      // Reset de estado ao fechar
      setEtapa("upload");
      setArquivo(null);
      setPreview(null);
      setErro(null);
      setResultadoSucesso(null);
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [aberto]);

  if (!aberto) return null;

  async function processarArquivo(file: File) {
    setErro(null);

    // Validação de extensão
    if (!file.name.toLowerCase().endsWith(".docx")) {
      setErro("Por favor, selecione um arquivo Word no formato .docx. Documentos antigos (.doc) devem ser salvos como .docx no Word antes de importar.");
      return;
    }

    setArquivo(file);
    setCarregando(true);
    try {
      const data = await tfdPreviewImportarWord(file);
      setPreview(data);
      setEtapa("preview");
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.message || "Falha ao processar o arquivo Word.";
      setErro(msg);
      setArquivo(null);
    } finally {
      setCarregando(false);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (files.length > 1) {
      setErro("Selecione apenas 1 arquivo Word (.docx) por vez.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    processarArquivo(files[0]);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();

    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;

    if (files.length > 1) {
      setErro("Arraste apenas 1 arquivo Word (.docx) por vez.");
      return;
    }

    processarArquivo(files[0]);
  }

  async function handleConfirmar() {
    if (!preview || preview.viagens.length === 0) return;
    setSalvando(true);
    setErro(null);
    try {
      const res = await tfdConfirmarImportarWord(preview.viagens);
      setResultadoSucesso(res);
      setEtapa("sucesso");
      if (onSucesso) onSucesso();
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.message || "Falha ao registrar viagens importadas.";
      setErro(msg);
    } finally {
      setSalvando(false);
    }
  }

  const modalContent = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-sus-950/60 p-4 backdrop-blur-xs transition-opacity animate-fadeIn"
      onClick={onFechar}
    >
      <div
        className="my-auto flex max-h-[92vh] w-full max-w-4xl flex-col rounded-3xl bg-white shadow-2xl border border-sus-900/10 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Topo do Modal */}
        <div className="flex items-center justify-between border-b border-sus-900/10 bg-sand/40 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal/10 text-teal">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-display text-base font-bold text-sus-950">
                Importar Viagens do Word (.docx)
              </h3>
              <p className="text-xs text-ink/60">
                Ordem de Circulação de Veículos e Relação de Passageiros TFD
              </p>
            </div>
          </div>
          <button
            onClick={onFechar}
            className="rounded-xl p-2 text-ink/50 transition hover:bg-sand hover:text-sus-950"
            title="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Corpo do Modal */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {erro && (
            <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50/80 p-4 text-xs text-red-800">
              <AlertCircle className="h-5 w-5 shrink-0 text-red-600 mt-0.5" />
              <div className="flex-1">
                <span className="font-bold">Atenção:</span> {erro}
              </div>
            </div>
          )}

          {/* ETAPA 1: SELEÇÃO DE ARQUIVO */}
          {etapa === "upload" && (
            <div className="space-y-4">
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`group flex flex-col items-center justify-center rounded-3xl border-2 border-dashed p-8 text-center transition cursor-pointer ${
                  carregando
                    ? "border-teal/30 bg-sand/30 cursor-wait"
                    : "border-teal/30 bg-sand/15 hover:border-teal hover:bg-teal/5"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  multiple={false}
                  onChange={handleFileChange}
                  className="hidden"
                />

                {carregando ? (
                  <div className="flex flex-col items-center gap-3">
                    <RefreshCw className="h-10 w-10 animate-spin text-teal" />
                    <p className="font-display text-sm font-bold text-sus-950">
                      Analisando documento Word...
                    </p>
                    <p className="text-xs text-ink/50">
                      Identificando cabeçalho, datas, horários e passageiros...
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-teal/10 text-teal group-hover:scale-105 transition-transform">
                      <Upload className="h-7 w-7" />
                    </div>
                    <p className="font-display text-sm font-bold text-sus-950">
                      Clique aqui ou arraste o arquivo do Word (.docx)
                    </p>
                    <p className="mt-1 text-xs text-ink/55 max-w-md">
                      Selecione <strong>1 único arquivo</strong> contendo uma ou mais Ordens de Circulação de Veículos.
                    </p>
                    <span className="mt-3 rounded-full bg-sand px-3 py-1 text-[11px] font-semibold text-ink/65 border border-sus-900/10">
                      Formatos aceitos: Microsoft Word (.docx)
                    </span>
                  </>
                )}
              </div>

              {/* Informações explicativas */}
              <div className="rounded-2xl border border-sus-900/10 bg-sand/30 p-4 space-y-2 text-xs text-ink/75">
                <p className="font-bold text-sus-950 flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-teal" /> Como funciona a detecção automática:
                </p>
                <ul className="list-disc list-inside space-y-1 pl-1 text-[11px] text-ink/70">
                  <li>
                    <strong>Destino, data e horário:</strong> Detecta automaticamente campos como <em>DESTINO: Passos</em>, <em>Data saída: 12/11/2026</em> e <em>Hora saída: 12:30</em>.
                  </li>
                  <li>
                    <strong>Veículo e Motorista:</strong> Caso estejam em branco no Word (com underlines), a viagem será importada normalmente e você poderá atribuir o carro e motorista depois no sistema.
                  </li>
                  <li>
                    <strong>Passageiros e Acompanhantes:</strong> Lê cada linha da tabela <em>RELAÇÃO DE PASSAGEIROS</em>. Caso alguém possua o tratamento <em>Acompanhante</em>, o sistema marcará automaticamente.
                  </li>
                  <li>
                    <strong>Novos Pacientes:</strong> Pacientes que ainda não constam no cadastro serão adicionados automaticamente para que a viagem seja registrada sem bloqueios.
                  </li>
                </ul>
              </div>
            </div>
          )}

          {/* ETAPA 2: PRÉ-VISUALIZAÇÃO DAS VIAGENS DETECTADAS */}
          {etapa === "preview" && preview && (
            <div className="space-y-5 animate-fadeIn">
              {/* Barra de Resumo */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-teal/20 bg-teal/5 p-4">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-teal">
                    Arquivo analisado com sucesso
                  </span>
                  <h4 className="font-display text-sm font-bold text-sus-950 flex items-center gap-2">
                    <FileText className="h-4 w-4 text-teal" /> {preview.nome_arquivo}
                  </h4>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-sus-950 border border-teal/20 shadow-xs">
                    {preview.total_viagens} viagem(ns) detectada(s)
                  </span>
                  <span className="rounded-xl bg-teal px-3 py-1.5 text-xs font-bold text-white shadow-xs">
                    {preview.total_passageiros} passageiro(s) no total
                  </span>
                </div>
              </div>

              {/* Lista de Viagens */}
              <div className="space-y-4">
                {preview.viagens.map((viagem, vIdx) => (
                  <div
                    key={vIdx}
                    className="rounded-2xl border border-sus-900/10 bg-white shadow-xs overflow-hidden"
                  >
                    {/* Cabeçalho da Viagem */}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sus-900/10 bg-sand/30 p-4">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal text-xs font-bold text-white">
                          #{vIdx + 1}
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <h5 className="font-display text-sm font-extrabold text-sus-950 flex items-center gap-1.5">
                              <MapPin className="h-4 w-4 text-teal" /> Destino: {viagem.destino || "Não informado"}
                            </h5>
                            {viagem.viagem_existente_id && (
                              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-800">
                                Viagem existente #{viagem.viagem_existente_id}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-3 text-xs text-ink/65 mt-0.5">
                            <span className="flex items-center gap-1 font-medium">
                              <Calendar className="h-3.5 w-3.5 text-ink/40" />
                              Data: {viagem.data_viagem ? viagem.data_viagem.split("-").reverse().join("/") : "Sem data"}
                            </span>
                            <span className="flex items-center gap-1 font-medium">
                              <Clock className="h-3.5 w-3.5 text-ink/40" />
                              Saída: {viagem.hora_saida || "07:00"}
                            </span>
                            {viagem.hora_retorno && (
                              <span className="text-ink/50">
                                Retorno: {viagem.hora_retorno}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Dados de Carro / Motorista */}
                      <div className="text-right text-xs">
                        <p className="font-semibold text-sus-950">
                          {viagem.veiculo ? `Veículo: ${viagem.veiculo}` : (viagem.placa ? `Placa: ${viagem.placa}` : "Sem veículo informado")}
                        </p>
                        <p className="text-ink/55 text-[11px]">
                          {viagem.motorista ? `Motorista: ${viagem.motorista}` : "Sem motorista informado"}
                        </p>
                      </div>
                    </div>

                    {/* Avisos específicos desta viagem */}
                    {viagem.avisos && viagem.avisos.length > 0 && (
                      <div className="bg-amber-50/70 border-b border-amber-200/60 px-4 py-2 flex items-center gap-2 text-xs text-amber-900">
                        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                        <span className="text-[11px]">
                          {viagem.avisos.join(" · ")}
                        </span>
                      </div>
                    )}

                    {/* Tabela de Passageiros */}
                    <div className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-sus-950 flex items-center gap-1.5">
                          <Users className="h-4 w-4 text-teal" />
                          Relação de Passageiros ({viagem.passageiros.length})
                        </span>
                      </div>

                      {viagem.passageiros.length === 0 ? (
                        <p className="text-xs text-ink/50 italic py-3 text-center">
                          Nenhum passageiro listado na tabela desta viagem.
                        </p>
                      ) : (
                        <div className="overflow-x-auto rounded-xl border border-sus-900/10">
                          <table className="w-full text-left text-xs">
                            <thead className="bg-sand/60 text-[10px] uppercase font-bold text-sus-950/70 border-b border-sus-900/10">
                              <tr>
                                <th className="px-3 py-2 w-10 text-center">Nº</th>
                                <th className="px-3 py-2">Passageiro</th>
                                <th className="px-3 py-2">Prontuário</th>
                                <th className="px-3 py-2">Tratamento / Observação</th>
                                <th className="px-3 py-2">Unidade</th>
                                <th className="px-3 py-2">Horário</th>
                                <th className="px-3 py-2">Cidade</th>
                                <th className="px-3 py-2 text-center">Status Cadastro</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-sus-900/5">
                              {viagem.passageiros.map((pax, pIdx) => (
                                <tr key={pIdx} className="hover:bg-sand/30 transition-colors">
                                  <td className="px-3 py-2 text-center font-mono text-ink/50">
                                    {String(pIdx + 1).padStart(2, "0")}
                                  </td>
                                  <td className="px-3 py-2 font-semibold text-sus-950">
                                    {pax.nome}
                                    {pax.is_acompanhante && (
                                      <span className="ml-2 inline-block rounded-full bg-purple-100 px-2 py-0.5 text-[9px] font-bold text-purple-800">
                                        Acompanhante
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2 font-mono text-ink/65">
                                    {pax.prontuario || "—"}
                                  </td>
                                  <td className="px-3 py-2 text-ink/75">
                                    {pax.tratamento || "—"}
                                  </td>
                                  <td className="px-3 py-2 text-ink/65">
                                    {pax.unidade || "—"}
                                  </td>
                                  <td className="px-3 py-2 font-mono text-ink/75">
                                    {pax.hora_consulta || "—"}
                                  </td>
                                  <td className="px-3 py-2 text-ink/65">
                                    {pax.cidade || viagem.destino || "—"}
                                  </td>
                                  <td className="px-3 py-2 text-center">
                                    {pax.cadastrado ? (
                                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                                        <UserCheck className="h-3 w-3" /> Já cadastrado
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 rounded-full bg-teal/10 px-2 py-0.5 text-[10px] font-bold text-teal border border-teal/20">
                                        Novo paciente
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ETAPA 3: SUCESSO */}
          {etapa === "sucesso" && resultadoSucesso && (
            <div className="py-6 flex flex-col items-center justify-center text-center space-y-4 animate-fadeIn">
              <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-100 text-emerald-700 shadow-xs">
                <CheckCircle2 className="h-9 w-9" />
              </div>
              <div>
                <h4 className="font-display text-lg font-bold text-sus-950">
                  Importação concluída com sucesso!
                </h4>
                <p className="text-xs text-ink/60 mt-1 max-w-md">
                  {resultadoSucesso.mensagem}
                </p>
              </div>

              <div className="grid grid-cols-3 gap-3 w-full max-w-md pt-2">
                <div className="rounded-2xl border border-sus-900/10 bg-sand/30 p-3 text-center">
                  <span className="block font-display text-xl font-extrabold text-sus-950">
                    {resultadoSucesso.viagens_criadas}
                  </span>
                  <span className="text-[10px] font-bold uppercase text-ink/50">
                    Viagem(ns)
                  </span>
                </div>
                <div className="rounded-2xl border border-sus-900/10 bg-sand/30 p-3 text-center">
                  <span className="block font-display text-xl font-extrabold text-teal">
                    {resultadoSucesso.passageiros_vinculados}
                  </span>
                  <span className="text-[10px] font-bold uppercase text-ink/50">
                    Passageiros
                  </span>
                </div>
                <div className="rounded-2xl border border-sus-900/10 bg-sand/30 p-3 text-center">
                  <span className="block font-display text-xl font-extrabold text-emerald-700">
                    {resultadoSucesso.pacientes_cadastrados}
                  </span>
                  <span className="text-[10px] font-bold uppercase text-ink/50">
                    Novos Pacientes
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Rodapé do Modal */}
        <div className="flex items-center justify-between border-t border-sus-900/10 bg-sand/30 px-6 py-4">
          {etapa === "upload" && (
            <>
              <Button variant="ghost" onClick={onFechar} disabled={carregando}>
                Cancelar
              </Button>
              <div className="text-xs text-ink/40">
                Selecione um arquivo .docx para continuar
              </div>
            </>
          )}

          {etapa === "preview" && (
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  setEtapa("upload");
                  setArquivo(null);
                  setPreview(null);
                  setErro(null);
                }}
                disabled={salvando}
              >
                Escolher outro arquivo
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={onFechar} disabled={salvando}>
                  Cancelar
                </Button>
                <Button
                  onClick={handleConfirmar}
                  disabled={salvando || !preview || preview.viagens.length === 0}
                  className="!bg-teal text-white hover:brightness-110 shadow-xs flex items-center gap-2"
                >
                  {salvando ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      Importando...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      Confirmar Importação ({preview?.total_viagens} viagem)
                    </>
                  )}
                </Button>
              </div>
            </>
          )}

          {etapa === "sucesso" && (
            <div className="w-full flex justify-end">
              <Button onClick={onFechar} className="!bg-teal text-white hover:brightness-110">
                Concluir e Ver Viagens
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
