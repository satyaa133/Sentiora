"""RAG service — retrieves relevant memory chunks and generates a grounded answer
using the configured OpenAI chat model.

Pipeline:
  question → query embedding → semantic retrieval → context builder → LLM → answer
"""

from __future__ import annotations

import logging
from uuid import UUID

from openai import OpenAI

from app.core.config import get_settings
from app.models.memory_item import SourceType
from app.schemas.ask import AskCitation, AskResponse
from app.services.retrieval_service import RetrievedChunk, RetrievalService

logger = logging.getLogger(__name__)

INSUFFICIENT_ANSWER = (
    "I couldn't find enough information in your saved memories to answer that."
)


class LLMNotConfiguredError(RuntimeError):
    """Raised when the LLM API key is not set in the environment."""


SYSTEM_PROMPT = """You are Sentiora, a private intelligent memory assistant.
Your ONLY job is to answer questions using the EXACT memory sources supplied below.

Rules:
- Answer ONLY using the supplied memory sources. Do not add outside knowledge.
- Write a natural, concise, helpful answer — as if you read the saved content yourself.
- When you draw on a source, cite it inline as [Source N] using the numbering provided.
- If the supplied sources are insufficient to answer, say:
  "I couldn't find enough information in your saved memories to answer that."
- Do NOT say "the language model is not configured" or anything about your own setup.
- Do NOT mention retrieval mechanics, vector search, or embeddings.
- Do NOT invent URLs, dates, authors, or facts not present in the sources.
- Synthesise across sources when multiple are relevant.
"""


def _build_context(chunks: list[RetrievedChunk], max_chars: int) -> str:
    """Build a clean, labelled context string for the LLM within a character budget.

    Each source block receives a proportional share of the budget so the most
    relevant chunks (retrieved first by vector distance) are never unfairly
    truncated relative to less relevant ones.
    """
    if not chunks:
        return ""

    # Distribute budget evenly across chunks; any remainder goes to the first.
    per_chunk = max_chars // len(chunks)
    parts: list[str] = []

    for index, chunk in enumerate(chunks, start=1):
        heading = chunk.heading or "General"
        page = f"\nPage: {chunk.page_number}" if chunk.page_number is not None else ""

        # Allow the first (most relevant) chunk to use any leftover budget.
        allowance = per_chunk + (max_chars - per_chunk * len(chunks)) if index == 1 else per_chunk
        content = chunk.content[:allowance] if len(chunk.content) > allowance else chunk.content

        parts.append(
            f"[Source {index}]\n"
            f"Title: {chunk.title}\n"
            f"URL: {chunk.url}\n"
            f"Type: {chunk.source_type.value}\n"
            f"Section: {heading}{page}\n"
            f"Content:\n{content}"
        )

    return "\n\n---\n\n".join(parts)


def _citations_from_chunks(chunks: list[RetrievedChunk]) -> list[AskCitation]:
    seen: set[UUID] = set()
    citations: list[AskCitation] = []
    for chunk in chunks:
        if chunk.memory_id in seen:
            continue
        seen.add(chunk.memory_id)
        citations.append(
            AskCitation(
                memory_id=chunk.memory_id,
                chunk_id=chunk.chunk_id,
                title=chunk.title,
                url=chunk.url,
                source_type=chunk.source_type,
                domain=chunk.domain,
                heading=chunk.heading,
                page_number=chunk.page_number,
            )
        )
    return citations


def _looks_insufficient(answer: str) -> bool:
    """Heuristic: did the LLM signal it lacked context?"""
    lower = answer.lower()
    signals = [
        "couldn't find",
        "cannot find",
        "not enough information",
        "no information",
        "not in your saved",
        "not available in",
        "i don't have",
        "i do not have",
    ]
    return any(s in lower for s in signals)


class RagService:
    def __init__(self, retrieval: RetrievalService) -> None:
        self.retrieval = retrieval
        self.settings = get_settings()

    def ask(
        self,
        user_id: UUID,
        question: str,
        source_type: SourceType | None = None,
        top_k: int | None = None,
        memory_id: UUID | None = None,
    ) -> AskResponse:
        # Fail fast — let the route layer convert this to HTTP 503.
        if not self.settings.openai_api_key:
            raise LLMNotConfiguredError(
                "OPENAI_API_KEY is not configured. "
                "Set it in backend/.env and restart the server."
            )

        chunks = self.retrieval.retrieve_relevant_memories(
            user_id=user_id,
            query=question,
            top_k=top_k,
            source_type=source_type,
            memory_id=memory_id,
        )

        if not chunks:
            return AskResponse(
                answer=INSUFFICIENT_ANSWER,
                citations=[],
                insufficient_context=True,
            )

        try:
            answer = self._complete(question, chunks)
        except LLMNotConfiguredError:
            raise
        except Exception:
            logger.exception("LLM completion failed")
            raise

        cleaned = (answer or "").strip()
        if not cleaned:
            return AskResponse(
                answer=INSUFFICIENT_ANSWER,
                citations=[],
                insufficient_context=True,
            )

        insufficient = _looks_insufficient(cleaned)
        return AskResponse(
            answer=cleaned,
            citations=_citations_from_chunks(chunks) if not insufficient else [],
            insufficient_context=insufficient,
        )

    def _complete(self, question: str, chunks: list[RetrievedChunk]) -> str:
        client = OpenAI(api_key=self.settings.openai_api_key, timeout=45.0)
        context = _build_context(chunks, self.settings.rag_max_context_chars)
        completion = client.chat.completions.create(
            model=self.settings.openai_chat_model,
            temperature=0.1,
            max_tokens=800,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": (
                        f"Memory sources from my personal vault:\n\n"
                        f"{context}\n\n"
                        f"---\n\n"
                        f"Question: {question}"
                    ),
                },
            ],
        )
        return completion.choices[0].message.content or ""
