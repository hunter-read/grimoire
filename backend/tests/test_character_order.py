"""`<g-order>`: blocks of a sheet the player drags into their own order."""
import pytest

from backend.services.characters import schema as svc
from backend.services.characters.layout_html import parse_layout_html


def _document(html: str, *, mobile: bool = False, **fields) -> dict:
    return {
        "id": "order-demo",
        "name": "Order Demo",
        "fields": {
            "attack_order": {"type": "textarea"},
            "short_order": {"type": "text"},
            "level": {"type": "number"},
            "attacks": {"type": "list", "columns": [{"key": "name"}, {"key": "bonus"}]},
            **fields,
        },
        ("mobile_layout_html" if mobile else "layout_html"): html,
    }


GOOD = (
    '<g-order field="attack_order">'
    '<g-repeat over="attacks"><div><g-field name="name" /></div></g-repeat>'
    '<g-order-item key="unarmed"><p>Unarmed strike</p></g-order-item>'
    '<g-if test="level > 4"><g-order-item key="spell"><p>Spell</p></g-order-item></g-if>'
    "</g-order>"
)


def test_an_order_parses_with_its_blocks():
    ast = parse_layout_html(GOOD)
    assert ast[0]["tag"] == "g-order"
    assert ast[0]["attrs"] == {"field": "attack_order"}
    assert [child["tag"] for child in ast[0]["children"]] == ["g-repeat", "g-order-item", "g-if"]


@pytest.mark.parametrize("field", ["attack_order", "short_order"])
def test_it_keeps_its_order_in_a_text_field(field):
    document = svc.validate_schema(_document(GOOD.replace("attack_order", field)))
    assert document["layout_ast"][0]["attrs"]["field"] == field


def test_a_phone_layout_is_checked_too():
    with pytest.raises(svc.SchemaError, match="mobile_layout_html: <g-order> keeps its order"):
        svc.validate_schema(_document('<g-order field="nope"></g-order>', mobile=True))


@pytest.mark.parametrize("field", ["nope", "level", "attacks", ""])
def test_it_needs_a_text_field_to_keep_its_order_in(field):
    with pytest.raises(svc.SchemaError, match="must be a text or textarea field"):
        svc.validate_schema(_document(GOOD.replace('"attack_order"', f'"{field}"')))


def test_an_order_with_no_field_is_refused():
    with pytest.raises(svc.SchemaError, match="keeps its order in None"):
        svc.validate_schema(_document("<g-order><g-order-item key='a'>A</g-order-item></g-order>"))


@pytest.mark.parametrize(
    "inner, what",
    [
        ("<div>loose</div>", "<div>"),
        ("plain words", "text"),
        ('<g-field name="level" />', "<g-field>"),
        ('<g-if test="level"><p>loose</p></g-if>', "<p>"),
    ],
)
def test_it_holds_only_blocks(inner, what):
    with pytest.raises(svc.SchemaError, match=f"<g-order> holds {what}"):
        svc.validate_schema(_document(f'<g-order field="attack_order">{inner}</g-order>'))


def test_orders_do_not_nest():
    html = (
        '<g-order field="attack_order"><g-order-item key="a">'
        '<g-order field="short_order"><g-order-item key="b">B</g-order-item></g-order>'
        "</g-order-item></g-order>"
    )
    with pytest.raises(svc.SchemaError, match="cannot sit inside another"):
        svc.validate_schema(_document(html))


@pytest.mark.parametrize("key", ['key=""', 'key="  "', ""])
def test_a_fixed_block_needs_a_key(key):
    html = f'<g-order field="attack_order"><g-order-item {key}>A</g-order-item></g-order>'
    with pytest.raises(svc.SchemaError, match="<g-order-item> needs a 'key'"):
        svc.validate_schema(_document(html))


def test_a_fixed_block_outside_an_order_is_just_its_contents():
    assert svc.validate_schema(_document('<g-order-item key="a"><p>A</p></g-order-item>'))


def test_an_order_takes_no_handlers():
    from backend.services.characters.layout_html import LayoutHtmlError

    with pytest.raises(LayoutHtmlError):
        parse_layout_html('<g-order field="attack_order" onpointerdown="x()"></g-order>')
