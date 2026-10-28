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

## R4 — Retrieval

`RetrievalService.retrieve_relevant_memories` (same signature) now runs:

1. **Query rewrite** (`app/services/retrieval/query_rewriter.py`). With chat
   history, a short LLM call turns the question into a standalone query
   ("what about the optimal one?" → "optimal approach to rotate an array by K
   places"). No history: the question as-is. Provider failure or unusable
   output: the previous user question + the follow-up.
2. **Two legs, 30 candidates each.**
   - Vector: pgvector cosine distance over chunks with the current
     `embedding_model`; hits below `RAG_MIN_SIMILARITY` (cosine, default 0.25)
     are dropped.
   - Full-text: `to_tsquery('english', t1 | t2 | …)` over `content_tsv ||
     title_tsv`, ranked by `ts_rank_cd(content) + ts_rank_cd(title)`. A hit
     must match enough distinct query terms (1 for ≤2 terms, else ⌈n/3⌉, min 2).
3. **Not covered.** If both legs are empty, retrieval returns `[]` and Ask
   treats the question as not covered by memory.
4. **Fusion and selection** (`app/services/retrieval/selection.py`):
   Reciprocal Rank Fusion (k = 60) → near-duplicate removal (3-word shingle
   Jaccard > 0.8) → MMR (λ = `RAG_MMR_LAMBDA`, 0.7; cosine on stored vectors,
   shingle Jaccard when a vector is missing) with at most
   `RAG_MAX_CHUNKS_PER_MEMORY` (2) chunks per memory → top `RAG_FINAL_K` (6).
   Questions scoped to one memory, and summary questions (up to 8 chunks), are
   not capped per memory.
5. **Isolation.** Every query filters `memory_chunks.user_id` and
   `memory_items.user_id` (plus READY, not deleted).
6. **Dev logging.** With `APP_ENVIRONMENT=development` each retrieval logs the
   query, the top scores of each leg and the chosen chunks.

`RAG_MAX_DISTANCE` is replaced by `RAG_MIN_SIMILARITY`. `GET /search` returns
retrieval's choice without the extra "strong match only" filter.

## R5 — Generation

**Pipeline** (`app/services/rag_service.py`). `RagService.prepare()` does every
database step (intent, query rewrite, retrieval, fixed answers) before any
model call; `RagService.run()` then emits events without touching the database,
so the streaming route can run after FastAPI has closed the request's session.

**Prompt** (`app/services/llm/prompts.py`). Each retrieved chunk is a numbered
block `[S1]..[Sn]` with title, type, URL, capture date, video time range (or
section) and page, inside the existing untrusted-data guards. One system prompt
asks for a single unified Markdown answer that cites memory facts inline with
`[S#]`, never pastes raw chunks, never writes separate "memory" / "general"
sections or repeats content, and — when memory does not cover the question —
answers from general knowledge and says so in one opening sentence. Questions
phrased as "based on what I saved" add a hint to report what the sources say or
that nothing relevant is saved. Markers like `[Source 2]` or `[S1, S3]` are
normalized to `[S2]`, `[S1][S3]`; markers for sources that were not supplied are
removed.

**Streaming endpoint.** `POST /api/v1/chat/stream`, same request body, auth and
rate limits as `POST /chat`. Validation, auth and retrieval errors are normal
HTTP errors (same codes as `/chat`). The response is `text/event-stream`:

| Event | Data |
| ----- | ---- |
| `sources` | `{"sources": [{"id": "S1", ...AskCitation fields incl. start_sec/end_sec}]}` |
| `delta` | `{"text": "..."}` — answer text pieces, in order |
| `final` | `{"answer", "mode": "memory"\|"general"\|"mixed", "usedSources": ["S1", ...], "followUps": [...], "insufficient_context", "used_fallback"}` — `answer` is the cleaned full text and replaces the streamed text |
| `error` | `{"code", "message", "status"}` — `ASK_STREAM_INTERRUPTED` after partial text, otherwise the `/chat` error codes |

The answer streams from OpenRouter/OpenAI (`stream: true`); Gemini answers in
one piece. Key failover happens only before the first token.

**Structured metadata.** After the answer, one non-streaming call per answer:
`response_format: {type: "json_schema", json_schema: {name: "answer_meta",
strict: true, schema}}` with `provider: {require_parameters: true}`. Schema:
`{mode: "memory"|"general"|"mixed", usedSources: string[], followUps: string[]
(maxItems 3)}`, `additionalProperties: false`, all fields required. The reply
is validated with pydantic (`AnswerMeta`); `usedSources` always comes from the
answer's valid `[S#]` markers, and the model's mode is corrected when it
contradicts them. On any failure, mode and sources come from the markers and
`followUps` is empty. Follow-up templates are gone.

**Fallback models.** `OPENROUTER_FALLBACK_MODELS` (comma-separated) is sent as
OpenRouter's `models` list after `OPENROUTER_CHAT_MODEL`.

**`POST /chat`** runs the same pipeline without streaming and keeps its response
shape: `[S#]` becomes `[k]` numbered by first use, `citations` follow that
order (one per cited chunk), and `mixed` is reported as `combined`.
