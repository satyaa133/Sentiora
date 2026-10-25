# Sentiora Team Setup

The steps a new teammate follows on a clean machine. Commands are the repository's own scripts. Verification status for each step is in [TEST_RESULTS.md](TEST_RESULTS.md).

## 1. Install runtimes

| Tool | Version | Why |
|---|---|---|
| Node.js | `20.19+` or `22.12+` | Vite 7 (`engines` in `package.json`) |
| Python | `3.12+` | `backend/pyproject.toml` |
| Docker Desktop / Docker Engine | recent, with Compose v2 | Postgres (pgvector) + Redis |
| Git | any recent | |
| Chrome / Chromium | recent stable | the extension (Manifest V3) |

Windows: use PowerShell or Git Bash. Nothing in the repo depends on a drive letter or user path.

## 2. Clone and configure

```bash
git clone https://github.com/satyaa133/Sentiora.git
cd Sentiora
cp .env.example .env                  # Windows: copy .env.example .env
cp backend/.env.example backend/.env  # Windows: copy backend\.env.example backend\.env
```

- **Root `.env`** holds the Docker ports and the browser-side build config: `VITE_API_BASE_URL` (API origin, no `/api/v1`) and `VITE_APP_URL` (web app origin). Vite reads `VITE_*` **only** from this file.
- **`backend/.env`** holds the API and worker settings: `DATABASE_URL`, `REDIS_URL`, `CORS_ORIGINS`, `JWT_SECRET_KEY`, and the AI keys.
- If 5432 or 6379 is already in use, set `POSTGRES_PORT=5433` / `REDIS_PORT=6380` in `.env` **and** use those ports in `backend/.env`. Use `127.0.0.1` (not `localhost`) in `DATABASE_URL`/`REDIS_URL`: Docker binds IPv4 loopback only and Windows tries IPv6 `localhost` first.
- Never commit `.env` files. Ask a teammate for AI keys through a password manager, not chat.

## 3. Install dependencies

```bash
npm install
# Windows: `py -3.12` (plain `python` is often the Store 3.11 alias, which fails)
py -3.12 -m venv backend\.venv
backend\.venv\Scripts\python --version     # must print 3.12+
backend\.venv\Scripts\pip install -e ".\backend[dev]"
# macOS/Linux:
python3.12 -m venv backend/.venv
# macOS/Linux:
backend/.venv/bin/pip install -e "./backend[dev]"
```

## 4. Start infrastructure and migrate

```bash
docker compose up -d                  # postgres, redis, pgadmin, all on 127.0.0.1
cd backend && .venv/Scripts/alembic upgrade head   # macOS/Linux: .venv/bin/alembic
```

Don't start the `app` profile (`docker compose --profile app up`) at the same time as the host processes below.

## 5. Run

```bash
npm start              # API on http://localhost:8000 + web app on http://localhost:5173
npm run dev:worker     # second terminal: processes captures (reconnects if Redis restarts)
```

Check: `http://localhost:8000/health` returns `{"success":true,...}` and `http://localhost:5173` shows the landing page.

## 6. Extension

```bash
npm run build:extension
```

In Chrome, open `chrome://extensions`, turn on Developer mode, click **Load unpacked**, and pick `extension/dist`. Sign in from the popup, or sign in to the web app at exactly `VITE_APP_URL`; the extension only trusts that origin. Rebuild after changing `.env`.

## 7. Tests

```bash
npm run lint
npm run typecheck
npm run test           # frontend + extension + shared + backend (backend uses a separate *_test database)
npm run test:e2e       # isolated API on :8100 and UI on :5180, never your dev DB
npm run build
```

The backend tests refuse to run against any database whose name lacks "test" (`backend/tests/testdb.py`).

## 8. Access modes

| Mode | What to do | Data |
|---|---|---|
| Local only (default) | Nothing; everything listens on `127.0.0.1`. | Your own database |
| Private LAN (opt-in) | See README → "Access From Another PC on Your LAN": set `VITE_API_BASE_URL`/`VITE_APP_URL` to your LAN IP, add the LAN origin to `CORS_ORIGINS`, run `npm run dev:backend -- --host 0.0.0.0` and `npm run dev:frontend -- --host`, and open TCP 8000/5173 for the private network only. | The host's database |
| Shared remote | Deploy `docker-compose.prod.yml` behind HTTPS (`docs/RELEASE.md`), and build the extension with `VITE_API_BASE_URL=https://...` via `npm run package:extension`. | The server's database |

Two developers' local setups **never** share data. Use the shared remote environment when you need common data.

## 9. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Web app calls `localhost:8000` although you set a LAN URL | You edited `frontend/.env`. Put `VITE_API_BASE_URL` in the root `.env` and restart `npm start`. |
| Browser console shows a CORS error | The page origin is missing from `CORS_ORIGINS` in `backend/.env`. Restart the API. |
| Captures stay "pending" | `npm run dev:worker` isn't running, or Redis is down. The worker re-queues stale captures when it (re)connects. |
| Two things answer on port 8000 | Old `sentiora-backend` container: `docker compose --profile app stop backend worker`. |
| `port is already allocated` on `docker compose up` | Another local Postgres/Redis. Change `POSTGRES_PORT`/`REDIS_PORT` (and `backend/.env`). |
| Extension says it can't reach the server | It was built with a different `VITE_API_BASE_URL`. Rebuild after editing the root `.env` and reload it in `chrome://extensions`. |
| Extension doesn't pick up the web sign-in | You opened the app on a different origin than `VITE_APP_URL` (e.g. `127.0.0.1` vs `localhost`). |
| YouTube capture says the transcript could not be fetched | Known limitation under investigation (BUG_REGISTER OPEN-01). Webpage and PDF capture are unaffected. |
| Semantic search is lexical only | No embedding key. Set `OPENAI_API_KEY` or `GEMINI_API_KEY` in `backend/.env` and restart the API and worker. |
