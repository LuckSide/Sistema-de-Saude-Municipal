import { useEffect, useState, useRef } from "react";
import { useParams } from "react-router-dom";
import {
  Pill,
  Search,
  CheckCircle2,
  AlertCircle,
  Clock,
  Tv,
  Smartphone,
  Maximize2,
  Minimize2,
  RefreshCw,
  FileText,
  Building2,
  ShieldAlert,
} from "lucide-react";
import {
  farmaciaConsultarPublico,
  type FarmaciaPainelPublicoResponse,
  type ItemDisponibilidadePublicaOut,
} from "../../services/api";

export default function FarmaciaPainelPublico() {
  const { token } = useParams<{ token: string }>();
  const [painel, setPainel] = useState<FarmaciaPainelPublicoResponse | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");
  const [categoriaFiltro, setCategoriaFiltro] = useState("");
  const [relogio, setRelogio] = useState<string>("");
  const [segundosParaRefresh, setSegundosParaRefresh] = useState<number>(30);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const timerRef = useRef<number | null>(null);
  const clockRef = useRef<number | null>(null);

  // Consulta dados do painel público
  async function carregarPainel(silencioso = false) {
    if (!token) return;
    if (!silencioso) setCarregando(true);
    setErro("");
    try {
      const dados = await farmaciaConsultarPublico(token);
      setPainel(dados);
      setSegundosParaRefresh(dados.tempo_atualizacao_segundos || 30);
    } catch {
      setErro("Este painel de consulta está indisponível, foi revogado ou o link expirou.");
    } finally {
      if (!silencioso) setCarregando(false);
    }
  }

  // Relógio ao vivo
  useEffect(() => {
    function atualizarRelogio() {
      const agora = new Date();
      setRelogio(
        agora.toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
    }
    atualizarRelogio();
    clockRef.current = window.setInterval(atualizarRelogio, 1000);
    return () => {
      if (clockRef.current) clearInterval(clockRef.current);
    };
  }, []);

  // Carga inicial
  useEffect(() => {
    carregarPainel();
  }, [token]);

  // Contagem regressiva e auto-refresh
  useEffect(() => {
    if (!painel) return;

    timerRef.current = window.setInterval(() => {
      setSegundosParaRefresh((prev) => {
        if (prev <= 1) {
          carregarPainel(true);
          return painel.tempo_atualizacao_segundos || 30;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [painel?.tempo_atualizacao_segundos, token]);

  // Fullscreen toggle
  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  }

  useEffect(() => {
    function handleFsChange() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener("fullscreenchange", handleFsChange);
    return () => document.removeEventListener("fullscreenchange", handleFsChange);
  }, []);

  // Filtragem local dos itens
  const itens = painel?.itens || [];
  const filtrados = itens.filter((m) => {
    if (categoriaFiltro && m.categoria !== categoriaFiltro) return false;
    if (busca.trim()) {
      const t = busca.toLowerCase();
      const matchNome = m.nome.toLowerCase().includes(t);
      const matchPrincipio = (m.principio_ativo || "").toLowerCase().includes(t);
      return matchNome || matchPrincipio;
    }
    return true;
  });

  const categoriasUnicas = Array.from(new Set(itens.map((i) => i.categoria).filter(Boolean)));

  // Estado de Erro
  if (erro) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-sus-50 p-6">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-lg border border-sus-100">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-100 text-red-600 mb-4">
            <ShieldAlert className="h-8 w-8" />
          </div>
          <h2 className="text-xl font-bold text-sus-900">Painel Indisponível</h2>
          <p className="mt-2 text-sm text-sus-900/60 leading-relaxed">{erro}</p>
          <div className="mt-6 border-t border-sus-100 pt-4 text-xs text-sus-900/40">
            Prefeitura Municipal · Secretaria Municipal de Saúde
          </div>
        </div>
      </div>
    );
  }

  // Estado de Carregamento inicial
  if (carregando || !painel) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-sus-50 p-6 text-sus-900">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-teal border-t-transparent" />
          <span className="text-sm font-semibold">Carregando painel de disponibilidade…</span>
        </div>
      </div>
    );
  }

  // ==========================================
  // RENDERIZAÇÃO: MODO TV (SALA DE ESPERA)
  // ==========================================
  if (painel.tipo_perfil === "tv") {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col justify-between selection:bg-teal selection:text-white">
        {/* Topo / Header da TV */}
        <header className="border-b border-slate-800 bg-slate-900/90 px-8 py-4 backdrop-blur">
          <div className="flex items-center justify-between">
            {/* Brasão / Identificação */}
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-teal/20 text-teal border border-teal/40">
                <Pill className="h-6 w-6" />
              </div>
              <div>
                <span className="text-xs uppercase tracking-widest text-teal font-extrabold">
                  SUS · Secretaria Municipal de Saúde
                </span>
                <h1 className="text-2xl font-black tracking-tight text-white">{painel.titulo}</h1>
              </div>
            </div>

            {/* Relógio Dinâmico & Indicador de Atualização */}
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2 rounded-xl bg-slate-800/80 px-4 py-2 border border-slate-700">
                <Clock className="h-5 w-5 text-teal" />
                <span className="font-mono text-2xl font-bold tracking-wider text-teal">
                  {relogio}
                </span>
              </div>

              {/* Contagem regressiva de refresh */}
              <div className="hidden sm:flex flex-col items-end text-xs text-slate-400">
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
                  <span className="font-semibold text-slate-300">Ao Vivo</span>
                </div>
                <span>Atualiza em {segundosParaRefresh}s</span>
              </div>

              {/* Botão Tela Cheia */}
              <button
                onClick={toggleFullscreen}
                className="rounded-xl bg-slate-800 p-2.5 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
                title={isFullscreen ? "Sair da Tela Cheia" : "Tela Cheia"}
              >
                {isFullscreen ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
              </button>
            </div>
          </div>

          {/* Cards de Métricas na TV */}
          <div className="mt-4 grid grid-cols-3 gap-4">
            <div className="rounded-xl bg-slate-800/50 p-3 border border-slate-800">
              <div className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
                Total de Medicamentos
              </div>
              <div className="mt-1 text-2xl font-black text-white">{painel.total_itens}</div>
            </div>

            <div className="rounded-xl bg-emerald-950/40 p-3 border border-emerald-900/50">
              <div className="text-xs uppercase tracking-wider text-emerald-400 font-semibold">
                Disponíveis no Estoque
              </div>
              <div className="mt-1 text-2xl font-black text-emerald-300">
                {painel.total_disponiveis}
              </div>
            </div>

            <div className="rounded-xl bg-rose-950/40 p-3 border border-rose-900/50">
              <div className="text-xs uppercase tracking-wider text-rose-400 font-semibold">
                Temporariamente em Falta
              </div>
              <div className="mt-1 text-2xl font-black text-rose-300">
                {painel.total_indisponiveis}
              </div>
            </div>
          </div>
        </header>

        {/* Conteúdo Principal da TV: Grid de Itens em Alta Definição */}
        <main className="flex-1 p-8 overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {painel.itens.map((item) => (
              <div
                key={item.id}
                className={`flex items-center justify-between rounded-2xl p-4 border transition-all ${
                  item.disponivel
                    ? "bg-slate-900/80 border-slate-800 hover:border-slate-700"
                    : "bg-slate-900/40 border-rose-950/40 opacity-75"
                }`}
              >
                <div className="flex-1 pr-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-teal">
                      {item.categoria}
                    </span>
                    {item.requer_receita && (
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400 font-medium">
                        Receita Obrigatória
                      </span>
                    )}
                  </div>
                  <h3 className="mt-1 text-lg font-bold text-white leading-tight">{item.nome}</h3>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {item.principio_ativo ? `${item.principio_ativo} · ` : ""}
                    {item.dosagem || item.forma_farmaceutica}
                  </div>
                </div>

                {/* Badge de Disponibilidade (TV) */}
                <div className="text-right shrink-0">
                  {item.disponivel ? (
                    <div className="flex flex-col items-end gap-1">
                      <span className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500/20 px-3.5 py-1.5 text-xs font-extrabold text-emerald-400 border border-emerald-500/40 shadow-sm">
                        <CheckCircle2 className="h-4 w-4" />
                        DISPONÍVEL
                      </span>
                      {painel.mostrar_quantidade && item.quantidade_disponivel != null && (
                        <span className="text-xs font-mono font-bold text-slate-300 pr-1">
                          {item.quantidade_disponivel} un.
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-xl bg-rose-500/20 px-3.5 py-1.5 text-xs font-extrabold text-rose-400 border border-rose-500/40">
                      <AlertCircle className="h-4 w-4" />
                      EM FALTA
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </main>

        {/* Rodapé da TV */}
        <footer className="border-t border-slate-800 bg-slate-900/90 px-8 py-3 text-center text-xs text-slate-400">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2">
            <span className="font-medium text-slate-300">{painel.mensagem_rodape}</span>
            <span className="text-[11px] text-slate-500">
              Sistema de Saúde Municipal · Atualização automática ativa
            </span>
          </div>
        </footer>
      </div>
    );
  }

  // ==========================================
  // RENDERIZAÇÃO: MODO PACIENTE (MOBILE / CIDADÃO)
  // REGRA DE SEGURANÇA: SEM QUANTIDADES NUMÉRICAS!
  // ==========================================
  return (
    <div className="min-h-screen bg-sus-50/70 pb-12 text-sus-900">
      {/* Topo Cidadão */}
      <header className="sticky top-0 z-20 border-b border-sus-100 bg-white/95 backdrop-blur px-4 py-4 shadow-sm">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal">
                <Pill className="h-5 w-5" />
              </div>
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-teal">
                  SUS · Farmácia Municipal
                </span>
                <h1 className="text-lg font-bold text-sus-900 leading-tight">{painel.titulo}</h1>
              </div>
            </div>

            <div className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              Online
            </div>
          </div>

          {/* Campo de Busca Rápida Cidadão */}
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sus-900/40" />
            <input
              type="text"
              placeholder="Digite o nome do remédio ou princípio ativo…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="w-full rounded-xl border border-sus-200 bg-white py-2.5 pl-9 pr-3 text-sm text-sus-900 placeholder:text-sus-900/40 focus:border-teal focus:outline-none focus:ring-2 focus:ring-teal/20"
            />
          </div>

          {/* Filtros de Categoria em Chips Horizontais */}
          {categoriasUnicas.length > 1 && (
            <div className="mt-3 flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
              <button
                onClick={() => setCategoriaFiltro("")}
                className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                  categoriaFiltro === ""
                    ? "bg-sus-900 text-white"
                    : "bg-sus-100 text-sus-900/70 hover:bg-sus-200"
                }`}
              >
                Todas ({itens.length})
              </button>
              {categoriasUnicas.map((c) => (
                <button
                  key={c}
                  onClick={() => setCategoriaFiltro(c)}
                  className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                    categoriaFiltro === c
                      ? "bg-teal text-white"
                      : "bg-sus-100 text-sus-900/70 hover:bg-sus-200"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* Conteúdo Cidadão */}
      <main className="mx-auto max-w-3xl px-4 pt-4 space-y-4">
        {/* Banner Informativo Cidadão */}
        <div className="rounded-xl border border-teal-200 bg-teal-50/60 p-3.5 text-xs text-teal-900 flex items-start gap-3">
          <FileText className="h-5 w-5 shrink-0 text-teal mt-0.5" />
          <div className="leading-relaxed">
            <span className="font-bold">Orientações para retirada:</span> Para retirar medicamentos na
            Farmácia Municipal, compareça com <strong>Documento com Foto</strong>,{" "}
            <strong>Cartão SUS</strong> e <strong>Receita Médica válida</strong> original.
          </div>
        </div>

        {/* Contador de Resultados */}
        <div className="flex items-center justify-between text-xs text-sus-900/60 px-1">
          <span>
            Exibindo <strong>{filtrados.length}</strong> medicamento(s)
          </span>
          <span>Atualizado a cada {painel.tempo_atualizacao_segundos}s</span>
        </div>

        {/* Lista de Medicamentos (Modo Paciente) */}
        {filtrados.length === 0 ? (
          <div className="rounded-2xl border border-sus-100 bg-white p-8 text-center text-sm text-sus-900/50">
            Nenhum medicamento encontrado para a busca "{busca}".
          </div>
        ) : (
          <div className="space-y-2.5">
            {filtrados.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between rounded-xl border border-sus-100 bg-white p-4 shadow-sm hover:shadow transition-shadow"
              >
                <div className="flex-1 pr-3">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="rounded bg-sus-100 px-1.5 py-0.5 text-[10px] font-semibold text-sus-900/70">
                      {item.categoria}
                    </span>
                    {item.requer_receita && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                        Receita Obrigatória
                      </span>
                    )}
                  </div>

                  <h2 className="mt-1 font-bold text-sus-900 text-base">{item.nome}</h2>

                  <div className="text-xs text-sus-900/50 mt-0.5">
                    {item.principio_ativo ? `${item.principio_ativo} · ` : ""}
                    {item.dosagem || item.forma_farmaceutica}
                  </div>
                </div>

                {/* Badge de Disponibilidade Paciente (SEM QUANTIDADE NUMÉRICA) */}
                <div className="shrink-0 text-right">
                  {item.disponivel ? (
                    <span className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-100 px-3 py-1.5 text-xs font-bold text-emerald-800 border border-emerald-200">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      DISPONÍVEL
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-xl bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 border border-red-200">
                      <AlertCircle className="h-4 w-4 text-red-600" />
                      EM FALTA
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Rodapé Institucional */}
        <div className="mt-8 rounded-xl bg-white p-4 text-center border border-sus-100 shadow-sm text-xs text-sus-900/60">
          <p className="font-medium text-sus-900">{painel.mensagem_rodape}</p>
          <p className="mt-1 text-[11px] text-sus-900/40">
            Painel Oficial de Transparência Farmacêutica Municipal
          </p>
        </div>
      </main>
    </div>
  );
}
