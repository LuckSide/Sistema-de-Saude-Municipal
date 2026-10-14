import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Copy, Eye, Pencil, Plus, Printer, QrCode, RefreshCw, Search, Trash2, X } from "lucide-react";
import {
  tfdAtualizarExame,
  tfdAtualizarExamesLote,
  tfdBuscarPacientesPec,
  tfdCatalogoExames,
  tfdConsultarExamePublico,
  tfdCriarExame,
  tfdExames,
  tfdExcluirExame,
  tfdFiltrosOpcoes,
  tfdPacientes,
  tfdRegenerarTokenExame,
  pagData,
  pagMeta,
  type CatalogoProc,
  type Exame,
  type FilaExamesParams,
  type OpcaoFiltro,
  type Paciente,
  type PacientePec,
} from "../../services/api";
import { Button, Card, Input, Label } from "../../components/ui/primitives";
import { Combobox, type ComboOption } from "../../components/ui/combobox";
import Paginacao from "../../components/Paginacao";

const STATUS = ["aguardando", "agendado", "realizado", "cancelado"];
const PRIOS = ["rotina", "prioritaria", "urgente"];

function hoje(): string {
  return new Date().toISOString().slice(0, 10);
}

function novoForm() {
  return {
    paciente_id: "",
    exame: "",
    codigo_curto: "",
    especialidade: "",
    tipo_fila: "",
    codigo_procedimento: "",
    codigo_especialidade: "",
    nome_especialidade: "",
    prioridade: "rotina",
    status: "aguardando",
    data_pedido: hoje(),
    data_agendada: "",
    destino: "",
    observacoes: "",
  };
}

function fmtData(s: string | null | undefined): string {
  if (!s || typeof s !== "string") return "—";
  const base = s.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(base)) return "—";
  return base.split("-").reverse().join("/");
}

function nomeLimpo(exame: string): string {
  const s = (exame || "").trim();
  const m = s.match(/^[0-9.\-]{4,}\s*-\s*(.+)$/);
  return (m ? m[1] : s).trim() || s;
}

function sigtapDe(exame: string): string {
  const s = (exame || "").trim();
  const m = s.match(/^([0-9.\-]{4,})\s*-/);
  return m ? m[1].trim() : "";
}

function baseAcompanhar(): string {
  const env = (import.meta as any).env?.VITE_PUBLIC_URL as string | undefined;
  if (env) return env.replace(/\/$/, "");
  return window.location.origin;
}

