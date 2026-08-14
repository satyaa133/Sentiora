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
| Phase 8: Testing | 🟡 In Progress | 75% | Pytest suites running; E2E Playwright pending |
| Phase 9: Deployment & Launch | ⏳ Planned | 0% | Staging/Prod environments, monitoring, Web Store |


---

## 3. Completed Work

**Repository & Scaffolding**
* Monorepo folder structure established (`frontend/`, `backend/`, `extension/`, `shared/`)
* Docker and `docker-compose.yml` configured for Postgres, Redis, MinIO, pgAdmin
* Environment files (`.env.example`) defined across all packages
* Core project documentation added (`docs/`, `AGENTS.md`, `README.md`)
* CI pipeline (`.github/workflows/ci.yml`) defined

**Backend (FastAPI & PostgreSQL)**
* FastAPI initialized with structured modules (`api`, `core`, `models`, `schemas`, `services`, `repositories`)
* PostgreSQL and Alembic integrated with migrations (`001_initial_users`, `002_memory_items`)
* Authentication endpoints (`/auth/register`, `/auth/login`, `/auth/refresh`, `/users/me`) implemented
* Memory Items CRUD APIs (`POST /memory-items`, `GET /memory-items`, `DELETE /memory-items/:id`)
* Async RQ background worker job (`process_capture.py`) for content cleaning, word count, and reading time

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

**Chrome Extension (Manifest V3)**
* Manifest V3 setup with active permissions (`tabs`, `storage`, `activeTab`)
* DOM content extractor powered by `@mozilla/readability`
* Sensitive-content guard (banking/health domain blocklist, password fields, `noindex`)
* YouTube timedtext transcript extractor (`youtubeCapture.ts`) with description fallback
* Local PDF reader helper (`pdfCapture.ts`)
* Popup UI displaying auth status and live tab capture trigger

---

## 4. Current Phase

* **Current active phase**: Phase 6 (Semantic Search) & Phase 7 (AI / RAG Chat)
* **Current objectives**: Connect backend pgvector embedding generation to natural language search query endpoint and complete RAG chat streaming backend.
* **Current deliverables**: 
  * `GET /api/v1/search?q=` semantic search backend endpoint with vector distance scoring
  * `POST /api/v1/chat` backend streaming RAG completion route
* **Current blockers**: None
* **Current branch**: `main`

---

## 5. Upcoming Tasks

| Priority | Task | Estimated Complexity | Dependencies | Expected Output |
| -------- | ---- | -------------------- | ------------ | --------------- |
| P0 | Complete pgvector vector embedding generation on ingest | Medium | Phase 4 | Embeddings stored in `memory_items.embedding` column |
| P0 | Connect `/api/v1/chat` backend streaming endpoint | Medium | Phase 7 UI | Live LLM response stream for Ask Sentiora |
| P1 | End-to-end Playwright user flow tests | Medium | Phase 8 | E2E automation test script |
| P1 | Production Docker deployment configuration | Medium | Phase 9 | Single command production deployment |

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
