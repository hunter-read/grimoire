"""Browsing the library.

These adapt to whatever the target instance holds: with an empty library the
content-dependent tests skip rather than fail, so the suite is meaningful
against both a seeded dev box and a bare one.
"""
from __future__ import annotations

import pytest
from selenium.webdriver.common.by import By
from selenium.webdriver.remote.webdriver import WebDriver

from grimoire_e2e import ApiClient, waits
from grimoire_e2e.config import Settings
from grimoire_e2e.pages import BookReaderPage, LibraryPage, LoginPage

pytestmark = pytest.mark.library


@pytest.fixture
def library(as_admin: LoginPage, driver: WebDriver, settings: Settings) -> LibraryPage:
    page = LibraryPage(driver, settings)
    page.open()
    page.wait_loaded()
    return page


def test_library_route_renders(library: LibraryPage) -> None:
    assert library.current_path.startswith("/library")


def test_sidebar_navigation(library: LibraryPage) -> None:
    """Each primary nav destination routes without dropping the app shell."""
    for route in ("/maps", "/tokens", "/audio", "/search", "/library"):
        locator = (By.CSS_SELECTOR, f'nav[aria-label="Main navigation"] a[href="{route}"]')
        if not library.has(locator):
            continue  # destination hidden by instance settings (hide_maps, etc.)
        library.goto_via_nav(route)
        library.wait_for_app_shell()


def test_systems_are_listed(library: LibraryPage, api: ApiClient) -> None:
    if not api.list_systems():
        pytest.skip("library has no game systems indexed")
    waits.visible(library.driver, LibraryPage.SYSTEM_CARDS)
    assert library.system_cards()


def test_opening_a_system_shows_its_books(library: LibraryPage, api: ApiClient) -> None:
    if not api.list_systems():
        pytest.skip("library has no game systems indexed")
    library.open_first_system()
    library.wait_for_app_shell()
    assert "/library/system/" in library.current_path


def test_book_reader_renders_a_page(
    as_admin: LoginPage, driver: WebDriver, settings: Settings, api: ApiClient
) -> None:
    books = api.list_books(limit=1)
    if not books:
        pytest.skip("library has no books indexed")

    reader = BookReaderPage(driver, settings)
    reader.open_book(books[0]["id"])
    # Server-side render on a cold cache is genuinely slow; uses slow_timeout.
    assert reader.wait_for_page_render().is_displayed()
