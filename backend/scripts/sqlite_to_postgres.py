"""Copy a Grimoire SQLite database into an empty PostgreSQL database.

    python -m backend.scripts.sqlite_to_postgres --postgres postgresql://user:pw@host/grimoire

Stop Grimoire first: writes made while the copy runs would not be carried over.
Run it with the install's own DATA_PATH (and SECRET_KEY, if it sets one), the
same environment the server uses, because an older database is brought up to
date before it is copied and some of those steps use the instance's key.

What it does:

1. Snapshots the SQLite file (``--sqlite``, default ``DATA_PATH/grimoire.db``)
   to a temporary copy and upgrades the copy to the current schema. The
   original file is only read, never changed, so it stays a complete fallback.
2. Checks the snapshot for data PostgreSQL would refuse - a row pointing at one
   that no longer exists, text in a number column, a number too big for its
   column, a missing required value, usernames PostgreSQL counts as one - and
   stops, listing every one, before anything is written.
3. Creates the schema in the PostgreSQL database (``--postgres``, default
   ``DATABASE_URL``), which must be empty.
4. Copies every table, the indexed page text and the character-catalogue index,
   in batches, then stamps the database at the current migration.
5. Reads both databases back and compares every row of every table. Any
   difference fails the command. NUL characters, which PostgreSQL text cannot
   hold, are dropped from the copy and left out of the comparison.

On success, set DATABASE_URL to the same URL and start Grimoire. Nothing in the
data folder moves: covers, thumbnails, uploads and the secret key stay where
they are.
"""
import argparse
import logging
import os
import sqlite3
import sys
import tempfile
import time
from typing import Any, Iterable, Iterator, Optional, Sequence

from sqlalchemy import Table, inspect, select, text
from sqlalchemy.engine import Connection, Engine

logger = logging.getLogger("grimoire.db")

BATCH = 2000

# App settings that describe the SQLite file itself and mean nothing on PostgreSQL.
_SQLITE_ONLY_SETTINGS = ("db_compact_pending",)

# Tables outside the models, created by models.postgres: (name, columns copied).
_RAW_TABLES = (
    ("book_pages", ("id", "book_id", "page_number", "content")),
    ("content_search", ("entry_row", "pack_row", "schema_id", "content_type", "name", "body")),
)


class MigrationError(RuntimeError):
    """The copy cannot go ahead, or did not come out identical."""


def _batches(rows: Iterable[Any], size: int = BATCH) -> Iterator[list]:
    batch: list = []
    for row in rows:
        batch.append(row)
        if len(batch) >= size:
            yield batch
            batch = []
    if batch:
        yield batch


def snapshot_sqlite(source: str, destination: str) -> None:
    """A consistent copy of ``source`` through SQLite's backup API, read-only on the source."""
    if not os.path.isfile(source):
        raise MigrationError(f"No SQLite database at {source}.")
    src = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
    try:
        dst = sqlite3.connect(destination)
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()


def _check_empty(conn: Connection) -> None:
    tables = set(inspect(conn).get_table_names())
    if tables:
        shown = ", ".join(sorted(tables)[:5])
        raise MigrationError(
            "The PostgreSQL database is not empty "
            f"({len(tables)} table(s), e.g. {shown}). Point --postgres at a new, empty "
            "database; nothing was changed."
        )


def _model_tables() -> Sequence[Table]:
    from ..models import Base

    return Base.metadata.sorted_tables


def deferred_links(tables: Sequence[Table]) -> dict[str, list[str]]:
    """Foreign-key columns that cannot be filled in as their row is inserted.

    PostgreSQL checks a foreign key as each row goes in. Tables are copied
    parents first, but a table that points at itself (a wiki page's parent
    page, a sub-genre's genre) can hold a row before the row it points at,
    and a cycle between tables has no order at all. Those columns go in empty
    and are filled in once every row exists. All of them are nullable.
    """
    order = {t.name: i for i, t in enumerate(tables)}
    links: dict[str, list[str]] = {}
    for table in tables:
        for fk in table.foreign_keys:
            target = fk.column.table.name
            if target == table.name or order.get(target, -1) > order[table.name]:
                links.setdefault(table.name, []).append(fk.parent.name)
    return links


