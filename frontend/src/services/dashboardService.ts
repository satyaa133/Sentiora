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

let inFlight: Promise<DashboardStatistics> | null = null;

/**
 * Home, Timeline, Intelligence and the corner Echo all mount at once and each
 * ask for statistics; callers that overlap share one request. Nothing is
 * cached after it settles, so a later refresh always gets fresh numbers.
 */
export function fetchStatistics(): Promise<DashboardStatistics> {
  inFlight ??= apiClient
    .get<APIEnvelope<DashboardStatistics>>("/dashboard/statistics", {
      params: { tz: browserTimeZone() },
    })
    .then((resp) => resp.data.data)
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
