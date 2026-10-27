import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Sidebar, { MobileTopBar, type NavTab } from "../components/Sidebar";
import CommandPalette from "../components/CommandPalette";
import MemoryDetailDrawer from "../components/MemoryDetailDrawer";
import HomeView from "../components/views/HomeView";
import MemoryTimelineView, {
  type TimelinePreset,
} from "../components/views/MemoryTimelineView";
import IntelligenceView from "../components/views/IntelligenceView";
import SearchView from "../components/views/SearchView";
import AskSentioraView from "../components/views/AskSentioraView";
import ConnectedSourcesView from "../components/views/ConnectedSourcesView";
import PrivacyCenterView from "../components/views/PrivacyCenterView";
import AccountSettingsView from "../components/views/AccountSettingsView";
import AddMemoryModal from "../components/AddMemoryModal";
import { useAuth } from "../context/AuthContext";
import { emitEcho } from "../components/echo/echoEvents";
import { useEchoFeedEvents } from "../hooks/useEchoFeedEvents";
import { useMemoryFeed } from "../hooks/useMemoryFeed";
import type { AskLaunch, AskScope } from "../services/askService";
import type { MemoryItem, SourceType } from "../types/memory";

const NAV_TABS: readonly NavTab[] = [
  "dashboard",
  "intelligence",
  "timeline",
  "search",
  "ask",
  "sources",
  "privacy",
  "settings",
];

const PAGE_HEADINGS: Partial<Record<NavTab, { title: string; subtitle: string }>> = {
  intelligence: {
    title: "Intelligence",
    subtitle: "What your memory holds, what needs attention, and what to ask next.",
  },
  timeline: { title: "Timeline", subtitle: "Everything you've saved, newest first." },
  search: { title: "Search", subtitle: "Find a memory by its title, text or address." },
  sources: {
    title: "Sources",
    subtitle: "Choose what Sentiora saves, and upload files.",
  },
  privacy: { title: "Privacy", subtitle: "Blocked sites and exporting your memory." },
  settings: { title: "Settings", subtitle: "Your profile and preferences." },
};

function tabFromPath(pathname: string): NavTab {
  const segment = pathname.replace(/^\/+|\/+$/g, "");
  return (NAV_TABS as readonly string[]).includes(segment)
    ? (segment as NavTab)
    : "dashboard";
}

