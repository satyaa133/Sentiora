import type { AskScope } from "../../../services/askService";
import type { StreamMode, StreamSource } from "../../../services/askStream";

export interface UserMessage {
  id: string;
  sender: "user";
  text: string;
}

export type AnswerStatus = "pending" | "streaming" | "done" | "stopped" | "error";

/** The "Explain with AI" answer written under an instant answer (S7). */
export interface Explanation {
  /** "busy": every AI slot was taken (AI_BUSY); retry after `retryAfter` s. */
  status: AnswerStatus | "busy";
  text: string;
  sources: StreamSource[];
  usedSources: string[];
  mode?: StreamMode;
  followups: string[];
  error?: string;
  retryAfter?: number;
}

export interface AiMessage {
  id: string;
  sender: "ai";
  status: AnswerStatus;
  /** Markdown with [S#] citation markers. */
  text: string;
  sources: StreamSource[];
  usedSources: string[];
  mode?: StreamMode;
  followups: string[];
  insufficient: boolean;
  usedFallback: boolean;
  /** Shown instead of the answer when status is "error". */
  error?: string;
  /** The question this answers, for Retry and Regenerate. */
  question: string;
  scope?: AskScope | null;
  /** Explain with AI can add to this answer (final.aiAvailable). */
  aiAvailable?: boolean;
  /** The AI answer, once asked for; kept in history with the instant one. */
  explain?: Explanation;
}

export type ChatMessage = UserMessage | AiMessage;

export type OpenMemory = (memoryId: string) => boolean;

/** Sources the answer used, in [S#] order. */
export function usedSourceList(message: Pick<AiMessage, "sources" | "usedSources">): StreamSource[] {
  const byId = new Map(message.sources.map((source) => [source.id, source]));
  const used = message.usedSources
    .map((id) => byId.get(id))
    .filter((source): source is StreamSource => Boolean(source));
  return used.sort((a, b) => sourceNumber(a.id) - sourceNumber(b.id));
}

export function sourceNumber(id: string): number {
  return Number(id.replace(/^S/, "")) || 0;
}

/** Answer text with [S#] markers as [#], plus a numbered source list, for copy / notes. */
export function plainAnswer(message: Pick<AiMessage, "text" | "sources" | "usedSources">): string {
  const text = message.text.replace(/\[S(\d+)\]/g, "[$1]");
  const sources = usedSourceList(message).map(
    (source) => `[${sourceNumber(source.id)}] ${source.title} (${source.url})`,
  );
  return sources.length ? `${text}\n\nSources:\n${sources.join("\n")}` : text;
}

/** Compare and contrast questions read better as a written answer (S7). */
export function suitsAiAnswer(question: string): boolean {
  return /\b(compare|comparison|contrast|differences?|differ|versus|vs\.?|better than|pros and cons)\b/i.test(
    question,
  );
}
