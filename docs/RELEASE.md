# Sentiora Release Guide

Covers production deployment (Docker) and Chrome Web Store packaging. Nothing in
this repository deploys or publishes automatically; every step below is manual.

## 1. Production deployment (single host, Docker Compose)

Files: `docker-compose.prod.yml`, `backend/Dockerfile`, `frontend/Dockerfile`,
`infrastructure/nginx/default.conf`, `.env.production.example`.

```
cp .env.production.example .env.production    # gitignored; fill in real values
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

What the stack does:

| Service    | Purpose | Exposed |
|------------|---------|---------|
| `postgres` | PostgreSQL 16 + pgvector, persistent volume | internal only |
| `redis`    | RQ queue, password-protected, AOF persistence | internal only |
| `migrate`  | One-shot: ensures `vector` extension, runs `alembic upgrade head` | n/a |
| `backend`  | FastAPI (non-root, healthcheck), starts after migrations succeed | internal only |
| `worker`   | RQ capture worker, healthy when registered with Redis | internal only |
| `web`      | nginx (unprivileged): SPA + same-origin proxy of `/api` and `/health` | `WEB_BIND:WEB_PORT` (default `0.0.0.0:8080`) |
| `pgadmin`  | Optional (`--profile admin`), bound to `127.0.0.1` | localhost only |

- **Fail-fast secrets:** compose refuses to start without `POSTGRES_PASSWORD`,
  `REDIS_PASSWORD`, `JWT_SECRET_KEY`, and `CORS_ORIGINS`. The API itself refuses
  non-development startup with the dev JWT secret, a secret shorter than 32
  characters, or `CORS_ORIGINS` containing `*`.
- **TLS** must terminate in front of `web` (load balancer or host reverse proxy)
  and forward `X-Forwarded-For` / `X-Forwarded-Proto`. The backend trusts
  `X-Forwarded-For` only from the `web` container (`TRUSTED_PROXY_IPS`), so rate
  limits cannot be bypassed with spoofed headers.
- **Security headers:** API responses carry nosniff / frame-deny / no-referrer /
  `default-src 'none'`; nginx serves the SPA with a strict CSP. `/docs` is not
  served outside development.
- **Migrations:** run automatically by `migrate` on every `up`. Back up the
  database before upgrading.
- **Restarting** applies configuration changes (`docker compose ... up -d`).
  Settings are read once per process.

Validated locally (2026-10-24): fresh build, all migrations on an empty database,
non-root API, register → capture → worker READY → grounded cited answer through
nginx, `/docs` blocked at the edge, spoofed `X-Forwarded-For` still rate limited.
No real server or cloud account was used.

### AI provider configuration

- Chat: `LLM_PROVIDER=openai|gemini|openrouter` plus its key.
- Semantic search needs an **embedding** key: `OPENAI_API_KEY`
  (`text-embedding-3-small`) or `GEMINI_API_KEY` (`gemini-embedding-001` or
  another model that outputs 1536 dimensions). OpenRouter provides chat only.
- `EMBEDDING_PROVIDER=auto` picks a provider as described in `.env.example`;
  `none` forces lexical-only search.
- Vectors are model-specific: after changing the embedding model, re-capture
  memories so stored vectors and query vectors come from the same model.
- Without any key, capture still works, search is lexical, and Ask returns a
  grounded local answer from retrieved memory (`used_fallback: true`).

## 2. Chrome Web Store packaging

```
VITE_API_BASE_URL=https://<your-api-origin> npm run package:extension
```

`scripts/package-extension.mjs` builds `extension/dist` fresh, then blocks the
release if:

- `VITE_API_BASE_URL` is missing, not https, or localhost (use
  `--allow-localhost` only for a local test ZIP, suffixed `-localdev`);
- the manifest is not MV3, the description exceeds 132 characters, icons are
  missing, a `key` field is present, or referenced files are missing;
- the bundle contains source maps, test files, env files, remote `<script src>`,
  or secret-like strings.

It writes a deterministic `release/sentiora-extension-<version>.zip` (gitignored)
and uploads nothing.

### Permission justifications (for the store listing)

| Permission | Why it is needed |
|------------|------------------|
| `host_permissions: <all_urls>` and content script on all pages | Core feature: the user's browsing (webpages, YouTube) is captured into their vault. Sensitive sites (banking, health, password pages, `noindex`) are excluded on-device before anything is sent. |
| `file:///*` content script match | Capture of local PDF files the user opens (requires the user to enable "Allow access to file URLs"). |
| `scripting` | Inject the capture script into an already-open tab on demand, and read YouTube's player data from the page's main world (content scripts cannot see it). |
| `storage` | Store the session tokens and per-session capture de-duplication state. |

