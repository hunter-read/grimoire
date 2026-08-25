"""First-run setup and login screens."""
from __future__ import annotations

from selenium.webdriver.common.by import By

from .. import waits
from .base import BasePage


class LoginPage(BasePage):
    path = "/"

    USERNAME = (By.ID, "login-username")
    PASSWORD = (By.ID, "login-password")
    SUBMIT = (By.CSS_SELECTOR, 'form button[type="submit"]')
    # The login form's only non-submit sibling text block; scoped to the card so
    # it cannot match an unrelated message elsewhere on the page.
    ERROR = (By.XPATH, '//form//div[contains(@style, "--red")]')
    GUEST_CODE = (By.ID, "guest-code")

    def login(self, username: str, password: str) -> None:
        """Fill and submit the password form. Does not wait for the result."""
        self.type_into(self.USERNAME, username)
        self.type_into(self.PASSWORD, password)
        self.click(self.SUBMIT)

    def login_and_wait(self, username: str, password: str) -> None:
        """Log in and block until the authenticated app shell is up."""
        self.login(username, password)
        self.wait_for_app_shell()

    def wait_for_form(self) -> None:
        waits.visible(self.driver, self.USERNAME)

    def error_text(self) -> str:
        return self.text_of(self.ERROR)


class SetupPage(BasePage):
    """First-run admin creation, shown only while the instance has no users."""

    path = "/"

    USERNAME = (By.ID, "setup-username")
    PASSWORD = (By.ID, "setup-password")
    CONFIRM = (By.ID, "setup-confirm")
    SUBMIT = (By.CSS_SELECTOR, 'form button[type="submit"]')

    def create_admin(self, username: str, password: str) -> None:
        self.type_into(self.USERNAME, username)
        self.type_into(self.PASSWORD, password)
        self.type_into(self.CONFIRM, password)
        self.click(self.SUBMIT)
        self.wait_for_app_shell()

    def is_showing(self) -> bool:
        return self.has(self.USERNAME)
