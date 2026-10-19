"""The shared Content-Disposition builder, and the routes that name files after
things users choose."""
from backend.config import SessionLocal
from backend.http_headers import content_disposition
from backend.models import Campaign


def test_ascii_fallback_and_utf8_name():
    header = content_disposition('Mörk "Borg".png')
    assert header.startswith('attachment; filename="M?rk \'Borg\'.png"')
    assert "filename*=UTF-8''M%C3%B6rk%20%22Borg%22.png" in header


def test_inline_disposition():
    assert content_disposition("a.pdf", "inline") == 'inline; filename="a.pdf"'


def test_plain_ascii_name_has_no_extended_form():
    assert content_disposition("village.uvtt") == 'attachment; filename="village.uvtt"'


def test_control_characters_dropped():
    header = content_disposition("evil\r\nSet-Cookie: x=1.ics")
    assert header == 'attachment; filename="evilSet-Cookie: x=1.ics"'


def test_backslash_replaced_in_fallback():
    assert 'filename="a_b.txt"' in content_disposition("a\\b.txt")


def test_emoji_name_is_latin1_safe():
    header = content_disposition("🐉 Dragons.ics")
    header.encode("latin-1")
    assert "filename*=UTF-8''%F0%9F%90%89%20Dragons.ics" in header


def test_undecodable_library_name():
    # A name read with surrogateescape (see backend/filenames.py).
    header = content_disposition("M\udcd6RK.pdf")
    header.encode("latin-1")
    assert "filename*=UTF-8''M%D6RK.pdf" in header


def test_empty_name_falls_back():
    assert 'filename="download"' in content_disposition("\r\n")


def test_calendar_download_with_awkward_campaign_name(client, admin_headers):
    created = client.post(
        "/api/campaigns", json={"name": "Plain name"}, headers=admin_headers
    )
    assert created.status_code in (200, 201), created.text
    campaign_id = created.json()["id"]
    # Set the name directly: the API may refuse some of these characters, but a
    # name already stored must still download.
    db = SessionLocal()
    try:
        db.query(Campaign).filter_by(id=campaign_id).update({"name": '🐉 "Dragons"\r\n'})
        db.commit()
    finally:
        db.close()
    resp = client.get(f"/api/campaigns/{campaign_id}/calendar.ics", headers=admin_headers)
    assert resp.status_code == 200, resp.text
    assert "filename*=UTF-8''" in resp.headers["content-disposition"]
