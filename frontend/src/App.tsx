import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { useCidadeDinamica } from "./hooks/useCidade";
import { Protected, Shell } from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Usuarios from "./pages/Usuarios";
import { Placeholder } from "./pages/Placeholder";
import TfdLayout from "./pages/tfd/TfdLayout";
import TfdResumo from "./pages/tfd/TfdResumo";
import TfdViagens from "./pages/tfd/TfdViagens";
import TfdPacientes from "./pages/tfd/TfdPacientes";
import TfdDestinos from "./pages/tfd/TfdDestinos";
import CatalogoExames from "./pages/tfd/CatalogoExames";
import TfdFrota from "./pages/tfd/TfdFrota";
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
import FilaExames from "./pages/tfd/FilaExames";
import Indicadores from "./pages/Indicadores";
import ApsPainel from "./pages/aps/ApsPainel";
import Configuracoes from "./pages/Configuracoes";

function Guard({ tela, children }: { tela: string; children: JSX.Element }) {
  const { can, loading } = useAuth();
  if (loading) return null;
  if (!can(tela)) return <Navigate to="/" replace />;
  return children;
}

function LabGuard({ tela, children }: { tela: string; children: JSX.Element }) {
  const { can, loading } = useAuth();
  if (loading) return null;
  const LAB_TELAS = ["lab", "lab_fila", "lab_agenda", "lab_vagas", "lab_audit"];
  if (tela === "lab") {
    if (!LAB_TELAS.some((t) => can(t))) return <Navigate to="/" replace />;
  } else if (!can("lab") && !can(tela)) {
    return <Navigate to="/" replace />;
  }
  return children;
}

function TfdRoutes() {
  return (
    <Protected>
      <Guard tela="tfd">
        <Shell>
          <TfdLayout />
        </Shell>
      </Guard>
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
      <AplicaCidade />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/alterar-senha-inicial" element={<AlterarSenhaInicial />} />
          <Route path="/acompanhar/:token" element={<AcompanharExame />} />
          <Route path="/fila-exames" element={
            <Protected>
              <Guard tela="tfd">
                <Shell>
                  <FilaExames />
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
                <Guard tela="dashboard">
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
            <Route index element={<TfdResumo />} />
            <Route path="viagens" element={<TfdViagens />} />
            <Route path="pacientes" element={<TfdPacientes />} />
            <Route path="exames" element={<Navigate to="/fila-exames" replace />} />
            <Route path="catalogo" element={<CatalogoExames />} />
            <Route path="destinos" element={<TfdDestinos />} />
            <Route path="frota" element={<TfdFrota />} />
            <Route path="faturamento" element={<TfdFaturamento />} />
          </Route>
          <Route path="/lab" element={<LabRoutes />}>
            <Route index element={<LabGuard tela="lab"><LabMarcacao /></LabGuard>} />
            <Route path="marcacao" element={<LabGuard tela="lab"><LabMarcacao /></LabGuard>} />
            <Route path="fila" element={<LabGuard tela="lab_fila"><FilaPsf /></LabGuard>} />
            <Route path="agenda" element={<LabGuard tela="lab_agenda"><VagasAgenda /></LabGuard>} />
            <Route path="vagas" element={<LabGuard tela="lab_vagas"><VagasAgenda /></LabGuard>} />
            <Route path="auditoria" element={<LabGuard tela="lab_audit"><AuditLab /></LabGuard>} />
            <Route path="faturamento" element={<LabGuard tela="lab"><LabFaturamento /></LabGuard>} />
            <Route path="sigtap" element={<LabGuard tela="lab"><LabSigtap /></LabGuard>} />
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
          <Route
            path="/integracoes"
            element={
              <Protected>
                <Guard tela="integracoes">
                  <Shell>
                    <Placeholder titulo="Integrações" />
                  </Shell>
                </Guard>
              </Protected>
            }
          />
          <Route
            path="/configuracoes"
            element={
              <Protected>
                <Guard tela="usuarios">
                  <Shell>
                    <Configuracoes />
                  </Shell>
                </Guard>
              </Protected>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

function AplicaCidade() {
  useCidadeDinamica();
  return null;
}
