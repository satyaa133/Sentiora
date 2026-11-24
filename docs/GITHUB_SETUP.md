# GitHub repository setup

How the Sentiora repository is run, and the settings only a repository admin
can change. The files (templates, CODEOWNERS, Dependabot, SECURITY.md) are in
the repo; the settings below are not, so an admin applies them once.

## How work flows

1. Pick or open an issue (Bug or Task form). Give it its `stage:` label and milestone.
2. Branch from `main`: `feat/…`, `fix/…`, `docs/…`, `chore/…`, `test/…`.
3. Open a pull request. The template's checklist must be honest; CODEOWNERS
   requests the reviewers.
4. CI (`validate`) must be green and one code owner must approve.
5. Squash-merge. The branch is deleted automatically.

Nobody pushes to `main` directly, admins included.

## Labels and milestones

| Label | Use |
|---|---|
| `stage:S8`, `stage:S9`, `stage:S10` | The rebuild stage the work belongs to |
| `type: bug`, `type: task`, `type: security`, `type: docs` | What kind of work |
| `area: backend`, `area: web`, `area: extension`, `area: ci` | Where the change lands |
| `priority: high` | Blocks the current stage |
| `dependencies` | Dependabot updates |
| `parked` | Agreed to wait (for example OTP email verification, until launch planning) |

One milestone per open stage (S8, S9, S10). A stage is done when its milestone
is empty and the owner has approved it in `docs/TASKS.md`.

## Admin settings (repository owner)

### 1. Make the repository private

Settings → General → Danger Zone → **Change visibility** → Private.

**Plan note:** on GitHub Free, branch protection and rulesets do **not** work
on private repositories. To keep step 2 after going private, the owner needs
GitHub Pro (personal account) or the repo moves to an organisation on the Team
plan. Without either, keep the rules in "How work flows" by agreement.

### 2. Protect `main`

Settings → Rules → Rulesets → **New branch ruleset**:

- Name `main`, Enforcement **Active**, target the default branch
- No bypass list (rules apply to admins too)
- Restrict deletions; block force pushes
- Require a pull request before merging: 1 approval, dismiss stale approvals
  on new commits, require review from Code Owners, require conversation resolution
- Require status checks to pass: `validate`; require branches to be up to date
- Require linear history (squash merges keep `main` readable)

### 3. Merge settings

Settings → General → Pull Requests:

- Allow squash merging only (turn off merge commits and rebase merging)
- Default squash message: pull request title and description
- **Automatically delete head branches**: on

### 4. Security

Settings → Code security:

- Dependabot alerts: on
- Dependabot security updates: on
- Secret scanning and push protection: on where the plan allows it

### 5. Collaborators

Settings → Collaborators: give each developer **Write**. Keep **Admin** to the owner.
