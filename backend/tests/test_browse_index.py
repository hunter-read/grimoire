"""The flat gallery's jump index: where each letter (or added month) starts.

``/{collection}/index`` takes the list's own filters and order and returns one
entry per run - a first letter for the ``name`` sort, a month for ``added_at`` -
with its length and its offset in the list. The rail opens the list at that
offset, so every offset must point at the first item of its run in exactly the
list the same parameters page through.

The test database is shared across the session, so every test works inside a
uniquely named folder.
"""
import uuid
from datetime import datetime

from backend.config import SessionLocal
from backend.models import Token
from backend.models.browse import natural_key
from backend.services.browse.media import index_letter
from backend.tests.conftest import make_audio, make_map, make_model3d, make_token


def _folder() -> str:
    return f"Index{uuid.uuid4().hex[:8]}"


def _index(client, headers, url="/api/tokens/index", **params):
    resp = client.get(url, params=params, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()["entries"]


def _list(client, headers, **params):
    resp = client.get("/api/tokens", params=params, headers=headers)
    assert resp.status_code == 200, resp.text
    return [t["filename"] for t in resp.json()["tokens"]]


def _tokens(folder: str, *names: str) -> None:
    for name in names:
        make_token(filename=name, relative_path=f"tokens/{folder}/{name}")


class TestIndexLetter:
    def test_letters_digits_and_symbols(self):
        assert index_letter("apple") == "A"
        # The stored key is accent-folded already; a bare accented letter still
        # reads as its own capital.
        assert index_letter("élan") == "É"
        assert index_letter("003100") == "#"
        assert index_letter("(x)") == "#"
        assert index_letter("") == "#"
        assert index_letter(None) == "#"
        assert index_letter("жар") == "Ж"


class TestNameIndex:
    def test_runs_offsets_and_counts(self, client, admin_headers):
        folder = _folder()
        _tokens(
            folder, "apple.png", "Avocado.png", "banana.png", "Élan.png", "1st.png", "(x).png"
        )
        entries = _index(client, admin_headers, folder=folder, sort="name")
        assert entries == [
            {"key": "#", "label": "#", "count": 2, "offset": 0},
            {"key": "A", "label": "A", "count": 2, "offset": 2},
            {"key": "B", "label": "B", "count": 1, "offset": 4},
            # Accents fold: "Élan" sorts with the e's and is indexed under E.
            {"key": "E", "label": "E", "count": 1, "offset": 5},
        ]

    def test_offsets_point_into_the_same_list(self, client, admin_headers):
        folder = _folder()
        _tokens(folder, "zeta.png", "Mörk.png", "moth.png", "alpha.png", "Mz.png", "beta.png")
        for order in ("asc", "desc"):
            names = _list(client, admin_headers, folder=folder, sort="name", order=order)
            entries = _index(client, admin_headers, folder=folder, sort="name", order=order)
            assert sum(e["count"] for e in entries) == len(names)
            for entry in entries:
                run = names[entry["offset"] : entry["offset"] + entry["count"]]
                assert [index_letter(natural_key(n)) for n in run] == [entry["label"]] * len(run)

    def test_descending_reverses_the_runs(self, client, admin_headers):
        folder = _folder()
        _tokens(folder, "apple.png", "banana.png", "berry.png", "cherry.png")
        entries = _index(client, admin_headers, folder=folder, sort="name", order="desc")
        assert [(e["label"], e["offset"], e["count"]) for e in entries] == [
            ("C", 0, 1),
            ("B", 1, 2),
            ("A", 3, 1),
        ]

    def test_a_label_seen_again_gets_its_own_key(self, client, admin_headers):
        # "~" sorts after every letter, so symbols land in two separate runs.
        folder = _folder()
        _tokens(folder, "(a).png", "kobold.png", "~tilde.png")
        entries = _index(client, admin_headers, folder=folder, sort="name")
        assert [(e["key"], e["label"]) for e in entries] == [
            ("#", "#"),
            ("K", "K"),
            ("#~1", "#"),
        ]

    def test_follows_the_filters(self, client, admin_headers):
        folder = _folder()
        _tokens(folder, "apple.png", "banana.png")
        entries = _index(client, admin_headers, folder=folder, sort="name", q="banana")
        assert entries == [{"key": "B", "label": "B", "count": 1, "offset": 0}]


class TestAddedIndex:
    def test_months_newest_first_and_undated_last(self, client, admin_headers):
        folder = _folder()
        dates = {
            "a.png": datetime(2026, 9, 3),
            "b.png": datetime(2026, 11, 1),
            "c.png": datetime(2026, 11, 20),
            "d.png": None,
        }
        _tokens(folder, *dates)
        db = SessionLocal()
        try:
            for name, when in dates.items():
                db.query(Token).filter(Token.relative_path == f"tokens/{folder}/{name}").update(
                    {"added_at": when}
                )
            db.commit()
        finally:
            db.close()
        entries = _index(client, admin_headers, folder=folder, sort="added_at", order="desc")
        assert [(e["label"], e["offset"], e["count"]) for e in entries] == [
            ("2026-11", 0, 2),
            ("2026-09", 2, 1),
            ("", 3, 1),
        ]
        names = _list(client, admin_headers, folder=folder, sort="added_at", order="desc")
        assert names[3] == "d.png"


class TestOtherSorts:
    def test_unindexed_sorts_return_no_entries(self, client, admin_headers):
        folder = _folder()
        _tokens(folder, "apple.png")
        for sort in ("size", "path", "duration", "track", "title"):
            assert _index(client, admin_headers, folder=folder, sort=sort) == []

    def test_bad_sort_is_rejected(self, client, admin_headers):
        resp = client.get("/api/tokens/index?sort=bogus", headers=admin_headers)
        assert resp.status_code == 422


class TestEveryGallery:
    def test_maps_audio_and_models_serve_an_index(self, client, admin_headers):
        folder = _folder()
        make_map(filename="arena.png", relative_path=f"maps/{folder}/arena.png")
        make_audio(filename="rain.mp3", relative_path=f"audio/{folder}/rain.mp3")
        make_model3d(filename="ogre.stl", relative_path=f"models/{folder}/ogre.stl")
        for url, label in (
            ("/api/maps/index", "A"),
            ("/api/audio/index", "R"),
            ("/api/models/index", "O"),
        ):
            entries = _index(client, admin_headers, url=url, folder=folder, sort="name")
            assert entries == [{"key": label, "label": label, "count": 1, "offset": 0}], url

    def test_map_type_narrows_the_map_index(self, client, admin_headers):
        folder = _folder()
        make_map(filename="arena.png", relative_path=f"maps/{folder}/arena.png", map_type="battle")
        make_map(filename="world.png", relative_path=f"maps/{folder}/world.png", map_type="world")
        entries = _index(
            client, admin_headers, url="/api/maps/index", folder=folder, sort="name", map_type="world"
        )
        assert entries == [{"key": "W", "label": "W", "count": 1, "offset": 0}]
