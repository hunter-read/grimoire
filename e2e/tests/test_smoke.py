"""The app is up, serves the SPA, and its API answers."""
from __future__ import annotations

import pytest
from selenium.webdriver.common.by import By
from selenium.webdriver.remote.webdriver import WebDriver

from grimoire_e2e import ApiClient, waits
from grimoire_e2e.pages import BasePage
from grimoire_e2e.config import Settings

pytestmark = pytest.mark.smoke


def test_app_loads(driver: WebDriver, settings: Settings) -> None:
    """The static build is served and React mounts into it."""
    driver.get(settings.url("/"))
    # #root is empty in the served HTML and filled in by React, so waiting for
    # content in it is the check that the bundle actually loaded and ran.
    waits.wait_for(
        driver,
        lambda d: d.find_element(By.ID, "root").get_attribute("innerHTML").strip(),
        message="React never mounted into #root",
    )


def test_health_endpoint(api: ApiClient) -> None:
    assert api.health() is not None


def test_unauthenticated_visitor_gets_a_gate(
    driver: WebDriver, settings: Settings, logged_out: None
) -> None:
    """With no token, the app shows setup or login — never the library.

    AuthContext resolves the session asynchronously (status starts as
    'loading'), so this waits for the gate to render rather than reading the
    DOM the instant navigation returns.
    """
    driver.get(settings.url("/library"))
    waits.wait_for(
        driver,
        lambda d: d.find_elements(By.ID, "login-username")
        or d.find_elements(By.ID, "setup-username"),
        message="unauthenticated visitor was not shown a login or setup form",
    )
    assert not driver.find_elements(*BasePage.NAV), "library shell rendered without auth"
