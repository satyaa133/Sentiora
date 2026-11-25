# Contributing

See `README.md` for local setup and running the app.

## Git Workflow

- Branch from `main`: `feat/`, `fix/`, `refactor/`, `docs/`, `chore/`
- Commit style: `feat: add memory CRUD endpoints` (Conventional Commits)
- Keep PRs focused — one feature or fix per PR
- Run `npm run lint:*`, `npm run typecheck:*`, and `npm run test:*` before pushing
- Never push to `main`: open a pull request, fill in its checklist, get green CI
  and one code owner's approval, then squash-merge
- Label issues and PRs with their stage (`stage:S9`) and add them to the stage milestone
- The full workflow, labels and admin settings are in `docs/GITHUB_SETUP.md`;
  security problems go through `SECURITY.md`, never a public issue

## Rules

- Read `docs/REBUILD_PLAN.md` and `docs/PROMPT_GUIDE.md` before writing any code
- Never invent API endpoints: the contract is `docs/API.md` and `docs/api/openapi.json`; new endpoints come only from `docs/REBUILD_PLAN.md` section 8. Run `npm run docs:api` after any API change
- Never change DB schema without an Alembic migration and an update to `docs/DATABASE.md`
- No `console.log` or debug `print()` left in committed code
- Update `docs/TASKS.md` when a phase milestone is completed
