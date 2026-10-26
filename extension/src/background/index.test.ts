import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { YoutubeCapturePayload } from "../shared/types";

const apiFetch = vi.fn();
vi.mock("../services/extApiClient", () => ({ extApiFetch: (...args: unknown[]) => apiFetch(...args) }));

type Listener = (message: unknown, sender: unknown, sendResponse: (r: unknown) => void) => boolean | void;

// chrome.storage.session survives service-worker restarts; module memory does not.
let sessionStore: Record<string, unknown> = {};
let listeners: Listener[] = [];
const executeScript = vi.fn();

function installChrome(): void {
  listeners = [];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      onInstalled: { addListener: vi.fn() },
      onMessage: { addListener: (fn: Listener) => listeners.push(fn) },
      lastError: undefined,
    },
    storage: {
      session: {
        get: async (key: string) => ({ [key]: sessionStore[key] }),
        set: async (items: Record<string, unknown>) => Object.assign(sessionStore, items),
      },
      local: { get: async () => ({}), set: async () => undefined, remove: async () => undefined },
    },
    scripting: { executeScript },
    action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
    tabs: { query: vi.fn(), sendMessage: vi.fn() },
    extension: { isAllowedFileSchemeAccess: vi.fn() },
  };
}

async function loadWorker() {
  vi.resetModules();
  installChrome();
  return import("./index");
}

function send(message: unknown, sender: unknown = { tab: { id: 7 }, frameId: 0 }): Promise<unknown> {
  return new Promise((resolve) => {
    const keepOpen = listeners[0]?.(message, sender, resolve);
    expect(keepOpen).toBe(true); // async responses must keep the channel open
  });
}

const VIDEO_ID = "dQw4w9WgXcQ";

function youtubePayload(isForce = false): YoutubeCapturePayload {
  return {
    source_type: "youtube",
    url: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
    title: "Lighthouse Keepers",
    content: "the keepers trimmed the wicks every four hours and polished the fresnel lens nightly",
    structured_content: [
      { id: "node-0", type: "paragraph", text: "the keepers trimmed the wicks", order: 0, parent_id: null, metadata: { start_seconds: 0, end_seconds: 12 } },
    ],
    extraction: { method: "youtube_transcript", duration_ms: 10, status: "success", quality_score: 0.9, quality_reasons: [] },
    is_force: isForce,
  };
}

beforeEach(() => {
  sessionStore = {};
  apiFetch.mockReset();
  executeScript.mockReset();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("background capture messaging", () => {
  it("posts a capture and reports the server's processing status, not 'indexed'", async () => {
    await loadWorker();
    apiFetch.mockResolvedValue({ success: true, data: { id: "m1", status: "pending" } });

    const result = await send({ type: "CAPTURE_YOUTUBE", payload: youtubePayload(true) });

    expect(result).toEqual({ success: true, status: "pending", memoryId: "m1" });
    expect(apiFetch).toHaveBeenCalledTimes(1);
    const [path, init] = apiFetch.mock.calls[0] as [string, { body: string }];
    expect(path).toBe("/memory-items");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ source_type: "youtube", url: `https://www.youtube.com/watch?v=${VIDEO_ID}` });
    expect(body.structured_content[0].metadata.start_seconds).toBe(0);
    expect(body.extraction.method).toBe("youtube_transcript");
    expect(body.is_force).toBeUndefined(); // client-only flag is not sent to the API
  });

  it("does not create duplicate captures for concurrent messages about one video", async () => {
    await loadWorker();
    let release: () => void = () => undefined;
    apiFetch.mockImplementation(
      () => new Promise((resolve) => (release = () => resolve({ success: true, data: { id: "m1", status: "pending" } }))),
    );

    const first = send({ type: "CAPTURE_YOUTUBE", payload: youtubePayload() });
    const second = send({ type: "CAPTURE_YOUTUBE", payload: youtubePayload() });
    expect(await second).toEqual({ success: true, deduplicated: true });
    await vi.waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    release();
    expect(await first).toMatchObject({ success: true });
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the recent-capture cooldown across a service-worker restart", async () => {
    await loadWorker();
    apiFetch.mockResolvedValue({ success: true, data: { id: "m1", status: "pending" } });
    await send({ type: "CAPTURE_YOUTUBE", payload: youtubePayload() });

    await loadWorker(); // simulated restart: module state is gone, session storage remains
    expect(await send({ type: "CAPTURE_YOUTUBE", payload: youtubePayload() })).toEqual({
      success: true,
      deduplicated: true,
    });
    // An explicit popup capture still goes through.
    expect(await send({ type: "CAPTURE_YOUTUBE", payload: youtubePayload(true) })).toMatchObject({ success: true });
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it("surfaces API failures instead of dropping them", async () => {
    await loadWorker();
    apiFetch.mockRejectedValue(new Error("Session expired. Sign in again."));
    expect(await send({ type: "CAPTURE_YOUTUBE", payload: youtubePayload(true) })).toEqual({
      success: false,
      error: "Session expired. Sign in again.",
    });
    // A failed capture must not start the cooldown.
    apiFetch.mockResolvedValue({ success: true, data: { id: "m2", status: "pending" } });
    expect(await send({ type: "CAPTURE_YOUTUBE", payload: youtubePayload() })).toMatchObject({ success: true, memoryId: "m2" });
  });
});

describe("YouTube main-world player bridge", () => {
  it("answers GET_YOUTUBE_PLAYER_RESPONSE from the page's main world", async () => {
    await loadWorker();
    const trimmed = { videoDetails: { videoId: VIDEO_ID, title: "T" } };
    executeScript.mockResolvedValue([{ result: trimmed }]);

    const response = await send({ type: "GET_YOUTUBE_PLAYER_RESPONSE", videoId: VIDEO_ID });

    expect(response).toEqual({ success: true, playerResponse: trimmed });
    expect(executeScript).toHaveBeenCalledWith(
      expect.objectContaining({ world: "MAIN", target: { tabId: 7, frameIds: [0] }, args: [VIDEO_ID] }),
    );
  });

  it("returns null without a tab or for an invalid video id", async () => {
    const { getYoutubePlayerResponse } = await loadWorker();
    expect(await getYoutubePlayerResponse(VIDEO_ID, undefined, 0)).toBeNull();
    expect(await getYoutubePlayerResponse("bad", 7, 0)).toBeNull();
    expect(executeScript).not.toHaveBeenCalled();
  });

  it("returns null when the tab cannot be scripted", async () => {
    const { getYoutubePlayerResponse } = await loadWorker();
    executeScript.mockRejectedValue(new Error("Cannot access contents of the page"));
    expect(await getYoutubePlayerResponse(VIDEO_ID, 7, 0)).toBeNull();
  });

  it("reads the live player, verifies the video id, and trims the response", async () => {
    const { readYoutubePlayerResponseInPage } = await loadWorker();
    const full = {
      videoDetails: { videoId: VIDEO_ID, title: "Live title", author: "A", lengthSeconds: "98", keywords: ["x"] },
      playabilityStatus: { status: "OK" },
      captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: "u", languageCode: "en", name: { simpleText: "English" } }] } },
      streamingData: { formats: ["huge"] },
    };
    const player = document.createElement("div");
    player.id = "movie_player";
    (player as unknown as { getPlayerResponse: () => unknown }).getPlayerResponse = () => full;
    document.body.appendChild(player);
    try {
      const result = readYoutubePlayerResponseInPage(VIDEO_ID);
      expect(result?.videoDetails?.title).toBe("Live title");
      expect(result?.captions?.playerCaptionsTracklistRenderer?.captionTracks).toEqual([
        { baseUrl: "u", languageCode: "en", kind: undefined },
      ]);
      expect(result).not.toHaveProperty("streamingData");
      expect(readYoutubePlayerResponseInPage("AAAAAAAAAAA")).toBeNull(); // stale player for another video
    } finally {
      player.remove();
    }
  });
});

