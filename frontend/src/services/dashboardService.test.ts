import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./apiClient", () => ({ default: { get: vi.fn() } }));

import apiClient from "./apiClient";
import { fetchStatistics, invalidateStatistics, STATISTICS_REUSE_MS } from "./dashboardService";

afterEach(() => {
  vi.mocked(apiClient.get).mockReset();
  invalidateStatistics();
  vi.useRealTimers();
});

describe("fetchStatistics", () => {
  it("shares one request between overlapping callers", async () => {
    let resolve: (value: unknown) => void = () => {};
    vi.mocked(apiClient.get).mockReturnValue(new Promise((r) => (resolve = r)));

    const first = fetchStatistics();
    const second = fetchStatistics();
    resolve({ data: { data: { total: 3 } } });

    await expect(first).resolves.toEqual({ total: 3 });
    await expect(second).resolves.toEqual({ total: 3 });
    expect(apiClient.get).toHaveBeenCalledTimes(1);
  });

  it("reuses a settled result for views that mount a moment later", async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { data: { total: 1 } } });

    await expect(fetchStatistics()).resolves.toEqual({ total: 1 });
    await expect(fetchStatistics()).resolves.toEqual({ total: 1 });
    expect(apiClient.get).toHaveBeenCalledTimes(1);
  });

  it("asks the server again when fresh numbers are needed or the result is old", async () => {
    vi.useFakeTimers();
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce({ data: { data: { total: 1 } } })
      .mockResolvedValueOnce({ data: { data: { total: 2 } } })
      .mockResolvedValueOnce({ data: { data: { total: 3 } } });

    await expect(fetchStatistics()).resolves.toEqual({ total: 1 });
    await expect(fetchStatistics({ fresh: true })).resolves.toEqual({ total: 2 });
    vi.advanceTimersByTime(STATISTICS_REUSE_MS + 1);
    await expect(fetchStatistics()).resolves.toEqual({ total: 3 });
    expect(apiClient.get).toHaveBeenCalledTimes(3);
  });

  it("lets a failed request be retried", async () => {
    vi.mocked(apiClient.get)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ data: { data: { total: 4 } } });

    await expect(fetchStatistics()).rejects.toThrow("offline");
    await expect(fetchStatistics()).resolves.toEqual({ total: 4 });
  });
});
