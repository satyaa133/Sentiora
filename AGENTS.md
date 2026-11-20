# Sentiora AI Agent Guide

## Mission

Sentiora is a product repository for building a memory-oriented application with supporting engineering documentation, design references, and implementation assets.

## Canonical Documents

AI agents MUST read the documentation in the docs folder before implementing anything.

- REBUILD_PLAN.md (current work; overrides the others where they differ)
- TASKS.md
- API.md and api/openapi.json (API contract)
- DATABASE.md (schema contract)
- RAG_v2_ADDENDUM.md (current Ask and retrieval design)
- DESIGN.md (UI)
- PROMPT_GUIDE.md
- 01_PRD_v2.1_FINAL.pdf (product vision only; scope superseded)

Documents in `docs/archive/` are superseded. Don't follow them when writing code.

## Rebuild v3 (current work)

The current work is the rebuild described in `docs/REBUILD_PLAN.md`. Before any rebuild task:

- Read `docs/REBUILD_PLAN.md` and the "Rebuild v3" section of `docs/TASKS.md`.
- Work on the current stage only (S0–S10, in order); stages replace the phase sequence below for rebuild work, and the rest of Phase 9 is stage S10.
- For anything the plan covers, it overrides `docs/RAG_v2_ADDENDUM.md` and the PRD. Its section 12 lists which documents are current.
- New endpoints, fields, tables, columns and settings are only those in the plan's sections 7–9. Propose a plan change instead of inventing one.

## Development Rules

AI agents must:

- Never skip implementation phases.
- Never mix multiple phases.
- Complete one phase before starting another.
- Follow the rebuild plan (`docs/REBUILD_PLAN.md`) exactly; phases 0–8 of the original implementation plan are complete.
- Preserve architectural consistency.
- Never invent APIs not defined in `docs/API.md` or the rebuild plan's section 8.
- Never invent database schemas: the schema is `docs/DATABASE.md` plus the rebuild plan's section 7.
- Never ignore security requirements.
- Never remove existing documentation.
- Keep commits focused and atomic.
- Ask for clarification when documentation conflicts.

## Repository Structure

- docs/ - canonical engineering documentation and documentation index; design references and screenshots are in docs/design/, the design system in docs/DESIGN.md
- frontend/ - React + Vite web app (pages, views, auth context, API services)
- backend/ - FastAPI API, RQ capture worker, Alembic migrations, pytest suite
- extension/ - Chrome MV3 extension (content-script capture, background worker, popup)
- shared/ - shared UI kit and design tokens (`shared/src/ui`, imported as `@shared/ui`)
- scripts/ - repository scripts (Python runner, extension packaging and icons)
- tests/ - cross-cutting Playwright end-to-end specs (`tests/e2e`)
- infrastructure/ - Postgres image, nginx and pgAdmin config used by the Compose files

### Where code lives

- HTTP routes stay thin: `backend/app/api/v1/*_routes.py` call `backend/app/services/`, which use `backend/app/repositories/` for database access. Embeddings, retrieval and RAG are services too (`embedding_service.py`, `retrieval_service.py`, `rag_service.py`).
- Every API response uses the envelope in `backend/app/schemas/envelope.py` (`APIResponse`, `response_meta`); errors are shaped by the handlers in `backend/app/main.py`.
- Background capture processing is `backend/app/workers/jobs/process_capture.py`.
- The frontend calls the API only through `frontend/src/services/` (`apiClient.ts` owns the token refresh); views live in `frontend/src/components/views/`.
- Content extraction (webpage, PDF, YouTube) happens in the extension (`extension/src/content/`); the backend never fetches pages.

## Coding Standards

- Clean Architecture
- SOLID Principles
- Type Safety
- Consistent Naming
- Reusable Components
- Documentation-first Development
- Security-first Development
- Readable Code
- Minimal Technical Debt

## Phase Workflow

Original implementation sequence (phases 0–8 complete; the rest of Phase 9 is rebuild stage S10, after S0–S9):

Repository Preparation

↓

Phase 0

↓

Phase 1

↓

Phase 2

↓

Phase 3

↓

Phase 4

↓

Phase 5

↓

Phase 6

↓

Phase 7

↓

Phase 8

↓

Phase 9 (continues as rebuild stage S10)

Rebuild stages run S0 → S10 in order, one at a time. No exceptions.