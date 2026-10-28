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

## R2 — Chunking

`app/services/chunking/` (package; `from app.services.chunking import …` is unchanged).

**Articles, PDFs, untimed transcripts** (`recursive.py`). Text is cut into
sections at detected headings and PDF page markers; a section shorter than 200
characters merges into the next one on the same page. Each section is split
recursively — paragraphs, lines, sentences, words — and packed into chunks of
~400–600 tokens (estimated at 4 characters per token: 1,600–2,400 characters,
target 2,000) with ~15% overlap carried as whole trailing sentences. Chunks never
span two sections or two PDF pages.

**Timed transcripts** (`transcript.py`). Segments are packed into 60–90 second
windows (also capped at 2,400 characters). Each window carries the trailing
~15% of the previous window's words, timed by interpolation inside their
segment. A segment longer than one window is split evenly in time.

**Schema (Alembic `006_rag_v2_chunks`).**

| Table | Column | Type | Notes |
| ----- | ------ | ---- | ----- |
| `memory_chunks` | `start_sec`, `end_sec` | `float`, nullable | Transcript time range |
| `memory_chunks` | `embedding_model` | `varchar(128)`, nullable | Filled from R3 |
| `memory_chunks` | `content_tsv` | `tsvector`, generated | `heading` (weight B) + `content` (weight A), english; GIN index |
| `memory_items` | `title_tsv` | `tsvector`, generated | `title`, english; GIN index |

Title and URL are not copied onto chunks; retrieval joins `memory_items`.

**API.** `AskCitation` and `SearchHit` gain optional `start_sec` / `end_sec`.
The Ask page's "Jump to" link uses `start_sec`, falling back to the heading
range for chunks saved before this change.

## R3 — Embeddings

**Providers** (`app/services/embedding_service.py`). `EMBEDDING_PROVIDER` is
`auto | openrouter | openai | gemini | none`; `auto` picks OpenRouter whenever an
OpenRouter key is set. `EMBEDDING_MODEL` overrides the provider default
(OpenRouter: `openai/text-embedding-3-small`, 1536 dimensions, verified live
against `POST https://openrouter.ai/api/v1/embeddings`). The OpenRouter adapter
batches 64 inputs per request and rotates across the OpenRouter keys, sharing
cooldowns with chat (`llm_pool.key_pool`).

**One embedding space.** Every adapter has a `model_id` (`provider:model`),
stored on each chunk as `memory_chunks.embedding_model`. Query embeddings come
from the same active adapter and only match chunks with the same
`embedding_model`. There is no cross-provider fallback for queries: if the
active provider fails, retrieval uses full-text search only.

**Capture.** Embedding still runs in the RQ capture job. If it fails, the memory
becomes READY with un-embedded chunks (full-text searchable) instead of FAILED;
the backfill embeds it later.

**Backfill.**

```bash
node scripts/run-python.mjs -m scripts.reprocess_memories --embed --dry-run
node scripts/run-python.mjs -m scripts.reprocess_memories --embed [--user EMAIL] [--batch 64]
node scripts/run-python.mjs -m scripts.reprocess_memories --reclean --embed   # both, in order
```

Embeds chunks of READY memories whose vector is missing or from another model,
committing per batch. It only selects chunks that still need work, so it is
idempotent and resumable; it stops at the first provider failure.
