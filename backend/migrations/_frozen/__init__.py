"""Logic Alembic revisions need, copied here so later app changes cannot reach them.

A revision has to do on every upgrade what it did the day it was written, so a
revision never imports ``backend.*`` outside ``backend.migrations``
(``test_migrations_frozen.py`` enforces this). A module here is never edited
once a revision uses it: a revision that needs different behaviour gets a new
module.
"""
