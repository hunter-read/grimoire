"""API-level tests for system containers (issues #261, #262).

Covers how container folders and their child systems surface through
``GET /api/systems``, ``GET /api/systems/{id}``, ``PATCH /api/systems/{id}``,
and ``GET /api/library/stats``.
"""
import pytest

from backend.tests.conftest import make_book, make_game_system


@pytest.fixture(scope="module")
def container():
    return make_game_system(
        name="API Container D&D",
        slug="api-container-dnd",
        container_kind="parent",
    )


@pytest.fixture(scope="module")
def child(container):
    system = make_game_system(
        name="API Container D&D 5e",
        slug="api-container-dnd--5e",
        parent_id=container.id,
        parent_system="API Container D&D",
        edition="5e",
    )
    make_book(system.id, category="core")
    return system


class TestListSystemsExcludesChildren:
    def test_container_appears_in_default_listing(self, client, admin_headers, container, child):
        resp = client.get("/api/systems", headers=admin_headers)
        ids = [s["id"] for s in resp.json()]
        assert container.id in ids

    def test_child_hidden_from_default_listing(self, client, admin_headers, container, child):
        resp = client.get("/api/systems", headers=admin_headers)
        ids = [s["id"] for s in resp.json()]
        assert child.id not in ids

    def test_parent_id_filter_returns_only_that_containers_children(
        self, client, admin_headers, container, child
    ):
        resp = client.get(f"/api/systems?parent_id={container.id}", headers=admin_headers)
        ids = [s["id"] for s in resp.json()]
        assert ids == [child.id]

    def test_include_children_returns_a_flat_list(self, client, admin_headers, container, child):
        resp = client.get("/api/systems?include_children=true", headers=admin_headers)
        ids = [s["id"] for s in resp.json()]
        assert container.id in ids
        assert child.id in ids

    def test_container_reports_its_child_count(self, client, admin_headers, container, child):
        resp = client.get("/api/systems", headers=admin_headers)
        row = next(s for s in resp.json() if s["id"] == container.id)
        assert row["child_count"] == 1

    def test_ordinary_system_reports_zero_children(self, client, admin_headers):
        plain = make_game_system(name="API Plain One", slug="api-plain-one")
        resp = client.get("/api/systems", headers=admin_headers)
        row = next(s for s in resp.json() if s["id"] == plain.id)
        assert row["child_count"] == 0
        assert row["container_kind"] == ""


class TestSystemSummaryShape:
    def test_container_fields_present(self, client, admin_headers, container, child):
        resp = client.get("/api/systems", headers=admin_headers)
        row = next(s for s in resp.json() if s["id"] == container.id)
        assert row["container_kind"] == "parent"
        assert row["parent_id"] is None
        assert row["name_is_custom"] is False

    def test_child_reports_its_parent(self, client, admin_headers, container, child):
        resp = client.get(f"/api/systems?parent_id={container.id}", headers=admin_headers)
        row = resp.json()[0]
        assert row["parent_id"] == container.id
        assert row["parent_system"] == "API Container D&D"
        assert row["edition"] == "5e"


class TestGetContainerDetail:
    def test_container_detail_lists_children(self, client, admin_headers, container, child):
        resp = client.get(f"/api/systems/{container.id}", headers=admin_headers)
        assert [c["id"] for c in resp.json()["children"]] == [child.id]

    def test_child_row_carries_its_book_count(self, client, admin_headers, container, child):
        resp = client.get(f"/api/systems/{container.id}", headers=admin_headers)
        assert resp.json()["children"][0]["book_count"] == 1

    def test_container_detail_reports_child_count(self, client, admin_headers, container, child):
        resp = client.get(f"/api/systems/{container.id}", headers=admin_headers)
        assert resp.json()["child_count"] == 1

    def test_ordinary_system_has_empty_children(self, client, admin_headers):
        plain = make_game_system(name="API Plain Two", slug="api-plain-two")
        resp = client.get(f"/api/systems/{plain.id}", headers=admin_headers)
        assert resp.json()["children"] == []

    def test_child_detail_still_returns_its_books(self, client, admin_headers, child):
        resp = client.get(f"/api/systems/{child.id}", headers=admin_headers)
        body = resp.json()
        assert len(body["books"]) == 1
        assert body["children"] == []


