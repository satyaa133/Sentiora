import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/memoryService", () => ({
  fetchMemoryItem: vi.fn(),
  renameMemoryItem: vi.fn(),
  enrichMemoryItem: vi.fn(),
}));
vi.mock("../services/privacyService", () => ({
  fetchPrivacyConsent: vi.fn(),
  acceptPrivacyNotice: vi.fn(),
}));

import MemoryDetailDrawer, { SUMMARY_POLL_MS } from "../components/MemoryDetailDrawer";
import { resetPrivacyConsentCache } from "../hooks/usePrivacyConsent";
import { enrichMemoryItem, fetchMemoryItem, renameMemoryItem } from "../services/memoryService";
import { fetchPrivacyConsent } from "../services/privacyService";
import type { MemoryItem } from "../types/memory";

function save(extra: Partial<MemoryItem> = {}): MemoryItem {
  const at = "2026-11-20T10:00:00Z";
  return {
    id: "m1",
    user_id: "u1",
    source_type: "webpage",
    url: "https://bees.example.com/a",
    title: "Keeping bees",
    content: "Beekeepers calm a hive with cool smoke.",
    summary: null,
    key_points: null,
    enrichment_status: "none",
    author: null,
    favicon_url: null,
    thumbnail_url: null,
    domain: "bees.example.com",
    language: "en",
    content_length: 40,
    word_count: 7,
    reading_time_seconds: 3,
    status: "ready",
    captured_at: at,
    created_at: at,
    ...extra,
  };
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.useRealTimers();
  resetPrivacyConsentCache();
});

describe("memory drawer (S7)", () => {
  it("shows the summary and key points of an enriched save", async () => {
    vi.mocked(fetchMemoryItem).mockResolvedValue(
      save({
        summary: "How to keep a calm, healthy hive.",
        key_points: ["Use cool smoke", "Inspect on warm afternoons"],
        enrichment_status: "ready",
      }),
    );
    render(<MemoryDetailDrawer item={save()} onClose={vi.fn()} onDelete={vi.fn()} />);
    const summary = await screen.findByRole("region", { name: "Summary" });
    expect(fetchMemoryItem).toHaveBeenCalledWith("m1"); // opening queues the summary (S5)
    expect(await within(summary).findByText("How to keep a calm, healthy hive.")).toBeInTheDocument();
    expect(within(summary).getByText("Use cool smoke")).toBeInTheDocument();
    expect(within(summary).getByRole("button", { name: "Summarise again" })).toBeInTheDocument();
  });

  it("Summarise asks for consent once, queues the summary and shows it when ready", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(fetchPrivacyConsent).mockResolvedValue({
      privacy_consent_version: "2026-11-20",
      privacy_consent_current: true,
    });
    vi.mocked(fetchMemoryItem).mockResolvedValueOnce(save());
    vi.mocked(enrichMemoryItem).mockResolvedValue(save({ enrichment_status: "queued" }));
    const onItemChanged = vi.fn();
    render(
      <MemoryDetailDrawer item={save()} onClose={vi.fn()} onDelete={vi.fn()} onItemChanged={onItemChanged} />,
    );
    const summary = screen.getByRole("region", { name: "Summary" });
    fireEvent.click(within(summary).getByRole("button", { name: "Summarise" }));
    expect(await within(summary).findByText(/writing a summary/)).toBeInTheDocument();
    expect(enrichMemoryItem).toHaveBeenCalledWith("m1");

    vi.mocked(fetchMemoryItem).mockResolvedValue(
      save({ summary: "Calm bees, healthy hive.", enrichment_status: "ready" }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SUMMARY_POLL_MS + 10);
    });
    expect(await within(summary).findByText("Calm bees, healthy hive.")).toBeInTheDocument();
    await waitFor(() => expect(onItemChanged).toHaveBeenLastCalledWith(expect.objectContaining({ enrichment_status: "ready" })));
  });

  it("says when today's summary limit is reached", async () => {
    vi.mocked(fetchPrivacyConsent).mockResolvedValue({
      privacy_consent_version: "2026-11-20",
      privacy_consent_current: true,
    });
    vi.mocked(fetchMemoryItem).mockResolvedValue(save());
    const { AxiosError } = await import("axios");
    const limited = new AxiosError("limited");
    limited.response = { status: 429, data: { error: { code: "RATE_LIMITED", message: "Daily summary limit reached." } } } as never;
    vi.mocked(enrichMemoryItem).mockRejectedValue(limited);
    render(<MemoryDetailDrawer item={save()} onClose={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Summarise" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("today's summary limit");
  });

  it("renames a save", async () => {
    vi.mocked(fetchMemoryItem).mockResolvedValue(save());
    vi.mocked(renameMemoryItem).mockResolvedValue(save({ title: "Calming a hive" }));
    const onItemChanged = vi.fn();
    render(
      <MemoryDetailDrawer item={save()} onClose={vi.fn()} onDelete={vi.fn()} onItemChanged={onItemChanged} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    const form = screen.getByRole("form", { name: "Rename this save" });
    const field = within(form).getByLabelText("Title");
    fireEvent.change(field, { target: { value: "   " } });
    fireEvent.click(within(form).getByRole("button", { name: "Save title" }));
    expect(await within(form).findByText("Give this save a title.")).toBeInTheDocument();
    expect(renameMemoryItem).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: "Calming  a hive" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save title" }));
    await waitFor(() => expect(renameMemoryItem).toHaveBeenCalledWith("m1", "Calming a hive"));
    expect(await screen.findByRole("dialog", { name: "Calming a hive" })).toBeInTheDocument();
    expect(onItemChanged).toHaveBeenCalledWith(expect.objectContaining({ title: "Calming a hive" }));
  });
});
