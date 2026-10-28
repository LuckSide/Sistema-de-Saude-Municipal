import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash2, X, ChartColumn, Search, Car, Wrench } from "lucide-react";
import {
  tfdAtualizarVeiculo,
  tfdCriarVeiculo,
  tfdExcluirVeiculo,
  tfdManutencaoVeiculo,
  tfdRelatorioFrota,
  tfdVeiculos,
  pagData,
  pagMeta,
  type RelatorioFrota,
  type Veiculo,
} from "../../services/api";
import { Button, Card, Input, Label } from "../../components/ui/primitives";
import Paginacao from "../../components/Paginacao";
import ExportarExcel from "../../components/ExportarExcel";
import { useConfirm } from "../../components/ConfirmDialog";
import { useUndo } from "../../components/UndoToast";

const vazio = { placa: "", modelo: "", capacidade: "4", tipo: "carro", status: "disponivel", ativo: true };

function formatarDataBR(dataStr?: string | null) {
  if (!dataStr) return "";
  const partes = dataStr.slice(0, 10).split("-");
  if (partes.length === 3) return `${partes[2]}/${partes[1]}/${partes[0]}`;
  return dataStr;
}

export default function TfdFrota() {
  const { confirmar } = useConfirm();
  const { notificarUndo } = useUndo();
  const [aba, setAba] = useState<"veiculos" | "relatorio">("veiculos");
  const [lista, setLista] = useState<Veiculo[]>([]);
  const [q, setQ] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<"ativos" | "manutencao" | "inativos">("ativos");
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(vazio);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [carregando, setCarregando] = useState(false);

  // Gestão individual de manutenção
  const [modalManutencao, setModalManutencao] = useState(false);
  const [veiculoManutencao, setVeiculoManutencao] = useState<Veiculo | null>(null);
  const [formManut, setFormManut] = useState({
    data_entrada: "",
    motivo: "",
    previsao_retorno: "",
    indefinida: false,
  });
  const [manutSalvando, setManutSalvando] = useState(false);

  // Relatório da frota
  const [relDe, setRelDe] = useState(() => new Date().toISOString().slice(0, 7) + "-01");
  const [relAte, setRelAte] = useState(() => new Date().toISOString().slice(0, 10));
  const [rel, setRel] = useState<RelatorioFrota | null>(null);
  const [relErro, setRelErro] = useState("");
  const [relLoading, setRelLoading] = useState(false);

  async function carregar(p = page, busca = q, st = filtroStatus, limite = pageSize) {
    setCarregando(true);
    setErro("");
    try {
      const paramAtivo = st === "inativos" ? false : true;
      const paramStatus = st === "manutencao" ? "manutencao" : undefined;
      const r = await tfdVeiculos(p, limite, busca, paramAtivo, paramStatus);
      setLista(pagData<Veiculo>(r));
      const m = pagMeta(r);
      setTotal(m.total);
      setPage(m.page);
      setPages(m.pages);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErro(msg || "Falha ao carregar frota.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregar(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      carregar(1, q, filtroStatus, pageSize).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, filtroStatus]);

  async function carregarRelatorio() {
    setRelLoading(true);
    setRelErro("");
    try {
      setRel(await tfdRelatorioFrota(relDe || undefined, relAte || undefined));
    } catch {
      setRelErro("Falha ao carregar relatório.");
    } finally {
      setRelLoading(false);
    }
  }

  useEffect(() => {
    if (aba === "relatorio" && !rel) carregarRelatorio().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aba]);

  function abrirModal(id?: number) {
    if (id) {
      const v = lista.find((x) => x.id === id);
      if (v) {
        setEditId(v.id);
        setForm({
          placa: v.placa,
          modelo: v.modelo,
          capacidade: String(v.capacidade),
          tipo: v.tipo,
          status: v.status || "disponivel",
          ativo: v.ativo,
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
    setOk("");
  }

  async function salvar() {
    setErro("");
    setOk("");
    if (form.placa.trim().length < 7) {
      setErro("Placa deve conter ao menos 7 caracteres.");
      return;
    }
    const payload = {
      ...form,
      placa: form.placa.trim().toUpperCase(),
      capacidade: Number(form.capacidade) || 4,
    };
    try {
      if (editId) {
        await tfdAtualizarVeiculo(editId, payload);
        fecharModal();
        setOk("Veículo atualizado.");
      } else {
        await tfdCriarVeiculo(payload);
        fecharModal();
        setOk("Veículo cadastrado.");
      }
      await carregar(page);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErro(msg || "Erro ao salvar. Placa pode já existir.");
    }
  }

  async function removerVeiculo(v: Veiculo) {
    setErro("");
    setOk("");
    const confirmado = await confirmar({
      titulo: `Excluir veículo ${v.placa}`,
      descricao: (
        <div className="space-y-1.5">
          <p>
            Deseja realmente remover o veículo <strong>{v.placa}</strong> ({v.modelo || "Sem modelo"})?
          </p>
          <p className="text-ink/60 text-[11px] leading-relaxed">
            Caso o veículo possua viagens agendadas ou realizadas no sistema, ele será automaticamente inativado para manter o histórico das rotas e passageiros.
          </p>
        </div>
      ),
      textoConfirmar: "Sim, Excluir",
      variante: "danger",
    });

    if (!confirmado) return;

    const snap = { ...v };
    try {
      await tfdExcluirVeiculo(v.id);
      // Remove imediatamente da lista para não ficar aparecendo na tela
      setLista((prev) => prev.filter((item) => item.id !== v.id));
      await carregar(page);
      setOk(`Veículo ${v.placa} inativado e removido da listagem ativa.`);
      notificarUndo({
        titulo: `Veículo ${snap.placa} removido.`,
        descricao: "Desfazer reativa ou recadastra o veículo.",
        onUndo: async () => {
          try {
            await tfdAtualizarVeiculo(snap.id, {
              placa: snap.placa,
              modelo: snap.modelo,
              capacidade: snap.capacidade,
              tipo: snap.tipo,
              status: snap.status,
              ativo: true,
            });
          } catch {
            await tfdCriarVeiculo({
              placa: snap.placa,
              modelo: snap.modelo,
              capacidade: snap.capacidade,
              tipo: snap.tipo,
              status: snap.status,
              ativo: true,
            });
          }
          await carregar(page);
        },
      });
    } catch (err: unknown) {
      const detalhe = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErro(detalhe || "Falha ao excluir veículo.");
    }
  }

  function abrirModalManutencao(v: Veiculo) {
    setVeiculoManutencao(v);
    const hoje = new Date().toISOString().slice(0, 10);
    setFormManut({
      data_entrada: v.manutencao_data_entrada ? v.manutencao_data_entrada.slice(0, 10) : hoje,
      motivo: v.manutencao_motivo || "",
      previsao_retorno: v.manutencao_previsao_retorno ? v.manutencao_previsao_retorno.slice(0, 10) : "",
      indefinida: !!v.manutencao_indefinida,
    });
    setErro("");
    setModalManutencao(true);
  }

  async function salvarManutencao(colocarEmManutencao: boolean) {
    if (!veiculoManutencao) return;
    setErro("");
    setOk("");

    if (colocarEmManutencao) {
      if (!formManut.data_entrada) {
        setErro("Informe a data de entrada na manutenção.");
        return;
      }
      if (!formManut.motivo.trim()) {
        setErro("Informe o motivo da manutenção.");
        return;
      }
      if (!formManut.indefinida && !formManut.previsao_retorno) {
        setErro("Informe a previsão de retorno ou marque manutenção por tempo indeterminado.");
        return;
      }
    }

    setManutSalvando(true);
    try {
      await tfdManutencaoVeiculo(veiculoManutencao.id, {
        em_manutencao: colocarEmManutencao,
        data_entrada: colocarEmManutencao ? formManut.data_entrada : null,
        motivo: colocarEmManutencao ? formManut.motivo.trim() : "",
        previsao_retorno: (colocarEmManutencao && !formManut.indefinida) ? formManut.previsao_retorno : null,
        indefinida: colocarEmManutencao ? formManut.indefinida : false,
      });

      const placa = veiculoManutencao.placa;
      setModalManutencao(false);
      setVeiculoManutencao(null);
      setOk(
        colocarEmManutencao
          ? `Veículo ${placa} colocado em manutenção e bloqueado para viagens.`
          : `Manutenção do veículo ${placa} concluída com sucesso! Veículo liberado para viagens.`
      );
      await carregar(page);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErro(msg || "Falha ao atualizar manutenção do veículo.");
    } finally {
      setManutSalvando(false);
    }
  }

  async function confirmarLiberarVeiculo() {
    if (!veiculoManutencao) return;
    const aceitou = await confirmar({
      titulo: `Concluir manutenção de ${veiculoManutencao.placa}`,
      descricao: `Deseja finalizar a manutenção do veículo ${veiculoManutencao.placa} e torná-lo disponível para viagens novamente?`,
      textoConfirmar: "Sim, Liberar Veículo",
      variante: "primary",
    });
    if (aceitou) {
      await salvarManutencao(false);
    }
  }

  // Garante que veículos inativos sejam removidos da listagem ativa
  const veiculosExibicao = useMemo(() => {
    if (filtroStatus === "inativos") {
      return lista.filter((v) => !v.ativo);
    }
    if (filtroStatus === "manutencao") {
      return lista.filter((v) => v.ativo && v.status === "manutencao");
    }
    return lista.filter((v) => v.ativo);
  }, [lista, filtroStatus]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="font-display text-lg font-bold text-sus-950">Frota</h2>
        <span className="rounded-full bg-teal/10 px-2.5 py-0.5 text-xs font-semibold text-teal">
          {total} cadastrado(s)
        </span>
        <div className="inline-flex rounded-xl border border-sus-900/10 bg-white p-1">
          {(["veiculos", "relatorio"] as const).map((a) => (
            <button
              key={a}
              onClick={() => setAba(a)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${aba === a ? "bg-sus-900 text-white" : "text-sus-900 hover:bg-sand"}`}
            >
              {a === "veiculos" ? "Veículos" : "Relatório"}
            </button>
          ))}
        </div>
        {aba === "veiculos" && (
          <Button onClick={() => abrirModal()} className="ml-auto"><Plus className="h-4 w-4" /> Novo veículo</Button>
        )}
        {aba === "relatorio" && (
          <span className="ml-auto">
            <ExportarExcel
              url="/api/tfd/frota/relatorio/exportar"
              arquivo="relatorio_frota"
              params={{ de: relDe || undefined, ate: relAte || undefined }}
            />
          </span>
        )}
      </div>
      {erro && !modal && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
      {ok && <p className="mb-3 rounded-xl bg-teal/10 px-3 py-2 text-sm text-teal">{ok}</p>}

      {aba === "veiculos" && (
        <>
          {/* Barra de Busca e Filtros Rápidos */}
          <Card className="mb-4 space-y-3 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Buscar veículo por placa ou modelo…"
                  className="pl-9"
                />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs font-medium text-slate-500">Status:</span>
                {(
                  [
                    { id: "ativos", label: "Veículos Ativos" },
                    { id: "manutencao", label: "Em Manutenção" },
                    { id: "inativos", label: "Inativados" },
                  ] as const
                ).map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => setFiltroStatus(st.id)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                      filtroStatus === st.id
                        ? "bg-sus-900 text-white shadow-sm font-bold"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {st.label}
                  </button>
                ))}
              </div>
            </div>
          </Card>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {veiculosExibicao.map((v) => (
              <Card key={v.id} className="p-4 transition hover:border-sus-900/20 hover:shadow-md">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <p className="rounded-lg bg-sus-900 px-2.5 py-1 font-display text-sm font-bold text-white tracking-wider">
                      {v.placa}
                    </p>
                    {v.status === "manutencao" && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                        <Wrench className="h-3 w-3" /> Manutenção
                      </span>
                    )}
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${v.ativo ? "bg-teal/10 text-teal" : "bg-sus-900/10 text-sus-900/60"}`}>
                    {v.ativo ? "Ativo" : "Inativo"}
                  </span>
                </div>
                <p className="mt-2.5 font-bold text-sus-950 flex items-center gap-1.5">
                  <Car className="h-4 w-4 text-slate-400" />
                  {v.modelo || "Sem modelo informado"}
                </p>
                <p className="mt-1 text-xs text-ink/65 capitalize">
                  {v.tipo === "amb" ? "Ambulância" : v.tipo} · {v.capacidade} lugares · {v.status === "manutencao" ? "Em manutenção" : "Disponível para viagem"}
                </p>
                {v.status === "manutencao" && (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/80 p-2.5 text-xs text-amber-900 space-y-1">
                    <div className="flex items-center justify-between font-semibold">
                      <span className="flex items-center gap-1 text-amber-800">
                        <Wrench className="h-3.5 w-3.5" /> Detalhes da Manutenção
                      </span>
                      {v.manutencao_indefinida ? (
                        <span className="rounded-md bg-amber-200/90 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
                          Prazo Indefinido
                        </span>
                      ) : v.manutencao_previsao_retorno ? (
                        <span className="text-[11px] font-medium text-amber-800">
                          Retorno: {formatarDataBR(v.manutencao_previsao_retorno)}
                        </span>
                      ) : null}
                    </div>
                    {v.manutencao_data_entrada && (
                      <p className="text-[11px] text-amber-800/80">
                        Entrada: {formatarDataBR(v.manutencao_data_entrada)}
                      </p>
                    )}
                    {v.manutencao_motivo && (
                      <p className="text-[11px] text-amber-950 font-medium line-clamp-2">
                        {v.manutencao_motivo}
                      </p>
                    )}
                  </div>
                )}
                <div className="mt-4 flex items-center justify-between gap-1 border-t border-slate-100 pt-3">
                  <button
                    type="button"
                    onClick={() => abrirModalManutencao(v)}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                      v.status === "manutencao"
                        ? "bg-amber-100 text-amber-800 hover:bg-amber-200 shadow-sm"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                    title="Gerenciar manutenção deste veículo"
                  >
                    <Wrench className="h-3.5 w-3.5" />
                    Manutenção
                  </button>
                  <div className="flex items-center gap-1">
                    {!v.ativo && (
                      <button
                        type="button"
                        onClick={async () => {
                          await tfdAtualizarVeiculo(v.id, { ...v, ativo: true });
                          await carregar(page);
                          setOk(`Veículo ${v.placa} reativado com sucesso.`);
                        }}
                        className="rounded-lg bg-teal/10 px-2.5 py-1 text-xs font-bold text-teal hover:bg-teal/20 transition"
                        title="Reativar veículo"
                      >
                        Reativar
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => abrirModal(v.id)}
                      className="rounded-lg p-2 text-sus-800 hover:bg-sus-100 transition"
                      title="Editar veículo"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removerVeiculo(v)}
                      className="rounded-lg p-2 text-red-600 hover:bg-red-50 transition"
                      title="Excluir/Inativar veículo"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </Card>
            ))}
            {carregando && (
              <p className="col-span-full py-8 text-center text-sm text-ink/45">Carregando frota…</p>
            )}
            {!carregando && veiculosExibicao.length === 0 && (
              <p className="col-span-full py-8 text-center text-sm text-ink/45">
                Nenhum veículo encontrado com os filtros selecionados.
              </p>
            )}
          </div>

          <div className="mt-4 overflow-hidden rounded-2xl border border-sus-900/10 bg-white">
            <Paginacao
              page={page}
              pages={pages}
              total={total}
              pageSize={pageSize}
              onPageSize={(sz) => {
                setPageSize(sz);
                carregar(1, q, filtroStatus, sz).catch(() => setErro("Falha ao carregar frota."));
              }}
              onPage={(p) => carregar(p, q, filtroStatus, pageSize).catch(() => setErro("Falha ao carregar frota."))}
            />
          </div>
        </>
      )}

      {aba === "relatorio" && (
        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex flex-wrap items-end gap-2">
              <div><Label>De</Label><Input type="date" value={relDe} onChange={(e) => setRelDe(e.target.value)} /></div>
              <div><Label>Até</Label><Input type="date" value={relAte} onChange={(e) => setRelAte(e.target.value)} /></div>
              <Button onClick={carregarRelatorio} className="!w-auto"><ChartColumn className="h-4 w-4" /> {relLoading ? "Gerando…" : "Gerar relatório"}</Button>
            </div>
            {relErro && <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{relErro}</p>}
          </Card>
          {rel && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ["Viagens no período", String(rel.total_viagens)],
                  ["Agendadas", String(rel.por_status.agendada ?? 0)],
                  ["Concluídas", String(rel.por_status.concluida ?? 0)],
                  ["Km rodados", `${rel.km_total} km`],
                  ["Ocupação média", `${Math.round(rel.ocupacao_media * 100)}%`],
                  ["Veículo mais usado", rel.mais_usado_veiculo ? `${rel.mais_usado_veiculo.placa} (${rel.mais_usado_veiculo.viagens})` : "—"],
                  ["Motorista mais usado", rel.mais_usado_motorista ? `${rel.mais_usado_motorista.motorista} (${rel.mais_usado_motorista.viagens})` : "—"],
                ].map(([k, v]) => (
                  <Card key={k} className="p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/50">{k}</p>
                    <p className="font-display text-lg font-extrabold text-sus-950">{v}</p>
                  </Card>
                ))}
              </div>
              <Card className="overflow-hidden">
                <p className="border-b border-sus-900/10 bg-sand px-4 py-3 font-display text-sm font-bold text-sus-950">Viagens por veículo</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead><tr className="border-b border-sus-900/10 text-xs uppercase text-sus-900/60">
                      <th className="px-4 py-3">Veículo</th><th className="px-4 py-3">Modelo</th>
                      <th className="px-4 py-3">Viagens</th><th className="px-4 py-3">Km</th><th className="px-4 py-3">Ocupação média</th>
                    </tr></thead>
                    <tbody>
                      {rel.por_veiculo.map((v) => (
                        <tr key={`${v.veiculo_id}-${v.placa}`} className="border-b border-sus-900/5 last:border-0">
                          <td className="px-4 py-2.5 font-mono font-bold">{v.placa}</td>
                          <td className="px-4 py-2.5">{v.modelo || "—"}</td>
                          <td className="px-4 py-2.5">{v.viagens}</td>
                          <td className="px-4 py-2.5">{v.km} km</td>
                          <td className="px-4 py-2.5">{Math.round(v.ocupacao_media * 100)}%</td>
                        </tr>
                      ))}
                      {rel.por_veiculo.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-ink/45">Sem viagens no período.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </Card>
              <Card className="overflow-hidden">
                <p className="border-b border-sus-900/10 bg-sand px-4 py-3 font-display text-sm font-bold text-sus-950">Viagens por motorista</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead><tr className="border-b border-sus-900/10 text-xs uppercase text-sus-900/60">
                      <th className="px-4 py-3">Motorista</th><th className="px-4 py-3">Viagens</th><th className="px-4 py-3">Km</th>
                    </tr></thead>
                    <tbody>
                      {rel.por_motorista.map((m) => (
                        <tr key={m.motorista} className="border-b border-sus-900/5 last:border-0">
                          <td className="px-4 py-2.5 font-semibold">{m.motorista}</td>
                          <td className="px-4 py-2.5">{m.viagens}</td>
                          <td className="px-4 py-2.5">{m.km} km</td>
                        </tr>
                      ))}
                      {rel.por_motorista.length === 0 && <tr><td colSpan={3} className="px-4 py-6 text-center text-ink/45">Sem viagens no período.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4" onClick={fecharModal}>
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-card"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA") {
                e.preventDefault();
              }
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <p className="font-display text-base font-bold text-sus-950">{editId ? "Editar veículo" : "Novo veículo"}</p>
              <button onClick={fecharModal} className="rounded-lg p-2 text-ink/50 hover:bg-sand"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-5">
                <div><Label>Placa *</Label><Input value={form.placa} onChange={(e) => setForm({ ...form, placa: e.target.value.toUpperCase() })} placeholder="ABC1D23" /></div>
                <div className="md:col-span-2"><Label>Modelo</Label><Input value={form.modelo} onChange={(e) => setForm({ ...form, modelo: e.target.value })} placeholder="Ex: Spin 1.8" /></div>
                <div><Label>Capacidade</Label><Input type="number" min={1} max={60} value={form.capacidade} onChange={(e) => setForm({ ...form, capacidade: e.target.value })} /></div>
                <div>
                  <Label>Status</Label>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
                    <option value="disponivel">Disponível</option>
                    <option value="manutencao">Em manutenção</option>
                  </select>
                </div>
                <div>
                  <Label>Tipo</Label>
                  <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })} className="w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2.5 text-sm">
                    <option value="carro">carro</option>
                    <option value="van">van</option>
                    <option value="micro">micro</option>
                    <option value="amb">ambulância</option>
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} className="h-4 w-4 accent-teal" /> Ativo
                </label>
              </div>
              {erro && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
              <Button onClick={salvar} className="w-full"><Plus className="h-4 w-4" />{editId ? "Atualizar" : "Cadastrar veículo"}</Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Gestão Individual de Manutenção */}
      {modalManutencao && veiculoManutencao && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-sus-950/50 p-4"
          onClick={() => !manutSalvando && setModalManutencao(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-card"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA") {
                e.preventDefault();
              }
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="rounded-xl bg-amber-100 p-2 text-amber-800">
                  <Wrench className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-display text-base font-bold text-sus-950">
                    {veiculoManutencao.status === "manutencao"
                      ? "Gerenciar Manutenção"
                      : "Colocar Veículo em Manutenção"}
                  </h3>
                  <p className="text-xs text-ink/65">
                    Veículo <span className="font-mono font-bold text-sus-950">{veiculoManutencao.placa}</span> · {veiculoManutencao.modelo || "Sem modelo informado"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModalManutencao(false)}
                disabled={manutSalvando}
                className="rounded-lg p-2 text-ink/50 hover:bg-slate-100 transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {erro && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{erro}</p>}

            <div className="space-y-4">
              <div>
                <Label>Data de entrada na manutenção *</Label>
                <Input
                  type="date"
                  value={formManut.data_entrada}
                  onChange={(e) => setFormManut({ ...formManut, data_entrada: e.target.value })}
                  className="mt-1"
                />
              </div>

              <div>
                <Label>Motivo da manutenção *</Label>
                <textarea
                  value={formManut.motivo}
                  onChange={(e) => setFormManut({ ...formManut, motivo: e.target.value })}
                  placeholder="Descreva o motivo da manutenção (ex: revisão preventiva, troca de pastilhas de freio, conserto de suspensão, problemas elétricos)..."
                  rows={3}
                  className="mt-1 w-full rounded-xl border border-sus-900/15 bg-white px-3 py-2 text-sm text-sus-950 outline-none transition focus:border-sus-900 focus:ring-2 focus:ring-sus-900/15"
                />
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 space-y-2.5">
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={formManut.indefinida}
                    onChange={(e) => setFormManut({ ...formManut, indefinida: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 text-sus-900 focus:ring-sus-900"
                  />
                  <span className="text-xs font-semibold text-slate-800">
                    Manutenção por tempo indeterminado / indefinida
                  </span>
                </label>

                {formManut.indefinida ? (
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    O veículo permanecerá marcado como em manutenção e bloqueado para viagens até que a manutenção seja liberada manualmente.
                  </p>
                ) : (
                  <div>
                    <Label className="text-xs">Previsão de retorno</Label>
                    <Input
                      type="date"
                      min={formManut.data_entrada || undefined}
                      value={formManut.previsao_retorno}
                      onChange={(e) => setFormManut({ ...formManut, previsao_retorno: e.target.value })}
                      className="mt-1 bg-white"
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4">
              {veiculoManutencao.status === "manutencao" ? (
                <button
                  type="button"
                  disabled={manutSalvando}
                  onClick={confirmarLiberarVeiculo}
                  className="rounded-xl border border-teal/30 bg-teal/10 px-4 py-2 text-xs font-bold text-teal hover:bg-teal/20 transition disabled:opacity-50"
                >
                  Concluir Manutenção (Liberar Veículo)
                </button>
              ) : (
                <div />
              )}

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => setModalManutencao(false)}
                  disabled={manutSalvando}
                  className="!w-auto"
                >
                  Cancelar
                </Button>
                <Button
                  onClick={() => salvarManutencao(true)}
                  disabled={manutSalvando}
                  className="!w-auto"
                >
                  {manutSalvando
                    ? "Salvando…"
                    : veiculoManutencao.status === "manutencao"
                    ? "Salvar Alterações"
                    : "Confirmar Manutenção"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}