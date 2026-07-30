"""Tests for the saved-filters API (server-side sort/filter presets)."""


class TestSavedFilters:
    def test_create_and_list(self, client, admin_headers):
        r = client.post(
            "/api/saved-filters",
            json={"scope": "systems", "name": "By pages", "state": {"sort": "page_count"}},
            headers=admin_headers,
        )
        assert r.status_code == 200
        assert r.json()["name"] == "By pages"
        assert r.json()["state"] == {"sort": "page_count"}

        rows = client.get("/api/saved-filters?scope=systems", headers=admin_headers).json()[
            "filters"
        ]
        assert any(f["name"] == "By pages" for f in rows)

    def test_blank_name_rejected(self, client, admin_headers):
        r = client.post(
            "/api/saved-filters",
            json={"scope": "systems", "name": "   ", "state": {}},
            headers=admin_headers,
        )
        assert r.status_code == 422

    def test_invalid_scope_rejected(self, client, admin_headers):
        r = client.post(
            "/api/saved-filters",
            json={"scope": "nope", "name": "x", "state": {}},
            headers=admin_headers,
        )
        assert r.status_code == 422

    def test_list_invalid_scope_query(self, client, admin_headers):
        r = client.get("/api/saved-filters?scope=nope", headers=admin_headers)
        assert r.status_code == 400

    def test_resave_overwrites_state(self, client, admin_headers):
        client.post(
            "/api/saved-filters",
            json={"scope": "books", "name": "Dupe", "state": {"sort": "title"}},
            headers=admin_headers,
        )
        r = client.post(
            "/api/saved-filters",
            json={"scope": "books", "name": "Dupe", "state": {"sort": "year"}},
            headers=admin_headers,
        )
        assert r.status_code == 200
        assert r.json()["state"] == {"sort": "year"}
        # No duplicate row created.
        rows = client.get("/api/saved-filters?scope=books", headers=admin_headers).json()[
            "filters"
        ]
        assert len([f for f in rows if f["name"] == "Dupe"]) == 1

    def test_only_one_default_per_scope(self, client, admin_headers):
        a = client.post(
            "/api/saved-filters",
            json={"scope": "maps", "name": "A", "state": {}, "is_default": True},
            headers=admin_headers,
        ).json()
        b = client.post(
            "/api/saved-filters",
            json={"scope": "maps", "name": "B", "state": {}},
            headers=admin_headers,
        ).json()
        # Promote B to default → A must lose it.
        client.patch(
            f"/api/saved-filters/{b['id']}", json={"is_default": True}, headers=admin_headers
        )
        rows = client.get("/api/saved-filters?scope=maps", headers=admin_headers).json()["filters"]
        defaults = {f["name"]: f["is_default"] for f in rows}
        assert defaults["A"] is False
        assert defaults["B"] is True
        assert a["is_default"] is True  # was default at creation

    def test_default_isolated_per_scope(self, client, admin_headers):
        client.post(
            "/api/saved-filters",
            json={"scope": "tokens", "name": "TokDefault", "state": {}, "is_default": True},
            headers=admin_headers,
        )
        client.post(
            "/api/saved-filters",
            json={"scope": "audio", "name": "AudDefault", "state": {}, "is_default": True},
            headers=admin_headers,
        )
        tok = client.get("/api/saved-filters?scope=tokens", headers=admin_headers).json()[
            "filters"
        ]
        aud = client.get("/api/saved-filters?scope=audio", headers=admin_headers).json()["filters"]
        assert tok[0]["is_default"] is True
        assert aud[0]["is_default"] is True

    def test_update_rename_and_state(self, client, admin_headers):
        f = client.post(
            "/api/saved-filters",
            json={"scope": "systems", "name": "Old", "state": {"sort": "name"}},
            headers=admin_headers,
        ).json()
        r = client.patch(
            f"/api/saved-filters/{f['id']}",
            json={"name": "New", "state": {"sort": "year"}},
            headers=admin_headers,
        )
        assert r.status_code == 200
        assert r.json()["name"] == "New"
        assert r.json()["state"] == {"sort": "year"}

    def test_delete(self, client, admin_headers):
        f = client.post(
            "/api/saved-filters",
            json={"scope": "systems", "name": "ToDelete", "state": {}},
            headers=admin_headers,
        ).json()
        assert (
            client.delete(f"/api/saved-filters/{f['id']}", headers=admin_headers).status_code
            == 200
        )
        assert (
            client.delete(f"/api/saved-filters/{f['id']}", headers=admin_headers).status_code
            == 404
        )

    def test_update_missing_404(self, client, admin_headers):
        assert (
            client.patch(
                "/api/saved-filters/nope", json={"name": "x"}, headers=admin_headers
            ).status_code
            == 404
        )

    def test_filters_are_per_user(self, client, admin_headers, gm_headers):
        client.post(
            "/api/saved-filters",
            json={"scope": "systems", "name": "AdminOnly", "state": {}},
            headers=admin_headers,
        )
        gm_rows = client.get("/api/saved-filters", headers=gm_headers).json()["filters"]
        assert all(f["name"] != "AdminOnly" for f in gm_rows)

    def test_requires_auth(self, client):
        assert client.get("/api/saved-filters").status_code == 401
