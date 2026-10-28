import { useEffect, useMemo, useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Clock, FileWarning, Pencil, Plus, Search, ShieldAlert, Trash2, X } from "lucide-react";
import {
  tfdAtualizarMotorista,
  tfdCriarMotorista,
  tfdExcluirMotorista,
  tfdMotoristas,
  pagData,
  pagMeta,
  type Motorista,
} from "../../services/api";
import { Button, Card, Input, Label } from "../../components/ui/primitives";
import { useUndo } from "../../components/UndoToast";
import { useConfirm } from "../../components/ConfirmDialog";
import {
  erros422,
  toastCampos,
  validaCnh,
  validaCnhValidade,
  validaCpf,
  validaTelefone,
} from "../../utils/validacoes";
import Paginacao from "../../components/Paginacao";

const CATEGORIAS = ["", "A", "B", "C", "D", "E", "AB", "AC", "AD", "AE"];

const vazio = {
  nome: "", cpf: "", cnh_numero: "", cnh_categoria: "",
  cnh_validade: "", toxicologico_validade: "", telefone: "", ativo: true,
};

function fmtValidade(s: string | null | undefined): string {
  if (!s) return "—";
  const b = s.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(b) ? b.split("-").reverse().join("/") : s;
}

export function statusToxicologico(dataStr: string | null | undefined, categoria: string): {
  status: "regular" | "vencendo" | "vencido" | "nao_informado";
  rotulo: string;
  classe: string;
  diasRestantes?: number;
} {
  const exige = ["C", "D", "E"].some((cat) => (categoria || "").toUpperCase().includes(cat));
  if (!dataStr) {
    return {
      status: "nao_informado",
      rotulo: exige ? `Não informado (Exigido cat. ${categoria || "C/D/E"})` : "Não informado / Isento",
      classe: exige ? "bg-amber-100 text-amber-900 border-amber-300 font-bold" : "bg-slate-100 text-slate-600 border-slate-200",
    };
  }
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const dataVal = new Date(dataStr.slice(0, 10) + "T00:00:00");
  const diffTime = dataVal.getTime() - hoje.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return {
      status: "vencido",
      rotulo: `Vencido há ${Math.abs(diffDays)} dia(s)`,
      classe: "bg-red-100 text-red-700 border-red-300 font-bold",
      diasRestantes: diffDays,
    };
  }
  if (diffDays <= 30) {
    return {
      status: "vencendo",
      rotulo: `Vence em ${diffDays} dia(s)`,
      classe: "bg-amber-100 text-amber-800 border-amber-300 font-bold",
      diasRestantes: diffDays,
    };
  }
  return {
    status: "regular",
    rotulo: `Válido (${dataStr.slice(0, 10).split("-").reverse().join("/")})`,
    classe: "bg-emerald-50 text-emerald-700 border-emerald-200",
    diasRestantes: diffDays,
  };
}

