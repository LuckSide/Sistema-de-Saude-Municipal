import { useEffect, useState, useRef } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  Eye,
  FileCheck,
  FileText,
  FileUp,
  FlaskConical,
  QrCode,
  RefreshCw,
  Search,
  UploadCloud,
  X,
} from "lucide-react";
import {
  solicitarListar,
  mapMestre,
  labRecepcionarColeta,
  labPedirAjuste,
  labUploadLaudo,
  labJustificarInconsistencia,
  labVisualizarLaudoPdfUrl,
  labsListar,
  pagData,
  pagMeta,
  type SolicMestre,
  type LabConferenciaResultado,
  type Laboratorio,
} from "../../services/api";
import { Button, Card, Input, Label, Select, cn } from "../../components/ui/primitives";
import ModalLeituraRapidaQR from "../../components/ModalLeituraRapidaQR";
import { useAuth } from "../../hooks/useAuth";
import { useConfirm } from "../../components/ConfirmDialog";
import { useBackdropClose } from "../../hooks/useBackdropClose";

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function RecepcaoLab() {
  const { confirmar } = useConfirm();
  const { user } = useAuth();
  const [lista, setLista] = useState<SolicMestre[]>([]);
  const [total, setTotal] = useState(0);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");

  // Permissões e Perfil
  const isMasterAdmin = !user?.laboratorio_id || user?.is_superuser;
  const [laboratorios, setLaboratorios] = useState<Laboratorio[]>([]);
  const [filtroLab, setFiltroLab] = useState<string>("todos");

  // Filtros
  const [filtroStatus, setFiltroStatus] = useState<string>("todos");
  const [dataFiltro, setDataFiltro] = useState<string>(hojeISO());
  const [termoBusca, setTermoBusca] = useState("");

  // Carrega lista de laboratórios caso seja administrador
  useEffect(() => {
    if (isMasterAdmin) {
      labsListar().then(setLaboratorios).catch(() => {});
    }
  }, [isMasterAdmin]);

  // Modais
  const [modalLeituraQR, setModalLeituraQR] = useState(false);

  // Modal de Pedido de Ajuste (Divergência de Recepção)
  const [modalAjuste, setModalAjuste] = useState(false);
  const [itemAjuste, setItemAjuste] = useState<SolicMestre | null>(null);
  const [tipoAjuste, setTipoAjuste] = useState("divergencia_pedido");
  const [justificativaAjuste, setJustificativaAjuste] = useState("");
  const [enviandoAjuste, setEnviandoAjuste] = useState(false);

  // Modal de Upload de Laudo PDF
  const [modalUpload, setModalUpload] = useState(false);
  const [itemUpload, setItemUpload] = useState<SolicMestre | null>(null);
  const [arquivoUpload, setArquivoUpload] = useState<File | null>(null);
  const [processandoUpload, setProcessandoUpload] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Modal de Justificativa de Inconsistência
  const [modalInconsistencia, setModalInconsistencia] = useState(false);
  const [itemInconsistencia, setItemInconsistencia] = useState<SolicMestre | null>(null);
  const [dadosConferencia, setDadosConferencia] = useState<LabConferenciaResultado | null>(null);
  const [motivoInconsistencia, setMotivoInconsistencia] = useState("divergencia_nomenclatura");
  const [justificativaInconsistencia, setJustificativaInconsistencia] = useState("");
  const [enviandoInconsistencia, setEnviandoInconsistencia] = useState(false);

  // Fechamento Seguro e Proteção Dirty State dos Modais
  const backdropUpload = useBackdropClose({
    onClose: () => !processandoUpload && setModalUpload(false),
    modalAberto: modalUpload,
    isDirty: !!arquivoUpload,
  });

  const backdropInconsistencia = useBackdropClose({
    onClose: () => !enviandoInconsistencia && setModalInconsistencia(false),
    modalAberto: modalInconsistencia,
    isDirty: justificativaInconsistencia.trim().length > 0,
  });

  const backdropAjuste = useBackdropClose({
    onClose: () => !enviandoAjuste && setModalAjuste(false),
    modalAberto: modalAjuste,
    isDirty: justificativaAjuste.trim().length > 0,
  });

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
        laboratorio_id: filtroLab !== "todos" ? Number(filtroLab) : undefined,
        limit: 100,
      });
      const arr = pagData<any>(res);
      setLista(arr.map(mapMestre));
      const m = pagMeta(res);
      setTotal(m.total);
    } catch {
      setErro("Falha ao carregar lista de atendimentos do laboratório.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregar();
  }, [filtroStatus, dataFiltro, filtroLab]);

  // Busca inteligente com debounce
  useEffect(() => {
    const t = setTimeout(() => {
      carregar();
    }, 300);
    return () => clearTimeout(t);
  }, [termoBusca]);

  async function confirmarRecepcao(item: SolicMestre) {
    const confirmou = await confirmar({
      titulo: `Confirmar recepção e coleta`,
      descricao: `Deseja registrar a recepção e coleta dos exames laboratoriais de ${item.paciente_nome}?`,
      textoConfirmar: "Confirmar Coleta",
      variante: "primary",
    });
    if (!confirmou) return;
    try {
      const atualizado = await labRecepcionarColeta(item.id);
      setOk(`Coleta de ${item.paciente_nome} confirmada com sucesso!`);
      setLista((antiga) =>
        antiga.map((x) =>
          x.id === item.id
            ? { ...x, status: "coletado", coletado_em: atualizado.coletado_em, coletado_por: atualizado.coletado_por }
            : x
        )
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
      setErro("Por favor, preencha a justificativa detalhada da divergência (mínimo 8 caracteres).");
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
      setErro(e?.response?.data?.detail || "Erro ao registrar pedido de ajuste.");
    } finally {
      setEnviandoAjuste(false);
    }
  }

  // Abertura do Modal de Upload
  function abrirModalUpload(item: SolicMestre) {
    setItemUpload(item);
    setArquivoUpload(null);
    setModalUpload(true);
  }

  // Abertura do Modal de Justificativa
  function abrirModalJustificativa(item: SolicMestre, conf?: LabConferenciaResultado) {
    setItemInconsistencia(item);
    setDadosConferencia(conf || null);
    setMotivoInconsistencia("divergencia_nomenclatura");
    setJustificativaInconsistencia("");
    setModalInconsistencia(true);
  }

  // Submissão do Upload do Laudo PDF
  async function submeterUploadLaudo() {
    if (!itemUpload || !arquivoUpload) {
      setErro("Selecione um arquivo PDF de laudo para continuar.");
      return;
    }

    if (!arquivoUpload.name.toLowerCase().endsWith(".pdf")) {
      setErro("O arquivo deve estar no formato PDF (.pdf).");
      return;
    }

    setProcessandoUpload(true);
    setErro("");
    setOk("");

    try {
      const resp = await labUploadLaudo(itemUpload.id, arquivoUpload);
      setModalUpload(false);

      if (resp.novo_status_solicitacao === "realizado" || resp.status_conferencia === "aprovado_automatico" || resp.status_pedido === "realizado") {
        setOk(`✓ Laudo validado com sucesso! Exames de ${itemUpload.paciente_nome} conferidos e pedido marcado como REALIZADO.`);
        carregar();
      } else {
        // Inconsistência detectada: abre o modal de justificativa imediatamente
        setOk("Laudo enviado. Inconsistências identificadas necessitam de justificativa técnica do laboratório.");
        carregar();
        abrirModalJustificativa(itemUpload, resp.conferencia || resp);
      }
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Falha ao processar e conferir o laudo PDF.");
    } finally {
      setProcessandoUpload(false);
    }
  }

  // Submissão da Justificativa Técnica de Inconsistência
  async function submeterJustificativaInconsistencia() {
    if (!itemInconsistencia) return;
    if (justificativaInconsistencia.trim().length < 10) {
      setErro("A justificativa técnica deve conter no mínimo 10 caracteres explicativos.");
      return;
    }

    setEnviandoInconsistencia(true);
    setErro("");
    try {
      await labJustificarInconsistencia(itemInconsistencia.id, {
        motivo_inconsistencia: motivoInconsistencia,
        justificativa: justificativaInconsistencia.trim(),
      });
      setModalInconsistencia(false);
      setOk(`Justificativa para o laudo de ${itemInconsistencia.paciente_nome} enviada com sucesso! O pedido está em Revisão pela Secretaria.`);
      carregar();
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Erro ao registrar justificativa de inconsistência.");
    } finally {
      setEnviandoInconsistencia(false);
    }
  }

  function handleFileDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setArrastando(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const f = e.dataTransfer.files[0];
      if (f.name.toLowerCase().endsWith(".pdf")) {
        setArquivoUpload(f);
      } else {
        setErro("Apenas arquivos PDF são aceitos.");
      }
    }
  }

  return (
    <div className="space-y-5">
      {/* Topo do Módulo do Laboratório Conveniado */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal/15 text-teal">
              <FlaskConical className="h-5 w-5" />
            </span>
            <h2 className="font-display text-xl font-bold text-sus-950">
              Laboratório · Recepção, Coleta e Validação de Laudos
            </h2>
            <span className="rounded-full bg-teal/10 px-3 py-0.5 text-xs font-bold text-teal border border-teal/20">
              {carregando ? "Carregando..." : `${total} ${total === 1 ? "pedido filtrado" : "pedidos filtrados"}`}
            </span>
          </div>
          <p className="mt-1 text-xs text-ink/65">
            Módulo de conferência de pedidos, coleta e upload de laudos PDF com conferência automatizada via OCR/NLP.
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
        <div className="rounded-xl bg-red-50 p-3.5 text-sm font-medium text-red-700 flex items-center justify-between">
          <span>{erro}</span>
          <button onClick={() => setErro("")} className="text-red-500 hover:text-red-800">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {ok && (
        <div className="rounded-xl bg-teal/10 p-3.5 text-sm font-medium text-teal flex items-center justify-between">
          <span>{ok}</span>
          <button onClick={() => setOk("")} className="text-teal hover:opacity-75">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Barra de Filtros e Busca Rápida */}
      <Card className="p-3.5 sm:p-4 border-sus-900/10 shadow-xs">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-center">
          {/* Busca Inteligente */}
          <div className={isMasterAdmin ? "md:col-span-4 relative" : "md:col-span-5 relative"}>
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-teal" />
            <Input
              value={termoBusca}
              onChange={(e) => setTermoBusca(e.target.value)}
              placeholder="Buscar paciente, CPF, CNS, protocolo (#)..."
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

          {/* Filtro por Laboratório (somente Administradores com visão global) */}
          {isMasterAdmin && (
            <div className="md:col-span-3">
              <Select
                value={filtroLab}
                onChange={(e) => setFiltroLab(e.target.value)}
                className="!h-10 text-xs font-medium"
                title="Selecione o laboratório para filtrar"
              >
                <option value="todos">Todos os Laboratórios</option>
                {laboratorios.map((l) => (
                  <option key={l.id} value={String(l.id)}>
                    {l.nome}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {/* Filtro por Data */}
          <div className={isMasterAdmin ? "md:col-span-3 flex items-center gap-1.5" : "md:col-span-4 flex items-center gap-1.5"}>
            <Input
              type="date"
              value={dataFiltro}
              onChange={(e) => setDataFiltro(e.target.value)}
              className="!h-10 text-xs"
            />
            <Button
              type="button"
              onClick={() => setDataFiltro(hojeISO())}
              className={cn(
                "!h-10 px-3 text-xs shrink-0 font-bold transition",
                dataFiltro === hojeISO()
                  ? "bg-teal text-white hover:bg-teal-700 shadow-2xs"
                  : "border border-sus-900/15 bg-white text-ink hover:bg-sand"
              )}
              title="Filtrar exames de hoje"
            >
              Hoje
            </Button>
            {dataFiltro && (
              <button
                type="button"
                onClick={() => setDataFiltro("")}
                className="text-xs text-ink/50 hover:text-ink underline shrink-0 ml-1"
              >
                Limpar
              </button>
            )}
          </div>

          {/* Filtro por Status */}
          <div className={isMasterAdmin ? "md:col-span-2" : "md:col-span-3"}>
            <Select
              value={filtroStatus}
              onChange={(e) => setFiltroStatus(e.target.value)}
              className="!h-10 text-xs"
            >
              <option value="todos">Todos os status</option>
              <option value="agendado">Aguardando Coleta</option>
              <option value="coletado">Coletado / Aguard. Laudo</option>
              <option value="aguardando_conferencia">Inconsistência Laudo</option>
              <option value="em_revisao_secretaria">Em Revisão Secretaria</option>
              <option value="realizado">Concluído (Validado)</option>
            </Select>
          </div>
        </div>
      </Card>

      {/* Resumo de Pedidos Filtrados */}
      <div className="flex flex-wrap items-center justify-between text-xs text-ink/70 px-1 py-0.5 gap-2">
        <div className="flex items-center gap-2">
          <span>
            Total de pedidos filtrados: <strong className="text-sus-950 font-bold">{total}</strong>
          </span>
          {lista.length > 0 && lista.length < total && (
            <span className="text-ink/50 text-[11px]">
              (exibindo {lista.length} de {total})
            </span>
          )}
          {carregando && (
            <span className="text-teal font-semibold animate-pulse flex items-center gap-1 text-[11px]">
              <span className="inline-block h-2 w-2 rounded-full bg-teal animate-ping" />
              Atualizando lista…
            </span>
          )}
        </div>
        {(termoBusca.trim() || filtroStatus !== "todos" || dataFiltro || filtroLab !== "todos") && (
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="text-ink/50">Filtros ativos:</span>
            {termoBusca.trim() && (
              <span className="rounded bg-teal/10 px-1.5 py-0.5 text-teal font-semibold">
                Busca: "{termoBusca.trim()}"
              </span>
            )}
            {filtroStatus !== "todos" && (
              <span className="rounded bg-teal/10 px-1.5 py-0.5 text-teal font-semibold">
                Status: {filtroStatus}
              </span>
            )}
            {dataFiltro && (
              <span className="rounded bg-teal/10 px-1.5 py-0.5 text-teal font-semibold">
                Data: {dataFiltro}
              </span>
            )}
            {filtroLab !== "todos" && (
              <span className="rounded bg-teal/10 px-1.5 py-0.5 text-teal font-semibold">
                Lab: {laboratorios.find((l) => String(l.id) === filtroLab)?.nome || filtroLab}
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                setTermoBusca("");
                setFiltroStatus("todos");
                setDataFiltro("");
                setFiltroLab("todos");
              }}
              className="text-red-600 hover:underline font-semibold ml-1 cursor-pointer"
            >
              Limpar filtros
            </button>
          </div>
        )}
      </div>

      {/* Relação de Atendimentos */}
      {carregando ? (
        <div className="py-12 text-center text-ink/50">
          <div className="inline-block h-7 w-7 animate-spin rounded-full border-2 border-teal border-t-transparent mb-2" />
          <p className="text-xs font-medium">Carregando atendimentos do laboratório...</p>
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
            const st = (item.status || "").toLowerCase();
            const isAgendado = st === "agendado" || st === "solicitado";
            const isColetado = st === "coletado" || st === "recepcionado";
            const isAguardandoConf = st === "aguardando_conferencia";
            const isEmRevisao = st === "em_revisao_secretaria";
            const isRealizado = st === "realizado";

            return (
              <Card
                key={item.id}
                className={`p-3.5 sm:p-4 rounded-xl border-sus-900/10 shadow-xs flex flex-col justify-between transition ${
                  isRealizado
                    ? "bg-emerald-50/20 border-emerald-300/70"
                    : isEmRevisao
                    ? "bg-indigo-50/20 border-indigo-200"
                    : isAguardandoConf
                    ? "bg-amber-50/30 border-amber-300"
                    : isColetado
                    ? "bg-teal-50/20 border-teal-200/60"
                    : "hover:border-teal/30"
                }`}
              >
                <div>
                  {/* Cabeçalho Compacto do Card */}
                  <div className="flex items-start justify-between gap-2 border-b border-sus-900/10 pb-2.5 mb-2.5">
                    <div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <h3 className="font-bold text-sus-950 text-sm sm:text-base leading-tight">
                          {item.paciente_nome}
                        </h3>
                        {isMasterAdmin && item.laboratorio_nome && (
                          <span className="rounded bg-teal/10 text-teal px-1.5 py-0.5 text-[10px] font-bold border border-teal/20">
                            🏥 {item.laboratorio_nome}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-ink/65">
                        {item.paciente_cpf && <span>CPF: {item.paciente_cpf}</span>}
                        {item.paciente_cns && <span>CNS: {item.paciente_cns}</span>}
                        {item.paciente_prontuario && <span>Pront.: {item.paciente_prontuario}</span>}
                        {item.unidade_psf && (
                          <span className="rounded bg-sand px-1.5 py-0.5 font-medium text-sus-900 text-[10px]">
                            {item.unidade_psf}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="font-mono text-xs font-bold text-ink/50">#{item.id}</span>
                      <div>
                        {isRealizado ? (
                          <span className="mt-0.5 inline-block rounded px-1.5 py-0.5 text-[9px] font-bold uppercase bg-emerald-100 text-emerald-800 border border-emerald-300">
                            ✓ Realizado
                          </span>
                        ) : isEmRevisao ? (
                          <span className="mt-0.5 inline-block rounded px-1.5 py-0.5 text-[9px] font-bold uppercase bg-indigo-100 text-indigo-800 border border-indigo-200">
                            Revisão Sec.
                          </span>
                        ) : isAguardandoConf ? (
                          <span className="mt-0.5 inline-block rounded px-1.5 py-0.5 text-[9px] font-bold uppercase bg-amber-100 text-amber-800 border border-amber-300">
                            Inconsistência
                          </span>
                        ) : isColetado ? (
                          <span className="mt-0.5 inline-block rounded px-1.5 py-0.5 text-[9px] font-bold uppercase bg-teal/15 text-teal border border-teal/20">
                            Coletado
                          </span>
                        ) : (
                          <span className="mt-0.5 inline-block rounded px-1.5 py-0.5 text-[9px] font-bold uppercase bg-sand text-ink/65 border border-sus-900/10">
                            Aguardando Coleta
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Detalhes de Agendamento e Autoria */}
                  <div className="grid grid-cols-2 gap-2 text-xs mb-2.5 bg-sand/30 p-2 rounded-lg border border-sus-900/5">
                    <div>
                      <span className="text-[10px] text-ink/50 flex items-center gap-1">
                        <Calendar className="h-3 w-3 text-teal" /> Data Agendada
                      </span>
                      <span className="font-semibold text-sus-950 text-xs">
                        {item.data_agendada
                          ? item.data_agendada.split("-").reverse().join("/")
                          : "—"}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-ink/50 flex items-center gap-1">
                        <Clock className="h-3 w-3 text-teal" /> Horário Previsto
                      </span>
                      <span className="font-semibold text-sus-950 text-xs">
                        {item.hora_agendada || "07:00 às 09:00"}
                      </span>
                    </div>
                    <div className="col-span-2 flex flex-wrap items-center justify-between gap-1 text-[11px] pt-1 border-t border-sus-900/5">
                      {item.medico_solicitante ? (
                        <span className="text-ink/80">Dr(a). {item.medico_solicitante}</span>
                      ) : (
                        <span className="text-ink/40">Médico não especificado</span>
                      )}
                      <span className="text-[10px] text-ink/60">
                        Agendado por: <strong className="text-sus-950">{item.agendado_por_nome || item.agendado_por || "Sistema"}</strong>
                      </span>
                    </div>
                  </div>

                  {/* Procedimentos Solicitados (Compacto) */}
                  <div className="mb-2.5">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[10px] font-bold uppercase text-sus-900/70">
                        Procedimentos ({item.itens?.length || 0})
                      </p>
                      {item.jejum_horas && (
                        <span className="text-[10px] text-amber-800 font-medium">
                          ⏱️ Jejum: {item.jejum_horas}
                        </span>
                      )}
                    </div>
                    <div className="space-y-1">
                      {(item.itens || []).slice(0, 3).map((it: any, idx) => (
                        <div
                          key={idx}
                          className="text-xs text-ink/85 flex items-center justify-between border-b border-sus-900/5 pb-0.5"
                        >
                          <span className="truncate mr-2 text-[11px]">
                            <span className="font-mono text-[9px] text-ink/50 mr-1">
                              {it.codigo || it.procedimento_codigo}
                            </span>
                            {it.descricao || it.procedimento_descricao}
                          </span>
                          {it.quantidade > 1 && (
                            <span className="text-[9px] font-bold text-teal bg-teal/10 px-1 rounded">
                              ×{it.quantidade}
                            </span>
                          )}
                        </div>
                      ))}
                      {(item.itens || []).length > 3 && (
                        <p className="text-[10px] font-semibold text-teal pt-0.5">
                          + {(item.itens || []).length - 3} outro(s) procedimento(s)
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Informações de Coleta e Laudo */}
                  {item.coletado_em && (
                    <div className="rounded-lg bg-teal-50/80 p-1.5 text-[10px] text-teal-900 border border-teal-200 mb-2">
                      ✓ Coleta em <strong>{new Date(item.coletado_em).toLocaleString("pt-BR")}</strong>
                      {item.coletado_por && <span> por {item.coletado_por}</span>}.
                    </div>
                  )}

                  {isAguardandoConf && (
                    <div className="rounded-lg bg-amber-100/70 p-2.5 text-[11px] text-amber-900 border border-amber-300 mb-3 flex items-start gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <strong>Inconsistência identificada na leitura do laudo.</strong>
                        <p className="mt-0.5 text-amber-800">
                          O arquivo PDF foi carregado, mas há exames divergentes ou faltantes. O laboratório deve justificar para enviar à Secretaria.
                        </p>
                      </div>
                    </div>
                  )}

                  {isEmRevisao && (
                    <div className="rounded-lg bg-indigo-50 p-2.5 text-[11px] text-indigo-900 border border-indigo-200 mb-3 flex items-start gap-2">
                      <FileCheck className="h-4 w-4 text-indigo-600 shrink-0 mt-0.5" />
                      <div>
                        <strong>Em Auditoria pela Secretaria de Saúde.</strong>
                        <p className="mt-0.5 text-indigo-700">
                          Justificativa enviada. O laudo está na fila de revisão da regulação municipal.
                        </p>
                      </div>
                    </div>
                  )}

                  {isRealizado && (
                    <div className="rounded-lg bg-emerald-100/70 p-2.5 text-[11px] text-emerald-900 border border-emerald-300 mb-3 flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                        <span>Laudo Oficial conferido e vinculado ao Prontuário PEC.</span>
                      </div>
                      <a
                        href={labVisualizarLaudoPdfUrl(item.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded bg-white px-2 py-1 text-[11px] font-bold text-emerald-800 shadow-2xs hover:bg-emerald-50 border border-emerald-300"
                      >
                        <FileText className="h-3.5 w-3.5" /> Abrir PDF
                      </a>
                    </div>
                  )}
                </div>

                {/* Ações da Recepção / Laboratório */}
                <div className="flex flex-wrap items-center justify-end pt-3 border-t border-sus-900/10 gap-2">
                  {/* Status 1: Aguardando Coleta */}
                  {isAgendado && (
                    <>
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
                    </>
                  )}

                  {/* Status 2: Coletado (Aguardando Laudo) */}
                  {isColetado && (
                    <Button
                      type="button"
                      onClick={() => abrirModalUpload(item)}
                      className="!h-9 text-xs bg-teal hover:bg-teal/90 text-white font-bold flex items-center gap-1.5 shadow-xs"
                    >
                      <UploadCloud className="h-4 w-4" /> Upload Laudo PDF (Validação)
                    </Button>
                  )}

                  {/* Status 3: Aguardando Justificativa de Inconsistência */}
                  {isAguardandoConf && (
                    <>
                      <Button
                        type="button"
                        onClick={() => abrirModalUpload(item)}
                        className="border border-sus-900/15 bg-white text-ink hover:bg-sand !h-9 text-xs flex items-center gap-1"
                        title="Enviar outro PDF para reprocessamento"
                      >
                        <RefreshCw className="h-3.5 w-3.5" /> Reenviar PDF
                      </Button>

                      <Button
                        type="button"
                        onClick={() => abrirModalJustificativa(item)}
                        className="!h-9 text-xs bg-amber-600 hover:bg-amber-700 text-white font-bold flex items-center gap-1.5"
                      >
                        <AlertTriangle className="h-4 w-4" /> Justificar Inconsistências
                      </Button>
                    </>
                  )}

                  {/* Status 4: Em Revisão Secretaria */}
                  {isEmRevisao && (
                    <a
                      href={labVisualizarLaudoPdfUrl(item.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-900 hover:bg-indigo-100"
                    >
                      <Eye className="h-3.5 w-3.5" /> Ver Laudo Enviado
                    </a>
                  )}

                  {/* Status 5: Realizado */}
                  {isRealizado && (
                    <a
                      href={labVisualizarLaudoPdfUrl(item.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3.5 py-2 text-xs font-bold text-emerald-900 hover:bg-emerald-100 shadow-2xs"
                    >
                      <FileCheck className="h-4 w-4 text-emerald-700" /> Visualizar Laudo Oficial (PDF)
                    </a>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Modal 1: Upload de Laudo PDF com Leitura Automatizada */}
      {modalUpload && itemUpload && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-sus-950/60 p-3 sm:p-5"
          onMouseDown={backdropUpload.onMouseDown}
          onMouseUp={backdropUpload.onMouseUp}
          onClick={backdropUpload.onClick}
        >
          <div
            className="rise max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between border-b border-sus-900/10 pb-3">
              <div>
                <h3 className="font-display text-base font-bold text-sus-950 flex items-center gap-2">
                  <UploadCloud className="h-5 w-5 text-teal" />
                  Conferência Automatizada de Laudo (PDF)
                </h3>
                <p className="mt-0.5 text-xs text-ink/65">
                  Paciente: <strong>{itemUpload.paciente_nome}</strong> · Pedido #{itemUpload.id}
                </p>
              </div>
              <button
                type="button"
                disabled={processandoUpload}
                onClick={backdropUpload.fecharProtegido}
                className="rounded-xl p-2 text-ink/50 hover:bg-sand transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="rounded-xl bg-teal/5 p-3.5 border border-teal/20 text-teal-950 space-y-1">
                <p className="font-bold flex items-center gap-1.5">
                  <FlaskConical className="h-4 w-4 text-teal" />
                  Validação Cruzada de Procedimentos
                </p>
                <p className="text-[11px] text-ink/75 leading-relaxed">
                  O sistema extrairá o texto do laudo, cruzará os dados do paciente (Nome, CPF ou CNS) e verificará automaticamente se todos os {itemUpload.itens?.length || 0} exames solicitados estão presentes no documento.
                </p>
              </div>

              {/* Área de Drag & Drop */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setArrastando(true);
                }}
                onDragLeave={() => setArrastando(false)}
                onDrop={handleFileDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`cursor-pointer rounded-2xl border-2 border-dashed p-6 text-center transition ${
                  arrastando
                    ? "border-teal bg-teal/10"
                    : arquivoUpload
                    ? "border-emerald-500 bg-emerald-50/50"
                    : "border-sus-900/20 hover:border-teal/50 hover:bg-sand/30"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      setArquivoUpload(e.target.files[0]);
                    }
                  }}
                />

                {arquivoUpload ? (
                  <div className="flex flex-col items-center gap-2">
                    <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                      <FileCheck className="h-6 w-6" />
                    </span>
                    <p className="font-bold text-sm text-emerald-950">{arquivoUpload.name}</p>
                    <p className="text-[11px] text-emerald-800">
                      {(arquivoUpload.size / 1024).toFixed(1)} KB · Arquivo PDF pronto para conferência
                    </p>
                    <span className="text-[10px] text-ink/50 underline mt-1">Clique para escolher outro arquivo</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-teal/10 text-teal">
                      <FileUp className="h-6 w-6" />
                    </span>
                    <p className="font-bold text-sm text-sus-950">
                      Arraste e solte o arquivo PDF do laudo aqui
                    </p>
                    <p className="text-[11px] text-ink/55">
                      ou clique para selecionar do computador (Máx 15MB)
                    </p>
                  </div>
                )}
              </div>

              {processandoUpload && (
                <div className="rounded-xl bg-sand p-3.5 text-center space-y-2">
                  <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-teal border-t-transparent" />
                  <p className="font-bold text-sus-950 text-xs">Processando documento...</p>
                  <p className="text-[11px] text-ink/65">
                    Extraindo texto, validando CPF/CNS e cruzando nomenclaturas clínicas dos exames.
                  </p>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-sus-900/10">
                <Button
                  type="button"
                  disabled={processandoUpload}
                  onClick={() => setModalUpload(false)}
                  className="border border-sus-900/15 bg-white text-ink hover:bg-sand"
                >
                  Cancelar
                </Button>
                <Button
                  onClick={submeterUploadLaudo}
                  disabled={!arquivoUpload || processandoUpload}
                  className="bg-teal hover:bg-teal/90 text-white font-bold"
                >
                  {processandoUpload ? "Validando Laudo..." : "Processar e Validar Laudo"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: Inconsistência Detectada e Justificativa Técnica Obrigatória */}
      {modalInconsistencia && itemInconsistencia && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-sus-950/60 p-3 sm:p-5"
          onMouseDown={backdropInconsistencia.onMouseDown}
          onMouseUp={backdropInconsistencia.onMouseUp}
          onClick={backdropInconsistencia.onClick}
        >
          <div
            className="rise max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between border-b border-sus-900/10 pb-3">
              <div>
                <h3 className="font-display text-base font-bold text-rose-950 flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-rose-600" />
                  Inconsistência Detectada no Laudo
                </h3>
                <p className="mt-0.5 text-xs text-ink/65">
                  Paciente: <strong>{itemInconsistencia.paciente_nome}</strong> · Pedido #{itemInconsistencia.id}
                </p>
              </div>
              <button
                type="button"
                disabled={enviandoInconsistencia}
                onClick={backdropInconsistencia.fecharProtegido}
                className="rounded-xl p-2 text-ink/50 hover:bg-sand transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Alerta de Match do Paciente */}
              {dadosConferencia && (
                <div
                  className={`p-3.5 rounded-xl border ${
                    dadosConferencia.match_paciente_ok
                      ? "bg-emerald-50 border-emerald-200 text-emerald-950"
                      : "bg-red-50 border-red-200 text-red-950"
                  }`}
                >
                  <p className="font-bold flex items-center gap-1.5 text-xs">
                    {dadosConferencia.match_paciente_ok ? (
                      <>
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        Identificação do Paciente Confirmada no Laudo
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="h-4 w-4 text-red-600" />
                        Atenção Crítica: Paciente não identificado com certeza no cabeçalho do laudo!
                      </>
                    )}
                  </p>
                  <p className="text-[11px] mt-1 leading-relaxed opacity-90">
                    {dadosConferencia.detalhes_paciente || dadosConferencia.paciente_criterio_match || dadosConferencia.mensagem}
                  </p>
                </div>
              )}

              {/* Quadro comparativo de exames */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                {/* Exames Encontrados */}
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 space-y-1.5">
                  <p className="font-bold text-[11px] uppercase text-emerald-900 flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    Encontrados ({dadosConferencia?.exames_encontrados?.length || 0})
                  </p>
                  <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                    {(dadosConferencia?.exames_encontrados || []).map((ex, i) => (
                      <div key={i} className="text-[11px] bg-white p-1.5 rounded border border-emerald-100 text-emerald-900">
                        {typeof ex === "string" ? ex : (ex as any).descricao || (ex as any).nome}
                      </div>
                    ))}
                    {(!dadosConferencia || dadosConferencia.exames_encontrados.length === 0) && (
                      <p className="text-[11px] text-ink/40 italic">Nenhum exame correspondente.</p>
                    )}
                  </div>
                </div>

                {/* Exames Faltantes */}
                <div className="rounded-xl border border-red-200 bg-red-50/50 p-3 space-y-1.5">
                  <p className="font-bold text-[11px] uppercase text-red-900 flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5 text-red-600" />
                    Faltantes ({dadosConferencia?.exames_faltantes?.length || 0})
                  </p>
                  <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                    {(dadosConferencia?.exames_faltantes || []).map((ex, i) => (
                      <div key={i} className="text-[11px] bg-white p-1.5 rounded border border-red-200 text-red-900 font-medium">
                        {typeof ex === "string" ? ex : (ex as any).descricao || (ex as any).nome}
                      </div>
                    ))}
                    {(!dadosConferencia || dadosConferencia.exames_faltantes.length === 0) && (
                      <p className="text-[11px] text-ink/40 italic">Nenhum exame faltante.</p>
                    )}
                  </div>
                </div>

                {/* Exames Adicionais / Particulares */}
                <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 space-y-1.5">
                  <p className="font-bold text-[11px] uppercase text-amber-900 flex items-center gap-1">
                    <FileText className="h-3.5 w-3.5 text-amber-600" />
                    Adicionais ({dadosConferencia?.exames_adicionais?.length || 0})
                  </p>
                  <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                    {(dadosConferencia?.exames_adicionais || []).map((ex, i) => (
                      <div key={i} className="text-[11px] bg-white p-1.5 rounded border border-amber-200 text-amber-900">
                        {ex}
                      </div>
                    ))}
                    {(!dadosConferencia || dadosConferencia.exames_adicionais.length === 0) && (
                      <p className="text-[11px] text-ink/40 italic">Nenhum exame adicional.</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Formulário de Justificativa */}
              <div className="space-y-3 pt-2">
                <div>
                  <Label>Motivo Clínico / Técnico da Inconsistência *</Label>
                  <Select
                    value={motivoInconsistencia}
                    onChange={(e) => setMotivoInconsistencia(e.target.value)}
                  >
                    <option value="divergencia_nomenclatura">
                      Divergência de nomenclatura técnica / sinonímia de laboratório
                    </option>
                    <option value="exame_cancelado_clinico">
                      Exame cancelado por condição clínica / jejum inadequado / amostra insuficiente
                    </option>
                    <option value="laudo_parcial_cultura">
                      Laudo parcial / cultura microbiológica ou sorologia com prazo estendido
                    </option>
                    <option value="particular_associado">
                      Exames adicionais realizados de forma particular pelo paciente
                    </option>
                    <option value="divergencia_dados_paciente">
                      Divergência em dados cadastrais (nome social / casado / digitação)
                    </option>
                    <option value="outro">Outro motivo técnico / justificativa clínica</option>
                  </Select>
                </div>

                <div>
                  <Label>Justificativa Detalhada para a Secretaria de Saúde *</Label>
                  <textarea
                    rows={4}
                    value={justificativaInconsistencia}
                    onChange={(e) => setJustificativaInconsistencia(e.target.value)}
                    placeholder="Explique tecnicamente os exames ausentes ou adicionais para que o auditor da Secretaria de Saúde possa avaliar a liberação..."
                    className="w-full rounded-xl border border-sus-900/15 bg-white p-3 text-sm text-ink outline-none focus:border-teal"
                  />
                  <p className="mt-1 text-[11px] text-ink/50">
                    O pedido entrará na fila de "Revisão da Secretaria" e só será concluído após aprovação do auditor.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-sus-900/10">
                <Button
                  type="button"
                  disabled={enviandoInconsistencia}
                  onClick={() => setModalInconsistencia(false)}
                  className="border border-sus-900/15 bg-white text-ink hover:bg-sand"
                >
                  Cancelar
                </Button>
                <Button
                  onClick={submeterJustificativaInconsistencia}
                  disabled={enviandoInconsistencia || justificativaInconsistencia.trim().length < 10}
                  className="bg-amber-600 hover:bg-amber-700 text-white font-bold"
                >
                  {enviandoInconsistencia ? "Submetendo..." : "Enviar Justificativa para a Secretaria"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal 3: Pedido de Ajuste Inicial de Recepção */}
      {modalAjuste && itemAjuste && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-sus-950/60 p-3 sm:p-5"
          onMouseDown={backdropAjuste.onMouseDown}
          onMouseUp={backdropAjuste.onMouseUp}
          onClick={backdropAjuste.onClick}
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
                onClick={backdropAjuste.fecharProtegido}
                className="rounded-xl p-2 text-ink/50 hover:bg-sand transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <Label>Motivo / Tipo de Divergência *</Label>
                <Select
                  value={tipoAjuste}
                  onChange={(e) => setTipoAjuste(e.target.value)}
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
                </Select>
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
