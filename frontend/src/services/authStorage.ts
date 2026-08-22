const ACCESS_TOKEN_KEY = "access_token";
const REFRESH_TOKEN_KEY = "refresh_token";
const AUTH_SESSION_KEY = "sentiora_auth_session";

export interface AuthSessionUser {
  id: string;
  email: string;
  is_email_verified?: boolean;
  onboarding_completed?: boolean;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  user?: AuthSessionUser;
}

function persistExtensionBridge(session: AuthSession | null): void {
  if (!session) {
    localStorage.removeItem(AUTH_SESSION_KEY);
    return;
  }
  localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
}

export function getAccessToken(): string | null {
  return sessionStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setAuthTokens(accessToken: string, refreshToken: string, user?: AuthSessionUser): void {
  sessionStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  persistExtensionBridge({
    accessToken,
    refreshToken,
    user,
  });
}

export function updateAccessToken(accessToken: string): void {
  const refreshToken = getRefreshToken();
  sessionStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  if (refreshToken) {
    persistExtensionBridge({
      accessToken,
      refreshToken,
    });
  }
}

export function clearAuthStorage(): void {
  sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  persistExtensionBridge(null);
}

export function broadcastAuthSync(session: AuthSession): void {
  const origin = window.location.origin;
  window.postMessage({ type: "SENTIORA_AUTH_SYNC", ...session }, origin);
  window.dispatchEvent(new CustomEvent("sentiora_auth_sync", { detail: session }));
}

export function broadcastAuthLogout(): void {
  const origin = window.location.origin;
  window.postMessage({ type: "SENTIORA_AUTH_LOGOUT" }, origin);
}
