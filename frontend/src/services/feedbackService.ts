import apiClient, { type APIEnvelope } from "./apiClient";

export type FeedbackRating = 1 | -1;

/** Answer modes the API accepts for feedback (REBUILD_PLAN S2; instant/ai from S6). */
export type FeedbackAnswerMode = "memory" | "general" | "mixed" | "combined" | "instant" | "ai";

export interface AnswerFeedback {
  question: string;
  answerMode: FeedbackAnswerMode;
  rating: FeedbackRating;
  /** Chunk IDs of the sources the answer cited. */
  sourceChunkIds: string[];
  comment?: string;
}

interface AnswerFeedbackResponse {
  id: string;
  rating: number;
  created_at: string;
}

/** Rate an Ask answer. The API stores only a hash of the question. */
export async function sendAnswerFeedback(feedback: AnswerFeedback): Promise<void> {
  await apiClient.post<APIEnvelope<AnswerFeedbackResponse>>("/answers/feedback", {
    question: feedback.question,
    answer_mode: feedback.answerMode,
    rating: feedback.rating,
    comment: feedback.comment,
    source_chunk_ids: feedback.sourceChunkIds.slice(0, 20),
  });
}
