import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./apiClient", () => ({ default: { get: vi.fn() } }));

import apiClient from "./apiClient";
import { fetchStatistics } from "./dashboardService";

afterEach(() => {
  vi.mocked(apiClient.get).mockReset();
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

  it("fetches again once the previous request settled", async () => {
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce({ data: { data: { total: 1 } } })
      .mockResolvedValueOnce({ data: { data: { total: 2 } } });

    await expect(fetchStatistics()).resolves.toEqual({ total: 1 });
    await expect(fetchStatistics()).resolves.toEqual({ total: 2 });
    expect(apiClient.get).toHaveBeenCalledTimes(2);
  });

  it("lets a failed request be retried", async () => {
    vi.mocked(apiClient.get)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ data: { data: { total: 4 } } });

    await expect(fetchStatistics()).rejects.toThrow("offline");
    await expect(fetchStatistics()).resolves.toEqual({ total: 4 });
  });
});
