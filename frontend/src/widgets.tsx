import { useEffect, useState } from "react";
import { Activity, Ambulance, CalendarDays, ListOrdered, type LucideIcon } from "lucide-react";
import { tfdFiltrosOpcoes, tfdResumo, vagasGrade } from "./services/api";
import { pecPainel } from "./services/pec";

export interface WidgetDef {
  id: string;
  titulo: string;
  desc: string;
  icone: LucideIcon;
  /** telas que liberam o widget (qualquer uma basta; endpoints reforçam no backend) */
  telas: string[];
}

export const WIDGETS: WidgetDef[] = [
  {
    id: "resumo-tfd",
    titulo: "TFD do mês",
    desc: "Viagens, passageiros e exames aguardando/urgentes.",
    icone: Ambulance,
    telas: ["tfd_resumo"],
  },
  {
    id: "fila-especialidade",
    titulo: "Fila por especialidade",
    desc: "Aguardando por especialidade (top 6).",
    icone: ListOrdered,
    telas: ["tfd_exames"],
  },
  {
    id: "agenda-semana",
    titulo: "Agenda da semana",
    desc: "Vagas livres nos próximos 7 dias.",
    icone: CalendarDays,
    telas: ["lab_agenda", "lab_vagas"],
  },
  {
    id: "painel-aps",
    titulo: "APS · repasse",
    desc: "Indicadores atingidos no período.",
    icone: Activity,
    telas: ["aps"],
  },
];

function Erro({ msg }: { msg: string }) {
  return <p className="mt-2 text-xs text-ink/45">{msg}</p>;
}

export function WidgetResumoTfd() {
  const [d, setD] = useState<{ viagens_mes: number; passageiros_mes: number; exames_aguardando: number; exames_urgentes: number } | null>(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    tfdResumo().then(setD).catch(() => setErro("Sem dados."));
  }, []);
  const cards = d
    ? [
        ["Viagens no mês", d.viagens_mes],
        ["Passageiros", d.passageiros_mes],
        ["Aguardando", d.exames_aguardando],
        ["Urgentes", d.exames_urgentes],
      ]
    : [];
  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        {cards.map(([k, v]) => (
          <div key={k as string} className="rounded-xl bg-sand px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/50">{k}</p>
            <p className="font-display text-xl font-extrabold text-sus-950">{v}</p>
          </div>
        ))}
      </div>
      {erro && <Erro msg={erro} />}
    </div>
  );
}

export function WidgetFilaEspecialidade() {
  const [itens, setItens] = useState<{ value: string; label: string; total: number }[]>([]);
  const [erro, setErro] = useState("");
  useEffect(() => {
    tfdFiltrosOpcoes("aguardando")
      .then((r) => setItens([...(r.especialidades ?? [])].sort((a, b) => b.total - a.total).slice(0, 6)))
      .catch(() => setErro("Sem dados."));
  }, []);
  const max = Math.max(1, ...itens.map((i) => i.total));
  return (
    <div>
      <div className="space-y-2">
        {itens.map((i) => (
          <div key={i.value}>
            <div className="flex items-baseline justify-between gap-2">
              <p className="truncate text-xs font-medium text-ink">{i.label || i.value}</p>
              <p className="font-display text-sm font-extrabold text-sus-950">{i.total}</p>
            </div>
            <div className="mt-0.5 h-2 overflow-hidden rounded-full bg-sus-900/10">
              <div className="h-full rounded-full bg-teal" style={{ width: `${Math.round((100 * i.total) / max)}%` }} />
            </div>
          </div>
        ))}
        {itens.length === 0 && !erro && <p className="text-xs text-ink/45">Carregando…</p>}
      </div>
      {erro && <Erro msg={erro} />}
    </div>
  );
}

export function WidgetAgendaSemana() {
  const [dias, setDias] = useState<{ data: string; livres: number; ocupadas: number }[]>([]);
  const [erro, setErro] = useState("");
  useEffect(() => {
    const hoje = new Date();
    const mes = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
    vagasGrade(mes)
      .then((grade) => {
        const porDia = new Map<string, { livres: number; ocupadas: number }>();
        for (const g of grade ?? []) {
          const acc = porDia.get(g.data) ?? { livres: 0, ocupadas: 0 };
          acc.livres += g.livres ?? 0;
          acc.ocupadas += g.ocupadas ?? 0;
          porDia.set(g.data, acc);
        }
        const out: { data: string; livres: number; ocupadas: number }[] = [];
        for (let i = 0; i < 7; i++) {
          const d = new Date(hoje);
          d.setDate(hoje.getDate() + i);
          const chave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          const acc = porDia.get(chave) ?? { livres: 0, ocupadas: 0 };
          out.push({ data: chave, ...acc });
        }
        setDias(out);
      })
      .catch(() => setErro("Sem dados."));
  }, []);
  const SEM = ["D", "S", "T", "Q", "Q", "S", "S"];
  const max = Math.max(1, ...dias.map((d) => d.livres + d.ocupadas));
  return (
    <div>
      <div className="grid grid-cols-7 gap-1.5">
        {dias.map((d) => {
          const dt = new Date(d.data + "T12:00:00");
          return (
            <div key={d.data} className="rounded-xl bg-sand px-1 py-2 text-center">
              <p className="text-[10px] font-bold text-ink/50">{SEM[dt.getDay()]}</p>
              <p className="font-display text-sm font-extrabold text-sus-950">{dt.getDate()}</p>
              <div className="mx-auto mt-1 h-10 w-2 overflow-hidden rounded-full bg-sus-900/10">
                <div className="w-full rounded-full bg-teal" style={{ height: `${Math.round((100 * d.livres) / max)}%` }} title={`${d.livres} livres`} />
              </div>
              <p className="mt-0.5 text-[10px] font-bold text-teal">{d.livres}</p>
            </div>
          );
        })}
      </div>
      {erro && <Erro msg={erro} />}
    </div>
  );
}

export function WidgetPainelAps() {
  const [d, setD] = useState<{ atingidos: number; total: number; status: string; periodo: string } | null>(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    pecPainel()
      .then(({ dados }) => {
        const r = dados.resumo_repasse;
        if (!r) {
          setErro("Sem dados.");
          return;
        }
        setD({ atingidos: r.atingidos, total: r.total, status: r.status_geral, periodo: dados.periodo });
      })
      .catch(() => setErro("Sem dados."));
  }, []);
  if (!d) return <div>{erro ? <Erro msg={erro} /> : <p className="text-xs text-ink/45">Carregando…</p>}</div>;
  const pct = d.total ? Math.round((100 * d.atingidos) / d.total) : 0;
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <p className="font-display text-3xl font-extrabold text-sus-950">{d.atingidos}<span className="text-lg text-ink/40">/{d.total}</span></p>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${d.status === "atingido" ? "bg-teal/15 text-teal" : d.status === "alerta" ? "bg-amber-100 text-amber-900" : "bg-red-100 text-red-700"}`}>
          {d.status === "atingido" ? "no repasse" : d.status}
        </span>
      </div>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-sus-900/10">
        <div className="h-full rounded-full bg-teal" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-xs text-ink/55">Indicadores atingidos · {d.periodo}</p>
    </div>
  );
}

export function WidgetPorId({ id }: { id: string }) {
  if (id === "resumo-tfd") return <WidgetResumoTfd />;
  if (id === "fila-especialidade") return <WidgetFilaEspecialidade />;
  if (id === "agenda-semana") return <WidgetAgendaSemana />;
  if (id === "painel-aps") return <WidgetPainelAps />;
  return <p className="text-xs text-ink/45">Widget removido do catálogo.</p>;
}
