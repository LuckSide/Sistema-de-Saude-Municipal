import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import type { ReactElement } from "react";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { UndoToastProvider } from "./components/UndoToast";
import { useCidadeDinamica } from "./hooks/useCidade";
import { Protected, Shell } from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Usuarios from "./pages/Usuarios";
import TfdLayout from "./pages/tfd/TfdLayout";
import TfdResumo from "./pages/tfd/TfdResumo";
import TfdViagens from "./pages/tfd/TfdViagens";
import TfdPacientes from "./pages/tfd/TfdPacientes";
import AgendaTfd from "./pages/tfd/AgendaTfd";
import QuadroViagens from "./pages/tfd/QuadroViagens";
import TfdDestinos from "./pages/tfd/TfdDestinos";
import CatalogoExames from "./pages/tfd/CatalogoExames";
import TfdFrota from "./pages/tfd/TfdFrota";
import TfdMotoristas from "./pages/tfd/TfdMotoristas";
import TfdFaturamento from "./pages/tfd/TfdFaturamento";
import AlterarSenhaInicial from "./pages/AlterarSenhaInicial";
import LabLayout from "./pages/lab/LabLayout";
import LabMarcacao from "./pages/lab/LabMarcacao";
import FilaPsf from "./pages/lab/FilaPsf";
import VagasAgenda from "./pages/lab/VagasAgenda";
import AuditLab from "./pages/lab/AuditLab";
import LabFaturamento from "./pages/lab/LabFaturamento";
import LabSigtap from "./pages/lab/LabSigtap";
import AcompanharExame from "./pages/AcompanharExame";
import Auditoria from "./pages/Auditoria";
import FilaExames from "./pages/tfd/FilaExames";
import Indicadores from "./pages/Indicadores";
import ApsPainel from "./pages/aps/ApsPainel";
import Configuracoes from "./pages/Configuracoes";
import PainelMedico from "./pages/PainelMedico";
import Medicos from "./pages/Medicos";
import UnidadesSaude from "./pages/UnidadesSaude";

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
  if (!can("usuarios") && !can("integracoes")) return <Navigate to="/" replace />;
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
  const LAB_TELAS = ["lab", "lab_marcacao", "lab_fila", "lab_agenda", "lab_vagas", "lab_audit", "lab_faturamento", "lab_sigtap"];
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
      <GuardQualquer telas={["tfd", "tfd_resumo", "tfd_viagens", "tfd_pacientes", "tfd_exames", "tfd_agenda", "tfd_catalogo", "tfd_destinos", "tfd_frota", "tfd_frota_gestao", "tfd_faturamento"]}>
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
      <AplicaCidade />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/alterar-senha-inicial" element={<AlterarSenhaInicial />} />
          <Route path="/acompanhar/:token" element={<AcompanharExame />} />
          <Route path="/fila-exames" element={
            <Protected>
              <Guard tela="tfd_exames">
                <Shell>
                  <FilaExames />
                </Shell>
              </Guard>
            </Protected>
          } />
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
            <Route path="viagens" element={<Guard tela="tfd_viagens"><TfdViagens /></Guard>} />
            <Route path="quadro" element={<GuardQualquer telas={["tfd_viagens", "tfd_frota_gestao"]}><QuadroViagens /></GuardQualquer>} />
            <Route path="pacientes" element={<Guard tela="tfd_pacientes"><TfdPacientes /></Guard>} />
            <Route path="agenda" element={<Guard tela="tfd_agenda"><AgendaTfd /></Guard>} />
            <Route path="exames" element={<Navigate to="/fila-exames" replace />} />
            <Route path="catalogo" element={<Guard tela="tfd_catalogo"><CatalogoExames /></Guard>} />
            <Route path="destinos" element={<Guard tela="tfd_destinos"><TfdDestinos /></Guard>} />
            <Route path="frota" element={<Guard tela="tfd_frota"><TfdFrota /></Guard>} />
            <Route path="motoristas" element={<Guard tela="tfd_frota"><TfdMotoristas /></Guard>} />
            <Route path="faturamento" element={<Guard tela="tfd_faturamento"><TfdFaturamento /></Guard>} />
          </Route>
          <Route path="/lab" element={<LabRoutes />}>
            <Route index element={<LabGuard tela="lab_marcacao"><LabMarcacao /></LabGuard>} />
            <Route path="marcacao" element={<LabGuard tela="lab_marcacao"><LabMarcacao /></LabGuard>} />
            <Route path="fila" element={<LabGuard tela="lab_fila"><FilaPsf /></LabGuard>} />
            <Route path="agenda" element={<LabGuard tela="lab_agenda" telas={["lab_agenda", "lab_vagas"]}><VagasAgenda /></LabGuard>} />
            <Route path="vagas" element={<LabGuard tela="lab_vagas"><VagasAgenda /></LabGuard>} />
            <Route path="auditoria" element={<LabGuard tela="lab_audit"><AuditLab /></LabGuard>} />
            <Route path="faturamento" element={<LabGuard tela="lab_faturamento"><LabFaturamento /></LabGuard>} />
            <Route path="sigtap" element={<LabGuard tela="lab_sigtap"><LabSigtap /></LabGuard>} />
          </Route>
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
          <Route path="/integracoes" element={<Navigate to="/configuracoes" replace />} />
          <Route
            path="/auditoria"
            element={
              <Protected>
                <Guard tela="usuarios">
                  <Shell>
                    <Auditoria />
                  </Shell>
                </Guard>
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
      </BrowserRouter>
      </UndoToastProvider>
    </AuthProvider>
  );
}

function AplicaCidade() {
  useCidadeDinamica();
  return null;
}
