import { useState, useEffect, useRef, type FormEvent, type KeyboardEvent } from "react";
import {
  Button,
  Chip,
  Echo,
  IconArrowUp,
  IconCheck,
  IconClose,
  IconCopy,
  IconNote,
  IconExternalLink,
  IconPlus,
  IconRefresh,
  cx,
  sourceKind,
} from "@shared/ui";
import type { MemoryItem } from "../../types/memory";
import {
  askSentiora,
  AskApiError,
  type AnswerMode,
  type AskCitation,
  type AskLaunch,
  type AskRequest,
  type AskScope,
  type AskTurn,
} from "../../services/askService";
import { browserTimeZone } from "../../services/dashboardService";
import { safeHref } from "../../utils/safeHref";
import { emitEcho } from "../echo/echoEvents";
import { createMemoryItem } from "../../services/memoryService";
import { videoJumpUrl, videoStart } from "../../utils/videoJump";

interface AskSentioraViewProps {
  items?: MemoryItem[];
  /** A question and/or scope sent from another view ("Ask Echo about this"). */
  launch?: AskLaunch | null;
  /** Called once the launch has been copied into the view's own state. */
  onLaunchConsumed?: () => void;
  /** Opens the memory drawer; returns false when the memory isn't loaded. */
  onOpenMemory?: (memoryId: string) => boolean;
}

interface Message {
  id: string;
  sender: "user" | "ai";
  text: string;
  citations?: AskCitation[];
  mode?: AnswerMode;
  followups?: string[];
  isNotFound?: boolean;
  isError?: boolean;
  usedFallback?: boolean;
  /** The question to resend when an error answer offers Retry. */
  retryQuestion?: string;
}

const MEMORY_HEADING_RE = /^#{2,4}\s*From your saved memory\s*:?\s*$/im;
const HISTORY_TURNS = 4;

const MODE_LABELS: Record<AnswerMode, string> = {
  memory: "From your memory",
  general: "General knowledge · not from your saved memory",
  combined: "General knowledge and your saved memory",
};

let messageCounter = 0;
const nextId = () => `m${Date.now()}-${messageCounter++}`;

function clip(title: string, limit = 40) {
  return title.length > limit ? `${title.slice(0, limit - 1).trimEnd()}…` : title;
}

