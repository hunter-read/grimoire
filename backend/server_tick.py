"""Slowing uvicorn's housekeeping loop down, so an idle server sleeps.

uvicorn wakes ten times a second, for as long as it runs, to refresh the cached
``Date`` header and check whether it has been asked to exit. Neither needs that:
the header carries whole seconds, and a second's delay in noticing a shutdown is
nothing. On a small home server those wake-ups were most of Grimoire's CPU use
when nobody was using it, and they keep a low-power CPU from staying asleep.

``Server.main_loop`` has no setting for its interval, so this swaps the method
for one that sleeps a second at a time. It is replaced only when it looks the
way it did when this was written; an unfamiliar one is left alone, which costs
nothing but the saving.
"""
import asyncio
import inspect
import logging
from typing import Any

logger = logging.getLogger("grimoire")

# Seconds between wake-ups.
TICK_SECONDS = 1.0
# uvicorn counts tenths of a second and does its once-a-second work when the
# count is a multiple of ten. Counting in tens keeps that work on every wake-up.
_COUNT_PER_TICK = 10
_COUNT_WRAP = 864000
# uvicorn's own loop, kept once replaced.
_stock_main_loop: Any = None


async def _main_loop(self: Any) -> None:
    counter = 0
    should_exit = await self.on_tick(counter)
    while not should_exit:
        counter = (counter + _COUNT_PER_TICK) % _COUNT_WRAP
        await asyncio.sleep(TICK_SECONDS)
        should_exit = await self.on_tick(counter)


def _is_stock_loop(server_cls: Any) -> bool:
    """Whether ``main_loop`` is the tenth-of-a-second loop this replaces."""
    try:
        source = inspect.getsource(server_cls.main_loop)
    except (OSError, TypeError):
        return False
    return "asyncio.sleep(0.1)" in source and "self.on_tick(counter)" in source


def slow_down() -> bool:
    """Make uvicorn wake once a second. Returns whether its loop is now the slow one."""
    global _stock_main_loop
    try:
        from uvicorn.server import Server
    except ImportError:
        return False
    if Server.main_loop is _main_loop:
        return True
    if not _is_stock_loop(Server):
        logger.debug("uvicorn's main loop has changed; leaving its wake-up interval alone.")
        return False
    _stock_main_loop = Server.main_loop
    Server.main_loop = _main_loop  # type: ignore[method-assign]  # see module docstring
    return True
