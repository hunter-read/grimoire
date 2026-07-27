"""Tests for expanded system metadata, sort/filter, and serialization (#202)."""
from backend.tests.conftest import make_book, make_game_system


class TestSystemMetadataFields:
    def test_new_fields_in_list(self, client, admin_headers):
        make_game_system(
            name="Blades Test",
            slug="blades-test",
            genres=["Fantasy", "Heist"],
            dice_materials=["D6 pool"],
            system_family="Forged in the Dark",
            license="CC-BY",
            year=2017,
            urls=[{"label": "DriveThruRPG", "url": "http://example.com"}],
        )
        resp = client.get("/api/systems", headers=admin_headers)
        s = next(s for s in resp.json() if s["slug"] == "blades-test")
        assert s["genres"] == ["Fantasy", "Heist"]
        assert s["dice_materials"] == ["D6 pool"]
        assert s["system_family"] == "Forged in the Dark"
        assert s["license"] == "CC-BY"
        assert s["year"] == 2017
        assert s["urls"][0]["label"] == "DriveThruRPG"
        assert "total_page_count" in s
        assert "is_one_page" in s

    def test_update_metadata(self, client, admin_headers):
        sysobj = make_game_system(name="Patch Meta", slug="patch-meta")
        resp = client.patch(
            f"/api/systems/{sysobj.id}",
            json={
                "genres": ["Horror", "Horror", "  gothic  "],
                "system_family": "GUMSHOE",
                "year": 2011,
                "character_builder_urls": [{"label": "Sheet", "url": "http://s"}],
            },
            headers=admin_headers,
        )
        assert resp.status_code == 200
        got = client.get(f"/api/systems/{sysobj.id}", headers=admin_headers).json()
        # De-duplicated case-insensitively, trimmed, case preserved.
        assert got["genres"] == ["Horror", "gothic"]
        assert got["system_family"] == "GUMSHOE"
        assert got["character_builder_urls"][0]["url"] == "http://s"

    def test_update_parent_system_and_edition(self, client, admin_headers):
        sysobj = make_game_system(name="Cyberpunk Red", slug="cp-red")
        resp = client.patch(
            f"/api/systems/{sysobj.id}",
            json={"parent_system": "Cyberpunk", "edition": "Red", "license": "Custom"},
            headers=admin_headers,
        )
        assert resp.status_code == 200
        got = client.get(f"/api/systems/{sysobj.id}", headers=admin_headers).json()
        assert got["parent_system"] == "Cyberpunk"
        assert got["edition"] == "Red"
        assert got["license"] == "Custom"

    def test_new_fields_default_empty(self, client, admin_headers):
        sysobj = make_game_system(name="Bare Sys", slug="bare-sys")
        got = client.get(f"/api/systems/{sysobj.id}", headers=admin_headers).json()
        assert got["parent_system"] == ""
        assert got["edition"] == ""

    def test_total_page_count_aggregates(self, client, admin_headers):
        sysobj = make_game_system(name="Pages Sys", slug="pages-sys")
        make_book(system_id=sysobj.id, page_count=10)
        make_book(system_id=sysobj.id, page_count=25)
        resp = client.get("/api/systems", headers=admin_headers)
        s = next(s for s in resp.json() if s["slug"] == "pages-sys")
        assert s["total_page_count"] == 35
        assert s["book_count"] == 2


class TestSystemSort:
    def _slugs(self, rows, prefix):
        return [r["slug"] for r in rows if r["slug"].startswith(prefix)]

    def test_sort_by_page_count(self, client, admin_headers):
        a = make_game_system(name="Zsort A", slug="zsort-a")
        b = make_game_system(name="Zsort B", slug="zsort-b")
        make_book(system_id=a.id, page_count=5)
        make_book(system_id=b.id, page_count=50)
        rows = client.get(
            "/api/systems?sort=page_count&order=desc", headers=admin_headers
        ).json()
        ordered = self._slugs(rows, "zsort-")
        assert ordered.index("zsort-b") < ordered.index("zsort-a")

    def test_sort_by_name_desc(self, client, admin_headers):
        make_game_system(name="Alpha Name", slug="namesort-alpha")
        make_game_system(name="Beta Name", slug="namesort-beta")
        rows = client.get("/api/systems?sort=name&order=desc", headers=admin_headers).json()
        ordered = self._slugs(rows, "namesort-")
        assert ordered.index("namesort-beta") < ordered.index("namesort-alpha")


class TestSystemFilter:
    def test_filter_by_genre(self, client, admin_headers):
        make_game_system(name="GenreFilt", slug="genrefilt", genres=["Steampunk"])
        rows = client.get("/api/systems?genre=Steampunk", headers=admin_headers).json()
        assert any(s["slug"] == "genrefilt" for s in rows)
        assert all("Steampunk" in (s.get("genres") or []) for s in rows)

    def test_filter_by_family(self, client, admin_headers):
        make_game_system(name="FamFilt", slug="famfilt", system_family="Cypher System")
        rows = client.get(
            "/api/systems?family=Cypher System", headers=admin_headers
        ).json()
        assert any(s["slug"] == "famfilt" for s in rows)

    def test_filter_by_parent_system(self, client, admin_headers):
        make_game_system(
            name="ParentFilt", slug="parentfilt", parent_system="Dungeons & Dragons"
        )
        make_game_system(name="OtherPar", slug="otherpar", parent_system="Cyberpunk")
        rows = client.get(
            "/api/systems?parent_system=Dungeons %26 Dragons", headers=admin_headers
        ).json()
        slugs = [s["slug"] for s in rows]
        assert "parentfilt" in slugs
        assert "otherpar" not in slugs

    def test_filter_by_edition(self, client, admin_headers):
        make_game_system(
            name="EdFilt", slug="edfilt", parent_system="Cyberpunk", edition="Red"
        )
        rows = client.get("/api/systems?edition=Red", headers=admin_headers).json()
        assert any(s["slug"] == "edfilt" for s in rows)

    def test_filter_by_license(self, client, admin_headers):
        make_game_system(name="LicFilt", slug="licfilt", license="OGL 1.0a")
        rows = client.get(
            "/api/systems?license=OGL 1.0a", headers=admin_headers
        ).json()
        assert any(s["slug"] == "licfilt" for s in rows)

    def test_filter_explicit(self, client, admin_headers):
        make_game_system(name="ExplFilt", slug="explfilt", is_explicit=True)
        rows = client.get("/api/systems?explicit=true", headers=admin_headers).json()
        assert all(s["is_explicit"] for s in rows)
        assert any(s["slug"] == "explfilt" for s in rows)