def _copy_model_table(
    src: Connection, dst: Connection, table: Table, later: Sequence[str] = ()
) -> tuple[int, list[dict]]:
    """Copy ``table``; returns the row count and the ``later`` links to fill in after."""
    src_columns = {c["name"] for c in inspect(src).get_columns(table.name)}
    columns = [c for c in table.columns if c.name in src_columns]
    skipped = src_columns - {c.name for c in table.columns}
    if skipped:
        logger.info("  %s: leaving out column(s) the app no longer uses: %s",
                    table.name, ", ".join(sorted(skipped)))
    query = select(*columns)
    if table.name == "app_settings":
        query = query.where(table.c.key.not_in(_SQLITE_ONLY_SETTINGS))
    keys = [c.name for c in table.primary_key.columns]
    copied = 0
    pending: list[dict] = []
    result = src.execution_options(stream_results=True).execute(query)
    for batch in _batches(result):
        rows = [dict(row._mapping) for row in batch]
        for row in rows:
            link = {name: row[name] for name in later if row.get(name) is not None}
            if link:
                pending.append({**{f"pk_{k}": row[k] for k in keys}, **link})
                for name in link:
                    row[name] = None
        dst.execute(table.insert(), rows)
        copied += len(rows)
    return copied, pending


def _fill_links(dst: Connection, table: Table, later: Sequence[str], pending: list[dict]) -> None:
    keys = [c.name for c in table.primary_key.columns]
    where = " AND ".join(f'"{k}" = :pk_{k}' for k in keys)
    for name in later:
        rows = [
            {**{f"pk_{k}": p[f"pk_{k}"] for k in keys}, "v": p[name]}
            for p in pending
            if name in p
        ]
        for batch in _batches(rows):
            dst.execute(text(f'UPDATE {table.name} SET "{name}" = :v WHERE {where}'), batch)


def _copy_raw_table(src: Connection, dst: Connection, name: str, columns: Sequence[str]) -> int:
    if not inspect(src).has_table(name):
        return 0
    cols = ", ".join(columns)
    marks = ", ".join(f":{c}" for c in columns)
    copied = 0
    result = src.execution_options(stream_results=True).execute(
        text(f"SELECT {cols} FROM {name}")
    )
    for batch in _batches(result):
        dst.execute(
            text(f"INSERT INTO {name} ({cols}) VALUES ({marks})"),
            [dict(zip(columns, row)) for row in batch],
        )
        copied += len(batch)
    if "id" in columns:
        # Ids were copied explicitly; move the identity past them.
        dst.execute(
            text(
                f"SELECT setval(pg_get_serial_sequence('{name}', 'id'), "
                f"COALESCE((SELECT MAX(id) FROM {name}), 0) + 1, false)"
            )
        )
    return copied


def _rows(conn: Connection, query: Any) -> Iterator[tuple]:
    for row in conn.execution_options(stream_results=True).execute(query):
        yield tuple(row)


def _without_nul(rows: Iterator[tuple]) -> Iterator[tuple]:
    """``rows`` as PostgreSQL holds them: NUL characters dropped from every string.

    The target engine drops them on the way in (``postgres_engine``), since
    PostgreSQL text cannot hold one, so the SQLite side is compared without them.
    A JSON value keeps its ``\\u0000`` escape on both sides and needs nothing.
    """
    for row in rows:
        yield tuple(v.replace("\x00", "") if isinstance(v, str) else v for v in row)


def verify(src: Connection, dst: Connection) -> dict[str, int]:
    """Compare every row of every copied table; raise MigrationError on any difference."""
    counts: dict[str, int] = {}
    for table in _model_tables():
        src_columns = {c["name"] for c in inspect(src).get_columns(table.name)}
        columns = [c for c in table.columns if c.name in src_columns]
        keys = list(table.primary_key.columns) or columns
        query = select(*columns).order_by(*keys)
        if table.name == "app_settings":
            query = query.where(table.c.key.not_in(_SQLITE_ONLY_SETTINGS))
        counts[table.name] = _compare(
            table.name, _without_nul(_rows(src, query)), _rows(dst, query)
        )
    for name, raw_columns in _RAW_TABLES:
        if not inspect(src).has_table(name):
            continue
        order = "id" if "id" in raw_columns else ", ".join(raw_columns)
        raw_query = text(f"SELECT {', '.join(raw_columns)} FROM {name} ORDER BY {order}")
        if name == "content_search":
            # No key of its own on SQLite; compare as sorted multisets.
            counts[name] = _compare(
                name, iter(sorted(_without_nul(_rows(src, raw_query)), key=repr)),
                iter(sorted(_rows(dst, raw_query), key=repr)),
            )
        else:
            counts[name] = _compare(
                name, _without_nul(_rows(src, raw_query)), _rows(dst, raw_query)
            )
    return counts


def _compare(name: str, left: Iterator[tuple], right: Iterator[tuple]) -> int:
    count = 0
    sentinel = object()
    while True:
        a = next(left, sentinel)
        b = next(right, sentinel)
        if a is sentinel and b is sentinel:
            return count
        if a is sentinel or b is sentinel:
            raise MigrationError(f"{name}: row counts differ after the copy (at row {count + 1}).")
        if a != b:
            raise MigrationError(f"{name}: row {count + 1} differs after the copy: {a!r} != {b!r}")
        count += 1


