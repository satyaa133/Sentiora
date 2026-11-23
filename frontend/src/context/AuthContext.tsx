import { PRIVACY_NOTICE_VERSION } from "@shared/ui";
import { resetPrivacyConsentCache } from "../hooks/usePrivacyConsent";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import apiClient, { refreshAccessToken } from "../services/apiClient";
import {
  broadcastAuthLogout,
  clearAuthStorage,
  getAccessToken,
  getRefreshToken,
  getStoredSession,
  setAuthTokens,
} from "../services/authStorage";
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
  register: (email: string, password: string, fullName: string) => Promise<boolean>;
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
    clearAuthStorage();
    resetPrivacyConsentCache();
    broadcastAuthLogout();
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

      const accessToken = getAccessToken();
      const refreshToken = getRefreshToken();
      if (accessToken && refreshToken) {
        const userSession = {
          id: currentUser.id,
          email: currentUser.email,
          is_email_verified: currentUser.is_email_verified,
          onboarding_completed: currentUser.onboarding_completed,
        };
        const storedSession = getStoredSession();
        if (
          storedSession?.accessToken !== accessToken ||
          storedSession.refreshToken !== refreshToken ||
          storedSession.user?.id !== userSession.id ||
          storedSession.user?.email !== userSession.email ||
          storedSession.user?.is_email_verified !== userSession.is_email_verified ||
          storedSession.user?.onboarding_completed !== userSession.onboarding_completed
        ) {
          setAuthTokens(accessToken, refreshToken, userSession);
        }
      }

      return hydrateSourcePreferences(currentUser);
    } catch {
      clearSession();
      return null;
    }
  }, [clearSession, hydrateSourcePreferences]);

  useEffect(() => {
    const initAuth = async () => {
      let token = getAccessToken();
      const refreshToken = getRefreshToken();

      if (!token && refreshToken) {
        try {
          // Shared with the 401 interceptor so StrictMode's double effect run
          // (or a concurrent 401) cannot rotate the same refresh token twice.
          token = await refreshAccessToken();
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

  useEffect(() => {
    const handleAuthSync = async (sessionData: {
      accessToken?: string;
      refreshToken?: string;
      user?: unknown;
    }) => {
      if (sessionData?.accessToken && sessionData?.refreshToken) {
        const user = sessionData.user as {
          id?: string;
          email?: string;
          is_email_verified?: boolean;
          onboarding_completed?: boolean;
        } | undefined;
        const storedSession = getStoredSession();
        if (
          getAccessToken() === sessionData.accessToken &&
          getRefreshToken() === sessionData.refreshToken &&
          storedSession?.user?.id === user?.id &&
          storedSession?.user?.email === user?.email &&
          storedSession?.user?.is_email_verified === user?.is_email_verified &&
          storedSession?.user?.onboarding_completed === user?.onboarding_completed
        ) {
          return;
        }
        setAuthTokens(
          sessionData.accessToken,
          sessionData.refreshToken,
          user as { id: string; email: string; is_email_verified?: boolean; onboarding_completed?: boolean } | undefined,
        );
        await fetchCurrentUser();
      }
    };

    const handleCustomSync = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) void handleAuthSync(detail);
    };

    const handleMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === "SENTIORA_AUTH_SYNC") {
        void handleAuthSync(e.data);
      } else if (e.data?.type === "SENTIORA_AUTH_LOGOUT") {
        clearSession();
      }
    };

    const handleStorage = (e: StorageEvent) => {
      if (e.key === "sentiora_auth_session") {
        if (!e.newValue) {
          clearSession();
        } else {
          try {
            const parsed = JSON.parse(e.newValue);
            void handleAuthSync(parsed);
          } catch {
            /* ignore */
          }
        }
      }
    };

    window.addEventListener("sentiora_auth_sync", handleCustomSync);
    window.addEventListener("message", handleMessage);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener("sentiora_auth_sync", handleCustomSync);
      window.removeEventListener("message", handleMessage);
      window.removeEventListener("storage", handleStorage);
    };
  }, [fetchCurrentUser, clearSession]);

  const login = useCallback(async (email: string, password: string) => {
    const response = await apiClient.post<{
      success: boolean;
      data: { access_token: string; refresh_token: string };
    }>("/auth/login", { email, password });

    const { access_token, refresh_token } = response.data.data;
    setAuthTokens(access_token, refresh_token);

    const currentUser = await fetchCurrentUser();
    if (!currentUser) {
      throw new Error("Unable to load user profile after login.");
    }
    return currentUser;
  }, [fetchCurrentUser]);

  const register = useCallback(
    async (email: string, password: string, fullName: string) => {
      const response = await apiClient.post<{
        data: { email_verified: boolean };
      }>("/auth/register", {
        email,
        password,
        full_name: fullName,
        // The notice shown on the sign-up page (D10); the API stores it.
        privacy_consent_version: PRIVACY_NOTICE_VERSION,
      });
      const emailVerified = response.data.data.email_verified;
      if (emailVerified) await login(email, password);
      return emailVerified;
    },
    [login],
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
