"""The resolution endpoints: linking, merging, deleting, comparing.

Every one of these is user-driven by design (issue #304) — nothing here has an
automatic path, and the guards that stop a mis-click from hiding or destroying a
file are what most of these tests are about.
"""
import os

import pytest

from backend.tests.conftest import (
    make_audio,
    make_book,
    make_game_system,
    make_map,
    make_token,
)

API = "/api/duplicates"


@pytest.fixture
def system():
    return make_game_system()


def _link(client, headers, parent, child, kind="version", label="", rtype="book"):
    return client.post(
        f"{API}/link",
        headers=headers,
        json={
            "resource_type": rtype,
            "parent_id": parent,
            "children": [{"id": child, "kind": kind, "label": label}],
        },
    )


def _promote(client, headers, new_parent, old_parent, kind="other", label="", rtype="book"):
    return client.post(
        f"{API}/promote",
        headers=headers,
        json={
            "resource_type": rtype,
            "new_parent_id": new_parent,
            "old_parent_id": old_parent,
            "kind": kind,
            "label": label,
        },
    )


class TestPromote:
    """Re-electing the main version of a family that already exists."""

    def test_promotes_an_outsider_over_an_existing_family(
        self, client, admin_headers, system
    ):
        form = make_book(system_id=system.id)
        printable = make_book(system_id=system.id)
        lined = make_book(system_id=system.id)
        _link(client, admin_headers, form.id, printable.id, "printer-friendly")

        resp = _promote(client, admin_headers, lined.id, form.id, "form-fillable", "v2")
        assert resp.status_code == 200
        assert resp.json() == {"new_parent_id": lined.id, "moved": 2}

        # The whole family sits under the new parent, two levels deep at most.
        for book_id in (form.id, printable.id):
            detail = client.get(f"/api/books/{book_id}", headers=admin_headers).json()
            assert detail["variant_parent_id"] == lined.id
        assert (
            client.get(f"/api/books/{lined.id}", headers=admin_headers).json()[
                "variant_parent_id"
            ]
            is None
        )

    def test_link_alone_cannot_express_this(self, client, admin_headers, system):
        """The guard that makes /promote necessary rather than a convenience."""
        form = make_book(system_id=system.id)
        printable = make_book(system_id=system.id)
        lined = make_book(system_id=system.id)
        _link(client, admin_headers, form.id, printable.id, "printer-friendly")

        body = _link(client, admin_headers, lined.id, form.id, "form-fillable").json()
        assert body["linked"] == []
        assert "variant" in body["errors"][0]["detail"]

    def test_promotes_a_child_over_its_own_parent(self, client, admin_headers, system):
        parent = make_book(system_id=system.id)
        child = make_book(system_id=system.id)
        _link(client, admin_headers, parent.id, child.id, "version")

        assert _promote(client, admin_headers, child.id, parent.id, "version").status_code == 200
        detail = client.get(f"/api/books/{parent.id}", headers=admin_headers).json()
        assert detail["variant_parent_id"] == child.id

    def test_rejects_self_promotion(self, client, admin_headers, system):
        book = make_book(system_id=system.id)
        assert _promote(client, admin_headers, book.id, book.id).status_code == 400

    def test_missing_item_is_404(self, client, admin_headers, system):
        book = make_book(system_id=system.id)
        assert _promote(client, admin_headers, "nope", book.id).status_code == 404

    def test_requires_admin(self, client, player_headers, system):
        a, b = make_book(system_id=system.id), make_book(system_id=system.id)
        assert _promote(client, player_headers, b.id, a.id).status_code in (401, 403)


