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
| Phase 9: Deployment & Launch | 🟡 In Progress | 65% | Production compose validated locally; extension packaging script + store checklist. Pending: real deployment, brand icons/store assets, privacy policy, submission |


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
* Echo answer modes (memory / general / combined), hybrid retrieval with date and source scoping, validated citations, client-sent follow-up history; Timeline server filters and paging; Intelligence view backed by `GET /api/v1/dashboard/statistics`

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

---

## 4. Current Phase

* **Current active phase**: Phase 9 (Deployment & Launch)
* **Current objectives**: Choose a deployment target, finalize store assets and the privacy policy, verify YouTube transcript capture in a signed-in Chrome profile, and submit the extension.
* **Current deliverables**:
  * Pytest coverage for capture, search, and Ask/RAG (including grounded fallback, multi-memory retrieval, and insufficient-context cases)
  * Vitest suites for dashboard, extension capture utilities, and shared packages
  * GitHub Actions CI running lint, typecheck, test, and build on pull requests
* **Current blockers**: YouTube blocks caption downloads outside its player and its transcript panel fails in automated/signed-out browsers, so live transcript capture is unverified in a real signed-in profile. Brand icons, store assets and privacy policy need owner decisions. Semantic search needs `OPENAI_API_KEY` or `GEMINI_API_KEY` (OpenRouter is chat-only).
* **Current branch**: `fix/get-app-running`

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
