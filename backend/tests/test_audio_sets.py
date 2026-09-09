"""Tests for the saved audio-sets API (named playlists and soundboards)."""
from backend.config import SessionLocal
from backend.models import Audio, AudioSet
from backend.tests.conftest import make_audio


def _save(client, headers, **body):
    return client.post("/api/audio-sets", json=body, headers=headers)


class TestSaveAndLoad:
    def test_save_playlist_and_list(self, client, admin_headers):
        a, b = make_audio(title="Rain"), make_audio(title="Thunder")
        r = _save(
            client,
            admin_headers,
            kind="playlist",
            name="Storm",
            entries=[{"audio_id": a.id}, {"audio_id": b.id}],
        )
        assert r.status_code == 200
        body = r.json()
        assert body["kind"] == "playlist"
        assert [e["audio_id"] for e in body["entries"]] == [a.id, b.id]
        assert body["missing"] == 0
        # A playlist has no grid.
        assert body["layout"] is None

        rows = client.get("/api/audio-sets?kind=playlist", headers=admin_headers).json()["sets"]
        row = next(s for s in rows if s["name"] == "Storm")
        assert row["count"] == 2

    def test_save_soundboard_keeps_loop_and_layout(self, client, admin_headers):
        a, b = make_audio(), make_audio()
        r = _save(
            client,
            admin_headers,
            kind="soundboard",
            name="Tavern",
            entries=[{"audio_id": a.id, "loop": True}, {"audio_id": b.id}],
            layout={"cols": 3, "rows": 5},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["layout"] == {"cols": 3, "rows": 5}
        assert [e["loop"] for e in body["entries"]] == [True, False]

    def test_entry_order_is_preserved(self, client, admin_headers):
        tracks = [make_audio() for _ in range(4)]
        ordered = [tracks[2], tracks[0], tracks[3], tracks[1]]
        _save(
            client,
            admin_headers,
            kind="playlist",
            name="Ordered",
            entries=[{"audio_id": t.id} for t in ordered],
        )
        sets = client.get("/api/audio-sets?kind=playlist", headers=admin_headers).json()["sets"]
        sid = next(s["id"] for s in sets if s["name"] == "Ordered")
        loaded = client.get(f"/api/audio-sets/{sid}", headers=admin_headers).json()
        assert [e["audio_id"] for e in loaded["entries"]] == [t.id for t in ordered]

    def test_titles_resolve_live_not_from_the_saved_copy(self, client, admin_headers):
        a = make_audio(title="Old name")
        sid = _save(
            client, admin_headers, kind="playlist", name="Live", entries=[{"audio_id": a.id}]
        ).json()["id"]

        db = SessionLocal()
        db.query(Audio).filter_by(id=a.id).first().title = "New name"
        db.commit()
        db.close()

        loaded = client.get(f"/api/audio-sets/{sid}", headers=admin_headers).json()
        assert loaded["entries"][0]["title"] == "New name"

    def test_title_falls_back_to_filename(self, client, admin_headers):
        a = make_audio(title="")
        sid = _save(
            client, admin_headers, kind="playlist", name="Untitled", entries=[{"audio_id": a.id}]
        ).json()["id"]
        loaded = client.get(f"/api/audio-sets/{sid}", headers=admin_headers).json()
        assert loaded["entries"][0]["title"] == a.filename

    def test_load_missing_set_404s(self, client, admin_headers):
        assert client.get("/api/audio-sets/nope", headers=admin_headers).status_code == 404


class TestMissingTracks:
    def test_deleted_track_is_skipped_and_counted(self, client, admin_headers):
        a, b = make_audio(), make_audio()
        sid = _save(
            client,
            admin_headers,
            kind="playlist",
            name="Gappy",
            entries=[{"audio_id": a.id}, {"audio_id": b.id}],
        ).json()["id"]

        db = SessionLocal()
        db.query(Audio).filter_by(id=b.id).delete()
        db.commit()
        db.close()

        loaded = client.get(f"/api/audio-sets/{sid}", headers=admin_headers).json()
        assert [e["audio_id"] for e in loaded["entries"]] == [a.id]
        assert loaded["missing"] == 1

    def test_listing_counts_saved_entries_not_resolved_ones(self, client, admin_headers):
        a = make_audio()
        _save(
            client,
            admin_headers,
            kind="playlist",
            name="Counted",
            entries=[{"audio_id": a.id}, {"audio_id": "gone-forever"}],
        )
        rows = client.get("/api/audio-sets?kind=playlist", headers=admin_headers).json()["sets"]
        assert next(s for s in rows if s["name"] == "Counted")["count"] == 2


class TestOverwriteAndRename:
    def test_resaving_a_name_updates_in_place(self, client, admin_headers):
        a, b = make_audio(), make_audio()
        first = _save(
            client, admin_headers, kind="playlist", name="Dupe", entries=[{"audio_id": a.id}]
        ).json()
        second = _save(
            client, admin_headers, kind="playlist", name="Dupe", entries=[{"audio_id": b.id}]
        ).json()
        assert second["id"] == first["id"]
        assert [e["audio_id"] for e in second["entries"]] == [b.id]

        rows = client.get("/api/audio-sets?kind=playlist", headers=admin_headers).json()["sets"]
        assert len([s for s in rows if s["name"] == "Dupe"]) == 1

    def test_same_name_across_kinds_is_allowed(self, client, admin_headers):
        a = make_audio()
        p = _save(
            client, admin_headers, kind="playlist", name="Shared", entries=[{"audio_id": a.id}]
        )
        s = _save(
            client, admin_headers, kind="soundboard", name="Shared", entries=[{"audio_id": a.id}]
        )
        assert p.status_code == 200 and s.status_code == 200
        assert p.json()["id"] != s.json()["id"]

    def test_rename(self, client, admin_headers):
        a = make_audio()
        sid = _save(
            client, admin_headers, kind="playlist", name="Before", entries=[{"audio_id": a.id}]
        ).json()["id"]
        r = client.patch(
            f"/api/audio-sets/{sid}", json={"name": "After"}, headers=admin_headers
        )
        assert r.status_code == 200
        assert r.json()["name"] == "After"

    def test_rename_onto_an_existing_name_conflicts(self, client, admin_headers):
        a = make_audio()
        _save(client, admin_headers, kind="playlist", name="Taken", entries=[{"audio_id": a.id}])
        sid = _save(
            client, admin_headers, kind="playlist", name="Free", entries=[{"audio_id": a.id}]
        ).json()["id"]
        r = client.patch(f"/api/audio-sets/{sid}", json={"name": "Taken"}, headers=admin_headers)
        assert r.status_code == 409

    def test_rename_to_its_own_name_is_a_no_op(self, client, admin_headers):
        a = make_audio()
        sid = _save(
            client, admin_headers, kind="playlist", name="Itself", entries=[{"audio_id": a.id}]
        ).json()["id"]
        r = client.patch(f"/api/audio-sets/{sid}", json={"name": "Itself"}, headers=admin_headers)
        assert r.status_code == 200

    def test_patch_replaces_entries_and_layout(self, client, admin_headers):
        a, b = make_audio(), make_audio()
        sid = _save(
            client,
            admin_headers,
            kind="soundboard",
            name="Rebuilt",
            entries=[{"audio_id": a.id}],
            layout={"cols": 2, "rows": 2},
        ).json()["id"]
        r = client.patch(
            f"/api/audio-sets/{sid}",
            json={"entries": [{"audio_id": b.id, "loop": True}], "layout": {"cols": 5, "rows": 6}},
            headers=admin_headers,
        )
        body = r.json()
        assert [e["audio_id"] for e in body["entries"]] == [b.id]
        assert body["entries"][0]["loop"] is True
        assert body["layout"] == {"cols": 5, "rows": 6}

    def test_patch_missing_set_404s(self, client, admin_headers):
        r = client.patch("/api/audio-sets/nope", json={"name": "x"}, headers=admin_headers)
        assert r.status_code == 404


class TestValidation:
    def test_blank_name_rejected(self, client, admin_headers):
        assert _save(client, admin_headers, kind="playlist", name="  ").status_code == 422

    def test_blank_rename_rejected(self, client, admin_headers):
        a = make_audio()
        sid = _save(
            client, admin_headers, kind="playlist", name="Named", entries=[{"audio_id": a.id}]
        ).json()["id"]
        r = client.patch(f"/api/audio-sets/{sid}", json={"name": " "}, headers=admin_headers)
        assert r.status_code == 422

    def test_invalid_kind_rejected(self, client, admin_headers):
        assert _save(client, admin_headers, kind="mixtape", name="x").status_code == 422

    def test_list_invalid_kind_query(self, client, admin_headers):
        assert client.get("/api/audio-sets?kind=mixtape", headers=admin_headers).status_code == 400

    def test_out_of_range_layout_rejected(self, client, admin_headers):
        assert (
            _save(
                client,
                admin_headers,
                kind="soundboard",
                name="Huge",
                layout={"cols": 99, "rows": 4},
            ).status_code
            == 422
        )
        assert (
            _save(
                client,
                admin_headers,
                kind="soundboard",
                name="Tall",
                layout={"cols": 4, "rows": 99},
            ).status_code
            == 422
        )

    def test_entry_cap_enforced(self, client, admin_headers):
        entries = [{"audio_id": f"id-{i}"} for i in range(501)]
        assert (
            _save(
                client, admin_headers, kind="playlist", name="Too many", entries=entries
            ).status_code
            == 422
        )
        a = make_audio()
        sid = _save(
            client, admin_headers, kind="playlist", name="Growable", entries=[{"audio_id": a.id}]
        ).json()["id"]
        r = client.patch(f"/api/audio-sets/{sid}", json={"entries": entries}, headers=admin_headers)
        assert r.status_code == 422

    def test_playlist_layout_is_dropped(self, client, admin_headers):
        r = _save(
            client,
            admin_headers,
            kind="playlist",
            name="No grid",
            layout={"cols": 3, "rows": 3},
        )
        assert r.json()["layout"] is None

    def test_hand_edited_entries_do_not_break_a_load(self, client, admin_headers):
        """A row edited directly in the database degrades to what it can read."""
        a = make_audio()
        sid = _save(
            client, admin_headers, kind="playlist", name="Corrupt", entries=[{"audio_id": a.id}]
        ).json()["id"]

        db = SessionLocal()
        row = db.query(AudioSet).filter_by(id=sid).first()
        row.entries = "not a list"
        row.layout = "not a dict"
        db.commit()
        db.close()

        loaded = client.get(f"/api/audio-sets/{sid}", headers=admin_headers).json()
        assert loaded["entries"] == []
        assert loaded["layout"] is None

        db = SessionLocal()
        row = db.query(AudioSet).filter_by(id=sid).first()
        row.entries = [{"loop": True}, {"audio_id": a.id}]
        db.commit()
        db.close()

        loaded = client.get(f"/api/audio-sets/{sid}", headers=admin_headers).json()
        assert [e["audio_id"] for e in loaded["entries"]] == [a.id]


class TestOwnership:
    def test_sets_are_per_user(self, client, admin_headers, player_headers):
        a = make_audio()
        sid = _save(
            client, admin_headers, kind="playlist", name="Mine", entries=[{"audio_id": a.id}]
        ).json()["id"]

        rows = client.get("/api/audio-sets", headers=player_headers).json()["sets"]
        assert all(s["name"] != "Mine" for s in rows)
        assert client.get(f"/api/audio-sets/{sid}", headers=player_headers).status_code == 404
        assert client.delete(f"/api/audio-sets/{sid}", headers=player_headers).status_code == 404

    def test_two_users_may_use_the_same_name(self, client, admin_headers, player_headers):
        a = make_audio()
        assert (
            _save(
                client, admin_headers, kind="playlist", name="Tavern", entries=[{"audio_id": a.id}]
            ).status_code
            == 200
        )
        assert (
            _save(
                client, player_headers, kind="playlist", name="Tavern", entries=[{"audio_id": a.id}]
            ).status_code
            == 200
        )

    def test_requires_auth(self, client):
        assert client.get("/api/audio-sets").status_code in (401, 403)

    def test_list_without_kind_returns_both(self, client, admin_headers):
        a = make_audio()
        _save(client, admin_headers, kind="playlist", name="BothP", entries=[{"audio_id": a.id}])
        _save(client, admin_headers, kind="soundboard", name="BothS", entries=[{"audio_id": a.id}])
        names = {s["name"] for s in client.get("/api/audio-sets", headers=admin_headers).json()["sets"]}
        assert {"BothP", "BothS"} <= names


class TestDelete:
    def test_delete(self, client, admin_headers):
        a = make_audio()
        sid = _save(
            client, admin_headers, kind="playlist", name="Doomed", entries=[{"audio_id": a.id}]
        ).json()["id"]
        assert client.delete(f"/api/audio-sets/{sid}", headers=admin_headers).status_code == 200
        assert client.get(f"/api/audio-sets/{sid}", headers=admin_headers).status_code == 404

    def test_delete_missing_404s(self, client, admin_headers):
        assert client.delete("/api/audio-sets/nope", headers=admin_headers).status_code == 404


class TestGuestDegradation:
    """A guest only keeps the tracks still shared into a campaign they belong to.

    A set saved while a track was shared should degrade to what the guest can
    still play rather than 403-ing the whole load.
    """

    def test_unshared_tracks_are_skipped_for_a_guest(
        self, client, admin_headers, gm_headers
    ):
        client.patch(
            "/api/settings", json={"guest_access_enabled": True}, headers=admin_headers
        )
        campaign = client.post(
            "/api/campaigns",
            json={"name": "Audio Sets Guest", "is_gm_campaign": True},
            headers=gm_headers,
        ).json()["id"]
        created = client.post(
            f"/api/campaigns/{campaign}/guests",
            json={"nickname": "SetGuest"},
            headers=gm_headers,
        ).json()
        login = client.post("/api/auth/guest-login", json={"code": created["guest_code"]})
        guest_headers = {"Authorization": f"Bearer {login.json()['token']}"}

        shared, private = make_audio(), make_audio()
        assert (
            client.post(
                f"/api/campaigns/{campaign}/resources",
                json={"resource_type": "audio", "resource_id": shared.id, "visibility": "public"},
                headers=gm_headers,
            ).status_code
            == 201
        )

        sid = _save(
            client,
            guest_headers,
            kind="soundboard",
            name="Guest board",
            entries=[{"audio_id": shared.id}, {"audio_id": private.id}],
        ).json()["id"]

        loaded = client.get(f"/api/audio-sets/{sid}", headers=guest_headers).json()
        assert [e["audio_id"] for e in loaded["entries"]] == [shared.id]
        assert loaded["missing"] == 1
