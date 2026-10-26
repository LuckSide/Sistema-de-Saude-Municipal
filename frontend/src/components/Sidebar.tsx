import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Activity,
  Ambulance,
  BarChart3,
  BookOpenText,
  Building2,
  CalendarDays,
  Car,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Coins,
  Cross,
  Database,
  FileCheck,
  FlaskConical,
  HeartPulse,
  History,
  KeyRound,
  LayoutDashboard,
  ListOrdered,
  LogOut,
  MapPin,
  PanelLeftClose,
  PanelLeftOpen,
  PlusCircle,
  ReceiptText,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Stethoscope,
  Truck,
  UserCheck,
  UserCog,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { useCidadeDinamica, nomeCidade } from "../hooks/useCidade";
import { cn } from "./ui/primitives";
import TrocarSenhaModal from "./TrocarSenhaModal";

interface SubItem {
  to: string;
  label: string;
  icon: LucideIcon;
  tela: string;
  ou?: string[];
}

interface ModuloNav {
  id: string;
  label: string;
  icon: LucideIcon;
  itens: SubItem[];
}

const MODULOS_NAV: ModuloNav[] = [
  {
    id: "frota",
    label: "Frota e Logística",
    icon: Truck,
    itens: [
      { to: "/tfd/frota", label: "Veículos", icon: Car, tela: "tfd_frota", ou: ["tfd_frota_gestao", "tfd"] },
      { to: "/tfd/motoristas", label: "Motoristas", icon: UserCheck, tela: "tfd_frota", ou: ["tfd_frota_gestao", "tfd"] },
      { to: "/tfd/frota?aba=manutencoes", label: "Manutenções", icon: Wrench, tela: "tfd_frota", ou: ["tfd_frota_gestao", "tfd"] },
    ],
  },
  {
    id: "tfd",
    label: "TFD · Transporte",
    icon: Ambulance,
    itens: [
      { to: "/tfd/quadro", label: "Viagens e Escalas", icon: CalendarDays, tela: "tfd_viagens", ou: ["tfd_frota_gestao", "tfd"] },
      { to: "/tfd/viagens", label: "Ordens de Viagem", icon: Ambulance, tela: "tfd_viagens", ou: ["tfd"] },
      { to: "/tfd", label: "Solicitações TFD", icon: ClipboardCheck, tela: "tfd_resumo", ou: ["tfd"] },
      { to: "/tfd/faturamento", label: "Diárias e Custos", icon: Coins, tela: "tfd_faturamento", ou: ["tfd"] },
      { to: "/tfd/faturamento?aba=prestacao", label: "Prestação Contas", icon: ReceiptText, tela: "tfd_faturamento", ou: ["tfd"] },
      { to: "/indicadores", label: "Relatórios da Fila", icon: BarChart3, tela: "dash_indicadores", ou: ["dashboard", "tfd", "tfd_exames"] },
    ],
  },
  {
    id: "fila",
    label: "Solicitações",
    icon: ListOrdered,
    itens: [
      { to: "/tfd/solicitacoes/nova", label: "Nova Solicitação", icon: PlusCircle, tela: "tfd_exames", ou: ["tfd_fila_lancamento", "tfd"] },
      { to: "/fila-exames", label: "Fila de Espera", icon: ListOrdered, tela: "tfd_exames", ou: ["tfd_fila_lancamento", "tfd_medico", "tfd"] },
      { to: "/tfd/agendamentos", label: "Agenda e Recepção", icon: CalendarDays, tela: "tfd_agenda", ou: ["tfd"] },
      { to: "/tfd/relatorio-agendados", label: "Relatório de Agendados", icon: BarChart3, tela: "tfd_agenda", ou: ["tfd", "usuarios"] },
      { to: "/painel-medico", label: "Regulação Médica", icon: Stethoscope, tela: "tfd_medico" },
    ],
  },
  {
    id: "cadastros",
    label: "Cadastros",
    icon: BookOpenText,
    itens: [
      { to: "/tfd/pacientes", label: "Pacientes", icon: Users, tela: "tfd_pacientes", ou: ["tfd"] },
      { to: "/configuracoes?aba=medicos", label: "Médicos", icon: Stethoscope, tela: "usuarios", ou: ["lab_vagas", "cfg_geral"] },
      { to: "/configuracoes?aba=unidades", label: "Unidades de Saúde", icon: Building2, tela: "usuarios", ou: ["lab_vagas", "cfg_geral"] },
      { to: "/tfd/catalogo", label: "Catálogo SIGTAP", icon: BookOpenText, tela: "tfd_catalogo", ou: ["tfd"] },
      { to: "/tfd/destinos", label: "Destinos", icon: MapPin, tela: "tfd_destinos", ou: ["tfd"] },
    ],
  },
  {
    id: "lab",
    label: "Exames laboratoriais",
    icon: FlaskConical,
    itens: [
      { to: "/lab/recepcao", label: "Recepção e Coleta", icon: FlaskConical, tela: "lab_recepcao", ou: ["lab", "usuarios"] },
      { to: "/lab/marcacao", label: "Marcação de exames de sangue", icon: ClipboardCheck, tela: "lab_marcacao", ou: ["lab"] },
      { to: "/lab/fila", label: "Fila de exames", icon: ListOrdered, tela: "lab_fila", ou: ["lab"] },
      { to: "/lab/agenda", label: "Vagas e Agenda", icon: CalendarDays, tela: "lab_agenda", ou: ["lab", "lab_vagas"] },
      { to: "/lab/faturamento", label: "Faturamento BPA", icon: ReceiptText, tela: "lab_faturamento", ou: ["lab"] },
      { to: "/lab/sigtap", label: "SIGTAP BPA", icon: BookOpenText, tela: "lab_sigtap", ou: ["lab"] },
    ],
  },
  {
    id: "apac",
    label: "APAC · Alta Complexidade",
    icon: ShieldCheck,
    itens: [
      { to: "/apac/solicitacoes", label: "Laudos e Solicitações", icon: FileCheck, tela: "apac_solicitacao", ou: ["tfd", "usuarios"] },
      { to: "/apac/regulacao", label: "Regulação e Autorização", icon: Stethoscope, tela: "apac_regulacao", ou: ["usuarios"] },
      { to: "/apac/faturamento", label: "Faturamento APAC-Mag", icon: ReceiptText, tela: "apac_faturamento", ou: ["tfd", "usuarios"] },
    ],
  },
  {
    id: "admin",
    label: "Administração",
    icon: Settings,
    itens: [
      { to: "/usuarios", label: "Usuários e Acessos", icon: UserCog, tela: "usuarios" },
      { to: "/configuracoes?aba=backup", label: "Backup do Sistema", icon: Database, tela: "cfg_backup", ou: ["usuarios", "cfg_geral"] },
      { to: "/configuracoes?aba=geral", label: "Configurações", icon: SlidersHorizontal, tela: "cfg_geral", ou: ["usuarios", "integracoes"] },
      { to: "/auditoria", label: "Auditoria / Logs", icon: History, tela: "usuarios" },
    ],
  },
];

