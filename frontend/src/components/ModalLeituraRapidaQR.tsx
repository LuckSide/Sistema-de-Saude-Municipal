import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Bus,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  FlaskConical,
  Loader2,
  MapPin,
  Printer,
  QrCode,
  Search,
  User,
  X,
} from "lucide-react";
import {
  tfdLeituraRapida,
  tfdRecepcaoRapida,
  type LeituraRapidaRes,
} from "../services/api";
import { Button } from "./ui/primitives";
import BotaoWhatsApp from "./BotaoWhatsApp";
import ComprovanteExameModal from "./ComprovanteExameModal";
import { useBackdropClose } from "../hooks/useBackdropClose";

interface ModalLeituraRapidaQRProps {
  onClose: () => void;
  onRecepcaoSucesso?: () => void;
}

export default function ModalLeituraRapidaQR({
  onClose,
  onRecepcaoSucesso,
}: ModalLeituraRapidaQRProps) {
  const [codigoInput, setCodigoInput] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [recepcionando, setRecepcionando] = useState(false);
  const [erro, setErro] = useState("");
  const [sucessoMsg, setSucessoMsg] = useState("");
  const [dados, setDados] = useState<LeituraRapidaRes | null>(null);
  const [abrirComprovante, setAbrirComprovante] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const backdrop = useBackdropClose(onClose);

  useEffect(() => {
    // Foco imediato para aceitar disparos de leitores ópticos / QR scanners
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  async function handleBuscar(codigoAlvo?: string) {
    const cod = (codigoAlvo || codigoInput).trim();
    if (!cod) {
      setErro("Aponte o leitor de QR Code ou digite o código da solicitação.");
      return;
    }
    setCarregando(true);
    setErro("");
    setSucessoMsg("");
    try {
      const res = await tfdLeituraRapida(cod);
      setDados(res);
    } catch (err: any) {
      setDados(null);
      setErro(
        err?.response?.data?.detail ||
          "Nenhuma solicitação ou exame encontrado para este código/QR Code."
      );
    } finally {
      setCarregando(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleBuscar();
    }
  }

  async function handleRecepcionarEmLote() {
    if (!dados) return;
    setRecepcionando(true);
    setErro("");
    try {
      const res = await tfdRecepcaoRapida(dados.numero_pedido || dados.codigo_curto);
      setSucessoMsg(res.mensagem || "Recepção em lote realizada com sucesso!");
      // Atualiza status local
      setDados({
        ...dados,
        status: "recepcionado",
        pode_recepcionar: false,
        todos_coletados: true,
        exames: dados.exames.map((ex) => ({
          ...ex,
          status: "recepcionado",
        })),
      });
      if (onRecepcaoSucesso) {
        onRecepcaoSucesso();
      }
    } catch (err: any) {
      setErro(
        err?.response?.data?.detail || "Erro ao registrar recepção dos exames."
      );
    } finally {
      setRecepcionando(false);
    }
  }

  function limparEScanearOutro() {
    setCodigoInput("");
    setDados(null);
    setErro("");
    setSucessoMsg("");
    setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-sus-950/70 p-3 sm:p-5" {...backdrop}>
        <div className="relative max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white p-5 sm:p-7 shadow-2xl">
          {/* Cabeçalho */}
          <div className="mb-5 flex items-center justify-between border-b border-sus-900/10 pb-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal/10 text-teal">
                <QrCode className="h-5 w-5" />
              </span>
              <div>
                <h3 className="font-display text-base sm:text-lg font-bold text-sus-950">
                  Leitura Rápida de QR Code / Código de Barras
                </h3>
                <p className="text-xs text-ink/60">
                  Aponte o scanner óptico ou digite o código do paciente para conferência instantânea
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl p-2 text-ink/50 hover:bg-sand transition"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Campo de Scanner / Busca */}
          <div className="rounded-2xl border-2 border-teal/20 bg-sand/30 p-4">
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-sus-900/70">
              Código Escaneado / Prontuário / Pedido:
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  ref={inputRef}
                  type="text"
                  value={codigoInput}
                  onChange={(e) => setCodigoInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="EX-000101, PED-2026..., link ou aponte o leitor..."
                  className="w-full rounded-xl border border-sus-900/20 bg-white px-3.5 py-2.5 font-mono text-sm text-sus-950 shadow-inner focus:border-teal focus:outline-none focus:ring-2 focus:ring-teal/20"
                />
              </div>
              <Button
                type="button"
                onClick={() => handleBuscar()}
                disabled={carregando || !codigoInput.trim()}
                className="flex items-center gap-1.5 bg-teal text-white hover:bg-teal-700 !h-10 px-4 text-xs font-semibold"
              >
                {carregando ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                Buscar
              </Button>
            </div>
          </div>

          {/* Mensagens de Erro / Sucesso */}
          {erro && (
            <div className="mt-4 flex items-center gap-2 rounded-xl bg-red-50 p-3 text-xs text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
              <span>{erro}</span>
            </div>
          )}

          {sucessoMsg && (
            <div className="mt-4 flex items-center gap-2 rounded-xl bg-teal/10 p-3 text-xs text-teal font-medium">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{sucessoMsg}</span>
            </div>
          )}

          {/* Dados Encontrados */}
          {dados && (
            <div className="mt-5 space-y-4">
              {/* Card de Identificação */}
              <div className="rounded-2xl border border-sus-900/10 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sus-900/10 pb-3">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-ink/50">
                      Solicitação / Pedido
                    </span>
                    <h4 className="font-mono font-black text-base text-sus-950">
                      {dados.numero_pedido || dados.codigo_curto}
                    </h4>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-teal/15 px-2.5 py-1 text-xs font-bold uppercase text-teal">
                      {dados.status}
                    </span>
                    <span className="text-xs text-ink/60">
                      Data: {dados.data_agendada || dados.data_pedido || "—"}
                    </span>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-[10px] text-ink/60 flex items-center gap-1 font-semibold">
                      <User className="h-3 w-3 text-teal" /> Paciente
                    </p>
                    <p className="text-sm font-bold text-sus-950">
                      {dados.paciente.nome}
                    </p>
                    <p className="font-mono text-[11px] text-ink/70">
                      Prontuário: {dados.paciente.prontuario || "—"} · CPF:{" "}
                      {dados.paciente.cpf || "—"}
                    </p>
                    {dados.paciente.telefone && (
                      <p className="text-[11px] text-ink/60">
                        Tel: {dados.paciente.telefone}
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-[10px] text-ink/60 flex items-center gap-1 font-semibold">
                      <MapPin className="h-3 w-3 text-teal" /> Destino / Unidade
                    </p>
                    <p className="font-medium text-sus-950">
                      {dados.destino || "Laboratório Municipal"}
                    </p>
                    <p className="text-[11px] text-ink/70">
                      Solicitante: {dados.medico_nome || "Médico da Unidade"} (
                      {dados.unidade_nome || "PSF"})
                    </p>
                  </div>
                </div>
              </div>

              {/* Informações de Transporte / Viagem Vinculada (Exibido apenas quando houver viagem vinculada) */}
              {dados.transporte && dados.transporte.possui_viagem && (
                <div className="rounded-2xl border-2 border-teal/40 bg-teal/5 p-4 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-teal/20 pb-2.5 mb-3">
                    <span className="flex items-center gap-2 font-display text-xs font-bold uppercase tracking-wider text-teal">
                      <Bus className="h-4 w-4" />
                      Transporte Municipal Vinculado (TFD / Frota)
                    </span>
                    {dados.transporte.viagem_id && (
                      <span className="rounded-md bg-teal/15 px-2 py-0.5 font-mono text-[11px] font-bold text-teal">
                        Viagem #{dados.transporte.viagem_id}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div className="rounded-xl bg-white/80 p-2.5 border border-teal/15">
                      <p className="text-[10px] text-ink/60 font-semibold uppercase tracking-wider">
                        Veículo / Modelo
                      </p>
                      <p className="text-sm font-bold text-sus-950 mt-0.5">
                        {dados.transporte.veiculo}
                      </p>
                    </div>

                    <div className="rounded-xl bg-white/80 p-2.5 border border-teal/15">
                      <p className="text-[10px] text-ink/60 font-semibold uppercase tracking-wider">
                        Ponto de Saída / Embarque
                      </p>
                      <p className="text-sm font-bold text-sus-950 mt-0.5">
                        {dados.transporte.ponto_saida}
                      </p>
                    </div>

                    <div className="rounded-xl bg-white/80 p-2.5 border border-teal/15">
                      <p className="text-[10px] text-ink/60 font-semibold uppercase tracking-wider">
                        Horário de Saída
                      </p>
                      <p className="text-sm font-bold text-teal mt-0.5 flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5 text-teal" />
                        {dados.transporte.horario_saida}
                      </p>
                    </div>
                  </div>

                  {(dados.transporte.destino || dados.transporte.motorista || dados.transporte.acompanhante) && (
                    <div className="mt-2.5 pt-2 border-t border-teal/15 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink/75">
                      {dados.transporte.destino && (
                        <span>Destino: <b className="text-sus-950">{dados.transporte.destino}</b></span>
                      )}
                      {dados.transporte.motorista && (
                        <span>Motorista: <b className="text-sus-950">{dados.transporte.motorista}</b></span>
                      )}
                      {dados.transporte.acompanhante && (
                        <span>Acompanhante: <b className="text-sus-950">{dados.transporte.acompanhante}</b></span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Instruções Adicionais de Transporte / Observações do Operador */}
              {dados.instrucoes_transporte && (
                <div className="rounded-2xl border border-teal/20 bg-sand/30 p-3.5 text-xs">
                  <p className="font-bold text-teal flex items-center gap-1.5 mb-1">
                    <Bus className="h-3.5 w-3.5" /> Instruções Adicionais para o Paciente:
                  </p>
                  <p className="text-ink/80 whitespace-pre-wrap">{dados.instrucoes_transporte}</p>
                </div>
              )}

              {/* Relação de Procedimentos da Solicitação */}
              <div className="rounded-2xl border border-sus-900/10 bg-white p-4 shadow-sm">
                <h5 className="mb-2 text-xs font-bold uppercase tracking-wider text-sus-900/70">
                  Exames Vinculados a Este Pedido ({dados.exames.length}):
                </h5>
                <div className="divide-y divide-sus-900/10 rounded-xl border border-sus-900/10 overflow-hidden text-xs">
                  {dados.exames.map((ex, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-2.5 hover:bg-sand/30"
                    >
                      <div>
                        <span className="font-mono font-bold text-teal text-[11px] mr-2">
                          {ex.codigo || "SIGTAP"}
                        </span>
                        <span className="font-semibold text-sus-950">
                          {ex.nome}
                        </span>
                      </div>
                      <span className="rounded bg-sand px-2 py-0.5 text-[10px] font-bold uppercase text-ink/75">
                        {ex.status}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Preparo e Jejum Clínico */}
                {dados.preparo && (
                  <div className="mt-3 rounded-xl bg-amber-50/80 p-2.5 text-xs text-amber-950 border border-amber-200">
                    <p className="font-bold text-amber-900">
                      ⏱️ Jejum Recomendado: {dados.preparo.jejum || "Padrão"}
                    </p>
                    {dados.preparo.instrucoes?.length > 0 && (
                      <p className="text-[11px] text-amber-900/90 mt-0.5">
                        {dados.preparo.instrucoes.join(" · ")}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Botões de Ação */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-sus-900/10">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    onClick={() => setAbrirComprovante(true)}
                    className="flex items-center gap-1.5 border border-sus-900/20 bg-white text-sus-950 hover:bg-sand !h-9 text-xs"
                  >
                    <Printer className="h-4 w-4 text-teal" />
                    Comprovante Unificado
                  </Button>

                  {dados.tipo === "tfd" && (
                    <BotaoWhatsApp
                      exameId={dados.pedido_id}
                      exame={{
                        id: dados.pedido_id,
                        paciente_nome: dados.paciente.nome,
                        paciente_telefone: dados.paciente.telefone,
                        paciente_id: dados.paciente.id,
                        exame: dados.exames.map((e) => e.nome).join(", "),
                        data_agendada: dados.data_agendada,
                        hora_agendada: dados.hora_agendada,
                        unidade_nome: dados.unidade_nome,
                        destino: dados.destino,
                      }}
                      tipo={dados.data_agendada ? "agendamento" : "entrada_fila"}
                      variante="compacto"
                    />
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    onClick={limparEScanearOutro}
                    className="border border-sus-900/20 bg-sand/60 text-ink/75 hover:bg-sand !h-9 text-xs"
                  >
                    Próximo Paciente
                  </Button>

                  {dados.pode_recepcionar && (
                    <Button
                      type="button"
                      onClick={handleRecepcionarEmLote}
                      disabled={recepcionando}
                      className="flex items-center gap-1.5 bg-teal text-white hover:bg-teal-700 !h-9 text-xs font-semibold"
                    >
                      {recepcionando ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4" />
                      )}
                      Confirmar Recepção em Lote
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {abrirComprovante && dados && (
        <ComprovanteExameModal
          exameId={dados.tipo === "tfd" ? dados.pedido_id : undefined}
          solicitacaoId={dados.tipo === "lab" ? dados.pedido_id : undefined}
          numeroPedido={dados.numero_pedido}
          onClose={() => setAbrirComprovante(false)}
        />
      )}
    </>
  );
}
