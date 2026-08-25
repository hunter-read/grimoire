"""Page objects — one per screen, exposing locators and interactions."""
from .base import BasePage
from .library import BookReaderPage, LibraryPage
from .login import LoginPage, SetupPage
from .settings import SettingsPage, UsersTab

__all__ = [
    "BasePage",
    "BookReaderPage",
    "LibraryPage",
    "LoginPage",
    "SettingsPage",
    "SetupPage",
    "UsersTab",
]