class TestLink:
    def test_links_and_hides(self, client, admin_headers, system):
        parent = make_book(system_id=system.id)
        child = make_book(system_id=system.id)
        resp = _link(client, admin_headers, parent.id, child.id, "printer-friendly", "B&W")
        assert resp.status_code == 200
        body = resp.json()
        assert body["linked"] == [child.id] and body["errors"] == []

        detail = client.get(f"/api/books/{parent.id}", headers=admin_headers).json()
        assert [v["id"] for v in detail["variants"]] == [child.id]
        assert detail["variants"][0]["label"] == "B&W"

    def test_rejects_self_parent(self, client, admin_headers, system):
        book = make_book(system_id=system.id)
        body = _link(client, admin_headers, book.id, book.id).json()
        assert body["linked"] == []
        assert "itself" in body["errors"][0]["detail"]

    def test_rejects_grandchild(self, client, admin_headers, system):
        parent, child, grand = (make_book(system_id=system.id) for _ in range(3))
        _link(client, admin_headers, parent.id, child.id)
        body = _link(client, admin_headers, child.id, grand.id).json()
        assert body["linked"] == []
        assert "main version" in body["errors"][0]["detail"]

    def test_rejects_unknown_kind(self, client, admin_headers, system):
        parent, child = make_book(system_id=system.id), make_book(system_id=system.id)
        body = _link(client, admin_headers, parent.id, child.id, "bogus").json()
        assert body["linked"] == []
        assert "Unknown variant kind" in body["errors"][0]["detail"]

    def test_partial_success_keeps_the_good_links(self, client, admin_headers, system):
        parent, good = make_book(system_id=system.id), make_book(system_id=system.id)
        resp = client.post(
            f"{API}/link",
            headers=admin_headers,
            json={
                "resource_type": "book",
                "parent_id": parent.id,
                "children": [
                    {"id": good.id, "kind": "version"},
                    {"id": "does-not-exist", "kind": "version"},
                ],
            },
        )
        body = resp.json()
        assert body["linked"] == [good.id]
        assert len(body["errors"]) == 1

    def test_duplicate_ids_in_one_request(self, client, admin_headers, system):
        parent, child = make_book(system_id=system.id), make_book(system_id=system.id)
        body = client.post(
            f"{API}/link",
            headers=admin_headers,
            json={
                "resource_type": "book",
                "parent_id": parent.id,
                "children": [
                    {"id": child.id, "kind": "version"},
                    {"id": child.id, "kind": "spreads"},
                ],
            },
        ).json()
        assert body["linked"] == [child.id]
        assert "more than once" in body["errors"][0]["detail"]

    def test_requires_admin(self, client, player_headers, system):
        parent, child = make_book(system_id=system.id), make_book(system_id=system.id)
        assert _link(client, player_headers, parent.id, child.id).status_code == 403

    def test_unknown_resource_type_is_rejected(self, client, admin_headers):
        resp = client.post(
            f"{API}/link",
            headers=admin_headers,
            json={
                "resource_type": "sandwich",
                "parent_id": "a",
                "children": [{"id": "b", "kind": "other"}],
            },
        )
        assert resp.status_code == 422


class TestUnlink:
    def test_unlink_by_ids(self, client, admin_headers, system):
        parent, child = make_book(system_id=system.id), make_book(system_id=system.id)
        _link(client, admin_headers, parent.id, child.id)
        body = client.post(
            f"{API}/unlink",
            headers=admin_headers,
            json={"resource_type": "book", "ids": [child.id]},
        ).json()
        assert body["unlinked"] == [child.id]
        detail = client.get(f"/api/books/{child.id}", headers=admin_headers).json()
        assert detail["variant_parent_id"] is None

    def test_unlink_whole_family(self, client, admin_headers, system):
        parent = make_book(system_id=system.id)
        kids = [make_book(system_id=system.id) for _ in range(2)]
        for k in kids:
            _link(client, admin_headers, parent.id, k.id)
        body = client.post(
            f"{API}/unlink",
            headers=admin_headers,
            json={"resource_type": "book", "parent_id": parent.id},
        ).json()
        assert set(body["unlinked"]) == {k.id for k in kids}