function qrUrl(link: string): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(link)}`;
}

export default function FilaExames() {
  const [lista, setLista] = useState<Exame[]>([]);
  const [filtro, setFiltro] = useState("aguardando");
  const [q, setQ] = useState("");
  const [prio, setPrio] = useState("");
  const [tipoFila, setTipoFila] = useState("");
  const [proc, setProc] = useState("");
  const [espCbo, setEspCbo] = useState("");
  const [opTipos, setOpTipos] = useState<OpcaoFiltro[]>([]);
  const [opProcs, setOpProcs] = useState<OpcaoFiltro[]>([]);
  const [opEsps, setOpEsps] = useState<OpcaoFiltro[]>([]);
  const [dest, setDest] = useState("");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(novoForm());
  const [pacientesPec, setPacientesPec] = useState<PacientePec[]>([]);
  const [pacientesLocais, setPacientesLocais] = useState<Paciente[]>([]);
  const [buscaPac, setBuscaPac] = useState("");
  const [buscaDebounce, setBuscaDebounce] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [catalogo, setCatalogo] = useState<CatalogoProc[]>([]);
  const [buscaExame, setBuscaExame] = useState("");
  const [buscaExameDeb, setBuscaExameDeb] = useState("");
  const [exameFoco, setExameFoco] = useState(false);
  const [catLoading, setCatLoading] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [comprovante, setComprovante] = useState<Exame | null>(null);
  const [detalhe, setDetalhe] = useState<Exame | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [sel, setSel] = useState<number[]>([]);
  const [loteModal, setLoteModal] = useState<"agendar" | "status" | "editar" | null>(null);
  const [loteForm, setLoteForm] = useState({ data_agendada: "", destino: "", status: "", prioridade: "", observacoes: "" });
  const [loteSalvando, setLoteSalvando] = useState(false);

  const idsVisiveis = useMemo(() => lista.map((e) => e.id), [lista]);
  const todosVisiveis = idsVisiveis.length > 0 && idsVisiveis.every((id) => sel.includes(id));
  const algunsVisiveis = idsVisiveis.some((id) => sel.includes(id));

  function toggleUm(id: number) {
    setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }
  function toggleTodos() {
    setSel((s) => (todosVisiveis ? s.filter((id) => !idsVisiveis.includes(id)) : [...new Set([...s, ...idsVisiveis])]));
  }
  function abrirLote(kind: "agendar" | "status" | "editar") {
    setErro("");
    setLoteForm({ data_agendada: "", destino: "", status: "", prioridade: "", observacoes: "" });
    setLoteModal(kind);
  }
  async function salvarLote() {
    if (sel.length === 0) return;
    setLoteSalvando(true);
    setErro("");
    try {
      const payload: Record<string, unknown> = { ids: sel };
      if (loteModal === "agendar") {
        if (!loteForm.data_agendada && !loteForm.destino.trim()) {
          setErro("Informe data agendada e/ou destino.");
          setLoteSalvando(false);
          return;
        }
        if (loteForm.data_agendada) payload.data_agendada = loteForm.data_agendada;
        if (loteForm.destino.trim()) payload.destino = loteForm.destino.trim();
        payload.status = "agendado";
      } else if (loteModal === "status") {
        if (!loteForm.status) {
          setErro("Escolha o novo status.");
          setLoteSalvando(false);
          return;
        }
        payload.status = loteForm.status;
      } else {
        if (!loteForm.prioridade && !loteForm.observacoes.trim()) {
          setErro("Informe prioridade e/ou observações.");
          setLoteSalvando(false);
          return;
        }
        if (loteForm.prioridade) payload.prioridade = loteForm.prioridade;
        if (loteForm.observacoes.trim()) payload.observacoes = loteForm.observacoes.trim();
      }
      const r = await tfdAtualizarExamesLote(payload as { ids: number[] });
      setOk(`${r.atualizados} pedido(s) atualizado(s).`);
      setLoteModal(null);
      setSel([]);
      await carregar();
      carregarOpcoes().catch(() => {});
    } catch {
      setErro("Erro ao atualizar em lote.");
    } finally {
      setLoteSalvando(false);
    }
  }

  async function carregar(p = page, over?: { tipo?: string; proc?: string; esp?: string }) {
    const tipoAtual = over?.tipo !== undefined ? over.tipo : tipoFila;
    const procAtual = over?.proc !== undefined ? over.proc : proc;
    const espAtual = over?.esp !== undefined ? over.esp : espCbo;
    const params: FilaExamesParams = {
      status: filtro || undefined,
      q: q.trim() || undefined,
      prioridade: prio || undefined,
      tipo_fila: tipoAtual.trim() || undefined,
      procedimento: procAtual.trim() || undefined,
      codigo_especialidade: espAtual.trim() || undefined,
      destino: dest.trim() || undefined,
      data_de: de || undefined,
      data_ate: ate || undefined,
      page: p,
      limit: 100,
    };
    const r = await tfdExames(params);
    setLista(pagData<Exame>(r));
    const m = pagMeta(r);
    setTotal(m.total);
    setPage(m.page);
    setPages(m.pages);
  }

  async function carregarOpcoes(st = filtro) {
    try {
      const o = await tfdFiltrosOpcoes(st || undefined);
      setOpTipos(o.tipos ?? []);
      setOpProcs(o.procedimentos ?? []);
      setOpEsps(o.especialidades ?? []);
    } catch {
      setOpTipos([]);
      setOpProcs([]);
      setOpEsps([]);
    }
  }

  useEffect(() => {
    // Marca o body durante a impressão p/ CSS isolar só o comprovante.
    document.body.classList.toggle("imprimindo-comprovante", !!comprovante);
    return () => document.body.classList.remove("imprimindo-comprovante");
  }, [comprovante]);

  useEffect(() => {
    setPage(1);
    setSel([]);
    carregar(1).catch(() => setErro("Falha ao carregar fila."));
    carregarOpcoes().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtro]);

  useEffect(() => {
    tfdPacientes("").then((r) => setPacientesLocais(pagData<Paciente>(r))).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setBuscaDebounce(buscaPac), 250);
    return () => clearTimeout(t);
  }, [buscaPac]);

  useEffect(() => {
    const t = setTimeout(() => setBuscaExameDeb(buscaExame), 200);
    return () => clearTimeout(t);
  }, [buscaExame]);

  useEffect(() => {
    // Abre modal já com catálogo; foco/clica só exibe, digitar refina via API + filtro local.
    if (!modal) return;
    let vivo = true;
    setCatLoading(true);
    tfdCatalogoExames(buscaExameDeb || undefined)
      .then((r) => vivo && setCatalogo(r))
      .catch(() => vivo && setCatalogo([]))
      .finally(() => vivo && setCatLoading(false));
    return () => {
      vivo = false;
    };
  }, [buscaExameDeb, modal]);

  useEffect(() => {
    if (!buscaDebounce || buscaDebounce.length < 2) {
      setPacientesPec([]);
      return;
    }
    let vivo = true;
    setBuscando(true);
    tfdBuscarPacientesPec(buscaDebounce)
      .then((r) => vivo && setPacientesPec(r.resultados))
      .catch(() => vivo && setPacientesPec([]))
      .finally(() => vivo && setBuscando(false));
    return () => {
      vivo = false;
    };
  }, [buscaDebounce]);

  function aplicarFiltros(e?: React.FormEvent) {
    e?.preventDefault();
    setErro("");
    setPage(1);
    carregar(1).catch(() => setErro("Falha ao carregar fila."));
  }

  function escolherExame(c: CatalogoProc) {
    setForm((f) => ({
      ...f,
      exame: c.exame,
      especialidade: c.especialidade || c.nome_especialidade || f.especialidade,
      tipo_fila: c.tipo_fila || f.tipo_fila,
      codigo_procedimento: c.codigo_procedimento || sigtapDe(c.exame) || f.codigo_procedimento,
      codigo_especialidade: c.codigo_especialidade || f.codigo_especialidade,
      nome_especialidade: c.nome_especialidade || c.especialidade || f.nome_especialidade,
      codigo_curto: c.codigo_curto || f.codigo_curto,
    }));
    setBuscaExame("");
    setBuscaExameDeb("");
    setExameFoco(false);
  }

  // Opções vindas do backend com contagem: Tipo / Procedimento / Especialidade-CBO.
  function paraCombo(lista: OpcaoFiltro[]): ComboOption[] {
    return (lista ?? []).map((o) => ({
      value: o.value,
      label: o.label,
      keywords: `${o.value} ${o.label}`,
    }));
  }
  const opcoesTipo = useMemo(() => paraCombo(opTipos), [opTipos]);
  const opcoesProc = useMemo(() => paraCombo(opProcs), [opProcs]);
  const opcoesEsp = useMemo(() => paraCombo(opEsps), [opEsps]);

  useEffect(() => {
    // Opções com contagem p/ Tipo / Procedimento / CBO ao abrir a tela.
    carregarOpcoes("aguardando").catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Catálogo alimenta autocomplete do modal mesmo antes de abrir.
    tfdCatalogoExames().then(setCatalogo).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filtro local imediato: dropdown responde a cada tecla mesmo antes da API voltar.
  const opcoesFiltradas = useMemo(() => {
    const t = buscaExame.trim().toLowerCase();
    if (!t) return catalogo;
    return catalogo.filter((c) =>
      `${c.codigo_curto} ${c.exame} ${c.especialidade} ${nomeLimpo(c.exame)}`.toLowerCase().includes(t)
    );
  }, [buscaExame, catalogo]);

  function abrirModal(id?: number) {
    setErro("");
    setExameFoco(false);
    // Pré-carrega catálogo p/ dropdown abrir imediato no clique.
    tfdCatalogoExames().then(setCatalogo).catch(() => {});
    if (id) {
      const e = lista.find((x) => x.id === id);
      if (e) {
        setEditId(e.id);
        setForm({
          paciente_id: String(e.paciente_id),
          exame: e.exame,
          codigo_curto: e.codigo_curto ?? "",
          especialidade: e.especialidade,
          tipo_fila: e.tipo_fila ?? "",
          codigo_procedimento: e.codigo_procedimento ?? sigtapDe(e.exame),
          codigo_especialidade: e.codigo_especialidade ?? "",
          nome_especialidade: e.nome_especialidade ?? e.especialidade ?? "",
          prioridade: e.prioridade,
          status: e.status,
          data_pedido: (e.data_pedido || "").slice(0, 10),
          data_agendada: (e.data_agendada || "").slice(0, 10),
          destino: e.destino,
          observacoes: e.observacoes,
        });
        setBuscaPac(e.paciente_nome);
        setBuscaExame("");
      }
    } else {
      setEditId(null);
      setForm(novoForm());
      setBuscaPac("");
      setBuscaExame("");
      setBuscaExameDeb("");
    }
    setModal(true);
  }

  function fecharModal() {
    setModal(false);
    setEditId(null);
    setForm(novoForm());
    setBuscaPac("");
    setBuscaDebounce("");
    setPacientesPec([]);
    setBuscaExame("");
    setBuscaExameDeb("");
    setExameFoco(false);
    setErro("");
  }

  async function salvar() {
    setErro("");
    setOk("");
    if (!form.paciente_id || !form.exame.trim() || !form.data_pedido) {
      setErro("Paciente, exame e data do pedido são obrigatórios.");
      return;
    }
    const pid = Number(form.paciente_id);
    if (!Number.isInteger(pid) || pid <= 0) {
      setErro("Paciente inválido.");
      return;
    }
    setSalvando(true);
    // Compat legado: especialidade espelha tipo_fila / nome especialidade.
    const espFinal = (form.nome_especialidade || form.especialidade || form.tipo_fila || "").trim();
    const tipoFinal = (form.tipo_fila || form.especialidade || "").trim().toUpperCase();
    const payload: Record<string, unknown> = {
      ...form,
      exame: form.exame.trim(),
      especialidade: espFinal || tipoFinal,
      tipo_fila: tipoFinal,
      codigo_procedimento: (form.codigo_procedimento || sigtapDe(form.exame) || "").trim(),
      codigo_especialidade: (form.codigo_especialidade || "").replace(/\D/g, "").slice(0, 6),
      nome_especialidade: espFinal,
      codigo_curto: form.codigo_curto.trim().toUpperCase(),
      paciente_id: pid,
      data_agendada: form.data_agendada || null,
    };
    try {
      let salvo: Exame;
      if (editId) {
        salvo = await tfdAtualizarExame(editId, payload);
        setOk("Exame atualizado.");
      } else {
        salvo = await tfdCriarExame(payload);
        setOk("Exame inserido na fila.");
      }
      fecharModal();
      setComprovante(salvo);
      await carregar();
      carregarOpcoes().catch(() => {});
    } catch {
      setErro("Erro ao salvar.");
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(id: number) {
    if (!confirm("Excluir da fila?")) return;
    try {
      await tfdExcluirExame(id);
      setOk("Excluído da fila.");
      await carregar();
    } catch {
      setErro("Erro ao excluir.");
    }
  }

  async function regenerar(id: number) {
    try {
      const e = await tfdRegenerarTokenExame(id);
      setOk("Link de acompanhamento renovado.");
      setComprovante(e);
      await carregar();
    } catch {
      setErro("Erro ao renovar link.");
    }
  }

  function linkAcompanhar(e: Exame): string {
    return `${baseAcompanhar()}/acompanhar/${encodeURIComponent(e.public_token ?? "")}`;
  }

  function copiar(link: string) {
    navigator.clipboard?.writeText(link).then(
      () => setOk("Link copiado."),
      () => setErro("Não foi possível copiar.")
    );
  }

  const badgeTotal = lista.length > 0 ? lista[0].total_fila ?? total : total;
  const prioCor: Record<string, string> = {
    rotina: "bg-sus-900/10 text-sus-900",
    prioritaria: "bg-amber-100 text-amber-800",
    urgente: "bg-red-100 text-red-700",
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <h2 className="font-display text-lg font-bold text-sus-950">Fila de exames e procedimentos</h2>
        <span className="rounded-full bg-teal/10 px-2.5 py-0.5 text-xs font-semibold text-teal">
          {total} no filtro · {badgeTotal} na fila
        </span>
        <select value={filtro} onChange={(e) => setFiltro(e.target.value)} className="ml-auto rounded-xl border border-sus-900/15 bg-white px-3 py-2 text-sm">
          <option value="">Todos</option>
          {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <Button onClick={() => abrirModal()}><Plus className="h-4 w-4" /> Novo pedido</Button>
      </div>
      {erro && !modal && !comprovante && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 print:hidden">{erro}</p>}
      {ok && <p className="mb-3 rounded-xl bg-teal/10 px-3 py-2 text-sm text-teal print:hidden">{ok}</p>}

      <Card className="mb-4 p-4 print:hidden">
        <form onSubmit={aplicarFiltros} className="grid gap-2 md:grid-cols-12">
          <div className="md:col-span-4">
            <Label>Buscar (nome, CNS, CBO ou código)</Label>
            <Input placeholder="Ex: nome, data nasc., CNS, CBO ou código 482917…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <Label>Prioridade</Label>
            <select value={prio} onChange={(e) => setPrio(e.target.value)} className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
              <option value="">Todas</option>
              {PRIOS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <Label>Tipo de fila</Label>
            <Combobox
              value={tipoFila}
              onChange={(v) => {
                setTipoFila(v);
                setPage(1);
                setErro("");
                carregar(1, { tipo: v }).catch(() => setErro("Falha ao carregar fila."));
              }}
              options={opcoesTipo}
              placeholder="Todos os tipos de fila"
              emptyText="Nenhum tipo encontrado"
              searchPlaceholder="Buscar tipo de fila…"
            />
          </div>
          <div className="md:col-span-2">
            <Label>Procedimento</Label>
            <Combobox
              value={proc}
              onChange={(v) => {
                setProc(v);
                setPage(1);
                setErro("");
                carregar(1, { proc: v }).catch(() => setErro("Falha ao carregar fila."));
              }}
              options={opcoesProc}
              placeholder="Todos os procedimentos"
              emptyText="Nenhum procedimento encontrado"
              searchPlaceholder="Buscar código ou nome…"
            />
          </div>
          <div className="md:col-span-2">
            <Label>Especialidade (CBO)</Label>
            <Combobox
              value={espCbo}
              onChange={(v) => {
                setEspCbo(v);
                setPage(1);
                setErro("");
                carregar(1, { esp: v }).catch(() => setErro("Falha ao carregar fila."));
              }}
              options={opcoesEsp}
              placeholder="Todas as especialidades"
              emptyText="Nenhuma especialidade encontrada"
              searchPlaceholder="Buscar especialidade ou CBO…"
            />
          </div>
          <div className="md:col-span-4">
            <Label>Unidade / destino</Label>
            <Input placeholder="Ex: ESF Centro" value={dest} onChange={(e) => setDest(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2 md:col-span-4">
            <div>
              <Label>De</Label>
              <Input type="date" value={de} onChange={(e) => setDe(e.target.value)} />
            </div>
            <div>
              <Label>Até</Label>
              <Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
            </div>
          </div>
          <div className="flex items-end gap-2 md:col-span-4">
            <Button type="submit"><Search className="h-4 w-4" /> Filtrar</Button>
            <button
              type="button"
              onClick={() => { setQ(""); setPrio(""); setTipoFila(""); setProc(""); setEspCbo(""); setDest(""); setDe(""); setAte(""); setFiltro("aguardando"); setPage(1); carregar(1, { tipo: "", proc: "", esp: "" }).catch(() => {}); }}
              className="rounded-xl px-4 py-2.5 text-sm font-semibold text-sus-900 hover:bg-sus-900/5"
            >
              Limpar
            </button>
          </div>
        </form>
      </Card>

      <Card className="overflow-hidden print:hidden">
        {sel.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-sus-900/10 bg-sus-900 px-4 py-2.5 text-sm text-white">
            <span className="font-semibold">{sel.length} selecionado(s)</span>
            <button onClick={() => setSel([])} className="rounded-lg px-2 py-1 text-xs text-white/70 hover:bg-white/10 hover:text-white">Limpar</button>
            <div className="ml-auto flex flex-wrap gap-2">
              <button onClick={() => abrirLote("agendar")} className="rounded-xl bg-teal px-3 py-1.5 text-xs font-bold text-white hover:brightness-110">Agendar em lote</button>
              <button onClick={() => abrirLote("status")} className="rounded-xl bg-white/15 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/25">Alterar status em lote</button>
              <button onClick={() => abrirLote("editar")} className="rounded-xl bg-white/15 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/25">Modificar em conjunto</button>
            </div>
          </div>
        )}
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b border-sus-900/10 bg-sand text-xs uppercase text-sus-900/60">
            <th className="w-10 px-3 py-3">
              <input type="checkbox" checked={todosVisiveis} ref={(el) => { if (el) el.indeterminate = !todosVisiveis && algunsVisiveis; }} onChange={toggleTodos} aria-label="Selecionar todos visíveis" className="h-4 w-4 accent-teal" />
            </th>
            <th className="px-4 py-3">Posição*</th><th className="px-4 py-3">Paciente</th><th className="px-4 py-3">Exame</th><th className="px-4 py-3">Prioridade</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Ações</th>          </tr></thead>
          <tbody>
            {lista.map((e) => (
              <tr key={e.id} className={`border-b border-sus-900/5 last:border-0 ${sel.includes(e.id) ? "bg-teal/5" : ""}`}>
                <td className="px-3 py-3">
                  <input type="checkbox" checked={sel.includes(e.id)} onChange={() => toggleUm(e.id)} aria-label={`Selecionar pedido ${e.id}`} className="h-4 w-4 accent-teal" />
                </td>
                <td className="px-4 py-3 font-display text-base font-extrabold text-sus-900">
                  {e.posicao ? `${e.posicao}º` : "—"}
                  {e.total_fila ? <span className="block text-[10px] font-normal text-ink/45">de {e.total_fila}</span> : null}
                </td>
                <td className="px-4 py-3 font-semibold">{e.paciente_nome}<p className="text-xs font-normal text-ink/50">pedido {fmtData(e.data_pedido)} {e.destino ? `· ${e.destino}` : ""}</p></td>
                <td className="px-4 py-3">{nomeLimpo(e.exame)}<p className="text-xs text-ink/50">{e.especialidade || "—"}</p></td>
                <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${prioCor[e.prioridade] ?? ""}`}>{e.prioridade}</span></td>
                <td className="px-4 py-3 text-xs">{e.status}{e.data_agendada ? ` · ${fmtData(e.data_agendada)}` : ""}</td>
                <td className="px-4 py-3"><div className="flex justify-end gap-1">
                  <button onClick={() => setDetalhe(e)} className="rounded-lg p-2 text-sus-900 hover:bg-sand" title="Detalhes"><Eye className="h-4 w-4" /></button>
                  {e.public_token && (
                    <button onClick={() => setComprovante(e)} className="rounded-lg p-2 text-teal hover:bg-teal/10" title="Comprovante / QR"><QrCode className="h-4 w-4" /></button>
                  )}
                  <button onClick={() => abrirModal(e.id)} className="rounded-lg p-2 text-sus-800 hover:bg-sus-100" title="Editar"><Pencil className="h-4 w-4" /></button>
                  <button onClick={() => excluir(e.id)} className="rounded-lg p-2 text-red-600 hover:bg-red-50" title="Excluir"><Trash2 className="h-4 w-4" /></button>
                </div></td>
              </tr>
            ))}
            {lista.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-ink/45">Fila vazia.</td></tr>}
          </tbody>
        </table>
        <p className="bg-sand/50 px-4 py-2 text-[11px] text-ink/50">* Posição dentro do mesmo procedimento/tipo de serviço.{total > 0 ? ` ${total} registro(s) no filtro.` : ""}{sel.length > 0 ? ` ${sel.length} selecionado(s) no total.` : ""}</p>
        <Paginacao page={page} pages={pages} total={total} onPage={(p) => { setPage(p); carregar(p).catch(() => setErro("Falha ao carregar fila.")); }} />
      </Card>

      {loteModal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4 print:hidden" onClick={() => setLoteModal(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl bg-white p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <p className="font-display text-base font-bold text-sus-950">
                {loteModal === "agendar" ? `Agendar ${sel.length} pedido(s)` : loteModal === "status" ? `Alterar status de ${sel.length} pedido(s)` : `Modificar ${sel.length} pedido(s)`}
              </p>
              <button onClick={() => setLoteModal(null)} className="rounded-lg p-2 text-ink/50 hover:bg-sand" aria-label="Fechar"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3">
              {loteModal === "agendar" && (
                <>
                  <div><Label>Data agendada</Label><Input type="date" value={loteForm.data_agendada} onChange={(e) => setLoteForm({ ...loteForm, data_agendada: e.target.value })} /></div>
                  <div><Label>Unidade / destino</Label><Input value={loteForm.destino} onChange={(e) => setLoteForm({ ...loteForm, destino: e.target.value })} placeholder="Cidade / unidade" /></div>
                  <p className="text-xs text-ink/55">Status muda para <b>agendado</b>. Campos vazios mantêm valor atual.</p>
                </>
              )}
              {loteModal === "status" && (
                <div>
                  <Label>Novo status</Label>
                  <select value={loteForm.status} onChange={(e) => setLoteForm({ ...loteForm, status: e.target.value })} className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
                    <option value="">Escolher…</option>
                    {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              )}
              {loteModal === "editar" && (
                <>
                  <div>
                    <Label>Prioridade</Label>
                    <select value={loteForm.prioridade} onChange={(e) => setLoteForm({ ...loteForm, prioridade: e.target.value })} className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
                      <option value="">Manter atual</option>
                      {PRIOS.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div><Label>Observações</Label><Input value={loteForm.observacoes} onChange={(e) => setLoteForm({ ...loteForm, observacoes: e.target.value })} placeholder="Vazio mantém valor atual" /></div>
                </>
              )}
              {erro && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
              <Button onClick={salvarLote} disabled={loteSalvando} className="w-full">
                {loteSalvando ? "Aplicando…" : `Aplicar a ${sel.length} pedido(s)`}
              </Button>
            </div>
          </div>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-sus-950/50 p-4 print:hidden" onClick={fecharModal}>
          <div className="max-h-[90vh] w-full max-w-4xl overflow-auto rounded-2xl bg-white p-6 shadow-card md:p-8" onClick={(e) => e.stopPropagation()}>
            <div className="mb-5 flex items-center justify-between">
              <p className="font-display text-lg font-bold text-sus-950">{editId ? "Editar pedido" : "Novo pedido na fila"}</p>
              <button onClick={fecharModal} className="rounded-lg p-2 text-ink/50 hover:bg-sand" aria-label="Fechar"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-5">
              {/* Paciente */}
              <section>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-sus-900/55">Paciente</p>
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="md:col-span-3">
                    <Label>Paciente *</Label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/40" />
                      <Input
                        placeholder="Buscar nome/CPF/CNS/prontuário…"
                        value={buscaPac}
                        onChange={(e) => setBuscaPac(e.target.value)}
                        className="pl-10"
                      />
                    </div>
                    {buscando && <p className="mt-1 text-center text-xs text-ink/45">Buscando…</p>}
                    {pacientesPec.length > 0 && (
                      <div className="mt-1 max-h-40 overflow-y-auto rounded-xl border border-sus-900/10 bg-white">
                        {pacientesPec.slice(0, 15).map((p, i) => (
                          <button
                            key={`${p.origem}-${p.id ?? "pec"}-${i}`}
                            onClick={() => {
                              if (p.origem === "pec" && p.id === null) {
                                setErro("Paciente do PEC ainda sem cadastro local — selecione um paciente local abaixo.");
                                return;
                              }
                              setForm({ ...form, paciente_id: String(p.id!) });
                              setBuscaPac(p.nome);
                              setPacientesPec([]);
                            }}
                            className="flex w-full items-center justify-between border-b border-sus-900/5 px-3 py-2 text-left text-sm last:border-0 hover:bg-sand"
                          >
                            <div className="flex flex-col">
                              <span className="font-medium">{p.nome}</span>
                              <div className="flex flex-wrap gap-2 text-xs text-ink/45">
                                {p.cpf && <span>{p.cpf}</span>}
                                {p.cns && <span>CNS {p.cns}</span>}
                                {p.prontuario && <span>Pront. {p.prontuario}</span>}
                                <span className={p.origem === "pec" ? "text-teal" : "text-sus-900"}>{p.origem === "pec" ? "PEC" : "Local"}</span>
                              </div>
                            </div>
                            <Plus className="h-4 w-4 text-teal" />
                          </button>
                        ))}
                      </div>
                    )}
                    {buscaDebounce && buscaDebounce.length >= 2 && !buscando && pacientesPec.length === 0 && (
                      <p className="mt-1 text-center text-xs text-ink/45">Nenhum paciente encontrado.</p>
                    )}
                    <select value={form.paciente_id} onChange={(e) => setForm({ ...form, paciente_id: e.target.value })} className="mt-1 w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
                      <option value="">Ou selecionar paciente local…</option>
                      {pacientesLocais
                        .filter((p) => !buscaPac || p.nome.toLowerCase().includes(buscaPac.toLowerCase()))
                        .slice(0, 20).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                    </select>
                  </div>
                </div>
              </section>
              {/* Procedimento */}
              <section>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-sus-900/55">Exame / procedimento</p>
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="md:col-span-2">
                    <Label>Exame / procedimento (código, curto ou nome) *</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/40" />
                    <Input
                      placeholder="Clique p/ ver opções ou digite: mamografia, USG…"
                      value={buscaExame}
                      onChange={(e) => {
                        setBuscaExame(e.target.value);
                        setExameFoco(true);
                      }}
                      onFocus={() => setExameFoco(true)}
                      onBlur={() => setTimeout(() => setExameFoco(false), 200)}
                      onClick={() => setExameFoco(true)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setExameFoco(false);
                        if (e.key === "Enter" && opcoesFiltradas.length > 0) {
                          e.preventDefault();
                          escolherExame(opcoesFiltradas[0]);
                        }
                      }}
                      className="pl-10 pr-10"
                      autoComplete="off"
                    />
                    {form.exame && (
                      <button
                        type="button"
                        title="Limpar seleção"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setForm({ ...form, exame: "", especialidade: "", codigo_curto: "" });
                          setBuscaExame("");
                          setExameFoco(true);
                        }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-ink/40 hover:bg-sand hover:text-ink"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  {form.exame && (
                    <p className="mt-1 truncate rounded-lg bg-teal/10 px-2.5 py-1 text-xs font-semibold text-teal" title={form.exame}>
                      Selecionado: {nomeLimpo(form.exame)}{form.codigo_curto ? ` · ${form.codigo_curto}` : ""}
                    </p>
                  )}
                  {exameFoco && (
                    <div className="mt-1 max-h-56 overflow-y-auto rounded-xl border border-sus-900/10 bg-white shadow-card">
                      <p className="sticky top-0 border-b border-sus-900/5 bg-sand/70 px-3 py-1.5 text-[11px] font-semibold text-sus-900/60">
                        {catLoading && catalogo.length === 0
                          ? "Buscando…"
                          : opcoesFiltradas.length > 0
                            ? `${opcoesFiltradas.length} opção(ões) — clique p/ selecionar`
                            : "Nenhuma opção p/ este filtro"}
                      </p>
                      {opcoesFiltradas.map((c) => (
                        <button
                          key={`${c.codigo_curto}-${c.exame}`}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => escolherExame(c)}
                          className="flex w-full items-center justify-between gap-2 border-b border-sus-900/5 px-3 py-2 text-left text-sm last:border-0 hover:bg-sand"
                        >
                          <span>
                            <span className="font-semibold">{c.codigo_curto ? `${c.codigo_curto} · ` : ""}{nomeLimpo(c.exame)}</span>
                            <span className="block text-xs text-ink/50">{c.especialidade} · {c.usos} na fila{sigtapDe(c.exame) ? ` · SIGTAP ${sigtapDe(c.exame)}` : ""}</span>
                          </span>
                          <Plus className="h-4 w-4 shrink-0 text-teal" />
                        </button>
                      ))}
                      {!catLoading && buscaExame.trim().length >= 2 && (
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setForm({ ...form, exame: buscaExame.trim() });
                            setBuscaExame("");
                            setExameFoco(false);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-sus-900 hover:bg-sand"
                        >
                          <Plus className="h-3.5 w-3.5" /> Usar texto digitado: “{buscaExame.trim()}”
                        </button>
                      )}
                    </div>
                  )}
                  <div className="mt-1 grid grid-cols-2 gap-2">
                    <Input
                      placeholder="Código curto (ex: MAMO, USG-TV)"
                      value={form.codigo_curto}
                      onChange={(e) => setForm({ ...form, codigo_curto: e.target.value.toUpperCase() })}
                    />
                    <Input
                      placeholder="Valor exato p/ registro"
                      value={form.exame}
                      onChange={(e) => { setForm({ ...form, exame: e.target.value }); setBuscaExame(e.target.value); }}
                    />
                  </div>
                </div>
                <div>
                  <Label>Tipo de fila *</Label>
                  <Input value={form.tipo_fila} onChange={(e) => setForm({ ...form, tipo_fila: e.target.value.toUpperCase() })} placeholder="Ex: ULTRASSONOGRAFIA" list="tipos-fila-datalist" />
                  <datalist id="tipos-fila-datalist">
                    {opTipos.map((o) => <option key={o.value} value={o.value} />)}
                  </datalist>
                </div>
                </div>
              </section>
              {/* Classificação */}
              <section>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-sus-900/55">Classificação</p>
                <div className="grid gap-4 md:grid-cols-3">
                  <div><Label>Código procedimento</Label><Input value={form.codigo_procedimento} onChange={(e) => setForm({ ...form, codigo_procedimento: e.target.value })} placeholder="Ex: 0205020186" /></div>
                  <div><Label>Especialidade / CBO nome</Label><Input value={form.nome_especialidade || form.especialidade} onChange={(e) => setForm({ ...form, nome_especialidade: e.target.value, especialidade: e.target.value })} placeholder="Ex: Médico urologista" /></div>
                  <div><Label>CBO</Label><Input value={form.codigo_especialidade} onChange={(e) => setForm({ ...form, codigo_especialidade: e.target.value.replace(/\D/g, "").slice(0, 6) })} placeholder="Ex: 225285" inputMode="numeric" /></div>
                </div>
              </section>
              {/* Situação e datas */}
              <section>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-sus-900/55">Situação e datas</p>
                <div className="grid gap-4 md:grid-cols-4">
                  <div>
                    <Label>Prioridade</Label>
                    <select value={form.prioridade} onChange={(e) => setForm({ ...form, prioridade: e.target.value })} className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
                      {PRIOS.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div>
                    <Label>Status</Label>
                    <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
                      {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div><Label>Data pedido *</Label><Input type="date" value={form.data_pedido} onChange={(e) => setForm({ ...form, data_pedido: e.target.value })} /></div>
                  <div><Label>Data agendada</Label><Input type="date" value={form.data_agendada} onChange={(e) => setForm({ ...form, data_agendada: e.target.value })} /></div>
                </div>
              </section>
              {/* Destino e observações */}
              <section>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-sus-900/55">Destino e observações</p>
                <div className="grid gap-4 md:grid-cols-3">
                  <div><Label>Destino / unidade</Label><Input value={form.destino} onChange={(e) => setForm({ ...form, destino: e.target.value })} placeholder="Cidade / unidade" /></div>
                  <div className="md:col-span-2"><Label>Observações</Label><Input value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} /></div>
                </div>
              </section>
              {erro && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
              <Button onClick={salvar} disabled={salvando} className="w-full"><Plus className="h-4 w-4" />{salvando ? "Salvando…" : editId ? "Atualizar" : "Entrar na fila"}</Button>
            </div>
          </div>
        </div>
      )}

      {comprovante && createPortal(
        <div id="comprovante-overlay" className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4" onClick={() => setComprovante(null)}>
          <div id="comprovante-print" className="max-h-[90vh] w-full max-w-md overflow-auto rounded-2xl bg-white p-6 shadow-card print:block print:max-h-none print:w-full print:max-w-none print:overflow-visible print:rounded-none print:p-0 print:shadow-none" onClick={(e) => e.stopPropagation()}>
            <div className="comprovante-header mb-4 flex items-center justify-between print:hidden">
              <p className="flex items-center gap-2 font-display text-base font-bold text-sus-950">
                <CheckCircle2 className="h-5 w-5 text-teal" /> Comprovante do pedido
              </p>
              <button onClick={() => setComprovante(null)} className="rounded-lg p-2 text-ink/50 hover:bg-sand" aria-label="Fechar"><X className="h-4 w-4" /></button>
            </div>
            <div id="comprovante-dados" className="rounded-2xl border border-sus-900/10 p-4 text-sm print:block">
              <p className="font-display text-base font-bold text-sus-950">{comprovante.exame}</p>
              <p className="text-xs text-ink/55">{comprovante.especialidade || "—"} · {comprovante.prioridade} · pedido {fmtData(comprovante.data_pedido)}</p>
              <p className="mt-2 font-semibold">{comprovante.paciente_nome}</p>
              <p className="mt-1 text-xs text-ink/60">
                Status: <b>{comprovante.status}</b>
                {comprovante.posicao ? ` · posição ${comprovante.posicao}º no procedimento (de ${comprovante.total_fila ?? "—"})` : ""}
              </p>
              {comprovante.public_token && (
                <>
                  <div className="mt-3 grid place-items-center rounded-xl bg-sand/60 p-3 print:block print:bg-white print:p-0">
                    <img src={qrUrl(linkAcompanhar(comprovante))} alt="QR Code acompanhamento" className="h-44 w-44 print:block" loading="lazy" />
                    <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-sus-900"><QrCode className="h-3.5 w-3.5 print:hidden" /> Escaneie para acompanhar</p>
                  </div>
                  <p className="mt-2 break-all rounded-xl bg-sand/60 px-3 py-2 text-xs text-sus-900 print:block print:bg-white print:px-0">{linkAcompanhar(comprovante)}</p>
                </>
              )}
            </div>
            <div className="comprovante-acoes mt-3 grid grid-cols-2 gap-2 print:hidden">
              {comprovante.public_token && (
                <Button onClick={() => copiar(linkAcompanhar(comprovante))} className="!w-auto"><Copy className="h-4 w-4" /> Copiar link</Button>
              )}
              <button onClick={() => window.print()} className="flex items-center justify-center gap-2 rounded-xl bg-sus-900/10 px-4 py-2.5 text-sm font-semibold text-sus-900 hover:bg-sus-900/15">
                <Printer className="h-4 w-4" /> Imprimir
              </button>
            </div>
            <button onClick={() => regenerar(comprovante.id)} className="comprovante-extra mt-2 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold text-sus-900/60 hover:bg-sand print:hidden">
              <RefreshCw className="h-3.5 w-3.5" /> Renovar link de acompanhamento
            </button>
            {comprovante.public_token && (
              <div className="comprovante-extra print:hidden">
                <ComprovanteCheck token={comprovante.public_token} />
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
      {detalhe && (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-sus-950/50 p-4 print:hidden" onClick={() => setDetalhe(null)}>
          <div className="max-h-[90vh] w-full max-w-5xl overflow-auto rounded-2xl bg-white p-6 shadow-card md:p-8" onClick={(e) => e.stopPropagation()}>
            <div className="mb-5 flex items-center justify-between">
              <p className="flex items-center gap-2 font-display text-lg font-bold text-sus-950">
                <Eye className="h-5 w-5 text-sus-900" /> Detalhes do pedido #{detalhe.id}
              </p>
              <button onClick={() => setDetalhe(null)} className="rounded-lg p-2 text-ink/50 hover:bg-sand" aria-label="Fechar"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid gap-4 text-sm lg:grid-cols-3">
              <div className="space-y-4 lg:col-span-2">
              <div className="rounded-2xl border border-sus-900/10 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-sus-900/50">Paciente</p>
                <p className="mt-1 text-base font-bold text-sus-950">{detalhe.paciente_nome}</p>
                {detalhe.posicao ? (
                  <p className="mt-1 text-xs text-ink/60">
                    Posição <b>{detalhe.posicao}º</b> no procedimento (de {detalhe.total_fila ?? "—"})
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-ink/60">Fora da fila ativa (status {detalhe.status}).</p>
                )}
              </div>
              <div className="rounded-2xl border border-sus-900/10 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-sus-900/50">Exame / procedimento</p>
                <p className="mt-1 font-display text-base font-bold text-sus-950">{nomeLimpo(detalhe.exame)}</p>
                <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2.5 text-xs md:grid-cols-3">
                  <div><dt className="text-ink/45">Código SIGTAP</dt><dd className="font-semibold">{sigtapDe(detalhe.exame) || detalhe.codigo_procedimento || "—"}</dd></div>
                  <div><dt className="text-ink/45">Código curto</dt><dd className="font-semibold">{detalhe.codigo_curto || "—"}</dd></div>
                  <div><dt className="text-ink/45">Tipo de fila</dt><dd className="font-semibold">{detalhe.tipo_fila || "—"}</dd></div>
                  <div><dt className="text-ink/45">Tipo / especialidade</dt><dd className="font-semibold">{detalhe.especialidade || "—"}</dd></div>
                  <div><dt className="text-ink/45">Especialidade (CBO)</dt><dd className="font-semibold">{detalhe.nome_especialidade || "—"}{detalhe.codigo_especialidade ? ` · ${detalhe.codigo_especialidade}` : ""}</dd></div>
                  <div><dt className="text-ink/45">Prioridade</dt><dd className="font-semibold">{detalhe.prioridade}</dd></div>
                  <div><dt className="text-ink/45">Status</dt><dd className="font-semibold">{detalhe.status}</dd></div>
                  <div><dt className="text-ink/45">Data pedido</dt><dd className="font-semibold">{fmtData(detalhe.data_pedido)}</dd></div>
                  <div><dt className="text-ink/45">Data agendada</dt><dd className="font-semibold">{fmtData(detalhe.data_agendada)}</dd></div>
                  <div><dt className="text-ink/45">Destino</dt><dd className="font-semibold">{detalhe.destino || "—"}</dd></div>
                </dl>
                {detalhe.observacoes && (
                  <p className="mt-2 rounded-xl bg-sand/60 px-3 py-2 text-xs text-ink/70">{detalhe.observacoes}</p>
                )}
                <p className="mt-2 break-all text-[11px] text-ink/40" title="Registro completo (legado)">{detalhe.exame}</p>
              </div>
              </div>
              <div className="space-y-4">
              <div className="rounded-2xl border border-sus-900/10 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-sus-900/50">Rastreio público</p>
                {detalhe.public_token ? (
                  <>
                    <div className="mt-2 grid place-items-center rounded-xl bg-sand/60 p-3">
                      <img src={qrUrl(linkAcompanhar(detalhe))} alt="QR Code acompanhamento" className="h-48 w-48" loading="lazy" />
                      <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-sus-900"><QrCode className="h-3.5 w-3.5" /> Escaneie para acompanhar</p>
                    </div>
                    <p className="mt-2 break-all rounded-xl bg-sand/60 px-3 py-2 text-xs text-sus-900">{linkAcompanhar(detalhe)}</p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <Button onClick={() => copiar(linkAcompanhar(detalhe))} className="!w-auto"><Copy className="h-4 w-4" /> Copiar link</Button>
                      <button onClick={() => { setComprovante(detalhe); setDetalhe(null); }} className="flex items-center justify-center gap-2 rounded-xl bg-sus-900/10 px-4 py-2.5 text-sm font-semibold text-sus-900 hover:bg-sus-900/15">
                        <Printer className="h-4 w-4" /> Comprovante
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="mt-1 text-xs text-ink/55">Sem token gerado.</p>
                )}
              </div>
              <div className="grid grid-cols-1 gap-2">
                <Button onClick={() => { const id = detalhe.id; setDetalhe(null); abrirModal(id); }} className="!w-auto"><Pencil className="h-4 w-4" /> Editar</Button>
                <button onClick={() => { setDetalhe(null); regenerar(detalhe.id); }} className="flex items-center justify-center gap-2 rounded-xl bg-sus-900/10 px-4 py-2.5 text-sm font-semibold text-sus-900 hover:bg-sus-900/15">
                  <RefreshCw className="h-4 w-4" /> Renovar link
                </button>
              </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ComprovanteCheck({ token }: { token: string }) {
  const [msg, setMsg] = useState("");
  useEffect(() => {
    tfdConsultarExamePublico(token).then(
      () => setMsg(""),
      () => setMsg("Link público indisponível no momento.")
    );
  }, [token]);
  if (!msg) return null;
  return <p className="mt-2 text-center text-xs text-red-600 print:hidden">{msg}</p>;
}
