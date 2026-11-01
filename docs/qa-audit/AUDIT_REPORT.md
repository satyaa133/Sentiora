# Sentiora QA & Cross-Machine Audit Report

Date: 2026-10-25 · Branch `fix/get-app-running` (baseline commit `9466abb`, PR #7) · Details: [BUG_REGISTER.md](BUG_REGISTER.md), [TEST_RESULTS.md](TEST_RESULTS.md), [TEAM_SETUP.md](TEAM_SETUP.md), [CROSS_MACHINE_CHECKLIST.md](CROSS_MACHINE_CHECKLIST.md).

## Stabilization pass update (latest)

**Result: READY WITH LIMITATIONS.** 13 bugs found, 13 fixed, 0 unresolved P0/P1, 1 functional area blocked (YouTube in real Chrome). Every fix is verified by tests on this PC; BUG-02 Redis recovery is also verified live. Everything is still **uncommitted** on top of `9466abb`, and CI hasn't run on it. Full gate on this PC: lint, typecheck, 142 backend + 124 JS tests, 3 Playwright E2E and builds all pass; a clean clone in a separate directory with fresh containers also passes. Remaining blockers: YouTube manual test, a second physical PC, a real LAN client, and CI on the pushed commit. Details: TEST_RESULTS.md (matrix) and BUG_REGISTER.md (BUG-10…13, OPEN-06…08).

## Overall result (first pass): Ready with limitations

The core loop works end to end on this machine with a real LLM: register/login, webpage and PDF capture through the real extension, worker processing, search, and cited answers, with strict per-user isolation. Linux clean install is proven by CI. Before teammates rely on it:

1. Re-run the full suite on the audit commit (several fixes are only partly verified).
2. Confirm YouTube capture in a real Chrome profile (blocked here).
3. Have at least one teammate complete the cross-machine checklist.

## Architecture (as implemented)

- **Backend:** FastAPI (`backend/app/main.py`), routers `auth`, `users`, `memory-items`, `chat`/`search` under `/api/v1`. SQLAlchemy + Alembic on Postgres 16 with pgvector. JWT access tokens (15 min) plus rotating refresh tokens stored server-side. Rate limiting and login backoff. Body-size limit and security headers middleware.
- **Processing:** `POST /memory-items` stores a `pending` item and enqueues to RQ (`sentiora.default`). The worker (`app/workers/worker.py`) normalizes, chunks, embeds (OpenAI/Gemini, 1536-d, optional) and marks it READY. Retrieval is vector with lexical fallback. RAG answers with citations, or a local fallback without an LLM.
- **Frontend:** React 18 + Vite (`frontend/`). axios client with silent refresh. Auth in localStorage, mirrored to the extension.
- **Extension:** MV3 (`extension/`). Content script extracts webpages (Readability → structured nodes), PDFs (PDF.js) and YouTube transcripts in the browser. The background worker posts to the API and holds tokens in `chrome.storage`.
- **Config:** Vite reads `VITE_*` from the **root** `.env`; the backend reads `backend/.env`.

## Critical findings (all fixed in the working tree)

- **BUG-01 (P1, security):** a malicious website could sign the extension into an attacker's account, after which the user's captures of pages they visit would go to the attacker. Fixed with exact-origin trust; verified by tests that fail on the old code.
- **BUG-02 (P1, reliability):** the worker exited permanently on any short Redis outage, leaving all new captures pending forever. Fixed with a reconnecting supervisor loop; unit tests written; execution pending.
- **BUG-06 (P2, security):** the dev database, unauthenticated Redis, pgAdmin (`admin/admin`) and the dev API were reachable from the local network by default. Now loopback-only, with a documented LAN opt-in.

## Cross-machine findings

- The documented way to point the web app/extension at another backend (`frontend/.env`, `extension/.env`) was silently ignored (BUG-03). On another PC, LAN or deployment, the apps would keep calling `localhost:8000`.
- The extension hard-coded `localhost:5173` for its links (BUG-04).
- The documented compose command revived stale backend/worker containers that fight the host processes (BUG-05).
- The Node version requirement was wrong in the README (BUG-09).
- No absolute paths, drive letters or user-specific files are required. `scripts/run-python.mjs` handles Windows and Unix venv layouts. CI runs from a clean checkout.
- **Not tested:** macOS, a fresh Windows clone, a second physical PC, a real LAN client, a remote deployment.

## Security summary

Verified live: IDOR protection on read/delete/list/search/chat; JWT validation; refresh rotation and revocation; rate limiting; 413 on oversized bodies; restrictive CORS; security headers; `javascript:` URLs rejected; no stack traces in errors. Accepted/open: access token valid up to 15 min after logout (OPEN-02). Not yet run: a secret scan of git history and dependency audits. No credentials were printed during the audit; `.env` files were inspected by key name only.

## Files changed by the audit

| File | Purpose |
|---|---|
| `extension/src/shared/appUrl.ts` (new) | Configured web-app origin; exact-origin trust check; page URL helper |
| `extension/src/content/index.ts` | Auth sync only on the configured app origin (BUG-01) |
| `extension/src/background/index.ts` | Reject auth sync/clear from untrusted senders; refresh only app tabs (BUG-01) |
| `extension/src/popup/App.tsx`, `extension/src/popup/PopupAuth.tsx` | Configured dashboard/onboarding URLs and server name in errors (BUG-04) |
| `extension/src/services/extApiClient.ts` | Export `API_DISPLAY_URL` |
| `extension/src/shared/blocklist.ts` | Never capture the configured app origin |
| `extension/src/content/webpageCapture.ts` | Readability element cap 2500 → 15000 (BUG-07) |
| `extension/src/content/youtubeCapture.ts` | Report unavailable videos correctly (BUG-08) |
| `backend/app/workers/worker.py` | Reconnect after Redis loss; recovery on each reconnect (BUG-02) |
| `docker-compose.yml` | Loopback port bindings; `app` profile for backend/worker (BUG-05/06) |
| `package.json` | `dev:backend` on 127.0.0.1; `engines.node` (BUG-06/09) |
| `.env.example`, `frontend/.env.example`, `extension/.env.example` | Correct `VITE_*` variables in the file Vite reads (BUG-03) |
| `README.md` | Env, compose, Node version, extension origin, LAN mode |
| Tests (new/extended) | `extension/src/shared/appUrl.test.ts`, `extension/src/background/index.test.ts`, `extension/src/content/webpageCapture.test.ts`, `extension/src/content/youtubeCapture.flow.test.ts`, `backend/tests/test_worker_reconnect.py` |
| `docs/qa-audit/*` (new) | These reports |

Operational actions on this PC (non-destructive): Docker Desktop started; stale `sentiora-backend`/`sentiora-worker` containers stopped (not removed); infra containers recreated with new bindings (volumes kept); two throwaway `qa_*@example.com` users created in the local dev DB, with their capture deleted.

## Remaining work (priority order)

1. Re-run `npm run lint && npm run typecheck && npm run test && npm run test:e2e && npm run build` and `pytest tests/test_worker_reconnect.py`; restart `npm start` and `npm run dev:worker` to pick up the changes; re-run the live probe including a Redis restart.
2. Push the audit commit to PR #7 and confirm CI is green.
3. Verify YouTube capture in a real signed-in Chrome (OPEN-01); if it fails, design a server-side transcript path.
4. Secret scan of git history, plus `npm audit` and `pip-audit`.
5. A teammate completes CROSS_MACHINE_CHECKLIST on Windows/macOS, including the LAN section.
6. P3 items: lazy-load PDF.js in the content script, tidy `backend/test_e2e.py` and the root scratch files, and decide on access-token revocation.
