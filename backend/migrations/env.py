"""Alembic environment for Grimoire.

Targets the application's SQLAlchemy metadata (``Base.metadata``). The database
URL is resolved from the app config when running standalone (the Alembic CLI),
or from a live connection passed by the runtime migrator in
``backend/models/db.py`` (the ``connection`` attribute on the Alembic config).

SQLite has limited ALTER TABLE support, so ``render_as_batch=True`` is enabled
in both online and offline modes to make table rebuilds work.
"""
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

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


def _get_url() -> str:
    """DB URL for standalone CLI runs; falls back to the app's configured path.

    Precedence: ``-x url=...`` CLI override, then the ini's ``sqlalchemy.url``,
    then the app's configured ``DB_PATH``.
    """
    x_args = context.get_x_argument(as_dictionary=True)
    if x_args.get("url"):
        return x_args["url"]
    url = config.get_main_option("sqlalchemy.url")
    if url:
        return url
    from backend.config import DB_PATH

    return f"sqlite:///{DB_PATH}"


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode (emit SQL to stdout, no DB connection)."""
    context.configure(
        url=_get_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def _run_with_connection(connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        render_as_batch=True,
        compare_type=True,
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
