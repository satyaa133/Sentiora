# Sentiora

**Sentiora** is a memory-oriented AI application that acts as your private second brain. It seamlessly captures digital content you browse — webpages, articles, PDFs, and YouTube videos — indexes it intelligently, and lets you search, organize, and chat with your entire memory archive using AI.

---

## Features

- 🧠 **Smart Capture** — Chrome extension that captures webpage text, local PDFs, and YouTube transcripts in the background.
- 📂 **Connected Memory Sources** — Direct PDF/TXT file uploader and integration hubs (Notion, ChatGPT, Twitter, GitHub, Substack).
- 💬 **Ask Sentiora AI Assistant** — Natural language Q&A with rich Markdown responses and source citations.
- 🗂️ **Memory Timeline** — Browse your captures chronologically with compact preview cards, category filters, and detail drawers.
- 🛡️ **Privacy Center & Control** — Custom domain blocklist (`localStorage` persistent) and 1-click JSON vault data exporter.
- 👤 **Account & Preferences** — Custom user profiles, timezone selection, and AI summary style preferences.
- 🔒 **Private by Design** — Local infrastructure support with complete data ownership.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Backend** | Python 3.12, FastAPI, PostgreSQL (pgvector), SQLAlchemy, Alembic, Redis, RQ |
| **Frontend** | React 18, Vite, TypeScript, Tailwind CSS, React Router |
| **Extension** | Chrome Extension Manifest V3, React, TypeScript |
| **AI / Search** | OpenAI embeddings + chat completions, pgvector semantic search, lexical fallback |
| **Infrastructure** | Docker, Docker Compose, MinIO/S3, pgAdmin |

---

## Project Structure

```
Sentiora/
├── backend/           FastAPI backend (endpoints, services, models, workers)
│   ├── alembic/       Database schema migration scripts
│   └── tests/         Pytest backend integration test suite
├── frontend/          React + Vite web dashboard
│   └── src/           Components, views, pages, auth context, services
├── extension/         Chrome Extension (Manifest V3)
│   ├── src/           Popup UI, content scripts, background worker
│   └── dist/          Compiled extension bundle for Chrome loading
├── shared/            Shared TypeScript types, constants, and utilities
├── infrastructure/    Docker Compose and pgAdmin configuration
└── docs/              Canonical technical specs and TASKS.md tracker
```

---

## Prerequisites

Ensure you have the following installed on your machine:

