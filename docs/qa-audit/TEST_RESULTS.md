# Sentiora Test Results

Last updated: 2026-10-25 (stabilization pass). Tested code: PR head `9466abb` **plus the uncommitted audit changes** in the working tree (25 modified, 4 new files). CI has **not** yet run on these changes, because they aren't pushed.

Environment: Windows 11 (10.0.22621), Node 22.13.1, npm 10.9.2, Python 3.12.0, Docker Desktop (Postgres 16 + pgvector, Redis 7), Playwright Chromium. Linux evidence: GitHub Actions `ubuntu-latest` on `9466abb` only. **macOS not tested. No second physical PC.**

Status labels: PASS · FAIL · BLOCKED · NOT TESTED · STATICALLY REVIEWED.

## Verification matrix

| Area | Status | Evidence |
|---|---|---|
| Redis recovery | PASS | Isolated stack (`sentiora_test`, Redis db 5, API :8200 + worker). **(a) quick restart:** both captures READY, searchable, no duplicates. **(b) 25 s outage:** RQ logged `Redis connection timeout, quitting...`, the new loop logged `Redis unavailable ... retrying in 5s` ×4, started a fresh worker when Redis returned, and the next capture was READY in 1.0 s. Before the fix the same scenario left the worker dead and captures `pending`. **(c) capture while Redis is down:** HTTP 201, READY in 1.1 s via the inline fallback (`Could not enqueue ... Processing inline`), one item, no duplicate after Redis came back. Unit: `test_worker_reconnect.py` (3) and claim tests in `test_process_capture.py` (3; the busy-item test fails on the old code). |
| Extension origin security | PASS (unit) / NOT TESTED (real Chrome) | `appUrl.test.ts` (5) and the background trust-boundary tests (6). Rejected: userinfo `localhost:5173@evil`, path/fragment/query tricks, `app.localhost`, trailing-dot host, `ws:`, `sentiora.example.attacker.com`, `app.sentiora.example`, other ports, http vs https, `127.0.0.1` vs `localhost`. A malformed `VITE_APP_URL` trusts nothing. 5 tests fail on the old code. Manifest: `storage`, `scripting`, `<all_urls>` (needed for capture on any site); no `externally_connectable`, so web pages can't message the extension directly. |
| Cross-machine configuration | PASS | Fresh clone: `VITE_API_BASE_URL`/`VITE_APP_URL` in the root `.env` appear in the frontend bundle, the extension background/content and the popup; a conflicting `frontend/.env` value does **not** (ignored as documented). No `localhost:5173` remains in the extension bundles. DB/Redis defaults switched to `127.0.0.1` (BUG-10). |
| Clean installation | PASS (second directory, same PC) | Fresh `git clone` + audit diff in a new folder, new `pgvector/pgvector:pg16` and `redis:7-alpine` containers (ports 55432/56379), env files from the examples. `npm install` 391 pkgs OK; venv via `py -3.12`; `alembic upgrade head` on an empty DB OK; typecheck OK; tests 142 backend + 111 extension + 11 frontend + 2 shared passed; `npm run build` OK. Found: plain `python` = 3.11 Store alias breaks the backend install (BUG-11, docs fixed); a lint error in a new audit test (fixed). |
| Second physical PC | BLOCKED | None available. Needs a teammate to run CROSS_MACHINE_CHECKLIST. |
| LAN connectivity | PASS (same host via LAN IP) / BLOCKED (second device) | API started with `--host 0.0.0.0`: `http://<lan-ip>:8300/health` → 200; CORS preflight allowed only the configured `http://<lan-ip>:5173` (evil origin and port 5174 got no allow header); unauthenticated list → 401; Postgres 5433, Redis 6380 and pgAdmin 5050 **refused** on the LAN IP. |
| YouTube transcripts | BLOCKED | Playwright Chromium (headless and headed): `timedtext` → 200 with empty body; YouTube's own `get_transcript` → 400 "Precondition check failed". Installed Google Chrome refuses `--load-extension`, so automated real-Chrome testing isn't possible. Needs a manual test (below). Unavailable-video message fixed (BUG-08). |
| Authentication and isolation | PASS | Live probe (37 checks, earlier pass), and pytest auth/authorization/security suites (part of 142). |
| Backend tests | PASS | `pytest`: 142 passed (main checkout and clean clone). |
| Frontend and extension tests | PASS | Vitest: extension 111 passed / 1 skipped (opt-in live test), frontend 11, shared 2. |
| Browser E2E | PASS | `npm run test:e2e`: 3 passed (isolated API :8100 + UI :5180, test DB), including the UI flow showing a failed capture with its reason. |
| Production builds | PASS | `npm run build` (frontend, extension, shared) exit 0, main checkout and clean clone. |
| Dependency audit | PASS with notes | `npm audit --omit=dev`: 0 vulnerabilities. Dev-only: 3 moderate (`postcss-selector-parser` via tailwind/postcss-nested), not shipped. `pip-audit`: **PyJWT 2.13.0 had 13 advisories** (most need JWKS/PyJWK/asymmetric keys, which Sentiora doesn't use; HS256 only). Floor raised to `pyjwt>=2.15`; venv now 2.15.1; urllib3 2.8.0, certifi 2026.10.23. Remaining: `black` 24.10 and `pytest` 8.4 (dev tools; fixes need major bumps). |
| Git-history secret scan | PASS with note | All 74 commits scanned with regexes for OpenAI/OpenRouter/Google/GitHub/AWS/Slack keys, private keys, JWTs and secret assignments: **no real credentials found**; no `.env` ever committed. Generic hits are dev placeholders (`CHANGE_ME_LOCAL_DEV`, `DEV_SECRET_KEY_...`) and test passwords. Note: commit `b6588dae` added a full Python venv (`backend/.venv312`), since removed from the tree but still in history (size only). Built bundles and root scratch files contain no keys. Tool: custom regex scan (gitleaks not installed). |

## Commands executed this pass

| Command | Result |
|---|---|
| `pytest tests/test_worker_reconnect.py` (direct) | 3 passed |
| `pytest` (full, 127.0.0.1 URLs via env) | 139 → 142 passed after the new tests |
| `pytest tests/test_process_capture.py` with the old `process_capture.py` | 1 failed (busy item reprocessed), proving the regression test |
| `redis_recovery.py` / `redis_outage.py` / `redis_down_capture.py` (isolated stack) | see Redis recovery row |
| Clean clone: `npm install`, `py -3.12 -m venv`, `pip install -e ./backend[dev]`, `alembic upgrade head`, `npm run lint/typecheck/test/build` | see Clean installation row |
| Clean clone: `npm run build:frontend`, `npm run build:extension` with marker env values | see Cross-machine row |
| `npm run lint && npm run typecheck && npm run test && npm run test:e2e && npm run build` (main checkout) | all exit 0 |
| `npm audit`, `npm audit --omit=dev`, `pip-audit -r <freeze>` | see Dependency audit row |
| History scan script over `git log --all -p` | see secret scan row |
| `uvicorn --host 0.0.0.0 --port 8300` + curl via LAN IP | see LAN row |

## Manual test still required (YouTube, real Chrome)

1. `npm run build:extension`. In your normal Chrome, open `chrome://extensions`, then **Load unpacked** → `extension/dist`.
2. Sign in via the popup.
3. Open a captioned video (e.g. `https://www.youtube.com/watch?v=aircAruvnKk`), let it play a few seconds, then click **Capture** in the popup.
4. Expected: memory READY with transcript text and timestamps. Record the exact error code if it fails.
5. Repeat with a Shorts URL, a video without captions (expect `YOUTUBE_CAPTIONS_UNAVAILABLE`) and a deleted video (expect `YOUTUBE_VIDEO_UNAVAILABLE`).
