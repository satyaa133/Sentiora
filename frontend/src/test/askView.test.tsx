import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AskSentioraView from "../components/views/AskSentioraView";
import { linkCitations } from "../components/views/ask/citations";
import type { StreamFinal, StreamSource } from "../services/askStream";
import type { MemoryItem } from "../types/memory";

vi.mock("../services/askStream", () => ({ askStream: vi.fn() }));
vi.mock("../services/memoryService", async (importOriginal) => {
  const actual = await importOriginal<typeof MemoryService>();
  return { ...actual, createMemoryItem: vi.fn() };
});
vi.mock("../services/feedbackService", () => ({ sendAnswerFeedback: vi.fn() }));
vi.mock("../services/privacyService", () => ({
  fetchPrivacyConsent: vi.fn(),
  acceptPrivacyNotice: vi.fn(),
}));
import { resetPrivacyConsentCache } from "../hooks/usePrivacyConsent";
import { AskApiError } from "../services/askService";
import { askStream } from "../services/askStream";
import { acceptPrivacyNotice, fetchPrivacyConsent } from "../services/privacyService";
import { sendAnswerFeedback } from "../services/feedbackService";
import { createMemoryItem } from "../services/memoryService";
import type * as MemoryService from "../services/memoryService";

const VIDEO: StreamSource = {
  id: "S1",
  memory_id: "v",
  chunk_id: "c1",
  title: "Production Dockerfiles, a talk",
  url: "https://www.youtube.com/watch?v=abc",
  source_type: "youtube",
  domain: "youtube.com",
  heading: "[14:20–16:05]",
  page_number: null,
  start_sec: 860,
  end_sec: 965,
  source_available: true,
  captured_at: "2026-10-20T10:00:00Z",
  excerpt: "Multi-stage builds copy only the final artefacts.",
};
const ARTICLE: StreamSource = {
  ...VIDEO,
  id: "S2",
  memory_id: "a",
  chunk_id: "c2",
  title: "Docker image size guide",
  url: "https://example.dev/size",
  source_type: "webpage",
  domain: "example.dev",
  heading: null,
  start_sec: null,
  end_sec: null,
  excerpt: "Alpine base images are small.",
};

function final(overrides: Partial<StreamFinal> = {}): StreamFinal {
  return {
    answer: "Use multi-stage builds [S1]. Smaller bases help too [S2].",
    mode: "memory",
    usedSources: ["S1", "S2"],
    followUps: ["How do I scan a Docker image for vulnerabilities?"],
    insufficient_context: false,
    used_fallback: false,
    ...overrides,
  };
}

/** Make the next askStream call stream `deltas` with `sources`, then resolve `result`. */
function streams(result: StreamFinal, sources: StreamSource[] = [VIDEO, ARTICLE], deltas?: string[]) {
  vi.mocked(askStream).mockImplementationOnce(async (_payload, handlers = {}) => {
    handlers.onSources?.(sources);
    for (const piece of deltas ?? [result.answer]) handlers.onDelta?.(piece);
    return result;
  });
}

function item(id: string, title: string, sourceType: MemoryItem["source_type"] = "webpage"): MemoryItem {
  return {
    id,
    user_id: "u1",
    source_type: sourceType,
    url: `https://example.dev/${id}`,
    title,
    content: `${title} body text.`,
    word_count: 100,
    status: "ready",
    captured_at: "2026-10-20T10:00:00Z",
    created_at: "2026-10-20T10:00:00Z",
  } as MemoryItem;
}

function ask(question: string) {
  fireEvent.change(screen.getByLabelText("Your question"), { target: { value: question } });
  fireEvent.click(screen.getByRole("button", { name: "Send question" }));
}

beforeEach(() => {
  localStorage.setItem("sentiora_auth_session", JSON.stringify({ user: { id: "u1", email: "u@example.dev" } }));
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  resetPrivacyConsentCache();
  localStorage.clear();
});

function consented(current = true) {
  vi.mocked(fetchPrivacyConsent).mockResolvedValue({
    privacy_consent_version: current ? "2026-11-20" : null,
    privacy_consent_current: current,
  });
}