`tabs` was removed: tab URLs/titles are available through the host permission.

### Data handling disclosures (draft, needs owner review)

- Collected: page text, titles, URLs, YouTube transcripts, local PDF text that
  the user captures, account email.
- Purpose: building the user's private searchable memory and answering the
  user's questions with citations.
- Sent to: the Sentiora API at `VITE_API_BASE_URL`; when configured server-side,
  text is sent to the chosen AI provider (OpenAI, Google Gemini, OpenRouter) for
  embeddings and answers.
- Not sold; not used for advertising.

### Outstanding human decisions before submission

1. **Icons are placeholders** (`extension/public/icons/icon.svg`, rendered by
   `npm run icons:extension`). Replace with approved brand art and store
   screenshots / promo tiles.
2. **Privacy policy URL** and the final data-use disclosure text (above is a
   draft; do not publish claims that have not been reviewed).
3. **Production API origin** for `VITE_API_BASE_URL`, and the dashboard origin
   (the content script syncs auth only on `localhost`/`127.0.0.1` or hosts
   containing `sentiora`).
4. Whether automatic capture on every page should be opt-in for store review.
5. Version number and release notes.

## 3. YouTube capture: behaviour and limits

- Supported pages: `youtube.com/watch`, `/shorts/<id>`, `/live/<id>`,
  `m.youtube.com`. All variants are saved under one canonical
  `https://www.youtube.com/watch?v=<id>` URL, so re-captures deduplicate.
- Transcript sources, in order: official caption tracks (manual, then other
  languages, then auto-generated), then YouTube's own transcript panel. The panel
  is opened by clicking "Show transcript" **only for a manual popup capture**;
  automatic capture never touches the page UI.
- Timestamps are kept per transcript segment and per chunk (`Title [mm:ss–mm:ss]`
  headings), so citations point at the moment in the video.
- Nothing is saved when no transcript is accessible. Users see a typed error:
  `YOUTUBE_CAPTIONS_UNAVAILABLE`, `YOUTUBE_VIDEO_UNAVAILABLE` (private, removed,
  age/login-gated), `YOUTUBE_TRANSCRIPT_FETCH_FAILED`, `YOUTUBE_PLAYER_UNREADY`,
  or `YOUTUBE_TRANSCRIPT_PARSE_FAILED`.
- Access controls are respected: no authentication, DRM, CAPTCHA, or
  proof-of-origin token bypass.
- **Known limitation (observed 2026-10-24):** YouTube now often returns empty
  caption files to requests made outside its player (missing proof-of-origin
  token), and in automated or signed-out browsers its own transcript panel
  request fails (HTTP 400). In those cases capture reports
  `YOUTUBE_TRANSCRIPT_FETCH_FAILED` honestly. Verify transcript capture in a normal
  signed-in Chrome profile before release.
- Opt-in checks: `SENTIORA_LIVE_YOUTUBE=1 npx vitest run src/content/youtubeCapture.live.test.ts`
  (in `extension/`) and `npm run verify:youtube-extension` (loads the built
  extension into Chromium and extracts a live video without saving it).
