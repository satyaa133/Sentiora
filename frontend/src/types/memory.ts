export type SourceType = "webpage" | "pdf" | "youtube";
export type ItemStatus = "pending" | "processing" | "ready" | "failed";

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
  captured_at: string;
  created_at: string;
}

export interface MemoryItemListResponse {
  items: MemoryItem[];
  total: number;
  page: number;
  per_page: number;
  has_more: boolean;
}