class TestRenameMarksNameCustom:
    def test_rename_sets_name_is_custom(self, client, admin_headers):
        system = make_game_system(name="API Rename Me", slug="api-rename-me")
        resp = client.patch(
            f"/api/systems/{system.id}",
            json={"name": "API Renamed"},
            headers=admin_headers,
        )
        assert resp.status_code == 200
        detail = client.get(f"/api/systems/{system.id}", headers=admin_headers).json()
        assert detail["name"] == "API Renamed"
        assert detail["name_is_custom"] is True

    def test_editing_other_fields_does_not_mark_name_custom(self, client, admin_headers):
        system = make_game_system(name="API Keep Name", slug="api-keep-name")
        client.patch(
            f"/api/systems/{system.id}",
            json={"description": "just a description edit"},
            headers=admin_headers,
        )
        detail = client.get(f"/api/systems/{system.id}", headers=admin_headers).json()
        assert detail["name_is_custom"] is False

    def test_patching_same_name_does_not_mark_custom(self, client, admin_headers):
        system = make_game_system(name="API Same Name", slug="api-same-name")
        client.patch(
            f"/api/systems/{system.id}",
            json={"name": "API Same Name"},
            headers=admin_headers,
        )
        detail = client.get(f"/api/systems/{system.id}", headers=admin_headers).json()
        assert detail["name_is_custom"] is False


class TestStatsCountsChildrenNotContainers:
    def _count(self, client, admin_headers):
        return client.get("/api/stats", headers=admin_headers).json()["game_systems"]

    def test_container_is_not_counted_but_child_is(self, client, admin_headers):
        before = self._count(client, admin_headers)
        parent = make_game_system(
            name="API Stats Container",
            slug="api-stats-container",
            container_kind="one-page",
            is_one_page=True,
        )
        make_game_system(
            name="API Stats Child A",
            slug="api-stats-container--a",
            parent_id=parent.id,
        )
        make_game_system(
            name="API Stats Child B",
            slug="api-stats-container--b",
            parent_id=parent.id,
        )
        # +2 for the children, +0 for the container itself.
        assert self._count(client, admin_headers) == before + 2

    def test_parent_kind_container_also_excluded(self, client, admin_headers):
        before = self._count(client, admin_headers)
        make_game_system(
            name="API Stats Parent Container",
            slug="api-stats-parent-container",
            container_kind="parent",
        )
        assert self._count(client, admin_headers) == before


class TestContainerCoverIsNotBorrowedFromBooks:
    """A container must not adopt one of its children's book covers.

    Containers are shelves of systems; an arbitrary game's front page standing in
    for the whole collection is misleading. They show folder art, an upload, or
    nothing.
    """

    def test_container_reports_no_cover_book(self, client, admin_headers):
        parent = make_game_system(
            name="Cover Container", slug="cover-container", container_kind="one-page",
            is_one_page=True,
        )
        # A book attached directly to the container (as a pre-upgrade DB would have).
        make_book(parent.id, category="core", has_thumbnail=True)

        resp = client.get("/api/systems?include_children=true", headers=admin_headers)
        row = next(s for s in resp.json() if s["id"] == parent.id)
        assert row["cover_book_id"] is None

    def test_container_detail_reports_no_cover_book(self, client, admin_headers):
        parent = make_game_system(
            name="Cover Container Detail", slug="cover-container-detail",
            container_kind="parent",
        )
        make_book(parent.id, category="core", has_thumbnail=True)

        resp = client.get(f"/api/systems/{parent.id}", headers=admin_headers)
        assert resp.json()["cover_book_id"] is None

    def test_explicit_cover_book_on_a_container_is_still_honoured(self, client, admin_headers):
        parent = make_game_system(
            name="Cover Container Explicit", slug="cover-container-explicit",
            container_kind="parent",
        )
        book = make_book(parent.id, category="core", has_thumbnail=True)
        client.patch(
            f"/api/systems/{parent.id}", json={"cover_book_id": book.id}, headers=admin_headers
        )
        resp = client.get(f"/api/systems/{parent.id}", headers=admin_headers)
        assert resp.json()["cover_book_id"] == book.id

    def test_ordinary_system_still_derives_a_cover_from_its_books(self, client, admin_headers):
        system = make_game_system(name="Cover Ordinary", slug="cover-ordinary")
        book = make_book(system.id, category="core", has_thumbnail=True)
        resp = client.get(f"/api/systems/{system.id}", headers=admin_headers)
        assert resp.json()["cover_book_id"] == book.id


