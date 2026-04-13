"""Pydantic schemas for the books API."""
from typing import Optional
from pydantic import BaseModel


class BookUpdate(BaseModel):
    title: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None
    authors: Optional[list[str]] = None
    publisher: Optional[str] = None
    publisher_url: Optional[str] = None
    year: Optional[int] = None
    tags: Optional[list[str]] = None
    is_explicit: Optional[bool] = None
