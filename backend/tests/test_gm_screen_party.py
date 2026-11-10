"""The party overview's small rules: which values travel, and portraits.

The routes are covered in ``test_gm_screen_api.py``; these pin the edges a
real sheet rarely reaches - an infinite number, a malformed crop, a portrait
file that has gone missing.
"""
import math

from backend.services.gm_screen import party


def test_only_scalar_values_travel():
    assert party._scalar(True) is True
    assert party._scalar(3) == 3
    assert party._scalar(2.5) == 2.5
    assert party._scalar(math.inf) is None
    assert party._scalar("x" * 500) == "x" * party._MAX_TEXT
    assert party._scalar([1, 2]) is None
    assert party._scalar(None) is None


def test_a_crop_is_rechecked_on_the_way_out():
    assert party._portrait_crop({"x": 10, "y": 90, "zoom": 2}) == {"x": 10.0, "y": 90.0, "zoom": 2.0}
    assert party._portrait_crop({"x": 10, "y": 90, "zoom": 9}) is None
    assert party._portrait_crop({"x": "left"}) is None
    assert party._portrait_crop(None) is None


def test_a_portrait_version_follows_the_file(tmp_path, monkeypatch):
    monkeypatch.setattr(party, "CHARACTER_PORTRAIT_DIR", str(tmp_path))
    assert party._portrait_version(None) is None
    assert party._portrait_version("gone.png") is None
    (tmp_path / "here.png").write_bytes(b"png")
    assert isinstance(party._portrait_version("here.png"), int)


def test_a_label_falls_back_to_the_name():
    assert party._label("hp", {"label": "  Hit Points "}) == "Hit Points"
    assert party._label("hp", {"label": ""}) == "hp"
    assert party._label("hp", "formula") == "hp"


def test_an_empty_campaign_has_no_party(client):
    from backend.config import SessionLocal

    db = SessionLocal()
    try:
        assert party.party_overview(db, "no-such-campaign", "nobody") == {"characters": [], "fields": []}
    finally:
        db.close()
