"""Ask answer modes (memory / general / combined), timeline filters and stats."""

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient

from app.core.db import SessionLocal
from app.main import app
from app.models.memory_item import ItemStatus, MemoryItem, SourceType
from app.services.ask_intent import classify, is_followup, parse_date_window, topic_of
from app.services.llm.structured import normalize_markers, strip_unknown_markers
from app.services.rag_service import _to_legacy_markers
from app.services.retrieval_service import RetrievedChunk, RetrievalService

client = TestClient(app)

ARTICLE = (
    "Binary search repeatedly halves the search interval. It compares the target "
    "with the middle element, then continues on one side of the sorted collection."
)
VIDEO = (
    "Sliding window lecture notes. A fixed-size window keeps a running sum and "
    "slides by adding the next element and dropping the first element."
)

_LLM_SETTINGS = {
    "llm_provider": "openai",
    "openai_api_key": "sk-test",
    "gemini_api_key": None,
    "openrouter_api_key": None,
    "openrouter_chat_model": "anthropic/claude-3-haiku",
    "openai_chat_model": "gpt-4o-mini",
    "rag_top_k": 8,
    "rag_max_distance": 0.65,
    "rag_strong_distance": 0.4,
    "rag_max_context_chars": 6000,
}


def _auth_headers(email: str) -> dict[str, str]:
    password = "MemoryPassword123!"
    client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "full_name": "Echo Tester"},
    )
    login = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    return {"Authorization": f"Bearer {login.json()['data']['access_token']}"}


def _create(
    headers: dict[str, str],
    title: str,
    content: str,
    source_type: str = "webpage",
    url: str | None = None,
    captured_at: datetime | None = None,
) -> str:
    payload: dict[str, Any] = {
        "source_type": source_type,
        "url": url or f"https://docs.example.com/{uuid4().hex[:8]}",
        "title": title,
        "content": content,
    }
    if captured_at is not None:
        payload["captured_at"] = captured_at.isoformat()
    resp = client.post("/api/v1/memory-items", json=payload, headers=headers)
    assert resp.status_code == 201, resp.text
    # Tests run without RQ, so creation processes the capture inline.
    return str(resp.json()["data"]["id"])


def _with_llm(monkeypatch, reply: str | None = None, calls: list[dict[str, Any]] | None = None) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr("app.services.retrieval_service.get_embedding_adapter", lambda: None)
    monkeypatch.setattr(
        "app.services.rag_service.get_settings", lambda: type("S", (), _LLM_SETTINGS)()
    )

    def fake_complete(self, question, chunks, **kwargs):  # type: ignore[no-untyped-def]
        if calls is not None:
            calls.append({"question": question, "chunks": chunks, **kwargs})
        return reply or "A general answer.\n\nExample: 1, 2, 3."

    monkeypatch.setattr("app.services.rag_service.RagService._complete", fake_complete)


