import { Link } from "react-router-dom";

import { Echo, Logo, buttonClasses } from "@shared/ui";

/** 404 (DESIGN.md §10): Echo searching with a moving magnifier. Echo also roams here. */
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <header className="mx-auto flex h-16 w-full max-w-6xl items-center px-4 sm:px-6">
        <Link to="/" aria-label="Sentiora home" className="touch-target inline-flex rounded-btn">
          <Logo size={21} />
        </Link>
      </header>
      <main
        id="main"
        className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-4 pb-24 text-center"
      >
        <Echo state="searching" size={180} still className="h-[140px] w-[140px] sm:h-[180px] sm:w-[180px]" />
        <p className="mt-6 font-mono text-[15px] uppercase tracking-[0.06em] text-muted">404</p>
        <h1 className="mt-2 font-display text-[36px] font-bold leading-tight tracking-tight sm:text-page-title">
          Echo couldn&apos;t find this page.
        </h1>
        <p className="mt-3 text-[17px] text-muted">
          The link may be old, or the address has a typo.
        </p>
        <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row" data-echo-avoid="">
          <Link to="/" className={buttonClasses("primary", "lg")} data-echo-point="">
            Go to the home page
          </Link>
          <Link to="/dashboard" className={buttonClasses("secondary", "lg")}>
            Open your dashboard
          </Link>
        </div>
      </main>
    </div>
  );
}
