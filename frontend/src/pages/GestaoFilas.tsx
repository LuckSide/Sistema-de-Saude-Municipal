import { useEffect, useState } from "react";
import {
  ListOrdered,
  Plus,
  Search,
  Filter,
  Edit2,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  FlaskConical,
  ShieldCheck,
  Activity,
  Layers,
  HelpCircle,
} from "lucide-react";
import {
  tfdTipos,
  tfdCriarTipo,
  tfdAtualizarTipo,
  tfdExcluirTipo,
  type TipoFila,
  pagData,
  pagMeta,
} from "../services/api";
import { Badge, Button, Card, Input, Label, Select } from "../components/ui/primitives";
import { useConfirm } from "../components/ConfirmDialog";

const TIPOS_FILA_CONFIG: {
  id: string;
  rotulo: string;
  descricao: string;
  corBadge: string;
}[] = [
  {
    id: "REGULACAO_GERAL",
    rotulo: "Regulação Geral",
    descricao: "Fila regular de consultas especializadas, exames de imagem e regulação municipal.",
    corBadge: "bg-teal-50 text-teal-800 border-teal-200",
  },
  {
    id: "EXAME_LABORATORIAL",
    rotulo: "Exame Laboratorial",
    descricao: "Exames de sangue e análises clínicas vinculados diretamente ao módulo de Laboratório.",
    corBadge: "bg-purple-50 text-purple-800 border-purple-200",
  },
  {
    id: "ALTA_COMPLEXIDADE",
    rotulo: "Alta Complexidade",
    descricao: "Procedimentos de alta complexidade, cirurgias eletivas e regulação estadual/regional.",
    corBadge: "bg-amber-50 text-amber-800 border-amber-200",
  },
];

