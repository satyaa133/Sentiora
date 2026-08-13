import { Readability } from "@mozilla/readability";
import { isCurrentPageSensitive } from "./sensitiveGuard";
import { isYoutubeWatchPage, captureYoutube } from "./youtubeCapture";
import { isPdfDocument, capturePdf } from "./pdfCapture";
import type { ExtensionMessage, WebpageCapturePayload } from "../shared/types";

function cleanExtractedText(rawText: string): string {
  if (!rawText) return "";
  let text = rawText.replace(/\s+/g, " ").trim();

  // Filter out repetitive metric badge noise (e.g. "3k 1.6m 3.2k 1.4m 2.4k 1.6m 2.2k...")
  const words = text.split(" ");
  const cleanedWords: string[] = [];
  let statStreak = 0;

  for (const word of words) {
    const isMetricWord = /^\d+(\.\d+)?[kmKMbB]?$/i.test(word.replace(/,/g, ""));
    if (isMetricWord) {
      statStreak++;
      if (statStreak <= 2) {
        cleanedWords.push(word);
      }
    } else {
      statStreak = 0;
      cleanedWords.push(word);
    }
  }

  return cleanedWords.join(" ").replace(/\s+/g, " ").trim();
}

async function runCapturePipeline(isForce = false): Promise<boolean> {
  // 1. Guard check
  if (isCurrentPageSensitive() && !isForce) {
    console.info("[Sentiora] Page capture skipped: page flagged as sensitive or blocked.");
    return false;
  }

  // 2. Check YouTube
  if (isYoutubeWatchPage()) {
    const payload = await captureYoutube(isForce);
    if (payload) {
      return await sendCapture({ type: "CAPTURE_YOUTUBE", payload });
    }
    return false;
  }

  // 3. Check PDF
  if (isPdfDocument()) {
    const payload = capturePdf(isForce);
    if (payload) {
      return await sendCapture({ type: "CAPTURE_PDF", payload });
    }
    return false;
  }

  // 4. General Webpage Capture via Readability
  try {
    const documentClone = document.cloneNode(true) as Document;
    const reader = new Readability(documentClone);
    const article = reader.parse();

    const rawTitle = article?.title || document.title || "Untitled Page";
    const title = rawTitle.trim().slice(0, 1024);

    const rawContent = article?.textContent || document.body.innerText || "";
    const content = cleanExtractedText(rawContent);

    // Skip pages with trivial content unless forced
    if (!isForce && (!content || content.length < 50)) {
      console.info("[Sentiora] Page capture skipped: insufficient content length.");
      return false;
    }

    // Extract metadata
    const faviconEl = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
    let faviconUrl = faviconEl ? faviconEl.href : undefined;
    if (faviconUrl && (faviconUrl.startsWith("data:") || faviconUrl.length > 2048)) {
      faviconUrl = undefined;
    }

    const ogImageEl = document.querySelector<HTMLMetaElement>("meta[property='og:image']");
    let thumbnailUrl = ogImageEl ? ogImageEl.content : undefined;
    if (thumbnailUrl && (thumbnailUrl.startsWith("data:") || thumbnailUrl.length > 2048)) {
      thumbnailUrl = undefined;
    }

    const rawAuthor = article?.byline || undefined;
    const author = rawAuthor ? rawAuthor.trim().slice(0, 512) : undefined;

    const payload: WebpageCapturePayload = {
      source_type: "webpage",
      url: window.location.href.slice(0, 2048),
      title,
      content,
      author,
      favicon_url: faviconUrl,
      thumbnail_url: thumbnailUrl,
      is_force: isForce,
    };

    return await sendCapture({ type: "CAPTURE_WEBPAGE", payload });
  } catch (err) {
    console.error("[Sentiora] Webpage capture error:", err);
    return false;
  }
}

function sendCapture(message: ExtensionMessage): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      if (typeof chrome === "undefined" || !chrome.runtime?.id) {
        resolve(false);
        return;
      }
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          console.warn("[Sentiora] Runtime send message error:", chrome.runtime.lastError.message);
          resolve(false);
          return;
        }
        if (response?.success) {
          console.info("[Sentiora] Content successfully captured and queued.");
          resolve(true);
        } else {
          resolve(false);
        }
      });
    } catch {
      resolve(false);
    }
  });
}

// ── Listen for explicit FORCE_CAPTURE request from popup button click ──
try {
  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message?.type === "FORCE_CAPTURE") {
        runCapturePipeline(true)
          .then((success) => sendResponse({ success }))
          .catch((err) => sendResponse({ success: false, error: String(err) }));
        return true;
      }
    });
  }
} catch {
  // Ignore runtime listener attachment errors if context invalidated
}

// ── Dashboard Auth Sync Bridge ──
function initDashboardAuthSync(): void {
  const isDashboardHost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname.includes("sentiora");

  if (!isDashboardHost) return;

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

  // 2. Check localStorage on page load
  try {
    const rawSession = localStorage.getItem("sentiora_auth_session");
    if (rawSession) {
      const parsed = JSON.parse(rawSession);
      syncAuth(parsed);
    }
  } catch {
    // Ignore storage parse errors
  }
}

initDashboardAuthSync();
