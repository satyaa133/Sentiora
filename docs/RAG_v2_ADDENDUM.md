# Ask Sentiora RAG v2 — Specification Addendum

This addendum records the changes the owner approved for the Ask Sentiora rework
(branch `feat/ask-rag-v2`). It extends the canonical specifications in `docs/`
(the PDFs stay unchanged). Where this file and a PDF disagree on Ask, retrieval or
chunking, this file is newer.

Stack decisions: FastAPI + PostgreSQL stay. Vector search is pgvector; keyword
search is Postgres full-text (tsvector). There is no MongoDB/Atlas.

## R1 — Ingestion cleanup

**Rolling captions.** YouTube auto-captions repeat the previous cue's tail in
each new cue. `app/services/ingest/transcript_normalizer.py` cleans them before
chunking:

- `merge_rolling_cues` drops the longest suffix of the already-merged text that
  matches a new cue's prefix (word-level, case and punctuation ignored, at least
  2 words unless the cue is wholly covered). A cue already contained in the
  recent text is dropped and the previous cue's `end_seconds` extended.
- `collapse_repeated_ngrams` collapses back-to-back repeats of 2–15 word
  phrases. Single repeated words ("had had") are kept.
- Timed `structured_content` nodes keep their `start_seconds`/`end_seconds`; the
  cleaned nodes replace the stored ones.

**Title is metadata, never body text.** Chunk `content` is body text only. The
memory title stays on `memory_items.title`. Transcript chunk headings are the
time range only (`[02:15–04:30]`); webpage/PDF headings are detected section
headings. The RAG prompt no longer repeats the heading as a `Section:` line
when there is none.

**Re-cleaning saved memories.**

```bash
node scripts/run-python.mjs -m scripts.reprocess_memories --reclean --dry-run
node scripts/run-python.mjs -m scripts.reprocess_memories --reclean [--user EMAIL]
```

Re-normalizes and re-chunks every READY memory, then embeds the new chunks. If
embedding fails, the memory stays READY with un-embedded chunks (keyword search
only) until the embedding backfill runs. Progress is checkpointed in
`backend/.reprocess-checkpoint.json`; `--restart` ignores it.
