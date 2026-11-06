"""Alembic environment for Grimoire.

Targets the application's SQLAlchemy metadata (``Base.metadata``). The database
URL is resolved from the app config when running standalone (the Alembic CLI),
or from a live connection passed by the runtime migrator in
``backend/models/db.py`` (the ``connection`` attribute on the Alembic config).

SQLite has limited ALTER TABLE support, so ``render_as_batch=True`` is enabled
in both online and offline modes to make table rebuilds work.
"""
import warnings
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, exc, pool

from backend.models.base import Base

# Import the model modules for their side effect of registering every table on
# Base.metadata, so autogenerate sees the full schema.
import backend.models  # noqa: F401

config = context.config

# Configure logging from the ini only for standalone CLI runs. When the app
# runs migrations in-process it passes a live connection via config.attributes;
# in that case we must NOT call fileConfig, which would tear down the app's
# existing loggers/handlers (e.g. the in-memory log ring buffer).
if config.config_file_name is not None and config.attributes.get("connection") is None:
    try:
        fileConfig(config.config_file_name, disable_existing_loggers=False)
    except Exception:
        # Logging config is optional; never let it break a runtime migration.
        pass

target_metadata = Base.metadata

# SQLAlchemy can't reflect an expression index (users' lower(username) index,
# migration 0050) and says so each time a migration lists a table's indexes to
# see whether one of its own exists. The index is skipped, which is all those
# checks need, so this one message is dropped rather than logged every start.
warnings.filterwarnings(
    "ignore",
    message="Skipped unsupported reflection of expression-based index",
    category=exc.SAWarning,
)

# FTS5 virtual tables, the shadow tables SQLite keeps for them, and the
# book_pages table book_search indexes are created by
# migrations with raw SQL rather than declared as models, so autogenerate (and
# ``alembic check``) must not report them as tables to drop.
_UNMODELLED_TABLE_PREFIXES = ("book_search", "book_pages", "content_search")


# Indexes made outside the models on purpose: the expression index behind
# case-insensitive usernames (``usernames.ensure_unique_index``). SQLite cannot
# reflect it; PostgreSQL can, and would otherwise report it as one to drop.
_UNMODELLED_INDEXES = ("ix_users_username_lower",)


def _include_object(obj, name, type_, reflected, compare_to) -> bool:
    if type_ == "table" and reflected and compare_to is None:
        return not (name or "").startswith(_UNMODELLED_TABLE_PREFIXES)
    if type_ == "index" and reflected and compare_to is None:
        return name not in _UNMODELLED_INDEXES
    return True


def _compare_type(context, inspected_column, metadata_column, inspected_type, metadata_type):
    """Leave PostgreSQL's unbounded VARCHAR alone.

    ``String(n)`` is created without its length there (``models/postgres.py``),
    so a length difference is by design. Collation still counts. Anything else
    goes to Alembic's own comparison (None).
    """
    if context.dialect.name == "postgresql":
        from sqlalchemy import String, Text

        expected = metadata_type.dialect_impl(context.dialect)
        if (
            isinstance(expected, String)
            and not isinstance(expected, Text)
            and isinstance(inspected_type, String)
            and not isinstance(inspected_type, Text)
        ):
            return (expected.collation or None) != (inspected_type.collation or None)
    return None


def _get_url() -> str:
    """DB URL for standalone CLI runs; falls back to the app's configured database.

    Precedence: ``-x url=...`` CLI override, then the ini's ``sqlalchemy.url``,
    then the app's ``DATABASE_URL`` (PostgreSQL), then its SQLite ``DB_PATH``.
    """
    x_args = context.get_x_argument(as_dictionary=True)
    if x_args.get("url"):
        return x_args["url"]
    url = config.get_main_option("sqlalchemy.url")
    if url:
        return url
    from backend.config import DATABASE_URL, DB_PATH

    if DATABASE_URL:
        from backend.models.db import postgres_url

        return postgres_url(DATABASE_URL)
    return f"sqlite:///{DB_PATH}"


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode (emit SQL to stdout, no DB connection)."""
    context.configure(
        url=_get_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,
        compare_type=_compare_type,
        include_object=_include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


def _run_with_connection(connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        render_as_batch=True,
        compare_type=_compare_type,
        include_object=_include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    When the runtime migrator supplies a live connection via
    ``config.attributes['connection']`` we reuse it; otherwise we build an
    engine from the resolved URL (the standard CLI path).
    """
    connectable = config.attributes.get("connection", None)
    if connectable is not None:
        _run_with_connection(connectable)
        return

    section = config.get_section(config.config_ini_section, {})
    section["sqlalchemy.url"] = _get_url()
    connectable = engine_from_config(
        section,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        _run_with_connection(connection)


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
