# Cross-Machine Checklist

Each teammate completes this on their own PC and pastes the result (name, OS, date) into the PR or team channel. Never paste secrets or `.env` contents.

**Machine:** ______ **OS:** ______ **Date:** ______ **Commit:** `git rev-parse --short HEAD` = ______

## Runtimes
- [ ] `node -v` is 20.19+ or 22.12+
- [ ] `python --version` (or `python3`) is 3.12+
- [ ] `docker compose version` works and Docker is running

## Setup
- [ ] Fresh `git clone`, no files copied from another PC
- [ ] `.env` and `backend/.env` created from the examples; only keys/ports edited
- [ ] `npm install` finished without errors
- [ ] Backend venv created and `pip install -e "./backend[dev]"` succeeded
- [ ] `docker compose up -d` → `docker compose ps` shows postgres and redis `healthy`
- [ ] `alembic upgrade head` succeeded on an empty database

## Services
- [ ] `npm start` → `http://localhost:8000/health` returns `"status":"ok"`
- [ ] `http://localhost:5173` loads with no red errors in DevTools Console
- [ ] `npm run dev:worker` prints `Listening on sentiora.default`
- [ ] Only one process listens on 8000 (`netstat -ano | findstr :8000` / `lsof -i :8000`)

## Accounts & data
- [ ] Register a new account, log out, log back in
- [ ] Refresh a dashboard page while logged in → still logged in
- [ ] After logout, opening `/dashboard` redirects to login

## Extension
- [ ] `npm run build:extension`, loaded unpacked from `extension/dist`
- [ ] Signing in via popup works; signing in on the web app syncs to the extension
- [ ] Capture an article (e.g. a Wikipedia page) → appears in the timeline and reaches READY; its text starts with article content, not menus
- [ ] Capture a text PDF → READY, text searchable
- [ ] Capture a YouTube video with captions → READY with timestamps, **or** record the exact error (known issue OPEN-01)

## AI
- [ ] Ask a question answered by a captured page → answer cites that page
- [ ] Ask about something you never captured → "couldn't find enough information" (no invented citations)

## Isolation & persistence
- [ ] A second account cannot see the first account's memories (list, search, ask)
- [ ] Restart API and worker (`Ctrl+C`, start again) → memories still there
- [ ] `docker compose restart redis` → worker reconnects by itself; a new capture still reaches READY

## Tests
- [ ] `npm run lint` · [ ] `npm run typecheck` · [ ] `npm run test` · [ ] `npm run test:e2e` · [ ] `npm run build`

## LAN (only if you need it)
- [ ] Followed README "Access From Another PC on Your LAN"
- [ ] From a second device: web app loads, login works, no CORS or mixed-content errors
- [ ] Reverted to local-only afterwards (or firewall limited to the private network)

Notes / failures:
