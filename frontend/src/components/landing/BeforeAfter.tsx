import { Echo, IconSearch, SourceBadge } from "@shared/ui";

const QUERY = "that article about isolating processes";
const FOLDERS = [
  { name: "Read later", count: 214 },
  { name: "Important", count: 87 },
  { name: "Sem 7 refs", count: 53 },
];

/** "Where did I read that?" (DESIGN.md §9.2): the same query, without and with Sentiora. */
export default function BeforeAfter() {
  return (
    <section aria-labelledby="before-after-heading" className="scroll-mt-16 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="max-w-2xl">
          <h2 id="before-after-heading" className="font-display text-section text-fg">
            Where did I read that?
          </h2>
          <p className="mt-4 text-[18px] leading-relaxed text-muted">
            You read it. You know you did. It&apos;s somewhere in 40 tabs, 300 bookmarks and
            a folder called &ldquo;read later&rdquo;.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-2">
          <figure className="rounded-panel border-2 border-dashed border-line p-5 sm:p-7">
            <figcaption className="font-mono text-eyebrow uppercase text-muted">
              Without Sentiora
            </figcaption>
            <div aria-hidden="true" className="mt-5 flex gap-1 overflow-hidden">
              {Array.from({ length: 14 }, (_, i) => (
                <span
                  key={i}
                  className="before-tab h-6 min-w-6 flex-1 rounded-t-md border border-b-0 border-line bg-raised"
                  style={{ animationDelay: `${(i % 5) * 0.35}s` }}
                />
              ))}
            </div>
            <ul className="mt-5 space-y-2">
              {FOLDERS.map((folder) => (
                <li
                  key={folder.name}
                  className="flex items-center justify-between rounded-btn bg-raised px-3 py-2 text-[15px] text-muted"
                >
                  <span>{folder.name}</span>
                  <span className="font-mono text-xs">{folder.count} items</span>
                </li>
              ))}
            </ul>
            <div className="mt-5 flex items-center gap-2 rounded-btn border border-line px-3 py-2.5 text-[15px] text-muted">
              <IconSearch size={18} className="shrink-0" />
              <span className="truncate">&ldquo;{QUERY}&hellip;&rdquo;</span>
            </div>
            <p className="mt-3 font-mono text-xs uppercase tracking-[0.06em] text-muted">
              0 results in bookmarks
            </p>
          </figure>

          <figure className="rounded-panel border border-line bg-surface p-5 shadow-float sm:p-7">
            <figcaption className="font-mono text-eyebrow uppercase text-link">With Sentiora</figcaption>
            <div className="mt-5 flex items-center gap-2 rounded-btn border border-accent px-3 py-2.5 text-[15px] text-fg">
              <IconSearch size={18} className="shrink-0 text-link" />
              <span className="truncate">{QUERY}</span>
            </div>
            <div className="mt-4 rounded-card bg-raised p-4">
              <div className="flex items-center gap-2">
                <SourceBadge type="web" />
                <span className="text-[17px] font-semibold text-fg">Understanding Docker containers</span>
              </div>
              <p className="mt-1 font-mono text-xs text-muted">Saved Oct 12 · blog.example.dev</p>
              <blockquote className="mt-3 border-l-2 border-accent pl-3 text-[16px] leading-relaxed text-fg">
                &ldquo;Containers isolate processes using kernel namespaces and cgroups&hellip;&rdquo;
              </blockquote>
            </div>
            <p className="mt-4 flex items-center gap-2 text-[15px] font-medium text-fg">
              <Echo state="happy" size={32} still />
              Found it in 0.4s
            </p>
          </figure>
        </div>
      </div>
    </section>
  );
}
