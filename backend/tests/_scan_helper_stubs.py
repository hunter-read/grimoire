"""Stand-in entry points for the scan helper process, for test_scan_isolation.py.

A spawned child imports its target by name, so a patch made in the test
process never reaches it. These live in a module of their own so the child can
import them.
"""
import os
import time
from multiprocessing.connection import Connection


def hang_main(conn: Connection) -> None:
    """Take a request and never answer it, like MuPDF stuck on a document."""
    conn.recv()
    time.sleep(60)


def crash_main(conn: Connection) -> None:
    """Take a request and die without answering, like a native crash."""
    conn.recv()
    os._exit(3)


def busy_main(conn: Connection) -> None:
    """Spin the CPU for a while before answering, as a heavy render does."""
    conn.recv()
    deadline = time.monotonic() + 1.5
    while time.monotonic() < deadline:
        pass
    conn.send((True, 7))
