export type SourceType = "webpage" | "pdf" | "youtube";

export type SourceFilter = "all" | SourceType;

/** Type-filter chips shared by Home and Timeline. */
export const SOURCE_FILTERS: Array<{ id: SourceFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "webpage", label: "Web" },
  { id: "pdf", label: "PDF" },
  { id: "youtube", label: "Video" },
];
export type ItemStatus = "pending" | "processing" | "ready" | "failed";

export type NodeType =
  | "heading"
  | "paragraph"
  | "list_item"
  | "code_block"
  | "table"
  | "blockquote";

export interface StructuredNode {
  id: string;
  type: NodeType;
  text: string;
  order: number;
  parent_id: string | null;
  metadata?: {
    level?: number;
    language?: string;
    page_number?: number;
    start_seconds?: number;
    end_seconds?: number;
    row_index?: number;
    col_index?: number;
    list_style?: "ordered" | "unordered";
  };
}

export type ExtractionMethod =
  | "readability"
  | "fallback_scraper"
  | "youtube_transcript"
  | "pdf_js";

export type ExtractionStatus =
  | "success"
  | "partial"
  | "failed"
  | "insufficient_content";

export interface ExtractionMetadata {
  method: ExtractionMethod;
  duration_ms: number;
  status: ExtractionStatus;
  quality_score: number;
  quality_reasons: string[];
}

export interface MemoryItem {
  id: string;
  user_id: string;
  source_type: SourceType;
  url: string;
  title: string;
  content: string | null;
  summary: string | null;
  author: string | null;
  favicon_url: string | null;
  thumbnail_url: string | null;
  domain: string | null;
  language: string | null;
  content_length: number;
  word_count: number;
  reading_time_seconds: number;
  status: ItemStatus;
  processing_error?: string | null;
  captured_at: string;
  created_at: string;
  /** Capture v2 structure; YouTube transcript nodes carry real start/end seconds. */
  structured_content?: StructuredContentNode[] | null;
}

export interface StructuredContentNode {
  id: string;
  type: string;
  text: string;
  order: number;
  metadata?: { start_seconds?: number | null; end_seconds?: number | null; page_number?: number | null } | null;
}

/** Server-side filters for GET /memory-items (all optional, user-scoped). */
export interface MemoryListFilters {
  source_type?: SourceType;
  status?: ItemStatus;
  /** ISO timestamp, inclusive. */
  date_from?: string;
  /** ISO timestamp, exclusive. */
  date_to?: string;
  /** Metadata match on title, domain and URL. */
  q?: string;
}

export interface MemoryItemListResponse {
  items: MemoryItem[];
  total: number;
  page: number;
  per_page: number;
  has_more: boolean;
}
