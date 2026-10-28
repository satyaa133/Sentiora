import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  Button,
  Chip,
  Drawer,
  Echo,
  IconArrowUp,
  IconCheck,
  IconClock,
  IconClose,
  IconCopy,
  IconNote,
  IconPlus,
  IconRefresh,
  Kbd,
  Skeleton,
} from "@shared/ui";
import type { MemoryItem } from "../../types/memory";
import {
  AskApiError,
  type AskLaunch,
  type AskRequest,
  type AskScope,
  type AskTurn,
} from "../../services/askService";
import { askStream } from "../../services/askStream";
import {
  deleteConversation,
  loadConversations,
  saveConversation,
  type StoredConversation,
} from "../../services/askHistory";
import { getStoredSession } from "../../services/authStorage";
import { browserTimeZone } from "../../services/dashboardService";
import { createMemoryItem } from "../../services/memoryService";
import { emitEcho } from "../echo/echoEvents";
import { AnswerMarkdown } from "./ask/AnswerMarkdown";
import { HistorySidebar } from "./ask/HistorySidebar";
import { ModeBadge } from "./ask/ModeBadge";
import { ScopePicker } from "./ask/ScopePicker";
import { SourcesPanel } from "./ask/SourcesPanel";
import {
  plainAnswer,
  usedSourceList,
  type AiMessage,
  type ChatMessage,
} from "./ask/types";

interface AskSentioraViewProps {
  items?: MemoryItem[];
  /** A question and/or scope sent from another view ("Ask Echo about this"). */
  launch?: AskLaunch | null;
  /** Called once the launch has been copied into the view's own state. */
  onLaunchConsumed?: () => void;
  /** Opens the memory drawer; returns false when the memory isn't loaded. */
  onOpenMemory?: (memoryId: string) => boolean;
}

const HISTORY_TURNS = 4;
let messageCounter = 0;
const nextId = (prefix = "m") => `${prefix}${Date.now()}-${messageCounter++}`;

function clip(title: string, limit = 40) {
  return title.length > limit ? `${title.slice(0, limit - 1).trimEnd()}…` : title;
}

function isAbort(err: unknown) {
  return err instanceof DOMException && err.name === "AbortError";
}