class TestMergeMetadata:
    def test_copies_empty_fields_only_by_default(self, client, admin_headers, system):
        source = make_book(system_id=system.id, title="Good Title", publisher="WotC")
        target = make_book(system_id=system.id, title="Bad Title", publisher="")
        body = client.post(
            f"{API}/merge-metadata",
            headers=admin_headers,
            json={
                "resource_type": "book",
                "source_id": source.id,
                "target_id": target.id,
                "fields": ["title", "publisher"],
            },
        ).json()
        # publisher was empty on the target so it fills; title was already set.
        assert body["updated"] == ["publisher"]
        assert body["skipped"] == ["title"]
        detail = client.get(f"/api/books/{target.id}", headers=admin_headers).json()
        assert detail["publisher"] == "WotC" and detail["title"] == "Bad Title"

    def test_overwrite_replaces(self, client, admin_headers, system):
        source = make_book(system_id=system.id, title="Good Title")
        target = make_book(system_id=system.id, title="Bad Title")
        body = client.post(
            f"{API}/merge-metadata",
            headers=admin_headers,
            json={
                "resource_type": "book",
                "source_id": source.id,
                "target_id": target.id,
                "fields": ["title"],
                "overwrite": True,
            },
        ).json()
        assert body["updated"] == ["title"]
        detail = client.get(f"/api/books/{target.id}", headers=admin_headers).json()
        assert detail["title"] == "Good Title"

    def test_tags_are_additive(self, client, admin_headers, system):
        source = make_book(system_id=system.id, tags=["dragons"])
        target = make_book(system_id=system.id, tags=["homebrew"])
        client.post(
            f"{API}/merge-metadata",
            headers=admin_headers,
            json={
                "resource_type": "book",
                "source_id": source.id,
                "target_id": target.id,
                "fields": ["tags"],
            },
        )
        detail = client.get(f"/api/books/{target.id}", headers=admin_headers).json()
        assert set(detail["tags"]) == {"dragons", "homebrew"}

    def test_rejects_fields_outside_the_whitelist(self, client, admin_headers, system):
        a, b = make_book(system_id=system.id), make_book(system_id=system.id)
        for field in ("filepath", "content_hash", "variant_parent_id", "id", "game_system_id"):
            resp = client.post(
                f"{API}/merge-metadata",
                headers=admin_headers,
                json={
                    "resource_type": "book",
                    "source_id": a.id,
                    "target_id": b.id,
                    "fields": [field],
                },
            )
            assert resp.status_code == 400, field
            assert "cannot be copied" in resp.json()["detail"]

    def test_rejects_same_item(self, client, admin_headers, system):
        book = make_book(system_id=system.id)
        resp = client.post(
            f"{API}/merge-metadata",
            headers=admin_headers,
            json={
                "resource_type": "book",
                "source_id": book.id,
                "target_id": book.id,
                "fields": ["title"],
            },
        )
        assert resp.status_code == 400


