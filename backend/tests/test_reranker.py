"""S4: cross-encoder reranking of the fused retrieval candidates."""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest

from app.core.config import get_settings
from app.models.memory_item import SourceType
from app.services.retrieval import reranker as reranker_module
from app.services.retrieval.reranker import (
    RerankerService,
    get_reranker,
    passage_text,
)
from app.services.retrieval_service import RetrievalService, RetrievedChunk


def _chunk(memory_id: UUID, content: str, distance: float, title: str = "Notes") -> RetrievedChunk:
    return RetrievedChunk(
        chunk_id=uuid4(),
        memory_id=memory_id,
        title=title,
        url="https://notes.example.com/page",
        source_type=SourceType.webpage,
        content=content,
        domain="notes.example.com",
        heading=None,
        page_number=None,
        captured_at=datetime.now(UTC),
        distance=distance,
    )


class _KeywordReranker:
    """Scores a passage by whether it contains the keyword; records its input."""

    def __init__(self, keyword: str, fail: bool = False) -> None:
        self.keyword = keyword
        self.fail = fail
        self.seen: list[str] = []

    def score(self, query: str, passages: Sequence[str]) -> list[float]:
        if self.fail:
            raise RuntimeError("model crashed")
        self.seen = list(passages)
        return [5.0 if self.keyword in p else -5.0 for p in passages]


def _service(monkeypatch: pytest.MonkeyPatch, reranker: object | None, **settings: object) -> RetrievalService:
    monkeypatch.setattr("app.services.retrieval_service.get_reranker", lambda: reranker)
    service = RetrievalService.__new__(RetrievalService)
    service.settings = type("S", (), settings)()
    return service


def _candidates() -> tuple[RetrievedChunk, RetrievedChunk, RetrievedChunk]:
    """Fusion ranks the overview first; the answer is second in both legs."""
    overview = _chunk(uuid4(), "an overview of deadlocks and why they happen", 0.30)
    answer = _chunk(uuid4(), "the four coffman conditions are mutual exclusion and hold and wait", 0.32)
    aside = _chunk(uuid4(), "livelock is a different problem from a later paper", 0.40)
    return overview, answer, aside


def test_reranker_puts_the_answering_passage_first(monkeypatch: pytest.MonkeyPatch) -> None:
    overview, answer, aside = _candidates()
    service = _service(monkeypatch, _KeywordReranker("coffman"))
    picked = service._select(
        [overview, answer, aside], [overview, answer], limit=2, per_memory=2,
        query="what conditions cause a deadlock",
    )
    assert picked[0].chunk_id == answer.chunk_id


def test_without_reranker_fused_order_is_kept(monkeypatch: pytest.MonkeyPatch) -> None:
    overview, answer, aside = _candidates()
    service = _service(monkeypatch, None)
    picked = service._select(
        [overview, answer, aside], [overview, answer], limit=2, per_memory=2, query="q"
    )
    assert picked[0].chunk_id == overview.chunk_id


def test_reranker_failure_keeps_fused_order(monkeypatch: pytest.MonkeyPatch) -> None:
    overview, answer, aside = _candidates()
    service = _service(monkeypatch, _KeywordReranker("coffman", fail=True))
    picked = service._select(
        [overview, answer, aside], [overview, answer], limit=2, per_memory=2, query="q"
    )
    assert picked[0].chunk_id == overview.chunk_id


def test_only_the_top_candidates_are_scored(monkeypatch: pytest.MonkeyPatch) -> None:
    memory = uuid4()
    chunks = [_chunk(memory, f"passage number {i} about topic {i}", 0.2 + i / 100) for i in range(8)]
    # The best answer is ranked 6th by fusion: outside a 4-candidate window.
    chunks[5] = _chunk(memory, "coffman conditions explained", 0.25)
    reranker = _KeywordReranker("coffman")
    service = _service(monkeypatch, reranker, rag_rerank_candidates=4)
    picked = service._select(chunks, [], limit=3, per_memory=3, query="q")
    assert len(reranker.seen) == 4
    assert all(c.chunk_id != chunks[5].chunk_id for c in picked)
    # Never fewer candidates than the answer needs.
    service = _service(monkeypatch, reranker, rag_rerank_candidates=1)
    service._select(chunks, [], limit=3, per_memory=3, query="q")
    assert len(reranker.seen) == 3


def test_passage_text_leads_with_title_and_heading_and_is_capped() -> None:
    text = passage_text("Deadlocks", "Coffman", "word  " * 2000)
    assert text.startswith("Deadlocks\nCoffman\nword word")
    assert len(text) == reranker_module._MAX_PASSAGE_CHARS


