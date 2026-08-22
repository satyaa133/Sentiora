import { useState, useEffect, useCallback, useRef } from "react";
import { APP_NAME } from "@shared/constants/app";
import PopupAuth from "./PopupAuth";
import { getAccessToken, getRefreshToken, getCachedUser, setCachedUser, clearAllAuthData, type CachedUser } from "../services/storage";
import { extApiFetch, ExtApiError, attemptTokenRefresh } from "../services/extApiClient";
import { isPdfUrl, isUrlBlocked } from "../shared/blocklist";
import { sendCaptureMessage } from "../shared/captureUtils";
import type { CapturePayload } from "../shared/types";

type PopupView =
  | "auth"
  | "ready"
  | "capturing"
  | "paused"
  | "saved"
  | "failed"
  | "sensitive"
  | "manual_note"
  | "settings";

const EXTRACT_TIMEOUT_MS = 8_000;
const PDF_YOUTUBE_EXTRACT_TIMEOUT_MS = 25_000;
const SAVE_TIMEOUT_MS = 8_000;
const PING_TIMEOUT_MS = 400;

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
    chrome.tabs.sendMessage(tabId, { type: "PING" }, () => {
      window.clearTimeout(timer);
      resolve(!chrome.runtime.lastError);
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
    chrome.tabs.sendMessage(tabId, { type: "FORCE_CAPTURE" }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve((response ?? {}) as ForceCaptureResponse);
    });
  });
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<CachedUser | null>(null);
  const [itemCount, setItemCount] = useState<number | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [viewState, setViewState] = useState<PopupView>("ready");
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [capturePhase, setCapturePhase] = useState<"extracting" | "saving">("extracting");
  const captureGenerationRef = useRef(0);

  // Current tab info
  const [activeTabTitle, setActiveTabTitle] = useState("Understanding Docker Containers");
  const [activeTabUrl, setActiveTabUrl] = useState("docs.docker.com");
  const [activeTabType, setActiveTabType] = useState<"webpage" | "youtube" | "pdf">("webpage");

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
    const messageType = payload.source_type === "youtube" ? "CAPTURE_YOUTUBE" : payload.source_type === "pdf" ? "CAPTURE_PDF" : "CAPTURE_WEBPAGE";
    const result = await sendCaptureMessage({
      type: messageType,
      payload: { ...payload, is_force: true }
    } as any);

    if (!result.success) {
      setCaptureError(result.error ?? "Capture request failed.");
      return false;
    }
    return true;
  }

  async function ensureContentScript(tabId: number): Promise<void> {
    const alreadyInjected = await pingTab(tabId);
    if (alreadyInjected) {
      return;
    }

    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    } catch {
      // Restricted pages cannot receive content scripts; caller may use fallback.
    }
  }
  async function fetchItemCount() {
    try {
      const resp = await extApiFetch<{ total: number }>("/memory-items?per_page=1");
      if (resp.data && typeof resp.data.total === "number") {
        setItemCount(resp.data.total);
      }
    } catch {
      // Ignore count fetch errors
    }
  }

  // Get current browser tab details if running in extension environment
  useEffect(() => {
    if (typeof chrome !== "undefined" && chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.url) {
          const urlStr = tabs[0].url;
          try {
            const urlObj = new URL(urlStr);
            setActiveTabUrl(urlObj.hostname + (urlObj.pathname.length > 1 ? urlObj.pathname.substring(0, 18) + "..." : ""));
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
          const meResp = await extApiFetch<{ id: string; email: string; is_email_verified?: boolean }>("/auth/me");
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
    if (isUrlBlocked(urlStr, { allowLocalPdf: isPdfUrl(urlStr) })) {
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
      await extApiFetch("/memory-items", {
        method: "POST",
        body: JSON.stringify({
          source_type: sourceType,
          url: urlStr,
          title: titleStr,
          content: `Captured ${sourceType} content: ${titleStr}. Open the dashboard to view full extracted content when available.`,
          thumbnail_url: thumbnailUrl,
        }),
      });
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
          activeTabType === "webpage" ? EXTRACT_TIMEOUT_MS : PDF_YOUTUBE_EXTRACT_TIMEOUT_MS,
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

      const extractionMs = response?.extractionMs ?? Math.round(performance.now() - extractStarted);
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
                : "Could not extract readable content from this page."
        );
        return;
      }

      if (!isCurrentCapture()) return;

      const saveMs = Math.round(performance.now() - saveStarted);
      console.info(
        `[Sentiora Capture] Extraction: ${extractionMs} ms | API: ${saveMs} ms | Total: ${extractionMs + saveMs} ms`,
      );

      if (saved) {
        setViewState("saved");
        fetchItemCount();
      } else {
        setCaptureError((prev) => prev ?? "Capture failed. Sign in with the same account as the dashboard.");
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
    setViewState("capturing");
    try {
      await extApiFetch("/memory-items", {
        method: "POST",
        body: JSON.stringify({
          source_type: "webpage",
          title: noteTitle.trim(),
          url: `https://sentiora.app/notes/${Date.now()}`,
          content: noteContent.trim() || noteTitle.trim(),
        }),
      });
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

  function openDashboard() {
    if (typeof chrome !== "undefined" && chrome.tabs) {
      chrome.tabs.create({ url: "http://localhost:5173/dashboard" });
    } else {
      window.open("http://localhost:5173/dashboard", "_blank");
    }
  }

  if (checkingAuth) {
    return (
      <main className="min-h-[380px] w-[350px] bg-[#FFFDF7] p-6 text-[#1F2421] flex flex-col items-center justify-center font-sans space-y-3">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#2C6F54] border-t-transparent" />
        <span className="text-xs font-serif font-bold text-[#60706A]">Loading Sentiora...</span>
      </main>
    );
  }

  return (
    <main className="w-[350px] bg-gradient-to-b from-[#FFFDF7] via-[#FFFDF7] to-[#F5EFE0] text-[#1F2421] font-sans p-5 border border-[#E5DFD0] rounded-3xl shadow-2xl min-h-[400px] flex flex-col justify-between relative overflow-hidden">
      {/* Background Decorative Blob */}
      <div className="absolute -top-20 -right-20 w-40 h-40 bg-[#2C6F54]/10 rounded-full blur-2xl pointer-events-none" />

      {/* Header Bar */}
      <div className="flex justify-between items-center border-b border-[#E5DFD0]/80 pb-3 z-10">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-xl bg-[#2C6F54] text-white flex items-center justify-center font-serif font-bold text-sm shadow-xs">
            S
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="font-serif text-base font-bold tracking-tight text-[#1F2421]">{APP_NAME}</h1>
              <span className="text-[9px] text-[#2C6F54] font-mono bg-[#DBE9DF] px-1.5 py-0.2 rounded font-bold">
                v1.2.0
              </span>
            </div>
          </div>
        </div>

        {isAuthenticated && (
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#DBE9DF] text-[#2C6F54] text-[10px] font-bold border border-[#2C6F54]/20">
              <span className="w-1.5 h-1.5 rounded-full bg-[#2C6F54] animate-pulse" />
              Connected
            </span>
            <button
              onClick={() => setViewState(viewState === "settings" ? "ready" : "settings")}
              title="Extension Settings"
              className="p-1.5 rounded-xl text-[#60706A] hover:bg-[#FAF8F1] hover:text-[#1F2421] transition-all border border-transparent hover:border-[#E5DFD0]"
            >
              ⚙️
            </button>
          </div>
        )}
      </div>

      {/* Dynamic Content Views */}
      <div className="py-4 flex-1 flex flex-col justify-center z-10">
        {/* VIEW 1: Unauthenticated */}
        {!isAuthenticated && viewState === "auth" && (
          <div className="space-y-4">
            <PopupAuth onAuthChange={checkAuth} />
          </div>
        )}

        {/* VIEW 2: Ready / Main Extension View */}
        {isAuthenticated && viewState === "ready" && (
          <div className="space-y-4">
            {/* Current Active Tab Preview Card */}
            <div className="p-3.5 bg-white/90 backdrop-blur-md border border-[#E5DFD0] rounded-2xl space-y-1.5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-bold uppercase tracking-wider text-[#60706A]">
                  ACTIVE TAB CONTENT
                </span>
                <span className="text-[10px] font-bold uppercase bg-[#DBE9DF] text-[#2C6F54] px-2 py-0.5 rounded-full border border-[#2C6F54]/20">
                  {activeTabType}
                </span>
              </div>
              <p className="text-xs font-bold text-[#1F2421] leading-snug line-clamp-2">{activeTabTitle}</p>
              <div className="flex items-center gap-1 text-[11px] text-[#2C6F54] font-semibold truncate pt-0.5">
                <span>{activeTabType === "youtube" ? "🎬" : activeTabType === "pdf" ? "📄" : "🌐"}</span>
                <span className="truncate">{activeTabUrl}</span>
              </div>
            </div>

            {/* Main Action Button */}
            <button
              onClick={handleSaveCurrentPage}
              disabled={isCapturing}
              className="w-full py-3.5 bg-[#2C6F54] hover:bg-[#235943] disabled:opacity-50 text-white rounded-2xl font-bold text-xs transition-all flex items-center justify-center gap-2 shadow-md hover:shadow-lg active:scale-[0.99]"
            >
              <span className="text-sm">⚡</span> Capture Memory Now
            </button>

            {/* Quick Secondary Action Buttons */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setViewState("manual_note")}
                className="py-2.5 bg-white hover:bg-[#FAF8F1] border border-[#E5DFD0] text-[#1F2421] text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1 shadow-xs"
              >
                <span>📝</span> Add Quick Note
              </button>
              <button
                onClick={() => setViewState("paused")}
                className="py-2.5 bg-white hover:bg-[#FAF8F1] border border-[#E5DFD0] text-[#1F2421] text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1 shadow-xs"
              >
                <span>⏸</span> Pause Sync
              </button>
            </div>

            {/* Vault Quick Stats */}
            <div className="pt-2 border-t border-[#E5DFD0]/80 flex justify-between items-center text-xs text-[#60706A]">
              <span className="flex items-center gap-1 font-medium">
                <span>📦</span> Vault Items: <strong className="text-[#1F2421] font-bold">{itemCount ?? 0}</strong>
              </span>
              <button
                onClick={openDashboard}
                className="text-[11px] font-bold text-[#2C6F54] hover:underline flex items-center gap-0.5"
              >
                Dashboard ↗
              </button>
            </div>
          </div>
        )}

        {/* VIEW 3: Capturing Progress State */}
        {isAuthenticated && viewState === "capturing" && (
          <div className="space-y-4 text-center py-4">
            <div className="relative w-12 h-12 mx-auto">
              <div className="animate-spin rounded-full h-12 w-12 border-3 border-[#2C6F54] border-t-transparent" />
              <div className="absolute inset-0 flex items-center justify-center text-sm">✨</div>
            </div>
            <div className="space-y-1">
              <h2 className="font-serif text-base font-bold text-[#1F2421]">
                {capturePhase === "saving" ? "Saving Memory..." : "Extracting Content..."}
              </h2>
              <p className="text-xs text-[#60706A]">
                {capturePhase === "saving"
                  ? "Persisting this page to your vault"
                  : "Extracting article text, headers, and metadata"}
              </p>
            </div>
            <div className="p-3 bg-white border border-[#E5DFD0] rounded-xl text-xs text-[#2C6F54] font-medium truncate shadow-xs">
              📄 {activeTabTitle}
            </div>
            <button
              onClick={() => {
                captureGenerationRef.current += 1;
                setIsCapturing(false);
                setViewState("ready");
              }}
              className="text-xs text-rose-600 hover:underline font-semibold"
            >
              Cancel Capture
            </button>
          </div>
        )}

        {/* VIEW 4: Capture Paused State */}
        {isAuthenticated && viewState === "paused" && (
          <div className="space-y-4 text-center py-2">
            <div className="h-12 w-12 rounded-2xl bg-[#F2E5D4] text-[#A86A1A] flex items-center justify-center mx-auto text-xl font-bold border border-[#A86A1A]/20">
              ⏸
            </div>
            <div className="space-y-1">
              <h2 className="font-serif text-base font-bold text-[#1F2421]">Auto-Capture Paused</h2>
              <p className="text-xs text-[#60706A] leading-relaxed">
                Background webpage capturing is currently paused for your privacy.
              </p>
            </div>
            <button
              onClick={() => setViewState("ready")}
              className="w-full py-3 bg-[#2C6F54] hover:bg-[#235943] text-white rounded-xl font-bold text-xs transition-colors shadow-md"
            >
              ▷ Resume Auto-Capture
            </button>
          </div>
        )}

        {/* VIEW 5: Manual Note Mode */}
        {isAuthenticated && viewState === "manual_note" && (
          <div className="space-y-3">
            <div className="flex justify-between items-center border-b border-[#E5DFD0] pb-2">
              <h2 className="font-serif text-sm font-bold text-[#1F2421]">Create Quick Note</h2>
              <span className="text-[9px] font-bold uppercase bg-[#DBE9DF] text-[#2C6F54] px-2 py-0.5 rounded border border-[#2C6F54]/20">
                MANUAL NOTE
              </span>
            </div>

            <input
              type="text"
              value={noteTitle}
              onChange={(e) => setNoteTitle(e.target.value)}
              placeholder="Note Title..."
              className="w-full bg-white border border-[#E5DFD0] rounded-xl px-3 py-2 text-xs text-[#1F2421] placeholder-[#60706A] focus:outline-none focus:border-[#2C6F54] font-medium"
            />

            <textarea
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              placeholder="Write your thoughts or clip content..."
              rows={3}
              className="w-full bg-white border border-[#E5DFD0] rounded-xl p-3 text-xs text-[#1F2421] placeholder-[#60706A] focus:outline-none focus:border-[#2C6F54] font-medium"
            />

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setViewState("ready")}
                className="flex-1 py-2.5 bg-white border border-[#E5DFD0] hover:bg-[#FAF8F1] text-[#1F2421] text-xs font-semibold rounded-xl"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveManualNote}
                disabled={!noteTitle.trim()}
                className="flex-1 py-2.5 bg-[#2C6F54] hover:bg-[#235943] disabled:opacity-50 text-white rounded-xl font-bold text-xs transition-colors shadow-xs"
              >
                Save Note
              </button>
            </div>
          </div>
        )}

        {/* VIEW 6: Memory Saved Success State */}
        {isAuthenticated && viewState === "saved" && (
          <div className="space-y-4 text-center py-2">
            <div className="h-12 w-12 rounded-2xl bg-[#DBE9DF] text-[#2C6F54] flex items-center justify-center mx-auto text-xl font-bold border border-[#2C6F54]/30 shadow-xs">
              ✓
            </div>
            <div>
              <h2 className="font-serif text-base font-bold text-[#1F2421]">Memory Saved to Vault!</h2>
              <p className="text-[11px] text-[#60706A]">Indexed and ready for RAG AI retrieval.</p>
            </div>

            <div className="p-3 bg-white border border-[#E5DFD0] rounded-2xl text-left space-y-1 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-bold uppercase bg-[#DBE9DF] text-[#2C6F54] px-2 py-0.5 rounded">
                  {activeTabType}
                </span>
                <span className="text-[10px] text-[#60706A]">Just now</span>
              </div>
              <p className="text-xs font-bold text-[#1F2421] truncate">{activeTabTitle}</p>
            </div>

            <button
              onClick={openDashboard}
              className="w-full py-2.5 bg-[#2C6F54] hover:bg-[#235943] text-white rounded-xl text-xs font-bold transition-all shadow-sm"
            >
              Open Web Dashboard ↗
            </button>

            <button
              onClick={() => setViewState("ready")}
              className="text-xs text-[#60706A] hover:underline font-medium"
            >
              ← Back to extension
            </button>
          </div>
        )}

        {/* VIEW 6b: Capture Failed */}
        {isAuthenticated && viewState === "failed" && (
          <div className="space-y-4 text-center py-2">
            <div className="h-12 w-12 rounded-2xl bg-rose-100 text-rose-700 flex items-center justify-center mx-auto text-xl font-bold border border-rose-200">
              ✕
            </div>
            <div>
              <h2 className="font-serif text-base font-bold text-[#1F2421]">Capture Failed</h2>
              <p className="text-[11px] text-rose-700 leading-relaxed px-2">
                {captureError ?? "Unable to save this page to your vault."}
              </p>
            </div>
            <button
              onClick={() => {
                setCaptureError(null);
                setViewState("ready");
              }}
              className="w-full py-2.5 bg-white border border-[#E5DFD0] hover:bg-[#FAF8F1] text-[#1F2421] rounded-xl text-xs font-bold"
            >
              Try Again
            </button>
          </div>
        )}

        {/* VIEW 6c: Sensitive Page Blocked */}
        {isAuthenticated && viewState === "sensitive" && (
          <div className="space-y-4 text-center py-2">
            <div className="h-12 w-12 rounded-2xl bg-[#F2E5D4] text-[#A86A1A] flex items-center justify-center mx-auto text-xl font-bold border border-[#A86A1A]/20">
              🔒
            </div>
            <div>
              <h2 className="font-serif text-base font-bold text-[#1F2421]">Page Protected</h2>
              <p className="text-[11px] text-[#60706A] leading-relaxed px-2">
                {captureError ?? "This page cannot be captured for privacy reasons."}
              </p>
            </div>
            <button
              onClick={() => {
                setCaptureError(null);
                setViewState("ready");
              }}
              className="w-full py-2.5 bg-white border border-[#E5DFD0] hover:bg-[#FAF8F1] text-[#1F2421] rounded-xl text-xs font-bold"
            >
              Back
            </button>
          </div>
        )}

        {/* VIEW 7: Extension Settings */}
        {isAuthenticated && viewState === "settings" && (
          <div className="space-y-3">
            <h2 className="font-serif text-sm font-bold text-[#1F2421] border-b border-[#E5DFD0] pb-2">
              Extension Preferences
            </h2>

            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between p-2.5 bg-white rounded-xl border border-[#E5DFD0]">
                <span className="text-[#1F2421] font-semibold">Auto-detect sensitive pages</span>
                <input
                  type="checkbox"
                  checked={autoDetectSensitive}
                  onChange={(e) => setAutoDetectSensitive(e.target.checked)}
                  className="accent-[#2C6F54] h-4 w-4 cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between p-2.5 bg-white rounded-xl border border-[#E5DFD0]">
                <span className="text-[#1F2421] font-semibold">Show save confirmation</span>
                <input
                  type="checkbox"
                  checked={showSaveConfirmation}
                  onChange={(e) => setShowSaveConfirmation(e.target.checked)}
                  className="accent-[#2C6F54] h-4 w-4 cursor-pointer"
                />
              </div>

              <div className="p-3 bg-white border border-[#E5DFD0] rounded-xl flex items-center justify-between mt-3">
                <div className="truncate">
                  <p className="text-[9px] font-bold uppercase text-[#60706A]">ACCOUNT</p>
                  <p className="text-xs font-bold text-[#1F2421] truncate">{user?.email}</p>
                </div>
                <button
                  onClick={handleSignOut}
                  className="text-xs text-rose-600 font-bold hover:underline"
                >
                  Sign Out
                </button>
              </div>

              <button
                onClick={() => setViewState("ready")}
                className="w-full py-2 bg-white border border-[#E5DFD0] hover:bg-[#FAF8F1] text-[#1F2421] text-xs font-semibold rounded-xl"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Global Extension Footer */}
      <footer className="pt-3 border-t border-[#E5DFD0]/80 flex justify-between items-center text-xs z-10">
        <button
          onClick={openDashboard}
          className="text-[#2C6F54] hover:underline font-bold flex items-center gap-1"
        >
          <span>🌐</span> Launch Sentiora Vault →
        </button>
      </footer>
    </main>
  );
}
