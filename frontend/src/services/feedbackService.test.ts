import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./apiClient", () => ({ default: { post: vi.fn() } }));

import apiClient from "./apiClient";
import { sendAnswerFeedback } from "./feedbackService";

afterEach(() => {
  vi.mocked(apiClient.post).mockReset();
});

describe("sendAnswerFeedback", () => {
  it("posts the rating in the API's field names, with at most 20 chunk IDs", async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: { data: { id: "f1" } } });
    const chunks = Array.from({ length: 25 }, (_, index) => `c${index}`);

    await sendAnswerFeedback({
      question: "What is 3NF?",
      answerMode: "general",
      rating: 1,
      sourceChunkIds: chunks,
    });

    expect(apiClient.post).toHaveBeenCalledWith("/answers/feedback", {
      question: "What is 3NF?",
      answer_mode: "general",
      rating: 1,
      comment: undefined,
      source_chunk_ids: chunks.slice(0, 20),
    });
  });
});
