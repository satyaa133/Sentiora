import { API_BASE_URL, refreshAccessToken } from "./apiClient";
import { clearAuthStorage, getAccessToken } from "./authStorage";
import { AskApiError, type AskCitation, type AskRequest } from "./askService";

/** How the answer used the user's memory (POST /chat/stream `final.mode`). */
export type StreamMode = "memory" | "general" | "mixed";

/** A numbered source the answer may cite as [S1], [S2], ... */
export interface StreamSource extends AskCitation {
  id: string;
}

export interface StreamFinal {
  /** The cleaned full answer; replaces the streamed text. */
  answer: string;
  mode: StreamMode;
  usedSources: string[];
  followUps: string[];
  insufficient_context: boolean;
  used_fallback: boolean;
}

export interface AskStreamHandlers {
  onSources?: (sources: StreamSource[]) => void;
  onDelta?: (text: string) => void;
}

interface StreamEvent {
  name: string;
  data: Record<string, unknown>;
}

function parseEvent(block: string): StreamEvent | null {
  let name = "message";
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) name = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (!data.length) return null;
  try {
    return { name, data: JSON.parse(data.join("\n")) as Record<string, unknown> };
  } catch {
    return null;
  }
}

async function errorFrom(response: Response): Promise<AskApiError> {
  let code: string | undefined;
  let message = "Sentiora could not answer right now.";
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    code = body.error?.code;
    message = body.error?.message ?? message;
  } catch {
    // Not JSON (e.g. a proxy error page): keep the generic message.
  }
  return new AskApiError(message, response.status, code);
}

function post(payload: AskRequest, token: string | null, signal?: AbortSignal) {
  return fetch(`${API_BASE_URL}/api/v1/chat/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
    signal,
  });
}

/**
 * Ask a question and stream the answer (server-sent events over fetch, so the
 * Bearer token can be sent). Calls `onSources` once, `onDelta` per text piece,
 * and resolves with the `final` event. Rejects with AskApiError for HTTP and
 * stream errors, or with an AbortError when `signal` is aborted (Stop).
 */
export async function askStream(
  payload: AskRequest,
  handlers: AskStreamHandlers = {},
  signal?: AbortSignal,
): Promise<StreamFinal> {
  let response = await post(payload, getAccessToken(), signal);
  if (response.status === 401) {
    // Same single silent refresh as apiClient's interceptor.
    let token: string;
    try {
      token = await refreshAccessToken();
    } catch {
      clearAuthStorage();
      window.dispatchEvent(new Event("auth:logout"));
      throw new AskApiError("Your session expired. Please sign in again.", 401);
    }
    response = await post(payload, token, signal);
  }
  if (!response.ok) throw await errorFrom(response);
  if (!response.body) {
    throw new AskApiError("This browser cannot read streamed answers.", 0, "ASK_STREAM_UNSUPPORTED");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let final: StreamFinal | null = null;

  const handle = (event: StreamEvent) => {
    if (event.name === "sources") {
      handlers.onSources?.((event.data.sources as StreamSource[] | undefined) ?? []);
    } else if (event.name === "delta") {
      handlers.onDelta?.(String(event.data.text ?? ""));
    } else if (event.name === "final") {
      final = event.data as unknown as StreamFinal;
    } else if (event.name === "error") {
      const status = typeof event.data.status === "number" ? event.data.status : 502;
      throw new AskApiError(
        String(event.data.message ?? "The answer could not be completed."),
        status,
        typeof event.data.code === "string" ? event.data.code : undefined,
      );
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = done ? "" : (blocks.pop() ?? "");
    for (const block of blocks) {
      const event = parseEvent(block);
      if (event) handle(event);
    }
    if (done) break;
  }
  if (!final) {
    throw new AskApiError("The answer stream ended early.", 0, "ASK_STREAM_INTERRUPTED");
  }
  return final;
}
