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
| **Infrastructure** | Docker, Docker Compose, pgAdmin |

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
| **Node.js** | `20.19+` or `22.12+` (Vite 7) | [nodejs.org](https://nodejs.org) |
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
```

```bat
REM Windows Command Prompt
copy .env.example .env
copy backend\.env.example backend\.env
```

- `.env` (repo root): Docker ports plus the **frontend/extension build config** (`VITE_API_BASE_URL`, `VITE_APP_URL`). Vite reads `VITE_*` only from this file; `frontend/.env` and `extension/.env` are ignored.
- `backend/.env`: API and worker settings (`DATABASE_URL`, `REDIS_URL`, `CORS_ORIGINS`, AI keys).
- If port 5432/6379 is already taken on your machine, set `POSTGRES_PORT`/`REDIS_PORT` in `.env` and use the same ports in `backend/.env`'s `DATABASE_URL`/`REDIS_URL`. Use `127.0.0.1`, not `localhost`, as the host in those URLs: the containers listen on IPv4 loopback only, and on Windows `localhost` tries IPv6 first and stalls (about 10 s per connection).

### Step 3 — Install Node Dependencies

```bash
npm install
```

### Step 4 — Set Up Python Virtual Environment

```bash
# Mac / Linux
python3.12 -m venv backend/.venv
backend/.venv/bin/pip install -e "./backend[dev]"
```

```bat
REM Windows (the py launcher picks 3.12 even if `python` is an older version)
py -3.12 -m venv backend\.venv
backend\.venv\Scripts\pip install -e ".\backend[dev]"
```

The backend needs Python 3.12+. Check with `backend/.venv/bin/python --version` (Windows: `backend\.venv\Scripts\python --version`). On Windows, plain `python` is often the Microsoft Store 3.11 alias, which makes `pip install` fail with "requires a different Python".

The npm scripts (`dev:backend`, `dev:worker`, `test:backend`, ...) always use `backend/.venv` (see `scripts/run-python.mjs`).

### Step 5 — Start Infrastructure Containers (Postgres + Redis)

Ensure **Docker Desktop** is running, then start database services (or use `npm run compose:up`):

```bash
docker compose up -d
```

This starts Postgres, Redis and pgAdmin only, bound to `127.0.0.1`. The containerised backend/worker are opt-in (`docker compose --profile app up -d`); don't run them alongside `npm start`/`npm run dev:worker`, because they compete for port 8000 and the capture queue. If you started them before, stop them with `docker compose --profile app stop backend worker`.

> **Mac / Linux Docker socket tip**: If you get a socket permission error, run:
> ```bash
> DOCKER_HOST=unix://$HOME/.docker/run/docker.sock docker compose up -d postgres redis
> ```

### Step 6 — Run Database Migrations

Apply Alembic migrations to create PostgreSQL tables (`users`, `memory_items`, `memory_chunks`, and related indexes):

```bash
# Mac / Linux
cd backend && .venv/bin/alembic upgrade head
```

```bat
REM Windows
cd backend && .venv\Scripts\alembic upgrade head
```

### Step 7 — Configure AI (Optional for Ask Sentiora)

Set `LLM_PROVIDER` (`openai`, `gemini`, or `openrouter`) plus its key in `backend/.env` (see `.env.example`). Docker backend and worker read that file.

**Semantic search needs an embedding key.** OpenRouter provides chat only, so with `LLM_PROVIDER=openrouter` set `OPENAI_API_KEY` or `GEMINI_API_KEY` as well. `EMBEDDING_PROVIDER=auto` (default) picks the provider; `GEMINI_EMBEDDING_MODEL` must output 1536 dimensions (`gemini-embedding-001`). Restart the API and worker after changing keys. Vectors are model-specific, so re-capture after switching embedding models.

Without a provider key:

- **Ask Sentiora** (`POST /api/v1/chat`) still returns HTTP `200` with a short grounded answer from retrieved READY memory (`used_fallback: true`).
- **Semantic search** falls back to lexical matching when embeddings are unavailable.
- **Capture** still works; memories become READY even if embedding generation is skipped.

Optional tuning variables: `OPENAI_EMBEDDING_MODEL`, `OPENAI_CHAT_MODEL`, `GEMINI_CHAT_MODEL`, `RAG_TOP_K`, `RAG_MAX_DISTANCE`, `RAG_MAX_CONTEXT_CHARS`.

---

## Running the Application

### Start Everything (Recommended)

Run both the backend API and frontend dev server simultaneously in one terminal:

```bash
npm start
```

In a separate terminal, start the background worker to process captures:

```bash
npm run dev:worker
```

The worker reconnects on its own if Redis restarts, and re-queues captures left pending.

### Load the Chrome Extension

1. Build the extension bundle first: `npm run build:extension` (it bakes in `VITE_API_BASE_URL`/`VITE_APP_URL` from the root `.env`; rebuild after changing them).
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top right corner).
4. Click **Load unpacked**.
5. Select the `extension/dist` directory.

The extension picks up the web app's sign-in only from the exact `VITE_APP_URL` origin. `http://127.0.0.1:5173` is not the same origin as `http://localhost:5173`.

### Access From Another PC on Your LAN (optional)

By default the backend, the frontend and Docker services listen on this machine only. For a teammate on the same network to use your instance:

1. In the root `.env`, set `VITE_API_BASE_URL=http://<your-LAN-IP>:8000` and `VITE_APP_URL=http://<your-LAN-IP>:5173`. "localhost" in a browser always means *that* browser's machine.
2. In `backend/.env`, add the LAN origin: `CORS_ORIGINS=["http://localhost:5173","http://<your-LAN-IP>:5173"]`.
3. Start the API and frontend listening on all interfaces:
   ```bash
   npm run dev:backend -- --host 0.0.0.0
   npm run dev:frontend -- --host
   ```
4. Allow inbound TCP 8000 and 5173 in your OS firewall for the private network only.

Don't expose these dev servers to the internet: they use HTTP and the development JWT secret. For a shared remote environment, deploy `docker-compose.prod.yml` behind HTTPS (see `docs/RELEASE.md`). Two local setups never share data; each has its own database.

---

## Application Access URLs

| Service | Access URL | Description |
|---|---|---|
| **Web Dashboard** | [http://localhost:5173](http://localhost:5173) | Main user interface |
| **Backend API** | [http://localhost:8000](http://localhost:8000) | FastAPI service |
| **API Documentation** | [http://localhost:8000/docs](http://localhost:8000/docs) | Interactive Swagger UI |
| **pgAdmin** | [http://localhost:5050](http://localhost:5050) | Database admin interface (`admin@sentiora.ai` / `admin`, local only) |

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
npm run test:backend       # Pytest backend tests (dedicated test database)
npm run test:e2e           # Playwright: API + real-UI flows on an isolated stack

# Release tooling
npm run package:extension  # Chrome Web Store ZIP (needs VITE_API_BASE_URL=https://...)
```

---

## Testing and Data Safety

Tests never touch the development database:

- **pytest** points the app at `TEST_DATABASE_URL`, or derives `sentiora_test` on the same server from `DATABASE_URL`. It creates and migrates that database automatically and empties it at the start of each run. It aborts if the target database name lacks `test`, equals the development database, or `APP_ENVIRONMENT=production`. Real provider keys are blanked for the test session, so no live AI calls are made.
- **Playwright** (`npm run test:e2e`) starts its own stack instead of reusing dev servers: API on `:8100` and an RQ worker against the test database and Redis DB 15, plus the frontend on `:5180`. It runs the API-level flow and browser-driven UI flows (sign up → add memory → processed → cited answer; failed capture shows its reason). Without Redis (as in CI), the API processes captures inline.
- `npm run test:db:prepare` creates and migrates the test database on its own.
- Opt-in live checks (skipped by default): `SENTIORA_LIVE_YOUTUBE=1 npx vitest run src/content/youtubeCapture.live.test.ts` in `extension/`, and `npm run verify:youtube-extension`.

## YouTube Capture

Watch, Shorts, and live URLs are saved under one canonical watch URL. The transcript comes from official caption tracks, or from YouTube's own transcript panel (opened only on a manual popup capture). Segment timestamps are kept, and chunks carry their time range. Nothing is saved without a real transcript; users get a typed reason instead. YouTube increasingly blocks caption downloads outside its player, so verify transcript capture in your own signed-in Chrome profile. Details: [docs/RELEASE.md](docs/RELEASE.md#3-youtube-capture-behaviour-and-limits).

## Production and Chrome Web Store

See [docs/RELEASE.md](docs/RELEASE.md): `docker-compose.prod.yml` (non-root images, one-shot migrations, internal-only DB/Redis, nginx same-origin proxy, fail-fast secrets) and the extension packaging checklist (permission justifications, outstanding human decisions).

---

## Implementation Phases

### ✅ Phase 0 — Environment & Foundations
- Monorepo folder layout (`frontend/`, `backend/`, `extension/`, `shared/`)
- Docker Compose setup for Postgres, Redis, pgAdmin
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
- LLM answers when a provider key is configured; otherwise a grounded local fallback from retrieved memory
- Frontend Ask Sentiora view distinguishes empty vault, indexing, fallback answers, auth, and system errors

### ✅ Phase 8 — Testing
- Backend pytest suites for auth, authorization, capture, YouTube transcripts, search, Ask/RAG and security, on a dedicated test database
- Frontend, extension (including service-worker messaging), and shared Vitest coverage
- Playwright API and browser-driven UI flows on an isolated stack

### 🟡 Phase 9 — Deployment & Launch *(In Progress)*
- Production Docker Compose stack validated locally; extension packaging script and store checklist
- Pending: real deployment target, monitoring, brand icons/store assets, privacy policy, Web Store submission

---

## Ask Sentiora / RAG Behavior

| Scenario | HTTP status | Behavior |
|---|---|---|
| LLM configured, relevant memories found | `200` | Grounded answer with citations |
| LLM configured, insufficient context | `200` | `insufficient_context: true`, no fabricated citations |
| Provider key missing, relevant memories found | `200` | Grounded local fallback, `used_fallback: true`, real citations |
| LLM request fails at runtime, memories found | `200` | Same grounded local fallback |
| No relevant memory | `200` | `insufficient_context: true` |
| Unexpected server error | `502` | `ASK_SYSTEM_FAILED` |

Embeddings and chat completions use the configured provider (OpenAI or Gemini). Retrieval is scoped per authenticated user.

---

## Documentation

All canonical engineering specifications live in `docs/`:

| File | Description |
|---|---|
| `docs/TASKS.md` | Live engineering progress tracker and deliverables |
| `docs/RELEASE.md` | Production deployment, Chrome Web Store packaging, YouTube capture limits |
| `docs/01_PRD_v2.1_FINAL.pdf` | Product Requirements Document |
| `docs/02_SRS_v1.0.pdf` | Software Requirements Specification |
| `docs/03_Backend_Technical_Specification_v1.2.pdf` | Backend technical architecture |
| `docs/04_Technical_Specification_v1.2.pdf` | Full system architecture specification |
| `docs/05_API_Specification_v1.0.pdf` | API endpoint contracts |
| `docs/06_Database_Schema_Design_v1.2.pdf` | Database schema design |
| `docs/07_Development_Implementation_Plan.pdf` | Implementation phase breakdown |
| `docs/08_UIUX_Specification_v1.0_FINAL.pdf` | UI/UX design specifications |