class _FakeCrossEncoder:
    instances = 0
    batch_sizes: list[int] = []

    def __init__(self, model_name: str, cache_dir: str | None = None) -> None:
        _FakeCrossEncoder.instances += 1

    def rerank(self, query: str, documents: Iterable[str], batch_size: int = 64) -> Iterable[float]:
        _FakeCrossEncoder.batch_sizes.append(batch_size)
        return [float(len(d)) for d in documents]


@pytest.fixture
def fake_model(monkeypatch: pytest.MonkeyPatch) -> None:
    import fastembed.rerank.cross_encoder as cross_encoder

    monkeypatch.setattr(cross_encoder, "TextCrossEncoder", _FakeCrossEncoder)
    monkeypatch.setattr(reranker_module, "_models", {})
    monkeypatch.setattr(get_settings(), "reranker_model", "jinaai/jina-reranker-v1-tiny-en")
    _FakeCrossEncoder.instances = 0
    _FakeCrossEncoder.batch_sizes = []


def test_reranker_is_off_when_set_to_none(monkeypatch: pytest.MonkeyPatch) -> None:
    for value in ("none", "", "OFF"):
        monkeypatch.setattr(get_settings(), "reranker_model", value)
        assert get_reranker() is None


def test_model_loads_once_and_scores_one_passage_at_a_time(fake_model: None) -> None:
    first = get_reranker()
    second = get_reranker()
    assert first is not None and second is not None
    assert first.score("q", ["a", "bbb"]) == [1.0, 3.0]
    assert _FakeCrossEncoder.instances == 1
    assert _FakeCrossEncoder.batch_sizes == [1]


def test_a_model_that_fails_to_load_turns_reranking_off(
    fake_model: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    def broken(*args: object, **kwargs: object) -> None:
        raise OSError("model files missing")

    monkeypatch.setattr(reranker_module, "load_reranker", broken)
    assert get_reranker() is None


def _real_model_cached() -> bool:
    cache = get_settings().model_cache_path
    return cache.exists() and any(cache.glob("*jina-reranker-v1-tiny-en*"))


@pytest.mark.skipif(not _real_model_cached(), reason="reranker model not downloaded")
def test_real_reranker_prefers_the_answering_passage(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "reranker_model", "jinaai/jina-reranker-v1-tiny-en")
    scores = RerankerService().score(
        "How does TCP establish a connection?",
        [
            "TCP opens a connection with a three-way handshake: SYN, SYN-ACK, then ACK.",
            "UDP sends datagrams without setting up a connection first.",
        ],
    )
    assert scores[0] > scores[1]


# -- veto (D16) ---------------------------------------------------------------


def _keyword_only(content: str) -> RetrievedChunk:
    from dataclasses import replace

    return replace(_chunk(uuid4(), content, 0.0), distance=None, lexical=True, rank=3.0)


def test_veto_drops_keyword_only_hits_the_reranker_rejects(monkeypatch: pytest.MonkeyPatch) -> None:
    # "single pass" in PR notes is not an answer to a YOLO question.
    stray = _keyword_only("this must pass completely in a single run of the checks")
    service = _service(monkeypatch, _KeywordReranker("yolo"), rag_rerank_min_score=-0.6)
    assert service._select([], [stray], limit=6, per_memory=2, query="how does yolo detect objects in a single pass") == []


def test_veto_keeps_meaning_matches_and_keyword_hits_it_likes(monkeypatch: pytest.MonkeyPatch) -> None:
    by_meaning = _chunk(uuid4(), "object detectors look at the image once", 0.30)  # scores -5 but matched by vector
    keyword_hit = _keyword_only("yolo divides the image into a grid")  # scores +5
    stray = _keyword_only("this must pass completely")  # scores -5, keywords only
    service = _service(monkeypatch, _KeywordReranker("yolo"), rag_rerank_min_score=-0.6)
    picked = service._select(
        [by_meaning], [keyword_hit, stray], limit=6, per_memory=2, query="yolo single pass"
    )
    assert {c.chunk_id for c in picked} == {by_meaning.chunk_id, keyword_hit.chunk_id}


def test_veto_is_off_when_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    stray = _keyword_only("this must pass completely")
    service = _service(monkeypatch, _KeywordReranker("yolo"), rag_rerank_min_score=None)
    assert [c.chunk_id for c in service._select([], [stray], limit=6, per_memory=2, query="q")] == [stray.chunk_id]
