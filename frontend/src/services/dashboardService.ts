import apiClient, { type APIEnvelope } from "./apiClient";
import type { ItemStatus, SourceType } from "../types/memory";

export interface DailyCount {
  /** Local calendar day, YYYY-MM-DD. */
  date: string;
  count: number;
}

/** Real aggregates over the signed-in user's memories (GET /dashboard/statistics). */
export interface DashboardStatistics {
  total: number;
  today: number;
  this_week: number;
  by_source_type: Record<SourceType, number>;
  by_status: Record<ItemStatus, number>;
  /** Ready items that have searchable chunks, so Ask can use them. */
  ready_for_ai: number;
  /** Last 14 days, oldest first, zeros included. */
  daily: DailyCount[];
  last_captured_at: string | null;
  timezone: string;
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** A loaded result is reused for this long by views that mount later. */
export const STATISTICS_REUSE_MS = 10_000;

let inFlight: Promise<DashboardStatistics> | null = null;
let latest: { stats: DashboardStatistics; at: number } | null = null;

/**
 * Home, Timeline, Intelligence and the corner Echo each ask for statistics as
 * they mount, a moment apart. Overlapping callers share one request, and a
 * result stays reusable for STATISTICS_REUSE_MS, so one page load makes one
 * request. `fresh` (or `invalidateStatistics`) asks the server again: use it
 * when the user's saves changed.
 */
export function fetchStatistics(options: { fresh?: boolean } = {}): Promise<DashboardStatistics> {
  if (options.fresh) latest = null;
  if (latest && Date.now() - latest.at < STATISTICS_REUSE_MS) {
    return Promise.resolve(latest.stats);
  }
  inFlight ??= apiClient
    .get<APIEnvelope<DashboardStatistics>>("/dashboard/statistics", {
      params: { tz: browserTimeZone() },
    })
    .then((resp) => {
      latest = { stats: resp.data.data, at: Date.now() };
      return resp.data.data;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Forget the reusable result: the next caller asks the server. */
export function invalidateStatistics(): void {
  latest = null;
}
