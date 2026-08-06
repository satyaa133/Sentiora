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

async function runCapturePipeline(): Promise<void> {
  // 1. Guard check
  if (isCurrentPageSensitive()) {
    console.info("[Sentiora] Page capture skipped: page flagged as sensitive or blocked.");
    return;
  }

  // 2. Check YouTube
  if (isYoutubeWatchPage()) {
    const payload = await captureYoutube();
    if (payload) {
      sendCapture({ type: "CAPTURE_YOUTUBE", payload });
    }
    return;
  }

  // 3. Check PDF
  if (isPdfDocument()) {
    const payload = capturePdf();
    if (payload) {
      sendCapture({ type: "CAPTURE_PDF", payload });
    }
    return;
  }

  // 4. General Webpage Capture via Readability
  try {
    const documentClone = document.cloneNode(true) as Document;
    const reader = new Readability(documentClone);
    const article = reader.parse();

    const title = article?.title || document.title || "Untitled Page";
    const rawContent = article?.textContent || document.body.innerText || "";
    const content = cleanExtractedText(rawContent);

    // Skip pages with trivial content
    if (!content || content.length < 50) {
      console.info("[Sentiora] Page capture skipped: insufficient content length.");
      return;
    }

    // Extract metadata
    const faviconEl = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
    const faviconUrl = faviconEl ? faviconEl.href : undefined;

    const ogImageEl = document.querySelector<HTMLMetaElement>("meta[property='og:image']");
    const thumbnailUrl = ogImageEl ? ogImageEl.content : undefined;

    const author = article?.byline || undefined;

    const payload: WebpageCapturePayload = {
      source_type: "webpage",
      url: window.location.href,
      title: title.trim(),
      content,
      author,
      favicon_url: faviconUrl,
      thumbnail_url: thumbnailUrl,
    };

    sendCapture({ type: "CAPTURE_WEBPAGE", payload });
  } catch (err) {
    console.error("[Sentiora] Webpage capture error:", err);
  }
}

function sendCapture(message: ExtensionMessage): void {
  chrome.runtime.sendMessage(message, (response) => {
    if (chrome.runtime.lastError) {
      // Background worker might be sleeping or unregistered
      return;
    }
    if (response?.success) {
      console.info("[Sentiora] Content successfully captured and queued.");
    }
  });
}

// Run capture on document load
if (document.readyState === "complete") {
  setTimeout(runCapturePipeline, 1000);
} else {
  window.addEventListener("load", () => setTimeout(runCapturePipeline, 1000));
}

// ── Dashboard Auth Sync Bridge ──
function initDashboardAuthSync(): void {
  const isDashboardHost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname.includes("sentiora");

  if (!isDashboardHost) return;

  // 1. Listen for real-time postMessage auth events from Dashboard
  window.addEventListener("message", (event) => {
    if (event.data?.type === "SENTIORA_AUTH_SYNC") {
      const { accessToken, refreshToken, user } = event.data;
      if (accessToken && refreshToken && user) {
        chrome.runtime.sendMessage({
          type: "SYNC_AUTH_TOKENS",
          payload: { accessToken, refreshToken, user },
        });
      }
    } else if (event.data?.type === "SENTIORA_AUTH_LOGOUT") {
      chrome.runtime.sendMessage({ type: "CLEAR_AUTH_TOKENS" });
    }
  });

  // 2. Check localStorage on page load
  try {
    const rawSession = localStorage.getItem("sentiora_auth_session");
    if (rawSession) {
      const parsed = JSON.parse(rawSession);
      if (parsed.accessToken && parsed.refreshToken && parsed.user) {
        chrome.runtime.sendMessage({
          type: "SYNC_AUTH_TOKENS",
          payload: {
            accessToken: parsed.accessToken,
            refreshToken: parsed.refreshToken,
            user: parsed.user,
          },
        });
      }
    }
  } catch {
    // Ignore storage parse errors
  }
}

initDashboardAuthSync();
