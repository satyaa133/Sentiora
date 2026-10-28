import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/apiClient", () => ({
  API_BASE_URL: "http://api.test",
  refreshAccessToken: vi.fn(),
}));
vi.mock("../services/authStorage", () => ({
  getAccessToken: vi.fn(() => "access-1"),
  clearAuthStorage: vi.fn(),
}));
import { refreshAccessToken } from "../services/apiClient";
import { AskApiError } from "../services/askService";
import { askStream } from "../services/askStream";

function sse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { "Content-Type": "text/event-stream" } });
}

type FetchInit = NonNullable<Parameters<typeof fetch>[1]>;

const FINAL = {
  answer: "Halves the range [S1].",
  mode: "memory",
  usedSources: ["S1"],
  followUps: [],
  insufficient_context: false,
  used_fallback: false,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("askStream", () => {
  it("parses events split across network chunks", async () => {
    const fetchMock = vi.fn(async () =>
      sse([
        'event: sources\ndata: {"sources":[{"id":"S1","title":"Binary search"}]}\n\nevent: del',
        'ta\ndata: {"text":"Halves "}\n\nevent: delta\ndata: {"text":"the range"}\n',
        `\nevent: final\ndata: ${JSON.stringify(FINAL)}\n\n`,
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const deltas: string[] = [];
    const onSources = vi.fn();
    const result = await askStream({ question: "q" }, { onSources, onDelta: (t) => deltas.push(t) });

    expect(onSources).toHaveBeenCalledWith([{ id: "S1", title: "Binary search" }]);
    expect(deltas).toEqual(["Halves ", "the range"]);
    expect(result).toEqual(FINAL);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, FetchInit];
    expect(url).toBe("http://api.test/api/v1/chat/stream");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer access-1");
  });

  it("turns an error event into an AskApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sse([
          'event: delta\ndata: {"text":"Part"}\n\n',
          'event: error\ndata: {"code":"ASK_STREAM_INTERRUPTED","message":"The answer was cut off.","status":502}\n\n',
        ]),
      ),
    );
    await expect(askStream({ question: "q" })).rejects.toMatchObject({
      name: "AskApiError",
      code: "ASK_STREAM_INTERRUPTED",
      status: 502,
    });
  });

  it("reports HTTP errors with the API error code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: "AI_PROVIDER_UNAVAILABLE", message: "Out of credits." } }), {
            status: 503,
          }),
      ),
    );
    const error = await askStream({ question: "q" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AskApiError);
    expect(error).toMatchObject({ status: 503, code: "AI_PROVIDER_UNAVAILABLE", message: "Out of credits." });
  });

  it("refreshes the access token once on 401 and retries", async () => {
    vi.mocked(refreshAccessToken).mockResolvedValue("access-2");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(sse([`event: final\ndata: ${JSON.stringify(FINAL)}\n\n`]));
    vi.stubGlobal("fetch", fetchMock);
    await expect(askStream({ question: "q" })).resolves.toEqual(FINAL);
    const retried = fetchMock.mock.calls[1]?.[1] as FetchInit;
    expect((retried.headers as Record<string, string>).Authorization).toBe("Bearer access-2");
  });

  it("fails when the stream ends without a final event", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sse(['event: delta\ndata: {"text":"Part"}\n\n'])));
    await expect(askStream({ question: "q" })).rejects.toMatchObject({ code: "ASK_STREAM_INTERRUPTED" });
  });
});
