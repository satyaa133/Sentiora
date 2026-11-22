import { type FormEvent, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button, IconAlert, TextField } from "@shared/ui";
import AuthLayout from "../components/AuthLayout";
import apiClient, { getApiErrorMessage } from "../services/apiClient";
import { setAuthTokens } from "../services/authStorage";
import { useAuth } from "../context/AuthContext";

export default function VerifyEmail() {
  const navigate = useNavigate();
  const location = useLocation();
  const { refreshUser } = useAuth();

  const [email] = useState<string>(
    () =>
      (location.state as { email?: string } | null)?.email ||
      sessionStorage.getItem("pending_verify_email") ||
      "",
  );

  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(60);

  useEffect(() => {
    if (!email) {
      navigate("/signup", { replace: true });
      return;
    }
    const id = setInterval(() => {
      setResendCooldown((s) => {
        if (s <= 1) {
          clearInterval(id);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [email, navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (otp.length !== 6 || !/^\d{6}$/.test(otp)) {
      setError("Please enter a valid 6-digit code.");
      return;
    }
    setIsLoading(true);
    setError(null);

    try {
      type VerifyResp = {
        access_token: string;
        refresh_token: string;
        user?: { id: string; email: string; full_name?: string | null };
      };
      const resp = await apiClient.post<{ data: VerifyResp }>("/auth/verify-email", {
        email,
        otp,
      });
      const { access_token, refresh_token, user } = resp.data.data;
      if (user) {
        setAuthTokens(access_token, refresh_token, {
          id: user.id,
          email: user.email,
          is_email_verified: true,
          onboarding_completed: false,
        });
      } else {
        setAuthTokens(access_token, refresh_token);
      }
      sessionStorage.removeItem("pending_verify_email");
      await refreshUser();
      navigate("/onboarding", { replace: true });
    } catch (err: unknown) {
      const respData = (err as { response?: { data?: { error?: { code?: string } } } })?.response?.data;
      const code = respData?.error?.code;
      if (code === "OTP_EXPIRED") {
        setError("Your code has expired. Please request a new one below.");
      } else if (code === "OTP_INVALID") {
        setError("Incorrect code. Please check and try again.");
      } else if (code === "OTP_MAX_ATTEMPTS") {
        setError("Too many incorrect attempts. Please request a new code.");
      } else {
        setError(getApiErrorMessage(err, "Verification failed. Please try again."));
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
      await apiClient.post("/auth/resend-otp", { email });
      setSuccess("A new code has been sent to your inbox.");
      setResendCooldown(60);
      const id = setInterval(() => {
        setResendCooldown((s) => {
          if (s <= 1) {
            clearInterval(id);
            return 0;
          }
          return s - 1;
        });
      }, 1000);
    } catch (err: unknown) {
      const respData = (err as { response?: { data?: { error?: { code?: string; message?: string } } } })?.response?.data;
      const code = respData?.error?.code;
      if (code === "OTP_RESEND_COOLDOWN") {
        const ttl = respData?.error?.message?.match(/\d+/)?.[0] ?? "60";
        setError(`Please wait ${ttl} seconds before requesting a new code.`);
      } else {
        setError(getApiErrorMessage(err, "Could not resend code. Please try again."));
      }
    } finally {
      setIsResending(false);
    }
  }

  return (
    <AuthLayout
      title="Check your inbox"
      subtitle={
        email
          ? `We sent a 6-digit code to ${email}`
          : "Enter the code we sent to your email"
      }
      footer={
        <>
          Wrong email?{" "}
          <Link
            to="/signup"
            className="font-semibold text-link hover:underline"
            onClick={() => sessionStorage.removeItem("pending_verify_email")}
          >
            Start over
          </Link>
        </>
      }
    >
      {error && (
        <p
          role="alert"
          className="mb-5 flex items-start gap-2 rounded-btn bg-accent-soft px-4 py-3 text-[15px] text-accent-soft-fg"
        >
          <IconAlert size={18} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
      {success && !error && (
        <p
          role="status"
          className="mb-5 rounded-btn bg-raised px-4 py-3 text-[15px] text-muted"
        >
          {success}
        </p>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <TextField
          id="otp-input"
          label="Verification code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={otp}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "").slice(0, 6);
            setOtp(v);
          }}
          placeholder="000000"
          hint="Enter the 6-digit code from your email."
        />

        <Button
          id="verify-submit-btn"
          type="submit"
          size="lg"
          fullWidth
          loading={isLoading}
        >
          {isLoading ? "Verifying" : "Verify email"}
        </Button>
      </form>

      <div className="mt-5 text-center text-[15px] text-muted">
        Didn&apos;t get a code?{" "}
        {resendCooldown > 0 ? (
          <span className="text-muted">Resend in {resendCooldown}s</span>
        ) : (
          <button
            type="button"
            disabled={isResending}
            onClick={handleResend}
            className="font-semibold text-link hover:underline disabled:opacity-50"
          >
            {isResending ? "Sending…" : "Resend code"}
          </button>
        )}
      </div>
    </AuthLayout>
  );
}
