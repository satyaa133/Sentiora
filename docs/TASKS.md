# Sentiora Tasks & Progress Tracker

## 1. Project Overview
* **Brief description of Sentiora**: A memory-oriented application that seamlessly captures and indexes user content (webpages, PDFs, YouTube) for semantic search and AI-driven retrieval.
* **Product vision**: To provide users with a private, intelligent, and context-aware second brain that securely stores and retrieves their digital footprint.
* **MVP objective**: Deliver an end-to-end loop where a user can authenticate, capture content via a Chrome extension or web uploader, view it on a web dashboard, and perform semantic search and RAG-based chat with citations, deployed to a production environment.

---

## 2. Current Development Status

| Phase | Status | Completion | Notes |
| ----- | ------ | ---------- | ----- |
| Phase 0: Environment & Foundations | ✅ Completed | 100% | Scaffolding, Docker, CI skeleton, DB config |
| Phase 1: Authentication | ✅ Completed | 100% | Backend endpoints, frontend flow, DB schema for users |
| Phase 2: Chrome Extension Skeleton | ✅ Completed | 100% | Manifest V3, popup shell, permission model skeleton |
| Phase 3: Capture Pipeline | ✅ Completed | 100% | Meaningful Capture Engine (webpage, YouTube, PDF, blocklist) |
| Phase 4: Backend Core APIs | ✅ Completed | 100% | Memory CRUD APIs, DB migration, RQ processing job |
| Phase 5: Frontend Dashboard | ✅ Completed | 100% | Memory Feed UI, compact timeline cards, detail drawer, stats, auto-sync |
| Phase 6: Search | ✅ Completed | 100% | Semantic pgvector search, lexical fallback, user isolation |
| Phase 7: AI / RAG Chat | ✅ Completed | 100% | Real LLM integration (OpenAI), grounded RAG pipeline, citations, 503 error handling, content dedup |
| Phase 8: Testing | ✅ Completed | 100% | Dedicated test DB with safety guard; pytest (incl. YouTube, authz, security); Vitest (incl. service worker); Playwright API + real-UI flows on an isolated stack |
| Phase 9: Deployment & Launch | 🟡 In Progress | 70% | Production compose validated locally; extension packaging script + store checklist; brand icons, favicon and link-preview image done. Pending: real deployment, store listing assets, privacy policy, submission |

### UI/UX redesign (docs/DESIGN.md)

| Redesign phase | Status | Commit | Notes |
| -------------- | ------ | ------ | ----- |
| 1-7: Tokens, UI kit, popup, landing, app shell, remaining views, final pass | ✅ Completed | 028af6b … beb0a2b | Built to DESIGN.md v1 |
| 8: Honest auto-save | ✅ Completed | 7ca4d99 | Signed-out sessions send nothing; Privacy Center blocklist synced to the extension; larger built-in sensitive list (Indian and global finance, health, ID) and sign-in URLs; popup page status |
| 9: Logo, icons, link preview | ✅ Completed | 3030260 | Wordmark with the coral dot and 10s wave; favicon, extension icons and OG image regenerated (`npm run icons:extension`, `npm run og:image`) |
| 10: Echo companion, corner mode | ✅ Completed | 91fe855 | New Echo states and arms; corner Echo on app pages reacting to real events only; opt-in Web Audio sound |
| 11: Roaming Echo, easter eggs, 404 | ✅ Completed | 466f707 | Landing and 404 only |
| 12: Landing header, hero, live demo | ✅ Completed | 167ced2 | Static sample libraries; no API calls |
| 13: Landing sections, final order | ✅ Completed | c20a41c | Before/after, scroll story, extension clip, privacy flow |
| 14: Performance and docs | ✅ Completed | this commit | App pages code-split; landing LCP 1.75s on throttled mobile (`npm run perf:landing`) |

### Ask Sentiora RAG v2 (docs/RAG_v2_ADDENDUM.md, branch `feat/ask-rag-v2`)

