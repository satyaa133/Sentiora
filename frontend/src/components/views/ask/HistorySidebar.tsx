import { IconPlus, IconTrash, cx } from "@shared/ui";
import type { StoredConversation } from "../../../services/askHistory";

interface HistorySidebarProps {
  conversations: StoredConversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNewChat: () => void;
}

function when(timestamp: number): string {
  const days = Math.floor((Date.now() - timestamp) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Past Ask conversations, stored in this browser only. */
export function HistorySidebar({
  conversations,
  activeId,
  onSelect,
  onDelete,
  onNewChat,
}: HistorySidebarProps) {
  return (
    <nav aria-label="Conversation history" className="flex h-full flex-col">
      <div className="p-3">
        <button
          type="button"
          onClick={onNewChat}
          className="flex min-h-touch w-full items-center gap-2 rounded-btn border border-line bg-surface px-3 text-[15px] font-semibold text-fg hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <IconPlus size={16} />
          New chat
        </button>
      </div>
      <p className="px-4 pb-1 font-mono text-eyebrow uppercase text-muted">History</p>
      {conversations.length === 0 ? (
        <p className="px-4 py-2 text-[15px] text-muted">
          Your conversations show up here. They stay in this browser.
        </p>
      ) : (
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
          {conversations.map((conversation) => (
            <li key={conversation.id} className="group relative">
              <button
                type="button"
                aria-current={conversation.id === activeId ? "true" : undefined}
                onClick={() => onSelect(conversation.id)}
                className={cx(
                  "flex min-h-touch w-full flex-col justify-center rounded-btn py-1.5 pl-3 pr-10 text-left hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
                  conversation.id === activeId && "bg-accent-soft",
                )}
              >
                <span className="w-full truncate text-[15px] text-fg">{conversation.title}</span>
                <span className="font-mono text-xs text-muted">{when(conversation.updatedAt)}</span>
              </button>
              <button
                type="button"
                aria-label={`Delete conversation ${conversation.title}`}
                onClick={() => onDelete(conversation.id)}
                className="absolute right-1 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-btn text-muted hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                <IconTrash size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
