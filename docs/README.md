# Sentiora Documentation

**Current work: [REBUILD_PLAN.md](REBUILD_PLAN.md).** For anything it covers (Ask, retrieval, embeddings, capture processing, reliability, deployment) it overrides the other documents. Its section 12 lists which documents are current.

## Read first

1. [REBUILD_PLAN.md](REBUILD_PLAN.md) - Rebuild plan (v3)
The stages S0–S10, decisions, target architecture, and every planned table, endpoint and setting.

2. [TASKS.md](TASKS.md) - Project Tasks & Progress Tracker
Single source of truth for progress: which stage is current and what is done.

3. [API.md](API.md) - API reference
Conventions, envelope, auth, rate limits, endpoints and error codes. Exact schemas in [api/openapi.json](api/openapi.json), generated from the code with `npm run docs:api`.

4. [DATABASE.md](DATABASE.md) - Database schema
Tables, columns, indexes and migrations at the current Alembic head.

## Reference

5. [RAG_v2_ADDENDUM.md](RAG_v2_ADDENDUM.md) - Current Ask and retrieval design
Ingestion cleanup, chunking, embeddings, hybrid retrieval, generation and the Ask page as built. REBUILD_PLAN overrides it where they differ.

6. [DESIGN.md](DESIGN.md) - Design System and Redesign Handoff
Tokens, components and screen layouts for the web app, extension popup and shared UI. Reference screenshots are in [design/](design/).

7. [PROMPT_GUIDE.md](PROMPT_GUIDE.md) - AI Prompt Guide
How AI agents read the docs, write code and verify tasks.

8. [TEAM_SETUP.md](TEAM_SETUP.md) - Team setup and troubleshooting
Clean-machine setup walkthrough and fixes for common problems.

9. [RELEASE.md](RELEASE.md) - Release Guide
Production Docker Compose deployment, Chrome Web Store packaging, and YouTube capture limits.

10. [GITHUB_SETUP.md](GITHUB_SETUP.md) - GitHub workflow and repository settings
How issues, branches, pull requests and reviews work, the labels and milestones, and the settings a repository admin applies.

11. [Capture_Module_v2_Technical_Design.pdf](Capture_Module_v2_Technical_Design.pdf) - Capture Module v2 Technical Design
Extension capture and the capture API.

12. [01_PRD_v2.1_FINAL.pdf](01_PRD_v2.1_FINAL.pdf) - Product Requirements Document
Product vision and personas. Its scope is superseded: the Footprint and Shield modules were not built; the product is Memory + Ask (REBUILD_PLAN).

## Archive

[archive/](archive/) holds superseded documents (the SRS, backend and technical specifications, API and database PDFs, the implementation plan, the UI/UX PDF, and the 2026-10-25 QA reports). Kept for history; don't follow them when writing code. [archive/README.md](archive/README.md) says what replaced each one.
