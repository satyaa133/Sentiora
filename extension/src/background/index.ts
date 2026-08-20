import { extApiFetch } from "../services/extApiClient";
import { setAccessToken, setRefreshToken, setCachedUser, clearAllAuthData } from "../services/storage";
import { isPdfUrl, isUrlBlocked } from "../shared/blocklist";
import { postCapturePayload, sanitizeCapturePayload } from "../shared/captureUtils";
import type { ExtensionMessage, CapturePayload } from "../shared/types";

chrome.runtime.onInstalled.addListener(() => {
  console.info("Sentiora extension background initialized.");
});

const CAPTURE_COOLDOWN_MS = 10 * 60 * 1000;

async function isUrlCapturedRecently(url: string): Promise<boolean> {
  try {
    const key = `captured_${url}`;
    const result = await chrome.storage.session.get(key);
    const lastTime = result[key] as number | undefined;
    if (lastTime && Date.now() - lastTime < CAPTURE_COOLDOWN_MS) {
      return true;
    }
  } catch {
    // If storage session fails, proceed
  }
  return false;
}

async function markUrlCaptured(url: string): Promise<void> {
  try {
    const key = `captured_${url}`;
    await chrome.storage.session.set({ [key]: Date.now() });
  } catch {
    // Ignore storage errors
  }
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  if (message.type === "CHECK_FILE_ACCESS") {
    chrome.extension.isAllowedFileSchemeAccess((isAllowed) => {
      sendResponse({ isAllowed });
    });
    return true;
  }

  if (message.type === "FETCH_PDF_BYTES") {
    handleFetchPdfBytes(message.url, sender.tab?.id)
      .then((result) => sendResponse(result))
      .catch((err) =>
        sendResponse({
          success: false,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    return true;
  }

  if (
    message.type === "CAPTURE_WEBPAGE" ||
    message.type === "CAPTURE_YOUTUBE" ||
    message.type === "CAPTURE_PDF"
  ) {
    handleCaptureMessage(message.payload)
      .then((result) => {
        sendResponse(result);
      })
      .catch((err) => {
        console.error("[Sentiora Background] Capture payload failed:", err);
        sendResponse({
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      });

    return true;
  }

  if (message.type === "SYNC_AUTH_TOKENS") {
    const { accessToken, refreshToken, user } = message.payload;
    Promise.all([
      setAccessToken(accessToken),
      setRefreshToken(refreshToken),
      setCachedUser(user),
    ])
      .then(() => {
        console.info("[Sentiora Background] Authentication tokens synchronized from Dashboard.");
        sendResponse({ success: true });
      })
      .catch((err) => {
        console.error("[Sentiora Background] Token sync error:", err);
        sendResponse({ success: false, error: String(err) });
      });
    return true;
  }

  if (message.type === "CLEAR_AUTH_TOKENS") {
    clearAllAuthData()
      .then(() => {
        console.info("[Sentiora Background] Auth tokens cleared via Dashboard logout.");
        sendResponse({ success: true });
      })
      .catch((err) => {
        console.error("[Sentiora Background] Auth clear error:", err);
        sendResponse({ success: false, error: String(err) });
      });
    return true;
  }
});

const inFlightCaptures = new Set<string>();

async function handleCaptureMessage(
  payload: CapturePayload,
): Promise<{ success: boolean; deduplicated?: boolean; error?: string }> {
  const sanitized = sanitizeCapturePayload(payload);
  const allowLocalPdf = sanitized.source_type === "pdf" && isPdfUrl(sanitized.url);
  if (isUrlBlocked(sanitized.url, { allowLocalPdf })) {
    return { success: false, error: "This page is protected and cannot be captured." };
  }

  if (inFlightCaptures.has(sanitized.url)) {
    console.info("[Sentiora Background] Skipping capture, URL currently in-flight:", sanitized.url);
    return { success: true, deduplicated: true };
  }

  // Check rate limit / deduplication unless user explicitly forced capture
  if (!payload.is_force) {
    const recent = await isUrlCapturedRecently(sanitized.url);
    if (recent) {
      console.info("[Sentiora Background] Skipping automatic capture, URL captured recently:", sanitized.url);
      return { success: true, deduplicated: true };
    }
  }

  inFlightCaptures.add(sanitized.url);
  try {
    const result = await postCapturePayload(
      async (capturePayload) => {
        await extApiFetch("/memory-items", {
          method: "POST",
          body: JSON.stringify(capturePayload),
        });
      },
      sanitized,
    );

    if (!result.success) {
      console.error("[Sentiora Background] API post memory-item error:", result.error);
      return { success: false, error: result.error };
    }

    await markUrlCaptured(sanitized.url);
    showBadgeSuccess();
    notifyDashboardTabs();
    return { success: true };
  } finally {
    inFlightCaptures.delete(sanitized.url);
  }
}

function notifyDashboardTabs(): void {
  try {
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (
          tab.id &&
          tab.url &&
          (tab.url.includes("localhost") ||
            tab.url.includes("127.0.0.1") ||
            tab.url.includes("sentiora"))
        ) {
          chrome.tabs.sendMessage(tab.id, { type: "REFRESH_MEMORY_FEED" }, () => {
            // Ignore tab send errors if script not listening
            if (chrome.runtime.lastError) {
              /* ignore */
            }
          });
        }
      }
    });
  } catch {
    // Ignore tab query errors
  }
}

async function handleFetchPdfBytes(
  url: string,
  tabId?: number,
): Promise<{ success: boolean; bytes?: number[]; error?: string }> {
  try {
    const resp = await fetch(url);
    if (resp.ok) {
      const bytes = Array.from(new Uint8Array(await resp.arrayBuffer()));
      if (bytes.length > 0) {
        return { success: true, bytes };
      }
    }
  } catch {
    // Viewer/file URLs often cannot be fetched from the service worker.
  }

  if (tabId != null) {
    try {
      const injected = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: async (src: string) => {
          const resp = await fetch(src);
          const buf = new Uint8Array(await resp.arrayBuffer());
          return Array.from(buf);
        },
        args: [url],
      });
      const bytes = injected[0]?.result;
      if (Array.isArray(bytes) && bytes.length > 0) {
        return { success: true, bytes };
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return {
    success: false,
    error:
      "Could not read PDF bytes. For local files, enable Allow access to file URLs on the Sentiora extension.",
  };
}

function showBadgeSuccess(): void {
  try {
    chrome.action.setBadgeText({ text: "✓" });
    chrome.action.setBadgeBackgroundColor({ color: "#0d9488" });
    setTimeout(() => {
      chrome.action.setBadgeText({ text: "" });
    }, 3000);
  } catch {
    // Ignore badge errors if action UI is disabled
  }
}
