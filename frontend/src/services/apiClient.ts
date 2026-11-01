import axios, { type AxiosError } from "axios";
import {
  broadcastAuthSync,
  clearAuthStorage,
  getAccessToken,
  getRefreshToken,
  getStoredSession,
  setAuthTokens,
} from "./authStorage";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

/** Success envelope returned by every Sentiora API endpoint. */
export interface APIEnvelope<T> {
  success: boolean;
  data: T;
}

const apiClient = axios.create({
  baseURL: `${API_BASE_URL}/api/v1`,
  headers: { "Content-Type": "application/json" },
  withCredentials: false,
});

// Attach access token on every request
apiClient.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let refreshInFlight: Promise<string> | null = null;

/**
 * Rotates the refresh token and returns a new access token.
 *
 * The backend treats a reused refresh token as theft and revokes every session,
 * so a token must never be spent twice. Callers in this tab share one request,
 * and a Web Lock serialises refreshes across tabs (all tabs read the same
 * refresh token from localStorage).
 */
export function refreshAccessToken(): Promise<string> {
  if (!refreshInFlight) {
    const tokenBeforeWaiting = getRefreshToken();
    refreshInFlight = withCrossTabLock(() => rotateTokens(tokenBeforeWaiting)).finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

function withCrossTabLock<T>(task: () => Promise<T>): Promise<T> {
  // Supported by all current browsers; without it only same-tab callers are coordinated.
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks) return task();
  // request() resolves with the task's own result; TS's DOM typings nest the promise.
  return locks.request("sentiora-token-refresh", task) as unknown as Promise<T>;
}

async function rotateTokens(tokenBeforeWaiting: string | null): Promise<string> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    throw new Error("No refresh token");
  }

  // Another tab rotated the token while this one waited for the lock: use its
  // result rather than spending a token the backend has already revoked.
  const shared = getStoredSession();
  if (refreshToken !== tokenBeforeWaiting && shared?.refreshToken === refreshToken) {
    setAuthTokens(shared.accessToken, shared.refreshToken, shared.user);
    return shared.accessToken;
  }

  const response = await axios.post<
    APIEnvelope<{ access_token: string; refresh_token: string }>
  >(`${API_BASE_URL}/api/v1/auth/refresh-token`, { refresh_token: refreshToken });
  const { access_token, refresh_token: newRefreshToken } = response.data.data;
  const user = shared?.user;
  setAuthTokens(access_token, newRefreshToken, user);
  // The extension holds its own copy of the refresh token; hand it the new one.
  broadcastAuthSync({ accessToken: access_token, refreshToken: newRefreshToken, user });
  return access_token;
}

// Auth endpoints answer 401 for bad credentials or tokens; retrying them is pointless.
const NO_RETRY_PATHS = ["/auth/login", "/auth/register", "/auth/refresh-token", "/auth/logout"];

// On 401: attempt a single silent refresh, then force re-login
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as typeof error.config & { _retry?: boolean };
    const requestUrl = originalRequest?.url ?? "";

    if (
      error.response?.status !== 401 ||
      !originalRequest ||
      originalRequest._retry ||
      NO_RETRY_PATHS.some((path) => requestUrl.includes(path))
    ) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;
    try {
      const accessToken = await refreshAccessToken();
      originalRequest.headers.Authorization = `Bearer ${accessToken}`;
      return apiClient(originalRequest);
    } catch (refreshError) {
      clearAuthStorage();
      window.dispatchEvent(new Event("auth:logout"));
      return Promise.reject(refreshError);
    }
  },
);

export function getApiErrorMessage(err: unknown, fallback: string): string {
  if (!err || typeof err !== "object") {
    return fallback;
  }
  // No response at all: the request never reached the API (offline, server down, CORS).
  if (axios.isAxiosError(err) && !err.response) {
    return "Could not reach the Sentiora server. Check your connection and try again.";
  }
  if ("response" in err && err.response && typeof err.response === "object") {
    const response = err.response as {
      status?: number;
      data?: { error?: { code?: string; message?: string } };
    };
    const code = response.data?.error?.code;
    const message = response.data?.error?.message;
    if (response.status === 429 || code === "RATE_LIMITED" || code === "AUTH_LOGIN_THROTTLED") {
      return message || "Too many attempts. Please wait a moment and try again.";
    }
    if (code === "AUTH_INVALID_CREDENTIALS") {
      return "Invalid email or password. Please try again.";
    }
    if (code === "AUTH_EMAIL_ALREADY_EXISTS") {
      return "An account with this email already exists.";
    }
    if (response.status && response.status >= 500) {
      return message || "The Sentiora server ran into a problem. Please try again in a moment.";
    }
    if (message) {
      return message;
    }
  }
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return fallback;
}

export default apiClient;
