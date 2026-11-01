# Sentiora AI Agent Guide

## Mission

Sentiora is a product repository for building a memory-oriented application with supporting engineering documentation, design references, and implementation assets.

## Canonical Documents

AI agents MUST read the documentation in the docs folder before implementing anything.

- 01_PRD_v2.1_FINAL.pdf
- 02_SRS_v1.0.pdf
- 03_Backend_Technical_Specification_v1.2.pdf
- 04_Technical_Specification_v1.2.pdf
- 05_API_Specification_v1.0.pdf
- 06_Database_Schema_Design_v1.2.pdf
- 07_Development_Implementation_Plan.pdf
- 08_UIUX_Specification_v1.0_FINAL.pdf
- TASKS.md
- PROMPT_GUIDE.md

## Development Rules

AI agents must:

- Never skip implementation phases.
- Never mix multiple phases.
- Complete one phase before starting another.
- Follow the Development & Implementation Plan exactly.
- Preserve architectural consistency.
- Never invent APIs not defined in the specifications.
- Never invent database schemas.
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

Implementation must always follow:

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

Phase 9

No exceptions.