class TestBookMetadata:
    def test_book_new_fields(self, client, admin_headers):
        sysobj = make_game_system(name="BookMeta Sys", slug="bookmeta-sys")
        book = make_book(
            system_id=sysobj.id,
            artists=["Jane Artist"],
            genres=["Grimdark"],
            isbn="978-3-16-148410-0",
            version="1.2",
            language="en",
            year=2019,
            month=3,
            day=14,
        )
        got = client.get(f"/api/systems/{sysobj.id}", headers=admin_headers).json()
        b = next(x for x in got["books"] if x["id"] == book.id)
        assert b["artists"] == ["Jane Artist"]
        assert b["genres"] == ["Grimdark"]
        assert b["isbn"] == "978-3-16-148410-0"
        assert b["version"] == "1.2"
        assert b["month"] == 3
        assert b["day"] == 14

    def test_book_license_override(self, client, admin_headers):
        # A book can carry its own license (e.g. an OGL SRD in a proprietary system).
        sysobj = make_game_system(
            name="LicSys", slug="licsys", license="Proprietary / All Rights Reserved"
        )
        book = make_book(system_id=sysobj.id)
        resp = client.patch(
            f"/api/books/{book.id}", json={"license": "OGL 1.0a"}, headers=admin_headers
        )
        assert resp.status_code == 200
        got = client.get(f"/api/systems/{sysobj.id}", headers=admin_headers).json()
        b = next(x for x in got["books"] if x["id"] == book.id)
        assert b["license"] == "OGL 1.0a"

    def test_book_update_month_validation(self, client, admin_headers):
        sysobj = make_game_system(name="BadDate Sys", slug="baddate-sys")
        book = make_book(system_id=sysobj.id)
        resp = client.patch(
            f"/api/books/{book.id}", json={"month": 13}, headers=admin_headers
        )
        assert resp.status_code == 422

    def test_book_update_month_zero_rejected(self, client, admin_headers):
        sysobj = make_game_system(name="ZeroMonth Sys", slug="zeromonth-sys")
        book = make_book(system_id=sysobj.id)
        resp = client.patch(
            f"/api/books/{book.id}", json={"month": 0}, headers=admin_headers
        )
        assert resp.status_code == 422

    def test_book_update_day_out_of_range(self, client, admin_headers):
        sysobj = make_game_system(name="BadDay Sys", slug="badday-sys")
        book = make_book(system_id=sysobj.id)
        resp = client.patch(
            f"/api/books/{book.id}", json={"day": 32}, headers=admin_headers
        )
        assert resp.status_code == 422

    def test_book_update_valid_full_date(self, client, admin_headers):
        sysobj = make_game_system(name="GoodDate Sys", slug="gooddate-sys")
        book = make_book(system_id=sysobj.id)
        resp = client.patch(
            f"/api/books/{book.id}",
            json={"year": 2020, "month": 6, "day": 15, "genres": ["  Fantasy  ", "fantasy"]},
            headers=admin_headers,
        )
        assert resp.status_code == 200
        got = client.get(f"/api/books/{book.id}", headers=admin_headers).json()
        assert (got["year"], got["month"], got["day"]) == (2020, 6, 15)
        # Genres trimmed and de-duplicated case-insensitively.
        assert got["genres"] == ["Fantasy"]

    def test_book_url_backfill_field(self, client, admin_headers):
        sysobj = make_game_system(name="BookUrl Sys", slug="bookurl-sys")
        book = make_book(system_id=sysobj.id)
        client.patch(
            f"/api/books/{book.id}",
            json={"urls": [{"label": "DTRPG", "url": "http://x"}]},
            headers=admin_headers,
        )
        got = client.get(f"/api/books/{book.id}", headers=admin_headers).json()
        assert got["urls"][0]["label"] == "DTRPG"


class TestBookSortFilter:
    def test_book_sort_by_page_count(self, client, admin_headers):
        sysobj = make_game_system(name="BookSort Sys", slug="booksort-sys")
        make_book(system_id=sysobj.id, title="Small", page_count=3)
        make_book(system_id=sysobj.id, title="Large", page_count=300)
        got = client.get(
            f"/api/systems/{sysobj.id}?book_sort=page_count&book_order=desc",
            headers=admin_headers,
        ).json()
        titles = [b["title"] for b in got["books"]]
        assert titles.index("Large") < titles.index("Small")

    def test_book_filter_explicit(self, client, admin_headers):
        sysobj = make_game_system(name="BookExpl Sys", slug="bookexpl-sys")
        make_book(system_id=sysobj.id, title="Clean", is_explicit=False)
        make_book(system_id=sysobj.id, title="Spicy", is_explicit=True)
        got = client.get(
            f"/api/systems/{sysobj.id}?explicit=true", headers=admin_headers
        ).json()
        titles = [b["title"] for b in got["books"]]
        assert "Spicy" in titles and "Clean" not in titles
