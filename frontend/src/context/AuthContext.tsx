import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import apiClient from "../services/apiClient";

interface UserProfile {
  display_name: string | null;
  avatar_url: string | null;
  timezone: string;
  locale: string;
}

interface AuthUser {
  id: string;
  email: string;
  is_email_verified: boolean;
  profile: UserProfile | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, fullName: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const clearSession = useCallback(() => {
    sessionStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    localStorage.removeItem("sentiora_auth_session");
    window.postMessage({ type: "SENTIORA_AUTH_LOGOUT" }, "*");
    setUser(null);
  }, []);

  const fetchCurrentUser = useCallback(async () => {
    try {
      const response = await apiClient.get<{ success: boolean; data: AuthUser }>(
        "/users/me",
      );
      const currentUser = response.data.data;
      setUser(currentUser);

      const accessToken = sessionStorage.getItem("access_token");
      const refreshToken = localStorage.getItem("refresh_token");
      if (accessToken && refreshToken && currentUser) {
        const sessionData = {
          accessToken,
          refreshToken,
          user: {
            id: currentUser.id,
            email: currentUser.email,
            is_email_verified: currentUser.is_email_verified,
          },
        };
        localStorage.setItem("sentiora_auth_session", JSON.stringify(sessionData));
        window.postMessage({ type: "SENTIORA_AUTH_SYNC", ...sessionData }, "*");
      }
    } catch {
      clearSession();
    }
  }, [clearSession]);

  useEffect(() => {
    const token = sessionStorage.getItem("access_token");
    if (token) {
      fetchCurrentUser().finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, [fetchCurrentUser]);

  useEffect(() => {
    const handleLogout = () => clearSession();
    window.addEventListener("auth:logout", handleLogout);
    return () => window.removeEventListener("auth:logout", handleLogout);
  }, [clearSession]);

  const login = useCallback(async (email: string, password: string) => {
    const response = await apiClient.post<{
      success: boolean;
      data: { access_token: string; refresh_token: string };
    }>("/auth/login", { email, password });

    const { access_token, refresh_token } = response.data.data;
    sessionStorage.setItem("access_token", access_token);
    localStorage.setItem("refresh_token", refresh_token);

    await fetchCurrentUser();
  }, [fetchCurrentUser]);

  const register = useCallback(
    async (email: string, password: string, fullName: string) => {
      await apiClient.post("/auth/register", {
        email,
        password,
        full_name: fullName,
      });
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await apiClient.post("/auth/logout");
    } finally {
      clearSession();
    }
  }, [clearSession]);

  return (
    <AuthContext.Provider
      value={{ user, isAuthenticated: !!user, isLoading, login, register, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within <AuthProvider>");
  }
  return ctx;
}