export default function AskSentioraView({
  items = [],
  launch,
  onLaunchConsumed,
  onOpenMemory,
}: AskSentioraViewProps) {
  const [input, setInput] = useState("");
  const [scope, setScope] = useState<AskScope | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isWriting, setIsWriting] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // Save as note (DESIGN.md §5.5): per answer, saving / saved / failed.
  const [noteState, setNoteState] = useState<
    Record<string, "saving" | "saved" | "failed">
  >({});
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Effects can run twice (StrictMode); act on each launch only once.
  const handledLaunchId = useRef<number | null>(null);

  const readyItems = items.filter(
    (item) =>
      item.status === "ready" && (item.word_count > 0 || Boolean(item.content?.trim())),
  );
  const isIndexing = items.some(
    (item) => item.status === "pending" || item.status === "processing",
  );

  const introText =
    readyItems.length > 0
      ? `Echo answers from your ${readyItems.length} saved ${readyItems.length === 1 ? "memory" : "memories"} and links the sources. General questions get a general answer, labelled as such.`
      : isIndexing
        ? "Your latest saves are still being indexed. Until then Echo can answer general questions."
        : "Nothing saved yet, so Echo answers general questions only. Save a page with the extension to ask about it here.";

  // Starters cover each answer mode, built from real saves where possible.
  const starters = [
    readyItems[0] ? `Summarize “${clip(readyItems[0].title)}”` : null,
    readyItems[1] ? `What are the key ideas in “${clip(readyItems[1].title)}”?` : null,
    items.length > 0 ? "What did I capture this week?" : null,
    "Explain recursion with a short example",
  ].filter((prompt): prompt is string => Boolean(prompt));

  // Copy a launch (question + scope) into local state, then release it, so the
  // scope survives until the user removes it.
  useEffect(() => {
    if (!launch || handledLaunchId.current === launch.id) return;
    handledLaunchId.current = launch.id;
    const nextScope = launch.scope !== undefined ? (launch.scope ?? null) : scope;
    setScope(nextScope);
    if (launch.question && launch.autoSend) {
      void handleSendQuery(launch.question, nextScope);
    } else if (launch.question) {
      setInput(launch.question);
    }
    inputRef.current?.focus();
    onLaunchConsumed?.();
    // Runs once per launch; handleSendQuery and scope are read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launch, onLaunchConsumed]);

  // Staged status while waiting: retrieval first, then generation.
  useEffect(() => {
    if (!isGenerating) {
      setIsWriting(false);
      return;
    }
    const timer = window.setTimeout(() => setIsWriting(true), 1500);
    return () => window.clearTimeout(timer);
  }, [isGenerating]);

  function historyFor(previous: Message[]): AskTurn[] {
    return previous
      .filter((msg) => !msg.isError)
      .slice(-HISTORY_TURNS)
      .map((msg) => ({
        role: msg.sender === "user" ? "user" : "assistant",
        content: msg.text.slice(0, 4000),
      }));
  }

  async function handleSendQuery(queryText: string, scopeOverride?: AskScope | null) {
    const question = queryText.trim();
    if (!question || isGenerating) return;
    const activeScope = scopeOverride !== undefined ? scopeOverride : scope;

    const history = historyFor(messages);
    setMessages((prev) => [...prev, { id: nextId(), sender: "user", text: question }]);
    setInput("");
    setIsGenerating(true);
    emitEcho({ type: "ask" });

    try {
      const payload: AskRequest = { question, tz: browserTimeZone() };
      if (history.length > 0) payload.history = history;
      if (activeScope?.memoryId) payload.memory_id = activeScope.memoryId;
      if (activeScope?.sourceType) payload.source_type = activeScope.sourceType;
      const result = await askSentiora(payload);
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          sender: "ai",
          text: result.answer,
          citations: result.citations,
          mode: result.mode ?? "memory",
          followups: result.suggested_followups ?? [],
          isNotFound: result.insufficient_context,
          usedFallback: Boolean(result.used_fallback),
        },
      ]);
      emitEcho({
        type: "answer",
        status: result.insufficient_context ? "not_found" : "ready",
        cited: (result.citations?.length ?? 0) > 0,
      });
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          sender: "ai",
          text: errorMessage(err),
          isError: true,
          retryQuestion: question,
        },
      ]);
      emitEcho({ type: "answer", status: "error", cited: false });
    } finally {
      setIsGenerating(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void handleSendQuery(input);
  }

  /**
   * Keep an answer as a note memory, the same way the extension saves notes:
   * POST /memory-items with a sentiora.app/notes URL. The question, the answer
   * and its sources become the note's text.
   */
  async function handleSaveNote(message: Message) {
    if (noteState[message.id] === "saving" || noteState[message.id] === "saved") return;
    const index = messages.findIndex((msg) => msg.id === message.id);
    const question =
      [...messages.slice(0, index)].reverse().find((msg) => msg.sender === "user")
        ?.text ?? "";
    const sources = (message.citations ?? []).map(
      (citation, i) => `[${i + 1}] ${citation.title} (${citation.url})`,
    );
    setNoteState((prev) => ({ ...prev, [message.id]: "saving" }));
    try {
      await createMemoryItem({
        source_type: "webpage",
        title: clip(`Note: ${question || "Ask Sentiora answer"}`, 120),
        url: `https://sentiora.app/notes/${Date.now()}`,
        content: [
          question && `Q: ${question}`,
          message.text,
          sources.length ? `Sources:\n${sources.join("\n")}` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      });
      setNoteState((prev) => ({ ...prev, [message.id]: "saved" }));
    } catch {
      setNoteState((prev) => ({ ...prev, [message.id]: "failed" }));
    }
  }

  function handleCopy(id: string, text: string) {
    void navigator.clipboard?.writeText(text);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId(null), 2000);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSendQuery(input);
    }
  }

  function startNewChat() {
    setMessages([]);
    setScope(null);
    setInput("");
    inputRef.current?.focus();
  }

  const messagesEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages, isGenerating]);

  const firstQuestion = messages.find((msg) => msg.sender === "user")?.text;
  const conversationTitle = firstQuestion ? clip(firstQuestion, 60) : "Ask Sentiora";
  const latestCitations =
    [...messages].reverse().find((msg) => msg.sender === "ai" && msg.citations?.length)
      ?.citations ?? [];
  const lastAiId = [...messages].reverse().find((msg) => msg.sender === "ai")?.id;

  function citationMeta(citation: AskCitation) {
    const kind = sourceKind(citation.source_type);
    const label = kind === "video" ? "Video" : kind === "pdf" ? "PDF" : "Web";
    const saved = citation.captured_at
      ? new Date(citation.captured_at).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        })
      : null;
    return [
      label,
      citation.domain,
      citation.page_number ? `p. ${citation.page_number}` : null,
      saved,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  function originalHref(citation: AskCitation): string | undefined {
    if (citation.source_available === false || citation.url.startsWith("file:"))
      return undefined;
    return safeHref(citation.url);
  }

  function renderFormattedMessage(text: string, withCitations: boolean) {
    const lines = text.split("\n");
    return (
      <div className="space-y-2 text-[17px] leading-relaxed text-fg">
        {lines.map((line, idx) => {
          if (!line.trim() || /^-{3,}$/.test(line.trim())) return null;

          if (/^#{1,4}\s+/.test(line)) {
            return (
              <h3 key={idx} className="pt-2 text-[17px] font-semibold text-fg">
                {formatInlineText(line.replace(/^#{1,4}\s+/, ""), withCitations)}
              </h3>
            );
          }

          if (
            /^\d+\.\s+/.test(line) ||
            line.startsWith("• ") ||
            line.startsWith("- ")
          ) {
            return (
              <li key={idx} className="ml-5 list-disc">
                {formatInlineText(
                  line.replace(/^\d+\.\s+/, "").replace(/^[•-]\s*/, ""),
                  withCitations,
                )}
              </li>
            );
          }

          return <p key={idx}>{formatInlineText(line, withCitations)}</p>;
        })}
      </div>
    );
  }

  function formatInlineText(text: string, withCitations: boolean) {
    const parts = text.split(/(\*\*.*?\*\*|`.*?`|\*.*?\*|\[\d+\])/g);
    return parts.map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return (
          <strong key={i} className="font-semibold">
            {part.slice(2, -2)}
          </strong>
        );
      }
      // Citation pills only where real citations exist; elsewhere "[1]" is text.
      if (withCitations && /^\[\d+\]$/.test(part)) {
        return (
          <span
            key={i}
            className="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded bg-accent-soft px-1 align-[2px] font-mono text-xs font-semibold text-accent-soft-fg"
          >
            <span className="sr-only">source </span>
            {part.slice(1, -1)}
          </span>
        );
      }
      if (part.startsWith("*") && part.endsWith("*") && !part.startsWith("**")) {
        return <em key={i}>{part.slice(1, -1)}</em>;
      }
      if (part.startsWith("`") && part.endsWith("`")) {
        return (
          <code
            key={i}
            className="rounded bg-raised px-1.5 py-0.5 font-mono text-[15px]"
          >
            {part.slice(1, -1)}
          </code>
        );
      }
      return part;
    });
  }

  /** Combined answers: general explanation, then a visibly separate memory part. */
  function renderAnswer(msg: Message) {
    const withCitations = Boolean(msg.citations?.length);
    const match = MEMORY_HEADING_RE.exec(msg.text);
    if (!match) return renderFormattedMessage(msg.text, withCitations);
    const general = msg.text.slice(0, match.index);
    const memory = msg.text.slice(match.index + match[0].length);
    return (
      <div className="space-y-4">
        {general.trim() ? renderFormattedMessage(general, false) : null}
        <section
          aria-label="From your saved memory"
          className="rounded-btn border-l-4 border-accent bg-raised px-4 py-3"
        >
          <h3 className="font-mono text-eyebrow uppercase text-muted">
            From your saved memory
          </h3>
          <div className="mt-2">{renderFormattedMessage(memory, withCitations)}</div>
        </section>
      </div>
    );
  }

  function renderSourceCard(citation: AskCitation, index: number) {
    const href = originalHref(citation);
    const start = videoStart(citation.heading);
    const jumpHref = href && start ? videoJumpUrl(href, start.seconds) : null;
    return (
      <li
        key={`${citation.memory_id}-${index}`}
        className="rounded-card border border-line bg-surface p-4"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-accent px-1.5 font-mono text-xs font-semibold text-on-accent">
            {index + 1}
          </span>
          <span className="truncate font-mono text-xs text-muted">
            {citationMeta(citation)}
          </span>
        </div>
        <p className="mt-2 font-semibold leading-snug text-fg">{citation.title}</p>
        {citation.heading && citation.heading !== citation.title ? (
          <p className="mt-2 rounded-btn bg-raised px-3 py-2 text-[15px] text-muted">
            {citation.heading}
          </p>
        ) : citation.excerpt ? (
          <p className="mt-2 line-clamp-3 text-[15px] text-muted">{citation.excerpt}</p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
          {onOpenMemory ? (
            <button
              type="button"
              onClick={() => {
                if (!onOpenMemory(citation.memory_id) && href)
                  window.open(href, "_blank", "noopener");
              }}
              className="inline-flex min-h-touch items-center text-[15px] font-semibold text-link hover:underline"
            >
              Open memory
            </button>
          ) : null}
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-touch items-center gap-1 text-[15px] text-muted hover:text-fg hover:underline"
            >
              Original
              <IconExternalLink size={14} />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          ) : (
            <span className="inline-flex min-h-touch items-center text-[15px] text-muted">
              Original unavailable
            </span>
          )}
          {jumpHref && start ? (
            <a
              href={jumpHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-touch items-center gap-1 text-[15px] font-semibold text-link hover:underline"
            >
              Jump to {start.label}
              <span className="sr-only">(opens the video in a new tab)</span>
            </a>
          ) : null}
        </div>
      </li>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <section aria-labelledby="ask-title" className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line bg-surface px-4 sm:px-6">
          <Echo state="idle" size={32} still className="shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-mono text-eyebrow uppercase text-muted">Echo</p>
            <h1
              id="ask-title"
              className="truncate text-[17px] font-semibold leading-tight text-fg"
            >
              {conversationTitle}
            </h1>
          </div>
          {messages.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={<IconPlus size={16} />}
              onClick={startNewChat}
            >
              New chat
            </Button>
          ) : null}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[780px] space-y-8 px-4 py-8 sm:px-6">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center pt-6 text-center sm:pt-12">
                <Echo state={readyItems.length > 0 ? "idle" : "faded"} size={88} />
                <h2 className="mt-5 font-display text-[28px] font-bold tracking-tight text-fg">
                  Ask Echo
                </h2>
                <p className="mt-2 max-w-md text-[17px] text-muted">{introText}</p>
                <ul
                  aria-label="Suggested questions"
                  className="mt-6 flex w-full max-w-lg flex-col gap-2"
                >
                  {starters.map((prompt) => (
                    <li key={prompt}>
                      <button
                        type="button"
                        onClick={() => void handleSendQuery(prompt)}
                        className="w-full rounded-card border border-line bg-surface px-4 py-3 text-left text-[16px] text-fg transition-colors hover:bg-raised"
                      >
                        {prompt}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {messages.map((msg) =>
              msg.sender === "user" ? (
                <div key={msg.id} className="flex justify-end">
                  <p className="max-w-[85%] whitespace-pre-wrap rounded-card border border-inverse-border bg-inverse px-4 py-3 text-[16px] text-on-inverse">
                    {msg.text}
                  </p>
                </div>
              ) : (
                <article key={msg.id} aria-label="Echo's answer" className="flex gap-3">
                  <Echo
                    state={msg.isError || msg.isNotFound ? "faded" : "happy"}
                    size={36}
                    still
                    className="mt-0.5 shrink-0"
                  />
                  <div className="min-w-0 flex-1 space-y-3">
                    {msg.isError ? null : (
                      <p className="font-mono text-eyebrow uppercase text-muted">
                        {msg.usedFallback
                          ? "From your saved memories, without the AI model"
                          : msg.isNotFound
                            ? "Not found in your saved memory"
                            : MODE_LABELS[msg.mode ?? "memory"]}
                      </p>
                    )}
                    {msg.isError ? (
                      <div
                        role="alert"
                        className="space-y-3 rounded-btn bg-accent-soft px-4 py-3"
                      >
                        <p className="text-[16px] text-accent-soft-fg">{msg.text}</p>
                        {msg.retryQuestion ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            leadingIcon={<IconRefresh size={16} />}
                            disabled={isGenerating}
                            onClick={() =>
                              void handleSendQuery(msg.retryQuestion ?? "")
                            }
                          >
                            Try again
                          </Button>
                        ) : null}
                      </div>
                    ) : msg.isNotFound ? (
                      <div className="text-muted [&_*]:text-muted">
                        {renderFormattedMessage(
                          msg.text,
                          Boolean(msg.citations?.length),
                        )}
                      </div>
                    ) : (
                      renderAnswer(msg)
                    )}

                    {msg.citations && msg.citations.length > 0 ? (
                      <ol aria-label="Sources" className="space-y-3 xl:hidden">
                        {msg.citations.map((citation, index) =>
                          renderSourceCard(citation, index),
                        )}
                      </ol>
                    ) : null}

                    {!msg.isError ? (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          leadingIcon={
                            copiedId === msg.id ? (
                              <IconCheck size={16} />
                            ) : (
                              <IconCopy size={16} />
                            )
                          }
                          onClick={() => handleCopy(msg.id, msg.text)}
                        >
                          {copiedId === msg.id ? "Copied" : "Copy answer"}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          leadingIcon={
                            noteState[msg.id] === "saved" ? (
                              <IconCheck size={16} />
                            ) : (
                              <IconNote size={16} />
                            )
                          }
                          loading={noteState[msg.id] === "saving"}
                          disabled={noteState[msg.id] === "saved"}
                          onClick={() => void handleSaveNote(msg)}
                        >
                          {noteState[msg.id] === "saved"
                            ? "Saved as note"
                            : "Save as note"}
                        </Button>
                        {noteState[msg.id] === "failed" ? (
                          <p role="alert" className="w-full text-[15px] text-link">
                            Could not save this note. Try again.
                          </p>
                        ) : null}
                      </div>
                    ) : null}

                    {msg.id === lastAiId && !isGenerating && msg.followups?.length ? (
                      <div
                        role="group"
                        aria-label="Follow-up questions"
                        className="flex flex-wrap gap-2"
                      >
                        {msg.followups.map((followup) => (
                          <Chip
                            key={followup}
                            onClick={() => void handleSendQuery(followup)}
                          >
                            {followup}
                          </Chip>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </article>
              ),
            )}

            {isGenerating && (
              <div
                role="status"
                className="flex items-center gap-3 text-[16px] text-muted"
              >
                <Echo state="saving" size={36} still />
                {isWriting ? "Writing the answer…" : "Looking through your memories…"}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        <form
          data-echo-dock=""
          onSubmit={handleSubmit}
          className="mx-auto w-full max-w-[780px] shrink-0 px-4 pb-4 pt-2 sm:px-6"
        >
          {scope ? (
            <div className="mb-2 flex items-center gap-2 text-[15px] text-muted">
              <span>Asking about</span>
              <span className="inline-flex max-w-[70%] items-center gap-1 rounded-full border border-line bg-surface py-1 pl-3 pr-1 text-fg">
                <span className="truncate">{scope.label}</span>
                <button
                  type="button"
                  onClick={() => setScope(null)}
                  aria-label={`Stop limiting answers to ${scope.label}`}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-raised hover:text-fg"
                >
                  <IconClose size={14} />
                </button>
              </span>
            </div>
          ) : null}
          <div className="flex items-end gap-2 rounded-panel border border-line bg-surface p-2 pl-4 shadow-pop focus-within:border-accent">
            <label htmlFor="ask-input" className="sr-only">
              Your question
            </label>
            <textarea
              id="ask-input"
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder={
                messages.length > 0 ? "Ask a follow-up..." : "Ask Echo anything..."
              }
              className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent py-2.5 text-[17px] text-fg placeholder:text-muted focus:outline-none"
            />
            <button
              type="submit"
              aria-label="Send question"
              disabled={!input.trim() || isGenerating}
              className={cx(
                "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-btn bg-accent text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              <IconArrowUp size={20} />
            </button>
          </div>
          <p className="mt-2 text-center text-[15px] text-muted">
            Memory answers cite your saves. General answers are labelled as general
            knowledge.
          </p>
        </form>
      </section>

      <aside
        aria-labelledby="sources-used"
        className="hidden w-[340px] shrink-0 overflow-y-auto border-l border-line bg-surface p-5 xl:block"
      >
        <h2 id="sources-used" className="text-[18px] font-semibold text-fg">
          Sources used
        </h2>
        {latestCitations.length > 0 ? (
          <ol className="mt-4 space-y-3 [&>li]:bg-bg">
            {latestCitations.map((citation, index) =>
              renderSourceCard(citation, index),
            )}
          </ol>
        ) : (
          <p className="mt-2 text-[15px] text-muted">
            Sources for the latest memory answer show up here.
          </p>
        )}
      </aside>
    </div>
  );
}

function errorMessage(err: unknown): string {
  if (!(err instanceof AskApiError)) {
    return "Echo could not reach the server. Confirm the backend is running, then try again.";
  }
  if (err.status === 401 || err.status === 403) {
    return "Your session expired or you are not signed in. Please sign in again to ask questions.";
  }
  if (err.status === 429) {
    return "You're asking faster than the limit allows. Wait a moment, then try again.";
  }
  if (err.status === 503 || err.code === "AI_NOT_CONFIGURED") {
    return (
      err.message ||
      "Sentiora AI is not configured, and no saved memory could be used to answer."
    );
  }
  if (err.code === "ASK_LLM_FAILED") {
    return (
      err.message || "The language model failed while answering. Try again in a moment."
    );
  }
  if (err.code === "ASK_SYSTEM_FAILED" || err.status === 502) {
    return err.message || "The Sentiora server had a problem answering this question.";
  }
  if (err.status >= 500) {
    return err.message || "The Sentiora server had a problem.";
  }
  return err.message || "Echo could not answer right now.";
}
