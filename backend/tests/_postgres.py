"""Running the suite on PostgreSQL (``TEST_DATABASE_URL``).

Imported by conftest before any backend module, so it must not import one.
"""
import os

from sqlalchemy.engine import make_url

ON_POSTGRES = bool(os.environ.get("TEST_DATABASE_URL", "").strip())


def fresh_database(url: str, worker: str) -> str:
    """Drop and create ``grimoire_test_<worker>`` on the server ``url`` names; return its URL.

    ``url`` must name a database the user can connect to (it is only used to
    issue CREATE/DROP DATABASE) and the user needs CREATEDB.
    """
    import psycopg

    base = make_url(url.replace("postgres://", "postgresql://", 1))
    name = f"grimoire_test_{worker}"
    admin = base.set(drivername="postgresql").render_as_string(hide_password=False)
    with psycopg.connect(admin, autocommit=True) as conn:
        conn.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
        conn.execute(f'CREATE DATABASE "{name}"')
    return base.set(database=name).render_as_string(hide_password=False)


def search_book_ids(db, term: str) -> list:
    """Book ids whose indexed page text matches the single word ``term``, on either database."""
    from sqlalchemy import text

    if ON_POSTGRES:
        sql = "SELECT book_id FROM book_pages WHERE search @@ phraseto_tsquery('grimoire', :t)"
    else:
        sql = (
            "SELECT book_id FROM book_search "
            "JOIN book_pages ON book_pages.id = book_search.rowid "
            "WHERE book_search MATCH :t"
        )
    return [row[0] for row in db.execute(text(sql), {"t": term}).fetchall()]


def scratch_database(name: str) -> str:
    """A new, empty database on the TEST_DATABASE_URL server; returns its URL."""
    return fresh_database(os.environ["TEST_DATABASE_URL"].strip(), f"scratch_{name}")
