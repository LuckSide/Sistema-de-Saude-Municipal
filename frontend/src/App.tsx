import { lazy, Suspense } from "react";
import { lazyWithRetry } from "./utils/lazyWithRetry";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import type { ReactElement } from "react";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { UndoToastProvider } from "./components/UndoToast";
import { ConfirmDialogProvider } from "./components/ConfirmDialog";
import { useCidadeDinamica } from "./hooks/useCidade";
import { Protected, Shell } from "./components/Layout";
import TopRouteProgressBar from "./components/TopRouteProgressBar";
import { MODULOS } from "./permissoes";

// Loading Fallback para transição suave de módulos (nível root)
function PageLoader() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center p-8">
      <div className="flex flex-col items-center gap-3 text-sus-900/60">
        <div className="h-8 w-8 animate-spin rounded-full border-3 border-teal border-t-transparent" />
        <span className="text-xs font-medium">Carregando…</span>
      </div>
    </div>
  );
}

// Loading Fallback no miolo da aplicação (não desmonta Shell nem Sidebar)
function PageContentLoader() {
  return (
    <div className="space-y-4 p-2 animate-pulse" aria-busy="true">
      <div className="flex items-center justify-between pb-3 border-b border-sus-900/10">
        <div className="space-y-2">
          <div className="h-6 w-44 rounded-xl bg-sus-900/10" />
          <div className="h-3.5 w-64 rounded-lg bg-sus-900/5" />
        </div>
        <div className="h-9 w-24 rounded-xl bg-sus-900/10" />
      </div>

      <div className="flex min-h-[35vh] flex-col items-center justify-center gap-3 py-10">
        <div className="relative h-9 w-9">
          <div className="absolute inset-0 rounded-full border-2 border-teal/20" />
          <div className="absolute inset-0 animate-spin rounded-full border-2 border-teal border-t-transparent" />
        </div>
        <span className="text-xs font-semibold text-sus-950/60 tracking-wide">
          Carregando módulo…
        </span>
      </div>
    </div>
  );
}

// Layout Persistente da Aplicação
// O Shell e a Sidebar nunca são desmontados ao navegar entre rotas internas.
function AppShellLayout() {
  const loc = useLocation();

  return (
    <Protected>
      <Shell>
        <TopRouteProgressBar />
        <Suspense fallback={<PageContentLoader />}>
          <div key={loc.pathname} className="animate-page-enter">
            <Outlet />
          </div>
        </Suspense>
      </Shell>
    </Protected>
  );
}

