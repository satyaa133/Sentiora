import apiClient, { type APIEnvelope } from "./apiClient";
import type { SourceType } from "../types/memory";

export interface AskCitation {
  memory_id: string;
  /** Null when the citation points at a whole capture (e.g. "what did I save today"). */
  chunk_id: string | null;
  title: string;
  url: string;
  source_type: SourceType;
  domain: string | null;
  heading: string | null;
  page_number: number | null;
  source_available?: boolean;
  captured_at?: string | null;
  excerpt?: string | null;
}

/**
 * memory: grounded in saved memory only. general: general knowledge, no memory
 * used. combined: a general explanation plus a cited "From your saved memory" part.
 */
export type AnswerMode = "memory" | "general" | "combined";

export interface AskResponse {
  answer: string;
  citations: AskCitation[];
  insufficient_context: boolean;
  used_fallback?: boolean;
  mode?: AnswerMode;
  suggested_followups?: string[];
}

export interface AskTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AskRequest {
  question: string;
  source_type?: SourceType;
  memory_id?: string;
  top_k?: number;
  /** Up to 4 earlier turns so follow-ups keep their context. */
  history?: AskTurn[];
  /** IANA time zone for "today" / "yesterday" questions. */
  tz?: string;
}

/** What Ask is limited to: one saved memory, or one source type. */
export interface AskScope {
  memoryId?: string;
  sourceType?: SourceType;
  label: string;
}

/** A request from another view to open Ask with a question and/or scope. */
export interface AskLaunch {
  id: number;
  question?: string;
  scope?: AskScope;
  /** Send the question right away instead of only pre-filling it. */
  autoSend?: boolean;
}

/** Error thrown when the API returns a non-2xx status. Carries the HTTP status code. */
export class AskApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "AskApiError";
  }
}

export async function askSentiora(payload: AskRequest): Promise<AskResponse> {
  try {
    const resp = await apiClient.post<APIEnvelope<AskResponse>>("/chat", payload);
    return resp.data.data;
  } catch (err: unknown) {
    // Axios wraps HTTP errors — extract status and API error code for the UI.
    if (
      err &&
      typeof err === "object" &&
      "response" in err &&
      err.response &&
      typeof err.response === "object"
    ) {
      const response = err.response as {
        status: number;
        data?: { error?: { code?: string; message?: string } };
      };
      const status = response.status ?? 0;
      const apiError = response.data?.error;
      const code = apiError?.code;
      const message =
        apiError?.message ?? "Sentiora could not answer right now.";
      throw new AskApiError(message, status, code);
    }
    throw err;
  }
}
