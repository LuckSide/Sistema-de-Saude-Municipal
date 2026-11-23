import { useState } from "react";
import { useLocation } from "react-router-dom";
import {
  AlertCircle,
  Bug,
  CheckCircle2,
  HelpCircle,
  LifeBuoy,
  Lightbulb,
  Loader2,
  MapPin,
  Send,
  X,
} from "lucide-react";
import { criarTicketSuporte, msgErro } from "../services/api";

type CategoriaTicket = "bug" | "info_incorreta" | "nova_funcionalidade" | "duvida";

interface CategoriaOpcao {
  id: CategoriaTicket;
  label: string;
  descricao: string;
  icon: typeof Bug;
  cor: string;
}

const CATEGORIAS: CategoriaOpcao[] = [
  {
    id: "bug",
    label: "Bug no site",
    descricao: "Algo quebrou, travou ou deu erro na tela",
    icon: Bug,
    cor: "text-red-500 bg-red-500/10 border-red-500/30",
  },
  {
    id: "info_incorreta",
    label: "Informação incorreta",
    descricao: "Dado errado, divergente ou desatualizado",
    icon: AlertCircle,
    cor: "text-amber-500 bg-amber-500/10 border-amber-500/30",
  },
  {
    id: "nova_funcionalidade",
    label: "Requisitar nova funcionalidade",
    descricao: "Ideia, melhoria ou novo recurso necessário",
    icon: Lightbulb,
    cor: "text-purple-400 bg-purple-500/10 border-purple-500/30",
  },
  {
    id: "duvida",
    label: "Dúvida / Outro",
    descricao: "Como usar uma função ou outro pedido de ajuda",
    icon: HelpCircle,
    cor: "text-teal bg-teal/10 border-teal/30",
  },
];

