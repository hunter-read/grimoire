# CI/CD Pipelines

Grimoire uses four GitHub Actions workflows (in [`.github/workflows/`](../.github/workflows/)).
Docker images are published to Docker Hub at `hunterreadca/grimoire`.

The branch model is: feature branches → `dev` (integration) → `main` (stable). Releases are
cut by pushing a version tag.

---

## Workflows at a glance

| Workflow | File | Trigger | Produces |
|---|---|---|---|
| **CI** | [`ci.yml`](../.github/workflows/ci.yml) | Push to `main`/`dev`, and pull requests | Lint + test + coverage validation (no image) |
| **CodeQL** | [`codeql.yml`](../.github/workflows/codeql.yml) | Push to `main`, PRs to `main`/`dev`, weekly cron | Security analysis (Python + JS/TS) |
| **Edge** | [`edge.yml`](../.github/workflows/edge.yml) | After CI succeeds on a `dev` push | `:edge` multi-arch Docker image |
| **Release** | [`release.yml`](../.github/workflows/release.yml) | Push a `vX.Y.Z` tag | Versioned + `:latest` images (OCR & slim) + GitHub Release |

---

## CI (`ci.yml`)

Runs on every push to `main`/`dev` and on all pull requests. Validates the change without
publishing anything. Two jobs run in parallel:

**Frontend (`frontend/`):**
- `npm run format:check` — Prettier formatting
- `npm run lint` — ESLint (errors fail CI)
- `npm run test:coverage` — Vitest with coverage
- `npm run build` — production build (catches broken imports / JSX errors)

**Backend:**
- `ruff check backend/` — lint
- `python -c "import backend.main"` — import smoke check
- `pytest` with coverage

**Per-changed-file coverage gate (PRs only):** on pull requests, each job additionally runs
the coverage check (`npm run coverage:check` / `backend/scripts/check_coverage.py`), which
diffs against the PR base branch and fails if any new or touched source file is below 80%
line coverage. See [CLAUDE.md](../CLAUDE.md#testing-conventions) for details.

### Coverage badges

On **push to `main` only**, each job extracts its total line-coverage % (frontend from
`coverage/coverage-summary.json`, backend from coverage.py's `coverage.json`) and publishes it
to a [Shields.io endpoint](https://shields.io/badges/endpoint-badge) badge stored in a GitHub
Gist via [`schneegans/dynamic-badges-action`](https://github.com/schneegans/dynamic-badges-action).
No third-party service ingests the code — the badge JSON lives in a gist you own. The badges
render in the [README](../README.md) badge row.

**One-time setup** (already done for this repo; documented for forks):

1. Create a **public** GitHub Gist with two files:
   `grimoire-backend-coverage.json` and `grimoire-frontend-coverage.json` (any placeholder
   contents). The gist ID is the hash in its URL.
2. Create a [personal access token](https://github.com/settings/tokens) with **only** the
   `gist` scope and add it as the repo secret **`GIST_SECRET`**.
3. Add the gist ID as two repo **variables** (Settings → Secrets and variables → Actions →
   Variables): **`BACKEND_COVERAGE_GIST_ID`** and **`FRONTEND_COVERAGE_GIST_ID`** (both may be
   the same gist).
4. In the [README](../README.md), replace the `BACKEND_COVERAGE_GIST_ID` /
   `FRONTEND_COVERAGE_GIST_ID` placeholders in the two coverage-badge URLs with the gist ID.

### Note: the `dev → main` PR runs once, not twice

A direct push to `dev` while the `dev → main` pull request is open would normally make CI run
twice for the same commit — once for the `push` event and once for the `pull_request` event.
To avoid that (and the duplicate downstream **Edge** build it caused), both CI jobs are
guarded to skip the `pull_request` run when the PR's head branch is `dev`:

```yaml
if: >-
  github.event_name != 'pull_request' ||
  github.event.pull_request.head.ref != 'dev'
```

The `push` run on `dev` already covers that commit, so nothing is lost.

---

## CodeQL (`codeql.yml`)

GitHub's static security analysis, run against both languages in the repo (Python and
JavaScript/TypeScript) with the `security-extended` query pack. It runs on pushes to `main`,
on pull requests targeting `main` or `dev`, and on a weekly schedule (Mondays at 08:00 UTC).
Findings surface in the repository's **Security → Code scanning** tab. No action is needed
unless it flags something.

---

## Edge (`edge.yml`)

Builds a multi-arch **edge** image from the `dev` branch so the latest integration build is
always pullable. It's triggered by a `workflow_run` event when **CI** completes, and only
runs when:

- CI concluded `success`, **and**
- the CI run's head branch was `dev`, **and**
- the CI run's triggering event was `push`.

**What it produces:**
- `hunterreadca/grimoire:edge` — multi-arch (`linux/amd64`, `linux/arm64/v8`), built from the
  Dockerfile's `ocr` target (bundles Tesseract OCR).

Built with `APP_VERSION=edge` and the triggering commit SHA. Uses the GitHub Actions build
cache (`type=gha`) to keep rebuilds fast.

> **Edge is unstable.** It tracks `dev` and can change or break at any time — use it only for
> testing upcoming changes, not for a production deployment.

---

## Release (`release.yml`)

Cuts a stable release. Triggered by pushing a semver tag matching `v[0-9]+.[0-9]+.[0-9]+`.

### How to cut a release

```bash
git checkout main
git pull
git tag v1.5.0        # must match vX.Y.Z
git push origin v1.5.0
```

Pushing the tag is the entire trigger — there are no manual workflow inputs.

### What it does

The tag `v1.5.0` is parsed into `version=1.5.0`, `minor=1.5`, and `major=1`, then the workflow
builds and pushes **two** multi-arch image variants (`linux/amd64`, `linux/arm64/v8`):

**OCR (default) — Dockerfile `ocr` target, bundles Tesseract:**
- `hunterreadca/grimoire:latest`
- `hunterreadca/grimoire:1`
- `hunterreadca/grimoire:1.5`
- `hunterreadca/grimoire:1.5.0`

**Slim — Dockerfile `slim` target, no OCR engine, smaller image:**
- `hunterreadca/grimoire:slim`
- `hunterreadca/grimoire:1-slim`
- `hunterreadca/grimoire:1.5-slim`
- `hunterreadca/grimoire:1.5.0-slim`

Finally it creates a **GitHub Release** for the tag with auto-generated release notes (from
merged PRs and commits since the last release).

See [OCR](../README.md#ocr) for the difference between the OCR and slim variants.

### To pull a specific release

```bash
docker pull hunterreadca/grimoire:1.5.0        # or :1.5, :1, :latest
docker pull hunterreadca/grimoire:1.5.0-slim   # slim variant
```

---

## Versioning convention

Grimoire follows [Semantic Versioning](https://semver.org/):

- **PATCH** (`x.y.Z`) — bug fixes, dependency bumps, small tweaks
- **MINOR** (`x.Y.0`) — new features, backwards-compatible
- **MAJOR** (`X.0.0`) — breaking changes (config format, API, data migration required)

The rolling `major` (`:1`) and `minor` (`:1.5`) tags let deployments pin to a compatibility
level and still pick up patch updates. Because schema migrations run automatically on startup
([Alembic](https://alembic.sqlalchemy.org/)), always back up `DATA_PATH` before upgrading.