| Tool | Min Version | Download Link |
|---|---|---|
| **Node.js** | `>= 18.x` | [nodejs.org](https://nodejs.org) |
| **Python** | `>= 3.12` | [python.org](https://python.org/downloads) |
| **Docker Desktop** | Latest | [docker.com](https://www.docker.com/products/docker-desktop) |
| **Git** | Latest | [git-scm.com](https://git-scm.com) |

---

## Step-by-Step Local Setup Guide

Follow these steps to clone and run Sentiora locally on your machine:

### Step 1 — Clone the Repository

```bash
git clone <repo-url>
cd Sentiora
```

### Step 2 — Configure Environment Files

```bash
# Mac / Linux
cp .env.example .env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
cp extension/.env.example extension/.env
```

```bat
REM Windows Command Prompt
copy .env.example .env
copy backend\.env.example backend\.env
copy frontend\.env.example frontend\.env
copy extension\.env.example extension\.env
```

### Step 3 — Install Node Dependencies

```bash
npm install
```

### Step 4 — Set Up Python Virtual Environment

```bash
# Mac / Linux
python3 -m venv backend/.venv
backend/.venv/bin/pip install -e "./backend[dev]"
```

```bat
REM Windows
python -m venv backend\.venv
backend\.venv\Scripts\pip install -e ".\backend[dev]"
```

### Step 5 — Start Infrastructure Containers (Postgres + Redis)

Ensure **Docker Desktop** is running, then start database services:

```bash
docker compose up -d postgres redis
```

> **Mac / Linux Docker socket tip**: If you get a socket permission error, run:
> ```bash
> DOCKER_HOST=unix://$HOME/.docker/run/docker.sock docker compose up -d postgres redis
> ```

### Step 6 — Run Database Migrations

Apply Alembic migrations to create PostgreSQL tables (`users`, `memory_items`, `memory_chunks`, and related indexes):

```bash
# Mac / Linux
backend/.venv/bin/python3 -m alembic -c backend/alembic.ini upgrade head
```

```bat
REM Windows
backend\.venv\Scripts\python -m alembic -c backend\alembic.ini upgrade head
```

### Step 7 — Configure AI (Required for Ask Sentiora)

Set `OPENAI_API_KEY` in the root `.env` and `backend/.env` files (see `.env.example` for placeholders). Without it:

- **Ask Sentiora** (`POST /api/v1/chat`) returns HTTP `503` with error code `AI_NOT_CONFIGURED`.
- **Semantic search** falls back to lexical matching when embeddings are unavailable.
- **Capture** still works; embeddings are generated in the background worker when the key is present.

Optional tuning variables: `OPENAI_EMBEDDING_MODEL`, `OPENAI_CHAT_MODEL`, `RAG_TOP_K`, `RAG_MAX_DISTANCE`, `RAG_MAX_CONTEXT_CHARS`.

---

## Running the Application

### Start Everything (Recommended)

Run both the backend API and frontend dev server simultaneously with one command:

```bash
npm start
```

### Load the Chrome Extension

1. Open Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** (toggle in the top right corner).
3. Click **Load unpacked**.
4. Select the `Sentiora/extension` (or `extension/dist` after running `npm run build --workspace extension`) directory.

---

## Application Access URLs

| Service | Access URL | Description |
|---|---|---|
| **Web Dashboard** | [http://localhost:5173](http://localhost:5173) | Main user interface |
| **Backend API** | [http://localhost:8000](http://localhost:8000) | FastAPI service |
| **API Documentation** | [http://localhost:8000/docs](http://localhost:8000/docs) | Interactive Swagger UI |
| **pgAdmin** | [http://localhost:5050](http://localhost:5050) | Database admin interface (`admin@sentiora.ai` / `admin`) |

---

## Essential Developer Commands

```bash
# Workspace verification suite (runs lint, typecheck, tests & production builds)
npm run lint && npm run typecheck && npm run test && npm run build

# Individual service development
npm run dev:frontend       # Frontend dashboard only (http://localhost:5173)
npm run dev:backend        # Backend API server only (http://localhost:8000)
npm run dev:extension      # Watch mode for Chrome Extension build

# Run unit & integration test suites
npm run test:frontend      # Vitest frontend tests
npm run test:extension     # Vitest extension tests
npm run test:backend       # Pytest backend tests
```

---

## Implementation Phases

### ✅ Phase 0 — Environment & Foundations
- Monorepo folder layout (`frontend/`, `backend/`, `extension/`, `shared/`)
- Docker Compose setup for Postgres, Redis, MinIO, pgAdmin
- GitHub Actions CI pipeline configuration

### ✅ Phase 1 — Authentication
- `POST /api/v1/auth/register`, `/login`, `/refresh`, `/users/me`
- JWT authentication middleware and password hashing
- React Auth Context, Login/SignUp UI, and protected route guards

### ✅ Phase 2 — Chrome Extension Skeleton
- Manifest V3 extension configuration (`tabs`, `storage`, `activeTab`)
- React popup UI showing login status and capture triggers
- Extension API client and background message bus

### ✅ Phase 3 — Capture Pipeline
- Webpage content extractor powered by `@mozilla/readability`
- YouTube timedtext transcript extractor (`youtubeCapture.ts`)
- PDF document text parser helper (`pdfCapture.ts`)
- Privacy exclusion rules (banking/health blocklist, password fields, `noindex`)

### ✅ Phase 4 — Backend Core APIs
- Memory Items CRUD APIs (`POST /memory-items`, `GET /memory-items`, `DELETE /memory-items/:id`)
- Async RQ background worker (`process_capture.py`) for word count, cleaning, and reading time
- Alembic database schema migrations

### ✅ Phase 5 — Frontend Dashboard
- Memory Timeline View with compact card previews and sequential date grouping
- Memory Detail Reader Drawer for full reading, metadata breakdown, and deletion
- Connected Sources hub with PDF/document drag & drop parser and integration modal
- Privacy Center with custom domain blocklist and complete JSON vault exporter
- Account Settings with avatar initials, personal preferences, and timezone options

### ✅ Phase 6 — Semantic Search
- `GET /api/v1/search?q=` with pgvector semantic retrieval and lexical fallback
- User-scoped chunk retrieval with distance scoring (`RAG_MAX_DISTANCE`)
- Background embedding generation in the capture worker when `OPENAI_API_KEY` is set

### ✅ Phase 7 — AI / RAG Chat
- `POST /api/v1/chat` grounded RAG pipeline with citations and insufficient-context handling
- Fail-fast `503 AI_NOT_CONFIGURED` when `OPENAI_API_KEY` is missing (no silent fallback)
- Frontend Ask Sentiora view surfaces configuration and retrieval errors clearly

### 🟡 Phase 8 — Testing *(In Progress)*
- Backend pytest suites for auth, capture, search, and Ask/RAG behavior
- Frontend, extension, and shared Vitest coverage
- End-to-end Playwright automation pending

### ⏳ Phase 9 — Deployment & Launch *(Planned)*
- Staging/production environments, monitoring, and Chrome Web Store release

---

## Ask Sentiora / RAG Behavior

| Scenario | HTTP status | Behavior |
|---|---|---|
| LLM configured, relevant memories found | `200` | Grounded answer with citations |
| LLM configured, insufficient context | `200` | `insufficient_context: true`, no fabricated citations |
| `OPENAI_API_KEY` missing | `503` | `AI_NOT_CONFIGURED` — Ask Sentiora does not return a fake answer |
| LLM request fails at runtime | `502` | `RAG_LLM_FAILED` |

Embeddings and chat completions use the OpenAI SDK directly (no LangChain dependency). Retrieval is scoped per authenticated user.

---

## Documentation

All canonical engineering specifications live in `docs/`:

| File | Description |
|---|---|
| `docs/TASKS.md` | Live engineering progress tracker and deliverables |
| `docs/01_PRD_v2.1_FINAL.pdf` | Product Requirements Document |
| `docs/02_SRS_v1.0.pdf` | Software Requirements Specification |
| `docs/03_Backend_Technical_Specification_v1.2.pdf` | Backend technical architecture |
| `docs/04_Technical_Specification_v1.2.pdf` | Full system architecture specification |
| `docs/05_API_Specification_v1.0.pdf` | API endpoint contracts |
| `docs/06_Database_Schema_Design_v1.2.pdf` | Database schema design |
| `docs/07_Development_Implementation_Plan.pdf` | Implementation phase breakdown |
| `docs/08_UIUX_Specification_v1.0_FINAL.pdf` | UI/UX design specifications |

