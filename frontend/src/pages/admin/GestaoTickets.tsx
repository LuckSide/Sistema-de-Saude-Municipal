import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Bug,
  CheckCircle2,
  Clock,
  Compass,
  CornerDownRight,
  Filter,
  HelpCircle,
  LifeBuoy,
  Lightbulb,
  Loader2,
  MessageSquare,
  RefreshCw,
  Search,
  User,
  X,
} from "lucide-react";
import {
  atualizarStatusTicket,
  listarTicketsSuporte,
  msgErro,
  type TicketSuporte,
} from "../../services/api";
import { useConfirm } from "../../components/ConfirmDialog";

const TIPO_INFO: Record<
  string,
  { label: string; icon: typeof Bug; cor: string; badgeCor: string }
> = {
  bug: {
    label: "Bug no site",
    icon: Bug,
    cor: "text-red-600",
    badgeCor: "bg-red-50 text-red-700 border border-red-200",
  },
  info_incorreta: {
    label: "Informação incorreta",
    icon: AlertTriangle,
    cor: "text-amber-600",
    badgeCor: "bg-amber-50 text-amber-700 border border-amber-200",
  },
  nova_funcionalidade: {
    label: "Nova funcionalidade",
    icon: Lightbulb,
    cor: "text-purple-600",
    badgeCor: "bg-purple-50 text-purple-700 border border-purple-200",
  },
  duvida: {
    label: "Dúvida / Outro",
    icon: HelpCircle,
    cor: "text-teal",
    badgeCor: "bg-teal/10 text-teal border border-teal/20",
  },
  outro: {
    label: "Outro",
    icon: HelpCircle,
    cor: "text-slate-600",
    badgeCor: "bg-slate-100 text-slate-700 border border-slate-200",
  },
};

const STATUS_INFO: Record<
  string,
  { label: string; badgeCor: string; icon: typeof Clock }
> = {
  aberto: {
    label: "Aberto",
    badgeCor: "bg-rose-50 text-rose-700 border border-rose-200",
    icon: AlertCircle,
  },
  em_analise: {
    label: "Em Análise",
    badgeCor: "bg-blue-50 text-blue-700 border border-blue-200",
    icon: Clock,
  },
  resolvido: {
    label: "Resolvido",
    badgeCor: "bg-emerald-50 text-emerald-700 border border-emerald-200",
    icon: CheckCircle2,
  },
};

