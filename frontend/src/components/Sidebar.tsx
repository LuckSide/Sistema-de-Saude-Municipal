import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Activity,
  Ambulance,
  BookOpenText,
  CalendarDays,
  ChartColumn,
  ClipboardList,
  FlaskConical,
  HeartPulse,
  KeyRound,
  LayoutDashboard,
  ListOrdered,
  MapPin,
  Microscope,
  Plug,
  ReceiptText,
  Settings,
  ShieldCheck,
  Users,
  Cross,
} from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { useCidadeDinamica, nomeCidade } from "../hooks/useCidade";
import { cn } from "./ui/primitives";
import TrocarSenhaModal from "./TrocarSenhaModal";

const NAV = [
  { to: "/", label: "Painel", tela: "dashboard", icon: LayoutDashboard },
  { to: "/indicadores", label: "Indicadores e Agenda", tela: "dashboard", icon: ChartColumn },
  { to: "/tfd", label: "Transporte · TFD", tela: "tfd", icon: Ambulance },
  { to: "/fila-exames", label: "Fila de exames", tela: "tfd", icon: ListOrdered },
  { to: "/lab", label: "Exames / BPA", tela: "__lab__", icon: FlaskConical },
  { to: "/aps", label: "APS · Previne", tela: "aps", icon: Activity },
  { to: "/usuarios", label: "Contas", tela: "usuarios", icon: Users },
  { to: "/configuracoes", label: "Configurações", tela: "usuarios", icon: Settings },
  { to: "/integracoes", label: "Integrações", tela: "integracoes", icon: Plug },
];

const TFD_SUB = [
  { to: "/tfd/viagens", label: "Viagens", icon: Ambulance },
  { to: "/tfd/destinos", label: "Destinos", icon: MapPin },
  { to: "/tfd/pacientes", label: "Pacientes", icon: Users },
  { to: "/tfd/catalogo", label: "Catálogo exames", icon: BookOpenText },
  { to: "/tfd/frota", label: "Frota", icon: CalendarDays },
  { to: "/tfd/faturamento", label: "Faturamento", icon: ReceiptText },
];

const LAB_SUB = [
  { to: "/lab/marcacao", label: "Marcação", icon: ClipboardList, tela: "lab" },
  { to: "/lab/fila", label: "Fila do PSF", icon: ListOrdered, tela: "lab_fila" },
  { to: "/lab/agenda", label: "Vagas e agenda", icon: CalendarDays, tela: "lab_agenda" },
  { to: "/lab/auditoria", label: "Auditoria", icon: ShieldCheck, tela: "lab_audit" },
  { to: "/lab/faturamento", label: "Faturamento BPA", icon: ReceiptText, tela: "lab" },
  { to: "/lab/sigtap", label: "Tabela SIGTAP", icon: Microscope, tela: "lab" },
];

const LAB_TELAS = ["lab", "lab_fila", "lab_agenda", "lab_vagas", "lab_audit"];
const canLab = (can: (t: string) => boolean) => LAB_TELAS.some((t) => can(t));

export default function Sidebar() {
  const { user, can, logout } = useAuth();
  const settings = useCidadeDinamica();
  const cidade = nomeCidade(settings);
  const [senhaAberta, setSenhaAberta] = useState(false);
  const loc = useLocation();
  const inTfd = loc.pathname.startsWith("/tfd");
  const inLab = loc.pathname.startsWith("/lab");

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col justify-between bg-sus-950 p-4 text-white">
      <div>
        <div className="flex items-center gap-3 px-1 pb-6 pt-2">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-teal font-display text-xl font-extrabold text-sus-950">
            <Cross className="h-6 w-6" strokeWidth={2.5} />
          </div>
          <div>
            <p className="font-display text-[15px] font-bold leading-tight">
              Saúde {cidade}
            </p>
            <p className="text-xs text-white/60">{settings.subtitulo} · {settings.uf}</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1">
          {NAV.filter((n) => n.tela === "__lab__" ? canLab(can) : can(n.tela)).map((n) => (
            <div key={n.to}>
              <NavLink
                to={n.to}
                end={n.to === "/"}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition",
                    isActive || (n.to === "/tfd" && inTfd) || (n.to === "/lab" && inLab)
                      ? "bg-white/10 text-white"
                      : "text-white/65 hover:bg-white/10 hover:text-white"
                  )
                }
              >
                <n.icon className="h-[18px] w-[18px]" />
                {n.label}
              </NavLink>
              {n.to === "/tfd" && can("tfd") && inTfd && (
                <div className="ml-5 mt-1.5 space-y-1 border-l border-white/10 pl-2.5">
                  {TFD_SUB.map((s) => (
                    <NavLink
                      key={s.to}
                      to={s.to}
                      className={({ isActive }) =>
                        cn(
                          "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition",
                          isActive
                            ? "bg-teal/20 text-teal"
                            : "text-white/55 hover:bg-white/5 hover:text-white"
                        )
                      }
                    >
                      <s.icon className="h-4 w-4" />
                      {s.label}
                    </NavLink>
                  ))}
                </div>
              )}
              {n.to === "/lab" && canLab(can) && inLab && (
                <div className="ml-5 mt-1.5 space-y-1 border-l border-white/10 pl-2.5">
                  {LAB_SUB.filter((s) => can("lab") || can(s.tela)).map((s) => (
                    <NavLink
                      key={s.to}
                      to={s.to}
                      className={({ isActive }) =>
                        cn(
                          "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition",
                          isActive
                            ? "bg-teal/20 text-teal"
                            : "text-white/55 hover:bg-white/5 hover:text-white"
                        )
                      }
                    >
                      <s.icon className="h-4 w-4" />
                      {s.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
      </div>

      <div className="mt-auto rounded-2xl bg-white/10 p-4">
        <div className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-teal/25 font-display text-sm font-bold text-teal">
            {(user?.nome || user?.username || "?").slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {user?.nome || user?.username}
            </p>
            <p className="truncate text-xs text-white/55">
              {user?.is_superuser ? "Superuser" : user?.area} ·{" "}
              <HeartPulse className="mr-0.5 inline h-3 w-3" />
              SUS
            </p>
          </div>
        </div>
        <button
          onClick={() => setSenhaAberta(true)}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-teal py-2 text-xs font-bold text-sus-950 transition hover:brightness-110"
        >
          <KeyRound className="h-3.5 w-3.5" />
          Trocar senha
        </button>
        <button
          onClick={logout}
          className="mt-2 w-full rounded-xl bg-white/10 py-2 text-xs font-semibold text-white/85 transition hover:bg-white/15"
        >
          Sair
        </button>
      </div>
      {senhaAberta && <TrocarSenhaModal onClose={() => setSenhaAberta(false)} />}
    </aside>
  );
}