// Code Splitting sob demanda com lazyWithRetry (protege contra chunks desatualizados pós-deploy)
const Login = lazyWithRetry(() => import("./pages/Login"));
const Dashboard = lazyWithRetry(() => import("./pages/Dashboard"));
const Usuarios = lazyWithRetry(() => import("./pages/Usuarios"));
const TfdLayout = lazyWithRetry(() => import("./pages/tfd/TfdLayout"));
const TfdViagens = lazyWithRetry(() => import("./pages/tfd/TfdViagens"));
const TfdPacientes = lazyWithRetry(() => import("./pages/tfd/TfdPacientes"));
const AgendaTfd = lazyWithRetry(() => import("./pages/tfd/AgendaTfd"));
const Agendamentos = lazyWithRetry(() => import("./pages/tfd/Agendamentos"));
const QuadroViagens = lazyWithRetry(() => import("./pages/tfd/QuadroViagens"));
const TfdDestinos = lazyWithRetry(() => import("./pages/tfd/TfdDestinos"));
const CatalogoExames = lazyWithRetry(() => import("./pages/tfd/CatalogoExames"));
const TfdFrota = lazyWithRetry(() => import("./pages/tfd/TfdFrota"));
const TfdMotoristas = lazyWithRetry(() => import("./pages/tfd/TfdMotoristas"));
const TfdFaturamento = lazyWithRetry(() => import("./pages/tfd/TfdFaturamento"));
const AlterarSenhaInicial = lazyWithRetry(() => import("./pages/AlterarSenhaInicial"));
const LabLayout = lazyWithRetry(() => import("./pages/lab/LabLayout"));
const LabMarcacao = lazyWithRetry(() => import("./pages/lab/LabMarcacao"));
const RecepcaoLab = lazyWithRetry(() => import("./pages/lab/RecepcaoLab"));
const FilaPsf = lazyWithRetry(() => import("./pages/lab/FilaPsf"));
const VagasAgenda = lazyWithRetry(() => import("./pages/lab/VagasAgenda"));
const AuditLab = lazyWithRetry(() => import("./pages/lab/AuditLab"));
const LabFaturamento = lazyWithRetry(() => import("./pages/lab/LabFaturamento"));
const LabSigtap = lazyWithRetry(() => import("./pages/lab/LabSigtap"));
const LabOrcamentoLotes = lazyWithRetry(() => import("./pages/lab/LabOrcamentoLotes"));
const PortalLaboratorio = lazyWithRetry(() => import("./pages/lab/PortalLaboratorio"));
const AuditoriaLaudos = lazyWithRetry(() => import("./pages/lab/AuditoriaLaudos"));
const Prestadores = lazyWithRetry(() => import("./pages/Prestadores"));
const AcompanharExame = lazyWithRetry(() => import("./pages/AcompanharExame"));
const ConfirmarPresencaViagem = lazyWithRetry(() => import("./pages/ConfirmarPresencaViagem"));
const Auditoria = lazyWithRetry(() => import("./pages/Auditoria"));
const FilaExames = lazyWithRetry(() => import("./pages/tfd/FilaExames"));
const NovaSolicitacao = lazyWithRetry(() => import("./pages/tfd/NovaSolicitacao"));
const RelatorioAgendados = lazyWithRetry(() => import("./pages/tfd/RelatorioAgendados"));
const Indicadores = lazyWithRetry(() => import("./pages/Indicadores"));
const ApsPainel = lazyWithRetry(() => import("./pages/aps/ApsPainel"));
const Configuracoes = lazyWithRetry(() => import("./pages/Configuracoes"));
const PainelMedico = lazyWithRetry(() => import("./pages/PainelMedico"));
const ApacSolicitacao = lazyWithRetry(() => import("./pages/apac/ApacSolicitacao"));
const ApacRegulacao = lazyWithRetry(() => import("./pages/apac/ApacRegulacao"));
const ApacFaturamento = lazyWithRetry(() => import("./pages/apac/ApacFaturamento"));
const FaturamentoBpa = lazyWithRetry(() => import("./pages/FaturamentoBpa"));
const ProducaoProfissional = lazyWithRetry(() => import("./pages/ProducaoProfissional"));
const OxigenioPainelEstoque = lazyWithRetry(() => import("./pages/oxigenio/OxigenioPainelEstoque"));
const OxigenioEquipamentos = lazyWithRetry(() => import("./pages/oxigenio/OxigenioEquipamentos"));
const OxigenioEmprestimos = lazyWithRetry(() => import("./pages/oxigenio/OxigenioEmprestimos"));
const OxigenioEmpresas = lazyWithRetry(() => import("./pages/oxigenio/OxigenioEmpresas"));
const OxigenioRequisicaoAF = lazyWithRetry(() => import("./pages/oxigenio/OxigenioRequisicaoAF"));
const FarmaciaEstoque = lazyWithRetry(() => import("./pages/farmacia/FarmaciaEstoque"));
const FarmaciaValidade = lazyWithRetry(() => import("./pages/farmacia/FarmaciaValidade"));
const FarmaciaLinks = lazyWithRetry(() => import("./pages/farmacia/FarmaciaLinks"));
const FarmaciaInsumos = lazyWithRetry(() => import("./pages/farmacia/FarmaciaInsumos"));
const FarmaciaPainelPublico = lazyWithRetry(() => import("./pages/farmacia/FarmaciaPainelPublico"));
const GestaoTickets = lazyWithRetry(() => import("./pages/admin/GestaoTickets"));

