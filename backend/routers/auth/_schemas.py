"""Pydantic schemas for the auth API."""
from pydantic import BaseModel, field_validator


class LoginRequest(BaseModel):
    username: str
    password: str


class GuestLoginRequest(BaseModel):
    code: str

    @field_validator("code")
    @classmethod
    def code_clean(cls, v):
        return (v or "").strip().upper()


class SetupRequest(BaseModel):
    username: str
    password: str

    @field_validator("username")
    @classmethod
    def username_valid(cls, v):
        v = v.strip()
        if len(v) < 2:
            raise ValueError("Username must be at least 2 characters")
        return v

    @field_validator("password")
    @classmethod
    def password_valid(cls, v):
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v
