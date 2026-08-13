import { type AxiosError } from "axios";
import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import "./Auth.css";

interface ApiErrorResponse {
  error?: { code?: string; message?: string };
}

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string; general?: string }>({});

  function validate(): boolean {
    const errs: typeof errors = {};
    if (!email) {
      errs.email = "Email address is required.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errs.email = "Please enter a valid email.";
    }
    if (!password) {
      errs.password = "Password is required.";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setIsLoading(true);
    setErrors({});

    try {
      await login(email, password);
      navigate("/dashboard");
    } catch (err) {
      const axiosErr = err as AxiosError<ApiErrorResponse>;
      const apiCode = axiosErr.response?.data?.error?.code;
      if (apiCode === "AUTH_INVALID_CREDENTIALS") {
        setErrors({ general: "Invalid email or password. Please try again." });
      } else {
        setErrors({ general: "Something went wrong. Please try again." });
      }
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-header">
        <h1 className="auth-logo">Sentiora</h1>
        <p className="auth-tagline">PERSONAL DIGITAL VAULT</p>
      </div>

      <div className="auth-card">
        <div className="auth-card-inner">
          <h2 className="auth-title">Welcome back</h2>
          <p className="auth-subtitle">Sign in to your personal knowledge memory archive.</p>

          {errors.general && (
            <div className="auth-error-banner" role="alert">
              {errors.general}
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate>
            <div className="auth-field">
              <label htmlFor="login-email" className="auth-label">
                Email Address
              </label>
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                className={`auth-input${errors.email ? " auth-input--error" : ""}`}
                placeholder="e.g., jordan@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              {errors.email && <p className="auth-field-error">{errors.email}</p>}
            </div>

            <div className="auth-field">
              <label htmlFor="login-password" className="auth-label">
                Password
              </label>
              <div className="auth-input-wrapper">
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  className={`auth-input auth-input--with-action${errors.password ? " auth-input--error" : ""}`}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="auth-input-action"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
              {errors.password && <p className="auth-field-error">{errors.password}</p>}
            </div>

            <div className="auth-forgot-row">
              <Link to="/forgot-password" className="auth-forgot-link">
                Forgot your password?
              </Link>
            </div>

            <button
              id="login-submit-btn"
              type="submit"
              className="auth-btn-primary"
              disabled={isLoading}
            >
              {isLoading ? "Signing in…" : "Sign In"}
            </button>
          </form>

          <div className="auth-divider">
            <span>or</span>
          </div>

          <button type="button" className="auth-btn-social" disabled>
            <span className="auth-btn-social-icon">⊗</span>
            Continue with Google
          </button>

          <p className="auth-switch">
            Don&apos;t have an account?{" "}
            <Link to="/onboarding" className="auth-switch-link">
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
