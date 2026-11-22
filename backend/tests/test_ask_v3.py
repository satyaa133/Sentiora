"""Ask v3 (REBUILD_PLAN S6): instant answers, the question-bank leg, the AI gate,
one-call AI answers and the answer cache."""

from __future__ import annotations

import threading
import time
from collections.abc import Iterator, Sequence
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any
from uuid import UUID, uuid4

import fakeredis
import pytest
from fastapi.testclient import TestClient

from app.core.config import LOCAL_VECTOR_DIMENSIONS, get_settings
from app.core.db import SessionLocal
from app.core.redis_client import shared_redis
from app.main import app
from app.models.memory_chunk import MemoryChunk
from app.models.memory_item import MemoryItem, SourceType
from app.models.memory_question import MemoryQuestion
from app.services import rag_service
from app.services.ai_gate import AIBusyError, ai_gate
from app.services.answer import extractive
from app.services.answer.extractive import extract_answer, overview_answer
from app.services.llm.structured import TrailerSplitter, parse_trailer, split_trailer
from app.services.rag_service import RagService
from app.services.retrieval_service import RetrievalService, RetrievedChunk
from app.workers.jobs.process_capture import process_capture

client = TestClient(app)

ARTICLE = (
    "Beekeepers calm a hive with cool smoke before they open it. "
    "The smoke masks the alarm scent that guard bees release.\n\n"
    "A hive inspection checks the brood pattern, the stores of honey and the queen. "
    "Inspections are best done on warm, still afternoons when foragers are out.\n\n"
    "Varroa mites are the main pest of honey bees and are counted with a sugar roll."
)


# -- helpers -------------------------------------------------------------------


def _chunk(content: str, *, title: str = "Bees", start: float | None = None) -> RetrievedChunk:
    return RetrievedChunk(
        chunk_id=uuid4(),
        memory_id=uuid4(),
        title=title,
        url="https://bees.example.com/a",
        source_type=SourceType.youtube if start is not None else SourceType.webpage,
        content=content,
        domain="bees.example.com",
        heading=None,
        page_number=None,
        captured_at=datetime.now(UTC),
        distance=0.2,
        start_sec=start,
        end_sec=None if start is None else start + 60,
    )


def _keyword_scorer(question: str, sentences: Sequence[str]) -> list[float]:
    words = {w for w in question.lower().split() if len(w) > 3}
    return [float(sum(w in s.lower() for w in words)) for s in sentences]


def _register(email: str) -> tuple[dict[str, str], UUID]:
    password = "MemoryPassword123!"
    client.post(
        "/api/v1/auth/register",
        json={"privacy_consent_version": "2026-11-20", "email": email, "password": password, "full_name": "Ask Tester"},
    )
    token = client.post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    ).json()["data"]["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    user_id = UUID(client.get("/api/v1/users/me", headers=headers).json()["data"]["id"])
    return headers, user_id


def _save(headers: dict[str, str], slug: str, content: str = ARTICLE) -> UUID:
    created = client.post(
        "/api/v1/memory-items",
        json={
            "source_type": "webpage",
            "url": f"https://bees.example.com/{slug}",
            "title": "Keeping bees",
            "content": content,
        },
        headers=headers,
    ).json()["data"]
    process_capture(created["id"])
    return UUID(created["id"])


def _events(response: Any) -> list[tuple[str, dict[str, Any]]]:
    import json

    events = []
    for block in response.text.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines())
        events.append((lines["event"], json.loads(lines["data"])))
    return events


def _stream(headers: dict[str, str], body: dict[str, Any]) -> dict[str, Any]:
    response = client.post("/api/v1/chat/stream", json=body, headers=headers)
    assert response.status_code == 200, response.text
    return _events(response)[-1][1]


