"""Per-user theme endpoints.

Every route here is scoped to the calling user: themes are installed, listed,
and selected per account, so `get_current_user` is the only gate. There is no
admin curation step — one person's choice of colours cannot affect anyone else,
so requiring an admin to approve it would be friction without a safety benefit.

The one exception is the catalogue URL, which is server-wide configuration and
is therefore admin-only to change.
"""
import logging
from typing import Optional

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from ... import config
from ...auth import CurrentUser, get_current_user, require_admin
from ...config import get_db
from ...models import AppSetting, User, UserTheme
from ...services import themes as svc
from ._schemas import ThemeImport, ThemeSelection, ThemeSourceUpdate

logger = logging.getLogger("grimoire.themes")


def _serialize(theme: UserTheme) -> dict:
    """Shape a stored theme for the API.

    Tokens are re-sanitized on the way out, not just on the way in: a row edited
    directly in the database must not be able to inject anything either.
    """
    primary = theme.mode or "dark"
    stored = theme.variants if isinstance(theme.variants, dict) else {}
    variants = {
        mode: svc.sanitize_tokens(tokens)
        for mode, tokens in stored.items()
        if mode in svc.THEME_MODES and svc.sanitize_tokens(tokens)
    }
    # A row written before variants existed has only `tokens`; read it as a
    # single-mode theme so the two shapes are the same thing to every caller.
    if not variants:
        fallback = svc.sanitize_tokens(theme.tokens)
        if fallback:
            variants = {primary: fallback}

    return {
        "id": theme.theme_id,
        "name": theme.name,
        "mode": primary,
        "app_mode": theme.app_mode or svc.DEFAULT_APP_MODE,
        "variants": variants,
        # Which colour modes this theme actually covers, so the picker can say
        # "light and dark" on one row instead of listing two themes.
        "modes": [m for m in svc.THEME_MODES if m in variants],
        "tokens": variants.get(primary) or svc.sanitize_tokens(theme.tokens),
        "source_id": theme.source_id,
        "source_url": theme.source_url,
        "source_version": theme.source_version,
        "is_community": bool(theme.source_id),
    }


def _resolve_app_mode(value: Optional[str]) -> str:
    """Normalise a app_mode name, falling back to the default."""
    candidate = (value or svc.DEFAULT_APP_MODE).lower()
    return candidate if candidate in svc.APP_MODES else svc.DEFAULT_APP_MODE


def _selection_for(user: User, app_mode: str) -> dict:
    """The user's mode/theme in one app_mode.

    Grimoire keeps its original columns; every other app_mode lives in the
    ``theme_by_mode`` JSON, so the common case reads no JSON at all.
    """
    if app_mode == svc.DEFAULT_APP_MODE:
        return {"mode": user.theme_mode or "dark", "theme_id": user.theme_id or ""}
    stored = (user.theme_by_mode or {}).get(app_mode) or {}
    return {
        "mode": stored.get("mode") or "dark",
        "theme_id": stored.get("theme_id") or "",
    }


def _set_selection(user: User, app_mode: str, *, mode=None, theme_id=None) -> None:
    """Write back one app_mode's selection, leaving the others alone."""
    if app_mode == svc.DEFAULT_APP_MODE:
        if mode is not None:
            user.theme_mode = mode
        if theme_id is not None:
            user.theme_id = theme_id or None
        return

    by_mode = dict(user.theme_by_mode or {})
    entry = dict(by_mode.get(app_mode) or {})
    if mode is not None:
        entry["mode"] = mode
    if theme_id is not None:
        entry["theme_id"] = theme_id or ""
    by_mode[app_mode] = entry
    # Reassign rather than mutate: SQLAlchemy does not track in-place edits to a
    # plain JSON column, so an in-place update would silently not persist.
    user.theme_by_mode = by_mode


