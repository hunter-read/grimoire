"""Settings, including the admin-only tabs.

Tabs are routes (`/settings/:tab`), so the page object navigates by URL rather
than hunting for a tab control with a translated label.
"""
from __future__ import annotations

from selenium.webdriver.common.by import By

from .. import waits
from .base import BasePage


class SettingsPage(BasePage):
    path = "/settings"

    #: Tabs the app renders only for admins. A non-admin landing on one of these
    #: routes gets the account tab's content instead, which is what the
    #: role-restriction tests assert on.
    ADMIN_TABS = ("users", "authentication", "application", "metadata", "maintenance", "logs")

    LOGOUT = (By.CSS_SELECTOR, '[aria-label*="og out" i], [aria-label*="ogout" i]')

    def open_tab(self, tab: str) -> None:
        """Navigate to a settings tab and wait for it to finish mounting.

        The admin tabs each fetch their own data on mount, and on a cold server
        the very first one can take noticeably longer than a warm request — so
        this waits on the slow budget rather than the default one.
        """
        self.driver.get(self.settings.url(f"/settings/{tab}"))
        self.wait_for_app_shell(timeout=self.settings.slow_timeout)
        waits.url_contains(self.driver, f"/settings/{tab}")

    def logout(self) -> None:
        """Log out via the sidebar control and wait for the login screen."""
        waits.clickable(self.driver, self.LOGOUT).click()
        waits.visible(self.driver, (By.ID, "login-username"))


class UsersTab(BasePage):
    """Admin > Users."""

    path = "/settings/users"

    def open(self) -> "UsersTab":
        super().open()
        self.wait_for_app_shell()
        return self

    def row_for(self, username: str) -> bool:
        """Whether a user with this username is listed."""
        return bool(
            self.driver.find_elements(
                By.XPATH, f'//*[normalize-space(text())="{username}"]'
            )
        )

    def wait_for_user(self, username: str) -> None:
        waits.wait_for(
            self.driver,
            lambda d: self.row_for(username),
            message=f"user {username!r} never appeared in the users list",
        )
