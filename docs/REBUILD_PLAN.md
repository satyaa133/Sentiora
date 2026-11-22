# Sentiora Rebuild Plan (v3)

> **Who this is for:** the owner, every teammate, and every AI agent working on
> Sentiora. Read it fully before starting any rebuild work.
>
> **Status:** approved direction, stages not started (2026-11-20).
> **Track:** this rebuild runs before the rest of Phase 9 (Deployment &
> Launch). Deployment is stage S10 of this plan.
> **Progress lives in** `docs/TASKS.md` (section "Rebuild v3"). This file says
> *what* and *why*; TASKS.md says *where we are*.

---

## Contents

1. [How to use this document](#1-how-to-use-this-document)
2. [Why we are rebuilding](#2-why-we-are-rebuilding)
3. [What stays](#3-what-stays)
4. [Decisions](#4-decisions)
5. [Target architecture](#5-target-architecture)
6. [Stages](#6-stages)
7. [Database changes](#7-database-changes)
8. [API changes](#8-api-changes)
9. [Configuration changes](#9-configuration-changes)
10. [Definition of done](#10-definition-of-done)
11. [Working rules](#11-working-rules)
12. [Document status](#12-document-status)
13. [Risks](#13-risks)
14. [Glossary](#14-glossary)

---

## 1. How to use this document

- **Order of authority.** For anything this plan covers (Ask, retrieval,
  embeddings, capture processing, reliability, deployment), this plan wins over
  `RAG_v2_ADDENDUM.md`, which wins over the PDFs in `docs/`. Where this plan
  is silent, the older documents still apply.
- **One stage at a time.** Stages run in the order of section 6. A stage
  starts only when the previous stage meets its "Done when" and TASKS.md says
  so. Two people may work on different tasks *inside* the same stage.
- **No invention.** New endpoints, request/response fields, tables and columns
  are the ones listed in sections 7 and 8. Anything else needs this file
  updated first (and the owner's OK).
- **Changing the plan.** Edit this file in its own commit
  (`docs(plan): ...`) before writing code that depends on the change. Record
  the decision in section 4.
- **Stage checklists** in section 6 are the work items. Tick them in TASKS.md,
  not here.

---

## 2. Why we are rebuilding

The core works: capture, chunking, hybrid search, cited answers. What doesn't
hold up for real users is everything around the AI provider. Problems found on
2026-11-20 (logs, database and code):

| # | Problem | Evidence | Fixed in |
| - | ------- | -------- | -------- |
| P1 | Every question waits on 3–4 external API calls (embed question, answer, metadata, sometimes a rewrite) | `rag_service.py`, `embedding_service.py` | S3, S6 |
| P2 | Slow provider = slow or hung Ask: chat timeout 25 s, embedding 30 s, up to 4 backends tried | 10:48–10:51 IST: Gemini and OpenRouter timed out in turn, answers > 30 s | S1 |
| P3 | Question embedding fails → retrieval silently falls back to keyword-only | API log, `retrieval_service.py` | S3 |
| P4 | Failed capture embeddings are never retried | 23 chunks of one YouTube save left un-embedded | S1, S3 |
| P5 | `/chat/stream` keeps its DB session (and pool connection) until the stream ends | `ask_routes.py` uses `Depends(get_db)`; FastAPI 0.141 closes yield dependencies after the response | S1 |
| P6 | HNSW index spans all users and filters by user afterwards; as users grow, a user's own chunks can fall outside the first 40 candidates | migration 005, no `hnsw.iterative_scan` | S1 |
| P7 | Rate limits live in process memory, so N processes allow N× the limit | `app/core/rate_limit.py` | S1 |
| P8 | No visibility: no error tracking, no latency, cost or quality metrics | — | S2 |
| P9 | Questions worded unlike a long page miss its best passage | TASKS.md P2 item | S4, S5 |
| P10 | Webpage and PDF chunks average ~185 tokens, far under the 400–600 target | DB: avg 740 / 753 chars | S5 |
| P11 | One capture worker, one queue | `app/workers/queue.py` | S1, S5 |
| P12 | Every answer costs money and is capped by one key's rate limit | 1 OpenRouter key configured | S6 |
| P13 | The extension auto-saves every page; any per-save AI step would multiply cost | README "Privacy behaviour" | S5 (lazy enrichment) |
| P14 | Stale docs: PDFs describe Celery, S3, ~90 endpoints and tables that don't exist | section 12 | S0 |

**Goal of the rebuild:**

1. Ask always answers fast, from the user's own saves, with **no external call
   at question time**.
2. AI answers are an extra, on a button, bounded and observable.
3. Expensive AI work happens in the background when saving, only for saves that
   matter, and is retried when the provider fails.
4. The system is measured (latency, cost, quality) and load-tested before launch.

**Targets** (checked in S9):

| Measure | Today | Target |
| ------- | ----- | ------ |
| External calls per default answer | 3–4 | 0 |
| Default (instant) answer, p95 | 3–30 s | < 1 s |
| Instant answer when every provider is down | degraded | same quality |
| 500 signed-in users, 50 asking at once | untested | p95 < 1 s, 0 errors, DB pool never exhausted |
| Invented facts in the instant answer | possible | none (quoted text only) |
| Retrieval quality (`npm run eval:rag`) | hit@6 1.00, MRR 0.96 | not lower than 0.95 / 0.90 |

---

## 3. What stays

Locked unless this file is changed:

- **Backend:** Python 3.12, FastAPI, SQLAlchemy 2, Alembic, Pydantic.
- **Data:** PostgreSQL 16 + pgvector (vectors live next to the data), Postgres
  full-text search, Redis 7. No Pinecone or other vector database.
- **Jobs:** RQ workers (`SimpleWorker` on Windows).
- **Retrieval core:** hybrid vector + full-text, RRF (k = 60), near-duplicate
  removal, MMR, per-memory caps (RAG_v2_ADDENDUM R4).
- **No AI framework:** no LangChain, LangGraph or LlamaIndex. Plain services.
- **Frontend:** React 18 + Vite + TypeScript + Tailwind; design system in
  `docs/DESIGN.md`.
- **Extension:** Chrome MV3; extraction happens in the extension; the backend
  never fetches pages.
- **Layering:** routes → services → repositories; every response uses the
  envelope in `app/schemas/envelope.py`; the frontend calls the API only
  through `frontend/src/services/`.
- **Security:** every query scoped by `user_id`; saved text is untrusted in
  prompts (`rag_sanitize.py`).

---

## 4. Decisions

### Approved (2026-11-20)

| ID | Decision |
| -- | -------- |
| D1 | Rebuild first, then deploy. The rest of Phase 9 becomes stage S10. The deadline is flexible: quality first. |
| D2 | **Default answer = instant answer** (quoted from the user's saves, no AI). **"Explain with AI"** button for a written AI answer. |
| D3 | Embeddings and reranking run **locally on CPU** inside the API and worker processes, using `fastembed` (ONNX Runtime, no PyTorch). |
| D4 | Embedding model: start with `BAAI/bge-small-en-v1.5` (384 dimensions); compare with `nomic-ai/nomic-embed-text-v1.5` (768) in the S3 eval and keep the better one. **Chosen 2026-11-21 (owner): quantized `nomic-ai/nomic-embed-text-v1.5-Q`** (hit@6 1.00, MRR 0.93 vs bge-small 0.95 / 0.91; 130 MB). |
| D5 | AI work at save time (enrichment) is **lazy**: only for saves that matter (S5), never for every auto-saved page. |
| D6 | **Plans, limits and payments come after the rebuild and its testing** (stage L1). The rebuild only records usage so limits can be added later. |
| D7 | Future plans: Free (15 AI answers/day), Student, Plus, Pro. No Business plan for now. Student verification: college email **and** ID upload. Details in L1. |
| D8 | Keep pgvector. Revisit a dedicated vector database only past ~20M chunks. |
| D9 | **AI providers.** Development: OpenRouter, as today (no Anthropic API budget yet), with OpenRouter's "don't route to providers that train" setting on. Production (S10): Anthropic API directly with **Claude Haiku 5.5** (`claude-haiku-5-5`) for AI answers, and enrichment through Anthropic's **Message Batches API** (half price; enrichment can wait); Gemini **paid tier only** as backup. Pro plan's "best model" (L1): Claude Sonnet 5.5. Never a free tier or a provider that trains on user data. |
| D11 | **Development providers (2026-11-21, owner).** Use every configured key: OpenRouter is the primary for answers and embeddings (Claude Haiku); **Groq** (`openai/gpt-oss-120b`, OpenAI-compatible) is the first chat backup, then Gemini. Groq has no embeddings API. Groq keeps no API inputs or outputs by default (abuse/error logs up to 30 days; Zero Data Retention can be turned on); whether it trains on API data is in its services agreement, not yet read. Before Groq serves real users: confirm its no-training terms, turn on ZDR, and add it to the D10 notice (new notice version). |
| D12 | ~~OpenAI as the main provider~~ **Withdrawn 2026-11-21:** the owner won't add OpenAI credit; the key was removed. |
| D13 | **No provider may store or train on user text (2026-11-21, owner), and as little as possible depends on paid APIs.** Development uses only: **Groq** (primary for answers; its services agreement forbids training on inputs/outputs and keeps none by default) and **OpenRouter** (backup answers and, until S3, embeddings), where every request sends `provider: {data_collection: "deny", zdr: true}` so only zero-data-retention endpoints that don't collect prompts are used (checked live). Gemini (free tier may use data) and OpenAI are removed. No credit will be added to any API, so S3 (local embeddings), S4 (local reranker) and S6 (instant answers without AI) are the priority, and the AI answer stays an optional extra. Owner action: turn on Groq's Zero Data Retention setting. |
| D14 | **Question-bank leg has its own similarity bar (2026-11-22, owner).** `RAG_QUESTION_MIN_SIMILARITY` (0.60) instead of `RAG_MIN_SIMILARITY` (0.65): the local model scores a paraphrased question against a stored one at 0.60–0.67, so at 0.65 the leg added nothing. S6 eval (31 questions): 0.65 → hit@6 0.86, MRR 0.86, long-page 6/10; **0.60 → 0.93, 0.88, 8/10, reject 1.00**; 0.55 → reject 0.50 (narrow window, S8 eval-in-CI watches it). |
| D15 | **Account deletion and the CI eval (2026-11-22, owner).** `DELETE /api/v1/users/me` with the current password removes the account and everything tied to it; Account Settings gets a Delete account button with a confirm step. CI evaluates retrieval on an original fixture library in the repo (`scripts/eval-rag/fixture/`, no copied articles or transcripts), embedded with the local model, against the section 2 targets; the dev-library eval stays a local command. |
| D16 | **Reranker veto (2026-11-22, owner).** After reranking, a keyword-only candidate (no vector or question-bank match) that the local cross-encoder scores below `RAG_RERANK_MIN_SCORE` (-0.6) is dropped; when nothing is left the question is not covered. Vetoing every candidate also dropped right answers (dev library hit@6 0.96 → 0.88), so matches by meaning are left alone. Found in the S8 eval: questions about topics no longer saved matched pages on two common words ("single pass" in PR notes, "load balancers" in the API spec, "temperature" and "liquid" in a sourdough page). The floor is picked by the eval so answerable questions stay at or above the section 2 targets. |
| D10 | **Privacy notice at sign-up.** New users see the notice below and must accept it to create an account; the accepted version and time are stored. When the notice changes, signed-in users accept the new version before using AI features. The same text goes in the privacy policy (S10). |

**Approved privacy notice (D10), version `2026-11-20`:**

> To write AI answers and summaries, Sentiora sends your question and the
> relevant excerpts from your saved items to our AI providers (Anthropic, and
> Google as a backup). These providers process the text only to produce the
> response and do not use it to train their models. Instant answers and search
> run on our own servers and send nothing to AI providers.

The notice describes production (D9). During development, text goes through
Groq and OpenRouter only, with no-training routing (D13); only the team's
own accounts use the development setup.

### Open

| ID | Question | Needed by |
| -- | -------- | --------- |
| O1 | Hosting provider and monthly budget (server, managed Postgres, Redis, AI credits) | S10 |
| O2 | Production AI provider: D9 (Anthropic, paid) conflicts with D13 (no paid credit). Decide before S10, and update the D10 notice to name the providers actually used | S10 |

---

## 5. Target architecture

Legend: 🔑 external AI API (needs a key, costs money) · 🖥️ runs on our server
(free, no key).

### 5.1 Save pipeline (background, the user never waits)

```
Chrome extension: reads the page / PDF / YouTube transcript
        │
        ▼
API  POST /api/v1/memory-items  →  stores raw content, returns 201 at once
        │
        ▼  queue "sentiora.capture"
┌─ capture worker ──────────────────────────────────────────────┐
│ 1. normalize text, reject stubs                          🖥️    │
│ 2. chunk (sections → paragraphs → sentences)             🖥️    │
│ 3. embed chunks with the local model                     🖥️    │
│ 4. store chunks + vectors → status READY                       │
│    ✅ searchable within seconds; no external call              │
└───────────────────────────────────────────────────────────────┘
        │  only when the save "matters" (S5 rules)
        ▼  queue "sentiora.enrich"
┌─ enrich worker ───────────────────────────────────────────────┐
│ 5. 🔑 ONE structured call to a cheap model per save:            │
│      summary · key points · 5–10 questions it answers ·         │
│      one context line per chunk                                 │
│ 6. embed questions + context lines locally               🖥️    │
│ 7. store → enrichment_status READY                              │
│    ❌ provider fails → retry 1 min, 5 min, 30 min, 6 h;          │
│       the save already works without enrichment                 │
└───────────────────────────────────────────────────────────────┘
```

### 5.2 Ask pipeline (the user waits, so it must be fast)

```
User question
   │
   ▼
API: auth → rate limit (Redis) → answer cache (Redis) ── hit ──► answer
   │ miss
   ▼
Understand the question                               🖥️ rules: intent, dates, scope
   └─ vague follow-up ("what about its cons?")         🖥️ heuristic rewrite
   ▼
Embed the question (local)                            🖥️ ~20 ms
   ▼
Hybrid search in Postgres, this user only             🖥️ ~50 ms
   ├─ vector: chunks
   ├─ vector: question bank (from enrichment)
   └─ full-text: chunks + titles
   → RRF → near-duplicate removal
   ▼
Rerank top 30 → top 6 (local cross-encoder)           🖥️ ~100 ms
   ▼
⚡ INSTANT ANSWER: best sentences, cited [S1]…         🖥️ shown at < 1 s
   │   (summary questions on one save → stored summary + key points)
   │
   └─ user clicks "Explain with AI"
        ▼
      AI gate: concurrency slot free? provider healthy (circuit breaker)?
        ├─ yes → 🔑 ONE streamed call: answer with [S#] citations + follow-ups
        │        → citation check → cache → usage logged
        └─ no  → instant answer stays; message "AI busy, try again in N s"
```

### 5.3 Where external AI is used (complete list)

| Step | Today | After the rebuild |
| ---- | ----- | ----------------- |
| Embed chunks at save | 🔑 every save | 🖥️ local |
| Embed the question | 🔑 every question | 🖥️ local |
| Rerank | — | 🖥️ local |
| Follow-up rewrite | 🔑 for vague follow-ups | 🖥️ heuristic; 🔑 only inside the AI answer call |
| Enrichment | — | 🔑 once per save that matters, background |
| Instant answer | — | 🖥️ none |
| AI answer | 🔑 every question | 🔑 only on "Explain with AI" |
| Answer metadata (mode, sources, follow-ups) | 🔑 separate call | merged into the AI answer call |
| **External calls per question** | **3–4** | **0** (1 with Explain with AI) |

### 5.4 Runtime components

| Component | Runs | Notes |
| --------- | ---- | ----- |
| API (FastAPI/uvicorn) | N processes | Loads embedding + reranker models once per process (~300–500 MB RAM) |
| Capture worker | ≥ 2 | Queue `sentiora.capture` |
| Enrich worker | ≥ 1 | Queue `sentiora.enrich`, rate-limited to the provider |
| PostgreSQL 16 + pgvector | managed in production | PgBouncer (transaction mode) in front in production |
| Redis 7 | managed in production | queues, rate limits, AI semaphore, answer cache, circuit breaker |
| Frontend | static build on a CDN | |

---

## 6. Stages

Each stage: **Goal → Tasks → Done when.** Effort is a rough estimate for one
developer.

### S0 — Documentation reset (1–2 days)

**Goal:** the docs describe what we are building, so people and agents stop
following stale specs.

- [ ] This plan merged; `AGENTS.md`, `docs/README.md`, `CONTRIBUTING.md`,
      `docs/PROMPT_GUIDE.md` point to it.
- [ ] `docs/TASKS.md` gets the "Rebuild v3" section (S0–S10, L1).
- [ ] Generate the API reference from code: export FastAPI's OpenAPI schema to
      `docs/api/openapi.json` (script + npm command) and write `docs/API.md`
      (conventions, envelope, error codes, auth) to replace the API PDF as the
      contract.
- [ ] Write `docs/DATABASE.md` from the SQLAlchemy models and migrations (tables,
      columns, indexes) to replace the schema PDF as the contract.
- [ ] Move superseded documents to `docs/archive/` (section 12) with the owner's
      OK. Nothing is deleted.

**Done when:** a new teammate can follow README + this plan + API.md +
DATABASE.md without opening an archived PDF.

### S1 — Reliability fixes (3–4 days)

**Goal:** today's flow stops hanging and stays correct as users grow.

- [ ] **DB session not held during streaming.** `/chat/stream` uses
      `Depends(get_db, scope="function")` (or closes the session after
      `prepare()`). Test: pool checked-out count unchanged while a stream runs.
- [ ] **pgvector iterative scan.** Set `hnsw.iterative_scan = relaxed_order`
      on connect (`app/core/db.py`); re-sort by distance in an outer query.
      Test: a user with 10 chunks among 50k other users' chunks still gets
      their best match.
- [ ] **Configurable, shorter timeouts.** `LLM_CHAT_TIMEOUT_SECONDS` (10),
      `LLM_META_TIMEOUT_SECONDS` (8), `EMBEDDING_TIMEOUT_SECONDS` (10) replace
      the constants in `rag_service.py` and `embedding_service.py`.
      `LLM_CHAT_TIMEOUT_SECONDS` is the most an answer waits for its first
      token **across every key it tries** (each attempt gets the time left), so
      an outage fails in about that long. Streamed answers are not cut off after
      the first token. One-piece responses (the Gemini backup, `POST /chat`, the
      follow-up rewrite) must finish within it: Gemini's SDK also sends it as
      the server-side deadline.
- [ ] **Circuit breaker, shared.** `llm_pool.py` already cools a failing key
      down (30 s for a timeout or 5xx, 5 min for auth, credit or rate-limit
      errors, doubling on repeats). Today that state is per process. Share it
      through Redis so every API process and worker skips a failing key at once
      (keys stored as a hash, never the key itself), falling back to the
      in-process state when Redis is down. No separate breaker thresholds.
- [ ] **Redis rate limits.** `app/core/rate_limit.py` sliding window moves to
      Redis (same keys and limits); in-memory fallback if Redis is down.
      Shared Redis access lives in `app/core/redis_client.py` (short socket
      timeouts; after a failure, Redis is skipped for 30 s so a Redis outage
      doesn't slow every request). Tests use `fakeredis` (dev dependency).
- [ ] **Automatic embedding retry.** A capture whose embedding fails enqueues
      a retry at 1, 5 and 30 minutes (RQ scheduled jobs; the worker runs with
      the scheduler).
- [ ] **More workers.** `WORKER_COUNT` in `docker-compose.prod.yml` (default 2);
      README shows running two locally.
- [ ] **Stale container guard.** README and `compose:up` keep the containerised
      backend/worker off by default (they keep reappearing on port 8000).
- [ ] **Owner actions (D9):** turn on OpenRouter's "don't route to providers
      that train" setting; confirm the `GEMINI_API_KEY` project has billing
      enabled (paid terms) or remove Gemini as the backup.

**Done when:** all tasks have tests, `npm run test:backend` and
`npm run eval:rag` pass, and a provider outage makes Ask fail fast (< 12 s)
instead of hanging.

### S2 — Observability baseline (2–3 days)

**Goal:** measure before changing the pipeline, so every later stage can prove
it helped.

- [ ] Structured logs with `request_id` (already in the envelope meta) on API
      and workers: JSON when `LOG_FORMAT=json` (production default), readable
      text in development.
- [ ] **Sentry** (or an equivalent) for API and worker errors; `SENTRY_DSN`
      from env, off when unset; no personal data sent (`send_default_pii`
      off, request bodies not attached). The web app and extension follow in
      S10: the browser needs a Content-Security-Policy change for the Sentry
      host and the privacy policy must name Sentry before it is turned on.
- [ ] Metrics endpoint `/metrics` (Prometheus format) when `METRICS_ENABLED`.
      It sits outside `/api/`, which is all nginx forwards, so it isn't public
      in production. With several uvicorn workers set `PROMETHEUS_MULTIPROC_DIR`
      so one scrape covers every process. Metrics: request latency per route,
      Ask stage timings (embed, search, answer; rerank from S4), queue lengths,
      AI provider errors. Cache hit rate is added in S6 with the cache.
- [ ] **`llm_usage` table** (section 7): one row per external AI call (user,
      purpose, provider, model, tokens in/out, cost, latency, success). Tokens
      come from the provider's usage report; `cost_usd` is stored when the
      provider reports it (OpenRouter usage accounting) and left null
      otherwise. The answer-metadata call counts as `answer`. Needed for cost
      tracking now and for plan limits in L1.
- [ ] **Answer feedback:** `POST /answers/feedback` stores 👍/👎 in
      `answer_feedback` (a hash of the question, not its text); the Ask page
      gets 👍/👎 on today's answers now, and S7 extends it to both answer
      modes.
- [ ] Baseline numbers recorded in TASKS.md (current p50/p95 Ask time,
      provider error rate).

**Done when:** for any Ask we can see each stage's time and what it cost.

### S3 — Local embeddings (3–4 days)

**Goal:** search never needs the internet (fixes P1, P3).

- [x] `LocalEmbeddingAdapter` in `embedding_service.py` (`model_id`
      `local:<model>`), `EMBEDDING_PROVIDER=local`, `LOCAL_EMBEDDING_MODEL`,
      `MODEL_CACHE_DIR`. Model loaded once per process; query/passage prefixes
      where the model needs them.
- [x] Migration: `memory_chunks.embedding_local vector(768)` + HNSW cosine
      index. Keep `embedding vector(1536)` until S10 so rollback is a setting.
      `embedding_model` keeps describing `embedding` only; `embedding_local`
      always holds `LOCAL_EMBEDDING_MODEL` vectors, so a same-size model change
      needs `--embed --force`.
- [x] `scripts.reprocess_memories --embed` fills `embedding_local`
      (`--force` re-embeds every chunk).
- [x] Retrieval reads the column matching the active provider.
- [x] Eval both D4 models on `scripts/eval-rag/questions.json`; pick one; re-run
      the `RAG_MIN_SIMILARITY` sweep for it; record results in TASKS.md.
- [x] Model files baked into the Docker image; downloaded once locally.

**Done when:** with every provider key removed, search and Ask retrieval work,
and eval meets the section 2 target.

### S4 — Local reranker (2–3 days)

**Goal:** the best passage reaches the top (fixes P9 for the current pipeline,
and powers the instant answer in S6).

- [x] `RerankerService` (`app/services/retrieval/reranker.py`) using a
      `fastembed` cross-encoder; model chosen by eval (start with
      `BAAI/bge-reranker-base`; a smaller MiniLM cross-encoder if CPU time is
      too high). **Chosen 2026-11-21 (owner): `jinaai/jina-reranker-v1-tiny-en`**;
      bge-reranker-base took ~17 s for 30 candidates on a laptop CPU.
- [x] Retrieval: RRF candidates (top **10**, `RAG_RERANK_CANDIDATES`) → rerank
      → MMR → top 6. Passages scored one at a time (batches pad to the longest
      passage) and cut to 1,200 characters, title and heading first.
- [x] Add the long-page cases from TASKS.md to `questions.json` (10 cases with
      a `passage` the answering chunk must contain).
- [x] Measure rerank time. The original target (p95 < 150 ms for 30
      candidates) is not reachable on CPU: every cross-encoder costs ~25–30 ms
      per passage. **Revised (owner, 2026-11-21): p95 < 350 ms**; measured
      p50 243 ms, p95 322 ms with 10 candidates.

**Done when:** eval MRR is equal or better. **Revised (owner, 2026-11-21):**
the long-page cases moved to S5: their misses come from candidate recall
(answering chunk outside the top candidates or under the similarity bar) and
chunking, which a reranker can't fix.

### S5 — Save pipeline v3 (5–7 days)

**Goal:** better chunks, background enrichment, and no per-page AI cost
(fixes P4, P9, P10, P11, P13).

- [x] **Chunking:** raise `MIN_SECTION_CHARS` (start at 800) so short headed
      sections merge; re-chunk with `--reclean`; confirm average chunk size
      moves toward 400 tokens without hurting eval. (800: PDF 188 → 328 tokens,
      webpage 185 → 266; eval MRR 0.84 → 0.86.)
- [x] **PDF title fallback:** first heading when the PDF has no metadata title.
      (A title that is only an ID or a generic file name; a file name with
      words just loses `.pdf`.)
- [x] **Queues:** `sentiora.capture` and `sentiora.enrich`; workers can listen
      to either.
- [x] **Enrichment job** `enrich_memory(memory_id)`: one structured call
      (pydantic-validated) returning `summary`, `key_points` (≤ 8),
      `questions` (5–10, each with its answering chunk index) and one context
      line per chunk. Input capped at ~12,000 characters plus headings. Saved
      text passes through `rag_sanitize.py`. Usage logged to `llm_usage`.
      **Groq only** (owner, 2026-11-21): no paid fallback; a rate-limited
      provider means a retry later.
- [x] **Lazy enrichment rules** — a save is enriched when any of these happens:
      the user clicks **Save now** in the extension, opens it in the app, or it
      appears in an Ask answer. Auto-saved pages are never enriched on capture.
      A per-user daily cap (`ENRICH_DAILY_LIMIT`, default 50) protects cost.
- [x] **Retries:** 1 min, 5 min, 30 min, 6 h, then `enrichment_status = failed`.
- [x] **Store:** `memory_items.summary` (column exists, unused today),
      `key_points`, enrichment fields; `memory_questions` rows with local
      embeddings; ~~context line embedded together with its chunk text
      (contextual retrieval) by re-embedding that chunk~~. **Revised (owner,
      2026-11-21):** context lines are stored, not embedded: embedding them
      scored lower (long-page 6/10 → 5/10, MRR 0.86 → 0.83), since on long
      saves the model sees ~110 characters per chunk. Each question's
      answering chunk is picked locally (the model's pick and the 5 nearest
      chunks, scored by the reranker), not taken from the model.
- [x] **Backfill:** `scripts.reprocess_memories --enrich [--user EMAIL]`,
      rate-limited and resumable.
- [x] `GET /memory-items/{id}` returns `summary`, `key_points`,
      `enrichment_status`.

**Done when:** an outage only delays enrichment and deleting a memory removes
its questions. **Revised (owner, 2026-11-21):** "eval with enrichment beats
eval without it" and the long-page cases moved to S6: enrichment pays off in
retrieval through the question-bank leg, which S6 adds.

### S6 — Ask v3 (5–7 days)

**Goal:** instant answer by default, AI on a button, bounded (fixes P1, P12).

- [ ] **Question-bank leg:** nearest `memory_questions` (mapped to their
      chunks) as a third RRF list, behind `RAG_QUESTION_MIN_SIMILARITY` (D14).
- [ ] **Instant answer** (`app/services/answer/extractive.py`): split the
      reranked chunks into sentences (transcripts: time-aligned lines), score
      (question, sentence) pairs with the reranker, keep the top 3–5 above
      `RAG_EXTRACT_MIN_SCORE`, max 2 per source, add the neighbouring sentence
      when short, render Markdown with `[S#]` citations. Replaces
      `_local_fallback_answer`.
- [ ] **Special cases:** summary questions scoped to one save → stored summary
      and key points; listing and "which sources mention" answers unchanged;
      nothing above the threshold → existing "not in your saves" answer plus
      the AI button for general questions; compare/contrast questions → instant
      answer with the AI button highlighted.
- [ ] **Follow-ups** from matched saves' stored questions (no model call).
- [ ] **`answer_mode`** on `/chat` and `/chat/stream`: `instant` (default) |
      `ai`. `ASK_DEFAULT_MODE` setting; `ai` reproduces v2 for rollback.
- [ ] **AI path:** reuses the retrieved sources (no second retrieval); one
      streamed call returns the answer and follow-ups (the separate metadata
      call is removed); citation check as today; vague follow-ups are rewritten
      inside this call.
- [ ] **AI gate:** Redis semaphore `LLM_MAX_CONCURRENT` (default 10) across all
      processes; when full → `AI_BUSY` with `retry_after`; circuit breaker from
      S1.
- [ ] **Answer cache:** Redis, 24 h, key = user + normalised question + scope +
      mode + library version (latest `memory_items.updated_at`).
- [ ] Usage of every AI call logged to `llm_usage`.

**Done when:** the instant path makes zero external calls (a test stub fails if
any provider is called), and 50 parallel AI requests make at most
`LLM_MAX_CONCURRENT` provider calls with clean `AI_BUSY` for the rest. Moved
from S5: eval with the question-bank leg beats eval without it, and the
long-page cases (`long-*` in `questions.json`) pass.

### S7 — Web app and extension (4–5 days)

**Goal:** the new flow is clear to users. Design notes go in `DESIGN.md` §5.5.

- [ ] Ask page: instant answer first ("Quoted from your saves" badge), quoted
      sentences highlighted, citation chips and sources panel as today.
- [ ] **Explain with AI** button under each answer; streams below the instant
      answer; busy and error states; Stop.
- [ ] 👍/👎 on both answer types.
- [ ] Memory detail drawer: summary and key points when enriched; "Summarise"
      triggers enrichment for that save.
- [ ] Ask history stores both answers per turn.
- [ ] Extension: **Save now** marks the save for enrichment; popup shows saved /
      processing / ready.
- [ ] Edit a memory's title (endpoint in section 8).
- [ ] Dashboard: one statistics request per load.
- [ ] **Privacy notice at sign-up (D10):** the register page shows the approved
      notice with a required "I agree" checkbox; the API stores the version and
      time. Signed-in users with an older version see the notice once before
      their next AI request; AI requests without current consent return
      `PRIVACY_CONSENT_REQUIRED`. Instant answers and search are not blocked.

**Done when:** Vitest and Playwright cover instant, AI, busy and feedback
states, and the R7 accessibility list still holds (375 px, keyboard, focus,
reduced motion).

### S8 — Quality, security and privacy (3–4 days)

- [ ] `npm run eval:rag` in CI with thresholds; a PR that lowers hit@6 or MRR
      below target fails. Runs on the fixture library (D15).
- [ ] Answer eval: `expected_answer` substrings in `questions.json`; metric
      "answer hit" for the instant answer.
- [ ] Security tests: cross-user isolation on every new query (question bank,
      cache keys), prompt-injection text inside saves, rate limits.
- [ ] **Account deletion** removes memories, chunks, questions, feedback, usage
      rows and cache keys (DPDP Act).
- [ ] Verify YouTube capture in a real signed-in Chrome profile.
- [ ] Windows: `npm run dev:backend` reload crash fixed or documented.

**Done when:** CI runs lint, typecheck, unit, eval and E2E on every PR, and the
security tests pass.

### S9 — Load test (2–3 days)

- [ ] `scripts/load/` (k6): 500 signed-in virtual users browsing, 10% asking
      at once, 5% clicking Explain with AI (provider stubbed), on the
      production compose.
- [ ] Pass: instant answer p95 < 1 s, zero 5xx, DB pool never exhausted,
      queue drains, memory stable.
- [ ] Results and the server size used recorded in TASKS.md; tune
      `API_WORKERS`, pool size, `LLM_MAX_CONCURRENT`.

**Done when:** the targets in section 2 are met.

### S10 — Launch readiness (remaining Phase 9) (4–6 days)

- [ ] Decide O1; provision server, managed Postgres (pgvector) with daily
      backups, managed Redis, PgBouncer, CDN for the frontend, HTTPS.
- [ ] **Error tracking in the browser:** Sentry for the web app and extension
      (`VITE_SENTRY_DSN`, off when unset), the nginx Content-Security-Policy
      allowing the Sentry ingest host, and Sentry named in the privacy policy.
- [ ] Production env and secrets; `npm run check:secrets` clean.
- [ ] **Production AI providers (D9):** Anthropic adapter using the official
      `anthropic` Python SDK (`LLM_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`,
      `ANTHROPIC_CHAT_MODEL=claude-haiku-5-5`) for AI answers; enrichment
      submitted through the Message Batches API; Gemini paid tier as backup;
      OpenRouter removed from production config. Re-run the answer eval on the
      production model.
- [ ] Drop the old `embedding vector(1536)` column once the local model is
      confirmed in production.
- [ ] Privacy policy (the D10 notice, providers' retention periods, deletion),
      terms; reviewed by a lawyer (DPDP Act).
- [ ] Chrome Web Store assets and submission (`npm run package:extension`).
- [ ] Update `RELEASE.md`; runbook for restarts, backups, key rotation.
- [ ] Smoke test in production; monitoring alerts on.

**Done when:** real users can sign up, install the extension, save and ask in
production.

### Later — L1: Plans, limits and payments (after S10 and testing)

Not part of the rebuild. Planned here so the rebuild leaves room for it.

- Plans stored as data (`plans` table): Free, Student, Plus, Pro. Limits per
  plan: AI answers/day (Free **15**), enrichment/day, saves stored, model tier,
  features (cross-save compare, export).
- Daily limits reset at midnight in the user's time zone; failed AI answers
  don't count; instant answers and search are never limited.
- Entitlement checks on the server for every AI request, using Redis counters
  and `llm_usage`.
- Upgrade prompt when the limit is reached (instant answer still shown).
- Student: college email domain check **and** ID upload with manual or assisted
  review; re-verify yearly.
- Payments on the website only (Chrome Web Store payments no longer exist):
  Razorpay for India (UPI, cards, subscriptions, webhooks); Stripe later for
  international users. GST invoicing needs a CA's advice.
- Prices set from real `llm_usage` cost data after a beta (each plan ≥ 3–5×
  its AI cost).

---

## 7. Database changes

All through Alembic migrations, in the stage shown. `docs/DATABASE.md` is
updated in the same PR.

| Stage | Change |
| ----- | ------ |
| S2 | New `llm_usage`: `id`, `user_id` (nullable for system jobs, indexed), `purpose` (`answer` \| `enrich` \| `rewrite` \| `embed`), `provider`, `model`, `tokens_in`, `tokens_out`, `cost_usd` numeric, `latency_ms`, `success` bool, `error_code`, `created_at` (indexed with `user_id`) |
| S2 | New `answer_feedback`: `id`, `user_id`, `question_hash`, `answer_mode`, `rating` (+1/−1), `comment` (nullable, ≤ 1000 chars), `source_chunk_ids` uuid[], `created_at` |
| S3 | `memory_chunks.embedding_local vector(768)` + HNSW `vector_cosine_ops` index (migration `008_local_embeddings`) |
| S5 | `memory_items`: `key_points jsonb`, `enrichment_status` (`none` \| `queued` \| `ready` \| `failed`), `enrich_requested_at`, `enriched_at`, `enrichment_model`; existing `summary` starts being used |
| S5 | `memory_chunks.context text` (enrichment context line) |
| S5 | New `memory_questions`: `id`, `memory_id` (FK, cascade), `user_id` (indexed), `chunk_id` (FK `memory_chunks`, nullable, `ON DELETE SET NULL`), `question text`, `embedding_local vector(<dims>)` (HNSW), `created_at` |
| S7 | `users`: `privacy_consent_version` (text, nullable), `privacy_consented_at` (timestamptz, nullable) |
| S10 | Drop `memory_chunks.embedding vector(1536)` and its index |
| L1 | `plans`, `subscriptions`, `payments`, `student_verifications` (designed in L1) |

---

## 8. API changes

Contract documented in `docs/API.md` and `docs/api/openapi.json` (S0). All
responses keep the envelope.

| Stage | Endpoint | Change |
| ----- | -------- | ------ |
| S2 | `POST /api/v1/answers/feedback` | New. Body: `question`, `answer_mode`, `rating`, `comment?`, `source_chunk_ids`. 201. |
| S5 | `GET /api/v1/memory-items/{id}` | Adds `summary`, `key_points`, `enrichment_status`. |
| S5 | `POST /api/v1/memory-items/{id}/enrich` | New. Queues enrichment for one save (Summarise button, Save now). 202; 409 `ENRICHMENT_ALREADY_QUEUED` if already queued; 429 `RATE_LIMITED` past `ENRICH_DAILY_LIMIT`. |
| S5 | `POST /api/v1/memory-items` | Optional `enrich: bool` (extension sends `true` for Save now). |
| S6 | `POST /api/v1/chat`, `POST /api/v1/chat/stream` | New request field `answer_mode: "instant" \| "ai"` (default from `ASK_DEFAULT_MODE`). `final.mode` gains `"instant"`; `final` adds `aiAvailable`. New error code `AI_BUSY` (429, `retry_after`). `/chat` keeps its shape and reports `instant` as `memory`. |
| S7 | `PATCH /api/v1/memory-items/{id}` | New. Body: `title` (1–300 chars). |
| S7 | `GET /api/v1/dashboard/statistics` | Returns everything the dashboard needs in one response. |
| S7 | `POST /api/v1/auth/register` | New required field `privacy_consent_version` (must equal `PRIVACY_NOTICE_VERSION`); 422 otherwise. |
| S7 | `GET /api/v1/auth/me` | Adds `privacy_consent_version`, `privacy_consent_current` (bool). |
| S7 | `POST /api/v1/users/me/privacy-consent` | New. Body: `version`. Records consent to the current notice. 200. |
| S8 | `DELETE /api/v1/users/me` | New (D15). Body: `password`. Hard-deletes the user, their memories, chunks, questions, feedback, `llm_usage` rows, sessions and refresh tokens, and their answer-cache keys. 200; 401 `AUTH_INVALID_CREDENTIALS` for a wrong password. |
| S7 | `POST /api/v1/chat`, `POST /api/v1/chat/stream` (`answer_mode: "ai"`), `POST /api/v1/memory-items/{id}/enrich` | New error code `PRIVACY_CONSENT_REQUIRED` (403) when the user hasn't accepted the current notice. |

---

## 9. Configuration changes

Documented in `backend/.env.example` and `app/core/config.py` in the stage
that adds them.

| Setting | Default | Stage |
| ------- | ------- | ----- |
| `LLM_CHAT_TIMEOUT_SECONDS` | 10 | S1 |
| `LLM_META_TIMEOUT_SECONDS` | 8 | S1 |
| `EMBEDDING_TIMEOUT_SECONDS` | 10 | S1 |
| `WORKER_COUNT` (compose) | 2 | S1 |
| `LOG_FORMAT` | `text` in development, `json` otherwise | S2 |
| `SENTRY_DSN` | unset (off) | S2 |
| `SENTRY_TRACES_SAMPLE_RATE` | 0 (errors only) | S2 |
| `METRICS_ENABLED` | true | S2 |
| `PROMETHEUS_MULTIPROC_DIR` (env, read by `prometheus_client`) | unset | S2 |
| `EMBEDDING_PROVIDER` | gains `local` | S3 |
| `LOCAL_EMBEDDING_MODEL` | `nomic-ai/nomic-embed-text-v1.5-Q` (D4 eval) | S3 |
| `MODEL_CACHE_DIR` | `backend/.models` | S3 |
| `RAG_MIN_SIMILARITY` | 0.65 with the local model (code default stays 0.25 for remote embeddings; set in `.env.example` and compose) | S3 |
| `RERANKER_MODEL` | `jinaai/jina-reranker-v1-tiny-en` (S4 eval; `none` turns it off) | S4 |
| `RAG_RERANK_CANDIDATES` | 10 (S4 eval) | S4 |
| `ENRICH_DAILY_LIMIT` | 50 | S5 |
| `ENRICH_MODEL` | cheapest configured chat model | S5 |
| `ASK_DEFAULT_MODE` | `instant` | S6 |
| `RAG_EXTRACT_MIN_SCORE` | set by eval | S6 |
| `RAG_QUESTION_MIN_SIMILARITY` | 0.60 (D14) | S6 |
| `RAG_RERANK_MIN_SCORE` | -0.6 (S8 eval, D16); unset turns the veto off | S8 |
| `LLM_MAX_CONCURRENT` | 10 | S6 |
| `ANSWER_CACHE_TTL_SECONDS` | 86400 | S6 |
| `VITE_SENTRY_DSN` (root `.env`, build time) | unset (off) | S10 |
| `PRIVACY_NOTICE_VERSION` | `2026-11-20` | S7 |
| `GROQ_API_KEY` | unset | D11 |
| `GROQ_CHAT_MODEL` | `openai/gpt-oss-120b` | D11 |
| `LLM_PROVIDER` | gains `anthropic` | S10 |
| `ANTHROPIC_API_KEY` | unset | S10 |
| `ANTHROPIC_CHAT_MODEL` | `claude-haiku-5-5` | S10 |

---

## 10. Definition of done

A task is done only when all of these hold:

- Code follows section 3 and the layering rules.
- Tests: unit tests for new logic; API tests for new endpoints; Vitest for new
  UI; Playwright when a user flow changes.
- `npm run lint`, `npm run typecheck`, `npm run test:backend`,
  `npm run test:frontend`, `npm run test:extension` pass.
- `npm run eval:rag` not worse than the section 2 target (retrieval changes).
- New settings in `.env.example` and `config.py`; new tables in
  `docs/DATABASE.md`; new or changed endpoints in `docs/API.md`.
- No secrets, debug prints or `console.log` committed.
- TASKS.md updated.

A stage is done when every task is done, its "Done when" is demonstrated (with
numbers where it has targets), and the owner has seen it.

---

## 11. Working rules

**For everyone**

- Branch per stage or task: `feat/s3-local-embeddings`,
  `fix/s1-stream-db-session`. One PR per task where possible; Conventional
  Commits.
- Never commit to `main` directly. PRs need green CI and one review.
- Don't run the containerised backend/worker next to `npm start` (port 8000 and
  queue conflicts).
- Keep `backend/.env` private; never paste keys in chats, issues or docs.

**For AI agents (in addition to `AGENTS.md`)**

- Read this file, `TASKS.md` and the stage you are working on before coding.
- Work only on the current stage's unticked tasks. Don't start the next stage.
- Don't add endpoints, fields, tables, columns or settings that are not in
  sections 7–9; propose a plan change instead.
- When this plan conflicts with older docs, this plan wins (section 1). When it
  conflicts with the code in a way the plan didn't expect, stop and ask.
- Show evidence when claiming a task is done: test output, eval numbers,
  timings.

---

## 12. Document status

Reviewed 2026-11-20 against the code; applied in S0 the same day. Archived
documents are in `docs/archive/` (kept for history, no longer followed; see
`docs/archive/README.md`). Nothing was deleted.

| Document | Status | Why |
| -------- | ------ | --- |
| `REBUILD_PLAN.md` (this) | **Current** | Rebuild source of truth |
| `TASKS.md` | **Current** | Progress tracker |
| `API.md` + `api/openapi.json` | **Current** (S0) | API contract; `openapi.json` generated with `npm run docs:api` |
| `DATABASE.md` | **Current** (S0) | Schema contract at the current Alembic head |
| `DESIGN.md` + `design/` | **Current** | Design system used by the code |
| `RAG_v2_ADDENDUM.md` | **Current** until S6 | Describes today's retrieval and Ask; this plan overrides it where they differ |
| `RELEASE.md` | **Current**, update in S10 | Deployment and packaging |
| `README.md` (docs index) | **Current** (rewritten in S0) | |
| `PROMPT_GUIDE.md` | **Current** (updated in S0) | |
| `TEAM_SETUP.md` | **Current** (moved from `qa-audit/` in S0) | Setup and troubleshooting |
| Root `CONTRIBUTING.md`, `AGENTS.md` | **Current** (updated in S0) | |
| `Capture_Module_v2_Technical_Design.pdf` | **Current** | Short; matches the capture code |
| `01_PRD_v2.1_FINAL.pdf` | **Kept as product vision**, superseded in scope | Footprint and Shield modules (not built) and the original MVP scope; product scope is now Memory + Ask (this plan) |
| `archive/02_SRS_v1.0.pdf` | **Archived** | Requirements for modules and integrations that don't exist; useful NFRs are in section 2 |
| `archive/03_Backend_Technical_Specification_v1.2.pdf` | **Archived** | Describes Celery and S3; the code uses RQ and no object storage |
| `archive/04_Technical_Specification_v1.2.pdf` | **Archived** | August four-person roadmap and day-one guide; historical |
| `archive/05_API_Specification_v1.0.pdf` | **Archived** | ~90 endpoints specified (collections, admin, favorites, uploads…); 23 exist, several with different paths (`/memory-items`, `/chat`). Replaced by `API.md` |
| `archive/06_Database_Schema_Design_v1.2.pdf` | **Archived** | Many designed tables (collections, embeddings, integrations…); 6 exist. Replaced by `DATABASE.md` |
| `archive/07_Development_Implementation_Plan.pdf` | **Archived** | Phases 0–8 done; Phase 9 continues as S10 here |
| `archive/08_UIUX_Specification_v1.0_FINAL.pdf` | **Archived** | Replaced by `DESIGN.md` (redesign) |
| `archive/qa-audit-2026-10-25/` | **Archived** | Audit report, test results, bug register and cross-machine checklist from the 2026-10-25 stabilization pass |
| `RAG_v3_ADDENDUM.md` | Removed (never committed) | Draft merged into this plan |

Files in the repo folder that are not documentation and are not tracked by git
(clean up locally, keep out of the repo): `Sentiora_*_Report_2026-11-18.docx/.pdf`,
`sentiora-handoff.zip`, `swaraj_diff.patch`, `release/*.zip`,
`playwright-report/`, `test-results/`.

---

## 13. Risks

| Risk | Mitigation |
| ---- | ---------- |
| Instant answers read less smoothly than AI answers (worst on spoken YouTube text) | Use stored key points for videos when scores are close; AI button one click away; 👍/👎 data to tune |
| Small local embedding model below `text-embedding-3-small` | D4 eval; question bank and contextual chunks; nomic as fallback |
| CPU load from the reranker under load | ≤ 30 candidates, ≤ 60 sentences per question; S9 measures; smaller cross-encoder if needed |
| Model download size / cold start | Bake models into the Docker image; `MODEL_CACHE_DIR` locally |
| Re-chunking changes citations of old answers | Ask history stores the answer text; re-chunk once in S5 before launch |
| Scope creep (payments, teams) | L1 is explicitly after S10 |
| Provider privacy terms | D9/D10: paid, no-training providers only; notice accepted at sign-up; policy reviewed before launch |
| Development model differs from production (OpenRouter now, Anthropic direct in S10) | Provider adapters behind one interface (`llm_pool.py`); answer eval re-run on the production model in S10 |

---

## 14. Glossary

| Term | Meaning |
| ---- | ------- |
| Chunk | A piece of a saved page (~400–600 tokens) stored with its vector |
| Embedding / vector | A list of numbers representing a text's meaning; close vectors = similar meaning |
| HNSW | The fast nearest-neighbour index pgvector uses for vectors |
| Full-text search | Postgres keyword search (`tsvector`) |
| RRF | Reciprocal Rank Fusion: merges ranked lists; each item scores `1/(60 + rank)` per list |
| MMR | Maximal Marginal Relevance: picks results that are relevant but not repetitive |
| Reranker / cross-encoder | A model that reads the question and a passage together and scores how well the passage answers it |
| Enrichment | Background AI step that writes a save's summary, key points, questions and chunk context |
| Question bank | The questions enrichment generates, searched like chunks |
| Contextual retrieval | Adding a one-line context to each chunk before embedding it |
| Instant answer | The default answer: best sentences quoted from the user's saves, no AI |
| AI answer | The written answer from the chat model, on "Explain with AI" |
| Circuit breaker | Stops calling a failing provider for a short time so requests fail fast |
| Semaphore | A shared counter limiting how many AI calls run at once |
| p95 | 95% of requests are faster than this |