export default function DashboardHome() {
  // The URL is the source of truth so deep links (/ask, /timeline, ...) and
  // browser back/forward open the matching view.
  const location = useLocation();
  const navigate = useNavigate();
  const activeTab = tabFromPath(location.pathname);
  const setActiveTab = useCallback(
    (tab: NavTab) => {
      if (tabFromPath(window.location.pathname) !== tab) navigate(`/${tab}`);
    },
    [navigate],
  );
  const { user } = useAuth();
  const displayName =
    user?.profile?.display_name?.trim() || user?.email?.split("@")[0] || "there";
  const {
    items,
    isLoading,
    isSyncing,
    loadError,
    toast,
    loadMemoryFeed,
    handleManualSync,
    handleDeleteItem,
  } = useMemoryFeed();
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [deleteCount, setDeleteCount] = useState(0);
  const [askLaunch, setAskLaunch] = useState<AskLaunch | null>(null);
  const [timelinePreset, setTimelinePreset] = useState<{ id: number; preset: TimelinePreset }>({
    id: 0,
    preset: {},
  });
  const [selectedItem, setSelectedItem] = useState<MemoryItem | null>(null);

  // Global Ctrl/Cmd+K opens the command palette.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const onDeleteItem = async (id: string) => {
    const deleted = await handleDeleteItem(id);
    // The feed holds only the newest 100 items, so count deletes separately
    // to refresh views that page further back.
    if (deleted) setDeleteCount((count) => count + 1);
    if (deleted && selectedItem?.id === id) {
      setSelectedItem(null);
    }
  };

  // Changes only when a memory is added, removed or changes status, so the
  // Timeline and statistics refresh without refetching on every poll.
  const feedKey = useMemo(
    () => items.map((item) => `${item.id}:${item.status}`).join(","),
    [items],
  );

  const viewRefreshKey = `${feedKey}|${deleteCount}`;

  // Echo reacts to real feed changes and tab switches only (DESIGN.md §8.2).
  useEchoFeedEvents(items, !isLoading && !loadError, feedKey);
  const previousTab = useRef(activeTab);
  useEffect(() => {
    if (previousTab.current === activeTab) return;
    previousTab.current = activeTab;
    emitEcho({ type: "navigate", tab: activeTab });
  }, [activeTab]);

  const openAsk = useCallback(
    (question?: string, options: { scope?: AskScope; send?: boolean } = {}) => {
      setAskLaunch({
        id: Date.now(),
        question,
        // An explicit scope replaces the current one; plain questions keep it unset.
        scope: options.scope,
        autoSend: options.send,
      });
      setActiveTab("ask");
    },
    [setActiveTab],
  );

  const askAbout = useCallback((question: string) => openAsk(question), [openAsk]);

  const askAboutItem = useCallback(
    (item: MemoryItem) =>
      openAsk(`What is "${item.title}" about?`, {
        scope: { memoryId: item.id, label: item.title },
      }),
    [openAsk],
  );

  const askAboutSource = useCallback(
    (sourceType: SourceType, label: string) =>
      openAsk("Summarize my latest saves", { scope: { sourceType, label } }),
    [openAsk],
  );

  const openTimeline = useCallback(
    (preset: TimelinePreset) => {
      setTimelinePreset((prev) => ({ id: prev.id + 1, preset }));
      setActiveTab("timeline");
    },
    [setActiveTab],
  );

  const clearAskLaunch = useCallback(() => setAskLaunch(null), []);

  const openMemoryById = useCallback(
    (memoryId: string) => {
      const item = items.find((candidate) => candidate.id === memoryId);
      if (item) setSelectedItem(item);
      return Boolean(item);
    },
    [items],
  );

  const heading = PAGE_HEADINGS[activeTab];
  const isAsk = activeTab === "ask";

  return (
    <div className="flex h-screen w-full overflow-hidden bg-bg text-fg">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} rail={isAsk} />

      <div className="flex min-w-0 flex-1 flex-col">
        <MobileTopBar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onOpenPalette={() => setPaletteOpen(true)}
        />

        <main
          id="main"
          className={
            isAsk ? "flex min-h-0 flex-1 flex-col" : "min-h-0 flex-1 overflow-y-auto"
          }
        >
          {activeTab === "dashboard" && (
            <HomeView
              name={displayName}
              items={items}
              isLoading={isLoading}
              loadError={loadError}
              isSyncing={isSyncing}
              status={toast}
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
              onRetry={() => void loadMemoryFeed()}
              onSync={() => void handleManualSync()}
              onAddMemory={() => setIsAddModalOpen(true)}
              onSelectItem={setSelectedItem}
              onAsk={askAbout}
              onOpenPalette={() => setPaletteOpen(true)}
              onViewTimeline={() => setActiveTab("timeline")}
              statsRefreshKey={viewRefreshKey}
            />
          )}

          {heading ? (
            <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6 lg:px-10 lg:pt-10">
              <header className="mb-8">
                <h1 className="font-display text-[28px] font-bold tracking-tight sm:text-page-title">
                  {heading.title}
                </h1>
                <p className="mt-1 text-[16px] text-muted">{heading.subtitle}</p>
                {toast ? (
                  <p role="status" className="mt-2 text-[15px] text-muted">
                    {toast}
                  </p>
                ) : null}
              </header>

              {activeTab === "intelligence" && (
                <IntelligenceView
                  items={items}
                  isLoading={isLoading}
                  loadError={loadError}
                  refreshKey={viewRefreshKey}
                  onRetry={() => void loadMemoryFeed()}
                  onAsk={openAsk}
                  onOpenTimeline={openTimeline}
                  onSelectItem={setSelectedItem}
                />
              )}

              {activeTab === "timeline" && (
                <MemoryTimelineView
                  key={timelinePreset.id}
                  preset={timelinePreset.preset}
                  refreshKey={viewRefreshKey}
                  onSelectItem={setSelectedItem}
                  onAskAbout={askAboutItem}
                />
              )}

              {activeTab === "search" && (
                <SearchView
                  items={items}
                  isLoading={isLoading}
                  loadError={loadError}
                  onRetry={() => void loadMemoryFeed()}
                  onSelectItem={setSelectedItem}
                />
              )}

              {activeTab === "sources" && (
                <ConnectedSourcesView
                  items={items}
                  onRefreshFeed={() => loadMemoryFeed(true)}
                  onAskAboutSource={askAboutSource}
                />
              )}

              {activeTab === "privacy" && <PrivacyCenterView items={items} />}

              {activeTab === "settings" && <AccountSettingsView />}
            </div>
          ) : null}

          {isAsk && (
            <AskSentioraView
              items={items}
              launch={askLaunch}
              onLaunchConsumed={clearAskLaunch}
              onOpenMemory={openMemoryById}
            />
          )}
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        items={items}
        onNavigate={setActiveTab}
        onAsk={askAbout}
        onOpenMemory={setSelectedItem}
      />

      {/* Slide-over Detail Drawer */}
      <MemoryDetailDrawer
        item={selectedItem}
        onClose={() => setSelectedItem(null)}
        onDelete={onDeleteItem}
        onAskAnything={(item) => {
          askAboutItem(item);
          setSelectedItem(null);
        }}
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
