## What and why

<!-- One or two sentences. Link the issue: "Closes #123". -->

## Stage

<!-- The rebuild stage this belongs to (S0–S10), from docs/REBUILD_PLAN.md. One stage per PR. -->
Stage: S

## Changes

-

## Checklist

- [ ] Follows `docs/REBUILD_PLAN.md` for this stage; no endpoint, table, column or setting outside sections 7–9
- [ ] API change: `docs/API.md` and `docs/api/openapi.json` updated (`npm run docs:api`)
- [ ] Schema change: Alembic migration plus `docs/DATABASE.md` updated
- [ ] New setting: added to the root `.env.example` and the plan's section 9
- [ ] Tests added or updated; `npm run lint`, `npm run typecheck` and `npm run test` pass locally
- [ ] `docs/TASKS.md` updated if a stage item is done
- [ ] No secrets, keys or personal data in code, logs, screenshots or this description

## How to check it

<!-- Steps a reviewer can follow, or screenshots for UI changes. -->
