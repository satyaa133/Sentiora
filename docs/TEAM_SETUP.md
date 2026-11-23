# Sentiora Team Setup

The steps a new teammate follows on a clean machine. Commands are the repository's own scripts. Verification status for each step as of 2026-10-25 is in [TEST_RESULTS.md](archive/qa-audit-2026-10-25/TEST_RESULTS.md) (archived).

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
```

- The root `.env` is the safe local-development template and is ignored by Git. For personal credentials or overrides, use the ignored root `.env.local`; it overrides `.env`. The backend also supports `backend/.env.local` as a local override. Docker Compose interpolation values such as `POSTGRES_PASSWORD` and port numbers must be set in root `.env` (or supplied to Compose with `--env-file`).
- Vite reads `VITE_*` values from the root environment files. Those values are embedded in browser/extension bundles, so never put secrets in any `VITE_*` variable.
- If 5432 or 6379 is already in use, change the relevant local port settings. Use `127.0.0.1` (not `localhost`) in local database URLs: Docker binds IPv4 loopback only and Windows may resolve `localhost` to IPv6 first.
- Never commit `.env`, `.env.local`, or other real environment files. Share credentials through an approved password manager or secret manager, not chat or the repository.

Keep the committed `.env.example` free of credentials. Put provider keys,
database passwords and a unique local `JWT_SECRET_KEY` in `.env.local`. After
changing environment files, restart the API and worker. To inspect configured
providers without printing keys:

```bash
node scripts/run-python.mjs -c "from app.core.config import get_settings as g; from app.services.llm_pool import build_backends as b; print([x.name for x in b(g())])"
```

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
| Browser console shows a CORS error | The page origin is missing from `CORS_ORIGINS` in `.env` or `.env.local`. Restart the API. |
| Captures stay "pending" | `npm run dev:worker` isn't running, or Redis is down. The worker re-queues stale captures when it (re)connects. |
| Two things answer on port 8000 | Old `sentiora-backend` container: `docker compose --profile app stop backend worker`. |
| `port is already allocated` on `docker compose up` | Another local Postgres/Redis. Change the relevant local port setting in `.env.local`. |
| Extension says it can't reach the server | It was built with a different `VITE_API_BASE_URL`. Rebuild after editing the root `.env` and reload it in `chrome://extensions`. |
| Extension doesn't pick up the web sign-in | You opened the app on a different origin than `VITE_APP_URL` (e.g. `127.0.0.1` vs `localhost`). |
| YouTube capture says the transcript could not be fetched | Known limitation under investigation (archived BUG_REGISTER OPEN-01; REBUILD_PLAN S8 verifies it in real Chrome). Webpage and PDF capture are unaffected. |
| Semantic search is lexical only | Check that `EMBEDDING_PROVIDER` and the selected provider settings are configured in `.env` or `.env.local`; local embeddings need no API key. Restart the API and worker. |
| Web app says "Could not reach the Sentiora server" | The request got no response: the API is not running at `VITE_API_BASE_URL`, or the page origin is missing from `CORS_ORIGINS`. Check `http://localhost:8000/health` and the browser console. |
| "Too many requests" (HTTP 429) | A per-minute limit was hit (`RATE_LIMIT_*` in `.env` or `.env.local`). Wait a minute, or raise the limit for local testing. |
| Local `file://` PDFs are not captured | Chrome blocks extensions from file URLs by default. In `chrome://extensions` → Sentiora → **Details**, turn on **Allow access to file URLs**. |
| Uploading a `.txt`/`.md` file on Sources fails | Known gap: the upload is sent as a `file://` web page, which the API refuses. Use the extension or **Add memory** instead. |
| Extension changes don't show up | `npm run dev:extension` rebuilds `extension/dist`, but Chrome needs the reload icon in `chrome://extensions`, then a page refresh. |
