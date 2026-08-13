import React, { useState } from "react";
import { extApiFetch, ExtApiError } from "../services/extApiClient";
import {
  setAccessToken,
  setRefreshToken,
  setCachedUser,
} from "../services/storage";

interface PopupAuthProps {
  onAuthChange: (authenticated: boolean) => void;
}

export default function PopupAuth({ onAuthChange }: PopupAuthProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) {
      setError("Please fill in all required fields.");
      return;
    }

    if (mode === "register") {
      if (password.length < 10) {
        setError("Password must be at least 10 characters long.");
        return;
      }
      if (!/[A-Z]/.test(password)) {
        setError("Password must contain at least one uppercase letter (A-Z).");
        return;
      }
      if (!/[0-9]/.test(password)) {
        setError("Password must contain at least one number (0-9).");
        return;
      }
    }

    setIsLoading(true);
    setError(null);

    try {
      if (mode === "register") {
        await extApiFetch("/auth/register", {
          method: "POST",
          body: JSON.stringify({
            email,
            password,
            full_name: fullName || "Vault User",
          }),
        });
      }

      const loginResp = await extApiFetch<{
        access_token: string;
        refresh_token: string;
        user: { id: string; email: string; is_email_verified: boolean };
      }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });

      const { access_token, refresh_token, user } = loginResp.data;
      await setAccessToken(access_token);
      await setRefreshToken(refresh_token);
      await setCachedUser({
        id: user.id,
        email: user.email,
        is_email_verified: user.is_email_verified ?? false,
      });

      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({
          type: "SYNC_AUTH_TOKENS",
          payload: {
            accessToken: access_token,
            refreshToken: refresh_token,
            user: {
              id: user.id,
              email: user.email,
              is_email_verified: user.is_email_verified ?? false,
            },
          },
        });
      }

      onAuthChange(true);
    } catch (err) {
      if (err instanceof ExtApiError) {
        if (err.code === "AUTH_INVALID_CREDENTIALS") {
          setError("Invalid email or password. If you haven't created an account, click 'Create Account' above.");
        } else if (err.code === "AUTH_EMAIL_ALREADY_EXISTS" || err.code === "AUTH_EMAIL_EXISTS") {
          setError("An account with this email address already exists. Switch to 'Sign In'.");
        } else {
          setError(err.message || "Authentication request failed.");
        }
      } else {
        setError("Unable to connect to backend server. Ensure http://localhost:8000 is online.");
      }
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="space-y-3.5 font-sans text-[#1F2421]">
      {/* Segmented Auth Mode Switcher */}
      <div className="flex bg-white/80 p-1 rounded-2xl border border-[#E5DFD0] shadow-xs">
        <button
          type="button"
          onClick={() => {
            setMode("login");
            setError(null);
          }}
          className={`flex-1 py-1.5 text-xs font-bold rounded-xl transition-all ${
            mode === "login"
              ? "bg-[#2C6F54] text-white shadow-xs"
              : "text-[#60706A] hover:text-[#1F2421]"
          }`}
        >
          Sign In
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("register");
            setError(null);
          }}
          className={`flex-1 py-1.5 text-xs font-bold rounded-xl transition-all ${
            mode === "register"
              ? "bg-[#2C6F54] text-white shadow-xs"
              : "text-[#60706A] hover:text-[#1F2421]"
          }`}
        >
          Create Account
        </button>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl p-2.5 text-center font-medium leading-relaxed shadow-xs">
          ⚠️ {error}
        </div>
      )}

      <form onSubmit={handleAuth} className="space-y-2.5">
        {mode === "register" && (
          <div>
            <label className="block text-[11px] font-bold text-[#1F2421] mb-1">
              Full Name
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full bg-white border border-[#E5DFD0] rounded-xl px-3 py-2 text-xs text-[#1F2421] placeholder-[#9CA3AF] focus:outline-none focus:border-[#2C6F54] font-medium shadow-xs"
              placeholder="e.g. Jordan Miller"
            />
          </div>
        )}

        <div>
          <label className="block text-[11px] font-bold text-[#1F2421] mb-1">
            Email Address
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-white border border-[#E5DFD0] rounded-xl px-3 py-2 text-xs text-[#1F2421] placeholder-[#9CA3AF] focus:outline-none focus:border-[#2C6F54] font-medium shadow-xs"
            placeholder="jordan@example.com"
            required
          />
        </div>

        <div>
          <label className="block text-[11px] font-bold text-[#1F2421] mb-1">
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-white border border-[#E5DFD0] rounded-xl px-3 py-2 text-xs text-[#1F2421] placeholder-[#9CA3AF] focus:outline-none focus:border-[#2C6F54] font-medium shadow-xs"
            placeholder="••••••••••"
            required
          />
          {mode === "register" && (
            <p className="text-[10px] text-[#60706A] mt-1 font-medium">
              Min 10 chars, 1 uppercase (A-Z), and 1 number (0-9).
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full bg-[#2C6F54] hover:bg-[#235943] disabled:opacity-50 text-white font-bold rounded-xl py-2.5 text-xs transition-all shadow-md active:scale-[0.99] mt-1"
        >
          {isLoading
            ? mode === "login"
              ? "Signing in..."
              : "Creating Account..."
            : mode === "login"
            ? "Sign In to Vault"
            : "Create Vault Account"}
        </button>
      </form>
    </div>
  );
}
