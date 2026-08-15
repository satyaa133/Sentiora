import axios, { type AxiosError } from "axios";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

const apiClient = axios.create({
  baseURL: `${API_BASE_URL}/api/v1`,
  headers: { "Content-Type": "application/json" },
  withCredentials: false,
});

// Attach access token on every request
apiClient.interceptors.request.use((config) => {
  const token = sessionStorage.getItem("access_token") || localStorage.getItem("access_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// On 401: attempt a single silent refresh, then force re-login
let isRefreshing = false;
type FailedRequest = {
  resolve: (token: string) => void;
  reject: (err: unknown) => void;
};
let failedQueue: FailedRequest[] = [];

function processQueue(error: unknown, token: string | null = null) {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else if (token) {
      prom.resolve(token);
    }
  });
  failedQueue = [];
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as typeof error.config & { _retry?: boolean };

    if (error.response?.status === 401 && !originalRequest?._retry) {
      const requestUrl = originalRequest?.url ?? "";
      if (requestUrl.includes("/auth/login") || requestUrl.includes("/auth/register")) {
        return Promise.reject(error);
      }
      if (isRefreshing) {
        return new Promise<string>((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            if (originalRequest) {
              originalRequest.headers = originalRequest.headers ?? {};
              originalRequest.headers.Authorization = `Bearer ${token}`;
            }
            return apiClient(originalRequest!);
          })
          .catch((err) => Promise.reject(err));
      }

      if (originalRequest) originalRequest._retry = true;
      isRefreshing = true;

      const refreshToken = localStorage.getItem("refresh_token");
      if (!refreshToken) {
        isRefreshing = false;
        window.dispatchEvent(new Event("auth:logout"));
        return Promise.reject(error);
      }

      try {
        const response = await axios.post(`${API_BASE_URL}/api/v1/auth/refresh-token`, {
          refresh_token: refreshToken,
        });
        const { access_token, refresh_token: newRefreshToken } = response.data.data;
        sessionStorage.setItem("access_token", access_token);
        localStorage.setItem("access_token", access_token);
        localStorage.setItem("refresh_token", newRefreshToken);

        processQueue(null, access_token);
        if (originalRequest) {
          originalRequest.headers = originalRequest.headers ?? {};
          originalRequest.headers.Authorization = `Bearer ${access_token}`;
        }
        return apiClient(originalRequest!);
      } catch (refreshError) {
        processQueue(refreshError, null);
        sessionStorage.removeItem("access_token");
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");
        window.dispatchEvent(new Event("auth:logout"));
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  },
);

export function getApiErrorMessage(err: unknown, fallback: string): string {
  if (!err || typeof err !== "object") {
    return fallback;
  }
  if ("response" in err && err.response && typeof err.response === "object") {
    const response = err.response as {
      status?: number;
      data?: { error?: { code?: string; message?: string } };
    };
    const code = response.data?.error?.code;
    const message = response.data?.error?.message;
    if (code === "AUTH_INVALID_CREDENTIALS") {
      return "Invalid email or password. Please try again.";
    }
    if (code === "AUTH_EMAIL_ALREADY_EXISTS") {
      return "An account with this email already exists.";
    }
    if (!response.status) {
      return "Could not reach the Sentiora server. Confirm it is running on port 8000.";
    }
    if (response.status >= 500) {
      return message || "The Sentiora server could not complete sign-in. Check that Postgres is running.";
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
