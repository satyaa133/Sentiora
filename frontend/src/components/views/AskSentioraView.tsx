import { useState, type FormEvent } from "react";
import type { MemoryItem } from "../../types/memory";
import { formatExtractedContent } from "../../utils/contentFormatter";

interface AskSentioraViewProps {
  items?: MemoryItem[];
}

interface Message {
  id: string;
  sender: "user" | "ai";
  text: string;
  citations?: { title: string; url: string }[];
  isNotFound?: boolean;
}

export default function AskSentioraView({ items = [] }: AskSentioraViewProps) {
  const [input, setInput] = useState("");

  const initialWelcomeText = items.length > 0
    ? `Hello! I am **Sentiora AI**. I can synthesize answers strictly based on your **${items.length} saved memory source${items.length > 1 ? "s" : ""}**:\n\n${items.slice(0, 3).map((i) => `• **"${i.title}"**`).join("\n")}\n\nAsk me anything about your saved archive!`
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

  const firstTitle = items[0]?.title || "";
  const secondTitle = items[1]?.title || "";

  // Dynamic suggested prompt chips from real items
  const suggestedPrompts = items.length > 0 && firstTitle
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

  const dynamicPlaceholder = items.length > 0 && firstTitle
    ? `Ask about "${firstTitle.length > 22 ? firstTitle.slice(0, 22) + "..." : firstTitle}" or your ${items.length} saved source${items.length > 1 ? "s" : ""}...`
    : "Ask a question about your saved articles, notes, or YouTube transcripts...";

  function handleSendQuery(queryText: string) {
    if (!queryText.trim()) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      sender: "user",
      text: queryText,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsGenerating(true);

    setTimeout(() => {
      const cleanQuery = queryText.trim().toLowerCase();

      if (items.length === 0) {
        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            sender: "ai",
            text: "You currently have no saved memories in your vault. Capture webpages, YouTube videos, or PDFs to start querying your archive!",
            isNotFound: true,
          },
        ]);
        setIsGenerating(false);
        return;
      }

      // Check if query is a general question or conversational phrase
      const isGeneralQuery =
        cleanQuery.length <= 4 ||
        /what|summary|summarize|explain|tell|saved|it|this|show|detail|design|memory|memories|about|dribbl/.test(cleanQuery);

      // Score and match items with fuzzy substring & token matching
      const queryWords = cleanQuery
        .replace(/[^\w\s]/g, "")
        .split(/\s+/)
        .filter((w) => w.length >= 2);

      let matchedItems = items.filter((item) => {
        const formatted = formatExtractedContent(item);
        const corpus = `${item.title} ${formatted.cleanText} ${item.url} ${item.source_type} ${item.author || ""}`.toLowerCase();

        if (corpus.includes(cleanQuery)) return true;

        return queryWords.some((word) => {
          const stem = word.length > 4 ? word.slice(0, 4) : word;
          return corpus.includes(stem);
        });
      });

      // Fallback to top items if no match but query is general
      if (matchedItems.length === 0 && (isGeneralQuery || queryWords.length === 0)) {
        matchedItems = items.slice(0, 3);
      }

      if (matchedItems.length > 0) {
        const topMatches = matchedItems.slice(0, 3);
        const citations = topMatches.map((m) => ({ title: m.title, url: m.url }));

        const structuredAnswers = topMatches.map((item) => {
          const formatted = formatExtractedContent(item);
          let domain = "webpage";
          try {
            domain = new URL(item.url).hostname.replace(/^www\./, "");
          } catch {
            domain = item.url;
          }

          let summaryText = formatted.cleanText
            .replace(/^Captured page resource from \S+\s*\([^)]*\)\.\s*/i, "")
            .replace(/Contains page layout references, media assets, and design components\./i, "It features curated landing page design inspiration, UI layout references, media assets, and reusable design components.");

          if (!summaryText.trim()) {
            summaryText = `Contains saved reference materials and content captured from ${domain}.`;
          }

          if (summaryText.length > 350) {
            summaryText = summaryText.slice(0, 350) + "...";
          }

          const sourceTypeLabel = item.source_type === "youtube" ? "YouTube Video" : item.source_type === "pdf" ? "PDF Document" : "Webpage";
          const readTime = Math.max(1, Math.ceil((item.reading_time_seconds || 120) / 60));

          return `### 💡 **${item.title}**
*Source: ${sourceTypeLabel} via \`${domain}\`*

${summaryText}

**Key Details:**
- **Source Domain**: \`${domain}\`
- **Estimated Reading Time**: ~${readTime} min read (${item.word_count || 120} words)
- **Captured Date**: ${new Date(item.captured_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
        });

        const fallbackAnswer = structuredAnswers[0] || "No detailed summary available.";
        const aiAnswer = topMatches.length === 1
          ? fallbackAnswer
          : `Here is the synthesized answer based on your saved memory sources:\n\n${structuredAnswers.join("\n\n---\n\n")}`;

        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            sender: "ai",
            text: aiAnswer,
            citations,
          },
        ]);
      } else {
        const availableTitles = items.slice(0, 3).map((i) => `• **"${i.title}"**`).join("\n");
        const notFoundText = `I searched your saved memory archive, but no available memory sources contain specific information matching **"${queryText}"**.\n\nYour available memory sources (${items.length}):\n${availableTitles}\n\nTry asking a question related to one of your saved sources above.`;

        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            sender: "ai",
            text: notFoundText,
            isNotFound: true,
          },
        ]);
      }

      setIsGenerating(false);
    }, 500);
  }

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
            Synthesizing answers strictly from your {items.length} saved memory source{items.length !== 1 ? "s" : ""}.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-moss-100/90 backdrop-blur-xs text-moss-700 text-[10px] font-bold shadow-xs">
          <span className="w-1.5 h-1.5 rounded-full bg-moss-600 animate-pulse" />
          RAG Engine Active ({items.length} Sources)
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
                renderFormattedMessage(msg.text)
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
                      <span className="truncate">[{i + 1}] {c.title}</span>
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
