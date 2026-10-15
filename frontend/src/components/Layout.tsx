import { useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Cross, Menu, X } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import Sidebar, { SidebarConteudo } from "./Sidebar";

export function Protected({ children }: { children: ReactNode }) {
  const { user, loading, precisaTrocarSenha } = useAuth();
  if (loading)
    return (
      <div className="grid h-screen place-items-center bg-sand font-display text-sm text-sus-900">
        Carregando painel…
      </div>
    );
  if (!user) return <Navigate to="/login" replace />;
  if (precisaTrocarSenha) return <Navigate to="/alterar-senha-inicial" replace />;
  return children;
}

export function Shell({ children }: { children: ReactNode }) {
  const [aberto, setAberto] = useState(false);
  const loc = useLocation();

  // Fecha a gaveta a cada troca de rota.
  useEffect(() => {
    setAberto(false);
  }, [loc.pathname]);

  // Trava o scroll do fundo com a gaveta aberta.
  useEffect(() => {
    document.body.style.overflow = aberto ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [aberto ]);

  return (
    <div className="flex min-h-screen bg-sand print:block print:min-h-0 print:bg-white">
      <div className="sticky top-0 hidden h-screen shrink-0 md:block print:hidden">
        <Sidebar />
      </div>

      {/* Gaveta mobile */}
      {aberto && (
        <div className="fixed inset-0 z-40 md:hidden print:hidden">
          <div
            className="absolute inset-0 bg-sus-950/60"
            onClick={() => setAberto(false)}
            aria-hidden
          />
          <div className="drawer-in absolute left-0 top-0 flex h-full w-72 max-w-[85vw] flex-col bg-sus-950 p-4 text-white shadow-2xl">
            <div className="flex items-center justify-between pb-2">
              <span className="inline-flex items-center gap-2 font-display text-sm font-bold">
                <Cross className="h-4 w-4 text-teal" /> Gestão SMS
              </span>
              <button
                onClick={() => setAberto(false)}
                aria-label="Fechar menu"
                className="grid min-h-[44px] min-w-[44px] place-items-center rounded-xl text-white/70 hover:bg-white/10 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              <SidebarConteudo onNavegar={() => setAberto(false)} />
            </div>
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header mobile com hambúrguer */}
        <header className="sticky top-0 z-30 flex min-h-[56px] items-center gap-3 bg-sus-950 px-4 py-2 text-white md:hidden print:hidden">
          <button
            onClick={() => setAberto(true)}
            aria-label="Abrir menu"
            className="grid min-h-[44px] min-w-[44px] place-items-center rounded-xl hover:bg-white/10"
          >
            <Menu className="h-6 w-6" />
          </button>
          <span className="inline-flex items-center gap-2 font-display text-sm font-bold">
            <Cross className="h-4 w-4 text-teal" /> Gestão SMS
          </span>
        </header>
        <main className="min-w-0 flex-1 overflow-y-auto print:overflow-visible">
          <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8 print:max-w-none print:p-0">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
