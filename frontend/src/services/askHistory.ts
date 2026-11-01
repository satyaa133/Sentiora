/**
 * Ask conversation history, kept in this browser only (localStorage), per user.
 * Cleared on sign-out. Nothing here is sent to the server.
 */

const PREFIX = "sentiora.ask.history.";
const MAX_CONVERSATIONS = 30;
const MAX_MESSAGES = 40;

export interface StoredConversation<M = unknown> {
  id: string;
  title: string;
  updatedAt: number;
  messages: M[];
}

function keyFor(userId: string) {
  return `${PREFIX}${userId}`;
}

export function loadConversations<M>(userId: string | null): StoredConversation<M>[] {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(keyFor(userId));
    const parsed = raw ? (JSON.parse(raw) as StoredConversation<M>[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write<M>(userId: string, conversations: StoredConversation<M>[]) {
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify(conversations));
  } catch {
    // Storage full or blocked: history is a convenience, the chat still works.
  }
}

/** Insert or update a conversation; newest first, capped in count and length. */
export function saveConversation<M>(
  userId: string | null,
  conversation: StoredConversation<M>,
): StoredConversation<M>[] {
  if (!userId) return [];
  const others = loadConversations<M>(userId).filter((c) => c.id !== conversation.id);
  const next = [
    { ...conversation, messages: conversation.messages.slice(-MAX_MESSAGES) },
    ...others,
  ]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_CONVERSATIONS);
  write(userId, next);
  return next;
}

export function deleteConversation<M>(userId: string | null, id: string): StoredConversation<M>[] {
  if (!userId) return [];
  const next = loadConversations<M>(userId).filter((c) => c.id !== id);
  write(userId, next);
  return next;
}

/** Remove every user's Ask history from this browser (on sign-out). */
export function clearAskHistory() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    // Storage unavailable: nothing to clear.
  }
}
