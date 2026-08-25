"""Runtime configuration for the E2E suite, read from the environment.

Every knob is an environment variable so the same tests can run against a local
dev server today and a deployed environment later without code changes. Defaults
target the local dev setup described in the repo's CLAUDE.md (backend on 9481).
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field


def _flag(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    return int(raw)


@dataclass(frozen=True)
class Settings:
    """Resolved settings for one test run."""

    #: Base URL of the running Grimoire instance, no trailing slash.
    base_url: str = field(
        default_factory=lambda: os.environ.get("GRIMOIRE_BASE_URL", "http://localhost:9481").rstrip(
            "/"
        )
    )

    #: Which browser to drive. Selenium Manager resolves the driver binary.
    browser: str = field(
        default_factory=lambda: os.environ.get("GRIMOIRE_BROWSER", "chrome").strip().lower()
    )
    headless: bool = field(default_factory=lambda: _flag("GRIMOIRE_HEADLESS", True))
    window_width: int = field(default_factory=lambda: _int("GRIMOIRE_WINDOW_WIDTH", 1440))
    window_height: int = field(default_factory=lambda: _int("GRIMOIRE_WINDOW_HEIGHT", 900))

    #: Optional Selenium Grid / remote WebDriver endpoint. Empty means local.
    remote_url: str = field(default_factory=lambda: os.environ.get("GRIMOIRE_REMOTE_URL", "").strip())

    #: Seconds an explicit wait polls before failing.
    timeout: int = field(default_factory=lambda: _int("GRIMOIRE_TIMEOUT", 15))
    #: Longer budget for genuinely slow operations (first PDF page render, scans).
    slow_timeout: int = field(default_factory=lambda: _int("GRIMOIRE_SLOW_TIMEOUT", 60))

    #: Admin credentials. On a fresh instance the suite creates this account via
    #: the first-run setup endpoint; against an existing instance it logs in.
    admin_username: str = field(
        default_factory=lambda: os.environ.get("GRIMOIRE_ADMIN_USER", "e2e_admin")
    )
    admin_password: str = field(
        default_factory=lambda: os.environ.get("GRIMOIRE_ADMIN_PASSWORD", "e2e-password-123")
    )

    #: Where failure screenshots and page source dumps land.
    artifact_dir: str = field(
        default_factory=lambda: os.environ.get("GRIMOIRE_ARTIFACT_DIR", "artifacts")
    )

    #: Guard rail for the future "real environment" runs: destructive tests
    #: (creating/deleting users, editing library data) are skipped unless this is
    #: explicitly enabled, so pointing the suite at a live server is safe.
    allow_destructive: bool = field(
        default_factory=lambda: _flag("GRIMOIRE_ALLOW_DESTRUCTIVE", True)
    )

    @property
    def api_url(self) -> str:
        return f"{self.base_url}/api"

    def url(self, path: str = "/") -> str:
        """Absolute app URL for a client-side route."""
        if not path.startswith("/"):
            path = "/" + path
        return f"{self.base_url}{path}"


settings = Settings()
