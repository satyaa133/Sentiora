import type { AskScope } from "../../../services/askService";
import type { StreamMode, StreamSource } from "../../../services/askStream";

export interface UserMessage {
  id: string;
  sender: "user";
  text: string;
}

export type AnswerStatus = "pending" | "streaming" | "done" | "stopped" | "error";

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
}

export type ChatMessage = UserMessage | AiMessage;

export type OpenMemory = (memoryId: string) => boolean;

/** Sources the answer used, in [S#] order; falls back to every source for memory answers. */
export function usedSourceList(message: AiMessage): StreamSource[] {
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
export function plainAnswer(message: AiMessage): string {
  const text = message.text.replace(/\[S(\d+)\]/g, "[$1]");
  const sources = usedSourceList(message).map(
    (source) => `[${sourceNumber(source.id)}] ${source.title} (${source.url})`,
  );
  return sources.length ? `${text}\n\nSources:\n${sources.join("\n")}` : text;
}
