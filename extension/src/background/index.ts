import { extApiFetch } from "../services/extApiClient";
import { setAccessToken, setRefreshToken, setCachedUser, clearAllAuthData } from "../services/storage";
import type { ExtensionMessage, CapturePayload } from "../shared/types";

chrome.runtime.onInstalled.addListener(() => {
  console.info("Sentiora extension background initialized.");
});

// Cache for captured URLs in session storage to prevent duplicates (10 minute cooldown)
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
  if (
    message.type === "CAPTURE_WEBPAGE" ||
    message.type === "CAPTURE_YOUTUBE" ||
    message.type === "CAPTURE_PDF"
  ) {
    handleCaptureMessage(message.payload)
      .then((success) => {
        sendResponse({ success });
      })
      .catch((err) => {
        console.error("[Sentiora Background] Capture payload failed:", err);
        sendResponse({ success: false, error: String(err) });
      });

    return true; // Keep message channel open for async response
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

async function handleCaptureMessage(payload: CapturePayload): Promise<boolean> {
  if (!payload.url || !payload.title) {
    return false;
  }

  // Check rate limit / deduplication
  const recent = await isUrlCapturedRecently(payload.url);
  if (recent) {
    console.info("[Sentiora Background] Skipping capture, URL captured recently:", payload.url);
    return true;
  }

  try {
    await extApiFetch("/memory-items", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    await markUrlCaptured(payload.url);
    showBadgeSuccess();
    return true;
  } catch (err) {
    console.error("[Sentiora Background] API post memory-item error:", err);
    return false;
  }
}

function showBadgeSuccess(): void {
  try {
    chrome.action.setBadgeText({ text: "✓" });
    chrome.action.setBadgeBackgroundColor({ color: "#0d9488" }); // teal-600
    setTimeout(() => {
      chrome.action.setBadgeText({ text: "" });
    }, 3000);
  } catch {
    // Ignore badge errors if action UI is disabled
  }
}
