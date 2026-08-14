"""Pydantic schemas for the OIDC API."""
from typing import Optional

from pydantic import BaseModel


class DiscoverRequest(BaseModel):
    issuer_url: str


class DiscoverResponse(BaseModel):
    """The endpoint URLs pulled out of the IdP's discovery document.

    The handler defaults each key to `""` / `[]` when absent, but the document
    itself is untrusted third-party JSON: an IdP that emits an explicit
    `"userinfo_endpoint": null` would pass that null straight through, so every
    field is Optional rather than a strict `str`.
    """

    issuer: Optional[str] = None
    authorization_endpoint: Optional[str] = None
    token_endpoint: Optional[str] = None
    userinfo_endpoint: Optional[str] = None
    jwks_uri: Optional[str] = None
    end_session_endpoint: Optional[str] = None
    id_token_signing_alg_values_supported: Optional[list[str]] = None
