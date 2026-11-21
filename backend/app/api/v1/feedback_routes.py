from typing import Annotated

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.orm import Session as DBSession

from app.api.deps import get_current_user, get_db
from app.models.user import User
from app.schemas.envelope import APIResponse, response_meta
from app.schemas.feedback import AnswerFeedbackCreate, AnswerFeedbackResponse
from app.services.feedback_service import FeedbackService

router = APIRouter(prefix="/answers", tags=["Answer Feedback"])


@router.post(
    "/feedback",
    response_model=APIResponse[AnswerFeedbackResponse],
    status_code=status.HTTP_201_CREATED,
    summary="Rate an Ask answer 👍 (1) or 👎 (-1)",
)
def create_answer_feedback(
    req: AnswerFeedbackCreate,
    request: Request,
    db: Annotated[DBSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> APIResponse[AnswerFeedbackResponse]:
    data = FeedbackService(db).record(current_user.id, req)
    return APIResponse(data=data, meta=response_meta(request))
