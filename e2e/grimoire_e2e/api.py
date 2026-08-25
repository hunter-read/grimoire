"""Thin HTTP client for the Grimoire API.

Used for *setup and teardown only* — creating the accounts and fixtures a test
needs, and cleaning them up afterwards. Assertions belong in the browser: if a
test verifies behaviour through this client it is no longer an E2E test.
"""
from __future__ import annotations

import time
from typing import Any, Optional

import requests

from .config import Settings


class ApiError(RuntimeError):
    """A non-2xx response from the API."""

    def __init__(self, method: str, path: str, status: int, body: str) -> None:
        super().__init__(f"{method} {path} -> {status}: {body[:500]}")
        self.status = status
        self.body = body


class ApiClient:
    """Authenticated (or anonymous) access to `/api`."""

    def __init__(self, settings: Settings, token: Optional[str] = None) -> None:
        self._settings = settings
        self._session = requests.Session()
        self.token = token

    # -- plumbing ---------------------------------------------------------

    def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        url = f"{self._settings.api_url}{path}"
        headers = dict(kwargs.pop("headers", {}))
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        resp = self._session.request(
            method, url, headers=headers, timeout=self._settings.timeout, **kwargs
        )
        if not resp.ok:
            raise ApiError(method, path, resp.status_code, resp.text)
        if resp.status_code == 204 or not resp.content:
            return None
        return resp.json()

    def get(self, path: str, **kwargs: Any) -> Any:
        return self._request("GET", path, **kwargs)

    def post(self, path: str, **kwargs: Any) -> Any:
        return self._request("POST", path, **kwargs)

    def patch(self, path: str, **kwargs: Any) -> Any:
        return self._request("PATCH", path, **kwargs)

    def delete(self, path: str, **kwargs: Any) -> Any:
        return self._request("DELETE", path, **kwargs)

    # -- auth -------------------------------------------------------------

    def is_initialized(self) -> bool:
        """Whether the instance already has at least one user."""
        status = self.get("/auth/status")
        return bool(status.get("initialized"))

    def setup_admin(self, username: str, password: str) -> dict:
        """First-run admin creation. Only valid when no users exist yet."""
        return self.post("/auth/setup", json={"username": username, "password": password})

    def login(self, username: str, password: str) -> dict:
        data = self.post("/auth/login", json={"username": username, "password": password})
        self.token = data["token"]
        return data

    def me(self) -> dict:
        return self.get("/auth/me")

    # -- users ------------------------------------------------------------

    def list_users(self) -> list[dict]:
        return self.get("/users")

    def create_user(self, username: str, password: str, role: str = "player", **extra: Any) -> dict:
        payload = {"username": username, "password": password, "role": role, **extra}
        return self.post("/users", json=payload)

    def delete_user(self, user_id: str) -> None:
        self.delete(f"/users/{user_id}")

    def find_user(self, username: str) -> Optional[dict]:
        return next((u for u in self.list_users() if u.get("username") == username), None)

    def ensure_user(self, username: str, password: str, role: str = "player") -> dict:
        """Create the user, or reset it to a known state if it already exists.

        Re-runs of the suite must not fail on leftovers from a previous run, and
        a stale password would break login, so an existing account is deleted
        and recreated rather than reused as-is.
        """
        existing = self.find_user(username)
        if existing:
            self.delete_user(existing["id"])
        return self.create_user(username, password, role=role)

    # -- library ----------------------------------------------------------

    def list_systems(self) -> list[dict]:
        return self.get("/systems")

    def list_books(self, **params: Any) -> list[dict]:
        """The books themselves — `/books` wraps them as `{total, books}`."""
        data = self.get("/books", params=params or None)
        return data["books"] if isinstance(data, dict) else data

    def rescan(self, **body: Any) -> Any:
        """Kick off a background library scan (admin only)."""
        return self.post("/rescan", json=body or None)

    def scan_status(self) -> dict:
        return self.get("/scan-status")

    def wait_for_scan(self, timeout: int = 180) -> dict:
        """Block until no scan is running, or `timeout` seconds elapse."""
        deadline = time.monotonic() + timeout
        status: dict = {}
        while time.monotonic() < deadline:
            status = self.scan_status()
            if not status.get("running"):
                return status
            time.sleep(1)
        raise TimeoutError(f"library scan still running after {timeout}s: {status}")

    def health(self) -> Any:
        return self.get("/health")


def admin_client(settings: Settings) -> ApiClient:
    """An API client authenticated as the suite's admin account.

    Bootstraps the account on a fresh instance via first-run setup; otherwise
    logs in with the configured credentials.
    """
    client = ApiClient(settings)
    if not client.is_initialized():
        data = client.setup_admin(settings.admin_username, settings.admin_password)
        client.token = data["token"]
        return client
    client.login(settings.admin_username, settings.admin_password)
    return client
