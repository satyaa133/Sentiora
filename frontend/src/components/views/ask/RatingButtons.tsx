import { Button, IconCheck, IconThumbDown, IconThumbUp } from "@shared/ui";
import type { FeedbackRating } from "../../../services/feedbackService";

export interface RatingState {
  rating: FeedbackRating;
  state: "sending" | "sent" | "failed";
}

interface RatingButtonsProps {
  /** Names the group, e.g. "Rate this answer" or "Rate the AI answer". */
  label: string;
  value?: RatingState;
  onRate: (rating: FeedbackRating) => void;
}

/** Helpful / Not helpful for one answer (REBUILD_PLAN S2, both answer types in S7). */
export function RatingButtons({ label, value, onRate }: RatingButtonsProps) {
  return (
    <>
      <div role="group" aria-label={label} className="flex gap-2">
        {([1, -1] as const).map((rating) => {
          const chosen = value?.rating === rating && value.state !== "failed";
          return (
            <Button
              key={rating}
              variant="secondary"
              size="sm"
              aria-pressed={chosen}
              leadingIcon={
                chosen && value?.state === "sent" ? (
                  <IconCheck size={16} />
                ) : rating === 1 ? (
                  <IconThumbUp size={16} />
                ) : (
                  <IconThumbDown size={16} />
                )
              }
              loading={chosen && value?.state === "sending"}
              disabled={value !== undefined && value.state !== "failed"}
              onClick={() => onRate(rating)}
            >
              {rating === 1 ? "Helpful" : "Not helpful"}
            </Button>
          );
        })}
      </div>
      {value?.state === "sent" ? (
        <p role="status" className="w-full text-[15px] text-muted">
          Thanks, that helps improve answers.
        </p>
      ) : null}
      {value?.state === "failed" ? (
        <p role="alert" className="w-full text-[15px] text-link">
          Could not send your rating. Try again.
        </p>
      ) : null}
    </>
  );
}
