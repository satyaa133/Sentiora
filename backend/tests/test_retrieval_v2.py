"""Hybrid retrieval: RRF, threshold, MMR, per-memory cap, rewrite, isolation."""

from __future__ import annotations

import zlib
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.db import SessionLocal
from app.main import app
from app.schemas.ask import AskTurn
from app.services.rag_service import RagService
from app.services.retrieval import selection
from app.services.retrieval.query_rewriter import (
    REWRITE_SYSTEM_PROMPT,
    heuristic_query,
    rewrite_query,
)
from app.services.retrieval_service import RetrievalService
from app.workers.jobs.process_capture import process_capture

client = TestClient(app)

# --- selection helpers -----------------------------------------------------------


def test_rrf_rewards_items_found_by_both_legs() -> None:
    scores = selection.rrf([["a", "b"], ["b", "c"]])
    assert scores["b"] > scores["a"] > scores["c"]
    assert scores["a"] == pytest.approx(1 / 61)


def test_near_duplicates_are_dropped() -> None:
    text = "binary search halves the sorted range on every comparison until found"
    kept = selection.drop_near_duplicates(
        [text, text + " quickly", "hash tables map keys to buckets"], str
    )
    assert kept == [text, "hash tables map keys to buckets"]


def test_mmr_caps_items_per_group_and_prefers_diversity() -> None:
    items = [("m1", "a"), ("m1", "b"), ("m1", "c"), ("m2", "d")]
    relevance = {"a": 1.0, "b": 0.95, "c": 0.9, "d": 0.6}
    picked = selection.mmr(
        items,
        relevance=lambda item: relevance[item[1]],
        similarity=lambda x, y: 1.0 if x[0] == y[0] else 0.0,
        limit=3,
        group=lambda item: item[0],
        per_group=2,
    )
    assert [item[1] for item in picked] == ["a", "d", "b"]


# --- query rewriting -------------------------------------------------------------

HISTORY = [
    AskTurn(role="user", content="What does the Rotate Array video cover?"),
    AskTurn(
        role="assistant", content="It covers brute force, better and optimal rotation."
    ),
]


def test_rewrite_skipped_without_history() -> None:
    def explode(prompt: str, system: str) -> str:
        raise AssertionError("no LLM call expected")

    assert rewrite_query("What is a heap?", [], explode) == "What is a heap?"


def test_rewrite_uses_llm_output() -> None:
    calls: list[str] = []

    def complete(prompt: str, system: str) -> str:
        calls.append(system)
        return 'Query: "optimal approach to rotate an array by K places"\n'

    query = rewrite_query("what about the optimal one?", HISTORY, complete)
    assert query == "optimal approach to rotate an array by K places"
    assert calls == [REWRITE_SYSTEM_PROMPT]


@pytest.mark.parametrize("output", ["", "   ", "x" * 400])
def test_rewrite_falls_back_on_unusable_output(output: str) -> None:
    question = "and the second one?"
    assert rewrite_query(question, HISTORY, lambda p, s: output) == heuristic_query(
        question, HISTORY
    )


def test_rewrite_falls_back_when_provider_fails() -> None:
    def fail(prompt: str, system: str) -> str:
        raise RuntimeError("402")

    assert "Rotate Array" in rewrite_query("and the second one?", HISTORY, fail)


# --- database-backed retrieval ---------------------------------------------------

# Concept buckets: synonyms land in the same dimension, so a paraphrase with no
# shared keyword still embeds close to the stored text.
_CONCEPTS = {
    "automobile": "car", "vehicle": "car", "car": "car", "cars": "car",
    "motor": "engine", "motors": "engine", "engine": "engine", "engines": "engine",
    "combustion": "burn", "burn": "burn", "burns": "burn", "ignite": "burn", "ignites": "burn",
}  # fmt: skip


class ConceptAdapter:
    model_id = "test:concepts"

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        vectors = []
        for text in texts:
            vec = [0.0] * 1536
            for word in text.lower().replace(".", " ").replace("?", " ").split():
                vec[zlib.crc32(_CONCEPTS.get(word, word).encode()) % 1536] += 1.0
            norm = sum(v * v for v in vec) ** 0.5 or 1.0
            vectors.append([v / norm for v in vec])
        return vectors


CAR_TEXT = (
    "Cars use an engine where fuel burns. The engine ignites fuel in cylinders. " * 3
)
LONG_CAR_TEXT = "\n\n".join(
    f"Section {i}. Cars and their engine design part {i}. "
    + "The engine burns fuel to move cars forward. " * 40
    for i in range(6)
)
GARDEN_TEXT = "Tomatoes need full sun, deep watering and a trellis to climb. " * 4


def _user(email: str) -> tuple[dict[str, str], UUID]:
    password = "MemoryPassword123!"
    client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "full_name": "Retrieval Tester"},
    )
    token = client.post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    ).json()["data"]["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    return headers, UUID(
        client.get("/api/v1/users/me", headers=headers).json()["data"]["id"]
    )


def _save(headers: dict[str, str], slug: str, title: str, content: str) -> UUID:
    created = client.post(
        "/api/v1/memory-items",
        json={
            "source_type": "webpage",
            "url": f"https://notes.example.com/{slug}",
            "title": title,
            "content": content,
        },
        headers=headers,
    ).json()["data"]
    process_capture(created["id"])
    return UUID(created["id"])


