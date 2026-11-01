from app.models.memory_item import MemoryItem, SourceType
from app.services.chunking import chunk_content, chunk_transcript
from app.services.ingest.transcript_normalizer import (
    Cue,
    clean_transcript_nodes,
    clean_transcript_text,
    collapse_repeated_ngrams,
    merge_rolling_cues,
)
from app.workers.jobs.process_capture import prepare_chunks

DUPLICATED = (
    "I took off this three I moved L I took off this three I moved L "
    "I took off this three I moved L"
)


def _node(text: str, start: float, end: float, order: int) -> dict:
    return {
        "id": f"n{order}",
        "type": "paragraph",
        "text": text,
        "order": order,
        "metadata": {"start_seconds": start, "end_seconds": end},
    }


def test_repeated_phrase_collapses_to_one_copy() -> None:
    assert collapse_repeated_ngrams(DUPLICATED) == "I took off this three I moved L"


def test_single_word_repeats_are_kept() -> None:
    assert collapse_repeated_ngrams("it had had an effect") == "it had had an effect"


def test_rolling_cues_drop_overlap_and_keep_timestamps() -> None:
    cues = [
        Cue("I took off this", 0.0, 2.0),
        Cue("I took off this three I moved", 1.0, 4.0),
        Cue("three I moved L", 3.0, 5.0),
        Cue("and then we went home", 6.0, 8.0),
    ]
    merged = merge_rolling_cues(cues)
    assert (
        " ".join(c.text for c in merged)
        == "I took off this three I moved L and then we went home"
    )
    assert [(c.start, c.end) for c in merged] == [
        (0.0, 2.0),
        (1.0, 4.0),
        (3.0, 5.0),
        (6.0, 8.0),
    ]


def test_contained_cue_extends_previous_end() -> None:
    merged = merge_rolling_cues(
        [
            Cue("the binary search halves the range", 0.0, 3.0),
            Cue("halves the range", 2.0, 5.0),
        ]
    )
    assert [c.text for c in merged] == ["the binary search halves the range"]
    assert merged[0].end == 5.0


def test_short_coincidental_overlap_is_kept() -> None:
    merged = merge_rolling_cues(
        [Cue("we start with the", 0, 1), Cue("the end of the list", 1, 2)]
    )
    assert " ".join(c.text for c in merged) == "we start with the the end of the list"


def test_cleaning_is_idempotent() -> None:
    once = clean_transcript_text(
        f"{DUPLICATED}\n\nthree I moved L and then we went home"
    )
    assert once == "I took off this three I moved L\n\nand then we went home"
    assert clean_transcript_text(once) == once


def test_transcript_nodes_cleaned_across_boundaries() -> None:
    nodes = [
        _node(DUPLICATED, 0.0, 6.0, 0),
        _node("three I moved L and the next step is sorting", 5.0, 9.0, 1),
        _node("the next step is sorting", 8.0, 11.0, 2),
    ]
    cleaned = clean_transcript_nodes(nodes)
    assert cleaned is not None
    assert [n["text"] for n in cleaned] == [
        "I took off this three I moved L",
        "and the next step is sorting",
    ]
    assert cleaned[0]["metadata"]["start_seconds"] == 0.0
    assert cleaned[1]["metadata"] == {"start_seconds": 5.0, "end_seconds": 11.0}


def test_chunk_text_never_contains_title() -> None:
    title = "Graph algorithms L5."
    text = "Intro\n\n" + " ".join(["Dijkstra relaxes edges in order of distance."] * 40)
    for source_type in (SourceType.webpage, SourceType.pdf, SourceType.youtube):
        for chunk in chunk_content(text, source_type, title=title):
            assert title not in chunk.content
    nodes = [
        _node(
            "Dijkstra relaxes edges in order of distance " * 5,
            i * 10.0,
            i * 10.0 + 9,
            i,
        )
        for i in range(5)
    ]
    for chunk in chunk_transcript(nodes, title=title):
        assert title not in chunk.content
        assert chunk.heading and chunk.heading.startswith("[")


def test_prepare_chunks_cleans_youtube_capture() -> None:
    item = MemoryItem(
        source_type=SourceType.youtube,
        url="https://www.youtube.com/watch?v=abc",
        title="Lecture L5.",
        content=DUPLICATED,
        structured_content=[
            _node(DUPLICATED, 0.0, 6.0, 0),
            _node(
                "three I moved L and then the proof of correctness follows",
                5.0,
                12.0,
                1,
            ),
        ],
    )
    drafts = prepare_chunks(item)
    joined = " ".join(d.content for d in drafts)
    assert joined.count("I took off this three I moved L") == 1
    assert "L5." not in joined
    assert item.content.count("I took off this") == 1


def test_reclean_script_rechunks_ready_memory(tmp_path) -> None:
    from uuid import UUID

    from fastapi.testclient import TestClient

    from app.core.db import SessionLocal
    from app.main import app
    from app.models.memory_chunk import MemoryChunk
    from scripts.reprocess_memories import main

    client = TestClient(app)
    email = "reclean_owner@example.com"
    password = "MemoryPassword123!"
    client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "full_name": "Reclean Tester"},
    )
    token = client.post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    ).json()["data"]["access_token"]
    created = client.post(
        "/api/v1/memory-items",
        json={
            "source_type": "youtube",
            "url": "https://www.youtube.com/watch?v=recleanAAAA",
            "title": "Lecture L5.",
            "content": DUPLICATED,
            "structured_content": [
                _node(DUPLICATED, 0.0, 6.0, 0),
                _node("and the proof follows next", 6.0, 9.0, 1),
            ],
        },
        headers={"Authorization": f"Bearer {token}"},
    ).json()["data"]
    memory_id = UUID(created["id"])

    # Simulate a chunk saved by the old pipeline: title prefixed, duplicated text.
    with SessionLocal() as db:
        db.query(MemoryChunk).filter(MemoryChunk.memory_id == memory_id).update(
            {MemoryChunk.content: f"Lecture L5. [00:00–00:09]\n\n{DUPLICATED}"}
        )
        db.commit()

    checkpoint = tmp_path / "cp.json"
    assert main(["--reclean", "--user", email, "--checkpoint", str(checkpoint)]) == 0

    with SessionLocal() as db:
        chunks = db.query(MemoryChunk).filter(MemoryChunk.memory_id == memory_id).all()
    joined = " ".join(c.content for c in chunks)
    assert joined.count("I took off this three I moved L") == 1
    assert "L5." not in joined
    # A second run is a no-op on content.
    assert main(["--reclean", "--user", email, "--checkpoint", str(checkpoint)]) == 0
