"""Selenium end-to-end test support for Grimoire.

Layout:
    config.py   environment-driven settings
    driver.py   WebDriver construction
    api.py      HTTP client used for fixture setup/teardown only
    waits.py    explicit-wait helpers
    pages/      page objects, one per screen
"""
from .api import ApiClient, ApiError, admin_client
from .config import Settings, settings
from .driver import create_driver

__all__ = [
    "ApiClient",
    "ApiError",
    "Settings",
    "admin_client",
    "create_driver",
    "settings",
]