class TestDelete:
    def _book_on_disk(self, system, name):
        root = os.path.join(os.environ["LIBRARY_PATH"], "books", "dupe-del")
        os.makedirs(root, exist_ok=True)
        path = os.path.join(root, name)
        with open(path, "wb") as f:
            f.write(b"%PDF-1.4 stub")
        return make_book(system_id=system.id, filepath=path, filename=name), path

    def test_deletes_record_and_file(self, client, admin_headers, system):
        book, path = self._book_on_disk(system, "delete-me.pdf")
        resp = client.request(
            "DELETE",
            f"{API}/items/book/{book.id}",
            headers=admin_headers,
            json={"delete_file": True},
        )
        assert resp.status_code == 200
        assert resp.json()["file_deleted"] is True
        assert not os.path.exists(path)
        assert client.get(f"/api/books/{book.id}", headers=admin_headers).status_code == 404

    def test_can_keep_the_file(self, client, admin_headers, system):
        book, path = self._book_on_disk(system, "keep-file.pdf")
        resp = client.request(
            "DELETE",
            f"{API}/items/book/{book.id}",
            headers=admin_headers,
            json={"delete_file": False},
        )
        assert resp.json()["file_deleted"] is False
        assert os.path.exists(path)

    def test_parent_with_variants_needs_a_decision(self, client, admin_headers, system):
        parent, _p = self._book_on_disk(system, "parent.pdf")
        child, _c = self._book_on_disk(system, "child.pdf")
        _link(client, admin_headers, parent.id, child.id)
        resp = client.request("DELETE", f"{API}/items/book/{parent.id}", headers=admin_headers)
        assert resp.status_code == 409
        assert "variant" in resp.json()["detail"]

    def test_reparent_promotes_the_heir(self, client, admin_headers, system):
        parent, _ = self._book_on_disk(system, "old-parent.pdf")
        heir, _ = self._book_on_disk(system, "heir.pdf")
        sibling, _ = self._book_on_disk(system, "sibling.pdf")
        _link(client, admin_headers, parent.id, heir.id)
        _link(client, admin_headers, parent.id, sibling.id)

        resp = client.request(
            "DELETE",
            f"{API}/items/book/{parent.id}",
            headers=admin_headers,
            json={"delete_file": True, "reparent_to": heir.id},
        )
        assert resp.status_code == 200
        assert resp.json()["reparented"] == 1
        heir_detail = client.get(f"/api/books/{heir.id}", headers=admin_headers).json()
        assert heir_detail["variant_parent_id"] is None
        assert [v["id"] for v in heir_detail["variants"]] == [sibling.id]

    def test_reparent_to_empty_promotes_everyone(self, client, admin_headers, system):
        parent, _ = self._book_on_disk(system, "p2.pdf")
        child, _ = self._book_on_disk(system, "c2.pdf")
        _link(client, admin_headers, parent.id, child.id)
        resp = client.request(
            "DELETE",
            f"{API}/items/book/{parent.id}",
            headers=admin_headers,
            json={"delete_file": True, "reparent_to": ""},
        )
        assert resp.status_code == 200
        detail = client.get(f"/api/books/{child.id}", headers=admin_headers).json()
        assert detail["variant_parent_id"] is None

    def test_reparent_to_an_outsider_is_refused(self, client, admin_headers, system):
        parent, _ = self._book_on_disk(system, "p3.pdf")
        child, _ = self._book_on_disk(system, "c3.pdf")
        outsider, _ = self._book_on_disk(system, "o3.pdf")
        _link(client, admin_headers, parent.id, child.id)
        resp = client.request(
            "DELETE",
            f"{API}/items/book/{parent.id}",
            headers=admin_headers,
            json={"reparent_to": outsider.id},
        )
        assert resp.status_code == 400

    def test_missing_item_404s(self, client, admin_headers):
        resp = client.request("DELETE", f"{API}/items/book/nope", headers=admin_headers)
        assert resp.status_code == 404

    def test_requires_admin(self, client, player_headers, system):
        book, _ = self._book_on_disk(system, "player-cant.pdf")
        resp = client.request("DELETE", f"{API}/items/book/{book.id}", headers=player_headers)
        assert resp.status_code == 403


class TestCompare:
    def test_returns_diff_and_reference_counts(self, client, admin_headers, system):
        a = make_book(system_id=system.id, title="Same Title", page_count=100, file_size=10)
        b = make_book(system_id=system.id, title="Same Title", page_count=80, file_size=20)
        body = client.get(
            f"{API}/compare?resource_type=book&ids={a.id}&ids={b.id}", headers=admin_headers
        ).json()

        assert [i["id"] for i in body["items"]] == [a.id, b.id]
        diffs = {d["field"]: d for d in body["differences"]}
        assert diffs["title"]["same"] is True
        assert diffs["page_count"]["same"] is False
        # A synced flip can only run as far as the shorter book.
        assert body["page_count_min"] == 80
        # More pages wins the advisory pick.
        assert body["suggested_parent_id"] == a.id
        assert "favorites" in body["items"][0]["reference_counts"]

    def test_rejects_too_few_or_too_many(self, client, admin_headers, system):
        ids = [make_book(system_id=system.id).id for _ in range(5)]
        one = client.get(
            f"{API}/compare?resource_type=book&ids={ids[0]}", headers=admin_headers
        )
        assert one.status_code == 400
        many = "&".join(f"ids={i}" for i in ids)
        assert client.get(
            f"{API}/compare?resource_type=book&{many}", headers=admin_headers
        ).status_code == 400

    def test_works_for_media(self, client, admin_headers):
        a, b = make_map(), make_map()
        body = client.get(
            f"{API}/compare?resource_type=map&ids={a.id}&ids={b.id}", headers=admin_headers
        ).json()
        assert len(body["items"]) == 2
        assert {d["field"] for d in body["differences"]} == {
            "map_type",
            "grid_size",
            "file_size",
            "description",
        }


