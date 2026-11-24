# Sentiora — Team Development Workspace

**Sentiora** is an AI-powered personal memory archive and research companion. It passively and actively captures digital context (web pages, articles, research PDFs, YouTube video transcripts, and manual notes), indexes chunks semantically with local embeddings, and provides instant quoted answers and AI explanations with grounded citations.

This repository is configured as the unified internal workspace for our engineering team.

---

## Team Architecture & Stack

| Component | Technology | Role & Notes |
|---|---|---|
| **Backend API** | FastAPI (Python 3.12+), SQLAlchemy 2, Alembic | Async REST endpoints, auth, RAG retrieval pipeline, rate limits |
| **Worker Service** | Python RQ, Redis | Background ingestion, PDF extraction, lazy enrichment, question bank |
| **Database** | PostgreSQL with `pgvector` extension | Hosted on Cloud Managed Postgres (Supabase / Neon / RDS) |
| **Cache & Queue** | Redis / Valkey | Hosted on Upstash Redis or managed cloud Redis |
| **Frontend Web** | React 18, Vite, TypeScript, Tailwind CSS | Dashboard, timeline feeds, memory drawer, instant quote & AI ask |
| **Extension** | Chrome Manifest V3, React, TypeScript | Content extractors, real-time auth and memory feed synchronization |
| **LLM Provider** | **Groq** (`llama-3.3-70b-versatile`) | Ultra-fast inference for AI explanations, summaries, and enrichment |
| **Embeddings** | **FastEmbed (Local CPU)** (`nomic-embed-text`) | Self-contained local embeddings; no external API keys or calls needed |
| **Reranker** | **Cross-Encoder** (`ms-marco-MiniLM-L-6-v2`) | Local CPU cross-encoder reranking top retrieved candidates |

---

## Unified Environment Configuration

All workspaces use the root environment configuration. Copy `.env.example` to `.env` for local development; `.env` and `.env.local` are ignored by Git and must never be committed. Vite reads the root environment file, and the backend loads it from the repository root. Do not put credentials in frontend `VITE_*` variables: those values are embedded in browser bundles.

```
Sentiora/
├── .env.example          <-- Safe template; committed
├── .env                  <-- Local settings and credentials; gitignored
└── .env.local            <-- Optional personal overrides; gitignored
```

Start with `cp .env.example .env`. Keep API keys, database passwords, and unique JWT secrets only in local ignored files or a secret manager. For production, generate a unique `JWT_SECRET_KEY` and use production-only database, Redis, and provider credentials.

### Key Team Configuration Variables

```ini
# ── Cloud Managed Services (Supabase / Neon / Upstash) ──────────────────────
DATABASE_URL=postgresql+psycopg://<USER>:<PASSWORD>@<HOST>:5432/postgres
REDIS_URL=rediss://default:<TOKEN>@<HOST>:6379

# ── Backend Server ─────────────────────────────────────────────────────────
APP_NAME=Sentiora Backend
APP_ENVIRONMENT=development
BACKEND_HOST=0.0.0.0
BACKEND_PORT=8000
CORS_ORIGINS=["http://localhost:5173","http://localhost:3000"]
JWT_SECRET_KEY=replace_with_a_unique_local_secret

# ── AI Provider (Groq) ─────────────────────────────────────────────────────
LLM_PROVIDER=groq
GROQ_API_KEY=
GROQ_CHAT_MODEL=llama-3.3-70b-versatile

# ── Embeddings & Reranker (Self-contained Local CPU) ───────────────────────
EMBEDDING_PROVIDER=local
RERANKER_MODEL=ms-marco-MiniLM-L-6-v2

# ── Email OTP Verification ─────────────────────────────────────────────────
# Set to false for rapid dev velocity; set to true when testing live email OTP delivery
REQUIRE_EMAIL_VERIFICATION=false
RESEND_API_KEY=
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=
SMTP_PASSWORD=

# ── Frontend & Extension Build Config ──────────────────────────────────────
VITE_API_BASE_URL=http://localhost:8000
VITE_APP_URL=http://localhost:5173
VITE_APP_NAME=Sentiora
VITE_EXTENSION_NAME=Sentiora Extension
```

> **Developer Overrides:** Put personal API keys or custom database ports in `.env.local` at repository root. It overrides `.env` and is gitignored.

---

## Daily Development Workflow

### 1. Install Dependencies

```bash
# Node dependencies (frontend, extension, shared UI)
npm install

# Backend Python dependencies
backend/.venv/bin/pip install -e "./backend[dev]"
```

### 2. Database Migrations

Ensure your cloud Postgres database schema is up to date:

```bash
cd backend && .venv/bin/alembic upgrade head && cd ..
```

### 3. Run Development Servers

Run the backend API, the capture worker and the frontend Vite server together:

```bash
npm start
```
- Web Dashboard: `http://localhost:5173`
- Backend API Docs: `http://localhost:8000/docs`
- Prometheus Metrics: `http://localhost:8000/metrics`

Without a worker, saves stay "Waiting" in the Timeline. To run a second worker in parallel (or the worker on its own), use:

```bash
npm run dev:worker
```

---

## Chrome Extension Setup

1. Build the extension package:
   ```bash
   npm run build:extension
   ```
2. Open Google Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `extension/dist` directory.
5. In extension details, enable **"Allow access to file URLs"** to enable capturing local PDF research papers.

### Real-Time Parallel Synchronization

The extension and web dashboard run in real time:
- **Authentication**: Signing in or signing out on either the dashboard or extension popup synchronizes tokens across all open tabs instantly without manual refreshing.
- **Memory Feed**: Capturing pages or deleting items immediately updates timeline views across all open tabs.

---

## Verification & Testing

Run all quality checks before submitting or pushing code:

```bash
# Typecheck TypeScript (frontend, extension, shared) and Python (mypy)
npm run typecheck

# Lint TypeScript (ESLint) and Python (Ruff)
npm run lint

# Run unit and integration tests
npm run test:frontend
npm run test:extension
npm run test:shared

# Build all production artifacts
npm run build
```

---

## Project Structure

```
Sentiora/
├── .env                  Unified environment configuration (shared across team)
├── backend/              FastAPI backend service
│   ├── alembic/          Schema migration scripts (head: 010_privacy_consent)
│   ├── app/              API routes, core security, services, models, workers
│   └── tests/            Pytest suite (auth, OTP, RAG retrieval, chunking)
├── frontend/             Vite + React 18 dashboard web application
│   └── src/              Pages, components, auth context, hooks, API client
├── extension/            Chrome MV3 extension
│   └── src/              Popup UI, background service worker, content scripts
├── shared/               Shared UI design system and tokens (`@shared/ui`)
├── scripts/              Cross-workspace runners and utility scripts
└── docs/                 Canonical engineering architecture, tasks, and API contracts
```
