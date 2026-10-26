# CI/CD Pipelines

Grimoire uses four GitHub Actions workflows (in [`.github/workflows/`](../.github/workflows/)),
plus Dependabot for dependency updates.
Docker images are published to Docker Hub at `hunterreadca/grimoire` and mirrored, with the
same tags, to the GitHub Container Registry at `ghcr.io/hunter-read/grimoire`. Docker Hub
logs in with the `DOCKERHUB_USERNAME`/`DOCKERHUB_TOKEN` secrets; GHCR uses the workflow's
own `GITHUB_TOKEN` (the publishing jobs request `packages: write`), so it needs no secret.

The branch model is: feature branches off `main`, merged back into `main` by pull request.
`main` is what `:nightly` is built from, and releases are cut from it by pushing a version
tag. (Grimoire once integrated feature branches on a `dev` branch and merged `dev → main` for
releases; that flow is retired and the workflows no longer refer to it.)

---

## Workflows at a glance

| Workflow | File | Trigger | Produces |
|---|---|---|---|
| **CI** | [`ci.yml`](../.github/workflows/ci.yml) | Push to `main`, and pull requests | Lint + test + coverage validation, and a smoke test of both image targets (nothing published) |
| **CodeQL** | [`codeql.yml`](../.github/workflows/codeql.yml) | Push to `main`, PRs to `main`, weekly cron | Security analysis (Python + JS/TS) |
| **Test order** | [`test-order.yml`](../.github/workflows/test-order.yml) | Daily at 06:00 UTC (or manually), off `main` | Backend suite run serially and on two workers (nothing published) |
| **Nightly** | [`nightly.yml`](../.github/workflows/nightly.yml) | Daily at 07:00 UTC (or manually), off `main` | `:nightly` multi-arch Docker image |
| **Release** | [`release.yml`](../.github/workflows/release.yml) | Push a `vX.Y.Z` tag | Versioned + `:latest` images (OCR & slim) + GitHub Release |

---

## CI (`ci.yml`)

Runs on every push to `main` and on all pull requests. Validates the change without
publishing anything. The jobs run in parallel, and a newer push to the same PR cancels the
run in progress. Branch protection requires **Frontend build + test** and **Backend lint +
test**.

**Frontend (`frontend/`)** is split so the slow part runs in parallel:
- **Frontend lint + build:** `npm run format:check` (Prettier), `npm run lint` (ESLint;
  errors fail CI), `npm run typecheck` (`tsc` over `src/`, see [TypeScript](typescript.md)),
  `npm run typescript:check` (PRs only - the TypeScript ratchet: fails if the PR adds a
  `.js`/`.jsx` file under `src/`, or modifies a non-test one, so the JavaScript only
  shrinks), and `npm run build` (catches broken imports / JSX errors).
- **Frontend tests (1/3, 2/3, 3/3):** Vitest with coverage, a third of the test files each
  (`--shard`). Most of the suite's time is creating a jsdom environment per file, which
  spreads across runners where it can't within one. Each shard uploads a blob report.
