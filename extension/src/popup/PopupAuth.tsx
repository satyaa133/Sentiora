import React, { useEffect, useState } from "react";
import { Button, Echo, IconAlert, TextField, cx, isTrustedEmail } from "@shared/ui";
import { API_DISPLAY_URL, extApiFetch, ExtApiError } from "../services/extApiClient";
import { appPageUrl } from "../shared/appUrl";
import { setAccessToken, setRefreshToken, setCachedUser } from "../services/storage";

interface PopupAuthProps {
  onAuthChange: (authenticated: boolean) => void;
}

export default function PopupAuth({ onAuthChange }: PopupAuthProps) {
  const [mode, setMode] = useState<"login" | "register" | "verify">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(60);

  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;
    if (mode === "verify") {
      id = setInterval(() => {
        setResendCooldown((s) => {
          if (s <= 1) {
            if (id) clearInterval(id);
            return 0;
          }
          return s - 1;
        });
      }, 1000);
    }
    return () => {
      if (id) clearInterval(id);
    };
  }, [mode]);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (otp.length !== 6 || !/^\d{6}$/.test(otp)) {
      setError("Please enter a valid 6-digit code.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const verifyResp = await extApiFetch<{
        access_token: string;
        refresh_token: string;
        user: { id: string; email: string; is_email_verified?: boolean };
      }>("/auth/verify-email", {
        method: "POST",
        body: JSON.stringify({ email, otp }),
      });

      const { access_token, refresh_token, user } = verifyResp.data;
      await setAccessToken(access_token);
      await setRefreshToken(refresh_token);
      await setCachedUser({
        id: user.id,
        email: user.email,
        is_email_verified: user.is_email_verified ?? true,
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
              is_email_verified: user.is_email_verified ?? true,
            },
          },
        });
      }

      onAuthChange(true);

      if (typeof chrome !== "undefined" && chrome.tabs) {
        chrome.tabs.create({ url: appPageUrl("/onboarding") });
      } else {
        window.open(appPageUrl("/onboarding"), "_blank");
      }
    } catch (err) {
      if (err instanceof ExtApiError) {
        if (err.code === "OTP_EXPIRED") {
          setError("Your code has expired. Please request a new one.");
        } else if (err.code === "OTP_INVALID") {
          setError("Incorrect code. Please try again.");
        } else if (err.code === "OTP_MAX_ATTEMPTS") {
          setError("Too many attempts. Please request a new code.");
        } else {
          setError(err.message || "Verification failed.");
        }
      } else {
        setError(`Unable to connect to the Sentiora server at ${API_DISPLAY_URL}.`);
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function handleResend() {
    setIsResending(true);
    setError(null);
    setSuccess(null);
    try {
      await extApiFetch("/auth/resend-otp", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setSuccess("A new code has been sent to your inbox.");
      setResendCooldown(60);
    } catch (err) {
      if (err instanceof ExtApiError && err.code === "OTP_RESEND_COOLDOWN") {
        const ttl = err.message.match(/\d+/)?.[0] ?? "60";
        setError(`Please wait ${ttl} seconds before requesting a new code.`);
      } else {
        setError("Could not resend code. Please try again.");
      }
    } finally {
      setIsResending(false);
    }
  }

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) {
      setError("Please fill in all required fields.");
      return;
    }

    if (mode === "register") {
      if (!isTrustedEmail(email)) {
        setError("Please use a valid email address.");
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
        setMode("verify");
        setResendCooldown(60);
        setSuccess(`We sent a 6-digit verification code to ${email}`);
        return;
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
        if (err.code === "AUTH_EMAIL_NOT_VERIFIED") {
          setMode("verify");
          setResendCooldown(60);
          setError("Please verify your email before signing in.");
          extApiFetch("/auth/resend-otp", {
            method: "POST",
            body: JSON.stringify({ email }),
          }).catch(() => {});
          return;
        }
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
            {mode === "login"
              ? "Sign in to Sentiora"
              : mode === "register"
                ? "Create your account"
                : "Check your inbox"}
          </h1>
          <p className="text-[15px] text-muted">
            {mode === "verify"
              ? `Code sent to ${email}`
              : "Saves what you read while signed in."}
          </p>
        </div>
      </div>

      {mode !== "verify" ? (
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
                setSuccess(null);
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
      ) : null}

      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-btn bg-accent-soft px-3 py-2.5 text-[15px] text-accent-soft-fg"
        >
          <IconAlert size={18} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}

      {success && !error && (
        <p
          role="status"
          className="rounded-btn bg-raised px-3 py-2 text-[15px] text-muted"
        >
          {success}
        </p>
      )}

      {mode === "verify" ? (
        <form onSubmit={handleVerify} className="space-y-3" noValidate>
          <TextField
            label="6-digit verification code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={otp}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "").slice(0, 6);
              setOtp(v);
            }}
            placeholder="000000"
            required
          />

          <Button type="submit" size="lg" fullWidth loading={isLoading}>
            {isLoading ? "Verifying…" : "Verify email"}
          </Button>

          <div className="flex items-center justify-between text-xs text-muted pt-1">
            <button
              type="button"
              onClick={() => {
                setMode("login");
                setError(null);
                setSuccess(null);
              }}
              className="text-link hover:underline"
            >
              Back to Sign in
            </button>
            {resendCooldown > 0 ? (
              <span>Resend in {resendCooldown}s</span>
            ) : (
              <button
                type="button"
                disabled={isResending}
                onClick={handleResend}
                className="text-link hover:underline disabled:opacity-50"
              >
                {isResending ? "Sending…" : "Resend code"}
              </button>
            )}
          </div>
        </form>
      ) : (
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
      )}
    </section>
  );
}