function instant(overrides: Partial<StreamFinal> = {}): StreamFinal {
  return final({
    answer: "- (14:20) Multi-stage builds copy only the final artefacts. [S1]",
    mode: "instant",
    usedSources: ["S1"],
    aiAvailable: true,
    ...overrides,
  });
}

describe("citation markers", () => {
  it("links [S#] markers but leaves code alone", () => {
    expect(linkCitations("Fact [S1][S2]. `arr[S1]`\n```\nx[S3]\n```")).toBe(
      "Fact [S1](#sentiora-cite-1)[S2](#sentiora-cite-2). `arr[S1]`\n```\nx[S3]\n```",
    );
  });
});

describe("Ask Sentiora answers", () => {
  it("renders [S#] as coral chips with a preview, opening videos at the cited time", async () => {
    streams(final());
    render(<AskSentioraView items={[]} />);
    ask("How do I keep images small?");

    const answer = await screen.findByRole("article", { name: "Echo's answer" });
    const chip = within(answer).getByRole("link", { name: /Source 1: Production Dockerfiles, a talk, at 14:20/ });
    expect(chip).toHaveTextContent("1");
    expect(chip).toHaveAttribute("href", "https://www.youtube.com/watch?v=abc&t=860s");
    expect(chip).toHaveAttribute("target", "_blank");
    const preview = document.getElementById(chip.getAttribute("aria-describedby") ?? "");
    expect(preview).toHaveTextContent("Multi-stage builds copy only the final artefacts.");
    expect(within(answer).getByRole("link", { name: /Source 2: Docker image size guide/ })).toHaveAttribute(
      "href",
      "https://example.dev/size",
    );
    expect(answer).not.toHaveTextContent("[S1]");
    expect(answer).toHaveTextContent("From your memory");
  });

  it("labels an instant answer as quoted from the user's saves", async () => {
    streams(final({ mode: "instant", aiAvailable: true }));
    render(<AskSentioraView items={[]} />);
    ask("How do I keep images small?");

    const answer = await screen.findByRole("article", { name: "Echo's answer" });
    expect(answer).toHaveTextContent("Quoted from your saves");
  });

  it("drops markers for sources that were not supplied", async () => {
    streams(final({ answer: "Only one source [S1] here [S7].", usedSources: ["S1"] }));
    render(<AskSentioraView items={[]} />);
    ask("Question?");
    const answer = await screen.findByRole("article", { name: "Echo's answer" });
    expect(within(answer).getAllByRole("link", { name: /^Source \d/ })).toHaveLength(1);
    expect(answer).not.toHaveTextContent("[S7]");
  });

  it("lists the used sources in a collapsible panel", async () => {
    streams(final());
    const onOpenMemory = vi.fn(() => true);
    render(<AskSentioraView items={[]} onOpenMemory={onOpenMemory} />);
    ask("How do I keep images small?");

    const toggle = await screen.findByRole("button", { name: /Sources used/ });
    expect(screen.getByRole("heading", { name: "Sources used" })).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: /Jump to 14:20/ })).toHaveAttribute(
      "href",
      "https://www.youtube.com/watch?v=abc&t=860s",
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Open memory" })[0]!);
    expect(onOpenMemory).toHaveBeenCalledWith("v");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Open memory" })).not.toBeInTheDocument();
  });

  it("shows one mode badge for general answers and sends follow-up chips with history", async () => {
    streams(
      final({
        answer: "A heap is a tree-shaped priority queue. Example: arr[1] holds a child.",
        mode: "general",
        usedSources: [],
        followUps: ["How is a heap different from a binary search tree?"],
      }),
      [],
    );
    render(<AskSentioraView items={[]} />);
    ask("What is a heap?");
    const answer = await screen.findByRole("article", { name: "Echo's answer" });
    expect(answer).toHaveTextContent("General knowledge");
    expect(answer).toHaveTextContent("arr[1] holds a child");
    expect(screen.queryByRole("heading", { name: "Sources used" })).not.toBeInTheDocument();

    streams(final({ answer: "Another one.", mode: "general", usedSources: [], followUps: [] }), []);
    fireEvent.click(screen.getByRole("button", { name: "How is a heap different from a binary search tree?" }));
    await screen.findByText("Another one.");
    expect(vi.mocked(askStream).mock.lastCall?.[0]).toEqual(
      expect.objectContaining({
        question: "How is a heap different from a binary search tree?",
        history: [
          { role: "user", content: "What is a heap?" },
          { role: "assistant", content: expect.stringContaining("priority queue") },
        ],
      }),
    );
  });

  it("says plainly when nothing relevant is saved", async () => {
    streams(
      final({
        answer: "I couldn't find enough information in your saved memories to answer that.",
        usedSources: [],
        insufficient_context: true,
        followUps: [],
      }),
      [],
    );
    render(<AskSentioraView items={[item("d", "Doc")]} />);
    ask("What did I save about kubernetes?");
    expect(await screen.findByRole("heading", { name: "Nothing relevant saved yet" })).toBeInTheDocument();
  });

  it("renders Markdown lists, bold text and fenced code", async () => {
    streams(
      final({
        answer:
          "Revalidation:\n\n*   **304 Response**: reuse the stored copy.\n\n```python\ndef f(n):\n    # Base case\n    return 1\n```",
        usedSources: [],
        mode: "general",
      }),
      [],
    );
    const { container } = render(<AskSentioraView items={[]} />);
    ask("How does revalidation work?");
    const listItem = await screen.findByRole("listitem");
    expect(listItem).toHaveTextContent("304 Response: reuse the stored copy.");
    expect(within(listItem).getByText("304 Response").tagName).toBe("STRONG");
    expect(container.querySelector("pre code")?.textContent).toBe("def f(n):\n    # Base case\n    return 1\n");
    expect(screen.queryByRole("heading", { name: "Base case" })).toBeNull();
  });
});

