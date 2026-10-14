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

type AuthCtx = {
  user: Usuario | null;
  loading: boolean;
  login: (u: string, p: string) => Promise<void>;
  logout: () => void;
  refreshMe: () => Promise<Usuario>;
  can: (tela: string) => boolean;
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
      return user.telas.includes(tela);
    },
    [user]
  );

  const precisaTrocarSenha = !!user?.must_change_password;

  const value = useMemo(
    () => ({ user, loading, login, logout, refreshMe, can, precisaTrocarSenha }),
    [user, loading, login, logout, refreshMe, can, precisaTrocarSenha]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth fora do AuthProvider");
  return ctx;
}
