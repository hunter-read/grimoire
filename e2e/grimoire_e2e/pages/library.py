"""Library browsing: the system grid, a system's books, and the reader."""
from __future__ import annotations

from typing import Optional

from selenium.webdriver.common.by import By
from selenium.webdriver.remote.webelement import WebElement

from .. import waits
from .base import BasePage


class LibraryPage(BasePage):
    path = "/library"

    # Cards are anchors to a detail route; matching on href keeps this working
    # regardless of the card's internal markup or language.
    SYSTEM_CARDS = (By.CSS_SELECTOR, 'a[href^="/library/system/"]')
    BOOK_CARDS = (By.CSS_SELECTOR, 'a[href^="/library/book/"]')
    SORT_FILTER_BAR = (By.CSS_SELECTOR, '[data-testid="sort-filter-bar"]')

    def wait_loaded(self) -> None:
        """Wait until the library has settled into content or an empty state.

        An empty library is a legitimate state, so this waits for the shell plus
        the toolbar rather than for cards that may never come.
        """
        self.wait_for_app_shell()
        waits.url_contains(self.driver, "/library")

    def system_cards(self) -> list[WebElement]:
        return self.driver.find_elements(*self.SYSTEM_CARDS)

    def book_cards(self) -> list[WebElement]:
        return self.driver.find_elements(*self.BOOK_CARDS)

    def open_first_system(self) -> None:
        waits.visible(self.driver, self.SYSTEM_CARDS).click()
        waits.url_contains(self.driver, "/library/system/")

    def open_first_book(self) -> None:
        waits.visible(self.driver, self.BOOK_CARDS).click()
        waits.url_contains(self.driver, "/library/book/")


class BookReaderPage(BasePage):
    """The PDF/EPUB reader. Page images render server-side, so waits here use
    the slow timeout — a cold page cache means a real render round trip."""

    CANVAS = (By.CSS_SELECTOR, "canvas, img[src*='/page/']")

    def open_book(self, book_id: str) -> None:
        self.driver.get(self.settings.url(f"/library/book/{book_id}"))

    def wait_for_page_render(self, timeout: Optional[int] = None) -> WebElement:
        return waits.visible(
            self.driver, self.CANVAS, timeout or self.settings.slow_timeout
        )
