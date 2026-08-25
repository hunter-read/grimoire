"""Shared fixtures for the Selenium suite."""
from __future__ import annotations

import os
import pathlib
from typing import Iterator

import pytest
import requests
from selenium.webdriver.remote.webdriver import WebDriver

from grimoire_e2e import ApiClient, admin_client, create_driver
from grimoire_e2e.config import Settings
from grimoire_e2e.pages import LoginPage, SetupPage
from grimoire_e2e.session import authenticate, clear_session


# --------------------------------------------------------------------------
# CLI options — env vars stay the primary interface; these are conveniences.
# --------------------------------------------------------------------------


def pytest_addoption(parser: pytest.Parser) -> None:
    group = parser.getgroup("grimoire-e2e")
    group.addoption("--base-url", default=None, help="Grimoire base URL to test against")
    group.addoption("--browser", default=None, help="chrome (default) or firefox")
    group.addoption(
        "--headed",
        action="store_true",
        default=False,
        help="Run with a visible browser window (default is headless)",
    )


@pytest.fixture(scope="session")
def settings(request: pytest.FixtureRequest) -> Settings:
    """Run settings, with CLI flags overriding the environment."""
    if request.config.getoption("--base-url"):
        os.environ["GRIMOIRE_BASE_URL"] = request.config.getoption("--base-url")
    if request.config.getoption("--browser"):
        os.environ["GRIMOIRE_BROWSER"] = request.config.getoption("--browser")
    if request.config.getoption("--headed"):
        os.environ["GRIMOIRE_HEADLESS"] = "0"

    # Settings snapshot the environment at construction, so rebuild after the
    # overrides above rather than using the import-time instance.
    return Settings()


# --------------------------------------------------------------------------
# Server readiness
# --------------------------------------------------------------------------


@pytest.fixture(scope="session", autouse=True)
def require_server(settings: Settings) -> None:
    """Fail the whole run immediately if nothing is serving the base URL.

    Without this, an unreachable server produces one timeout per test and a
    wall of misleading element-not-found errors.
    """
    try:
        resp = requests.get(f"{settings.api_url}/health", timeout=10)
        resp.raise_for_status()
    except Exception as exc:  # noqa: BLE001 - reported verbatim to the user
        pytest.exit(
            f"No Grimoire server at {settings.base_url} ({exc}).\n"
            "Start one with:  uvicorn backend.main:app --port 9481\n"
            "or point the suite elsewhere with GRIMOIRE_BASE_URL / --base-url.",
            returncode=3,
        )


# --------------------------------------------------------------------------
# API-level fixtures (setup/teardown only — assertions belong in the browser)
# --------------------------------------------------------------------------


@pytest.fixture(scope="session")
def api(settings: Settings) -> ApiClient:
    """Admin-authenticated API client, bootstrapping the instance if needed."""
    return admin_client(settings)


@pytest.fixture(scope="session")
def admin_credentials(settings: Settings, api: ApiClient) -> tuple[str, str]:
    """Username/password of a known-good admin, guaranteed to exist."""
    return settings.admin_username, settings.admin_password


@pytest.fixture
def destructive(settings: Settings) -> None:
    """Marker fixture for tests that write or delete data.

    Depend on it from any test that mutates state; runs against an environment
    with GRIMOIRE_ALLOW_DESTRUCTIVE=0 will skip those tests instead of touching
    real data.
    """
    if not settings.allow_destructive:
        pytest.skip("destructive tests disabled (GRIMOIRE_ALLOW_DESTRUCTIVE=0)")


@pytest.fixture
def temp_user(api: ApiClient, destructive: None) -> Iterator[dict]:
    """A throwaway player account, removed after the test."""
    username = "e2e_temp_player"
    password = "e2e-temp-password-123"
    user = api.ensure_user(username, password, role="player")
    user["password"] = password
    try:
        yield user
    finally:
        existing = api.find_user(username)
        if existing:
            api.delete_user(existing["id"])


# --------------------------------------------------------------------------
# Browser fixtures
# --------------------------------------------------------------------------


@pytest.fixture
def driver(settings: Settings, request: pytest.FixtureRequest) -> Iterator[WebDriver]:
    """A fresh browser per test.

    Per-test rather than per-session: a shared browser leaks cookies, localStorage
    and scroll position between tests, which is the usual source of E2E flake
    that only reproduces in a full run.
    """
    drv = create_driver(settings)
    try:
        yield drv
    finally:
        _capture_artifacts_on_failure(drv, settings, request)
        drv.quit()


@pytest.fixture
def login_page(driver: WebDriver, settings: Settings) -> LoginPage:
    page = LoginPage(driver, settings)
    page.open()
    return page


@pytest.fixture
def setup_page(driver: WebDriver, settings: Settings) -> SetupPage:
    page = SetupPage(driver, settings)
    page.open()
    return page


@pytest.fixture
def as_admin(driver: WebDriver, settings: Settings, api: ApiClient) -> LoginPage:
    """A browser already logged in as admin, sitting on the app shell.

    Injects the session token rather than driving the login form: the auth
    endpoints are rate-limited (default 10/minute), and a suite that logs in
    through the UI for every test trips that limit mid-run. Tests that are
    specifically about the login flow use `login_page` and the real form.
    """
    page = LoginPage(driver, settings)
    authenticate(driver, settings, api.token, landing="/library")
    # Slow budget: the first authenticated load against a cold server pays for
    # process warm-up on top of the usual render.
    page.wait_for_app_shell(timeout=settings.slow_timeout)
    return page


@pytest.fixture
def as_user(driver: WebDriver, settings: Settings) -> "callable":
    """Factory: log the browser in as an arbitrary user via their own token."""

    def _login(username: str, password: str, landing: str = "/library") -> LoginPage:
        client = ApiClient(settings)
        client.login(username, password)
        page = LoginPage(driver, settings)
        authenticate(driver, settings, client.token, landing=landing)
        page.wait_for_app_shell(timeout=settings.slow_timeout)
        return page

    return _login


@pytest.fixture
def logged_out(driver: WebDriver, settings: Settings) -> None:
    """Guarantee the browser starts with no stored credentials."""
    clear_session(driver, settings)


# --------------------------------------------------------------------------
# Failure artifacts
# --------------------------------------------------------------------------


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item: pytest.Item, call: pytest.CallInfo):
    """Record each phase's result so fixtures can see whether the test failed."""
    outcome = yield
    report = outcome.get_result()
    setattr(item, f"report_{report.when}", report)


def _capture_artifacts_on_failure(
    driver: WebDriver, settings: Settings, request: pytest.FixtureRequest
) -> None:
    """On failure, save a screenshot, the DOM, and the browser console log."""
    report = getattr(request.node, "report_call", None) or getattr(
        request.node, "report_setup", None
    )
    if report is None or not report.failed:
        return

    out = pathlib.Path(settings.artifact_dir)
    out.mkdir(parents=True, exist_ok=True)
    stem = request.node.name.replace("/", "_").replace("::", "-")[:120]

    try:
        driver.save_screenshot(str(out / f"{stem}.png"))
    except Exception:  # noqa: BLE001 - artifact capture must never mask the failure
        pass
    try:
        (out / f"{stem}.html").write_text(driver.page_source, encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass
    try:
        entries = driver.get_log("browser")
        if entries:
            lines = [f"{e.get('level')}: {e.get('message')}" for e in entries]
            (out / f"{stem}.console.log").write_text("\n".join(lines), encoding="utf-8")
    except Exception:  # noqa: BLE001 - not all drivers expose logs (Firefox)
        pass