def list_themes(
    app_mode: Optional[str] = None,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The user's installed themes and their selection in one app_mode."""
    active = _resolve_app_mode(app_mode)
    installed = (
        db.query(UserTheme)
        .filter_by(user_id=current_user.id)
        .order_by(UserTheme.name)
        .all()
    )
    user = db.query(User).filter_by(id=current_user.id).first()
    selection = (
        _selection_for(user, active) if user else {"mode": "dark", "theme_id": ""}
    )
    return {
        "installed": [_serialize(t) for t in installed],
        "app_mode": active,
        "app_modes": list(svc.APP_MODES),
        "built_in": svc.built_in_themes(active),
        **selection,
        "downloads_enabled": svc.downloads_enabled(),
        "index_url": svc.get_index_url(db),
        "default_index_url": config.DEFAULT_THEME_INDEX_URL,
        "is_custom_url": svc.is_custom_url(db),
    }


def browse_themes(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The community catalogue, marking the ones this user already has."""
    if not svc.downloads_enabled():
        raise HTTPException(403, "Downloading themes is disabled on this server")
    try:
        doc = svc.fetch_catalogue(db)
    except svc.ThemeError as exc:
        raise HTTPException(502, str(exc)) from exc

    owned = {
        t.theme_id
        for t in db.query(UserTheme).filter_by(user_id=current_user.id).all()
    }
    entries = svc.list_entries(doc)
    for entry in entries:
        entry["installed"] = entry["id"] in owned
    return {
        "themes": entries,
        "generated": str(doc.get("generated") or ""),
        "index_url": svc.get_index_url(db),
        "is_custom_url": svc.is_custom_url(db),
    }


def _upsert(db: Session, user_id: str, theme: dict, source: dict | None) -> UserTheme:
    """Install a theme, replacing the user's existing copy of the same id."""
    row = db.query(UserTheme).filter_by(user_id=user_id, theme_id=theme["id"]).first()
    if row is None:
        row = UserTheme(user_id=user_id, theme_id=theme["id"])
        db.add(row)
    row.name = theme["name"]
    row.mode = theme["mode"]
    row.app_mode = theme.get("app_mode") or svc.DEFAULT_APP_MODE
    row.variants = theme.get("variants") or {theme["mode"]: theme["tokens"]}
    row.tokens = theme["tokens"]
    row.source_id = (source or {}).get("id")
    row.source_url = (source or {}).get("url")
    row.source_version = (source or {}).get("version") or theme.get("version") or None
    return row


def install_theme(
    theme_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Download one theme from the catalogue into the user's account."""
    if not svc.downloads_enabled():
        raise HTTPException(403, "Downloading themes is disabled on this server")
    try:
        doc = svc.fetch_catalogue(db)
        entry = svc.find_entry(doc, theme_id)
        if entry is None:
            raise HTTPException(404, "That theme is not in the catalogue")
        theme = svc.fetch_theme(db, entry)
    except svc.ThemeError as exc:
        raise HTTPException(502, str(exc)) from exc

    row = _upsert(
        db,
        current_user.id,
        theme,
        {"id": theme_id, "url": svc.get_index_url(db), "version": entry.get("version")},
    )
    db.commit()
    db.refresh(row)
    return _serialize(row)


def import_theme(
    data: ThemeImport,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Install a theme the user pasted or uploaded.

    Works regardless of the download kill-switch: this is the air-gapped escape
    hatch, and nothing here touches the network.
    """
    try:
        theme = svc.parse_theme(data.model_dump())
    except svc.ThemeError as exc:
        raise HTTPException(400, str(exc)) from exc

    row = _upsert(db, current_user.id, theme, None)
    db.commit()
    db.refresh(row)
    return _serialize(row)


def delete_theme(
    theme_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Uninstall one of the user's themes."""
    row = db.query(UserTheme).filter_by(user_id=current_user.id, theme_id=theme_id).first()
    if row is None:
        raise HTTPException(404, "Theme not found")
    db.delete(row)

    # Deselect it everywhere, so the user is not left pointing at a theme they
    # no longer have — which would silently render as the built-in palette. It
    # may have been selected in more than one app_mode.
    user = db.query(User).filter_by(id=current_user.id).first()
    if user:
        if user.theme_id == theme_id:
            user.theme_id = None
        by_mode = {
            app_mode: entry
            for app_mode, entry in (user.theme_by_mode or {}).items()
        }
        changed = False
        for app_mode, entry in by_mode.items():
            if (entry or {}).get("theme_id") == theme_id:
                by_mode[app_mode] = {**entry, "theme_id": ""}
                changed = True
        if changed:
            user.theme_by_mode = by_mode
    db.commit()
    return {"ok": True}


def select_theme(
    data: ThemeSelection,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Set the user's mode and/or active theme."""
    user = db.query(User).filter_by(id=current_user.id).first()
    if not user:
        raise HTTPException(404, "User not found")

    active = _resolve_app_mode(data.app_mode)

    theme_id = None
    if data.theme_id is not None:
        wanted = data.theme_id.strip()
        if wanted and not svc.is_built_in(wanted, active):
            owned = (
                db.query(UserTheme)
                .filter_by(user_id=current_user.id, theme_id=wanted)
                .first()
            )
            if owned is None:
                raise HTTPException(404, "That theme is not installed")
        theme_id = wanted

    _set_selection(user, active, mode=data.mode, theme_id=theme_id)
    db.commit()
    return {"app_mode": active, **_selection_for(user, active)}


def set_theme_source(
    data: ThemeSourceUpdate,
    _: CurrentUser = Depends(require_admin),  # noqa: ARG001
    db: Session = Depends(get_db),
):
    """Point the catalogue at a fork or mirror. Server-wide, so admin-only."""
    if data.index_url is None:
        raise HTTPException(400, "index_url is required")

    row = db.query(AppSetting).filter_by(key=svc.SETTING_INDEX_URL).first()
    value = data.index_url.strip()
    if row is None:
        db.add(AppSetting(key=svc.SETTING_INDEX_URL, value=value))
    else:
        row.value = value
    db.commit()
    return {"index_url": svc.get_index_url(db), "is_custom_url": svc.is_custom_url(db)}
