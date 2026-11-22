"""The CI eval's fixture library stays loadable, and its floors are enforced (S8)."""

from __future__ import annotations

import json

import pytest
from sqlalchemy import func, select

from app.core.db import SessionLocal
from app.models.memory_item import ItemStatus, MemoryItem
from app.models.memory_question import MemoryQuestion
from app.models.user import User
from scripts import eval_fixture, eval_rag


def test_every_fixture_save_indexes_and_every_question_finds_its_chunk() -> None:
    saves = json.loads(eval_fixture.LIBRARY.read_text(encoding="utf-8"))["saves"]
    with eval_fixture.fixture_user() as user_id, SessionLocal() as db:
        items = db.execute(select(MemoryItem).where(MemoryItem.user_id == user_id)).scalars().all()
        assert len(items) == len(saves)
        assert all(item.status == ItemStatus.ready for item in items)
        stored = db.execute(
            select(func.count()).select_from(MemoryQuestion).where(
                MemoryQuestion.user_id == user_id, MemoryQuestion.chunk_id.is_not(None)
            )
        ).scalar_one()
        assert stored == sum(len(save["questions"]) for save in saves)
    with SessionLocal() as db:  # the throwaway user and its saves are gone
        assert db.get(User, user_id) is None
        assert not db.execute(select(MemoryItem.id).where(MemoryItem.user_id == user_id)).first()


def test_fixture_questions_point_at_saves_that_exist() -> None:
    titles = [save["title"].lower() for save in json.loads(eval_fixture.LIBRARY.read_text(encoding="utf-8"))["saves"]]
    cases = eval_rag.load_cases(eval_fixture.QUESTIONS)
    assert len({case.id for case in cases}) == len(cases)
    for case in cases:
        for expected in case.expected:
            assert any(expected.lower() in title for title in titles), (case.id, expected)
    assert any(not case.expected for case in cases)  # rejects are evaluated too
    assert sum(case.passage is not None for case in cases) >= 8


def test_fail_under_floors_are_parsed() -> None:
    assert eval_rag.parse_floors("hit=0.95,mrr=0.90,answer=0.6") == {
        "hit_at_k": 0.95,
        "mrr": 0.90,
        "answer_hit": 0.6,
    }
    assert eval_rag.parse_floors(None) == {}
    with pytest.raises(SystemExit):
        eval_rag.parse_floors("speed=1")
