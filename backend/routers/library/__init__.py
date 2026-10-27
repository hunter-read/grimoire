"""Library package — registers scan and stats routes, exports both routers."""
from .core import router, stats_router

__all__ = ["router", "stats_router"]
