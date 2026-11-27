import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  Clock,
  Download,
  ExternalLink,
  Globe,
  History,
  Layers,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import {
  labSigtap,
  msgErro,
  pagData,
  pagMeta,
  siaAutoSyncConfig,
  siaAutoSyncExecutar,
  siaAutoSyncStatus,
  sigtapArvore,
  sigtapAtualizar,
  sigtapAutoSyncConfig,
  sigtapAutoSyncExecutar,
  sigtapAutoSyncStatus,
  sigtapCriarManual,
  sigtapImportar,
  sigtapVersoes,
  type SiaAutoSyncStatus,
  type SigtapArvore,
  type SigtapAutoSyncStatus,
  type SigtapImportOut,
  type SigtapProc,
  type SigtapVersao,
} from "../../services/api";
import { Button, Card, Input, Label, Select } from "../../components/ui/primitives";
import { Combobox } from "../../components/ui/combobox";
import Paginacao from "../../components/Paginacao";
import ExportarExcel from "../../components/ExportarExcel";

const INSTRUMENTOS = ["BPA-C", "BPA-I", "BPA-F", "AIH", "APAC", "RAAS"];

function brl(v: number | undefined): string {
  return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function LabSigtap() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [q, setQ] = useState(() => searchParams.get("q") || "");
  const [inst, setInst] = useState("");
  const [apenasLab, setApenasLab] = useState(false);
  const [grupoCodigo, setGrupoCodigo] = useState("");
  const [subgrupoCodigo, setSubgrupoCodigo] = useState("");
  const [cboCodigo, setCboCodigo] = useState("");
  const [arvore, setArvore] = useState<SigtapArvore | null>(null);
  const [lista, setLista] = useState<SigtapProc[]>([]);
  const [erro, setErro] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);

  // Importação e Atualização Agendada (Tabela Unificada DATASUS)
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [competencia, setCompetencia] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 7);
  });
  const [importando, setImportando] = useState(false);
  const [avisoAuto, setAvisoAuto] = useState<{ mensagem: string; linkOficial?: string } | null>(null);
  const [preview, setPreview] = useState<SigtapImportOut | null>(null);
  const [versoes, setVersoes] = useState<SigtapVersao[]>([]);
  const [autoSync, setAutoSync] = useState<SigtapAutoSyncStatus | null>(null);
  const [salvandoAutoSync, setSalvandoAutoSync] = useState(false);
  const [executandoAutoSync, setExecutandoAutoSync] = useState(false);
  const [siaAutoSync, setSiaAutoSync] = useState<SiaAutoSyncStatus | null>(null);
  const [salvandoSiaAutoSync, setSalvandoSiaAutoSync] = useState(false);
  const [executandoSiaSync, setExecutandoSiaSync] = useState(false);
  const [ok, setOk] = useState("");

  // Cadastro / Edição de Procedimento SIGTAP
  const [modalManual, setModalManual] = useState(false);
  const [editSigtapId, setEditSigtapId] = useState<number | null>(null);
  const editarParamProcessadoRef = useRef<string>("");
  const [manualCodigo, setManualCodigo] = useState("");
  const [manualDescricao, setManualDescricao] = useState("");
  const [manualComplexidade, setManualComplexidade] = useState("MC");
  const [manualInstrumento, setManualInstrumento] = useState("BPA-C");
  const [manualValorSa, setManualValorSa] = useState("0");
  const [manualValorSp, setManualValorSp] = useState("0");
  const [manualValorSh, setManualValorSh] = useState("0");
  const [manualSexo, setManualSexo] = useState("");
  const [manualSemCodigo, setManualSemCodigo] = useState(false);
  const [manualCodigoFat, setManualCodigoFat] = useState("");
  const [nomeProcFat, setNomeProcFat] = useState("");
  const [buscandoProcFat, setBuscandoProcFat] = useState(false);
  const [buscaSigtapRef, setBuscaSigtapRef] = useState("");
  const [resultadosSigtapRef, setResultadosSigtapRef] = useState<SigtapProc[]>([]);
  const [buscandoSigtapRef, setBuscandoSigtapRef] = useState(false);
  const [procSigtapRefSel, setProcSigtapRefSel] = useState<SigtapProc | null>(null);
  const [salvandoManual, setSalvandoManual] = useState(false);

  useEffect(() => {
    const termo = buscaSigtapRef.trim();
    if (!modalManual || !manualSemCodigo || termo.length < 2) {
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
  }, [buscaSigtapRef, modalManual, manualSemCodigo]);

  function selecionarProcedimentoSigtapRef(proc: SigtapProc) {
    setProcSigtapRefSel(proc);
    setManualCodigoFat(proc.codigo);
    setNomeProcFat(proc.descricao);
    setManualValorSa(String(proc.valor_sa || 0));
    setManualValorSp(String(proc.valor_sp || 0));
    setManualValorSh(String(proc.valor_sh || 0));
    if (proc.complexidade) setManualComplexidade(proc.complexidade);
    if (proc.instrumento) setManualInstrumento(proc.instrumento);
    if (!manualDescricao.trim()) {
      setManualDescricao(proc.descricao);
    }
    setBuscaSigtapRef("");
    setResultadosSigtapRef([]);
  }

  function limparBuscaSigtapRef() {
    setBuscaSigtapRef("");
    setResultadosSigtapRef([]);
    setProcSigtapRefSel(null);
  }

  // Busca automática da descrição e valores do exame SIGTAP de faturamento
  async function buscarExameFaturamento(cod: string) {
    const codLimpo = cod.trim().replace(/\D/g, "");
    if (codLimpo.length !== 10) {
      setNomeProcFat("");
      return;
    }
    setBuscandoProcFat(true);
    try {
      const resp = await labSigtap(codLimpo, undefined, 1, 5, false);
      const lista = pagData<SigtapProc>(resp);
      const achado = lista.find((x: SigtapProc) => x.codigo === codLimpo);
      if (achado) {
        setNomeProcFat(achado.descricao);
        if (Number(manualValorSa) === 0 && Number(manualValorSp) === 0 && Number(manualValorSh) === 0) {
          setManualValorSa(String(achado.valor_sa || 0));
          setManualValorSp(String(achado.valor_sp || 0));
          setManualValorSh(String(achado.valor_sh || 0));
        }
        if (achado.complexidade) setManualComplexidade(achado.complexidade);
        if (achado.instrumento) setManualInstrumento(achado.instrumento);
      } else {
        setNomeProcFat("Código informado não localizado na base local (será validado no envio).");
      }
    } catch {
      setNomeProcFat("");
    } finally {
      setBuscandoProcFat(false);
    }
  }

  function abrirModalNovo() {
    setEditSigtapId(null);
    setManualCodigo("");
    setManualDescricao("");
    setManualComplexidade("MC");
    setManualInstrumento("BPA-C");
    setManualValorSa("0");
    setManualValorSp("0");
    setManualValorSh("0");
    setManualSexo("");
    setManualSemCodigo(false);
    setManualCodigoFat("");
    setNomeProcFat("");
    limparBuscaSigtapRef();
    setErro("");
    setModalManual(true);
  }

  function abrirModalEditar(proc: SigtapProc) {
    setEditSigtapId(proc.id ?? null);
    setManualCodigo(proc.codigo || "");
    setManualDescricao(proc.descricao || "");
    setManualComplexidade(proc.complexidade || "MC");
    setManualInstrumento(proc.instrumento || "BPA-C");
    setManualValorSa(String(proc.valor_sa ?? 0));
    setManualValorSp(String(proc.valor_sp ?? 0));
    setManualValorSh(String(proc.valor_sh ?? 0));
    setManualSexo(proc.sexo || "");
    setManualSemCodigo(Boolean(proc.sem_codigo_especifico));
    const codFat = proc.codigo_faturamento_sigtap || "";
    setManualCodigoFat(codFat);
    setNomeProcFat("");
    limparBuscaSigtapRef();
    setErro("");
    setModalManual(true);
    if (codFat.length === 10) {
      buscarExameFaturamento(codFat);
    }
  }

  async function salvarProcedimentoManual() {
    if (!manualSemCodigo && !/^\d{10}$/.test(manualCodigo.trim())) {
      setErro("O código SIGTAP padrão deve conter exatamente 10 dígitos numéricos.");
      return;
    }
    if (!manualSemCodigo && manualCodigo.trim().startsWith("99999")) {
      setErro("Informe um código SIGTAP oficial de 10 dígitos ou marque 'sem código específico' e vincule o código SIGTAP oficial.");
      return;
    }
    if (manualSemCodigo && manualCodigoFat.trim() && !/^\d{10}$/.test(manualCodigoFat.trim().replace(/\D/g, ""))) {
      setErro("O código SIGTAP para faturamento deve conter exatamente 10 dígitos numéricos.");
      return;
    }
    if (!manualDescricao.trim()) {
      setErro("A descrição do procedimento é obrigatória.");
      return;
    }
    setSalvandoManual(true);
    setErro("");
    try {
      const payload = {
        codigo: manualCodigo.trim(),
        descricao: manualDescricao.trim(),
        complexidade: manualComplexidade,
        instrumento: manualInstrumento,
        valor_sa: Number(manualValorSa) || 0,
        valor_sp: Number(manualValorSp) || 0,
        valor_sh: Number(manualValorSh) || 0,
        sexo: manualSexo || undefined,
        sem_codigo_especifico: manualSemCodigo,
        codigo_faturamento_sigtap: manualCodigoFat.trim().replace(/\D/g, ""),
      };
      const resp = editSigtapId
        ? await sigtapAtualizar(editSigtapId, payload)
        : await sigtapCriarManual(payload);
      setOk(
        editSigtapId
          ? `Procedimento ${resp.codigo} atualizado com sucesso.`
          : `Procedimento ${resp.codigo} cadastrado com sucesso.`,
      );
      setModalManual(false);
      setEditSigtapId(null);
      setManualCodigo("");
      setManualDescricao("");
      setManualValorSa("0");
      setManualValorSp("0");
      setManualValorSh("0");
      setManualSemCodigo(false);
      setManualCodigoFat("");
      setNomeProcFat("");
      limparBuscaSigtapRef();
      buscar(page, pageSize);
    } catch (e: any) {
      setErro(msgErro(e, editSigtapId ? "Erro ao atualizar procedimento SIGTAP." : "Erro ao cadastrar procedimento manual."));
    } finally {
      setSalvandoManual(false);
    }
  }

  function buscar(p = 1, limite = pageSize) {
    const limitParam = limite >= 5000 ? 5000 : limite;
    setErro("");
    labSigtap(
      q || undefined,
      inst || undefined,
      p,
      limitParam,
      apenasLab,
      grupoCodigo || undefined,
      subgrupoCodigo || undefined,
      cboCodigo || undefined,
    )
      .then((r) => {
        setErro("");
        setLista(pagData<SigtapProc>(r));
        const m = pagMeta(r);
        setTotal(m.total);
        setPage(m.page);
        setPages(m.pages);
      })
      .catch((e) => setErro(msgErro(e, "Falha ao buscar tabela.")));
  }

  function carregarVersoes() {
    sigtapVersoes().then(setVersoes).catch(() => {});
  }

  function carregarAutoSync() {
    sigtapAutoSyncStatus().then(setAutoSync).catch(() => {});
    siaAutoSyncStatus().then(setSiaAutoSync).catch(() => {});
  }

  useEffect(() => {
    let cancel = false;
    sigtapArvore({
      grupo_codigo: grupoCodigo || undefined,
      subgrupo_codigo: subgrupoCodigo || undefined,
      cbo: cboCodigo || undefined,
    })
      .then((res) => {
        if (!cancel) setArvore(res);
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, [grupoCodigo, subgrupoCodigo, cboCodigo]);

  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      buscar(1, pageSize);
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, inst, apenasLab, grupoCodigo, subgrupoCodigo, cboCodigo, pageSize]);

  useEffect(() => {
    carregarVersoes();
    carregarAutoSync();
  }, []);

  useEffect(() => {
    const qParam = searchParams.get("q") || "";
    const editarParam = (searchParams.get("editar") || "").trim();
    if (qParam && qParam !== q) {
      setQ(qParam);
    }
    if (!editarParam || editarParamProcessadoRef.current === editarParam) return;
    const matchLocal = lista.find((x) => x.codigo === editarParam || String(x.id) === editarParam);
    if (matchLocal) {
      editarParamProcessadoRef.current = editarParam;
      abrirModalEditar(matchLocal);
      const next = new URLSearchParams(searchParams);
      next.delete("editar");
      setSearchParams(next, { replace: true });
      return;
    }
    labSigtap(editarParam, undefined, 1, 10, false)
      .then((resp) => {
        const encontrados = pagData<SigtapProc>(resp);
        const match = encontrados.find((x) => x.codigo === editarParam || String(x.id) === editarParam) || encontrados[0];
        if (match) {
          editarParamProcessadoRef.current = editarParam;
          abrirModalEditar(match);
          const next = new URLSearchParams(searchParams);
          next.delete("editar");
          setSearchParams(next, { replace: true });
        }
      })
      .catch((e) => setErro(msgErro(e, "Falha ao carregar procedimento para edição.")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, lista]);

  const opcoesCboArvore = useMemo(() => {
    return (arvore?.cbos ?? []).map((c) => ({
      value: c.cbo,
      label: c.descricao ? `${c.cbo} · ${c.descricao}` : `CBO ${c.cbo}`,
      sub: c.cbo ? `CBO ${c.cbo}` : undefined,
      keywords: `${c.cbo} ${c.descricao}`,
    }));
  }, [arvore]);

  async function atualizarConfigAutoSync(patch: { sigtap_sync_automatica?: boolean; sigtap_sync_intervalo_horas?: number }) {
    setSalvandoAutoSync(true);
    setErro("");
    try {
      const payload = { ...patch, sigtap_sync_intervalo_horas: 24 };
      const novo = await sigtapAutoSyncConfig(payload);
      setAutoSync((prev) =>
        prev
          ? { ...prev, ...novo }
          : {
              sigtap_sync_automatica: novo.sigtap_sync_automatica,
              sigtap_sync_intervalo_horas: 24,
              sigtap_sync_ultima_execucao: null,
              sigtap_sync_ultimo_status: "",
              sigtap_sync_ultima_competencia: "",
              sigtap_sync_ultimo_erro: "",
              em_execucao: false,
            },
      );
      setOk("Configuração de sincronização diária da Tabela Unificada atualizada.");
    } catch (e: unknown) {
      setErro(msgErro(e, "Falha ao atualizar configuração automática do SIGTAP."));
    } finally {
      setSalvandoAutoSync(false);
    }
  }

  async function atualizarConfigSiaAutoSync(patch: { sia_sync_automatica?: boolean }) {
    setSalvandoSiaAutoSync(true);
    setErro("");
    try {
      const novo = await siaAutoSyncConfig(patch);
      setSiaAutoSync((prev) =>
        prev
          ? { ...prev, ...novo }
          : {
              sia_sync_automatica: novo.sia_sync_automatica,
              sia_sync_ultima_execucao: null,
              sia_sync_ultimo_status: "",
              sia_sync_ultima_competencia: "",
              sia_sync_ultimo_erro: "",
              em_execucao: false,
            },
      );
      setOk("Configuração de sincronização da Tabela SIA (FTP DATASUS) atualizada.");
    } catch (e: unknown) {
      setErro(msgErro(e, "Falha ao atualizar configuração automática do SIA."));
    } finally {
      setSalvandoSiaAutoSync(false);
    }
  }

  async function sincronizarSiaAgora() {
    setExecutandoSiaSync(true);
    setErro("");
    setOk("");
    try {
      const res = await siaAutoSyncExecutar(competencia || undefined, false);
      carregarAutoSync();
      const st = String(res.status || "").toUpperCase();
      if (st === "SUCESSO" && res.ok) {
        setOk(
          `Tabela SIA sincronizada com sucesso via FTP oficial (${String(res.competencia || competencia)}): ${Number(res.inseridos || 0)} inseridos, ${Number(res.atualizados || 0)} atualizados.`,
        );
        carregarVersoes();
        buscar(1);
      } else if (st === "SEM_NOVIDADE") {
        setOk(
          String(
            res.mensagem ||
              `A Tabela SIA (${String(res.competencia || competencia)}) já está atualizada com a versão oficial do DATASUS.`,
          ),
        );
      } else {
        setErro(String(res.mensagem || "Falha na sincronização da Tabela SIA via FTP DATASUS."));
      }
    } catch (e: unknown) {
      setErro(msgErro(e, "Falha na sincronização da Tabela SIA."));
    } finally {
      setExecutandoSiaSync(false);
    }
  }

  async function sincronizarAgora() {
    setExecutandoAutoSync(true);
    setErro("");
    setOk("");
    setAvisoAuto(null);
    try {
      const res = await sigtapAutoSyncExecutar(competencia || undefined, false);
      carregarAutoSync();
      const st = String(res.status || "").toUpperCase();
      if (st === "SUCESSO" && res.ok) {
        setPreview(res as unknown as SigtapImportOut);
        setOk(
          `Sincronização concluída com sucesso (${String(res.competencia || competencia)}): ${Number(res.inseridos || 0)} inseridos, ${Number(res.atualizados || 0)} atualizados.`,
        );
        carregarVersoes();
        buscar(1);
      } else if (st === "SUCESSO_PARCIAL") {
        setOk(String(res.mensagem || "Tabela SIA sincronizada com sucesso via FTP oficial do DATASUS."));
        carregarVersoes();
        buscar(1);
      } else if (st === "SEM_NOVIDADE") {
        setOk(
          String(
            res.mensagem ||
              `A Tabela Unificada (${String(res.competencia || competencia)}) já está atualizada com a versão oficial do DATASUS.`,
          ),
        );
      } else if (st === "INDISPONIVEL" || st === "ERRO" || res.ok === false) {
        setAvisoAuto({
          mensagem: String(
            res.mensagem ||
              "O portal ou FTP do DATASUS/SIGTAP não respondeu no momento. Utilize o link oficial abaixo para download manual.",
          ),
          linkOficial: String(res.link_oficial || "http://sigtap.datasus.gov.br/tabela-unificada/app/download.jsp"),
        });
      } else {
        setOk(String(res.mensagem || "Sincronização concluída."));
      }
    } catch (e: unknown) {
      const detalhe = msgErro(
        e,
        "Não foi possível conectar ao portal do DATASUS no momento para sincronização automática.",
      );
      setAvisoAuto({
        mensagem: detalhe,
        linkOficial: "http://sigtap.datasus.gov.br/tabela-unificada/app/download.jsp",
      });
      carregarAutoSync();
    } finally {
      setExecutandoAutoSync(false);
    }
  }

  async function importar(simular: boolean) {
    if (!arquivo) {
      setErro("Selecione o .zip ou .txt/.csv do layout SIGTAP.");
      return;
    }
    if (!/^\d{4}-\d{2}$/.test(competencia)) {
      setErro("Competência inválida (AAAA-MM).");
      return;
    }
    setImportando(true);
    setErro("");
    setOk("");
    try {
      const r = await sigtapImportar(arquivo, competencia, simular);
      setPreview(r);
      if (!simular) {
        setOk(`Carga ${competencia} aplicada: ${r.inseridos} inseridos, ${r.atualizados} atualizados.`);
        carregarVersoes();
        buscar(1);
      }
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail ?? "Erro na importação.";
      setErro(msg);
    } finally {
      setImportando(false);
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="font-display text-lg font-bold text-sus-950">Tabela SIGTAP Completa</h2>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            onClick={abrirModalNovo}
            className="!bg-teal !text-sus-950 font-bold flex items-center gap-1.5"
          >
            <Plus className="h-4 w-4" /> Cadastrar Procedimento Manual
          </Button>
          <ExportarExcel
            url="/api/lab/sigtap/exportar"
            arquivo="sigtap"
            params={{
              q: q.trim() || undefined,
              instrumento: inst || undefined,
              apenas_laboratoriais: apenasLab,
              grupo_codigo: grupoCodigo || undefined,
              subgrupo_codigo: subgrupoCodigo || undefined,
              cbo: cboCodigo || undefined,
            }}
          />
        </div>
      </div>

      <Card className="mb-4 p-4 space-y-3">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="md:col-span-2">
            <Label>Busca rápida</Label>
            <Input placeholder="Código ou descrição do procedimento…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div>
            <Label>Instrumento</Label>
            <Select value={inst} onChange={(e) => setInst(e.target.value)}>
              <option value="">Todos</option>
              {INSTRUMENTOS.map((i) => <option key={i} value={i}>{i}</option>)}
            </Select>
          </div>
          <div className="flex flex-col justify-end pb-1">
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-sus-950">
              <input
                type="checkbox"
                checked={apenasLab}
                onChange={(e) => setApenasLab(e.target.checked)}
                className="h-4 w-4 rounded border-sus-900/30 text-teal"
              />
              Somente Laboratoriais (0202)
            </label>
          </div>
        </div>

        <div className="grid gap-3 border-t border-sus-900/10 pt-3 md:grid-cols-3">
          <div>
            <Label className="flex items-center gap-1.5 text-xs">
              <Layers className="h-3.5 w-3.5 text-teal" /> Área (Grupo SIGTAP)
            </Label>
            <Select
              value={grupoCodigo}
              onChange={(e) => {
                const g = e.target.value;
                setGrupoCodigo(g);
                if (subgrupoCodigo && (!g || !subgrupoCodigo.startsWith(g))) {
                  setSubgrupoCodigo("");
                }
              }}
              className="mt-1"
            >
              <option value="">Todas as áreas (Grupos 01–08)</option>
              {(arvore?.grupos ?? []).map((g) => (
                <option key={g.codigo} value={g.codigo}>
                  {g.codigo} · {g.nome}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label className="text-xs">Subgrupo SIGTAP</Label>
            <Select
              value={subgrupoCodigo}
              onChange={(e) => {
                const s = e.target.value;
                setSubgrupoCodigo(s);
                if (s.length >= 2 && !grupoCodigo) {
                  setGrupoCodigo(s.slice(0, 2));
                }
              }}
              className="mt-1"
            >
              <option value="">Todos os subgrupos</option>
              {(arvore?.subgrupos ?? [])
                .filter((s) => !grupoCodigo || s.grupo_codigo === grupoCodigo || s.codigo.startsWith(grupoCodigo))
                .map((s) => (
                  <option key={s.codigo} value={s.codigo}>
                    {s.codigo} · {s.nome}
                  </option>
                ))}
            </Select>
          </div>
          <div>
            <Label className="text-xs">CBO (Ocupação Autorizada)</Label>
            <div className="mt-1">
              <Combobox
                value={cboCodigo}
                onChange={(v) => setCboCodigo(v)}
                options={opcoesCboArvore}
                placeholder="Filtrar por CBO…"
                searchPlaceholder="Código ou ocupação CBO…"
                emptyText="Nenhum CBO nessa área/subgrupo"
                showAll={true}
              />
            </div>
          </div>
        </div>
      </Card>

      {erro && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
      {ok && <p className="mb-3 rounded-xl bg-teal/10 px-3 py-2 text-sm text-teal">{ok}</p>}

      <Card className="mb-4 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-sus-900/10 bg-sand text-xs uppercase text-sus-900/60">
              <th className="px-4 py-3">Código</th>
              <th className="px-4 py-3">Descrição / Área &amp; Subgrupo</th>
              <th className="px-4 py-3">Complexidade</th>
              <th className="px-4 py-3">Instrumento</th>
              <th className="px-4 py-3">Valores SA/SP/SH</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((s) => (
              <tr key={s.id ?? s.codigo} className="border-b border-sus-900/5 last:border-0 hover:bg-sand/30">
                <td className="px-4 py-3 font-mono font-semibold">
                  <span>{s.codigo}</span>
                  {s.sem_codigo_especifico ? (
                    <span className="ml-2 inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                      SEM CÓD. ESPECÍFICO
                    </span>
                  ) : s.origem_manual ? (
                    <span className="ml-2 inline-flex items-center rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-800">
                      MANUAL
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <p className="font-medium text-sus-950" title={s.descricao}>{s.descricao}</p>
                  {s.codigo_faturamento_sigtap && (
                    <p className="mt-0.5 text-[11px] font-bold text-teal">
                      Faturamento SUS: SIGTAP {s.codigo_faturamento_sigtap}
                    </p>
                  )}
                  {(s.grupo_nome || s.subgrupo_nome) && (
                    <p className="mt-0.5 text-[11px] text-ink/55">
                      {s.grupo_codigo ? `${s.grupo_codigo} ${s.grupo_nome}` : ""}
                      {s.subgrupo_codigo ? ` › ${s.subgrupo_codigo} ${s.subgrupo_nome}` : ""}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3 text-xs">{s.complexidade || "—"}</td>
                <td className="px-4 py-3 text-xs">{s.instrumento}</td>
                <td className="px-4 py-3 text-xs">{brl(s.valor_sa)} / {brl(s.valor_sp)} / {brl(s.valor_sh)}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => abrirModalEditar(s)}
                    className="inline-flex items-center gap-1 rounded-lg border border-sus-900/15 bg-white px-2.5 py-1 text-xs font-semibold text-sus-900 hover:bg-sand transition"
                    title="Editar código ou mapeamento SIGTAP deste procedimento"
                  >
                    <Pencil className="h-3.5 w-3.5 text-teal" /> Editar
                  </button>
                </td>
              </tr>
            ))}
            {lista.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-ink/45">Nada encontrado.</td></tr>}
          </tbody>
        </table>
        </div>
        <Paginacao
          page={page}
          pages={pages}
          total={total}
          pageSize={pageSize}
          onPageSize={(sz) => {
            const novoLimite = typeof sz === "number" ? sz : 5000;
            setPageSize(novoLimite);
            buscar(1, novoLimite);
          }}
          onPage={(p) => buscar(p, pageSize)}
        />
      </Card>

      <Card className="mb-4 p-5 space-y-5">
        <div>
          <p className="flex items-center gap-2 font-display text-base font-bold text-sus-950">
            <Globe className="h-5 w-5 text-teal" /> Atualização e Carga da Tabela Unificada (SIGTAP / DATASUS)
          </p>
          <p className="mt-1 text-xs text-ink/65 leading-relaxed">
            Mantenha o catálogo de procedimentos, valores ambulatoriais/hospitalares e compatibilidades de CBO/CID
            atualizados com a competência oficial do Ministério da Saúde.
          </p>
        </div>

        {/* Sincronização Automática com DATASUS (SIGTAP Portal + Tabela SIA FTP) */}
        <div className="rounded-2xl border border-teal/25 bg-teal/5 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-bold text-sm text-sus-950 flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-teal" /> Sincronização Automática (SIGTAP + Tabela SIA / DATASUS)
              </p>
              <p className="text-xs text-ink/65 mt-0.5">
                Atualiza os procedimentos, valores e regras oficiais integrando o Portal SIGTAP e o FTP oficial do SIA (<code>ftp://ftp.datasus.gov.br/siasus/SIA/</code>).
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {autoSync && (
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                    ["sucesso", "sem_novidade"].includes((autoSync.sigtap_sync_ultimo_status || "").toLowerCase())
                      ? "bg-emerald-100 text-emerald-800"
                      : ["erro", "indisponivel"].includes((autoSync.sigtap_sync_ultimo_status || "").toLowerCase())
                        ? "bg-amber-100 text-amber-900 border border-amber-300"
                        : "bg-sus-900/10 text-sus-900"
                  }`}
                >
                  SIGTAP: {autoSync.sigtap_sync_ultimo_status || "Aguardando"}
                  {autoSync.sigtap_sync_ultima_competencia ? ` (${autoSync.sigtap_sync_ultima_competencia})` : ""}
                </span>
              )}
              {siaAutoSync && (
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                    ["sucesso", "sem_novidade"].includes((siaAutoSync.sia_sync_ultimo_status || "").toLowerCase())
                      ? "bg-teal/15 text-teal-800 border border-teal/30"
                      : ["erro", "indisponivel"].includes((siaAutoSync.sia_sync_ultimo_status || "").toLowerCase())
                        ? "bg-amber-100 text-amber-900 border border-amber-300"
                        : "bg-sus-900/10 text-sus-900"
                  }`}
                >
                  SIA (FTP): {siaAutoSync.sia_sync_ultimo_status || "Aguardando"}
                  {siaAutoSync.sia_sync_ultima_competencia ? ` (${siaAutoSync.sia_sync_ultima_competencia})` : ""}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3 pt-1">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-sus-900/15 bg-white px-3 py-2 text-xs font-semibold text-sus-950">
              <input
                type="checkbox"
                checked={Boolean(autoSync?.sigtap_sync_automatica ?? true)}
                disabled={salvandoAutoSync}
                onChange={(e) => atualizarConfigAutoSync({ sigtap_sync_automatica: e.target.checked })}
                className="h-4 w-4 rounded border-sus-900/30 text-teal"
              />
              Auto-sync SIGTAP (1x ao mês)
            </label>

            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-sus-900/15 bg-white px-3 py-2 text-xs font-semibold text-sus-950">
              <input
                type="checkbox"
                checked={Boolean(siaAutoSync?.sia_sync_automatica ?? true)}
                disabled={salvandoSiaAutoSync}
                onChange={(e) => atualizarConfigSiaAutoSync({ sia_sync_automatica: e.target.checked })}
                className="h-4 w-4 rounded border-sus-900/30 text-teal"
              />
              Auto-sync Tabela SIA / FTP
            </label>

            <div>
              <Label className="text-xs">Competência (AAAA-MM)</Label>
              <Input
                type="month"
                value={competencia}
                onChange={(e) => setCompetencia(e.target.value)}
                className="mt-1 bg-white h-9"
              />
            </div>

            <Button
              type="button"
              onClick={sincronizarAgora}
              disabled={executandoAutoSync || executandoSiaSync || importando}
              className="!bg-teal !text-sus-950 font-bold flex items-center gap-1.5 !w-auto"
            >
              <RefreshCw className={`h-4 w-4 ${executandoAutoSync ? "animate-spin" : ""}`} />
              {executandoAutoSync ? "Sincronizando SIGTAP + SIA…" : "Sincronizar SIGTAP + SIA"}
            </Button>

            <Button
              type="button"
              onClick={sincronizarSiaAgora}
              disabled={executandoAutoSync || executandoSiaSync || importando}
              className="border border-sus-900/20 bg-white hover:bg-sus-900/5 text-sus-950 font-semibold flex items-center gap-1.5 !w-auto"
            >
              <Download className={`h-4 w-4 ${executandoSiaSync ? "animate-spin" : ""}`} />
              {executandoSiaSync ? "Baixando do FTP DATASUS…" : "Sincronizar Apenas SIA (FTP)"}
            </Button>
          </div>

          {/* Banner de Erro/Indisponibilidade que leva diretamente ao link de download oficial do DATASUS */}
          {avisoAuto && (
            <div className="rounded-xl border border-amber-400 bg-amber-50 p-4 text-xs text-amber-950 space-y-2.5 mt-3 animate-in fade-in">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-2 flex-1">
                  <div>
                    <p className="font-bold text-sm text-amber-950">
                      Não foi possível conectar ao portal do DATASUS
                    </p>
                    <p className="leading-relaxed text-amber-900 mt-0.5">
                      {avisoAuto.mensagem}
                    </p>
                  </div>
                  <div className="pt-1 flex flex-wrap items-center gap-3">
                    <a
                      href={avisoAuto.linkOficial || "http://sigtap.datasus.gov.br/tabela-unificada/app/download.jsp"}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 rounded-xl bg-amber-700 hover:bg-amber-800 text-white font-bold px-3.5 py-2 text-xs shadow-sm transition"
                    >
                      <Download className="h-4 w-4" />
                      Baixar Tabela Oficial no DATASUS (download.jsp)
                      <ExternalLink className="h-3.5 w-3.5 opacity-80" />
                    </a>
                    <span className="text-[11px] text-amber-900/80">
                      Após baixar o arquivo <b>.zip</b> no site oficial do DATASUS, utilize o campo de <b>Importação Manual</b> abaixo para carregar a tabela no sistema.
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Exibe último aviso registrado se não estiver exibindo aviso ativo */}
          {!avisoAuto && autoSync?.sigtap_sync_ultimo_erro && (
            <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2 text-[11px] text-amber-900">
              <span>Último aviso registrado: {autoSync.sigtap_sync_ultimo_erro}</span>
              <a
                href="http://sigtap.datasus.gov.br/tabela-unificada/app/download.jsp"
                target="_blank"
                rel="noreferrer"
                className="font-bold text-amber-800 underline hover:text-amber-950 flex items-center gap-1"
              >
                Link de Download DATASUS <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
        </div>

        {/* Bloco 2: Importação Manual de Arquivo */}
        <div className="rounded-2xl border border-sus-900/15 bg-white p-4 space-y-3">
          <div>
            <p className="font-bold text-sm text-sus-950 flex items-center gap-1.5">
              <Upload className="h-4 w-4 text-sus-900" /> Importação Manual de Arquivo (.zip / .txt / .csv)
            </p>
            <p className="text-xs text-ink/65 mt-0.5">
              Envie o pacote compactado (.zip oficial) do SIGTAP ou arquivos .txt/.csv avulsos do layout FTP do DATASUS.
              A simulação permite auditar a quantidade de procedimentos, CBOs e CIDs antes de gravar no banco de dados.
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-2.5">
            <div className="flex-1 min-w-[240px]">
              <Label className="text-xs">Arquivo da Tabela Unificada (.zip / .txt / .csv / .dat) *</Label>
              <Input
                type="file"
                accept=".zip,.txt,.csv,.dat"
                onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Competência</Label>
              <Input
                type="month"
                value={competencia}
                onChange={(e) => setCompetencia(e.target.value)}
                className="mt-1"
              />
            </div>
            <Button
              onClick={() => importar(true)}
              disabled={importando || !arquivo}
              className="!w-auto"
              variant="outline"
            >
              {importando ? "Processando…" : "Simular Carga"}
            </Button>
            <Button
              onClick={() => importar(false)}
              disabled={importando || !arquivo}
              className="!bg-teal !text-sus-950 font-bold !w-auto"
            >
              Aplicar Carga Manual
            </Button>
            <a
              href="/api/lab/sigtap/modelo"
              className="inline-flex min-h-[44px] items-center rounded-xl px-3 py-2 text-xs font-bold text-sus-900 hover:bg-sus-900/5 transition"
            >
              Baixar modelo CSV
            </a>
          </div>
        </div>

        {preview && (
          <div className="rounded-2xl bg-sand/60 p-4 text-xs border border-sus-900/10 space-y-1.5">
            <p className="font-bold text-sus-950 text-sm">
              {preview.simulacao ? "📊 Relatório de Simulação" : "✅ Carga Aplicada com Sucesso"} — {preview.arquivo} · Competência {preview.competencia}
            </p>
            <p className="text-ink/75">
              Registros Processados: <b>{preview.processados}</b> · Inseridos: <b>{preview.inseridos}</b> ·
              Atualizados: <b>{preview.atualizados}</b> · Ignorados: <b>{preview.ignorados}</b> ·
              Compatibilidades CBO: <b>{preview.cbo_total}</b> · Compatibilidades CID: <b>{preview.cid_total}</b>
            </p>
            {preview.erros.length > 0 && (
              <div className="mt-2 pt-2 border-t border-sus-900/10">
                <p className="font-semibold text-red-700 mb-1">Avisos / Inconsistências na leitura:</p>
                <ul className="space-y-1 text-ink/65 max-h-32 overflow-y-auto">
                  {preview.erros.slice(0, 10).map((e, i) => (
                    <li key={i}>· {e.arquivo} linha {e.linha}: {e.motivo}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <p className="flex items-center gap-2 border-b border-sus-900/10 bg-sand px-4 py-3 font-display text-sm font-bold text-sus-950">
          <History className="h-4 w-4" /> Histórico de versões importadas
        </p>
        <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b border-sus-900/10 text-xs uppercase text-sus-900/60">
            <th className="px-4 py-3">Competência</th><th className="px-4 py-3">Arquivo</th><th className="px-4 py-3">Proc.</th><th className="px-4 py-3">Inseridos</th><th className="px-4 py-3">Atualizados</th><th className="px-4 py-3">CBO/CID</th><th className="px-4 py-3">Por</th><th className="px-4 py-3">Em</th>
          </tr></thead>
          <tbody>
            {versoes.map((v) => (
              <tr key={v.id} className="border-b border-sus-900/5 last:border-0">
                <td className="px-4 py-3 font-mono font-bold">{v.competencia}</td>
                <td className="px-4 py-3 text-xs">{v.arquivo || "—"}</td>
                <td className="px-4 py-3 text-xs">{v.total_proc}</td>
                <td className="px-4 py-3 text-xs">{v.inseridos}</td>
                <td className="px-4 py-3 text-xs">{v.atualizados}</td>
                <td className="px-4 py-3 text-xs">{v.cbo_total}/{v.cid_total}</td>
                <td className="px-4 py-3 text-xs">{v.usuario || "—"}</td>
                <td className="px-4 py-3 text-xs">{v.criado_em || "—"}</td>
              </tr>
            ))}
            {versoes.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-ink/45">Nenhuma carga registrada.</td></tr>}
          </tbody>
        </table>
        </div>
      </Card>

      {/* Modal de Cadastro Manual de Procedimento */}
      {modalManual && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4"
          onClick={() => setModalManual(false)}
        >
          <div
            className="rise max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between border-b border-sus-900/10 pb-3">
              <div>
                <p className="font-display text-base font-bold text-sus-950 flex items-center gap-2">
                  {editSigtapId ? <Pencil className="h-5 w-5 text-teal" /> : <Plus className="h-5 w-5 text-teal" />}
                  {editSigtapId ? "Editar Procedimento SIGTAP" : "Cadastrar Procedimento SIGTAP Manual"}
                </p>
                <p className="text-xs text-ink/60 mt-0.5">
                  {editSigtapId
                    ? "Atualize o código oficial SIGTAP (10 dígitos) ou vincule um código de faturamento SUS."
                    : "Adiciona um procedimento avulso compatível com a estrutura de 10 dígitos do SIGTAP / SUS."}
                </p>
              </div>
              <button
                onClick={() => setModalManual(false)}
                className="rounded-lg p-1.5 text-ink/50 hover:bg-sand"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              {editSigtapId && manualCodigo.trim().startsWith("99999") && !manualSemCodigo && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                  <p className="font-bold">Código municipal legado ({manualCodigo.trim()})</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed">
                    Para corrigir a crítica do BPA/SUS: informe um código SIGTAP oficial de 10 dígitos no campo de código abaixo, ou marque{" "}
                    <strong>"Procedimento não tem código específico no SIGTAP"</strong> para vincular um código oficial equivalente para faturamento.
                  </p>
                </div>
              )}
              {/* Opção: Não possui código SIGTAP específico */}
              <div className="rounded-xl border border-amber-300 bg-amber-50/70 p-3 space-y-1.5">
                <label className="flex items-center gap-2 text-xs font-bold text-amber-950 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={manualSemCodigo}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setManualSemCodigo(checked);
                      if (checked && !editSigtapId) {
                        setManualCodigo("");
                      }
                    }}
                    className="rounded border-amber-400 text-teal"
                  />
                  <span>Procedimento não tem código específico no SIGTAP</span>
                </label>
                <p className="text-[11px] text-amber-900/90 leading-relaxed">
                  Permite cadastrar exames/procedimentos sem código próprio no SUS e informar o código SIGTAP de outro exame equivalente para ser usado no faturamento/BPA.
                </p>
              </div>

              {manualSemCodigo && (
                <div className="rounded-xl border border-teal/20 bg-teal/5 p-3.5 space-y-2.5">
                  <Label className="text-xs font-bold text-teal-950">
                    Buscar Procedimento Existente na Tabela SIGTAP (Faturamento SUS) *
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
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-teal">Buscando…</span>
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
                                  {pr.instrumento} · {pr.complexidade} · Valor SIGTAP/SUS: {brl(valRef)}
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
                          Valor SIGTAP/SUS: <strong>{brl((procSigtapRefSel.valor_sa || 0) + (procSigtapRefSel.valor_sp || 0))}</strong> · Instrumento: <strong>{procSigtapRefSel.instrumento}</strong> · Complexidade: <strong>{procSigtapRefSel.complexidade}</strong>
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
                      Código de Outro Exame para Faturamento (SIGTAP / BPA) *
                    </Label>
                    <div className="relative mt-1">
                      <Input
                        placeholder="Ex: 0202010183 (10 dígitos)"
                        maxLength={10}
                        value={manualCodigoFat}
                        onChange={(e) => {
                          const v = e.target.value.replace(/\D/g, "");
                          setManualCodigoFat(v);
                          if (procSigtapRefSel && v !== procSigtapRefSel.codigo) {
                            setProcSigtapRefSel(null);
                          }
                          if (v.length === 10) {
                            buscarExameFaturamento(v);
                          } else {
                            setNomeProcFat("");
                          }
                        }}
                        className="font-mono font-bold text-xs bg-white"
                      />
                      {buscandoProcFat && (
                        <span className="absolute right-3 top-2.5 text-[11px] text-teal">Buscando…</span>
                      )}
                    </div>
                  </div>
                  {nomeProcFat && !procSigtapRefSel && (
                    <p className="text-[11px] font-semibold text-teal-900 bg-white/80 p-2 rounded border border-teal/20">
                      Procedimento para faturamento: <strong>{nomeProcFat}</strong>
                    </p>
                  )}
                  <p className="text-[10px] text-ink/55">
                    Este código será utilizado no arquivo de produção ambulatorial (BPA), utilizando os valores e regras do SUS para este item.
                  </p>
                </div>
              )}

              <div>
                <Label>
                  {manualSemCodigo
                    ? "Código Interno / Identificador (opcional — gerado automaticamente se vazio)"
                    : "Código SIGTAP (10 dígitos numéricos) *"}
                </Label>
                <Input
                  placeholder={manualSemCodigo ? "Deixe em branco para gerar código 99... automático" : "Ex: 0202010183"}
                  maxLength={manualSemCodigo ? 20 : 10}
                  value={manualCodigo}
                  onChange={(e) => setManualCodigo(manualSemCodigo ? e.target.value : e.target.value.replace(/\D/g, ""))}
                />
                <p className="mt-1 text-[11px] text-ink/50">
                  {manualSemCodigo
                    ? "Identificador exclusivo do exame para prescrição e agendamento interno."
                    : "Os 2 primeiros dígitos definem o Grupo (ex: 02 = Procedimentos com Finalidade Diagnóstica)."}
                </p>
              </div>

              <div>
                <Label>Descrição Completa do Procedimento *</Label>
                <Input
                  placeholder="Ex: DETERMINACAO DE CURVA GLICEMICA (4 DOSAGENS)"
                  maxLength={1000}
                  value={manualDescricao}
                  onChange={(e) => setManualDescricao(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Complexidade</Label>
                  <Select value={manualComplexidade} onChange={(e) => setManualComplexidade(e.target.value)}>
                    <option value="MC">Média Complexidade (MC)</option>
                    <option value="AC">Alta Complexidade (AC)</option>
                    <option value="AB">Atenção Básica (AB)</option>
                    <option value="NA">Não se Aplica (NA)</option>
                  </Select>
                </div>
                <div>
                  <Label>Instrumento de Registro</Label>
                  <Select value={manualInstrumento} onChange={(e) => setManualInstrumento(e.target.value)}>
                    <option value="BPA-C">BPA Consolidado (BPA-C)</option>
                    <option value="BPA-I">BPA Individualizado (BPA-I)</option>
                    <option value="APAC">APAC</option>
                    <option value="AIH">AIH</option>
                    <option value="RAAS">RAAS</option>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Valor SA (R$)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={manualValorSa}
                    onChange={(e) => setManualValorSa(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Valor SP (R$)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={manualValorSp}
                    onChange={(e) => setManualValorSp(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Valor SH (R$)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={manualValorSh}
                    onChange={(e) => setManualValorSh(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <Label>Restrição de Sexo</Label>
                <Select value={manualSexo} onChange={(e) => setManualSexo(e.target.value)}>
                  <option value="">Ambos (Indiferente)</option>
                  <option value="M">Masculino</option>
                  <option value="F">Feminino</option>
                </Select>
              </div>

              {erro && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{erro}</p>}

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setModalManual(false)}>
                  Cancelar
                </Button>
                <Button
                  onClick={salvarProcedimentoManual}
                  disabled={salvandoManual || (!manualSemCodigo && !manualCodigo) || !manualDescricao.trim()}
                  className="!bg-teal !text-sus-950 font-bold"
                >
                  {salvandoManual ? "Salvando…" : editSigtapId ? "Atualizar Procedimento" : "Salvar Procedimento"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