@pytest.fixture
def concepts(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.workers.jobs.process_capture.get_embedding_adapter",
        lambda: ConceptAdapter(),
    )
    monkeypatch.setattr(
        "app.services.retrieval_service.get_embedding_adapter", lambda: ConceptAdapter()
    )


def _retrieve(user_id: UUID, query: str, **kwargs: object) -> list:
    with SessionLocal() as db:
        return RetrievalService(db).retrieve_relevant_memories(
            user_id=user_id, query=query, **kwargs
        )  # type: ignore[arg-type]


def test_paraphrase_without_shared_keywords_is_found(concepts: None) -> None:
    headers, user_id = _user("retr_paraphrase@example.com")
    car = _save(headers, "car", "How cars work", CAR_TEXT)
    _save(headers, "garden", "Growing tomatoes", GARDEN_TEXT)

    hits = _retrieve(user_id, "how does an automobile motor ignite combustion")
    assert hits and hits[0].memory_id == car
    assert hits[0].distance is not None and hits[0].rank == 0.0  # vector-only match


def test_fulltext_leg_finds_stemmed_terms(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.services.retrieval_service.get_embedding_adapter", lambda: None
    )
    headers, user_id = _user("retr_fulltext@example.com")
    garden = _save(headers, "garden", "Growing tomatoes", GARDEN_TEXT)
    hits = _retrieve(user_id, "watering tomato trellises")
    assert hits and hits[0].memory_id == garden and hits[0].rank > 0


def test_unrelated_question_is_not_covered(concepts: None) -> None:
    headers, user_id = _user("retr_uncovered@example.com")
    _save(headers, "car", "How cars work", CAR_TEXT)
    assert _retrieve(user_id, "explain quantum entanglement experiments") == []


def test_chunks_per_memory_are_capped(concepts: None) -> None:
    headers, user_id = _user("retr_cap@example.com")
    long_car = _save(headers, "long-car", "Engine design notes", LONG_CAR_TEXT)
    hits = _retrieve(user_id, "how do car engines burn fuel")
    assert 0 < sum(h.memory_id == long_car for h in hits) <= 2
    # Scoped to that memory, the cap no longer applies.
    scoped = _retrieve(user_id, "how do car engines burn fuel", memory_id=long_car)
    assert len(scoped) > 2


def test_other_users_memories_are_never_returned(concepts: None) -> None:
    owner_headers, _ = _user("retr_owner@example.com")
    _save(owner_headers, "car", "How cars work", CAR_TEXT)
    _, other_id = _user("retr_other@example.com")
    assert _retrieve(other_id, "how do car engines burn fuel") == []


def test_ask_retrieves_with_the_rewritten_follow_up(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: list[str] = []

    def fake_retrieve(self: RetrievalService, **kwargs: object) -> list:
        seen.append(str(kwargs["query"]))
        return []

    def fake_complete(self: RagService, prompt: str, system_prompt: str) -> str:
        if system_prompt == REWRITE_SYSTEM_PROMPT:
            return "optimal approach to rotate an array by K places"
        return "General answer."

    monkeypatch.setattr(RetrievalService, "retrieve_relevant_memories", fake_retrieve)
    monkeypatch.setattr(RagService, "_llm_configured", lambda self: True)
    monkeypatch.setattr(RagService, "_complete_raw", fake_complete)
    with SessionLocal() as db:
        RagService(RetrievalService(db)).ask(
            user_id=UUID(int=1), question="what about the optimal one?", history=HISTORY
        )
    assert seen == ["optimal approach to rotate an array by K places"]


def test_min_similarity_setting_is_respected(
    concepts: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    headers, user_id = _user("retr_threshold@example.com")
    _save(headers, "car", "How cars work", CAR_TEXT)
    monkeypatch.setattr(get_settings(), "rag_min_similarity", 0.99)
    assert _retrieve(user_id, "automobile motor ignite combustion") == []


def test_standalone_question_with_history_is_not_rewritten() -> None:
    def explode(prompt: str, system: str) -> str:
        raise AssertionError("standalone questions must not cost a model call")

    question = "How do I avoid overflow when computing the midpoint in binary search?"
    assert rewrite_query(question, HISTORY, explode) == question


def test_two_word_keyword_only_hit_needs_both_words_when_vectors_work(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.workers.jobs.process_capture.get_embedding_adapter", lambda: ConceptAdapter())
    headers, user_id = _user("retr_two_words@example.com")
    garden = _save(headers, "garden", "Growing tomatoes", GARDEN_TEXT)

    # Vector leg active: "trellis" alone is not enough for "trellis australia".
    monkeypatch.setattr("app.services.retrieval_service.get_embedding_adapter", lambda: ConceptAdapter())
    assert _retrieve(user_id, "trellis australia") == []
    assert _retrieve(user_id, "tomato trellis")[0].memory_id == garden

    # Keyword-only search (no embeddings) keeps the lenient one-word rule.
    monkeypatch.setattr("app.services.retrieval_service.get_embedding_adapter", lambda: None)
    assert _retrieve(user_id, "trellis australia")[0].memory_id == garden