def _without_llm(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr("app.services.retrieval_service.get_embedding_adapter", lambda: None)
    settings = dict(_LLM_SETTINGS, openai_api_key=None)
    monkeypatch.setattr("app.services.rag_service.get_settings", lambda: type("S", (), settings)())


def _ask(headers: dict[str, str], question: str, **extra: Any) -> dict[str, Any]:
    resp = client.post("/api/v1/chat", json={"question": question, **extra}, headers=headers)
    assert resp.status_code == 200, resp.text
    return dict(resp.json()["data"])


# -- intent -------------------------------------------------------------------


def test_classify_routes_the_four_question_shapes() -> None:
    assert classify("What is sliding window?").kind == "open"
    combined = classify("Explain sliding window based on the playlist I saved")
    assert combined.kind == "combined"
    assert combined.source_type == SourceType.youtube
    listing = classify("What did I capture yesterday?")
    assert listing.kind == "personal" and listing.listing
    mention = classify("Which sources mention RAG?")
    assert mention.mention_topic == "RAG"
    assert classify("Summarize the video").kind == "personal"
    # Words that look like saves inside a concept are not personal.
    assert classify("What is the page rank algorithm?").kind == "open"
    assert classify("What is a video codec?").source_type is None


def test_parse_date_window_uses_the_user_time_zone() -> None:
    zone = ZoneInfo("Asia/Kolkata")
    now = datetime(2026, 10, 27, 1, 0, tzinfo=UTC)  # 06:30 on the 27th in India
    window = parse_date_window("what did I save yesterday", zone, now)
    assert window is not None
    assert window.start == datetime(2026, 10, 25, 18, 30, tzinfo=UTC)
    assert window.end == datetime(2026, 10, 26, 18, 30, tzinfo=UTC)
    week = parse_date_window("this week", zone, now)
    assert week is not None and week.start.astimezone(zone).weekday() == 0
    assert parse_date_window("what is a heap", zone, now) is None


def test_followup_and_topic_helpers() -> None:
    assert is_followup("Can you give another example?")
    assert is_followup("why is that?")
    assert not is_followup("What is a binary heap and how is it stored in an array?")
    assert topic_of("What is a binary heap?") == "binary heap"
    assert topic_of("Explain sliding window based on the playlist I saved") == "sliding window"


def test_citation_markers_are_normalized_validated_and_renumbered() -> None:
    text = normalize_markers("First [Source 3]. Then [S9]. Both [S1, S3].")
    text = strip_unknown_markers(text, source_count=3)
    assert text == "First [S3]. Then. Both [S1][S3]."
    legacy, order = _to_legacy_markers(text, ["S3", "S1"])
    assert legacy == "First [1]. Then. Both [2][1]."
    assert order == [3, 1]


def test_fusion_keeps_a_strong_semantic_hit_without_keyword_overlap() -> None:
    def chunk(distance: float | None, rank: float) -> RetrievedChunk:
        return RetrievedChunk(
            chunk_id=uuid4(),
            memory_id=uuid4(),
            title="t",
            url="https://x.example",
            source_type=SourceType.webpage,
            content=uuid4().hex,
            domain=None,
            heading=None,
            page_number=None,
            captured_at=datetime.now(UTC),
            distance=distance,
            lexical=distance is None,
            rank=rank,
        )

    service = RetrievalService.__new__(RetrievalService)
    service.settings = type("S", (), {})()
    keyword = chunk(None, 3.0)
    strong = chunk(0.2, 0.0)
    fused = service._select([strong], [keyword], limit=6, per_memory=2)
    ids = [c.chunk_id for c in fused]
    # Meaning-only hits (already past the similarity threshold) are kept next
    # to keyword hits: natural-language questions rarely share the words.
    assert keyword.chunk_id in ids and strong.chunk_id in ids


# -- answer modes -------------------------------------------------------------


def test_general_question_without_memory_gets_a_general_answer(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    calls: list[dict[str, Any]] = []
    _with_llm(monkeypatch, "A binary heap is a complete binary tree.\n\nExample: [1, 3, 2]", calls)
    headers = _auth_headers("echo_general@example.com")
    data = _ask(headers, "What is a binary heap?")
    assert data["mode"] == "general"
    assert data["citations"] == []
    assert data["insufficient_context"] is False
    assert "complete binary tree" in data["answer"]
    assert calls and calls[0]["chunks"] == []
    # Follow-ups come from the structured call only (offline in tests): no templates.
    assert data["suggested_followups"] == []


def test_general_question_without_llm_says_the_model_is_missing(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _without_llm(monkeypatch)
    headers = _auth_headers("echo_nollm@example.com")
    data = _ask(headers, "What is a binary heap?")
    assert data["insufficient_context"] is True
    assert data["citations"] == []
    assert "not configured" in data["answer"]


def test_unrelated_memory_is_not_cited_for_a_general_answer(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _with_llm(monkeypatch, "Sorting arranges items in order. Example: [3,1,2] -> [1,2,3].")
    headers = _auth_headers("echo_unrelated@example.com")
    _create(headers, "Binary Search Explained", ARTICLE)
    data = _ask(headers, "What is sorting in a sorted collection?")
    assert data["mode"] == "general"
    assert data["citations"] == []


def test_combined_answer_is_one_unified_cited_answer(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    reply = (
        "Binary search finds a value in a sorted array by halving the interval each step "
        "[Source 1], as your article describes; it also cites [Source 4]. More generally, "
        "it runs in O(log n) time."
    )
    _with_llm(monkeypatch, reply)
    monkeypatch.setattr(
        "app.services.rag_service.RagService._call_structured",
        lambda self, backend, prompt, system: (
            '{"mode":"mixed","usedSources":["S1"],"followUps":'
            '["How is binary search different from linear search?"]}'
        ),
    )
    headers = _auth_headers("echo_combined@example.com")
    item_id = _create(headers, "Binary Search Explained", ARTICLE)
    data = _ask(headers, "Explain binary search based on the article I saved")
    assert data["mode"] == "combined"
    assert [c["memory_id"] for c in data["citations"]] == [item_id]
    assert "[Source" not in data["answer"] and "[S" not in data["answer"]
    assert "[1]" in data["answer"] and "[4]" not in data["answer"]
    assert "From your saved memory" not in data["answer"]
    assert data["suggested_followups"] == ["How is binary search different from linear search?"]
    assert data["citations"][0]["excerpt"]
    assert data["citations"][0]["captured_at"]


def test_combined_question_with_no_matching_save_tells_the_model(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    calls: list[dict[str, Any]] = []
    _with_llm(
        monkeypatch,
        "Your saved memories don't cover this, so here's a general answer. "
        "Kubernetes schedules containers.",
        calls,
    )
    headers = _auth_headers("echo_combined_empty@example.com")
    data = _ask(headers, "Explain kubernetes based on the video I saved")
    assert data["mode"] == "general"
    assert data["citations"] == []
    assert "saved material" in calls[0]["system_prompt"]


def test_personal_question_with_no_memory_never_answers_generally(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    calls: list[dict[str, Any]] = []
    _with_llm(monkeypatch, "should not be used", calls)
    headers = _auth_headers("echo_personal_empty@example.com")
    data = _ask(headers, "What did I save about kubernetes?")
    assert data["insufficient_context"] is True
    assert data["mode"] == "memory"
    assert data["citations"] == []
    assert calls == []


def test_listing_question_lists_only_that_day(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    calls: list[dict[str, Any]] = []
    _with_llm(monkeypatch, "unused", calls)
    headers = _auth_headers("echo_listing@example.com")
    now = datetime.now(UTC)
    yesterday_id = _create(headers, "Yesterday Article", ARTICLE, captured_at=now - timedelta(days=1))
    _create(headers, "Older Article", ARTICLE, captured_at=now - timedelta(days=5))
    data = _ask(headers, "What did I capture yesterday?", tz="UTC")
    assert calls == []
    assert [c["memory_id"] for c in data["citations"]] == [yesterday_id]
    assert "You captured 1 memory yesterday" in data["answer"]
    assert data["citations"][0]["chunk_id"] is None

    empty = _ask(headers, "What did I capture today?", tz="UTC")
    assert empty["insufficient_context"] is True
    assert "most recent capture" in empty["answer"]


def test_mention_question_lists_matching_sources_only(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _with_llm(monkeypatch, "unused")
    headers = _auth_headers("echo_mention@example.com")
    article_id = _create(headers, "Binary Search Explained", ARTICLE)
    _create(headers, "Sliding Window Lecture", VIDEO, source_type="youtube",
            url="https://www.youtube.com/watch?v=abc123")
    data = _ask(headers, "Which sources mention halves?")
    assert [c["memory_id"] for c in data["citations"]] == [article_id]
    none = _ask(headers, "Which sources mention kubernetes?")
    assert none["insufficient_context"] is True
    assert none["citations"] == []


def test_followup_uses_history_for_retrieval_and_prompt(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    calls: list[dict[str, Any]] = []
    _with_llm(monkeypatch, "It keeps a running sum [Source 1].", calls)
    headers = _auth_headers("echo_followup@example.com")
    video_id = _create(headers, "Sliding Window Lecture", VIDEO, source_type="youtube",
                       url="https://www.youtube.com/watch?v=def456")
    history = [
        {"role": "user", "content": "What does my sliding window lecture say?"},
        {"role": "assistant", "content": "It covers fixed-size windows."},
    ]
    data = _ask(headers, "Can you give another example?", history=history)
    assert calls, "LLM should be called"
    assert calls[0]["history"][0].content.startswith("What does my sliding window")
    assert [c["memory_id"] for c in data["citations"]] == [video_id]


def test_scoped_question_only_uses_that_memory(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _without_llm(monkeypatch)
    headers = _auth_headers("echo_scoped@example.com")
    _create(headers, "Binary Search Explained", ARTICLE)
    video_id = _create(headers, "Sliding Window Lecture", VIDEO, source_type="youtube",
                       url="https://www.youtube.com/watch?v=ghi789")
    data = _ask(headers, "What is this about?", memory_id=video_id)
    assert {c["memory_id"] for c in data["citations"]} == {video_id}
    by_type = _ask(headers, "What is this about?", source_type="youtube")
    assert {c["memory_id"] for c in by_type["citations"]} == {video_id}


def test_ask_rejects_unknown_time_zone_and_long_history() -> None:
    headers = _auth_headers("echo_validation@example.com")
    bad_tz = client.post(
        "/api/v1/chat", json={"question": "What is a heap?", "tz": "Mars/Olympus"}, headers=headers
    )
    assert bad_tz.status_code == 422
    too_long = client.post(
        "/api/v1/chat",
        json={"question": "and?", "history": [{"role": "user", "content": "x"}] * 5},
        headers=headers,
    )
    assert too_long.status_code == 422


# -- timeline filters ---------------------------------------------------------


def test_memory_list_filters_and_pagination() -> None:
    headers = _auth_headers("echo_filters@example.com")
    now = datetime.now(UTC)
    article_id = _create(headers, "Binary Search Explained", ARTICLE, captured_at=now - timedelta(days=3))
    video_id = _create(headers, "Sliding Window Lecture", VIDEO, source_type="youtube",
                       url="https://www.youtube.com/watch?v=jkl012", captured_at=now)
    other = _auth_headers("echo_filters_other@example.com")
    _create(other, "Binary Search Elsewhere", ARTICLE)

    def ids(**params: Any) -> list[str]:
        resp = client.get("/api/v1/memory-items", params=params, headers=headers)
        assert resp.status_code == 200, resp.text
        return [item["id"] for item in resp.json()["data"]["items"]]

    assert ids(source_type="youtube") == [video_id]
    assert ids(q="binary") == [article_id]
    assert ids(q="youtube.com") == [video_id]
    assert ids(q="100%_") == []
    assert ids(date_from=(now - timedelta(days=1)).isoformat()) == [video_id]
    assert ids(date_to=(now - timedelta(days=1)).isoformat()) == [article_id]
    assert ids(status="ready") == [video_id, article_id]
    assert ids(status="failed") == []

    page = client.get("/api/v1/memory-items", params={"per_page": 1, "page": 2}, headers=headers)
    body = page.json()["data"]
    assert body["total"] == 2 and body["has_more"] is False
    assert [item["id"] for item in body["items"]] == [article_id]

    bad = client.get(
        "/api/v1/memory-items",
        params={"date_from": now.isoformat(), "date_to": (now - timedelta(days=1)).isoformat()},
        headers=headers,
    )
    assert bad.status_code == 422


# -- statistics ---------------------------------------------------------------


def test_dashboard_statistics_counts_real_data_per_user() -> None:
    headers = _auth_headers("echo_stats@example.com")
    now = datetime.now(UTC)
    _create(headers, "Today Article", ARTICLE, captured_at=now)
    old_id = _create(headers, "Old Article", ARTICLE, captured_at=now - timedelta(days=20))
    _create(headers, "Video", VIDEO, source_type="youtube", url="https://www.youtube.com/watch?v=mno345")

    db = SessionLocal()
    try:
        item = db.get(MemoryItem, UUID(old_id))
        assert item is not None
        item.status = ItemStatus.failed
        db.commit()
    finally:
        db.close()
    _create(_auth_headers("echo_stats_other@example.com"), "Not mine", ARTICLE)

    resp = client.get("/api/v1/dashboard/statistics", params={"tz": "UTC"}, headers=headers)
    assert resp.status_code == 200, resp.text
    # Never served from the browser cache, so counts update right after a delete.
    assert resp.headers["cache-control"] == "private, no-store"
    stats = resp.json()["data"]
    assert stats["total"] == 3
    assert stats["today"] == 2
    assert stats["by_source_type"] == {"webpage": 2, "pdf": 0, "youtube": 1}
    assert stats["by_status"]["failed"] == 1
    assert stats["by_status"]["ready"] == 2
    assert stats["ready_for_ai"] == 2
    assert len(stats["daily"]) == 14
    assert stats["daily"][-1]["count"] == 2
    assert sum(day["count"] for day in stats["daily"]) == 2

    bad = client.get("/api/v1/dashboard/statistics", params={"tz": "Nope/Zone"}, headers=headers)
    assert bad.status_code == 422
    assert client.get("/api/v1/dashboard/statistics").status_code in (401, 403)


def test_invalid_structured_metadata_degrades_to_marker_metadata(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _with_llm(monkeypatch, "It halves the interval [S1].")
    monkeypatch.setattr(
        "app.services.rag_service.RagService._call_structured",
        lambda self, backend, prompt, system: '{"mode": "memory", "unexpected": true}',
    )
    headers = _auth_headers("echo_bad_meta@example.com")
    item_id = _create(headers, "Binary Search Explained", ARTICLE)
    data = _ask(headers, "How does binary search halve the interval?")
    assert data["mode"] == "memory"
    assert [c["memory_id"] for c in data["citations"]] == [item_id]
    assert data["suggested_followups"] == []


def test_scoped_question_is_memory_unless_it_asks_for_an_explanation() -> None:
    from app.services.ask_intent import scoped_intent

    assert scoped_intent(classify("What is this about?"), "What is this about?").kind == "personal"
    question = "Explain recursion with an example"
    assert scoped_intent(classify(question), question).kind == "combined"


def test_date_words_alone_do_not_make_a_question_personal() -> None:
    assert classify("Which JavaScript frameworks are popular recently?").kind == "open"
    assert classify("What did I save recently?").kind == "personal"


def test_mention_with_a_too_short_topic_does_not_claim_absence(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _with_llm(monkeypatch, "unused")
    headers = _auth_headers("echo_short_topic@example.com")
    _create(headers, "AI notes", "AI systems learn from data. " * 5)
    data = _ask(headers, "Which sources mention AI?")
    assert data["insufficient_context"] is True
    assert "too short" in data["answer"]
    assert "None of your saved sources" not in data["answer"]


def test_cited_answer_that_names_the_source_stays_a_memory_answer(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _with_llm(monkeypatch, "The source explains that it halves the interval [Source 1].")
    headers = _auth_headers("echo_source_word@example.com")
    item_id = _create(headers, "Binary Search Explained", ARTICLE)
    data = _ask(headers, "How does binary search halve the interval?")
    assert data["mode"] == "memory"
    assert [c["memory_id"] for c in data["citations"]] == [item_id]


class _ProviderError(Exception):
    def __init__(self, status_code: int) -> None:
        super().__init__(f"upstream said {status_code}")
        self.status_code = status_code


def _failing_llm(monkeypatch, status_code: int | None) -> None:  # type: ignore[no-untyped-def]
    _with_llm(monkeypatch)

    def boom(self, question, chunks, **kwargs):  # type: ignore[no-untyped-def]
        raise _ProviderError(status_code) if status_code else RuntimeError("timeout")

    monkeypatch.setattr("app.services.rag_service.RagService._complete", boom)


def test_out_of_credits_general_question_reports_provider_unavailable(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _failing_llm(monkeypatch, 402)
    headers = _auth_headers("echo_credits@example.com")
    resp = client.post("/api/v1/chat", json={"question": "What is a binary heap?"}, headers=headers)
    assert resp.status_code == 503
    error = resp.json()["error"]
    assert error["code"] == "AI_PROVIDER_UNAVAILABLE"
    assert "upstream said" not in error["message"]


def test_one_off_provider_failure_without_memory_is_ask_llm_failed(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _failing_llm(monkeypatch, None)
    headers = _auth_headers("echo_timeout@example.com")
    resp = client.post("/api/v1/chat", json={"question": "What is a binary heap?"}, headers=headers)
    assert resp.status_code == 502
    assert resp.json()["error"]["code"] == "ASK_LLM_FAILED"


def test_provider_failure_on_a_personal_question_falls_back_to_memory(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _failing_llm(monkeypatch, 402)
    headers = _auth_headers("echo_credits_memory@example.com")
    item_id = _create(headers, "Binary Search Explained", ARTICLE)
    data = _ask(headers, "What did I save about binary search?")
    assert data["used_fallback"] is True
    assert [c["memory_id"] for c in data["citations"]] == [item_id]


def test_provider_failure_does_not_answer_a_general_question_with_unrelated_memory(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _failing_llm(monkeypatch, 402)
    headers = _auth_headers("echo_credits_unrelated@example.com")
    _create(headers, "Memory vault guide", "Search your saved pages using natural language phrases. " * 3)
    resp = client.post(
        "/api/v1/chat", json={"question": "What is a large language model?"}, headers=headers
    )
    assert resp.status_code == 503
    assert resp.json()["error"]["code"] == "AI_PROVIDER_UNAVAILABLE"
