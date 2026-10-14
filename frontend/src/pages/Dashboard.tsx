import { Activity, Ambulance, CalendarDays, ChartColumn, FlaskConical, ListOrdered, Plug, Settings2, ShieldCheck, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { Card } from "../components/ui/primitives";
import UpdateBanner, { VersaoRodape } from "../components/UpdateBanner";
import { updateStatus, type UpdateStatus } from "../services/api";

export default function Dashboard() {
  const { user, can } = useAuth();
  const [versao, setVersao] = useState<UpdateStatus | null>(null);
  useEffect(() => {
    if (!user?.is_superuser) return;
    updateStatus(false).then(setVersao).catch(() => {});
  }, [user?.is_superuser]);

  const cards = [
    {
      tela: "dashboard",
      titulo: "Indicadores e Agenda",
      desc: "Evolução das filas, volume por tipo e agenda integrada.",
      icon: ChartColumn,
      to: "/indicadores",
    },
    {
      tela: "tfd",
      titulo: "TFD · Operações",
      desc: "Viagens, pacientes, fila de exames, frota e faturamento.",
      icon: Ambulance,
      to: "/tfd",
    },
    {
      tela: "lab",
      titulo: "Exames / BPA",
      desc: "Solicitações laboratoriais, SIGTAP e lote BPA.",
      icon: FlaskConical,
      to: "/lab",
    },
    {
      tela: "aps",
      titulo: "APS · Previne Brasil",
      desc: "Indicadores, painéis e acompanhamento das equipes.",
      icon: Activity,
      to: "/aps",
    },
    {
      tela: "lab_fila",
      titulo: "Fila do PSF",
      desc: "Pedidos das unidades de saúde.",
      icon: ListOrdered,
      to: "/lab/fila",
    },
    {
      tela: "lab_agenda",
      titulo: "Agenda de exames",
      desc: "Grade mensal de vagas por laboratório.",
      icon: CalendarDays,
      to: "/lab/agenda",
    },
    {
      tela: "lab_vagas",
      titulo: "Vagas",
      desc: "Quantitativo diário dos 3 laboratórios.",
      icon: Settings2,
      to: "/lab/vagas",
    },
    {
      tela: "lab_audit",
      titulo: "Auditoria lab",
      desc: "Conferência pedido físico × sistema.",
      icon: ShieldCheck,
      to: "/lab/auditoria",
    },
    {
      tela: "usuarios",
      titulo: "Contas",
      desc: "Usuários, áreas e telas permitidas.",
      icon: Users,
      to: "/usuarios",
    },
    {
      tela: "integracoes",
      titulo: "Integrações",
      desc: "e-SUS, RNDS e demais sistemas.",
      icon: Plug,
      to: "/integracoes",
    },
  ].filter((c) => can(c.tela));

  return (
    <div>
      {user?.is_superuser && <UpdateBanner />}
      <div className="rise mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-sus-700">
          Secretaria de Saúde · Guapé-MG
        </p>
        <h1 className="mt-1 font-display text-3xl font-extrabold text-sus-950">
          Olá, {(user?.nome || user?.username)?.split(" ")[0]}
        </h1>
        <p className="mt-1 text-sm text-ink/55">
          Área: <b>{user?.area}</b> · Telas: {user?.telas.join(", ") || "—"}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map((c, i) => (
          <Link key={c.tela} to={c.to}>
            <Card
              className={`rise rise-${i + 1} group p-5 transition hover:-translate-y-0.5 hover:shadow-card`}
            >
              <div className="mb-3 grid h-11 w-11 place-items-center rounded-2xl bg-sus-900 text-white transition group-hover:bg-teal group-hover:text-sus-950">
                <c.icon className="h-5 w-5" />
              </div>
              <p className="font-display text-base font-bold text-sus-950">{c.titulo}</p>
              <p className="mt-1 text-sm text-ink/55">{c.desc}</p>
            </Card>
          </Link>
        ))}
      </div>
      {user?.is_superuser && <VersaoRodape st={versao} />}
    </div>
  );
}
