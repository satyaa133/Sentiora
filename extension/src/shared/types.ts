export type SourceType = "webpage" | "pdf" | "youtube";

// ──────────────────────────────────────────────
// Structured content types (Phase 2 — CapturePayloadV2)
// ──────────────────────────────────────────────

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
    level?: number;           // heading level (1–6)
    language?: string;        // code block language
    page_number?: number;     // PDF page number
    start_seconds?: number;   // YouTube transcript start
    end_seconds?: number;     // YouTube transcript end
    row_index?: number;       // table row
    col_index?: number;       // table column
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
  quality_score: number;          // 0.0 – 1.0
  quality_reasons: string[];
}

// ──────────────────────────────────────────────
// Capture payloads (v2)
// ──────────────────────────────────────────────

export interface WebpageCapturePayload {
  source_type: "webpage";
  url: string;
  title: string;
  content: string;
  author?: string;
  favicon_url?: string;
  thumbnail_url?: string;
  captured_at?: string;           // ISO-8601
  structured_content?: StructuredNode[];
  extraction?: ExtractionMetadata;
  is_force?: boolean;
}

export interface YoutubeCapturePayload {
  source_type: "youtube";
  url: string;
  title: string;
  content: string;
  author?: string;
  thumbnail_url?: string;
  captured_at?: string;
  structured_content?: StructuredNode[];
  extraction?: ExtractionMetadata;
  is_force?: boolean;
}

export interface PdfCapturePayload {
  source_type: "pdf";
  url: string;
  title: string;
  content: string;
  author?: string;
  captured_at?: string;
  structured_content?: StructuredNode[];
  extraction?: ExtractionMetadata;
  is_force?: boolean;
}

export type CapturePayload =
  | WebpageCapturePayload
  | YoutubeCapturePayload
  | PdfCapturePayload;

// ──────────────────────────────────────────────
// Extension messaging
// ──────────────────────────────────────────────

export interface AuthSyncPayload {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; is_email_verified: boolean };
}

export type ExtensionMessage =
  | { type: "CAPTURE_WEBPAGE"; payload: WebpageCapturePayload }
  | { type: "CAPTURE_YOUTUBE"; payload: YoutubeCapturePayload }
  | { type: "CAPTURE_PDF"; payload: PdfCapturePayload }
  | { type: "CAPTURE_RESULT"; success: boolean; error?: string }
  | { type: "SYNC_AUTH_TOKENS"; payload: AuthSyncPayload }
  | { type: "CLEAR_AUTH_TOKENS" }
  | { type: "FETCH_PDF_BYTES"; url: string };

export interface ExtensionState {
  readonly isReady: boolean;
}
