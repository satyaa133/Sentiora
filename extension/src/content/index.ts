import { isCurrentPageSensitive } from "./sensitiveGuard";
import { isYoutubeWatchPage, captureYoutube } from "./youtubeCapture";
import { isPdfDocument, capturePdf } from "./pdfCapture";
import { captureWebpageTimed } from "./webpageCapture";
import { sendCaptureMessage } from "../shared/captureUtils";
import type { CapturePayload, ExtensionMessage } from "../shared/types";

export type CapturePipelineResult =
  | { status: "saved"; deduplicated?: boolean }
  | { status: "skipped"; reason: "sensitive" | "insufficient_content" | "no_payload" }
  | { status: "failed"; error: string };

export type ExtractCaptureResult =
  | { status: "ok"; payload: CapturePayload; extractionMs?: number }
  | { status: "skipped"; reason: "sensitive" | "insufficient_content" | "no_payload" }
  | { status: "failed"; error: string };

declare global {
  interface Window {
    __sentioraContentLoaded?: boolean;
  }
}

export async function extractCapturePayload(manualCapture = false): Promise<ExtractCaptureResult> {
  const started = performance.now();

  if (isCurrentPageSensitive(manualCapture) && !manualCapture) {
    console.info("[Sentiora] Page capture skipped: page flagged as sensitive or blocked.");
    return { status: "skipped", reason: "sensitive" };
  }

  if (isYoutubeWatchPage()) {
    const payload = await captureYoutube(manualCapture);
    if (!payload) {
      return { status: "skipped", reason: "insufficient_content" };
    }
    return { status: "ok", payload, extractionMs: Math.round(performance.now() - started) };
  }

  if (isPdfDocument()) {
    const payload = await capturePdf(manualCapture);
    if (!payload) {
      return { status: "skipped", reason: "insufficient_content" };
    }
    return { status: "ok", payload, extractionMs: Math.round(performance.now() - started) };
  }

  try {
    const extracted = captureWebpageTimed();
    if (!extracted) {
      return { status: "skipped", reason: "insufficient_content" };
    }
    return { status: "ok", payload: extracted.payload, extractionMs: extracted.extractionMs };
  } catch (err) {
    return {
      status: "failed",
      error: err instanceof Error ? err.message : "Webpage capture failed.",
    };
  }
}

async function submitExtractedPayload(payload: CapturePayload): Promise<CapturePipelineResult> {
  const messageType: ExtensionMessage["type"] =
    payload.source_type === "youtube"
      ? "CAPTURE_YOUTUBE"
      : payload.source_type === "pdf"
        ? "CAPTURE_PDF"
        : "CAPTURE_WEBPAGE";

  const result = await sendCaptureMessage({ type: messageType, payload } as ExtensionMessage);
  if (!result.success) {
    return { status: "failed", error: result.error ?? "Capture API failed." };
  }
  return { status: "saved", deduplicated: result.deduplicated };
}

async function runAutoCapturePipeline(): Promise<CapturePipelineResult> {
  const extracted = await extractCapturePayload(false);
  if (extracted.status === "skipped") {
    return { status: "skipped", reason: extracted.reason };
  }
  if (extracted.status === "failed") {
    return { status: "failed", error: extracted.error };
  }
  return submitExtractedPayload(extracted.payload);
}

function initContentScript(): void {
  if (window.__sentioraContentLoaded) {
    return;
  }
  window.__sentioraContentLoaded = true;

  let autoCaptureQueued = false;
  let extractInFlight = false;

  function queueAutoCapture(): void {
    if (autoCaptureQueued) return;
    autoCaptureQueued = true;
    setTimeout(async () => {
      autoCaptureQueued = false;
      if (extractInFlight) return;
      extractInFlight = true;
      try {
        await runAutoCapturePipeline();
      } finally {
        extractInFlight = false;
      }
    }, 1000);
  }

  if (document.readyState === "complete") {
    queueAutoCapture();
  } else {
    window.addEventListener("load", queueAutoCapture);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "FORCE_CAPTURE") {
      extractInFlight = true;
      extractCapturePayload(true)
        .then((result) => {
          if (result.status === "ok") {
            sendResponse({
              success: true,
              payload: result.payload,
              extractionMs: result.extractionMs,
            });
            return;
          }

          if (result.status === "skipped") {
            sendResponse({
              success: false,
              skipped: true,
              reason: result.reason,
            });
            return;
          }

          sendResponse({
            success: false,
            error: result.error,
          });
        })
        .catch((err) => {
          sendResponse({
            success: false,
            error: err instanceof Error ? err.message : String(err),
          });
        })
        .finally(() => {
          extractInFlight = false;
        });
      return true;
    }

    if (message?.type === "PING") {
      sendResponse({ success: true });
      return true;
    }
  });

  let lastCapturedUrl = window.location.href;
  function checkYoutubeUrlChange(): void {
    if (window.location.href !== lastCapturedUrl) {
      lastCapturedUrl = window.location.href;
      if (isYoutubeWatchPage()) {
        setTimeout(() => {
          void runAutoCapturePipeline();
        }, 1500);
      }
    }
  }

  if (window.location.hostname.includes("youtube.com")) {
    window.addEventListener("yt-navigate-finish", () => {
      setTimeout(() => {
        void runAutoCapturePipeline();
      }, 1500);
    });
    window.addEventListener("popstate", checkYoutubeUrlChange);
    setInterval(checkYoutubeUrlChange, 2500);
  }

  const isDashboardHost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname.includes("sentiora");

  if (!isDashboardHost) {
    return;
  }

  const syncAuth = (session: { accessToken?: string; refreshToken?: string; user?: unknown }) => {
    try {
      if (typeof chrome === "undefined" || !chrome.runtime?.id) return;
      if (session?.accessToken && session?.refreshToken && session?.user) {
        chrome.runtime.sendMessage(
          {
            type: "SYNC_AUTH_TOKENS",
            payload: {
              accessToken: session.accessToken,
              refreshToken: session.refreshToken,
              user: session.user,
            },
          },
          () => {
            if (chrome.runtime.lastError) {
              /* ignore */
            }
          },
        );
      }
    } catch {
      /* ignore context invalidated */
    }
  };

  const syncFromStorage = () => {
    try {
      const rawSession = localStorage.getItem("sentiora_auth_session");
      if (!rawSession) return;
      const parsed = JSON.parse(rawSession);
      syncAuth(parsed);
    } catch {
      // Ignore storage parse errors
    }
  };

  // 1. Listen for real-time postMessage & custom DOM auth events from Dashboard
  window.addEventListener("message", (event) => {
    if (event.data?.type === "SENTIORA_AUTH_SYNC") {
      syncAuth(event.data);
    } else if (event.data?.type === "SENTIORA_AUTH_LOGOUT") {
      try {
        if (typeof chrome !== "undefined" && chrome.runtime?.id) {
          chrome.runtime.sendMessage({ type: "CLEAR_AUTH_TOKENS" }, () => {
            if (chrome.runtime.lastError) {
              /* ignore */
            }
          });
        }
      } catch {
        /* ignore */
      }
    }
  });

  window.addEventListener("sentiora_auth_sync", (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (detail) {
      syncAuth(detail);
    }
  });

  syncFromStorage();
  window.addEventListener("focus", syncFromStorage);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      syncFromStorage();
    }
  });
}

initContentScript();
