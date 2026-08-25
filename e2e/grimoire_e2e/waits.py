"""Explicit-wait helpers.

Selenium's default failure mode is a race: the test asks for an element the
instant a click returns, before React has re-rendered. Everything here waits for
a *condition* rather than sleeping, so tests stay fast when the app is fast and
still pass when it is slow.
"""
from __future__ import annotations

from typing import Callable, Optional, TypeVar

from selenium.common.exceptions import (
    NoSuchElementException,
    StaleElementReferenceException,
    TimeoutException,
)
from selenium.webdriver.remote.webdriver import WebDriver
from selenium.webdriver.remote.webelement import WebElement
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

from .config import settings

T = TypeVar("T")

Locator = tuple[str, str]


def wait_for(
    driver: WebDriver,
    condition: Callable[[WebDriver], T],
    timeout: Optional[int] = None,
    message: str = "",
) -> T:
    """Poll `condition` until it returns something truthy."""
    return WebDriverWait(
        driver,
        timeout if timeout is not None else settings.timeout,
        poll_frequency=0.2,
        ignored_exceptions=(NoSuchElementException, StaleElementReferenceException),
    ).until(condition, message)


def visible(driver: WebDriver, locator: Locator, timeout: Optional[int] = None) -> WebElement:
    """The element, once it exists and is displayed."""
    return wait_for(
        driver,
        EC.visibility_of_element_located(locator),
        timeout,
        f"element {locator} never became visible",
    )


def present(driver: WebDriver, locator: Locator, timeout: Optional[int] = None) -> WebElement:
    return wait_for(
        driver,
        EC.presence_of_element_located(locator),
        timeout,
        f"element {locator} never appeared in the DOM",
    )


def clickable(driver: WebDriver, locator: Locator, timeout: Optional[int] = None) -> WebElement:
    return wait_for(
        driver,
        EC.element_to_be_clickable(locator),
        timeout,
        f"element {locator} never became clickable",
    )


def gone(driver: WebDriver, locator: Locator, timeout: Optional[int] = None) -> bool:
    return wait_for(
        driver,
        EC.invisibility_of_element_located(locator),
        timeout,
        f"element {locator} was still visible",
    )


def is_present(driver: WebDriver, locator: Locator) -> bool:
    """Immediate, non-waiting existence check.

    Only correct for asserting something is *already* absent after a state you
    have separately waited for — never as a substitute for a wait.
    """
    return bool(driver.find_elements(*locator))


def url_contains(driver: WebDriver, fragment: str, timeout: Optional[int] = None) -> bool:
    return wait_for(
        driver,
        EC.url_contains(fragment),
        timeout,
        f"URL never contained {fragment!r} (was {driver.current_url!r})",
    )


def text_in(
    driver: WebDriver, locator: Locator, text: str, timeout: Optional[int] = None
) -> bool:
    return wait_for(
        driver,
        EC.text_to_be_present_in_element(locator, text),
        timeout,
        f"element {locator} never contained {text!r}",
    )


def safe_text(element: WebElement) -> str:
    """`element.text`, tolerating a re-render between locating and reading."""
    try:
        return element.text
    except StaleElementReferenceException:
        return ""


__all__ = [
    "Locator",
    "TimeoutException",
    "clickable",
    "gone",
    "is_present",
    "present",
    "safe_text",
    "text_in",
    "url_contains",
    "visible",
    "wait_for",
]
