"""Establishing an authenticated browser session without the login form.

The backend rate-limits the auth endpoints (`AUTH_RATE_LIMIT`, default
`10/minute`), so a suite where every test types into the login form starts
getting 429s part-way through a run — a failure that has nothing to do with the
behaviour under test.

Tests that are *about* logging in should still drive the real form (see
`tests/test_auth.py`). Everything else just needs to arrive authenticated, and
uses `authenticate` below: it mints a token over the API once per session and
injects it into `localStorage`, which is exactly where AuthContext looks.
"""
from __future__ import annotations

from selenium.webdriver.remote.webdriver import WebDriver

from .config import Settings

#: Where AuthContext persists the JWT (frontend/src/context/AuthContext.jsx).
TOKEN_KEY = "grimoire_token"


def authenticate(driver: WebDriver, settings: Settings, token: str, landing: str = "/") -> None:
    """Put `token` in localStorage and land on `landing`, authenticated.

    Two things make this fiddlier than one `setItem` call:

    * localStorage is origin-scoped, so nothing can be written to it until the
      browser is on the app's origin.
    * AuthContext boots on mount and calls `localStorage.removeItem` when it
      finds no usable token. Any approach that lets the SPA boot before the
      token is in place races that cleanup, and loses intermittently.

    So the first navigation is to a static asset (`/favicon.ico`). It is on the
    app's origin but is not an HTML document, so the SPA bundle never runs and
    cannot clear the key. Note the server's catch-all serves index.html for
    unknown paths — including unknown `/api/*` ones — so a 404-ish URL would
    boot the app and reintroduce the race. The write is also registered as a
    document-start script, so it is in place before page scripts on the real
    navigation that follows.
    """
    script = "try { window.localStorage.setItem(%r, %r); } catch (e) {}" % (TOKEN_KEY, token)

    # A static asset: same origin, not an HTML document, so nothing can clear
    # the key between this navigation and the write below.
    driver.get(f"{settings.base_url}/favicon.ico")
    driver.execute_script(script)
    _add_startup_script(driver, script)

    driver.get(settings.url(landing))


def _add_startup_script(driver: WebDriver, script: str) -> None:
    """Run `script` before page scripts on each load, when the driver allows it.

    Chrome exposes this through CDP; Selenium's cross-browser `script` API is
    the fallback. Neither is fatal if unavailable — the plain `execute_script`
    write in `authenticate` still covers browsers without either.
    """
    try:
        driver.execute_cdp_cmd(  # type: ignore[attr-defined]
            "Page.addScriptToEvaluateOnNewDocument", {"source": script}
        )
        return
    except Exception:  # noqa: BLE001 - not Chrome, or CDP unavailable
        pass
    try:
        driver.script.pin(script)  # type: ignore[attr-defined]
    except Exception:  # noqa: BLE001 - older Selenium or unsupported browser
        pass


def clear_session(driver: WebDriver, settings: Settings) -> None:
    """Drop any stored credentials, returning the browser to logged-out."""
    driver.get(settings.url("/"))
    driver.execute_script("window.localStorage.clear(); window.sessionStorage.clear();")