class TestAllCollections:
    @pytest.mark.parametrize(
        "factory,rtype,kind",
        [
            (make_map, "map", "gridless"),
            (make_token, "token", "other"),
            (make_audio, "audio", "version"),
        ],
    )
    def test_link_and_unlink(self, client, admin_headers, factory, rtype, kind):
        parent, child = factory(), factory()
        body = _link(client, admin_headers, parent.id, child.id, kind, rtype=rtype).json()
        assert body["linked"] == [child.id]

        detail = client.get(f"/api/{rtype}s/{child.id}" if rtype != "audio"
                            else f"/api/audio/{child.id}", headers=admin_headers).json()
        assert detail["variant_parent_id"] == parent.id

        out = client.post(
            f"{API}/unlink",
            headers=admin_headers,
            json={"resource_type": rtype, "ids": [child.id]},
        ).json()
        assert out["unlinked"] == [child.id]


class TestDismissPrunesLiveResults:
    """A dismissed pair must leave the current list immediately, not next scan."""

    def _group(self, db, system, member_ids, edges):
        from backend.models.duplicates import DuplicateGroup
        from backend.services.duplicates.grouping import group_key

        row = DuplicateGroup(
            scan_id="s1",
            resource_type="book",
            group_key=group_key(member_ids),
            member_ids=member_ids,
            confidence=0.9,
            reasons=["metadata"],
            edges=edges,
            suggested_parent_id=member_ids[0],
            suggested_kinds={},
        )
        db.add(row)
        db.commit()
        return row

    def test_dismissing_one_pair_inside_a_larger_group_drops_that_pair(
        self, client, admin_headers, system
    ):
        # The regression: the old whole-group subset test only fired when the
        # dismissed set covered the entire group, so this deleted nothing and
        # the rejected pair reappeared on screen straight away.
        from backend.config import SessionLocal

        books = [make_book(system_id=system.id) for _ in range(4)]
        ids = [b.id for b in books]
        edges = [
            {"a": ids[0], "b": ids[1], "reason": "hash", "score": 1.0},
            {"a": ids[3], "b": ids[0], "reason": "metadata", "score": 0.8},
            {"a": ids[3], "b": ids[1], "reason": "metadata", "score": 0.8},
            {"a": ids[3], "b": ids[2], "reason": "metadata", "score": 0.8},
        ]
        db = SessionLocal()
        try:
            self._group(db, system, ids, edges)
        finally:
            db.close()

        resp = client.post(
            f"{API}/dismiss",
            headers=admin_headers,
            json={"resource_type": "book", "member_ids": [ids[3], ids[0]]},
        )
        assert resp.status_code == 200

        groups = client.get(f"{API}/groups", headers=admin_headers).json()["groups"]
        remaining = {
            frozenset((e["a"], e["b"])) for g in groups for e in g.get("edges", [])
        }
        assert frozenset((ids[3], ids[0])) not in remaining
        # The genuine duplicate is untouched.
        assert frozenset((ids[0], ids[1])) in remaining

    def test_group_disappears_once_its_last_edge_is_dismissed(
        self, client, admin_headers, system
    ):
        from backend.config import SessionLocal

        a, b = make_book(system_id=system.id), make_book(system_id=system.id)
        db = SessionLocal()
        try:
            self._group(
                db,
                system,
                [a.id, b.id],
                [{"a": a.id, "b": b.id, "reason": "hash", "score": 1.0}],
            )
        finally:
            db.close()

        client.post(
            f"{API}/dismiss",
            headers=admin_headers,
            json={"resource_type": "book", "member_ids": [a.id, b.id]},
        )
        # Scoped to this test's own books: the test DB is shared, so a bare
        # "no groups at all" assertion would depend on sibling tests.
        groups = client.get(f"{API}/groups", headers=admin_headers).json()["groups"]
        mine = [
            g
            for g in groups
            if {a.id, b.id} & {m["id"] for m in g["members"]}
        ]
        assert mine == []
