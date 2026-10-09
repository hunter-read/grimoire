"""Tests for the admin-styleable OIDC login button (issue #377)."""
import io
import logging
from unittest.mock import patch

import pytest
from PIL import Image

from backend.services import oidc_button as svc

SVG = (
    b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 9">'
    b'<path fill="#4285F4" d="M0 0h18v9H0z"/><script>alert(1)</script></svg>'
)


def _png(size=(32, 32), mode="RGBA", color=(255, 0, 0, 255), fmt="PNG") -> bytes:
    buf = io.BytesIO()
    Image.new(mode, size, color).save(buf, format=fmt)
    return buf.getvalue()


def _open(png: bytes) -> Image.Image:
    img = Image.open(io.BytesIO(png))
    assert img.format == "PNG"
    return img


@pytest.fixture
def branding_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "BRANDING_DIR", str(tmp_path))
    svc._env_icon_cache.clear()
    return tmp_path


@pytest.fixture
def oidc_env(monkeypatch):
    """A mutable copy of OIDC_ENV patched into every module that reads it."""
    import backend.routers.oidc.button_icon as icon_router
    import backend.routers.settings._helpers as helpers
    import backend.routers.settings.core as core
    import backend.routers.settings.oidc_button as settings_icon

    env = dict(core.OIDC_ENV)
    for mod in (core, helpers, settings_icon, icon_router):
        monkeypatch.setattr(mod, "OIDC_ENV", env)
    return env


@pytest.fixture
def oidc_configured(client, admin_headers):
    client.patch(
        "/api/settings",
        headers=admin_headers,
        json={
            "oidc_enabled": True,
            "oidc_issuer_url": "https://idp.example.com/realm",
            "oidc_client_id": "grimoire",
            "oidc_client_secret": "abc123",
        },
    )
    yield
    client.delete("/api/settings/oidc-button-icon", headers=admin_headers)
    client.patch(
        "/api/settings",
        headers=admin_headers,
        json={
            "oidc_enabled": False,
            "oidc_issuer_url": "",
            "oidc_client_id": "",
            "oidc_client_secret": "__CLEAR__",
            "oidc_button_bg_color": "",
            "oidc_button_text_color": "",
            "oidc_button_border_color": "",
            "oidc_button_radius": "",
        },
    )


def _upload(client, headers, data: bytes, name="icon.png", ctype="image/png"):
    return client.post(
        "/api/settings/oidc-button-icon",
        headers=headers,
        files={"file": (name, data, ctype)},
    )


# ---------------------------------------------------------------------------
# Style value validation
# ---------------------------------------------------------------------------


class TestStyleValues:
    @pytest.mark.parametrize(
        "value,expected",
        [
            ("#FFF", "#fff"),
            ("#ffff", "#ffff"),
            (" #131314 ", "#131314"),
            ("#5865F2CC", "#5865f2cc"),
            ("", ""),
            (None, ""),
        ],
    )
    def test_valid_colors(self, value, expected):
        assert svc.normalize_color(value) == expected

    @pytest.mark.parametrize(
        "value",
        ["red", "#12", "#12345", "#1234567", "#ggg", "#fff;background:url(x)", "rgb(0,0,0)"],
    )
    def test_invalid_colors(self, value):
        assert svc.normalize_color(value) is None

    @pytest.mark.parametrize("value,expected", [("8", "8"), ("08", "8"), ("0", "0"), ("40", "40"), ("", "")])
    def test_valid_radius(self, value, expected):
        assert svc.normalize_radius(value) == expected

    @pytest.mark.parametrize("value", ["41", "-1", "1.5", "8px", "abc"])
    def test_invalid_radius(self, value):
        assert svc.normalize_radius(value) is None


# ---------------------------------------------------------------------------
# Icon normalization
# ---------------------------------------------------------------------------


