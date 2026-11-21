# Sentiora Database

PostgreSQL 16 with the `pgvector` extension (image
`sentiora-postgres-pgvector:16`, `infrastructure/`). The schema is owned by the
SQLAlchemy models in `backend/app/models/` and changed only through Alembic
migrations in `backend/alembic/versions/`.

This file describes the schema at migration head **`008_local_embeddings`**
(checked against a live database on 2026-11-20). It replaces
`06_Database_Schema_Design_v1.2.pdf` (archived), which designed many tables
that were never built. Planned changes are in `REBUILD_PLAN.md` section 7.

---

## Overview

```
users ─┬─< sessions ─<┐
       ├─< refresh_tokens (session_id → sessions, SET NULL)
       ├── user_profiles (1:1)
       ├─< memory_items ─< memory_chunks
       ├─<──────────────────┘ (memory_chunks.user_id)
       ├─< llm_usage
       └─< answer_feedback
```

Every user-owned table references `users(id) ON DELETE CASCADE`, so deleting a
user row deletes all their data. `memory_chunks` also cascades from
`memory_items`.

Eight tables (plus `alembic_version`):

| Table | Holds |
| ----- | ----- |
| `users` | Accounts and credentials |
| `sessions` | Signed-in devices |
| `refresh_tokens` | Hashed refresh tokens (rotation and revocation) |
| `user_profiles` | Display settings, onboarding, capture source preferences |
| `memory_items` | One row per save (page, PDF, YouTube video) |
| `memory_chunks` | The searchable pieces of each save, with vectors and full-text |
| `llm_usage` | One row per call to an external AI provider (tokens, cost, latency) |
| `answer_feedback` | 👍/👎 on Ask answers |

### Enums

| Type | Values |
| ---- | ------ |
| `sourcetype` | `webpage`, `pdf`, `youtube` |
| `itemstatus` | `pending`, `processing`, `ready`, `failed` |

All timestamps are `timestamptz` (UTC). All primary keys are UUIDs.

---

## Tables

### `users`

| Column | Type | Null | Default / notes |
| ------ | ---- | ---- | --------------- |
| `id` | uuid | no | PK |
| `email` | varchar | no | unique |
| `password_hash` | text | yes | bcrypt |
| `is_email_verified` | boolean | no | `false` |
| `is_active` | boolean | no | `true`; `false` = `AUTH_ACCOUNT_DISABLED` |
| `last_login_at` | timestamptz | yes | |
| `created_at`, `updated_at` | timestamptz | no | `now()` |
| `deleted_at` | timestamptz | yes | soft delete |

Indexes: unique `email`; `deleted_at`.

### `sessions`

| Column | Type | Null | Default / notes |
| ------ | ---- | ---- | --------------- |
| `id` | uuid | no | PK |
| `user_id` | uuid | no | FK `users`, cascade |
| `device_label` | varchar | yes | |
| `ip_address` | inet | yes | |
| `user_agent` | text | yes | |
| `is_active` | boolean | no | `true` |
| `last_seen_at` | timestamptz | no | `now()` |
| `expires_at` | timestamptz | no | |
| `created_at` | timestamptz | no | `now()` |

Indexes: `user_id`; `(user_id, is_active)`.

### `refresh_tokens`

| Column | Type | Null | Default / notes |
| ------ | ---- | ---- | --------------- |
| `id` | uuid | no | PK |
| `user_id` | uuid | no | FK `users`, cascade |
| `session_id` | uuid | yes | FK `sessions`, `SET NULL` |
| `token_hash` | text | no | the token itself is never stored |
| `is_revoked` | boolean | no | `false` |
| `expires_at` | timestamptz | no | 30 days (`REFRESH_TOKEN_EXPIRE_DAYS`) |
| `created_at` | timestamptz | no | `now()` |

Indexes: `token_hash`; `(user_id, is_revoked)`. Refresh rotates the token;
reusing a revoked token revokes the user's whole token family.

### `user_profiles`

| Column | Type | Null | Default / notes |
| ------ | ---- | ---- | --------------- |
| `id` | uuid | no | PK |
| `user_id` | uuid | no | FK `users`, cascade; unique (1:1) |
| `display_name` | varchar | yes | |
| `avatar_url` | text | yes | |
| `bio` | text | yes | |
| `timezone` | varchar | no | `'UTC'` |
| `locale` | varchar | no | `'en-US'` |
| `onboarding_completed` | boolean | no | `false` |
| `source_preferences` | jsonb | no | `'{}'`; which capture sources are on |
| `created_at`, `updated_at` | timestamptz | no | `now()` |

