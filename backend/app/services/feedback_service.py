"""👍/👎 on Ask answers. The question is stored only as a hash."""

from __future__ import annotations

import hashlib
from uuid import UUID

from sqlalchemy.orm import Session as DBSession

from app.models.answer_feedback import AnswerFeedback
from app.schemas.feedback import AnswerFeedbackCreate, AnswerFeedbackResponse


def question_hash(question: str) -> str:
    """SHA-256 of the question, lower-cased with whitespace collapsed."""
    normalised = " ".join(question.lower().split())
    return hashlib.sha256(normalised.encode("utf-8")).hexdigest()


class FeedbackService:
    def __init__(self, db: DBSession) -> None:
        self.db = db

    def record(self, user_id: UUID, req: AnswerFeedbackCreate) -> AnswerFeedbackResponse:
        comment = (req.comment or "").strip() or None
        row = AnswerFeedback(
            user_id=user_id,
            question_hash=question_hash(req.question),
            answer_mode=req.answer_mode,
            rating=req.rating,
            comment=comment,
            source_chunk_ids=list(dict.fromkeys(req.source_chunk_ids)),
        )
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return AnswerFeedbackResponse(id=row.id, rating=row.rating, created_at=row.created_at)
