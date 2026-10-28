import { Card } from "@shared/ui";

import type { DailyCount } from "../../services/dashboardService";

const DAYS = 7;
const PLOT_HEIGHT = 96;

function dayLabel(date: string): { short: string; long: string } {
  // date is a local calendar day (YYYY-MM-DD); parse at noon to dodge DST edges.
  const day = new Date(`${date}T12:00:00`);
  return {
    short: day.toLocaleDateString(undefined, { weekday: "narrow" }),
    long: day.toLocaleDateString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
    }),
  };
}

/**
 * "This week" on Home (DESIGN.md §5.4): saves per day for the last 7 days, from
 * /dashboard/statistics only. One series, so no legend; the title names it.
 * Each day shows its count on hover or focus, and the list doubles as the
 * screen-reader table.
 */
export default function ThisWeekChart({ daily }: { daily: DailyCount[] | null }) {
  const week = (daily ?? []).slice(-DAYS);
  const total = week.reduce((sum, day) => sum + day.count, 0);
  const max = Math.max(1, ...week.map((day) => day.count));

  return (
    <Card as="section" aria-labelledby="this-week-heading" padding="lg">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="this-week-heading" className="text-[20px] font-semibold text-fg">
          This week
        </h2>
        {daily ? (
          <p className="font-mono text-xs text-muted">
            {total} {total === 1 ? "save" : "saves"}
          </p>
        ) : null}
      </div>

      {!daily ? (
        <p className="mt-3 text-[15px] text-muted">
          Statistics are unavailable right now.
        </p>
      ) : total === 0 ? (
        <p className="mt-3 text-[15px] text-muted">Nothing saved in the last 7 days.</p>
      ) : (
        <ol
          aria-label="Saves per day, last 7 days"
          className="mt-4 grid grid-cols-7 gap-0.5 border-b border-line"
          style={{ height: PLOT_HEIGHT + 4 }}
        >
          {week.map((day) => {
            const label = dayLabel(day.date);
            const height =
              day.count === 0 ? 0 : Math.max(4, (day.count / max) * PLOT_HEIGHT);
            return (
              <li
                key={day.date}
                tabIndex={0}
                className="group relative flex h-full flex-col items-center justify-end rounded-t-[4px] outline-offset-2"
              >
                <span className="sr-only">
                  {label.long}: {day.count} {day.count === 1 ? "save" : "saves"}
                </span>
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -top-1 left-1/2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-inverse px-2 py-1 font-mono text-xs text-on-inverse opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                >
                  {day.count}
                </span>
                <span
                  aria-hidden="true"
                  className="block w-full max-w-7 rounded-t-[4px] bg-accent"
                  style={{ height }}
                />
              </li>
            );
          })}
        </ol>
      )}
      {daily && total > 0 ? (
        <div
          aria-hidden="true"
          className="mt-1.5 grid grid-cols-7 gap-0.5 text-center font-mono text-xs text-muted"
        >
          {week.map((day) => (
            <span key={day.date}>{dayLabel(day.date).short}</span>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