@pytest.fixture
def ai_configured(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """A configured key whose provider records calls instead of making them."""
    settings = get_settings()
    monkeypatch.setattr(settings, "llm_provider", "openrouter")
    monkeypatch.setattr(settings, "openrouter_api_key", "or-test-key")
    calls: list[str] = []

    def fake_stream(self: RagService, backend: Any, prompt: str, system: str) -> Iterator[str]:
        calls.append(prompt)
        yield "Smoke masks the alarm scent [S1].\n<<<META>>>\nmode: memory\n"
        yield "- Why do bees release an alarm scent?"

    monkeypatch.setattr(RagService, "_stream_backend", fake_stream)
    return calls


@pytest.fixture
def redis_cache() -> Iterator[None]:
    shared_redis.use(fakeredis.FakeStrictRedis())
    yield
    shared_redis.use(None)


# -- instant answer (extractive) ---------------------------------------------


def test_instant_answer_quotes_only_source_sentences() -> None:
    chunks = [_chunk(ARTICLE)]
    answer = extract_answer("Why do beekeepers use smoke?", chunks, 1.0, _keyword_scorer)
    assert answer.text is not None and answer.used_sources == ["S1"]
    assert "cool smoke" in answer.text and "[S1]" in answer.text
    # Every quoted sentence exists in the source: nothing is written.
    body = answer.text.replace("[S1]", "").replace("- ", "")
    for line in body.splitlines():
        assert " ".join(line.split()) in " ".join(ARTICLE.split())


def test_instant_answer_takes_at_most_two_sentences_per_source() -> None:
    text = " ".join(f"Smoke fact number {i} about bees and smoke." for i in range(8))
    answer = extract_answer("smoke bees", [_chunk(text)], 0.5, _keyword_scorer)
    assert answer.text is not None
    assert answer.text.count("[S1]") <= 2


def test_nothing_above_the_threshold_is_not_an_answer() -> None:
    answer = extract_answer("How do volcanoes erupt?", [_chunk(ARTICLE)], 1.0, _keyword_scorer)
    assert answer.text is None and answer.used_sources == []


def test_transcript_quotes_carry_their_time_and_the_next_line() -> None:
    words = " ".join(f"w{i}" for i in range(80))
    chunk = _chunk(words + " smoke calms the bees " + words, start=120.0)

    def scorer(question: str, sentences: Sequence[str]) -> list[float]:
        return [5.0 if "smoke" in s else 0.0 for s in sentences]

    answer = extract_answer("smoke", [chunk], 1.0, scorer)
    assert answer.text is not None
    assert answer.text.startswith("(02:")
    assert "smoke calms the bees" in answer.text
    assert len(answer.text.split()) > 30  # the following line came along


def test_overview_reads_the_best_save_in_order() -> None:
    first, second = _chunk("Opening line about hives and bees."), _chunk(ARTICLE)
    second = RetrievedChunk(**{**second.__dict__, "memory_id": first.memory_id})
    answer = overview_answer([first, second])
    assert answer.text is not None and answer.text.startswith("- Opening line")


def test_sentence_budget_is_shared_across_sources() -> None:
    many = " ".join(f"Sentence {i} talks about hives at length." for i in range(80))
    sentences = extractive.split_sentences([_chunk(many), _chunk(ARTICLE)])
    assert len(sentences) == extractive.MAX_SENTENCES
    assert {s.source for s in sentences} == {1, 2}


# -- one-call trailer ------------------------------------------------------------


def test_trailer_split_across_stream_pieces_is_never_shown() -> None:
    splitter = TrailerSplitter()
    shown = "".join(
        splitter.feed(piece)
        for piece in ["Answer [S1].", "\n<<", "<MET", "A>>>\nmode: mixed\n- Next one?"]
    )
    shown += splitter.finish()
    assert shown == "Answer [S1].\n"
    meta = parse_trailer(splitter.trailer)
    assert meta is not None and meta.mode == "mixed" and meta.followUps == ["Next one?"]


def test_text_that_only_looks_like_a_marker_prefix_is_kept() -> None:
    splitter = TrailerSplitter()
    shown = splitter.feed("a << b") + splitter.feed(" <<") + splitter.finish()
    assert shown == "a << b <<"
    assert split_trailer("no trailer") == ("no trailer", None)
    assert parse_trailer("\nnot a mode\n- q?") is None


# -- the instant path calls no provider ------------------------------------------


def test_instant_answers_make_no_external_call(
    monkeypatch: pytest.MonkeyPatch, ai_configured: list[str]
) -> None:
    def forbidden(*args: object, **kwargs: object) -> None:
        raise AssertionError("the instant path called an AI provider")

    monkeypatch.setattr(rag_service, "OpenAI", forbidden)
    monkeypatch.setattr(RagService, "_call_backend", forbidden)
    monkeypatch.setattr(RagService, "_stream_backend", forbidden)
    monkeypatch.setattr("app.services.llm.clients.openai_compatible_client", forbidden)
    headers, _ = _register("v3_no_calls@example.com")
    _save(headers, "no-calls")

    final = _stream(headers, {"question": "Why do beekeepers use cool smoke?"})
    assert final["mode"] == "instant"
    assert "smoke" in final["answer"].lower() and final["usedSources"]
    assert final["aiAvailable"] is True

    data = client.post(
        "/api/v1/chat", json={"question": "How do volcanoes erupt?"}, headers=headers
    ).json()["data"]
    assert data["insufficient_context"] is True and data["mode"] == "memory"


def test_ai_mode_is_one_streamed_call_with_followups(ai_configured: list[str]) -> None:
    headers, _ = _register("v3_ai_mode@example.com")
    _save(headers, "ai-mode")
    final = _stream(
        headers,
        {"question": "Why do beekeepers use cool smoke?", "answer_mode": "ai"},
    )
    assert len(ai_configured) == 1
    assert final["mode"] == "memory"
    assert final["answer"] == "Smoke masks the alarm scent [S1]."
    assert final["followUps"] == ["Why do bees release an alarm scent?"]
    assert final["aiAvailable"] is False


def test_follow_ups_come_from_the_saves_question_bank() -> None:
    headers, user_id = _register("v3_followups@example.com")
    memory_id = _save(headers, "followups")
    with SessionLocal() as db:
        for text in (
            "Why do beekeepers use cool smoke",
            "When is the best time for a hive inspection?",
            "How are varroa mites counted?",
        ):
            db.add(MemoryQuestion(memory_id=memory_id, user_id=user_id, question=text))
        db.commit()
    final = _stream(headers, {"question": "Why do beekeepers use cool smoke?"})
    assert final["followUps"] == [
        "When is the best time for a hive inspection?",
        "How are varroa mites counted?",
    ]


def test_summary_question_on_an_enriched_save_uses_its_summary() -> None:
    headers, _ = _register("v3_summary@example.com")
    memory_id = _save(headers, "summary")
    with SessionLocal() as db:
        item = db.get(MemoryItem, memory_id)
        assert item is not None
        item.summary = "How to keep a calm, healthy hive."
        item.key_points = ["Use cool smoke", "Inspect on warm afternoons"]
        db.commit()
    final = _stream(
        headers, {"question": "Summarize this", "memory_id": str(memory_id)}
    )
    assert final["answer"].startswith("How to keep a calm, healthy hive. [S1]")
    assert "- Use cool smoke" in final["answer"]


# -- question-bank leg -----------------------------------------------------------


class _OneHot:
    model_id = "local:nomic-ai/nomic-embed-text-v1.5-Q"
    dimensions = LOCAL_VECTOR_DIMENSIONS

    def embed_query(self, text: str) -> list[float]:
        return _one_hot(0)


def _one_hot(slot: int) -> list[float]:
    vector = [0.0] * LOCAL_VECTOR_DIMENSIONS
    vector[slot] = 1.0
    return vector


def test_question_bank_finds_a_chunk_the_other_legs_miss(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers, user_id = _register("v3_bank@example.com")
    memory_id = _save(headers, "bank")
    with SessionLocal() as db:
        chunks = db.query(MemoryChunk).filter(MemoryChunk.memory_id == memory_id).all()
        for chunk in chunks:  # far from every query
            chunk.embedding_local = _one_hot(5)
        db.add(
            MemoryQuestion(
                memory_id=memory_id,
                user_id=user_id,
                chunk_id=chunks[0].id,
                question="Why do keepers puff smoke at hives?",
                embedding_local=_one_hot(0),
            )
        )
        db.commit()
        target = chunks[0].id
    monkeypatch.setattr(
        "app.services.retrieval_service.get_embedding_adapter", lambda: _OneHot()
    )
    monkeypatch.setattr(get_settings(), "rag_min_similarity", 0.65)
    monkeypatch.setattr(get_settings(), "rag_question_min_similarity", 0.60)

    query = "quietening a colony"  # no shared words, vector far from every chunk
    with SessionLocal() as db:
        found = RetrievalService(db).retrieve_relevant_memories(user_id=user_id, query=query)
        assert [c.chunk_id for c in found] == [target]
        without = RetrievalService(db)
        without.use_question_bank = False
        assert without.retrieve_relevant_memories(user_id=user_id, query=query) == []
        # Another user's questions are never used.
        other = RetrievalService(db).retrieve_relevant_memories(user_id=uuid4(), query=query)
        assert other == []


def test_question_bank_has_its_own_bar(monkeypatch: pytest.MonkeyPatch) -> None:
    """D14: a stored question at 0.62 similarity passes 0.60 but not 0.65."""
    headers, user_id = _register("v3_bank_bar@example.com")
    memory_id = _save(headers, "bank-bar")
    close = [0.0] * LOCAL_VECTOR_DIMENSIONS
    close[0], close[1] = 0.62, (1 - 0.62**2) ** 0.5  # cosine 0.62 to the query
    with SessionLocal() as db:
        chunk = db.query(MemoryChunk).filter(MemoryChunk.memory_id == memory_id).first()
        assert chunk is not None
        db.add(
            MemoryQuestion(
                memory_id=memory_id,
                user_id=user_id,
                chunk_id=chunk.id,
                question="Why do keepers puff smoke at hives?",
                embedding_local=close,
            )
        )
        db.commit()
    monkeypatch.setattr(
        "app.services.retrieval_service.get_embedding_adapter", lambda: _OneHot()
    )
    settings = get_settings()
    monkeypatch.setattr(settings, "rag_min_similarity", 0.65)
    with SessionLocal() as db:
        monkeypatch.setattr(settings, "rag_question_min_similarity", 0.60)
        found = RetrievalService(db).retrieve_relevant_memories(
            user_id=user_id, query="quietening a colony"
        )
        assert [c.memory_id for c in found] == [memory_id]
        monkeypatch.setattr(settings, "rag_question_min_similarity", 0.65)
        assert RetrievalService(db).retrieve_relevant_memories(
            user_id=user_id, query="quietening a colony"
        ) == []


# -- AI gate --------------------------------------------------------------------


def _parallel_ai_requests(
    monkeypatch: pytest.MonkeyPatch, limit: int, requests: int
) -> tuple[int, int, int]:
    """(most provider calls at once, answers, AI_BUSY) for parallel AI requests."""
    settings = get_settings()
    monkeypatch.setattr(settings, "llm_max_concurrent", limit)
    monkeypatch.setattr(settings, "llm_provider", "openrouter")
    monkeypatch.setattr(settings, "openrouter_api_key", "or-test-key")
    lock = threading.Lock()
    state = {"now": 0, "peak": 0}

    def slow_stream(self: RagService, backend: Any, prompt: str, system: str) -> Iterator[str]:
        with lock:
            state["now"] += 1
            state["peak"] = max(state["peak"], state["now"])
        try:
            time.sleep(0.3)
            yield "Smoke calms bees [S1]."
        finally:
            with lock:
                state["now"] -= 1

    monkeypatch.setattr(RagService, "_stream_backend", slow_stream)

    class Retrieval:
        db = None

        def retrieve_relevant_memories(self, **kwargs: Any) -> list[RetrievedChunk]:
            return [_chunk(ARTICLE)]

    results: list[str] = []
    barrier = threading.Barrier(requests)

    def ask() -> None:
        service = RagService(Retrieval())  # type: ignore[arg-type]
        barrier.wait()
        try:
            prepared = service.prepare(uuid4(), "Why use smoke?", answer_mode="ai")
        except AIBusyError as exc:
            assert exc.retry_after >= 1
            results.append("busy")
            return
        events = list(service.run(prepared))
        results.append("answer" if events[-1].name == "final" else "error")

    threads = [threading.Thread(target=ask) for _ in range(requests)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert ai_gate.in_use() == 0  # every slot was given back
    return state["peak"], results.count("answer"), results.count("busy")


def test_fifty_parallel_ai_requests_respect_the_limit_through_redis(
    monkeypatch: pytest.MonkeyPatch, redis_cache: None
) -> None:
    peak, answers, busy = _parallel_ai_requests(monkeypatch, limit=10, requests=50)
    assert peak <= 10
    assert answers >= 1 and answers + busy == 50 and busy >= 1


def test_the_limit_holds_in_process_without_redis(monkeypatch: pytest.MonkeyPatch) -> None:
    peak, answers, busy = _parallel_ai_requests(monkeypatch, limit=3, requests=12)
    assert peak <= 3 and answers + busy == 12 and busy >= 1


def test_ai_busy_is_a_clean_429(monkeypatch: pytest.MonkeyPatch, ai_configured: list[str]) -> None:
    def full() -> None:
        raise AIBusyError(7)

    monkeypatch.setattr(ai_gate, "acquire", full)
    headers, _ = _register("v3_busy@example.com")
    _save(headers, "busy")
    body = {"question": "Why do beekeepers use cool smoke?", "answer_mode": "ai"}
    for path in ("/api/v1/chat", "/api/v1/chat/stream"):
        response = client.post(path, json=body, headers=headers)
        assert response.status_code == 429
        assert response.headers["Retry-After"] == "7"
        error = response.json()["error"]
        assert error["code"] == "AI_BUSY" and error["details"] == {"retry_after": 7}
    assert ai_configured == []
    # The instant answer is never gated.
    assert client.post(
        "/api/v1/chat", json={"question": body["question"]}, headers=headers
    ).status_code == 200


# -- answer cache ------------------------------------------------------------------


def test_cache_reuses_answers_and_sources_until_the_library_changes(
    monkeypatch: pytest.MonkeyPatch, redis_cache: None, ai_configured: list[str]
) -> None:
    calls = {"retrieve": 0}
    original = RetrievalService.retrieve_relevant_memories

    def counting(self: RetrievalService, **kwargs: Any) -> list[RetrievedChunk]:
        calls["retrieve"] += 1
        return original(self, **kwargs)

    monkeypatch.setattr(RetrievalService, "retrieve_relevant_memories", counting)
    headers, _ = _register("v3_cache@example.com")
    _save(headers, "cache")
    question = {"question": "Why do beekeepers use cool smoke?"}

    first = _stream(headers, question)
    again = _stream(headers, {"question": "why do beekeepers use cool smoke"})
    assert again == first and calls["retrieve"] == 1

    # "Explain with AI" answers from the same sources: no second retrieval.
    ai = _stream(headers, {**question, "answer_mode": "ai"})
    assert ai["mode"] == "memory" and calls["retrieve"] == 1
    assert _stream(headers, {**question, "answer_mode": "ai"}) == ai
    assert len(ai_configured) == 1

    # POST /chat reads the same cached answer in its own shape.
    data = client.post("/api/v1/chat", json=question, headers=headers).json()["data"]
    assert data["citations"] and calls["retrieve"] == 1

    _save(headers, "cache-2", "Queens lay up to two thousand eggs a day in summer.")
    _stream(headers, question)
    assert calls["retrieve"] == 2


def test_a_scope_or_another_user_never_shares_an_entry(redis_cache: None) -> None:
    headers, _ = _register("v3_cache_scope@example.com")
    memory_id = _save(headers, "scope")
    other, _ = _register("v3_cache_other@example.com")
    question = "Why do beekeepers use cool smoke?"
    mine = _stream(headers, {"question": question})
    assert mine["usedSources"]
    theirs = _stream(other, {"question": question})
    assert theirs["insufficient_context"] is True
    scoped = _stream(headers, {"question": question, "memory_id": str(memory_id)})
    assert scoped["usedSources"]


def test_settings_document_the_s6_defaults() -> None:
    settings = SimpleNamespace(**get_settings().model_dump())
    assert settings.ask_default_mode == "instant"
    assert settings.llm_max_concurrent == 10
    assert settings.answer_cache_ttl_seconds == 86400
    assert settings.rag_question_min_similarity == 0.60
