import { attemptTokenRefresh, extApiFetch } from "../services/extApiClient";
import {
  setAccessToken,
  setRefreshToken,
  setCachedUser,
  clearAllAuthData,
  getAccessToken,
  getRefreshToken,
  getUserBlockedDomains,
  setUserBlockedDomains,
} from "../services/storage";
import { isPdfUrl, isUrlBlocked, sanitizeUserBlockedDomains } from "../shared/blocklist";
import { isTrustedAppUrl } from "../shared/appUrl";
import { postCapturePayload, sanitizeCapturePayload } from "../shared/captureUtils";
import type {
  ExtensionMessage,
  CapturePayload,
  PageCaptureStatus,
  YoutubePlayerResponse,
} from "../shared/types";

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

/**
 * Signed in means a usable access token, refreshing an expired one if a refresh
 * token exists. Without one, captures stop here: no page content is sent.
 */
async function hasUsableSession(): Promise<boolean> {
  if (await getAccessToken()) return true;
  if (!(await getRefreshToken())) return false;
  return Boolean(await attemptTokenRefresh());
}

async function getPageStatus(url: string): Promise<PageCaptureStatus> {
  if (inFlightCaptures.has(url)) return "saving";
  try {
    const key = `captured_${url}`;
    const result = await chrome.storage.session.get(key);
    return result[key] ? "saved" : "not_saved";
  } catch {
    return "not_saved";
  }
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

  if (message.type === "GET_YOUTUBE_PLAYER_RESPONSE") {
    getYoutubePlayerResponse(message.videoId, sender.tab?.id, sender.frameId ?? 0)
      .then((playerResponse) => sendResponse({ success: Boolean(playerResponse), playerResponse }))
      .catch((err) =>
        sendResponse({ success: false, error: err instanceof Error ? err.message : String(err) }),
      );
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

  if (message.type === "GET_SESSION_STATE") {
    hasUsableSession()
      .then((signedIn) => sendResponse({ signedIn }))
      .catch(() => sendResponse({ signedIn: false }));
    return true;
  }

  if (message.type === "GET_PAGE_STATUS") {
    getPageStatus(message.url)
      .then((status) => sendResponse({ status }))
      .catch(() => sendResponse({ status: "not_saved" }));
    return true;
  }

  if (
    (message.type === "SYNC_AUTH_TOKENS" ||
      message.type === "CLEAR_AUTH_TOKENS" ||
      message.type === "SYNC_BLOCKLIST") &&
    !isTrustedAuthSender(sender)
  ) {
    sendResponse({ success: false, error: "Untrusted sender" });
    return false;
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

  if (message.type === "SYNC_BLOCKLIST") {
    setUserBlockedDomains(sanitizeUserBlockedDomains(message.domains))
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: String(err) }));
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

/** Auth changes come only from extension pages (popup) or the configured web app. */
function isTrustedAuthSender(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== undefined && sender.id !== chrome.runtime.id) return false;
  if (!sender.tab) return true;
  return isTrustedAppUrl(sender.url ?? sender.tab.url);
}

const inFlightCaptures = new Set<string>();

type CaptureMessageResult = {
  success: boolean;
  deduplicated?: boolean;
  error?: string;
  /** Server-side processing status of the saved memory (pending → processing → ready/failed). */
  status?: string;
  memoryId?: string;
};

export async function handleCaptureMessage(payload: CapturePayload): Promise<CaptureMessageResult> {
  const sanitized = sanitizeCapturePayload(payload);
  const allowLocalPdf = sanitized.source_type === "pdf" && isPdfUrl(sanitized.url);
  const userDomains = await getUserBlockedDomains();
  if (isUrlBlocked(sanitized.url, { allowLocalPdf, userDomains })) {
    return { success: false, error: "This page is protected and cannot be captured." };
  }

  if (!(await hasUsableSession())) {
    return { success: false, error: "Sign in to Sentiora to save pages." };
  }

  // Check and claim the URL with no await in between, so concurrent messages for
  // the same page (e.g. YouTube SPA events firing twice) cannot both reach the API.
  if (inFlightCaptures.has(sanitized.url)) {
    console.info("[Sentiora Background] Skipping capture, URL currently in-flight:", sanitized.url);
    return { success: true, deduplicated: true };
  }
  inFlightCaptures.add(sanitized.url);

  try {
    // Check rate limit / deduplication unless user explicitly forced capture
    if (!payload.is_force) {
      const recent = await isUrlCapturedRecently(sanitized.url);
      if (recent) {
        console.info("[Sentiora Background] Skipping automatic capture, URL captured recently:", sanitized.url);
        return { success: true, deduplicated: true };
      }
    }

    let created: { id?: string; status?: string } | undefined;
    const result = await postCapturePayload(
      async (capturePayload) => {
        const resp = await extApiFetch<{ id?: string; status?: string }>("/memory-items", {
          method: "POST",
          body: JSON.stringify(capturePayload),
        });
        created = resp.data;
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
    return { success: true, status: created?.status, memoryId: created?.id };
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
          isTrustedAppUrl(tab.url)
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

/**
 * Runs in the page's MAIN world (content scripts live in an isolated world and
 * cannot see YouTube's player globals). Must be self-contained: it is
 * serialized by chrome.scripting. Returns only a small JSON-safe subset.
 */
export function readYoutubePlayerResponseInPage(expectedVideoId: string): YoutubePlayerResponse | null {
  type PlayerEl = { getPlayerResponse?: () => YoutubePlayerResponse | null };
  const candidates: (YoutubePlayerResponse | null | undefined)[] = [];
  for (const selector of ["#movie_player", "#shorts-player"]) {
    try {
      candidates.push((document.querySelector(selector) as PlayerEl | null)?.getPlayerResponse?.());
    } catch {
      // player not ready
    }
  }
  candidates.push((window as unknown as { ytInitialPlayerResponse?: YoutubePlayerResponse }).ytInitialPlayerResponse);

  const match = candidates.find((resp) => resp?.videoDetails?.videoId === expectedVideoId);
  if (!match) return null;
  const details = match.videoDetails ?? {};
  return {
    videoDetails: {
      videoId: details.videoId,
      title: details.title,
      author: details.author,
      channelId: details.channelId,
      lengthSeconds: details.lengthSeconds,
      isLive: details.isLive,
      thumbnail: { thumbnails: (details.thumbnail?.thumbnails ?? []).slice(-3) },
    },
    playabilityStatus: {
      status: match.playabilityStatus?.status,
      reason: match.playabilityStatus?.reason,
    },
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: (match.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []).map(
          (track) => ({ baseUrl: track.baseUrl, languageCode: track.languageCode, kind: track.kind }),
        ),
      },
    },
  };
}

export async function getYoutubePlayerResponse(
  videoId: string,
  tabId: number | undefined,
  frameId: number,
): Promise<YoutubePlayerResponse | null> {
  if (tabId == null || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
  // The player can lag behind SPA navigation; poll briefly (~6s).
  for (let attempt = 0; attempt < 15; attempt += 1) {
    try {
      const injected = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [frameId] },
        world: "MAIN",
        func: readYoutubePlayerResponseInPage,
        args: [videoId],
      });
      const result = injected[0]?.result as YoutubePlayerResponse | null | undefined;
      if (result) return result;
    } catch {
      return null; // tab closed, navigated to a restricted page, or no host access
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return null;
}
