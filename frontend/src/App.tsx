import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import type { ReactElement } from "react";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { UndoToastProvider } from "./components/UndoToast";
import { ConfirmDialogProvider } from "./components/ConfirmDialog";
import { useCidadeDinamica } from "./hooks/useCidade";
import { Protected, Shell } from "./components/Layout";

// Loading Fallback para transição suave de módulos
function PageLoader() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center p-8">
      <div className="flex flex-col items-center gap-3 text-sus-900/60">
        <div className="h-8 w-8 animate-spin rounded-full border-3 border-teal border-t-transparent" />
        <span className="text-xs font-medium">Carregando módulo…</span>
      </div>
    </div>
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
    <Protected>
      <GuardQualquer telas={["tfd", "tfd_resumo", "tfd_viagens", "tfd_pacientes", "tfd_exames", "tfd_fila_lancamento", "tfd_agenda", "tfd_relatorio_agendados", "tfd_catalogo", "tfd_destinos", "tfd_frota", "tfd_motoristas", "tfd_frota_gestao", "tfd_faturamento"]}>
        <Shell>
          <TfdLayout />
        </Shell>
      </GuardQualquer>
    </Protected>
  );
}

function LabRoutes() {
  return (
    <Protected>
      <LabGuard tela="lab">
        <Shell>
          <LabLayout />
        </Shell>
      </LabGuard>
    </Protected>
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
          <Route path="/login" element={<Login />} />
          <Route path="/alterar-senha-inicial" element={<AlterarSenhaInicial />} />
          <Route path="/acompanhar/:token" element={<AcompanharExame />} />
          <Route path="/confirmar-presenca/:token" element={<ConfirmarPresencaViagem />} />
          <Route path="/farmacia/publico/:token" element={<FarmaciaPainelPublico />} />
          <Route path="/farmacia/painel-tv/:token" element={<FarmaciaPainelPublico />} />
          <Route path="/fila-exames" element={
            <Protected>
              <GuardQualquer telas={["tfd_exames", "tfd_fila_lancamento", "tfd_medico", "tfd"]}>
                <Shell>
                  <FilaExames />
                </Shell>
              </GuardQualquer>
            </Protected>
          } />
          <Route path="/solicitacoes/nova" element={<Navigate to="/tfd/solicitacoes/nova" replace />} />
          <Route path="/solicitacoes" element={<Navigate to="/fila-exames" replace />} />
          <Route path="/painel-medico" element={
            <Protected>
              <Guard tela="tfd_medico">
                <Shell>
                  <PainelMedico />
                </Shell>
              </Guard>
            </Protected>
          } />
          <Route
            path="/"
            element={
              <Protected>
                <Shell>
                  <Dashboard />
                </Shell>
              </Protected>
            }
          />
          <Route
            path="/indicadores"
            element={
              <Protected>
                <Guard tela="dash_indicadores">
                  <Shell>
                    <Indicadores />
                  </Shell>
                </Guard>
              </Protected>
            }
          />
          <Route
            path="/usuarios"
            element={
              <Protected>
                <Guard tela="usuarios">
                  <Shell>
                    <Usuarios />
                  </Shell>
                </Guard>
              </Protected>
            }
          />
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
            <Route path="faturamento" element={<LabGuard tela="lab_faturamento"><LabFaturamento /></LabGuard>} />
            <Route path="sigtap" element={<LabGuard tela="lab_sigtap"><LabSigtap /></LabGuard>} />
          </Route>
          <Route
            path="/sigtap"
            element={
              <Protected>
                <GuardQualquer telas={["lab_sigtap", "tfd_catalogo", "tfd", "lab", "usuarios", "cfg_geral"]}>
                  <Shell>
                    <LabSigtap />
                  </Shell>
                </GuardQualquer>
              </Protected>
            }
          />
          <Route
            path="/aps"
            element={
              <Protected>
                <Guard tela="aps">
                  <Shell>
                    <ApsPainel />
                  </Shell>
                </Guard>
              </Protected>
            }
          />
          <Route
            path="/apac/solicitacoes"
            element={
              <Protected>
                <Guard tela="apac_solicitacao">
                  <Shell>
                    <ApacSolicitacao />
                  </Shell>
                </Guard>
              </Protected>
            }
          />
          <Route
            path="/apac/regulacao"
            element={
              <Protected>
                <Guard tela="apac_regulacao">
                  <Shell>
                    <ApacRegulacao />
                  </Shell>
                </Guard>
              </Protected>
            }
          />
          <Route
            path="/apac/faturamento"
            element={
              <Protected>
                <Guard tela="apac_faturamento">
                  <Shell>
                    <ApacFaturamento />
                  </Shell>
                </Guard>
              </Protected>
            }
          />
          <Route
            path="/oxigenio"
            element={
              <Protected>
                <GuardQualquer telas={["oxigenio_estoque", "oxigenio", "usuarios"]}>
                  <Shell>
                    <OxigenioPainelEstoque />
                  </Shell>
                </GuardQualquer>
              </Protected>
            }
          />
          <Route
            path="/oxigenio/equipamentos"
            element={
              <Protected>
                <GuardQualquer telas={["oxigenio_equipamentos", "oxigenio", "usuarios"]}>
                  <Shell>
                    <OxigenioEquipamentos />
                  </Shell>
                </GuardQualquer>
              </Protected>
            }
          />
          <Route
            path="/oxigenio/emprestimos"
            element={
              <Protected>
                <GuardQualquer telas={["oxigenio_emprestimos", "oxigenio", "usuarios"]}>
                  <Shell>
                    <OxigenioEmprestimos />
                  </Shell>
                </GuardQualquer>
              </Protected>
            }
          />
          <Route
            path="/oxigenio/empresas"
            element={
              <Protected>
                <GuardQualquer telas={["oxigenio_empresas", "oxigenio", "usuarios"]}>
                  <Shell>
                    <OxigenioEmpresas />
                  </Shell>
                </GuardQualquer>
              </Protected>
            }
          />
          <Route
            path="/oxigenio/relatorios"
            element={
              <Protected>
                <GuardQualquer telas={["oxigenio_relatorios", "oxigenio", "usuarios"]}>
                  <Shell>
                    <OxigenioRequisicaoAF />
                  </Shell>
                </GuardQualquer>
              </Protected>
            }
          />
          <Route
            path="/farmacia"
            element={
              <Protected>
                <GuardQualquer telas={["farmacia_estoque", "farmacia", "usuarios"]}>
                  <Shell>
                    <FarmaciaEstoque />
                  </Shell>
                </GuardQualquer>
              </Protected>
            }
          />
          <Route
            path="/farmacia/validade"
            element={
              <Protected>
                <GuardQualquer telas={["farmacia_validade", "farmacia", "usuarios"]}>
                  <Shell>
                    <FarmaciaValidade />
                  </Shell>
                </GuardQualquer>
              </Protected>
            }
          />
          <Route
            path="/farmacia/links"
            element={
              <Protected>
                <GuardQualquer telas={["farmacia_links", "farmacia", "usuarios"]}>
                  <Shell>
                    <FarmaciaLinks />
                  </Shell>
                </GuardQualquer>
              </Protected>
            }
          />
          <Route
            path="/farmacia/insumos"
            element={
              <Protected>
                <GuardQualquer telas={["farmacia_insumos", "farmacia", "usuarios"]}>
                  <Shell>
                    <FarmaciaInsumos />
                  </Shell>
                </GuardQualquer>
              </Protected>
            }
          />
          <Route path="/integracoes" element={<Navigate to="/configuracoes" replace />} />
          <Route
            path="/auditoria"
            element={
              <Protected>
                <GuardQualquer telas={["auditoria", "usuarios"]}>
                  <Shell>
                    <Auditoria />
                  </Shell>
                </GuardQualquer>
              </Protected>
            }
          />
          <Route
            path="/configuracoes"
            element={
              <Protected>
                <ConfigGuard>
                  <Shell>
                    <Configuracoes />
                  </Shell>
                </ConfigGuard>
              </Protected>
            }
          />
              {/* Rotas legadas: redirecionam p/ as abas em Configurações. */}
              <Route path="/admin/medicos" element={<Navigate to="/configuracoes?aba=medicos" replace />} />
              <Route path="/admin/psfs" element={<Navigate to="/configuracoes?aba=unidades" replace />} />
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