function Guard({ tela, children }: { tela: string; children: ReactElement }) {
  const { can, loading } = useAuth();
  if (loading) return null;
  if (!can(tela)) return <Navigate to="/" replace />;
  return children;
}

function HomeGuard({ children }: { children: ReactElement }) {
  const { can, loading } = useAuth();
  if (loading) return null;
  if (can("dashboard")) return children;
  for (const m of MODULOS) {
    for (const f of m.filhos ?? []) {
      if (f.rota && can(f.codigo)) return <Navigate to={f.rota} replace />;
    }
    if (!m.apenasGrupo && m.rota && can(m.codigo)) return <Navigate to={m.rota} replace />;
  }
  return (
    <div className="rounded-2xl border border-sus-900/10 bg-white p-8 text-center text-sm text-ink/70">
      Nenhuma tela liberada para o seu usuário. Solicite acesso ao administrador.
    </div>
  );
}

// Configurações centraliza parâmetros, cadastros auxiliares, filas, PEC e RNDS.
function ConfigGuard({ children }: { children: ReactElement }) {
  const { can, loading } = useAuth();
  if (loading) return null;
  const CFG_TELAS = [
    "integracoes",
    "cfg_geral",
    "cfg_filas",
    "cfg_importar",
    "cfg_pec",
    "cfg_rnds",
    "cfg_whatsapp",
    "cfg_exames",
    "cfg_medicos",
    "cfg_unidades",
    "cfg_dados",
    "cfg_backup",
  ];
  if (!CFG_TELAS.some((t) => can(t))) return <Navigate to="/" replace />;
  return children;
}

function GuardQualquer({ telas, children }: { telas: string[]; children: ReactElement }) {
  const { can, loading } = useAuth();
  if (loading) return null;
  if (!telas.some((t) => can(t))) return <Navigate to="/" replace />;
  return children;
}

function LabGuard({ tela, telas, children }: { tela: string; telas?: string[]; children: ReactElement }) {
  const { can, loading } = useAuth();
  if (loading) return null;
  const LAB_TELAS = [
    "lab",
    "lab_recepcao",
    "lab_marcacao",
    "lab_fila",
    "lab_agenda",
    "lab_vagas",
    "lab_portal",
    "lab_orcamento",
    "lab_audit",
    "lab_auditoria_laudos",
    "lab_faturamento",
    "lab_sigtap",
  ];
  const alvos = telas ?? [tela];
  if (tela === "lab") {
    if (!LAB_TELAS.some((t) => can(t))) return <Navigate to="/" replace />;
  } else if (!alvos.some((t) => can(t))) {
    return <Navigate to="/" replace />;
  }
  return children;
}

function TfdRoutes() {
  return (
    <GuardQualquer telas={["tfd", "tfd_viagens", "tfd_pacientes", "tfd_exames", "tfd_fila_lancamento", "tfd_agenda", "tfd_relatorio_agendados", "tfd_catalogo", "tfd_destinos", "tfd_frota", "tfd_motoristas", "tfd_frota_gestao", "tfd_faturamento"]}>
      <TfdLayout />
    </GuardQualquer>
  );
}