describe("Ask Sentiora controls", () => {
  it("streams with a typing state, and Stop keeps the partial answer", async () => {
    let release: (() => void) | undefined;
    vi.mocked(askStream).mockImplementationOnce(async (_payload, handlers = {}, signal) => {
      handlers.onSources?.([VIDEO]);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      handlers.onDelta?.("Partial answer ");
      await new Promise((_resolve, reject) =>
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))),
      );
      return final();
    });
    render(<AskSentioraView items={[]} />);
    ask("Long question?");

    expect(await screen.findByText("Reading 1 saved source…")).toBeInTheDocument();
    await act(async () => release?.());
    expect(await screen.findByText(/Partial answer/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stop answering" }));
    expect(await screen.findByText("Stopped")).toBeInTheDocument();
    expect(screen.getByText(/Partial answer/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send question" })).toBeInTheDocument();
  });

  it("asks for a quoted answer first and offers Explain with AI only when it can help", async () => {
    streams(instant());
    render(<AskSentioraView items={[]} />);
    ask("How do I keep images small?");
    const answer = await screen.findByRole("article", { name: "Echo's answer" });
    expect(vi.mocked(askStream).mock.lastCall?.[0]).toEqual(
      expect.objectContaining({ question: "How do I keep images small?", answer_mode: "instant" }),
    );
    expect(answer).toHaveTextContent("Quoted from your saves");
    expect(within(answer).getByRole("button", { name: "Explain with AI" })).toBeEnabled();
    expect(within(answer).queryByRole("button", { name: "Regenerate" })).not.toBeInTheDocument();

    streams(instant({ aiAvailable: false }));
    ask("What did I save?");
    await waitFor(() => expect(screen.getAllByRole("article", { name: "Echo's answer" })).toHaveLength(2));
    const second = screen.getAllByRole("article", { name: "Echo's answer" })[1]!;
    expect(within(second).queryByRole("button", { name: "Explain with AI" })).not.toBeInTheDocument();
  });

  it("streams the AI answer below the quoted one and keeps both in history", async () => {
    consented();
    streams(instant());
    render(<AskSentioraView items={[]} />);
    ask("How do I keep images small?");
    const answer = await screen.findByRole("article", { name: "Echo's answer" });

    streams(
      final({ answer: "Build in stages and copy only what runs [S1].", usedSources: ["S1"], followUps: ["Why use Alpine?"] }),
      [VIDEO],
      ["Build in stages ", "and copy only what runs [S1]."],
    );
    fireEvent.click(within(answer).getByRole("button", { name: "Explain with AI" }));
    const ai = await within(answer).findByRole("region", { name: "AI answer" });
    expect(await within(ai).findByText(/Build in stages/)).toBeInTheDocument();
    expect(vi.mocked(askStream).mock.lastCall?.[0]).toEqual(
      expect.objectContaining({ question: "How do I keep images small?", answer_mode: "ai" }),
    );
    expect(vi.mocked(askStream).mock.lastCall?.[0]).not.toHaveProperty("history");
    // The quoted answer stays; the AI one adds to it.
    expect(answer).toHaveTextContent("Multi-stage builds copy only the final artefacts.");
    expect(within(ai).getByText("From your memory")).toBeInTheDocument();
    expect(within(answer).queryByRole("button", { name: "Explain with AI" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Why use Alpine?" })).toBeInTheDocument();

    await waitFor(() =>
      expect(localStorage.getItem("sentiora.ask.history.u1")).toContain("Build in stages and copy only what runs"),
    );
    expect(localStorage.getItem("sentiora.ask.history.u1")).toContain("Multi-stage builds copy only");
  });

  it("rates the quoted and the AI answer separately", async () => {
    consented();
    vi.mocked(sendAnswerFeedback).mockResolvedValue(undefined);
    streams(instant());
    render(<AskSentioraView items={[]} />);
    ask("How do I keep images small?");
    const answer = await screen.findByRole("article", { name: "Echo's answer" });
    streams(final({ answer: "Written answer [S1].", usedSources: ["S1"] }), [VIDEO]);
    fireEvent.click(within(answer).getByRole("button", { name: "Explain with AI" }));
    const ai = await within(answer).findByRole("region", { name: "AI answer" });
    await within(ai).findByText(/Written answer/);

    const quotedGroup = within(answer).getByRole("group", { name: "Rate the quoted answer" });
    fireEvent.click(within(quotedGroup).getByRole("button", { name: "Helpful" }));
    const aiGroup = within(ai).getByRole("group", { name: "Rate the AI answer" });
    fireEvent.click(within(aiGroup).getByRole("button", { name: "Not helpful" }));
    await waitFor(() => expect(sendAnswerFeedback).toHaveBeenCalledTimes(2));
    expect(vi.mocked(sendAnswerFeedback).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ answerMode: "instant", rating: 1, sourceChunkIds: ["c1"] }),
    );
    expect(vi.mocked(sendAnswerFeedback).mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ answerMode: "ai", rating: -1, sourceChunkIds: ["c1"] }),
    );
  });

  it("says when the AI is busy and lets the user try again", async () => {
    consented();
    streams(instant());
    render(<AskSentioraView items={[]} />);
    ask("How do I keep images small?");
    const answer = await screen.findByRole("article", { name: "Echo's answer" });
    vi.mocked(askStream).mockRejectedValueOnce(new AskApiError("busy", 429, "AI_BUSY", 7));
    fireEvent.click(within(answer).getByRole("button", { name: "Explain with AI" }));
    const alert = await within(answer).findByRole("alert");
    expect(alert).toHaveTextContent("Try again in 7 seconds");
    expect(answer).toHaveTextContent("Multi-stage builds copy only the final artefacts.");

    streams(final({ answer: "Now it worked [S1].", usedSources: ["S1"] }), [VIDEO]);
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await within(answer).findByText(/Now it worked/)).toBeInTheDocument();
  });

  it("shows the privacy notice before the first AI answer", async () => {
    consented(false);
    vi.mocked(acceptPrivacyNotice).mockResolvedValue({
      privacy_consent_version: "2026-11-20",
      privacy_consent_current: true,
    });
    streams(instant());
    render(<AskSentioraView items={[]} />);
    ask("How do I keep images small?");
    const answer = await screen.findByRole("article", { name: "Echo's answer" });
    fireEvent.click(within(answer).getByRole("button", { name: "Explain with AI" }));

    const dialog = await screen.findByRole("dialog", { name: "Before Echo uses AI" });
    expect(dialog).toHaveTextContent("do not use it to train their models");
    expect(askStream).toHaveBeenCalledTimes(1); // nothing sent to the AI yet
    streams(final({ answer: "After consent [S1].", usedSources: ["S1"] }), [VIDEO]);
    fireEvent.click(within(dialog).getByRole("button", { name: "I agree" }));
    expect(await within(answer).findByText(/After consent/)).toBeInTheDocument();
    expect(acceptPrivacyNotice).toHaveBeenCalledTimes(1);
  });

  it("asks for consent again when the API says it is missing", async () => {
    consented(true);
    vi.mocked(acceptPrivacyNotice).mockResolvedValue({
      privacy_consent_version: "2026-11-20",
      privacy_consent_current: true,
    });
    streams(instant());
    render(<AskSentioraView items={[]} />);
    ask("How do I keep images small?");
    const answer = await screen.findByRole("article", { name: "Echo's answer" });
    vi.mocked(askStream).mockRejectedValueOnce(
      new AskApiError("consent", 403, "PRIVACY_CONSENT_REQUIRED"),
    );
    fireEvent.click(within(answer).getByRole("button", { name: "Explain with AI" }));
    const dialog = await screen.findByRole("dialog", { name: "Before Echo uses AI" });
    streams(final({ answer: "Retried [S1].", usedSources: ["S1"] }), [VIDEO]);
    fireEvent.click(within(dialog).getByRole("button", { name: "I agree" }));
    expect(await within(answer).findByText(/Retried/)).toBeInTheDocument();
  });

  it("offers a retry after an error", async () => {
    vi.mocked(askStream).mockRejectedValueOnce(new Error("offline"));
    render(<AskSentioraView items={[]} />);
    ask("Hello?");
    expect(await screen.findByRole("alert")).toHaveTextContent("could not reach the server");
    streams(final({ answer: "Hi.", mode: "general", usedSources: [], followUps: [] }), []);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Hi.")).toBeInTheDocument();
  });

  it("limits answers to a source type or one memory from the scope picker", async () => {
    render(<AskSentioraView items={[item("v", "Sliding window playlist", "youtube")]} />);
    fireEvent.click(screen.getByRole("button", { name: /Search in: All memories/ }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Choose what Echo searches" })).getByRole("button", { name: "Videos" }));
    streams(final());
    ask("What did I watch?");
    await screen.findByRole("article", { name: "Echo's answer" });
    expect(vi.mocked(askStream).mock.lastCall?.[0]).toEqual(expect.objectContaining({ source_type: "youtube" }));

    fireEvent.click(screen.getByRole("button", { name: /Search in: Videos/ }));
    fireEvent.change(screen.getByLabelText("Find a memory"), { target: { value: "sliding" } });
    fireEvent.click(screen.getByRole("button", { name: /Sliding window playlist/ }));
    streams(final());
    ask("And this one?");
    await waitFor(() => expect(vi.mocked(askStream)).toHaveBeenCalledTimes(2));
    expect(vi.mocked(askStream).mock.lastCall?.[0]).toEqual(expect.objectContaining({ memory_id: "v" }));

    fireEvent.click(screen.getByRole("button", { name: "Stop limiting answers to Sliding window playlist" }));
    streams(final());
    ask("Anything else?");
    await waitFor(() => expect(vi.mocked(askStream)).toHaveBeenCalledTimes(3));
    expect(vi.mocked(askStream).mock.lastCall?.[0]).not.toHaveProperty("memory_id");
  });

  it("keeps a launched scope until the user removes it", async () => {
    const onLaunchConsumed = vi.fn();
    render(
      <AskSentioraView
        items={[item("v", "Sliding window playlist", "youtube")]}
        launch={{ id: 1, question: 'What is "Sliding window playlist" about?', scope: { memoryId: "v", label: "Sliding window playlist" } }}
        onLaunchConsumed={onLaunchConsumed}
      />,
    );
    expect(onLaunchConsumed).toHaveBeenCalled();
    expect(screen.getByLabelText("Your question")).toHaveValue('What is "Sliding window playlist" about?');
    streams(final());
    fireEvent.click(screen.getByRole("button", { name: "Send question" }));
    await screen.findByRole("article", { name: "Echo's answer" });
    expect(vi.mocked(askStream).mock.lastCall?.[0]).toEqual(expect.objectContaining({ memory_id: "v" }));
  });

  it("sends on Enter, adds a newline on Shift+Enter, and focuses on Ctrl/Cmd+K", async () => {
    render(<AskSentioraView items={[]} />);
    const input = screen.getByLabelText("Your question");
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "Line one" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(vi.mocked(askStream)).not.toHaveBeenCalled();
    streams(final());
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(vi.mocked(askStream)).toHaveBeenCalledOnce());
  });

  it("copies the answer with numbered sources and saves it as a note", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    vi.mocked(createMemoryItem).mockResolvedValue({} as Awaited<ReturnType<typeof createMemoryItem>>);
    streams(final());
    render(<AskSentioraView items={[]} />);
    ask("How do I keep images small?");
    await screen.findByRole("article", { name: "Echo's answer" });

    fireEvent.click(screen.getByRole("button", { name: "Copy answer" }));
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining("Use multi-stage builds [1]. Smaller bases help too [2]."),
    );
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("[1] Production Dockerfiles, a talk"));

    fireEvent.click(screen.getByRole("button", { name: "Save as note" }));
    expect(await screen.findByRole("button", { name: "Saved as note" })).toBeDisabled();
    const payload = vi.mocked(createMemoryItem).mock.calls[0]?.[0];
    expect(payload?.url).toMatch(/^https:\/\/sentiora\.app\/notes\/\d+$/);
    expect(payload?.title).toBe("Note: How do I keep images small?");
    expect(payload?.content).toContain("[2] Docker image size guide (https://example.dev/size)");
  });

  it("sends a rating with the cited chunks and shows it was received", async () => {
    vi.mocked(sendAnswerFeedback).mockResolvedValueOnce();
    streams(final());
    render(<AskSentioraView items={[]} />);
    ask("How do I keep images small?");
    await screen.findByText(/Use multi-stage builds/);

    const group = screen.getByRole("group", { name: "Rate this answer" });
    fireEvent.click(within(group).getByRole("button", { name: "Not helpful" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Thanks");
    expect(sendAnswerFeedback).toHaveBeenCalledWith({
      question: "How do I keep images small?",
      answerMode: "memory",
      rating: -1,
      sourceChunkIds: ["c1", "c2"],
    });
    const notHelpful = within(group).getByRole("button", { name: "Not helpful" });
    expect(notHelpful).toHaveAttribute("aria-pressed", "true");
    expect(notHelpful).toBeDisabled();
    expect(within(group).getByRole("button", { name: "Helpful" })).toBeDisabled();
  });

  it("lets the user try again when a rating fails", async () => {
    vi.mocked(sendAnswerFeedback).mockRejectedValueOnce(new Error("offline"));
    streams(final());
    render(<AskSentioraView items={[]} />);
    ask("How do I keep images small?");
    await screen.findByText(/Use multi-stage builds/);

    fireEvent.click(screen.getByRole("button", { name: "Helpful" }));
    expect(await screen.findByText("Could not send your rating. Try again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Helpful" })).toBeEnabled();
  });

  it("keeps conversations in this browser and reopens them from history", async () => {
    streams(final({ answer: "Layer caching answer [S1].", usedSources: ["S1"] }));
    const { unmount } = render(<AskSentioraView items={[]} />);
    ask("How does layer caching work?");
    await screen.findByText(/Layer caching answer/);
    await waitFor(() => expect(localStorage.getItem("sentiora.ask.history.u1")).toContain("layer caching"));
    unmount();

    render(<AskSentioraView items={[]} />);
    const history = screen.getAllByRole("navigation", { name: "Conversation history" })[0]!;
    fireEvent.click(within(history).getByRole("button", { name: /^How does layer caching work\?/ }));
    expect(await screen.findByText(/Layer caching answer/)).toBeInTheDocument();
    fireEvent.click(within(history).getByRole("button", { name: /Delete conversation/ }));
    expect(localStorage.getItem("sentiora.ask.history.u1")).toBe("[]");
  });
});
