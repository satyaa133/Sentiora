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

export async function fetchStatistics(): Promise<DashboardStatistics> {
  const resp = await apiClient.get<APIEnvelope<DashboardStatistics>>(
    "/dashboard/statistics",
    { params: { tz: browserTimeZone() } },
  );
  return resp.data.data;
}
