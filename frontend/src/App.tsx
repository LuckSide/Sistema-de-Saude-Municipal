import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import type { ReactElement } from "react";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { UndoToastProvider } from "./components/UndoToast";
import { ConfirmDialogProvider } from "./components/ConfirmDialog";
import { useCidadeDinamica } from "./hooks/useCidade";
import { Protected, Shell } from "./components/Layout";
import TopRouteProgressBar from "./components/TopRouteProgressBar";

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

// Code Splitting sob demanda com React.lazy
const Login = lazy(() => import("./pages/Login"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Usuarios = lazy(() => import("./pages/Usuarios"));
const TfdLayout = lazy(() => import("./pages/tfd/TfdLayout"));
const TfdResumo = lazy(() => import("./pages/tfd/TfdResumo"));
const TfdViagens = lazy(() => import("./pages/tfd/TfdViagens"));
const TfdPacientes = lazy(() => import("./pages/tfd/TfdPacientes"));
const AgendaTfd = lazy(() => import("./pages/tfd/AgendaTfd"));
const Agendamentos = lazy(() => import("./pages/tfd/Agendamentos"));
const QuadroViagens = lazy(() => import("./pages/tfd/QuadroViagens"));
const TfdDestinos = lazy(() => import("./pages/tfd/TfdDestinos"));
const CatalogoExames = lazy(() => import("./pages/tfd/CatalogoExames"));
const TfdFrota = lazy(() => import("./pages/tfd/TfdFrota"));
const TfdMotoristas = lazy(() => import("./pages/tfd/TfdMotoristas"));
const TfdFaturamento = lazy(() => import("./pages/tfd/TfdFaturamento"));
const AlterarSenhaInicial = lazy(() => import("./pages/AlterarSenhaInicial"));
const LabLayout = lazy(() => import("./pages/lab/LabLayout"));
const LabMarcacao = lazy(() => import("./pages/lab/LabMarcacao"));
const RecepcaoLab = lazy(() => import("./pages/lab/RecepcaoLab"));
const FilaPsf = lazy(() => import("./pages/lab/FilaPsf"));
const VagasAgenda = lazy(() => import("./pages/lab/VagasAgenda"));
const AuditLab = lazy(() => import("./pages/lab/AuditLab"));
const LabFaturamento = lazy(() => import("./pages/lab/LabFaturamento"));
const LabSigtap = lazy(() => import("./pages/lab/LabSigtap"));
const LabOrcamentoLotes = lazy(() => import("./pages/lab/LabOrcamentoLotes"));
const PortalLaboratorio = lazy(() => import("./pages/lab/PortalLaboratorio"));
const AuditoriaLaudos = lazy(() => import("./pages/lab/AuditoriaLaudos"));
const Prestadores = lazy(() => import("./pages/Prestadores"));
const AcompanharExame = lazy(() => import("./pages/AcompanharExame"));
const ConfirmarPresencaViagem = lazy(() => import("./pages/ConfirmarPresencaViagem"));
const Auditoria = lazy(() => import("./pages/Auditoria"));
const FilaExames = lazy(() => import("./pages/tfd/FilaExames"));
const NovaSolicitacao = lazy(() => import("./pages/tfd/NovaSolicitacao"));
const RelatorioAgendados = lazy(() => import("./pages/tfd/RelatorioAgendados"));
const Indicadores = lazy(() => import("./pages/Indicadores"));
const ApsPainel = lazy(() => import("./pages/aps/ApsPainel"));
const Configuracoes = lazy(() => import("./pages/Configuracoes"));
const PainelMedico = lazy(() => import("./pages/PainelMedico"));
const ApacSolicitacao = lazy(() => import("./pages/apac/ApacSolicitacao"));
const ApacRegulacao = lazy(() => import("./pages/apac/ApacRegulacao"));
const ApacFaturamento = lazy(() => import("./pages/apac/ApacFaturamento"));
const FaturamentoBpa = lazy(() => import("./pages/FaturamentoBpa"));
const ProducaoProfissional = lazy(() => import("./pages/ProducaoProfissional"));
const OxigenioPainelEstoque = lazy(() => import("./pages/oxigenio/OxigenioPainelEstoque"));
const OxigenioEquipamentos = lazy(() => import("./pages/oxigenio/OxigenioEquipamentos"));
const OxigenioEmprestimos = lazy(() => import("./pages/oxigenio/OxigenioEmprestimos"));
const OxigenioEmpresas = lazy(() => import("./pages/oxigenio/OxigenioEmpresas"));
const OxigenioRequisicaoAF = lazy(() => import("./pages/oxigenio/OxigenioRequisicaoAF"));
const FarmaciaEstoque = lazy(() => import("./pages/farmacia/FarmaciaEstoque"));
const FarmaciaValidade = lazy(() => import("./pages/farmacia/FarmaciaValidade"));
const FarmaciaLinks = lazy(() => import("./pages/farmacia/FarmaciaLinks"));
const FarmaciaInsumos = lazy(() => import("./pages/farmacia/FarmaciaInsumos"));
const FarmaciaPainelPublico = lazy(() => import("./pages/farmacia/FarmaciaPainelPublico"));
const GestaoTickets = lazy(() => import("./pages/admin/GestaoTickets"));

function Guard({ tela, children }: { tela: string; children: ReactElement }) {
  const { can, loading } = useAuth();
  if (loading) return null;
  if (!can(tela)) return <Navigate to="/" replace />;
  return children;
}

// Configurações centraliza município, filas, PEC e RNDS: aceita a tela
// "usuarios" (admin) ou a legada "integracoes".
function ConfigGuard({ children }: { children: ReactElement }) {
  const { can, loading } = useAuth();
  if (loading) return null;
  const CFG_TELAS = [
    "usuarios",
    "integracoes",
    "cfg_geral",
    "cfg_filas",
    "cfg_pec",
    "cfg_rnds",
    "cfg_whatsapp",
    "cfg_exames",
    "cfg_medicos",
    "cfg_unidades",
    "cfg_laboratorios",
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
  const LAB_TELAS = ["lab", "lab_recepcao", "lab_marcacao", "lab_fila", "lab_agenda", "lab_vagas", "lab_audit", "lab_faturamento", "lab_sigtap"];
  const alvos = telas ?? [tela];
  if (tela === "lab") {
    if (!LAB_TELAS.some((t) => can(t))) return <Navigate to="/" replace />;
  } else if (!can("lab") && !alvos.some((t) => can(t))) {
    return <Navigate to="/" replace />;
  }
  return children;
}

function TfdRoutes() {
  return (
    <GuardQualquer telas={["tfd", "tfd_resumo", "tfd_viagens", "tfd_pacientes", "tfd_exames", "tfd_fila_lancamento", "tfd_agenda", "tfd_relatorio_agendados", "tfd_catalogo", "tfd_destinos", "tfd_frota", "tfd_motoristas", "tfd_frota_gestao", "tfd_faturamento"]}>
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
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/fila-exames" element={<GuardQualquer telas={["tfd_exames", "tfd_fila_lancamento", "tfd_medico", "tfd"]}><FilaExames /></GuardQualquer>} />
                  <Route path="/solicitacoes/nova" element={<Navigate to="/tfd/solicitacoes/nova" replace />} />
                  <Route path="/solicitacoes" element={<Navigate to="/fila-exames" replace />} />
                  <Route path="/painel-medico" element={<Guard tela="tfd_medico"><PainelMedico /></Guard>} />
                  <Route path="/indicadores" element={<Guard tela="dash_indicadores"><Indicadores /></Guard>} />
                  <Route path="/usuarios" element={<Guard tela="usuarios"><Usuarios /></Guard>} />

                  <Route path="/tfd" element={<TfdRoutes />}>
                    <Route index element={<Guard tela="tfd_resumo"><TfdResumo /></Guard>} />
                    <Route path="solicitacoes/nova" element={<GuardQualquer telas={["tfd_exames", "tfd_fila_lancamento", "tfd"]}><NovaSolicitacao /></GuardQualquer>} />
                    <Route path="relatorio-agendados" element={<GuardQualquer telas={["tfd_agenda", "tfd_relatorio_agendados", "tfd_exames", "tfd", "usuarios"]}><RelatorioAgendados /></GuardQualquer>} />
                    <Route path="viagens" element={<Guard tela="tfd_viagens"><TfdViagens /></Guard>} />
                    <Route path="quadro" element={<GuardQualquer telas={["tfd_viagens", "tfd_frota_gestao"]}><QuadroViagens /></GuardQualquer>} />
                    <Route path="pacientes" element={<Guard tela="tfd_pacientes"><TfdPacientes /></Guard>} />
                    <Route path="agenda" element={<Guard tela="tfd_agenda"><AgendaTfd /></Guard>} />
                    <Route path="agendamentos" element={<Guard tela="tfd_agenda"><Agendamentos /></Guard>} />
                    <Route path="exames" element={<Navigate to="/fila-exames" replace />} />
                    <Route path="catalogo" element={<Guard tela="tfd_catalogo"><CatalogoExames /></Guard>} />
                    <Route path="destinos" element={<Guard tela="tfd_destinos"><TfdDestinos /></Guard>} />
                    <Route path="frota" element={<GuardQualquer telas={["tfd_frota", "tfd_frota_gestao", "tfd"]}><TfdFrota /></GuardQualquer>} />
                    <Route path="motoristas" element={<GuardQualquer telas={["tfd_frota", "tfd_motoristas", "tfd_frota_gestao", "tfd"]}><TfdMotoristas /></GuardQualquer>} />
                    <Route path="faturamento" element={<Guard tela="tfd_faturamento"><TfdFaturamento /></Guard>} />
                  </Route>

                  <Route path="/lab" element={<LabRoutes />}>
                    <Route index element={<LabGuard tela="lab_recepcao" telas={["lab_recepcao", "lab_marcacao", "lab"]}><RecepcaoLab /></LabGuard>} />
                    <Route path="recepcao" element={<LabGuard tela="lab_recepcao" telas={["lab_recepcao", "lab"]}><RecepcaoLab /></LabGuard>} />
                    <Route path="marcacao" element={<LabGuard tela="lab_marcacao"><LabMarcacao /></LabGuard>} />
                    <Route path="fila" element={<LabGuard tela="lab_fila"><FilaPsf /></LabGuard>} />
                    <Route path="agenda" element={<LabGuard tela="lab_agenda" telas={["lab_agenda", "lab_vagas"]}><VagasAgenda /></LabGuard>} />
                    <Route path="vagas" element={<LabGuard tela="lab_vagas"><VagasAgenda /></LabGuard>} />
                    <Route path="auditoria" element={<LabGuard tela="lab_audit"><AuditLab /></LabGuard>} />
                    <Route path="auditoria-laudos" element={<LabGuard tela="lab_audit" telas={["lab_audit", "lab_orcamento", "lab_faturamento", "lab", "usuarios"]}><AuditoriaLaudos /></LabGuard>} />
                    <Route path="orcamento" element={<LabGuard tela="lab_orcamento" telas={["lab_orcamento", "lab_marcacao", "lab"]}><LabOrcamentoLotes /></LabGuard>} />
                    <Route path="lotes" element={<LabGuard tela="lab_orcamento" telas={["lab_orcamento", "lab_marcacao", "lab"]}><LabOrcamentoLotes /></LabGuard>} />
                    <Route path="faturamento" element={<LabGuard tela="lab_faturamento"><LabFaturamento /></LabGuard>} />
                    <Route path="portal-producao" element={<LabGuard tela="lab_recepcao" telas={["lab_recepcao", "lab_portal", "lab_faturamento", "lab", "usuarios"]}><PortalLaboratorio /></LabGuard>} />
                    <Route path="sigtap" element={<Navigate to="/sigtap" replace />} />
                  </Route>

                  <Route path="/prestadores" element={<GuardQualquer telas={["cfg_unidades", "cfg_laboratorios", "usuarios", "tfd", "lab", "cfg_geral"]}><Prestadores /></GuardQualquer>} />
                  <Route path="/sigtap" element={<GuardQualquer telas={["lab_sigtap", "tfd_catalogo", "tfd", "lab", "usuarios", "cfg_geral"]}><LabSigtap /></GuardQualquer>} />
                  <Route path="/aps" element={<Guard tela="aps"><ApsPainel /></Guard>} />
                  <Route path="/apac/solicitacoes" element={<Guard tela="apac_solicitacao"><ApacSolicitacao /></Guard>} />
                  <Route path="/apac/regulacao" element={<Guard tela="apac_regulacao"><ApacRegulacao /></Guard>} />
                  <Route path="/apac/faturamento" element={<Guard tela="apac_faturamento"><ApacFaturamento /></Guard>} />
                  <Route path="/faturamento/bpa" element={<GuardQualquer telas={["faturamento_bpa", "tfd", "lab", "usuarios", "tfd_faturamento", "lab_faturamento", "apac_faturamento", "apac"]}><FaturamentoBpa /></GuardQualquer>} />
                  <Route path="/faturamento/prestadores" element={<Navigate to="/lab/faturamento" replace />} />
                  <Route path="/regulacao/bpa" element={<Navigate to="/faturamento/bpa" replace />} />
                  <Route path="/producao-ambulatorial" element={<GuardQualquer telas={["producao_ambulatorial", "faturamento_bpa", "tfd", "lab", "usuarios", "tfd_medico", "tfd_faturamento"]}><ProducaoProfissional /></GuardQualquer>} />
                  <Route path="/producao-profissional" element={<Navigate to="/producao-ambulatorial" replace />} />
                  <Route path="/oxigenio" element={<GuardQualquer telas={["oxigenio_estoque", "oxigenio", "usuarios"]}><OxigenioPainelEstoque /></GuardQualquer>} />
                  <Route path="/oxigenio/equipamentos" element={<GuardQualquer telas={["oxigenio_equipamentos", "oxigenio", "usuarios"]}><OxigenioEquipamentos /></GuardQualquer>} />
                  <Route path="/oxigenio/emprestimos" element={<GuardQualquer telas={["oxigenio_emprestimos", "oxigenio", "usuarios"]}><OxigenioEmprestimos /></GuardQualquer>} />
                  <Route path="/oxigenio/empresas" element={<GuardQualquer telas={["oxigenio_empresas", "oxigenio", "usuarios"]}><OxigenioEmpresas /></GuardQualquer>} />
                  <Route path="/oxigenio/relatorios" element={<GuardQualquer telas={["oxigenio_relatorios", "oxigenio", "usuarios"]}><OxigenioRequisicaoAF /></GuardQualquer>} />
                  <Route path="/farmacia" element={<GuardQualquer telas={["farmacia_estoque", "farmacia", "usuarios"]}><FarmaciaEstoque /></GuardQualquer>} />
                  <Route path="/farmacia/validade" element={<GuardQualquer telas={["farmacia_validade", "farmacia", "usuarios"]}><FarmaciaValidade /></GuardQualquer>} />
                  <Route path="/farmacia/links" element={<GuardQualquer telas={["farmacia_links", "farmacia", "usuarios"]}><FarmaciaLinks /></GuardQualquer>} />
                  <Route path="/farmacia/insumos" element={<GuardQualquer telas={["farmacia_insumos", "farmacia", "usuarios"]}><FarmaciaInsumos /></GuardQualquer>} />
                  <Route path="/integracoes" element={<Navigate to="/configuracoes" replace />} />
                  <Route path="/auditoria" element={<GuardQualquer telas={["auditoria", "usuarios"]}><Auditoria /></GuardQualquer>} />
                  <Route path="/admin/tickets" element={<GuardQualquer telas={["usuarios", "auditoria"]}><GestaoTickets /></GuardQualquer>} />
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