### `memory_items`

One row per save. Written by `POST /memory-items`; processed by the capture
worker (`backend/app/workers/jobs/process_capture.py`).

| Column | Type | Null | Default / notes |
| ------ | ---- | ---- | --------------- |
| `id` | uuid | no | PK |
| `user_id` | uuid | no | FK `users`, cascade |
| `source_type` | sourcetype | no | |
| `url` | text | no | |
| `title` | text | no | metadata only, never part of chunk text |
| `content` | text | yes | cleaned full text |
| `structured_content` | jsonb | yes | sections / timed transcript nodes from the extension |
| `summary` | text | yes | **unused today**; REBUILD_PLAN S5 fills it |
| `author`, `favicon_url`, `thumbnail_url` | text | yes | |
| `domain`, `language` | varchar | yes | |
| `word_count`, `reading_time_seconds` | integer | no | `0` |
| `content_length`, `raw_content_length` | integer | no | `0` |
| `content_hash` | varchar | yes | duplicate detection |
| `extraction_method`, `extraction_status` | varchar | yes | from the extension's capture engine |
| `extraction_quality_score` | double | yes | |
| `extraction_quality_reasons` | jsonb | yes | |
| `status` | itemstatus | no | `pending` → `processing` → `ready` / `failed` |
| `processing_error` | text | yes | why it failed |
| `captured_at` | timestamptz | no | `now()`; when the user saw it |
| `received_at` | timestamptz | no | `now()`; when the API received it |
| `created_at`, `updated_at` | timestamptz | no | `now()` |
| `deleted_at` | timestamptz | yes | soft delete; excluded from search |
| `title_tsv` | tsvector | — | generated: `to_tsvector('english', coalesce(title, ''))` |

Indexes: `user_id`; `status`; `source_type`; `captured_at`; `deleted_at`;
`content_hash`; GIN `title_tsv`.

### `memory_chunks`

The searchable pieces of a save. Built by the capture worker (RAG_v2_ADDENDUM
R2): ~400–600 token chunks for pages and PDFs, 60–90 second windows for timed
YouTube transcripts.

| Column | Type | Null | Default / notes |
| ------ | ---- | ---- | --------------- |
| `id` | uuid | no | PK |
| `memory_id` | uuid | no | FK `memory_items`, cascade |
| `user_id` | uuid | no | FK `users`, cascade; every query filters on it |
| `chunk_index` | integer | no | order within the memory; unique with `memory_id` |
| `content` | text | no | body text |
| `heading` | text | yes | section heading, or `[mm:ss–mm:ss]` for transcripts |
| `page_number` | integer | yes | PDFs |
| `start_sec`, `end_sec` | double | yes | YouTube time range |
| `source_type` | sourcetype | no | copied from the memory |
| `embedding` | vector(1536) | yes | null when embedding failed (full-text still works) |
| `embedding_model` | varchar | yes | `provider:model` that produced `embedding`; queries only match the active model |
| `embedding_local` | vector(768) | yes | vector from the local model (`EMBEDDING_PROVIDER=local`, `LOCAL_EMBEDDING_MODEL`, default `nomic-ai/nomic-embed-text-v1.5-Q`); null until embedded. `embedding_model` does not describe it: it always holds `LOCAL_EMBEDDING_MODEL` vectors |
| `content_tsv` | tsvector | — | generated: `setweight(to_tsvector('english', coalesce(heading, '')), 'B') \|\| setweight(to_tsvector('english', content), 'A')` |
| `created_at` | timestamptz | no | `now()` |

Indexes: `memory_id`; `user_id`; `(user_id, memory_id)`; unique
`(memory_id, chunk_index)`; **HNSW** `embedding vector_cosine_ops`; **HNSW**
`embedding_local vector_cosine_ops`; GIN `content_tsv`.

Search reads the column of the active provider: `embedding_local` for
`EMBEDDING_PROVIDER=local`, otherwise `embedding` where `embedding_model`
matches. Each provider writes only its own column, so switching back is a
setting plus `scripts.reprocess_memories --embed` for saves made meanwhile.
`embedding` is dropped in S10.

