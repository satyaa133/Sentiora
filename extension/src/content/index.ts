import { getPageSensitivityReason, isCurrentPageSensitive } from "./sensitiveGuard";
import { isYoutubeHost, isYoutubeVideoPage, captureYoutube, parseYoutubeVideoUrl } from "./youtubeCapture";
import { isPdfDocument, capturePdf } from "./pdfCapture";
import { captureWebpageTimed } from "./webpageCapture";
import { sendCaptureMessage } from "../shared/captureUtils";
import { isTrustedAppUrl } from "../shared/appUrl";
import { getUserBlockedDomains } from "../services/storage";
import type { CapturePayload, ExtensionMessage, CaptureErrorCode } from "../shared/types";

export type CapturePipelineResult =
  | { status: "saved"; deduplicated?: boolean }
  | { status: "skipped"; reason: "sensitive" | "insufficient_content" | "no_payload" | "signed_out" }
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

/** Asks the background whether a session exists; any failure counts as signed out. */
function isSignedIn(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: "GET_SESSION_STATE" } satisfies ExtensionMessage, (response) => {
        resolve(!chrome.runtime.lastError && response?.signedIn === true);
      });
    } catch {
      resolve(false);
    }
  });
}

export async function extractCapturePayload(manualCapture = false): Promise<ExtractCaptureResult> {
  const started = performance.now();
  const userDomains = await getUserBlockedDomains();

  if (isCurrentPageSensitive(userDomains)) {
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
  // On YouTube only video pages are memories; never auto-save home/search/channel pages.
  if (isYoutubeHost() && !isYoutubeVideoPage()) {
    return { status: "skipped", reason: "no_payload" };
  }
  // Signed out: do not even read the page.
  if (!(await isSignedIn())) {
    return { status: "skipped", reason: "signed_out" };
  }
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
            errorCode: result.errorCode,
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

    // Read-only check for the popup's page status; nothing is extracted or sent.
    if (message?.type === "GET_SENSITIVITY") {
      getUserBlockedDomains()
        .then((userDomains) => sendResponse({ reason: getPageSensitivityReason(userDomains) }))
        .catch(() => sendResponse({ reason: null }));
      return true;
    }
  });

  // YouTube is a SPA: watch for in-app navigation between videos. Both the
  // yt-navigate-finish event and the URL poll can fire for one navigation, so
  // auto-capture at most once per video ID.
  if (isYoutubeHost()) {
    let lastVideoId = parseYoutubeVideoUrl(window.location.href)?.videoId ?? null;
    const onYoutubeNavigation = () => {
      const videoId = parseYoutubeVideoUrl(window.location.href)?.videoId ?? null;
      if (!videoId || videoId === lastVideoId) return;
      lastVideoId = videoId;
      setTimeout(() => {
        if (parseYoutubeVideoUrl(window.location.href)?.videoId === videoId) {
          void runAutoCapturePipeline();
        }
      }, 1500);
    };
    window.addEventListener("yt-navigate-finish", onYoutubeNavigation);
    window.addEventListener("popstate", onYoutubeNavigation);
    setInterval(onYoutubeNavigation, 2500);
  }

  // Exact origin match: any other page could otherwise plant its own tokens and
  // redirect this user's captures into a foreign account.
  if (!isTrustedAppUrl(window.location.href)) {
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

  // The Privacy Center keeps the user's blocked sites in this origin's
  // localStorage; mirror them into the extension so every capture honours them.
  const syncBlocklist = () => {
    try {
      if (typeof chrome === "undefined" || !chrome.runtime?.id) return;
      const raw = localStorage.getItem("sentiora_blocked_domains");
      const domains: unknown = raw ? JSON.parse(raw) : [];
      chrome.runtime.sendMessage({ type: "SYNC_BLOCKLIST", domains } satisfies ExtensionMessage, () => {
        if (chrome.runtime.lastError) {
          /* ignore */
        }
      });
    } catch {
      // Ignore storage parse errors and invalidated contexts
    }
  };

  // 1. Listen for real-time postMessage & custom DOM auth events from Dashboard
  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) {
      return;
    }
    if (event.data?.type === "SENTIORA_AUTH_SYNC") {
      syncAuth(event.data);
    } else if (event.data?.type === "SENTIORA_BLOCKLIST_SYNC") {
      syncBlocklist();
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
  syncBlocklist();
  window.addEventListener("focus", () => {
    syncFromStorage();
    syncBlocklist();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      syncFromStorage();
      syncBlocklist();
    }
  });
}

initContentScript();
