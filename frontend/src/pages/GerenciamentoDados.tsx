import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Building2,
  Calendar,
  CheckCheck,
  CheckCircle2,
  Clock,
  Database,
  Eraser,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FlaskConical,
  GitMerge,
  History,
  Info,
  ListOrdered,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  Users,
  Wrench,
  X,
} from "lucide-react";
import Paginacao from "../components/Paginacao";
import { Badge, Button, Card, Input, Label, Select } from "../components/ui/primitives";
import { useAuth } from "../hooks/useAuth";
import {
  executarLimpezaMassa,
  msgErro,
  obterAuditoriaDados,
  obterDiagnosticoDados,
  previewLimpezaMassa,
  resolverInconsistenciaDados,
  resolverInconsistenciasLoteDados,
  unificarRegistros,
  type AuditoriaItem,
  type DiagnosticoResponse,
  type EntidadeUnificavel,
  type ItemDiagnostico,
  type LimpezaMassaPreviewResponse,
  type ResolverInconsistenciaItem,
  type ResolverLoteResponse,
  type TipoLimpezaMassa,
  type UnificarResponse,
} from "../services/api";

type SubAba = "diagnostico" | "unificacao" | "limpeza" | "auditoria";
type DominioFiltro = "todos" | "pacientes" | "filas" | "laboratorio" | "viagens" | "cadastros";

const DIAG_SESSION_CACHE_KEY = "gerenciamento_dados_diag_cache_v1";

