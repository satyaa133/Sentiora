import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { Echo, Logo, ThemeToggle } from "@shared/ui";
import type { EchoState } from "@shared/ui";

interface AuthLayoutProps {
  title: string;
  subtitle?: ReactNode;
  echo?: EchoState;
  children: ReactNode;
  /** Line under the card, e.g. "Don't have an account? Sign up". */
  footer?: ReactNode;
}

/** Shared frame for Login, Sign up and Forgot password. */
export default function AuthLayout({
  title,
  subtitle,
  echo = "idle",
  children,
  footer,
}: AuthLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <header className="flex h-16 items-center justify-between px-4 sm:px-6">
        <Link to="/" aria-label="Sentiora home" className="touch-target inline-flex rounded-btn">
          <Logo size={21} />
        </Link>
        <ThemeToggle variant="icon" />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-6 sm:items-center sm:pt-0">
        <div className="w-full max-w-md">
          <div className="rounded-panel border border-line bg-surface p-6 sm:p-8">
            <Echo state={echo} size={56} />
            <h1 className="mt-4 font-display text-[28px] font-bold leading-tight tracking-tight">
              {title}
            </h1>
            {subtitle ? (
              <p className="mt-1.5 text-[16px] text-muted">{subtitle}</p>
            ) : null}
            <div className="mt-6">{children}</div>
          </div>
          {footer ? (
            <p className="mt-5 text-center text-[15px] text-muted">{footer}</p>
          ) : null}
        </div>
      </main>
    </div>
  );
}
