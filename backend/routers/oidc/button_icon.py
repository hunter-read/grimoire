"""Public endpoint serving the admin-configured login-button icon (issue #377)."""
from typing import Optional

from fastapi import Depends, HTTPException, Query, Request, Response
from sqlalchemy.orm import Session

from ...config import OIDC_ENV, get_db
from ...services.oidc_button import current_icon
from ..settings._helpers import _get_raw

# The icon is always a server-normalized PNG, but it is fetched pre-auth by
# anyone, so lock the response down anyway: no sniffing, and nothing it could
# reference or run if it were ever opened as a document.
_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cross-Origin-Resource-Policy": "same-origin",
}


def serve_oidc_button_icon(
    request: Request,
    v: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    # Not gated on OIDC being fully configured: the icon is only the admin's
    # chosen login-page logo, and the settings preview shows it mid-setup.
    raw = _get_raw(db)
    icon = current_icon(raw.get("oidc_button_icon", ""), OIDC_ENV.get("oidc_button_icon"))
    if icon is None:
        raise HTTPException(404, "No login button icon")
    png, version = icon
    etag = f'"{version}"'
    # A URL carrying the current version can be cached forever: a new icon gets
    # a new version. Anything else must revalidate.
    cache = "public, max-age=31536000, immutable" if v == version else "no-cache"
    headers = {**_SECURITY_HEADERS, "ETag": etag, "Cache-Control": cache}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return Response(content=png, media_type="image/png", headers=headers)
