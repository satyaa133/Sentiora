import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Sidebar, { type NavTab } from "../components/Sidebar";
import MemoryCard from "../components/MemoryCard";
import MemoryDetailDrawer from "../components/MemoryDetailDrawer";
import MemoryFeedSkeleton from "../components/MemoryFeedSkeleton";
import MemoryTimelineView from "../components/views/MemoryTimelineView";
import SearchView from "../components/views/SearchView";
import AskSentioraView from "../components/views/AskSentioraView";
import ConnectedSourcesView from "../components/views/ConnectedSourcesView";
import PrivacyCenterView from "../components/views/PrivacyCenterView";
import AccountSettingsView from "../components/views/AccountSettingsView";
import AddMemoryModal from "../components/AddMemoryModal";
import { fetchMemoryItems, deleteMemoryItem } from "../services/memoryService";
import type { MemoryItem, SourceType } from "../types/memory";
import { formatExtractedContent } from "../utils/contentFormatter";

export default function DashboardHome() {
  const [activeTab, setActiveTab] = useState<NavTab>("dashboard");
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncToast, setSyncToast] = useState<string | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [selectedFilter, setSelectedFilter] = useState<"all" | SourceType>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [askQuery, setAskQuery] = useState<string>("");
  const [selectedItem, setSelectedItem] = useState<MemoryItem | null>(null);

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Global ⌘K keyboard shortcut to focus search bar
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setActiveTab("dashboard");
        setTimeout(() => searchInputRef.current?.focus(), 50);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const loadMemoryFeed = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);

    try {
      const data = await fetchMemoryItems(1, 100);
      setItems(data.items);
      setTotalCount(data.total);
    } catch (err) {
      console.error("Error loading memory feed:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleManualSync = async () => {
    setIsSyncing(true);
    await loadMemoryFeed(true);
    setIsSyncing(false);
    setSyncToast("Vault synced successfully!");
    setTimeout(() => setSyncToast(null), 2500);
  };

  useEffect(() => {
    loadMemoryFeed();

    // Silent background poll every 15 seconds for new captures
    const interval = setInterval(() => {
      loadMemoryFeed(true);
    }, 15000);

    return () => clearInterval(interval);
  }, [loadMemoryFeed]);

  const handleDeleteItem = async (id: string) => {
    try {
      await deleteMemoryItem(id);
      setItems((prev) => prev.filter((item) => item.id !== id));
      setTotalCount((prev) => Math.max(0, prev - 1));
      if (selectedItem?.id === id) {
        setSelectedItem(null);
      }
    } catch (err) {
      console.error("Error deleting memory item:", err);
      alert("Could not delete memory item. Please try again.");
    }
  };

  // Filter and search logic for dashboard home
  // Filter and search logic for dashboard home
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (selectedFilter !== "all" && item.source_type !== selectedFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        return (
          item.title.toLowerCase().includes(query) ||
          item.url.toLowerCase().includes(query) ||
          (item.content?.toLowerCase().includes(query) ?? false)
        );
      }
      return true;
    });
  }, [items, selectedFilter, searchQuery]);

  // Dynamic source type counts
  const webpageCount = useMemo(() => items.filter((i) => i.source_type === "webpage").length, [items]);
  const pdfCount = useMemo(() => items.filter((i) => i.source_type === "pdf").length, [items]);
  const youtubeCount = useMemo(() => items.filter((i) => i.source_type === "youtube").length, [items]);

  // Active source channels count
  const activeSourcesCount = useMemo(() => {
    const typesPresent = new Set(items.map((i) => i.source_type));
    return Math.max(typesPresent.size, 1);
  }, [items]);

  // Dynamic storage size calculation from actual memory items content & metadata
  const calculatedStorageString = useMemo(() => {
    if (!items || items.length === 0) return "0 KB";
    let totalBytes = 0;
    for (const item of items) {
      const text = (item.title || "") + (item.content || "") + (item.url || "") + (item.summary || "");
      totalBytes += new Blob([text]).size + 512;
    }
    if (totalBytes < 1024 * 1024) {
      return `${(totalBytes / 1024).toFixed(1)} KB`;
    } else if (totalBytes < 1024 * 1024 * 1024) {
      return `${(totalBytes / (1024 * 1024)).toFixed(1)} MB`;
    } else {
      return `${(totalBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }
  }, [items]);

  // Dynamic relative time string for most recent capture
  const lastCaptureTimeFormatted = useMemo(() => {
    if (!items || items.length === 0 || !items[0]?.captured_at) return "None";
    try {
      const date = new Date(items[0].captured_at);
      const now = new Date();
      const diffSecs = Math.floor((now.getTime() - date.getTime()) / 1000);

      if (diffSecs < 60) return "Just now";
      if (diffSecs < 3600) return `${Math.floor(diffSecs / 60)}m ago`;
      if (diffSecs < 86400) return `${Math.floor(diffSecs / 3600)}h ago`;
      if (diffSecs < 172800) return "Yesterday";
      return `${Math.floor(diffSecs / 86400)}d ago`;
    } catch {
      return "Recently";
    }
  }, [items]);

  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-parchment-0 text-ink-900 font-sans selection:bg-moss-100 selection:text-moss-700">
      {/* Ambient background glow blur blobs */}
      <div className="pointer-events-none fixed -top-40 -left-40 w-96 h-96 bg-moss-500/10 rounded-full blur-[120px] z-0" />
      <div className="pointer-events-none fixed top-1/3 right-0 w-[30rem] h-[30rem] bg-amber-500/10 rounded-full blur-[140px] z-0" />
      <div className="pointer-events-none fixed -bottom-40 left-1/3 w-[32rem] h-[32rem] bg-moss-600/10 rounded-full blur-[140px] z-0" />

      {/* Sidebar */}
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />

      {/* Main Content Canvas */}
      <main className="flex-1 flex flex-col min-w-0 h-full overflow-y-auto p-6 md:p-8 max-w-7xl z-10">
        <header className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 sticky -top-6 md:-top-8 -mx-6 md:-mx-8 px-6 md:px-8 pt-6 pb-4 bg-parchment-50/95 backdrop-blur-xl border-b border-parchment-200/80 z-30 shadow-xs">
          <div>
            <h1 className="font-serif text-3xl font-bold text-ink-900 tracking-tight capitalize">
              {activeTab === "dashboard" && "Dashboard"}
              {activeTab === "timeline" && "Memory Timeline"}
              {activeTab === "search" && "Archive Search"}
              {activeTab === "ask" && "Ask Sentiora"}
              {activeTab === "sources" && "Connected Sources"}
              {activeTab === "privacy" && "Privacy Center"}
              {activeTab === "settings" && "Account Settings"}
            </h1>
            <p className="text-xs text-ink-500 font-medium mt-1">
              {activeTab === "dashboard" && "Search and browse your digital memory archive."}
              {activeTab === "timeline" && "Chronological history of all captured web content and notes."}
              {activeTab === "search" && "Instant keyword and topic search across your personal vault."}
              {activeTab === "ask" && "Ask natural language questions powered by your saved memories."}
              {activeTab === "sources" && "Manage connected browser extensions, file dropzones, and integrators."}
              {activeTab === "privacy" && "Manage domain blocklists and personal vault export controls."}
              {activeTab === "settings" && "Update profile details and account security settings."}
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            {syncToast && (
              <span className="text-[11px] font-bold text-moss-600 bg-moss-50 border border-moss-200/60 px-2.5 py-1 rounded-lg animate-fade-in">
                ✓ {syncToast}
              </span>
            )}

            <button
              onClick={handleManualSync}
              disabled={isSyncing}
              title="Sync Archive from all sources"
              className="px-3.5 py-2 bg-white/85 backdrop-blur-sm border border-parchment-200/80 hover:bg-white text-ink-900 text-xs font-semibold rounded-xl transition-all shadow-card hover:shadow-md flex items-center gap-1.5 disabled:opacity-50"
            >
              <svg className={`w-3.5 h-3.5 text-moss-600 ${isSyncing ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {isSyncing ? "Syncing..." : "Sync Vault"}
            </button>

            <button
              onClick={() => setIsAddModalOpen(true)}
              title="Manually Add Memory"
              className="px-3.5 py-2 bg-moss-600 hover:bg-moss-700 text-white text-xs font-semibold rounded-xl transition-all shadow-card hover:shadow-md flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
              Add Memory
            </button>
          </div>
        </header>

        {/* Tab 1: Main Dashboard (Dashboard.png layout) */}
        {activeTab === "dashboard" && (
          <div className="space-y-8">
            {/* ⌘K Search Bar */}
            <div className="relative group">
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search your memories (title, text, domain)..."
                className="w-full bg-white/85 backdrop-blur-md border border-parchment-200/80 rounded-2xl pl-11 pr-16 py-3.5 text-sm text-ink-900 placeholder-ink-500 shadow-card hover:shadow-md focus:bg-white focus:outline-none focus:border-moss-600 focus:ring-2 focus:ring-moss-600/10 transition-all font-medium"
              />
              <svg
                className="w-5 h-5 text-ink-500 absolute left-4 top-4 group-focus-within:text-moss-600 transition-colors"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <kbd className="absolute right-4 top-3.5 bg-parchment-100/90 backdrop-blur-xs border border-parchment-200/80 text-ink-500 text-[11px] font-mono font-bold px-2 py-1 rounded-md shadow-xs">
                ⌘K
              </kbd>
            </div>

            {/* 2-Column Grid matching Figma Dashboard.png */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Left Column: Recent Memories */}
              <div className="lg:col-span-2 space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-ink-500">
                    RECENT MEMORIES
                  </h2>
                  <button
                    onClick={() => setActiveTab("timeline")}
                    className="text-xs font-bold text-moss-600 hover:underline flex items-center gap-1"
                  >
                    View All Timeline →
                  </button>
                </div>

                {/* Filter Pills */}
                <div className="flex items-center gap-2 flex-wrap pb-2 border-b border-parchment-200/80 p-1">
                  {(["all", "webpage", "pdf", "youtube"] as const).map((filter) => (
                    <button
                      key={filter}
                      onClick={() => setSelectedFilter(filter)}
                      className={`px-3.5 py-1.5 rounded-full text-xs font-semibold capitalize transition-all duration-200 ${
                        selectedFilter === filter
                          ? "bg-moss-600 text-white shadow-sm font-bold"
                          : "bg-white/80 hover:bg-white backdrop-blur-xs text-ink-700 border border-parchment-200/80"
                      }`}
                    >
                      {filter === "all" ? "All Memories" : filter}
                    </button>
                  ))}
                </div>

                {/* Cards Feed */}
                {isLoading ? (
                  <MemoryFeedSkeleton />
                ) : filteredItems.length > 0 ? (
                  <div className="space-y-4">
                    {filteredItems.slice(0, 6).map((item) => (
                      <MemoryCard key={item.id} item={item} onSelect={setSelectedItem} onDelete={handleDeleteItem} />
                    ))}
                  </div>
                ) : (
                  <div className="bg-white/85 backdrop-blur-md border border-parchment-200/80 rounded-2xl p-10 text-center space-y-3 shadow-card">
                    <div className="h-12 w-12 rounded-full bg-parchment-100/90 text-moss-600 flex items-center justify-center mx-auto text-xl">
                      📂
                    </div>
                    <p className="text-base font-serif font-bold text-ink-900">Nothing saved yet</p>
                    <p className="text-xs text-ink-500 leading-relaxed max-w-sm mx-auto">
                      Connect sources or use the Sentiora Chrome Extension to start building your archive.
                    </p>
                  </div>
                )}

                {/* RECENT CAPTURE Card (Category-Aware) */}
                {(() => {
                  const categoryRecentItem = items.find((item) =>
                    selectedFilter === "all" ? true : item.source_type === selectedFilter
                  );

                  const headingTitle =
                    selectedFilter === "all"
                      ? "RECENT CAPTURE"
                      : `RECENT ${selectedFilter.toUpperCase()} CAPTURE`;

                  if (!categoryRecentItem) {
                    return (
                      <div className="mt-8 space-y-3">
                        <div className="flex items-center justify-between">
                          <h2 className="text-xs font-bold uppercase tracking-wider text-ink-500">
                            {headingTitle}
                          </h2>
                          <span className="text-[10px] font-semibold text-ink-400 capitalize">
                            Category: {selectedFilter === "all" ? "All Memories" : selectedFilter}
                          </span>
                        </div>
                        <div className="bg-white/85 backdrop-blur-md border border-parchment-200/80 rounded-2xl p-6 shadow-card text-center space-y-1.5">
                          <p className="text-xs font-bold text-ink-700">
                            No recent {selectedFilter === "all" ? "" : selectedFilter} captures yet
                          </p>
                          <p className="text-[11px] text-ink-500">
                            Capture {selectedFilter === "all" ? "web content, PDFs, or videos" : selectedFilter + " content"} using the extension or dashboard to see it featured here.
                          </p>
                        </div>
                      </div>
                    );
                  }

                  const formattedTop = formatExtractedContent(categoryRecentItem);
                  const readMin = Math.max(1, Math.ceil((categoryRecentItem.reading_time_seconds || 120) / 60));
                  const dateFormatted = new Date(categoryRecentItem.captured_at).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  });

                  return (
                    <div className="mt-8 space-y-3">
                      <div className="flex items-center justify-between">
                        <h2 className="text-xs font-bold uppercase tracking-wider text-ink-500 flex items-center gap-2">
                          <span>{headingTitle}</span>
                          <span className="w-1.5 h-1.5 rounded-full bg-moss-600 animate-pulse" />
                        </h2>
                        <span className="text-[10px] font-semibold text-moss-600 bg-moss-50 px-2.5 py-0.5 rounded-full border border-moss-200/60">
                          Category: {selectedFilter === "all" ? "All Memories" : selectedFilter}
                        </span>
                      </div>

                      <div className="bg-white/85 backdrop-blur-md border border-parchment-200/80 rounded-2xl p-6 shadow-card hover:shadow-lg transition-all space-y-3">
                        <div className="flex items-center justify-between text-xs">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-moss-100/90 text-moss-600 backdrop-blur-xs">
                            {categoryRecentItem.source_type.toUpperCase()}
                          </span>
                          <span className="text-ink-500 font-medium">
                            Captured {dateFormatted} · {readMin} min read
                          </span>
                        </div>

                        <h3 className="text-base font-bold text-ink-900 leading-snug line-clamp-1">
                          {categoryRecentItem.title}
                        </h3>

                        <p className="text-xs text-ink-700 line-clamp-2 leading-relaxed">
                          {formattedTop.cleanText}
                        </p>

                        <div className="pt-2 flex items-center justify-between border-t border-parchment-200/60 text-xs">
                          <button
                            onClick={() => setSelectedItem(categoryRecentItem)}
                            className="font-bold text-moss-600 hover:underline flex items-center gap-1"
                          >
                            View Memory Details →
                          </button>
                          <span className="text-[11px] text-ink-500 font-medium">
                            {categoryRecentItem.word_count} words
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Right Column: Side Panel Cards */}
              <div className="space-y-6">
                {/* Card 1: CONNECTED SOURCES */}
                <div className="bg-white/85 backdrop-blur-md border border-parchment-200/80 rounded-2xl p-5 shadow-card hover:shadow-md transition-all space-y-4">
                  <div className="flex items-center justify-between border-b border-parchment-200/80 pb-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-ink-900">
                      CONNECTED SOURCES
                    </h3>
                    <span
                      onClick={() => setActiveTab("sources")}
                      className="text-moss-600 font-bold text-sm cursor-pointer hover:underline"
                    >
                      +
                    </span>
                  </div>
                  <ul className="space-y-3 text-xs font-semibold">
                    <li className="flex items-center justify-between text-ink-900">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-moss-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                        Webpages
                      </div>
                      <span className="text-ink-500 font-normal text-[11px]">
                        {webpageCount > 0 ? `Active (${webpageCount})` : "Active"}
                      </span>
                    </li>
                    <li className="flex items-center justify-between text-ink-900">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-moss-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                        PDFs
                      </div>
                      <span className="text-ink-500 font-normal text-[11px]">
                        {pdfCount > 0 ? `Active (${pdfCount})` : "Active"}
                      </span>
                    </li>
                    <li className="flex items-center justify-between text-ink-900">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-moss-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                        YouTube
                      </div>
                      <span className="text-ink-500 font-normal text-[11px]">
                        {youtubeCount > 0 ? `Active (${youtubeCount})` : "Active"}
                      </span>
                    </li>
                  </ul>
                </div>

                {/* Card 2: ASK SENTIORA */}
                <div className="bg-white/85 backdrop-blur-md border border-parchment-200/80 rounded-2xl p-5 shadow-card hover:shadow-md transition-all space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-ink-900">
                    ASK SENTIORA
                  </h3>
                  <p className="text-xs text-ink-500 leading-relaxed">
                    Ask about anything you've saved.
                  </p>
                  <div className="relative">
                    <input
                      type="text"
                      value={askQuery}
                      onChange={(e) => setAskQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") setActiveTab("ask");
                      }}
                      placeholder={
                        items.length > 0 && items[0]
                          ? `Ask about "${items[0].title.slice(0, 24)}..."`
                          : "Ask a question about your saved memories..."
                      }
                      className="w-full bg-parchment-50/80 backdrop-blur-xs border border-parchment-200/80 rounded-xl pl-3 pr-10 py-2.5 text-xs text-ink-900 placeholder-ink-500 focus:outline-none focus:border-moss-600 focus:bg-white font-medium transition-colors"
                    />
                    <button
                      onClick={() => setActiveTab("ask")}
                      className="absolute right-1.5 top-1.5 h-7 w-7 bg-moss-600 hover:bg-moss-700 text-white rounded-lg flex items-center justify-center transition-colors font-bold shadow-xs"
                    >
                      →
                    </button>
                  </div>
                </div>

                {/* Card 3: VAULT OVERVIEW */}
                <div className="bg-white/85 backdrop-blur-md border border-parchment-200/80 rounded-2xl p-5 shadow-card hover:shadow-md transition-all space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-ink-900 border-b border-parchment-200/80 pb-3">
                    VAULT OVERVIEW
                  </h3>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between text-ink-700">
                      <span>Memories Saved</span>
                      <span className="font-bold text-ink-900">{totalCount}</span>
                    </div>
                    <div className="flex justify-between text-ink-700">
                      <span>Last Capture</span>
                      <span className="font-bold text-ink-900">{lastCaptureTimeFormatted}</span>
                    </div>
                    <div className="flex justify-between text-ink-700">
                      <span>Sources Connected</span>
                      <span className="font-bold text-ink-900">{activeSourcesCount}</span>
                    </div>
                    <div className="flex justify-between text-ink-700">
                      <span>Storage Used</span>
                      <span className="font-bold text-ink-900">{calculatedStorageString}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Memory Timeline */}
        {activeTab === "timeline" && (
          <MemoryTimelineView
            items={items}
            isLoading={isLoading}
            onSelectItem={setSelectedItem}
          />
        )}

        {/* Tab 3: Search Archives */}
        {activeTab === "search" && (
          <SearchView items={items} onSelectItem={setSelectedItem} />
        )}

        {/* Tab 4: Ask Sentiora RAG */}
        {activeTab === "ask" && <AskSentioraView items={items} />}

        {/* Tab 5: Connected Sources */}
        {activeTab === "sources" && (
          <ConnectedSourcesView items={items} onRefreshFeed={() => loadMemoryFeed(true)} />
        )}

        {/* Tab 6: Privacy Center */}
        {activeTab === "privacy" && <PrivacyCenterView items={items} />}

        {/* Tab 7: Account Settings */}
        {activeTab === "settings" && <AccountSettingsView />}
      </main>

      {/* Slide-over Detail Drawer */}
      <MemoryDetailDrawer
        item={selectedItem}
        onClose={() => setSelectedItem(null)}
        onDelete={handleDeleteItem}
      />

      {/* Manual Memory Ingestion Modal */}
      <AddMemoryModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSuccess={() => loadMemoryFeed(true)}
      />
    </div>
  );
}
