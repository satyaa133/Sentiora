# Security policy

Sentiora stores what people read, so security problems are taken seriously.

## Reporting a problem

Don't open a public issue, pull request or discussion for a security problem.

Report it privately to a maintainer (@Vansh2802 or @satyaa133) by direct
message. Include:

- what the problem is and what an attacker could do with it
- steps to reproduce, or a proof of concept
- the branch or commit you tested

We aim to reply within 3 working days and to fix confirmed problems before
anything about them is made public.

## What counts

- One user reading or changing another user's saves, answers, cache entries or account
- Getting around sign-in, rate limits or account deletion
- Text inside a saved page changing what Ask does (prompt injection)
- Keys, tokens or personal data in logs, builds, the extension bundle or the repository
- The extension capturing pages it should skip (banking, health, sign-in pages)

## Supported versions

Only `main` is supported until the first public release.

## For contributors

- Never commit `.env`, `.env.local` or any real key. Personal credentials go in `.env.local`.
- Never put a secret in a `VITE_*` variable: those are built into the browser and extension bundles.
- `npm run check:secrets` runs in CI after the build and fails if a provider key or URL reaches a client bundle.
