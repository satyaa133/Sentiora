import { isCurrentPageSensitive } from "./sensitiveGuard";
import { isYoutubeHost, isYoutubeVideoPage, captureYoutube } from "./youtubeCapture";
import { isPdfDocument, capturePdf } from "./pdfCapture";
import { captureWebpageTimed } from "./webpageCapture";
import type { CapturePayload, CaptureErrorCode } from "../shared/types";

export type CapturePipelineResult =
  | { status: "saved"; deduplicated?: boolean }
  | { status: "skipped"; reason: "sensitive" | "insufficient_content" | "no_payload" }
  | { status: "failed"; error: string; errorCode?: CaptureErrorCode };

export type ExtractCaptureResult =
  | { status: "ok"; payload: CapturePayload; extractionMs?: number }
  | { status: "skipped"; reason: "sensitive" | "insufficient_content" | "no_payload" }
  | { status: "failed"; error: string; errorCode?: CaptureErrorCode };

declare global {
  interface Window {
    __sentioraContentLoaded?: boolean;
  }
}

export async function extractCapturePayload(manualCapture = false): Promise<ExtractCaptureResult> {
  const started = performance.now();

  if (isCurrentPageSensitive(manualCapture)) {
    console.info("[Sentiora] Page capture skipped: page flagged as sensitive or blocked.");
    return { status: "skipped", reason: "sensitive" };
  }

  if (isYoutubeVideoPage()) {
    try {
      const payload = await captureYoutube(manualCapture);
      if (!payload) {
        return { status: "skipped", reason: "insufficient_content" };
      }
      return { status: "ok", payload, extractionMs: Math.round(performance.now() - started) };
    } catch (err: any) {
      return { status: "failed", errorCode: err.code || "UNKNOWN_ERROR", error: err.message || String(err) };
    }
  }

  if (isYoutubeHost()) {
    return { status: "skipped", reason: "no_payload" };
  }

  if (isPdfDocument()) {
    try {
      const payload = await capturePdf(manualCapture);
      if (!payload) {
        return { status: "skipped", reason: "insufficient_content" };
      }
      return { status: "ok", payload, extractionMs: Math.round(performance.now() - started) };
    } catch (err: any) {
      return { status: "failed", errorCode: err.code || "UNKNOWN_ERROR", error: err.message || String(err) };
    }
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

function initContentScript(): void {
  if (window.__sentioraContentLoaded) {
    return;
  }
  window.__sentioraContentLoaded = true;

  function findYoutubeEmbed(): HTMLIFrameElement | null {
    for (const iframe of Array.from(document.querySelectorAll("iframe"))) {
      const src = iframe.getAttribute("src");
      if (!src) continue;
      try {
        const parsed = new URL(src, window.location.href);
        if (parsed.hostname === "www.youtube.com" || parsed.hostname === "youtube.com" || parsed.hostname === "www.youtube-nocookie.com") {
          if (parsed.pathname.startsWith("/embed/")) return iframe;
        }
      } catch {
        // Ignore malformed iframe URLs.
      }
    }
    return null;
  }

  function requestEmbeddedCapture(): Promise<ExtractCaptureResult> | null {
    const iframe = findYoutubeEmbed();
    const iframeWindow = iframe?.contentWindow;
    if (!iframeWindow) return null;

    return new Promise((resolve) => {
      const timeoutId = window.setTimeout(() => {
        window.removeEventListener("message", handleResponse);
        resolve({ status: "failed", errorCode: "YOUTUBE_PLAYER_UNREADY", error: "Embedded YouTube player did not respond." });
      }, 60_000);

      function handleResponse(event: MessageEvent): void {
        if (event.source !== iframeWindow || event.data?.type !== "SENTIORA_EMBED_CAPTURE_RESULT") return;
        window.clearTimeout(timeoutId);
        window.removeEventListener("message", handleResponse);
        resolve(event.data.result as ExtractCaptureResult);
      }

      window.addEventListener("message", handleResponse);
      iframeWindow.postMessage({ type: "SENTIORA_EMBED_CAPTURE" }, "*");
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "FORCE_CAPTURE") {
      const extraction = isYoutubeVideoPage() ? extractCapturePayload(true) : requestEmbeddedCapture() ?? extractCapturePayload(true);
      extraction
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
        });
      return true;
    }

    if (message?.type === "PING") {
      sendResponse({ success: true });
      return true;
    }
  });

  window.addEventListener("message", (event) => {
    if (event.data?.type !== "SENTIORA_EMBED_CAPTURE" || !isYoutubeVideoPage()) return;
    extractCapturePayload(true).then((result) => {
      (event.source as Window | null)?.postMessage(
        { type: "SENTIORA_EMBED_CAPTURE_RESULT", result },
        { targetOrigin: "*" },
      );
    });
  });

  const observedVideos = new WeakSet<HTMLVideoElement>();
  const watchVideoEnd = (video: HTMLVideoElement): void => {
    if (observedVideos.has(video)) return;
    observedVideos.add(video);
    video.addEventListener("ended", () => {
      if (!isYoutubeVideoPage()) return;
      chrome.runtime.sendMessage({ type: "YOUTUBE_VIDEO_ENDED", url: window.location.href });
    });
  };

  const observeVideoPlayer = (): void => {
    for (const video of Array.from(document.querySelectorAll("video"))) {
      watchVideoEnd(video);
    }
  };
  observeVideoPlayer();
  const videoObserver = new MutationObserver(observeVideoPlayer);
  videoObserver.observe(document.documentElement, { childList: true, subtree: true });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "CAPTURE_SUCCEEDED" || !isYoutubeVideoPage()) return;
    const video = document.querySelector("video");
    if (video instanceof HTMLVideoElement && video.ended) {
      chrome.runtime.sendMessage({ type: "YOUTUBE_VIDEO_ENDED", url: message.url });
    }
  });

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
    if (event.origin !== window.location.origin) {
      return;
    }
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
