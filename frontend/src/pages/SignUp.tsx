import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, IconAlert, TextField, cx } from "@shared/ui";
import AuthLayout from "../components/AuthLayout";
import PasswordField from "../components/PasswordField";
import { useAuth } from "../context/AuthContext";
import { getApiErrorMessage } from "../services/apiClient";

export default function SignUp() {
  const { register, login } = useAuth();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
    const score = [pwd.length >= 10, hasUpper, hasNumber, hasSymbol].filter(
      Boolean,
    ).length;
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
      const message = getApiErrorMessage(
        err,
        "Something went wrong. Please try again.",
      );
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
    <AuthLayout
      title="Create your account"
      subtitle="Start a memory for everything you read."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="font-semibold text-link hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      {errors.general && (
        <p
          role="alert"
          className="mb-5 flex items-start gap-2 rounded-btn bg-accent-soft px-4 py-3 text-[15px] text-accent-soft-fg"
        >
          <IconAlert size={18} className="mt-0.5 shrink-0" />
          {errors.general}
        </p>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <TextField
          id="signup-fullname"
          label="Full name"
          type="text"
          autoComplete="name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          error={errors.fullName}
        />

        <TextField
          id="signup-email"
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
        />

        <div>
          <PasswordField
            id="signup-password"
            label="Password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
            hint="At least 10 characters, with one capital letter and one number."
            aria-describedby={password.length > 0 ? "signup-strength" : undefined}
          />
          {password.length > 0 && (
            <div className="mt-2">
              <div aria-hidden="true" className="flex gap-1">
                {[1, 2, 3, 4].map((i) => (
                  <span
                    key={i}
                    className={cx(
                      "h-1.5 flex-1 rounded-full",
                      strength.level >= i ? "bg-accent" : "bg-raised",
                    )}
                  />
                ))}
              </div>
              {strength.label && (
                <p id="signup-strength" className="mt-1.5 text-[15px] text-muted">
                  {strength.label}
                </p>
              )}
            </div>
          )}
        </div>

        <div>
          <label
            htmlFor="signup-terms"
            className="flex min-h-touch cursor-pointer items-start gap-3 text-[15px] text-fg"
          >
            <input
              id="signup-terms"
              type="checkbox"
              checked={agreedToTerms}
              onChange={(e) => setAgreedToTerms(e.target.checked)}
              aria-invalid={errors.terms ? true : undefined}
              aria-describedby={errors.terms ? "signup-terms-error" : undefined}
              className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-accent"
            />
            <span>
              {/* TODO: link the real Terms of Service and Privacy Policy pages. */}I
              agree to the{" "}
              <a href="#" className="text-link underline">
                Terms of Service
              </a>{" "}
              and{" "}
              <a href="#" className="text-link underline">
                Privacy Policy
              </a>
              .
            </span>
          </label>
          {errors.terms && (
            <p id="signup-terms-error" className="mt-1 text-[15px] text-link">
              {errors.terms}
            </p>
          )}
        </div>

        <Button
          id="signup-submit-btn"
          type="submit"
          size="lg"
          fullWidth
          loading={isLoading}
        >
          {isLoading ? "Creating account" : "Create account"}
        </Button>
      </form>

      <div className="my-5 flex items-center gap-3 text-sm text-muted">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>

      <Button variant="secondary" fullWidth disabled>
        Continue with Google (coming soon)
      </Button>
    </AuthLayout>
  );
}
