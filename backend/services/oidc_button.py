"""Admin-styleable OIDC login button (issue #377).

Grimoire deliberately ships no provider-specific sign-in buttons: there are
dozens of IdPs, each with its own (changing) branding rules. Instead the admin
describes the button - background, text and border colors, corner radius, and
an icon - and the login page renders whatever they configured. That is enough
to reproduce Google's, GitHub's, Discord's, or anyone else's standard button.

Everything here is about doing that safely, because the result is rendered on
the pre-auth login page to every visitor:

* Colors must be strict CSS hex (``#rgb``, ``#rgba``, ``#rrggbb``,
  ``#rrggbbaa``) and the radius a small integer, so no setting can smuggle
  arbitrary CSS into a style attribute.
* Icons never reach the browser in the form they were uploaded. Raster images
  are decoded and re-encoded with Pillow; SVGs are rasterized with MuPDF (which
  runs no script and ignores external references). Either way the stored and
  served file is a small, metadata-free PNG, so an uploaded SVG can never
  become a stored-XSS payload when opened directly.
"""

import hashlib
import io
import logging
import os
import re
import tempfile
from typing import Optional

from ..config import BRANDING_DIR

logger = logging.getLogger("grimoire.oidc")

# Largest upload accepted. Official logo files are a few KB; this is generous.
MAX_ICON_UPLOAD_BYTES = 1024 * 1024
# The stored PNG's longest side. The button draws the icon at ~20 CSS px, so
# this stays sharp up to ~10x device pixel ratio while keeping the file tiny.
ICON_SIZE_PX = 192
# Refuse to decode anything bigger than this many pixels (decompression bombs).
_MAX_SOURCE_PIXELS = 4096 * 4096
_RASTER_FORMATS = {"PNG", "JPEG", "WEBP", "GIF"}

ICON_FILENAME = "oidc_button_icon.png"

_HEX_COLOR_RE = re.compile(r"^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$")
MAX_RADIUS_PX = 40


class IconError(ValueError):
    """The uploaded file is not an image we can turn into a button icon."""


# ---------------------------------------------------------------------------
# Style values
# ---------------------------------------------------------------------------


def normalize_color(value: Optional[str]) -> Optional[str]:
    """Return a canonical hex color, ``""`` for unset, or None when invalid."""
    v = (value or "").strip().lower()
    if not v:
        return ""
    return v if _HEX_COLOR_RE.match(v) else None


def normalize_radius(value: Optional[str]) -> Optional[str]:
    """Return the radius as a decimal string, ``""`` for unset, or None when invalid."""
    v = (value or "").strip()
    if not v:
        return ""
    if not v.isdigit() or int(v) > MAX_RADIUS_PX:
        return None
    return str(int(v))


# ---------------------------------------------------------------------------
# Icon normalization
# ---------------------------------------------------------------------------


def _looks_like_svg(data: bytes) -> bool:
    head = data[:2048].lstrip().lower()
    if head.startswith(b"\xef\xbb\xbf"):
        head = head[3:].lstrip()
    return head.startswith(b"<") and b"<svg" in data[:65536].lower()


def _rasterize_svg(data: bytes) -> bytes:
    """Render an SVG to a PNG whose longest side is ICON_SIZE_PX."""
    import fitz  # PyMuPDF

    # MuPDF does not expand custom entities, but there is no reason for an icon
    # to declare any; refusing them up front keeps the parser surface minimal.
    if b"<!doctype" in data.lower() or b"<!entity" in data.lower():
        raise IconError("SVG files with a DOCTYPE or entity declarations are not supported")
    try:
        doc = fitz.open(stream=data, filetype="svg")
        try:
            page = doc[0]
            width, height = page.rect.width, page.rect.height
            if width <= 0 or height <= 0:
                raise IconError("SVG has no size")
            scale = ICON_SIZE_PX / max(width, height)
            pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=True)
            return pix.tobytes("png")
        finally:
            doc.close()
    except IconError:
        raise
    except Exception as e:
        raise IconError(f"Could not render SVG: {e}") from e