function isItemAtivo(itemTo: string, currentPath: string, currentSearch: string): boolean {
  const [toPath, toQuery] = itemTo.split("?");
  if (toPath !== currentPath) {
    if (toPath === "/" && currentPath === "/") return !currentSearch;
    return false;
  }
  if (toQuery) {
    const params = new URLSearchParams(currentSearch);
    const [qKey, qVal] = toQuery.split("=");
    return params.get(qKey) === qVal;
  }
  return !currentSearch || currentSearch === "?";
}

function podeVerItem(item: { tela: string; ou?: string[] }, can: (t: string) => boolean): boolean {
  if (can(item.tela)) return true;
  if (item.ou && item.ou.some((t) => can(t))) return true;
  return false;
}

interface SidebarConteudoProps {
  onNavegar?: () => void;
  colapsado?: boolean;
  onToggleColapsado?: () => void;
  forcarExpandido?: boolean;
}

export function SidebarConteudo({
  onNavegar,
  colapsado = false,
  onToggleColapsado,
  forcarExpandido = false,
}: SidebarConteudoProps) {
  const { user, can, logout } = useAuth();
  const settings = useCidadeDinamica();
  const cidade = nomeCidade(settings);
  const [senhaAberta, setSenhaAberta] = useState(false);
  const loc = useLocation();

  const emColapso = colapsado && !forcarExpandido;

  // Filtragem dos módulos de acordo com as permissões do usuário
  const modulosVisiveis = MODULOS_NAV.map((m) => ({
    ...m,
    itens: m.itens.filter((it) => podeVerItem(it, can)),
  })).filter((m) => m.itens.length > 0);

  // Estado de abertura dos accordions
  const [abertos, setAbertos] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const m of MODULOS_NAV) {
      if (m.itens.some((it) => isItemAtivo(it.to, loc.pathname, loc.search))) {
        initial[m.id] = true;
      }
    }
    return initial;
  });

  // Expande automaticamente a categoria quando a rota atual pertencer a ela
  useEffect(() => {
    for (const m of modulosVisiveis) {
      if (m.itens.some((it) => isItemAtivo(it.to, loc.pathname, loc.search))) {
        setAbertos((prev) => ({ ...prev, [m.id]: true }));
      }
    }
  }, [loc.pathname, loc.search]);

  function toggleModulo(id: string) {
    setAbertos((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  // Se colapsado, clicar no ícone do módulo expande a sidebar e abre o módulo
  function clicarModuloColapsado(id: string) {
    setAbertos((prev) => ({ ...prev, [id]: true }));
    if (onToggleColapsado) onToggleColapsado();
  }

  const painelAtivo = isItemAtivo("/", loc.pathname, loc.search);
  const apsAtivo = isItemAtivo("/aps", loc.pathname, loc.search);

  return (
    <>
      <div className="flex flex-col">
        {/* Cabeçalho */}
        <div
          className={cn(
            "flex items-center pb-4 pt-2 border-b border-white/10",
            emColapso ? "justify-center flex-col gap-2" : "justify-between px-1"
          )}
        >
          <div className={cn("flex items-center gap-3", emColapso && "justify-center")}>
            {settings.brasao_url ? (
              <img
                src={settings.brasao_url}
                alt={`Brasão de ${cidade}`}
                className="h-10 w-10 rounded-2xl bg-white object-contain p-1 shrink-0"
              />
            ) : (
              <div className="grid h-10 w-10 place-items-center rounded-2xl bg-teal font-display text-lg font-extrabold text-sus-950 shrink-0">
                <Cross className="h-5 w-5" strokeWidth={2.5} />
              </div>
            )}
            {!emColapso && (
              <div className="min-w-0">
                <p className="truncate font-display text-[15px] font-bold leading-tight">
                  Saúde {cidade}
                </p>
                <p className="truncate text-xs text-white/60">
                  {settings.subtitulo || "Secretaria Municipal"} · {settings.uf}
                </p>
              </div>
            )}
          </div>

          {onToggleColapsado && !forcarExpandido && (
            <button
              onClick={onToggleColapsado}
              title={emColapso ? "Expandir menu lateral" : "Recolher menu lateral"}
              className={cn(
                "rounded-lg p-2 text-white/70 transition hover:bg-white/10 hover:text-white",
                emColapso ? "mt-1" : "ml-auto"
              )}
            >
              {emColapso ? (
                <PanelLeftOpen className="h-5 w-5" />
              ) : (
                <PanelLeftClose className="h-5 w-5" />
              )}
            </button>
          )}
        </div>

        {/* Itens de Navegação */}
        <nav className="mt-3 flex-1 space-y-1">
          {/* Painel Principal */}
          {can("dashboard") && (
            <NavLink
              to="/"
              end
              onClick={onNavegar}
              title={emColapso ? "Painel Principal" : undefined}
              className={cn(
                "flex items-center rounded-xl transition min-h-[42px]",
                emColapso
                  ? "justify-center p-2.5"
                  : "gap-3 px-3 py-2 text-sm font-semibold",
                painelAtivo
                  ? "bg-teal/20 text-teal ring-1 ring-teal/30"
                  : "text-white/80 hover:bg-white/10 hover:text-white"
              )}
            >
              <LayoutDashboard className="h-[18px] w-[18px] shrink-0" />
              {!emColapso && <span>Painel Principal</span>}
            </NavLink>
          )}

          {/* Indicadores (APS Previne) */}
          {can("aps") && (
            <NavLink
              to="/aps"
              onClick={onNavegar}
              title={emColapso ? "Indicadores" : undefined}
              className={cn(
                "flex items-center rounded-xl transition min-h-[42px]",
                emColapso
                  ? "justify-center p-2.5"
                  : "gap-3 px-3 py-2 text-sm font-semibold",
                apsAtivo
                  ? "bg-teal/20 text-teal ring-1 ring-teal/30"
                  : "text-white/80 hover:bg-white/10 hover:text-white"
              )}
            >
              <Activity className="h-[18px] w-[18px] shrink-0" />
              {!emColapso && <span>Indicadores</span>}
            </NavLink>
          )}

          <div className="my-2 border-t border-white/10" />

          {/* Módulos com Accordions */}
          {modulosVisiveis.map((modulo) => {
            const ModuloIcon = modulo.icon;
            const algumFilhoAtivo = modulo.itens.some((it) =>
              isItemAtivo(it.to, loc.pathname, loc.search)
            );
            const isOpen = !!abertos[modulo.id];

            if (emColapso) {
              return (
                <div key={modulo.id} className="relative py-0.5">
                  <button
                    onClick={() => clicarModuloColapsado(modulo.id)}
                    title={modulo.label}
                    className={cn(
                      "flex h-10 w-full items-center justify-center rounded-xl transition",
                      algumFilhoAtivo
                        ? "bg-teal/20 text-teal ring-1 ring-teal/50 font-bold"
                        : "text-white/75 hover:bg-white/10 hover:text-white"
                    )}
                  >
                    <ModuloIcon className="h-5 w-5" />
                  </button>
                </div>
              );
            }

            return (
              <div key={modulo.id} className="pt-1">
                <button
                  type="button"
                  onClick={() => toggleModulo(modulo.id)}
                  title={modulo.label}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-[13px] font-semibold transition",
                    algumFilhoAtivo
                      ? "text-white bg-white/10 font-bold"
                      : "text-white/75 hover:bg-white/5 hover:text-white"
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <ModuloIcon
                      className={cn(
                        "h-4 w-4 shrink-0",
                        algumFilhoAtivo ? "text-teal" : "text-white/60"
                      )}
                    />
                    <span className="truncate">{modulo.label}</span>
                  </div>
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-white/60" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-white/60" />
                  )}
                </button>

                {isOpen && (
                  <div className="ml-3.5 mt-1 space-y-0.5 border-l-2 border-white/10 pl-2.5">
                    {modulo.itens.map((item) => {
                      const ItemIcon = item.icon;
                      const ativo = isItemAtivo(item.to, loc.pathname, loc.search);

                      return (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          onClick={onNavegar}
                          title={item.label}
                          className={cn(
                            "flex min-h-[36px] items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition",
                            ativo
                              ? "bg-teal/20 text-teal font-bold shadow-sm"
                              : "text-white/80 hover:bg-white/10 hover:text-white"
                          )}
                        >
                          <ItemIcon
                            className={cn(
                              "h-4 w-4 shrink-0",
                              ativo ? "text-teal" : "text-white/55"
                            )}
                          />
                          <span className="truncate">{item.label}</span>
                        </NavLink>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </div>

      {/* Rodapé do Usuário */}
      <div
        className={cn(
          "mt-auto border-t border-white/10 pt-3",
          emColapso ? "flex flex-col items-center gap-2" : "rounded-2xl bg-white/5 p-3.5"
        )}
      >
        {emColapso ? (
          <>
            <div
              title={`${user?.nome || user?.username} (${user?.is_superuser ? "Superuser" : user?.area || "SUS"})`}
              className="grid h-9 w-9 place-items-center rounded-full bg-teal/25 font-display text-sm font-bold text-teal ring-1 ring-teal/40 cursor-default"
            >
              {(user?.nome || user?.username || "?").slice(0, 1).toUpperCase()}
            </div>
            <button
              onClick={logout}
              title="Sair do sistema"
              className="grid h-9 w-9 place-items-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2.5">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-teal/25 font-display text-sm font-bold text-teal ring-1 ring-teal/40">
                {(user?.nome || user?.username || "?").slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-white">
                  {user?.nome || user?.username}
                </p>
                <p className="truncate text-xs text-white/60">
                  {user?.is_superuser ? "Superusuário" : user?.area || "Operador"} ·{" "}
                  <HeartPulse className="mr-0.5 inline h-3 w-3 text-teal" />
                  SUS
                </p>
              </div>
            </div>
            <div className="mt-2.5 grid grid-cols-2 gap-2">
              <button
                onClick={() => setSenhaAberta(true)}
                className="flex min-h-[36px] items-center justify-center gap-1.5 rounded-lg bg-teal px-2 py-1.5 text-xs font-bold text-sus-950 transition hover:brightness-110"
              >
                <KeyRound className="h-3.5 w-3.5 shrink-0" />
                <span>Senha</span>
              </button>
              <button
                onClick={logout}
                className="flex min-h-[36px] items-center justify-center gap-1.5 rounded-lg bg-white/10 px-2 py-1.5 text-xs font-semibold text-white/85 transition hover:bg-white/15 hover:text-white"
              >
                <LogOut className="h-3.5 w-3.5 shrink-0" />
                <span>Sair</span>
              </button>
            </div>
          </>
        )}
      </div>

      {senhaAberta && <TrocarSenhaModal onClose={() => setSenhaAberta(false)} />}
    </>
  );
}

export default function Sidebar() {
  const [colapsado, setColapsado] = useState<boolean>(() => {
    try {
      return localStorage.getItem("guape:sidebar:colapsada") === "1";
    } catch {
      return false;
    }
  });

  function toggleColapsado() {
    setColapsado((prev) => {
      const proximo = !prev;
      try {
        localStorage.setItem("guape:sidebar:colapsada", proximo ? "1" : "0");
      } catch {}
      return proximo;
    });
  }

  return (
    <aside
      className={cn(
        "sticky top-0 flex h-screen shrink-0 flex-col justify-between overflow-y-auto bg-sus-950 text-white transition-all duration-200 select-none",
        colapsado ? "w-16 p-2" : "w-[270px] p-3.5"
      )}
    >
      <SidebarConteudo
        colapsado={colapsado}
        onToggleColapsado={toggleColapsado}
      />
    </aside>
  );
}
