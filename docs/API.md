# Sentiora API

The contract between the API and its clients (web app, extension, tests).

- **Exact schemas** (every path, parameter, request and response model):
  [`api/openapi.json`](api/openapi.json), generated from the code.
  Regenerate after any route or schema change and commit it with the change:

  ```bash
  npm run docs:api
  npm run docs:api -- --check   # fails if the committed file is out of date
  ```

- **Interactive docs:** `http://localhost:8000/docs` while
  `APP_ENVIRONMENT=development`.
- **Planned changes:** `REBUILD_PLAN.md` section 8. Endpoints and fields are
  added only through that plan.

This file replaces `05_API_Specification_v1.0.pdf` (archived), which described
endpoints that were never built.

---

## Conventions

| Topic | Rule |
| ----- | ---- |
| Base path | `/api/v1` for everything except `GET /health` |
| Format | JSON, UTF-8. `POST /chat/stream` returns `text/event-stream` |
| Field names | `snake_case` in requests and responses (the SSE `final` event uses `usedSources` / `followUps`, see Ask) |
| Times | ISO 8601 with timezone, UTC |
| IDs | UUID strings |
| Request size | Bodies over 4 MB (`MAX_REQUEST_BODY_BYTES`) are refused with `413 PAYLOAD_TOO_LARGE` |
| Request ID | Every response has an `X-Request-ID` header, also in `meta.request_id` |
| User isolation | Every memory, chunk and search query is limited to the signed-in user |

### Response envelope

Every JSON response uses the envelope in `backend/app/schemas/envelope.py`.

**Success**

```json
{
  "success": true,
  "data": { },
  "meta": { "timestamp": "2026-11-20T05:02:34.134691Z", "request_id": "req_9473bbec" }
}
```

**Failure** (shaped by the handlers in `backend/app/main.py`)

```json
{
  "success": false,
  "error": { "code": "MEMORY_ITEM_NOT_FOUND", "message": "…", "details": null },
  "meta": { "timestamp": "…", "request_id": "…" }
}
```

Validation errors (`422 VALIDATION_ERROR`) list each problem in `details`:
`[{ "field": "email", "issue": "value is not a valid email address" }]`.
Unhandled errors are `500 SYSTEM_ERROR`; `details` carries the exception only
in development.

---

## Authentication

- `POST /auth/register` or `POST /auth/login` returns an **access token** (JWT,
  15 minutes, `ACCESS_TOKEN_EXPIRE_MINUTES`) and a **refresh token** (30 days,
  `REFRESH_TOKEN_EXPIRE_DAYS`).
- Protected endpoints need `Authorization: Bearer <access token>`.
- `POST /auth/refresh-token` exchanges a refresh token for a new pair; the old
  refresh token is revoked.
- `POST /auth/logout` revokes the user's refresh tokens.
- The web app refreshes automatically in `frontend/src/services/apiClient.ts`;
  the streaming Ask client (`askStream.ts`) retries once after a refresh.

---

## Rate limits

Sliding windows of 60 seconds. Exceeding one returns `429 RATE_LIMITED` with a
`Retry-After` header (seconds).

| Endpoint | Key | Default limit | Setting |
| -------- | --- | ------------- | ------- |
| `POST /auth/login` | client IP | 10 / min | `RATE_LIMIT_LOGIN_PER_MINUTE` |
| `POST /auth/register` | client IP | 5 / min | `RATE_LIMIT_REGISTER_PER_MINUTE` |
| `POST /auth/refresh-token` | client IP | 30 / min | `RATE_LIMIT_REFRESH_PER_MINUTE` |
| `POST /chat`, `POST /chat/stream` | client IP | 20 / min | `RATE_LIMIT_CHAT_PER_MINUTE` |
| `POST /chat`, `POST /chat/stream` | user | 10 / min | `RATE_LIMIT_CHAT_PER_USER_PER_MINUTE` |
| `GET /search` | user | 30 / min | `RATE_LIMIT_SEARCH_PER_USER_PER_MINUTE` |