function lerCacheSessao(): DiagnosticoResponse | null {
  try {
    const raw = sessionStorage.getItem(DIAG_SESSION_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DiagnosticoResponse;
    if (parsed && parsed.resumo && parsed.detalhes) {
      return { ...parsed, cache_hit: true };
    }
    return null;
  } catch {
    return null;
  }
}

function salvarCacheSessao(dados: DiagnosticoResponse | null) {
  try {
    if (!dados) {
      sessionStorage.removeItem(DIAG_SESSION_CACHE_KEY);
    } else {
      sessionStorage.setItem(DIAG_SESSION_CACHE_KEY, JSON.stringify(dados));
    }
  } catch {
    // Ignora quota/modo privado
  }
}

function obterChaveUnica(item: ItemDiagnostico, dominioFallback: string, idx: number): string {
  if (item.chave_unica) return String(item.chave_unica);
  const ids = Array.isArray(item.ids) ? item.ids.join(",") : "";
  return `${item.dominio || dominioFallback}|${item.tipo}|${item.id || item.paciente_id || item.chave || ids || idx}`;
}

function converterParaPayloadResolucao(
  item: ItemDiagnostico,
  dominioFallback: string
): ResolverInconsistenciaItem {
  return {
    tipo: item.tipo,
    dominio: String(item.dominio || dominioFallback),
    chave_unica: item.chave_unica,
    dados: { ...item },
  };
}

function formatarDataHoraCache(geradoEm?: string | null): string | null {
  if (!geradoEm) return null;
  // Backend salva timestamp UTC naive; se não tem timezone, trata como UTC
  const iso = /[zZ]|[+-]\d{2}:\d{2}$/.test(geradoEm) ? geradoEm : `${geradoEm}Z`;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString("pt-BR");
}

export default function GerenciamentoDados() {
  const { user } = useAuth();
  const [subAba, setSubAba] = useState<SubAba>("diagnostico");

  // Alerta Global de Sucesso / Erro
  const [alertaSucesso, setAlertaSucesso] = useState<string | null>(null);
  const [alertaErro, setAlertaErro] = useState<string | null>(null);

  // Estado do Diagnóstico (com cache imediato em sessão + cache persistente no backend)
  const [carregandoDiag, setCarregandoDiag] = useState<boolean>(false);
  const [dominioSelecionado, setDominioSelecionado] = useState<DominioFiltro>("todos");
  const [diagnostico, setDiagnostico] = useState<DiagnosticoResponse | null>(() => lerCacheSessao());

  // Modais
  const [modalUnificarAberto, setModalUnificarAberto] = useState<boolean>(false);
  const [unificarPreenchido, setUnificarPreenchido] = useState<{
    entidade: EntidadeUnificavel;
    principalId: number;
    duplicadoId: number;
    detalhesItem?: ItemDiagnostico;
  } | null>(null);

  const [modalResolucaoItens, setModalResolucaoItens] = useState<ItemDiagnostico[] | null>(null);
  const [resolvendoChave, setResolvendoChave] = useState<string | null>(null);

  const [modalLimpezaAberto, setModalLimpezaAberto] = useState<boolean>(false);
  const [limpezaConfigurada, setLimpezaConfigurada] = useState<{
    tipo: TipoLimpezaMassa;
    filtro: Record<string, unknown>;
    previewInfo?: { totalAfetados: number; detalhes?: any[] };
  } | null>(null);
  const [modalDetalhesItem, setModalDetalhesItem] = useState<ItemDiagnostico | null>(null);

  // Auditoria
  const [logsAuditoria, setLogsAuditoria] = useState<AuditoriaItem[]>([]);
  const [totalLogs, setTotalLogs] = useState<number>(0);
  const [paginaAuditoria, setPaginaAuditoria] = useState<number>(1);
  const [limiteAuditoria, setLimiteAuditoria] = useState<number>(25);
  const [carregandoAudit, setCarregandoAudit] = useState<boolean>(false);

  // Na montagem inicial, usa cache persistente do servidor (forcar=false) sem reexecutar varredura pesada
  useEffect(() => {
    if (!diagnostico) {
      carregarDiagnostico(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Limpa alertas temporários
  useEffect(() => {
    if (alertaSucesso) {
      const timer = setTimeout(() => setAlertaSucesso(null), 9000);
      return () => clearTimeout(timer);
    }
  }, [alertaSucesso]);

  useEffect(() => {
    if (alertaErro) {
      const timer = setTimeout(() => setAlertaErro(null), 10000);
      return () => clearTimeout(timer);
    }
  }, [alertaErro]);

  // Carrega auditoria ao trocar para a sub-aba ou alterar paginação
  useEffect(() => {
    if (subAba === "auditoria") {
      carregarAuditoria(paginaAuditoria, limiteAuditoria);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subAba, paginaAuditoria, limiteAuditoria]);

  async function carregarDiagnostico(forcar = false) {
    setCarregandoDiag(true);
    setAlertaErro(null);
    try {
      const dados = await obterDiagnosticoDados("todos", forcar);
      setDiagnostico(dados);
      salvarCacheSessao(dados);
    } catch (err: unknown) {
      setAlertaErro(msgErro(err, "Falha ao executar rotina de diagnóstico de dados."));
    } finally {
      setCarregandoDiag(false);
    }
  }

  async function carregarAuditoria(pagina = paginaAuditoria, limite = limiteAuditoria) {
    setCarregandoAudit(true);
    try {
      const tamanhoEfetivo = Math.min(500, Math.max(1, limite));
      const offset = (Math.max(1, pagina) - 1) * tamanhoEfetivo;
      const resp = await obterAuditoriaDados(tamanhoEfetivo, offset);
      setLogsAuditoria(resp.logs);
      setTotalLogs(resp.total);
    } catch (err: unknown) {
      setAlertaErro(msgErro(err, "Falha ao carregar registros de auditoria."));
    } finally {
      setCarregandoAudit(false);
    }
  }

  function abrirUnificacao(
    entidade: EntidadeUnificavel,
    principalId: number,
    duplicadoId: number,
    item?: ItemDiagnostico
  ) {
    setUnificarPreenchido({
      entidade,
      principalId,
      duplicadoId,
      detalhesItem: item,
    });
    setModalUnificarAberto(true);
  }

  async function handleCorrigirUnico(item: ItemDiagnostico) {
    const chave = obterChaveUnica(item, String(item.dominio || "geral"), 0);
    setResolvendoChave(chave);
    setAlertaErro(null);
    try {
      const resp = await resolverInconsistenciaDados(
        converterParaPayloadResolucao(item, String(item.dominio || "geral"))
      );
      setAlertaSucesso(resp.mensagem);
      salvarCacheSessao(null);
      await carregarDiagnostico(true);
    } catch (err: unknown) {
      setAlertaErro(msgErro(err, "Falha ao corrigir inconsistência."));
    } finally {
      setResolvendoChave(null);
    }
  }

  const resumo = diagnostico?.resumo;
  const totalInconsistencias = resumo
    ? resumo.pacientes.inconsistencias +
      resumo.filas.inconsistencias +
      resumo.laboratorio.inconsistencias +
      resumo.viagens.inconsistencias +
      resumo.cadastros.inconsistencias
    : 0;

  const totalDuplicidades = resumo
    ? resumo.pacientes.duplicidades +
      resumo.filas.duplicidades +
      resumo.laboratorio.duplicidades +
      resumo.viagens.duplicidades +
      resumo.cadastros.duplicidades
    : 0;

  const ultimaChecagemFmt = formatarDataHoraCache(diagnostico?.gerado_em);

  return (
    <div className="space-y-6">
      {/* Top Banner de Contexto */}
      <div className="flex flex-col gap-3 rounded-2xl border border-sus-900/10 bg-gradient-to-r from-sus-950 via-sus-900 to-sus-950 p-6 text-white shadow-card md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-teal">
            <Database className="h-5 w-5" />
            <span className="font-display text-xs font-bold uppercase tracking-wider">
              Módulo de Governança e Qualidade
            </span>
          </div>
          <h2 className="mt-1 font-display text-2xl font-black tracking-tight text-white">
            Gerenciamento de Dados
          </h2>
          <p className="mt-1 text-sm text-white/75">
            Diagnóstico em cache com correção individual ou em lote, deduplicação segura e ferramentas administrativas.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {diagnostico && (
            <div className="flex items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-3 py-1.5 text-xs text-white/85">
              <Clock className="h-3.5 w-3.5 text-teal" />
              <span>
                {diagnostico.cache_hit ? "Em cache" : "Atualizado"}
                {ultimaChecagemFmt ? ` · ${ultimaChecagemFmt}` : ""}
              </span>
            </div>
          )}
          <Button
            size="sm"
            onClick={() => carregarDiagnostico(true)}
            disabled={carregandoDiag}
            className="!border !border-teal/30 !bg-teal/20 !text-white hover:!bg-teal/30"
          >
            <RefreshCw className={`h-4 w-4 ${carregandoDiag ? "animate-spin text-teal" : ""}`} />
            {carregandoDiag ? "Diagnosticando..." : "Reexecutar Diagnóstico"}
          </Button>
        </div>
      </div>

      {/* Alertas Globais */}
      {alertaSucesso && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900 shadow-sm">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
            <p className="font-medium">{alertaSucesso}</p>
          </div>
          <button
            onClick={() => setAlertaSucesso(null)}
            className="rounded p-1 text-emerald-700 hover:bg-emerald-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {alertaErro && (
        <div className="flex items-center justify-between rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900 shadow-sm">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0 text-rose-600" />
            <p className="font-medium">{alertaErro}</p>
          </div>
          <button
            onClick={() => setAlertaErro(null)}
            className="rounded p-1 text-rose-700 hover:bg-rose-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Sub-navegação / Segmented Controls */}
      <div className="flex flex-wrap items-center gap-2 border-b border-sus-900/10 pb-3">
        <button
          onClick={() => setSubAba("diagnostico")}
          className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition ${
            subAba === "diagnostico"
              ? "bg-sus-900 text-white shadow-sm"
              : "border border-sus-900/15 text-sus-900 hover:bg-sand"
          }`}
        >
          <Activity className="h-4 w-4" />
          Diagnóstico de Inconsistências
          {(totalInconsistencias > 0 || totalDuplicidades > 0) && (
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-black ${
                subAba === "diagnostico" ? "bg-white text-sus-900" : "bg-red-500 text-white"
              }`}
            >
              {totalInconsistencias + totalDuplicidades}
            </span>
          )}
        </button>

        <button
          onClick={() => setSubAba("unificacao")}
          className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition ${
            subAba === "unificacao"
              ? "bg-sus-900 text-white shadow-sm"
              : "border border-sus-900/15 text-sus-900 hover:bg-sand"
          }`}
        >
          <GitMerge className="h-4 w-4" />
          Unificação de Registros
        </button>

        <button
          onClick={() => setSubAba("limpeza")}
          className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition ${
            subAba === "limpeza"
              ? "bg-sus-900 text-white shadow-sm"
              : "border border-sus-900/15 text-sus-900 hover:bg-sand"
          }`}
        >
          <Trash2 className="h-4 w-4" />
          Limpeza em Massa
          <span className="rounded bg-amber-200 px-1.5 py-0.2 text-[10px] font-extrabold text-amber-900">
            Admin
          </span>
        </button>

        <button
          onClick={() => setSubAba("auditoria")}
          className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition ${
            subAba === "auditoria"
              ? "bg-sus-900 text-white shadow-sm"
              : "border border-sus-900/15 text-sus-900 hover:bg-sand"
          }`}
        >
          <History className="h-4 w-4" />
          Histórico de Auditoria
        </button>
      </div>

      {/* Conteúdo da Sub-Aba Selecionada */}
      {subAba === "diagnostico" && (
        <SecaoDiagnostico
          diagnostico={diagnostico}
          carregando={carregandoDiag}
          dominioSelecionado={dominioSelecionado}
          resolvendoChave={resolvendoChave}
          onTrocarDominio={(dom) => {
            setDominioSelecionado(dom);
          }}
          onRecarregar={() => carregarDiagnostico(true)}
          onAbrirUnificacao={abrirUnificacao}
          onCorrigirItem={(item) => setModalResolucaoItens([item])}
          onCorrigirLote={(itens) => setModalResolucaoItens(itens)}
          onVerDetalhes={(item) => setModalDetalhesItem(item)}
        />
      )}

      {subAba === "unificacao" && (
        <SecaoUnificacao
          onUnificacaoSucesso={(msg) => {
            setAlertaSucesso(msg);
            salvarCacheSessao(null);
            carregarDiagnostico(true);
          }}
          onErro={(err) => setAlertaErro(err)}
        />
      )}

      {subAba === "limpeza" && (
        <SecaoLimpeza
          isSuperuser={!!user?.is_superuser}
          onAbrirModalConfirmacao={(tipo, filtro, previewInfo) => {
            if (!user?.is_superuser) return;
            setLimpezaConfigurada({ tipo, filtro, previewInfo });
            setModalLimpezaAberto(true);
          }}
          onErro={(err) => setAlertaErro(err)}
        />
      )}

      {subAba === "auditoria" && (
        <SecaoAuditoria
          logs={logsAuditoria}
          total={totalLogs}
          pagina={paginaAuditoria}
          limite={limiteAuditoria}
          carregando={carregandoAudit}
          onRecarregar={() => carregarAuditoria(paginaAuditoria, limiteAuditoria)}
          onPagina={(p) => setPaginaAuditoria(p)}
          onLimite={(sz) => {
            setLimiteAuditoria(sz >= 5000 ? 500 : sz);
            setPaginaAuditoria(1);
          }}
        />
      )}

      {/* Modais Globais */}
      {modalUnificarAberto && unificarPreenchido && (
        <ModalUnificarRegistros
          aberto={modalUnificarAberto}
          dadosIniciais={unificarPreenchido}
          onFechar={() => {
            setModalUnificarAberto(false);
            setUnificarPreenchido(null);
          }}
          onSucesso={(msg) => {
            setModalUnificarAberto(false);
            setUnificarPreenchido(null);
            setAlertaSucesso(msg);
            salvarCacheSessao(null);
            carregarDiagnostico(true);
          }}
        />
      )}

      {modalResolucaoItens && modalResolucaoItens.length > 0 && (
        <ModalConfirmarResolucao
          aberto={true}
          itens={modalResolucaoItens}
          onFechar={() => setModalResolucaoItens(null)}
          onSucesso={(msg) => {
            setModalResolucaoItens(null);
            setAlertaSucesso(msg);
            salvarCacheSessao(null);
            carregarDiagnostico(true);
          }}
          onErro={(err) => setAlertaErro(err)}
        />
      )}

      {modalLimpezaAberto && (
        <ModalLimpezaMassa
          aberto={modalLimpezaAberto}
          limpezaConfigurada={limpezaConfigurada}
          onFechar={() => {
            setModalLimpezaAberto(false);
            setLimpezaConfigurada(null);
          }}
          onSucesso={(msg) => {
            setModalLimpezaAberto(false);
            setLimpezaConfigurada(null);
            setAlertaSucesso(msg);
            salvarCacheSessao(null);
            carregarDiagnostico(true);
          }}
        />
      )}

      {modalDetalhesItem && (
        <ModalDetalhesDiagnostico
          item={modalDetalhesItem}
          aberto={!!modalDetalhesItem}
          onFechar={() => setModalDetalhesItem(null)}
          onUnificar={(ent, pId, dId) => {
            const itemAtual = modalDetalhesItem;
            setModalDetalhesItem(null);
            abrirUnificacao(ent, pId, dId, itemAtual);
          }}
          onCorrigir={(item) => {
            setModalDetalhesItem(null);
            handleCorrigirUnico(item);
          }}
        />
      )}
    </div>
  );
}

// ==============================================================================
// 1. SEÇÃO: DIAGNÓSTICO DE INCONSISTÊNCIAS E DUPLICIDADES (R2 + CACHE + LOTE + PAGINAÇÃO)
// ==============================================================================

interface SecaoDiagnosticoProps {
  diagnostico: DiagnosticoResponse | null;
  carregando: boolean;
  dominioSelecionado: DominioFiltro;
  resolvendoChave: string | null;
  onTrocarDominio: (dom: DominioFiltro) => void;
  onRecarregar: () => void;
  onAbrirUnificacao: (
    entidade: EntidadeUnificavel,
    principalId: number,
    duplicadoId: number,
    item?: ItemDiagnostico
  ) => void;
  onCorrigirItem: (item: ItemDiagnostico) => void;
  onCorrigirLote: (itens: ItemDiagnostico[]) => void;
  onVerDetalhes: (item: ItemDiagnostico) => void;
}

const ROTULOS_DOMINIO: Record<string, string> = {
  pacientes: "Pacientes",
  filas: "Filas de Espera",
  laboratorio: "Laboratório",
  viagens: "Viagens e TFD",
  cadastros: "Cadastros de Saúde",
};

function SecaoDiagnostico({
  diagnostico,
  carregando,
  dominioSelecionado,
  resolvendoChave,
  onTrocarDominio,
  onRecarregar,
  onAbrirUnificacao,
  onCorrigirItem,
  onCorrigirLote,
  onVerDetalhes,
}: SecaoDiagnosticoProps) {
  const resumo = diagnostico?.resumo;
  const detalhes = diagnostico?.detalhes;

  // Filtros locais, paginação e seleção em lote
  const [busca, setBusca] = useState<string>("");
  const [filtroCategoria, setFiltroCategoria] = useState<"todos" | "duplicidades" | "inconsistencias">("todos");
  const [filtroTipo, setFiltroTipo] = useState<string>("todos");
  const [pagina, setPagina] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());

  const dominiosConfig: Array<{
    id: DominioFiltro;
    rotulo: string;
    icone: React.ComponentType<{ className?: string }>;
    dadosResumo?: { duplicidades: number; inconsistencias: number };
    itens: ItemDiagnostico[];
  }> = [
    {
      id: "pacientes",
      rotulo: "Pacientes",
      icone: Users,
      dadosResumo: resumo?.pacientes,
      itens: detalhes?.pacientes || [],
    },
    {
      id: "filas",
      rotulo: "Filas de Espera",
      icone: ListOrdered,
      dadosResumo: resumo?.filas,
      itens: detalhes?.filas || [],
    },
    {
      id: "laboratorio",
      rotulo: "Laboratório",
      icone: FlaskConical,
      dadosResumo: resumo?.laboratorio,
      itens: detalhes?.laboratorio || [],
    },
    {
      id: "viagens",
      rotulo: "Viagens e TFD",
      icone: Calendar,
      dadosResumo: resumo?.viagens,
      itens: detalhes?.viagens || [],
    },
    {
      id: "cadastros",
      rotulo: "Cadastros de Saúde",
      icone: Building2,
      dadosResumo: resumo?.cadastros,
      itens: detalhes?.cadastros || [],
    },
  ];

  // Lista consolidada dos domínios visíveis com chave estável garantida
  const itensDoDominio = useMemo(() => {
    const lista: Array<{ chave: string; dominio: DominioFiltro; item: ItemDiagnostico }> = [];
    for (const dom of dominiosConfig) {
      if (dominioSelecionado !== "todos" && dominioSelecionado !== dom.id) continue;
      dom.itens.forEach((item, idx) => {
        const chave = obterChaveUnica(item, dom.id, idx);
        lista.push({
          chave,
          dominio: dom.id,
          item: { ...item, dominio: item.dominio || dom.id, chave_unica: chave },
        });
      });
    }
    return lista;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detalhes, dominioSelecionado]);

  // Tipos distintos presentes no domínio atual (para filtro rápido por tipo)
  const tiposDisponiveis = useMemo(() => {
    const contagem = new Map<string, number>();
    for (const entry of itensDoDominio) {
      contagem.set(entry.item.tipo, (contagem.get(entry.item.tipo) || 0) + 1);
    }
    return Array.from(contagem.entries()).sort((a, b) => b[1] - a[1]);
  }, [itensDoDominio]);

  // Aplica busca textual, categoria e tipo
  const itensFiltrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return itensDoDominio.filter(({ item }) => {
      const ehDup = item.tipo.toLowerCase().includes("duplic");
      if (filtroCategoria === "duplicidades" && !ehDup) return false;
      if (filtroCategoria === "inconsistencias" && ehDup) return false;
      if (filtroTipo !== "todos" && item.tipo !== filtroTipo) return false;
      if (termo) {
        const texto = [
          item.tipo,
          item.descricao,
          item.dominio,
          item.chave,
          item.nome,
          item.acao_sugerida,
          Array.isArray(item.ids) ? item.ids.join(" ") : "",
          item.registros ? JSON.stringify(item.registros) : "",
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!texto.includes(termo)) return false;
      }
      return true;
    });
  }, [itensDoDominio, filtroCategoria, filtroTipo, busca]);

  // Reseta página e seleção quando diagnóstico ou filtros mudam
  useEffect(() => {
    setPagina(1);
  }, [dominioSelecionado, filtroCategoria, filtroTipo, busca, pageSize]);

  useEffect(() => {
    setFiltroTipo("todos");
  }, [dominioSelecionado]);

  useEffect(() => {
    // Remove chaves selecionadas que não existem mais após atualização do diagnóstico
    const chavesAtuais = new Set(itensDoDominio.map((x) => x.chave));
    setSelecionados((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set<string>();
      prev.forEach((k) => {
        if (chavesAtuais.has(k)) next.add(k);
      });
      return next.size === prev.size ? prev : next;
    });
  }, [itensDoDominio]);

  const totalFiltrados = itensFiltrados.length;
  const tamanhoEfetivo = pageSize >= 5000 ? Math.max(1, totalFiltrados) : pageSize;
  const totalPaginas = Math.max(1, Math.ceil(totalFiltrados / tamanhoEfetivo));
  const paginaSegura = Math.min(pagina, totalPaginas);
  const inicio = (paginaSegura - 1) * tamanhoEfetivo;
  const itensPaginados = itensFiltrados.slice(inicio, inicio + tamanhoEfetivo);

  const chavesPagina = useMemo(() => itensPaginados.map((e) => e.chave), [itensPaginados]);
  const todosDaPaginaSelecionados =
    chavesPagina.length > 0 && chavesPagina.every((k) => selecionados.has(k));

  const itensSelecionadosLista = useMemo(() => {
    if (selecionados.size === 0) return [];
    return itensDoDominio.filter((e) => selecionados.has(e.chave)).map((e) => e.item);
  }, [itensDoDominio, selecionados]);

  function alternarItem(chave: string) {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(chave)) next.delete(chave);
      else next.add(chave);
      return next;
    });
  }

  function alternarPaginaAtual() {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (todosDaPaginaSelecionados) {
        chavesPagina.forEach((k) => next.delete(k));
      } else {
        chavesPagina.forEach((k) => next.add(k));
      }
      return next;
    });
  }

  function selecionarTodosDoFiltro() {
    setSelecionados(new Set(itensFiltrados.map((e) => e.chave)));
  }

  function limparSelecao() {
    setSelecionados(new Set());
  }

  return (
    <div className="space-y-5">
      {/* 5 Cards de Resumo por Domínio */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {dominiosConfig.map((dom) => {
          const Icone = dom.icone;
          const dups = dom.dadosResumo?.duplicidades || 0;
          const incs = dom.dadosResumo?.inconsistencias || 0;
          const total = dups + incs;
          const ativo = dominioSelecionado === dom.id;

          return (
            <Card
              key={dom.id}
              onClick={() => onTrocarDominio(dom.id === dominioSelecionado ? "todos" : dom.id)}
              className={`cursor-pointer p-4 transition hover:border-sus-700/40 hover:shadow-md ${
                ativo ? "border-2 border-sus-900 bg-sand/30" : ""
              }`}
            >
              <div className="flex items-center justify-between">
                <div
                  className={`rounded-xl p-2.5 ${
                    total > 0 ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
                  }`}
                >
                  <Icone className="h-5 w-5" />
                </div>
                {total > 0 ? (
                  <Badge variant="danger">{total} pendências</Badge>
                ) : (
                  <Badge variant="success">Regular</Badge>
                )}
              </div>

              <h3 className="mt-3 font-display text-sm font-bold text-sus-950">{dom.rotulo}</h3>

              <div className="mt-2 flex items-center justify-between text-xs text-ink/75 border-t border-sus-900/10 pt-2">
                <span>
                  Duplicatas: <strong>{dups}</strong>
                </span>
                <span>
                  Inconsistências: <strong>{incs}</strong>
                </span>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Barra de Filtro de Domínio + Busca + Tipo */}
      <div className="space-y-3 rounded-xl border border-sus-900/10 bg-white p-3.5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-2 text-xs font-bold uppercase tracking-wide text-ink/60">
              Domínio:
            </span>
            <button
              type="button"
              onClick={() => onTrocarDominio("todos")}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                dominioSelecionado === "todos"
                  ? "bg-sus-900 text-white"
                  : "bg-sand/60 text-sus-900 hover:bg-sand"
              }`}
            >
              Todos os Domínios
            </button>
            {dominiosConfig.map((dom) => (
              <button
                key={dom.id}
                type="button"
                onClick={() => onTrocarDominio(dom.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                  dominioSelecionado === dom.id
                    ? "bg-sus-900 text-white"
                    : "bg-sand/60 text-sus-900 hover:bg-sand"
                }`}
              >
                {dom.rotulo}
              </button>
            ))}
          </div>

          <Button size="sm" variant="outline" onClick={onRecarregar} disabled={carregando}>
            <RefreshCw className={`h-3.5 w-3.5 ${carregando ? "animate-spin" : ""}`} />
            Reexecutar Varredura
          </Button>
        </div>

        {/* Filtros secundários: busca, categoria e tipo específico */}
        <div className="grid grid-cols-1 gap-2.5 border-t border-sus-900/10 pt-3 md:grid-cols-12">
          <div className="relative md:col-span-5">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/40" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por paciente, ID, CPF, descrição ou tipo..."
              className="pl-9 text-xs"
            />
          </div>

          <div className="md:col-span-3">
            <Select
              value={filtroCategoria}
              onChange={(e) =>
                setFiltroCategoria(e.target.value as "todos" | "duplicidades" | "inconsistencias")
              }
              className="text-xs"
            >
              <option value="todos">Todas as Categorias ({itensDoDominio.length})</option>
              <option value="duplicidades">Somente Duplicidades</option>
              <option value="inconsistencias">Somente Inconsistências</option>
            </Select>
          </div>

          <div className="md:col-span-4">
            <Select
              value={filtroTipo}
              onChange={(e) => setFiltroTipo(e.target.value)}
              className="text-xs"
            >
              <option value="todos">Todos os Tipos de Problema</option>
              {tiposDisponiveis.map(([tipo, qtd]) => (
                <option key={tipo} value={tipo}>
                  {tipo} ({qtd})
                </option>
              ))}
            </Select>
          </div>
        </div>
      </div>

      {/* Barra de Seleção e Correção em Lote */}
      {!carregando && totalFiltrados > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sus-900/15 bg-sand/50 px-4 py-3">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="flex cursor-pointer items-center gap-2 font-bold text-sus-950">
              <input
                type="checkbox"
                checked={todosDaPaginaSelecionados}
                onChange={alternarPaginaAtual}
                className="h-4 w-4 rounded border-sus-900/30 text-sus-900 focus:ring-sus-700"
              />
              <span>Selecionar página ({itensPaginados.length})</span>
            </label>

            {totalFiltrados > itensPaginados.length && selecionados.size < totalFiltrados && (
              <button
                type="button"
                onClick={selecionarTodosDoFiltro}
                className="font-bold text-sus-900 underline hover:text-sus-700"
              >
                Selecionar todos os {totalFiltrados} do filtro
              </button>
            )}

            {selecionados.size > 0 && (
              <>
                <span className="text-ink/30">·</span>
                <span className="rounded-full bg-sus-900 px-2.5 py-0.5 font-bold text-white">
                  {selecionados.size} selecionado(s)
                </span>
                <button
                  type="button"
                  onClick={limparSelecao}
                  className="font-semibold text-ink/65 hover:text-rose-700 hover:underline"
                >
                  Limpar seleção
                </button>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => onCorrigirLote(itensSelecionadosLista)}
              disabled={selecionados.size === 0 || carregando}
              className="!bg-emerald-700 !text-white hover:!bg-emerald-800 disabled:opacity-45"
            >
              <CheckCheck className="h-4 w-4" />
              Corrigir Selecionados ({selecionados.size})
            </Button>
          </div>
        </div>
      )}

      {/* Listagem Paginada de Problemas */}
      {carregando ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-sus-900/10 bg-white py-16 shadow-card">
          <Loader2 className="h-8 w-8 animate-spin text-sus-900" />
          <p className="mt-3 font-display text-sm font-bold text-sus-950">
            Analisando integridade dos cruzamentos de dados...
          </p>
          <p className="text-xs text-ink/60">Cruzando pacientes, filas, solicitações e cadastros</p>
        </div>
      ) : totalFiltrados === 0 ? (
        <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-5 text-emerald-900">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
          <span className="text-sm font-medium">
            {itensDoDominio.length === 0
              ? "Nenhuma inconsistência ou duplicidade detectada neste domínio. Integridade referencial preservada!"
              : "Nenhum problema corresponde aos filtros aplicados."}
          </span>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-sus-900/10 bg-white shadow-card">
          <div className="divide-y divide-sus-900/10">
            {itensPaginados.map(({ chave, dominio, item }) => (
              <CardDiagnosticoItem
                key={chave}
                chave={chave}
                item={item}
                dominioId={dominio}
                selecionado={selecionados.has(chave)}
                resolvendo={resolvendoChave === chave}
                onToggleSelecionado={() => alternarItem(chave)}
                onCorrigir={() => onCorrigirItem(item)}
                onUnificar={onAbrirUnificacao}
                onVerDetalhes={onVerDetalhes}
              />
            ))}
          </div>

          <Paginacao
            page={paginaSegura}
            pages={totalPaginas}
            total={totalFiltrados}
            onPage={(p) => setPagina(p)}
            pageSize={pageSize}
            onPageSize={(sz) => {
              setPageSize(sz);
              setPagina(1);
            }}
          />
        </div>
      )}
    </div>
  );
}

// Componente para item individual do Diagnóstico
function CardDiagnosticoItem({
  chave,
  item,
  dominioId,
  selecionado,
  resolvendo,
  onToggleSelecionado,
  onCorrigir,
  onUnificar,
  onVerDetalhes,
}: {
  chave: string;
  item: ItemDiagnostico;
  dominioId: DominioFiltro;
  selecionado: boolean;
  resolvendo: boolean;
  onToggleSelecionado: () => void;
  onCorrigir: () => void;
  onUnificar: (
    entidade: EntidadeUnificavel,
    pId: number,
    dId: number,
    item?: ItemDiagnostico
  ) => void;
  onVerDetalhes: (item: ItemDiagnostico) => void;
}) {
  const ehDuplicidade = item.tipo.toLowerCase().includes("duplic");
  const badgeVariant = ehDuplicidade ? "warning" : "danger";

  // Identifica se o item também suporta escolha manual de principal no Modal de Unificação
  const ids: number[] = Array.isArray(item.ids) ? item.ids : [];
  let entidadeAlvo: EntidadeUnificavel | null = item.entidade_unificavel || null;
  if (!entidadeAlvo && ids.length >= 2) {
    if (dominioId === "pacientes") {
      entidadeAlvo = "pacientes";
    } else if (dominioId === "cadastros") {
      if (item.tipo.includes("medico")) entidadeAlvo = "medicos";
      else if (item.tipo.includes("unidade")) entidadeAlvo = "unidades";
      else if (item.tipo.includes("prestador")) entidadeAlvo = "prestadores";
      else if (item.tipo.includes("laboratorio")) entidadeAlvo = "laboratorios";
    }
  }
  const podeEscolherPrincipal = entidadeAlvo !== null && ids.length >= 2;
  const rotuloAcao = item.acao_sugerida || "Corrigir";

  return (
    <div
      data-chave={chave}
      className={`flex flex-col justify-between gap-4 p-4 transition md:flex-row md:items-center ${
        selecionado ? "bg-sus-900/[0.04]" : "bg-white hover:bg-sand/20"
      }`}
    >
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <input
          type="checkbox"
          checked={selecionado}
          onChange={onToggleSelecionado}
          aria-label={`Selecionar ${item.tipo}`}
          className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-sus-900/30 text-sus-900 focus:ring-sus-700"
        />

        <div className="space-y-1.5 flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-[11px]">
              {ROTULOS_DOMINIO[String(item.dominio || dominioId)] || String(item.dominio || dominioId)}
            </Badge>
            <Badge variant={badgeVariant}>
              {ehDuplicidade ? "Duplicidade" : "Inconsistência"}
            </Badge>
            <span className="font-mono text-xs font-semibold text-ink/50">{item.tipo}</span>
            {item.total && (
              <span className="text-xs font-bold text-sus-900">({item.total} afetados)</span>
            )}
          </div>

          <p className="text-sm font-semibold text-sus-950">{item.descricao}</p>

          {item.descricao_correcao && (
            <p className="text-xs text-ink/65">
              <span className="font-semibold text-emerald-800">Correção:</span> {item.descricao_correcao}
            </p>
          )}

          {/* Amostra rápida se houver registros vinculados */}
          {item.registros && item.registros.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-2 text-xs">
              {item.registros.slice(0, 3).map((reg, rIdx) => (
                <span
                  key={rIdx}
                  className="inline-flex items-center gap-1 rounded bg-sand/80 px-2 py-0.5 text-ink/80"
                >
                  <strong>ID {String(reg.id || "")}:</strong> {String(reg.nome || reg.cpf || "")}
                </span>
              ))}
              {item.registros.length > 3 && (
                <span className="text-xs text-ink/50 pt-0.5">
                  +{item.registros.length - 3} outros
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap flex-shrink-0 items-center gap-2 pl-7 md:pl-0">
        <Button size="sm" variant="outline" onClick={() => onVerDetalhes(item)}>
          <Info className="h-3.5 w-3.5" /> Detalhes
        </Button>

        {podeEscolherPrincipal && entidadeAlvo && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onUnificar(entidadeAlvo!, ids[0], ids[1], item)}
            title="Abrir modal para escolher manualmente o registro principal"
          >
            <GitMerge className="h-3.5 w-3.5" /> Escolher Principal
          </Button>
        )}

        <Button
          size="sm"
          onClick={onCorrigir}
          disabled={resolvendo}
          className="!bg-sus-900 !text-white hover:!bg-sus-800"
          title={item.descricao_correcao || "Aplicar correção automática"}
        >
          {resolvendo ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Wrench className="h-3.5 w-3.5" />
          )}
          {rotuloAcao}
        </Button>
      </div>
    </div>
  );
}

// ==============================================================================
// 2. SEÇÃO: UNIFICAÇÃO DE REGISTROS (R3 & R5)
// ==============================================================================

interface SecaoUnificacaoProps {
  onUnificacaoSucesso: (msg: string) => void;
  onErro: (err: string) => void;
}

function SecaoUnificacao({ onUnificacaoSucesso, onErro }: SecaoUnificacaoProps) {
  const [entidade, setEntidade] = useState<EntidadeUnificavel>("pacientes");
  const [principalId, setPrincipalId] = useState<string>("");
  const [duplicadoId, setDuplicadoId] = useState<string>("");
  const [carregando, setCarregando] = useState<boolean>(false);
  const [ultimoResultado, setUltimoResultado] = useState<UnificarResponse | null>(null);

  const descricoesEntidades: Record<EntidadeUnificavel, { titulo: string; desc: string; fks: string }> = {
    pacientes: {
      titulo: "Pacientes (tfd_pacientes)",
      desc: "Transfere solicitações de exames, filas PSF/TFD, viagens, acompanhantes, faturamentos e contas de usuários.",
      fks: "18 tabelas dependentes reatribuídas com tratamento de colisões em viagens e SIGTAP.",
    },
    medicos: {
      titulo: "Médicos (cadastros_medicos)",
      desc: "Reatribui pedidos de exames TFD, solicitações laboratoriais e laudos.",
      fks: "Atualização atômica de FKs e nomes desnormalizados em filas e solicitações.",
    },
    unidades: {
      titulo: "Unidades de Saúde (cadastros_unidades_saude)",
      desc: "Reatribui filas PSF, agendamentos e vínculos cadastrais de pacientes.",
      fks: "Substituição completa do identificador da unidade em toda a base.",
    },
    laboratorios: {
      titulo: "Laboratórios Conveniados (lab_laboratorios)",
      desc: "Reatribui contratos, faturamento, FPO, lotes de exames e vagas de agendamento.",
      fks: "Reatribuição transacional sem quebra de registros financeiros.",
    },
    prestadores: {
      titulo: "Prestadores de Saúde (prestadores)",
      desc: "Mescla dados cadastrais complementares (CNPJ, CNES, contatos) e remove o prestador duplicado.",
      fks: "Preservação de integridade cadastral com auditoria completa.",
    },
  };

  async function handleUnificar(e: React.FormEvent) {
    e.preventDefault();
    const mid = parseInt(principalId, 10);
    const did = parseInt(duplicadoId, 10);

    if (isNaN(mid) || mid <= 0 || isNaN(did) || did <= 0) {
      onErro("Informe identificadores numéricos válidos (maiores que zero) para ambos os registros.");
      return;
    }

    if (mid === did) {
      onErro("O registro principal e o registro duplicado devem ser diferentes!");
      return;
    }

    setCarregando(true);
    try {
      const resp = await unificarRegistros({
        entidade,
        registro_principal_id: mid,
        registro_duplicado_id: did,
      });

      setUltimoResultado(resp);
      setDuplicadoId("");
      onUnificacaoSucesso(resp.mensagem);
    } catch (err: unknown) {
      onErro(msgErro(err, "Falha na unificação transacional de registros."));
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-start gap-3 border-b border-sus-900/10 pb-4">
          <div className="rounded-xl bg-sus-900 p-2.5 text-white">
            <GitMerge className="h-6 w-6" />
          </div>
          <div>
            <h3 className="font-display text-lg font-bold text-sus-950">
              Unificação Segura de Cadastros e Duplicatas
            </h3>
            <p className="text-sm text-ink/75">
              Reatribui integralmente todas as chaves estrangeiras, históricos e dependências para o registro principal escolhido. O registro duplicado é permanentemente excluído após a migração.
            </p>
          </div>
        </div>

        <form onSubmit={handleUnificar} className="mt-6 space-y-6">
          {/* Seletor de Entidade */}
          <div>
            <Label>Entidade Alvo *</Label>
            <Select
              value={entidade}
              onChange={(e) => setEntidade(e.target.value as EntidadeUnificavel)}
              disabled={carregando}
            >
              <option value="pacientes">Pacientes (tfd_pacientes)</option>
              <option value="medicos">Médicos e Profissionais (cadastros_medicos)</option>
              <option value="unidades">Unidades de Saúde e PSFs (cadastros_unidades_saude)</option>
              <option value="laboratorios">Laboratórios Conveniados (lab_laboratorios)</option>
              <option value="prestadores">Prestadores de Saúde (prestadores)</option>
            </Select>

            <div className="mt-2.5 rounded-xl bg-sand/60 p-3 text-xs text-ink/80">
              <strong className="block text-sus-950">{descricoesEntidades[entidade].titulo}</strong>
              <p className="mt-0.5">{descricoesEntidades[entidade].desc}</p>
              <p className="mt-1 font-semibold text-teal-800">
                Garantia: {descricoesEntidades[entidade].fks}
              </p>
            </div>
          </div>

          {/* IDs: Principal vs Duplicado */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-emerald-300 bg-emerald-50/50 p-4">
              <div className="flex items-center gap-2 text-emerald-800 mb-2">
                <CheckCircle2 className="h-4 w-4" />
                <span className="font-display text-xs font-bold uppercase tracking-wider">
                  Registro Principal (Preservado)
                </span>
              </div>
              <Label>ID do Registro Principal *</Label>
              <Input
                type="number"
                min="1"
                placeholder="Ex: 1045"
                value={principalId}
                onChange={(e) => setPrincipalId(e.target.value)}
                disabled={carregando}
                required
              />
              <p className="mt-1 text-[11px] text-ink/60">
                Este registro continuará ativo no sistema e receberá todos os dados e vínculos.
              </p>
            </div>

            <div className="rounded-xl border border-rose-300 bg-rose-50/50 p-4">
              <div className="flex items-center gap-2 text-rose-800 mb-2">
                <Trash2 className="h-4 w-4" />
                <span className="font-display text-xs font-bold uppercase tracking-wider">
                  Registro Duplicado (Excluído)
                </span>
              </div>
              <Label>ID do Registro Duplicado *</Label>
              <Input
                type="number"
                min="1"
                placeholder="Ex: 2189"
                value={duplicadoId}
                onChange={(e) => setDuplicadoId(e.target.value)}
                disabled={carregando}
                required
              />
              <p className="mt-1 text-[11px] text-ink/60">
                Seus vínculos serão transferidos para o principal e este registro será deletado permanentemente.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
              <div>
                <strong className="block font-bold">Atomicidade e Segurança Transacional:</strong>
                A operação utiliza bloqueio de concorrência e transação atômica. Se qualquer etapa falhar, todos os dados sofrerão reversão completa (rollback) sem deixar registros corrompidos ou órfãos.
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={carregando || !principalId || !duplicadoId}
              className="!w-auto"
            >
              {carregando ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Unificando Registros...
                </>
              ) : (
                <>
                  <GitMerge className="h-4 w-4" /> Executar Unificação Definitiva
                </>
              )}
            </Button>
          </div>
        </form>
      </Card>

      {/* Histórico da Última Unificação Executada */}
      {ultimoResultado && (
        <Card className="border-teal/30 bg-teal/5 p-6">
          <div className="flex items-center gap-2 text-teal">
            <CheckCircle2 className="h-5 w-5" />
            <h4 className="font-display text-base font-bold text-sus-950">
              Resultado da Operação de Unificação
            </h4>
          </div>
          <p className="mt-2 text-sm text-ink/80">{ultimoResultado.mensagem}</p>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
            <div className="rounded-lg bg-white p-3 border border-sus-900/10">
              <span className="text-ink/60">Vínculos Reatribuídos:</span>
              <p className="font-display text-lg font-bold text-sus-900">
                {ultimoResultado.vinculos_reatribuidos}
              </p>
            </div>
            <div className="rounded-lg bg-white p-3 border border-sus-900/10">
              <span className="text-ink/60">ID do Registro Excluído:</span>
              <p className="font-display text-lg font-bold text-rose-700">
                #{ultimoResultado.registro_excluido_id}
              </p>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

// ==============================================================================
// 3. SEÇÃO: LIMPEZA EM MASSA (R4)
// ==============================================================================

interface SecaoLimpezaProps {
  onAbrirModalConfirmacao: (
    tipo: TipoLimpezaMassa,
    filtro: Record<string, unknown>,
    previewInfo?: { totalAfetados: number; detalhes?: any[] }
  ) => void;
  onErro: (err: string) => void;
  isSuperuser?: boolean;
}

function SecaoLimpeza({
  onAbrirModalConfirmacao,
  onErro,
  isSuperuser = false,
}: SecaoLimpezaProps) {
  const [tipoLimpeza, setTipoLimpeza] = useState<TipoLimpezaMassa>("fila_importada");
  const [tipoFila, setTipoFila] = useState<string>("");
  const [dataInicio, setDataInicio] = useState<string>("");
  const [dataFim, setDataFim] = useState<string>("");
  const [apenasNaoAgendados, setApenasNaoAgendados] = useState<boolean>(true);

  const [preview, setPreview] = useState<LimpezaMassaPreviewResponse | null>(null);
  const [carregandoPreview, setCarregandoPreview] = useState<boolean>(false);

  function obterFiltroAtual(): Record<string, unknown> {
    const filtroPayload: Record<string, unknown> = {};
    if (tipoLimpeza === "fila_importada") {
      if (tipoFila.trim()) filtroPayload.tipo_fila = tipoFila.trim();
      if (dataInicio) filtroPayload.data_inicio = dataInicio;
      if (dataFim) filtroPayload.data_fim = dataFim;
      filtroPayload.apenas_nao_agendados = apenasNaoAgendados;
    }
    return filtroPayload;
  }

  const ferramentas: Array<{
    tipo: TipoLimpezaMassa;
    titulo: string;
    icone: React.ComponentType<{ className?: string }>;
    desc: string;
    impacto: string;
  }> = [
    {
      tipo: "fila_importada",
      titulo: "Limpeza de Fila Importada Incorretamente",
      icone: FileSpreadsheet,
      desc: "Remove em lote exames ou solicitações importadas indevidamente por planilha ou integração.",
      impacto: "Preserva atendimentos já agendados com suporte a filtro de período e tipagem.",
    },
    {
      tipo: "pedidos_orfaos",
      titulo: "Expurgo de Solicitações e Agendamentos Órfãos",
      icone: Eraser,
      desc: "Remove itens laboratoriais sem solicitação mestre, mestres vazios ou referências inexistentes.",
      impacto: "Higieniza o banco de dados contra sobras de migrações e exclusões anteriores.",
    },
    {
      tipo: "agendamentos_duplicados",
      titulo: "Deduplicação de Agendamentos Laboratoriais",
      icone: FlaskConical,
      desc: "Localiza agendamentos redundantes no mesmo dia e preserva o primeiro registro original.",
      impacto: "Remove agendamentos duplicados garantindo a liberação de vagas ocupadas indevidamente.",
    },
    {
      tipo: "cadastros_fantasmas",
      titulo: "Limpeza de Pacientes Sem Vínculos (Fantasmas)",
      icone: Users,
      desc: "Remove cadastros de pacientes sem histórico, sem exames, sem viagens e sem chave do e-SUS PEC.",
      impacto: "Elimina cadastros de teste ou gerados por erros de sincronização.",
    },
  ];

  async function handlePreview() {
    setCarregandoPreview(true);
    setPreview(null);
    try {
      const filtroPayload = obterFiltroAtual();

      const res = await previewLimpezaMassa({
        tipo_limpeza: tipoLimpeza,
        filtro: filtroPayload,
      });
      setPreview(res);
    } catch (err: unknown) {
      onErro(msgErro(err, "Falha ao pré-visualizar registros afetados."));
    } finally {
      setCarregandoPreview(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Alerta de Perfil Não Superuser */}
      {!isSuperuser && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-950 shadow-sm">
          <ShieldAlert className="h-6 w-6 shrink-0 text-amber-600 mt-0.5" />
          <div className="space-y-1">
            <h4 className="font-display text-sm font-black uppercase tracking-wider text-amber-900">
              Acesso Restrito: Limpeza em Massa Exclusiva para Superusuários
            </h4>
            <p className="text-xs leading-relaxed text-amber-800">
              As operações de limpeza e expurgo em massa realizam modificações estruturais e exclusões físicas irreversíveis no banco de dados.
              Seu usuário não possui perfil de superusuário (<code className="font-mono font-bold">is_superuser</code>).
              A execução destas ferramentas está bloqueada no sistema.
            </p>
          </div>
        </div>
      )}

      {/* Alerta de Segurança Superuser */}
      <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50/80 p-5 text-red-950">
        <ShieldAlert className="h-6 w-6 shrink-0 text-red-600 mt-0.5" />
        <div className="space-y-1">
          <h4 className="font-display text-sm font-black uppercase tracking-wider text-red-900">
            Acesso Restrito: Ferramenta de Exclusão em Massa (Superusuários)
          </h4>
          <p className="text-xs leading-relaxed text-red-800">
            As operações nesta seção realizam exclusões físicas permanentes na base de dados.
            Por medida estrita de segurança, qualquer exclusão exige <strong>pré-visualização obrigatória</strong>,
            <strong> confirmação explícita de ciência</strong> e <strong>digitação da senha do administrador logado</strong>.
          </p>
        </div>
      </div>

      {/* Grid de Opções de Ferramentas de Limpeza */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {ferramentas.map((f) => {
          const Icone = f.icone;
          const selecionado = tipoLimpeza === f.tipo;

          return (
            <Card
              key={f.tipo}
              onClick={() => {
                setTipoLimpeza(f.tipo);
                setPreview(null);
              }}
              className={`cursor-pointer p-5 transition ${
                selecionado
                  ? "border-2 border-red-600 bg-red-50/20 shadow-md"
                  : "hover:border-sus-700/30"
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`rounded-xl p-2.5 ${
                    selecionado ? "bg-red-600 text-white" : "bg-sand text-sus-900"
                  }`}
                >
                  <Icone className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="font-display text-sm font-bold text-sus-950">{f.titulo}</h4>
                  <Badge variant={selecionado ? "danger" : "outline"} className="mt-0.5">
                    {selecionado ? "Selecionado" : "Clique para Escolher"}
                  </Badge>
                </div>
              </div>

              <p className="mt-3 text-xs leading-relaxed text-ink/75">{f.desc}</p>
              <div className="mt-2 text-[11px] font-semibold text-sus-900">
                Regra: {f.impacto}
              </div>
            </Card>
          );
        })}
      </div>

      {/* Painel de Filtros e Execução */}
      <Card className="p-6">
        <h4 className="font-display text-base font-bold text-sus-950 border-b border-sus-900/10 pb-3">
          Configuração da Operação: {ferramentas.find((f) => f.tipo === tipoLimpeza)?.titulo}
        </h4>

        {tipoLimpeza === "fila_importada" && (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <Label>Nome ou Sigla da Fila</Label>
              <Input
                placeholder="Ex: OFTALMOLOGIA, SANGUE"
                value={tipoFila}
                onChange={(e) => {
                  setTipoFila(e.target.value);
                  setPreview(null);
                }}
              />
            </div>
            <div>
              <Label>Data Inicial do Pedido</Label>
              <Input
                type="date"
                value={dataInicio}
                onChange={(e) => {
                  setDataInicio(e.target.value);
                  setPreview(null);
                }}
              />
            </div>
            <div>
              <Label>Data Final do Pedido</Label>
              <Input
                type="date"
                value={dataFim}
                onChange={(e) => {
                  setDataFim(e.target.value);
                  setPreview(null);
                }}
              />
            </div>
            <div className="flex items-center pt-6">
              <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-sus-950">
                <input
                  type="checkbox"
                  checked={apenasNaoAgendados}
                  onChange={(e) => {
                    setApenasNaoAgendados(e.target.checked);
                    setPreview(null);
                  }}
                  className="h-4 w-4 rounded border-sus-900/30 text-sus-900 focus:ring-sus-700"
                />
                <span>Preservar agendados (Recomendado)</span>
              </label>
            </div>
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-sus-900/10 pt-4">
          <Button
            variant="outline"
            onClick={handlePreview}
            disabled={carregandoPreview || !isSuperuser}
            className="!w-auto"
          >
            <Eye className="h-4 w-4" />
            {carregandoPreview ? "Calculando Impacto..." : "1. Pré-visualizar Registros Afetados"}
          </Button>

          <Button
            onClick={() => {
              if (!isSuperuser || !preview) return;
              onAbrirModalConfirmacao(tipoLimpeza, obterFiltroAtual(), {
                totalAfetados: preview.total_afetados,
                detalhes: preview.detalhes,
              });
            }}
            disabled={!isSuperuser || !preview || carregandoPreview}
            className="!w-auto !bg-red-700 !text-white hover:!bg-red-800 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" /> 2. Prosseguir para Exclusão com Senha
          </Button>
        </div>

        {/* Exibição do Resultado da Prévia */}
        {preview && (
          <div className="mt-6 rounded-xl border border-sus-900/15 bg-sand/40 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Info className="h-5 w-5 text-sus-900" />
                <span className="font-display text-sm font-bold text-sus-950">
                  Resultado da Pré-visualização (Dry-Run):
                </span>
              </div>
              <Badge variant={preview.total_afetados > 0 ? "warning" : "success"}>
                {preview.total_afetados} registros elegíveis
              </Badge>
            </div>

            <p className="mt-1 text-xs text-ink/75">{preview.mensagem}</p>

            {preview.detalhes && preview.detalhes.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-sus-900/5 text-sus-950">
                    <tr>
                      <th className="p-2">ID</th>
                      <th className="p-2">Tabela</th>
                      <th className="p-2">Paciente / Ref</th>
                      <th className="p-2">Detalhes</th>
                      <th className="p-2">Data</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-sus-900/10">
                    {preview.detalhes.slice(0, 10).map((item, idx) => (
                      <tr key={idx} className="hover:bg-white/80">
                        <td className="p-2 font-mono font-bold">#{String(item.id || "")}</td>
                        <td className="p-2">{String(item.tabela || "")}</td>
                        <td className="p-2">{String(item.paciente_id ? `Paciente #${item.paciente_id}` : item.nome || "")}</td>
                        <td className="p-2 truncate max-w-[200px]">{String(item.exame || item.especialidade || item.tipo || "")}</td>
                        <td className="p-2">{String(item.data_pedido || item.data_solicitacao || item.data_agendada || "-")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.detalhes.length > 10 && (
                  <p className="mt-2 text-center text-[11px] text-ink/50">
                    Exibindo 10 de {preview.total_afetados} registros identificados.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

// ==============================================================================
// 4. SEÇÃO: HISTÓRICO DE AUDITORIA (R5)
// ==============================================================================

interface SecaoAuditoriaProps {
  logs: AuditoriaItem[];
  total: number;
  pagina: number;
  limite: number;
  carregando: boolean;
  onRecarregar: () => void;
  onPagina: (novaPagina: number) => void;
  onLimite: (novoLimite: number) => void;
}

function SecaoAuditoria({
  logs,
  total,
  pagina,
  limite,
  carregando,
  onRecarregar,
  onPagina,
  onLimite,
}: SecaoAuditoriaProps) {
  const [detalhesExpandidos, setDetalhesExpandidos] = useState<number | null>(null);
  const totalPaginas = Math.max(1, Math.ceil(total / Math.max(1, limite)));

  return (
    <Card className="p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sus-900/10 pb-4">
        <div>
          <h3 className="font-display text-lg font-bold text-sus-950">
            Trilha de Auditoria: Operações de Dados
          </h3>
          <p className="text-sm text-ink/75">
            Registro imutável de todas as unificações, mesclagens e limpezas em massa realizadas no sistema.
          </p>
        </div>

        <Button size="sm" variant="outline" onClick={onRecarregar} disabled={carregando}>
          <RefreshCw className={`h-4 w-4 ${carregando ? "animate-spin" : ""}`} />
          Atualizar Histórico
        </Button>
      </div>

      {carregando ? (
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-sus-900" />
          <p className="mt-2 text-xs text-ink/60">Carregando trilha de auditoria...</p>
        </div>
      ) : logs.length === 0 ? (
        <div className="rounded-xl bg-sand/40 p-8 text-center text-sm text-ink/60">
          Nenhuma operação de gerenciamento de dados registrada até o momento.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-sus-900/15 bg-sand/60 text-sus-950 font-bold">
              <tr>
                <th className="p-3">Data / Hora</th>
                <th className="p-3">Usuário</th>
                <th className="p-3">Ação</th>
                <th className="p-3">Entidade</th>
                <th className="p-3">Origem / IP</th>
                <th className="p-3 text-right">Detalhes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sus-900/10">
              {logs.map((log) => {
                const dataFormatada = new Date(log.timestamp).toLocaleString("pt-BR");
                const expandido = detalhesExpandidos === log.id;

                return (
                  <React.Fragment key={log.id}>
                    <tr className="hover:bg-sand/30 transition">
                      <td className="p-3 font-mono text-ink/80">{dataFormatada}</td>
                      <td className="p-3 font-semibold text-sus-950">
                        {log.user_name || "sistema"}
                      </td>
                      <td className="p-3">
                        <Badge
                          variant={log.action.includes("CLEANUP") ? "danger" : "default"}
                          className="font-mono text-[11px]"
                        >
                          {log.rotulo_acao || log.action}
                        </Badge>
                      </td>
                      <td className="p-3">
                        {log.rotulo_entidade || log.entity}
                        {log.entity_id && ` #${log.entity_id}`}
                      </td>
                      <td className="p-3 text-ink/60 truncate max-w-[150px]">{log.device}</td>
                      <td className="p-3 text-right">
                        <button
                          onClick={() => setDetalhesExpandidos(expandido ? null : log.id)}
                          className="font-bold text-sus-900 hover:underline"
                        >
                          {expandido ? "Ocultar" : "Expandir"}
                        </button>
                      </td>
                    </tr>
                    {expandido && (
                      <tr className="bg-sand/20">
                        <td colSpan={6} className="p-4">
                          <pre className="overflow-auto rounded-lg bg-sus-950 p-3 font-mono text-[11px] text-teal">
                            {JSON.stringify(
                              (() => {
                                try {
                                  return JSON.parse(log.details);
                                } catch {
                                  return log.details;
                                }
                              })(),
                              null,
                              2
                            )}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>

          {/* Paginação padronizada */}
          <Paginacao
            page={pagina}
            pages={totalPaginas}
            total={total}
            onPage={onPagina}
            pageSize={limite}
            onPageSize={onLimite}
          />
        </div>
      )}
    </Card>
  );
}

// ==============================================================================
// 5. MODAL: UNIFICAÇÃO DE REGISTROS (R3)
// ==============================================================================

interface ModalUnificarRegistrosProps {
  aberto: boolean;
  dadosIniciais: {
    entidade: EntidadeUnificavel;
    principalId: number;
    duplicadoId: number;
    detalhesItem?: ItemDiagnostico;
  };
  onFechar: () => void;
  onSucesso: (mensagem: string) => void;
}

function ModalUnificarRegistros({
  aberto,
  dadosIniciais,
  onFechar,
  onSucesso,
}: ModalUnificarRegistrosProps) {
  const [entidade, setEntidade] = useState<EntidadeUnificavel>(dadosIniciais.entidade);
  const [principalId, setPrincipalId] = useState<number>(dadosIniciais.principalId || 0);
  const [duplicadoId, setDuplicadoId] = useState<number>(dadosIniciais.duplicadoId || 0);
  const [carregando, setCarregando] = useState<boolean>(false);
  const [erro, setErro] = useState<string>("");

  if (!aberto) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro("");

    if (!principalId || !duplicadoId || principalId <= 0 || duplicadoId <= 0) {
      setErro("Informe identificadores numéricos válidos (maiores que zero).");
      return;
    }

    if (principalId === duplicadoId) {
      setErro("O ID principal e o ID duplicado não podem ser idênticos.");
      return;
    }

    setCarregando(true);
    try {
      const resp = await unificarRegistros({
        entidade,
        registro_principal_id: principalId,
        registro_duplicado_id: duplicadoId,
      });

      onSucesso(resp.mensagem);
    } catch (err: unknown) {
      setErro(msgErro(err, "Falha durante a unificação de registros."));
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-sus-950/60 p-4"
      onClick={onFechar}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl bg-white p-6 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between border-b border-sus-900/10 pb-3">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-sus-900 p-2 text-white">
              <GitMerge className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-display text-base font-bold text-sus-950">
                Confirmar Unificação de Registros
              </h3>
              <p className="text-xs text-ink/55">Reatribuição transacional de vínculos</p>
            </div>
          </div>
          <button
            onClick={onFechar}
            disabled={carregando}
            className="rounded-lg p-2 text-ink/50 hover:bg-sand"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Entidade</Label>
            <Select
              value={entidade}
              onChange={(e) => setEntidade(e.target.value as EntidadeUnificavel)}
              disabled={carregando}
            >
              <option value="pacientes">Pacientes</option>
              <option value="medicos">Médicos</option>
              <option value="unidades">Unidades de Saúde</option>
              <option value="laboratorios">Laboratórios</option>
              <option value="prestadores">Prestadores de Saúde</option>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-emerald-300 bg-emerald-50/60 p-3">
              <Label className="text-emerald-900">ID Principal (Fica) *</Label>
              <Input
                type="number"
                min="1"
                value={principalId > 0 ? principalId : ""}
                onChange={(e) => setPrincipalId(parseInt(e.target.value, 10) || 0)}
                disabled={carregando}
                placeholder="ID Principal"
                required
              />
            </div>

            <div className="rounded-xl border border-rose-300 bg-rose-50/60 p-3">
              <Label className="text-rose-900">ID Duplicado (Sai) *</Label>
              <Input
                type="number"
                min="1"
                value={duplicadoId > 0 ? duplicadoId : ""}
                onChange={(e) => setDuplicadoId(parseInt(e.target.value, 10) || 0)}
                disabled={carregando}
                placeholder="ID Duplicado"
                required
              />
            </div>
          </div>

          <div className="rounded-xl border border-sus-900/10 bg-sand/50 p-3 text-xs leading-relaxed text-ink/80">
            <strong>O que acontece durante a unificação:</strong>
            <ul className="mt-1 list-disc pl-4 space-y-0.5">
              <li>Todos os exames, viagens, faturamentos e filas são transferidos para o registro principal.</li>
              <li>Campos vazios no cadastro principal são preenchidos pelos dados do duplicado.</li>
              <li>O cadastro duplicado {duplicadoId > 0 ? `(#${duplicadoId})` : ""} é excluído permanentemente da base.</li>
            </ul>
          </div>

          {erro && (
            <div className="rounded-xl bg-red-50 p-3 text-xs font-semibold text-red-700">
              {erro}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-sus-900/10">
            <Button type="button" variant="outline" onClick={onFechar} disabled={carregando}>
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={carregando || !principalId || !duplicadoId || principalId <= 0 || duplicadoId <= 0}
            >
              {carregando ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Unificando...
                </>
              ) : (
                <>
                  <GitMerge className="h-4 w-4" /> Confirmar Unificação
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ==============================================================================
// 6. MODAL: CONFIRMAÇÃO DE LIMPEZA EM MASSA COM SENHA (R4)
// ==============================================================================

interface ModalLimpezaMassaProps {
  aberto: boolean;
  limpezaConfigurada: {
    tipo: TipoLimpezaMassa;
    filtro: Record<string, unknown>;
    previewInfo?: { totalAfetados: number; detalhes?: any[] };
  } | null;
  onFechar: () => void;
  onSucesso: (mensagem: string) => void;
}

function ModalLimpezaMassa({
  aberto,
  limpezaConfigurada,
  onFechar,
  onSucesso,
}: ModalLimpezaMassaProps) {
  const { user } = useAuth();
  const tipoLimpeza = limpezaConfigurada?.tipo || "fila_importada";
  const [senha, setSenha] = useState<string>("");
  const [mostrarSenha, setMostrarSenha] = useState<boolean>(false);
  const [confirmacaoExplicita, setConfirmacaoExplicita] = useState<boolean>(false);
  const [carregando, setCarregando] = useState<boolean>(false);
  const [erro, setErro] = useState<string>("");

  if (!aberto) return null;

  function obterRotuloTipo(tipo: TipoLimpezaMassa): string {
    switch (tipo) {
      case "fila_importada":
        return "Fila Importada em Lote";
      case "pedidos_orfaos":
        return "Pedidos e Agendamentos Órfãos";
      case "agendamentos_duplicados":
        return "Agendamentos Laboratoriais Duplicados";
      case "cadastros_fantasmas":
        return "Cadastros de Pacientes Sem Vínculo (Fantasmas)";
      default:
        return tipo;
    }
  }

  async function handleExecutar(e: React.FormEvent) {
    e.preventDefault();
    setErro("");

    if (!user?.is_superuser) {
      setErro("Apenas superusuários do sistema têm autorização para executar limpeza em massa.");
      return;
    }

    if (!senha.trim()) {
      setErro("Informe sua senha de administrador para autorizar a limpeza em massa.");
      return;
    }

    if (!confirmacaoExplicita) {
      setErro("Você precisa marcar a caixa de ciência sobre a irreversibilidade da exclusão.");
      return;
    }

    setCarregando(true);
    try {
      const resp = await executarLimpezaMassa({
        tipo_limpeza: tipoLimpeza,
        filtro: limpezaConfigurada?.filtro || null,
        senha: senha.trim(),
        confirmacao_explicita: true,
      });

      onSucesso(
        `Limpeza executada com sucesso! ${resp.total_removidos} registro(s) foram excluídos da base.`
      );
    } catch (err: unknown) {
      setErro(msgErro(err, "Falha ao executar limpeza em massa. Verifique sua senha."));
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-sus-950/60 p-4"
      onClick={onFechar}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl bg-white p-6 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between border-b border-sus-900/10 pb-3">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-red-100 p-2 text-red-700">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-display text-base font-bold text-sus-950">
                Executar Limpeza em Massa de Dados
              </h3>
              <p className="text-xs text-ink/55">Requer senha e autorização de superusuário</p>
            </div>
          </div>
          <button
            onClick={onFechar}
            disabled={carregando}
            className="rounded-lg p-2 text-ink/50 hover:bg-sand"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleExecutar} className="space-y-4">
          <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-950">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
              <div>
                <strong className="block font-bold">ATENÇÃO: Operação Irreversível!</strong>
                Os dados selecionados serão excluídos fisicamente do banco de dados relacional.
                Certifique-se de que revisou a prévia de registros antes de autorizar a limpeza.
              </div>
            </div>
          </div>

          {!user?.is_superuser && (
            <div className="rounded-xl border border-red-300 bg-red-100 p-3 text-xs font-bold text-red-900">
              Ação bloqueada: Apenas administradores com privilégio de superusuário podem autorizar exclusões em massa.
            </div>
          )}

          {limpezaConfigurada && (
            <div className="rounded-xl border border-red-200 bg-red-50/60 p-4 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sus-950">Operação Ativa:</span>
                <Badge variant="danger">{obterRotuloTipo(limpezaConfigurada.tipo)}</Badge>
              </div>
              {limpezaConfigurada.previewInfo !== undefined && (
                <div className="flex items-center justify-between font-medium text-ink/80">
                  <span>Impacto confirmado na prévia:</span>
                  <span className="font-mono font-bold text-red-700">
                    {limpezaConfigurada.previewInfo.totalAfetados} registro(s) elegíveis
                  </span>
                </div>
              )}
              {limpezaConfigurada.tipo === "fila_importada" && (
                <div className="border-t border-red-200/60 pt-2 space-y-1 text-ink/75">
                  <p>
                    <span className="font-semibold">Fila / Sigla:</span>{" "}
                    <span className="font-mono text-sus-950">
                      {String(limpezaConfigurada.filtro.tipo_fila || "Todas as filas")}
                    </span>
                  </p>
                  {Boolean(limpezaConfigurada.filtro.data_inicio || limpezaConfigurada.filtro.data_fim) && (
                    <p>
                      <span className="font-semibold">Período:</span>{" "}
                      {String(limpezaConfigurada.filtro.data_inicio || "Início")} até{" "}
                      {String(limpezaConfigurada.filtro.data_fim || "Hoje")}
                    </p>
                  )}
                  <p>
                    <span className="font-semibold">Critério de Agendamento:</span>{" "}
                    {limpezaConfigurada.filtro.apenas_nao_agendados
                      ? "Preservar registros agendados (apenas não agendados serão removidos)"
                      : "Incluir todos os registros da fila"}
                  </p>
                </div>
              )}
            </div>
          )}

          <div>
            <Label>Tipo de Limpeza</Label>
            <Select
              value={tipoLimpeza}
              disabled={true}
              className="bg-sand/30 font-medium cursor-not-allowed"
            >
              <option value="fila_importada">Fila Importada em Lote</option>
              <option value="pedidos_orfaos">Pedidos e Agendamentos Órfãos</option>
              <option value="agendamentos_duplicados">Agendamentos Laboratoriais Duplicados</option>
              <option value="cadastros_fantasmas">Cadastros de Pacientes Sem Vínculo (Fantasmas)</option>
            </Select>
            <span className="text-[11px] text-ink/50 mt-1 block">
              Bloqueado conforme configuração pré-visualizada na etapa anterior.
            </span>
          </div>

          <div className="flex items-center gap-1.5 rounded-lg bg-sand/60 px-3 py-2 text-xs text-ink/75">
            <span className="font-semibold text-sus-950">Administrador Responsável:</span>
            <span>{user?.nome ? `${user.nome} (${user.username})` : user?.username || "Superusuário"}</span>
          </div>

          <div>
            <Label>Senha do Administrador *</Label>
            <div className="relative">
              <Input
                type={mostrarSenha ? "text" : "password"}
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                placeholder="Digite sua senha atual"
                disabled={carregando || !user?.is_superuser}
                className="pr-10"
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                onClick={() => setMostrarSenha(!mostrarSenha)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/50 hover:text-ink"
                tabIndex={-1}
              >
                {mostrarSenha ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-sus-900/10 bg-sand/40 p-3">
            <label className="flex cursor-pointer items-start gap-2.5 text-xs leading-relaxed text-sus-950">
              <input
                type="checkbox"
                checked={confirmacaoExplicita}
                onChange={(e) => setConfirmacaoExplicita(e.target.checked)}
                disabled={carregando || !user?.is_superuser}
                className="mt-0.5 h-4 w-4 rounded border-sus-900/30 text-sus-900 focus:ring-sus-700"
              />
              <span className="font-semibold">
                Estou ciente de que esta exclusão é definitiva e não poderá ser desfeita.
              </span>
            </label>
          </div>

          {erro && (
            <div className="rounded-xl bg-red-50 p-3 text-xs font-semibold text-red-700">
              {erro}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-sus-900/10">
            <Button type="button" variant="outline" onClick={onFechar} disabled={carregando}>
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={carregando || !user?.is_superuser || !senha.trim() || !confirmacaoExplicita}
              className="!w-auto !bg-red-700 !text-white hover:!bg-red-800 disabled:opacity-50"
            >
              {carregando ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Excluindo Dados...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" /> Confirmar Exclusão em Massa
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ==============================================================================
// 7. MODAL: DETALHES DE INCONSISTÊNCIA / JSON INSPECTION
// ==============================================================================

interface ModalDetalhesDiagnosticoProps {
  item: ItemDiagnostico;
  aberto: boolean;
  onFechar: () => void;
  onUnificar: (entidade: EntidadeUnificavel, principalId: number, duplicadoId: number) => void;
  onCorrigir: (item: ItemDiagnostico) => void;
}

function ModalDetalhesDiagnostico({
  item,
  aberto,
  onFechar,
  onUnificar,
  onCorrigir,
}: ModalDetalhesDiagnosticoProps) {
  if (!aberto) return null;

  const ids = Array.isArray(item.ids) ? item.ids : [];
  let entidadeAlvo: EntidadeUnificavel | null = item.entidade_unificavel || null;
  if (!entidadeAlvo && ids.length >= 2) {
    if (item.dominio === "pacientes") {
      entidadeAlvo = "pacientes";
    } else if (item.dominio === "cadastros") {
      if (item.tipo.includes("medico")) entidadeAlvo = "medicos";
      else if (item.tipo.includes("unidade")) entidadeAlvo = "unidades";
      else if (item.tipo.includes("prestador")) entidadeAlvo = "prestadores";
      else if (item.tipo.includes("laboratorio")) entidadeAlvo = "laboratorios";
    }
  }
  const podeUnificar = entidadeAlvo !== null && ids.length >= 2;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-sus-950/60 p-4"
      onClick={onFechar}
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl bg-white p-6 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between border-b border-sus-900/10 pb-3">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-sus-900 p-2 text-white">
              <Info className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-display text-base font-bold text-sus-950">
                Detalhes da Inconsistência
              </h3>
              <p className="text-xs text-ink/55">{item.tipo}</p>
            </div>
          </div>
          <button onClick={onFechar} className="rounded-lg p-2 text-ink/50 hover:bg-sand">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <Label>Descrição Completa</Label>
            <p className="text-sm font-semibold text-sus-950">{item.descricao}</p>
          </div>

          {item.registros && item.registros.length > 0 && (
            <div>
              <Label>Registros Coincidentes</Label>
              <div className="overflow-x-auto rounded-xl border border-sus-900/10">
                <table className="w-full text-left text-xs">
                  <thead className="bg-sand/60 text-sus-950 font-bold">
                    <tr>
                      <th className="p-2.5">ID</th>
                      <th className="p-2.5">Nome / Registro</th>
                      <th className="p-2.5">CPF / Documento</th>
                      <th className="p-2.5">CNS / Chave</th>
                      <th className="p-2.5">Detalhe</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-sus-900/10">
                    {item.registros.map((r, i) => (
                      <tr key={i} className="hover:bg-sand/20">
                        <td className="p-2.5 font-mono font-bold">#{String(r.id || "")}</td>
                        <td className="p-2.5 font-semibold text-sus-950">{String(r.nome || "-")}</td>
                        <td className="p-2.5 font-mono">{String(r.cpf || "-")}</td>
                        <td className="p-2.5 font-mono">{String(r.cns || r.co_seq_cidadao_pec || "-")}</td>
                        <td className="p-2.5 text-ink/60">{String(r.prontuario || r.nascimento || "-")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div>
            <Label>Metadados da Ocorrência (JSON)</Label>
            <pre className="max-h-48 overflow-auto rounded-xl bg-sus-950 p-3 font-mono text-xs text-teal">
              {JSON.stringify(item, null, 2)}
            </pre>
          </div>

          <div className="flex flex-wrap justify-between items-center gap-2 pt-3 border-t border-sus-900/10">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={() => onCorrigir(item)}
                className="!bg-emerald-700 !text-white hover:!bg-emerald-800"
              >
                <Wrench className="h-4 w-4" /> {item.acao_sugerida || "Corrigir Problema"}
              </Button>
              {podeUnificar && entidadeAlvo && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onUnificar(entidadeAlvo!, ids[0], ids[1])}
                >
                  <GitMerge className="h-4 w-4" /> Escolher Principal (#{ids[0]} e #{ids[1]})
                </Button>
              )}
            </div>
            <Button size="sm" variant="outline" onClick={onFechar}>
              Fechar
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ==============================================================================
// 8. MODAL: CONFIRMAÇÃO DE CORREÇÃO INDIVIDUAL OU EM LOTE
// ==============================================================================

interface ModalConfirmarResolucaoProps {
  aberto: boolean;
  itens: ItemDiagnostico[];
  onFechar: () => void;
  onSucesso: (mensagem: string) => void;
  onErro: (erro: string) => void;
}

function ModalConfirmarResolucao({
  aberto,
  itens,
  onFechar,
  onSucesso,
  onErro,
}: ModalConfirmarResolucaoProps) {
  const [executando, setExecutando] = useState<boolean>(false);
  const [erroLocal, setErroLocal] = useState<string>("");
  const [progresso, setProgresso] = useState<{ feito: number; total: number } | null>(null);

  const resumoPorTipo = useMemo(() => {
    const mapa = new Map<string, { tipo: string; dominio: string; acao: string; desc: string; qtd: number }>();
    for (const item of itens) {
      const chave = `${item.dominio}|${item.tipo}`;
      const atual = mapa.get(chave);
      if (atual) {
        atual.qtd += 1;
      } else {
        mapa.set(chave, {
          tipo: item.tipo,
          dominio: String(item.dominio || "geral"),
          acao: item.acao_sugerida || "Corrigir",
          desc: item.descricao_correcao || "Aplica a correção automatizada para esta ocorrência.",
          qtd: 1,
        });
      }
    }
    return Array.from(mapa.values());
  }, [itens]);

  if (!aberto) return null;

  const ehLote = itens.length > 1;

  async function handleConfirmar() {
    setExecutando(true);
    setErroLocal("");
    try {
      if (!ehLote) {
        const item = itens[0];
        const resp = await resolverInconsistenciaDados(
          converterParaPayloadResolucao(item, String(item.dominio || "geral"))
        );
        onSucesso(resp.mensagem);
        return;
      }

      // Envia em blocos de até 200 itens para suportar grandes lotes com segurança
      const TAMANHO_BLOCO = 200;
      let totalResolvidos = 0;
      let totalFalhas = 0;
      const mensagensFalha: string[] = [];

      for (let i = 0; i < itens.length; i += TAMANHO_BLOCO) {
        const bloco = itens.slice(i, i + TAMANHO_BLOCO);
        setProgresso({ feito: i, total: itens.length });
        const payload = {
          itens: bloco.map((it) =>
            converterParaPayloadResolucao(it, String(it.dominio || "geral"))
          ),
        };
        const resp: ResolverLoteResponse = await resolverInconsistenciasLoteDados(payload);
        totalResolvidos += resp.total_resolvidos;
        totalFalhas += resp.total_falhas;
        for (const r of resp.resultados) {
          if (!r.sucesso && mensagensFalha.length < 5) {
            mensagensFalha.push(`${r.tipo}: ${r.mensagem}`);
          }
        }
      }

      setProgresso({ feito: itens.length, total: itens.length });

      if (totalFalhas > 0 && totalResolvidos === 0) {
        const msgFalha = `Nenhuma ocorrência pôde ser corrigida (${totalFalhas} falha(s)): ${mensagensFalha.join(" | ")}`;
        setErroLocal(msgFalha);
        onErro(msgFalha);
        return;
      }

      const msgFinal =
        totalFalhas === 0
          ? `Correção em lote concluída com sucesso! ${totalResolvidos} problema(s) resolvido(s).`
          : `Correção em lote finalizada: ${totalResolvidos} resolvido(s) e ${totalFalhas} falha(s). ${mensagensFalha.join(" | ")}`;
      onSucesso(msgFinal);
    } catch (err: unknown) {
      const m = msgErro(err, "Falha ao executar correção dos problemas selecionados.");
      setErroLocal(m);
    } finally {
      setExecutando(false);
      setProgresso(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-sus-950/60 p-4"
      onClick={executando ? undefined : onFechar}
    >
      <div
        className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-2xl bg-white p-6 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between border-b border-sus-900/10 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-emerald-700 p-2 text-white">
              {ehLote ? <CheckCheck className="h-5 w-5" /> : <Wrench className="h-5 w-5" />}
            </div>
            <div>
              <h3 className="font-display text-base font-bold text-sus-950">
                {ehLote
                  ? `Confirmar Correção em Lote (${itens.length} problemas)`
                  : `Confirmar Correção: ${itens[0].acao_sugerida || itens[0].tipo}`}
              </h3>
              <p className="text-xs text-ink/55">
                Operação transacional com bloqueio de concorrência e registro em auditoria
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onFechar}
            disabled={executando}
            className="rounded-lg p-2 text-ink/50 hover:bg-sand disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          {!ehLote ? (
            <div className="space-y-2 rounded-xl border border-sus-900/10 bg-sand/40 p-4 text-xs">
              <div className="flex items-center gap-2">
                <Badge variant="outline">
                  {ROTULOS_DOMINIO[String(itens[0].dominio)] || String(itens[0].dominio)}
                </Badge>
                <span className="font-mono font-semibold text-ink/60">{itens[0].tipo}</span>
              </div>
              <p className="text-sm font-semibold text-sus-950">{itens[0].descricao}</p>
              {itens[0].descricao_correcao && (
                <p className="text-emerald-900">
                  <strong>Ação que será aplicada:</strong> {itens[0].descricao_correcao}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Resumo das Correções Selecionadas</Label>
              <div className="max-h-64 space-y-2 overflow-y-auto rounded-xl border border-sus-900/10 bg-sand/30 p-3">
                {resumoPorTipo.map((g) => (
                  <div
                    key={`${g.dominio}|${g.tipo}`}
                    className="rounded-lg border border-sus-900/10 bg-white p-3 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className="text-[10px]">
                          {ROTULOS_DOMINIO[g.dominio] || g.dominio}
                        </Badge>
                        <span className="font-bold text-sus-950">{g.acao}</span>
                        <span className="font-mono text-[11px] text-ink/50">({g.tipo})</span>
                      </div>
                      <Badge variant="default">{g.qtd}x</Badge>
                    </div>
                    <p className="mt-1 text-ink/70">{g.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <p>
                Cada item é processado com <strong>savepoint isolado</strong> e todas as alterações
                ficam registradas no Histórico de Auditoria. O cache do diagnóstico será atualizado
                automaticamente ao concluir.
              </p>
            </div>
          </div>

          {progresso && (
            <div className="rounded-xl border border-sus-900/10 bg-sand/40 p-3 text-xs text-sus-950">
              Processando lote: <strong>{progresso.feito}</strong> de{" "}
              <strong>{progresso.total}</strong>...
            </div>
          )}

          {erroLocal && (
            <div className="rounded-xl bg-red-50 p-3 text-xs font-semibold text-red-700">
              {erroLocal}
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-sus-900/10 pt-3">
            <Button type="button" variant="outline" onClick={onFechar} disabled={executando}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleConfirmar}
              disabled={executando}
              className="!bg-emerald-700 !text-white hover:!bg-emerald-800"
            >
              {executando ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Aplicando Correções...
                </>
              ) : (
                <>
                  <CheckCheck className="h-4 w-4" />
                  {ehLote ? `Confirmar e Corrigir ${itens.length} Itens` : "Confirmar Correção"}
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
