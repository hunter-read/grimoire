# Grimoire E2E (Selenium)

Browser-level integration tests that drive a real Grimoire instance through a
real browser. This directory is deliberately self-contained — its own
dependencies, its own pytest config, no imports from `backend/` — so it can be
lifted into a separate repository later without changes.

## Quick start

```bash
pip3 install -r requirements.txt

# Everything in one command: starts a throwaway backend on its own port with a
# temporary DATA_PATH/LIBRARY_PATH, seeds a sample book, runs the suite, cleans up.
./scripts/run_local.sh

# Anything after the script name goes to pytest:
./scripts/run_local.sh -m smoke
./scripts/run_local.sh -k login -vv
```

Requires the frontend build to exist (`cd ../frontend && npm run build`) — the
backend serves the SPA from `frontend/dist/`.

Against an already-running instance instead:

```bash
GRIMOIRE_BASE_URL=http://localhost:9481 python3 -m pytest
```

No driver install is needed: Selenium Manager downloads and caches a matching
chromedriver/geckodriver automatically.

## Configuration

Every setting is an environment variable, so the same suite runs locally today
and against a deployed environment later.

| Variable | Default | Meaning |
| --- | --- | --- |
| `GRIMOIRE_BASE_URL` | `http://localhost:9481` | Instance under test |
| `GRIMOIRE_BROWSER` | `chrome` | `chrome` or `firefox` |
| `GRIMOIRE_HEADLESS` | `1` | `0` to watch the browser work |
| `GRIMOIRE_REMOTE_URL` | – | Selenium Grid endpoint; empty runs locally |
| `GRIMOIRE_TIMEOUT` | `15` | Seconds for ordinary explicit waits |
| `GRIMOIRE_SLOW_TIMEOUT` | `60` | Budget for slow work (cold PDF page render) |
| `GRIMOIRE_ADMIN_USER` | `e2e_admin` | Admin account the suite uses |
| `GRIMOIRE_ADMIN_PASSWORD` | `e2e-password-123` | …and its password |
| `GRIMOIRE_ARTIFACT_DIR` | `artifacts` | Where failure screenshots land |
| `GRIMOIRE_ALLOW_DESTRUCTIVE` | `1` | `0` skips tests that create/delete data |

A few flags are also available as pytest options: `--base-url`, `--browser`,
`--headed`.

## Layout

```
e2e/
├── conftest.py            fixtures, failure artifacts, server readiness check
├── pytest.ini             markers + rootdir
├── grimoire_e2e/
│   ├── config.py          environment-driven settings
│   ├── driver.py          WebDriver construction
│   ├── api.py             HTTP client — fixture setup/teardown only
│   ├── session.py         authenticating a browser without the login form
│   ├── waits.py           explicit-wait helpers
│   └── pages/             page objects, one per screen
├── scripts/
│   ├── run_local.sh       throwaway server + seed + run
│   └── seed_library.py    write a sample PDF and index it
└── tests/                 the tests themselves
```

## Conventions

**Page objects hold locators and interactions, never assertions.** Tests assert.
A markup change is then a one-line fix in `pages/` rather than an edit spread
across every test that touched the screen.

**The API client is for setup and teardown only.** If a test verifies behaviour
through `ApiClient` it is not testing the browser any more. Use it to create the
users and fixtures a test needs, then assert on what the UI shows.

**Always wait for a condition, never sleep.** Helpers live in `waits.py`. There
is deliberately no implicit wait configured — it slows every explicit wait and
makes "this element is absent" assertions take the full timeout.

**Prefer stable selectors,** in this order: `data-testid` (about 20 components
already have one), then `id` (the auth forms have `login-username`,
`setup-password`, and friends), then a route-based selector such as
`a[href^="/library/book/"]`. Avoid matching on visible text — the UI is
translated into EN/DE/FR, so text selectors break under a different locale.

**Content-dependent tests skip rather than fail** when the target library is
empty, so the suite stays meaningful against both a seeded box and a bare one.
Run `scripts/seed_library.py` to give them something to work with.

## Things worth knowing

These were found the hard way while building the suite; they will bite again.

- **Auth endpoints are rate-limited** to `10/minute` by default
  (`AUTH_RATE_LIMIT`). Tests that log in through the real form trip this
  part-way through a full run and fail with 429s that look like app bugs.
  Only the auth tests use the form; everything else takes a session token from
  the API and injects it. `run_local.sh` also raises the limit on its server.
- **The token must be injected before the SPA ever boots.** `AuthContext` runs
  on mount and calls `localStorage.removeItem` when it finds no valid token. Any
  sequence that loads the app first and writes the token second races that
  cleanup — and loses maybe one run in three, presenting as a login screen where
  the app shell was expected. `session.authenticate` therefore navigates to
  `/favicon.ico` first (same origin, not an HTML document, so no bundle runs),
  writes the token there, and also registers it as a document-start script.
- **The catch-all serves `index.html` for unknown paths, including unknown
  `/api/*` ones.** So there is no convenient "404 that isn't the app" — reaching
  for one is what made the first attempt at the fix above still flaky. Use a
  real static asset.
- **A background library scan starts on boot** (see the `lifespan` handler).
  Triggering a second scan while it runs puts both in contention for SQLite's
  single writer. `seed_library.py` waits for the startup scan before rescanning,
  and `run_local.sh` waits for quiescence before starting pytest.
- **Auth resolution is asynchronous.** `status` starts at `'loading'` while the
  app fetches `/api/auth/status` and `/api/auth/me`, so checking the DOM
  immediately after `driver.get` finds neither the login form nor the app shell.
  Wait for whichever you expect.
- **The library layout needs a collection directory.** The scanner expects
  `<collection>/<GameSystem>/<Category>/<Book>.pdf` where the top level is one
  of `books`, `maps`, `tokens`, `audio`. A PDF one level up is silently ignored.
- **`GET /api/books` returns `{total, books}`,** not a bare list — and the
  wrapper is truthy when empty, so check `books`, not the response.

## Failure artifacts

When a test fails the browser is captured before it closes: a screenshot, the
page source, and the browser console log, written to `artifacts/` and named
after the test. The console log is usually the fastest route to the cause — the
rate-limit and token-wipe issues above were both diagnosed straight from it.

## Scope

This is a scaffold: it covers smoke, auth, library browsing, and admin/role
boundaries, and establishes the patterns for the rest. Substantial areas not yet
covered include campaigns, maps, tokens, audio, search, tags, favorites,
bookmarks, file management, duplicates, OPDS, add-ons, and OIDC login.
