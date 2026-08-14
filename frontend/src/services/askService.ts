import apiClient from "./apiClient";
import type { SourceType } from "../types/memory";

interface APIEnvelope<T> {
  success: boolean;
  data: T;
}

export interface AskCitation {
  memory_id: string;
  chunk_id: string;
  title: string;
  url: string;
  source_type: SourceType;
  domain: string | null;
  heading: string | null;
  page_number: number | null;
}

export interface AskResponse {
  answer: string;
  citations: AskCitation[];
  insufficient_context: boolean;
}

export interface AskRequest {
  question: string;
  source_type?: SourceType;
  memory_id?: string;
  top_k?: number;
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
        apiError?.message ?? "Sentiora AI could not answer right now.";
      throw new AskApiError(message, status, code);
    }
    throw err;
  }
}
