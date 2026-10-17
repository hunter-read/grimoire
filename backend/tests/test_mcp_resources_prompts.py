"""MCP resources (grimoire:// URIs), prompts, and prompt-argument completion."""
import uuid

import pytest

from backend.config import SessionLocal
from backend.mcp_server import errors, prompts
from backend.models import CampaignMember
from backend.tests._mcp import error_of, make_key, mcp_test_client, result_of
from backend.tests.conftest import make_book, make_campaign, make_game_system


@pytest.fixture(scope="module")
def mcp_client():
    with mcp_test_client() as c:
        yield c


@pytest.fixture(scope="module")
def full_key(client, admin_headers):
    return make_key(client, admin_headers, {"*": "read"})


@pytest.fixture(scope="module")
def search_key(client, admin_headers):
    return make_key(client, admin_headers, {"search": "read"})


@pytest.fixture(scope="module")
def world(client, admin_id, admin_headers, player_id):
    tag = uuid.uuid4().hex[:4]
    campaign = make_campaign(admin_id, name=f"Ember{tag} Coast", description="Pirates.")
    page = client.post(
        f"/api/campaigns/{campaign.id}/wiki",
        json={"title": "Captain Rook", "body": "A pirate."},
        headers=admin_headers,
    ).json()
    # The admin is only invited here, so it is listed but can't be opened.
    invited = make_campaign(player_id, name=f"Invite Only {tag}", is_gm_campaign=True)
    db = SessionLocal()
    db.add(CampaignMember(campaign_id=invited.id, user_id=admin_id, status="invited"))
    db.commit()
    db.close()
    system = make_game_system(name=f"Resource System {tag}")
    book = make_book(system_id=system.id, title="Pirate Rules", mime_type="text/plain")
    return {"campaign": campaign, "page": page, "invited": invited, "book": book, "tag": tag}


# ---------------------------------------------------------------------------
# Resources
# ---------------------------------------------------------------------------


class TestResourceLists:
    def test_campaigns_are_listed(self, mcp_client, full_key, world):
        listed = result_of(mcp_client, full_key, "resources/list")["resources"]
        mine = next(r for r in listed if r["uri"] == f"grimoire://campaigns/{world['campaign'].id}")
        assert mine["name"] == world["campaign"].name
        assert mine["mimeType"] == "text/markdown"

    def test_templates_cover_books_campaigns_and_wiki(self, mcp_client, full_key):
        templates = result_of(mcp_client, full_key, "resources/templates/list")
        assert {t["uriTemplate"] for t in templates["resourceTemplates"]} == {
            "grimoire://campaigns/{campaign_id}",
            "grimoire://campaigns/{campaign_id}/wiki/{page_id}",
            "grimoire://books/{book_id}",
        }

    def test_a_key_without_those_permissions_sees_none(self, mcp_client, search_key):
        assert result_of(mcp_client, search_key, "resources/list") == {"resources": []}
        assert result_of(mcp_client, search_key, "resources/templates/list") == {
            "resourceTemplates": []
        }


class TestReadResource:
    def _read(self, mcp_client, key, uri):
        return result_of(mcp_client, key, "resources/read", {"uri": uri})["contents"][0]

    def test_campaign(self, mcp_client, full_key, world):
        uri = f"grimoire://campaigns/{world['campaign'].id}"
        content = self._read(mcp_client, full_key, uri)
        assert content["uri"] == uri and content["mimeType"] == "text/markdown"
        assert content["text"].startswith(f"# {world['campaign'].name}")
        assert "Captain Rook" in content["text"]

    def test_wiki_page(self, mcp_client, full_key, world):
        uri = f"grimoire://campaigns/{world['campaign'].id}/wiki/{world['page']['id']}"
        assert "A pirate." in self._read(mcp_client, full_key, uri)["text"]

    def test_book(self, mcp_client, full_key, world):
        uri = f"grimoire://books/{world['book'].id}"
        assert self._read(mcp_client, full_key, uri)["text"].startswith("# Pirate Rules")

    @pytest.mark.parametrize(
        "uri", ["grimoire://books/nope", "grimoire://maps/1", "https://example.com"]
    )
    def test_unknown_uris(self, mcp_client, full_key, uri):
        error = error_of(mcp_client, full_key, "resources/read", {"uri": uri})
        assert error["code"] == errors.RESOURCE_NOT_FOUND

    def test_a_campaign_it_cannot_open_reads_as_missing(self, mcp_client, full_key, world):
        uri = f"grimoire://campaigns/{world['invited'].id}"
        error = error_of(mcp_client, full_key, "resources/read", {"uri": uri})
        assert error["code"] == errors.RESOURCE_NOT_FOUND

    def test_permission_is_checked(self, mcp_client, search_key, world):
        error = error_of(
            mcp_client, search_key, "resources/read", {"uri": f"grimoire://books/{world['book'].id}"}
        )
        assert error["code"] == errors.INVALID_PARAMS
        assert "'books'" in error["message"]

    def test_uri_is_required(self, mcp_client, full_key):
        assert error_of(mcp_client, full_key, "resources/read", {})["code"] == (
            errors.INVALID_PARAMS
        )


# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------