Repeated failed logins also back off per account (`429 AUTH_LOGIN_THROTTLED`).
Limits are counted in Redis, so they hold across every API process. If Redis
is unreachable, each process falls back to its own in-memory count. The
per-account login back-off is still kept per process.

---

## Endpoints

24 endpoints. Request and response models are in `api/openapi.json`.
Prometheus metrics are served at `GET /metrics` (outside `/api/`, not in the
OpenAPI schema; nginx doesn't forward it).

### Health

| Method | Path | Auth | Purpose |
| ------ | ---- | ---- | ------- |
| GET | `/health` | — | Liveness: `{status: "ok", service}` |

### Auth (`/api/v1/auth`)

| Method | Path | Auth | Purpose |
| ------ | ---- | ---- | ------- |
| POST | `/register` | — | Create an account; returns tokens (201). Requires `privacy_consent_version` equal to `PRIVACY_NOTICE_VERSION` (422 otherwise) |
| POST | `/login` | — | Email + password; returns tokens |
| POST | `/refresh-token` | — | New token pair from a refresh token |
| POST | `/logout` | Bearer | Revoke the user's refresh tokens |
| GET | `/me` | Bearer | Signed-in user's identity, with `privacy_consent_version` and `privacy_consent_current` |
| POST | `/forgot-password` | — | Request a reset link; always 202 |
| POST | `/reset-password` | — | Set a new password with a reset token |
| PUT | `/change-password` | Bearer | Change password (current password required) |

### Users (`/api/v1/users`)

| Method | Path | Auth | Purpose |
| ------ | ---- | ---- | ------- |
| GET | `/me` | Bearer | Full profile |
| GET | `/me/source-preferences` | Bearer | Which capture sources are on |
| PATCH | `/me/source-preferences` | Bearer | Update several sources |
| PATCH | `/me/source-preferences/{source_id}` | Bearer | Update one source |
| POST | `/me/onboarding/complete` | Bearer | Finish onboarding with initial sources |
| DELETE | `/me` | Bearer | Delete the account and everything in it (D15). Body `{"password"}`; 401 `AUTH_INVALID_CREDENTIALS` when wrong (nothing deleted); rate-limited like sign-in. Removes memories, chunks, questions, feedback, AI usage rows, sessions, refresh tokens and the user's cached answers |
| POST | `/me/privacy-consent` | Bearer | Accept the current privacy notice. Body `{"version"}` (must be current, 422 otherwise); returns `privacy_consent_version`, `privacy_consent_current` |

**Privacy notice (D10, S7).** Sign-up stores the accepted notice version and
time. When `PRIVACY_NOTICE_VERSION` changes, `privacy_consent_current` turns
false until the user accepts again. Without current consent, AI answers
(`answer_mode: "ai"`) and `POST /memory-items/{id}/enrich` return `403
PRIVACY_CONSENT_REQUIRED`, and background enrichment is skipped. Instant answers
and search never need it.

### Memory items (`/api/v1/memory-items`)

| Method | Path | Auth | Purpose |
| ------ | ---- | ---- | ------- |
| POST | `` (collection) | Bearer | Ingest a capture from the extension; queues processing (201) |
| GET | `` (collection) | Bearer | List the user's memories |
| GET | `/{item_id}` | Bearer | One memory; opening it queues its enrichment |
| POST | `/{item_id}/enrich` | Bearer | Queue enrichment of one save (Summarise button, Save now) (202) |
| PATCH | `/{item_id}` | Bearer | Rename a save. Body `{"title"}` (1–300 characters, spaces collapsed) |
| DELETE | `/{item_id}` | Bearer | Soft delete (also removes its questions) |

List query parameters: `page` (≥ 1), `per_page` (1–100, default 20),
`source_type`, `status`, `date_from` (inclusive), `date_to` (exclusive), `q`.
The list response has `items`, `total`, `page`, `per_page`.

A capture of a blocked sensitive URL is refused with
`403 CAPTURE_SENSITIVE_BLOCKED`. Processing (chunking, embedding) happens in the
capture worker; the item's `status` moves from `pending` to `ready` or `failed`.

**Enrichment (S5).** A memory has `summary`, `key_points` (up to 8) and
`enrichment_status` (`none` | `queued` | `ready` | `failed`). Enrichment is one
AI call in the `sentiora.enrich` worker queue and runs only for saves that
matter: `POST` with `"enrich": true` (the extension's Save now; auto-saves send
`false`), `POST /{item_id}/enrich`, opening the memory (`GET /{item_id}`) or the
memory being a source of an Ask answer. Each user gets `ENRICH_DAILY_LIMIT`
(default 50) requests per UTC day. A failed attempt is retried after 1, 5 and 30
minutes and 6 hours, then the status is `failed` (the memory stays searchable).

`POST /{item_id}/enrich` returns `202` with the memory (`enrichment_status:
"queued"`), `409 ENRICHMENT_ALREADY_QUEUED` when it is already queued, `429
RATE_LIMITED` past the daily limit, `422 VALIDATION_ERROR` for a failed capture
and `404 MEMORY_ITEM_NOT_FOUND`. It also re-enriches a `ready` or `failed` memory.

### Ask and search (`/api/v1`)

| Method | Path | Auth | Purpose |
| ------ | ---- | ---- | ------- |
| POST | `/chat` | Bearer | Ask a question; one JSON answer with citations |
| POST | `/chat/stream` | Bearer | Same question, answer streamed as server-sent events |
| GET | `/search` | Bearer | Hybrid search over the user's chunks (`q` 2–500 chars, `source_type`, `top_k` 1–20, default 8) |

Ask request: `question` (2–2000 chars), optional `source_type`, `memory_id`,
`top_k` (1–8, default 5), `history` (up to 4 earlier turns), `tz` (IANA zone for
"today" / "yesterday"), `answer_mode` (`"instant"` | `"ai"`, default
`ASK_DEFAULT_MODE`, which is `instant`).

**Answer modes (S6).** `instant` answers without any AI call: the best sentences
of the retrieved saves, quoted and cited `[S#]` (video lines start with their
time), or a stored summary for "summarise this save" questions on an enriched
save. When no sentence clears `RAG_EXTRACT_MIN_SCORE` the answer is the "not in
your saves" text. `ai` ("Explain with AI") makes one model call that returns the
answer and its follow-ups; it reuses the sources the instant answer for the same
question showed. Before an `ai` answer calls a model it takes one of
`LLM_MAX_CONCURRENT` slots shared by every API process; when none is free the
request fails with `429 AI_BUSY`, `details.retry_after` (seconds) and a
`Retry-After` header. Listing and "which sources mention" answers never call a
model in either mode. Finished answers are cached per user, question, scope,
earlier turns and library version for `ANSWER_CACHE_TTL_SECONDS`.

`POST /chat` keeps its shape: an `instant` answer reports `mode: "memory"`.

**`/chat/stream` events** (details in `RAG_v2_ADDENDUM.md` R5):

| Event | Data |
| ----- | ---- |
| `sources` | `{"sources": [{"id": "S1", …citation fields, start_sec/end_sec}]}` |
| `delta` | `{"text": "…"}` answer pieces in order |
| `final` | `{"answer", "mode": "instant" \| "memory" \| "general" \| "mixed", "usedSources", "followUps", "insufficient_context", "used_fallback", "aiAvailable"}`; `answer` replaces the streamed text. `mode` is `instant` for every `instant`-mode answer. `aiAvailable`: an AI answer could add to this one (a model is configured and not cooling down; false for AI answers and save listings). `followUps` of instant answers come from the matched saves' stored questions |
| `error` | `{"code", "message", "status"}` |

Validation, auth, retrieval and `AI_BUSY` errors on `/chat/stream` are normal
HTTP errors before the stream starts; model failures after it starts arrive as
`error` events.

### Answer feedback (`/api/v1/answers`)

| Method | Path | Auth | Purpose |
| ------ | ---- | ---- | ------- |
| POST | `/feedback` | Bearer | Rate an Ask answer 👍/👎 (201) |

Body: `question` (2–2000 chars; stored only as a SHA-256 hash), `answer_mode`
(`memory`, `general`, `mixed`, `combined`; `instant`/`ai` from S6), `rating`
(`1` or `-1`), optional `comment` (≤ 1000 chars), `source_chunk_ids` (≤ 20
UUIDs). Returns `{id, rating, created_at}`.

### Dashboard (`/api/v1/dashboard`)

| Method | Path | Auth | Purpose |
| ------ | ---- | ---- | ------- |
| GET | `/statistics` | Bearer | Memory counts and aggregates for the user; the web app makes one request per dashboard load and reuses it for 10 s |

---

## Error codes

| Code | HTTP | When |
| ---- | ---- | ---- |
| `VALIDATION_ERROR` | 422 | Request body or parameters invalid |
| `PAYLOAD_TOO_LARGE` | 413 | Body over `MAX_REQUEST_BODY_BYTES` |
| `RATE_LIMITED` | 429 | Rate limit hit; see `Retry-After` |
| `SYSTEM_ERROR` | 500 | Unhandled server error |
| `AUTH_INVALID_CREDENTIALS` | 401 | Wrong email or password |
| `AUTH_TOKEN_INVALID` | 401 | Missing, malformed or wrongly signed token |
| `AUTH_TOKEN_EXPIRED` | 401 | Expired token |
| `AUTH_TOKEN_REVOKED` | 401 | Refresh token already revoked |
| `AUTH_RESET_TOKEN_INVALID` | 400 | Password reset token invalid or expired |
| `AUTH_FORBIDDEN` | 403 | Authenticated but not allowed |
| `PRIVACY_CONSENT_REQUIRED` | 403 | An AI feature (AI answer, Summarise) without consent to the current privacy notice |
| `AUTH_ACCOUNT_DISABLED` | 403 | Account disabled |
| `AUTH_EMAIL_ALREADY_EXISTS` | 409 | Registering an email that exists |
| `AUTH_LOGIN_THROTTLED` | 429 | Too many failed logins for the account |
| `USER_PROFILE_NOT_FOUND` | 404 | Profile missing |
| `MEMORY_ITEM_NOT_FOUND` | 404 | Memory doesn't exist or isn't the user's |
| `ENRICHMENT_ALREADY_QUEUED` | 409 | `POST /memory-items/{id}/enrich` while that memory's enrichment is queued |
| `CAPTURE_SENSITIVE_BLOCKED` | 403 | Capture of a blocked sensitive URL |
| `AI_NOT_CONFIGURED` | 503 | No AI model configured and no saved memory could answer |
| `AI_PROVIDER_UNAVAILABLE` | 503 | Every AI key is out of credit, invalid, rate-limited or overloaded |
| `ASK_LLM_FAILED` | 502 | The AI model call failed |
| `ASK_SYSTEM_FAILED` | 502 | Retrieval or another Ask step failed |
| `ASK_STREAM_INTERRUPTED` | — | SSE `error` event: the answer stopped after partial text |
| `AI_BUSY` | 429 | `answer_mode: "ai"` while every AI slot (`LLM_MAX_CONCURRENT`) is in use; `details.retry_after` and `Retry-After` give the wait in seconds |

New codes come only from `REBUILD_PLAN.md` section 8 (for example `AI_BUSY`,
`PRIVACY_CONSENT_REQUIRED`).

---

## Changing the API

1. Add the change to `REBUILD_PLAN.md` section 8 first (owner approval).
2. Implement it: route in `backend/app/api/v1/*_routes.py`, logic in
   `backend/app/services/`, schemas in `backend/app/schemas/`.
3. Add API tests.
4. Run `npm run docs:api`, update this file if a convention, endpoint table or
   error code changed, and commit both with the code.
5. Update the client in `frontend/src/services/` (and the extension if it calls
   the endpoint).
