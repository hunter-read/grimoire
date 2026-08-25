"""WebDriver construction.

Selenium 4 ships Selenium Manager, which downloads and caches a matching driver
binary automatically, so there is no chromedriver to install or keep in step
with the browser.
"""
from __future__ import annotations

from selenium import webdriver
from selenium.webdriver.remote.webdriver import WebDriver

from .config import Settings


def _chrome_options(settings: Settings) -> webdriver.ChromeOptions:
    opts = webdriver.ChromeOptions()
    if settings.headless:
        opts.add_argument("--headless=new")
    opts.add_argument(f"--window-size={settings.window_width},{settings.window_height}")
    # Containers and CI runners get a small /dev/shm; without this Chrome dies
    # part-way through a page render with an opaque crash.
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--no-sandbox")
    # Keep runs deterministic: no first-run bubbles, no password manager prompts
    # stealing focus from a form the test is typing into.
    opts.add_argument("--disable-search-engine-choice-screen")
    opts.add_experimental_option(
        "prefs",
        {
            "credentials_enable_service": False,
            "profile.password_manager_enabled": False,
        },
    )
    # Surfaced by BrowserLogs so a failing test can show console errors.
    opts.set_capability("goog:loggingPrefs", {"browser": "ALL"})
    return opts


def _firefox_options(settings: Settings) -> webdriver.FirefoxOptions:
    opts = webdriver.FirefoxOptions()
    if settings.headless:
        opts.add_argument("-headless")
    opts.add_argument("--width")
    opts.add_argument(str(settings.window_width))
    opts.add_argument("--height")
    opts.add_argument(str(settings.window_height))
    return opts


def build_options(settings: Settings):
    if settings.browser == "chrome":
        return _chrome_options(settings)
    if settings.browser == "firefox":
        return _firefox_options(settings)
    raise ValueError(
        f"Unsupported GRIMOIRE_BROWSER={settings.browser!r}; expected 'chrome' or 'firefox'"
    )


def create_driver(settings: Settings) -> WebDriver:
    """Start a browser session for one test."""
    options = build_options(settings)

    if settings.remote_url:
        driver = webdriver.Remote(command_executor=settings.remote_url, options=options)
    elif settings.browser == "chrome":
        driver = webdriver.Chrome(options=options)
    else:
        driver = webdriver.Firefox(options=options)

    driver.set_window_size(settings.window_width, settings.window_height)
    # No implicit wait on purpose: it silently slows every explicit wait and
    # makes "element is absent" assertions take the full timeout. All waiting
    # goes through the explicit helpers in waits.py.
    driver.implicitly_wait(0)
    driver.set_page_load_timeout(settings.slow_timeout)
    return driver
