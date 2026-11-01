import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { Button, TextField, buttonClasses } from "@shared/ui";
import AuthLayout from "../components/AuthLayout";

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
    <AuthLayout
      title="Reset your password"
      subtitle="Enter your email and we'll send you a link to reset your password."
      echo={isSubmitted ? "happy" : "idle"}
      footer={
        <>
          Remember your password?{" "}
          <Link to="/login" className="font-semibold text-link hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      {isSubmitted ? (
        <div className="space-y-5">
          <p
            role="status"
            className="rounded-btn bg-raised px-4 py-3 text-[15px] text-fg"
          >
            Password reset link sent. Check your inbox for <strong>{email}</strong>.
          </p>
          <Link to="/login" className={buttonClasses("primary", "lg", true)}>
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <TextField
            id="reset-email"
            label="Email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Button type="submit" size="lg" fullWidth loading={isLoading}>
            {isLoading ? "Sending link" : "Send reset link"}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
