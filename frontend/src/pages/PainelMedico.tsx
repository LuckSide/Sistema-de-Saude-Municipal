import { useEffect, useMemo, useState } from "react";
import { Pencil, Search, X } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import {
  tfdAlterarPrioridade,
  tfdExames,
  pagData,
  pagMeta,
  type Exame,
} from "../services/api";
import { Button, Card, Input, Label } from "../components/ui/primitives";
import Paginacao from "../components/Paginacao";
import { rotuloPrioridade } from "../utils/rotulos";
import ExportarExcel from "../components/ExportarExcel";

const PRIOS = [
  { value: "urgente", rotulo: "Urgente" },
  { value: "rotina", rotulo: "Eletivo" },
];

const prioCor: Record<string, string> = {
  rotina: "bg-sus-900/10 text-sus-900",
  urgente: "bg-red-100 text-red-700",
};


export default function PainelMedico() {
  const { user, podeAlterarPrioridade } = useAuth();
  const [lista, setLista] = useState<Exame[]>([]);
  const [q, setQ] = useState("");
  const [soMeus, setSoMeus] = useState(true);
  const [statusFiltro, setStatusFiltro] = useState("aguardando");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [alvo, setAlvo] = useState<Exame | null>(null);
  const [prio, setPrio] = useState("rotina");
  const [just, setJust] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erroModal, setErroModal] = useState("");

  async function carregar(p = 1, meus = soMeus, termo = q, st = statusFiltro) {
    try {
      const r = await tfdExames({ status: st || undefined, q: termo.trim() || undefined, meus, page: p, limit: 50 });
      setLista(pagData<Exame>(r));
      const m = pagMeta(r);
      setTotal(m.total);
      setPage(m.page);
      setPages(m.pages);
    } catch {
      setErro("Falha ao carregar encaminhamentos.");
    }
  }

  useEffect(() => {
    carregar(1, true, "").catch(() => setErro("Falha ao carregar encaminhamentos."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const vinculados = useMemo(() => lista.filter((e) => podeAlterarPrioridade(e.medico_id)), [lista, podeAlterarPrioridade]);

  function abrir(e: Exame) {
    setAlvo(e);
    setPrio(e.prioridade);
    setJust(e.justificativa_prioridade ?? "");
    setErroModal("");
  }

  async function salvar() {
    if (!alvo) return;
    const texto = just.trim();
    if (texto.length < 12) {
      setErroModal("A justificativa deve conter no mínimo 12 caracteres.");
      return;
    }
    setSalvando(true);
    try {
      await tfdAlterarPrioridade(alvo.id, { prioridade: prio, justificativa: texto });
      setOk("Prioridade atualizada com justificativa registrada.");
      setAlvo(null);
      await carregar(page);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? "Erro ao salvar.";
      setErroModal(msg);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h1 className="font-display text-2xl font-extrabold text-sus-950">Painel Médico</h1>
        <span className="rounded-full bg-teal/10 px-2.5 py-0.5 text-xs font-semibold text-teal">
          {user?.is_superuser ? "Superuser" : "Perfil Médico"} · {total} em acompanhamento
        </span>
        <span className="ml-auto"><ExportarExcel url="/api/tfd/exames/exportar" arquivo="painel_medico" params={{ status: statusFiltro || undefined, q: q.trim() || undefined, meus: soMeus || undefined }} /></span>
      </div>
      <p className="mb-4 mt-1 text-sm text-ink/55">
        Somente o médico envolvido na solicitação/atendimento altera prioridade, sempre com justificativa técnica (mín. 12 caracteres).
      </p>
      {erro && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
      {ok && <p className="mb-3 rounded-xl bg-teal/10 px-3 py-2 text-sm text-teal">{ok}</p>}

      <Card className="mb-4 p-4">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => { e.preventDefault(); carregar(1, soMeus, q).catch(() => {}); }}
        >
          <div className="min-w-52 flex-1">
            <Label>Buscar (paciente, exame, código)</Label>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ex: nome, CNS, procedimento…" />
          </div>
          <div>
            <Label>Status</Label>
            <select value={statusFiltro} onChange={(e) => setStatusFiltro(e.target.value)} className="min-h-[44px] rounded-xl border border-sus-900/15 bg-white px-3 py-2 text-sm">
              <option value="">Todos</option>
              <option value="aguardando">Aguardando</option>
              <option value="agendado">Marcado</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setSoMeus(true); setPage(1); carregar(1, true, q).catch(() => {}); }}
              className={`min-h-[44px] rounded-xl px-4 py-2 text-sm font-bold ${soMeus ? "bg-teal text-white" : "bg-sus-900/10 text-sus-900 hover:bg-sus-900/15"}`}
            >
              Meus encaminhamentos
            </button>
            <button
              type="button"
              onClick={() => { setSoMeus(false); setPage(1); carregar(1, false, q).catch(() => {}); }}
              className={`min-h-[44px] rounded-xl px-4 py-2 text-sm font-bold ${!soMeus ? "bg-teal text-white" : "bg-sus-900/10 text-sus-900 hover:bg-sus-900/15"}`}
            >
              Todos
            </button>
            <Button type="submit"><Search className="h-4 w-4" /> Filtrar</Button>
          </div>
        </form>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-sus-900/10 bg-sand text-xs uppercase text-sus-900/60">
              <th className="px-4 py-3">Paciente</th><th className="px-4 py-3">Exame / especialidade</th><th className="px-4 py-3">Risco</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Ações</th>
            </tr></thead>
            <tbody>
              {lista.map((e) => {
                const pode = podeAlterarPrioridade(e.medico_id);
                return (
                  <tr key={e.id} className="border-b border-sus-900/5 last:border-0">
                    <td className="px-4 py-3 font-semibold">{e.paciente_nome}</td>
                    <td className="px-4 py-3">{e.exame}<p className="text-xs text-ink/50">{e.nome_especialidade || e.especialidade || "—"}</p></td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${prioCor[e.prioridade] ?? ""}`}>{rotuloPrioridade(e.prioridade)}</span></td>
                    <td className="px-4 py-3 text-xs">{e.status}</td>
                    <td className="px-4 py-3"><div className="flex justify-end">
                      {pode ? (
                        <button onClick={() => abrir(e)} className="rounded-lg p-2 text-teal hover:bg-teal/10" title="Alterar prioridade"><Pencil className="h-4 w-4" /></button>
                      ) : (
                        <span className="px-2 py-2 text-[11px] text-ink/40" title="Somente o médico envolvido altera prioridade">somente leitura</span>
                      )}
                    </div></td>
                  </tr>
                );
              })}
              {lista.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-ink/45">Nenhum encaminhamento.</td></tr>}
            </tbody>
          </table>
        </div>
        <Paginacao page={page} pages={pages} total={total} onPage={(p) => carregar(p).catch(() => setErro("Falha ao carregar."))} />
      </Card>
      {vinculados.length === 0 && lista.length > 0 && (
        <p className="mt-2 text-xs text-ink/50">Nenhum item vinculado a você neste filtro — prioridade e justificativa em modo somente leitura.</p>
      )}

      {alvo && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4" onClick={() => setAlvo(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl bg-white p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <p className="font-display text-base font-bold text-sus-950">Alterar prioridade #{alvo.id}</p>
              <button onClick={() => setAlvo(null)} className="rounded-lg p-2 text-ink/50 hover:bg-sand" aria-label="Fechar"><X className="h-4 w-4" /></button>
            </div>
            <p className="mb-3 text-sm text-ink/60">{alvo.paciente_nome} · {alvo.exame}</p>
            <div className="space-y-3">
              <div>
                <Label>Prioridade</Label>
                <select value={prio} onChange={(e) => setPrio(e.target.value)} className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
                  {PRIOS.map((p) => <option key={p.value} value={p.value}>{p.rotulo}</option>)}
                </select>
              </div>
              <div>
                <Label>Justificativa técnica * (mín. 12 caracteres)</Label>
                <textarea
                  value={just}
                  onChange={(e) => setJust(e.target.value)}
                  rows={4}
                  maxLength={500}
                  placeholder="Descreva o motivo clínico da prioridade…"
                  className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm outline-none focus:border-teal"
                />
                <p className={`mt-1 text-xs ${just.trim().length < 12 ? "text-red-600" : "text-teal"}`}>
                  {just.trim().length}/12 caracteres mínimos
                </p>
              </div>
              {erroModal && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erroModal}</p>}
              <Button onClick={salvar} disabled={salvando} className="w-full">{salvando ? "Salvando…" : "Salvar prioridade"}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
