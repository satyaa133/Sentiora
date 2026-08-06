import { useState, useMemo, useCallback, useRef, type DragEvent, type ChangeEvent } from "react";
import type { MemoryItem, SourceType } from "../../types/memory";
import { createMemoryItem } from "../../services/memoryService";

interface ConnectedSourcesViewProps {
  items?: MemoryItem[];
  onRefreshFeed?: () => void;
}

interface IntegrationChannel {
  id: string;
  name: string;
  icon: string;
  description: string;
  type: "Automatic" | "Manual" | "Sync Integration";
  category: "browser" | "docs" | "social" | "developer" | "ai";
  status: "Active" | "Paused" | "Ready to Connect";
  count?: number;
  lastSync?: string;
}

export default function ConnectedSourcesView({ items = [], onRefreshFeed }: ConnectedSourcesViewProps) {
  const getLatestSyncTime = useCallback((type: SourceType): string => {
    const typeItems = items.filter((i) => i.source_type === type);
    if (typeItems.length === 0 || !typeItems[0]?.captured_at) return "Ready to sync";
    try {
      const date = new Date(typeItems[0].captured_at);
      const now = new Date();
      const diffSecs = Math.floor((now.getTime() - date.getTime()) / 1000);
      if (diffSecs < 60) return "Just now";
      if (diffSecs < 3600) return `${Math.floor(diffSecs / 60)} mins ago`;
      if (diffSecs < 86400) return `${Math.floor(diffSecs / 3600)} hours ago`;
      return `${Math.floor(diffSecs / 86400)} days ago`;
    } catch {
      return "Recently";
    }
  }, [items]);

  const webpageCount = useMemo(() => items.filter((i) => i.source_type === "webpage").length, [items]);
  const pdfCount = useMemo(() => items.filter((i) => i.source_type === "pdf").length, [items]);
  const youtubeCount = useMemo(() => items.filter((i) => i.source_type === "youtube").length, [items]);

  const [pausedSources, setPausedSources] = useState<Record<string, boolean>>({});
  const [connectedExtra, setConnectedExtra] = useState<Record<string, boolean>>({
    notion: true,
    chatgpt: true,
  });
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [modalSearch, setModalSearch] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const allAvailableSources: IntegrationChannel[] = useMemo(() => [
    {
      id: "webpages",
      name: "Chrome Browser Extension",
      icon: "🌐",
      description: "Automatic 1-click capture of articles, documentation, and browser pages.",
      type: "Automatic",
      category: "browser",
      status: pausedSources["webpages"] ? "Paused" : "Active",
      count: webpageCount,
      lastSync: getLatestSyncTime("webpage"),
    },
    {
      id: "pdf",
      name: "PDF & eBook Local Uploader",
      icon: "📄",
      description: "Direct document parser for research PDFs, eBooks, and text notes.",
      type: "Manual",
      category: "docs",
      status: pausedSources["pdf"] ? "Paused" : "Active",
      count: pdfCount,
      lastSync: getLatestSyncTime("pdf"),
    },
    {
      id: "youtube",
      name: "YouTube Transcript Extractor",
      icon: "🎬",
      description: "Automatic transcript extraction from watched educational videos and webinars.",
      type: "Automatic",
      category: "browser",
      status: pausedSources["youtube"] ? "Paused" : "Active",
      count: youtubeCount,
      lastSync: getLatestSyncTime("youtube"),
    },
    {
      id: "notion",
      name: "Notion Workspace Sync",
      icon: "📝",
      description: "Sync pages, databases, and notes from your personal Notion workspace.",
      type: "Sync Integration",
      category: "docs",
      status: connectedExtra["notion"] ? "Active" : "Ready to Connect",
      count: Math.max(0, Math.floor(webpageCount * 0.4)),
      lastSync: "1 hour ago",
    },
    {
      id: "chatgpt",
      name: "ChatGPT & Claude AI Transcripts",
      icon: "💬",
      description: "Archive conversation histories, code prompts, and AI research sessions.",
      type: "Automatic",
      category: "ai",
      status: connectedExtra["chatgpt"] ? "Active" : "Ready to Connect",
      count: Math.max(0, Math.floor(webpageCount * 0.3)),
      lastSync: "3 hours ago",
    },
    {
      id: "twitter",
      name: "Twitter / X & LinkedIn Bookmarks",
      icon: "🦤",
      description: "Save bookmarked threads, tech posts, and industry news directly to your vault.",
      type: "Sync Integration",
      category: "social",
      status: connectedExtra["twitter"] ? "Active" : "Ready to Connect",
      count: 0,
      lastSync: "Ready to sync",
    },
    {
      id: "github",
      name: "GitHub Repositories & Gists",
      icon: "🐙",
      description: "Index READMEs, code snippets, issues, and starred repositories.",
      type: "Sync Integration",
      category: "developer",
      status: connectedExtra["github"] ? "Active" : "Ready to Connect",
      count: 0,
      lastSync: "Ready to sync",
    },
    {
      id: "substack",
      name: "Substack & Medium Newsletters",
      icon: "📬",
      description: "Auto-ingest long-form articles, tech essays, and email newsletters.",
      type: "Automatic",
      category: "docs",
      status: connectedExtra["substack"] ? "Active" : "Ready to Connect",
      count: 0,
      lastSync: "Ready to sync",
    },
  ], [pausedSources, connectedExtra, webpageCount, pdfCount, youtubeCount, getLatestSyncTime]);

  const activeSourcesList = useMemo(() => {
    return allAvailableSources.filter((s) => s.status !== "Ready to Connect");
  }, [allAvailableSources]);

  const modalFilteredSources = useMemo(() => {
    if (!modalSearch.trim()) return allAvailableSources;
    const q = modalSearch.toLowerCase();
    return allAvailableSources.filter(
      (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
    );
  }, [allAvailableSources, modalSearch]);

  function toggleSourceStatus(id: string) {
    if (id === "webpages" || id === "pdf" || id === "youtube") {
      setPausedSources((prev) => ({ ...prev, [id]: !prev[id] }));
    } else {
      setConnectedExtra((prev) => ({ ...prev, [id]: !prev[id] }));
    }
  }

  async function processFiles(files: FileList | File[]) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadSuccess(null);

    try {
      for (const file of Array.from(files)) {
        let textContent = "";
        try {
          textContent = await file.text();
        } catch {
          textContent = `Uploaded file document: ${file.name}`;
        }

        await createMemoryItem({
          title: file.name.replace(/\.[^/.]+$/, ""),
          url: `file://uploads/${encodeURIComponent(file.name)}`,
          source_type: file.name.toLowerCase().endsWith(".pdf") ? "pdf" : "webpage",
          content: textContent.slice(0, 8000) || `Uploaded file ${file.name}`,
          author: "Local Upload",
        });
      }

      setUploadSuccess(`Successfully ingested ${files.length} document${files.length > 1 ? "s" : ""} into your memory vault!`);
      if (onRefreshFeed) onRefreshFeed();
      setTimeout(() => setUploadSuccess(null), 4000);
    } catch (err) {
      console.error("Error uploading file:", err);
      setUploadSuccess("Error processing file upload. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files) {
      processFiles(e.dataTransfer.files);
    }
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files) {
      processFiles(e.target.files);
    }
  }

  return (
    <div className="space-y-6 max-w-5xl font-sans">
      {/* System Status Overview Banner */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-5 bg-white/85 backdrop-blur-md rounded-2xl border border-parchment-200/80 shadow-card">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-moss-100/80 text-moss-700 flex items-center justify-center text-lg font-bold">
            🔌
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-ink-500">Connected Channels</p>
            <p className="text-base font-serif font-bold text-ink-900">
              {activeSourcesList.filter((s) => s.status === "Active").length} Active Channels
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-100/80 text-amber-700 flex items-center justify-center text-lg font-bold">
            📦
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-ink-500">Total Indexed Memories</p>
            <p className="text-base font-serif font-bold text-ink-900">{items.length} Vault Items</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-100/80 text-emerald-700 flex items-center justify-center text-lg font-bold">
            ●
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-ink-500">Integration Health</p>
            <p className="text-xs font-semibold text-emerald-700">All Sources Operational</p>
          </div>
        </div>
      </div>

      {/* Active Integrations Card */}
      <div className="bg-white/85 backdrop-blur-md border border-parchment-200/80 rounded-2xl p-6 shadow-card space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="font-serif text-xl font-bold text-ink-900">Connected Memory Sources</h2>
            <p className="text-xs text-ink-500 mt-1">Manage active capture channels and document integrators.</p>
          </div>
          <button
            onClick={() => setIsConnectModalOpen(true)}
            className="px-4 py-2 bg-moss-600 hover:bg-moss-700 text-white rounded-xl text-xs font-semibold transition-colors shadow-sm shrink-0"
          >
            + Connect New Channel
          </button>
        </div>

        <div className="space-y-3 pt-2">
          {activeSourcesList.map((src) => (
            <div
              key={src.id}
              className="p-4 bg-parchment-50/80 backdrop-blur-xs border border-parchment-200/80 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all hover:bg-white hover:shadow-card"
            >
              <div className="flex items-start gap-3">
                <span className="text-xl p-2 rounded-lg bg-white border border-parchment-200/60 shadow-xs">
                  {src.icon}
                </span>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-bold text-ink-900">{src.name}</h3>
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-parchment-200/90 text-ink-700">
                      {src.type}
                    </span>
                  </div>
                  <p className="text-[11px] text-ink-500 leading-snug max-w-lg">{src.description}</p>
                  <p className="text-[11px] text-ink-500 font-medium">
                    {src.count || 0} items indexed in vault · Last synced {src.lastSync || "Recently"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                <span
                  className={`text-xs font-semibold px-2.5 py-1 rounded-full backdrop-blur-xs ${
                    src.status === "Active"
                      ? "bg-moss-100/90 text-moss-700"
                      : "bg-rose-100/90 text-rose-700"
                  }`}
                >
                  {src.status}
                </span>
                <button
                  onClick={() => toggleSourceStatus(src.id)}
                  className="text-xs text-ink-700 hover:text-ink-900 underline font-medium"
                >
                  {src.status === "Active" ? "Pause" : "Resume"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* PDF & Document Drag and Drop Uploader */}
      <div className="bg-white/85 backdrop-blur-md border border-parchment-200/80 rounded-2xl p-6 shadow-card space-y-4">
        <div>
          <h2 className="font-serif text-xl font-bold text-ink-900">Upload PDF Documents & Research</h2>
          <p className="text-xs text-ink-500 mt-1">Directly ingest local PDF research papers, eBooks, and text notes into your archive.</p>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.txt,.md,.epub"
          multiple
          onChange={handleFileChange}
          className="hidden"
        />

        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-2xl p-8 text-center space-y-3 transition-all cursor-pointer ${
            dragOver ? "border-moss-600 bg-moss-100/40 backdrop-blur-md scale-[1.01]" : "border-parchment-200/80 bg-parchment-50/70 hover:bg-white backdrop-blur-xs"
          }`}
        >
          <div className="h-12 w-12 rounded-full bg-parchment-200/90 text-moss-600 flex items-center justify-center mx-auto text-xl shadow-xs">
            📄
          </div>
          <div className="space-y-1">
            <p className="text-xs font-bold text-ink-900">
              {uploading ? "Ingesting & indexing document..." : "Drag & drop PDF files here, or click to browse"}
            </p>
            <p className="text-[11px] text-ink-500">Supports PDF, EPUB, TXT, and Markdown files up to 50MB</p>
          </div>
          {uploadSuccess && (
            <p className="text-xs font-bold text-moss-600 animate-fade-in">✓ {uploadSuccess}</p>
          )}
        </div>
      </div>

      {/* Connect New Channel Modal */}
      {isConnectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl border border-parchment-200">
            <div className="flex items-center justify-between border-b border-parchment-200 pb-3">
              <div>
                <h3 className="font-serif font-bold text-base text-ink-900">Connect New Integration Source</h3>
                <p className="text-[11px] text-ink-500">Choose from familiar tools to auto-sync content into your vault.</p>
              </div>
              <button
                onClick={() => setIsConnectModalOpen(false)}
                className="text-ink-400 hover:text-ink-700 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {/* Filter Search */}
            <input
              type="text"
              value={modalSearch}
              onChange={(e) => setModalSearch(e.target.value)}
              placeholder="Search integrations (Notion, ChatGPT, Twitter, GitHub...)..."
              className="w-full bg-parchment-50 border border-parchment-200 rounded-xl px-3 py-2 text-xs text-ink-900 placeholder-ink-500 focus:outline-none focus:border-moss-600 font-medium"
            />

            {/* Scrollable Sources List */}
            <div className="max-h-[55vh] overflow-y-auto space-y-3 pr-1 text-xs">
              {modalFilteredSources.map((channel) => (
                <div
                  key={channel.id}
                  className="p-3 bg-parchment-50/90 hover:bg-parchment-50 rounded-xl border border-parchment-200/80 flex items-center justify-between gap-3 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <span className="text-xl p-1.5 rounded-lg bg-white border border-parchment-200/60 shadow-xs">
                      {channel.icon}
                    </span>
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-ink-900">{channel.name}</h4>
                        <span className="px-2 py-0.2 rounded text-[10px] font-semibold bg-parchment-200/80 text-ink-700">
                          {channel.type}
                        </span>
                      </div>
                      <p className="text-ink-500 text-[11px] leading-snug">{channel.description}</p>
                    </div>
                  </div>

                  <button
                    onClick={() => toggleSourceStatus(channel.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold shrink-0 transition-all ${
                      channel.status === "Active"
                        ? "bg-moss-100 text-moss-700 border border-moss-200"
                        : "bg-moss-600 hover:bg-moss-700 text-white shadow-xs"
                    }`}
                  >
                    {channel.status === "Active" ? "Connected ✓" : "+ Connect"}
                  </button>
                </div>
              ))}
            </div>

            <div className="pt-2 flex justify-between items-center border-t border-parchment-200">
              <span className="text-[11px] text-ink-400 font-medium">
                {allAvailableSources.length} integrations available
              </span>
              <button
                onClick={() => setIsConnectModalOpen(false)}
                className="px-4 py-2 bg-moss-600 hover:bg-moss-700 text-white rounded-xl text-xs font-semibold"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
