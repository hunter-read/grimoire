"""Admin settings and role boundaries."""
from __future__ import annotations

import pytest
from selenium.webdriver.remote.webdriver import WebDriver

from grimoire_e2e.config import Settings
from grimoire_e2e.pages import LoginPage, SettingsPage, UsersTab  # noqa: F401

pytestmark = pytest.mark.admin


def test_admin_reaches_every_settings_tab(
    as_admin: LoginPage, driver: WebDriver, settings: Settings
) -> None:
    page = SettingsPage(driver, settings)
    for tab in SettingsPage.ADMIN_TABS:
        page.open_tab(tab)
        assert page.current_path.startswith(f"/settings/{tab}")


def test_new_user_appears_in_the_users_tab(
    as_admin: LoginPage, driver: WebDriver, settings: Settings, temp_user: dict
) -> None:
    tab = UsersTab(driver, settings)
    tab.open()
    tab.wait_for_user(temp_user["username"])


def test_player_does_not_get_the_admin_users_tab(
    driver: WebDriver, settings: Settings, temp_user: dict, as_user
) -> None:
    """A player navigating straight to /settings/users must not see it render."""
    as_user(temp_user["username"], temp_user["password"])

    page = SettingsPage(driver, settings)
    page.open_tab("users")
    # The route resolves for anyone; the admin-only panel is what must be absent.
    assert not UsersTab(driver, settings).row_for(settings.admin_username)