def _preflight(src: Connection, dst: Connection, tables: Sequence[Table]) -> None:
    """Stop, before anything is written, on data PostgreSQL would refuse."""
    from ._sqlite_checks import find_problems

    problems = find_problems(src, dst, tables)
    if problems:
        listed = "\n".join(f"  - {p}" for p in problems)
        raise MigrationError(
            f"The SQLite database holds {len(problems)} thing(s) PostgreSQL would refuse, "
            "so nothing was copied:\n"
            f"{listed}\n"
            "Fix them in the SQLite database - with Grimoire stopped, and after backing the "
            "file up - then run this command again. The statements shown run as they are "
            "in the sqlite3 shell. The PostgreSQL database is still empty."
        )


def migrate(sqlite_path: str, postgres_url: str) -> dict[str, int]:
    """Copy ``sqlite_path`` into the empty database at ``postgres_url``; return row counts."""
    from alembic import command

    from ..models.db import (
        _alembic_config,
        _postgres_migration_lock,
        init_db,
        postgres_engine,
    )
    from ..models.postgres import create_schema

    target: Engine = postgres_engine(postgres_url)
    with target.connect() as conn:
        _check_empty(conn)

    with tempfile.TemporaryDirectory(prefix="grimoire-migrate-") as tmp:
        copy_path = os.path.join(tmp, "grimoire.db")
        logger.info("Taking a snapshot of %s ...", sqlite_path)
        snapshot_sqlite(sqlite_path, copy_path)
        logger.info("Bringing the snapshot up to the current schema ...")
        source, _ = init_db(copy_path)
        try:
            with _postgres_migration_lock(target), source.connect() as src, target.connect() as dst:
                _check_empty(dst)
                tables = _model_tables()
                logger.info("Checking the SQLite data for anything PostgreSQL would refuse ...")
                _preflight(src, dst, tables)
                logger.info("Creating the schema in PostgreSQL ...")
                create_schema(dst, seed=False)
                links = deferred_links(tables)
                pending: dict[str, list[dict]] = {}
                for table in tables:
                    started = time.monotonic()
                    later = links.get(table.name, [])
                    copied, pending[table.name] = _copy_model_table(src, dst, table, later)
                    if copied:
                        logger.info("  %s: %d row(s) (%.1fs)", table.name, copied,
                                    time.monotonic() - started)
                for table in tables:
                    if pending.get(table.name):
                        _fill_links(dst, table, links[table.name], pending[table.name])
                for name, columns in _RAW_TABLES:
                    started = time.monotonic()
                    copied = _copy_raw_table(src, dst, name, columns)
                    if copied:
                        logger.info("  %s: %d row(s) (%.1fs)", name, copied,
                                    time.monotonic() - started)
                # Stamped in the same transaction as the copy: up to here it all
                # lands, or none of it does and the database is still empty.
                command.stamp(_alembic_config(dst), "head")
                dst.commit()
                logger.info("Checking every row against the SQLite snapshot ...")
                try:
                    counts = verify(src, dst)
                except MigrationError as exc:
                    raise MigrationError(
                        f"{exc} The copy was written but does not match: drop the "
                        "PostgreSQL database and create it again empty before retrying, "
                        "and please report this."
                    ) from exc
        finally:
            source.dispose()
    target.dispose()
    return counts


def main(argv: Optional[Sequence[str]] = None) -> int:
    from ..config import env, paths

    parser = argparse.ArgumentParser(
        prog="python -m backend.scripts.sqlite_to_postgres",
        description="Copy a Grimoire SQLite database into an empty PostgreSQL database.",
    )
    parser.add_argument("--sqlite", default=paths.DB_PATH,
                        help="SQLite database to copy (default: DATA_PATH/grimoire.db)")
    parser.add_argument("--postgres", default=env.DATABASE_URL or None,
                        help="empty PostgreSQL database to copy into (default: DATABASE_URL)")
    args = parser.parse_args(argv)
    args.sqlite = os.path.abspath(args.sqlite)
    logging.basicConfig(level=logging.INFO, format="%(message)s", stream=sys.stdout)
    if not args.postgres:
        parser.error("give --postgres URL (or set DATABASE_URL)")
    try:
        counts = migrate(args.sqlite, args.postgres)
    except MigrationError as exc:
        logger.error("Migration stopped: %s", exc)
        return 1
    except Exception as exc:
        # Everything up to the final check runs in one transaction, so a failure
        # part-way leaves the PostgreSQL database as it was: empty.
        logger.exception("Migration failed: %s", exc)
        logger.error(
            "Nothing was written to PostgreSQL and %s was not changed. "
            "Please report this error.", args.sqlite
        )
        return 1
    total = sum(counts.values())
    logger.info(
        "Done: %d row(s) in %d table(s) copied and verified. Set DATABASE_URL to this "
        "database and start Grimoire. %s was not changed.",
        total, len(counts), args.sqlite,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
