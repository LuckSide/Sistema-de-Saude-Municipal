import { useEffect, useState } from "react";
import {
  Building2,
  Plus,
  Search,
  Filter,
  Phone,
  Mail,
  MapPin,
  User,
  CheckCircle2,
  AlertTriangle,
  Edit2,
  Trash2,
  ShieldCheck,
  Package,
  Stethoscope,
  Wrench,
  Activity,
  FileCheck,
  ArrowRightLeft,
} from "lucide-react";
import {
  oxigenioEmpresas,
  oxigenioCriarEmpresa,
  oxigenioAtualizarEmpresa,
  oxigenioExcluirEmpresa,
  oxigenioMigrarEmpresa,
  type EmpresaOxigenio,
} from "../../services/api";
import { Button, Input, Label, Badge } from "../../components/ui/primitives";

const OPCOES_SERVICOS = [
  { id: "OXIGENIO_MEDICINAL", rotulo: "Oxigênio Medicinal (Cilindros)", icone: Package, cor: "bg-sky-100 text-sky-800 border-sky-300" },
  { id: "LOCACAO_CONCENTRADOR_5L", rotulo: "Locação Concentrador 5L", icone: Stethoscope, cor: "bg-indigo-100 text-indigo-800 border-indigo-300" },
  { id: "LOCACAO_CONCENTRADOR_10L", rotulo: "Locação Concentrador 10L", icone: Stethoscope, cor: "bg-blue-100 text-blue-800 border-blue-300" },
  { id: "LOCACAO_CPAP", rotulo: "Locação de CPAP", icone: Activity, cor: "bg-purple-100 text-purple-800 border-purple-300" },
  { id: "LOCACAO_BIPAP", rotulo: "Locação de BiPAP", icone: Activity, cor: "bg-violet-100 text-violet-800 border-violet-300" },
  { id: "MANUTENCAO", rotulo: "Assistência & Manutenção", icone: Wrench, cor: "bg-amber-100 text-amber-800 border-amber-300" },
  { id: "INSUMOS", rotulo: "Insumos & Circuitos", icone: ShieldCheck, cor: "bg-emerald-100 text-emerald-800 border-emerald-300" },
];