export default function GestaoTickets() {
  const { confirmar } = useConfirm();
  const [tickets, setTickets] = useState<TicketSuporte[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  // Filtros
  const [filtroStatus, setFiltroStatus] = useState<string>("todos");
  const [filtroTipo, setFiltroTipo] = useState<string>("todos");
  const [busca, setBusca] = useState<string>("");

  // Modal de resolução com resposta
  const [ticketParaResolver, setTicketParaResolver] = useState<TicketSuporte | null>(null);
  const [respostaAdmin, setRespostaAdmin] = useState("");
  const [salvandoStatus, setSalvandoStatus] = useState(false);

  const carregarTickets = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const data = await listarTicketsSuporte({
        tipo: filtroTipo !== "todos" ? filtroTipo : undefined,
        status: filtroStatus !== "todos" ? filtroStatus : undefined,
      });
      setTickets(data);
    } catch (err) {
      setErro(msgErro(err, "Falha ao carregar lista de chamados."));
    } finally {
      setCarregando(false);
    }
  }, [filtroStatus, filtroTipo]);

  useEffect(() => {
    carregarTickets();
  }, [carregarTickets]);

  // Contadores
  const contadores = useMemo(() => {
    const total = tickets.length;
    const abertos = tickets.filter((t) => t.status === "aberto").length;
    const emAnalise = tickets.filter((t) => t.status === "em_analise").length;
    const resolvidos = tickets.filter((t) => t.status === "resolvido").length;
    return { total, abertos, emAnalise, resolvidos };
  }, [tickets]);

  // Tickets filtrados pela busca textual
  const ticketsExibidos = useMemo(() => {
    if (!busca.trim()) return tickets;
    const termo = busca.toLowerCase();
    return tickets.filter(
      (t) =>
        t.usuario_nome.toLowerCase().includes(termo) ||
        t.descricao.toLowerCase().includes(termo) ||
        t.pagina_url.toLowerCase().includes(termo) ||
        (t.resposta_admin && t.resposta_admin.toLowerCase().includes(termo))
    );
  }, [tickets, busca]);

  async function handleConfirmarResolucao(e: React.FormEvent) {
    e.preventDefault();
    if (!ticketParaResolver) return;

    setSalvandoStatus(true);
    try {
      const atualizado = await atualizarStatusTicket(ticketParaResolver.id, {
        status: "resolvido",
        resposta_admin: respostaAdmin.trim() || undefined,
      });
      setTickets((prev) =>
        prev.map((t) => (t.id === atualizado.id ? atualizado : t))
      );
      setTicketParaResolver(null);
      setRespostaAdmin("");
    } catch (err) {
      alert(msgErro(err, "Erro ao marcar chamado como resolvido."));
    } finally {
      setSalvandoStatus(false);
    }
  }

  async function handleMudarStatusDireto(
    ticket: TicketSuporte,
    novoStatus: "aberto" | "em_analise"
  ) {
    const textoAcao =
      novoStatus === "em_analise"
        ? "Colocar chamado em análise?"
        : "Reabrir chamado para pendente?";
    const ok = await confirmar({
      titulo: textoAcao,
      descricao: `O chamado #${ticket.id} (${ticket.usuario_nome}) terá o status alterado para "${novoStatus}".`,
      textoConfirmar: "Confirmar alteração",
      variante: "primary",
    });

    if (!ok) return;

    try {
      const atualizado = await atualizarStatusTicket(ticket.id, {
        status: novoStatus,
      });
      setTickets((prev) =>
        prev.map((t) => (t.id === atualizado.id ? atualizado : t))
      );
    } catch (err) {
      alert(msgErro(err, "Erro ao atualizar status do chamado."));
    }
  }

  function formatarData(dataStr?: string | null): string {
    if (!dataStr) return "-";
    try {
      const d = new Date(dataStr);
      return d.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dataStr;
    }
  }

  return (
    <div className="space-y-6">
      {/* Topo / Cabeçalho */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <div className="rounded-xl bg-teal/10 p-2 text-teal">
              <LifeBuoy className="h-6 w-6" />
            </div>
            <h1 className="font-display text-2xl font-bold text-sus-900">
              Tickets de Suporte & Feedback
            </h1>
          </div>
          <p className="mt-1 text-xs text-sus-900/60">
            Painel administrativo para análise e resolução de problemas, bugs e pedidos dos usuários
          </p>
        </div>
        <button
          onClick={carregarTickets}
          disabled={carregando}
          className="inline-flex items-center gap-2 self-start rounded-xl border border-sus-900/15 bg-white px-3.5 py-2 text-xs font-semibold text-sus-900 shadow-xs hover:bg-sus-50 transition-colors"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${carregando ? "animate-spin" : ""}`} />
          <span>Atualizar</span>
        </button>
      </div>

      {/* Cards de Métricas / Contadores */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-sus-900/10 bg-white p-4 shadow-card">
          <p className="font-display text-xs font-semibold uppercase tracking-wide text-sus-900/60">
            Total Carregado
          </p>
          <p className="mt-1 font-display text-2xl font-bold text-sus-900">
            {contadores.total}
          </p>
        </div>
        <div className="rounded-2xl border border-rose-200 bg-rose-50/50 p-4 shadow-card">
          <p className="font-display text-xs font-semibold uppercase tracking-wide text-rose-700">
            Abertos / Pendentes
          </p>
          <p className="mt-1 font-display text-2xl font-bold text-rose-700">
            {contadores.abertos}
          </p>
        </div>
        <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-4 shadow-card">
          <p className="font-display text-xs font-semibold uppercase tracking-wide text-blue-700">
            Em Análise
          </p>
          <p className="mt-1 font-display text-2xl font-bold text-blue-700">
            {contadores.emAnalise}
          </p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 shadow-card">
          <p className="font-display text-xs font-semibold uppercase tracking-wide text-emerald-700">
            Resolvidos
          </p>
          <p className="mt-1 font-display text-2xl font-bold text-emerald-700">
            {contadores.resolvidos}
          </p>
        </div>
      </div>

      {/* Barra de Filtros */}
      <div className="rounded-2xl border border-sus-900/10 bg-white p-4 shadow-card space-y-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          {/* Filtro por Status */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold text-sus-900/70 mr-1 flex items-center gap-1">
              <Filter className="h-3.5 w-3.5" /> Status:
            </span>
            {[
              { id: "todos", label: "Todos" },
              { id: "aberto", label: "Abertos" },
              { id: "em_analise", label: "Em Análise" },
              { id: "resolvido", label: "Resolvidos" },
            ].map((st) => (
              <button
                key={st.id}
                onClick={() => setFiltroStatus(st.id)}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                  filtroStatus === st.id
                    ? "bg-sus-950 text-white"
                    : "bg-sus-50 text-sus-900/70 hover:bg-sus-100"
                }`}
              >
                {st.label}
              </button>
            ))}
          </div>

          {/* Busca textual */}
          <div className="relative w-full md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-sus-900/40" />
            <input
              type="text"
              placeholder="Buscar em chamados…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="w-full rounded-xl border border-sus-900/15 bg-white pl-9 pr-3 py-1.5 text-xs text-sus-900 placeholder:text-sus-900/40 focus:border-sus-700 focus:outline-none"
            />
            {busca && (
              <button
                onClick={() => setBusca("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sus-900/40 hover:text-sus-900"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* Filtro por Tipo */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-sus-900/5">
          <span className="text-xs font-semibold text-sus-900/70 mr-1">Tipo:</span>
          {[
            { id: "todos", label: "Todos os Tipos" },
            { id: "bug", label: "Bug no site" },
            { id: "info_incorreta", label: "Informação incorreta" },
            { id: "nova_funcionalidade", label: "Nova funcionalidade" },
            { id: "duvida", label: "Dúvida / Outro" },
          ].map((tp) => (
            <button
              key={tp.id}
              onClick={() => setFiltroTipo(tp.id)}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                filtroTipo === tp.id
                  ? "bg-teal text-sus-950"
                  : "bg-sus-50 text-sus-900/70 hover:bg-sus-100"
              }`}
            >
              {tp.label}
            </button>
          ))}
        </div>
      </div>

      {/* Erro */}
      {erro && (
        <div className="flex items-center gap-2 rounded-xl bg-red-50 p-4 text-xs text-red-700 border border-red-200">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
          <span>{erro}</span>
        </div>
      )}

      {/* Listagem de Chamados */}
      {carregando ? (
        <div className="flex min-h-[30vh] items-center justify-center p-8">
          <div className="flex flex-col items-center gap-3 text-sus-900/60">
            <Loader2 className="h-8 w-8 animate-spin text-teal" />
            <span className="text-xs font-medium">Carregando chamados de suporte…</span>
          </div>
        </div>
      ) : ticketsExibidos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-sus-900/20 bg-white/50 p-12 text-center">
          <LifeBuoy className="mx-auto h-10 w-10 text-sus-900/30" />
          <h3 className="mt-3 font-display text-sm font-bold text-sus-900">
            Nenhum chamado encontrado
          </h3>
          <p className="mt-1 text-xs text-sus-900/60 max-w-sm mx-auto">
            Não há tickets cadastrados correspondentes aos filtros selecionados no momento.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {ticketsExibidos.map((ticket) => {
            const tipoConfig = TIPO_INFO[ticket.tipo] || TIPO_INFO.outro;
            const statusConfig = STATUS_INFO[ticket.status] || STATUS_INFO.aberto;
            const TipoIcone = tipoConfig.icon;
            const StatusIcone = statusConfig.icon;

            return (
              <div
                key={ticket.id}
                className="overflow-hidden rounded-2xl border border-sus-900/10 bg-white p-5 shadow-card transition-shadow hover:shadow-md"
              >
                {/* Linha superior: Badges, ID e Usuário */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sus-900/5 pb-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Badge Tipo */}
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${tipoConfig.badgeCor}`}
                    >
                      <TipoIcone className="h-3.5 w-3.5" />
                      {tipoConfig.label}
                    </span>

                    {/* Badge Status */}
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${statusConfig.badgeCor}`}
                    >
                      <StatusIcone className="h-3.5 w-3.5" />
                      {statusConfig.label}
                    </span>

                    <span className="font-mono text-xs font-semibold text-sus-900/40">
                      #{ticket.id}
                    </span>
                  </div>

                  <div className="flex items-center gap-4 text-xs text-sus-900/60">
                    <span className="flex items-center gap-1">
                      <User className="h-3.5 w-3.5 text-sus-900/40" />
                      <strong className="text-sus-900 font-semibold">{ticket.usuario_nome}</strong>
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5 text-sus-900/40" />
                      {formatarData(ticket.criado_em)}
                    </span>
                  </div>
                </div>

                {/* Conteúdo: Tela onde estava e descrição */}
                <div className="mt-3.5 space-y-3">
                  {/* Página capturada */}
                  {ticket.pagina_url && (
                    <div className="flex items-center gap-2 text-xs text-sus-900/70">
                      <Compass className="h-3.5 w-3.5 shrink-0 text-sus-900/40" />
                      <span className="font-semibold text-sus-900/80">Tela capturada:</span>
                      <code className="rounded bg-sand px-2 py-0.5 font-mono text-[11px] text-sus-900 border border-sus-900/10">
                        {ticket.pagina_url}
                      </code>
                    </div>
                  )}

                  {/* Descrição */}
                  <div className="rounded-xl bg-sand/40 p-3.5 border border-sus-900/5 text-xs text-sus-900 leading-relaxed whitespace-pre-wrap">
                    {ticket.descricao}
                  </div>

                  {/* Resposta / Resolução Admin */}
                  {ticket.status === "resolvido" && (
                    <div className="rounded-xl bg-emerald-50/70 border border-emerald-200/60 p-3.5 text-xs text-emerald-950 space-y-1">
                      <div className="flex items-center justify-between font-semibold text-emerald-800">
                        <span className="flex items-center gap-1.5">
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                          Resolvido por {ticket.resolvido_por || "Administrador"}
                        </span>
                        <span className="text-[11px] font-normal text-emerald-700">
                          {formatarData(ticket.resolvido_em)}
                        </span>
                      </div>
                      {ticket.resposta_admin && (
                        <p className="mt-1 text-emerald-900 pl-5 border-l-2 border-emerald-300">
                          {ticket.resposta_admin}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Ações Administrativas */}
                <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-sus-900/5 pt-3">
                  {ticket.status !== "resolvido" ? (
                    <>
                      {ticket.status !== "em_analise" && (
                        <button
                          onClick={() => handleMudarStatusDireto(ticket, "em_analise")}
                          className="rounded-xl border border-sus-900/15 bg-white px-3 py-1.5 text-xs font-semibold text-sus-900 hover:bg-sus-50 transition-colors"
                        >
                          Colocar em Análise
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setTicketParaResolver(ticket);
                          setRespostaAdmin("");
                        }}
                        className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 transition-colors"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>Marcar como Resolvido</span>
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => handleMudarStatusDireto(ticket, "aberto")}
                      className="rounded-xl border border-sus-900/15 bg-white px-3 py-1.5 text-xs font-semibold text-sus-900 hover:bg-sus-50 transition-colors"
                    >
                      Reabrir Chamado
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal para Adicionar Resposta e Marcar como Resolvido */}
      {ticketParaResolver && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in duration-150"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/10">
            <div className="flex items-center justify-between border-b border-slate-100 bg-emerald-700 px-6 py-4 text-white">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5" />
                <h3 className="font-display text-base font-bold text-white">
                  Concluir e Resolver Chamado #{ticketParaResolver.id}
                </h3>
              </div>
              <button
                onClick={() => setTicketParaResolver(null)}
                disabled={salvandoStatus}
                className="rounded-lg p-1 text-white/70 hover:bg-white/10 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmarResolucao} className="p-6 space-y-4">
              <div>
                <p className="text-xs text-slate-600">
                  Você está marcando este chamado de{" "}
                  <strong>{ticketParaResolver.usuario_nome}</strong> como resolvido.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                  Resposta / Resolução (opcional)
                </label>
                <textarea
                  rows={3}
                  value={respostaAdmin}
                  onChange={(e) => setRespostaAdmin(e.target.value)}
                  placeholder="Ex: Corrigido na atualização. A opção já está visível novamente."
                  className="w-full rounded-xl border border-slate-300 p-3 text-xs text-slate-800 placeholder-slate-400 focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600"
                  disabled={salvandoStatus}
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setTicketParaResolver(null)}
                  disabled={salvandoStatus}
                  className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvandoStatus}
                  className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 transition-colors"
                >
                  {salvandoStatus ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Salvando…</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      <span>Confirmar Resolução</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
