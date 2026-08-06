import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { APP_NAME } from "@shared/constants/app";
import "./Auth.css";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email) return;
    setIsLoading(true);
    setTimeout(() => {
      setIsLoading(false);
      setIsSubmitted(true);
    }, 800);
  }

  return (
    <div className="auth-page">
      <div className="auth-header">
        <h1 className="auth-logo">{APP_NAME}</h1>
        <p className="auth-tagline">PERSONAL DIGITAL VAULT</p>
      </div>

      <div className="auth-card">
        <div className="auth-card-inner">
          <h2 className="auth-title">Reset password</h2>
          <p className="auth-subtitle">
            Enter your email address and we'll send you instructions to reset your password.
          </p>

          {isSubmitted ? (
            <div className="space-y-4 text-center">
              <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-medium">
                Password reset link sent! Check your inbox for <strong>{email}</strong>.
              </div>
              <Link to="/login" className="auth-btn-primary block text-center">
                Back to Sign In
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} noValidate>
              <div className="auth-field">
                <label htmlFor="reset-email" className="auth-label">
                  Email Address
                </label>
                <input
                  id="reset-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g., jordan@example.com"
                  className="auth-input"
                  required
                />
              </div>

              <button type="submit" disabled={isLoading} className="auth-btn-primary">
                {isLoading ? "Sending Link..." : "Send Reset Link"}
              </button>

              <p className="auth-switch">
                Remember your password?{" "}
                <Link to="/login" className="auth-switch-link">
                  Sign in
                </Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