export default function OxigenioEmpresas() {
  const [empresas, setEmpresas] = useState<EmpresaOxigenio[]>([]);
  const [busca, setBusca] = useState("");
  const [filtroServico, setFiltroServico] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState("");

  // Modal Edição / Criação
  const [modalAberto, setModalAberto] = useState(false);
  const [empresaEdicao, setEmpresaEdicao] = useState<EmpresaOxigenio | null>(null);
  const [salvando, setSalvando] = useState(false);

  // Modal Migração Global de Empresa
  const [modalMigracaoAberto, setModalMigracaoAberto] = useState(false);
  const [empresaOrigemId, setEmpresaOrigemId] = useState<string>("");
  const [empresaDestinoId, setEmpresaDestinoId] = useState<string>("");
  const [transferirPacientes, setTransferirPacientes] = useState(true);
  const [transferirEquipamentos, setTransferirEquipamentos] = useState(true);
  const [obsMigracao, setObsMigracao] = useState("");
  const [migrando, setMigrando] = useState(false);

  const obterEscopoEmpresa = (servicos: string[] = []) => {
    const sList = Array.isArray(servicos) ? servicos : [];
    const temOxigenio = sList.includes("OXIGENIO_MEDICINAL") || sList.some((s) => s.toLowerCase().includes("oxigenio"));
    const temEquipamento = sList.some((s) =>
      ["LOCACAO_CONCENTRADOR", "LOCACAO_CONCENTRADOR_5L", "LOCACAO_CONCENTRADOR_10L", "LOCACAO_CPAP", "LOCACAO_BIPAP"].includes(s) ||
      s.toLowerCase().includes("locacao") ||
      s.toLowerCase().includes("concentrador")
    );
    if (temOxigenio && temEquipamento) {
      return { rotulo: "Escopo: Gases & Equipamentos", tipo: "AMBOS", cor: "bg-teal-50 text-teal-800 border-teal-200" };
    }
    if (temOxigenio) {
      return { rotulo: "Escopo: Exclusivo Oxigênio & Gases", tipo: "OXIGENIO", cor: "bg-sky-50 text-sky-800 border-sky-200" };
    }
    if (temEquipamento) {
      return { rotulo: "Escopo: Exclusivo Locação de Equipamentos", tipo: "EQUIPAMENTOS", cor: "bg-purple-50 text-purple-800 border-purple-200" };
    }
    return { rotulo: "Escopo: Serviços Diversos", tipo: "OUTROS", cor: "bg-slate-50 text-slate-700 border-slate-200" };
  };

  const [form, setForm] = useState({
    nome_fantasia: "",
    razao_social: "",
    cnpj: "",
    telefone: "",
    email: "",
    contato_responsavel: "",
    endereco: "",
    servicos: ["OXIGENIO_MEDICINAL"] as string[],
    valor_unitario_10m3: "",
    valor_unitario_3m3: "",
    valor_unitario_1m3: "",
    valor_recarga_m3: "",
    locacao_mensal_concentrador: "",
    locacao_mensal_concentrador_5l: "",
    locacao_mensal_concentrador_10l: "",
    locacao_mensal_cpap: "",
    locacao_mensal_bipap: "",
    locacao_mensal_cilindro: "",
    observacoes: "",
    ativo: true,
  });

  const handlePrecoChange = (campo: string, valorStr: string) => {
    // Permite apagar tudo (""), digitar números e vírgula/ponto, sem travar o "0"
    const limpo = valorStr.replace(/[^0-9.,]/g, "").replace(",", ".");
    setForm((prev) => ({ ...prev, [campo]: limpo }));
  };

  const carregarEmpresas = async () => {
    setCarregando(true);
    setErro("");
    try {
      const res = await oxigenioEmpresas({
        q: busca || undefined,
        servico: filtroServico || undefined,
      });
      setEmpresas(res);
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Erro ao carregar empresas fornecedoras");
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregarEmpresas();
  }, [filtroServico]);

  const abrirModalNova = () => {
    setEmpresaEdicao(null);
    setForm({
      nome_fantasia: "",
      razao_social: "",
      cnpj: "",
      telefone: "",
      email: "",
      contato_responsavel: "",
      endereco: "",
      servicos: ["OXIGENIO_MEDICINAL"],
      valor_unitario_10m3: "",
      valor_unitario_3m3: "",
      valor_unitario_1m3: "",
      valor_recarga_m3: "",
      locacao_mensal_concentrador: "",
      locacao_mensal_concentrador_5l: "",
      locacao_mensal_concentrador_10l: "",
      locacao_mensal_cpap: "",
      locacao_mensal_bipap: "",
      locacao_mensal_cilindro: "",
      observacoes: "",
      ativo: true,
    });
    setModalAberto(true);
  };

  const abrirModalEditar = (emp: EmpresaOxigenio) => {
    setEmpresaEdicao(emp);
    setForm({
      nome_fantasia: emp.nome_fantasia || emp.nome || "",
      razao_social: emp.razao_social || "",
      cnpj: emp.cnpj,
      telefone: emp.telefone || "",
      email: emp.email || "",
      contato_responsavel: emp.contato_responsavel || "",
      endereco: emp.endereco || "",
      servicos: Array.isArray(emp.servicos) ? emp.servicos : [],
      valor_unitario_10m3: emp.valor_unitario_10m3 != null && emp.valor_unitario_10m3 > 0 ? String(emp.valor_unitario_10m3) : "",
      valor_unitario_3m3: emp.valor_unitario_3m3 != null && emp.valor_unitario_3m3 > 0 ? String(emp.valor_unitario_3m3) : "",
      valor_unitario_1m3: emp.valor_unitario_1m3 != null && emp.valor_unitario_1m3 > 0 ? String(emp.valor_unitario_1m3) : "",
      valor_recarga_m3: emp.valor_recarga_m3 != null && emp.valor_recarga_m3 > 0 ? String(emp.valor_recarga_m3) : "",
      locacao_mensal_concentrador: emp.locacao_mensal_concentrador != null && emp.locacao_mensal_concentrador > 0 ? String(emp.locacao_mensal_concentrador) : "",
      locacao_mensal_concentrador_5l: emp.locacao_mensal_concentrador_5l != null && emp.locacao_mensal_concentrador_5l > 0 ? String(emp.locacao_mensal_concentrador_5l) : (emp.locacao_mensal_concentrador != null && emp.locacao_mensal_concentrador > 0 ? String(emp.locacao_mensal_concentrador) : ""),
      locacao_mensal_concentrador_10l: emp.locacao_mensal_concentrador_10l != null && emp.locacao_mensal_concentrador_10l > 0 ? String(emp.locacao_mensal_concentrador_10l) : "",
      locacao_mensal_cpap: (emp as any).locacao_mensap_cpap != null && (emp as any).locacao_mensap_cpap > 0 ? String((emp as any).locacao_mensap_cpap) : (emp.locacao_mensal_cpap != null && emp.locacao_mensal_cpap > 0 ? String(emp.locacao_mensal_cpap) : ""),
      locacao_mensal_bipap: emp.locacao_mensal_bipap != null && emp.locacao_mensal_bipap > 0 ? String(emp.locacao_mensal_bipap) : "",
      locacao_mensal_cilindro: emp.locacao_mensal_cilindro != null && emp.locacao_mensal_cilindro > 0 ? String(emp.locacao_mensal_cilindro) : "",
      observacoes: emp.observacoes || "",
      ativo: emp.ativo,
    });
    setModalAberto(true);
  };

  const toggleServico = (id: string) => {
    if (form.servicos.includes(id)) {
      setForm({ ...form, servicos: form.servicos.filter((s) => s !== id) });
    } else {
      setForm({ ...form, servicos: [...form.servicos, id] });
    }
  };

  const handleSalvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.razao_social || !form.cnpj) {
      setErro("Preencha ao menos a Razão Social e o CNPJ da empresa");
      return;
    }

    setSalvando(true);
    setErro("");
    const payload = {
      ...form,
      valor_unitario_10m3: parseFloat(form.valor_unitario_10m3) || 0,
      valor_unitario_3m3: parseFloat(form.valor_unitario_3m3) || 0,
      valor_unitario_1m3: parseFloat(form.valor_unitario_1m3) || 0,
      valor_recarga_m3: parseFloat(form.valor_recarga_m3) || 0,
      locacao_mensal_concentrador: parseFloat(form.locacao_mensal_concentrador_5l) || parseFloat(form.locacao_mensal_concentrador) || 0,
      locacao_mensal_concentrador_5l: parseFloat(form.locacao_mensal_concentrador_5l) || parseFloat(form.locacao_mensal_concentrador) || 0,
      locacao_mensal_concentrador_10l: parseFloat(form.locacao_mensal_concentrador_10l) || 0,
      locacao_mensal_cpap: parseFloat(form.locacao_mensal_cpap) || 0,
      locacao_mensal_bipap: parseFloat(form.locacao_mensal_bipap) || 0,
      locacao_mensal_cilindro: parseFloat(form.locacao_mensal_cilindro) || 0,
    };

    try {
      if (empresaEdicao) {
        await oxigenioAtualizarEmpresa(empresaEdicao.id, payload as any);
        setSucesso("Empresa fornecedora atualizada com sucesso!");
      } else {
        await oxigenioCriarEmpresa(payload as any);
        setSucesso("Empresa cadastrada com sucesso!");
      }
      setModalAberto(false);
      carregarEmpresas();
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Erro ao salvar empresa");
    } finally {
      setSalvando(false);
    }
  };

  const handleExcluir = async (id: number) => {
    if (!window.confirm("Deseja realmente excluir esta empresa do cadastro?")) return;
    try {
      await oxigenioExcluirEmpresa(id);
      setSucesso("Empresa removida com sucesso!");
      carregarEmpresas();
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Erro ao remover empresa");
    }
  };

  const abrirModalMigracao = (origemId?: number) => {
    setEmpresaOrigemId(origemId ? String(origemId) : "");
    const primeiraDestino = empresas.find((e) => e.ativo && e.id !== origemId);
    setEmpresaDestinoId(primeiraDestino ? String(primeiraDestino.id) : "");
    setTransferirPacientes(true);
    setTransferirEquipamentos(true);
    setObsMigracao("");
    setModalMigracaoAberto(true);
  };

  const handleSalvarMigracao = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!empresaOrigemId || !empresaDestinoId) {
      setErro("Selecione a empresa fornecedora de origem e a nova empresa de destino.");
      return;
    }
    if (empresaOrigemId === empresaDestinoId) {
      setErro("A empresa de origem e destino devem ser diferentes.");
      return;
    }

    setMigrando(true);
    setErro("");
    try {
      const res = await oxigenioMigrarEmpresa({
        empresa_origem_id: Number(empresaOrigemId),
        empresa_destino_id: Number(empresaDestinoId),
        transferir_pacientes: transferirPacientes,
        transferir_equipamentos: transferirEquipamentos,
        observacoes: obsMigracao,
      });
      setSucesso(res.mensagem || "Migração global realizada com sucesso!");
      setModalMigracaoAberto(false);
      carregarEmpresas();
    } catch (e: any) {
      setErro(e?.response?.data?.detail || "Erro ao realizar migração de empresa.");
    } finally {
      setMigrando(false);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Cabeçalho da Página */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-teal/10 text-teal">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <h1 className="font-display text-xl md:text-2xl font-bold text-sus-950">
              Empresas & Fornecedores
            </h1>
            <p className="text-xs text-ink/60 mt-0.5">
              Cadastro e controle de empresas credenciadas para fornecimento de gases e locação de equipamentos
            </p>
          </div>
        </div>
      </div>

      {erro && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl flex items-center justify-between text-sm shadow-sm">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
            <span>{erro}</span>
          </div>
          <button onClick={() => setErro("")} className="text-rose-500 hover:text-rose-700 font-bold">×</button>
        </div>
      )}

      {sucesso && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl flex items-center justify-between text-sm shadow-sm">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span>{sucesso}</span>
          </div>
          <button onClick={() => setSucesso("")} className="text-emerald-500 hover:text-emerald-700 font-bold">×</button>
        </div>
      )}

      {/* BARRA DE FILTRO E AÇÕES */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="relative min-w-[240px]">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <Input
              placeholder="Buscar por nome, razão social ou CNPJ..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="pl-9 text-xs"
            />
          </div>

          <select
            value={filtroServico}
            onChange={(e) => setFiltroServico(e.target.value)}
            className="px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white"
          >
            <option value="">Todos os Serviços Prestados</option>
            {OPCOES_SERVICOS.map((serv) => (
              <option key={serv.id} value={serv.id}>
                {serv.rotulo}
              </option>
            ))}
          </select>

          <Button
            variant="outline"
            size="sm"
            onClick={carregarEmpresas}
            className="text-xs text-slate-600"
          >
            Filtrar
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => abrirModalMigracao()}
            className="border-amber-300 text-amber-800 hover:bg-amber-50 flex items-center gap-1.5 text-xs shadow-sm font-semibold"
          >
            <ArrowRightLeft className="w-4 h-4 text-amber-600" />
            <span>Migrar / Trocar Fornecedor</span>
          </Button>

          <Button
            onClick={abrirModalNova}
            className="bg-sky-600 hover:bg-sky-700 text-white flex items-center gap-2 text-xs shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Nova Empresa Fornecedora</span>
          </Button>
        </div>
      </div>

      {/* GRADE DE EMPRESAS CADASTRADAS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {empresas.length === 0 ? (
          <div className="col-span-full bg-white p-12 text-center rounded-2xl border border-slate-200 text-slate-400 text-sm">
            Nenhuma empresa fornecedora encontrada. Clique em "Nova Empresa Fornecedora" para cadastrar.
          </div>
        ) : (
          empresas.map((emp) => (
            <div
              key={emp.id}
              className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between space-y-4"
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2.5 bg-sky-100 text-sky-700 rounded-xl">
                      <Building2 className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-900 text-base leading-snug">{emp.nome_fantasia || emp.razao_social || emp.nome}</h3>
                      <span className="text-[11px] text-slate-500 font-mono">CNPJ: {emp.cnpj}</span>
                    </div>
                  </div>
                  {emp.ativo ? (
                    <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-100 text-emerald-800">
                      Ativa
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-slate-200 text-slate-700">
                      Inativa
                    </span>
                  )}
                </div>

                {emp.razao_social && (
                  <p className="text-xs text-slate-600 italic mb-2">
                    {emp.razao_social}
                  </p>
                )}

                {/* Badge de Escopo Exclusivo ou Integrado */}
                {(() => {
                  const escopo = obterEscopoEmpresa(emp.servicos);
                  return (
                    <div className={`mb-3 px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1.5 ${escopo.cor}`}>
                      <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                      <span>{escopo.rotulo}</span>
                    </div>
                  );
                })()}

                {/* Contatos */}
                <div className="space-y-1 text-xs text-slate-600 pt-2 border-t border-slate-100">
                  {emp.contato_responsavel && (
                    <div className="flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span>{emp.contato_responsavel}</span>
                    </div>
                  )}
                  {emp.telefone && (
                    <div className="flex items-center gap-1.5">
                      <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span>{emp.telefone}</span>
                    </div>
                  )}
                  {emp.email && (
                    <div className="flex items-center gap-1.5">
                      <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span>{emp.email}</span>
                    </div>
                  )}
                  {emp.endereco && (
                    <div className="flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="truncate">{emp.endereco}</span>
                    </div>
                  )}
                </div>

                {/* Tags de Serviços Prestados */}
                <div className="pt-3 border-t border-slate-100 space-y-1.5">
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                    Serviços Habilitados:
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {emp.servicos?.map((s) => {
                      const opc = OPCOES_SERVICOS.find((o) => o.id === s);
                      return (
                        <span
                          key={s}
                          className={`px-2 py-0.5 rounded text-[10px] font-medium border ${
                            opc?.cor || "bg-slate-100 text-slate-700 border-slate-200"
                          }`}
                        >
                          {opc?.rotulo || s}
                        </span>
                      );
                    })}
                  </div>
                </div>

                {/* Preços Unitários Contratados na Empresa */}
                {(Number(emp.valor_unitario_10m3) > 0 ||
                  Number(emp.valor_unitario_3m3) > 0 ||
                  Number(emp.valor_unitario_1m3) > 0 ||
                  Number(emp.valor_recarga_m3) > 0 ||
                  Number(emp.locacao_mensal_concentrador_5l) > 0 ||
                  Number(emp.locacao_mensal_concentrador_10l) > 0 ||
                  Number(emp.locacao_mensal_concentrador) > 0 ||
                  Number(emp.locacao_mensal_cpap) > 0) && (
                  <div className="pt-3 border-t border-slate-100">
                    <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1.5">
                      <div className="flex items-center justify-between text-slate-500 font-bold text-[10px] uppercase tracking-wide">
                        <span className="flex items-center gap-1">
                          <Package className="w-3 h-3 text-sky-600" />
                          Preços Unitários
                        </span>
                        <span>Tabela Direta</span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-slate-700">
                        {Number(emp.valor_unitario_10m3) > 0 && (
                          <div>10m³: <strong className="text-slate-900 font-semibold">R$ {Number(emp.valor_unitario_10m3).toFixed(2)}</strong></div>
                        )}
                        {Number(emp.valor_unitario_3m3) > 0 && (
                          <div>3m³: <strong className="text-slate-900 font-semibold">R$ {Number(emp.valor_unitario_3m3).toFixed(2)}</strong></div>
                        )}
                        {Number(emp.valor_unitario_1m3) > 0 && (
                          <div>1m³: <strong className="text-slate-900 font-semibold">R$ {Number(emp.valor_unitario_1m3).toFixed(2)}</strong></div>
                        )}
                        {Number(emp.valor_recarga_m3) > 0 && (
                          <div>Recarga/m³: <strong className="text-slate-900 font-semibold">R$ {Number(emp.valor_recarga_m3).toFixed(2)}</strong></div>
                        )}
                        {(Number(emp.locacao_mensal_concentrador_5l) > 0 || Number(emp.locacao_mensal_concentrador) > 0) && (
                          <div>Conc. 5L: <strong className="text-slate-900 font-semibold">R$ {Number(emp.locacao_mensal_concentrador_5l || emp.locacao_mensal_concentrador).toFixed(2)}/mês</strong></div>
                        )}
                        {Number(emp.locacao_mensal_concentrador_10l) > 0 && (
                          <div>Conc. 10L: <strong className="text-slate-900 font-semibold">R$ {Number(emp.locacao_mensal_concentrador_10l).toFixed(2)}/mês</strong></div>
                        )}
                        {Number(emp.locacao_mensal_cpap) > 0 && (
                          <div>CPAP: <strong className="text-slate-900 font-semibold">R$ {Number(emp.locacao_mensal_cpap).toFixed(2)}/mês</strong></div>
                        )}
                        {Number(emp.locacao_mensal_bipap) > 0 && (
                          <div>BiPAP: <strong className="text-slate-900 font-semibold">R$ {Number(emp.locacao_mensal_bipap).toFixed(2)}/mês</strong></div>
                        )}
                        {Number(emp.locacao_mensal_cilindro) > 0 && (
                          <div>Loc. Cil.: <strong className="text-slate-900 font-semibold">R$ {Number(emp.locacao_mensal_cilindro).toFixed(2)}/mês</strong></div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Botões de Ação */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => abrirModalMigracao(emp.id)}
                  className="text-[11px] border-amber-300 text-amber-800 hover:bg-amber-50 flex items-center gap-1 font-medium"
                  title="Migrar contratos e pacientes desta empresa para outra fornecedora"
                >
                  <ArrowRightLeft className="w-3.5 h-3.5 text-amber-600" />
                  <span>Migrar</span>
                </Button>

                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => abrirModalEditar(emp)}
                    className="text-xs text-slate-600 hover:text-slate-900 flex items-center gap-1"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    <span>Editar</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleExcluir(emp.id)}
                    className="text-xs text-rose-600 hover:text-rose-800 border-rose-200 hover:bg-rose-50 flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Excluir</span>
                  </Button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* MODAL: NOVA / EDITAR EMPRESA */}
      {modalAberto && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-3xl w-full max-h-[92vh] overflow-y-auto border border-slate-200">
            <div className="sticky top-0 z-10 px-6 py-4 bg-sky-900 text-white flex justify-between items-center shadow-sm">
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-sky-300" />
                <h3 className="font-bold text-base">
                  {empresaEdicao ? "Editar Empresa Fornecedora" : "Cadastrar Nova Empresa"}
                </h3>
              </div>
              <button
                onClick={() => setModalAberto(false)}
                className="text-white/80 hover:text-white text-xl font-bold"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSalvar} className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Nome Fantasia / Comercial</Label>
                  <Input
                    placeholder="Ex: White Martins, Oxigás..."
                    value={form.nome_fantasia}
                    onChange={(e) => setForm({ ...form, nome_fantasia: e.target.value })}
                  />
                </div>
                <div>
                  <Label>CNPJ *</Label>
                  <Input
                    required
                    placeholder="00.000.000/0000-00"
                    value={form.cnpj}
                    onChange={(e) => setForm({ ...form, cnpj: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <Label>Razão Social Completa *</Label>
                <Input
                  required
                  placeholder="Ex: White Martins Gases Industriais Ltda"
                  value={form.razao_social}
                  onChange={(e) => setForm({ ...form, razao_social: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Telefone / WhatsApp</Label>
                  <Input
                    placeholder="(35) 99999-9999"
                    value={form.telefone}
                    onChange={(e) => setForm({ ...form, telefone: e.target.value })}
                  />
                </div>
                <div>
                  <Label>E-mail de Contato</Label>
                  <Input
                    placeholder="contato@empresa.com"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Representante / Responsável</Label>
                  <Input
                    placeholder="Nome do consultor"
                    value={form.contato_responsavel}
                    onChange={(e) => setForm({ ...form, contato_responsavel: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <Label>Endereço / Filial de Atendimento</Label>
                <Input
                  placeholder="Endereço, cidade e UF"
                  value={form.endereco}
                  onChange={(e) => setForm({ ...form, endereco: e.target.value })}
                />
              </div>

              {/* Seleção de Serviços com Checkboxes */}
              <div className="space-y-2 pt-1">
                <Label className="font-bold text-slate-800">Serviços Fornecidos / Contratados:</Label>
                <div className="grid grid-cols-2 gap-2">
                  {OPCOES_SERVICOS.map((serv) => {
                    const ativo = form.servicos.includes(serv.id);
                    return (
                      <button
                        type="button"
                        key={serv.id}
                        onClick={() => toggleServico(serv.id)}
                        className={`p-2.5 rounded-xl border text-left flex items-center gap-2 transition-all ${
                          ativo
                            ? "bg-sky-50 border-sky-500 ring-1 ring-sky-300 text-sky-900 font-semibold"
                            : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={ativo}
                          onChange={() => {}}
                          className="rounded text-sky-600"
                        />
                        <span className="text-xs">{serv.rotulo}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* TABELA DE PREÇOS UNITÁRIOS CENTRALIZADA NA EMPRESA */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3.5">
                <div className="flex items-center justify-between pb-1 border-b border-slate-200">
                  <div className="flex items-center gap-2">
                    <Package className="w-4 h-4 text-sky-700" />
                    <span className="font-bold text-slate-800 text-sm">
                      Tabela de Preços Unitários Contratados
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-500">
                    Defina diretamente os preços desta fornecedora (R$)
                  </span>
                </div>

                {/* Bloco 1: Cilindros e Gases Medicinais */}
                <div className="space-y-2">
                  <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block">
                    Gases Medicinais & Recargas de Cilindros:
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div>
                      <Label className="text-slate-600 text-[11px]">Cilindro 10m³</Label>
                      <div className="relative mt-1">
                        <span className="absolute left-2.5 top-2.5 text-xs text-slate-400 font-semibold pointer-events-none">R$</span>
                        <Input
                          type="text"
                          inputMode="decimal"
                          placeholder="0,00"
                          className="pl-8 text-xs font-medium"
                          value={form.valor_unitario_10m3}
                          onChange={(e) => handlePrecoChange("valor_unitario_10m3", e.target.value)}
                        />
                      </div>
                    </div>

                    <div>
                      <Label className="text-slate-600 text-[11px]">Cilindro 3m³</Label>
                      <div className="relative mt-1">
                        <span className="absolute left-2.5 top-2.5 text-xs text-slate-400 font-semibold pointer-events-none">R$</span>
                        <Input
                          type="text"
                          inputMode="decimal"
                          placeholder="0,00"
                          className="pl-8 text-xs font-medium"
                          value={form.valor_unitario_3m3}
                          onChange={(e) => handlePrecoChange("valor_unitario_3m3", e.target.value)}
                        />
                      </div>
                    </div>

                    <div>
                      <Label className="text-slate-600 text-[11px]">Cilindro 1m³</Label>
                      <div className="relative mt-1">
                        <span className="absolute left-2.5 top-2.5 text-xs text-slate-400 font-semibold pointer-events-none">R$</span>
                        <Input
                          type="text"
                          inputMode="decimal"
                          placeholder="0,00"
                          className="pl-8 text-xs font-medium"
                          value={form.valor_unitario_1m3}
                          onChange={(e) => handlePrecoChange("valor_unitario_1m3", e.target.value)}
                        />
                      </div>
                    </div>

                    <div>
                      <Label className="text-slate-600 text-[11px]">Recarga por m³</Label>
                      <div className="relative mt-1">
                        <span className="absolute left-2.5 top-2.5 text-xs text-slate-400 font-semibold pointer-events-none">R$</span>
                        <Input
                          type="text"
                          inputMode="decimal"
                          placeholder="0,00"
                          className="pl-8 text-xs font-medium"
                          value={form.valor_recarga_m3}
                          onChange={(e) => handlePrecoChange("valor_recarga_m3", e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Bloco 2: Locações Mensais de Equipamentos */}
                <div className="space-y-2 pt-2 border-t border-slate-200">
                  <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block">
                    Locações Mensais de Equipamentos:
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                    <div>
                      <Label className="text-slate-600 text-[11px]">Concentrador 5L</Label>
                      <div className="relative mt-1">
                        <span className="absolute left-2.5 top-2.5 text-xs text-slate-400 font-semibold pointer-events-none">R$</span>
                        <Input
                          type="text"
                          inputMode="decimal"
                          placeholder="0,00"
                          className="pl-8 text-xs font-medium"
                          value={form.locacao_mensal_concentrador_5l || form.locacao_mensal_concentrador}
                          onChange={(e) => {
                            handlePrecoChange("locacao_mensal_concentrador_5l", e.target.value);
                            handlePrecoChange("locacao_mensal_concentrador", e.target.value);
                          }}
                        />
                      </div>
                    </div>

                    <div>
                      <Label className="text-slate-600 text-[11px]">Concentrador 10L</Label>
                      <div className="relative mt-1">
                        <span className="absolute left-2.5 top-2.5 text-xs text-slate-400 font-semibold pointer-events-none">R$</span>
                        <Input
                          type="text"
                          inputMode="decimal"
                          placeholder="0,00"
                          className="pl-8 text-xs font-medium"
                          value={form.locacao_mensal_concentrador_10l}
                          onChange={(e) => handlePrecoChange("locacao_mensal_concentrador_10l", e.target.value)}
                        />
                      </div>
                    </div>

                    <div>
                      <Label className="text-slate-600 text-[11px]">CPAP</Label>
                      <div className="relative mt-1">
                        <span className="absolute left-2.5 top-2.5 text-xs text-slate-400 font-semibold pointer-events-none">R$</span>
                        <Input
                          type="text"
                          inputMode="decimal"
                          placeholder="0,00"
                          className="pl-8 text-xs font-medium"
                          value={form.locacao_mensal_cpap}
                          onChange={(e) => handlePrecoChange("locacao_mensal_cpap", e.target.value)}
                        />
                      </div>
                    </div>

                    <div>
                      <Label className="text-slate-600 text-[11px]">BiPAP</Label>
                      <div className="relative mt-1">
                        <span className="absolute left-2.5 top-2.5 text-xs text-slate-400 font-semibold pointer-events-none">R$</span>
                        <Input
                          type="text"
                          inputMode="decimal"
                          placeholder="0,00"
                          className="pl-8 text-xs font-medium"
                          value={form.locacao_mensal_bipap}
                          onChange={(e) => handlePrecoChange("locacao_mensal_bipap", e.target.value)}
                        />
                      </div>
                    </div>

                    <div>
                      <Label className="text-slate-600 text-[11px]">Locação Cilindro</Label>
                      <div className="relative mt-1">
                        <span className="absolute left-2.5 top-2.5 text-xs text-slate-400 font-semibold pointer-events-none">R$</span>
                        <Input
                          type="text"
                          inputMode="decimal"
                          placeholder="0,00"
                          className="pl-8 text-xs font-medium"
                          value={form.locacao_mensal_cilindro}
                          onChange={(e) => handlePrecoChange("locacao_mensal_cilindro", e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <Label>Observações Gerais</Label>
                <Input
                  placeholder="Condições de entrega, prazo de frete..."
                  value={form.observacoes}
                  onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
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
                  className="bg-sky-600 hover:bg-sky-700 text-white"
                >
                  {salvando ? "Salvando..." : "Salvar Empresa"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: TRANSIÇÃO / MIGRAÇÃO GLOBAL DE EMPRESA */}
      {modalMigracaoAberto && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-xl w-full overflow-hidden border border-slate-200">
            <div className="px-6 py-4 bg-amber-600 text-white flex justify-between items-center">
              <div className="flex items-center gap-2">
                <ArrowRightLeft className="w-5 h-5 text-amber-200" />
                <h3 className="font-bold text-base">
                  Migração Global / Troca de Empresa Contratada
                </h3>
              </div>
              <button
                onClick={() => setModalMigracaoAberto(false)}
                className="text-white/80 hover:text-white text-xl font-bold"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSalvarMigracao} className="p-6 space-y-4 text-xs">
              <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-900 space-y-1">
                <div className="font-bold flex items-center gap-1.5 text-xs text-amber-800">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>Transferência em Lote de Pacientes & Equipamentos</span>
                </div>
                <p className="text-[11px] leading-relaxed text-amber-700">
                  Utilize esta rotina quando o contrato com a empresa antiga for encerrado e uma nova empresa credenciada assumir o fornecimento. Todos os empréstimos ativos e equipamentos serão reatribuídos para a nova fornecedora, preservando integralmente o histórico de atendimentos e consumos.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="font-bold text-slate-700">1. Empresa Antiga (Origem) *</Label>
                  <select
                    required
                    value={empresaOrigemId}
                    onChange={(e) => setEmpresaOrigemId(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white"
                  >
                    <option value="">Selecione a empresa de origem...</option>
                    {empresas.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.nome_fantasia || e.razao_social} {e.ativo ? "" : "(Inativa)"}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <Label className="font-bold text-slate-700">2. Nova Empresa (Destino) *</Label>
                  <select
                    required
                    value={empresaDestinoId}
                    onChange={(e) => setEmpresaDestinoId(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white"
                  >
                    <option value="">Selecione a nova empresa...</option>
                    {empresas
                      .filter((e) => e.ativo && String(e.id) !== empresaOrigemId)
                      .map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.nome_fantasia || e.razao_social}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                <span className="font-bold text-slate-800 block">Itens a serem migrados:</span>
                <label className="flex items-center gap-2 cursor-pointer text-slate-700">
                  <input
                    type="checkbox"
                    checked={transferirPacientes}
                    onChange={(e) => setTransferirPacientes(e.target.checked)}
                    className="rounded text-amber-600"
                  />
                  <span>Transferir todos os pacientes e empréstimos ativos para a nova empresa</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-slate-700">
                  <input
                    type="checkbox"
                    checked={transferirEquipamentos}
                    onChange={(e) => setTransferirEquipamentos(e.target.checked)}
                    className="rounded text-amber-600"
                  />
                  <span>Transferir equipamentos (locados/próprios) vinculados à empresa antiga</span>
                </label>
              </div>

              <div>
                <Label>Motivo / Justificativa da Transição</Label>
                <Input
                  placeholder="Ex: Encerramento do Pregão 015/2026 e homologação da nova ata..."
                  value={obsMigracao}
                  onChange={(e) => setObsMigracao(e.target.value)}
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setModalMigracaoAberto(false)}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={migrando}
                  className="bg-amber-600 hover:bg-amber-700 text-white flex items-center gap-1.5"
                >
                  <ArrowRightLeft className="w-4 h-4" />
                  <span>{migrando ? "Migrando..." : "Confirmar Migração Global"}</span>
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
