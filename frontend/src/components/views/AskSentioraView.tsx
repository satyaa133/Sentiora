import { useState, useEffect, type FormEvent } from "react";
import type { MemoryItem } from "../../types/memory";
import { askSentiora, AskApiError, type AskCitation, type AskRequest } from "../../services/askService";


interface AskSentioraViewProps {
  items?: MemoryItem[];
  initialQuery?: string;
  focusMemoryId?: string;
  onClearInitialQuery?: () => void;
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
}: AskSentioraViewProps) {
  const [input, setInput] = useState("");
  const [hasProcessedInitial, setHasProcessedInitial] = useState(false);

  const readyItems = items.filter((item) => item.status === "ready");
  const isIndexing = items.some((item) => item.status === "pending" || item.status === "processing");

  const initialWelcomeText = readyItems.length > 0
    ? `Hello! I am **Sentiora AI**. I can synthesize answers strictly based on your **${readyItems.length} saved memory source${readyItems.length > 1 ? "s" : ""}**:\n\n${readyItems.slice(0, 3).map((i) => `• **"${i.title}"**`).join("\n")}\n\nAsk me anything about your saved archive!`
    : isIndexing
      ? "Hello! I am **Sentiora AI**. Your latest captures are still being indexed. Ask again once they show as Ready."
      : "Hello! I am **Sentiora AI**. You currently have no saved memories in your vault. Connect browser sources or save pages to enable AI Q&A.";

  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      sender: "ai",
      text: initialWelcomeText,
    },
  ]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const firstTitle = readyItems[0]?.title || "";
  const secondTitle = readyItems[1]?.title || "";

  // Dynamic suggested prompt chips from real items
  const suggestedPrompts = readyItems.length > 0 && firstTitle
    ? [
        `What is "${firstTitle.length > 22 ? firstTitle.slice(0, 22) + "..." : firstTitle}" about?`,
        `Summarize "${firstTitle.length > 22 ? firstTitle.slice(0, 22) + "..." : firstTitle}"`,
        secondTitle
          ? `Key details from "${secondTitle.length > 22 ? secondTitle.slice(0, 22) + "..." : secondTitle}"`
          : `What design & topic details are saved?`,
      ]
    : [
        "What web sources can I capture?",
        "How does Sentiora memory vault work?",
        "How to save YouTube transcripts?",
      ];

  const dynamicPlaceholder = readyItems.length > 0 && firstTitle
    ? `Ask about "${firstTitle.length > 22 ? firstTitle.slice(0, 22) + "..." : firstTitle}" or your ${readyItems.length} saved source${readyItems.length > 1 ? "s" : ""}...`
    : "Ask a question about your saved articles, notes, or YouTube transcripts...";

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

  function renderFormattedMessage(text: string) {
    const lines = text.split("\n");
    return (
      <div className="space-y-1.5 leading-relaxed text-xs">
        {lines.map((line, idx) => {
          if (!line.trim()) return <div key={idx} className="h-1" />;

          if (line.startsWith("### ")) {
            return (
              <h4 key={idx} className="font-serif font-bold text-xs sm:text-sm text-ink-900 mt-2 mb-1">
                {formatInlineText(line.replace("### ", ""))}
              </h4>
            );
          }

          if (line.startsWith("• ") || line.startsWith("- ")) {
            return (
              <li key={idx} className="ml-4 list-disc text-ink-800">
                {formatInlineText(line.replace(/^[•-]\s*/, ""))}
              </li>
            );
          }

          return (
            <p key={idx} className="text-ink-800">
              {formatInlineText(line)}
            </p>
          );
        })}
      </div>
    );
  }

  function formatInlineText(text: string) {
    const parts = text.split(/(\*\*.*?\*\*|`.*?`|\*.*?\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={i} className="font-bold text-ink-900">{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith("*") && part.endsWith("*") && !part.startsWith("**")) {
        return <em key={i} className="italic text-ink-600">{part.slice(1, -1)}</em>;
      }
      if (part.startsWith("`") && part.endsWith("`")) {
        return (
          <code key={i} className="px-1.5 py-0.5 rounded bg-parchment-100 font-mono text-[11px] text-moss-700 font-semibold border border-parchment-200/60">
            {part.slice(1, -1)}
          </code>
        );
      }
      return part;
    });
  }

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] max-w-4xl bg-white/85 backdrop-blur-md border border-parchment-200/80 rounded-2xl shadow-xl overflow-hidden font-sans">
      {/* Header */}
      <div className="p-4 border-b border-parchment-200/80 bg-parchment-50/90 backdrop-blur-md flex items-center justify-between">
        <div>
          <h2 className="font-serif font-bold text-base text-ink-900">Ask Sentiora RAG Assistant</h2>
          <p className="text-[11px] text-ink-500">
            Synthesizing answers strictly from your {readyItems.length} indexed memory source{readyItems.length !== 1 ? "s" : ""}.
            {isIndexing ? " Newer captures are still processing." : ""}
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-moss-100/90 backdrop-blur-xs text-moss-700 text-[10px] font-bold shadow-xs">
          <span className="w-1.5 h-1.5 rounded-full bg-moss-600 animate-pulse" />
          RAG Engine Active ({readyItems.length} Sources)
        </span>
      </div>

      {/* Suggested Prompt Chips */}
      <div className="px-4 py-2.5 bg-parchment-50/70 backdrop-blur-xs border-b border-parchment-200/80 flex items-center gap-2 overflow-x-auto text-xs">
        <span className="text-ink-500 font-semibold shrink-0">Try asking:</span>
        {suggestedPrompts.map((prompt, idx) => (
          <button
            key={idx}
            onClick={() => handleSendQuery(prompt)}
            className="px-3 py-1 rounded-lg bg-white/80 hover:bg-white backdrop-blur-xs border border-parchment-200/80 hover:border-moss-600 hover:text-moss-600 text-ink-700 text-[11px] font-medium transition-all hover:scale-105 whitespace-nowrap shrink-0 shadow-xs"
          >
            {prompt}
          </button>
        ))}
      </div>

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-5 bg-parchment-0/50 backdrop-blur-xs">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col ${msg.sender === "user" ? "items-end" : "items-start"}`}
          >
            <div
              className={`max-w-xl p-4 rounded-2xl text-xs leading-relaxed space-y-2 relative group transition-all ${
                msg.sender === "user"
                  ? "bg-moss-600/95 text-white rounded-br-none shadow-md"
                  : msg.isError
                  ? "bg-rose-50/90 border border-rose-200/90 text-rose-950 rounded-bl-none shadow-card"
                  : msg.isNotFound
                  ? "bg-amber-50/90 border border-amber-200/90 text-amber-950 rounded-bl-none shadow-card"
                  : "bg-white/90 backdrop-blur-md border border-parchment-200/80 text-ink-900 rounded-bl-none shadow-card hover:shadow-md"
              }`}
            >
              {msg.sender === "ai" && (
                <div className="flex items-center justify-between border-b border-parchment-200/60 pb-2 mb-2 text-[11px]">
                  <span className="flex items-center gap-1 font-serif font-bold text-moss-700">
                    <span>✨</span> Sentiora AI Assistant
                  </span>
                  <button
                    onClick={() => handleCopy(msg.id, msg.text)}
                    className="text-[10px] text-ink-500 hover:text-moss-600 font-semibold px-2 py-0.5 rounded bg-parchment-100/60 hover:bg-parchment-100 transition-colors"
                  >
                    {copiedId === msg.id ? "✓ Copied" : "📋 Copy"}
                  </button>
                </div>
              )}

              {msg.sender === "user" ? (
                <p className="whitespace-pre-wrap">{msg.text}</p>
              ) : (
                <>
                  {msg.usedFallback && (
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                      Answered from your saved memory (AI provider unavailable)
                    </p>
                  )}
                  {renderFormattedMessage(msg.text)}
                </>
              )}

              {/* Citations */}
              {msg.citations && msg.citations.length > 0 && (
                <div className="mt-3 pt-3 border-t border-parchment-200/80 space-y-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-ink-500">
                    Source Citations:
                  </p>
                  {msg.citations.map((c, i) => (
                    <a
                      key={i}
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between p-2 rounded-lg bg-parchment-50/90 backdrop-blur-xs border border-parchment-200/80 text-[11px] text-moss-600 hover:underline font-medium transition-colors"
                    >
                      <span className="truncate">
                        [{i + 1}] {c.title}
                        {c.page_number ? ` · p.${c.page_number}` : ""}
                      </span>
                      <svg className="w-3 h-3 text-moss-600 shrink-0 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {isGenerating && (
          <div className="flex items-center gap-2 text-xs text-ink-500 p-3 bg-white/90 backdrop-blur-md border border-parchment-200/80 rounded-2xl w-fit shadow-card">
            <span className="w-2 h-2 rounded-full bg-moss-600 animate-ping" />
            Synthesizing answer from your personal memory archive...
          </div>
        )}
      </div>

      {/* Input Form */}
      <form onSubmit={handleSubmit} className="p-4 border-t border-parchment-200/80 bg-white/90 backdrop-blur-md flex gap-3">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={dynamicPlaceholder}
          className="flex-1 bg-parchment-50/80 backdrop-blur-xs border border-parchment-200/80 rounded-xl px-4 py-2.5 text-xs text-ink-900 placeholder-ink-500 focus:outline-none focus:border-moss-600 focus:bg-white font-medium transition-colors"
        />
        <button
          type="submit"
          disabled={!input.trim() || isGenerating}
          className="px-5 py-2.5 bg-moss-600 hover:bg-moss-700 disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition-colors shadow-sm"
        >
          Send Query
        </button>
      </form>
    </div>
  );
}
