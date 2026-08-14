import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import apiClient from "../services/apiClient";
import {
  completeOnboarding as completeOnboardingApi,
  fetchSourcePreferences,
  updateSourceStatus as updateSourceStatusApi,
} from "../services/sourcePreferencesService";
import type {
  SourceId,
  SourcePreferencesMap,
  SourceStatus,
} from "../types/sourcePreferences";

interface UserProfile {
  display_name: string | null;
  avatar_url: string | null;
  timezone: string;
  locale: string;
  onboarding_completed?: boolean;
  source_preferences?: SourcePreferencesMap;
}

interface AuthUser {
  id: string;
  email: string;
  is_email_verified: boolean;
  onboarding_completed: boolean;
  profile: UserProfile | null;
  source_preferences: SourcePreferencesMap | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  register: (email: string, password: string, fullName: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<AuthUser | null>;
  completeOnboarding: (selectedSources: SourceId[]) => Promise<void>;
  updateSourcePreference: (sourceId: SourceId, status: SourceStatus) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function normalizeUser(data: {
  id: string;
  email: string;
  is_email_verified: boolean;
  onboarding_completed?: boolean;
  profile?: UserProfile | null;
}): AuthUser {
  const profile = data.profile ?? null;
  return {
    id: data.id,
    email: data.email,
    is_email_verified: data.is_email_verified,
    onboarding_completed:
      data.onboarding_completed ?? profile?.onboarding_completed ?? false,
    profile,
    source_preferences: (profile?.source_preferences as SourcePreferencesMap | undefined) ?? null,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const clearSession = useCallback(() => {
    sessionStorage.removeItem("access_token");
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    localStorage.removeItem("sentiora_auth_session");
    window.postMessage({ type: "SENTIORA_AUTH_LOGOUT" }, "*");
    setUser(null);
  }, []);

  const hydrateSourcePreferences = useCallback(async (currentUser: AuthUser): Promise<AuthUser> => {
    try {
      const prefs = await fetchSourcePreferences();
      const nextUser: AuthUser = {
        ...currentUser,
        onboarding_completed: prefs.onboarding_completed,
        source_preferences: prefs.sources,
        profile: currentUser.profile
          ? {
              ...currentUser.profile,
              onboarding_completed: prefs.onboarding_completed,
              source_preferences: prefs.sources,
            }
          : null,
      };
      setUser(nextUser);
      return nextUser;
    } catch {
      return currentUser;
    }
  }, []);

  const fetchCurrentUser = useCallback(async (): Promise<AuthUser | null> => {
    try {
      const response = await apiClient.get<{ success: boolean; data: AuthUser }>(
        "/users/me",
      );
      const currentUser = normalizeUser(response.data.data);
      setUser(currentUser);

      const accessToken = sessionStorage.getItem("access_token") || localStorage.getItem("access_token");
      const refreshToken = localStorage.getItem("refresh_token");
      if (accessToken && refreshToken) {
        const sessionData = {
          accessToken,
          refreshToken,
          user: {
            id: currentUser.id,
            email: currentUser.email,
            is_email_verified: currentUser.is_email_verified,
            onboarding_completed: currentUser.onboarding_completed,
          },
        };
        localStorage.setItem("sentiora_auth_session", JSON.stringify(sessionData));
        window.postMessage({ type: "SENTIORA_AUTH_SYNC", ...sessionData }, "*");
        window.dispatchEvent(new CustomEvent("sentiora_auth_sync", { detail: sessionData }));
      }

      return hydrateSourcePreferences(currentUser);
    } catch {
      clearSession();
      return null;
    }
  }, [clearSession, hydrateSourcePreferences]);

  useEffect(() => {
    const initAuth = async () => {
      let token = sessionStorage.getItem("access_token") || localStorage.getItem("access_token");
      const refreshToken = localStorage.getItem("refresh_token");

      if (!token && refreshToken) {
        try {
          const resp = await apiClient.post<{
            success: boolean;
            data: { access_token: string; refresh_token: string };
          }>("/auth/refresh-token", { refresh_token: refreshToken });
          const { access_token, refresh_token: newRefreshToken } = resp.data.data;
          sessionStorage.setItem("access_token", access_token);
          localStorage.setItem("access_token", access_token);
          localStorage.setItem("refresh_token", newRefreshToken);
          token = access_token;
        } catch {
          clearSession();
          setIsLoading(false);
          return;
        }
      }

      if (token) {
        fetchCurrentUser().finally(() => setIsLoading(false));
      } else {
        setIsLoading(false);
      }
    };

    initAuth();
  }, [fetchCurrentUser, clearSession]);

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
    localStorage.setItem("access_token", access_token);
    localStorage.setItem("refresh_token", refresh_token);

    const currentUser = await fetchCurrentUser();
    if (!currentUser) {
      throw new Error("Unable to load user profile after login.");
    }
    return currentUser;
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

  const completeOnboarding = useCallback(
    async (selectedSources: SourceId[]) => {
      const prefs = await completeOnboardingApi(selectedSources);
      setUser((prev) =>
        prev
          ? {
              ...prev,
              onboarding_completed: prefs.onboarding_completed,
              source_preferences: prefs.sources,
              profile: prev.profile
                ? {
                    ...prev.profile,
                    onboarding_completed: prefs.onboarding_completed,
                    source_preferences: prefs.sources,
                  }
                : null,
            }
          : prev,
      );
    },
    [],
  );

  const updateSourcePreference = useCallback(
    async (sourceId: SourceId, status: SourceStatus) => {
      const prefs = await updateSourceStatusApi(sourceId, status);
      setUser((prev) =>
        prev
          ? {
              ...prev,
              onboarding_completed: prefs.onboarding_completed,
              source_preferences: prefs.sources,
              profile: prev.profile
                ? {
                    ...prev.profile,
                    onboarding_completed: prefs.onboarding_completed,
                    source_preferences: prefs.sources,
                  }
                : null,
            }
          : prev,
      );
    },
    [],
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        register,
        logout,
        refreshUser: fetchCurrentUser,
        completeOnboarding,
        updateSourcePreference,
      }}
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
