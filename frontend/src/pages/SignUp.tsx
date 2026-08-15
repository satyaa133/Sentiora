import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getApiErrorMessage } from "../services/apiClient";
import "./Auth.css";

export default function SignUp() {
  const { register, login } = useAuth();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<{
    fullName?: string;
    email?: string;
    password?: string;
    terms?: string;
    general?: string;
  }>({});

  function getPasswordStrength(pwd: string): { label: string; level: number } {
    if (pwd.length === 0) return { label: "", level: 0 };
    const hasUpper = /[A-Z]/.test(pwd);
    const hasNumber = /[0-9]/.test(pwd);
    const hasSymbol = /[^A-Za-z0-9]/.test(pwd);
    const score = [pwd.length >= 10, hasUpper, hasNumber, hasSymbol].filter(Boolean).length;
    if (score <= 1) return { label: "Weak password.", level: 1 };
    if (score === 2) return { label: "Fair password.", level: 2 };
    if (score === 3) return { label: "Good password.", level: 3 };
    return { label: "Strong password. Contains numbers & symbols.", level: 4 };
  }

  function validate(): boolean {
    const errs: typeof errors = {};
    if (!fullName || fullName.trim().length < 2) {
      errs.fullName = "Full name must be at least 2 characters.";
    } else if (fullName.trim().length > 80) {
      errs.fullName = "Full name must be 80 characters or fewer.";
    }
    if (!email) {
      errs.email = "Email address is required.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errs.email = "Please enter a valid email.";
    }
    if (!password || password.length < 10) {
      errs.password = "Password must be at least 10 characters.";
    } else if (!/[A-Z]/.test(password)) {
      errs.password = "Password must contain at least one uppercase letter.";
    } else if (!/[0-9]/.test(password)) {
      errs.password = "Password must contain at least one number.";
    }
    if (!agreedToTerms) {
      errs.terms = "You must agree to the Terms of Service.";
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
      await register(email, password, fullName.trim());
      // Auto-login after registration and navigate to onboarding first
      await login(email, password);
      navigate("/onboarding");
    } catch (err) {
      const message = getApiErrorMessage(err, "Something went wrong. Please try again.");
      if (message.toLowerCase().includes("already exists")) {
        setErrors({ email: message });
      } else {
        setErrors({ general: message });
      }
    } finally {
      setIsLoading(false);
    }
  }

  const strength = getPasswordStrength(password);

  return (
    <div className="auth-page">
      <div className="auth-header">
        <h1 className="auth-logo">Sentiora</h1>
        <p className="auth-tagline">PERSONAL DIGITAL VAULT</p>
      </div>

      <div className="auth-card">
        <div className="auth-card-inner">
          <h2 className="auth-title">Create your memory</h2>
          <p className="auth-subtitle">Start building your personal knowledge base.</p>

          {errors.general && (
            <div className="auth-error-banner" role="alert">
              {errors.general}
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate>
            <div className="auth-field">
              <label htmlFor="signup-fullname" className="auth-label">
                Full Name
              </label>
              <input
                id="signup-fullname"
                type="text"
                autoComplete="name"
                className={`auth-input${errors.fullName ? " auth-input--error" : ""}`}
                placeholder="Jordan Miller"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
              {errors.fullName && <p className="auth-field-error">{errors.fullName}</p>}
            </div>

            <div className="auth-field">
              <label htmlFor="signup-email" className="auth-label">
                Email Address
              </label>
              <input
                id="signup-email"
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
              <label htmlFor="signup-password" className="auth-label">
                Password
              </label>
              <div className="auth-input-wrapper">
                <input
                  id="signup-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
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
              {password.length > 0 && (
                <div className="auth-password-strength">
                  <div className="auth-strength-bar">
                    {[1, 2, 3, 4].map((i) => (
                      <div
                        key={i}
                        className={`auth-strength-segment${strength.level >= i ? " auth-strength-segment--active" : ""}`}
                        data-level={strength.level}
                      />
                    ))}
                  </div>
                  {strength.label && (
                    <p
                      className={`auth-strength-label${strength.level >= 4 ? " auth-strength-label--strong" : ""}`}
                    >
                      {strength.label}
                    </p>
                  )}
                </div>
              )}
              {errors.password && <p className="auth-field-error">{errors.password}</p>}
            </div>

            <div className="auth-field auth-field--checkbox">
              <label className="auth-checkbox-label">
                <input
                  id="signup-terms"
                  type="checkbox"
                  checked={agreedToTerms}
                  onChange={(e) => setAgreedToTerms(e.target.checked)}
                  className="auth-checkbox"
                />
                <span>
                  I agree to the{" "}
                  <a href="#" className="auth-switch-link">
                    Terms of Service
                  </a>{" "}
                  and{" "}
                  <a href="#" className="auth-switch-link">
                    Privacy Policy
                  </a>
                  .
                </span>
              </label>
              {errors.terms && <p className="auth-field-error">{errors.terms}</p>}
            </div>

            <button
              id="signup-submit-btn"
              type="submit"
              className="auth-btn-primary"
              disabled={isLoading}
            >
              {isLoading ? "Creating account…" : "Create Account"}
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
            Already have an account?{" "}
            <Link to="/login" className="auth-switch-link">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
