import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Layers, Pencil, Plus, Search, ShieldCheck, ShieldOff, Trash2, X } from "lucide-react";
import {
  labSigtap,
  msgErro,
  pagData,
  pagMeta,
  tfdAtualizarEspecialidade,
  tfdAtualizarProcedimento,
  tfdAtualizarTipo,
  tfdCriarEspecialidade,
  tfdCriarProcedimento,
  tfdCriarTipo,
  tfdEspecialidades,
  tfdExcluirEspecialidade,
  tfdExcluirProcedimento,
  tfdExcluirTipo,
  tfdProcedimentos,
  tfdTipos,
  tfdUnificarEspecialidades,
  type EspecialidadeCat,
  type ProcedimentoCat,
  type SigtapProc,
  type TipoFila,
} from "../../services/api";
import { Badge, Button, Card, Input, Label } from "../../components/ui/primitives";
import Paginacao from "../../components/Paginacao";
import { useBackdropClose } from "../../hooks/useBackdropClose";
import { useConfirm } from "../../components/ConfirmDialog";
import { useAuth } from "../../hooks/useAuth";
import LabSigtap from "../lab/LabSigtap";

type Aba = "tipos" | "procedimentos" | "especialidades" | "sigtap";

const vazioTipo = { codigo: "", nome: "", ativo: true };
const vazioProc = {
  codigo: "",
  nome: "",
  tipo_fila: "",
  codigo_especialidade: "",
  nome_especialidade: "",
  codigo_curto: "",
  sem_codigo_especifico: false,
  codigo_faturamento_sigtap: "",
  ativo: true,
};
const vazioEsp = { codigo_cbo: "", nome: "", ativo: true };

