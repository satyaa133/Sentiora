"""Retrieval evaluation for Ask Sentiora.

Runs each question in scripts/eval-rag/questions.json through the same
retrieval path Ask uses (follow-up rewrite -> hybrid search -> selection) for
one user, prints the chunks it picked with their scores, and reports:

  hit@k   answerable questions with a chunk from an expected memory in the top k
  MRR     mean reciprocal rank of the first expected chunk
  noise   share of returned chunks that are not from an expected memory
  reject  not-covered questions (expected: []) that correctly returned nothing

A question with ``passage`` (long-page cases) only counts a chunk as a hit
when it is from an expected memory AND contains that text (case and spacing
ignored), so it checks that the best passage of a long save was found, not
just the save.

``--compare-question-bank`` also runs retrieval without the question-bank leg
(S6) so its effect is visible. ``--instant`` builds the instant answer for each
question and reports, per ``RAG_EXTRACT_MIN_SCORE`` (``--extract-sweep``):

  answered  answerable questions that got a quoted answer citing an expected
            save (passage cases: the chunk holding the passage)
  wrong     answerable questions answered from no expected save
  silent    answerable questions answered "not in your saves"
  reject    not-covered questions that got no quoted answer

Follow-ups are rewritten with the same heuristic Ask uses (no model call).

Usage (from the repo root):

    node scripts/run-python.mjs -m scripts.eval_rag --user you@example.com
    node scripts/run-python.mjs -m scripts.eval_rag --user you@example.com --sweep 0.2,0.25,0.3,0.35
    npm run eval:rag -- --user you@example.com --quiet --compare-question-bank
    npm run eval:rag -- --user you@example.com --quiet --instant --extract-sweep -0.5,0,0.5
    npm run eval:rag -- --user you@example.com --quiet --json eval.json

Query embeddings are cached for the run, so a threshold sweep costs one
embedding call per question.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.core.config import get_settings
from app.core.db import SessionLocal
from app.models.user import User
from app.schemas.ask import AskTurn
from app.services import retrieval_service
from app.services.chunking import format_timestamp
from app.services.answer.extractive import extract_answer, is_overview_question
from app.services.retrieval.query_rewriter import rewrite_query
from app.services.retrieval_service import RetrievalService, RetrievedChunk

DEFAULT_QUESTIONS = (
    Path(__file__).resolve().parents[2] / "scripts" / "eval-rag" / "questions.json"
)


@dataclass
class Case:
    id: str
    question: str
    expected: list[str]
    history: list[AskTurn] = field(default_factory=list)
    passage: str | None = None


@dataclass
class Outcome:
    case: Case
    query: str
    chunks: list[RetrievedChunk]
    rank: int | None  # 1-based rank of the first expected chunk

    @property
    def covered(self) -> bool:
        return bool(self.case.expected)

    @property
    def correct(self) -> bool:
        return self.rank is not None if self.covered else not self.chunks

    def matches(self, chunk: RetrievedChunk) -> bool:
        title = chunk.title.lower()
        if not any(part.lower() in title for part in self.case.expected):
            return False
        if self.case.passage is None:
            return True
        return _normalize(self.case.passage) in _normalize(chunk.content)


def _normalize(text: str) -> str:
    return " ".join(text.lower().split())


class CachingAdapter:
    """Wraps the embedding adapter so repeated queries are embedded once."""

    def __init__(self, inner: Any) -> None:
        self.inner = inner
        self.model_id = getattr(inner, "model_id", None)
        self.dimensions = getattr(inner, "dimensions", None)
        self.cache: dict[str, list[float]] = {}
        self.query_cache: dict[str, list[float]] = {}

    def embed_query(self, text: str) -> list[float]:
        if text not in self.query_cache:
            self.query_cache[text] = self.inner.embed_query(text)
        return self.query_cache[text]

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        missing = [t for t in texts if t not in self.cache]
        if missing:
            for text, vector in zip(
                missing, self.inner.embed_texts(missing), strict=True
            ):
                self.cache[text] = vector
        return [self.cache[t] for t in texts]


def load_cases(path: Path) -> list[Case]:
    data = json.loads(path.read_text(encoding="utf-8"))
    cases = []
    for raw in data["questions"]:
        history = [AskTurn(**turn) for turn in raw.get("history", [])]
        cases.append(
            Case(
                raw["id"],
                raw["question"],
                list(raw.get("expected", [])),
                history,
                raw.get("passage"),
            )
        )
    return cases


def resolve_user(db: Any, user: str) -> UUID:
    try:
        return UUID(user)
    except ValueError:
        found = db.execute(
            select(User.id).where(User.email == user.lower())
        ).scalar_one_or_none()
        if found is None:
            raise SystemExit(f"No user with email {user}") from None
        return UUID(str(found))


def evaluate(
    db: Any, user_id: UUID, cases: Sequence[Case], queries: dict[str, str], k: int
) -> list[Outcome]:
    service = RetrievalService(db)
    outcomes = []
    for case in cases:
        chunks = service.retrieve_relevant_memories(
            user_id=user_id, query=queries[case.id], top_k=k
        )
        outcome = Outcome(case, queries[case.id], chunks, None)
        outcome.rank = next(
            (i for i, c in enumerate(chunks, start=1) if outcome.matches(c)), None
        )
        outcomes.append(outcome)
    return outcomes


def summarize(outcomes: Sequence[Outcome]) -> dict[str, float | int]:
    covered = [o for o in outcomes if o.covered]
    uncovered = [o for o in outcomes if not o.covered]
    returned = [(o, c) for o in covered for c in o.chunks]
    return {
        "questions": len(outcomes),
        "hit_at_k": sum(o.rank is not None for o in covered) / len(covered)
        if covered
        else 0.0,
        "mrr": sum(1 / o.rank for o in covered if o.rank) / len(covered)
        if covered
        else 0.0,
        "noise": sum(not o.matches(c) for o, c in returned) / len(returned)
        if returned
        else 0.0,
        "reject": sum(o.correct for o in uncovered) / len(uncovered)
        if uncovered
        else 1.0,
    }


def describe(chunk: RetrievedChunk) -> str:
    if chunk.start_sec is not None:
        where = f"[{format_timestamp(chunk.start_sec)}–{format_timestamp(chunk.end_sec or chunk.start_sec)}]"
    elif chunk.page_number is not None:
        where = f"p.{chunk.page_number}"
    else:
        where = (chunk.heading or "")[:30]
    sim = "   -  " if chunk.distance is None else f"{1 - chunk.distance:.3f}"
    return f"sim={sim} fts={chunk.rank:6.2f}  {chunk.title[:60]} {where}"


def print_outcomes(outcomes: Sequence[Outcome]) -> None:
    for o in outcomes:
        if o.covered:
            status = f"HIT @{o.rank}" if o.rank else "MISS"
        else:
            status = "OK, nothing" if o.correct else "FALSE MATCH"
        print(f"\n[{status}] {o.case.id}: {o.case.question}")
        if o.query != o.case.question:
            print(f"   rewritten: {o.query}")
        print(f"   expected: {o.case.expected or 'nothing (not covered)'}")
        for i, chunk in enumerate(o.chunks, start=1):
            mark = "*" if o.matches(chunk) else " "
            print(f"   {mark}{i}. {describe(chunk)}")
            print(f"        {' '.join(chunk.content.split())[:140]}")
        if not o.chunks:
            print("    (no chunks: treated as not covered)")


def print_summary(label: str, summary: dict[str, float | int]) -> None:
    print(
        f"{label:<22} hit@k={summary['hit_at_k']:.2f}  MRR={summary['mrr']:.2f}  "
        f"noise={summary['noise']:.2f}  reject={summary['reject']:.2f}  (n={summary['questions']})"
    )


def print_passages(outcomes: Sequence[Outcome]) -> None:
    passages = [o for o in outcomes if o.case.passage is not None]
    if passages:
        found = sum(o.rank is not None for o in passages)
        print(f"long-page cases: {found}/{len(passages)} found the passage")


class CachingScorer:
    """Scores each (question, sentence) once, so a threshold sweep is cheap."""

    def __init__(self) -> None:
        from app.services.retrieval.reranker import get_reranker

        self.reranker = get_reranker()
        self.cache: dict[tuple[str, str], float] = {}

    def __call__(self, question: str, sentences: Sequence[str]) -> list[float]:
        if self.reranker is None:
            raise SystemExit("--instant needs the reranker (RERANKER_MODEL)")
        missing = [s for s in sentences if (question, s) not in self.cache]
        if missing:
            for text, score in zip(
                missing, self.reranker.score_sentences(question, missing), strict=True
            ):
                self.cache[(question, text)] = score
        return [self.cache[(question, s)] for s in sentences]


def evaluate_instant(
    outcomes: Sequence[Outcome], thresholds: Sequence[float], *, quiet: bool
) -> None:
    """Instant-answer quality per extraction threshold (see module docstring)."""
    import time

    scorer = CachingScorer()
    timings: list[float] = []
    for round_index, threshold in enumerate(thresholds):
        counts = {"answered": 0, "wrong": 0, "silent": 0, "reject": 0}
        covered = [o for o in outcomes if o.covered]
        uncovered = [o for o in outcomes if not o.covered]
        for o in outcomes:
            if is_overview_question(o.case.question) or not o.chunks:
                answer = None
                used: list[str] = []
                if o.chunks and is_overview_question(o.case.question):
                    # Overviews quote the best save's opening lines.
                    used = ["S1"]
                    answer = "overview"
            else:
                started = time.perf_counter()
                result = extract_answer(o.case.question, o.chunks, threshold, scorer)
                if round_index == 0:  # later rounds hit the score cache
                    timings.append(time.perf_counter() - started)
                answer, used = result.text, result.used_sources
            if not o.covered:
                counts["reject"] += answer is None
                continue
            if answer is None:
                counts["silent"] += 1
                status = "silent"
            elif any(o.matches(o.chunks[int(sid[1:]) - 1]) for sid in used):
                counts["answered"] += 1
                status = "answered"
            else:
                counts["wrong"] += 1
                status = "WRONG"
            if not quiet and len(thresholds) == 1:
                print(f"  instant {status:<8} {o.case.id}: {(answer or '')[:150]!r}")
        n = len(covered) or 1
        print(
            f"instant min_score={threshold:+.2f}  answered={counts['answered'] / n:.2f}  "
            f"wrong={counts['wrong'] / n:.2f}  silent={counts['silent'] / n:.2f}  "
            f"reject={counts['reject'] / (len(uncovered) or 1):.2f}"
        )
    if timings:
        ordered = sorted(timings)
        p50 = ordered[len(ordered) // 2]
        p95 = ordered[min(len(ordered) - 1, int(len(ordered) * 0.95))]
        print(
            f"sentence scoring (uncached): p50 {p50 * 1000:.0f} ms, "
            f"p95 {p95 * 1000:.0f} ms"
        )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--user", required=True, help="user email or id whose memories are searched"
    )
    parser.add_argument("--questions", default=str(DEFAULT_QUESTIONS))
    parser.add_argument(
        "--k", type=int, default=None, help="chunks per question (default RAG_FINAL_K)"
    )
    parser.add_argument(
        "--sweep", help="comma-separated RAG_MIN_SIMILARITY values to compare"
    )
    parser.add_argument(
        "--compare-question-bank",
        action="store_true",
        help="also evaluate without the question-bank leg",
    )
    parser.add_argument(
        "--instant", action="store_true", help="evaluate the instant answer too"
    )
    parser.add_argument(
        "--extract-sweep",
        help="comma-separated RAG_EXTRACT_MIN_SCORE values for --instant",
    )
    parser.add_argument("--quiet", action="store_true", help="only print the summary")
    parser.add_argument("--json", help="write per-question results to this file")
    args = parser.parse_args(argv)

    # Transcripts and titles hold characters a Windows console code page cannot print.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(message)s")
    settings = get_settings()
    k = args.k or settings.rag_final_k
    cases = load_cases(Path(args.questions))

    adapter = retrieval_service.get_embedding_adapter()
    if adapter is None:
        print(
            "No embedding provider configured: only full-text search is evaluated.",
            file=sys.stderr,
        )
    else:
        cached = CachingAdapter(adapter)
        retrieval_service.get_embedding_adapter = lambda: cached  # type: ignore[assignment,return-value]

    with SessionLocal() as db:
        user_id = resolve_user(db, args.user)
        queries = {
            case.id: rewrite_query(case.question, case.history, None) for case in cases
        }

        baseline = settings.rag_min_similarity
        outcomes = evaluate(db, user_id, cases, queries, k)
        if not args.quiet:
            print_outcomes(outcomes)
        print(f"\nRetrieval eval over {len(cases)} questions, k={k}")
        print_summary(f"min_similarity={baseline:.2f}", summarize(outcomes))

        if args.compare_question_bank:
            RetrievalService.use_question_bank = False
            try:
                print_summary(
                    "without question bank",
                    summarize(evaluate(db, user_id, cases, queries, k)),
                )
            finally:
                RetrievalService.use_question_bank = True
        print_passages(outcomes)

        if args.instant:
            values = (
                [float(v) for v in args.extract_sweep.split(",") if v.strip()]
                if args.extract_sweep
                else [settings.rag_extract_min_score]
            )
            evaluate_instant(outcomes, values, quiet=args.quiet)

        if args.sweep:
            try:
                for value in (float(v) for v in args.sweep.split(",") if v.strip()):
                    settings.rag_min_similarity = value
                    print_summary(
                        f"min_similarity={value:.2f}",
                        summarize(evaluate(db, user_id, cases, queries, k)),
                    )
            finally:
                settings.rag_min_similarity = baseline

    if args.json:
        Path(args.json).write_text(
            json.dumps(
                {
                    "summary": summarize(outcomes),
                    "results": [
                        {
                            "id": o.case.id,
                            "question": o.case.question,
                            "query": o.query,
                            "expected": o.case.expected,
                            "correct": o.correct,
                            "rank": o.rank,
                            "chunks": [
                                {
                                    "title": c.title,
                                    "similarity": None
                                    if c.distance is None
                                    else round(1 - c.distance, 4),
                                    "fulltext_rank": round(c.rank, 4),
                                    "start_sec": c.start_sec,
                                    "matches": o.matches(c),
                                }
                                for c in o.chunks
                            ],
                        }
                        for o in outcomes
                    ],
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        print(f"Wrote {args.json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
