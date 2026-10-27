import { useState, useEffect, useCallback, useRef } from "react";
import { Echo } from "@shared/ui";
import PopupAuth from "./PopupAuth";
import CapturingView from "./views/CapturingView";
import ErrorView from "./views/ErrorView";
import NoteView from "./views/NoteView";
import PopupHeader from "./views/PopupHeader";
import ProtectedView from "./views/ProtectedView";
import ReadyView, { type PageStatus, type RecentMemory } from "./views/ReadyView";
import SavedView from "./views/SavedView";
import SettingsView from "./views/SettingsView";
import {
  getAccessToken,
  getRefreshToken,
  getCachedUser,
  setCachedUser,
  clearAllAuthData,
  getUserBlockedDomains,
  type CachedUser,
} from "../services/storage";
import {
  extApiFetch,
  ExtApiError,
  attemptTokenRefresh,
} from "../services/extApiClient";
import { getUrlBlockReason, isInternalUrl, isPdfUrl } from "../shared/blocklist";
import { sendCaptureMessage } from "../shared/captureUtils";
import { appPageUrl } from "../shared/appUrl";
import type { CapturePayload, PageCaptureStatus } from "../shared/types";

type PopupView =
  | "auth"
  | "ready"
  | "capturing"
  | "saved"
  | "failed"
  | "sensitive"
  | "manual_note"
  | "settings";

const EXTRACT_TIMEOUT_MS = 8_000;
const PDF_YOUTUBE_EXTRACT_TIMEOUT_MS = 25_000;
const SAVE_TIMEOUT_MS = 8_000;
const PING_TIMEOUT_MS = 400;
const STATUS_TIMEOUT_MS = 800;
const SAVING_POLL_MS = 1500;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        window.clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function pingTab(tabId: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(false), PING_TIMEOUT_MS);
    chrome.tabs.sendMessage(tabId, { type: "PING" }, { frameId: 0 }, () => {
      window.clearTimeout(timer);
      resolve(!chrome.runtime.lastError);
    });
  });
}

/** Page-level check (password field, noindex) from the content script; null when clear or unknown. */
function requestSensitivity(tabId: number): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), STATUS_TIMEOUT_MS);
    chrome.tabs.sendMessage(tabId, { type: "GET_SENSITIVITY" }, { frameId: 0 }, (response) => {
      window.clearTimeout(timer);
      const reason = (response as { reason?: unknown } | undefined)?.reason;
      resolve(!chrome.runtime.lastError && typeof reason === "string" ? reason : null);
    });
  });
}

/** Whether the background saved this URL in this browser session, or is saving it now. */
function requestPageStatus(url: string): Promise<PageCaptureStatus> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve("not_saved"), STATUS_TIMEOUT_MS);
    chrome.runtime.sendMessage({ type: "GET_PAGE_STATUS", url }, (response) => {
      window.clearTimeout(timer);
      const status = (response as { status?: PageCaptureStatus } | undefined)?.status;
      resolve(!chrome.runtime.lastError && status ? status : "not_saved");
    });
  });
}

interface ForceCaptureResponse {
  success?: boolean;
  payload?: CapturePayload;
  skipped?: boolean;
  reason?: string;
  error?: string;
  extractionMs?: number;
}