class TestPromptList:
    def test_lists_prompts_with_arguments(self, mcp_client, full_key):
        listed = {p["name"]: p for p in result_of(mcp_client, full_key, "prompts/list")["prompts"]}
        assert set(listed) == {"prep_session", "answer_from_my_books"}
        assert listed["prep_session"]["arguments"] == [
            {
                "name": "campaign",
                "description": "A word from the campaign's name; leave out to be asked.",
                "required": False,
            }
        ]
        assert listed["answer_from_my_books"]["arguments"] == []

    def test_hides_prompts_the_key_cannot_use(self, mcp_client, search_key):
        names = [p["name"] for p in result_of(mcp_client, search_key, "prompts/list")["prompts"]]
        assert names == ["answer_from_my_books"]


def _prep(mcp_client, key, arguments=None):
    params = {"name": "prep_session"}
    if arguments is not None:
        params["arguments"] = arguments
    return result_of(mcp_client, key, "prompts/get", params)


class TestPrepSession:
    def test_finds_the_campaign_by_name_and_embeds_its_overview(
        self, mcp_client, full_key, world
    ):
        name = world["campaign"].name
        got = _prep(mcp_client, full_key, {"campaign": name.upper()})
        ask, attached = got["messages"]
        assert ask["role"] == "user"
        assert f"my campaign {name}. Its overview is attached." in ask["content"]["text"]
        resource = attached["content"]["resource"]
        assert attached["content"]["type"] == "resource"
        assert resource["uri"] == f"grimoire://campaigns/{world['campaign'].id}"
        assert "Pirates." in resource["text"]

    def test_one_distinctive_word_is_enough(self, mcp_client, full_key, world):
        # Claude Code passes one word per argument, so a name is usually partial.
        got = _prep(mcp_client, full_key, {"campaign": f"ember{world['tag']}"})
        assert world["campaign"].name in got["messages"][0]["content"]["text"]

    @pytest.mark.parametrize(
        "arguments, said",
        [(None, ""), ({"campaign": ""}, ""), ({"campaign": "zzz-no-such"}, ' (I said "zzz-no-such")')],
    )
    def test_otherwise_the_model_is_told_to_ask(self, mcp_client, full_key, arguments, said):
        got = _prep(mcp_client, full_key, arguments)
        (ask,) = got["messages"]
        text = ask["content"]["text"]
        assert text.startswith(f"Help me prepare the next session of one of my campaigns{said}.")
        assert "list_campaigns" in text and "ask me" in text

    def test_a_campaign_it_cannot_open(self, mcp_client, full_key, world):
        error = error_of(
            mcp_client,
            full_key,
            "prompts/get",
            {"name": "prep_session", "arguments": {"campaign": world["invited"].id}},
        )
        assert error == {"code": errors.INVALID_PARAMS, "message": "Not a member of this campaign"}


class TestAnswerFromMyBooks:
    def test_sets_the_ground_rules_and_asks_for_the_question(self, mcp_client, search_key):
        got = result_of(mcp_client, search_key, "prompts/get", {"name": "answer_from_my_books"})
        text = got["messages"][0]["content"]["text"]
        assert "not from memory" in text and "search_library" in text
        assert text.endswith("Ask me what my first question is.")


class TestPromptErrors:
    def test_unknown_prompt(self, mcp_client, full_key):
        error = error_of(mcp_client, full_key, "prompts/get", {"name": "nope"})
        assert error["code"] == errors.INVALID_PARAMS
        assert error["message"] == "Unknown prompt: nope"

    def test_arguments_must_be_an_object(self, mcp_client, full_key):
        params = {"name": "prep_session", "arguments": ["x"]}
        error = error_of(mcp_client, full_key, "prompts/get", params)
        assert error["code"] == errors.INVALID_PARAMS

    def test_required_arguments_are_enforced(self, mcp_client, full_key, monkeypatch):
        strict = prompts.Prompt(
            name="strict",
            title="Strict",
            description="Needs one.",
            arguments=(prompts.Argument("thing", "A thing."),),
            permission="search",
            build=lambda args, ctx: [],
        )
        monkeypatch.setitem(prompts.PROMPTS, "strict", strict)
        for arguments in ({}, {"thing": ""}):
            error = error_of(
                mcp_client, full_key, "prompts/get", {"name": "strict", "arguments": arguments}
            )
            assert error["message"] == "Missing argument(s): thing"

    def test_a_prompt_the_key_cannot_use_is_unknown(self, mcp_client, search_key):
        error = error_of(
            mcp_client,
            search_key,
            "prompts/get",
            {"name": "prep_session", "arguments": {"campaign": "x"}},
        )
        assert error["message"] == "Unknown prompt: prep_session"


# ---------------------------------------------------------------------------
# Completion
# ---------------------------------------------------------------------------


def _complete(mcp_client, key, name="prep_session", argument="campaign", value=""):
    return result_of(
        mcp_client,
        key,
        "completion/complete",
        {
            "ref": {"type": "ref/prompt", "name": name},
            "argument": {"name": argument, "value": value},
        },
    )["completion"]


class TestCompletion:
    def test_suggests_campaign_names(self, mcp_client, full_key, world):
        got = _complete(mcp_client, full_key, value=f"ember{world['tag']}")
        assert got == {"values": [world["campaign"].name], "total": 1, "hasMore": False}

    @pytest.mark.parametrize(
        "name, argument", [("answer_from_my_books", "x"), ("prep_session", "other")]
    )
    def test_nothing_to_suggest_elsewhere(self, mcp_client, full_key, name, argument):
        assert _complete(mcp_client, full_key, name, argument)["values"] == []

    def test_nothing_without_campaign_access(self, mcp_client, search_key):
        assert _complete(mcp_client, search_key)["values"] == []
