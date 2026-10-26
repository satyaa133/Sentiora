import { useState, useEffect, useRef, type FormEvent, type KeyboardEvent } from "react";
import {
  Button,
  Echo,
  IconArrowUp,
  IconCheck,
  IconCopy,
  IconExternalLink,
  cx,
  sourceKind,
} from "@shared/ui";
import type { MemoryItem } from "../../types/memory";
import {
  askSentiora,
  AskApiError,
  type AskCitation,
  type AskRequest,
} from "../../services/askService";
import { safeHref } from "../../utils/safeHref";

interface AskSentioraViewProps {
  items?: MemoryItem[];
  initialQuery?: string;
  focusMemoryId?: string;
  onClearInitialQuery?: () => void;
  /** Opens the memory drawer; returns false when the memory isn't loaded. */
  onOpenMemory?: (memoryId: string) => boolean;
}

interface Message {
  id: string;
  sender: "user" | "ai";
  text: string;
  citations?: AskCitation[];
  isNotFound?: boolean;
  isError?: boolean;
  usedFallback?: boolean;
}

export default function AskSentioraView({
  items = [],
  initialQuery,
  focusMemoryId,
  onClearInitialQuery,
  onOpenMemory,
}: AskSentioraViewProps) {
  const [input, setInput] = useState("");
  const [hasProcessedInitial, setHasProcessedInitial] = useState(false);

  const readyItems = items.filter(
    (item) =>
      item.status === "ready" && (item.word_count > 0 || Boolean(item.content?.trim())),
  );
  const isIndexing = items.some(
    (item) => item.status === "pending" || item.status === "processing",
  );

  const introText =
    readyItems.length > 0
      ? `Answers come only from your ${readyItems.length} saved ${readyItems.length === 1 ? "memory" : "memories"}, with the sources linked.`
      : isIndexing
        ? "Your latest saves are still being indexed. Ask again once they're ready."
        : "You haven't saved anything yet. Save a page with the extension, then ask about it here.";

  const [messages, setMessages] = useState<Message[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const firstTitle = readyItems[0]?.title || "";
  const secondTitle = readyItems[1]?.title || "";

  const clip = (title: string) =>
    title.length > 40 ? `${title.slice(0, 39).trimEnd()}…` : title;

  // Suggested questions built from real saved titles; none when nothing is saved.
  const suggestedPrompts = [
    firstTitle ? `What is “${clip(firstTitle)}” about?` : null,
    firstTitle ? `Summarize “${clip(firstTitle)}”` : null,
    secondTitle ? `Key points from “${clip(secondTitle)}”` : null,
  ].filter((prompt): prompt is string => Boolean(prompt));

  async function handleSendQuery(queryText: string) {
    if (!queryText.trim()) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      sender: "user",
      text: queryText,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsGenerating(true);

    if (items.length === 0) {
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          sender: "ai",
          text: "Your vault is empty. Capture a webpage, PDF, or YouTube video before asking Sentiora.",
          isNotFound: true,
        },
      ]);
      setIsGenerating(false);
      return;
    }

    if (readyItems.length === 0 && isIndexing) {
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          sender: "ai",
          text: "Your captures are still being indexed. Ask again once they show as Ready.",
          isNotFound: true,
        },
      ]);
      setIsGenerating(false);
      return;
    }

    try {
      const payload: AskRequest = { question: queryText.trim() };
      if (focusMemoryId) {
        payload.memory_id = focusMemoryId;
      }
      const result = await askSentiora(payload);
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          sender: "ai",
          text: result.answer,
          citations: result.citations,
          isNotFound: result.insufficient_context,
          usedFallback: Boolean(result.used_fallback),
        },
      ]);
    } catch (err) {
      let errorText =
        "Sentiora could not reach the server. Confirm the backend is running, then try again.";
      let isError = true;

      if (err instanceof AskApiError) {
        if (err.status === 401 || err.status === 403) {
          errorText =
            "Your session expired or you are not signed in. Please sign in again to ask questions.";
        } else if (err.status === 503 || err.code === "AI_NOT_CONFIGURED") {
          errorText =
            err.message ||
            "Sentiora AI is not configured, and no saved memory could be used to answer.";
        } else if (err.code === "ASK_LLM_FAILED") {
          errorText =
            err.message ||
            "The language model failed while answering. Your memories were found; try again in a moment.";
        } else if (err.code === "ASK_SYSTEM_FAILED" || err.status === 502) {
          errorText =
            err.message ||
            "The Sentiora server had a problem answering this question. This is not an AI configuration issue.";
        } else if (err.status >= 500) {
          errorText =
            err.message ||
            "The Sentiora server had a problem. This is not an AI configuration issue.";
        } else {
          errorText = err.message || errorText;
        }
      }

      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          sender: "ai",
          text: errorText,
          isError,
        },
      ]);
    } finally {
      setIsGenerating(false);
    }
  }

  useEffect(() => {
    if (initialQuery && !hasProcessedInitial && !isGenerating) {
      setHasProcessedInitial(true);
      setInput(initialQuery); // Just set the input instead of auto-sending to let user edit, or auto-send. The prompt says "pre-filled with the context query".
      if (onClearInitialQuery) {
        onClearInitialQuery();
      }
    }
  }, [initialQuery, hasProcessedInitial, isGenerating, onClearInitialQuery]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    handleSendQuery(input);
  }

  function handleCopy(id: string, text: string) {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!isGenerating) handleSendQuery(input);
    }
  }

  const messagesEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages, isGenerating]);

  const firstQuestion = messages.find((msg) => msg.sender === "user")?.text;
  const conversationTitle = firstQuestion
    ? firstQuestion.length > 60
      ? `${firstQuestion.slice(0, 59).trimEnd()}…`
      : firstQuestion
    : "Ask Sentiora";
  const latestCitations =
    [...messages].reverse().find((msg) => msg.sender === "ai" && msg.citations?.length)
      ?.citations ?? [];

  function citationMeta(citation: AskCitation) {
    const kind = sourceKind(citation.source_type);
    const label = kind === "video" ? "Video" : kind === "pdf" ? "PDF" : "Web";
    return [
      label,
      citation.domain,
      citation.page_number ? `p. ${citation.page_number}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  function originalHref(citation: AskCitation): string | undefined {
    if (citation.source_available === false || citation.url.startsWith("file:"))
      return undefined;
    return safeHref(citation.url);
  }

  function renderFormattedMessage(text: string) {
    const lines = text.split("\n");
    return (
      <div className="space-y-2 text-[17px] leading-relaxed text-fg">
        {lines.map((line, idx) => {
          if (!line.trim()) return null;

          if (line.startsWith("## ") || line.startsWith("### ")) {
            return (
              <h3 key={idx} className="pt-2 text-[17px] font-semibold text-fg">
                {formatInlineText(line.replace(/^#{2,3}\s+/, ""))}
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
                )}
              </li>
            );
          }

          return <p key={idx}>{formatInlineText(line)}</p>;
        })}
      </div>
    );
  }

  function formatInlineText(text: string) {
    const parts = text.split(/(\*\*.*?\*\*|`.*?`|\*.*?\*|\[\d+\])/g);
    return parts.map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return (
          <strong key={i} className="font-semibold">
            {part.slice(2, -2)}
          </strong>
        );
      }
      if (/^\[\d+\]$/.test(part)) {
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

  function renderSourceCard(citation: AskCitation, index: number) {
    const href = originalHref(citation);
    return (
      <li
        key={`${citation.chunk_id}-${index}`}
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
        {citation.heading ? (
          <p className="mt-2 rounded-btn bg-raised px-3 py-2 text-[15px] text-muted">
            {citation.heading}
          </p>
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
        </div>
      </li>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <section aria-labelledby="ask-title" className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center border-b border-line bg-surface px-4 sm:px-6">
          <h1 id="ask-title" className="truncate text-[18px] font-semibold text-fg">
            {conversationTitle}
          </h1>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[780px] space-y-8 px-4 py-8 sm:px-6">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center pt-6 text-center sm:pt-12">
                <Echo state={readyItems.length > 0 ? "idle" : "faded"} size={88} />
                <h2 className="mt-5 font-display text-[28px] font-bold tracking-tight text-fg">
                  Ask anything you&apos;ve saved
                </h2>
                <p className="mt-2 max-w-md text-[17px] text-muted">{introText}</p>
                {suggestedPrompts.length > 0 ? (
                  <ul className="mt-6 flex w-full max-w-lg flex-col gap-2">
                    {suggestedPrompts.map((prompt) => (
                      <li key={prompt}>
                        <button
                          type="button"
                          onClick={() => handleSendQuery(prompt)}
                          className="w-full rounded-card border border-line bg-surface px-4 py-3 text-left text-[16px] text-fg transition-colors hover:bg-raised"
                        >
                          {prompt}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
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
                <article
                  key={msg.id}
                  aria-label="Sentiora's answer"
                  className="flex gap-3"
                >
                  <Echo
                    state={msg.isError || msg.isNotFound ? "faded" : "happy"}
                    size={36}
                    still
                    className="mt-0.5 shrink-0"
                  />
                  <div className="min-w-0 flex-1 space-y-3">
                    {msg.usedFallback ? (
                      <p className="font-mono text-eyebrow uppercase text-muted">
                        From your saved memories, without the AI model
                      </p>
                    ) : null}
                    {msg.isError ? (
                      <p
                        role="alert"
                        className="rounded-btn bg-accent-soft px-4 py-3 text-[16px] text-accent-soft-fg"
                      >
                        {msg.text}
                      </p>
                    ) : msg.isNotFound ? (
                      <div className="text-muted [&_*]:text-muted">
                        {renderFormattedMessage(msg.text)}
                      </div>
                    ) : (
                      renderFormattedMessage(msg.text)
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
                Looking through your memories…
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="mx-auto w-full max-w-[780px] shrink-0 px-4 pb-4 pt-2 sm:px-6"
        >
          <div className="flex items-end gap-2 rounded-panel border border-line bg-surface p-2 pl-4 shadow-pop focus-within:border-accent">
            <label htmlFor="ask-input" className="sr-only">
              Your question
            </label>
            <textarea
              id="ask-input"
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder={
                messages.length > 0
                  ? "Ask a follow-up..."
                  : "Ask anything you've saved..."
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
          <p className="mt-2 text-center text-sm text-muted">
            Answers only use your saved memories.
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
            Sources for the latest answer show up here.
          </p>
        )}
      </aside>
    </div>
  );
}
