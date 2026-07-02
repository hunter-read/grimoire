"""Library package — registers scan and stats routes, exports both routers."""
from .core import router, public_router
from ._helpers import background_indexer, run_rescan_sync  # re-exported for main.py

__all__ = ["router", "public_router", "background_indexer", "run_rescan_sync"]
