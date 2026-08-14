export type SourceId =
  | "webpages"
  | "youtube"
  | "pdf"
  | "chatgpt"
  | "notion"
  | "github"
  | "twitter"
  | "substack";

export type SourceStatus = "active" | "paused" | "not_connected";

export type SourcePreferencesMap = Record<SourceId, SourceStatus>;

export interface SourcePreferencesResponse {
  sources: SourcePreferencesMap;
  onboarding_completed: boolean;
}

export interface SourceCatalogItem {
  id: SourceId;
  name: string;
  icon: string;
  description: string;
  type: "Automatic" | "Manual" | "Sync Integration";
  category: "browser" | "docs" | "social" | "developer" | "ai";
}

export const SOURCE_CATALOG: SourceCatalogItem[] = [
  {
    id: "webpages",
    name: "Web Pages",
    icon: "🌐",
    description: "Capture articles, documentation, and browser pages.",
    type: "Automatic",
    category: "browser",
  },
  {
    id: "youtube",
    name: "YouTube",
    icon: "🎬",
    description: "Extract transcripts from educational videos and webinars.",
    type: "Automatic",
    category: "browser",
  },
  {
    id: "pdf",
    name: "PDFs & Documents",
    icon: "📄",
    description: "Upload research PDFs, eBooks, and text notes.",
    type: "Manual",
    category: "docs",
  },
  {
    id: "chatgpt",
    name: "AI Conversations",
    icon: "💬",
    description: "Archive ChatGPT, Claude, and other AI chat histories.",
    type: "Automatic",
    category: "ai",
  },
  {
    id: "notion",
    name: "Notion",
    icon: "📝",
    description: "Sync pages and databases from your Notion workspace.",
    type: "Sync Integration",
    category: "docs",
  },
  {
    id: "github",
    name: "GitHub",
    icon: "🐙",
    description: "Index READMEs, code snippets, and starred repositories.",
    type: "Sync Integration",
    category: "developer",
  },
  {
    id: "twitter",
    name: "Twitter / LinkedIn",
    icon: "🦤",
    description: "Save bookmarked threads and industry posts.",
    type: "Sync Integration",
    category: "social",
  },
  {
    id: "substack",
    name: "Substack / Medium",
    icon: "📬",
    description: "Ingest newsletters and long-form articles.",
    type: "Automatic",
    category: "docs",
  },
];

export const ALL_SOURCE_IDS = SOURCE_CATALOG.map((source) => source.id);

export function statusToUiLabel(status: SourceStatus): "Active" | "Paused" | "Ready to Connect" {
  if (status === "active") return "Active";
  if (status === "paused") return "Paused";
  return "Ready to Connect";
}
