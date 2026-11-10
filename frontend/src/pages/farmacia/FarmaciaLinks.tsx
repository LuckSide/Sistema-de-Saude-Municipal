import { useEffect, useState } from "react";
import {
  Link as LinkIcon,
  Tv,
  Smartphone,
  Plus,
  Copy,
  ExternalLink,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  X,
  Eye,
  ShieldCheck,
  EyeOff,
  Clock,
  Layers,
} from "lucide-react";
import {
  farmaciaLinksListar,
  farmaciaLinkCriar,
  farmaciaLinkRevogar,
  farmaciaMedicamentosListar,
  type FarmaciaLinkPublicoOut,
  type FarmaciaLinkPublicoCriar,
  type MedicamentoOut,
} from "../../services/api";
import { Button, Card, Input, Label } from "../../components/ui/primitives";

const CATEGORIAS_PADRAO = [
  "Básico / Atenção Primária",
  "Hipertensão / Diabetes",
  "Antibióticos",
  "Saúde Mental / Psicotrópicos",
  "Controlado / Portaria 344",
  "Analgésicos & Anti-inflamatórios",
  "Saúde da Mulher",
  "Pediatria",
  "Urgência & Emergência",
];

export default function FarmaciaLinks() {
  const [links, setLinks] = useState<FarmaciaLinkPublicoOut[]>([]);
  const [todosMedicamentos, setTodosMedicamentos] = useState<MedicamentoOut[]>([]);
  const [carregando, setCarregando] = useState(true);

  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState("");
  const [copiadoId, setCopiadoId] = useState<number | null>(null);

  // Modal de Criação
  const [modalAberto, setModalAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [termoBuscaMed, setTermoBuscaMed] = useState("");

  const [form, setForm] = useState<FarmaciaLinkPublicoCriar>({
    titulo: "Painel Farmácia Central",
    tipo_perfil: "paciente",
    mostrar_quantidade: false,
    filtro_tipo: "todos",
    categoria_filtro: "",
    medicamentos_ids: [],
    tempo_atualizacao_segundos: 30,
    mensagem_rodape: "Secretaria Municipal de Saúde · Horário: 07h às 17h. Traga Cartão SUS e Receita Médica.",
  });

  async function carregarDados() {
    setCarregando(true);
    setErro("");
    try {
      const [listaLinks, listaMeds] = await Promise.all([
        farmaciaLinksListar(),
        farmaciaMedicamentosListar({ somente_ativos: true }),
      ]);
      setLinks(listaLinks);
      setTodosMedicamentos(listaMeds);
    } catch {
      setErro("Falha ao carregar painéis e links públicos.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregarDados();
  }, []);

  // Copiar link para o clipboard
  async function copiarLink(link: FarmaciaLinkPublicoOut) {
    const urlCompleta = `${window.location.origin}/farmacia/publico/${link.token}`;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(urlCompleta);
      } else {
        const input = document.createElement("input");
        input.value = urlCompleta;
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        document.body.removeChild(input);
      }
      setCopiadoId(link.id);
      setSucesso(`Link "${link.titulo}" copiado para a área de transferência!`);
      setTimeout(() => setCopiadoId(null), 3000);
      setTimeout(() => setSucesso(""), 4000);
    } catch {
      setErro("Não foi possível copiar o link automaticamente. Selecione-o manualmente.");
    }
  }

  // Revogar link
  async function revogarLink(id: number, titulo: string) {
    if (!window.confirm(`Deseja realmente revogar e desativar o link "${titulo}"? Ninguém mais conseguirá acessá-lo.`)) {
      return;
    }

    try {
      await farmaciaLinkRevogar(id);
      setSucesso(`Painel "${titulo}" revogado com sucesso!`);
      setTimeout(() => setSucesso(""), 4000);
      carregarDados();
    } catch {
      setErro("Erro ao revogar link público.");
    }
  }

  // Submeter novo link
  async function submeterCriacao(e: React.FormEvent) {
    e.preventDefault();
    if (!form.titulo?.trim()) {
      setErro("Informe o título do painel/link.");
      return;
    }
    if (form.filtro_tipo === "categoria" && !form.categoria_filtro) {
      setErro("Selecione a categoria para filtrar.");
      return;
    }
    if (form.filtro_tipo === "especificos" && (!form.medicamentos_ids || form.medicamentos_ids.length === 0)) {
      setErro("Selecione pelo menos um medicamento para o painel específico.");
      return;
    }

    setSalvando(true);
    setErro("");
    try {
      await farmaciaLinkCriar(form);
      setSucesso("Novo painel/link público gerado com sucesso!");
      setTimeout(() => setSucesso(""), 4000);
      setModalAberto(false);
      // Reset form
      setForm({
        titulo: "Painel Farmácia Central",
        tipo_perfil: "paciente",
        mostrar_quantidade: false,
        filtro_tipo: "todos",
        categoria_filtro: "",
        medicamentos_ids: [],
        tempo_atualizacao_segundos: 30,
        mensagem_rodape: "Secretaria Municipal de Saúde · Horário: 07h às 17h. Traga Cartão SUS e Receita Médica.",
      });
      carregarDados();
    } catch (err: unknown) {
      const axErr = err as { response?: { data?: { detail?: string } } };
      setErro(axErr.response?.data?.detail || "Erro ao criar link público.");
    } finally {
      setSalvando(false);
    }
  }

  // Toggle med na seleção específica
  function toggleMedicamento(id: number) {
    const atuais = form.medicamentos_ids || [];
    if (atuais.includes(id)) {
      setForm({ ...form, medicamentos_ids: atuais.filter((m) => m !== id) });
    } else {
      setForm({ ...form, medicamentos_ids: [...atuais, id] });
    }
  }

  // Métricas
  const totalAtivos = links.filter((l) => l.ativo).length;
  const totalTV = links.filter((l) => l.tipo_perfil === "tv").length;
  const totalPaciente = links.filter((l) => l.tipo_perfil === "paciente").length;
  const totalAcessos = links.reduce((acc, l) => acc + (l.visualizacoes_count || 0), 0);

  // Filtro de remédios para o modal
  const medsFiltradosModal = todosMedicamentos.filter((m) => {
    if (!termoBuscaMed.trim()) return true;
    const t = termoBuscaMed.toLowerCase();
    return (
      m.nome.toLowerCase().includes(t) ||
      (m.principio_ativo || "").toLowerCase().includes(t) ||
      m.codigo.toLowerCase().includes(t)
    );
  });

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/10 text-teal">
            <LinkIcon className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-sus-900">Painéis de Consulta & Links Públicos</h1>
            <p className="text-sm text-sus-900/60">
              Gere links externos seguros para TVs em salas de espera ou consulta direta pelo cidadão
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={carregarDados}
            disabled={carregando}
            className="flex items-center gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${carregando ? "animate-spin" : ""}`} />
            Atualizar
          </Button>

          <Button
            onClick={() => setModalAberto(true)}
            className="flex items-center gap-2 bg-teal hover:bg-teal-700 text-white"
          >
            <Plus className="h-4 w-4" />
            Novo Link / Painel
          </Button>
        </div>
      </div>

      {/* Alertas */}
      {erro && (
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <AlertTriangle className="h-5 w-5 shrink-0 text-red-600" />
          <div className="flex-1 font-medium">{erro}</div>
          <button onClick={() => setErro("")} className="text-red-600 hover:text-red-800">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {sucesso && (
        <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
          <div className="flex-1 font-medium">{sucesso}</div>
          <button onClick={() => setSucesso("")} className="text-emerald-600 hover:text-emerald-800">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Cards Informativos / Métricas */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-5 border border-sus-100">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-sus-900/60">
              Painéis Ativos
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-50 text-teal">
              <LinkIcon className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-3xl font-extrabold text-sus-900">{totalAtivos}</div>
          <p className="mt-1 text-xs text-sus-900/50">Links tokenizados disponíveis</p>
        </Card>

        <Card className="p-5 border border-indigo-100 bg-indigo-50/20">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-800">
              Modo TV (Sala de Espera)
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
              <Tv className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-3xl font-extrabold text-indigo-900">{totalTV}</div>
          <p className="mt-1 text-xs text-indigo-700">Painéis de alta visibilidade</p>
        </Card>

        <Card className="p-5 border border-sky-100 bg-sky-50/20">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-sky-800">
              Modo Cidadão (Mobile)
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
              <Smartphone className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-3xl font-extrabold text-sky-900">{totalPaciente}</div>
          <p className="mt-1 text-xs text-sky-700">Apenas status (quantidades ocultas)</p>
        </Card>

        <Card className="p-5 border border-emerald-100 bg-emerald-50/20">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">
              Total de Consultas
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
              <Eye className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-3xl font-extrabold text-emerald-900">{totalAcessos}</div>
          <p className="mt-1 text-xs text-emerald-700">Visualizações somadas</p>
        </Card>
      </div>

      {/* Lista de Links */}
      <Card className="overflow-hidden">
        <div className="border-b border-sus-100 bg-sus-50/60 p-4">
          <h2 className="text-base font-bold text-sus-900">Links Públicos Cadastrados</h2>
          <p className="text-xs text-sus-900/60">
            Cada link possui um token criptográfico único. Copie a URL para fixar em QR Code ou abrir na TV.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-sus-900">
            <thead className="border-b border-sus-100 bg-sus-50/40 text-xs font-bold uppercase tracking-wider text-sus-900/60">
              <tr>
                <th className="px-4 py-3.5">Título do Painel</th>
                <th className="px-4 py-3.5">Modo de Exibição</th>
                <th className="px-4 py-3.5">Exibição de Estoque</th>
                <th className="px-4 py-3.5">Filtro Aplicado</th>
                <th className="px-4 py-3.5 text-center">Atualização</th>
                <th className="px-4 py-3.5 text-center">Acessos</th>
                <th className="px-4 py-3.5 text-center">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sus-100">
              {carregando ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-sus-900/50">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <RefreshCw className="h-6 w-6 animate-spin text-teal" />
                      <span>Carregando painéis…</span>
                    </div>
                  </td>
                </tr>
              ) : links.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-sus-900/50">
                    Nenhum link público criado ainda. Clique em "+ Novo Link / Painel" para gerar o primeiro.
                  </td>
                </tr>
              ) : (
                links.map((link) => {
                  const isTV = link.tipo_perfil === "tv";
                  const isCopiado = copiadoId === link.id;

                  return (
                    <tr key={link.id} className="hover:bg-sus-50/40 transition-colors">
                      {/* Título e Token */}
                      <td className="px-4 py-3">
                        <div className="font-semibold text-sus-900">{link.titulo}</div>
                        <div className="flex items-center gap-1.5 text-xs text-sus-900/50 mt-0.5">
                          <span className="font-mono bg-sus-100/70 px-1 rounded text-[10px]">
                            {link.token}
                          </span>
                          <span>· Criado por {link.created_by}</span>
                        </div>
                      </td>

                      {/* Modo */}
                      <td className="px-4 py-3">
                        {isTV ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-semibold text-indigo-800">
                            <Tv className="h-3.5 w-3.5 text-indigo-700" />
                            Modo TV (Painel)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-100 px-2.5 py-1 text-xs font-semibold text-sky-800">
                            <Smartphone className="h-3.5 w-3.5 text-sky-700" />
                            Modo Paciente
                          </span>
                        )}
                      </td>

                      {/* Exibição de Estoque */}
                      <td className="px-4 py-3 text-xs">
                        {isTV ? (
                          link.mostrar_quantidade ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                              <Eye className="h-3.5 w-3.5" />
                              Quantidades Visíveis
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-sus-900/60 font-medium">
                              <EyeOff className="h-3.5 w-3.5" />
                              Apenas Disponibilidade
                            </span>
                          )
                        ) : (
                          <span className="inline-flex items-center gap-1 text-sus-900/70 font-medium">
                            <ShieldCheck className="h-3.5 w-3.5 text-teal" />
                            Oculta (Apenas Status)
                          </span>
                        )}
                      </td>

                      {/* Filtro Aplicado */}
                      <td className="px-4 py-3 text-xs">
                        {link.filtro_tipo === "todos" && (
                          <span className="rounded bg-sus-100 px-2 py-0.5 text-sus-900/70">
                            Todos os Medicamentos
                          </span>
                        )}
                        {link.filtro_tipo === "categoria" && (
                          <span className="rounded bg-amber-100 text-amber-800 px-2 py-0.5 font-medium">
                            Categoria: {link.categoria_filtro}
                          </span>
                        )}
                        {link.filtro_tipo === "especificos" && (
                          <span className="rounded bg-teal-100 text-teal-800 px-2 py-0.5 font-medium">
                            {link.medicamentos_ids?.length || 0} medicamento(s) selecionado(s)
                          </span>
                        )}
                      </td>

                      {/* Atualização */}
                      <td className="px-4 py-3 text-center text-xs">
                        <div className="flex items-center justify-center gap-1 text-sus-900/70">
                          <Clock className="h-3.5 w-3.5 text-sus-900/40" />
                          <span>{link.tempo_atualizacao_segundos}s</span>
                        </div>
                      </td>

                      {/* Acessos */}
                      <td className="px-4 py-3 text-center text-xs font-semibold text-sus-900">
                        {link.visualizacoes_count || 0}
                      </td>

                      {/* Ações */}
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {/* Copiar Link */}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => copiarLink(link)}
                            className={`flex items-center gap-1 text-xs py-1 px-2.5 ${
                              isCopiado
                                ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                                : "text-sus-900/80"
                            }`}
                            title="Copiar URL pública tokenizada"
                          >
                            {isCopiado ? (
                              <>
                                <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                                Copiado!
                              </>
                            ) : (
                              <>
                                <Copy className="h-3 w-3" />
                                Copiar Link
                              </>
                            )}
                          </Button>

                          {/* Abrir Link em Nova Aba */}
                          <a
                            href={`/farmacia/publico/${link.token}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-lg border border-sus-200 bg-white px-2.5 py-1 text-xs font-medium text-sus-900 hover:bg-sus-50 hover:text-teal"
                            title="Abrir painel público em nova aba"
                          >
                            <ExternalLink className="h-3 w-3" />
                            Abrir
                          </a>

                          {/* Revogar */}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => revogarLink(link.id, link.titulo)}
                            className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1.5"
                            title="Revogar e inativar este link público"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Modal de Criação de Link / Painel Público */}
      {modalAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 shadow-xl animate-in fade-in-50">
            <div className="flex items-center justify-between border-b border-sus-100 pb-3">
              <div className="flex items-center gap-2 text-sus-900">
                <LinkIcon className="h-5 w-5 text-teal" />
                <h3 className="text-lg font-bold">Gerar Novo Painel / Link Público</h3>
              </div>
              <button
                onClick={() => setModalAberto(false)}
                className="text-sus-900/40 hover:text-sus-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={submeterCriacao} className="mt-4 space-y-4">
              {/* Título */}
              <div>
                <Label htmlFor="link_titulo">Título de Identificação do Painel</Label>
                <Input
                  id="link_titulo"
                  type="text"
                  value={form.titulo}
                  onChange={(e) => setForm({ ...form, titulo: e.target.value })}
                  placeholder="Ex: Painel Farmácia Central - Recepção"
                  required
                />
              </div>

              {/* Modo de Exibição: Perfil */}
              <div>
                <Label>Modo de Exibição / Finalidade</Label>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 mt-1.5">
                  {/* Modo Paciente */}
                  <div
                    onClick={() => setForm({ ...form, tipo_perfil: "paciente", mostrar_quantidade: false })}
                    className={`cursor-pointer rounded-xl border-2 p-3.5 transition-all ${
                      form.tipo_perfil === "paciente"
                        ? "border-sky-500 bg-sky-50/50 shadow-sm"
                        : "border-sus-200 hover:border-sus-300"
                    }`}
                  >
                    <div className="flex items-center gap-2 font-bold text-sky-900 text-sm">
                      <Smartphone className="h-4 w-4 text-sky-600" />
                      Modo Cidadão / Paciente
                    </div>
                    <p className="mt-1 text-xs text-sky-800/80 leading-relaxed">
                      Otimizado para celulares de cidadãos. Exibe <strong>apenas o status</strong> ("Disponível" / "Em Falta") e <strong>nunca revela quantidades numéricas</strong> em estoque por segurança.
                    </p>
                  </div>

                  {/* Modo TV */}
                  <div
                    onClick={() => setForm({ ...form, tipo_perfil: "tv" })}
                    className={`cursor-pointer rounded-xl border-2 p-3.5 transition-all ${
                      form.tipo_perfil === "tv"
                        ? "border-indigo-500 bg-indigo-50/50 shadow-sm"
                        : "border-sus-200 hover:border-sus-300"
                    }`}
                  >
                    <div className="flex items-center gap-2 font-bold text-indigo-900 text-sm">
                      <Tv className="h-4 w-4 text-indigo-600" />
                      Modo TV (Sala de Espera)
                    </div>
                    <p className="mt-1 text-xs text-indigo-800/80 leading-relaxed">
                      Dashboard em alta resolução para TVs e totens na recepção. Possui relógio dinâmico, atualização ao vivo e opção de tela cheia.
                    </p>
                  </div>
                </div>
              </div>

              {/* Se Modo TV: Switch para mostrar quantidade */}
              {form.tipo_perfil === "tv" && (
                <div className="rounded-lg border border-indigo-200 bg-indigo-50/30 p-3.5">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.mostrar_quantidade}
                      onChange={(e) => setForm({ ...form, mostrar_quantidade: e.target.checked })}
                      className="h-4 w-4 rounded border-indigo-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div>
                      <span className="text-sm font-semibold text-indigo-950">
                        Exibir quantidade numérica em estoque na TV
                      </span>
                      <p className="text-xs text-indigo-800/70">
                        Se desmarcado, a TV exibirá apenas badges de "Disponível" ou "Em Falta", ocultando números.
                      </p>
                    </div>
                  </label>
                </div>
              )}

              {/* Filtro de Medicamentos */}
              <div>
                <Label>Quais medicamentos devem constar no painel?</Label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 mt-1.5">
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, filtro_tipo: "todos" })}
                    className={`rounded-lg border p-2.5 text-xs font-semibold transition-all ${
                      form.filtro_tipo === "todos"
                        ? "border-teal bg-teal-50 text-teal-900"
                        : "border-sus-200 bg-white text-sus-900/70 hover:bg-sus-50"
                    }`}
                  >
                    Todos os Medicamentos
                  </button>

                  <button
                    type="button"
                    onClick={() => setForm({ ...form, filtro_tipo: "categoria" })}
                    className={`rounded-lg border p-2.5 text-xs font-semibold transition-all ${
                      form.filtro_tipo === "categoria"
                        ? "border-teal bg-teal-50 text-teal-900"
                        : "border-sus-200 bg-white text-sus-900/70 hover:bg-sus-50"
                    }`}
                  >
                    Filtrar por Categoria
                  </button>

                  <button
                    type="button"
                    onClick={() => setForm({ ...form, filtro_tipo: "especificos" })}
                    className={`rounded-lg border p-2.5 text-xs font-semibold transition-all ${
                      form.filtro_tipo === "especificos"
                        ? "border-teal bg-teal-50 text-teal-900"
                        : "border-sus-200 bg-white text-sus-900/70 hover:bg-sus-50"
                    }`}
                  >
                    Medicamentos Específicos
                  </button>
                </div>
              </div>

              {/* Seletor de Categoria se filtro === 'categoria' */}
              {form.filtro_tipo === "categoria" && (
                <div>
                  <Label htmlFor="cat_filtro">Selecione a Categoria</Label>
                  <select
                    id="cat_filtro"
                    value={form.categoria_filtro}
                    onChange={(e) => setForm({ ...form, categoria_filtro: e.target.value })}
                    className="w-full rounded-lg border border-sus-200 bg-white px-3 py-2 text-sm text-sus-900 focus:border-teal focus:outline-none"
                    required
                  >
                    <option value="">Selecione…</option>
                    {CATEGORIAS_PADRAO.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Seletor Múltiplo se filtro === 'especificos' */}
              {form.filtro_tipo === "especificos" && (
                <div className="space-y-2 rounded-lg border border-sus-200 bg-sus-50/50 p-3">
                  <div className="flex items-center justify-between">
                    <Label>Selecione os medicamentos permitidos:</Label>
                    <span className="text-xs font-semibold text-teal">
                      {form.medicamentos_ids?.length || 0} selecionado(s)
                    </span>
                  </div>

                  <input
                    type="text"
                    placeholder="Filtrar medicamentos da lista…"
                    value={termoBuscaMed}
                    onChange={(e) => setTermoBuscaMed(e.target.value)}
                    className="w-full rounded-lg border border-sus-200 bg-white px-3 py-1.5 text-xs text-sus-900 focus:border-teal focus:outline-none"
                  />

                  <div className="max-h-48 overflow-y-auto space-y-1 rounded border border-sus-200 bg-white p-2">
                    {medsFiltradosModal.length === 0 ? (
                      <div className="text-xs text-sus-900/50 text-center py-2">
                        Nenhum medicamento encontrado.
                      </div>
                    ) : (
                      medsFiltradosModal.map((med) => {
                        const checked = (form.medicamentos_ids || []).includes(med.id);
                        return (
                          <label
                            key={med.id}
                            className={`flex items-center justify-between rounded px-2 py-1.5 text-xs cursor-pointer transition-colors ${
                              checked ? "bg-teal-50 text-teal-950 font-medium" : "hover:bg-sus-50 text-sus-900"
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleMedicamento(med.id)}
                                className="h-3.5 w-3.5 rounded border-sus-300 text-teal focus:ring-teal"
                              />
                              <span>{med.nome}</span>
                              <span className="text-[10px] text-sus-900/40">({med.codigo})</span>
                            </div>
                            <span className="text-[10px] text-sus-900/50">{med.categoria}</span>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* Tempo de Atualização Automática */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="tempo_atualizacao">Atualização Automática na Tela</Label>
                  <select
                    id="tempo_atualizacao"
                    value={form.tempo_atualizacao_segundos}
                    onChange={(e) =>
                      setForm({ ...form, tempo_atualizacao_segundos: Number(e.target.value) })
                    }
                    className="w-full rounded-lg border border-sus-200 bg-white px-3 py-2 text-sm text-sus-900 focus:border-teal focus:outline-none"
                  >
                    <option value={15}>A cada 15 segundos</option>
                    <option value={30}>A cada 30 segundos (Recomendado)</option>
                    <option value={60}>A cada 1 minuto</option>
                    <option value={120}>A cada 2 minutos</option>
                  </select>
                </div>

                <div>
                  <Label htmlFor="msg_rodape">Mensagem Institucional do Rodapé</Label>
                  <Input
                    id="msg_rodape"
                    type="text"
                    value={form.mensagem_rodape}
                    onChange={(e) => setForm({ ...form, mensagem_rodape: e.target.value })}
                    placeholder="Instruções para o paciente..."
                  />
                </div>
              </div>

              {/* Ações */}
              <div className="flex justify-end gap-2 border-t border-sus-100 pt-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setModalAberto(false)}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={salvando}
                  className="bg-teal hover:bg-teal-700 text-white flex items-center gap-1.5"
                >
                  {salvando ? <RefreshCw className="h-4 w-4 animate-spin" /> : <LinkIcon className="h-4 w-4" />}
                  Gerar Link e Ativar Painel
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