export default function AskSentioraView({
  items = [],
  launch,
  onLaunchConsumed,
  onOpenMemory,
}: AskSentioraViewProps) {
  const userId = getStoredSession()?.user?.id ?? null;
  const [input, setInput] = useState("");
  const [scope, setScope] = useState<AskScope | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<StoredConversation<ChatMessage>[]>(() =>
    loadConversations<ChatMessage>(userId),
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // Save as note (DESIGN.md §5.5): per answer, saving / saved / failed.
  const [noteState, setNoteState] = useState<Record<string, "saving" | "saved" | "failed">>({});
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  // Effects can run twice (StrictMode); act on each launch only once.
  const handledLaunchId = useRef<number | null>(null);

  const isGenerating = messages.some(
    (msg) => msg.sender === "ai" && (msg.status === "pending" || msg.status === "streaming"),
  );

  const readyItems = items.filter(
    (item) => item.status === "ready" && (item.word_count > 0 || Boolean(item.content?.trim())),
  );
  const isIndexing = items.some((item) => item.status === "pending" || item.status === "processing");

  const introText =
    readyItems.length > 0
      ? `Echo answers from your ${readyItems.length} saved ${readyItems.length === 1 ? "memory" : "memories"} and links each fact to its source. When your saves don't cover a question, Echo says so and answers from general knowledge.`
      : isIndexing
        ? "Your latest saves are still being indexed. Until then Echo can answer general questions."
        : "Nothing saved yet, so Echo answers general questions only. Save a page with the extension to ask about it here.";

  const starters = [
    readyItems[0] ? `What does “${clip(readyItems[0].title)}” cover?` : null,
    readyItems[1] ? `What are the key ideas in “${clip(readyItems[1].title)}”?` : null,
    items.length > 0 ? "What did I capture this week?" : null,
    "Explain recursion with a short example",
  ].filter((prompt): prompt is string => Boolean(prompt));

  const updateAi = useCallback((id: string, patch: (msg: AiMessage) => Partial<AiMessage>) => {
    setMessages((prev) =>
      prev.map((msg) => (msg.id === id && msg.sender === "ai" ? { ...msg, ...patch(msg) } : msg)),
    );
  }, []);

  // Persist finished conversations (this browser only).
  useEffect(() => {
    if (!messages.length || isGenerating || !userId) return;
    const id = conversationId ?? nextId("c");
    if (!conversationId) setConversationId(id);
    const first = messages.find((msg) => msg.sender === "user");
    setConversations(
      saveConversation<ChatMessage>(userId, {
        id,
        title: clip(first?.text ?? "Conversation", 60),
        updatedAt: Date.now(),
        messages,
      }),
    );
  }, [messages, isGenerating, userId, conversationId]);

  // Ctrl/Cmd+K focuses the composer on this page (elsewhere it opens the palette).
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        event.stopPropagation();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, []);

  // Stop streaming when the view goes away.
  useEffect(() => () => controllerRef.current?.abort(), []);

  // Composer grows with its content (up to ~6 lines).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  function historyFor(previous: ChatMessage[]): AskTurn[] {
    return previous
      .filter((msg) => msg.sender === "user" || (msg.status === "done" && msg.text))
      .slice(-HISTORY_TURNS)
      .map((msg) => ({
        role: msg.sender === "user" ? "user" : "assistant",
        content: msg.text.slice(0, 4000),
      }));
  }

  async function run(question: string, activeScope: AskScope | null, before: ChatMessage[], aiId: string) {
    const controller = new AbortController();
    controllerRef.current = controller;
    emitEcho({ type: "ask" });
    const payload: AskRequest = { question, tz: browserTimeZone() };
    const history = historyFor(before);
    if (history.length > 0) payload.history = history;
    if (activeScope?.memoryId) payload.memory_id = activeScope.memoryId;
    if (activeScope?.sourceType) payload.source_type = activeScope.sourceType;

    try {
      const final = await askStream(
        payload,
        {
          onSources: (sources) => updateAi(aiId, () => ({ sources })),
          onDelta: (text) => updateAi(aiId, (msg) => ({ status: "streaming", text: msg.text + text })),
        },
        controller.signal,
      );
      updateAi(aiId, () => ({
        status: "done",
        text: final.answer,
        mode: final.mode,
        usedSources: final.usedSources ?? [],
        followups: final.followUps ?? [],
        insufficient: Boolean(final.insufficient_context),
        usedFallback: Boolean(final.used_fallback),
      }));
      emitEcho({
        type: "answer",
        status: final.insufficient_context ? "not_found" : "ready",
        cited: (final.usedSources?.length ?? 0) > 0,
      });
    } catch (err) {
      if (isAbort(err)) {
        updateAi(aiId, () => ({ status: "stopped" }));
        return;
      }
      updateAi(aiId, () => ({ status: "error", error: errorMessage(err) }));
      emitEcho({ type: "answer", status: "error", cited: false });
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }

  function aiPlaceholder(question: string, activeScope: AskScope | null): AiMessage {
    return {
      id: nextId(),
      sender: "ai",
      status: "pending",
      text: "",
      sources: [],
      usedSources: [],
      followups: [],
      insufficient: false,
      usedFallback: false,
      question,
      scope: activeScope,
    };
  }

  async function handleSendQuery(queryText: string, scopeOverride?: AskScope | null) {
    const question = queryText.trim();
    if (!question || isGenerating) return;
    const activeScope = scopeOverride !== undefined ? scopeOverride : scope;
    const before = messages;
    const ai = aiPlaceholder(question, activeScope);
    setMessages([...before, { id: nextId(), sender: "user", text: question }, ai]);
    setInput("");
    await run(question, activeScope, before, ai.id);
  }

  /** Ask the same question again, replacing the answer (Retry and Regenerate). */
  async function regenerate(message: AiMessage) {
    if (isGenerating) return;
    const index = messages.findIndex((msg) => msg.id === message.id);
    if (index < 0) return;
    // History is everything before this answer's question.
    const before = messages.slice(0, Math.max(0, index - 1));
    const ai = aiPlaceholder(message.question, message.scope ?? null);
    setMessages([...messages.slice(0, index), ai, ...messages.slice(index + 1)]);
    await run(message.question, message.scope ?? null, before, ai.id);
  }

  function stop() {
    controllerRef.current?.abort();
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void handleSendQuery(input);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void handleSendQuery(input);
    } else if (event.key === "Escape" && isGenerating) {
      event.preventDefault();
      stop();
    }
  }

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

  /**
   * Keep an answer as a note memory, the same way the extension saves notes:
   * POST /memory-items with a sentiora.app/notes URL.
   */
  async function handleSaveNote(message: AiMessage) {
    if (noteState[message.id] === "saving" || noteState[message.id] === "saved") return;
    setNoteState((prev) => ({ ...prev, [message.id]: "saving" }));
    try {
      await createMemoryItem({
        source_type: "webpage",
        title: clip(`Note: ${message.question || "Ask Sentiora answer"}`, 120),
        url: `https://sentiora.app/notes/${Date.now()}`,
        content: [`Q: ${message.question}`, plainAnswer(message)].filter(Boolean).join("\n\n"),
      });
      setNoteState((prev) => ({ ...prev, [message.id]: "saved" }));
    } catch {
      setNoteState((prev) => ({ ...prev, [message.id]: "failed" }));
    }
  }

  function handleCopy(message: AiMessage) {
    void navigator.clipboard?.writeText(plainAnswer(message));
    setCopiedId(message.id);
    window.setTimeout(() => setCopiedId(null), 2000);
  }

  function startNewChat() {
    stop();
    setMessages([]);
    setConversationId(null);
    setScope(null);
    setInput("");
    setHistoryOpen(false);
    inputRef.current?.focus();
  }

  function openConversation(id: string) {
    const conversation = conversations.find((c) => c.id === id);
    if (!conversation) return;
    stop();
    setConversationId(id);
    setMessages(conversation.messages);
    setHistoryOpen(false);
  }

  function removeConversation(id: string) {
    setConversations(deleteConversation<ChatMessage>(userId, id));
    if (id === conversationId) startNewChat();
  }

  const messagesEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages]);

  const firstQuestion = messages.find((msg) => msg.sender === "user")?.text;
  const conversationTitle = firstQuestion ? clip(firstQuestion, 60) : "Ask Sentiora";
  const lastAiId = [...messages].reverse().find((msg) => msg.sender === "ai")?.id;

  const sidebar = (
    <HistorySidebar
      conversations={conversations}
      activeId={conversationId}
      onSelect={openConversation}
      onDelete={removeConversation}
      onNewChat={startNewChat}
    />
  );

  function renderAnswer(msg: AiMessage) {
    const used = usedSourceList(msg);
    const busy = msg.status === "pending" || msg.status === "streaming";
    const notFound = msg.status === "done" && msg.insufficient;
    return (
      <article
        key={msg.id}
        aria-label="Echo's answer"
        aria-busy={busy}
        className="flex gap-3"
      >
        <Echo
          state={msg.status === "error" || notFound ? "faded" : busy ? "saving" : "happy"}
          size={36}
          still
          className="mt-0.5 shrink-0"
        />
        <div className="min-w-0 flex-1 space-y-3">
          {msg.status === "done" && msg.mode && !notFound ? (
            <ModeBadge mode={msg.mode} usedFallback={msg.usedFallback} />
          ) : null}

          {msg.status === "pending" ? (
            <div role="status" className="space-y-2 pt-1">
              <span className="text-[16px] text-muted">
                {msg.sources.length
                  ? `Reading ${msg.sources.length} saved ${msg.sources.length === 1 ? "source" : "sources"}…`
                  : "Looking through your memories…"}
              </span>
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : null}

          {msg.status === "error" ? (
            <div role="alert" className="space-y-3 rounded-btn bg-accent-soft px-4 py-3">
              <p className="text-[16px] text-accent-soft-fg">{msg.error}</p>
              {msg.text ? (
                <div className="opacity-80">
                  <AnswerMarkdown text={msg.text} sources={msg.sources} onOpenMemory={onOpenMemory} />
                </div>
              ) : null}
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={<IconRefresh size={16} />}
                disabled={isGenerating}
                onClick={() => void regenerate(msg)}
              >
                Try again
              </Button>
            </div>
          ) : notFound ? (
            <div className="rounded-card border border-line bg-surface px-4 py-3">
              <h3 className="text-[17px] font-semibold text-fg">Nothing relevant saved yet</h3>
              <div className="mt-1 text-muted [&_*]:text-muted">
                <AnswerMarkdown text={msg.text} sources={msg.sources} onOpenMemory={onOpenMemory} />
              </div>
              <p className="mt-2 text-[15px] text-muted">
                Save pages, PDFs or videos with the extension, then ask again.
              </p>
            </div>
          ) : msg.text ? (
            <AnswerMarkdown
              text={msg.text}
              sources={msg.sources}
              onOpenMemory={onOpenMemory}
              streaming={msg.status === "streaming"}
            />
          ) : null}

          {msg.status === "stopped" ? (
            <p className="font-mono text-eyebrow uppercase text-muted">Stopped</p>
          ) : null}

          {msg.status === "done" && used.length > 0 ? (
            <SourcesPanel sources={used} onOpenMemory={onOpenMemory} defaultOpen={msg.id === lastAiId} />
          ) : null}

          {msg.status === "done" || msg.status === "stopped" ? (
            <div className="flex flex-wrap gap-2">
              {msg.text ? (
                <Button
                  variant="secondary"
                  size="sm"
                  leadingIcon={copiedId === msg.id ? <IconCheck size={16} /> : <IconCopy size={16} />}
                  onClick={() => handleCopy(msg)}
                >
                  {copiedId === msg.id ? "Copied" : "Copy answer"}
                </Button>
              ) : null}
              {msg.id === lastAiId ? (
                <Button
                  variant="secondary"
                  size="sm"
                  leadingIcon={<IconRefresh size={16} />}
                  disabled={isGenerating}
                  onClick={() => void regenerate(msg)}
                >
                  Regenerate
                </Button>
              ) : null}
              {msg.status === "done" ? (
                <Button
                  variant="secondary"
                  size="sm"
                  leadingIcon={
                    noteState[msg.id] === "saved" ? <IconCheck size={16} /> : <IconNote size={16} />
                  }
                  loading={noteState[msg.id] === "saving"}
                  disabled={noteState[msg.id] === "saved"}
                  onClick={() => void handleSaveNote(msg)}
                >
                  {noteState[msg.id] === "saved" ? "Saved as note" : "Save as note"}
                </Button>
              ) : null}
              {noteState[msg.id] === "failed" ? (
                <p role="alert" className="w-full text-[15px] text-link">
                  Could not save this note. Try again.
                </p>
              ) : null}
            </div>
          ) : null}

          {msg.id === lastAiId && msg.status === "done" && msg.followups.length ? (
            <div role="group" aria-label="Follow-up questions" className="flex flex-wrap gap-2">
              {msg.followups.map((followup) => (
                <Chip
                  key={followup}
                  className="h-auto min-h-9 whitespace-normal py-1.5 text-left"
                  onClick={() => void handleSendQuery(followup)}
                >
                  {followup}
                </Chip>
              ))}
            </div>
          ) : null}
        </div>
      </article>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="hidden w-64 shrink-0 border-r border-line bg-surface lg:block">{sidebar}</aside>
      <Drawer open={historyOpen} onClose={() => setHistoryOpen(false)} title="Conversations">
        {sidebar}
      </Drawer>

      <section aria-labelledby="ask-title" className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line bg-surface px-4 sm:px-6">
          <Echo state="idle" size={32} still className="shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-mono text-eyebrow uppercase text-muted">Echo</p>
            <h1 id="ask-title" className="truncate text-[17px] font-semibold leading-tight text-fg">
              {conversationTitle}
            </h1>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="lg:hidden"
            leadingIcon={<IconClock size={16} />}
            onClick={() => setHistoryOpen(true)}
          >
            <span className="sr-only sm:not-sr-only">History</span>
          </Button>
          {messages.length > 0 ? (
            <Button variant="ghost" size="sm" leadingIcon={<IconPlus size={16} />} onClick={startNewChat}>
              <span className="sr-only sm:not-sr-only">New chat</span>
            </Button>
          ) : null}
        </header>

        <div
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
          aria-live="polite"
          aria-relevant="additions"
        >
          <div className="mx-auto w-full max-w-[780px] space-y-8 px-4 py-8 sm:px-6">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center pt-6 text-center sm:pt-12">
                <Echo state={readyItems.length > 0 ? "idle" : "faded"} size={88} />
                <h2 className="mt-5 font-display text-[28px] font-bold tracking-tight text-fg">Ask Echo</h2>
                <p className="mt-2 max-w-md text-[17px] text-muted">{introText}</p>
                <ul aria-label="Suggested questions" className="mt-6 flex w-full max-w-lg flex-col gap-2">
                  {starters.map((prompt) => (
                    <li key={prompt}>
                      <button
                        type="button"
                        onClick={() => void handleSendQuery(prompt)}
                        className="w-full rounded-card border border-line bg-surface px-4 py-3 text-left text-[16px] text-fg transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
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
                renderAnswer(msg)
              ),
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        <form
          data-echo-dock=""
          onSubmit={handleSubmit}
          className="mx-auto w-full max-w-[780px] shrink-0 px-4 pb-4 pt-2 sm:px-6"
        >
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[15px] text-muted">
            <ScopePicker scope={scope} items={items} onChange={setScope} />
            {scope ? (
              <button
                type="button"
                onClick={() => setScope(null)}
                aria-label={`Stop limiting answers to ${scope.label}`}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                <IconClose size={14} />
              </button>
            ) : null}
          </div>
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
              aria-describedby="ask-hint"
              placeholder={messages.length > 0 ? "Ask a follow-up..." : "Ask Echo anything..."}
              className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent py-2.5 text-[17px] text-fg placeholder:text-muted focus:outline-none"
            />
            {isGenerating ? (
              <button
                type="button"
                onClick={stop}
                aria-label="Stop answering"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-btn border border-line bg-surface text-fg transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                <span aria-hidden="true" className="h-3.5 w-3.5 rounded-sm bg-fg" />
              </button>
            ) : (
              <button
                type="submit"
                aria-label="Send question"
                disabled={!input.trim()}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-btn bg-accent text-on-accent transition-colors hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                <IconArrowUp size={20} />
              </button>
            )}
          </div>
          <p id="ask-hint" className="mt-2 hidden text-center text-[14px] text-muted sm:block">
            <Kbd>Enter</Kbd> to send · <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> new line · <Kbd>Ctrl</Kbd>
            <Kbd>K</Kbd> to focus · Answers cite your saves and say when they use general knowledge.
          </p>
        </form>
      </section>
    </div>
  );
}

function errorMessage(err: unknown): string {
  if (!(err instanceof AskApiError)) {
    return "Echo could not reach the server. Confirm the backend is running, then try again.";
  }
  if (err.code === "ASK_STREAM_INTERRUPTED") {
    return "The answer was cut off before it finished. Try again.";
  }
  if (err.status === 401 || err.status === 403) {
    return "Your session expired or you are not signed in. Please sign in again to ask questions.";
  }
  if (err.status === 429) {
    return "You're asking faster than the limit allows. Wait a moment, then try again.";
  }
  if (err.status === 503 || err.code === "AI_NOT_CONFIGURED") {
    return err.message || "Sentiora AI is not configured, and no saved memory could be used to answer.";
  }
  if (err.code === "ASK_LLM_FAILED") {
    return err.message || "The language model failed while answering. Try again in a moment.";
  }
  if (err.code === "ASK_SYSTEM_FAILED" || err.status === 502) {
    return err.message || "The Sentiora server had a problem answering this question.";
  }
  if (err.status >= 500) {
    return err.message || "The Sentiora server had a problem.";
  }
  return err.message || "Echo could not answer right now.";
}