export default function BotaoAjudaFlutuante() {
  const location = useLocation();
  const [aberto, setAberto] = useState(false);
  const [tipo, setTipo] = useState<CategoriaTicket>("bug");
  const [descricao, setDescricao] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [sucesso, setSucesso] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const paginaAtual = `${location.pathname}${location.search}`;

  function resetarForm() {
    setTipo("bug");
    setDescricao("");
    setErro(null);
    setSucesso(false);
    setEnviando(false);
  }

  function handleFechar() {
    if (enviando) return;
    setAberto(false);
    setTimeout(resetarForm, 200);
  }

  async function handleEnviar(e: React.FormEvent) {
    e.preventDefault();
    if (!descricao.trim()) {
      setErro("Por favor, descreva o problema ou sugestão antes de enviar.");
      return;
    }

    setEnviando(true);
    setErro(null);

    try {
      await criarTicketSuporte({
        tipo,
        descricao: descricao.trim(),
        pagina_url: paginaAtual,
      });
      setSucesso(true);
      setTimeout(() => {
        handleFechar();
      }, 2500);
    } catch (err) {
      setErro(msgErro(err, "Falha ao enviar chamado. Tente novamente mais tarde."));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      {/* Botão Flutuante Discreto */}
      <button
        onClick={() => setAberto(true)}
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-sus-950 px-3.5 py-2.5 text-xs font-medium text-white shadow-xl ring-1 ring-white/10 hover:bg-sus-900 hover:ring-teal/50 hover:shadow-2xl transition-all duration-200 print:hidden group"
        title="Precisa de ajuda ou encontrou um problema? Clique para abrir um chamado"
        aria-label="Abrir suporte e ajuda"
      >
        <LifeBuoy className="h-4 w-4 text-teal transition-transform duration-300 group-hover:rotate-45" />
        <span className="hidden font-display font-semibold sm:inline tracking-wide">
          Ajuda
        </span>
      </button>

      {/* Modal de Suporte */}
      {aberto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in duration-150 print:hidden"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-ajuda-titulo"
        >
          <div
            className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/10"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 bg-sus-950 px-6 py-4 text-white">
              <div className="flex items-center gap-2.5">
                <div className="rounded-xl bg-teal/20 p-2 text-teal">
                  <LifeBuoy className="h-5 w-5" />
                </div>
                <div>
                  <h2
                    id="modal-ajuda-titulo"
                    className="font-display text-base font-bold text-white"
                  >
                    Central de Ajuda e Suporte
                  </h2>
                  <p className="text-xs text-white/70">
                    Relate um problema ou envie uma solicitação aos administradores
                  </p>
                </div>
              </div>
              <button
                onClick={handleFechar}
                disabled={enviando}
                className="rounded-lg p-1.5 text-white/70 hover:bg-white/10 hover:text-white transition-colors"
                aria-label="Fechar modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Conteúdo */}
            {sucesso ? (
              <div className="p-8 text-center animate-in zoom-in-95 duration-200">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 mb-4">
                  <CheckCircle2 className="h-8 w-8" />
                </div>
                <h3 className="font-display text-lg font-bold text-slate-800">
                  Chamado Registrado!
                </h3>
                <p className="mt-2 text-sm text-slate-600 max-w-sm mx-auto">
                  Sua solicitação foi salva e enviada aos administradores com a tela atual capturada. Em breve ela será analisada.
                </p>
                <div className="mt-6">
                  <button
                    onClick={handleFechar}
                    className="rounded-xl bg-sus-950 px-5 py-2.5 text-xs font-bold text-white hover:bg-sus-900 transition-colors"
                  >
                    Fechar
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleEnviar} className="p-6 space-y-4">
                {/* Página Detectada */}
                <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600 border border-slate-200">
                  <MapPin className="h-4 w-4 shrink-0 text-slate-400" />
                  <span className="font-semibold text-slate-700">Página atual:</span>
                  <code className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-[11px] text-slate-800 break-all">
                    {paginaAtual}
                  </code>
                </div>

                {/* Seleção de Categoria */}
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-2">
                    Com o que você precisa de ajuda?
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {CATEGORIAS.map((cat) => {
                      const Icone = cat.icon;
                      const selecionado = tipo === cat.id;
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => setTipo(cat.id)}
                          className={`flex items-start gap-2.5 rounded-xl border p-2.5 text-left transition-all ${
                            selecionado
                              ? "border-teal bg-teal/5 ring-1 ring-teal text-slate-900 shadow-xs"
                              : "border-slate-200 hover:border-slate-300 hover:bg-slate-50/50 text-slate-700"
                          }`}
                        >
                          <div
                            className={`rounded-lg p-1.5 shrink-0 ${
                              selecionado ? cat.cor : "bg-slate-100 text-slate-500"
                            }`}
                          >
                            <Icone className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-bold leading-tight">
                              {cat.label}
                            </p>
                            <p className="text-[10px] text-slate-500 line-clamp-1 mt-0.5">
                              {cat.descricao}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Descrição */}
                <div>
                  <label
                    htmlFor="ticket-descricao"
                    className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5"
                  >
                    Descreva o ocorrido ou solicitação
                  </label>
                  <textarea
                    id="ticket-descricao"
                    rows={4}
                    value={descricao}
                    onChange={(e) => setDescricao(e.target.value)}
                    placeholder="Explique detalhadamente o que aconteceu, qual botão clicou ou qual melhoria gostaria de ver no sistema..."
                    className="w-full rounded-xl border border-slate-300 p-3 text-xs text-slate-800 placeholder-slate-400 focus:border-teal focus:outline-none focus:ring-1 focus:ring-teal"
                    disabled={enviando}
                  />
                  <div className="mt-1 flex justify-between text-[11px] text-slate-400">
                    <span>Mínimo recomendado de detalhes para facilitar o suporte.</span>
                    <span>{descricao.length} caracteres</span>
                  </div>
                </div>

                {/* Alerta de erro */}
                {erro && (
                  <div className="flex items-center gap-2 rounded-xl bg-red-50 p-3 text-xs text-red-700 border border-red-200">
                    <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
                    <span>{erro}</span>
                  </div>
                )}

                {/* Botões do Rodapé */}
                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={handleFechar}
                    disabled={enviando}
                    className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={enviando || !descricao.trim()}
                    className="flex items-center gap-2 rounded-xl bg-teal px-4 py-2 text-xs font-bold text-sus-950 shadow-xs hover:brightness-105 active:scale-95 disabled:opacity-50 disabled:pointer-events-none transition-all"
                  >
                    {enviando ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Enviando…</span>
                      </>
                    ) : (
                      <>
                        <Send className="h-3.5 w-3.5" />
                        <span>Enviar Solicitação</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
