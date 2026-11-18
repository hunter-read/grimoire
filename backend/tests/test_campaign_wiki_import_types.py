"""Wiki import refuses JSON of the wrong shape with a 4xx, never a server error.

An imported file is untrusted. Each test takes a well-formed file - a Grimoire
bundle the app exported itself, and LegendKeeper exports in both shapes - and
swaps every value in it, one at a time, for values of other types. Every one of
those imports must answer 2xx or 4xx.
"""
import copy
import io
import json
import uuid
import zipfile

from backend.tests.conftest import make_map
from backend.tests.test_campaign_wiki_io import _lk_bundle

# A value of every JSON type, plus a number too large for a 64-bit column. A
# list holding null comes from swapping a list item for None.
WRONG = (5, 2**63, True, None, "x", [1], {"a": 1})


def uid():
    return uuid.uuid4().hex[:8]


def _campaign(client, gm_headers):
    return client.post(
        "/api/campaigns", json={"name": f"Types {uid()}", "is_gm_campaign": True},
        headers=gm_headers,
    ).json()["id"]


def _paths(value, path=()):
    """Every path into a JSON value, the root included."""
    yield path
    if isinstance(value, dict):
        for key, child in value.items():
            yield from _paths(child, path + (key,))
    elif isinstance(value, list):
        for i, child in enumerate(value):
            yield from _paths(child, path + (i,))


def _replaced(doc, path, new):
    if not path:
        return new
    out = copy.deepcopy(doc)
    node = out
    for key in path[:-1]:
        node = node[key]
    node[path[-1]] = new
    return out


def _post(client, headers, cid, filename, payload: bytes, content_type):
    return client.post(
        f"/api/campaigns/{cid}/wiki/import",
        files={"file": (filename, payload, content_type)},
        headers=headers,
    )


def _mutations_answer_cleanly(client, headers, cid, doc, filename="wiki.json", pack=None):
    pack = pack or (lambda d: json.dumps(d).encode())
    content_type = "application/zip" if filename.endswith(".zip") else "application/json"
    failures = []
    for path in list(_paths(doc)):
        for new in WRONG:
            mutated = _replaced(doc, path, new)
            try:
                resp = _post(client, headers, cid, filename, pack(mutated), content_type)
                status = resp.status_code
            except Exception as e:  # the test client re-raises a server error
                status = f"{type(e).__name__}: {e}"
            if not isinstance(status, int) or status >= 500:
                failures.append((path, new, status))
    assert failures == [], failures[:10]


def _exported_bundle(client, gm_headers, cid):
    m = make_map(filename=f"coast-{uid()}.png")
    client.post(
        f"/api/campaigns/{cid}/resources",
        json={"resource_type": "map", "resource_id": m.id, "visibility": "public"},
        headers=gm_headers,
    )
    parent = client.post(
        f"/api/campaigns/{cid}/wiki",
        json={"title": "Places", "body": "See [[Waterdeep]].", "icon": "castle",
              "icon_color": "#a1b2c3"},
        headers=gm_headers,
    ).json()
    client.post(
        f"/api/campaigns/{cid}/wiki",
        json={"title": "Waterdeep", "body": "City.", "parent_id": parent["id"],
              "visibility": "group"},
        headers=gm_headers,
    )
    client.post(
        f"/api/campaigns/{cid}/wiki",
        json={"title": "Session 1", "page_type": "session", "session_date": "2026-11-01"},
        headers=gm_headers,
    )
    page = client.post(
        f"/api/campaigns/{cid}/wiki",
        json={"title": "Coast", "page_type": "map", "map_id": m.id, "visibility": "group"},
        headers=gm_headers,
    ).json()
    client.post(
        f"/api/campaigns/{cid}/wiki/{page['id']}/pins",
        json={"x": 0.5, "y": 0.5, "label": "Port", "target_title": "Waterdeep"},
        headers=gm_headers,
    )
    resp = client.get(
        f"/api/campaigns/{cid}/wiki/export", params={"format": "json"}, headers=gm_headers
    )
    assert resp.status_code == 200
    return resp.json()


def _rich_lk_bundle():
    """The LegendKeeper bundle sample, plus the block types it leaves out."""
    bundle = _lk_bundle()
    bundle["resources"].append(
        {
            "id": "lists",
            "name": "Lists",
            "parentId": "magic",
            "isHidden": False,
            "documents": [
                {
                    "id": "d4",
                    "content": {
                        "type": "doc",
                        "content": [
                            {
                                "type": "bulletList",
                                "content": [
                                    {
                                        "type": "listItem",
                                        "content": [
                                            {
                                                "type": "paragraph",
                                                "content": [
                                                    {
                                                        "type": "text",
                                                        "text": "Link",
                                                        "marks": [
                                                            {"type": "strong"},
                                                            {
                                                                "type": "link",
                                                                "attrs": {"href": "https://x"},
                                                            },
                                                        ],
                                                    },
                                                    {"type": "hardBreak"},
                                                ],
                                            }
                                        ],
                                    }
                                ],
                            },
                            {
                                "type": "codeBlock",
                                "attrs": {"language": "js"},
                                "content": [{"type": "text", "text": "x()"}],
                            },
                            {
                                "type": "blockquote",
                                "content": [
                                    {
                                        "type": "paragraph",
                                        "content": [
                                            {
                                                "type": "mention",
                                                "attrs": {"documentId": "d1", "text": "Magic"},
                                            }
                                        ],
                                    }
                                ],
                            },
                            {"type": "horizontalRule"},
                        ],
                    },
                }
            ],
        }
    )
    return bundle


