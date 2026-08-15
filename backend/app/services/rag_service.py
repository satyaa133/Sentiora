"""RAG service — retrieves relevant memory chunks and generates a grounded answer.

Pipeline:
  question → retrieval (semantic, then lexical, then recent) → LLM if configured
  → local grounded fallback if the provider is missing or fails
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
    """Raised when the LLM API key is not set and no retrieved memory is available."""


class LLMProviderError(RuntimeError):
    """Raised when a configured LLM provider fails at runtime."""


SYSTEM_PROMPT = """You are Sentiora, a private intelligent memory assistant.
Your ONLY job is to answer questions using the EXACT memory sources supplied below.

Rules:
- Answer ONLY using the supplied memory sources. Do not add outside knowledge.
- Lead with the direct answer. No preamble, no "Based on your memories", no setup commentary.
- Keep the default answer short: 1–3 short paragraphs, or a few bullets when listing points.
- Add more detail only when the question clearly needs it.
- When you draw on a source, cite it inline as [Source N] using the numbering provided.
- If the supplied sources are insufficient to answer, say:
  "I couldn't find enough information in your saved memories to answer that."
- Do NOT mention retrieval mechanics, vector search, embeddings, or your own configuration.
- Do NOT invent URLs, dates, authors, or facts not present in the sources.
- Synthesise across sources when multiple are relevant.
- If the question is about one topic, do not drag in unrelated sources even if they were retrieved.
"""


def _build_context(chunks: list[RetrievedChunk], max_chars: int) -> str:
    """Build a labelled context string for the LLM within a character budget."""
    if not chunks:
        return ""

    per_chunk = max_chars // len(chunks)
    parts: list[str] = []

    for index, chunk in enumerate(chunks, start=1):
        heading = chunk.heading or "General"
        page = f"\nPage: {chunk.page_number}" if chunk.page_number is not None else ""
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


def _excerpt(text: str, limit: int = 420) -> str:
    collapsed = " ".join(text.split())
    if len(collapsed) <= limit:
        return collapsed
    trimmed = collapsed[:limit].rsplit(" ", 1)[0]
    return f"{trimmed}…"


def _local_fallback_answer(chunks: list[RetrievedChunk]) -> str:
    """Deterministic answer from retrieved memory only. Does not invent facts."""
    unique: list[RetrievedChunk] = []
    seen: set[UUID] = set()
    for chunk in chunks:
        if chunk.memory_id in seen:
            continue
        seen.add(chunk.memory_id)
        unique.append(chunk)
        if len(unique) >= 4:
            break

    if len(unique) == 1:
        primary = unique[0]
        title = (primary.title or "Untitled memory").strip()
        body = _excerpt(primary.content)
        return f"Your saved memory '{title}' discusses {body}."

    parts: list[str] = []
    for chunk in unique:
        title = (chunk.title or "Untitled memory").strip()
        parts.append(f"'{title}' discusses {_excerpt(chunk.content, 220)}")
    return "From your saved memories: " + " ".join(parts) + "."


class RagService:
    def __init__(self, retrieval: RetrievalService) -> None:
        self.retrieval = retrieval
        self.settings = get_settings()

    def _llm_configured(self) -> bool:
        if self.settings.llm_provider == "gemini":
            return bool(self.settings.gemini_api_key)
        return bool(self.settings.openai_api_key)

    def ask(
        self,
        user_id: UUID,
        question: str,
        source_type: SourceType | None = None,
        top_k: int | None = None,
        memory_id: UUID | None = None,
    ) -> AskResponse:
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
                used_fallback=False,
            )

        if self._llm_configured():
            try:
                answer = self._complete(question, chunks)
                cleaned = (answer or "").strip()
                if cleaned:
                    insufficient = _looks_insufficient(cleaned)
                    return AskResponse(
                        answer=cleaned,
                        citations=_citations_from_chunks(chunks) if not insufficient else [],
                        insufficient_context=insufficient,
                        used_fallback=False,
                    )
                raise LLMProviderError("The language model returned an empty response.")
            except LLMProviderError:
                raise
            except Exception as exc:
                logger.exception("LLM completion failed for configured provider")
                raise LLMProviderError(str(exc) or type(exc).__name__) from exc

        return AskResponse(
            answer=_local_fallback_answer(chunks),
            citations=_citations_from_chunks(chunks),
            insufficient_context=False,
            used_fallback=True,
        )

    def _complete(self, question: str, chunks: list[RetrievedChunk]) -> str:
        context = _build_context(chunks, self.settings.rag_max_context_chars)

        if self.settings.llm_provider == "gemini":
            return self._complete_gemini(question, context)

        return self._complete_openai(question, context)

    def _complete_openai(self, question: str, context: str) -> str:
        client = OpenAI(api_key=self.settings.openai_api_key, timeout=45.0)
        completion = client.chat.completions.create(
            model=self.settings.openai_chat_model,
            temperature=0.1,
            max_tokens=500,
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

    def _complete_gemini(self, question: str, context: str) -> str:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=self.settings.gemini_api_key)

        prompt = (
            f"Memory sources from my personal vault:\n\n"
            f"{context}\n\n"
            f"---\n\n"
            f"Question: {question}"
        )

        response = client.models.generate_content(
            model=self.settings.gemini_chat_model,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                temperature=0.1,
                max_output_tokens=500,
            ),
        )
        return _gemini_response_text(response)


def _gemini_response_text(response: object) -> str:
    try:
        text = getattr(response, "text", None)
        if isinstance(text, str) and text.strip():
            return text.strip()
    except Exception as exc:
        logger.warning("Gemini response.text is unusable: %s", exc)

    candidates = getattr(response, "candidates", None) or []
    parts: list[str] = []
    for candidate in candidates:
        content = getattr(candidate, "content", None)
        for part in getattr(content, "parts", None) or []:
            value = getattr(part, "text", None)
            if isinstance(value, str) and value.strip():
                parts.append(value.strip())
    if parts:
        return "\n".join(parts)

    raise LLMProviderError("Gemini returned no usable text (blocked, empty, or malformed).")
