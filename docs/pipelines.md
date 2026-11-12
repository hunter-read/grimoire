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
| **Test order** | [`test-order.yml`](../.github/workflows/test-order.yml) | Daily at 06:00 UTC (or manually), off `main` | Backend suite run serially and on two workers, on SQLite and PostgreSQL 15 and 18 (nothing published) |
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
  `npm run typescript:check` (fails if there is a `.js`/`.jsx` file anywhere under
  `src/`, which is all TypeScript), and `npm run build` (catches broken imports / JSX errors).
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

**Backend** is split the same way:
- **Backend lint + types:** `ruff check backend/`, `python -c "import backend.main"` (an
  import smoke check) and `mypy backend/`.
- **Backend tests (database, 1/2 and 2/2):** the `pytest` suite on SQLite, on PostgreSQL 18
  and on PostgreSQL 15 (the newest and oldest supported, see [PostgreSQL](postgresql.md)),
  each cut in two with `--shard`, so six jobs run side by side. Each runs its half on four
  workers (`-n 4 --dist loadgroup`, pytest-xdist). The SQLite and PostgreSQL 18 jobs measure
  coverage, with `COVERAGE_CORE=sysmon` (Python 3.12's low-overhead tracing hook), and upload
  the `.coverage` data; PostgreSQL 15 only has to pass. The SQLite jobs also run the
  community add-on contract tests (below).
- **Backend lint + test:** the required check. It combines the four coverage data files
  (`coverage combine`) into the `coverage.json` one run of the whole suite on both databases
  writes - the coverage gate has to see the code that only runs on PostgreSQL too - then
  runs the gate. It always runs and fails if the lint job or any test job failed.

**How the suite is split.** The tests share one database and lean on what earlier files left
behind, so they are never handed out one file at a time. `conftest.py` cuts the files, in
their usual order, into contiguous slices - one per worker - and each slice runs exactly as
it would serially. `--shard I/N` cuts N times as many slices and keeps the I-th
worker-count of them, so CI's two jobs per database run slices 1-4 and 5-8. The worker
count is pinned, not `auto`, so the slices are the same on every run.

The slices are sized by time, not by test count: a few files (the migration tests, the ones
that start a second Python) take as long as a thousand ordinary tests.
[`backend/tests/timings.json`](../backend/tests/timings.json) lists what each file over a
second takes and the average for the rest. It only needs refreshing when the jobs drift
apart - a stale file makes the slices uneven, nothing worse:

```bash
python3 -m pytest backend/tests/ -n 4 --dist loadgroup --write-timings
```

Locally, `python3 -m pytest -n 4 --dist loadgroup` runs the whole suite on four workers, and
adding `--shard 1/2` runs exactly what CI's first job does.

**What keeps the suite quick.** Two things `conftest.py` does for every test, both of which
were most of the suite's time before:
- Passwords are hashed at bcrypt's lowest cost (`password_hash.DEFAULT_ROUNDS`). At the
  real cost every account created and every sign-in is a quarter of a second of CPU. The
  tests of the cost itself put the real one back.
- A book's text is read in-process rather than in the child process the app starts for it.
  Every full scan tries to index each placeholder book earlier tests left in the shared
  database, and a new Python apiece only to fail on a junk file added up to minutes. The
  stand-in turns a failure into the error a dead child raises, so books end up marked as
  before; the tests of the isolation itself call the real
  `backend.indexer._subprocess.extract_text_isolated`.

**On PostgreSQL** (`TEST_DATABASE_URL`, a `postgres:*-alpine` service container in CI) each
worker gets its own database, dropped and created afresh (`backend/tests/_postgres.py`).
Tests marked `sqlite_only` skip there, and `postgres_only` ones skip on SQLite. Locally:
`TEST_DATABASE_URL=postgresql://user:pw@localhost/postgres python3 -m pytest -n 4 --dist loadgroup`
(the user needs `CREATEDB`). A test that removes `DATABASE_URL` or `TEST_DATABASE_URL`
from the environment, or leaves the app engine on the other database, fails in teardown
and has them put back: the next `importlib.reload(backend.config)` would otherwise move
the rest of the run onto a SQLite file. Code that clears the real environment (the add-on
worker's credential scrub) runs under `patch.dict(os.environ)` in tests.


**Community add-on contract tests:** nearly 400 tests (more as add-ons are added, since many are parametrised over them) load the add-ons actually published in
[`grimoire-codex/community-add-ons`](https://github.com/grimoire-codex/community-add-ons)
(scrapers, character importers, sheets, content packs) and check them against this repo's
interpreter, manifest models, importer and sheet renderer. A change on either side can break
a published add-on without anything else failing, so the SQLite test jobs check that repo out
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

The PostgreSQL service containers in `ci.yml` and `test-order.yml` are pinned by digest, the
tag kept for readability (`postgres:18-alpine@sha256:...`), the same way the actions are pinned
by commit. Dependabot does not update images in workflow files, so move them by hand now and
then - when a PostgreSQL minor release comes out, say - in both files at once:

```bash
docker buildx imagetools inspect postgres:18-alpine --format '{{json .Manifest.Digest}}'
docker buildx imagetools inspect postgres:15-alpine --format '{{json .Manifest.Digest}}'
```

The Docker updates skip Python minor/major and Node major versions on purpose. The image has
to build and run on the same runtimes `ci.yml` tests with, so a runtime move is done by hand,
changing the `Dockerfile` and `ci.yml` in the same PR. Patch and digest bumps of those images,
and bumps of the other base images, still come through.

PyMuPDF 2 folded its layout analysis into the main package and names onnxruntime, numpy,
networkx and more as dependencies: about 135 MB of image for a feature Grimoire never calls.
Since 2.1 `import pymupdf` loads none of it unless it is used, so the `Dockerfile` installs
PyMuPDF on its own with `--no-deps` and deletes the layout package and its models; the image
smoke test fails if any of those packages turn up. A plain `pip install -r
backend/requirements.txt`, as CI and a source install run it, does bring them in, unused.
**When a PyMuPDF bump comes through, check the image build**: a release that starts importing
one of those packages for ordinary rendering or text extraction fails the Docker image job
(the build imports the app), not the unit tests, which have the packages installed.

Each PR runs the normal CI, including the per-changed-file coverage gate, so a green grouped
bump is usually safe to merge as is.

---

## Test order (`test-order.yml`)

Runs the backend suite on `main` serially and on two workers, every day at 06:00 UTC or on
demand. The backend tests share one database and one library folder, so a test can pass
only because of the tests that run before it. CI's split (`conftest.py` gives each worker
a contiguous run of files) fixes those predecessors, which can hide such a test
until a new file shifts the split and it fails on an unrelated PR. A serial run gives every
file all its predecessors, and two workers start the second half without its own.

Each split runs three times: on SQLite, and on PostgreSQL 15 and 18 (the oldest and newest
supported), since CI's PostgreSQL jobs only ever run CI's own split.

It is not a required check. A failure means an order-dependent test to fix: reproduce it
with the same split locally (`pytest backend/tests/ -n 2 --dist loadgroup`, or serially),
with `TEST_DATABASE_URL` set for a PostgreSQL leg.
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
