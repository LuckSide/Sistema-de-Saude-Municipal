import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import Sidebar from "./Sidebar";

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
  return (
    <div className="flex min-h-screen bg-sand print:block print:min-h-0 print:bg-white">
      <div className="sticky top-0 hidden h-screen shrink-0 md:block print:hidden">
        <Sidebar />
      </div>
      <main className="min-w-0 flex-1 overflow-y-auto print:overflow-visible">
        <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8 print:max-w-none print:p-0">
          {children}
        </div>
      </main>
    </div>
  );
}
