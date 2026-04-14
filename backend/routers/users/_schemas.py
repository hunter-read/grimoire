"""Pydantic schemas for the users API."""
from typing import Optional
from pydantic import BaseModel, field_validator

from ...auth import ROLES


class UserCreate(BaseModel):
    username: str
    password: str
    role: str = "player"

    @field_validator("role")
    @classmethod
    def role_valid(cls, v):
        if v not in ROLES:
            raise ValueError(f"Role must be one of: {', '.join(ROLES)}")
        return v

    @field_validator("password")
    @classmethod
    def password_valid(cls, v):
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class UserUpdate(BaseModel):
    role: Optional[str] = None
    password: Optional[str] = None
    allow_explicit: Optional[bool] = None

    @field_validator("role")
    @classmethod
    def role_valid(cls, v):
        if v is not None and v not in ROLES:
            raise ValueError(f"Role must be one of: {', '.join(ROLES)}")
        return v

    @field_validator("password")
    @classmethod
    def password_valid(cls, v):
        if v is not None and len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class PasswordChange(BaseModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def password_valid(cls, v):
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class PreferencesUpdate(BaseModel):
    allow_explicit: Optional[bool] = None
    display_name: Optional[str] = None
