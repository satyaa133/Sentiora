import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Message = { type: string };

let sentMessages: Message[] = [];
let signedIn = false;
let userDomains: string[] = [];

function installChrome(): void {
  sentMessages = [];
  vi.stubGlobal("chrome", {
    runtime: {
      id: "ext",
      lastError: undefined,
      onMessage: { addListener: vi.fn() },
      sendMessage: vi.fn((message: Message, callback?: (response: unknown) => void) => {
        sentMessages.push(message);
        if (message.type === "GET_SESSION_STATE") callback?.({ signedIn });
        else callback?.({ success: true });
      }),
    },
    storage: {
      local: {
        get: async (key: string) => ({ [key]: userDomains }),
      },
    },
  });
}

async function loadContentScript(): Promise<void> {
  vi.resetModules();
  delete window.__sentioraContentLoaded;
  installChrome();
  await import("./index");
  // Auto-capture runs 1s after load; let it and its awaits finish.
  await vi.advanceTimersByTimeAsync(1500);
}

const captureMessages = () => sentMessages.filter((m) => m.type.startsWith("CAPTURE_"));

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  signedIn = false;
  userDomains = [];
  document.title = "Binary search, explained";
  document.body.innerHTML = `<article><h1>Binary search</h1>${"<p>Binary search halves the range on every step until it finds the target value in a sorted array.</p>".repeat(20)}</article>`;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("content script auto-capture", () => {
  it("sends nothing but the session check while signed out", async () => {
    await loadContentScript();
    expect(sentMessages.map((m) => m.type)).toEqual(["GET_SESSION_STATE"]);
  });

  it("captures the page once signed in", async () => {
    signedIn = true;
    await loadContentScript();
    expect(captureMessages().map((m) => m.type)).toEqual(["CAPTURE_WEBPAGE"]);
  });

  it("skips a site the user blocked before sending any capture", async () => {
    signedIn = true;
    userDomains = [window.location.hostname];
    await loadContentScript();
    expect(captureMessages()).toEqual([]);
  });
});
