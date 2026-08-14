export type SourceType = "webpage" | "pdf" | "youtube";

export interface WebpageCapturePayload {
  source_type: "webpage";
  url: string;
  title: string;
  content: string;
  author?: string;
  favicon_url?: string;
  thumbnail_url?: string;
  is_force?: boolean;
}

export interface YoutubeCapturePayload {
  source_type: "youtube";
  url: string;
  title: string;
  content: string;
  author?: string;
  thumbnail_url?: string;
  is_force?: boolean;
}

export interface PdfCapturePayload {
  source_type: "pdf";
  url: string;
  title: string;
  content: string;
  author?: string;
  is_force?: boolean;
}

export type CapturePayload = WebpageCapturePayload | YoutubeCapturePayload | PdfCapturePayload;

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
  | { type: "CLEAR_AUTH_TOKENS" };

export interface ExtensionState {
  readonly isReady: boolean;
}
