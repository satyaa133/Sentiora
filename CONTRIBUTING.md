# Contributing

See `README.md` for local setup and running the app.

## Git Workflow

- Branch from `main`: `feat/`, `fix/`, `refactor/`, `docs/`, `chore/`
- Commit style: `feat: add memory CRUD endpoints` (Conventional Commits)
- Keep PRs focused — one feature or fix per PR
- Run `npm run lint:*`, `npm run typecheck:*`, and `npm run test:*` before pushing

## Rules

- Read `docs/PROMPT_GUIDE.md` before writing any code
- Never invent API endpoints — all contracts are in `docs/05_API_Specification_v1.0.pdf`
- Never change DB schema without an Alembic migration
- No `console.log` or debug `print()` left in committed code
- Update `docs/TASKS.md` when a phase milestone is completed