| Phase | Status | Notes |
| ----- | ------ | ----- |
| R1: Ingestion cleanup | ✅ Completed | Rolling-caption normalizer, title kept out of chunk text, `scripts.reprocess_memories --reclean` |
| R2: Chunking | ✅ Completed | Recursive 400–600 token chunks with 15% overlap, 60–90s transcript windows, migration 006 (`start_sec`, `end_sec`, `embedding_model`, tsvector GIN indexes) |
| R3: Embeddings | ✅ Completed | OpenRouter embeddings (pluggable), per-chunk `embedding_model`, same-model queries only, non-fatal capture embedding, `--embed` backfill |
| R4: Retrieval | ✅ Completed | LLM query rewrite, pgvector + Postgres full-text fused with RRF, `RAG_MIN_SIMILARITY` 0.25, near-dup removal, MMR (same-memory redundancy by text overlap), 2 chunks per memory or up to 4 when one save leads every top slot, top 6 |
| R5: Generation | ✅ Completed | Unified `[S#]` prompt, SSE `POST /chat/stream`, strict json_schema metadata (mode, usedSources, followUps), `OPENROUTER_FALLBACK_MODELS`, `/chat` shape kept |
| R6: Env and keys | ✅ Completed | `OPENROUTER_API_KEY_1..N` auto-detected, exponential cooldown with Retry-After, `LLM_MAX_ATTEMPTS`, readable startup validation, `npm run check:secrets` in CI |
| R7: Ask page UX | ✅ Completed | Streaming with Stop/Regenerate, `[S#]` citation chips with previews and video timestamps, collapsible sources, mode badge, model follow-ups, scope picker, local history, keyboard shortcuts |
| R8: Evaluation | ✅ Completed | `npm run eval:rag` (hit@k, MRR, noise, reject, threshold sweep); dev baseline hit@6 1.00, MRR 0.96, reject 1.00; `RAG_MIN_SIMILARITY` kept at 0.25 |

### Rebuild v3 (docs/REBUILD_PLAN.md)

Approved direction 2026-11-20: instant answers from the user's saves with no external AI call at question time, AI on an "Explain with AI" button, local embeddings and reranker, lazy background enrichment, observability and a 500-user load test. Runs before the rest of Phase 9, which becomes S10. Plans and payments (L1) come after.