class TestChildKnowsItsParent:
    """A child carries its container's name so it can offer "back to <container>"."""

    def test_child_reports_parent_name(self, client, admin_headers, container, child):
        resp = client.get(f"/api/systems/{child.id}", headers=admin_headers)
        body = resp.json()
        assert body["parent_id"] == container.id
        assert body["parent_name"] == "API Container D&D"

    def test_child_reports_whether_its_parent_is_a_one_page_collection(
        self, client, admin_headers
    ):
        parent = make_game_system(
            name="API Back One Page",
            slug="api-back-one-page",
            container_kind="one-page",
            is_one_page=True,
        )
        kid = make_game_system(
            name="API Back Child", slug="api-back-one-page--child", parent_id=parent.id
        )
        resp = client.get(f"/api/systems/{kid.id}", headers=admin_headers)
        body = resp.json()
        assert body["parent_name"] == "API Back One Page"
        assert body["parent_is_one_page"] is True

    def test_parent_system_child_reports_a_non_one_page_parent(
        self, client, admin_headers, child
    ):
        resp = client.get(f"/api/systems/{child.id}", headers=admin_headers)
        assert resp.json()["parent_is_one_page"] is False

    def test_top_level_system_has_no_parent_name(self, client, admin_headers):
        system = make_game_system(name="API Back Top Level", slug="api-back-top-level")
        resp = client.get(f"/api/systems/{system.id}", headers=admin_headers)
        body = resp.json()
        assert body["parent_id"] is None
        assert body["parent_name"] == ""


class TestRenameValidation:
    """Renaming is how "Dungeons & Dragons 2e" becomes "Advanced Dungeons & Dragons"."""

    def test_rename_to_a_taken_name_is_a_conflict_not_a_crash(self, client, admin_headers):
        make_game_system(name="API Taken Name", slug="api-taken-name")
        other = make_game_system(name="API Renamer", slug="api-renamer")
        resp = client.patch(
            f"/api/systems/{other.id}",
            json={"name": "API Taken Name"},
            headers=admin_headers,
        )
        assert resp.status_code == 409

    def test_conflicting_rename_leaves_the_original_name(self, client, admin_headers):
        make_game_system(name="API Taken Name 2", slug="api-taken-name-2")
        other = make_game_system(name="API Renamer 2", slug="api-renamer-2")
        client.patch(
            f"/api/systems/{other.id}",
            json={"name": "API Taken Name 2"},
            headers=admin_headers,
        )
        detail = client.get(f"/api/systems/{other.id}", headers=admin_headers).json()
        assert detail["name"] == "API Renamer 2"

    def test_renaming_to_its_own_name_is_allowed(self, client, admin_headers):
        system = make_game_system(name="API Self Rename", slug="api-self-rename")
        resp = client.patch(
            f"/api/systems/{system.id}",
            json={"name": "API Self Rename"},
            headers=admin_headers,
        )
        assert resp.status_code == 200

    def test_blank_name_is_rejected(self, client, admin_headers):
        system = make_game_system(name="API Blank Rename", slug="api-blank-rename")
        resp = client.patch(
            f"/api/systems/{system.id}", json={"name": "   "}, headers=admin_headers
        )
        assert resp.status_code == 422

    def test_name_is_trimmed(self, client, admin_headers):
        system = make_game_system(name="API Trim Rename", slug="api-trim-rename")
        client.patch(
            f"/api/systems/{system.id}",
            json={"name": "  Advanced API Trim  "},
            headers=admin_headers,
        )
        detail = client.get(f"/api/systems/{system.id}", headers=admin_headers).json()
        assert detail["name"] == "Advanced API Trim"

    def test_the_advanced_dnd_case_end_to_end(self, client, admin_headers, container):
        """The motivating example: a generated edition name corrected by hand."""
        child = make_game_system(
            name="API Container D&D 2e",
            slug="api-container-dnd--2e",
            parent_id=container.id,
            parent_system="API Container D&D",
            edition="2e",
        )
        resp = client.patch(
            f"/api/systems/{child.id}",
            json={"name": "Advanced API Container D&D"},
            headers=admin_headers,
        )
        assert resp.status_code == 200
        detail = client.get(f"/api/systems/{child.id}", headers=admin_headers).json()
        assert detail["name"] == "Advanced API Container D&D"
        assert detail["name_is_custom"] is True
        # Its place in the container is unchanged.
        assert detail["parent_id"] == container.id
        assert detail["edition"] == "2e"