class TestNormalizeIcon:
    def test_large_png_is_downscaled(self):
        img = _open(svc.normalize_icon(_png((800, 400))))
        assert img.size == (svc.ICON_SIZE_PX, svc.ICON_SIZE_PX // 2)
        assert img.mode == "RGBA"

    def test_small_image_kept_at_its_size(self):
        assert _open(svc.normalize_icon(_png((20, 20)))).size == (20, 20)

    def test_jpeg_and_webp_become_png(self):
        for fmt in ("JPEG", "WEBP"):
            src = _png((50, 50), mode="RGB", color=(0, 0, 255), fmt=fmt)
            assert _open(svc.normalize_icon(src)).size == (50, 50)

    def test_animated_gif_uses_first_frame(self):
        frames = [Image.new("RGB", (16, 16), c) for c in ((255, 0, 0), (0, 255, 0))]
        buf = io.BytesIO()
        frames[0].save(buf, format="GIF", save_all=True, append_images=frames[1:])
        img = _open(svc.normalize_icon(buf.getvalue()))
        assert img.getpixel((8, 8))[:3] == (255, 0, 0)

    def test_svg_is_rasterized_without_its_markup(self):
        png = svc.normalize_icon(SVG)
        img = _open(png)
        assert img.size == (svc.ICON_SIZE_PX, svc.ICON_SIZE_PX // 2)
        assert b"script" not in png
        assert img.getpixel((10, 10))[3] == 255  # the path was drawn

    def test_svg_with_xml_declaration_and_bom(self):
        src = b"\xef\xbb\xbf<?xml version='1.0'?>\n" + SVG
        assert _open(svc.normalize_icon(src)).size[0] == svc.ICON_SIZE_PX

    def test_svg_doctype_rejected(self):
        src = b'<!DOCTYPE svg [<!ENTITY x "y">]>' + SVG
        with pytest.raises(svc.IconError, match="DOCTYPE"):
            svc.normalize_icon(src)

    def test_svg_render_failure_is_icon_error(self):
        with patch("fitz.open", side_effect=RuntimeError("boom")):
            with pytest.raises(svc.IconError, match="Could not render SVG"):
                svc.normalize_icon(SVG)

    def test_svg_without_size_rejected(self):
        class _Page:
            class rect:
                width = 0
                height = 0

        class _Doc:
            def __getitem__(self, _):
                return _Page()

            def close(self):
                pass

        with patch("fitz.open", return_value=_Doc()):
            with pytest.raises(svc.IconError, match="no size"):
                svc.normalize_icon(SVG)

    def test_empty_rejected(self):
        with pytest.raises(svc.IconError, match="Empty"):
            svc.normalize_icon(b"")

    def test_garbage_rejected(self):
        with pytest.raises(svc.IconError, match="not a valid image"):
            svc.normalize_icon(b"definitely not an image")

    def test_unsupported_format_rejected(self):
        with pytest.raises(svc.IconError, match="Unsupported"):
            svc.normalize_icon(_png((8, 8), mode="RGB", color=(0, 0, 0), fmt="BMP"))

    def test_oversized_dimensions_rejected(self):
        with pytest.raises(svc.IconError, match="too large"):
            svc.normalize_icon(_png((5000, 4000), mode="1", color=0))

    def test_truncated_image_rejected(self):
        with pytest.raises(svc.IconError, match="not a valid image"):
            svc.normalize_icon(_png((64, 64))[:80])


# ---------------------------------------------------------------------------
# Storage and the effective icon
# ---------------------------------------------------------------------------


class TestIconStorage:
    def test_store_then_current_then_remove(self, branding_dir):
        png = svc.normalize_icon(_png())
        version = svc.store_icon(png)
        assert version == svc.icon_version(png)
        assert svc.current_icon(version, None) == (png, version)
        assert list(branding_dir.iterdir()) == [branding_dir / svc.ICON_FILENAME]
        svc.remove_icon()
        assert svc.current_icon(version, None) is None
        svc.remove_icon()  # idempotent

    def test_no_stored_version_means_no_icon(self, branding_dir):
        svc.store_icon(svc.normalize_icon(_png()))
        assert svc.current_icon("", None) is None

    def test_failed_write_leaves_no_temp_file(self, branding_dir):
        with patch("os.replace", side_effect=OSError("disk full")):
            with pytest.raises(OSError):
                svc.store_icon(b"png")
        assert list(branding_dir.iterdir()) == []

    def test_env_icon_wins_over_upload(self, branding_dir, tmp_path):
        svc.store_icon(svc.normalize_icon(_png(color=(255, 0, 0, 255))))
        pinned = tmp_path / "pinned.svg"
        pinned.write_bytes(SVG)
        png, version = svc.current_icon("anything", str(pinned))
        assert _open(png).size[0] == svc.ICON_SIZE_PX
        assert version == svc.icon_version(png)

    def test_env_icon_is_cached_until_file_changes(self, branding_dir, tmp_path):
        pinned = tmp_path / "pinned.png"
        pinned.write_bytes(_png((10, 10)))
        with patch.object(svc, "normalize_icon", wraps=svc.normalize_icon) as spy:
            first = svc.current_icon("", str(pinned))
            second = svc.current_icon("", str(pinned))
            assert first == second and spy.call_count == 1
            pinned.write_bytes(_png((12, 12)))
            third = svc.current_icon("", str(pinned))
        assert spy.call_count == 2
        assert _open(third[0]).size == (12, 12)

    def test_env_icon_empty_pins_no_icon(self, branding_dir):
        svc.store_icon(svc.normalize_icon(_png()))
        assert svc.current_icon("v", "") is None

    def test_env_icon_missing_file(self, branding_dir, caplog):
        with caplog.at_level(logging.WARNING, logger="grimoire.oidc"):
            assert svc.current_icon("", "/no/such/icon.png") is None
        assert "could not be read" in caplog.text

    def test_env_icon_invalid_file(self, branding_dir, tmp_path, caplog):
        bad = tmp_path / "bad.png"
        bad.write_bytes(b"nope")
        with caplog.at_level(logging.WARNING, logger="grimoire.oidc"):
            assert svc.current_icon("", str(bad)) is None
            assert svc.current_icon("", str(bad)) is None
        assert caplog.text.count("not a usable image") == 1  # warned once

    def test_env_icon_too_large(self, branding_dir, tmp_path, caplog, monkeypatch):
        monkeypatch.setattr(svc, "MAX_ICON_UPLOAD_BYTES", 10)
        big = tmp_path / "big.png"
        big.write_bytes(_png())
        with caplog.at_level(logging.WARNING, logger="grimoire.oidc"):
            assert svc.current_icon("", str(big)) is None
        assert "larger than 1 MB" in caplog.text


# ---------------------------------------------------------------------------
# Settings API
# ---------------------------------------------------------------------------


class TestSettingsAPI:
    def test_defaults(self, client, admin_headers):
        body = client.get("/api/settings", headers=admin_headers).json()
        for key in ("bg_color", "text_color", "border_color", "radius", "icon_url"):
            assert body[f"oidc_button_{key}"] == ""
            if key != "icon_url":
                assert body[f"oidc_button_{key}_env_locked"] is False
        assert body["oidc_button_icon_env_locked"] is False

    def test_patch_style_canonicalizes(self, client, admin_headers, oidc_configured):
        resp = client.patch(
            "/api/settings",
            headers=admin_headers,
            json={
                "oidc_button_bg_color": "#131314",
                "oidc_button_text_color": "#E3E3E3",
                "oidc_button_border_color": " #8E918F ",
                "oidc_button_radius": "08",
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["oidc_button_bg_color"] == "#131314"
        assert body["oidc_button_text_color"] == "#e3e3e3"
        assert body["oidc_button_border_color"] == "#8e918f"
        assert body["oidc_button_radius"] == "8"

    @pytest.mark.parametrize(
        "payload",
        [
            {"oidc_button_bg_color": "red"},
            {"oidc_button_text_color": "#fff; position: fixed"},
            {"oidc_button_border_color": "url(javascript:x)"},
            {"oidc_button_radius": "999"},
            {"oidc_button_radius": "4px"},
        ],
    )
    def test_patch_rejects_invalid_style(self, client, admin_headers, payload):
        resp = client.patch("/api/settings", headers=admin_headers, json=payload)
        assert resp.status_code == 400

    def test_style_env_lock(self, client, admin_headers, oidc_env):
        oidc_env["oidc_button_bg_color"] = "#5865F2"
        resp = client.patch(
            "/api/settings", headers=admin_headers, json={"oidc_button_bg_color": "#000000"}
        )
        assert resp.status_code == 400
        body = client.get("/api/settings", headers=admin_headers).json()
        assert body["oidc_button_bg_color"] == "#5865f2"
        assert body["oidc_button_bg_color_env_locked"] is True

    def test_invalid_env_style_degrades_to_default(self, client, admin_headers, oidc_env):
        oidc_env["oidc_button_bg_color"] = "blue"
        oidc_env["oidc_button_radius"] = "huge"
        body = client.get("/api/settings", headers=admin_headers).json()
        assert body["oidc_button_bg_color"] == ""
        assert body["oidc_button_radius"] == ""

    def test_invalid_env_style_warns(self, oidc_env, caplog):
        import backend.routers.settings._helpers as helpers

        oidc_env["oidc_button_text_color"] = "white"
        oidc_env["oidc_button_radius"] = "-3"
        with caplog.at_level(logging.WARNING, logger="grimoire.oidc"):
            helpers._warn_invalid_button_env()
        assert "OIDC_BUTTON_TEXT_COLOR" in caplog.text
        assert "OIDC_BUTTON_RADIUS" in caplog.text

    def test_upload_and_delete_icon(self, client, admin_headers, branding_dir):
        resp = _upload(client, admin_headers, _png((300, 300)))
        assert resp.status_code == 200, resp.text
        url = resp.json()["oidc_button_icon_url"]
        assert url.startswith("/api/auth/openid/button-icon?v=")
        assert _open((branding_dir / svc.ICON_FILENAME).read_bytes()).size == (192, 192)

        resp = client.delete("/api/settings/oidc-button-icon", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.json()["oidc_button_icon_url"] == ""
        assert not (branding_dir / svc.ICON_FILENAME).exists()

    def test_upload_svg(self, client, admin_headers, branding_dir):
        resp = _upload(client, admin_headers, SVG, name="logo.svg", ctype="image/svg+xml")
        assert resp.status_code == 200, resp.text
        assert b"script" not in (branding_dir / svc.ICON_FILENAME).read_bytes()
        client.delete("/api/settings/oidc-button-icon", headers=admin_headers)

    def test_upload_rejects_non_image(self, client, admin_headers, branding_dir):
        resp = _upload(client, admin_headers, b"<html></html>", name="x.html", ctype="text/html")
        assert resp.status_code == 400
        assert not (branding_dir / svc.ICON_FILENAME).exists()

    def test_upload_rejects_too_large(self, client, admin_headers, branding_dir):
        resp = _upload(client, admin_headers, b"0" * (svc.MAX_ICON_UPLOAD_BYTES + 1))
        assert resp.status_code == 413

    def test_upload_and_delete_blocked_by_env_lock(
        self, client, admin_headers, branding_dir, oidc_env
    ):
        oidc_env["oidc_button_icon"] = ""
        assert _upload(client, admin_headers, _png()).status_code == 400
        resp = client.delete("/api/settings/oidc-button-icon", headers=admin_headers)
        assert resp.status_code == 400
        body = client.get("/api/settings", headers=admin_headers).json()
        assert body["oidc_button_icon_env_locked"] is True

    def test_non_admin_cannot_upload(self, client, player_headers, branding_dir):
        assert _upload(client, player_headers, _png()).status_code == 403
        resp = client.delete("/api/settings/oidc-button-icon", headers=player_headers)
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Public login-page surface
# ---------------------------------------------------------------------------


class TestPublicSurface:
    def test_auth_config_hides_style_until_configured(self, client, admin_headers):
        client.patch(
            "/api/settings", headers=admin_headers, json={"oidc_button_bg_color": "#000000"}
        )
        body = client.get("/api/auth/config").json()
        assert body["oidc_button_bg_color"] == ""
        assert body["oidc_button_radius"] is None
        assert body["oidc_button_icon_url"] == ""
        client.patch("/api/settings", headers=admin_headers, json={"oidc_button_bg_color": ""})

    def test_auth_config_exposes_style(self, client, admin_headers, oidc_configured, branding_dir):
        client.patch(
            "/api/settings",
            headers=admin_headers,
            json={
                "oidc_button_bg_color": "#24292f",
                "oidc_button_text_color": "#ffffff",
                "oidc_button_border_color": "#24292f",
                "oidc_button_radius": "6",
            },
        )
        _upload(client, admin_headers, _png())
        body = client.get("/api/auth/config").json()
        assert body["oidc_button_bg_color"] == "#24292f"
        assert body["oidc_button_text_color"] == "#ffffff"
        assert body["oidc_button_border_color"] == "#24292f"
        assert body["oidc_button_radius"] == 6
        assert body["oidc_button_icon_url"].startswith("/api/auth/openid/button-icon?v=")

    def test_auth_config_unset_radius_is_null(self, client, oidc_configured):
        assert client.get("/api/auth/config").json()["oidc_button_radius"] is None

    def test_icon_served_before_oidc_is_configured(self, client, admin_headers, branding_dir):
        # The settings preview needs it mid-setup; /api/auth/config still hides it.
        _upload(client, admin_headers, _png())
        assert client.get("/api/auth/openid/button-icon").status_code == 200
        assert client.get("/api/auth/config").json()["oidc_button_icon_url"] == ""
        client.delete("/api/settings/oidc-button-icon", headers=admin_headers)

    def test_icon_404_without_icon(self, client, oidc_configured, branding_dir):
        assert client.get("/api/auth/openid/button-icon").status_code == 404

    def test_serves_icon_publicly_with_locked_down_headers(
        self, client, admin_headers, oidc_configured, branding_dir
    ):
        url = _upload(client, admin_headers, _png()).json()["oidc_button_icon_url"]
        client.cookies.clear()
        resp = client.get(url)  # no credentials: the login page is pre-auth
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/png"
        assert resp.headers["x-content-type-options"] == "nosniff"
        assert "default-src 'none'" in resp.headers["content-security-policy"]
        assert "immutable" in resp.headers["cache-control"]
        _open(resp.content)

        stale = client.get("/api/auth/openid/button-icon?v=old")
        assert stale.headers["cache-control"] == "no-cache"

        etag = resp.headers["etag"]
        cached = client.get(
            "/api/auth/openid/button-icon", headers={"If-None-Match": etag}
        )
        assert cached.status_code == 304
        assert cached.content == b""

    def test_serves_env_pinned_icon(
        self, client, oidc_configured, branding_dir, oidc_env, tmp_path
    ):
        pinned = tmp_path / "pinned.svg"
        pinned.write_bytes(SVG)
        oidc_env["oidc_button_icon"] = str(pinned)
        url = client.get("/api/auth/config").json()["oidc_button_icon_url"]
        assert url
        resp = client.get(url)
        assert resp.status_code == 200
        assert _open(resp.content).size[0] == svc.ICON_SIZE_PX