export default function TfdMotoristas() {
  const { notificarUndo } = useUndo();
  const { confirmar } = useConfirm();
  const [lista, setLista] = useState<Motorista[]>([]);
  const [q, setQ] = useState("");
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(vazio);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [erros, setErros] = useState<Record<string, string>>({});
  const ROTULOS: Record<string, string> = {
    nome: "Nome completo", cpf: "CPF", cnh_numero: "CNH",
    cnh_validade: "Validade da CNH", telefone: "Telefone",
  };
  const borda = (c: string) => (erros[c] ? "!border-red-500 focus:!border-red-500" : "");
  const campoMsg = (c: string) =>
    erros[c] ? <p className="mt-1 text-xs font-medium text-red-600">{erros[c]}</p> : null;
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [carregando, setCarregando] = useState(false);

  // Filtros rápidos
  const [filtroToxi, setFiltroToxi] = useState<"todos" | "regular" | "vencendo" | "vencido" | "nao_informado">("todos");
  const [filtroAtivo, setFiltroAtivo] = useState<"todos" | "ativos" | "inativos">("todos");

  async function carregar(p = 1, busca = q, limite = pageSize) {
    setCarregando(true);
    setErro("");
    try {
      const r = await tfdMotoristas({ q: busca.trim() || undefined, page: p, limit: limite });
      setLista(pagData<Motorista>(r));
      const m = pagMeta(r);
      setTotal(m.total);
      setPage(m.page);
      setPages(m.pages);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErro(msg || "Falha ao carregar motoristas.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregar(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(() => carregar(1).catch(() => {}), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function abrirModal(id?: number) {
    setErro("");
    setErros({});
    setOk("");
    if (id) {
      const m = lista.find((x) => x.id === id);
      if (m) {
        setEditId(m.id);
        setForm({
          nome: m.nome, cpf: m.cpf, cnh_numero: m.cnh_numero,
          cnh_categoria: m.cnh_categoria, cnh_validade: (m.cnh_validade || "").slice(0, 10),
          toxicologico_validade: (m.toxicologico_validade || "").slice(0, 10),
          telefone: m.telefone, ativo: m.ativo,
        });
      }
    } else {
      setEditId(null);
      setForm(vazio);
    }
    setModal(true);
  }

  function fecharModal() {
    setModal(false);
    setEditId(null);
    setForm(vazio);
    setErro("");
  }

  async function salvar() {
    setErro("");
    setOk("");
    const e: Record<string, string> = {};
    if (form.nome.trim().length < 2) e.nome = "Nome é obrigatório.";
    const cpf = validaCpf(form.cpf);
    if (cpf) e.cpf = cpf;
    const cnh = validaCnh(form.cnh_numero);
    if (cnh) e.cnh_numero = cnh;
    const val = validaCnhValidade(form.cnh_validade);
    if (val) e.cnh_validade = val;
    const tel = validaTelefone(form.telefone);
    if (tel) e.telefone = tel;
    if (Object.keys(e).length > 0) {
      setErros(e);
      setErro(toastCampos(e, ROTULOS));
      return;
    }
    const payload: Record<string, unknown> = {
      nome: form.nome.trim(),
      cpf: form.cpf.replace(/\D/g, "").slice(0, 11),
      cnh_numero: form.cnh_numero.trim(),
      cnh_categoria: form.cnh_categoria,
      cnh_validade: form.cnh_validade || null,
      toxicologico_validade: form.toxicologico_validade || null,
      telefone: form.telefone.trim(),
      ativo: form.ativo,
    };
    try {
      if (editId) await tfdAtualizarMotorista(editId, payload);
      else await tfdCriarMotorista(payload);
      fecharModal();
      setOk(editId ? "Motorista atualizado." : "Motorista cadastrado.");
      await carregar(page);
    } catch (err: unknown) {
      const deCampo = erros422(err, ROTULOS);
      const detalhe = (err as { response?: { data?: { detail?: unknown } } }).response?.data?.detail;
      const texto = typeof detalhe === "string" ? detalhe : "";
      const extra: Record<string, string> = { ...deCampo };
      if (Object.keys(extra).length === 0 && texto.includes("CPF")) extra.cpf = texto;
      if (Object.keys(extra).length > 0) {
        setErros(extra);
        setErro(toastCampos(extra, ROTULOS));
        return;
      }
      setErro(texto || "Erro ao salvar.");
    }
  }

  // Métricas do Módulo Toxicológico (Requisito 9)
  const metricasToxi = useMemo(() => {
    let regulares = 0;
    let vencendo = 0;
    let vencidos = 0;
    let naoInformados = 0;

    lista.forEach((m) => {
      const info = statusToxicologico(m.toxicologico_validade, m.cnh_categoria);
      if (info.status === "regular") regulares++;
      else if (info.status === "vencendo") vencendo++;
      else if (info.status === "vencido") vencidos++;
      else naoInformados++;
    });

    return { regulares, vencendo, vencidos, naoInformados };
  }, [lista]);

  // Lista filtrada
  const motoristasExibicao = useMemo(() => {
    return lista.filter((m) => {
      if (filtroAtivo === "ativos" && !m.ativo) return false;
      if (filtroAtivo === "inativos" && m.ativo) return false;
      if (filtroToxi !== "todos") {
        const info = statusToxicologico(m.toxicologico_validade, m.cnh_categoria);
        if (info.status !== filtroToxi) return false;
      }
      return true;
    });
  }, [lista, filtroAtivo, filtroToxi]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="font-display text-lg font-bold text-sus-950">Motoristas</h2>
        <span className="rounded-full bg-teal/10 px-2.5 py-0.5 text-xs font-semibold text-teal">
          {total} cadastrado(s)
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button onClick={() => abrirModal()}><Plus className="h-4 w-4" /> Novo motorista</Button>
        </div>
      </div>
      {erro && !modal && (
        <div className="mb-3 flex items-center justify-between rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{erro}</span>
          <button
            type="button"
            onClick={() => carregar(page)}
            className="rounded-lg bg-red-100 px-3 py-1 font-semibold text-red-800 hover:bg-red-200">
            Tentar novamente
          </button>
        </div>
      )}
      {ok && <p className="mb-3 rounded-xl bg-teal/10 px-3 py-2 text-sm text-teal">{ok}</p>}

      {/* KPI Cards do Módulo Toxicológico & Frota (Requisitos 3 e 9) */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div
          onClick={() => { setFiltroToxi("todos"); setFiltroAtivo("todos"); }}
          className="cursor-pointer rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm transition hover:border-slate-300 hover:shadow"
        >
          <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-500">
            <span>Total Cadastrados</span>
            <Clock className="h-4 w-4 text-slate-400" />
          </div>
          <p className="mt-2 text-2xl font-black text-slate-800">{total}</p>
          <span className="text-xs text-slate-500">Na base do TFD</span>
        </div>

        <div
          onClick={() => setFiltroToxi("regular")}
          className={`cursor-pointer rounded-2xl border p-3.5 shadow-sm transition hover:shadow ${
            filtroToxi === "regular" ? "border-emerald-500 bg-emerald-50/50" : "border-slate-200 bg-white hover:border-emerald-300"
          }`}
        >
          <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-emerald-700">
            <span>Toxicológico Regular</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </div>
          <p className="mt-2 text-2xl font-black text-emerald-700">{metricasToxi.regulares}</p>
          <span className="text-xs text-emerald-600">Dentro da validade</span>
        </div>

        <div
          onClick={() => setFiltroToxi("vencendo")}
          className={`cursor-pointer rounded-2xl border p-3.5 shadow-sm transition hover:shadow ${
            filtroToxi === "vencendo" ? "border-amber-500 bg-amber-50/50" : "border-slate-200 bg-white hover:border-amber-300"
          }`}
        >
          <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-amber-700">
            <span>Vence em 30 Dias</span>
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </div>
          <p className="mt-2 text-2xl font-black text-amber-700">{metricasToxi.vencendo}</p>
          <span className="text-xs text-amber-600">Exige renovação breve</span>
        </div>

        <div
          onClick={() => setFiltroToxi("vencido")}
          className={`cursor-pointer rounded-2xl border p-3.5 shadow-sm transition hover:shadow ${
            filtroToxi === "vencido" ? "border-red-500 bg-red-50/50" : "border-slate-200 bg-white hover:border-red-300"
          }`}
        >
          <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-red-700">
            <span>Toxicológico Vencido</span>
            <ShieldAlert className="h-4 w-4 text-red-500" />
          </div>
          <p className="mt-2 text-2xl font-black text-red-700">{metricasToxi.vencidos}</p>
          <span className="text-xs text-red-600">Atenção imediata</span>
        </div>
      </div>

      {/* Barra de Filtros e Pesquisa Instantânea */}
      <Card className="mb-4 space-y-3 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por nome, CPF ou número da CNH…"
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-medium text-slate-500">Status:</span>
            {(["todos", "ativos", "inativos"] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setFiltroAtivo(st)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                  filtroAtivo === st
                    ? "bg-sus-900 text-white shadow-sm"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {st === "todos" ? "Todos" : st === "ativos" ? "Ativos" : "Inativos"}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3 text-xs">
          <span className="font-semibold text-slate-600">Filtro Toxicológico:</span>
          {(
            [
              { id: "todos", label: "Todos" },
              { id: "regular", label: "Regulares" },
              { id: "vencendo", label: "Vencendo (30d)" },
              { id: "vencido", label: "Vencidos" },
              { id: "nao_informado", label: "Pendentes / Não informados" },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setFiltroToxi(item.id)}
              className={`rounded-full border px-3 py-0.5 font-medium transition ${
                filtroToxi === item.id
                  ? "border-teal bg-teal text-white shadow-xs"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {item.label}
            </button>
          ))}
          {(filtroToxi !== "todos" || filtroAtivo !== "todos" || q) && (
            <button
              type="button"
              onClick={() => {
                setFiltroToxi("todos");
                setFiltroAtivo("todos");
                setQ("");
              }}
              className="ml-auto text-xs font-medium text-teal hover:underline"
            >
              Limpar filtros
            </button>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-sus-900/10 bg-sand text-xs uppercase text-sus-900/60">
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">CPF</th>
                <th className="px-4 py-3">CNH</th>
                <th className="px-4 py-3">Validade CNH</th>
                <th className="px-4 py-3">Exame Toxicológico</th>
                <th className="px-4 py-3">Telefone</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {carregando && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-ink/45">Carregando motoristas…</td></tr>
              )}
              {!carregando && motoristasExibicao.map((m) => {
                const toxi = statusToxicologico(m.toxicologico_validade, m.cnh_categoria);
                return (
                  <tr key={m.id} className="border-b border-sus-900/5 last:border-0 hover:bg-slate-50/50 transition">
                    <td className="px-4 py-3 font-semibold text-slate-900">{m.nome}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{m.cpf || "—"}</td>
                    <td className="px-4 py-3 text-xs">
                      {m.cnh_numero ? (
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono">{m.cnh_numero}</span>
                          {m.cnh_categoria && (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-700">
                              Cat. {m.cnh_categoria}
                            </span>
                          )}
                        </div>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">{fmtValidade(m.cnh_validade)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-0.5">
                        <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs ${toxi.classe}`}>
                          {toxi.status === "regular" && <CheckCircle2 className="h-3 w-3" />}
                          {toxi.status === "vencendo" && <AlertTriangle className="h-3 w-3" />}
                          {toxi.status === "vencido" && <AlertCircle className="h-3 w-3" />}
                          {toxi.status === "nao_informado" && <FileWarning className="h-3 w-3" />}
                          {toxi.rotulo}
                        </span>
                        {m.toxicologico_validade && (
                          <span className="text-[11px] text-slate-400">
                            Válido até: {fmtValidade(m.toxicologico_validade)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">{m.telefone || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${m.ativo ? "bg-teal/10 text-teal" : "bg-sus-900/10 text-sus-900/60"}`}>
                        {m.ativo ? "Ativo" : "Inativo"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => abrirModal(m.id)} className="rounded-lg p-2 text-sus-800 hover:bg-sus-100" title="Editar"><Pencil className="h-4 w-4" /></button>
                        <button
                          onClick={async () => {
                            const okConf = await confirmar({
                              titulo: `Excluir motorista ${m.nome}`,
                              descricao: (
                                <div className="space-y-1.5">
                                  <p>Deseja realmente excluir ou inativar o motorista <strong>{m.nome}</strong>?</p>
                                  <p className="text-ink/60 text-[11px] leading-relaxed">Se o motorista possuir viagens registradas no sistema, ele será inativado para manter a rastreabilidade da frota.</p>
                                </div>
                              ),
                              textoConfirmar: "Sim, Excluir",
                              variante: "danger",
                            });
                            if (!okConf) return;
                            const snap = { ...m };
                            try {
                              await tfdExcluirMotorista(m.id);
                              await carregar(page);
                              notificarUndo({
                                titulo: `Motorista ${snap.nome} excluído/inativado.`,
                                descricao: "Desfazer reativa ou recadastra o motorista.",
                                onUndo: async () => {
                                  try {
                                    await tfdAtualizarMotorista(snap.id, {
                                      nome: snap.nome, cpf: snap.cpf,
                                      cnh_numero: snap.cnh_numero,
                                      cnh_categoria: snap.cnh_categoria,
                                      cnh_validade: snap.cnh_validade,
                                      toxicologico_validade: snap.toxicologico_validade,
                                      telefone: snap.telefone, ativo: true,
                                    });
                                  } catch {
                                    await tfdCriarMotorista({
                                      nome: snap.nome, cpf: snap.cpf,
                                      cnh_numero: snap.cnh_numero,
                                      cnh_categoria: snap.cnh_categoria,
                                      cnh_validade: snap.cnh_validade,
                                      toxicologico_validade: snap.toxicologico_validade,
                                      telefone: snap.telefone, ativo: true,
                                    });
                                  }
                                  await carregar(page);
                                },
                              });
                            } catch {
                              setErro("Erro ao excluir.");
                            }
                          }}
                          className="rounded-lg p-2 text-red-600 hover:bg-red-50"
                          title="Excluir/inativar"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!carregando && motoristasExibicao.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-ink/45">
                    Nenhum motorista encontrado com os filtros selecionados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Paginacao
          page={page}
          pages={pages}
          total={total}
          pageSize={pageSize}
          onPageSize={(sz) => {
            setPageSize(sz);
            carregar(1, q, sz).catch(() => setErro("Falha ao carregar."));
          }}
          onPage={(p) => carregar(p, q, pageSize).catch(() => setErro("Falha ao carregar."))}
        />
      </Card>

      {modal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4" onClick={fecharModal}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <p className="font-display text-base font-bold text-sus-950">{editId ? "Editar motorista" : "Novo motorista"}</p>
              <button onClick={fecharModal} className="rounded-lg p-2 text-ink/50 hover:bg-sand" aria-label="Fechar"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="md:col-span-2"><Label>Nome completo *</Label><Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Nome completo" className={borda("nome")} />{campoMsg("nome")}</div>
              <div><Label>CPF *</Label><Input value={form.cpf} onChange={(e) => setForm({ ...form, cpf: e.target.value.replace(/\D/g, "").slice(0, 11) })} placeholder="Somente números" inputMode="numeric" className={borda("cpf")} />{campoMsg("cpf")}</div>
              <div><Label>Telefone</Label><Input value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} placeholder="DDD + número" className={borda("telefone")} />{campoMsg("telefone")}</div>
              <div><Label>CNH (número) *</Label><Input value={form.cnh_numero} onChange={(e) => setForm({ ...form, cnh_numero: e.target.value.replace(/\D/g, "").slice(0, 11) })} placeholder="11 dígitos" inputMode="numeric" className={borda("cnh_numero")} />{campoMsg("cnh_numero")}</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Categoria</Label>
                  <select value={form.cnh_categoria} onChange={(e) => setForm({ ...form, cnh_categoria: e.target.value })} className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
                    {CATEGORIAS.map((c) => <option key={c} value={c}>{c || "—"}</option>)}
                  </select>
                </div>
                <div><Label>Validade CNH *</Label><Input type="date" value={form.cnh_validade} onChange={(e) => setForm({ ...form, cnh_validade: e.target.value })} className={borda("cnh_validade")} />{campoMsg("cnh_validade")}</div>
              </div>

              {/* Exame Toxicológico Periódico (CTB Art. 148-A) */}
              <div className="rounded-xl border border-sus-900/10 bg-slate-50/70 p-3 md:col-span-2">
                <div className="flex items-center justify-between mb-1">
                  <Label className="text-xs font-bold text-slate-800">Validade do Exame Toxicológico</Label>
                  {["C", "D", "E"].some((cat) => (form.cnh_categoria || "").toUpperCase().includes(cat)) && (
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                      Obrigatório para Cat. {form.cnh_categoria}
                    </span>
                  )}
                </div>
                <Input
                  type="date"
                  value={form.toxicologico_validade}
                  onChange={(e) => setForm({ ...form, toxicologico_validade: e.target.value })}
                  className="bg-white"
                />
                <p className="mt-1.5 text-[11px] text-slate-500">
                  Exigido pela Lei Federal nº 13.103/2015 e CTB Art. 148-A para condutores de categorias C, D e E a cada 2 anos e meio (30 meses).
                </p>
              </div>

              <label className="flex items-center gap-2 text-sm md:col-span-2">
                <input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} className="h-4 w-4 accent-teal" /> Ativo
              </label>
            </div>
            {erro && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
            <Button onClick={salvar} className="mt-4 w-full"><Plus className="h-4 w-4" />{editId ? "Atualizar" : "Cadastrar motorista"}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
