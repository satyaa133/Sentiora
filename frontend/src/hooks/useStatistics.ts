import { useEffect, useRef, useState } from "react";
import { fetchStatistics, type DashboardStatistics } from "../services/dashboardService";

/**
 * Memory statistics. The first load reuses a result another view just
 * fetched; a later change of `refreshKey` (the saves changed) asks the server.
 */
export function useStatistics(refreshKey: unknown = 0) {
  const [stats, setStats] = useState<DashboardStatistics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const firstKey = useRef(refreshKey);

  useEffect(() => {
    let cancelled = false;
    const changed = !Object.is(firstKey.current, refreshKey);
    firstKey.current = refreshKey;
    fetchStatistics({ fresh: changed })
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
