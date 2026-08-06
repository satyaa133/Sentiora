export type SourceType = "webpage" | "pdf" | "youtube";

export interface WebpageCapturePayload {
  source_type: "webpage";
  url: string;
  title: string;
  content: string;
  author?: string;
  favicon_url?: string;
  thumbnail_url?: string;
}

export interface YoutubeCapturePayload {
  source_type: "youtube";
  url: string;
  title: string;
  content: string;
  author?: string;
  thumbnail_url?: string;
}

export interface PdfCapturePayload {
  source_type: "pdf";
  url: string;
  title: string;
  content: string;
  author?: string;
}

export type CapturePayload = WebpageCapturePayload | YoutubeCapturePayload | PdfCapturePayload;

export type ExtensionMessage =
  | { type: "CAPTURE_WEBPAGE"; payload: WebpageCapturePayload }
  | { type: "CAPTURE_YOUTUBE"; payload: YoutubeCapturePayload }
  | { type: "CAPTURE_PDF"; payload: PdfCapturePayload }
  | { type: "CAPTURE_RESULT"; success: boolean; error?: string };

export interface ExtensionState {
  readonly isReady: boolean;
}
