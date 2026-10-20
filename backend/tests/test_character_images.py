"""Tests for a sheet's `image` fields, and the portrait's framing (issue #577).

An image field's value names a file only the image routes write, so most of
what is checked here is that nothing else can set it, that the file goes when
its value does, and that the picture travels with an export and a backup.
"""
import base64
import io
import os

import pytest

from backend.config import CHARACTER_IMAGE_DIR, CHARACTER_PORTRAIT_DIR, SessionLocal
from backend.models import Campaign, CampaignMember, Character
from backend.services import characters as svc
from backend.services.characters import images
from backend.services.characters.schema import IMAGE_VALUE_RE, image_fields


SCHEMA = {
    "id": "heraldry",
    "name": "Heraldry",
    "fields": {
        "name": {"type": "text", "label": "Name"},
        "coat_of_arms": {"type": "image", "label": "Coat of Arms"},
        "banner": {"type": "image", "label": "Banner"},
    },
}


def _png(colour: str = "red") -> bytes:
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (4, 4), colour).save(buffer, format="PNG")
    return buffer.getvalue()


def _data_url(raw: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(raw).decode("ascii")


@pytest.fixture(autouse=True)
def _clean():
    yield
    db = SessionLocal()
    try:
        db.query(Character).delete()
        db.commit()
    finally:
        db.close()


@pytest.fixture
def sheet(client, admin_headers, gm_headers):
    for headers in (admin_headers, gm_headers):
        resp = client.post("/api/characters/schemas", json={"document": SCHEMA}, headers=headers)
        assert resp.status_code == 200, resp.text
    yield
    for headers in (admin_headers, gm_headers):
        client.delete("/api/characters/schemas/heraldry", headers=headers)


@pytest.fixture
def knight(client, admin_headers, sheet):
    return client.post(
        "/api/characters", json={"schema_ref": "heraldry", "name": "Sir Test"}, headers=admin_headers
    ).json()


def _upload(client, headers, character_id, field="coat_of_arms", raw=None, kind="image/png"):
    return client.post(
        f"/api/characters/{character_id}/images/{field}",
        files={"file": ("arms.png", raw if raw is not None else _png(), kind)},
        headers=headers,
    )


def _files(character_id):
    directory = os.path.join(CHARACTER_IMAGE_DIR, character_id)
    return sorted(os.listdir(directory)) if os.path.isdir(directory) else []


# --- schema validation -----------------------------------------------------


def _doc(**overrides):
    document = {"id": "img", "name": "Img", "fields": {"arms": {"type": "image"}}}
    document.update(overrides)
    return document


class TestValidation:
    def test_an_image_field_is_accepted(self):
        validated = svc.validate_schema(_doc())
        assert validated["fields"]["arms"]["type"] == "image"
        assert image_fields(validated) == {"arms"}

    def test_image_fields_of_nothing_is_empty(self):
        assert image_fields(None) == set()
        assert image_fields({"fields": []}) == set()

    def test_an_image_cannot_be_a_list_column(self):
        with pytest.raises(svc.SchemaError, match="unknown type 'image'"):
            svc.validate_schema(_doc(fields={
                "gear": {"type": "list", "columns": [{"key": "pic", "type": "image"}]}
            }))

    def test_an_image_cannot_be_a_content_type_property(self):
        with pytest.raises(svc.SchemaError, match="only a character's own fields"):
            svc.validate_schema(_doc(content_types={
                "item": {"fields": {"name": {"type": "text"}, "pic": {"type": "image"}}}
            }))

    def test_an_image_cannot_be_a_per_entry_field(self):
        with pytest.raises(svc.SchemaError, match="only a character's own fields"):
            svc.validate_schema(_doc(
                content_types={"item": {"fields": {"name": {"type": "text"}}}},
                fields={"items": {
                    "type": "content_list", "content_type": "item",
                    "per_entry_fields": {"pic": {"type": "image"}},
                }},
            ))

    @pytest.mark.parametrize("key", ["default", "default_from"])
    def test_an_image_has_no_default(self, key):
        with pytest.raises(svc.SchemaError, match=f"cannot have a '{key}'"):
            svc.validate_schema(_doc(fields={"arms": {"type": "image", key: "x"}}))

    def test_a_formula_cannot_read_an_image(self):
        with pytest.raises(svc.SchemaError, match="Computed 'x' reads the image field arms"):
            svc.validate_schema(_doc(computed={"x": {"formula": "len(arms)"}}))

    def test_a_condition_cannot_read_an_image(self):
        with pytest.raises(svc.SchemaError, match="visible_if reads the image field"):
            svc.validate_schema(_doc(fields={
                "arms": {"type": "image"},
                "motto": {"type": "text", "visible_if": "arms"},
            }))

    def test_a_validator_cannot_read_images(self):
        with pytest.raises(svc.SchemaError, match="reads the image fields arms, flag"):
            svc.validate_schema(_doc(
                fields={"arms": {"type": "image"}, "flag": {"type": "image"}},
                validators=[{"rule": "arms and flag", "message": "m"}],
            ))

    def test_a_default_from_cannot_read_an_image(self):
        with pytest.raises(svc.SchemaError, match="default_from reads the image field"):
            svc.validate_schema(_doc(fields={
                "arms": {"type": "image"},
                "motto": {"type": "text", "default_from": "arms"},
            }))

    def test_a_layout_section_cannot_hinge_on_an_image(self):
        with pytest.raises(svc.SchemaError, match="Layout section 0 visible_if reads"):
            svc.validate_schema(_doc(layout=[{"title": "A", "visible_if": "arms", "fields": ["arms"]}]))

    def test_a_layout_may_place_an_image(self):
        validated = svc.validate_schema(_doc(layout_html='<div><g-field name="arms"/><g-portrait/></div>'))
        tags = [child["tag"] for child in validated["layout_ast"][0]["children"]]
        assert tags == ["g-field", "g-portrait"]

    def test_g_portrait_takes_no_name(self):
        with pytest.raises(svc.SchemaError, match="'name' is not allowed on <g-portrait>"):
            svc.validate_schema(_doc(layout_html='<g-portrait name="arms"/>'))


class TestCoercion:
    def test_keeps_a_name_this_server_wrote(self):
        value = "arms-0123456789abcdef.png"
        assert svc.coerce_value({"type": "image"}, value) == value

    @pytest.mark.parametrize("value", [
        "../../etc/passwd", "arms.png", "https://example.com/a.png", None, 5,
        "arms-0123456789abcdef.svg",
    ])
    def test_anything_else_is_no_image(self, value):
        assert svc.coerce_value({"type": "image"}, value) == ""

    def test_an_image_reads_as_empty_in_formulas(self):
        document = svc.validate_schema(_doc(fields={"arms": {"type": "image"}, "n": {"type": "number"}},
                                            computed={"t": {"formula": "n + 1"}}))
        assert svc.compute_values(document, {}) == {"t": 1}


# --- the routes ------------------------------------------------------------


class TestUploadServeRemove:
    def test_round_trip(self, client, admin_headers, knight):
        resp = _upload(client, admin_headers, knight["id"])
        assert resp.status_code == 200, resp.text
        value = resp.json()["value"]
        assert resp.json()["field"] == "coat_of_arms"
        assert IMAGE_VALUE_RE.match(value) and value.startswith("coat_of_arms-")

        detail = client.get(f"/api/characters/{knight['id']}", headers=admin_headers).json()
        assert detail["data"]["coat_of_arms"] == value

        served = client.get(f"/api/characters/{knight['id']}/images/coat_of_arms", headers=admin_headers)
        assert served.status_code == 200
        assert served.content == _png()

        removed = client.delete(f"/api/characters/{knight['id']}/images/coat_of_arms",
                                headers=admin_headers)
        assert removed.status_code == 200
        assert _files(knight["id"]) == []
        detail = client.get(f"/api/characters/{knight['id']}", headers=admin_headers).json()
        assert "coat_of_arms" not in detail["data"]
        assert client.get(f"/api/characters/{knight['id']}/images/coat_of_arms",
                          headers=admin_headers).status_code == 404

    def test_replacing_changes_the_name_and_drops_the_old_file(self, client, admin_headers, knight):
        first = _upload(client, admin_headers, knight["id"]).json()["value"]
        second = _upload(client, admin_headers, knight["id"], raw=_png("blue")).json()["value"]
        assert first != second
        assert _files(knight["id"]) == [second]

    def test_fields_keep_their_own_files(self, client, admin_headers, knight):
        arms = _upload(client, admin_headers, knight["id"]).json()["value"]
        banner = _upload(client, admin_headers, knight["id"], field="banner").json()["value"]
        assert _files(knight["id"]) == sorted([arms, banner])

    def test_a_field_that_is_not_an_image_is_refused(self, client, admin_headers, knight):
        assert _upload(client, admin_headers, knight["id"], field="name").status_code == 404
        assert _upload(client, admin_headers, knight["id"], field="nope").status_code == 404
        assert _upload(client, admin_headers, knight["id"], field="bad-name").status_code == 404
        assert client.delete(f"/api/characters/{knight['id']}/images/name",
                             headers=admin_headers).status_code == 404

    def test_the_type_is_checked(self, client, admin_headers, knight):
        resp = _upload(client, admin_headers, knight["id"], kind="image/svg+xml")
        assert resp.status_code == 400
        assert resp.json()["detail"].startswith("An image must be one of")

    def test_the_bytes_must_be_an_image(self, client, admin_headers, knight):
        assert _upload(client, admin_headers, knight["id"], raw=b"MZ not a png").status_code == 400

    def test_the_size_is_capped(self, client, admin_headers, knight, monkeypatch):
        from backend.routers.characters import portraits

        monkeypatch.setattr(portraits, "MAX_PORTRAIT_BYTES", 10)
        resp = _upload(client, admin_headers, knight["id"])
        assert resp.status_code == 413
        assert resp.json()["detail"].startswith("An image may be at most")

    def test_a_character_without_its_sheet_has_no_image_fields(self, client, admin_headers, knight):
        client.delete("/api/characters/schemas/heraldry", headers=admin_headers)
        assert _upload(client, admin_headers, knight["id"]).status_code == 404

    def test_a_sheet_edit_cannot_set_or_reset_an_image(self, client, admin_headers, knight):
        value = _upload(client, admin_headers, knight["id"]).json()["value"]
        forged = "coat_of_arms-ffffffffffffffff.png"
        resp = client.put(
            f"/api/characters/{knight['id']}",
            json={"data": {"coat_of_arms": forged, "banner": forged}, "unset": ["coat_of_arms"]},
            headers=admin_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["data"]["coat_of_arms"] == value
        assert "banner" not in resp.json()["data"]

    def test_creating_cannot_set_an_image(self, client, admin_headers, sheet):
        created = client.post(
            "/api/characters",
            json={"schema_ref": "heraldry", "data": {"coat_of_arms": "coat_of_arms-0123456789abcdef.png"}},
            headers=admin_headers,
        ).json()
        assert "coat_of_arms" not in created["data"]


class TestAccess:
    def test_only_the_owner_writes(self, client, admin_headers, gm_headers, knight):
        assert _upload(client, gm_headers, knight["id"]).status_code == 404
        _upload(client, admin_headers, knight["id"])
        assert client.delete(f"/api/characters/{knight['id']}/images/coat_of_arms",
                             headers=gm_headers).status_code == 404
        assert len(_files(knight["id"])) == 1

    def test_a_stranger_cannot_read(self, client, admin_headers, gm_headers, knight):
        _upload(client, admin_headers, knight["id"])
        assert client.get(f"/api/characters/{knight['id']}/images/coat_of_arms",
                          headers=gm_headers).status_code == 404

    def test_the_party_can_read(self, client, admin_headers, gm_headers, knight, admin_id, gm_id):
        db = SessionLocal()
        try:
            campaign = Campaign(name="Image Table", owner_id=admin_id)
            db.add(campaign)
            db.flush()
            db.add(CampaignMember(campaign_id=campaign.id, user_id=gm_id, status="accepted"))
            db.commit()
            campaign_id = campaign.id
        finally:
            db.close()
        client.put(f"/api/characters/{knight['id']}", json={"campaign_id": campaign_id},
                   headers=admin_headers)
        _upload(client, admin_headers, knight["id"])
        assert client.get(f"/api/characters/{knight['id']}/images/coat_of_arms",
                          headers=gm_headers).status_code == 200


class TestLifecycle:
    def test_deleting_a_character_removes_its_pictures(self, client, admin_headers, knight):
        _upload(client, admin_headers, knight["id"])
        portrait = client.post(
            f"/api/characters/{knight['id']}/portrait",
            files={"file": ("p.png", _png(), "image/png")},
            headers=admin_headers,
        ).json()["portrait_path"]
        assert client.delete(f"/api/characters/{knight['id']}", headers=admin_headers).status_code == 200
        assert not os.path.exists(os.path.join(CHARACTER_IMAGE_DIR, knight["id"]))
        assert not os.path.exists(os.path.join(CHARACTER_PORTRAIT_DIR, portrait))

    def test_a_sheet_update_dropping_the_field_drops_the_picture(self, client, admin_headers, knight):
        arms = _upload(client, admin_headers, knight["id"]).json()["value"]
        banner = _upload(client, admin_headers, knight["id"], field="banner").json()["value"]
        client.put(f"/api/characters/{knight['id']}", json={"data": {"name": "kept"}},
                   headers=admin_headers)
        fields = dict(SCHEMA["fields"])
        fields["coat_of_arms"] = {"type": "text"}
        fields.pop("banner")
        resp = client.post("/api/characters/schemas",
                           json={"document": dict(SCHEMA, fields=fields)}, headers=admin_headers)
        assert resp.status_code == 200
        detail = client.get(f"/api/characters/{knight['id']}", headers=admin_headers).json()
        assert "coat_of_arms" not in detail["data"]
        assert "banner" not in detail["data"]
        assert detail["data"]["name"] == "kept"
        assert arms not in _files(knight["id"]) and banner not in _files(knight["id"])

    def test_a_sheet_update_keeping_the_field_keeps_the_picture(self, client, admin_headers, knight):
        arms = _upload(client, admin_headers, knight["id"]).json()["value"]
        # A stray file the field no longer names - a lost race - is swept up.
        stray = os.path.join(CHARACTER_IMAGE_DIR, knight["id"], "banner-0000000000000000.png")
        with open(stray, "wb") as handle:
            handle.write(_png())
        client.post("/api/characters/schemas", json={"document": dict(SCHEMA, name="Heraldry 2")},
                    headers=admin_headers)
        assert _files(knight["id"]) == [arms]

    def test_a_picture_the_sheet_left_behind_can_still_be_removed(self, client, admin_headers, knight):
        value = "crest-0123456789abcdef.png"
        db = SessionLocal()
        try:
            row = db.get(Character, knight["id"])
            images.store_field_image(row, "crest", _png(), ".png")
            value = row.data["crest"]
            db.commit()
        finally:
            db.close()
        resp = client.delete(f"/api/characters/{knight['id']}/images/crest", headers=admin_headers)
        assert resp.status_code == 200
        assert value not in _files(knight["id"])


class TestExportImport:
    def test_pictures_travel_with_the_file(self, client, admin_headers, gm_headers, knight):
        _upload(client, admin_headers, knight["id"], raw=_png("green"))
        client.post(f"/api/characters/{knight['id']}/portrait",
                    files={"file": ("p.png", _png("blue"), "image/png")}, headers=admin_headers)
        client.put(f"/api/characters/{knight['id']}",
                   json={"portrait_crop": {"x": 50, "y": 10, "zoom": 2}}, headers=admin_headers)

        exported = client.get(f"/api/characters/{knight['id']}/export", headers=admin_headers).json()
        assert exported["images"] == {"coat_of_arms": _data_url(_png("green"))}
        assert exported["portrait"] == _data_url(_png("blue"))
        assert exported["portrait_crop"] == {"x": 50, "y": 10, "zoom": 2}
        assert exported["data"]["coat_of_arms"].startswith("coat_of_arms-")

        imported = client.post("/api/characters/import", json={"payload": exported},
                               headers=gm_headers)
        assert imported.status_code == 200, imported.text
        copy = imported.json()
        assert copy["portrait_crop"] == {"x": 50, "y": 10, "zoom": 2}
        assert copy["portrait_path"]
        assert copy["data"]["coat_of_arms"] != exported["data"]["coat_of_arms"]
        served = client.get(f"/api/characters/{copy['id']}/images/coat_of_arms", headers=gm_headers)
        assert served.content == _png("green")

    def test_an_import_ignores_bad_pictures(self, client, admin_headers, sheet):
        payload = {
            "schema_id": "heraldry",
            "name": "Forged",
            "data": {"coat_of_arms": "coat_of_arms-0123456789abcdef.png"},
            "images": {
                "coat_of_arms": "https://example.com/arms.png",
                "banner": "data:image/png;base64," + base64.b64encode(b"nope").decode(),
                "name": _data_url(_png()),
            },
            "portrait": "data:text/html;base64,PGI+",
        }
        copy = client.post("/api/characters/import", json={"payload": payload},
                           headers=admin_headers).json()
        assert "coat_of_arms" not in copy["data"]
        assert copy["portrait_path"] is None
        assert _files(copy["id"]) == []

    def test_images_payload_that_is_not_an_object_is_ignored(self):
        assert images.import_images(object(), {"fields": {}}, "nope") == 0


class TestImageService:
    def test_a_missing_folder_is_fine(self):
        class Row:
            id = "no-such-character"
            data = {"x": 1}

        assert images.prune_images(Row(), {"fields": {}}) is False
        images.remove_field_image(Row(), "arms")
        assert Row.data == {"x": 1}

    def test_export_skips_values_that_are_not_pictures(self):
        class Row:
            id = "no-such-character"
            data = {"name": "Sir", "arms": "arms-0123456789abcdef.png", "n": 3}

        assert images.export_images(Row()) == {}

    def test_encode_refuses_an_unknown_extension_and_a_missing_file(self, tmp_path):
        odd = tmp_path / "x.bmp"
        odd.write_bytes(b"x")
        assert images.encode_data_url(str(odd)) is None
        assert images.encode_data_url(str(tmp_path / "gone.png")) is None


class TestPortraitCrop:
    def test_set_listed_and_cleared(self, client, admin_headers, knight):
        url = f"/api/characters/{knight['id']}"
        assert knight["portrait_crop"] is None
        resp = client.put(url, json={"portrait_crop": {"x": 40, "y": 12.5, "zoom": 1.5}},
                          headers=admin_headers)
        assert resp.json()["portrait_crop"] == {"x": 40, "y": 12.5, "zoom": 1.5}
        listed = client.get("/api/characters", headers=admin_headers).json()["characters"]
        assert listed[0]["portrait_crop"] == {"x": 40, "y": 12.5, "zoom": 1.5}
        # The defaults are no crop at all.
        resp = client.put(url, json={"portrait_crop": {}}, headers=admin_headers)
        assert resp.json()["portrait_crop"] is None

    @pytest.mark.parametrize("crop", [{"x": 101}, {"y": -1}, {"zoom": 0.5}, {"zoom": 5}])
    def test_out_of_range_is_refused(self, client, admin_headers, knight, crop):
        resp = client.put(f"/api/characters/{knight['id']}", json={"portrait_crop": crop},
                          headers=admin_headers)
        assert resp.status_code == 422

    def test_a_new_portrait_starts_centred(self, client, admin_headers, knight):
        url = f"/api/characters/{knight['id']}"
        client.post(f"{url}/portrait", files={"file": ("p.png", _png(), "image/png")},
                    headers=admin_headers)
        client.put(url, json={"portrait_crop": {"y": 0}}, headers=admin_headers)
        client.post(f"{url}/portrait", files={"file": ("p.png", _png("blue"), "image/png")},
                    headers=admin_headers)
        assert client.get(url, headers=admin_headers).json()["portrait_crop"] is None
        client.put(url, json={"portrait_crop": {"y": 0}}, headers=admin_headers)
        client.delete(f"{url}/portrait", headers=admin_headers)
        assert client.get(url, headers=admin_headers).json()["portrait_crop"] is None

    def test_a_malformed_stored_crop_reads_as_none(self, client, admin_headers, knight):
        db = SessionLocal()
        try:
            db.get(Character, knight["id"]).portrait_crop = {"x": "left", "zoom": 99}
            db.commit()
        finally:
            db.close()
        assert client.get(f"/api/characters/{knight['id']}",
                          headers=admin_headers).json()["portrait_crop"] is None


def test_backups_carry_character_pictures():
    from backend.services.backup._archive import ASSET_DIRS

    assert (CHARACTER_PORTRAIT_DIR, "character_portraits") in ASSET_DIRS
    assert (CHARACTER_IMAGE_DIR, "character_images") in ASSET_DIRS
