import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  FlaskConical,
  QrCode,
  Search,
  X,
} from "lucide-react";
import {
  solicitarListar,
  mapMestre,
  labRecepcionarColeta,
  labPedirAjuste,
  pagData,
  type SolicMestre,
} from "../../services/api";
import { Button, Card, Input, Label } from "../../components/ui/primitives";
import ModalLeituraRapidaQR from "../../components/ModalLeituraRapidaQR";
import { useAuth } from "../../hooks/useAuth";

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function RecepcaoLab() {
  const { user } = useAuth();
  const [lista, setLista] = useState<SolicMestre[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");

  // Filtros
  const [filtroStatus, setFiltroStatus] = useState<string>("todos");
  const [dataFiltro, setDataFiltro] = useState<string>(hojeISO());
  const [termoBusca, setTermoBusca] = useState("");

  // Modais
  const [modalLeituraQR, setModalLeituraQR] = useState(false);

  // Modal de Pedido de Ajuste
  const [modalAjuste, setModalAjuste] = useState(false);
  const [itemAjuste, setItemAjuste] = useState<SolicMestre | null>(null);
  const [tipoAjuste, setTipoAjuste] = useState("divergencia_pedido");
  const [justificativaAjuste, setJustificativaAjuste] = useState("");
  const [enviandoAjuste, setEnviandoAjuste] = useState(false);

  async function carregar() {
    setCarregando(true);
    setErro("");
    try {
      const qVal = termoBusca.trim();
      const res = await solicitarListar({
        q: qVal || undefined,
        status: filtroStatus !== "todos" ? filtroStatus : undefined,
        data_de: qVal ? undefined : (dataFiltro || undefined),
        data_ate: qVal ? undefined : (dataFiltro || undefined),
        limit: 100,
      });
      const arr = pagData<any>(res);
      setLista(arr.map(mapMestre));
    } catch {
      setErro("Falha ao carregar lista de atendimentos do laboratório.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregar();
  }, [filtroStatus, dataFiltro]);

  // Busca inteligente com debounce
  useEffect(() => {
    const t = setTimeout(() => {
      carregar();
    }, 300);
    return () => clearTimeout(t);
  }, [termoBusca]);

  async function confirmarRecepcao(item: SolicMestre) {
    if (!confirm(`Confirmar a recepção e coleta dos exames de ${item.paciente_nome}?`)) return;
    try {
      const atualizado = await labRecepcionarColeta(item.id);
      setOk(`Coleta de ${item.paciente_nome} confirmada com sucesso!`);
      setLista((antiga) =>
        antiga.map((x) => (x.id === item.id ? { ...x, status: "coletado", coletado_em: atualizado.coletado_em, coletado_por: atualizado.coletado_por } : x))
      );
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Erro ao registrar recepção e coleta.");
    }
  }

  function abrirModalAjuste(item: SolicMestre) {
    setItemAjuste(item);
    setTipoAjuste("divergencia_pedido");
    setJustificativaAjuste("");
    setModalAjuste(true);
  }

  async function submeterAjuste() {
    if (!itemAjuste) return;
    if (justificativaAjuste.trim().length < 8) {
      alert("Por favor, preencha a justificativa detalhada da divergência (mínimo 8 caracteres).");
      return;
    }

    setEnviandoAjuste(true);
    try {
      await labPedirAjuste(itemAjuste.id, {
        tipo_ajuste: tipoAjuste,
        justificativa: justificativaAjuste.trim(),
      });
      setModalAjuste(false);
      setOk(`Pedido de ajuste para ${itemAjuste.paciente_nome} enviado para a Secretaria com sucesso.`);
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Erro ao registrar pedido de ajuste.");
    } finally {
      setEnviandoAjuste(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Topo do Módulo do Laboratório Conveniado */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal/15 text-teal">
              <FlaskConical className="h-5 w-5" />
            </span>
            <h2 className="font-display text-xl font-bold text-sus-950">
              Laboratório · Recepção e Coleta de Exames
            </h2>
          </div>
          <p className="mt-1 text-xs text-ink/65">
            Módulo de conferência de pedidos, realização de coleta e notificação de divergências.
            {user?.laboratorio_nome && (
              <span className="ml-2 font-semibold text-teal">
                · Unidade vinculada: {user.laboratorio_nome}
              </span>
            )}
          </p>
        </div>

        <div>
          <Button
            type="button"
            onClick={() => setModalLeituraQR(true)}
            className="border border-teal/40 bg-teal/5 text-teal hover:bg-teal/15 text-xs font-bold flex items-center gap-1.5 !h-10"
          >
            <QrCode className="h-4 w-4" /> Leitura Rápida QR Code
          </Button>
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

      {/* Barra de Filtros e Busca Rápida */}
      <Card className="p-4 border-sus-900/10 shadow-xs">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
          {/* Busca Inteligente */}
          <div className="md:col-span-5 relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-teal" />
            <Input
              value={termoBusca}
              onChange={(e) => setTermoBusca(e.target.value)}
              placeholder="Buscar por paciente, CPF, CNS ou protocolo (#)..."
              className="pl-10 pr-9 !h-10 text-xs sm:text-sm"
            />
            {termoBusca && (
              <button
                onClick={() => setTermoBusca("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/40 hover:text-ink/80 transition"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Filtro por Data */}
          <div className="md:col-span-4 flex items-center gap-2">
            <Input
              type="date"
              value={dataFiltro}
              onChange={(e) => setDataFiltro(e.target.value)}
              className="!h-10 text-xs"
            />
            <Button
              type="button"
              onClick={() => setDataFiltro(hojeISO())}
              className="border border-sus-900/15 bg-white text-ink hover:bg-sand !h-10 px-3 text-xs shrink-0"
              title="Filtrar exames de hoje"
            >
              Hoje
            </Button>
            {dataFiltro && (
              <button
                type="button"
                onClick={() => setDataFiltro("")}
                className="text-xs text-ink/50 hover:text-ink underline shrink-0"
              >
                Limpar data
              </button>
            )}
          </div>

          {/* Filtro por Status */}
          <div className="md:col-span-3">
            <select
              value={filtroStatus}
              onChange={(e) => setFiltroStatus(e.target.value)}
              className="w-full h-10 rounded-xl border border-sus-900/15 bg-white px-3 text-xs outline-none focus:border-teal"
            >
              <option value="todos">Todos os status</option>
              <option value="agendado">Aguardando Coleta (Agendados)</option>
              <option value="coletado">Coleta Realizada (Recepcionados)</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Relação de Atendimentos */}
      {carregando ? (
        <div className="py-12 text-center text-ink/50">
          <div className="inline-block h-7 w-7 animate-spin rounded-full border-2 border-teal border-t-transparent mb-2" />
          <p className="text-xs font-medium">Carregando agendamentos do laboratório...</p>
        </div>
      ) : lista.length === 0 ? (
        <Card className="p-10 text-center border-dashed">
          <FlaskConical className="mx-auto h-8 w-8 text-ink/30 mb-2" />
          <p className="text-sm font-semibold text-sus-950">Nenhum atendimento encontrado</p>
          <p className="mt-1 text-xs text-ink/55">
            Não há exames para a data e filtros selecionados.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {lista.map((item) => {
            const isColetado = item.status === "coletado";
            return (
              <Card
                key={item.id}
                className={`p-5 border-sus-900/10 shadow-xs flex flex-col justify-between transition ${
                  isColetado ? "bg-emerald-50/20 border-emerald-200/60" : "hover:border-teal/30"
                }`}
              >
                <div>
                  {/* Cabeçalho do Card */}
                  <div className="flex items-start justify-between gap-2 border-b border-sus-900/10 pb-3 mb-3">
                    <div>
                      <h3 className="font-bold text-sus-950 text-base leading-snug">
                        {item.paciente_nome}
                      </h3>
                      <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-ink/65">
                        {item.paciente_cpf && <span>CPF: {item.paciente_cpf}</span>}
                        {item.paciente_cns && <span>CNS: {item.paciente_cns}</span>}
                        {item.paciente_prontuario && <span>Pront.: {item.paciente_prontuario}</span>}
                        {item.unidade_psf && (
                          <span className="rounded bg-sand px-1.5 py-0.5 font-medium text-sus-900">
                            {item.unidade_psf}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="font-mono text-xs font-bold text-ink/50">#{item.id}</span>
                      <div>
                        <span
                          className={`mt-1 inline-block rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${
                            isColetado
                              ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                              : "bg-teal/15 text-teal border border-teal/20"
                          }`}
                        >
                          {isColetado ? "✓ Coletado" : "Aguardando Coleta"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Detalhes de Agendamento */}
                  <div className="grid grid-cols-2 gap-2 text-xs mb-3 bg-sand/30 p-2.5 rounded-xl border border-sus-900/5">
                    <div>
                      <span className="text-[10px] text-ink/50 flex items-center gap-1">
                        <Calendar className="h-3 w-3 text-teal" /> Data Agendada
                      </span>
                      <span className="font-semibold text-sus-950">
                        {item.data_agendada
                          ? item.data_agendada.split("-").reverse().join("/")
                          : "—"}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-ink/50 flex items-center gap-1">
                        <Clock className="h-3 w-3 text-teal" /> Horário Previsto
                      </span>
                      <span className="font-semibold text-sus-950">
                        {item.hora_agendada || "07:00 às 09:00"}
                      </span>
                    </div>
                    {item.medico_solicitante && (
                      <div className="col-span-2">
                        <span className="text-[10px] text-ink/50 block">Médico Solicitante</span>
                        <span className="text-ink/80">Dr(a). {item.medico_solicitante}</span>
                      </div>
                    )}
                  </div>

                  {/* Procedimentos Solicitados */}
                  <div className="mb-3">
                    <p className="text-[11px] font-bold uppercase text-sus-900/70 mb-1">
                      Procedimentos para Coleta ({item.itens?.length || 0})
                    </p>
                    <div className="space-y-1">
                      {(item.itens || []).map((it: any, idx) => (
                        <div
                          key={idx}
                          className="text-xs text-ink/85 flex items-center justify-between border-b border-sus-900/5 pb-1"
                        >
                          <span className="truncate mr-2">
                            <span className="font-mono text-[10px] text-ink/50 mr-1.5">
                              {it.codigo || it.procedimento_codigo}
                            </span>
                            {it.descricao || it.procedimento_descricao}
                          </span>
                          {it.quantidade > 1 && (
                            <span className="text-[10px] font-bold text-teal bg-teal/10 px-1.5 rounded">
                              ×{it.quantidade}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Orientação de Jejum */}
                  <div className="rounded-lg bg-amber-50/70 p-2 text-[11px] text-amber-900 border border-amber-200/50 mb-3">
                    <span className="font-bold">⏱️ Jejum Clínico:</span> {item.jejum_horas || "8 a 12 horas"}
                  </div>

                  {/* Status de Coleta Realizada */}
                  {isColetado && item.coletado_em && (
                    <div className="rounded-lg bg-emerald-50 p-2 text-[11px] text-emerald-800 border border-emerald-200 mb-3">
                      ✓ Coleta registrada em <strong>{new Date(item.coletado_em).toLocaleString("pt-BR")}</strong>
                      {item.coletado_por && <span> por {item.coletado_por}</span>}.
                    </div>
                  )}
                </div>

                {/* Ações da Recepção */}
                {!isColetado && (
                  <div className="flex flex-wrap items-center justify-end pt-3 border-t border-sus-900/10 gap-2">
                    <Button
                      type="button"
                      onClick={() => abrirModalAjuste(item)}
                      className="border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 !h-9 text-xs"
                      title="Notificar divergência ou solicitar alteração"
                    >
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-600" /> Solicitar Ajuste
                    </Button>

                    <Button
                      type="button"
                      onClick={() => confirmarRecepcao(item)}
                      className="!h-9 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                    >
                      <CheckCircle2 className="h-4 w-4" /> Marcar Coleta Realizada
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Modal de Pedido de Ajuste / Notificação de Divergência */}
      {modalAjuste && itemAjuste && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-sus-950/60 p-3 sm:p-5"
          onClick={() => setModalAjuste(false)}
        >
          <div
            className="rise max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between border-b border-sus-900/10 pb-3">
              <div>
                <h3 className="font-display text-base font-bold text-sus-950 flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-600" />
                  Solicitar Ajuste / Notificar Divergência
                </h3>
                <p className="mt-0.5 text-xs text-ink/65">
                  Paciente: <strong>{itemAjuste.paciente_nome}</strong> (Pedido #{itemAjuste.id})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalAjuste(false)}
                className="rounded-xl p-2 text-ink/50 hover:bg-sand transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <Label>Motivo / Tipo de Divergência *</Label>
                <select
                  value={tipoAjuste}
                  onChange={(e) => setTipoAjuste(e.target.value)}
                  className="w-full h-11 rounded-xl border border-sus-900/15 bg-white px-3.5 text-sm outline-none focus:border-teal"
                >
                  <option value="divergencia_pedido">
                    Divergência entre o pedido físico e os procedimentos cadastrados
                  </option>
                  <option value="inclusao_exame">
                    Necessidade de inclusão de exame complementar indicado no pedido
                  </option>
                  <option value="cancelamento_exame">
                    Paciente sem preparo / jejum inadequado ou impossibilidade de coleta
                  </option>
                  <option value="divergencia_dados">
                    Divergência de dados cadastrais (CPF, CNS ou data de nascimento)
                  </option>
                  <option value="outro">Outro motivo clínico / técnico</option>
                </select>
              </div>

              <div>
                <Label>Justificativa Detalhada da Divergência *</Label>
                <textarea
                  rows={4}
                  value={justificativaAjuste}
                  onChange={(e) => setJustificativaAjuste(e.target.value)}
                  placeholder="Descreva de forma clara o que diverge e a alteração necessária para conferência da Secretaria de Saúde..."
                  className="w-full rounded-xl border border-sus-900/15 bg-white p-3 text-sm text-ink outline-none focus:border-teal"
                />
                <p className="mt-1 text-[11px] text-ink/50">
                  Este pedido ficará registrado na Secretaria de Saúde para análise do auditor regulador.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-sus-900/10">
                <Button
                  type="button"
                  onClick={() => setModalAjuste(false)}
                  className="border border-sus-900/15 bg-white text-ink hover:bg-sand"
                >
                  Cancelar
                </Button>
                <Button onClick={submeterAjuste} disabled={enviandoAjuste}>
                  {enviandoAjuste ? "Enviando pedido..." : "Enviar para Aprovação da Secretaria"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {modalLeituraQR && (
        <ModalLeituraRapidaQR
          onClose={() => setModalLeituraQR(false)}
          onRecepcaoSucesso={() => carregar()}
        />
      )}
    </div>
  );
}
