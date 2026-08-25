"""Login, logout, and session behaviour."""
from __future__ import annotations

import pytest
from selenium.webdriver.common.by import By
from selenium.webdriver.remote.webdriver import WebDriver

from grimoire_e2e import waits
from grimoire_e2e.config import Settings
from grimoire_e2e.pages import LoginPage, SettingsPage

pytestmark = pytest.mark.auth


def test_admin_can_log_in(login_page: LoginPage, admin_credentials: tuple[str, str]) -> None:
    login_page.wait_for_form()
    login_page.login_and_wait(*admin_credentials)
    assert login_page.has(LoginPage.NAV)


def test_wrong_password_is_rejected(
    login_page: LoginPage, admin_credentials: tuple[str, str]
) -> None:
    username, _ = admin_credentials
    login_page.wait_for_form()
    login_page.login(username, "definitely-not-the-password")

    # The app shell must never appear, and an error must be shown.
    waits.wait_for(
        login_page.driver,
        lambda d: bool(d.find_elements(*LoginPage.ERROR)),
        message="no error shown for a bad password",
    )
    assert not login_page.has(LoginPage.NAV)


def test_session_survives_a_reload(
    as_admin: LoginPage, driver: WebDriver, settings: Settings
) -> None:
    driver.get(settings.url("/library"))
    as_admin.wait_for_app_shell()
    driver.refresh()
    # Still authenticated after a full page load — the token was persisted.
    as_admin.wait_for_app_shell()


def test_logout_returns_to_login(as_admin: LoginPage, driver: WebDriver) -> None:
    SettingsPage(driver).logout()
    assert driver.find_elements(By.ID, "login-username")


def test_temp_user_can_log_in(login_page: LoginPage, temp_user: dict) -> None:
    login_page.wait_for_form()
    login_page.login_and_wait(temp_user["username"], temp_user["password"])
    assert login_page.has(LoginPage.NAV)
