"""Reading a few top-level values out of a JSON column, on SQLite and PostgreSQL.

A list that sorts and filters on two or three values of a JSON document should
not have to fetch and decode every whole document to do it. This selects just
those values, each decoded exactly as ``json.loads`` of the whole document
would have given it - ``true`` stays ``True``, a list stays a list, a missing
key is ``None`` - so code reading ``data.get(key)`` sees no difference.

Each document is parsed once, however many keys are read, and the values come
back as one small JSON value per row:

* SQLite: ``JSON_EXTRACT`` given two or more paths returns them as a JSON
  array, which keeps every type. SQLAlchemy's portable ``column[key]`` cannot
  be used, as it renders a single-path ``JSON_EXTRACT``, which turns a JSON
  ``true`` into the integer 1.
* PostgreSQL: the columns are ``json`` (text), so each ``->`` would parse the
  whole document again. ``json_each`` parses it once and ``json_object_agg``
  keeps just the keys asked for.
"""
import json
import re
from typing import Any, Callable, Sequence

from sqlalchemy import JSON, case, func, select
from sqlalchemy.sql.elements import ColumnElement

from ..models.dialect import is_postgres

#: Keys this can select. A path is built from the key, so anything that could
#: need quoting inside a JSON path is refused rather than escaped.
_KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

Decoder = Callable[[Sequence[Any]], dict[str, Any]]


def can_select(key: Any) -> bool:
    """Whether ``key`` is a name :func:`select_keys` can read."""
    return isinstance(key, str) and bool(_KEY.match(key))


def select_keys(
    bind: Any, column: Any, keys: Sequence[str]
) -> tuple[list[ColumnElement[Any]], Decoder]:
    """Expressions selecting ``keys`` from ``column``, and how to read them back.

    Add the expressions to a query's columns; pass that row's values for them,
    in order, to the decoder to get ``{key: value}``. Every key must pass
    :func:`can_select`. A document that is not an object reads as all ``None``.
    """
    names = list(keys)
    bad = [key for key in names if not can_select(key)]
    if bad:
        raise ValueError(f"Not a selectable JSON key: {bad[0]!r}")
    if not names:
        return [], lambda _values: {}
    if is_postgres(bind):
        return [_postgres_object(column, names)], _object_decoder(names)
    return [_sqlite_array(column, names)], _array_decoder(names)


def _sqlite_array(column: Any, names: list[str]) -> ColumnElement[Any]:
    paths = [f'$."{key}"' for key in names]
    # One path would return the bare SQL value (and lose ``true``); repeating it
    # keeps the array form.
    if len(paths) == 1:
        paths.append(paths[0])
    return func.json_extract(column, *paths)


def _postgres_object(column: Any, names: list[str]) -> ColumnElement[Any]:
    each = func.json_each(column).table_valued("key", "value").alias("json_field")
    picked = (
        select(func.json_object_agg(each.c.key, each.c.value, type_=JSON))
        .where(each.c.key.in_(names))
        .scalar_subquery()
    )
    # json_each refuses an array or a scalar; such a document has no keys.
    return case((func.json_typeof(column) == "object", picked), else_=None)


def _loaded(raw: Any) -> Any:
    return json.loads(raw) if isinstance(raw, (str, bytes)) else raw


def _array_decoder(names: list[str]) -> Decoder:
    def decode(values: Sequence[Any]) -> dict[str, Any]:
        found = _loaded(values[0]) if values else None
        if not isinstance(found, list):
            return dict.fromkeys(names)
        return dict(zip(names, found))

    return decode


def _object_decoder(names: list[str]) -> Decoder:
    def decode(values: Sequence[Any]) -> dict[str, Any]:
        found = _loaded(values[0]) if values else None
        if not isinstance(found, dict):
            return dict.fromkeys(names)
        return {key: found.get(key) for key in names}

    return decode
