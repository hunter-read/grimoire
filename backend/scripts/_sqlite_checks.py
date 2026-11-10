"""What the SQLite → PostgreSQL copy checks before it writes anything.

SQLite stores data PostgreSQL refuses: a row pointing at one that was deleted
(SQLite only checks foreign keys when asked to), text or fractions in a
whole-number column, a number too big for a 32-bit column, an empty value in a
column the models require, and usernames that only PostgreSQL's ``lower()``
treats as one name. Any of them would stop the copy part-way with a raw database
error. :func:`find_problems` finds them all up front, each naming the table, the
column, the rows and what to do, so they can be fixed in one pass.
"""
from typing import Any, Optional, Sequence

from sqlalchemy import Column, Table, inspect, text, types
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine import Connection

# Row ids named per problem; the rest are counted.
SHOWN = 10

# PostgreSQL's range for a SMALLINT and an INTEGER. A BIGINT holds any SQLite integer.
_SMALLINT = (-(2**15), 2**15 - 1)
_INTEGER = (-(2**31), 2**31 - 1)

# Columns of the tables outside the models (models.postgres) that are numbers there.
_RAW_INTEGERS = (("book_pages", "page_number", ("id",)),)

_PG = postgresql.dialect()


def _q(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _describe(src: Connection, table: str, keys: Sequence[str], where: str) -> Optional[str]:
    """How many rows of ``table`` match ``where``, and the first few ids; None for none."""
    count = src.execute(text(f"SELECT COUNT(*) FROM {_q(table)} WHERE {where}")).scalar() or 0
    if not count:
        return None
    key_sql = ", ".join(_q(k) for k in keys) if keys else "rowid"
    rows = src.execute(
        text(f"SELECT {key_sql} FROM {_q(table)} WHERE {where} ORDER BY {key_sql} LIMIT {SHOWN}")
    ).fetchall()
    label = "/".join(keys) if keys else "rowid"
    ids = ", ".join(repr(r[0]) if len(r) == 1 else repr(tuple(r)) for r in rows)
    more = f" and {count - SHOWN} more" if count > SHOWN else ""
    return f"{count} row(s) ({label} {ids}{more})"


def _bounds(kind: Any) -> Optional[tuple[int, int]]:
    """The range PostgreSQL holds in a column of type ``kind``; None if unbounded."""
    if isinstance(kind, types.BigInteger) or not isinstance(kind, types.Integer):
        return None
    return _SMALLINT if isinstance(kind, types.SmallInteger) else _INTEGER


def _value_problems(src: Connection, table: Table, columns: Sequence[Column]) -> list[str]:
    problems = []
    keys = [c.name for c in table.primary_key.columns]
    for column in columns:
        name, col = table.name, _q(column.name)
        where = f"{name}.{column.name}"
        if not column.nullable:
            found = _describe(src, name, keys, f"{col} IS NULL")
            if found:
                problems.append(
                    f"{where}: {found} have no value, which PostgreSQL requires there. "
                    "Fill it in or delete those rows."
                )
        kind = column.type.dialect_impl(_PG)
        if isinstance(kind, types.Integer):
            allowed, what = "'integer', 'null'", "something other than a whole number"
        elif isinstance(kind, (types.Float, types.Numeric)):
            allowed, what = "'integer', 'real', 'null'", "something other than a number"
        else:
            continue
        bad = f"typeof({col}) NOT IN ({allowed})"
        found = _describe(src, name, keys, bad)
        if found:
            fix = (
                f"Clear or correct them: UPDATE {name} SET {column.name} = NULL WHERE {bad};"
                if column.nullable
                else "Correct them."
            )
            problems.append(f"{where}: {found} hold {what}. {fix}")
        bounds = _bounds(kind)
        if bounds:
            low, high = bounds
            found = _describe(
                src, name, keys,
                f"typeof({col}) = 'integer' AND ({col} < {low} OR {col} > {high})",
            )
            if found:
                problems.append(
                    f"{where}: {found} hold a number outside {low} to {high}, the most "
                    "this column holds on PostgreSQL. Correct them, and please report "
                    "this so the column can be widened."
                )
    return problems


def _orphan_problems(src: Connection, table: Table, present: set[str]) -> list[str]:
    problems = []
    keys = [c.name for c in table.primary_key.columns]
    insp = inspect(src)
    for fk in table.foreign_key_constraints:
        parent = fk.referred_table.name
        children = [c.name for c in fk.columns]
        parents = [e.column.name for e in fk.elements]
        if not set(children) <= present or not insp.has_table(parent):
            continue
        if not set(parents) <= {c["name"] for c in insp.get_columns(parent)}:
            continue
        alias = "parent_row"
        match = " AND ".join(
            f"{alias}.{_q(p)} = {_q(table.name)}.{_q(c)}" for c, p in zip(children, parents)
        )
        where = (
            " AND ".join(f"{_q(table.name)}.{_q(c)} IS NOT NULL" for c in children)
            + f" AND NOT EXISTS (SELECT 1 FROM {_q(parent)} {alias} WHERE {match})"
        )
        found = _describe(src, table.name, keys, where)
        if not found:
            continue
        nullable = all(table.c[c].nullable for c in children)
        fix = (
            f"UPDATE {table.name} SET " + ", ".join(f"{c} = NULL" for c in children)
            if nullable
            else f"DELETE FROM {table.name}"
        ) + f" WHERE {where};"
        problems.append(
            f"{table.name}.{', '.join(children)}: {found} point at a {parent} row that no "
            f"longer exists. {'Clear the link' if nullable else 'Delete those rows'}: {fix}"
        )
    return problems


def _raw_problems(src: Connection) -> list[str]:
    problems = []
    low, high = _INTEGER
    for table, column, keys in _RAW_INTEGERS:
        if not inspect(src).has_table(table):
            continue
        col = _q(column)
        bad = f"typeof({col}) != 'integer' OR {col} < {low} OR {col} > {high}"
        found = _describe(src, table, keys, bad)
        if found:
            problems.append(
                f"{table}.{column}: {found} hold something other than a whole number "
                f"from {low} to {high}. Delete those rows: DELETE FROM {table} WHERE {bad};"
            )
    return problems


def _username_problems(src: Connection, dst: Connection) -> list[str]:
    """Accounts the unique index on ``lower(username)`` would refuse on PostgreSQL.

    SQLite's ``lower()`` folds only A-Z, PostgreSQL's every letter, so names
    that differ only in the case of an accented letter are one name there. The
    target database lowers the names itself (a read: nothing is written), so the
    check folds exactly as the index will.
    """
    users = src.execute(text("SELECT id, username FROM users ORDER BY id")).fetchall()
    if not users:
        return []
    lowered = dst.execute(
        text("SELECT lower(u) FROM unnest(CAST(:names AS text[])) WITH ORDINALITY AS t(u, n) "
             "ORDER BY n"),
        {"names": [u.username or "" for u in users]},
    ).scalars().all()
    groups: dict[str, list[Any]] = {}
    for user, low in zip(users, lowered):
        groups.setdefault(low, []).append(user)
    problems = []
    for clash in groups.values():
        if len(clash) > 1:
            names = ", ".join(f"{u.username!r} (id {u.id!r})" for u in clash)
            problems.append(
                f"users.username: {names} are one name on PostgreSQL, which ignores case "
                "in letters beyond A-Z too. Rename all but one in Settings > Users."
            )
    return problems


def find_problems(src: Connection, dst: Connection, tables: Sequence[Table]) -> list[str]:
    """Everything in ``src`` that PostgreSQL would refuse, one readable line each."""
    problems: list[str] = []
    insp = inspect(src)
    for table in tables:
        if not insp.has_table(table.name):
            continue
        present = {c["name"] for c in insp.get_columns(table.name)}
        columns = [c for c in table.columns if c.name in present]
        problems += _value_problems(src, table, columns)
        problems += _orphan_problems(src, table, present)
    problems += _raw_problems(src)
    problems += _username_problems(src, dst)
    return problems
