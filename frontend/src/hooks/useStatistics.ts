import { useEffect, useState } from "react";
import { fetchStatistics, type DashboardStatistics } from "../services/dashboardService";

/** Memory statistics; refetched whenever `refreshKey` changes. */
export function useStatistics(refreshKey: unknown = 0) {
  const [stats, setStats] = useState<DashboardStatistics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchStatistics()
      .then((data) => {
        if (cancelled) return;
        setStats(data);
        setError(null);
      })
      .catch(() => {
        if (!cancelled) setError("Statistics are unavailable right now.");
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return { stats, error };
}
