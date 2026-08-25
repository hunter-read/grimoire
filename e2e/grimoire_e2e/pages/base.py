"""Shared behaviour for all page objects."""
from __future__ import annotations

from typing import Optional

from selenium.webdriver.common.by import By
from selenium.webdriver.remote.webdriver import WebDriver
from selenium.webdriver.remote.webelement import WebElement

from .. import waits
from ..config import Settings, settings as default_settings


class BasePage:
    """A view in the app.

    Page objects own *locators and interactions*, never assertions — tests
    assert. Keeping that split means a markup change is a one-line fix here
    instead of an edit across every test that touched the screen.
    """

    #: Client-side route this page lives at. Subclasses override.
    path: str = "/"

    def __init__(self, driver: WebDriver, settings: Optional[Settings] = None) -> None:
        self.driver = driver
        self.settings = settings or default_settings

    # -- navigation -------------------------------------------------------

    def open(self) -> "BasePage":
        self.driver.get(self.settings.url(self.path))
        return self

    @property
    def current_path(self) -> str:
        url = self.driver.current_url
        base = self.settings.base_url
        return url[len(base) :] if url.startswith(base) else url

    # -- element access ---------------------------------------------------

    def find(self, locator: waits.Locator, timeout: Optional[int] = None) -> WebElement:
        return waits.visible(self.driver, locator, timeout)

    def click(self, locator: waits.Locator, timeout: Optional[int] = None) -> None:
        waits.clickable(self.driver, locator, timeout).click()

    def type_into(self, locator: waits.Locator, text: str) -> None:
        """Clear a field and type into it.

        `clear()` on a React-controlled input can leave state out of sync, so
        the value is selected and overwritten by the send_keys instead.
        """
        element = waits.visible(self.driver, locator)
        element.clear()
        element.send_keys(text)

    def has(self, locator: waits.Locator) -> bool:
        return waits.is_present(self.driver, locator)

    def text_of(self, locator: waits.Locator, timeout: Optional[int] = None) -> str:
        return waits.safe_text(self.find(locator, timeout))

    # -- common chrome ----------------------------------------------------

    #: The app shell only renders once a user is authenticated, so this doubles
    #: as the "am I logged in" signal.
    NAV = (By.CSS_SELECTOR, 'nav[aria-label="Main navigation"]')

    def wait_for_app_shell(self, timeout: Optional[int] = None) -> WebElement:
        return waits.visible(self.driver, self.NAV, timeout)

    def nav_link(self, route: str) -> WebElement:
        """A sidebar link by its route, so the suite stays language-agnostic."""
        return waits.clickable(
            self.driver, (By.CSS_SELECTOR, f'nav[aria-label="Main navigation"] a[href="{route}"]')
        )

    def goto_via_nav(self, route: str) -> None:
        self.nav_link(route).click()
        waits.url_contains(self.driver, route)