- **Frontend build + test:** the required check. It merges the shards' blob reports
  (`vitest --merge-reports --coverage`), which rebuilds the same `coverage-summary.json` an
  unsharded run writes, then runs the coverage gate. It always
  runs and fails if the lint/build job or any shard failed, since a required check that was
  merely skipped would count as passing. On `main` it uploads the coverage summary for the
  [badge](#coverage-badges).

**API types up to date:** regenerates `frontend/src/api/schema.d.ts` from the backend's
OpenAPI schema (`npm run api:types:check`) and fails if the committed copy differs. A backend
change to a request or response shape therefore has to land with its frontend types, and the
frontend job's `tsc` checks the code against them. It installs both toolchains: Python
exports the schema from the app, Node turns it into TypeScript.

**Backend:**
- `ruff check backend/` - lint
- `python -c "import backend.main"` - import smoke check
- `pytest` with coverage, including the community add-on contract tests (below), on four
  workers (`-n 4 --dist loadgroup`, pytest-xdist). The tests share one database and lean on
  what earlier files left behind, so `conftest.py` gives each worker a contiguous run of test
  files in their usual order rather than handing them out one at a time: each slice runs
  exactly as it would serially. The worker count is pinned, not `auto`, so the slices are the
  same on every run. Coverage is measured with `COVERAGE_CORE=sysmon`, Python 3.12's
  low-overhead tracing hook. Locally, `python3 -m pytest -n 4 --dist loadgroup` does the same.

**Docker image (slim, ocr):** builds each image target (amd64, loaded rather than pushed,
layers cached in the GitHub Actions cache) and runs
[`backend/scripts/smoke_test_image.py`](../backend/scripts/smoke_test_image.py) against it.
That generates a tiny library (a PDF, a CBR and an image map, from the standard library
alone), starts the image on it with an empty `/data`, and checks through the API that it
comes up healthy as a non-root user, first-run setup works, the scan indexes everything, the
PDF is searchable and renders, thumbnails are made, and `unar`, `ffmpeg` and (OCR only)
`tesseract` run. It then makes `/data` root-owned, as an install upgraded from the old
root-run image has it, restarts, and checks the data is handed over. Every push to
`main` runs it; a PR does when it touches the Dockerfile, dependencies, backend code or
`ci.yml`. Not a required check, but it is the only one that builds `slim` before a release.
Run it locally with `python3 backend/scripts/smoke_test_image.py <image> --target slim|ocr`.

**Community add-on contract tests:** nearly 400 tests (more as add-ons are added, since many are parametrised over them) load the add-ons actually published in
[`grimoire-codex/community-add-ons`](https://github.com/grimoire-codex/community-add-ons)
(scrapers, character importers, sheets, content packs) and check them against this repo's
interpreter, manifest models, importer and sheet renderer. A change on either side can break
a published add-on without anything else failing, so the backend job checks that repo out
beside the code and points `COMMUNITY_ADDONS_PATH` at it.

The checkout is pinned to a commit (`ref:` on the "Check out community add-ons" step in
`ci.yml`) rather than following the community repo's `main`, because the tests run the
add-ons' scripts: CI runs a snapshot someone has looked at, not whatever was merged there
last. That also means a new or changed community add-on is only covered once the pin moves.
Bump it when the community repo has changes worth testing against, or in the same PR as a
Grimoire change that needs a matching add-on change:

1. Review what changed in `grimoire-codex/community-add-ons` since the pinned commit
   (`https://github.com/grimoire-codex/community-add-ons/compare/<pinned sha>...main`),
   scripts especially.
2. Take its current head:
   `git ls-remote https://github.com/grimoire-codex/community-add-ons refs/heads/main`.
3. Put that full 40-character SHA in the step's `ref:`. Dependabot does not track it.

[`backend/tests/test_workflow_structure.py`](../backend/tests/test_workflow_structure.py)
fails if a job that can read a repository secret also checks out another repository without
a full commit SHA, and if any job other than **Coverage badges** references a secret.

Locally the tests find a checkout at `../community-add-ons` (or wherever
`COMMUNITY_ADDONS_PATH` points) and skip without one, so cloning Grimoire alone still gives
a passing suite. CI also sets `REQUIRE_COMMUNITY_ADDONS=true`, which makes `conftest.py`
fail the run if any of them skipped for want of the checkout, so a missing checkout or a
file the community repo renamed can't quietly turn them back into skips. Each one carries
the `community_addons` pytest marker, so `pytest -m community_addons` runs just these. See
[`backend/tests/community_addons.py`](../backend/tests/community_addons.py).

**Per-changed-file coverage gate (PRs only):** on pull requests, each job additionally runs
the coverage check (`npm run coverage:check` / `backend/scripts/check_coverage.py`), which
diffs against the PR base branch and fails if any new or touched source file is below 80%
line coverage.

### Coverage badges

On **push to `main` only**, the **Frontend build + test** and **Backend lint + test** jobs
upload their coverage reports (frontend `coverage/coverage-summary.json`, backend coverage.py's
`coverage.json`) as workflow artifacts, and a separate **Coverage badges** job publishes them.
It reads the total line-coverage % from each and writes it to a
[Shields.io endpoint](https://shields.io/badges/endpoint-badge) badge stored in a GitHub Gist
via [`schneegans/dynamic-badges-action`](https://github.com/schneegans/dynamic-badges-action).
No third-party service ingests the code - the badge JSON lives in a gist you own. The badges
render in the [README](../README.md) badge row.

**Coverage badges** is the only CI job given `GIST_SECRET`. It checks nothing out and runs no
repository code - it downloads the two reports, takes one number from each and calls the badge
action - with an empty `permissions:` block, so the jobs that run the test suites (and the
community add-ons' scripts) never have the token. Each badge updates only when its own tests
passed, so a backend failure doesn't hold back the frontend badge.

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

---

## CodeQL (`codeql.yml`)

GitHub's static security analysis, run against both languages in the repo (Python and
JavaScript/TypeScript) with the `security-extended` query pack. It runs on pushes to `main`,
on pull requests targeting `main`, and on a weekly schedule (Mondays at 08:00 UTC).
Findings surface in the repository's **Security → Code scanning** tab. No action is needed
unless it flags something.

---

## Dependabot (`dependabot.yml`)

[`.github/dependabot.yml`](../.github/dependabot.yml) opens version-update PRs against `main`
for every ecosystem the repo pins. Security updates arrive on their own, whatever the schedule.

| Ecosystem | Where | Schedule | Grouping |
|---|---|---|---|
| pip | `backend/requirements.txt`, `requirements-test.txt` | Weekly | FastAPI, Starlette, Uvicorn and Pydantic in one `web-stack` PR; other minor and patch bumps in one PR; majors one PR each |
| npm | `frontend/` | Weekly | Minor and patch bumps in one PR; majors one PR each |
| GitHub Actions | `.github/workflows/` | Monthly | All actions in one PR |
| Docker | `Dockerfile` base images | Monthly | One PR per image |

The Docker updates skip Python minor/major and Node major versions on purpose. The image has
to build and run on the same runtimes `ci.yml` tests with, so a runtime move is done by hand,
changing the `Dockerfile` and `ci.yml` in the same PR. Patch and digest bumps of those images,
and bumps of the other base images, still come through.

PyMuPDF is held on 1.x. Version 2 makes onnxruntime, numpy, networkx and its layout packages
hard dependencies and loads the layout model on every `import fitz`, which adds about 120 MB
to every process that opens a PDF (the server and each render worker) and about 135 MB to the
image. 1.x minor and patch releases still come through. **Watch its security advisories by
hand:** a PyMuPDF or MuPDF advisory still raises a Dependabot alert, but a fix released only
on 2.x gets no PR, because the ignore applies to security updates too. Check the alert and
decide whether to take 2.x then (and how to keep the layout model out), rather than letting it
sit. Lift the ignore if a later release makes the layout packages optional again.

Each PR runs the normal CI, including the per-changed-file coverage gate, so a green grouped
bump is usually safe to merge as is.

---

## Test order (`test-order.yml`)

Runs the backend suite on `main` serially and on two workers, every day at 06:00 UTC or on
demand. The backend tests share one database and one library folder, so a test can pass
only because of the tests that run before it. CI's four-worker split (`conftest.py` gives
each worker a contiguous run of files) fixes those predecessors, which can hide such a test
until a new file shifts the split and it fails on an unrelated PR. A serial run gives every
file all its predecessors, and two workers start the second half without its own.

It is not a required check. A failure means an order-dependent test to fix: reproduce it
with the same split locally (`pytest backend/tests/ -n 2 --dist loadgroup`, or serially).
The community add-on contract tests skip here, since CI already runs them on every PR.

---

## Nightly (`nightly.yml`)

Builds a multi-arch **nightly** image from `main` on a daily schedule (07:00 UTC), so the
latest stable branch is always pullable without cutting a release. Also runnable on demand
via **workflow_dispatch** - useful to re-cut the tag after a hotfix rather than waiting for
the next window.

**Skips when nothing changed.** Before building, the workflow compares `main`'s HEAD SHA
against the `org.opencontainers.image.revision` label on the `:nightly` image already in the
registry (Docker Hub - both registries receive the same push). If they match, the run exits early instead of republishing an identical image. A
missing tag (the first run) or an unreadable label falls through to building, so the check
can never wedge the pipeline shut. The manual `force` input overrides the skip.

**What it produces:**
- `hunterreadca/grimoire:nightly` and `ghcr.io/hunter-read/grimoire:nightly` - multi-arch (`linux/amd64`, `linux/arm64/v8`), built from
  the Dockerfile's `ocr` target (bundles Tesseract OCR).

Built with `APP_VERSION=nightly` and the commit SHA (recorded both as `COMMIT_HASH` and as
the OCI revision label the skip check reads back). Uses the GitHub Actions build cache
(`type=gha`) to keep rebuilds fast.

> **Nightly is not a release.** It tracks `main` between version tags - fine for testing
> what's landed, but pin a versioned tag for a production deployment.

> **Note:** GitHub's scheduled triggers are best-effort and can run late under load. Nothing
> downstream depends on the exact minute.

---

## Release (`release.yml`)

Cuts a stable release. Triggered by pushing a semver tag matching `v[0-9]+.[0-9]+.[0-9]+`.

### Release checklist

1. **Check `README.md` and `docs/` describe what is shipping.** User-facing docs are
   written in the same PR as the feature, so this is a review rather than a rewrite: skim
   the changes going out and confirm nothing landed undocumented, and that nothing
   documents a feature that slipped the release.
2. **Commit and push** any docs change to `main`.
3. **Tag `main`:**
   ```bash
   git checkout main
   git pull
   git tag v1.5.0        # must match vX.Y.Z
   git push origin v1.5.0
   ```
   Pushing the tag is the entire trigger - there are no manual workflow inputs.
4. **Tidy the release notes** once the workflow finishes. They are auto-generated from
   commits, so expect to reword a few lines.
5. **Publish the docs site** - push the accumulated local changes in the `docs/` repo for
   the new version.
6. **Announce on Discord.**

Steps 1-3 gate the release; 4-6 follow it.

### What it does

The tag `v1.5.0` is parsed into `version=1.5.0`, `minor=1.5`, and `major=1`, then the workflow
builds and pushes **two** multi-arch image variants (`linux/amd64`, `linux/arm64/v8`):

**OCR (default) - Dockerfile `ocr` target, bundles Tesseract:**
- `hunterreadca/grimoire:latest`
- `hunterreadca/grimoire:1`
- `hunterreadca/grimoire:1.5`
- `hunterreadca/grimoire:1.5.0`

**Slim - Dockerfile `slim` target, no OCR engine, smaller image:**
- `hunterreadca/grimoire:slim`
- `hunterreadca/grimoire:1-slim`
- `hunterreadca/grimoire:1.5-slim`
- `hunterreadca/grimoire:1.5.0-slim`

Every tag above is pushed to `ghcr.io/hunter-read/grimoire` as well, in the same
`docker/build-push-action` step, so the two registries always carry identical images.

Finally it creates a **GitHub Release** for the tag with auto-generated release notes (from
merged PRs and commits since the last release).

See [OCR](performance.md#ocr) for the difference between the OCR and slim variants.

### To pull a specific release

```bash
docker pull hunterreadca/grimoire:1.5.0        # or :1.5, :1, :latest
docker pull hunterreadca/grimoire:1.5.0-slim   # slim variant
docker pull ghcr.io/hunter-read/grimoire:1.5.0 # same image from GHCR
```

---

## Versioning convention

Grimoire follows [Semantic Versioning](https://semver.org/):

- **PATCH** (`x.y.Z`) - bug fixes, dependency bumps, small tweaks
- **MINOR** (`x.Y.0`) - new features, backwards-compatible
- **MAJOR** (`X.0.0`) - breaking changes (config format, API, data migration required)

The rolling `major` (`:1`) and `minor` (`:1.5`) tags let deployments pin to a compatibility
level and still pick up patch updates. Because schema migrations run automatically on startup
([Alembic](https://alembic.sqlalchemy.org/)), always back up `DATA_PATH` before upgrading.
