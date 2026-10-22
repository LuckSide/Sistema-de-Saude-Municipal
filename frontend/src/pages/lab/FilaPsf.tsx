import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  CalendarDays,
  CheckCircle2,
  Edit2,
  FlaskConical,
  Layers,
  Plus,
  Stethoscope,
  Trash2,
  User,
  X,
} from "lucide-react";
import {
  filaPsfCriar,
  filaPsfAtualizar,
  filaPsfExcluir,
  filaPsfListar,
  filaPsfAgendarLote,
  fetchMedicos,
  fetchUnidadesSaude,
  labsListar,
  pagData,
  pagMeta,
  type FilaPsfItem,
  type Laboratorio,
  type Medico,
  type Paciente,
  type UnidadeSaude,
} from "../../services/api";
import { Button, Card, Input, Label } from "../../components/ui/primitives";
import Paginacao from "../../components/Paginacao";
import ExportarExcel from "../../components/ExportarExcel";
import { Combobox, type ComboOption } from "../../components/ui/combobox";
import BuscaPacienteAutocomplete from "../../components/BuscaPacienteAutocomplete";
import { useAuth } from "../../hooks/useAuth";

const MEDICO_GENERICO = "Médico da Unidade / Responsável Técnico";

export default function FilaPsf() {
  const { user } = useAuth();
  const [lista, setLista] = useState<FilaPsfItem[]>([]);
  const [unidades, setUnidades] = useState<UnidadeSaude[]>([]);
  const [medicos, setMedicos] = useState<Medico[]>([]);
  const [labs, setLabs] = useState<Laboratorio[]>([]);

  // Modais
  const [modalAberto, setModalAberto] = useState(false);
  const [itemEditando, setItemEditando] = useState<FilaPsfItem | null>(null);

  const [modalLote, setModalLote] = useState(false);
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set());
  const [loteLabId, setLoteLabId] = useState("");
  const [loteData, setLoteData] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [loteHora, setLoteHora] = useState("07:00");
  const [loteSalvando, setLoteSalvando] = useState(false);

  // Form de Pedido (Criar / Editar)
  const [pacienteSelecionado, setPacienteSelecionado] = useState<Paciente | null>(null);
  const [form, setForm] = useState({
    paciente_id: "",
    unidade_psf: "",
    medico: MEDICO_GENERICO,
    justificativa: "",
    obs: "",
  });

  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [salvando, setSalvando] = useState(false);

  async function carregar(p = page) {
    const r = await filaPsfListar(undefined, undefined, p, 100);
    setLista(pagData<FilaPsfItem>(r));
    const m = pagMeta(r);
    setTotal(m.total);
    setPage(m.page);
    setPages(m.pages);
  }

  useEffect(() => {
    carregar(1).catch(() => setErro("Falha ao carregar fila de exames."));
    fetchUnidadesSaude()
      .then((u) => setUnidades(u.filter((x) => x.ativo)))
      .catch(() => {});
    fetchMedicos({ somente_ativos: true })
      .then((m) => setMedicos(m.filter((x) => x.ativo)))
      .catch(() => {});
    labsListar()
      .then((l) => {
        const ativ = l.filter((x) => x.ativo);
        setLabs(ativ);
        if (ativ.length > 0) setLoteLabId(String(ativ[0].id));
      })
      .catch(() => {});
  }, []);

  function set(k: string, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // Preenche unidade padrão pelo perfil do usuário logado
  const unidPadraoUsuario = useMemo(() => {
    if (user?.unidade_saude_id) {
      const u = unidades.find((x) => x.id === user.unidade_saude_id);
      if (u) return u.nome;
    }
    return user?.unidade_saude_nome || "";
  }, [unidades, user]);

  function abrirModalNovo() {
    setItemEditando(null);
    setPacienteSelecionado(null);
    setForm({
      paciente_id: "",
      unidade_psf: unidPadraoUsuario || (unidades[0]?.nome ?? ""),
      medico: MEDICO_GENERICO,
      justificativa: "",
      obs: "",
    });
    setErro("");
    setModalAberto(true);
  }

  function abrirModalEditar(item: FilaPsfItem) {
    setItemEditando(item);
    setPacienteSelecionado({
      id: item.paciente_id,
      nome: item.paciente_nome,
      cpf: item.paciente_cpf || "",
      cns: item.paciente_cns || "",
      prontuario: item.paciente_prontuario || "",
    } as unknown as Paciente);
    setForm({
      paciente_id: String(item.paciente_id),
      unidade_psf: item.unidade_psf || "",
      medico: item.medico || MEDICO_GENERICO,
      justificativa: item.justificativa || "",
      obs: item.obs || "",
    });
    setErro("");
    setModalAberto(true);
  }

  function fecharModal() {
    setModalAberto(false);
    setItemEditando(null);
  }

  // Opções para o Combobox de Unidades
  const opcoesUnidades = useMemo<ComboOption[]>(() => {
    return unidades.map((u) => ({
      value: u.nome,
      label: u.nome,
      sub: u.cnes ? `CNES: ${u.cnes}` : undefined,
    }));
  }, [unidades]);

  // Opções para o Combobox de Médicos
  const opcoesMedicos = useMemo<ComboOption[]>(() => {
    const opts: ComboOption[] = [
      {
        value: MEDICO_GENERICO,
        label: `🏥 ${MEDICO_GENERICO}`,
        sub: "Padrão para postos de saúde da família (PSF)",
      },
    ];
    medicos.forEach((m) => {
      if (!m.nome.includes("Responsável Técnico") && !m.nome.includes("Médico da Unidade")) {
        opts.push({
          value: m.nome,
          label: m.nome,
          sub: m.crm ? `CRM: ${m.crm}${m.cbo_codigo ? ` · CBO: ${m.cbo_codigo}` : ""}` : undefined,
        });
      }
    });
    return opts;
  }, [medicos]);

  async function salvarPedido() {
    setErro("");
    setOk("");
    if (!form.paciente_id) {
      setErro("Selecione o paciente através da busca inteligente.");
      return;
    }
    if (!form.unidade_psf.trim()) {
      setErro("Selecione o PSF / unidade de origem solicitante.");
      return;
    }
    if (!form.medico.trim()) {
      setErro("Selecione o médico requisitante.");
      return;
    }

    setSalvando(true);
    try {
      if (itemEditando) {
        await filaPsfAtualizar(itemEditando.id, {
          unidade_psf: form.unidade_psf.trim(),
          medico: form.medico.trim(),
          justificativa: form.justificativa.trim(),
          obs: form.obs.trim(),
        });
        setOk(`Pedido de ${itemEditando.paciente_nome} atualizado com sucesso.`);
      } else {
        await filaPsfCriar({
          paciente_id: Number(form.paciente_id),
          unidade_psf: form.unidade_psf.trim(),
          medico: form.medico.trim(),
          justificativa: form.justificativa.trim(),
          obs: form.obs.trim(),
        });
        setOk("Pedido incluído na fila de exames com sucesso.");
      }
      fecharModal();
      await carregar();
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Erro ao salvar pedido na fila.");
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(id: number) {
    if (!confirm("Remover este pedido da fila de exames?")) return;
    try {
      await filaPsfExcluir(id);
      setOk("Pedido removido da fila.");
      setSelecionados((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
      await carregar();
    } catch {
      setErro("Erro ao remover pedido.");
    }
  }

  // Lógica de seleção múltipla
  function toggleSelecionado(id: number) {
    setSelecionados((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function toggleSelecionarTodos() {
    if (selecionados.size === lista.length && lista.length > 0) {
      setSelecionados(new Set());
    } else {
      setSelecionados(new Set(lista.map((x) => x.id)));
    }
  }

  async function executarAgendamentoLote() {
    if (selecionados.size === 0) return;
    if (!loteLabId) {
      alert("Selecione o laboratório conveniado.");
      return;
    }
    if (!loteData) {
      alert("Selecione a data do agendamento.");
      return;
    }

    setLoteSalvando(true);
    try {
      const res = await filaPsfAgendarLote({
        fila_ids: Array.from(selecionados),
        laboratorio_id: Number(loteLabId),
        data_agendada: loteData,
        hora_agendada: loteHora || "07:00",
      });
      setModalLote(false);
      setSelecionados(new Set());
      setOk(
        `Marcação em lote concluída com sucesso! ${res.total_agendados || selecionados.size} paciente(s) agendado(s).`
      );
      await carregar();
    } catch (e: any) {
      alert(e?.response?.data?.detail || "Erro ao realizar marcação em lote.");
    } finally {
      setLoteSalvando(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Barra de Cabeçalho e Ações Principais */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h2 className="font-display text-xl font-bold text-sus-950">
            Fila de exames
          </h2>
          <span className="rounded-full bg-teal/10 px-3 py-0.5 text-xs font-semibold text-teal">
            {total > 0 ? total : lista.length} aguardando
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 ml-auto">
          <ExportarExcel url="/api/exames/fila-psf/exportar" arquivo="fila_exames" />

          {/* Botão de Agendamento em Lote */}
          <Button
            onClick={() => setModalLote(true)}
            disabled={selecionados.size === 0}
            className={`border border-teal bg-white text-teal hover:bg-teal/10 shadow-xs ${
              selecionados.size > 0 ? "border-2 border-teal font-bold" : ""
            }`}
          >
            <Layers className="h-4 w-4" />
            {selecionados.size > 0
              ? `Marcar lote (${selecionados.size} selecionados)`
              : "Marcar lote mensal"}
          </Button>

          {/* Botão Principal para abrir Dialog de Novo Pedido */}
          <Button onClick={abrirModalNovo} className="flex items-center gap-1.5 shadow-sm">
            <Plus className="h-4 w-4" /> Novo pedido na fila
          </Button>
        </div>
      </div>

      {erro && (
        <p className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700 font-medium">
          {erro}
        </p>
      )}
      {ok && (
        <p className="rounded-xl bg-teal/10 px-4 py-2.5 text-sm text-teal font-medium">
          {ok}
        </p>
      )}

      {/* Tabela de Pedidos na Fila */}
      <Card className="overflow-hidden border-sus-900/10 shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-sus-900/10 bg-sand text-xs uppercase text-sus-900/60">
                <th className="px-4 py-3 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={lista.length > 0 && selecionados.size === lista.length}
                    onChange={toggleSelecionarTodos}
                    className="h-4 w-4 rounded border-sus-900/20 text-teal focus:ring-teal"
                    title="Selecionar todos os pedidos desta página"
                  />
                </th>
                <th className="px-4 py-3 font-semibold">Paciente</th>
                <th className="px-4 py-3 font-semibold">PSF / Origem</th>
                <th className="px-4 py-3 font-semibold">Médico Requisitante</th>
                <th className="px-4 py-3 font-semibold">Justificativa / Obs</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 text-right font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((f) => {
                const isSelected = selecionados.has(f.id);
                return (
                  <tr
                    key={f.id}
                    className={`border-b border-sus-900/5 last:border-0 hover:bg-sand/30 transition ${
                      isSelected ? "bg-teal/5" : ""
                    }`}
                  >
                    <td className="px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelecionado(f.id)}
                        className="h-4 w-4 rounded border-sus-900/20 text-teal focus:ring-teal"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-sus-950">{f.paciente_nome}</p>
                      <div className="flex items-center gap-2 text-xs text-ink/50">
                        {f.paciente_cpf && <span>CPF: {f.paciente_cpf}</span>}
                        {f.paciente_prontuario && <span>Pront.: {f.paciente_prontuario}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-ink/75 font-medium">{f.unidade_psf}</td>
                    <td className="px-4 py-3 text-xs text-ink/75">{f.medico}</td>
                    <td className="px-4 py-3 text-xs text-ink/65 max-w-xs">
                      {f.justificativa && (
                        <p className="font-medium text-sus-950 truncate" title={f.justificativa}>
                          {f.justificativa}
                        </p>
                      )}
                      {f.obs && <p className="italic text-[11px] truncate" title={f.obs}>{f.obs}</p>}
                      {!f.justificativa && !f.obs && "—"}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span className="rounded-md bg-amber-50 px-2 py-0.5 font-semibold text-amber-700 border border-amber-200">
                        {f.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => abrirModalEditar(f)}
                          className="rounded-lg p-1.5 text-teal hover:bg-teal/10 transition"
                          title="Editar pedido"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => excluir(f.id)}
                          className="rounded-lg p-1.5 text-red-600 hover:bg-red-50 transition"
                          title="Remover da fila"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {lista.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-ink/45">
                    Nenhum pedido aguardando na fila de exames.
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
          onPage={(p) => carregar(p).catch(() => setErro("Falha ao carregar fila."))}
        />
      </Card>

      {/* DIALOG (MODAL) PARA NOVO OU EDITAR PEDIDO NA FILA */}
      {modalAberto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-sus-950/60 p-3 sm:p-5"
          onClick={fecharModal}
        >
          <div
            className="rise max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white p-6 sm:p-8 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Cabeçalho do Dialog */}
            <div className="mb-5 flex items-start justify-between border-b border-sus-900/10 pb-4">
              <div>
                <h3 className="font-display text-lg font-bold text-sus-950 flex items-center gap-2">
                  <FlaskConical className="h-5 w-5 text-teal" />
                  {itemEditando ? "Editar pedido na fila de exames" : "Novo pedido na fila de exames"}
                </h3>
                <p className="mt-1 text-xs text-ink/65">
                  Os pedidos lançados pelos PSFs aguardam o loteamento mensal de vagas gerido pela Secretaria de Saúde.
                </p>
              </div>
              <button
                type="button"
                onClick={fecharModal}
                className="rounded-xl p-2 text-ink/50 hover:bg-sand transition"
                title="Fechar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Formulário Simétrico e Padronizado */}
            <div className="space-y-4">
              {/* Paciente (Busca Inteligente) */}
              <div>
                <BuscaPacienteAutocomplete
                  pacienteId={form.paciente_id}
                  pacienteInicial={pacienteSelecionado}
                  onSelect={(p) => {
                    setPacienteSelecionado(p);
                    set("paciente_id", p ? String(p.id) : "");
                  }}
                  label="Paciente"
                  obrigatorio
                />
              </div>

              {/* Grid Simétrico de Unidade e Médico */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                <div>
                  <div className="flex items-center min-h-[26px] mb-1.5">
                    <Label className="!mb-0 flex items-center gap-1.5">
                      <Building2 className="h-3.5 w-3.5 text-teal" /> PSF / Unidade Solicitante *
                    </Label>
                  </div>
                  <Combobox
                    value={form.unidade_psf}
                    onChange={(v) => set("unidade_psf", v)}
                    options={opcoesUnidades}
                    placeholder="Buscar unidade de saúde…"
                    searchPlaceholder="Digite o nome da unidade…"
                    emptyText="Nenhuma unidade encontrada"
                    showAll={false}
                  />
                  {user?.unidade_saude_nome && form.unidade_psf === user.unidade_saude_nome ? (
                    <p className="mt-1.5 text-[11px] text-teal font-medium">
                      ✓ Unidade vinculada ao seu usuário
                    </p>
                  ) : (
                    <p className="mt-1.5 text-[11px] text-ink/50">
                      Posto de saúde requisitante.
                    </p>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between min-h-[26px] mb-1.5">
                    <Label className="!mb-0 flex items-center gap-1.5">
                      <Stethoscope className="h-3.5 w-3.5 text-teal" /> Médico(a) Requisitante *
                    </Label>
                    <button
                      type="button"
                      onClick={() => set("medico", MEDICO_GENERICO)}
                      className="inline-flex items-center rounded-md bg-teal/10 px-2 py-0.5 text-[10px] font-bold text-teal hover:bg-teal/20 transition"
                      title="Redefinir para Médico da Unidade"
                    >
                      🏥 Médico da Unidade
                    </button>
                  </div>
                  <Combobox
                    value={form.medico}
                    onChange={(v) => set("medico", v)}
                    options={opcoesMedicos}
                    placeholder="Buscar médico requisitante…"
                    searchPlaceholder="Digite o nome do médico ou CRM…"
                    emptyText="Nenhum médico encontrado"
                    showAll={false}
                  />
                  <p className="mt-1.5 text-[11px] text-ink/50">
                    Padrão: Médico da Unidade / Resp. Técnico.
                  </p>
                </div>
              </div>

              {/* Justificativa Clínica */}
              <div>
                <Label>Justificativa Clínica / Hipótese Diagnóstica</Label>
                <Input
                  placeholder="Descreva a indicação clínica do exame (mínimo recomendado de 12 caracteres)…"
                  value={form.justificativa}
                  onChange={(e) => set("justificativa", e.target.value)}
                />
              </div>

              {/* Observações Gerais */}
              <div>
                <Label>Observações Adicionais (opcional)</Label>
                <Input
                  placeholder="Orientações específicas, sintomas, prioridades…"
                  value={form.obs}
                  onChange={(e) => set("obs", e.target.value)}
                />
              </div>

              {erro && (
                <div className="rounded-xl bg-red-50 p-3 text-xs text-red-700 font-medium">
                  {erro}
                </div>
              )}

              {/* Botões do Rodapé */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-sus-900/10">
                <Button
                  type="button"
                  onClick={fecharModal}
                  className="border border-sus-900/15 bg-white text-ink hover:bg-sand"
                >
                  Cancelar
                </Button>
                <Button onClick={salvarPedido} disabled={salvando}>
                  <CheckCircle2 className="h-4 w-4" />
                  {salvando
                    ? "Salvando…"
                    : itemEditando
                    ? "Salvar alterações"
                    : "Confirmar inclusão na fila"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE AGENDAMENTO EM LOTE MENSAL */}
      {modalLote && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-sus-950/60 p-3 sm:p-5"
          onClick={() => setModalLote(false)}
        >
          <div
            className="rise max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between border-b border-sus-900/10 pb-3">
              <div>
                <h3 className="font-display text-base font-bold text-sus-950 flex items-center gap-2">
                  <Layers className="h-5 w-5 text-teal" />
                  Marcação mensal em lote ({selecionados.size} pedidos)
                </h3>
                <p className="mt-0.5 text-xs text-ink/65">
                  Agende os pedidos selecionados para o laboratório conveniado de destino.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalLote(false)}
                className="rounded-xl p-2 text-ink/50 hover:bg-sand transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <Label>Laboratório Conveniado *</Label>
                <select
                  value={loteLabId}
                  onChange={(e) => setLoteLabId(e.target.value)}
                  className="w-full h-11 rounded-xl border border-sus-900/15 bg-white px-3.5 text-sm outline-none focus:border-teal"
                >
                  {labs.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.nome} {l.cnes ? `(CNES: ${l.cnes})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Data do Agendamento *</Label>
                  <Input
                    type="date"
                    value={loteData}
                    onChange={(e) => setLoteData(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Horário da Coleta</Label>
                  <Input
                    type="text"
                    value={loteHora}
                    onChange={(e) => setLoteHora(e.target.value)}
                    placeholder="07:00"
                  />
                </div>
              </div>

              <div className="rounded-xl bg-sand/40 p-3 border border-sus-900/10">
                <p className="font-bold text-sus-950 mb-1">
                  Pacientes selecionados para agendamento ({selecionados.size}):
                </p>
                <ul className="list-disc pl-4 space-y-0.5 text-[11px] text-ink/75 max-h-36 overflow-y-auto">
                  {lista
                    .filter((x) => selecionados.has(x.id))
                    .map((x) => (
                      <li key={x.id}>
                        <strong>{x.paciente_nome}</strong> · {x.unidade_psf}
                      </li>
                    ))}
                </ul>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-sus-900/10">
                <Button
                  type="button"
                  onClick={() => setModalLote(false)}
                  className="border border-sus-900/15 bg-white text-ink hover:bg-sand"
                >
                  Cancelar
                </Button>
                <Button onClick={executarAgendamentoLote} disabled={loteSalvando}>
                  <CalendarDays className="h-4 w-4" />
                  {loteSalvando ? "Processando lote..." : "Confirmar Agendamento em Lote"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
