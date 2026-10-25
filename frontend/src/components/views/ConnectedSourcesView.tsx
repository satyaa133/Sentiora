import {
  useMemo,
  useCallback,
  useRef,
  useState,
  type DragEvent,
  type ChangeEvent,
} from "react";
import {
  Button,
  Card,
  IconCheck,
  IconFile,
  IconLink,
  IconPlus,
  IconSearch,
  IconUpload,
  Input,
  Modal,
  cx,
} from "@shared/ui";
import type { MemoryItem, SourceType } from "../../types/memory";
import { SOURCE_ICONS } from "../sourceIcons";
import { useAuth } from "../../context/AuthContext";
import { createMemoryItem } from "../../services/memoryService";
import { parsePdf } from "../../utils/pdfParser";
import {
  SOURCE_CATALOG,
  statusToUiLabel,
  type SourceId,
  type SourceStatus,
} from "../../types/sourcePreferences";

interface ConnectedSourcesViewProps {
  items?: MemoryItem[];
  onRefreshFeed?: () => void;
}

interface IntegrationChannel {
  id: SourceId;
  name: string;
  description: string;
  type: "Automatic" | "Manual" | "Sync Integration";
  category: "browser" | "docs" | "social" | "developer" | "ai";
  status: "Active" | "Paused" | "Ready to Connect";
  count?: number;
  lastSync?: string;
}

const DISPLAY_NAMES: Record<SourceId, string> = {
  webpages: "Chrome Browser Extension",
  pdf: "PDF & eBook Local Uploader",
  youtube: "YouTube Transcript Extractor",
  notion: "Notion Workspace Sync",
  chatgpt: "ChatGPT & Claude AI Transcripts",
  twitter: "Twitter / X & LinkedIn Bookmarks",
  github: "GitHub Repositories & Gists",
  substack: "Substack & Medium Newsletters",
};

const MEMORY_SOURCE_MAP: Partial<Record<SourceId, SourceType>> = {
  webpages: "webpage",
  pdf: "pdf",
  youtube: "youtube",
};