function requestForceCapture(tabId: number): Promise<ForceCaptureResponse> {
  return new Promise((resolve, reject) => {
    // Target the top frame only: a broadcast can be answered (or closed) by other frames.
    chrome.tabs.sendMessage(
      tabId,
      { type: "FORCE_CAPTURE" },
      { frameId: 0 },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve((response ?? {}) as ForceCaptureResponse);
      },
    );
  });
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<CachedUser | null>(null);
  const [itemCount, setItemCount] = useState<number | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [viewState, setViewState] = useState<PopupView>("ready");
  const [captureError, setCaptureError] = useState<string | null>(null);
  // Server processing status of the last saved memory; only "ready" means indexed.
  const [savedStatus, setSavedStatus] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [capturePhase, setCapturePhase] = useState<"extracting" | "saving">(
    "extracting",
  );
  const captureGenerationRef = useRef(0);

  // Current tab info
  const [activeTabTitle, setActiveTabTitle] = useState(
    "Understanding Docker Containers",
  );
  const [activeTabUrl, setActiveTabUrl] = useState("docs.docker.com");
  const [activeTabType, setActiveTabType] = useState<"webpage" | "youtube" | "pdf">(
    "webpage",
  );
  const [activeTabHost, setActiveTabHost] = useState("");
  const [activeTabRawUrl, setActiveTabRawUrl] = useState("");
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  // Saving is automatic, so the ready view leads with what happened to this page.
  const [pageStatus, setPageStatus] = useState<PageStatus>("checking");
  const [userBlockedDomains, setUserBlockedDomains] = useState<string[]>([]);

  // Last save, for the saved view and Undo (only set when the save created a new memory).
  const [savedTitle, setSavedTitle] = useState("");
  const [savedType, setSavedType] = useState<string>("webpage");
  const [savedMemoryId, setSavedMemoryId] = useState<string | null>(null);
  const [isUndoing, setIsUndoing] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastAttempt, setLastAttempt] = useState<"page" | "note">("page");

  // Two most recent memories for the "Recently saved" list; null = unknown.
  const [recentItems, setRecentItems] = useState<RecentMemory[] | null>(null);

  // Manual note fields
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");

  // Settings toggles
  const [autoDetectSensitive, setAutoDetectSensitive] = useState(true);
  const [showSaveConfirmation, setShowSaveConfirmation] = useState(true);

  async function syncAuthToBackground() {
    const token = await getAccessToken();
    const refreshToken = await getRefreshToken();
    const cached = await getCachedUser();
    if (token && refreshToken && cached && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({
        type: "SYNC_AUTH_TOKENS",
        payload: {
          accessToken: token,
          refreshToken,
          user: cached,
        },
      });
    }
  }

  async function postCaptureFromPopup(payload: CapturePayload): Promise<boolean> {
    const messageType =
      payload.source_type === "youtube"
        ? "CAPTURE_YOUTUBE"
        : payload.source_type === "pdf"
          ? "CAPTURE_PDF"
          : "CAPTURE_WEBPAGE";
    const result = await sendCaptureMessage({
      type: messageType,
      payload: { ...payload, is_force: true },
    } as any);

    if (!result.success) {
      setCaptureError(result.error ?? "Capture request failed.");
      return false;
    }
    setSavedStatus(result.status ?? null);
    setSavedMemoryId(result.deduplicated ? null : (result.memoryId ?? null));
    return true;
  }

  async function ensureContentScript(tabId: number): Promise<void> {
    const alreadyInjected = await pingTab(tabId);
    if (alreadyInjected) {
      return;
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
      });
    } catch {
      // Restricted pages cannot receive content scripts; caller may use fallback.
    }
  }
  async function fetchItemCount() {
    try {
      // Newest first; the two items feed "Recently saved", total feeds Settings.
      const resp = await extApiFetch<{ total: number; items?: RecentMemory[] }>(
        "/memory-items?per_page=2",
      );
      if (resp.data && typeof resp.data.total === "number") {
        setItemCount(resp.data.total);
      }
      if (Array.isArray(resp.data?.items)) {
        setRecentItems(resp.data.items.slice(0, 2));
      }
    } catch {
      // Ignore count fetch errors
    }
  }

  async function handleUndo() {
    if (!savedMemoryId || isUndoing) return;
    setIsUndoing(true);
    setUndoError(null);
    try {
      await extApiFetch(`/memory-items/${encodeURIComponent(savedMemoryId)}`, {
        method: "DELETE",
      });
      setSavedMemoryId(null);
      if (lastAttempt === "page") setPageStatus("not_saved");
      setNotice("Removed from your memory.");
      setViewState("ready");
      fetchItemCount();
    } catch (err) {
      setUndoError(err instanceof Error ? err.message : "Could not undo this save.");
    } finally {
      setIsUndoing(false);
    }
  }

  // Get current browser tab details if running in extension environment
  useEffect(() => {
    if (typeof chrome !== "undefined" && chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (typeof tabs[0]?.id === "number") setActiveTabId(tabs[0].id);
        if (tabs[0]?.url) {
          const urlStr = tabs[0].url;
          try {
            const urlObj = new URL(urlStr);
            setActiveTabRawUrl(urlStr);
            setActiveTabHost(urlObj.hostname);
            setActiveTabUrl(
              urlObj.hostname +
                (urlObj.pathname.length > 1
                  ? urlObj.pathname.substring(0, 18) + "..."
                  : ""),
            );
            if (urlObj.hostname.includes("youtube.com")) {
              setActiveTabType("youtube");
            } else if (urlStr.endsWith(".pdf") || urlObj.pathname.endsWith(".pdf")) {
              setActiveTabType("pdf");
            } else {
              setActiveTabType("webpage");
            }
          } catch {
            setActiveTabUrl(urlStr);
          }
          if (tabs[0].title) setActiveTabTitle(tabs[0].title);
        }
      });
    }
  }, []);

  const checkAuth = useCallback(async () => {
    try {
      let token = await getAccessToken();
      let cached = await getCachedUser();

      if (!token) {
        const refreshToken = await getRefreshToken();
        if (refreshToken) {
          const newToken = await attemptTokenRefresh();
          if (newToken) {
            token = newToken;
            cached = await getCachedUser();
          }
        }
      }

      if (token && !cached) {
        try {
          const meResp = await extApiFetch<{
            id: string;
            email: string;
            is_email_verified?: boolean;
          }>("/auth/me");
          if (meResp.data) {
            cached = {
              id: meResp.data.id,
              email: meResp.data.email,
              is_email_verified: meResp.data.is_email_verified ?? false,
            };
            await setCachedUser(cached);
          }
        } catch {
          // Ignore me error
        }
      }

      if (token && cached) {
        setIsAuthenticated(true);
        setUser(cached);
        setViewState("ready");
        await syncAuthToBackground();
        fetchItemCount();
      } else {
        setIsAuthenticated(false);
        setUser(null);
        setViewState("auth");
      }
    } catch {
      setIsAuthenticated(false);
      setUser(null);
      setViewState("auth");
    } finally {
      setCheckingAuth(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // Resolve the page status once signed in: blocklists first (no page access),
  // then the content script's page check, then the background's save record.
  useEffect(() => {
    if (!isAuthenticated || !activeTabRawUrl) return;
    let cancelled = false;
    void (async () => {
      const domains = await getUserBlockedDomains();
      if (cancelled) return;
      setUserBlockedDomains(domains);
      const rule = getUrlBlockReason(activeTabRawUrl, {
        allowLocalPdf: isPdfUrl(activeTabRawUrl),
        userDomains: domains,
      });
      let blocked = rule !== null;
      if (!blocked && activeTabId !== null && (await pingTab(activeTabId))) {
        blocked = (await requestSensitivity(activeTabId)) !== null;
      }
      if (cancelled) return;
      if (blocked) {
        setPageStatus("blocked");
        setViewState((view) => (view === "ready" ? "sensitive" : view));
        return;
      }
      const status = await requestPageStatus(activeTabRawUrl);
      if (!cancelled) setPageStatus(status);
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, activeTabRawUrl, activeTabId]);

  // An automatic save is in flight: follow it until the background finishes.
  useEffect(() => {
    if (pageStatus !== "saving" || !activeTabRawUrl) return;
    const interval = window.setInterval(() => {
      void requestPageStatus(activeTabRawUrl).then((status) => {
        if (status !== "saving") setPageStatus(status);
      });
    }, SAVING_POLL_MS);
    return () => window.clearInterval(interval);
  }, [pageStatus, activeTabRawUrl]);

  async function handleSignOut() {
    await clearAllAuthData();
    setIsAuthenticated(false);
    setUser(null);
    setItemCount(null);
    setViewState("auth");
  }

  async function performFallbackCapture(tab: chrome.tabs.Tab): Promise<boolean> {
    if (!tab.url || !tab.title) {
      setCaptureError("Unable to read the active tab URL or title.");
      return false;
    }

    const urlStr = tab.url.slice(0, 2048);
    const userDomains = await getUserBlockedDomains();
    if (getUrlBlockReason(urlStr, { allowLocalPdf: isPdfUrl(urlStr), userDomains })) {
      setCaptureError("This page is protected and cannot be captured.");
      setViewState("sensitive");
      return false;
    }
    const titleStr = tab.title.trim().slice(0, 1024);
    let sourceType: "webpage" | "youtube" | "pdf" = "webpage";
    let thumbnailUrl: string | undefined;

    if (urlStr.includes("youtube.com")) {
      sourceType = "youtube";
      try {
        const urlParams = new URL(urlStr).searchParams;
        const v = urlParams.get("v");
        if (v) {
          thumbnailUrl = `https://img.youtube.com/vi/${v}/hqdefault.jpg`;
        }
      } catch {
        // Ignore URL parse
      }
    } else if (urlStr.endsWith(".pdf") || urlStr.includes(".pdf")) {
      sourceType = "pdf";
    }

    try {
      const resp = await extApiFetch<{ id?: string }>("/memory-items", {
        method: "POST",
        body: JSON.stringify({
          source_type: sourceType,
          url: urlStr,
          title: titleStr,
          content: `Captured ${sourceType} content: ${titleStr}. Open the dashboard to view full extracted content when available.`,
          thumbnail_url: thumbnailUrl,
        }),
      });
      setSavedMemoryId(resp.data?.id ?? null);
      return true;
    } catch (err) {
      const message =
        err instanceof ExtApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Capture request failed.";
      setCaptureError(message);
      console.warn("Direct capture post failed:", err);
      return false;
    }
  }

  async function handleSaveCurrentPage() {
    if (isCapturing) return;

    const generation = ++captureGenerationRef.current;
    setIsCapturing(true);
    setCaptureError(null);
    setSavedStatus(null);
    setSavedMemoryId(null);
    setUndoError(null);
    setNotice(null);
    setLastAttempt("page");
    setCapturePhase("extracting");
    setViewState("capturing");

    const isCurrentCapture = () => captureGenerationRef.current === generation;

    const fail = (message: string) => {
      if (!isCurrentCapture()) return;
      setCaptureError(message);
      setViewState("failed");
      setIsCapturing(false);
    };

    if (typeof chrome === "undefined" || !chrome.tabs) {
      fail("Extension environment is unavailable.");
      return;
    }

    void syncAuthToBackground();

    const extractStarted = performance.now();

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const activeTab = tabs[0];
      if (!activeTab?.id) {
        fail("No active tab found.");
        return;
      }

      await ensureContentScript(activeTab.id);
      if (!isCurrentCapture()) return;

      let response: ForceCaptureResponse | null = null;
      let usedFallback = false;

      try {
        response = await withTimeout(
          requestForceCapture(activeTab.id),
          activeTabType === "webpage"
            ? EXTRACT_TIMEOUT_MS
            : PDF_YOUTUBE_EXTRACT_TIMEOUT_MS,
          "Extraction timed out. The page is too large or still loading.",
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "Extraction failed.";
        const noReceiver = message.includes("Receiving end does not exist");
        if (!noReceiver) {
          fail(message);
          return;
        }
        usedFallback = true;
      }

      if (!isCurrentCapture()) return;

      if (response?.skipped && response.reason === "sensitive") {
        setCaptureError("This page is protected and cannot be captured.");
        setPageStatus("blocked");
        setViewState("sensitive");
        setIsCapturing(false);
        return;
      }

      if (response?.skipped && response.reason === "insufficient_content") {
        const detail =
          activeTabType === "youtube"
            ? "Could not extract a YouTube transcript for this video. Captions may be disabled."
            : activeTabType === "pdf"
              ? "Could not extract text from this PDF. For local files, enable Allow access to file URLs on the Sentiora extension, or upload the PDF from the dashboard."
              : "Could not extract readable content from this page.";
        fail(detail);
        return;
      }

      const extractionMs =
        response?.extractionMs ?? Math.round(performance.now() - extractStarted);
      setCapturePhase("saving");
      const saveStarted = performance.now();

      let saved = false;
      if (response?.payload) {
        saved = await withTimeout(
          postCaptureFromPopup(response.payload),
          SAVE_TIMEOUT_MS,
          "Saving timed out. The vault did not confirm this memory.",
        );
      } else if (usedFallback && activeTabType === "webpage") {
        saved = await withTimeout(
          performFallbackCapture(activeTab),
          SAVE_TIMEOUT_MS,
          "Saving timed out. The vault did not confirm this memory.",
        );
      } else {
        fail(
          response?.error
            ? String(response.error)
            : activeTabType === "youtube"
              ? "Could not extract a YouTube transcript for this video. Captions may be disabled."
              : activeTabType === "pdf"
                ? "Could not extract text from this PDF. For local files, enable Allow access to file URLs on the Sentiora extension."
                : "Could not extract readable content from this page.",
        );
        return;
      }

      if (!isCurrentCapture()) return;

      const saveMs = Math.round(performance.now() - saveStarted);
      console.info(
        `[Sentiora Capture] Extraction: ${extractionMs} ms | API: ${saveMs} ms | Total: ${extractionMs + saveMs} ms`,
      );

      if (saved) {
        setPageStatus("saved");
        setSavedTitle(activeTabTitle);
        setSavedType(activeTabType);
        setViewState("saved");
        fetchItemCount();
      } else {
        setCaptureError(
          (prev) =>
            prev ?? "Capture failed. Sign in with the same account as the dashboard.",
        );
        setViewState("failed");
      }
    } catch (err) {
      if (!isCurrentCapture()) return;
      fail(err instanceof Error ? err.message : "Capture failed.");
      return;
    }

    if (isCurrentCapture()) {
      setIsCapturing(false);
    }
  }

  async function handleSaveManualNote() {
    if (!noteTitle.trim() || isCapturing) return;
    setIsCapturing(true);
    setCaptureError(null);
    setSavedStatus(null);
    setSavedMemoryId(null);
    setUndoError(null);
    setNotice(null);
    setLastAttempt("note");
    setViewState("capturing");
    try {
      const resp = await extApiFetch<{ id?: string; status?: string }>(
        "/memory-items",
        {
          method: "POST",
          body: JSON.stringify({
            source_type: "webpage",
            title: noteTitle.trim(),
            url: `https://sentiora.app/notes/${Date.now()}`,
            content: noteContent.trim() || noteTitle.trim(),
          }),
        },
      );
      setSavedMemoryId(resp.data?.id ?? null);
      setSavedStatus(resp.data?.status ?? null);
      setSavedTitle(noteTitle.trim());
      setSavedType("note");
      setNoteTitle("");
      setNoteContent("");
      setViewState("saved");
      fetchItemCount();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save note.";
      setCaptureError(message);
      console.error("Failed to save manual note:", err);
      setViewState("failed");
    } finally {
      setIsCapturing(false);
    }
  }

  function openAppPage(path: string) {
    if (typeof chrome !== "undefined" && chrome.tabs) {
      chrome.tabs.create({ url: appPageUrl(path) });
    } else {
      window.open(appPageUrl(path), "_blank");
    }
  }

  function openDashboard() {
    openAppPage("/dashboard");
  }

  function backToReady() {
    setCaptureError(null);
    setViewState("ready");
  }

  function retryLastAttempt() {
    setCaptureError(null);
    if (lastAttempt === "note") {
      setViewState("manual_note");
    } else {
      void handleSaveCurrentPage();
    }
  }

  if (checkingAuth) {
    return (
      <main
        aria-busy="true"
        className="flex min-h-[320px] w-[360px] flex-col items-center justify-center gap-3 bg-surface text-fg"
      >
        <Echo state="idle" size={64} />
        <span className="text-[15px] text-muted">Loading Sentiora</span>
      </main>
    );
  }

  const showHeader = viewState !== "saved";

  return (
    <main className="flex w-[360px] flex-col bg-surface text-fg">
      {showHeader ? (
        <PopupHeader
          onToggleSettings={
            isAuthenticated
              ? () => setViewState(viewState === "settings" ? "ready" : "settings")
              : undefined
          }
          settingsOpen={viewState === "settings"}
        />
      ) : null}

      {!isAuthenticated && viewState === "auth" && (
        <PopupAuth onAuthChange={checkAuth} />
      )}

      {isAuthenticated && viewState === "ready" && (
        <ReadyView
          tabTitle={activeTabTitle}
          tabType={activeTabType}
          tabHost={activeTabHost || activeTabUrl}
          recent={recentItems}
          notice={notice}
          status={pageStatus}
          saving={isCapturing}
          onSave={handleSaveCurrentPage}
          onAddNote={() => {
            setNotice(null);
            setViewState("manual_note");
          }}
          onOpenApp={openDashboard}
        />
      )}

      {isAuthenticated && viewState === "capturing" && (
        <CapturingView
          phase={capturePhase}
          tabTitle={lastAttempt === "note" ? noteTitle : activeTabTitle}
          onCancel={() => {
            captureGenerationRef.current += 1;
            setIsCapturing(false);
            setViewState("ready");
          }}
        />
      )}

      {isAuthenticated && viewState === "manual_note" && (
        <NoteView
          title={noteTitle}
          content={noteContent}
          onTitleChange={setNoteTitle}
          onContentChange={setNoteContent}
          saving={isCapturing}
          onCancel={() => setViewState("ready")}
          onSave={handleSaveManualNote}
        />
      )}

      {isAuthenticated && viewState === "saved" && (
        <SavedView
          title={savedTitle || activeTabTitle}
          sourceType={savedType}
          indexed={savedStatus === "ready"}
          canUndo={Boolean(savedMemoryId)}
          undoing={isUndoing}
          undoError={undoError}
          onUndo={handleUndo}
          onOpenApp={openDashboard}
        />
      )}

      {isAuthenticated && viewState === "failed" && (
        <ErrorView
          message={captureError ?? "Something went wrong while saving this page."}
          onRetry={retryLastAttempt}
          onBack={backToReady}
        />
      )}

      {isAuthenticated && viewState === "sensitive" && (
        <ProtectedView
          host={activeTabHost}
          rule={
            activeTabRawUrl
              ? getUrlBlockReason(activeTabRawUrl, {
                  allowLocalPdf: isPdfUrl(activeTabRawUrl),
                  userDomains: userBlockedDomains,
                })
              : null
          }
          internal={Boolean(activeTabRawUrl) && isInternalUrl(activeTabRawUrl)}
          onReviewBlockedSites={() => openAppPage("/privacy")}
        />
      )}

      {isAuthenticated && viewState === "settings" && (
        <SettingsView
          autoDetectSensitive={autoDetectSensitive}
          onAutoDetectSensitiveChange={setAutoDetectSensitive}
          showSaveConfirmation={showSaveConfirmation}
          onShowSaveConfirmationChange={setShowSaveConfirmation}
          email={user?.email}
          itemCount={itemCount}
          onSignOut={handleSignOut}
          onDone={() => setViewState("ready")}
        />
      )}
    </main>
  );
}
