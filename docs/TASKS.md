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
| R4: Retrieval | ⏳ Pending | Query rewrite, pgvector + full-text RRF, threshold, MMR |
| R5: Generation | ⏳ Pending | `[S#]` citations, SSE `/chat/stream`, structured follow-ups |
| R6: Env and keys | ⏳ Pending | `OPENROUTER_API_KEY_1..N`, exponential cooldown, startup validation |
| R7: Ask page UX | ⏳ Pending | Streaming UI, citation chips, sources panel, history |
| R8: Evaluation | ⏳ Pending | `scripts/eval-rag` hit rate |


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
* **Current blockers**: YouTube blocks caption downloads outside its player and its transcript panel fails in automated/signed-out browsers, so live transcript capture is unverified in a real signed-in profile. Brand icons, store assets and privacy policy need owner decisions. Semantic search needs `OPENAI_API_KEY` or `GEMINI_API_KEY` (OpenRouter is chat-only); the local `.env` has a Gemini key. The local OpenRouter key is out of credits, so Ask answers through the next configured key until it is topped up or `OPENROUTER_API_KEY_2` is set.
* **Current branch**: `feat/echo-intelligence`

---

## 5. Upcoming Tasks

| Priority | Task | Estimated Complexity | Dependencies | Expected Output |
| -------- | ---- | -------------------- | ------------ | --------------- |
| P1 | Verify YouTube transcript capture in a signed-in Chrome profile | Low | Phase 9 | Confirmed capture or documented limitation |
| P1 | Deploy `docker-compose.prod.yml` to a real host with TLS | Medium | Phase 9 | Running production environment |
| P1 | Brand icons, store screenshots, privacy policy, final data disclosures | Medium | Phase 9 | Store listing assets |
| P2 | Submit extension (`npm run package:extension`) | Low | Store assets | Published extension |
| P2 | Tailwind v4 migration (clears remaining moderate npm audit findings) | Medium | — | Clean `npm audit` |
| P3 | Re-embed existing memories after enabling an embedding provider | Low | Embedding key | Semantic search over older captures |

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