describe("auth token sync trust boundary", () => {
  const tokens = { type: "SYNC_AUTH_TOKENS", payload: { accessToken: "a", refreshToken: "r", user: { id: "u" } } };

  async function workerWithStorageSpy() {
    await loadWorker();
    const set = vi.fn(async () => undefined);
    const remove = vi.fn(async () => undefined);
    const chromeMock = (globalThis as unknown as {
      chrome: { storage: { local: Record<string, unknown>; session: Record<string, unknown> } };
    }).chrome;
    chromeMock.storage.local.set = set;
    chromeMock.storage.local.remove = remove;
    chromeMock.storage.session.set = set;
    chromeMock.storage.session.remove = remove;
    return { set, remove };
  }

  function sendSync(message: unknown, sender: unknown): Promise<unknown> {
    return new Promise((resolve) => listeners[0]?.(message, sender, resolve));
  }

  it.each([
    "https://sentiora-login.attacker.example/",
    "https://evil.example/?next=sentiora",
    "http://localhost:3000/",
    "http://127.0.0.1:5173/",
  ])("rejects tokens from a tab on %s", async (url) => {
    const { set } = await workerWithStorageSpy();
    const response = await sendSync(tokens, { tab: { id: 3, url }, url, frameId: 0 });
    expect(response).toMatchObject({ success: false });
    expect(set).not.toHaveBeenCalled();
  });

  it("rejects logout from an untrusted tab", async () => {
    const { remove } = await workerWithStorageSpy();
    const url = "https://sentiora.attacker.example/";
    const response = await sendSync({ type: "CLEAR_AUTH_TOKENS" }, { tab: { id: 3, url }, url, frameId: 0 });
    expect(response).toMatchObject({ success: false });
    expect(remove).not.toHaveBeenCalled();
  });

  it("accepts logout from the configured web app", async () => {
    const { remove } = await workerWithStorageSpy();
    const url = "http://localhost:5173/login";
    expect(await sendSync({ type: "CLEAR_AUTH_TOKENS" }, { tab: { id: 3, url }, url, frameId: 0 })).toMatchObject({ success: true });
    expect(remove).toHaveBeenCalled();
  });

  it("accepts tokens from the configured web app and from the popup", async () => {
    const { set } = await workerWithStorageSpy();
    const url = "http://localhost:5173/dashboard";
    expect(await sendSync(tokens, { tab: { id: 3, url }, url, frameId: 0 })).toMatchObject({ success: true });
    expect(await sendSync(tokens, { url: "chrome-extension://abc/src/popup/index.html" })).toMatchObject({ success: true });
    expect(set).toHaveBeenCalled();
  });
});
