from enum import StrEnum

from pydantic import BaseModel, Field


class SourceId(StrEnum):
    WEBPAGES = "webpages"
    YOUTUBE = "youtube"
    PDF = "pdf"
    CHATGPT = "chatgpt"
    NOTION = "notion"
    GITHUB = "github"
    TWITTER = "twitter"
    SUBSTACK = "substack"


class SourceStatus(StrEnum):
    ACTIVE = "active"
    PAUSED = "paused"
    NOT_CONNECTED = "not_connected"


ALL_SOURCE_IDS: tuple[SourceId, ...] = tuple(SourceId)


def default_source_preferences() -> dict[str, str]:
    return {source.value: SourceStatus.NOT_CONNECTED.value for source in SourceId}


class SourcePreferenceItem(BaseModel):
    source_id: SourceId
    status: SourceStatus


class SourcePreferencesData(BaseModel):
    sources: dict[str, SourceStatus]
    onboarding_completed: bool = False


class UpdateSourcePreferenceRequest(BaseModel):
    status: SourceStatus


class BulkSourcePreferencesRequest(BaseModel):
    sources: dict[str, SourceStatus] = Field(default_factory=dict)


class OnboardingCompleteRequest(BaseModel):
    selected_sources: list[SourceId] = Field(default_factory=list)