def _lk_pages():
    return [
        {
            "id": "aaaa",
            "name": "Castle",
            "parentId": None,
            "documents": [
                {
                    "content": "<div class='lk-tab' id='t'><p>Home of the "
                    "<a href=\"bbbb.html\">Baron</a>.</p></div>"
                }
            ],
        },
        {
            "id": "bbbb",
            "name": "Baron",
            "documents": [{"content": "<p>A noble.</p>"}],
        },
    ]


def _zip_of_pages(pages) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        if isinstance(pages, list):
            for i, page in enumerate(pages):
                zf.writestr(f"page-{i}.json", json.dumps(page))
        else:
            zf.writestr("page.json", json.dumps(pages))
    return buf.getvalue()


class TestWrongTypes:
    def test_an_exported_bundle(self, client, gm_headers):
        cid = _campaign(client, gm_headers)
        bundle = _exported_bundle(client, gm_headers, cid)
        # The unmutated bundle imports.
        resp = _post(client, gm_headers, cid, "wiki.json", json.dumps(bundle).encode(),
                     "application/json")
        assert resp.status_code == 201, resp.text
        _mutations_answer_cleanly(client, gm_headers, cid, bundle)

    def test_a_legendkeeper_bundle(self, client, gm_headers):
        cid = _campaign(client, gm_headers)
        bundle = _rich_lk_bundle()
        resp = _post(client, gm_headers, cid, "wiki.lk", json.dumps(bundle).encode(),
                     "application/json")
        assert resp.status_code == 201, resp.text
        assert resp.json()["imported"] == 4
        _mutations_answer_cleanly(client, gm_headers, cid, bundle, filename="wiki.lk")

    def test_legendkeeper_pages(self, client, gm_headers):
        cid = _campaign(client, gm_headers)
        pages = _lk_pages()
        _mutations_answer_cleanly(client, gm_headers, cid, pages)
        _mutations_answer_cleanly(client, gm_headers, cid, pages[0])

    def test_legendkeeper_pages_in_a_zip(self, client, gm_headers):
        cid = _campaign(client, gm_headers)
        _mutations_answer_cleanly(
            client, gm_headers, cid, _lk_pages(), filename="wiki.zip", pack=_zip_of_pages
        )


class TestTheAnswer:
    def test_names_the_field_at_fault(self, client, gm_headers):
        cid = _campaign(client, gm_headers)
        bundle = {"grimoire_wiki_version": 1, "pages": [{"title": "A"}, {"title": 5}]}
        resp = _post(client, gm_headers, cid, "wiki.json", json.dumps(bundle).encode(),
                     "application/json")
        assert resp.status_code == 400
        assert "pages.1.title" in resp.json()["detail"]

    def test_pages_must_be_a_list_of_pages(self, client, gm_headers):
        cid = _campaign(client, gm_headers)
        for pages in (5, [None], "x"):
            bundle = {"grimoire_wiki_version": 1, "pages": pages}
            resp = _post(client, gm_headers, cid, "wiki.json", json.dumps(bundle).encode(),
                         "application/json")
            assert resp.status_code == 400, (pages, resp.text)

    def test_a_malformed_body_tree_is_read_as_far_as_it_goes(self, client, gm_headers):
        cid = _campaign(client, gm_headers)
        bundle = _lk_bundle()
        heading = bundle["resources"][0]["documents"][0]["content"]["content"][0]
        heading["attrs"]["level"] = "big"
        resp = _post(client, gm_headers, cid, "wiki.lk", json.dumps(bundle).encode(),
                     "application/json")
        assert resp.status_code == 201, resp.text
        page = next(p for p in resp.json()["pages"] if p["title"] == "Magic Items")
        body = client.get(f"/api/campaigns/{cid}/wiki/{page['id']}", headers=gm_headers).json()
        assert body["body"].startswith("# Attunement")

    def test_a_non_text_icon_is_dropped(self, client, gm_headers):
        cid = _campaign(client, gm_headers)
        bundle = {"grimoire_wiki_version": 1, "pages": [{"title": "Odd", "icon": 5}]}
        resp = _post(client, gm_headers, cid, "wiki.json", json.dumps(bundle).encode(),
                     "application/json")
        assert resp.status_code == 201, resp.text
        assert resp.json()["pages"][0]["icon"] is None
