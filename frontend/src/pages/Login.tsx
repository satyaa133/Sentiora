import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, IconAlert, TextField } from "@shared/ui";
import AuthLayout from "../components/AuthLayout";
import PasswordField from "../components/PasswordField";
import { useAuth } from "../context/AuthContext";
import { getApiErrorMessage } from "../services/apiClient";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<{
    email?: string;
    password?: string;
    general?: string;
  }>({});

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
      const currentUser = await login(email, password);
      navigate(currentUser.onboarding_completed ? "/dashboard" : "/onboarding");
    } catch (err) {
      setErrors({
        general: getApiErrorMessage(err, "Something went wrong. Please try again."),
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to your Sentiora memory."
      footer={
        <>
          Don&apos;t have an account?{" "}
          <Link to="/signup" className="font-semibold text-link hover:underline">
            Sign up
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
          id="login-email"
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
        />

        <div>
          <PasswordField
            id="login-password"
            label="Password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
          />
          <div className="mt-1 flex justify-end">
            <Link
              to="/forgot-password"
              className="inline-flex min-h-touch items-center text-[15px] text-link hover:underline"
            >
              Forgot your password?
            </Link>
          </div>
        </div>

        <Button
          id="login-submit-btn"
          type="submit"
          size="lg"
          fullWidth
          loading={isLoading}
        >
          {isLoading ? "Signing in" : "Sign in"}
        </Button>
      </form>

      <div className="my-5 flex items-center gap-3 text-sm text-muted">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>

      <Button variant="secondary" fullWidth disabled>
        Continue with Google
      </Button>
    </AuthLayout>
  );
}