### `llm_usage`

One row per call to an external AI provider: answers, follow-up rewrites,
embeddings (and enrichment from S5). Written by `app/services/usage.py`.

| Column | Type | Null | Default / notes |
| ------ | ---- | ---- | --------------- |
| `id` | uuid | no | PK |
| `user_id` | uuid | yes | FK `users`, cascade; null for calls not made for one user |
| `purpose` | varchar(16) | no | `answer` \| `enrich` \| `rewrite` \| `embed` (check constraint); the answer-metadata call counts as `answer` |
| `provider` | varchar(32) | no | `openrouter`, `gemini`, `openai` |
| `model` | varchar(128) | no | |
| `tokens_in`, `tokens_out` | integer | yes | from the provider's usage report |
| `cost_usd` | numeric(16,10) | yes | as reported by the provider (OpenRouter); null otherwise |
| `latency_ms` | integer | no | |
| `success` | boolean | no | |
| `error_code` | varchar(64) | yes | HTTP status or exception type when it failed |
| `created_at` | timestamptz | no | `now()` |

Indexes: `(user_id, created_at)`; `created_at`.

### `answer_feedback`

| Column | Type | Null | Default / notes |
| ------ | ---- | ---- | --------------- |
| `id` | uuid | no | PK |
| `user_id` | uuid | no | FK `users`, cascade |
| `question_hash` | varchar(64) | no | SHA-256 of the normalised question; the text isn't stored |
| `answer_mode` | varchar(16) | no | the answer's mode (`memory`, `general`, `mixed`; `instant`/`ai` from S6) |
| `rating` | smallint | no | `1` or `-1` (check constraint) |
| `comment` | text | yes | at most 1000 characters (check constraint) |
| `source_chunk_ids` | uuid[] | no | `{}`; cited chunks, no foreign key (a deleted memory keeps the rating) |
| `created_at` | timestamptz | no | `now()` |

Indexes: `(user_id, created_at)`.

---

## Migrations

Applied in this order (`down_revision` chain):

| Revision | File | Change |
| -------- | ---- | ------ |
| `001_initial_auth` | `001_initial_auth.py` | `users`, `sessions`, `refresh_tokens`, `user_profiles` |
| `002_memory_items` | `002_memory_items.py` | `memory_items`, enums |
| `003_user_source_preferences` | `003_user_source_preferences.py` | `user_profiles.source_preferences`, onboarding |
| `004_memory_chunks` | `004_memory_chunks.py` | `memory_chunks` |
| `005_chunk_embeddings` | `005_chunk_embeddings.py` | `embedding vector(1536)` + HNSW index |
| `cbb1d84cf989` | `20260814_cbb1d84cf989_capture_v2_schema_enhancements.py` | Capture v2 fields on `memory_items` |
| `006_rag_v2_chunks` | `006_rag_v2_chunks.py` | `start_sec`, `end_sec`, `embedding_model`, generated tsvectors + GIN indexes |
| `007_usage_and_feedback` | `007_usage_and_feedback.py` | `llm_usage`, `answer_feedback` |
| `008_local_embeddings` | `008_local_embeddings.py` | `memory_chunks.embedding_local vector(768)` + HNSW cosine index (**head**) |

Commands (from the repo root):

```bash
cd backend && .venv\Scripts\alembic upgrade head      # Windows
cd backend && .venv/bin/alembic upgrade head          # Mac / Linux
node scripts/run-python.mjs -m alembic current        # where a database is
```

## Changing the schema

1. Add the change to `REBUILD_PLAN.md` section 7 first (owner approval).
2. Change the model in `backend/app/models/` and write an Alembic migration with
   a working `downgrade()`. Name it `NNN_short_name.py` and chain it after the
   current head.
3. Test `upgrade head` and `downgrade -1` on a copy of real data.
4. Update this file in the same commit.

## Rules

- Every query on user data filters by `user_id` (and excludes `deleted_at`
  rows where relevant).
- Never store secrets in plain text: passwords are bcrypt hashes, refresh tokens
  are stored as hashes.
- Vector dimensions are fixed by the column; changing the embedding model's
  dimension needs a migration and a re-embed (REBUILD_PLAN S3).