def normalize_icon(data: bytes) -> bytes:
    """Turn uploaded image bytes into a small, freshly encoded PNG.

    Raises IconError when the bytes are not a supported image.
    """
    from PIL import Image

    if not data:
        raise IconError("Empty file")
    if _looks_like_svg(data):
        data = _rasterize_svg(data)

    try:
        img = Image.open(io.BytesIO(data))
    except Exception as e:
        raise IconError("File is not a valid image") from e
    if img.format not in _RASTER_FORMATS:
        raise IconError(f"Unsupported image format: {img.format}")
    width, height = img.size
    if width <= 0 or height <= 0 or width * height > _MAX_SOURCE_PIXELS:
        raise IconError("Image dimensions are too large")
    try:
        img.seek(0)  # first frame of an animated GIF/WebP
        img = img.convert("RGBA")
        img.thumbnail((ICON_SIZE_PX, ICON_SIZE_PX), Image.Resampling.LANCZOS)
        out = io.BytesIO()
        img.save(out, format="PNG", optimize=True)
    except Exception as e:
        raise IconError("File is not a valid image") from e
    return out.getvalue()


def icon_version(png: bytes) -> str:
    """A short content hash, used to cache-bust the icon URL."""
    return hashlib.sha256(png).hexdigest()[:16]


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------


def _icon_path() -> str:
    return os.path.join(BRANDING_DIR, ICON_FILENAME)


def store_icon(png: bytes) -> str:
    """Atomically write the normalized icon; return its version."""
    os.makedirs(BRANDING_DIR, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=BRANDING_DIR, suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(png)
        os.replace(tmp, _icon_path())
    except BaseException:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise
    return icon_version(png)


def remove_icon() -> None:
    """Delete the uploaded icon, if any."""
    try:
        os.remove(_icon_path())
    except FileNotFoundError:
        pass


# Normalized env-pinned icons, keyed by (path, mtime_ns, size) so editing the
# file on disk is picked up without a restart. None records a failed load so a
# broken file is warned about once, not on every login-page view.
_env_icon_cache: dict[tuple[str, int, int], Optional[bytes]] = {}


def _load_env_icon(path: str) -> Optional[bytes]:
    try:
        st = os.stat(path)
    except OSError as e:
        logger.warning("OIDC_BUTTON_ICON %s could not be read: %s", path, e)
        return None
    key = (path, st.st_mtime_ns, st.st_size)
    if key in _env_icon_cache:
        return _env_icon_cache[key]
    png: Optional[bytes] = None
    if st.st_size > MAX_ICON_UPLOAD_BYTES:
        logger.warning("OIDC_BUTTON_ICON %s is larger than 1 MB; ignoring it", path)
    else:
        try:
            with open(path, "rb") as f:
                png = normalize_icon(f.read())
        except (OSError, IconError) as e:
            logger.warning("OIDC_BUTTON_ICON %s is not a usable image: %s", path, e)
    _env_icon_cache.clear()  # only ever one pinned icon worth keeping
    _env_icon_cache[key] = png
    return png


def current_icon(stored_version: str, env_path: Optional[str]) -> Optional[tuple[bytes, str]]:
    """Return ``(png, version)`` for the effective icon, or None when there is none.

    ``env_path`` (OIDC_BUTTON_ICON) wins over the uploaded icon, matching how
    every other OIDC setting is pinned. An empty env value pins "no icon".
    """
    if env_path is not None:
        png = _load_env_icon(env_path) if env_path.strip() else None
        return (png, icon_version(png)) if png else None
    if not stored_version:
        return None
    try:
        with open(_icon_path(), "rb") as f:
            png = f.read()
    except OSError:
        return None
    # Hash the bytes actually on disk rather than trusting the stored version,
    # so a URL can never pair one version with another upload's file.
    return (png, icon_version(png)) if png else None
