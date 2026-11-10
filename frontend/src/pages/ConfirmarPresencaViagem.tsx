import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Bus,
  Calendar,
  CheckCircle2,
  Clock,
  MapPin,
  AlertCircle,
  User,
  Users,
  ShieldCheck,
  XCircle,
  Car,
} from "lucide-react";
import {
  tfdConsultarViagemPublica,
  tfdConfirmarPresencaPublica,
  type ViagemConfirmacaoPublica,
} from "../services/api";
import { Card } from "../components/ui/primitives";

export default function ConfirmarPresencaViagem() {
  const { token } = useParams<{ token: string }>();
  const [dado, setDado] = useState<ViagemConfirmacaoPublica | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState("");
  const [sucessoMsg, setSucessoMsg] = useState("");
  const [modalDesistir, setModalDesistir] = useState(false);
  const [motivoDesistencia, setMotivoDesistencia] = useState("");

  useEffect(() => {
    if (!token || !/^[A-Za-z0-9-_]{10,128}$/.test(token)) {
      setErro("Link de confirmação inválido ou incompleto.");
      setLoading(false);
      return;
    }
    carregar();
  }, [token]);

  async function carregar() {
    if (!token) return;
    setLoading(true);
    setErro("");
    try {
      const res = await tfdConsultarViagemPublica(token);
      setDado(res);
    } catch {
      setErro("Viagem ou agendamento não encontrado. Confira o link recebido no WhatsApp.");
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmar() {
    if (!token) return;
    setConfirmando(true);
    setErro("");
    try {
      const atualizado = await tfdConfirmarPresencaPublica(token, "confirmar");
      setDado(atualizado);
      setSucessoMsg("Presença confirmada com sucesso! Seu assento está garantido no veículo.");
    } catch {
      setErro("Não foi possível registrar a confirmação. Tente novamente.");
    } finally {
      setConfirmando(false);
    }
  }

  async function handleDesistir() {
    if (!token) return;
    setConfirmando(true);
    setErro("");
    try {
      const atualizado = await tfdConfirmarPresencaPublica(token, "desistir", motivoDesistencia);
      setDado(atualizado);
      setModalDesistir(false);
      setSucessoMsg("Desistência registrada. Agradecemos por avisar com antecedência para liberar a vaga a outro cidadão.");
    } catch {
      setErro("Falha ao registrar desistência. Tente novamente.");
    } finally {
      setConfirmando(false);
    }
  }

  const formatarData = (dt: string) => {
    if (!dt) return "—";
    const partes = dt.slice(0, 10).split("-");
    if (partes.length === 3) return `${partes[2]}/${partes[1]}/${partes[0]}`;
    return dt;
  };

  const formatarDataHora = (dtStr: string | null) => {
    if (!dtStr) return "";
    try {
      const d = new Date(dtStr);
      return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
    } catch {
      return dtStr;
    }
  };

  return (
    <div className="min-h-screen bg-sand px-4 py-8 font-body text-ink">
      <div className="mx-auto max-w-lg">
        {/* Cabeçalho Oficial */}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-teal text-white shadow-md">
            <Bus className="h-7 w-7" />
          </div>
          <h1 className="font-display text-xl font-bold text-sus-950 sm:text-2xl">
            Transporte da Saúde · TFD
          </h1>
          <p className="text-xs text-ink/65">
            Prefeitura Municipal de Guapé · Secretaria de Saúde
          </p>
        </div>

        {/* Card Principal */}
        <Card className="overflow-hidden p-0 shadow-lg">
          {loading ? (
            <div className="p-8 text-center text-ink/60">
              <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-teal border-t-transparent" />
              <p className="text-sm font-semibold">Carregando dados da viagem...</p>
            </div>
          ) : erro ? (
            <div className="p-6 text-center">
              <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-red-100 text-red-600">
                <AlertCircle className="h-6 w-6" />
              </div>
              <p className="font-display text-base font-bold text-red-700">Atenção</p>
              <p className="mt-1 text-sm text-ink/70">{erro}</p>
            </div>
          ) : dado ? (
            <div>
              {/* Status Banner */}
              {dado.status_confirmacao === "confirmado" ? (
                <div className="bg-emerald-600 px-6 py-4 text-white">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-7 w-7 shrink-0 text-emerald-200" />
                    <div>
                      <h2 className="font-display text-base font-bold sm:text-lg">
                        Presença Confirmada!
                      </h2>
                      <p className="text-xs text-emerald-100">
                        Seu lugar no veículo está garantido.
                        {dado.confirmado_em && ` (Confirmado em ${formatarDataHora(dado.confirmado_em)})`}
                      </p>
                    </div>
                  </div>
                </div>
              ) : dado.status_confirmacao === "desistiu" ? (
                <div className="bg-red-600 px-6 py-4 text-white">
                  <div className="flex items-center gap-3">
                    <XCircle className="h-7 w-7 shrink-0 text-red-200" />
                    <div>
                      <h2 className="font-display text-base font-bold sm:text-lg">
                        Desistência Registrada
                      </h2>
                      <p className="text-xs text-red-100">
                        Você informou que não comparecerá a esta viagem. A vaga foi liberada.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-amber-500 px-6 py-4 text-white">
                  <div className="flex items-center gap-3">
                    <Clock className="h-7 w-7 shrink-0 text-amber-200" />
                    <div>
                      <h2 className="font-display text-base font-bold sm:text-lg">
                        Confirmação Pendente
                      </h2>
                      <p className="text-xs text-amber-100">
                        Por favor, confirme se você comparecerá ao embarque do transporte.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Mensagem de sucesso recente */}
              {sucessoMsg && (
                <div className="border-b border-emerald-200 bg-emerald-50 px-6 py-3 text-xs font-semibold text-emerald-900">
                  {sucessoMsg}
                </div>
              )}

              <div className="p-6 space-y-5">
                {/* Paciente */}
                <div className="rounded-xl border border-sus-900/10 bg-sand/40 p-4">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-ink/50">
                    Paciente Passageiro
                  </p>
                  <p className="mt-0.5 flex items-center gap-2 font-display text-lg font-bold text-sus-950">
                    <User className="h-4 w-4 text-teal" />
                    {dado.paciente_nome}
                  </p>
                  {dado.acompanhante && (
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-ink/70">
                      <Users className="h-3.5 w-3.5 text-ink/50" />
                      Acompanhante: <b className="text-sus-950">{dado.acompanhante}</b>
                    </p>
                  )}
                  {dado.tratamento && (
                    <p className="mt-1 text-xs text-ink/65">
                      Finalidade: <span className="font-medium text-sus-950">{dado.tratamento}</span>
                    </p>
                  )}
                </div>

                {/* Detalhes da Viagem */}
                <div className="space-y-3 rounded-xl border border-sus-900/10 p-4 text-sm">
                  {/* Data e Horário */}
                  <div className="grid grid-cols-2 gap-3 border-b border-sus-900/10 pb-3">
                    <div>
                      <p className="flex items-center gap-1.5 text-xs font-semibold text-ink/60">
                        <Calendar className="h-3.5 w-3.5 text-teal" /> Data da Viagem
                      </p>
                      <p className="mt-0.5 font-display text-base font-bold text-sus-950">
                        {formatarData(dado.data_viagem)}
                      </p>
                    </div>
                    <div>
                      <p className="flex items-center gap-1.5 text-xs font-semibold text-ink/60">
                        <Clock className="h-3.5 w-3.5 text-teal" /> Horário de Saída
                      </p>
                      <p className="mt-0.5 font-display text-base font-bold text-sus-950">
                        {dado.hora_saida || "06:00"}
                      </p>
                    </div>
                  </div>

                  {/* Ponto de Embarque */}
                  <div className="border-b border-sus-900/10 pb-3">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-ink/60">
                      <MapPin className="h-3.5 w-3.5 text-teal" /> Ponto de Saída / Embarque
                    </p>
                    <p className="mt-0.5 font-semibold text-sus-950">
                      {dado.ponto_saida || "Prefeitura Municipal de Guapé"}
                    </p>
                  </div>

                  {/* Destino */}
                  <div className="border-b border-sus-900/10 pb-3">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-ink/60">
                      <Bus className="h-3.5 w-3.5 text-teal" /> Destino
                    </p>
                    <p className="mt-0.5 font-semibold text-sus-950">
                      {dado.destino} {dado.unidade ? ` · ${dado.unidade}` : ""}
                    </p>
                  </div>

                  {/* Veículo e Motorista */}
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div>
                      <p className="flex items-center gap-1.5 text-xs font-semibold text-ink/60">
                        <Car className="h-3.5 w-3.5 text-teal" /> Veículo
                      </p>
                      <p className="mt-0.5 font-medium text-sus-950">
                        {dado.veiculo || "Veículo Municipal"}
                      </p>
                    </div>
                    {dado.motorista && (
                      <div>
                        <p className="flex items-center gap-1.5 text-xs font-semibold text-ink/60">
                          <User className="h-3.5 w-3.5 text-teal" /> Motorista
                        </p>
                        <p className="mt-0.5 font-medium text-sus-950">
                          {dado.motorista}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Ações do Paciente */}
                <div className="pt-2 space-y-3">
                  {dado.status_confirmacao !== "confirmado" && (
                    <button
                      onClick={handleConfirmar}
                      disabled={confirmando}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-teal px-6 py-3.5 font-display text-base font-bold text-white shadow-md transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-5 w-5" />
                      {confirmando ? "Registrando..." : "Confirmar Presença na Viagem"}
                    </button>
                  )}

                  {dado.status_confirmacao === "confirmado" && (
                    <div className="rounded-xl bg-emerald-50 p-4 text-center">
                      <div className="flex items-center justify-center gap-2 font-display text-sm font-bold text-emerald-800">
                        <ShieldCheck className="h-4 w-4" /> Presença Registrada no Sistema
                      </div>
                      <p className="mt-1 text-xs text-emerald-700">
                        O operador do transporte já pode visualizar sua confirmação no painel municipal.
                      </p>
                    </div>
                  )}

                  {/* Botão de Desistência */}
                  {dado.status_confirmacao !== "desistiu" && (
                    <div className="text-center">
                      <button
                        onClick={() => setModalDesistir(true)}
                        className="text-xs font-semibold text-red-600 underline hover:text-red-700"
                      >
                        Não poderei comparecer a esta viagem
                      </button>
                    </div>
                  )}

                  {dado.status_confirmacao === "desistiu" && (
                    <button
                      onClick={handleConfirmar}
                      disabled={confirmando}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-teal px-6 py-3 font-display text-sm font-bold text-white hover:brightness-110 disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Mudei de ideia: Desejo Confirmar Presença
                    </button>
                  )}
                </div>

                {/* Orientações Gerais */}
                <div className="rounded-xl bg-sand/60 p-3.5 text-xs text-ink/70">
                  <p className="font-bold text-sus-950">📌 Recomendações Importantes:</p>
                  <ul className="mt-1.5 list-inside list-disc space-y-1 text-[11px]">
                    <li>Chegue com 15 minutos de antecedência ao ponto de saída.</li>
                    <li>Apresente documento com foto (RG ou CNH) e Cartão Nacional do SUS.</li>
                    <li>Em caso de dúvidas, procure a Secretaria Municipal de Saúde.</li>
                  </ul>
                </div>
              </div>
            </div>
          ) : null}
        </Card>

        {/* Modal de Desistência */}
        {modalDesistir && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
            <Card className="w-full max-w-md p-6">
              <div className="flex items-center gap-2 text-red-600">
                <AlertCircle className="h-5 w-5" />
                <h3 className="font-display text-base font-bold">Informar Desistência</h3>
              </div>
              <p className="mt-2 text-xs text-ink/70">
                Tem certeza que deseja cancelar sua presença no transporte? Sua vaga será disponibilizada para outro paciente da fila de espera.
              </p>
              <div className="mt-3">
                <label className="text-xs font-semibold text-ink/70">
                  Motivo (opcional):
                </label>
                <input
                  type="text"
                  value={motivoDesistencia}
                  onChange={(e) => setMotivoDesistencia(e.target.value)}
                  placeholder="Ex: Consulta remarcada, imprevisto pessoal..."
                  className="mt-1 w-full rounded-lg border border-sus-900/20 px-3 py-2 text-xs focus:border-teal focus:outline-hidden"
                />
              </div>
              <div className="mt-5 flex gap-2">
                <button
                  onClick={() => setModalDesistir(false)}
                  className="flex-1 rounded-xl border border-sus-900/15 px-3 py-2 text-xs font-bold text-ink hover:bg-sand"
                >
                  Voltar
                </button>
                <button
                  onClick={handleDesistir}
                  disabled={confirmando}
                  className="flex-1 rounded-xl bg-red-600 px-3 py-2 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {confirmando ? "Registrando..." : "Confirmar Cancelamento"}
                </button>
              </div>
            </Card>
          </div>
        )}

        {/* Rodapé */}
        <p className="mt-6 text-center text-[11px] text-ink/45">
          Sistema de Saúde Municipal de Guapé · Notificações e Agendamento
        </p>
      </div>
    </div>
  );
}