export default function GestaoFilas() {
  const [filas, setFilas] = useState<TipoFila[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState("");

  // Filtros
  const [busca, setBusca] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<string>("todos");
  const [filtroStatus, setFiltroStatus] = useState<string>("todos");

  // Paginação
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);

  // Modal Novo / Edição
  const [modalAberto, setModalAberto] = useState(false);
  const [filaEdicao, setFilaEdicao] = useState<TipoFila | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erroModal, setErroModal] = useState("");

  const [form, setForm] = useState({
    codigo: "",
    nome: "",
    tipo_fila: "REGULACAO_GERAL",
    ativo: true,
  });

  const confirm = useConfirm();

  async function carregarFilas(p = page) {
    setCarregando(true);
    setErro("");
    try {
      const params: { q?: string; tipo_fila?: string; ativos?: boolean; page: number; limit: number } = {
        page: p,
        limit: 50,
      };
      if (busca.trim()) params.q = busca.trim();
      if (filtroTipo !== "todos") params.tipo_fila = filtroTipo;
      if (filtroStatus === "ativos") params.ativos = true;
      if (filtroStatus === "inativos") params.ativos = false;

      const r = await tfdTipos(params);
      const data = pagData<TipoFila>(r);
      const meta = pagMeta(r);
      setFilas(data);
      setTotal(meta.total);
      setPage(meta.page);
      setPages(meta.pages);
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Erro ao carregar lista de filas.");
      setFilas([]);
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregarFilas(1);
  }, [busca, filtroTipo, filtroStatus]);

  function abrirModalCriacao() {
    setFilaEdicao(null);
    setForm({
      codigo: "",
      nome: "",
      tipo_fila: "REGULACAO_GERAL",
      ativo: true,
    });
    setErroModal("");
    setModalAberto(true);
  }

  function abrirModalEdicao(f: TipoFila) {
    setFilaEdicao(f);
    setForm({
      codigo: f.codigo || "",
      nome: f.nome || "",
      tipo_fila: f.tipo_fila || "REGULACAO_GERAL",
      ativo: f.ativo,
    });
    setErroModal("");
    setModalAberto(true);
  }

  async function handleSalvar(e: React.FormEvent) {
    e.preventDefault();
    if (!form.codigo.trim() || !form.nome.trim()) {
      setErroModal("Preencha o código e o nome da fila.");
      return;
    }

    setSalvando(true);
    setErroModal("");
    try {
      const payload = {
        codigo: form.codigo.trim().toUpperCase(),
        nome: form.nome.trim(),
        tipo_fila: form.tipo_fila,
        ativo: form.ativo,
      };

      if (filaEdicao) {
        await tfdAtualizarTipo(filaEdicao.id, payload);
        setSucesso(`Fila "${form.nome}" atualizada com sucesso!`);
      } else {
        await tfdCriarTipo(payload);
        setSucesso(`Fila "${form.nome}" criada com sucesso!`);
      }
      setModalAberto(false);
      carregarFilas(page);
    } catch (err: any) {
      setErroModal(err?.response?.data?.detail || "Erro ao salvar fila.");
    } finally {
      setSalvando(false);
    }
  }

  async function alternarStatus(f: TipoFila) {
    try {
      await tfdAtualizarTipo(f.id, {
        codigo: f.codigo,
        nome: f.nome,
        tipo_fila: f.tipo_fila || "REGULACAO_GERAL",
        ativo: !f.ativo,
      });
      setSucesso(`Fila "${f.nome}" ${f.ativo ? "desativada" : "ativada"} com sucesso.`);
      carregarFilas(page);
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Erro ao alterar status da fila.");
    }
  }

  async function handleExcluir(f: TipoFila) {
    const ok = await confirm({
      title: "Excluir Fila",
      message: `Deseja realmente remover a fila "${f.nome}" (${f.codigo})? Procedimentos vinculados perderão essa categorização.`,
      confirmLabel: "Excluir Fila",
      cancelLabel: "Cancelar",
      danger: true,
    });
    if (!ok) return;

    try {
      await tfdExcluirTipo(f.id);
      setSucesso(`Fila "${f.nome}" removida.`);
      carregarFilas(page);
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Erro ao excluir fila.");
    }
  }

  function getBadgeTipo(tipo: string | undefined) {
    const conf = TIPOS_FILA_CONFIG.find((c) => c.id === tipo) || TIPOS_FILA_CONFIG[0];
    return (
      <span
        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${conf.corBadge}`}
        title={conf.descricao}
      >
        {tipo === "EXAME_LABORATORIAL" && <FlaskConical className="h-3 w-3" />}
        {tipo === "REGULACAO_GERAL" && <Layers className="h-3 w-3" />}
        {tipo === "ALTA_COMPLEXIDADE" && <Activity className="h-3 w-3" />}
        {conf.rotulo}
      </span>
    );
  }

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-sus-950 flex items-center gap-2">
            <ListOrdered className="h-6 w-6 text-teal" /> Gestão de Filas de Atendimento
          </h2>
          <p className="text-sm text-ink/70">
            Cadastre, edite e configure as filas de regulação, segregando o fluxo de laboratório da regulação geral.
          </p>
        </div>
        <Button onClick={abrirModalCriacao} className="gap-2 bg-teal hover:bg-teal-700 text-white shadow-sm">
          <Plus className="h-4 w-4" /> Nova Fila
        </Button>
      </div>

      {/* Alertas */}
      {erro && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{erro}</span>
        </div>
      )}
      {sucesso && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{sucesso}</span>
        </div>
      )}

      {/* Cartão Informativo de Segregação */}
      <div className="rounded-xl border border-sus-900/10 bg-sand/40 p-4">
        <div className="flex items-start gap-3">
          <HelpCircle className="h-5 w-5 text-teal shrink-0 mt-0.5" />
          <div className="text-xs space-y-1 text-ink/80">
            <p className="font-semibold text-sus-950">
              Diretriz Arquitetural de Segregação de Filas:
            </p>
            <p>
              • <b>Regulação Geral:</b> Exibida na Fila de Espera tradicional (consultas, TFD, ultrassons, radiologia).
            </p>
            <p>
              • <b>Exame Laboratorial:</b> Exibida exclusivamente no módulo de Laboratório (coletas de sangue, urina, fezes). Fica oculta na regulação geral.
            </p>
            <p>
              • <b>Alta Complexidade:</b> Utilizada para triagens especiais, cirurgias eletivas ou oncologia regional.
            </p>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-ink/40" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por código ou nome..."
              className="pl-9 text-xs"
            />
          </div>

          <div>
            <Select
              value={filtroTipo}
              onChange={(e) => setFiltroTipo(e.target.value)}
              className="text-xs"
            >
              <option value="todos">Todos os Tipos de Fila</option>
              <option value="REGULACAO_GERAL">Regulação Geral</option>
              <option value="EXAME_LABORATORIAL">Exames Laboratoriais</option>
              <option value="ALTA_COMPLEXIDADE">Alta Complexidade</option>
            </Select>
          </div>

          <div>
            <Select
              value={filtroStatus}
              onChange={(e) => setFiltroStatus(e.target.value)}
              className="text-xs"
            >
              <option value="todos">Todos os Status</option>
              <option value="ativos">Apenas Ativas</option>
              <option value="inativos">Apenas Desativadas</option>
            </Select>
          </div>
        </div>
      </Card>

      {/* Tabela de Filas */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-sand/60 text-sus-950 uppercase font-semibold border-b border-sus-900/10">
              <tr>
                <th className="px-4 py-3">Código</th>
                <th className="px-4 py-3">Nome da Fila</th>
                <th className="px-4 py-3">Tipo / Roteamento</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sus-900/10">
              {carregando ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-ink/50">
                    Carregando filas...
                  </td>
                </tr>
              ) : filas.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-ink/50">
                    Nenhuma fila encontrada com os filtros selecionados.
                  </td>
                </tr>
              ) : (
                filas.map((f) => (
                  <tr key={f.id} className="hover:bg-sand/20 transition-colors">
                    <td className="px-4 py-3 font-mono font-bold text-sus-950">
                      {f.codigo}
                    </td>
                    <td className="px-4 py-3 font-medium text-ink/90">
                      {f.nome}
                    </td>
                    <td className="px-4 py-3">
                      {getBadgeTipo(f.tipo_fila)}
                    </td>
                    <td className="px-4 py-3">
                      {f.ativo ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                          <CheckCircle2 className="h-3 w-3" /> Ativa
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-ink/50 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
                          Desativada
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right space-x-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => abrirModalEdicao(f)}
                        className="h-7 px-2 text-ink/70 hover:text-sus-950"
                        title="Editar fila"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => alternarStatus(f)}
                        className={`h-7 px-2 ${f.ativo ? "text-amber-700 hover:text-amber-900" : "text-emerald-700 hover:text-emerald-900"}`}
                        title={f.ativo ? "Desativar fila" : "Ativar fila"}
                      >
                        {f.ativo ? "Desativar" : "Ativar"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleExcluir(f)}
                        className="h-7 px-2 text-red-600 hover:text-red-800"
                        title="Excluir fila"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Rodapé e Paginação */}
        <div className="flex items-center justify-between px-4 py-3 bg-sand/30 border-t border-sus-900/10 text-xs text-ink/70">
          <span>Total: <b>{total}</b> filas cadastradas</span>
          {pages > 1 && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => carregarFilas(page - 1)}
                className="h-7 px-2 text-xs"
              >
                Anterior
              </Button>
              <span>
                Página {page} de {pages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pages}
                onClick={() => carregarFilas(page + 1)}
                className="h-7 px-2 text-xs"
              >
                Próxima
              </Button>
            </div>
          )}
        </div>
      </Card>

      {/* Modal Criar / Editar Fila */}
      {modalAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <Card className="w-full max-w-lg p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-sus-900/10 pb-3">
              <h3 className="text-base font-bold text-sus-950 flex items-center gap-2">
                <ListOrdered className="h-5 w-5 text-teal" />
                {filaEdicao ? "Editar Fila" : "Cadastrar Nova Fila"}
              </h3>
              <button
                type="button"
                onClick={() => setModalAberto(false)}
                className="text-ink/40 hover:text-ink/80 text-lg font-bold"
              >
                &times;
              </button>
            </div>

            {erroModal && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-2.5 text-xs text-red-800 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{erroModal}</span>
              </div>
            )}

            <form onSubmit={handleSalvar} className="space-y-4">
              <div>
                <Label className="text-xs font-semibold">Código Identificador *</Label>
                <Input
                  value={form.codigo}
                  onChange={(e) => setForm({ ...form, codigo: e.target.value.toUpperCase() })}
                  placeholder="Ex: CONSULTAS, LAB, CIRURGIAS"
                  className="mt-1 font-mono uppercase text-xs"
                  required
                />
                <p className="mt-0.5 text-[11px] text-ink/50">Código interno único (sem espaços recomendados).</p>
              </div>

              <div>
                <Label className="text-xs font-semibold">Nome da Fila *</Label>
                <Input
                  value={form.nome}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })}
                  placeholder="Ex: Consultas Especializadas, Exames de Sangue"
                  className="mt-1 text-xs"
                  required
                />
              </div>

              <div>
                <Label className="text-xs font-semibold">Tipo de Fila / Destino Arquitetural *</Label>
                <Select
                  value={form.tipo_fila}
                  onChange={(e) => setForm({ ...form, tipo_fila: e.target.value })}
                  className="mt-1 text-xs"
                  required
                >
                  <option value="REGULACAO_GERAL">Regulação Geral (Solicitações do Município, TFD e Especialidades)</option>
                  <option value="EXAME_LABORATORIAL">Exame Laboratorial (Módulo de Laboratório / Labcon)</option>
                  <option value="ALTA_COMPLEXIDADE">Alta Complexidade (Regulação Regional / Cirurgias)</option>
                </Select>
                <p className="mt-1 text-[11px] text-ink/60">
                  {form.tipo_fila === "EXAME_LABORATORIAL" &&
                    "Atenção: Filas laboratoriais serão exibidas estritamente no módulo de Laboratório e excluídas da fila de espera geral."}
                  {form.tipo_fila === "REGULACAO_GERAL" &&
                    "Filas regulares são consumidas pela esteira padrão de solicitações e regulação do TFD."}
                  {form.tipo_fila === "ALTA_COMPLEXIDADE" &&
                    "Utilizada para priorização e acompanhamento de alta densidade tecnológica."}
                </p>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="chk-ativo-fila"
                  checked={form.ativo}
                  onChange={(e) => setForm({ ...form, ativo: e.target.checked })}
                  className="rounded border-sus-900/20 text-teal focus:ring-teal"
                />
                <Label htmlFor="chk-ativo-fila" className="text-xs font-medium cursor-pointer">
                  Fila Ativa (disponível para novas solicitações e agendamentos)
                </Label>
              </div>

              <div className="flex justify-end gap-2 border-t border-sus-900/10 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setModalAberto(false)}
                  className="text-xs"
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={salvando}
                  className="bg-teal hover:bg-teal-700 text-white text-xs"
                >
                  {salvando ? "Salvando..." : filaEdicao ? "Atualizar Fila" : "Criar Fila"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
