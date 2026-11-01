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
  description: string;
  type: "Automatic" | "Manual" | "Sync Integration";
  category: "browser" | "docs" | "social" | "developer" | "ai";
  /** False for integrations that are planned but capture nothing yet. */
  available: boolean;
}

export const SOURCE_CATALOG: SourceCatalogItem[] = [
  {
    id: "webpages",
    name: "Web Pages",
    description: "Capture articles, documentation, and browser pages.",
    type: "Automatic",
    category: "browser",
    available: true,
  },
  {
    id: "youtube",
    name: "YouTube",
    description: "Extract transcripts from educational videos and webinars.",
    type: "Automatic",
    category: "browser",
    available: true,
  },
  {
    id: "pdf",
    name: "PDFs & Documents",
    description: "Upload research PDFs, eBooks, and text notes.",
    type: "Manual",
    category: "docs",
    available: true,
  },
  {
    id: "chatgpt",
    name: "AI Conversations",
    description: "Archive ChatGPT, Claude, and other AI chat histories.",
    type: "Automatic",
    category: "ai",
    available: false,
  },
  {
    id: "notion",
    name: "Notion",
    description: "Sync pages and databases from your Notion workspace.",
    type: "Sync Integration",
    category: "docs",
    available: false,
  },
  {
    id: "github",
    name: "GitHub",
    description: "Index READMEs, code snippets, and starred repositories.",
    type: "Sync Integration",
    category: "developer",
    available: false,
  },
  {
    id: "twitter",
    name: "Twitter / LinkedIn",
    description: "Save bookmarked threads and industry posts.",
    type: "Sync Integration",
    category: "social",
    available: false,
  },
  {
    id: "substack",
    name: "Substack / Medium",
    description: "Ingest newsletters and long-form articles.",
    type: "Automatic",
    category: "docs",
    available: false,
  },
];

export const AVAILABLE_SOURCE_IDS: ReadonlySet<SourceId> = new Set(
  SOURCE_CATALOG.filter((source) => source.available).map((source) => source.id),
);

export function isSourceAvailable(id: SourceId): boolean {
  return AVAILABLE_SOURCE_IDS.has(id);
}

export function statusToUiLabel(
  status: SourceStatus,
): "Active" | "Paused" | "Ready to Connect" {
  if (status === "active") return "Active";
  if (status === "paused") return "Paused";
  return "Ready to Connect";
}
