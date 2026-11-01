import { Echo, LogoMark, Tag } from "@shared/ui";

/** Illustrative browser window with the extension icon and a "saved" card. Decorative. */
export default function HeroMockup() {
  return (
    <div aria-hidden="true" className="relative pb-24 sm:pb-16 lg:pb-10">
      <div className="overflow-hidden rounded-panel border border-line bg-surface shadow-float">
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <span className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-raised" />
            <span className="h-2.5 w-2.5 rounded-full bg-raised" />
            <span className="h-2.5 w-2.5 rounded-full bg-raised" />
          </span>
          <span className="min-w-0 flex-1 truncate rounded-full bg-raised px-3 py-1 font-mono text-xs text-muted">
            blog.example.dev/understanding-docker-containers
          </span>
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md ring-2 ring-accent">
            <LogoMark size={16} />
          </span>
        </div>
        <div className="space-y-3 px-5 pb-8 pt-6 sm:px-8">
          <p className="font-mono text-eyebrow uppercase text-muted">
            DevOps · 9 min read
          </p>
          <p className="font-display text-2xl font-bold leading-tight tracking-tight text-fg sm:text-[28px]">
            Understanding Docker containers, from namespaces up
          </p>
          <div className="space-y-2.5 pt-2">
            <span className="block h-2.5 w-full rounded-full bg-raised" />
            <span className="block h-2.5 w-11/12 rounded-full bg-raised" />
            <span className="block h-2.5 w-4/5 rounded-full bg-accent" />
            <span className="block h-2.5 w-[95%] rounded-full bg-raised" />
            <span className="block h-2.5 w-2/3 rounded-full bg-raised" />
          </div>
          <span className="block h-24 rounded-card bg-raised" />
        </div>
      </div>

      <div className="absolute bottom-0 right-0 w-[min(100%,330px)] rounded-card border border-line bg-surface p-4 shadow-float sm:-right-4">
        <div className="flex items-center gap-3">
          <Echo state="happy" size={44} still />
          <div className="min-w-0">
            <p className="font-semibold text-fg">Saved to your memory</p>
            <p className="truncate text-sm text-muted">
              Article · 2,140 words · just now
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Tag>docker</Tag>
          <Tag>linux</Tag>
          <Tag>+ tag</Tag>
        </div>
      </div>
    </div>
  );
}
