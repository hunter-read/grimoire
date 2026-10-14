"""Upload and remove the OIDC login-button icon (issue #377).

The icon is normalized to a small PNG before it is stored (see
``services/oidc_button.py``), and served publicly by the OIDC router's
``GET /api/auth/openid/button-icon`` because the login page is pre-auth.
"""
from fastapi import Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ...auth import CurrentUser, require_admin
from ...config import OIDC_ENV, get_db
from ...services.oidc_button import (
    MAX_ICON_UPLOAD_BYTES,
    IconError,
    normalize_icon,
    remove_icon,
    store_icon,
)
from ._helpers import _get_raw, _set, _to_typed


def _ensure_icon_unlocked() -> None:
    if OIDC_ENV.get("oidc_button_icon") is not None:
        raise HTTPException(
            400, "oidc_button_icon is locked by the OIDC_BUTTON_ICON environment variable"
        )


def upload_oidc_button_icon(
    file: UploadFile = File(...),
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    _ensure_icon_unlocked()
    data = file.file.read(MAX_ICON_UPLOAD_BYTES + 1)
    if len(data) > MAX_ICON_UPLOAD_BYTES:
        raise HTTPException(413, "Icon must be 1 MB or smaller")
    try:
        png = normalize_icon(data)
    except IconError as e:
        raise HTTPException(400, str(e)) from e
    _set(db, "oidc_button_icon", store_icon(png))
    db.commit()
    return _to_typed(_get_raw(db))


def delete_oidc_button_icon(
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    _ensure_icon_unlocked()
    remove_icon()
    _set(db, "oidc_button_icon", "")
    db.commit()
    return _to_typed(_get_raw(db))
