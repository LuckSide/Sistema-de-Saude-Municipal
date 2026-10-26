import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { fetchMe, login as apiLogin, type Usuario } from "../services/api";
import { concedida } from "../permissoes";

type AuthCtx = {
  user: Usuario | null;
  loading: boolean;
  login: (u: string, p: string) => Promise<void>;
  logout: () => void;
  refreshMe: () => Promise<Usuario>;
  can: (tela: string) => boolean;
  /** Perfil Médico: tela tfd_medico explícita (exclusiva) ou superuser. */
  isMedico: boolean;
  /** Perfil de lançamento restrito (sem urgente/agendamento direto). */
  isLancamentoRestrito: boolean;
  /** Perfil Central TFD (pode escolher qualquer unidade e data). */
  isTfdCentral: boolean;
  /** Perfil PSF (restrito à sua unidade e data de hoje). */
  isPsf: boolean;
  /** Trava de lançamentos retroativos (data < hoje), salvo flag ou superuser. */
  retroativoBloqueado: boolean;
  /** Permissão para alterar viagens em datas passadas. */
  podeEditarPassadas: boolean;
  /** Pode alterar prioridade/justificativa deste pedido (superuser ou médico envolvido). */
  podeAlterarPrioridade: (medicoIdDoPedido?: number | null) => boolean;
  precisaTrocarSenha: boolean;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Usuario | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("guape:token");
    if (!token) {
      setLoading(false);
      return;
    }
    fetchMe()
      .then(setUser)
      .catch(() => localStorage.removeItem("guape:token"))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (u: string, p: string) => {
    const { token, must_change_password } = await apiLogin(u, p);
    localStorage.setItem("guape:token", token);
    const me = await fetchMe();
    setUser({ ...me, must_change_password: me.must_change_password || must_change_password });
  }, []);

  const refreshMe = useCallback(async () => {
    const me = await fetchMe();
    setUser(me);
    return me;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("guape:token");
    setUser(null);
  }, []);

  const can = useCallback(
    (tela: string) => {
      if (!user) return false;
      if (user.is_superuser) return true;
      return concedida(user.telas, tela);
    },
    [user]
  );

  const precisaTrocarSenha = !!user?.must_change_password;

  const isMedico = !!user && (user.is_superuser || concedida(user.telas, "tfd_medico"));

  /** Perfil de lançamento restrito: pode adicionar à fila, mas não pode setar urgente nem agendar direto. */
  const isLancamentoRestrito = !!user && !user.is_superuser && concedida(user.telas, "tfd_fila_lancamento") && !concedida(user.telas, "tfd_medico");

  /** Perfil TFD Central: superusuário ou permissão central sem restrição a PSF. */
  const isTfdCentral = !!user && (user.is_superuser || (concedida(user.telas, "tfd") && !concedida(user.telas, "tfd_fila_lancamento")));

  /** Perfil PSF: lotado em unidade de saúde e não pertencente à central TFD. */
  const isPsf = !!user && !isTfdCentral && !!user.unidade_saude_id;

  const retroativoBloqueado = !!user && !user.is_superuser && user.permite_retroativo === false;

  const podeEditarPassadas = !!user && (user.is_superuser || (user.permite_retroativo !== false && (concedida(user.telas, "tfd_viagens_passadas") || concedida(user.telas, "usuarios"))));

  const podeAlterarPrioridade = useCallback(
    (medicoIdDoPedido?: number | null) => {
      if (!user) return false;
      if (user.is_superuser) return true;
      if (!concedida(user.telas, "tfd_medico")) return false;
      if (!user.medico_id) return false;
      return (medicoIdDoPedido ?? null) === user.medico_id;
    },
    [user]
  );

  const value = useMemo(
    () => ({ user, loading, login, logout, refreshMe, can, isMedico, isLancamentoRestrito, isTfdCentral, isPsf, retroativoBloqueado, podeEditarPassadas, podeAlterarPrioridade, precisaTrocarSenha }),
    [user, loading, login, logout, refreshMe, can, isMedico, isLancamentoRestrito, isTfdCentral, isPsf, retroativoBloqueado, podeEditarPassadas, podeAlterarPrioridade, precisaTrocarSenha]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth fora do AuthProvider");
  return ctx;
}