export default function CatalogoExames() {
  const { can } = useAuth();
  const { confirmar } = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();

  const podeCatalogo = can("tfd_catalogo");
  const podeSigtap = can("lab_sigtap");
  const abasDisponiveis: { id: Aba; label: string }[] = [
    ...(podeCatalogo
      ? [
          { id: "tipos" as Aba, label: "Tipos de fila" },
          { id: "procedimentos" as Aba, label: "Procedimentos" },
          { id: "especialidades" as Aba, label: "Especialidades Médicas" },
        ]
      : []),
    ...(podeSigtap || podeCatalogo
      ? [{ id: "sigtap" as Aba, label: "Tabela Oficial SIGTAP (SUS)" }]
      : []),
  ];

  const abaParam = searchParams.get("aba") as Aba | null;
  const abaValida = abasDisponiveis.some((x) => x.id === abaParam)
    ? (abaParam as Aba)
    : (abasDisponiveis[0]?.id ?? "sigtap");
  const [aba, setAba] = useState<Aba>(abaValida);

  useEffect(() => {
    const p = searchParams.get("aba") as Aba | null;
    if (p && abasDisponiveis.some((x) => x.id === p) && p !== aba) {
      setAba(p);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  const [q, setQ] = useState("");
  const [tipos, setTipos] = useState<TipoFila[]>([]);
  const [procs, setProcs] = useState<ProcedimentoCat[]>([]);
  const [esps, setEsps] = useState<EspecialidadeCat[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [formTipo, setFormTipo] = useState(vazioTipo);
  const [formProc, setFormProc] = useState(vazioProc);
  const [formEsp, setFormEsp] = useState(vazioEsp);
  const [buscaSigtapRef, setBuscaSigtapRef] = useState("");
  const [resultadosSigtapRef, setResultadosSigtapRef] = useState<SigtapProc[]>([]);
  const [buscandoSigtapRef, setBuscandoSigtapRef] = useState(false);
  const [procSigtapRefSel, setProcSigtapRefSel] = useState<SigtapProc | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    const termo = buscaSigtapRef.trim();
    if (!modal || aba !== "procedimentos" || !formProc.sem_codigo_especifico || termo.length < 2) {
      setResultadosSigtapRef([]);
      setBuscandoSigtapRef(false);
      return;
    }
    let cancelado = false;
    const timer = setTimeout(async () => {
      setBuscandoSigtapRef(true);
      try {
        const resp = await labSigtap(termo, undefined, 1, 15, false);
        if (!cancelado) {
          setResultadosSigtapRef(pagData<SigtapProc>(resp));
        }
      } catch {
        if (!cancelado) setResultadosSigtapRef([]);
      } finally {
        if (!cancelado) setBuscandoSigtapRef(false);
      }
    }, 250);
    return () => {
      cancelado = true;
      clearTimeout(timer);
    };
  }, [buscaSigtapRef, modal, aba, formProc.sem_codigo_especifico]);

  function selecionarProcedimentoSigtapRef(proc: SigtapProc) {
    setProcSigtapRefSel(proc);
    setFormProc((prev) => ({
      ...prev,
      codigo_faturamento_sigtap: proc.codigo,
      nome: prev.nome.trim() ? prev.nome : proc.descricao,
    }));
    setBuscaSigtapRef("");
    setResultadosSigtapRef([]);
  }

  function limparBuscaSigtapRef() {
    setBuscaSigtapRef("");
    setResultadosSigtapRef([]);
    setProcSigtapRefSel(null);
  }
  const [unificando, setUnificando] = useState(false);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");

  async function unificarCbos() {
    setUnificando(true);
    setErro("");
    setOk("");
    try {
      const r = await tfdUnificarEspecialidades();
      setOk(
        `Deduplicação concluída: ${r.especialidades_mescladas} especialidade(s) e ${r.sigtap_cbos_removidos} CBO(s) SIGTAP unificados (${r.registros_atualizados} vínculo(s) atualizado(s), ${r.ocupacoes_total} ocupação(ões) únicas).`,
      );
      await carregar(1, "especialidades", q);
    } catch (e: unknown) {
      setErro(msgErro(e, "Falha ao unificar CBOs duplicados."));
    } finally {
      setUnificando(false);
    }
  }

  const modalBackdrop = useBackdropClose(fecharModal, modal);

  function mudarAba(novaAba: Aba) {
    setAba(novaAba);
    setSearchParams(novaAba === "tipos" ? {} : { aba: novaAba }, { replace: true });
  }

  async function carregar(p = 1, abaAtual = aba, busca = q, limite = pageSize) {
    const params = { q: busca.trim() || undefined, page: p, limit: limite };
    if (abaAtual === "tipos") {
      const r = await tfdTipos(params);
      setTipos(pagData<TipoFila>(r));
      const m = pagMeta(r);
      setTotal(m.total); setPage(m.page); setPages(m.pages);
    } else if (abaAtual === "procedimentos") {
      const r = await tfdProcedimentos(params);
      setProcs(pagData<ProcedimentoCat>(r));
      const m = pagMeta(r);
      setTotal(m.total); setPage(m.page); setPages(m.pages);
    } else {
      const r = await tfdEspecialidades(params);
      setEsps(pagData<EspecialidadeCat>(r));
      const m = pagMeta(r);
      setTotal(m.total); setPage(m.page); setPages(m.pages);
    }
  }

  useEffect(() => {
    if (aba === "sigtap") return;
    setPage(1);
    carregar(1, aba, "").catch(() => setErro("Falha ao carregar catálogo."));
    setQ("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aba]);

  function abrirModal(id?: number) {
    setErro(""); setOk("");
    limparBuscaSigtapRef();
    if (aba === "tipos") {
      if (id) {
        const t = tipos.find((x) => x.id === id);
        if (t) { setEditId(t.id); setFormTipo({ codigo: t.codigo, nome: t.nome, ativo: t.ativo }); }
      } else { setEditId(null); setFormTipo(vazioTipo); }
    } else if (aba === "procedimentos") {
      if (id) {
        const t = procs.find((x) => x.id === id);
        if (t) {
          setEditId(t.id);
          setFormProc({
            codigo: t.codigo,
            nome: t.nome,
            tipo_fila: t.tipo_fila,
            codigo_especialidade: t.codigo_especialidade,
            nome_especialidade: t.nome_especialidade,
            codigo_curto: t.codigo_curto,
            sem_codigo_especifico: Boolean(t.sem_codigo_especifico),
            codigo_faturamento_sigtap: t.codigo_faturamento_sigtap || "",
            ativo: t.ativo,
          });
        }
      } else { setEditId(null); setFormProc(vazioProc); }
    } else {
      if (id) {
        const t = esps.find((x) => x.id === id);
        if (t) { setEditId(t.id); setFormEsp({ codigo_cbo: t.codigo_cbo, nome: t.nome, ativo: t.ativo }); }
      } else { setEditId(null); setFormEsp(vazioEsp); }
    }
    setModal(true);
  }

  function fecharModal() {
    setModal(false); setEditId(null);
    setFormTipo(vazioTipo); setFormProc(vazioProc); setFormEsp(vazioEsp);
    limparBuscaSigtapRef();
    setErro("");
  }

  async function salvar() {
    setErro(""); setOk(""); setSalvando(true);
    try {
      if (aba === "tipos") {
        if (formTipo.nome.trim().length < 2) throw new Error("Nome do tipo é obrigatório.");
        const payload = { ...formTipo, codigo: formTipo.codigo.trim(), nome: formTipo.nome.trim().toUpperCase() };
        if (editId) await tfdAtualizarTipo(editId, payload);
        else await tfdCriarTipo(payload);
        setOk(editId ? "Tipo atualizado." : "Tipo cadastrado.");
      } else if (aba === "procedimentos") {
        if (!formProc.sem_codigo_especifico && !formProc.codigo.trim()) {
          throw new Error("Código do procedimento é obrigatório.");
        }
        if (formProc.nome.trim().length < 2) {
          throw new Error("Nome do procedimento é obrigatório.");
        }
        const payload = {
          ...formProc,
          codigo: formProc.codigo.trim(),
          nome: formProc.nome.trim().toUpperCase(),
          tipo_fila: formProc.tipo_fila.trim().toUpperCase(),
          codigo_especialidade: formProc.codigo_especialidade.replace(/\D/g, "").slice(0, 6),
          nome_especialidade: formProc.nome_especialidade.trim(),
          codigo_curto: formProc.codigo_curto.trim().toUpperCase(),
          sem_codigo_especifico: formProc.sem_codigo_especifico,
          codigo_faturamento_sigtap: formProc.codigo_faturamento_sigtap.trim(),
        };
        if (editId) await tfdAtualizarProcedimento(editId, payload);
        else await tfdCriarProcedimento(payload);
        setOk(editId ? "Procedimento atualizado." : "Procedimento cadastrado.");
      } else {
        const cbo = formEsp.codigo_cbo ? formEsp.codigo_cbo.replace(/\D/g, "").slice(0, 6) : "";
        if (formEsp.nome.trim().length < 2) throw new Error("O nome da especialidade é obrigatório.");
        const payload = { codigo_cbo: cbo, nome: formEsp.nome.trim(), ativo: formEsp.ativo };
        if (editId) await tfdAtualizarEspecialidade(editId, payload);
        else await tfdCriarEspecialidade(payload);
        setOk(editId ? "Especialidade atualizada." : "Especialidade cadastrada.");
      }
      fecharModal();
      await carregar(page);
    } catch (e: any) {
      setErro(e?.response?.data?.detail || e?.message || "Erro ao salvar.");
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(id: number) {
    const rotuloAba = aba === "tipos" ? "tipo de fila" : aba === "procedimentos" ? "procedimento" : "especialidade";
    const ok = await confirmar({
      titulo: `Inativar/excluir ${rotuloAba}`,
      descricao: `Deseja realmente inativar ou excluir este registro do catálogo de ${rotuloAba}?`,
      textoConfirmar: "Sim, Excluir",
      variante: "danger",
    });
    if (!ok) return;
    try {
      if (aba === "tipos") await tfdExcluirTipo(id);
      else if (aba === "procedimentos") await tfdExcluirProcedimento(id);
      else await tfdExcluirEspecialidade(id);
      setOk("Registro excluído.");
      await carregar(page);
    } catch {
      setErro("Erro ao excluir.");
    }
  }

  function buscar(e?: React.FormEvent) {
    e?.preventDefault();
    carregar(1, aba, q).catch(() => setErro("Falha ao buscar."));
  }

  const titulo =
    aba === "tipos" ? "Tipos de fila" :
    aba === "procedimentos" ? "Procedimentos" : "Especialidades Médicas";

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-lg font-bold text-sus-950">Catálogo de Procedimentos e Filas</h2>
          {aba !== "sigtap" && (
            <span className="rounded-full bg-teal/10 px-2.5 py-0.5 text-xs font-semibold text-teal">
              {total} registro(s)
            </span>
          )}
        </div>
        {aba !== "sigtap" && (
          <div className="flex items-center gap-2">
            <Button onClick={() => abrirModal()} className="bg-teal text-white hover:bg-teal/90">
              <Plus className="h-4 w-4 mr-1" /> Novo
            </Button>
          </div>
        )}
      </div>
      {erro && !modal && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
      {ok && <p className="mb-3 rounded-xl bg-teal/10 px-3 py-2 text-sm text-teal">{ok}</p>}

      <div className="mb-4 flex flex-wrap gap-2">
        {abasDisponiveis.map((t) => (
          <button
            key={t.id}
            onClick={() => mudarAba(t.id)}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
              aba === t.id ? "bg-sus-900 text-white shadow-sm font-bold" : "bg-sand text-sus-900 hover:bg-sus-900/10"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {aba === "sigtap" ? (
        <LabSigtap />
      ) : (
        <>
      <Card className="mb-4 p-4">
            <form onSubmit={buscar} className="flex flex-wrap items-end gap-2">
              <div className="min-w-52 flex-1">
                <Label>Buscar {titulo.toLowerCase()}</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/40" />
                  <Input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={
                      aba === "especialidades"
                        ? "Ex: radiologia, 225320…"
                        : aba === "procedimentos"
                          ? "Ex: mamografia, 0205020186, MAMO…"
                          : "Ex: ultrassonografia…"
                    }
                    className="pl-10"
                  />
                </div>
              </div>
              <Button type="submit"><Search className="h-4 w-4" /> Buscar</Button>
              <button
                type="button"
                onClick={() => { setQ(""); carregar(1, aba, "").catch(() => {}); }}
                className="rounded-xl px-4 py-2.5 text-sm font-semibold text-sus-900 hover:bg-sus-900/5"
              >
                Limpar
              </button>
              {aba === "especialidades" && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={unificarCbos}
                  disabled={unificando}
                  className="ml-auto"
                >
                  <Layers className="h-4 w-4 text-teal" />
                  {unificando ? "Unificando…" : "Unificar CBOs duplicados"}
                </Button>
              )}
            </form>
            <p className="mt-2 text-xs text-ink/50">
              Tipos e CBOs alimentam os filtros da Fila de exames com contagem. Procedimentos alimentam o autocomplete do pedido.
            </p>
          </Card>

          <Card className="overflow-hidden">
            {aba === "tipos" && (
              <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead><tr className="border-b border-sus-900/10 bg-sand text-xs uppercase text-sus-900/60">
                  <th className="px-4 py-3">ID e-SUS</th><th className="px-4 py-3">Tipo de fila</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Ações</th>
                </tr></thead>
                <tbody>
                  {tipos.map((t) => (
                    <tr key={t.id} className="border-b border-sus-900/5 last:border-0">
                      <td className="px-4 py-3 font-mono text-xs">{t.codigo || "—"}</td>
                      <td className="px-4 py-3 font-semibold" title={t.nome}>{t.nome}</td>
                      <td className="px-4 py-3">
                        <Badge variant={t.ativo ? "success" : "outline"}>
                          {t.ativo ? <ShieldCheck className="h-3 w-3" /> : <ShieldOff className="h-3 w-3" />}
                          {t.ativo ? "Ativo" : "Inativo"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3"><div className="flex justify-end gap-1">
                        <button onClick={() => abrirModal(t.id)} className="rounded-lg p-2 text-sus-800 hover:bg-sus-100" title="Editar"><Pencil className="h-4 w-4" /></button>
                        <button onClick={() => excluir(t.id)} className="rounded-lg p-2 text-red-600 hover:bg-red-50" title="Excluir"><Trash2 className="h-4 w-4" /></button>
                      </div></td>
                    </tr>
                  ))}
                  {tipos.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-ink/45">Nenhum tipo cadastrado.</td></tr>}
                </tbody>
              </table>
              </div>
            )}
            {aba === "procedimentos" && (
              <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead><tr className="border-b border-sus-900/10 bg-sand text-xs uppercase text-sus-900/60">
                  <th className="px-4 py-3">Código</th><th className="px-4 py-3">Procedimento</th><th className="px-4 py-3">Tipo / CBO</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Ações</th>
                </tr></thead>
                <tbody>
                  {procs.map((t) => (
                    <tr key={t.id} className="border-b border-sus-900/5 last:border-0">
                      <td className="px-4 py-3 font-mono text-xs">
                        {t.codigo}
                        {t.codigo_curto ? <span className="block text-teal">· {t.codigo_curto}</span> : null}
                        {t.sem_codigo_especifico ? (
                          <span className="mt-0.5 inline-block rounded bg-amber-100 px-1 py-0.5 text-[10px] font-bold text-amber-800">
                            Sem Cód. Específico
                          </span>
                        ) : null}
                        {t.codigo_faturamento_sigtap ? (
                          <span className="block text-[10px] font-semibold text-teal mt-0.5">
                            Fatura SIGTAP: {t.codigo_faturamento_sigtap}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 font-semibold" title={t.nome}>{t.nome}</td>
                      <td className="px-4 py-3 text-xs text-ink/60">
                        {t.tipo_fila || "—"}
                        {t.codigo_especialidade ? <span className="block">CBO {t.codigo_especialidade}{t.nome_especialidade ? ` · ${t.nome_especialidade}` : ""}</span> : null}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={t.ativo ? "success" : "outline"}>
                          {t.ativo ? <ShieldCheck className="h-3 w-3" /> : <ShieldOff className="h-3 w-3" />}
                          {t.ativo ? "Ativo" : "Inativo"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3"><div className="flex justify-end gap-1">
                        <button onClick={() => abrirModal(t.id)} className="rounded-lg p-2 text-sus-800 hover:bg-sus-100" title="Editar"><Pencil className="h-4 w-4" /></button>
                        <button onClick={() => excluir(t.id)} className="rounded-lg p-2 text-red-600 hover:bg-red-50" title="Excluir"><Trash2 className="h-4 w-4" /></button>
                      </div></td>
                    </tr>
                  ))}
                  {procs.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-ink/45">Nenhum procedimento cadastrado.</td></tr>}
                </tbody>
              </table>
              </div>
            )}
            {aba === "especialidades" && (
              <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead><tr className="border-b border-sus-900/10 bg-sand text-xs uppercase text-sus-900/60">
                  <th className="px-4 py-3">CBO</th><th className="px-4 py-3">Especialidade</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Ações</th>
                </tr></thead>
                <tbody>
                  {esps.map((t) => (
                    <tr key={t.id} className="border-b border-sus-900/5 last:border-0">
                      <td className="px-4 py-3 font-mono text-xs">
                        {t.codigo_cbo ? (
                          <span className="font-bold">{t.codigo_cbo}</span>
                        ) : (
                          <span className="rounded bg-sus-900/10 px-1.5 py-0.5 font-sans text-[11px] font-normal text-ink/50">
                            Geral / Sem CBO
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-semibold" title={t.nome}>{t.nome}</td>
                      <td className="px-4 py-3">
                        <Badge variant={t.ativo ? "success" : "outline"}>
                          {t.ativo ? <ShieldCheck className="h-3 w-3" /> : <ShieldOff className="h-3 w-3" />}
                          {t.ativo ? "Ativo" : "Inativo"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3"><div className="flex justify-end gap-1">
                        <button onClick={() => abrirModal(t.id)} className="rounded-lg p-2 text-sus-800 hover:bg-sus-100" title="Editar"><Pencil className="h-4 w-4" /></button>
                        <button onClick={() => excluir(t.id)} className="rounded-lg p-2 text-red-600 hover:bg-red-50" title="Excluir"><Trash2 className="h-4 w-4" /></button>
                      </div></td>
                    </tr>
                  ))}
                  {esps.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-ink/45">Nenhuma especialidade cadastrada.</td></tr>}
                </tbody>
              </table>
              </div>
            )}
            <Paginacao
              page={page}
              pages={pages}
              total={total}
              pageSize={pageSize}
              onPageSize={(sz) => {
                setPageSize(sz);
                carregar(1, aba, q, sz).catch(() => setErro("Falha ao carregar catálogo."));
              }}
              onPage={(p) => carregar(p, aba, q, pageSize).catch(() => setErro("Falha ao carregar catálogo."))}
            />
          </Card>
        </>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4" {...modalBackdrop}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <p className="font-display text-base font-bold text-sus-950">
                {editId ? `Editar ${titulo.toLowerCase()}` : `Novo ${titulo.toLowerCase()}`}
              </p>
              <button onClick={fecharModal} className="rounded-lg p-2 text-ink/50 hover:bg-sand" aria-label="Fechar"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3">
              {aba === "tipos" && (
                <div className="grid gap-3 md:grid-cols-3">
                  <div><Label>ID e-SUS</Label><Input value={formTipo.codigo} onChange={(e) => setFormTipo({ ...formTipo, codigo: e.target.value })} placeholder="Ex: 31" /></div>
                  <div className="md:col-span-2"><Label>Nome do tipo *</Label><Input value={formTipo.nome} onChange={(e) => setFormTipo({ ...formTipo, nome: e.target.value.toUpperCase() })} placeholder="Ex: ULTRASSONOGRAFIA" /></div>
                  <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={formTipo.ativo} onChange={(e) => setFormTipo({ ...formTipo, ativo: e.target.checked })} className="rounded border-sus-900/30" /> Ativo</label>
                </div>
              )}
              {aba === "procedimentos" && (
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="md:col-span-2 rounded-xl border border-amber-300 bg-amber-50/70 p-2.5">
                    <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-amber-950">
                      <input
                        type="checkbox"
                        checked={formProc.sem_codigo_especifico}
                        onChange={(e) => setFormProc({ ...formProc, sem_codigo_especifico: e.target.checked })}
                        className="rounded border-amber-400 text-teal"
                      />
                      <span>Procedimento não tem código específico no SIGTAP</span>
                    </label>
                  </div>
                  {formProc.sem_codigo_especifico && (
                    <div className="md:col-span-2 rounded-xl border border-teal/20 bg-teal/5 p-3 space-y-2.5">
                      <Label className="text-xs font-bold text-teal-950">
                        Buscar Procedimento Existente na Tabela SIGTAP (Faturamento SUS)
                      </Label>
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-teal-700/60" />
                        <Input
                          placeholder="Buscar na tabela SIGTAP por código ou descrição..."
                          value={buscaSigtapRef}
                          onChange={(e) => setBuscaSigtapRef(e.target.value)}
                          className="pl-8 text-xs bg-white"
                        />
                        {buscandoSigtapRef && (
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-teal">
                            Buscando…
                          </span>
                        )}
                        {resultadosSigtapRef.length > 0 && (
                          <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-52 overflow-y-auto rounded-xl border border-sus-900/15 bg-white shadow-lg">
                            {resultadosSigtapRef.map((pr) => {
                              const valRef = Number(pr.valor_sa || 0) + Number(pr.valor_sp || 0);
                              return (
                                <button
                                  key={pr.id ?? pr.codigo}
                                  type="button"
                                  onClick={() => selecionarProcedimentoSigtapRef(pr)}
                                  className="w-full border-b border-sus-900/5 px-3 py-2 text-left text-xs hover:bg-sand/70 last:border-0"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-mono font-bold text-teal">{pr.codigo}</span>
                                    <span className="font-mono text-[11px] text-ink/60">
                                      {pr.instrumento} · {pr.complexidade} · Valor SIGTAP/SUS: R$ {valRef.toFixed(2)}
                                    </span>
                                  </div>
                                  <p className="mt-0.5 font-medium text-sus-950">{pr.descricao}</p>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      {procSigtapRefSel && (
                        <div className="flex items-start justify-between gap-2 rounded-lg border border-teal/25 bg-white/90 px-3 py-2 text-[11px]">
                          <div>
                            <p className="font-bold text-teal-950">
                              Selecionado: <span className="font-mono">{procSigtapRefSel.codigo}</span> — {procSigtapRefSel.descricao}
                            </p>
                            <p className="text-ink/65 mt-0.5">
                              Valor SIGTAP/SUS: <strong>R$ {(Number(procSigtapRefSel.valor_sa || 0) + Number(procSigtapRefSel.valor_sp || 0)).toFixed(2)}</strong> · Instrumento: <strong>{procSigtapRefSel.instrumento}</strong> · Complexidade: <strong>{procSigtapRefSel.complexidade}</strong>
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={limparBuscaSigtapRef}
                            className="text-ink/40 hover:text-ink"
                            title="Limpar seleção"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                      <div>
                        <Label className="text-[11px] font-semibold text-teal-950">
                          Código SIGTAP para Faturamento SUS (de-para)
                        </Label>
                        <Input
                          value={formProc.codigo_faturamento_sigtap}
                          onChange={(e) => {
                            const v = e.target.value.replace(/\D/g, "");
                            setFormProc({ ...formProc, codigo_faturamento_sigtap: v });
                            if (procSigtapRefSel && v !== procSigtapRefSel.codigo) {
                              setProcSigtapRefSel(null);
                            }
                          }}
                          placeholder="Ex: 0205020186 (10 dígitos)"
                          maxLength={10}
                          className="mt-1 font-mono text-xs bg-white"
                        />
                      </div>
                    </div>
                  )}
                  <div>
                    <Label>{formProc.sem_codigo_especifico ? "Código interno (opcional)" : "Código procedimento *"}</Label>
                    <Input
                      value={formProc.codigo}
                      onChange={(e) => setFormProc({ ...formProc, codigo: e.target.value })}
                      placeholder={formProc.sem_codigo_especifico ? "Auto 99... se vazio" : "Ex: 0205020186"}
                    />
                  </div>
                  <div><Label>Código curto</Label><Input value={formProc.codigo_curto} onChange={(e) => setFormProc({ ...formProc, codigo_curto: e.target.value.toUpperCase() })} placeholder="Ex: USG-TV" /></div>
                  <div className="md:col-span-2"><Label>Nome procedimento *</Label><Input value={formProc.nome} onChange={(e) => setFormProc({ ...formProc, nome: e.target.value.toUpperCase() })} maxLength={1000} placeholder="Ex: ULTRASSONOGRAFIA TRANSVAGINAL" /></div>
                  <div><Label>Tipo de fila</Label><Input value={formProc.tipo_fila} onChange={(e) => setFormProc({ ...formProc, tipo_fila: e.target.value.toUpperCase() })} placeholder="Ex: ULTRASSONOGRAFIA" /></div>
                  <div><Label>CBO padrão</Label><Input value={formProc.codigo_especialidade} onChange={(e) => setFormProc({ ...formProc, codigo_especialidade: e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 6) })} placeholder="Ex: 225320" /></div>
                  <div className="md:col-span-2">
                    <Label>Nome especialidade</Label>
                    <Input
                      value={formProc.nome_especialidade}
                      onChange={(e) => {
                        const val = e.target.value;
                        const match = esps.find((x) => x.nome.toLowerCase() === val.toLowerCase());
                        setFormProc({
                          ...formProc,
                          nome_especialidade: val,
                          codigo_especialidade: match?.codigo_cbo || formProc.codigo_especialidade,
                        });
                      }}
                      placeholder="Ex: Médico em radiologia e diagnóstico por imagem"
                      list="proc-especialidades-list"
                    />
                    <datalist id="proc-especialidades-list">
                      {esps.map((esp) => (
                        <option key={esp.id} value={esp.nome}>
                          {esp.codigo_cbo ? `CBO ${esp.codigo_cbo} · ` : ""}{esp.nome}
                        </option>
                      ))}
                    </datalist>
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={formProc.ativo} onChange={(e) => setFormProc({ ...formProc, ativo: e.target.checked })} className="rounded border-sus-900/30" /> Ativo</label>
                </div>
              )}
              {aba === "especialidades" && (
                <div className="grid gap-3 md:grid-cols-3">
                  <div><Label>Código CBO (opcional)</Label><Input value={formEsp.codigo_cbo} onChange={(e) => setFormEsp({ ...formEsp, codigo_cbo: e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 6) })} placeholder="Ex: 225320 ou 5151F1 (opcional)" /></div>
                  <div className="md:col-span-2"><Label>Nome especialidade *</Label><Input value={formEsp.nome} onChange={(e) => setFormEsp({ ...formEsp, nome: e.target.value })} placeholder="Ex: Médico em radiologia e diagnóstico por imagem" /></div>
                  <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={formEsp.ativo} onChange={(e) => setFormEsp({ ...formEsp, ativo: e.target.checked })} className="rounded border-sus-900/30" /> Ativo</label>
                </div>
              )}
              {erro && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
              <Button onClick={salvar} disabled={salvando} className="w-full"><Plus className="h-4 w-4" />{salvando ? "Salvando…" : editId ? "Atualizar" : "Cadastrar"}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