function LabRoutes() {
  return (
    <LabGuard tela="lab">
      <LabLayout />
    </LabGuard>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <UndoToastProvider>
        <ConfirmDialogProvider>
          <AplicaCidade />
          <BrowserRouter>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                {/* Rotas Públicas (Sem Shell/Sidebar) */}
                <Route path="/login" element={<Login />} />
                <Route path="/alterar-senha-inicial" element={<AlterarSenhaInicial />} />
                <Route path="/acompanhar/:token" element={<AcompanharExame />} />
                <Route path="/confirmar-presenca/:token" element={<ConfirmarPresencaViagem />} />
                <Route path="/farmacia/publico/:token" element={<FarmaciaPainelPublico />} />
                <Route path="/farmacia/painel-tv/:token" element={<FarmaciaPainelPublico />} />

                {/* Rotas Autenticadas com Shell e Sidebar Persistentes */}
                <Route element={<AppShellLayout />}>
                  <Route path="/" element={<HomeGuard><Dashboard /></HomeGuard>} />
                  <Route path="/fila-exames" element={<Guard tela="tfd_exames"><FilaExames /></Guard>} />
                  <Route path="/solicitacoes/nova" element={<Navigate to="/tfd/solicitacoes/nova" replace />} />
                  <Route path="/solicitacoes" element={<Navigate to="/fila-exames" replace />} />
                  <Route path="/painel-medico" element={<Guard tela="tfd_medico"><PainelMedico /></Guard>} />
                  <Route path="/indicadores" element={<Guard tela="dash_indicadores"><Indicadores /></Guard>} />
                  <Route path="/usuarios" element={<Guard tela="usuarios"><Usuarios /></Guard>} />

                  <Route path="/tfd" element={<TfdRoutes />}>
                    <Route index element={<Navigate to="/" replace />} />
                    <Route path="solicitacoes/nova" element={<GuardQualquer telas={["tfd_exames", "tfd_fila_lancamento"]}><NovaSolicitacao /></GuardQualquer>} />
                    <Route path="relatorio-agendados" element={<Guard tela="tfd_relatorio_agendados"><RelatorioAgendados /></Guard>} />
                    <Route path="viagens" element={<Guard tela="tfd_viagens"><TfdViagens /></Guard>} />
                    <Route path="quadro" element={<Guard tela="tfd_frota_gestao"><QuadroViagens /></Guard>} />
                    <Route path="pacientes" element={<Guard tela="tfd_pacientes"><TfdPacientes /></Guard>} />
                    <Route path="agenda" element={<Guard tela="tfd_agenda"><AgendaTfd /></Guard>} />
                    <Route path="agendamentos" element={<Guard tela="tfd_agenda"><Agendamentos /></Guard>} />
                    <Route path="exames" element={<Navigate to="/fila-exames" replace />} />
                    <Route path="catalogo" element={<Guard tela="tfd_catalogo"><CatalogoExames /></Guard>} />
                    <Route path="destinos" element={<Guard tela="tfd_destinos"><TfdDestinos /></Guard>} />
                    <Route path="frota" element={<GuardQualquer telas={["tfd_frota", "tfd_frota_gestao"]}><TfdFrota /></GuardQualquer>} />
                    <Route path="motoristas" element={<GuardQualquer telas={["tfd_motoristas", "tfd_frota_gestao"]}><TfdMotoristas /></GuardQualquer>} />
                    <Route path="faturamento" element={<Guard tela="tfd_faturamento"><TfdFaturamento /></Guard>} />
                  </Route>

                  <Route path="/lab" element={<LabRoutes />}>
                    <Route index element={<LabGuard tela="lab_recepcao" telas={["lab_recepcao", "lab_marcacao", "lab_fila", "lab_agenda", "lab_vagas", "lab_portal", "lab_orcamento", "lab_audit", "lab_auditoria_laudos", "lab_faturamento"]}><RecepcaoLab /></LabGuard>} />
                    <Route path="recepcao" element={<LabGuard tela="lab_recepcao"><RecepcaoLab /></LabGuard>} />
                    <Route path="marcacao" element={<LabGuard tela="lab_marcacao"><LabMarcacao /></LabGuard>} />
                    <Route path="fila" element={<LabGuard tela="lab_fila"><FilaPsf /></LabGuard>} />
                    <Route path="agenda" element={<LabGuard tela="lab_agenda" telas={["lab_agenda", "lab_vagas"]}><VagasAgenda /></LabGuard>} />
                    <Route path="vagas" element={<LabGuard tela="lab_vagas"><VagasAgenda /></LabGuard>} />
                    <Route path="auditoria" element={<LabGuard tela="lab_audit"><AuditLab /></LabGuard>} />
                    <Route path="auditoria-laudos" element={<LabGuard tela="lab_auditoria_laudos" telas={["lab_auditoria_laudos", "lab_audit"]}><AuditoriaLaudos /></LabGuard>} />
                    <Route path="orcamento" element={<LabGuard tela="lab_orcamento"><LabOrcamentoLotes /></LabGuard>} />
                    <Route path="lotes" element={<LabGuard tela="lab_orcamento"><LabOrcamentoLotes /></LabGuard>} />
                    <Route path="faturamento" element={<LabGuard tela="lab_faturamento"><LabFaturamento /></LabGuard>} />
                    <Route path="portal-producao" element={<LabGuard tela="lab_portal"><PortalLaboratorio /></LabGuard>} />
                    <Route path="sigtap" element={<Navigate to="/sigtap" replace />} />
                  </Route>

                  <Route path="/prestadores" element={<Guard tela="cfg_laboratorios"><Prestadores /></Guard>} />
                  <Route path="/sigtap" element={<Guard tela="lab_sigtap"><LabSigtap /></Guard>} />
                  <Route path="/aps" element={<Guard tela="aps"><ApsPainel /></Guard>} />
                  <Route path="/apac/solicitacoes" element={<Guard tela="apac_solicitacao"><ApacSolicitacao /></Guard>} />
                  <Route path="/apac/regulacao" element={<Guard tela="apac_regulacao"><ApacRegulacao /></Guard>} />
                  <Route path="/apac/faturamento" element={<Guard tela="apac_faturamento"><ApacFaturamento /></Guard>} />
                  <Route path="/faturamento/bpa" element={<Guard tela="faturamento_bpa"><FaturamentoBpa /></Guard>} />
                  <Route path="/faturamento/prestadores" element={<Navigate to="/lab/faturamento" replace />} />
                  <Route path="/regulacao/bpa" element={<Navigate to="/faturamento/bpa" replace />} />
                  <Route path="/producao-ambulatorial" element={<Guard tela="producao_ambulatorial"><ProducaoProfissional /></Guard>} />
                  <Route path="/producao-profissional" element={<Navigate to="/producao-ambulatorial" replace />} />
                  <Route path="/oxigenio" element={<Guard tela="oxigenio_estoque"><OxigenioPainelEstoque /></Guard>} />
                  <Route path="/oxigenio/equipamentos" element={<Guard tela="oxigenio_equipamentos"><OxigenioEquipamentos /></Guard>} />
                  <Route path="/oxigenio/emprestimos" element={<Guard tela="oxigenio_emprestimos"><OxigenioEmprestimos /></Guard>} />
                  <Route path="/oxigenio/empresas" element={<Guard tela="oxigenio_empresas"><OxigenioEmpresas /></Guard>} />
                  <Route path="/oxigenio/relatorios" element={<Guard tela="oxigenio_relatorios"><OxigenioRequisicaoAF /></Guard>} />
                  <Route path="/farmacia" element={<Guard tela="farmacia_estoque"><FarmaciaEstoque /></Guard>} />
                  <Route path="/farmacia/validade" element={<Guard tela="farmacia_validade"><FarmaciaValidade /></Guard>} />
                  <Route path="/farmacia/links" element={<Guard tela="farmacia_links"><FarmaciaLinks /></Guard>} />
                  <Route path="/farmacia/insumos" element={<Guard tela="farmacia_insumos"><FarmaciaInsumos /></Guard>} />
                  <Route path="/integracoes" element={<Navigate to="/configuracoes" replace />} />
                  <Route path="/auditoria" element={<Guard tela="auditoria"><Auditoria /></Guard>} />
                  <Route path="/admin/tickets" element={<Guard tela="admin_tickets"><GestaoTickets /></Guard>} />
                  <Route path="/suporte/tickets" element={<Navigate to="/admin/tickets" replace />} />
                  <Route path="/configuracoes" element={<ConfigGuard><Configuracoes /></ConfigGuard>} />
                  <Route path="/admin/medicos" element={<Navigate to="/configuracoes?aba=medicos" replace />} />
                  <Route path="/admin/psfs" element={<Navigate to="/configuracoes?aba=unidades" replace />} />
                </Route>
              </Routes>
          </Suspense>
        </BrowserRouter>
        </ConfirmDialogProvider>
      </UndoToastProvider>
    </AuthProvider>
  );
}

function AplicaCidade() {
  useCidadeDinamica();
  return null;
}
