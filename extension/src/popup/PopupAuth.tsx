import React, { useState } from "react";
import {
  Button,
  Echo,
  IconAlert,
  PRIVACY_NOTICE_TEXT,
  PRIVACY_NOTICE_VERSION,
  TextField,
  cx,
  isTrustedEmail,
} from "@shared/ui";
import { API_DISPLAY_URL, extApiFetch, ExtApiError } from "../services/extApiClient";
import { appPageUrl } from "../shared/appUrl";
import { setAccessToken, setRefreshToken, setCachedUser } from "../services/storage";

interface PopupAuthProps {
  onAuthChange: (authenticated: boolean) => void;
}

export default function PopupAuth({ onAuthChange }: PopupAuthProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  // The privacy notice must be accepted to create an account (D10).
  const [agreed, setAgreed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) {
      setError("Please fill in all required fields.");
      return;
    }

    if (mode === "register") {
      if (
        !isTrustedEmail(email, {
          allowTestDomains: import.meta.env.VITE_ALLOW_TEST_EMAIL_DOMAINS === "true",
        })
      ) {
        setError(
          "Please use a valid email address.",
        );
        return;
      }
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
      if (!agreed) {
        setError("Please agree to the privacy notice to create an account.");
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
            privacy_consent_version: PRIVACY_NOTICE_VERSION,
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

      if (mode === "register") {
        if (typeof chrome !== "undefined" && chrome.tabs) {
          chrome.tabs.create({ url: appPageUrl("/onboarding") });
        } else {
          window.open(appPageUrl("/onboarding"), "_blank");
        }
      }
    } catch (err) {
      if (err instanceof ExtApiError) {
        if (err.code === "AUTH_INVALID_CREDENTIALS") {
          setError(
            "Invalid email or password. If you haven't created an account, choose Create account above.",
          );
        } else if (
          err.code === "AUTH_EMAIL_ALREADY_EXISTS" ||
          err.code === "AUTH_EMAIL_EXISTS"
        ) {
          setError(
            "An account with this email address already exists. Switch to Sign in.",
          );
        } else {
          setError(err.message || "Authentication request failed.");
        }
      } else {
        setError(
          `Unable to connect to the Sentiora server at ${API_DISPLAY_URL}. Make sure it is running and reachable.`,
        );
      }
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="space-y-4 px-5 pb-5 pt-6">
      <div className="flex items-center gap-3">
        <Echo state="idle" size={48} />
        <div>
          <h1 className="font-display text-[22px] font-bold tracking-tight">
            {mode === "login" ? "Sign in to Sentiora" : "Create your account"}
          </h1>
          <p className="text-[15px] text-muted">
            Saves what you read while signed in.
          </p>
        </div>
      </div>

      <div
        role="group"
        aria-label="Account"
        className="flex gap-1 rounded-full bg-raised p-1"
      >
        {(["login", "register"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => {
              setMode(value);
              setError(null);
            }}
            className={cx(
              "h-9 flex-1 rounded-full text-[15px] font-medium transition-colors",
              mode === value
                ? "bg-surface text-fg shadow-pop"
                : "text-muted hover:text-fg",
            )}
          >
            {value === "login" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>

      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-btn bg-accent-soft px-3 py-2.5 text-[15px] text-accent-soft-fg"
        >
          <IconAlert size={18} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}

      <form onSubmit={handleAuth} className="space-y-3" noValidate>
        {mode === "register" && (
          <TextField
            label="Full name"
            type="text"
            autoComplete="name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        )}

        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <TextField
          label="Password"
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint={
            mode === "register"
              ? "At least 10 characters, with one capital letter and one number."
              : undefined
          }
          required
        />

        {mode === "register" && (
          <div className="space-y-2">
            <p id="popup-notice" className="rounded-btn bg-raised px-3 py-2 text-[14px] leading-relaxed text-muted">
              {PRIVACY_NOTICE_TEXT}
            </p>
            <label className="flex min-h-touch cursor-pointer items-start gap-3 text-[15px] text-fg">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                aria-describedby="popup-notice"
                className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-accent"
              />
              <span>I agree to the privacy notice above.</span>
            </label>
          </div>
        )}

        <Button type="submit" size="lg" fullWidth loading={isLoading}>
          {isLoading
            ? mode === "login"
              ? "Signing in"
              : "Creating account"
            : mode === "login"
              ? "Sign in"
              : "Create account"}
        </Button>
      </form>
    </section>
  );
}
