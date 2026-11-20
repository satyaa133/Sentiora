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
| S1: Reliability fixes | 🟡 In Review | Branch `fix/s1-reliability`. Done: DB connection released before streaming (1 → 0 held per stream); `LLM_CHAT_TIMEOUT_SECONDS` (10) as one budget per answer, `LLM_META_TIMEOUT_SECONDS` (8), `EMBEDDING_TIMEOUT_SECONDS` (10); rate limits and AI key cooldowns shared through Redis with in-memory fallback (`app/core/redis_client.py`); `hnsw.iterative_scan = relaxed_order` on every connection (reproduction: 0 → 5 of a user's chunks found); capture embedding retried after 1, 5, 30 min, with due jobs moved by a worker thread (RQ's scheduler process fails on Windows); `WORKER_COUNT` (2) in production. Backend tests 293 pass (271 before S1). Eval (dev data, 21 questions): hit@6 1.00, MRR 0.94, noise 0.46, reject 1.00. Live outage check (providers unreachable): AI call fails after 11.1 s (was up to 25 s per key). Owner actions (OpenRouter no-training setting, Gemini billing) open |
| S2: Observability baseline | ⏳ Pending | Structured logs, Sentry, `/metrics`, `llm_usage`, answer feedback, baseline numbers |
| S3: Local embeddings | ⏳ Pending | `EMBEDDING_PROVIDER=local`, `embedding_local` column + HNSW, backfill, bge-small vs nomic eval |
| S4: Local reranker | ⏳ Pending | Cross-encoder rerank of top 30, long-page eval cases |
| S5: Save pipeline v3 | ⏳ Pending | Chunk merge fix, PDF title fallback, capture/enrich queues, lazy enrichment, question bank, contextual chunks |
| S6: Ask v3 | ⏳ Pending | Question-bank leg, instant extractive answer, `answer_mode`, one-call AI answer, AI semaphore (`AI_BUSY`), answer cache |
| S7: Web app and extension | ⏳ Pending | Instant answer + Explain with AI, feedback, summaries, Save now enrichment, title edit, one dashboard request, privacy notice at sign-up |
| S8: Quality, security, privacy | ⏳ Pending | Eval in CI, answer eval, isolation and injection tests, full account deletion, YouTube in real Chrome |
| S9: Load test | ⏳ Pending | k6, 500 users, instant p95 < 1 s, zero 5xx |
| S10: Launch readiness | ⏳ Pending | Remaining Phase 9: hosting, backups, PgBouncer, HTTPS, Anthropic API (Claude Haiku 5.5) + Batch enrichment, privacy policy, store submission |
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
