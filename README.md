# Sentiora

Sentiora is a private, memory-oriented reading companion. It saves webpages, PDFs, YouTube transcripts, and notes in a searchable personal library, then helps people recall what they have read.

## What it does

- Captures and organizes saved reading across the web app and Chrome extension.
- Searches a personal library using semantic and full-text retrieval.
- Gives instant answers quoted from saved sources, with citations.
- Offers optional AI explanations and background summaries.
- Uses local CPU models for embeddings and reranking; AI-provider calls are limited to optional features.

## Project components

- **Web app:** React, TypeScript, Vite, and Tailwind CSS.
- **Chrome extension:** Manifest V3 capture and popup experience.
- **API and workers:** FastAPI and Python, with RQ background jobs.
- **Data and search:** PostgreSQL with pgvector, plus Redis for queues and shared state.

The product scope and current development stages are documented in [docs/REBUILD_PLAN.md](docs/REBUILD_PLAN.md) and [docs/TASKS.md](docs/TASKS.md).