export default function ConnectedSourcesView({
  items = [],
  onRefreshFeed,
}: ConnectedSourcesViewProps) {
  const { user, updateSourcePreference } = useAuth();
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [modalSearch, setModalSearch] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const getLatestSyncTime = useCallback(
    (type: SourceType): string => {
      const typeItems = items.filter((i) => i.source_type === type);
      if (typeItems.length === 0 || !typeItems[0]?.captured_at) return "Ready to sync";
      try {
        const date = new Date(typeItems[0].captured_at);
        const now = new Date();
        const diffSecs = Math.floor((now.getTime() - date.getTime()) / 1000);
        if (diffSecs < 60) return "Just now";
        if (diffSecs < 3600) return `${Math.floor(diffSecs / 60)} mins ago`;
        if (diffSecs < 86400) return `${Math.floor(diffSecs / 3600)} hours ago`;
        const days = Math.floor(diffSecs / 86400);
        return `${days} ${days === 1 ? "day" : "days"} ago`;
      } catch {
        return "Recently";
      }
    },
    [items],
  );

  const webpageCount = useMemo(
    () => items.filter((i) => i.source_type === "webpage").length,
    [items],
  );
  const pdfCount = useMemo(
    () => items.filter((i) => i.source_type === "pdf").length,
    [items],
  );
  const youtubeCount = useMemo(
    () => items.filter((i) => i.source_type === "youtube").length,
    [items],
  );

  const allAvailableSources: IntegrationChannel[] = useMemo(() => {
    const preferences: Partial<Record<SourceId, SourceStatus>> =
      user?.source_preferences ?? {};

    return SOURCE_CATALOG.map((source) => {
      const persistedStatus = (preferences[source.id] ??
        "not_connected") as SourceStatus;
      const memoryType = MEMORY_SOURCE_MAP[source.id];
      const count =
        memoryType === "webpage"
          ? webpageCount
          : memoryType === "pdf"
            ? pdfCount
            : memoryType === "youtube"
              ? youtubeCount
              : 0;

      return {
        id: source.id,
        name: DISPLAY_NAMES[source.id],
        description: source.description,
        type: source.type,
        category: source.category,
        status: statusToUiLabel(persistedStatus),
        count,
        lastSync: memoryType ? getLatestSyncTime(memoryType) : "Ready to sync",
      };
    });
  }, [
    user?.source_preferences,
    webpageCount,
    pdfCount,
    youtubeCount,
    getLatestSyncTime,
  ]);

  const activeSourcesList = useMemo(() => {
    return allAvailableSources.filter((s) => s.status !== "Ready to Connect");
  }, [allAvailableSources]);

  const modalFilteredSources = useMemo(() => {
    if (!modalSearch.trim()) return allAvailableSources;
    const q = modalSearch.toLowerCase();
    return allAvailableSources.filter(
      (s) =>
        s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
    );
  }, [allAvailableSources, modalSearch]);

  async function toggleSourceStatus(id: SourceId) {
    const current = user?.source_preferences?.[id] ?? "not_connected";
    let nextStatus: SourceStatus;

    if (current === "active") {
      nextStatus = "paused";
    } else if (current === "paused") {
      nextStatus = "active";
    } else {
      nextStatus = "active";
    }

    setIsUpdating(id);
    try {
      await updateSourcePreference(id, nextStatus);
    } finally {
      setIsUpdating(null);
    }
  }

  async function processFiles(files: FileList | File[]) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadSuccess(null);

    try {
      for (const file of Array.from(files)) {
        let textContent = "";
        let structuredNodes = undefined;

        if (file.name.toLowerCase().endsWith(".pdf")) {
          try {
            const buffer = await file.arrayBuffer();
            const nodes = await parsePdf(buffer);
            if (nodes && nodes.length > 0) {
              structuredNodes = nodes.slice(0, 5000);
              textContent = structuredNodes.map((n: any) => n.text).join("\n\n");
            } else {
              textContent = `Uploaded PDF document: ${file.name}`;
            }
          } catch (err) {
            console.error("PDF parse error:", err);
            textContent = `Uploaded PDF document: ${file.name}`;
          }
        } else {
          try {
            textContent = await file.text();
          } catch {
            textContent = `Uploaded file document: ${file.name}`;
          }
        }

        textContent = textContent.slice(0, 500_000);

        await createMemoryItem({
          title: file.name.replace(/\.[^/.]+$/, ""),
          url: `file://uploads/${encodeURIComponent(file.name)}`,
          source_type: file.name.toLowerCase().endsWith(".pdf") ? "pdf" : "webpage",
          content: textContent || `Uploaded file ${file.name}`,
          author: "Local Upload",
          structured_content: structuredNodes,
        });
      }

      setUploadSuccess(
        `Added ${files.length} ${files.length > 1 ? "files" : "file"} to your memory.`,
      );
      if (onRefreshFeed) onRefreshFeed();
      setTimeout(() => setUploadSuccess(null), 4000);
    } catch (err) {
      console.error("Error uploading file:", err);
      setUploadSuccess("Could not add that file. Please try again.");
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

  const activeCount = activeSourcesList.filter((s) => s.status === "Active").length;

  function actionLabel(channel: IntegrationChannel): string {
    if (isUpdating === channel.id) return "Saving";
    if (channel.status === "Active") return "Pause";
    if (channel.status === "Paused") return "Resume";
    return "Connect";
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card padding="sm" className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-btn bg-accent-soft text-accent-soft-fg">
            <IconLink size={20} />
          </span>
          <div>
            <p className="text-[15px] text-muted">Active sources</p>
            <p className="text-[20px] font-semibold text-fg">{activeCount}</p>
          </div>
        </Card>
        <Card padding="sm" className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-btn bg-accent-soft text-accent-soft-fg">
            <IconFile size={20} />
          </span>
          <div>
            <p className="text-[15px] text-muted">Memories saved</p>
            <p className="text-[20px] font-semibold text-fg">{items.length}</p>
          </div>
        </Card>
      </div>

      <Card as="section" aria-labelledby="sources-heading" padding="lg">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="sources-heading" className="text-[20px] font-semibold text-fg">
              Your sources
            </h2>
            <p className="mt-1 text-[15px] text-muted">
              Pause or resume what Sentiora saves.
            </p>
          </div>
          <Button
            variant="inverse"
            leadingIcon={<IconPlus size={18} />}
            onClick={() => setIsConnectModalOpen(true)}
          >
            Add a source
          </Button>
        </div>

        {activeSourcesList.length === 0 ? (
          <p className="mt-6 rounded-btn bg-raised px-4 py-6 text-center text-[15px] text-muted">
            No sources yet. Choose Add a source to pick what Sentiora saves.
          </p>
        ) : (
          <ul className="mt-5 divide-y divide-line-soft">
            {activeSourcesList.map((src) => (
              <li
                key={src.id}
                className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-start gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-btn bg-raised text-fg">
                    {SOURCE_ICONS[src.id]}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[16px] font-semibold text-fg">{src.name}</h3>
                      <span className="rounded-md bg-raised px-2 py-0.5 text-xs text-muted">
                        {src.type}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[15px] text-muted">{src.description}</p>
                    <p className="mt-0.5 text-sm text-muted">
                      {src.count || 0} {src.count === 1 ? "memory" : "memories"}
                      {src.lastSync && src.lastSync !== "Ready to sync"
                        ? ` · last saved ${src.lastSync.toLowerCase()}`
                        : ""}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3 self-end sm:self-center">
                  <span
                    className={cx(
                      "text-[15px] font-medium",
                      src.status === "Active" ? "text-fg" : "text-muted",
                    )}
                  >
                    {src.status}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => toggleSourceStatus(src.id)}
                    loading={isUpdating === src.id}
                    aria-label={`${actionLabel(src)} ${src.name}`}
                  >
                    {actionLabel(src)}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card as="section" aria-labelledby="upload-heading" padding="lg">
        <h2 id="upload-heading" className="text-[20px] font-semibold text-fg">
          Upload files
        </h2>
        <p className="mt-1 text-[15px] text-muted">
          Add PDFs, text or Markdown files from your computer.
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.txt,.md"
          multiple
          onChange={handleFileChange}
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
        />

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          disabled={uploading}
          aria-describedby="upload-status"
          className={cx(
            "mt-5 flex w-full flex-col items-center gap-3 rounded-card border-2 border-dashed px-6 py-10 text-center transition-colors",
            dragOver
              ? "border-accent bg-accent-soft"
              : "border-line bg-raised hover:border-muted",
          )}
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface text-fg">
            <IconUpload size={22} />
          </span>
          <span className="text-[16px] font-semibold text-fg">
            {uploading ? "Adding your files…" : "Drop files here, or choose files"}
          </span>
          <span className="text-sm text-muted">PDF, TXT or Markdown</span>
        </button>
        <p
          id="upload-status"
          role="status"
          className="mt-3 min-h-[24px] text-[15px] text-fg"
        >
          {uploadSuccess}
        </p>
      </Card>

      <Modal
        open={isConnectModalOpen}
        onClose={() => setIsConnectModalOpen(false)}
        title="Add a source"
        description="Choose what Sentiora should save."
        size="lg"
        footer={
          <>
            <span className="mr-auto self-center text-sm text-muted">
              {allAvailableSources.length} sources
            </span>
            <Button onClick={() => setIsConnectModalOpen(false)}>Done</Button>
          </>
        }
      >
        <label htmlFor="sources-search" className="sr-only">
          Search sources
        </label>
        <Input
          id="sources-search"
          value={modalSearch}
          onChange={(e) => setModalSearch(e.target.value)}
          placeholder="Search sources"
          leadingIcon={<IconSearch size={18} />}
        />
        <ul className="mt-4 space-y-2">
          {modalFilteredSources.map((channel) => (
            <li
              key={channel.id}
              className="flex items-center justify-between gap-3 rounded-card border border-line p-3"
            >
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-btn bg-raised text-fg">
                  {SOURCE_ICONS[channel.id]}
                </span>
                <div className="min-w-0">
                  <p className="font-semibold text-fg">{channel.name}</p>
                  <p className="text-sm text-muted">{channel.description}</p>
                </div>
              </div>
              {channel.status === "Active" ? (
                <span className="inline-flex shrink-0 items-center gap-1 text-[15px] text-muted">
                  <IconCheck size={16} />
                  Added
                </span>
              ) : (
                <Button
                  size="sm"
                  variant={channel.status === "Paused" ? "secondary" : "primary"}
                  onClick={() => toggleSourceStatus(channel.id)}
                  loading={isUpdating === channel.id}
                  aria-label={`${channel.status === "Paused" ? "Resume" : "Add"} ${channel.name}`}
                  className="shrink-0"
                >
                  {channel.status === "Paused" ? "Resume" : "Add"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  );
}