| Stage | Status | Notes |
| ----- | ------ | ----- |
| S0: Documentation reset | ✅ Completed | REBUILD_PLAN.md; `docs/API.md` + generated `docs/api/openapi.json` (`npm run docs:api`, `--check`); `docs/DATABASE.md` (6 tables, head `006_rag_v2_chunks`); AGENTS, PROMPT_GUIDE, CONTRIBUTING, README and docs index updated; superseded PDFs and the 2026-10-25 QA reports moved to `docs/archive/`; TEAM_SETUP.md moved to `docs/` |
| S1: Reliability fixes | ✅ Completed (owner OK 2026-11-21; PR #13) | Branch `fix/s1-reliability`. Done: DB connection released before streaming (1 → 0 held per stream); `LLM_CHAT_TIMEOUT_SECONDS` (10) as one budget per answer, `LLM_META_TIMEOUT_SECONDS` (8), `EMBEDDING_TIMEOUT_SECONDS` (10); rate limits and AI key cooldowns shared through Redis with in-memory fallback (`app/core/redis_client.py`); `hnsw.iterative_scan = relaxed_order` on every connection (reproduction: 0 → 5 of a user's chunks found); capture embedding retried after 1, 5, 30 min, with due jobs moved by a worker thread (RQ's scheduler process fails on Windows); `WORKER_COUNT` (2) in production. Gemini is now a true backup: only `LLM_PROVIDER` keys rotate, other providers are tried after them (D9). Backend tests 294 pass (271 before S1). Eval (dev data, 21 questions): hit@6 1.00, MRR 0.94, noise 0.45, reject 1.00. Live outage check (providers unreachable): AI call fails after 11.1 s (was up to 25 s per key). Owner actions (OpenRouter no-training setting, Gemini billing) open |
| S2: Observability baseline | ✅ Completed (owner OK 2026-11-21; PR #14) | Branch `feat/s2-observability`. Log lines carry the request ID (`job_<id>` in the worker), JSON when `LOG_FORMAT=json`; Sentry for API and worker when `SENTRY_DSN` is set (no bodies, auth headers or locals; browser Sentry moved to S10); `/metrics` (request latency per route, Ask stages, AI provider errors, queue lengths; multiprocess in production); `llm_usage` (one row per AI call with provider-reported tokens and cost) and `answer_feedback` (migration 007); `POST /answers/feedback` and Helpful / Not helpful on Ask answers. Backend tests 316, frontend 175, shared 12. **Baseline (2026-11-20, dev data, 15 model answers via OpenRouter):** embed p50 0.73 s / p95 1.20 s; streamed answer p50 3.76 s / p95 4.91 s; metadata call p50 2.40 s / p95 2.78 s; whole Ask incl. metadata p50 6.71 s / p95 8.24 s; provider errors 0/47; cost $0.005 per question, the metadata call costing about as much as the answer. The OpenRouter key then ran out of credit (402); the Gemini fallback took 7–10 s and hit 503/504. Time to first token isn't in the baseline (read it from `sentiora_ask_stage_seconds{stage="answer"}`). |
| S3: Local embeddings | 🟡 Built, awaiting owner OK | Branch `feat/s3-local-embeddings`. `EMBEDDING_PROVIDER=local` embeds on the CPU with fastembed (model loaded once per process, query/passage prefixes); vectors in `memory_chunks.embedding_local vector(768)` + HNSW (migration 008), the 1536-dim `embedding` column kept so going back is a setting; retrieval, capture, retry and dedup use the active provider's column; `--embed [--force]` backfill; model baked into the Docker image (`HF_HUB_OFFLINE=1` at runtime). Backend tests 334 (13 new). **Eval (2026-11-21, dev data, 21 questions, no AI rewrite):** bge-small-en-v1.5 best at 0.60: hit@6 0.95, MRR 0.91, noise 0.46, reject 1.00 (misses n-choose-r → Pascal Triangle); nomic-embed-text-v1.5 at 0.65: 1.00 / 0.94 / 0.40 / 1.00; quantized nomic (-Q) at 0.65: 1.00 / 0.93 / 0.40 / 1.00. Owner chose quantized nomic. `RAG_MIN_SIMILARITY` sweep for it: 0.55 → reject 0.00, 0.60 → 0.50, **0.65 → hit 1.00, MRR 0.93, reject 1.00**, 0.70 → hit 0.95, MRR 0.89 (narrow window; S4 reranker and S8 eval-in-CI should widen it). **With every provider key removed and Hugging Face offline**, the eval gives the same numbers. Question embedding p50 12 ms on CPU; backfill of 1,195 chunks 9.5 min (~0.47 s/chunk, batches of 8 because nomic reads up to 8192 tokens) |
| S4: Local reranker | 🟡 Built, awaiting owner OK | Branch `feat/s4-reranker`. `RerankerService` (fastembed cross-encoder on CPU, loaded once per process, `RERANKER_MODEL=none` turns it off, any failure keeps the fused order) re-orders the top `RAG_RERANK_CANDIDATES` fused candidates before MMR; `rerank` stage in `/metrics`; model baked into the Docker image. Eval gained 10 long-page cases that must find a named passage (`passage` field). Backend tests 343 (9 new). **Eval (2026-11-21, dev data, 31 questions, no AI rewrite, threshold 0.65):** no reranker: original 19 questions MRR 0.93 (19/19), long-page 7/10 MRR 0.57; all 31: hit@6 0.90, MRR 0.81. MiniLM-L-6 or jina-tiny at 10/20/30 candidates: original 19 **MRR 1.00** every time; long-page 6–7/10 (no setting beat no reranker). Rerank time per question (p50 / p95): jina-tiny 10 → 243 / 322 ms, 20 → 477 / 612 ms, 30 → 601 / 969 ms; MiniLM-L-6 similar; bge-reranker-base ~17 s for 30. **Owner chose jina-tiny over 10 candidates**: all 31 hit@6 0.86, MRR 0.84, noise 0.51, reject 1.00. Plan revised: 150 ms target → 350 ms (CPU cost ~25 ms per passage); long-page cases moved to S5 (candidate recall and chunking). Side finding: the dev save "System Design Explained: … Load Balancing" holds a YOLO transcript, not its own (old capture bug) |
| S5: Save pipeline v3 | ✅ Completed (owner OK 2026-11-22; PR #17) | Branch `feat/s5-save-pipeline`. **Chunks:** `MIN_SECTION_CHARS` 200 → 800 (dev library: PDF 188 → 328 tokens, webpage 185 → 266; YouTube unchanged, time windows). **PDF titles:** ID-only or generic names ("1706.03762") use the first title-like line; "TCS NQT.pdf" → "TCS NQT". **Enrichment:** migration 009 (`memory_items` enrichment fields, `memory_chunks.context`, `memory_questions`); one Groq structured call per save (summary, ≤ 8 key points, 5-10 questions, a context line per chunk; input ≤ 12,000 characters; validated before storing); queues `sentiora.capture` / `sentiora.enrich`; triggers Save now (`enrich: true`), `POST /memory-items/{id}/enrich` (202 / 409 `ENRICHMENT_ALREADY_QUEUED` / 429), opening a save, being an Ask source; `ENRICH_DAILY_LIMIT` 50; retries 1 min, 5 min, 30 min, 6 h; lost jobs requeued on worker start; delete and re-chunk clear questions; `--enrich` backfill. Backend tests 370 (27 new: 18 enrichment, 8 PDF titles, 1 chunk merge). **Dev backfill (2026-11-21):** 53 saves, 8 questions each on average; Groq 46 calls, ~1.9k tokens in / 0.7k out, 2.4 s each, 4 rate-limited (429). Before the Groq-only decision 7 calls fell back to OpenRouter and cost $0.066, then 8 got 402 (no credit). **Eval (31 questions, threshold 0.65):** before S5 hit@6 0.86 / MRR 0.84 (long-page 6/10, MRR 0.55); after chunking 0.86 / 0.86 (long-page 6/10, 0.60); with context lines embedded 0.83 / 0.83 (5/10) → **owner: store context lines, don't embed them**; question bank alone (S6 leg, answering chunk picked locally) finds 5/10 long-page answers, two of them ones search misses. **Owner: the "beats no enrichment" and long-page checks move to S6; enrichment is Groq only.** |
| S6: Ask v3 | ✅ Completed (owner OK 2026-11-22, long-page 8/10 left open; PR #18) | Branch `feat/s6-ask-v3`. **Instant answer** (`app/services/answer/extractive.py`, default `ASK_DEFAULT_MODE=instant`): retrieved chunks split into sentences (transcripts: ~28-word lines with an estimated time, the next line added), ≤ 60 scored by the reranker, best ≤ 5 at or above `RAG_EXTRACT_MIN_SCORE` (0.0), ≤ 2 per source, rendered with `[S#]`; replaces `_local_fallback_answer` (also the no-model and after-error fallback). Special cases: no-keyword questions list the latest saves; summary / "what is X about" questions use the stored summary and key points, else the save's opening sentences; listing and "which sources mention" unchanged; nothing above the bar → "not in your saves" with `aiAvailable`. Follow-ups from the matched saves' stored questions. **`answer_mode`** on `/chat` and `/chat/stream`; `final.mode` `instant`, `final.aiAvailable`; `/chat` reports instant as `memory`. **AI path:** one streamed call returns the answer plus a `<<<META>>>` trailer (mode, follow-ups) that is never streamed; the metadata call and the LLM follow-up rewrite are gone (heuristic rewrite; the answer call reads the conversation). **AI gate:** Redis sorted-set semaphore `LLM_MAX_CONCURRENT` (10) across processes, in-process fallback, slots expire after 90 s; full → `429 AI_BUSY` with `details.retry_after` and `Retry-After`. **Answer cache:** Redis, `ANSWER_CACHE_TTL_SECONDS` (24 h), per user + normalised question + scope + turns + day + library version; a mode-independent sources entry lets Explain with AI reuse the instant answer's sources (no second retrieval). Library version = ready count, latest created, latest deleted, latest enriched (not `updated_at`, which Ask's enrichment request bumps on every question). **Question-bank leg:** third RRF list (nearest `memory_questions` → their chunks) behind its own bar `RAG_QUESTION_MIN_SIMILARITY` (0.60; D14, owner 2026-11-22). Web app: `instant` badge "Quoted from your saves" (full UI in S7). Backend tests 390 (20 new in `test_ask_v3.py`, incl. zero provider calls on the instant path and 50 parallel AI requests → ≤ 10 provider calls at once, rest `AI_BUSY`), frontend 176. **Eval (2026-11-22, dev data, 31 questions, threshold 0.65, heuristic follow-ups):** with and without the question-bank leg identical (hit@6 0.86, MRR 0.86, long-page 6/10): question-to-question similarity is 0.60–0.67, so few clear 0.65. A separate bar for that leg: 0.60 → **hit@6 0.93, MRR 0.88, long-page 8/10, reject 1.00**; 0.55 → reject 0.50. **Owner chose 0.60** (`RAG_QUESTION_MIN_SIMILARITY`, D14); with it the eval beats no question bank (0.93 / 0.88 vs 0.86 / 0.86) and instant answers at 0.0 go to 0.76 answered / 0.14 wrong / 0.10 silent. Instant answers by `RAG_EXTRACT_MIN_SCORE` (share of 29 answerable questions; answered = cites an expected save / the passage chunk): -1.0 → 0.83 answered, 0.17 wrong, 0 silent; **0.0 → 0.72 / 0.17 / 0.10**; 0.5 → 0.55 / 0.21 / 0.24; 1.0 → 0.48 / 0.10 / 0.41; reject 1.00 throughout. Quotes from auto-captioned videos read poorly (plan risk). **Latency (instant, warm, local, cache off, 56 questions):** p50 0.99 s, p95 1.43 s: full-text 248 ms, rerank 250 ms, sentence scoring 225 ms, vector 169 ms, question bank 85 ms, embed 17 ms; p95 < 1 s is S9's check. Not done: long-page cases 8/10 (misses `long-adam-bias`, `long-yolo-anchor`) |
| S7: Web app and extension | 🟡 Built, awaiting owner OK | Branch `feat/s7-web-extension`. **Ask page:** instant answer first (`answer_mode: "instant"`, "Quoted from your saves" badge, quotes set off by a coral rule); **Explain with AI** (when `aiAvailable`) streams one AI answer in a panel below the quote, with Stop, `AI_BUSY` note and Try again, errors, its own sources and Copy; primary button for compare questions and not-found answers; Regenerate removed. Helpful / Not helpful on both answers (`instant` / `ai`). History keeps both answers per turn. **Privacy (D10):** migration 010 (`users.privacy_consent_version`, `privacy_consented_at`); register requires `privacy_consent_version` (web sign-up and the extension's Create account show the notice + I agree); `/auth/me` adds `privacy_consent_version` / `privacy_consent_current`; `POST /users/me/privacy-consent`; AI answers and Summarise without current consent → `403 PRIVACY_CONSENT_REQUIRED` and the web app shows the notice once ("Before Echo uses AI"); background enrichment is skipped for them. **Memory drawer:** fetches the save on open (which queues its summary), shows summary + key points, Summarise (daily limit, polls until ready), Rename (`PATCH /memory-items/{id}`). **Extension:** Save now and popup notes send `enrich: true` (automatic saves `false`); the popup follows a save from Processing to Ready. **Dashboard:** one statistics request per load (results reused 10 s; no API change). Tests: backend 395 (5 new), frontend 187 (Ask: instant, AI, busy, consent, ratings; sign-up notice; drawer), extension 158, Playwright 8 (new `ask-v3.spec.ts`: instant + Explain with AI + both ratings, busy + Try again, rename + Summarise, R7 at 375 px with keyboard, focus ring and reduced motion; AI answers are intercepted because the e2e stack has no AI keys). Not checked by hand in the dev app (ports 8000/5173 taken by Docker). Open: the approved D10 notice names Anthropic and Google while development uses Groq and OpenRouter (O2) |
| S8: Quality, security, privacy | ⏳ Pending | Eval in CI, answer eval, isolation and injection tests, full account deletion, YouTube in real Chrome |
| S9: Load test | ⏳ Pending | k6, 500 users, instant p95 < 1 s, zero 5xx |
| S10: Launch readiness | ⏳ Pending | Remaining Phase 9: hosting, backups, PgBouncer, HTTPS, browser error tracking (Sentry, CSP), Anthropic API (Claude Haiku 5.5) + Batch enrichment, privacy policy, store submission |
| L1: Plans and payments | 💤 Later | Free 15 AI answers/day, Student (college email + ID), Plus, Pro; Razorpay |


---

## 3. Completed Work

**Repository & Scaffolding**
* Monorepo folder structure established (`frontend/`, `backend/`, `extension/`, `shared/`)
* Docker and `docker-compose.yml` configured for Postgres, Redis, pgAdmin
* Environment files (`.env.example`) defined across all packages
* Core project documentation added (`docs/`, `AGENTS.md`, `README.md`)
* CI pipeline (`.github/workflows/ci.yml`) defined

**Backend (FastAPI & PostgreSQL)**
* FastAPI initialized with structured modules (`api`, `core`, `models`, `schemas`, `services`, `repositories`)
* PostgreSQL and Alembic integrated with migrations (`001_initial_users`, `002_memory_items`)
* Authentication endpoints (`/auth/register`, `/auth/login`, `/auth/refresh`, `/users/me`) implemented
* Memory Items CRUD APIs (`POST /memory-items`, `GET /memory-items`, `DELETE /memory-items/:id`)
* Async RQ background worker job (`process_capture.py`) for content normalization, chunking, embeddings, and deduplication
* Semantic search (`GET /api/v1/search`) with pgvector retrieval and lexical fallback
* Ask Sentiora RAG chat (`POST /api/v1/chat`) with citations, insufficient-context handling, and a grounded local fallback when the LLM provider is missing or fails
* Echo answer modes (memory / general / combined), hybrid retrieval with date and source scoping, validated citations, client-sent follow-up history; Ask rotates across every configured chat key (`OPENROUTER_API_KEY`, optional `OPENROUTER_API_KEY_2`, `GEMINI_API_KEY`, `OPENAI_API_KEY`) and skips an exhausted or rate-limited key for `LLM_KEY_COOLDOWN_SECONDS`; the Search page uses hybrid semantic search (`GET /api/v1/search`); unbuilt integrations show as "Coming soon"; Timeline server filters and paging; Intelligence view backed by `GET /api/v1/dashboard/statistics`

**Frontend (React + Vite + Tailwind)**
* Vite + React + TypeScript initialized with Parchment glassmorphism design system
* Full Auth flow (Login, Sign Up, Forgot Password, Protected Routes)
* Responsive Memory Timeline View with compact card layouts and sequential date grouping
* Memory Detail Reader Drawer with full article reader, metadata breakdown, source links, and soft delete
* Ask Sentiora AI View with formatted Markdown rendering, source citation cards, and clean copy header
* Connected Sources View with active metrics, PDF/TXT file drag & drop parser, and searchable integration modal (Notion, ChatGPT, Twitter, GitHub, Substack)
* Privacy Center with custom sensitive domain blocklist (`localStorage` persistent) and complete JSON vault export
* Account Settings with user avatar badge, personal vault preferences, and profile configuration
* Fixed sticky navigation header with glass backdrop blur (`bg-parchment-50/95`)

**Stabilization (2026-10-24, branch `fix/get-app-running`)**
* Tests isolated on a dedicated `sentiora_test` database (`backend/tests/testdb.py`); destructive setup refuses non-test targets; dev data verified unchanged by row counts plus an ID fingerprint
* YouTube capture repaired: main-world player bridge (content scripts cannot read page globals), Shorts/live/mobile URLs, canonical URL dedup (extension and backend), transcript-panel fallback for manual capture, typed honest errors, no metadata-only saves
* Transcript timestamps preserved into chunks (`Title [mm:ss–mm:ss]` headings) and citations; long transcripts no longer truncated at 80k chars
* `EMBEDDING_PROVIDER` decoupled from chat provider; broken `text-embedding-004` default replaced; live Gemini 1536-dim embedding verified
* Grounding fix: lexical retrieval needs real token overlap (one stray shared word no longer produces an answer)
* Frontend: removed fabricated card text and fake transcript timestamps; failed captures show status and reason; safe link rendering
* Extension: concurrent duplicate-capture race fixed; popup no longer claims "indexed" before processing; top-frame messaging
* Security: trusted-proxy-only `X-Forwarded-For`, security headers, request body cap, no wildcard extension CORS, stricter production config, script-URL rejection; npm audit 17 → 3 (remaining: Tailwind v3 build-time parser)
* Release: non-root multi-stage images, `docker-compose.prod.yml`, nginx same-origin proxy, `scripts/package-extension.mjs`, `docs/RELEASE.md`

**Jury-readiness fixes (2026-11-18, branch `vansh`, PR #11)**
Found by a full end-to-end test (web app in a real browser, the extension on real pages, live AI models):
* Gemini backup answers again: Gemini 3.x gets `thinking_level=low` (a zero thinking budget made it hang); `GEMINI_CHAT_MODEL=gemini-3.1-flash-lite` locally
* Retrieval: same-memory MMR redundancy is text overlap, not vector closeness (long pages no longer lose the section with the answer); `RAG_SINGLE_MEMORY_CHUNKS` (default 4) when one save leads every top slot, with stragglers from other saves dropped
* Answer prompt: cited sentences may not add reasons the sources do not give
* Sign-up: `example.com` / `example.dev` accepted only with `ALLOW_TEST_EMAIL_DOMAINS` / `VITE_ALLOW_TEST_EMAIL_DOMAINS` (test suite, e2e stack, Playwright)
* Extension: popup text names the Save now button; Wikipedia `[edit]` links stripped; YouTube spoken timestamp labels ("4 seconds") no longer glued into transcript text
* Web app: no "Answer ready" bubble over the Ask page's follow-ups; overlapping dashboard statistics requests share one call
* `scripts.reprocess_memories --retry-failed-embedding` re-runs captures that failed only on embedding; all local memories are embedded
* Live-verified: webpage, PDF and YouTube capture through the extension; demo questions answered with correct citations

**Chrome Extension (Manifest V3)**
* Manifest V3 setup with active permissions (`tabs`, `storage`, `activeTab`)
* DOM content extractor powered by `@mozilla/readability`
* Sensitive-content guard (banking/health domain blocklist, password fields, `noindex`)
* YouTube timedtext transcript extractor (`youtubeCapture.ts`) with description fallback
* Local PDF reader helper (`pdfCapture.ts`)
* Popup UI displaying auth status and live tab capture trigger
* Redesign v2: popup leads with the page status (Saved / Saving / Not saved yet / Blocked); captures need a session before any page is read; the Privacy Center blocklist is honoured; built-in list covers Indian and global banking, UPI and payments, investing, insurance, health and government ID sites, plus sign-in URLs

---

## 4. Current Phase

* **Current active phase**: Phase 9 (Deployment & Launch)
* **Current objectives**: Choose a deployment target, finalize store assets and the privacy policy, verify YouTube transcript capture in a signed-in Chrome profile, and submit the extension.
* **Current deliverables**:
  * Pytest coverage for capture, search, and Ask/RAG (including grounded fallback, multi-memory retrieval, and insufficient-context cases)
  * Vitest suites for dashboard, extension capture utilities, and shared packages
  * GitHub Actions CI running lint, typecheck, test, and build on pull requests
* **Current blockers**: YouTube transcript capture worked through the extension in automated Chromium on 2026-11-18 but is still unverified in a real signed-in Chrome profile. Store assets, privacy policy and the deployment host need owner decisions. Only one OpenRouter key is configured locally; if its credits run out, answers fall back to Gemini (slower, no follow-up suggestions).
* **Current branch**: `vansh` (PR #11 to `main`)

---

## 5. Upcoming Tasks

| Priority | Task | Estimated Complexity | Dependencies | Expected Output |
| -------- | ---- | -------------------- | ------------ | --------------- |
| P1 | Verify YouTube transcript capture in a signed-in Chrome profile | Low | Phase 9 | Confirmed capture or documented limitation |
| P1 | Deploy `docker-compose.prod.yml` to a real host with TLS | Medium | Phase 9 | Running production environment |
| P1 | Brand icons, store screenshots, privacy policy, final data disclosures | Medium | Phase 9 | Store listing assets |
| P2 | Submit extension (`npm run package:extension`) | Low | Store assets | Published extension |
| P2 | Tailwind v4 migration (clears remaining moderate npm audit findings) | Medium | — | Clean `npm audit` |
| P2 | PDF title fallback: use the first heading when the PDF has no metadata title (arXiv PDFs show as `1706.03762`) | Low | — | Readable PDF titles |
| P2 | Edit a memory's title (no endpoint today) | Low | API spec update | Rename from the detail drawer |
| P2 | Long-page retrieval: questions worded unlike the page can miss the best passage ("TCP three-way handshake" vs "How does TCP establish a connection?") | Medium | `npm run eval:rag` cases | Higher hit rate on long saves |
| P2 | Second OpenRouter key and a low-credit warning | Low | Key | No silent fallback to Gemini |
| P3 | `npm run dev:backend` dies on auto-reload on Windows ("Terminate batch job"); run uvicorn without `--reload` meanwhile | Low | — | Stable reload on Windows |
| P3 | Dashboard still sends 3 sequential statistics requests per load | Low | — | One request per load |

### Later (redesign follow-ups, not in the current redesign)

From DESIGN.md §12 and items deferred while building v2:

| Task | Notes |
| ---- | ----- |
| "Try it on any link" in the landing hero | Needs a backend fetch of a public URL; the extension-only extraction rule applies today |
| Memory year-in-review card | Shareable summary of a year of saves |
| Shareable answer cards | Export an Ask answer with its sources as an image or link |
| Pause saving from the popup | "Pause on this site" and "Pause for 1 hour" toggles |
| Chrome Web Store listing assets | Screenshots, promo tiles, short and long description; set `CHROME_STORE_URL` in `frontend/src/components/landing/links.ts` |
| Product Hunt launch | Assets and launch copy |
| Corner Echo reaction to sensitive skips | The web app never hears about extension skips; needs an extension-to-app relay (like `REFRESH_MEMORY_FEED`) before Echo can show the shield |
| Real extension screen recording | 10-15s MP4/WebM with poster; set `EXTENSION_CLIP_VIDEO` in `links.ts` to replace the animated stand-in |
| Logo dot states | Dot pulses while saving, becomes a check when saved, a lock on protected pages (DESIGN.md §13, optional) |
| Footer links | Terms, GitHub and Contact destinations are still `[TODO]`; FAQ pricing answer is still `[TODO]` |

---

## 6. Completed Milestones

* **Milestone 1 (Foundations & Auth)**: Scaffolding complete. Monorepo environment operational. End-to-end user authentication working.
* **Milestone 2 (Capture & Core Vault)**: Chrome Extension captures web pages, YouTube transcripts, and PDFs. Memory items ingested into database and displayed on timeline dashboard.
* **Milestone 3 (Dashboard & Vault Tools)**: Full dashboard redesign complete with timeline view, Ask Sentiora AI, Connected Sources uploader, Privacy Center blocklist & JSON vault exporter, and Account Settings.

---

## 7. Future Roadmap

* **Post-MVP**: 
  * Footprint module (Identity mapping & memory graphs)
  * Shield module (Risk detection & privacy recommendations)
  * Port to Firefox & Safari Extensions
  * Native Mobile App (iOS / Android)
  * Multi-user Team Vault Collaboration

---

## 8. Rules

> [!IMPORTANT]  
> This document **must** be updated after every completed phase. It serves as the single source of truth for engineering progress. Do not start a new phase without ensuring this document accurately reflects the current status.
