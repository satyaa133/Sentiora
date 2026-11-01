import { Echo } from "@shared/ui";

function Cite({ n }: { n: number }) {
  return (
    <span className="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded bg-accent px-1 align-[1px] font-mono text-xs font-semibold text-on-accent">
      {n}
    </span>
  );
}

const SOURCES = [
  { n: 1, title: "Understanding Docker containers", meta: "Web · Oct 12" },
  { n: 2, title: "Production Dockerfiles, a talk", meta: "YouTube · Sep 30" },
];

export default function AskBand() {
  return (
    <section
      id="ask"
      aria-labelledby="ask-heading"
      className="scroll-mt-16 bg-inverse py-20 sm:py-28"
    >
      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-16">
        <div>
          <p className="font-mono text-eyebrow uppercase text-on-inverse-muted">
            Ask Sentiora
          </p>
          <h2
            id="ask-heading"
            className="mt-3 font-display text-section text-on-inverse"
          >
            Ask your own library, not the whole internet.
          </h2>
          <p className="mt-4 max-w-md text-[17px] leading-relaxed text-on-inverse-muted">
            Answers come only from pages you saved. If your memory doesn&apos;t know,
            Sentiora says so instead of guessing.
          </p>
        </div>

        {/* Illustrative conversation. */}
        <div
          aria-hidden="true"
          className="rounded-panel border border-line bg-surface p-4 sm:p-6"
        >
          <p className="ml-auto w-fit max-w-[90%] rounded-card bg-accent px-4 py-2.5 text-[15px] font-medium text-on-accent">
            What did I read about keeping container images small?
          </p>
          <div className="mt-4 flex items-start gap-3">
            <Echo state="happy" size={32} still className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] leading-relaxed text-fg">
                Two of your saves cover it. Use multi-stage builds so compilers stay out
                of the final image
                <Cite n={1} />, and start from a slim base rather than a full OS
                <Cite n={2} />.
              </p>
              <ul className="mt-4 space-y-2">
                {SOURCES.map((source) => (
                  <li
                    key={source.n}
                    className="flex items-center gap-3 rounded-btn bg-raised px-3 py-2.5"
                  >
                    <span className="font-mono text-sm font-semibold text-fg">
                      {source.n}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[15px] text-fg">
                      {source.title}
                    </span>
                    <span className="hidden shrink-0 font-mono text-xs text-muted sm:block">
                      {source.meta}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
